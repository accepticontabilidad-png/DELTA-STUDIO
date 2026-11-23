// Pruebas de DELTA Mac: vinculación con código, órdenes que van y vienen, y el chasquido.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "delta-mac-"));
const mac = await import("../server/mac.js");
const { suscribirPantalla } = await import("../server/avisos.js");

beforeEach(() => mac._reiniciar());

function vincularUna(nombre = "MacBook de prueba") {
  const { codigo } = mac.nuevoCodigo();
  return mac.vincular({ codigo, nombre, version: "1.0" });
}

test("vincula con el código correcto y da una llave que solo se guarda como huella", () => {
  const { codigo, minutos } = mac.nuevoCodigo();
  assert.match(codigo, /^\d{6}$/);
  assert.equal(minutos, 10);
  const r = mac.vincular({ codigo: codigo.slice(0, 3) + " " + codigo.slice(3), nombre: "MacBook <b>Pro</b>" });
  assert.match(r.llave, /^dmac_/);
  assert.equal(r.nombre, "MacBook bProb");
  assert.equal(mac.macDeLlave(r.llave).id, r.id);
  assert.equal(mac.macDeLlave("dmac_otra"), null);
  assert.equal(mac.macDeLlave(undefined), null);
  // El código ya se usó
  assert.throws(() => mac.vincular({ codigo }), /venció/);
});

test("código equivocado: falla y a los 5 intentos se anula", () => {
  const { codigo } = mac.nuevoCodigo();
  const malo = codigo === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++) assert.throws(() => mac.vincular({ codigo: malo }), /incorrecto/);
  assert.throws(() => mac.vincular({ codigo }), /Demasiados intentos/);
});

test("sin Mac vinculada o desconectada, DELTA lo dice claro", async () => {
  await assert.rejects(mac.pedir("abrir_app", { app: "Safari" }), /no hay una Mac vinculada/);
  const { id } = vincularUna();
  // Se vinculó hace un momento: cuenta como en línea un rato aunque no esté preguntando
  assert.equal(mac.estado().macs[0].en_linea, true);
  mac.desvincular(id);
  assert.equal(mac.estado().macs.length, 0);
  await assert.rejects(mac.pedir("volumen", { nivel: 10 }), /no hay una Mac vinculada/);
  await assert.rejects(mac.pedir("formatear_disco", {}), /No conozco/);
});

test("una orden llega a la Mac que está esperando y vuelve el resultado", async () => {
  const { llave } = vincularUna();
  const m = mac.macDeLlave(llave);
  const espera = mac.esperarOrdenes(m, { ms: 2000 });
  const pedido = mac.pedir("abrir_app", { app: "Safari" });
  const ordenes = await espera;
  assert.equal(ordenes.length, 1);
  assert.equal(ordenes[0].accion, "abrir_app");
  assert.equal(ordenes[0].riesgo, false);
  assert.deepEqual(ordenes[0].datos, { app: "Safari" });
  mac.recibirResultado(m, { id: ordenes[0].id, ok: true, resultado: "Abrí Safari" });
  assert.equal(await pedido, "Abrí Safari");
});

test("lo delicado va marcado como riesgo; si en la Mac dicen que no, DELTA recibe el no", async () => {
  const { llave } = vincularUna();
  const m = mac.macDeLlave(llave);
  const pedido = mac.pedir("mover_a_papelera", { ruta: "/Users/yo/a.txt" });
  const [orden] = await mac.esperarOrdenes(m, { ms: 2000 }); // estaba en la fila
  assert.equal(orden.riesgo, true);
  mac.recibirResultado(m, { id: orden.id, ok: false, error: "El dueño dijo que no." });
  await assert.rejects(pedido, /dijo que no/);
});

test("si la Mac colgó, la orden vuelve a la fila", async () => {
  const { llave } = vincularUna();
  const m = mac.macDeLlave(llave);
  const pedido = mac.pedir("apps_abiertas");
  const primeras = await mac.esperarOrdenes(m, { ms: 2000 });
  mac.devolver(primeras);
  const otra = await mac.esperarOrdenes(m, { ms: 2000 });
  assert.equal(otra[0].id, primeras[0].id);
  mac.recibirResultado(m, { id: otra[0].id, ok: true, resultado: ["Finder"] });
  assert.deepEqual(await pedido, ["Finder"]);
});

test("con el control apagado no se manda nada", async () => {
  vincularUna();
  mac.activarControl(false);
  await assert.rejects(mac.pedir("abrir_app", { app: "Notas" }), /apagado/);
  assert.equal(mac.estado().control_activo, false);
});

test("si nadie contesta, no se queda colgado", async () => {
  vincularUna();
  await assert.rejects(mac.pedir("abrir_app", { app: "Notas" }, { espera: 50 }), /no contestó/);
  await assert.rejects(mac.pedir("escribir_texto", { texto: "hola" }, { espera: 50 }), /Nadie confirmó/);
});

test("el doble chasquido avisa a las pantallas y queda pendiente un rato para la que se abre", () => {
  const { llave } = vincularUna();
  const eventos = [];
  const quitar = suscribirPantalla((d) => eventos.push(d));
  mac.despertar(mac.macDeLlave(llave));
  quitar();
  assert.ok(eventos.some((e) => e.tipo === "despertar"));
  assert.equal(mac.despertarReciente().despertar, true);
  assert.equal(mac.despertarReciente().despertar, false); // se consume
});
