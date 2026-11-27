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

test("Pancake: etiquetas dan la etapa y DELTA lee los chats para acomodar ventas y perdidos", async () => {
  agencia.crearCliente({ nombre: "Chirey" });
  const conv = (id, nombre, extra = {}) => ({ id, type: "INBOX", inserted_at: hace(3).toISOString(), updated_at: hace(1).toISOString(), message_count: 12,
    customers: [{ name: nombre, fb_id: `wa_52122233${String(id).slice(-5).padStart(5, "0")}` }], from: { id: `wa_${id}` }, last_sent_by: { id: `wa_${id}` }, ...extra });
  ext._fetchDePrueba(async (url) => {
    if (/\/tags\?/.test(url)) return { tags: [{ id: 1, text: "PERFILAMIENTO" }, { id: 2, text: "APROBADO" }, { id: 3, text: "VENTA" }] };
    return { success: true, total: 4, conversations: [
      conv("waba_1_11111", "Jorge Antonio", { tags: [3] }),
      conv("waba_1_22222", "Miguel Ángel"),
      conv("waba_1_33333", "Mafer", { tags: [null, { id: 1 }] }),
      conv("waba_1_44444", "Gerardo", { tags: [1, 2], message_count: 2 }),
    ] };
  });
  ext._chatsDePrueba(async (c) => `Cliente: hola\nNegocio: ${c}`);
  const leidos = [];
  ext._iaDePrueba(async (p, chat) => {
    leidos.push(p.nombre);
    if (/22222/.test(chat)) return { etapa: "venta", origen: "anuncio", fecha_venta: "2026-10-15", valor: 316450, interes: "Jaecco 7", resumen: "Pagó placas, cita de entrega" };
    if (/11111/.test(chat)) return { etapa: "contactado", origen: "cliente", resumen: "Ya era cliente, pregunta por su servicio" };
    if (/33333/.test(chat)) return { etapa: "perdido", motivo: "Rechazada por buró", resumen: "No pasó buró" };
    return { etapa: "contactado", resumen: "Sigue en trámite" };
  });
  const r = await ext.conectarFuente({ cliente: "Chirey", tipo: "pancake", cuenta: "waba_1", token: "tok-chirey-12345" });
  assert.equal(r.nuevos, 4);
  assert.equal(crm.buscarProspecto({ nombre: "Jorge Antonio" }).etapa, "contactado", "la etiqueta VENTA sola no hace venta");
  assert.equal(crm.buscarProspecto({ nombre: "Gerardo" }).etapa, "cita", "etiqueta APROBADO");
  const l = await ext.leerChats(r.id);
  assert.equal(l.leidos, 3, "no lee chats de pocos mensajes");
  assert.deepEqual(leidos.sort(), ["Jorge Antonio", "Mafer", "Miguel Ángel"]);
  assert.equal(crm.buscarProspecto({ nombre: "Jorge Antonio" }).origen, "cliente");
  const miguel = crm.buscarProspecto({ nombre: "Miguel Ángel" });
  assert.equal(miguel.etapa, "venta");
  assert.equal(miguel.valor, 316450);
  assert.equal(miguel.venta_fecha, "2026-10-15");
  assert.equal(miguel.origen, "anuncio");
  assert.match(crm.fichaProspecto(miguel.id).historial.at(-1).texto, /DELTA leyó el chat: Pagó placas/);
  const mafer = crm.buscarProspecto({ nombre: "Mafer" });
  assert.equal(mafer.etapa, "perdido");
  assert.equal(mafer.motivo_perdido, "Rechazada por buró");
  // Sin cambios en Pancake, no se vuelve a leer (no se gasta de más)
  assert.equal((await ext.leerChats(r.id)).leidos, 0);
  ext._fetchDePrueba(null); ext._chatsDePrueba(null); ext._iaDePrueba(null);
});

test("etiquetas que NO son venta y arreglo de ventas mal leídas de Pancake", async () => {
  const ext = await import("../server/crmexternos.js");
  for (const t of ["Tratamiento facial", "Página web", "Comprobante", "Pregunta por pago", "Ventas Facebook lead"]) assert.notEqual(ext.etapaPorNombre(t), "venta", t);
  for (const t of ["VENTA", "Pagado", "Ganado", "Paciente activo", "En tratamiento", "Compró"]) assert.equal(ext.etapaPorNombre(t), "venta", t);
});

