import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), "delta-correo-"));
delete process.env.MICROSOFT_CLIENT_ID;
delete process.env.MICROSOFT_CLIENT_SECRET;
const outlook = await import("../server/outlook.js");
const correo = await import("../server/correo.js");
const { setAjuste } = await import("../server/db.js");

test("hotmail: sin llaves no está conectado y lo explica", () => {
  assert.equal(outlook.outlookConectado(), false);
  assert.throws(() => outlook.urlConexion({ protocol: "https", get: () => "x" }), /MICROSOFT_CLIENT_ID/);
});

test("hotmail: arma el enlace de Microsoft con permisos de correo y regreso correcto", () => {
  process.env.MICROSOFT_CLIENT_ID = "id-prueba";
  process.env.MICROSOFT_CLIENT_SECRET = "secreto";
  try {
    const u = new URL(outlook.urlConexion({ protocol: "https", get: () => "delta.ejemplo.com" }));
    assert.equal(u.origin + u.pathname, "https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    assert.equal(u.searchParams.get("redirect_uri"), "https://delta.ejemplo.com/oauth/microsoft");
    assert.match(u.searchParams.get("scope"), /offline_access/);
    assert.match(u.searchParams.get("scope"), /Mail\.ReadWrite/);
    assert.match(u.searchParams.get("scope"), /Mail\.Send/);
    assert.ok(u.searchParams.get("state").length >= 32);
  } finally {
    delete process.env.MICROSOFT_CLIENT_ID;
    delete process.env.MICROSOFT_CLIENT_SECRET;
  }
});

test("hotmail: el regreso rechaza un estado inventado", async () => {
  process.env.MICROSOFT_CLIENT_ID = "id-prueba";
  process.env.MICROSOFT_CLIENT_SECRET = "secreto";
  try {
    await assert.rejects(outlook.terminarConexion({ query: { code: "x", state: "inventado" }, protocol: "https", get: () => "x" }), /caducó/);
  } finally {
    delete process.env.MICROSOFT_CLIENT_ID;
    delete process.env.MICROSOFT_CLIENT_SECRET;
  }
});

test("hotmail: traduce la búsqueda estilo Gmail", () => {
  assert.deepEqual(outlook.traducirConsulta("in:inbox is:unread newer_than:3d"), { sinLeer: true, dias: 3, adjuntos: false, buscar: "" });
  const f = outlook.traducirConsulta('from:ana@acme.com subject:"factura" has:attachment -category:promotions');
  assert.equal(f.buscar, "from:ana@acme.com subject:factura");
  assert.equal(f.adjuntos, true);
  assert.equal(outlook.traducirConsulta("newer_than:1m").dias, 30);
});

test("hotmail: convierte el mensaje al formato de DELTA", () => {
  const m = outlook.resumen({
    id: "AAA=", conversationId: "C1", subject: "Hola",
    from: { emailAddress: { name: "Ana López", address: "ana@x.com" } },
    toRecipients: [{ emailAddress: { name: "yo@hotmail.com", address: "yo@hotmail.com" } }],
    receivedDateTime: "2026-11-20T10:00:00Z", bodyPreview: "Hola\r\n  qué tal", isRead: false, importance: "high",
  });
  assert.equal(m.de, "Ana López <ana@x.com>");
  assert.equal(m.para, "yo@hotmail.com");
  assert.equal(m.vista_previa, "Hola qué tal");
  assert.equal(m.sin_leer, true);
  assert.equal(m.importante, true);
});

test("hotmail: destinatarios sin inyección de saltos", () => {
  assert.deepEqual(outlook.destinatarios('"Ana" <ana@x.com>, b@y.com;\r\nBcc: c@z.com'), [
    { emailAddress: { address: "ana@x.com", name: "Ana" } },
    { emailAddress: { address: "b@y.com" } },
    { emailAddress: { address: "Bcc: c@z.com" } },
  ]);
});

test("correo unificado: los ids de Hotmail llevan su marca y los de Gmail no", () => {
  assert.deepEqual(correo.separarId("o:AAMk-x="), { origen: "outlook", id: "AAMk-x=" });
  assert.deepEqual(correo.separarId("18c2f0a9b"), { origen: "gmail", id: "18c2f0a9b" });
});

test("correo unificado: sin cuentas conectadas lo dice claro", async () => {
  assert.deepEqual(correo.conectados(), []);
  assert.deepEqual(await correo.recientes(), { conectado: false, cuentas: [] });
  await assert.rejects(correo.buscarCorreos({}), /Conecte Gmail o Hotmail/);
  assert.equal(await correo.pendientesDeHoy(), null);
});

test("correo unificado: no deja usar Hotmail si no tiene llaves aunque haya permiso guardado", async () => {
  setAjuste("outlook_refresh", "algo");
  assert.equal(correo.estado().outlook.conectado, false);
  await assert.rejects(correo.leerCorreo("o:123"), /Hotmail no está conectado/);
  await assert.rejects(correo.buscarCorreos({ cuenta: "outlook" }), /Conecte Gmail o Hotmail/);
});
