import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "delta-crmrep-"));
process.env.ZONA_HORARIA = "America/Mexico_City";
const { db } = await import("../server/db.js");
const agencia = await import("../server/agencia.js");
const crm = await import("../server/crm.js");
const meta = await import("../server/meta.js");
const { reporteCrm } = await import("../server/crmreporte.js");
const { ahoraLocalISO } = await import("../server/tiempo.js");

test("periodo: mes, rango de fechas y periodo anterior", () => {
  assert.deepEqual(crm.periodo({ mes: "2026-02" }), { desde: "2026-02-01", hasta: "2026-02-28", dias: 28, mes: "2026-02", es_mes: true });
  const r = crm.periodo({ desde: "2026-11-23", hasta: "2026-11-17" });
  assert.equal(r.desde, "2026-11-17");
  assert.equal(r.dias, 7);
  assert.equal(r.es_mes, false);
  const ant = crm.periodoAnterior(r);
  assert.deepEqual([ant.desde, ant.hasta], ["2026-11-10", "2026-11-16"]);
  assert.equal(crm.periodoAnterior(crm.periodo({ mes: "2026-01" })).mes, "2025-12");
  assert.equal(crm.periodo({ desde: "2026-10-01", hasta: "2026-10-31" }).es_mes, true);
  assert.throws(() => crm.periodo({ desde: "ayer" }), /Fecha no válida/);
});

test("tablero y reporte por fechas: anuncios de Meta y prospectos del CRM", async () => {
  const c = agencia.crearCliente({ nombre: "Kardia" });
  db.prepare("INSERT INTO meta_activos (id, tipo, nombre, cliente_id) VALUES ('act_9','anuncios','Kardia Ads', ?)").run(c.id);
  let pedido = null;
  meta._insightsDePrueba((id, rango) => {
    pedido = rango;
    return { cuentas: ["Kardia Ads"], moneda: "MXN", errores: [],
      anuncios: [{ campana_id: "c1", campana: "Leads", conjunto_id: "s1", conjunto: "Todo MX", anuncio_id: "a1", anuncio: "Video", gasto: 100, impresiones: 1000, clics: 30, clics_enlace: 20, conversaciones: 0, prospectos: 4, compras: 0 }],
      dias: [{ fecha: rango.desde, campana_id: "c1", conjunto_id: "s1", anuncio_id: "a1", gasto: 100, impresiones: 1000, clics: 30, clics_enlace: 20, conversaciones: 0, prospectos: 4, compras: 0 }] };
  });
  const p = crm.crearProspecto({ cliente: c.id, nombre: "Ana", fuente: "anuncios", campana: "Leads · Video" });
  crm.actualizarProspecto(p.id, { etapa: "cita" });
  const hoy = ahoraLocalISO().slice(0, 10);
  const r = await reporteCrm({ cliente: c.id, desde: hoy, hasta: hoy });
  assert.equal(r.anuncios.filas[0].gasto, 100);
  assert.equal(r.anuncios.filas[0].cliente, "Kardia");
  assert.equal(r.prospectos.length, 1);
  assert.equal(r.prospectos[0].campana, "Leads · Video");
  assert.equal(r.prospectos[0].alcanzo, 2);
  assert.equal(pedido.hasta, hoy);
  const t = crm.tableroCrm({ cliente: c.id, desde: hoy, hasta: hoy });
  assert.equal(t.embudo.prospectos, 1);
  assert.equal(t.embudo.citas, 1);
  assert.equal(t.embudo_anterior.dias, 1);
  // Un periodo sin nadie
  const vacio = await reporteCrm({ cliente: c.id, desde: "2020-01-01", hasta: "2020-01-31" });
  assert.equal(vacio.prospectos.length, 0);
});
