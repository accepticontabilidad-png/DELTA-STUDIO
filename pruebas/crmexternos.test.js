import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "delta-ext-"));
process.env.ZONA_HORARIA = "America/Mexico_City";
const { db } = await import("../server/db.js");
const agencia = await import("../server/agencia.js");
const crm = await import("../server/crm.js");
const ext = await import("../server/crmexternos.js");

agencia.crearCliente({ nombre: "Kardia" });
agencia.crearCliente({ nombre: "Dr. Escutia" });
agencia.crearCliente({ nombre: "Endo Woman" });
const hace = (d) => new Date(Date.now() - d * 864e5);

test("etapas con cualquier nombre caen en las de DELTA", () => {
  assert.equal(ext.etapaPorNombre("Cita agendada"), "cita");
  assert.equal(ext.etapaPorNombre("Primer contacto"), "contactado");
  assert.equal(ext.etapaPorNombre("Asistió a valoración"), "asistio");
  assert.equal(ext.etapaPorNombre("Cerrado - ganado"), "venta");
  assert.equal(ext.etapaPorNombre("No le interesa"), "perdido");
  assert.equal(ext.etapaPorNombre("Leads entrantes"), "nuevo");
});

test("Kommo: trae prospectos con su teléfono, etapa y venta; sin duplicar; solo mueve si cambió allá", async () => {
  let estado = 2001;
  const pedidas = [];
  ext._fetchDePrueba(async (url, op) => {
    pedidas.push(url);
    assert.equal(op.headers.Authorization, "Bearer llave-kommo-123456");
    assert.ok(url.startsWith("https://kardia.kommo.com/api/v4/"));
    if (url.includes("/leads/pipelines")) return { _embedded: { pipelines: [{ id: 1, _embedded: { statuses: [{ id: 2001, name: "Contacto inicial" }, { id: 2002, name: "Cita agendada" }, { id: 142, name: "Logrado" }, { id: 143, name: "Perdido" }] } }] } };
    if (url.includes("/leads?")) return { _embedded: { leads: [
      { id: 10, name: "Chequeo", status_id: estado, price: 0, created_at: Math.floor(hace(3) / 1000), _embedded: { contacts: [{ id: 501, is_main: true }] } },
      { id: 11, name: "Holter", status_id: 142, price: 4500, created_at: Math.floor(hace(10) / 1000), _embedded: { contacts: [{ id: 502, is_main: true }] } },
    ] } };
    if (url.includes("/contacts?")) return { _embedded: { contacts: [
      { id: 501, name: "Ana López", custom_fields_values: [{ field_code: "PHONE", values: [{ value: "+52 55 1234 5678" }] }, { field_code: "EMAIL", values: [{ value: "ana@x.mx" }] }] },
      { id: 502, name: "Luis Torres", custom_fields_values: [{ field_code: "PHONE", values: [{ value: "5598765432" }] }] },
    ] } };
    throw new Error("no esperado " + url);
  });
  const r = await ext.conectarFuente({ cliente: "Kardia", tipo: "kommo", cuenta: "https://kardia.kommo.com/leads", token: "llave-kommo-123456" });
  assert.equal(r.nuevos, 2);
  assert.equal(r.cuenta, "kardia");
  assert.equal(r.token, undefined);
  assert.equal(r.token_final, "…3456");
  const ana = crm.buscarProspecto({ nombre: "Ana López" });
  assert.equal(ana.telefono, "525512345678");
  assert.equal(ana.correo, "ana@x.mx");
  assert.equal(ana.etapa, "contactado");
  assert.equal(ana.interes, "Chequeo");
  const luis = crm.buscarProspecto({ nombre: "Luis Torres" });
  assert.equal(luis.etapa, "venta");
  assert.equal(luis.valor, 4500);
  assert.ok(Date.parse(luis.creado) < Date.now() - 9 * 864e5, "conserva la fecha en que llegó");
  // Ella lo movió a mano en DELTA; Kommo no cambió: no se pisa
  crm.actualizarProspecto(ana.id, { etapa: "cita" });
  const r2 = await ext.sincronizarFuente(r.id);
  assert.equal(r2.nuevos, 0);
  assert.equal(crm.obtenerProspecto(ana.id).etapa, "cita");
  // Allá sí cambió: se mueve
  estado = 143;
  const r3 = await ext.sincronizarFuente(r.id);
  assert.equal(r3.movidos, 1);
  assert.equal(crm.obtenerProspecto(ana.id).etapa, "perdido");
  assert.ok(pedidas.every((u) => !/POST|PATCH/.test(u)));
});

