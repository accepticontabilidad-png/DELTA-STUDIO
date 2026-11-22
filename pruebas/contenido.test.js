import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "delta-cont-"));
process.env.ZONA_HORARIA = "America/Mexico_City";
delete process.env.ANTHROPIC_API_KEY;
const { db } = await import("../server/db.js");
const agencia = await import("../server/agencia.js");
const k = await import("../server/contenido.js");
const fin = await import("../server/finanzas.js");
const { ahoraLocalISO } = await import("../server/tiempo.js");

const hoy = ahoraLocalISO().slice(0, 10);
const dias = (n) => new Date(Date.parse(hoy + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);

test("crear, mover por etapas y publicar", () => {
  agencia.crearCliente({ nombre: "Kardia" });
  const p = k.crearContenido({ cliente: "Kardia", titulo: "Reel 5 señales de alerta", formato: "Reel", red: "instagram", publicar: dias(5) });
  assert.equal(p.etapa, "planeado");
  assert.equal(p.formato, "reel");
  assert.equal(p.dias_para_publicar, 5);
  assert.equal(k.moverContenido(p.id, 1).etapa, "grabar");
  assert.equal(k.moverContenido(p.id, 1).etapa, "edicion");
  assert.equal(k.moverContenido(p.id, -1).etapa, "grabar");
  assert.equal(k.actualizarContenido(p.id, { etapa: "esperando al cliente" }).etapa, "cliente");
  const pub = k.actualizarContenido(p.id, { etapa: "publicado" });
  assert.equal(pub.publicado, hoy);
  assert.equal(pub.a_tiempo, true);
  assert.equal(k.moverContenido(p.id, 1).etapa, "publicado"); // no pasa de la última
  assert.equal(k.actualizarContenido(p.id, { etapa: "aprobado" }).publicado, null);
  assert.throws(() => k.actualizarContenido(p.id, { etapa: "volando" }), /Etapa no válida/);
  assert.throws(() => k.crearContenido({ cliente: "Kardia", titulo: "" }), /título/);
  assert.throws(() => k.crearContenido({ cliente: "Kardia", titulo: "x", publicar: "mañana" }), /fecha/);
});

test("atrasadas y esperando al cliente: semáforo, Delta Score y Pulso", () => {
  const c = agencia.crearCliente({ nombre: "Endo Woman" });
  const antes = agencia.evaluarCliente(agencia.obtenerCliente(c.id));
  k.crearContenido({ cliente: c.id, titulo: "Carrusel calendario", formato: "carrusel", etapa: "edicion", publicar: dias(-2) });
  let e = agencia.evaluarCliente(agencia.obtenerCliente(c.id));
  assert.equal(e.salud.automatico, "amarillo");
  assert.match(e.salud.motivos.join(), /Contenido atrasado: Carrusel calendario \(2 días\)/);
  const entregas = e.score.partes.find((x) => x.clave === "entregas");
  assert.equal(entregas.pts, 20);
  assert.match(entregas.nota, /1 pieza de contenido atrasada/);
  assert.ok(e.score.puntos < antes.score.puntos);

  const v = k.crearContenido({ cliente: c.id, titulo: "Video quirófano", formato: "video", etapa: "cliente", publicar: dias(10) });
  db.prepare("UPDATE contenidos SET etapa_desde = ? WHERE id = ?").run(new Date(Date.now() - 3 * 864e5).toISOString(), v.id);
  k.crearContenido({ cliente: c.id, titulo: "Historia promo", formato: "historia", etapa: "planeado", publicar: dias(-6) });
  e = agencia.evaluarCliente(agencia.obtenerCliente(c.id));
  assert.equal(e.salud.automatico, "rojo"); // 6 días de atraso
  assert.match(e.salud.motivos.join(), /esperando al cliente: Video quirófano/);
  assert.match(e.score.partes.find((x) => x.clave === "atencion").nota, /1 pieza espera al cliente/);

  const p = fin.pulso();
  const item = (x) => p.items.find((i) => i.clave === x);
  assert.equal(item("contenido_atrasado").n, 2);
  assert.equal(item("contenido_atrasado").ir, "#/contenido");
  assert.match(item("contenido_atrasado").detalle[0], /Historia promo \(Endo Woman\)/);
  assert.equal(item("contenido_cliente").n, 1);
});

test("tablero: columnas, atrasadas, por cliente y búsqueda por título", () => {
  k.crearContenido({ cliente: "Kardia", titulo: "Post día del corazón", publicar: dias(0), etapa: "grabar" });
  const t = k.tableroContenido();
  assert.deepEqual(t.etapas.map((e) => e.clave), ["planeado", "grabar", "edicion", "cliente", "aprobado", "publicado"]);
  assert.equal(t.atrasadas.length, 2);
  assert.equal(t.atrasadas[0].titulo, "Historia promo");
  assert.equal(t.esperando_cliente.length, 1);
  assert.ok(t.esta_semana.some((p) => p.titulo === "Post día del corazón"));
  assert.equal(t.por_cliente[0].nombre, "Endo Woman");
  assert.equal(t.por_cliente[0].atrasadas, 2);
  assert.equal(k.tableroContenido({ cliente: "Kardia" }).etapas.flatMap((e) => e.piezas).length, 2);

  assert.equal(k.buscarContenido({ titulo: "corazón" }).titulo, "Post día del corazón");
  assert.throws(() => k.buscarContenido({ titulo: "zzz" }), /No encuentro/);
  k.crearContenido({ cliente: "Kardia", titulo: "Post día del corazón parte 2" });
  assert.throws(() => k.buscarContenido({ titulo: "día del corazón" }), /varias piezas/);
  assert.equal(k.borrarContenido(k.buscarContenido({ titulo: "parte 2" }).id).ok, true);
});
