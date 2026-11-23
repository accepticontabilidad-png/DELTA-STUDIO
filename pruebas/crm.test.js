import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "delta-crm-"));
process.env.ZONA_HORARIA = "America/Mexico_City";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.WHATSAPP_TOKEN;
const { db } = await import("../server/db.js");
const agencia = await import("../server/agencia.js");
const crm = await import("../server/crm.js");
const fin = await import("../server/finanzas.js");
const wa = await import("../server/whatsapp.js");
const { ahoraLocalISO } = await import("../server/tiempo.js");

const mes = ahoraLocalISO().slice(0, 7);
const hoy = ahoraLocalISO().slice(0, 10);

test("teléfonos, etapas y prospectos sin duplicar", () => {
  assert.equal(crm.normalizarTelefono("33 1234 5678"), "523312345678");
  assert.equal(crm.normalizarTelefono("+52 1 33 1234 5678"), "523312345678");
  assert.equal(crm.telefonoBonito("523312345678"), "33 1234 5678");
  assert.throws(() => crm.normalizarTelefono("123"), /no parece/);
  assert.equal(crm.etapaValida("ya agendó".replace("ya ", "")), "cita");
  assert.equal(crm.etapaValida("compró"), "venta");
  agencia.crearCliente({ nombre: "Kardia", industria: "Cardiología" });
  const p = crm.crearProspecto({ cliente: "Kardia", nombre: "Laura Pérez", telefono: "3312345678", fuente: "Meta ads", interes: "chequeo" });
  assert.equal(p.etapa, "nuevo");
  assert.equal(p.fuente, "anuncios");
  assert.equal(p.telefono_bonito, "33 1234 5678");
  const otra = crm.crearProspecto({ cliente: "Kardia", nombre: "Laura P.", telefono: "+52 33 1234 5678", notas: "volvió a escribir" });
  assert.equal(otra.id, p.id);
  assert.equal(otra.ya_existia, true);
  assert.throws(() => crm.crearProspecto({ cliente: "Kardia" }), /nombre o el teléfono/);
});

test("mover por el embudo: cita, asistió, venta; primer contacto y lo más lejos que llegó", () => {
  const p = crm.buscarProspecto({ nombre: "Laura" });
  let x = crm.actualizarProspecto(p.id, { cita: `${hoy} 17:30` });
  assert.equal(x.etapa, "cita"); // poner cita la mueve sola
  assert.equal(x.cita, `${hoy}T17:30`);
  assert.ok(x.primer_contacto);
  assert.equal(x.cita_hoy, true);
  x = crm.moverProspecto(p.id, 1);
  assert.equal(x.etapa, "asistio");
  x = crm.actualizarProspecto(p.id, { etapa: "venta", valor: "$12,500" });
  assert.equal(x.valor, 12500);
  assert.equal(x.alcanzo, 4);
  x = crm.moverProspecto(p.id, -1);
  assert.equal(x.etapa, "asistio");
  assert.equal(x.alcanzo, 4); // ya había llegado a venta
  crm.actualizarProspecto(p.id, { etapa: "venta" });
  const f = crm.fichaProspecto(p.id);
  assert.ok(f.historial.some((e) => e.tipo === "nota" && /volvió a escribir/.test(e.texto)));
  assert.ok(f.historial.some((e) => /Asistió → Venta/.test(e.texto)));
  assert.match(f.link_whatsapp, /^https:\/\/wa\.me\/523312345678$/);
  assert.throws(() => crm.actualizarProspecto(p.id, { cita: "mañana" }), /AAAA-MM-DD/);
});

