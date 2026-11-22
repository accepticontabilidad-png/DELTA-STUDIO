import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "delta-meta-"));
process.env.ZONA_HORARIA = "America/Mexico_City";
process.env.META_APP_ID = "123";
process.env.META_APP_SECRET = "secreto";
delete process.env.META_ACCESS_TOKEN;
delete process.env.ANTHROPIC_API_KEY;

const { setAjuste, db } = await import("../server/db.js");
const agencia = await import("../server/agencia.js");
const meta = await import("../server/meta.js");

// Meta de mentira: responde según la ruta pedida.
const pedidas = [];
const respuestas = {
  "/me/accounts": { data: [
    { id: "11", name: "Clínica Sonrisa", access_token: "tok-pagina", instagram_business_account: { id: "91", username: "sonrisa.clinica" } },
    { id: "12", name: "Pizzería Don Luis" },
  ] },
  "/me/adaccounts": { data: [{ id: "act_55", name: "Sonrisa Ads", currency: "MXN", account_status: 1 }, { id: "act_66", name: "Cuenta personal", currency: "MXN", account_status: 1 }] },
  "/me/businesses": { data: [] },
  "/11": { followers_count: 1500, fan_count: 1400 },
  "/11/posts": { data: [{ id: "p1" }, { id: "p2" }] },
  "/11/insights": { data: [{ name: "page_impressions_unique", values: [{ value: 100 }, { value: 4200 }] }] },
  "/91": { username: "sonrisa.clinica", followers_count: 8200, media_count: 300 },
  "/91/insights": { data: [{ name: "reach", total_value: { value: 25000 } }, { name: "total_interactions", total_value: { value: 900 } }] },
  "/91/media": { data: [
    { id: "m1", timestamp: new Date().toISOString(), like_count: 120, comments_count: 8, permalink: "https://instagram.com/p/x", caption: "Sonríe" },
    { id: "m2", timestamp: "2020-01-01T00:00:00+0000", like_count: 999, comments_count: 1 },
  ] },
  "/act_55/insights": (p) => (p.level === "campaign"
    ? { data: [
      { campaign_id: "c1", campaign_name: "Mensajes WhatsApp", objective: "OUTCOME_ENGAGEMENT", spend: p.date_preset === "last_7d" ? "900" : "2650.50", impressions: "70000", frequency: "2.1", inline_link_clicks: "600",
        actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: p.date_preset === "last_7d" ? "20" : "65" }] },
      { campaign_id: "c9", campaign_name: "Ventas viejas", objective: "OUTCOME_SALES", spend: "600", impressions: "20000", frequency: "4.6", inline_link_clicks: "200",
        actions: [{ action_type: "omni_purchase", value: "2" }], action_values: [{ action_type: "omni_purchase", value: "1800" }] },
    ] }
    : { data: [{ spend: "3250.50", impressions: "90000", reach: "40000", clicks: "1200", inline_link_clicks: "800",
      actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "65" }, { action_type: "link_click", value: "800" }, { action_type: "omni_purchase", value: "2" }],
      action_values: [{ action_type: "omni_purchase", value: "1800" }] }] }),
  "/act_55/campaigns": { data: [{ id: "c1" }, { id: "c2" }, { id: "c3" }] },
};
globalThis.fetch = async (url) => {
  const u = new URL(url);
  const ruta = u.pathname.replace(/^\/v[\d.]+/, "");
  pedidas.push({ ruta, params: Object.fromEntries(u.searchParams) });
  const r = respuestas[ruta];
  const d = typeof r === "function" ? r(Object.fromEntries(u.searchParams)) : r;
  if (!d) return new Response(JSON.stringify({ error: { message: "sin permiso", code: 10 } }), { status: 400 });
  return new Response(JSON.stringify(d), { status: 200 });
};

test("parecido de nombres: solo liga cuando hay un cliente claro", () => {
  const clientes = [{ id: 1, nombre: "Clínica Sonrisa" }, { id: 2, nombre: "Dental" }, { id: 3, nombre: "Pizzería Don Luis" }];
  assert.equal(meta.clienteParecido("Clinica Sonrisa Oficial", clientes)?.id, 1);
  assert.equal(meta.clienteParecido("sonrisa.clinica", clientes)?.id, 1);
  assert.equal(meta.clienteParecido("Clínica Dental Norte", clientes), null); // "Dental" es genérico
  assert.equal(meta.clienteParecido("Cuenta personal", clientes), null);
});