test("GoHighLevel: oportunidades con su contacto, ganadas y perdidas", async () => {
  ext._fetchDePrueba(async (url, op) => {
    assert.equal(op.headers.Version, "2021-07-28");
    if (url.includes("/opportunities/pipelines")) return { pipelines: [{ id: "p1", stages: [{ id: "s1", name: "New Lead" }, { id: "s2", name: "Appointment Booked" }] }] };
    if (url.includes("/opportunities/search")) {
      assert.match(url, /location_id=LOC123/);
      return { opportunities: [
        { id: "o1", name: "Mariana - Valoración", status: "open", pipelineStageId: "s2", source: "Facebook Lead Form", createdAt: hace(2).toISOString(), updatedAt: hace(1).toISOString(), contact: { name: "Mariana Ruiz", phone: "+525544556677", email: null } },
        { id: "o2", name: "Pedro", status: "won", monetaryValue: 9000, pipelineStageId: "s2", createdAt: hace(5).toISOString(), updatedAt: hace(1).toISOString(), contact: { name: "Pedro Gil", phone: "+525511122233" } },
        { id: "o3", name: "Viejo", status: "open", pipelineStageId: "s1", createdAt: hace(200).toISOString(), updatedAt: hace(200).toISOString(), contact: { name: "Viejo" } },
      ], meta: { nextPage: "" } };
    }
    throw new Error("no esperado " + url);
  });
  const r = await ext.conectarFuente({ cliente: "Endo Woman", tipo: "ghl", cuenta: "LOC123", token: "pit-1234567890" });
  assert.equal(r.nuevos, 2, "lo de hace más de 90 días no se trae");
  const m = crm.buscarProspecto({ nombre: "Mariana Ruiz" });
  assert.equal(m.etapa, "cita");
  assert.equal(m.fuente, "anuncios");
  assert.equal(crm.buscarProspecto({ nombre: "Pedro Gil" }).valor, 9000);
});

test("Pancake: conversaciones del mes como prospectos; una llave mala no se guarda", async () => {
  ext._fetchDePrueba(async (url) => {
    assert.match(url, /pages\.fm\/api\/public_api\/v1\/pages\/12345\/conversations\?page_access_token=/);
    return { success: true, total: 4, conversations: [
      { id: "wa_1", type: "INBOX", inserted_at: hace(1).toISOString(), customers: [{ name: "Rosa Méndez" }], recent_phone_numbers: [{ phone_number: "5511112222" }], from: { id: "wa_1" }, last_sent_by: { id: "pagina" } },
      { id: "waba_9_5215533334444", type: "INBOX", inserted_at: "2026-11-20T06:06:18.340190", customers: [{ name: "Lalo", fb_id: "wa_5215533334444" }], recent_phone_numbers: [], from: { id: "wa_5215533334444" }, last_sent_by: { id: "wa_5215533334444" }, ad_ids: ["1"] },
      { id: "c2", type: "INBOX", inserted_at: hace(2).toISOString(), customers: [{ name: "Carlos" }], recent_phone_numbers: [] },
      { id: "c3", type: "COMMENT", customers: [{ name: "Comentario" }] },
    ] };
  });
  const r = await ext.conectarFuente({ cliente: "Dr. Escutia", tipo: "pancake", cuenta: "12345", token: "tok-pancake-xyz" });
  assert.equal(r.nuevos, 3);
  const lalo = crm.buscarProspecto({ nombre: "Lalo" });
  assert.equal(lalo.fuente, "whatsapp");
  assert.equal(lalo.telefono, "525533334444");
  assert.equal(lalo.etapa, "nuevo");
  assert.equal(lalo.creado, "2026-11-20T06:06:18.340Z");
  // llave e id al revés: se acomodan solos y el link de Pancake se limpia
  const llave = "eyJhbGciOiJIUzI1NiJ9." + Buffer.from(JSON.stringify({ id: "12345", timestamp: 1 })).toString("base64url") + ".firma";
  assert.equal(ext.idDeLlavePancake(llave), "12345");
  const r2 = await ext.conectarFuente({ cliente: "Dr. Escutia", tipo: "pancake", cuenta: "", token: llave });
  assert.equal(r2.id, r.id, "solo con la llave encuentra la misma página");
  const r3 = await ext.conectarFuente({ cliente: "Dr. Escutia", tipo: "pancake", cuenta: llave, token: "" });
  assert.equal(r3.id, r.id, "aunque la pegue en el lugar equivocado");
  const rosa = crm.buscarProspecto({ nombre: "Rosa" });
  assert.equal(rosa.fuente, "whatsapp");
  assert.equal(rosa.etapa, "contactado");
  assert.equal(crm.buscarProspecto({ nombre: "Carlos" }).etapa, "nuevo");
  // Llave mala
  ext._fetchDePrueba(async () => { throw new Error("La llave no es válida o no tiene permiso de lectura"); });
  await assert.rejects(ext.conectarFuente({ cliente: "Kardia", tipo: "ghl", cuenta: "OTRA", token: "mala-1234567890" }), /GoHighLevel: La llave no es válida/);
  assert.equal(ext.listarFuentes("Kardia").length, 1, "solo queda Kommo");
  assert.equal(ext.listarFuentes().length, 3);
  ext.quitarFuente(r.id);
  assert.ok(crm.buscarProspecto({ nombre: "Rosa" }), "los prospectos que ya llegaron se quedan");
  ext._fetchDePrueba(null);
  assert.ok(db);
});