test("embudo del mes con costos y Pulso: sin respuesta y citas pasadas", () => {
  agencia.registrarGasto({ cliente: "Kardia", plataforma: "meta", monto: 6000, mes });
  const a = crm.crearProspecto({ cliente: "Kardia", nombre: "Mario", telefono: "5511112222", fuente: "anuncios" });
  const b = crm.crearProspecto({ cliente: "Kardia", nombre: "Sofía", telefono: "5533334444", fuente: "instagram" });
  crm.actualizarProspecto(b.id, { etapa: "perdido", motivo_perdido: "precio" });
  db.prepare("UPDATE prospectos SET creado = ? WHERE id = ?").run(new Date(Date.now() - 30 * 3600e3).toISOString(), a.id);
  db.prepare("UPDATE prospectos SET creado = ? WHERE id = ?").run(new Date(Date.now() - 3600e3).toISOString(), b.id);
  const e = crm.embudo({ cliente: "Kardia", mes });
  // Si el mes acaba de empezar, Mario (hace 30 h) puede caer en el mes pasado: se cuenta lo que haya.
  const n = e.prospectos;
  assert.ok(n === 3 || n === 2);
  assert.equal(e.pasos[0].n, n);
  assert.equal(e.ventas, 1);
  assert.equal(e.valor_ventas, 12500);
  assert.equal(e.inversion, 6000);
  assert.equal(e.costo_venta, 6000);
  assert.equal(e.retorno, 2.08);
  assert.equal(e.perdidos, 1);
  assert.ok(e.por_fuente.some((x) => x.fuente === "anuncios" && x.ventas === 1));

  const t = crm.tableroCrm({ cliente: "Kardia" });
  assert.deepEqual(t.sin_responder.map((p) => p.nombre), ["Mario"]);
  assert.equal(t.etapas.find((x) => x.clave === "venta").prospectos.length, 1);
  const item = fin.pulso().items.find((x) => x.clave === "crm_sin_responder");
  assert.equal(item.nivel, "rojo");
  assert.equal(item.ir, "#/crm");
  assert.match(item.detalle[0], /Mario \(Kardia\)/);

  const c = crm.crearProspecto({ cliente: "Kardia", nombre: "Pedro", telefono: "5599990000", cita: "2020-01-10 10:00", etapa: "cita" });
  assert.equal(c.cita_pasada, true);
  assert.ok(fin.pulso().items.some((x) => x.clave === "crm_citas_pasadas"));
});

test("formulario público: crea el prospecto, ignora robots y frena abusos", () => {
  const cfg = crm.configurarCrm({ cliente: "Kardia", formulario: true, bienvenida: "Agenda tu chequeo" });
  const token = cfg.formulario.slice(3);
  assert.match(token, /^[A-Za-z0-9_-]{16}$/);
  assert.equal(crm.configurarCrm({ cliente: "Kardia", formulario: true }).formulario, cfg.formulario); // no cambia
  assert.equal(crm.recibirFormulario(token, { nombre: "Robot", telefono: "5500000000", sitio_web: "spam" }, "1.1.1.1"), true);
  assert.throws(() => crm.buscarProspecto({ nombre: "Robot" }), /No encuentro/);
  crm.recibirFormulario(token, { nombre: "Ana <b>", telefono: "33 9876 5432", interes: "prueba de esfuerzo", mensaje: "¿precio?" }, "2.2.2.2");
  const ana = crm.buscarProspecto({ nombre: "Ana" });
  assert.equal(ana.fuente, "web");
  assert.throws(() => crm.recibirFormulario(token, { nombre: "X", telefono: "12" }, "2.2.2.2"), /10 dígitos/);
  for (let i = 0; i < 3; i++) crm.recibirFormulario(token, { nombre: "Z" + i, telefono: `55000000${10 + i}` }, "3.3.3.3");
  crm.recibirFormulario(token, { nombre: "Z9", telefono: "5500000019" }, "3.3.3.3");
  crm.recibirFormulario(token, { nombre: "Z8", telefono: "5500000018" }, "3.3.3.3");
  assert.throws(() => crm.recibirFormulario(token, { nombre: "Z7", telefono: "5500000017" }, "3.3.3.3"), /unos minutos/);
  const html = crm.paginaFormulario(crm.clientePorFormulario(token), { datos: { nombre: '"><script>' } });
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Agenda tu chequeo/);
  assert.equal(crm.clientePorFormulario("A".repeat(16)), null);
  crm.configurarCrm({ cliente: "Kardia", formulario: false });
  assert.equal(crm.clientePorFormulario(token), null);
});