test("una venta que solo venía de la etiqueta 'Tratamiento facial' se corrige", async () => {
  const ext = await import("../server/crmexternos.js");
  const crm = await import("../server/crm.js");
  const { db } = await import("../server/db.js");
  const agencia = await import("../server/agencia.js");
  const c = agencia.crearCliente({ nombre: "Betzy Prueba" });
  const p = crm.crearProspecto({ cliente: c.id, nombre: "Clara", notas: "Viene de Pancake (etapa: Tratamiento facial)", etapa: "venta" });
  db.prepare("UPDATE prospectos SET externo_id = 'pancake:1:clara', externo_etapa = 'venta' WHERE id = ?").run(p.id);
  assert.equal(crm.obtenerProspecto(p.id).alcanzo, 4);
  assert.equal(ext.revisarVentasPorEtiqueta(), 1);
  const x = crm.obtenerProspecto(p.id);
  assert.equal(x.etapa, "contactado");
  assert.equal(x.alcanzo, 1);
  assert.equal(x.ia_revisado, null);
  assert.equal(ext.revisarVentasPorEtiqueta(), 0);
});

test("ventas sin confirmar se releen: se quitan si no compró y se cuentan por fecha de compra y origen", async () => {
  const c = agencia.crearCliente({ nombre: "Betzy Ventas" });
  const r = await (async () => {
    ext._fetchDePrueba(async () => ({ success: true, conversations: [] }));
    const x = await ext.conectarFuente({ cliente: c.id, tipo: "pancake", cuenta: "waba_9", token: "tok-betzy-99999" });
    return x;
  })();
  const nueva = (nombre, id) => {
    const p = crm.crearProspecto({ cliente: c.id, nombre, fuente: "whatsapp", etapa: "venta" });
    db.prepare("UPDATE prospectos SET externo_id = ?, externo_mensajes = 20, venta_revisada = NULL, creado = '2026-10-02T15:00:00Z' WHERE id = ?").run(`pancake:waba_9:${id}`, p.id);
    return p.id;
  };
  const a = nueva("Ana Real", "a"), b = nueva("Beto Viejo", "b"), d = nueva("Dora Recomendada", "d");
  ext._chatsDePrueba(async (conv) => `chat ${conv}`);
  ext._iaDePrueba(async (p) => p.nombre === "Ana Real" ? { etapa: "venta", origen: "anuncio", fecha_venta: "2026-11-05", resumen: "Pagó" }
    : p.nombre === "Beto Viejo" ? { etapa: "contactado", origen: "cliente", resumen: "Pregunta por su servicio" }
    : { etapa: "venta", origen: "recomendado", fecha_venta: "2026-10-20", resumen: "La mandó su hermana, pagó" });
  const l = await ext.leerChats(r.id);
  assert.equal(l.quitadas, 1);
  assert.equal(l.confirmadas, 2);
  assert.equal(crm.obtenerProspecto(b).etapa, "contactado");
  assert.equal(crm.obtenerProspecto(b).alcanzo < 4, true);
  // Se cuentan en el mes en que LLEGÓ (2 de octubre): Ana de anuncio cuenta como de redes, Dora (recomendada) va aparte
  const oct = crm.embudo({ cliente: c.id, mes: "2026-10" }).ventas_cerradas;
  assert.equal(oct.redes, 1); assert.equal(oct.otras, 1);
  assert.equal(oct.lista.find((x) => x.nombre === "Ana Real").compro, "2026-11-05");
  assert.equal(crm.embudo({ cliente: c.id, mes: "2026-11" }).ventas_cerradas.redes, 0);
  // Ya confirmadas, no se vuelven a leer
  assert.equal((await ext.leerChats(r.id)).leidos, 0);
  // El dueño (o DELTA cuando se lo pide) corrige el origen a mano
  crm.actualizarProspecto(d, { origen: "redes" });
  assert.equal(crm.embudo({ cliente: c.id, mes: "2026-10" }).ventas_cerradas.redes, 2);
  crm.actualizarProspecto(a, { etapa: "perdido" });
  assert.equal(crm.obtenerProspecto(a).venta_fecha, null);
  assert.equal(crm.embudo({ cliente: c.id, mes: "2026-10" }).ventas_cerradas.redes, 1);
  // La respuesta de la IA se entiende aunque venga con texto, acentos o cortada
  assert.equal(ext.leerRespuestaIA('Listo:\n```json\n{"etapa":"Venta","origen":"Anuncios","fecha_venta":"2026-11-19"}\n```').etapa, "venta");
  assert.equal(ext.leerRespuestaIA('{"etapa":"asistió","origen":"redes","resumen":"Fue y luego').etapa, "asistio");
  ext._fetchDePrueba(null); ext._chatsDePrueba(null); ext._iaDePrueba(null);
});

