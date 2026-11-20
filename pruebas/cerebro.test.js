// Prueba que DELTA no pueda afirmar un cambio en la agenda sin haberlo hecho.
// Usa un servidor falso que imita la API de Claude (no gasta créditos).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "delta-cerebro-"));
process.env.ANTHROPIC_API_KEY = "falsa";

let guion = []; // respuestas que dará el servidor falso, en orden
const recibidas = [];
const servidor = http.createServer((req, res) => {
  let b = "";
  req.on("data", (c) => (b += c));
  req.on("end", () => {
    const cuerpo = JSON.parse(b);
    recibidas.push(cuerpo);
    const content = guion.shift()(cuerpo);
    const usaHerramienta = content.some((c) => c.type === "tool_use");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      id: "msg_" + recibidas.length, type: "message", role: "assistant", model: cuerpo.model, content,
      stop_reason: usaHerramienta ? "tool_use" : "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
    }));
  });
});
await new Promise((r) => servidor.listen(0, r));
process.env.ANTHROPIC_BASE_URL = `http://localhost:${servidor.address().port}`;
after(() => servidor.close());

const { hablarConDelta, afirmaAccion, nuevaConversacion, quitarDisculpas } = await import("../server/cerebro.js");
const agenda = await import("../server/agenda.js");
const { db } = await import("../server/db.js");

const texto = (t) => () => [{ type: "text", text: t }];
const usar = (name, input) => () => [{ type: "tool_use", id: "toolu_" + Math.random().toString(36).slice(2), name, input }];

test("detecta frases que afirman un cambio", () => {
  assert.ok(afirmaAccion("Listo, señor. Agendé la junta para mañana."));
  assert.ok(afirmaAccion("Ya quedó programado su recordatorio."));
  assert.ok(afirmaAccion("Anoté la tarea."));
  assert.ok(!afirmaAccion("Hoy no tiene eventos, señor."));
  assert.ok(!afirmaAccion("¿A qué hora quiere la junta?"));
});

test("si dice que agendó sin hacerlo, se le obliga a hacerlo de verdad", async () => {
  recibidas.length = 0;
  guion = [
    texto("Listo, señor. Agendé la junta con Acme mañana a las 10."), // mentira: no llamó herramienta
    usar("crear_evento", { titulo: "Junta Acme", inicio: "2026-12-01T10:00" }), // tras la verificación, sí la llama
    texto("Agendé la junta con Acme el 1 de diciembre a las 10:00."),
  ];
  const r = await hablarConDelta("Agenda junta con Acme el 1 de diciembre a las 10");
  assert.equal(recibidas.length, 3);
  const verif = recibidas[1].messages.at(-1);
  assert.equal(verif.role, "system");
  assert.match(verif.content, /no llamaste ninguna herramienta/);
  assert.ok(agenda.listarEventos({ desde: "2026-12-01", hasta: "2026-12-01" }).some((e) => e.titulo === "Junta Acme"));
  assert.match(r, /Agendé/);
});

test("si usa la herramienta a la primera, no hay verificación extra", async () => {
  recibidas.length = 0;
  guion = [usar("crear_tarea", { titulo: "Llamar al contador" }), texto("Anoté la tarea, señor.")];
  await hablarConDelta("Anota llamar al contador");
  assert.equal(recibidas.length, 2);
});

test("cada mensaje lleva la agenda real y el historial dice qué se hizo de verdad", async () => {
  recibidas.length = 0;
  guion = [texto("Tiene una tarea pendiente: llamar al contador.")];
  await hablarConDelta("¿Qué tengo pendiente?");
  const ultimo = recibidas[0].messages.at(-1).content;
  assert.match(ultimo, /\[Agenda actual/);
  assert.match(ultimo, /Llamar al contador/);
  const historial = recibidas[0].messages.filter((m) => m.role === "assistant").map((m) => m.content).join("\n");
  assert.match(historial, /\[Herramientas usadas en ese turno: crear_tarea\]/);
  const fila = db.prepare("SELECT acciones FROM conversacion ORDER BY id DESC LIMIT 1").get();
  assert.equal(fila.acciones, "[Herramientas usadas en ese turno: ninguna]");
});

test("conversación nueva: DELTA olvida la plática anterior", async () => {
  nuevaConversacion();
  recibidas.length = 0;
  guion = [texto("Hola, señor.")];
  await hablarConDelta("Hola");
  assert.equal(recibidas[0].messages.length, 1); // solo el mensaje nuevo, sin historial viejo
});

test("no arrastra disculpas por respuestas pasadas", async () => {
  const r = quitarDisculpas(
    "Listo, señor. Agendé la ceremonia para el sábado 28 a las 10:00.\n\n" +
      "Le debo la verdad: es la primera vez en esta conversación que uso de verdad su agenda. Le pido una disculpa.",
  );
  assert.equal(r, "Listo, señor. Agendé la ceremonia para el sábado 28 a las 10:00.");
  assert.equal(quitarDisculpas("Lo siento, no puedo apagar su laptop todavía."), "Lo siento, no puedo apagar su laptop todavía.");

  nuevaConversacion();
  guion = [usar("crear_tarea", { titulo: "Revisar bandera" }), texto("Listo, señor.\n\nLe debo la verdad: en mis mensajes anteriores no lo hice.")];
  const respuesta = await hablarConDelta("Agrega la tarea revisar bandera");
  assert.equal(respuesta, "Listo, señor.");
  // Un turno sin herramientas no se anota con "ninguna" en el historial.
  guion = [texto("Buenas tardes, señor.")];
  await hablarConDelta("Hola");
  recibidas.length = 0;
  guion = [texto("Aquí sigo.")];
  await hablarConDelta("¿Sigues ahí?");
  const hist = recibidas[0].messages.map((m) => m.content).join("\n");
  assert.doesNotMatch(hist, /ninguna\]/);
  assert.doesNotMatch(hist, /Le debo la verdad/);
});

test("los archivos adjuntos llegan a DELTA y quedan anotados en la plática", async () => {
  const { guardarArchivo } = await import("../server/archivos.js");
  const a = guardarArchivo(Buffer.from("Cliente,Monto\nSol,4500"), "ventas.csv");
  nuevaConversacion();
  recibidas.length = 0;
  guion = [texto("Vendió 4,500 a Sol, señor.")];
  await hablarConDelta("¿Cuánto vendí?", "app", [a.id]);
  const contenido = recibidas[0].messages.at(-1).content;
  assert.equal(contenido[0].type, "document");
  assert.match(contenido[0].source.data, /Sol,4500/);
  assert.match(contenido.at(-1).text, /\[Adjuntó: ventas\.csv/);
  // En el siguiente turno ya no se reenvía el archivo; queda la nota con su id para leer_archivo.
  recibidas.length = 0;
  guion = [texto("De nada.")];
  await hablarConDelta("Gracias");
  const previo = recibidas[0].messages[0].content;
  assert.equal(typeof previo, "string");
  assert.match(previo, new RegExp(`archivo ${a.id}`));
});

test("avisa a la app cuando DELTA cambió algo de verdad (para el sonido)", async () => {
  const info = {};
  guion = [usar("crear_tarea", { titulo: "Probar sonido" }), texto("Anotada, señor.")];
  await hablarConDelta("Anota probar sonido", "app", [], info);
  assert.equal(info.hizoCambio, true);
  const info2 = {};
  guion = [texto("Buenas tardes.")];
  await hablarConDelta("Hola", "app", [], info2);
  assert.equal(info2.hizoCambio, false);
});