test("conectar: el enlace lleva los permisos de solo lectura, o la configuración de negocio si existe", () => {
  const req = { protocol: "https", get: () => "delta.ejemplo.com" };
  const u = new URL(meta.urlConexion(req));
  assert.equal(u.searchParams.get("redirect_uri"), "https://delta.ejemplo.com/oauth/meta");
  assert.match(u.searchParams.get("scope"), /ads_read/);
  assert.doesNotMatch(u.searchParams.get("scope"), /ads_management|publish/);
  process.env.META_CONFIG_ID = "777";
  const u2 = new URL(meta.urlConexion(req));
  assert.equal(u2.searchParams.get("config_id"), "777");
  assert.equal(u2.searchParams.get("scope"), null);
  delete process.env.META_CONFIG_ID;
});

test("descubrir y actualizar: liga por nombre, llena el gasto solo y guarda la foto del cliente", async () => {
  const sonrisa = agencia.crearCliente({ nombre: "Clínica Sonrisa", presupuesto_anuncios: 5000 });
  agencia.crearCliente({ nombre: "Pizzería Don Luis" });
  setAjuste("meta_token", "tok-usuario");
  assert.equal(meta.metaConectado(), true);

  const r = await meta.actualizarTodo();
  assert.equal(r.cuentas_anuncios, 2);
  const e = meta.estado();
  const de = (id) => e.activos.find((a) => a.id === id);
  assert.equal(de("page:11").cliente, "Clínica Sonrisa");
  assert.equal(de("ig:91").cliente, "Clínica Sonrisa");
  assert.equal(de("act_55").cliente, "Clínica Sonrisa");
  assert.equal(de("page:12").cliente, "Pizzería Don Luis");
  assert.equal(de("act_66").cliente, null);
  assert.equal(JSON.stringify(e).includes("tok-pagina"), false, "el permiso de la página nunca sale a la pantalla");

  // La página usa su propio permiso y todo va firmado con la prueba del secreto.
  const pag = pedidas.find((p) => p.ruta === "/11");
  assert.equal(pag.params.access_token, "tok-pagina");
  assert.ok(pag.params.appsecret_proof);

  const f = agencia.fichaCliente(sonrisa.id);
  assert.equal(f.gasto.total, 3250.5);
  assert.equal(f.gasto.por_plataforma[0].fuente, "meta");
  assert.equal(f.meta.instagram.seguidores, 8200);
  assert.equal(f.meta.instagram.alcance_28d, 25000);
  assert.equal(f.meta.instagram.publicaciones_mes, 1);
  assert.equal(f.meta.instagram.mejor_publicacion.me_gusta, 120);
  assert.equal(f.meta.facebook.seguidores, 1500);
  assert.equal(f.meta.facebook.alcance_28d, 4200);
  assert.equal(f.meta.facebook.publicaciones_mes, 2);
  assert.equal(f.meta.anuncios.conversaciones, 65);
  assert.equal(f.meta.anuncios.campanas_activas, 3);
  assert.equal(f.meta.anuncios.valor_compras, 1800);
  assert.equal(f.meta.anuncios.campanas.length, 2);
  const [c1, c9] = f.meta.anuncios.campanas;
  assert.deepEqual([c1.id, c1.activa, c1.conversaciones, c1.semana.gasto, c1.semana.resultados], ["c1", true, 65, 900, 20]);
  assert.deepEqual([c9.activa, c9.compras, c9.valor_compras, c9.frecuencia], [false, 2, 1800, 4.6]);
  assert.equal(f.salud.nivel, "verde"); // 3,250 de 5,000: va bien
});

test("asignar a mano: manda sobre lo automático y mueve también su Instagram", async () => {
  const pizza = agencia.buscarCliente("Don Luis");
  meta.ligar("page:11", pizza.id);
  const e = meta.estado();
  assert.equal(e.activos.find((a) => a.id === "page:11").cliente, "Pizzería Don Luis");
  assert.equal(e.activos.find((a) => a.id === "ig:91").cliente, "Pizzería Don Luis");
  meta.ligar("act_66", null);
  await meta.descubrir();
  assert.equal(meta.estado().activos.find((a) => a.id === "page:11").cliente, "Pizzería Don Luis", "no se vuelve a ligar solo");
  assert.throws(() => meta.ligar("act_999", pizza.id), /No encuentro/);
});

test("permiso vencido: DELTA se desconecta sola", async () => {
  respuestas["/me/accounts"] = undefined;
  const antes = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "Session has expired", code: 190 } }), { status: 400 });
  await meta.descubrir().catch(() => {});
  globalThis.fetch = antes;
  assert.equal(meta.metaConectado(), false);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM meta_activos WHERE token IS NOT NULL").get().n, 0);
});