test("la llave de Pancake de un cliente no se puede usar en otro (no se cuelan sus prospectos)", async () => {
  const betzy = agencia.crearCliente({ nombre: "Betzy Llave" });
  const hector = agencia.crearCliente({ nombre: "Héctor Llave" });
  ext._fetchDePrueba(async () => ({ success: true, conversations: [
    { id: "waba_77_5212221770671", type: "INBOX", inserted_at: hace(1).toISOString(), customers: [{ name: "Luis Acevedo" }], recent_phone_numbers: [], from: { id: "wa_5212221770671" } },
  ] }));
  const llave = "eyJhbGciOiJIUzI1NiJ9." + Buffer.from(JSON.stringify({ id: "waba_77", timestamp: 1 })).toString("base64url") + ".firma";
  const r = await ext.conectarFuente({ cliente: betzy.id, tipo: "pancake", cuenta: "", token: llave });
  assert.equal(r.nuevos, 1);
  await assert.rejects(ext.conectarFuente({ cliente: hector.id, tipo: "pancake", cuenta: "", token: llave }), /es de la página de Betzy Llave/);
  assert.equal(ext.listarFuentes(hector.id).length, 0, "no se guarda la conexión equivocada");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM prospectos WHERE cliente_id = ?").get(hector.id).n, 0);
  // Una conexión equivocada que ya existía deja de traer datos y avisa
  const id = db.prepare("INSERT INTO crm_fuentes (cliente_id, tipo, cuenta, token) VALUES (?,?,?,?)").run(hector.id, "pancake", "waba_77", llave).lastInsertRowid;
  await assert.rejects(ext.sincronizarFuente(id), /es de la página de Betzy Llave/);
  assert.match(ext.listarFuentes(hector.id)[0].error, /Quita esta conexión/);
  await assert.rejects(ext.leerChats(id), /es de la página de Betzy Llave/);
  // La de Betzy sigue funcionando
  assert.ok((await ext.sincronizarFuente(r.id)).revisados >= 1);
});

test("Pancake del doctor: la etiqueta VENTA sí cuenta, se traen los 90 días en tramos y DELTA no quita ni inventa ventas", async () => {
  const doc = agencia.crearCliente({ nombre: "Dr. Héctor Etiqueta" });
  const tramos = [];
  const conv = (id, nombre, dias, tags = []) => ({ id, type: "INBOX", inserted_at: hace(dias).toISOString(), updated_at: hace(dias).toISOString(), message_count: 10,
    customers: [{ name: nombre, fb_id: `wa_52122200${id.slice(-4)}` }], from: { id: `wa_${id}` }, last_sent_by: { id: `wa_${id}` }, tags });
  let quitarEtiqueta = false;
  ext._fetchDePrueba(async (url) => {
    if (/\/tags\?/.test(url)) return { tags: [{ id: 9, text: "VENTA" }, { id: 4, text: "LEAD" }] };
    const since = Number(/since=(\d+)/.exec(url)[1]), until = Number(/until=(\d+)/.exec(url)[1]);
    if (/page_number=1&/.test(url)) tramos.push([since, until]);
    const todas = [conv("waba_h_0001", "Hugo", 50, [9]), conv("waba_h_0002", "Ivan", 45, quitarEtiqueta ? [4] : [9, 4]), conv("waba_h_0003", "Rosa", 10, [4])];
    return { success: true, conversations: /page_number=1&/.test(url) ? todas.filter((c) => { const t = Date.parse(c.updated_at) / 1000; return t >= since && t <= until; }) : [] };
  });
  ext._chatsDePrueba(async (c) => `Cliente: hola ${c}`);
  ext._iaDePrueba(async (p) => (p.nombre === "Rosa" ? { etapa: "venta", resumen: "dice que pagó" } : { etapa: "contactado", origen: "cliente", resumen: "x" }));
  const r = await ext.conectarFuente({ cliente: doc.id, tipo: "pancake", cuenta: "waba_h", token: "tok-hector-123456" });
  assert.ok(tramos.length >= 3, "pide en tramos de 30 días hasta cubrir 90");
  assert.equal(r.nuevos, 3, "trae también las de hace 45 y 50 días");
  assert.equal(crm.buscarProspecto({ nombre: "Hugo", cliente: doc.id }).etapa, "contactado", "sin el interruptor, la etiqueta sola no es venta");
  const v = await ext.ventaPorEtiqueta(r.id, true);
  assert.equal(v.venta_etiqueta, true);
  assert.equal(v.cambiadas, 2);
  const hugo = crm.buscarProspecto({ nombre: "Hugo", cliente: doc.id });
  assert.equal(hugo.etapa, "venta");
  assert.equal(hugo.venta_revisada, 1, "ya confirmada: DELTA no la vuelve a revisar");
  // Leer chats no quita ventas con etiqueta ni pone ventas sin etiqueta
  await ext.leerChats(r.id, { max: 50 });
  assert.equal(crm.buscarProspecto({ nombre: "Hugo", cliente: doc.id }).etapa, "venta");
  assert.equal(crm.buscarProspecto({ nombre: "Rosa", cliente: doc.id }).etapa === "venta", false);
  // El arreglo de ventas por etiqueta no toca esta página
  ext.revisarVentasPorEtiqueta();
  assert.equal(crm.buscarProspecto({ nombre: "Ivan", cliente: doc.id }).etapa, "venta");
  // Si en Pancake le quitan la etiqueta, deja de ser venta
  quitarEtiqueta = true;
  db.prepare("UPDATE crm_fuentes SET historia = NULL WHERE id = ?").run(r.id);
  await ext.sincronizarFuente(r.id);
  assert.notEqual(crm.buscarProspecto({ nombre: "Ivan", cliente: doc.id }).etapa, "venta");
  ext._fetchDePrueba(null); ext._chatsDePrueba(null); ext._iaDePrueba(null);
});