test("WhatsApp del cliente: llega al CRM, borradores y solo se envía con la ventana abierta", async () => {
  crm.configurarCrm({ cliente: "Kardia", wa_phone_id: "777", wa_numero: "3300000000" });
  const p = crm.recibirWhatsApp({ phoneId: "777", de: "5213311112222", nombre: "Carmen", texto: "Hola, ¿tienen cita mañana?", waId: "wamid.1" });
  assert.equal(p.nombre, "Carmen");
  assert.equal(p.fuente, "whatsapp");
  assert.equal(p.whatsapp_abierto, true);
  assert.equal(crm.recibirWhatsApp({ phoneId: "777", de: "5213311112222", texto: "repetido", waId: "wamid.1" }), null);
  assert.equal(crm.recibirWhatsApp({ phoneId: "999", de: "5213311112222", texto: "otro número" }), null);

  const b = await crm.sugerirMensaje(p.id); // sin Claude: plantilla según la etapa
  assert.match(b.texto, /Hola Carmen/);
  assert.match(b.link_whatsapp, /^https:\/\/wa\.me\/523311112222\?text=/);
  await assert.rejects(crm.enviarWhatsAppProspecto(p.id, { borrador_id: b.borrador_id }), /no está conectado/);
  process.env.WHATSAPP_TOKEN = "t";
  const enviados = [];
  crm._enviarDePrueba(async (phone, para, texto) => { enviados.push({ phone, para, texto }); return "wamid.out"; });
  const f = await crm.enviarWhatsAppProspecto(p.id, { borrador_id: b.borrador_id });
  assert.deepEqual(enviados[0], { phone: "777", para: "523311112222", texto: b.texto });
  assert.equal(f.etapa, "contactado");
  assert.equal(f.borradores.length, 0);
  assert.ok(f.historial.some((e) => e.tipo === "saliente"));
  await assert.rejects(crm.enviarWhatsAppProspecto(p.id, { borrador_id: b.borrador_id }), /ya no está pendiente/);
  db.prepare("UPDATE prospectos SET ultimo_entrante = ? WHERE id = ?").run(new Date(Date.now() - 25 * 3600e3).toISOString(), p.id);
  await assert.rejects(crm.enviarWhatsAppProspecto(p.id, { texto: "hola" }), /24 horas/);
  const m = crm.marcarEnviado(p.id, { borrador_id: crm.guardarBorrador(p.id, "Te mando la ubicación").borrador_id });
  assert.ok(m.historial.some((e) => e.tipo === "saliente" && /ubicación/.test(e.texto)));
  delete process.env.WHATSAPP_TOKEN;
});

test("webhook: lo del número del cliente va al CRM y no a DELTA", async () => {
  process.env.WHATSAPP_APP_SECRET = "secreto";
  process.env.WHATSAPP_PHONE_ID = "111";
  let aDelta = 0;
  const recibir = wa.crearReceptorWebhook(async () => { aDelta++; return "x"; }, crm.recibirWhatsApp);
  const cuerpo = { entry: [{ changes: [{ value: { metadata: { phone_number_id: "777" }, contacts: [{ wa_id: "5215544443333", profile: { name: "Jorge" } }], messages: [{ id: "wamid.9", from: "5215544443333", type: "text", text: { body: "Quiero informes" } }] } }] }] };
  const crudo = Buffer.from(JSON.stringify(cuerpo));
  const firma = "sha256=" + crypto.createHmac("sha256", "secreto").update(crudo).digest("hex");
  let estado = null;
  await recibir({ cuerpoOriginal: crudo, body: cuerpo, get: () => firma }, { sendStatus: (s) => { estado = s; } });
  assert.equal(estado, 200);
  assert.equal(aDelta, 0);
  const j = crm.buscarProspecto({ nombre: "Jorge" });
  assert.equal(j.cliente, "Kardia");
  assert.equal(crm.fichaProspecto(j.id).historial.at(-1).texto, "Quiero informes");
});
