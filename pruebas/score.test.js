import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "delta-score-"));
process.env.ZONA_HORARIA = "America/Mexico_City";
delete process.env.ANTHROPIC_API_KEY;
const { db } = await import("../server/db.js");
const agencia = await import("../server/agencia.js");
const fin = await import("../server/finanzas.js");
const { deltaScore, nivelDe } = await import("../server/score.js");
const { ahoraLocalISO } = await import("../server/tiempo.js");
const hoy = ahoraLocalISO().slice(0, 10);
const haceDias = (n) => new Date(Date.parse(hoy + "T12:00:00Z") - n * 864e5).toISOString().slice(0, 10);
const parte = (s, k) => s.partes.find((p) => p.clave === k);

test("cliente nuevo sin datos: 100, solo cuenta Seguimiento", () => {
  const c = agencia.crearCliente({ nombre: "Nuevo" });
  const { score } = agencia.evaluarCliente(c);
  assert.equal(score.puntos, 100);
  assert.equal(score.nivel, "excelente");
  assert.deepEqual(score.partes.map((p) => p.clave), ["atencion"]);
  assert.deepEqual(score.sin_datos, ["entregas", "pagos", "anuncios", "redes"]);
});

test("niveles", () => {
  assert.equal(nivelDe(91).nombre, "Excelente");
  assert.equal(nivelDe(70).nombre, "Saludable");
  assert.equal(nivelDe(55).nombre, "Atención");
  assert.equal(nivelDe(30).nombre, "En riesgo");
});

test("entrega atrasada y pago muy vencido: rojo y abajo de 60", () => {
  const c = agencia.crearCliente({ nombre: "Barbería" });
  agencia.crearProyecto({ cliente: c.id, titulo: "Reels", entrega: haceDias(2) + "T10:00" });
  fin.registrarCobro({ cliente: c.id, concepto: "Mensualidad vieja", monto: 6500, vence: haceDias(40), mes: haceDias(40).slice(0, 7) });
  const { salud, score } = agencia.evaluarCliente(c);
  assert.equal(salud.nivel, "rojo");
  assert.ok(salud.motivos.some((m) => /40 días de retraso/.test(m)));
  assert.equal(parte(score, "pagos").pts, 0);
  assert.equal(parte(score, "entregas").pts, 13);
  assert.ok(score.puntos <= 49);
  assert.equal(score.color, "rojo");
});

test("anuncios: pasarse del tope y gastar sin resultados baja la calificación", () => {
  const c = agencia.crearCliente({ nombre: "Clínica", presupuesto_anuncios: 10000 });
  agencia.registrarGasto({ cliente: c.id, plataforma: "google", monto: 12000 });
  const meta = { anuncios: { gasto_mes: 3000, conversaciones: 0, prospectos: 0, compras: 0 } };
  const s = deltaScore(c, { salud: agencia.saludCliente(c), gastoMes: 12000, meta });
  assert.equal(parte(s, "anuncios").pts, 0);
  assert.match(parte(s, "anuncios").nota, /tope/);
  const bien = deltaScore(c, { salud: { automatico: "verde", motivos: [] }, gastoMes: 5000, meta: { anuncios: { gasto_mes: 5000, conversaciones: 30 } } });
  assert.equal(parte(bien, "anuncios").pts, 20);
  assert.match(parte(bien, "anuncios").nota, /30 resultados/);
});

test("redes: perder seguidores y no publicar cuenta; semáforo verde baja a amarillo si el score es bajo", () => {
  const c = agencia.crearCliente({ nombre: "Café" });
  const meta = { instagram: { seguidores: 900, publicaciones_mes: 0 }, seguidores_cambio: { instagram: -40, facebook: null } };
  const s = deltaScore(c, { salud: { automatico: "verde", motivos: [] }, meta });
  assert.match(parte(s, "redes").nota, /Perdió 40/);
  if (Number(hoy.slice(8, 10)) >= 8) assert.equal(parte(s, "redes").pts, 2);
  // Un verde con mala calificación pasa a amarillo
  db.prepare("INSERT INTO cobros (cliente_id, tipo, concepto, monto, mes, vence) VALUES (?, 'extra', 'x', 100, ?, ?)").run(c.id, haceDias(5).slice(0, 7), haceDias(5));
  agencia.crearProyecto({ cliente: c.id, titulo: "A", entrega: haceDias(1) + "T10:00" });
  const r = agencia.evaluarCliente(c, { meta });
  assert.ok(r.score.puntos < 65);
  assert.notEqual(r.salud.nivel, "verde");
  assert.equal(r.salud.nivel, r.score.color, "el semáforo y la calificación coinciden");
});

test("cuentas y tablero traen el score; ficha también", () => {
  const lista = agencia.cuentas();
  assert.ok(lista.every((c) => Number.isInteger(c.score.puntos)));
  const t = agencia.tablero();
  assert.ok(Number.isInteger(t.score_promedio));
  assert.equal(t.score_clientes[0].puntos, Math.min(...t.score_clientes.map((x) => x.puntos)));
  assert.ok(agencia.fichaCliente("Barbería").score.partes.length >= 2);
});