test("prospectos de Pancake que quedaron en otro cliente regresan a su dueño; margen 0 = sin margen", () => {
  const dueno = agencia.crearCliente({ nombre: "Dueña Página" });
  const otro = agencia.crearCliente({ nombre: "Otro Doctor" });
  db.prepare("INSERT INTO crm_fuentes (cliente_id, tipo, cuenta, token) VALUES (?,?,?,?)").run(dueno.id, "pancake", "waba_mix", "tok-mix-123456");
  const p = crm.crearProspecto({ cliente: otro.id, nombre: "Colado" });
  db.prepare("UPDATE prospectos SET externo_id = 'pancake:waba_mix:1' WHERE id = ?").run(p.id);
  assert.equal(ext.acomodarProspectosDeOtraPagina(), 1);
  assert.equal(crm.obtenerProspecto(p.id).cliente_id, dueno.id);
  assert.equal(crm.guardarUtilidad({ cliente: dueno.id, ticket: 3000, margen: 0 }).margen, null);
  assert.equal(crm.guardarUtilidad({ cliente: dueno.id, margen: "60" }).margen, 60);
});

test("la etiqueta VENTA se prende sola una vez en el Pancake del Dr. Escutia", async () => {
  const doc = agencia.crearCliente({ nombre: "Dr. Héctor Escutia Prueba" });
  const id = db.prepare("INSERT INTO crm_fuentes (cliente_id, tipo, cuenta, token) VALUES (?,?,?,?)").run(doc.id, "pancake", "waba_esc", "tok-esc-123456").lastInsertRowid;
  const p = crm.crearProspecto({ cliente: doc.id, nombre: "Con etiqueta" });
  db.prepare("UPDATE prospectos SET externo_id = 'pancake:waba_esc:1', externo_etiquetas = 'VENTA' WHERE id = ?").run(p.id);
  ext._fetchDePrueba(async () => ({ success: true, conversations: [] }));
  const r = await ext.prenderVentaPorEtiquetaDelDoctor();
  assert.ok(r.some((x) => x.id === Number(id) && x.venta_etiqueta));
  assert.equal(crm.obtenerProspecto(p.id).etapa, "venta");
  // Si el dueño la apaga, no se vuelve a prender sola
  await ext.ventaPorEtiqueta(id, false);
  assert.equal((await ext.prenderVentaPorEtiquetaDelDoctor()).length, 0);
  ext._fetchDePrueba(null);
});
