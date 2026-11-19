import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "delta-"));
process.env.ZONA_HORARIA = "America/Mexico_City";
const { localAUTC, siguiente } = await import("../server/tiempo.js");
const agenda = await import("../server/agenda.js");

test("convierte hora local de CDMX a UTC", () => {
  assert.equal(localAUTC("2026-11-20T09:30"), "2026-11-20T15:30:00.000Z");
  assert.equal(localAUTC("2026-11-20 09:30"), "2026-11-20T15:30:00.000Z");
  assert.equal(localAUTC("2026-11-20T09:30:00Z"), "2026-11-20T09:30:00.000Z");
});

test("respeta el horario de verano en otras zonas", () => {
  assert.equal(localAUTC("2026-07-01T10:00", "America/New_York"), "2026-07-01T14:00:00.000Z");
  assert.equal(localAUTC("2026-12-01T10:00", "America/New_York"), "2026-12-01T15:00:00.000Z");
});

test("rechaza fechas mal escritas", () => {
  assert.throws(() => localAUTC("mañana"));
});

test("recordatorios repetidos avanzan", () => {
  assert.equal(siguiente("2026-11-20T15:00:00.000Z", "diario"), "2026-11-21T15:00:00.000Z");
  assert.equal(siguiente("2026-11-20T15:00:00.000Z", "semanal"), "2026-11-27T15:00:00.000Z");
  assert.equal(siguiente("2026-11-20T15:00:00.000Z", "no"), null);
});

test("ciclo de vida de una tarea", () => {
  const t = agenda.crearTarea({ titulo: "Enviar reporte a cliente", cliente: "Acme", prioridad: "alta", fecha_limite: "2026-11-21T12:00" });
  assert.equal(t.estado, "pendiente");
  assert.equal(t.fecha_limite, "2026-11-21T18:00:00.000Z");
  assert.ok(agenda.listarTareas().some((x) => x.id === t.id));
  const h = agenda.actualizarTarea(t.id, { estado: "hecha" });
  assert.equal(h.estado, "hecha");
  assert.ok(h.completada);
  assert.ok(!agenda.listarTareas().some((x) => x.id === t.id));
  agenda.borrarTarea(t.id);
  assert.throws(() => agenda.borrarTarea(t.id));
});

test("eventos y recordatorios", () => {
  const e = agenda.crearEvento({ titulo: "Junta con cliente", inicio: "2026-11-20T10:00" });
  const lista = agenda.listarEventos({ desde: "2026-11-20", hasta: "2026-11-20" });
  assert.ok(lista.some((x) => x.id === e.id));
  const movido = agenda.moverEvento(e.id, { inicio: "2026-11-21T11:00" });
  assert.equal(movido.inicio, "2026-11-21T17:00:00.000Z");
  const r = agenda.crearRecordatorio({ mensaje: "Pagar luz", cuando: "2026-11-25T09:00", repetir: "mensual" });
  assert.equal(r.repetir, "mensual");
  agenda.cancelarRecordatorio(r.id);
  assert.ok(!agenda.listarRecordatorios().some((x) => x.id === r.id));
});

test("textos legibles para el asistente", () => {
  const l = agenda.legible({ inicio: "2026-11-20T16:00:00.000Z", titulo: "x" });
  assert.match(l.inicio, /20 de noviembre/);
  assert.match(l.inicio, /10:00/);
});
