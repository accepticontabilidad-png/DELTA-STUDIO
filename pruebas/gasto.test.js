// Medidor de gasto: precios, tope mensual que nunca se pasa y modelo barato para lo sencillo.
// Usa un servidor falso que imita la API de Claude (no gasta créditos).
import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "delta-gasto-"));
process.env.ANTHROPIC_API_KEY = "falsa";

let guion = [];
const recibidas = [];
let uso = { input_tokens: 1000, output_tokens: 500 };
const servidor = http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    const cuerpo = JSON.parse(b);
    recibidas.push(cuerpo);
    const content = (guion.shift() || (() => [{ type: "text", text: "Listo." }]))(cuerpo);
    const usaHerramienta = content.some((c) => c.type === "tool_use");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      id: "msg_" + recibidas.length, type: "message", role: "assistant", model: cuerpo.model, content,
      stop_reason: usaHerramienta ? "tool_use" : "end_turn", stop_sequence: null, usage: uso,
    }));
  });
});
await new Promise((r) => servidor.listen(0, r));
process.env.ANTHROPIC_BASE_URL = `http://localhost:${servidor.address().port}`;
after(() => servidor.close());

const gasto = await import("../server/gasto.js");
const { hablarConDelta, elegirModelo } = await import("../server/cerebro.js");
const { db, setAjuste } = await import("../server/db.js");

const usar = (name, input) => () => [{ type: "tool_use", id: "toolu_" + Math.random().toString(36).slice(2), name, input }];

beforeEach(() => {
  db.exec("DELETE FROM gasto_api; DELETE FROM ajustes WHERE clave LIKE 'gasto_%' OR clave IN ('modelo_modo', 'ultimo_modelo');");
  recibidas.length = 0;
  guion = [];
  uso = { input_tokens: 1000, output_tokens: 500 };
});

test("calcula el costo con el precio de cada modelo", () => {
  // Opus 5.5: 4 USD por millón de entrada, 20 de salida
  assert.equal(gasto.costoDe("claude-opus-5-5", { input_tokens: 1_000_000 }), 4);
  assert.equal(gasto.costoDe("claude-opus-5-5", { output_tokens: 1_000_000 }), 20);
  // Haiku 5.5: 40 veces más barato
  assert.ok(Math.abs(gasto.costoDe("claude-haiku-5-5", { input_tokens: 50_000, output_tokens: 50_000 }) - 0.03) < 1e-12);
  // y por encima de 100 mil tokens de entrada, su tarifa sube
  assert.ok(gasto.costoDe("claude-haiku-5-5", { input_tokens: 200_000 }) > 0.02 * 2);
  // Caché: escribir cuesta 1.25 veces la entrada; leer, mucho menos
  assert.equal(gasto.costoDe("claude-sonnet-5-5", { cache_creation_input_tokens: 1_000_000 }), 2.5);
  assert.equal(gasto.costoDe("claude-sonnet-5-5", { cache_read_input_tokens: 1_000_000 }), 0.1);
  // Búsquedas web: un centavo cada una
  assert.equal(gasto.costoDe("claude-sonnet-5-5", { server_tool_use: { web_search_requests: 3 } }), 0.03);
  // Un modelo desconocido se cuenta caro, nunca gratis
  assert.ok(gasto.costoDe("claude-nuevo-9", { input_tokens: 1_000_000 }) >= 4);
});

test("lo sencillo va al modelo económico y lo complejo al fuerte", () => {
  assert.equal(elegirModelo("Anota llamar al contador mañana"), "claude-haiku-5-5");
  assert.equal(elegirModelo("¿Qué tengo hoy?"), "claude-haiku-5-5");
  assert.equal(elegirModelo("Analiza las ventas del trimestre y dame una estrategia"), "claude-opus-5-5");
  assert.equal(elegirModelo("Redacta un correo para el cliente"), "claude-opus-5-5");
  assert.equal(elegirModelo("Mira esto", ["arch_1"]), "claude-opus-5-5");
  setAjuste("modelo_modo", "fuerte");
  assert.equal(elegirModelo("Hola"), "claude-opus-5-5");
  setAjuste("modelo_modo", "economico");
  assert.equal(elegirModelo("Analiza todo"), "claude-haiku-5-5");
});

test("cada llamada del chat queda anotada en el medidor", async () => {
  guion = [usar("crear_tarea", { titulo: "Llamar al contador" }), () => [{ type: "text", text: "Anoté la tarea." }]];
  await hablarConDelta("Anota llamar al contador");
  assert.equal(recibidas.length, 2);
  assert.equal(recibidas[0].model, "claude-haiku-5-5");
  assert.equal(recibidas[0].fallbacks, undefined); // el económico no lleva respaldo del servidor
  const e = gasto.estado();
  assert.equal(e.por_modelo[0].llamadas, 2);
  assert.ok(Math.abs(e.gastado - 2 * gasto.costoDe("claude-haiku-5-5", uso)) < 1e-9);
});

test("al llegar al tope DELTA deja de usar a Claude y avisa", async () => {
  setAjuste("gasto_tope", 1);
  db.prepare("INSERT INTO gasto_api (mes, origen, modelo, costo) VALUES (?, 'chat', 'claude-opus-5-5', 0.9)").run(gasto.mesActual());
  const r = await hablarConDelta("¿Qué tengo hoy?");
  assert.equal(recibidas.length, 0); // ni una llamada más
  assert.match(r, /tope de gasto/);
  assert.equal(gasto.estado().bloqueado, true);
  const aviso = db.prepare("SELECT texto FROM avisos ORDER BY id DESC LIMIT 1").get();
  assert.match(aviso.texto, /tope de gasto/);
});

test("si se llega al tope a media tarea, se corta antes de la siguiente llamada", async () => {
  setAjuste("gasto_tope", 2);
  setAjuste("modelo_modo", "fuerte");
  uso = { input_tokens: 0, output_tokens: 60_000 }; // 1.20 USD por llamada con Opus
  guion = [usar("listar_tareas", {}), usar("listar_tareas", {}), usar("listar_tareas", {})];
  const r = await hablarConDelta("Revisa todas mis tareas");
  assert.equal(recibidas.length, 2);
  assert.match(r, /tope de gasto/);
});

test("al 80 % pasa a modo ahorro y usa el económico para todo", () => {
  setAjuste("gasto_tope", 10);
  db.prepare("INSERT INTO gasto_api (mes, origen, modelo, costo) VALUES (?, 'chat', 'claude-opus-5-5', 8.1)").run(gasto.mesActual());
  assert.equal(gasto.estado().ahorro, true);
  assert.equal(elegirModelo("Analiza la estrategia del cliente"), "claude-haiku-5-5");
});

test("se puede corregir lo gastado con la cifra de la consola", () => {
  db.prepare("INSERT INTO gasto_api (mes, origen, modelo, costo) VALUES (?, 'chat', 'claude-opus-5-5', 2)").run(gasto.mesActual());
  const e = gasto.guardarAjustes({ tope: 50, ya_gastado: 15 });
  assert.equal(e.tope, 50);
  assert.equal(e.gastado, 15);
  assert.equal(e.ajuste_manual, 13);
  assert.throws(() => gasto.guardarAjustes({ tope: -3 }));
});
