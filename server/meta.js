// Meta (Facebook, Instagram y anuncios) de los clientes de la agencia.
//
// Dos formas de conectar (la que esté puesta en Railway):
//  1. Botón "Conectar Meta" (recomendada): META_APP_ID y META_APP_SECRET de una app de Meta for Developers.
//     El dueño entra con su Facebook y DELTA ve todo lo que él ve como agencia (páginas, Instagram
//     y cuentas de anuncios de sus clientes). El permiso dura 60 días; DELTA avisa antes de que venza.
//     Si la app es de tipo "Negocio", también va META_CONFIG_ID (la configuración de Facebook Login for Business).
//  2. META_ACCESS_TOKEN: permiso de un "usuario del sistema" del Business Manager (no vence).
//
// Solo LEE: seguidores, alcance, publicaciones y anuncios. No publica ni toca campañas.
import crypto from "node:crypto";
import { db, getAjuste, setAjuste } from "./db.js";
import { listarClientes, obtenerCliente, registrarGasto, clienteRequerido, mesActual } from "./agencia.js";
import { localAUTC, ahoraLocalISO } from "./tiempo.js";
import { avisar } from "./avisos.js";

const VERSION = () => process.env.META_API_VERSION || "v23.0";
const GRAPH = () => `https://graph.facebook.com/${VERSION()}`;
const PERMISOS = [
  "ads_read", "business_management", "pages_show_list", "pages_read_engagement",
  "read_insights", "instagram_basic", "instagram_manage_insights",
].join(",");
const DIA = 864e5;
const CADA = 6 * 3600e3; // se actualiza sola cada 6 horas

export const modoSistema = () => Boolean(process.env.META_ACCESS_TOKEN);
export const metaDisponible = () => modoSistema() || Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET);
export const metaConectado = () => Boolean(tokenPrincipal());
const tokenPrincipal = () => process.env.META_ACCESS_TOKEN || getAjuste("meta_token") || null;

// ---------- Conexión con el botón ----------
const estados = new Map(); // estado -> expira (un solo uso, 10 min)

function urlRetorno(req) {
  const base = process.env.URL_PUBLICA || `${req.protocol}://${req.get("host")}`;
  return base.replace(/\/$/, "") + "/oauth/meta";
}

export function urlConexion(req) {
  if (modoSistema()) throw new Error("Meta ya está conectado con el permiso del Business Manager (META_ACCESS_TOKEN en Railway).");
  if (!metaDisponible()) throw new Error("Falta poner META_APP_ID y META_APP_SECRET en Railway (Variables). Vea la guía para conectar Meta.");
  const estado = crypto.randomBytes(24).toString("hex");
  const ahora = Date.now();
  for (const [k, exp] of estados) if (exp < ahora) estados.delete(k);
  estados.set(estado, ahora + 10 * 60000);
  const p = new URLSearchParams({ client_id: process.env.META_APP_ID, redirect_uri: urlRetorno(req), state: estado, response_type: "code" });
  if (process.env.META_CONFIG_ID) {
    p.set("config_id", process.env.META_CONFIG_ID);
    p.set("override_default_response_type", "true");
  } else {
    p.set("scope", PERMISOS);
  }
  return `https://www.facebook.com/${VERSION()}/dialog/oauth?${p}`;
}

export async function terminarConexion(req) {
  const { code, state, error, error_description } = req.query;
  if (error) throw new Error("Meta no dio permiso: " + (error_description || error));
  const exp = estados.get(String(state || ""));
  estados.delete(String(state || ""));
  if (!exp || exp < Date.now()) throw new Error("El enlace de conexión caducó. Vuelva a intentarlo desde Ajustes.");
  const app = { client_id: process.env.META_APP_ID, client_secret: process.env.META_APP_SECRET };
  const corto = await pedir("/oauth/access_token", { ...app, redirect_uri: urlRetorno(req), code: String(code || "") }, null, { sinPrueba: true });
  // El permiso corto dura 1-2 horas; se cambia por uno de 60 días.
  const largo = await pedir("/oauth/access_token", { ...app, grant_type: "fb_exchange_token", fb_exchange_token: corto.access_token }, null, { sinPrueba: true });
  const yo = await pedir("/me", { fields: "id,name" }, largo.access_token);
  setAjuste("meta_token", largo.access_token);
  setAjuste("meta_usuario", yo.name || "");
  setAjuste("meta_expira", largo.expires_in ? new Date(Date.now() + largo.expires_in * 1000).toISOString() : "");
  setAjuste("meta_aviso_vence", "");
  // Primera revisión en segundo plano: encuentra páginas, Instagram y cuentas de anuncios.
  actualizarTodo().catch((e) => console.error("[meta]", e.message));
  return yo.name;
}

export function desconectar() {
  db.prepare("DELETE FROM ajustes WHERE clave IN ('meta_token','meta_usuario','meta_expira','meta_aviso_vence')").run();
  db.prepare("UPDATE meta_activos SET token = NULL").run();
}

// ---------- Llamadas a Meta ----------
const prueba = (token) => (process.env.META_APP_SECRET && !modoSistema()
  ? crypto.createHmac("sha256", process.env.META_APP_SECRET).update(token).digest("hex")
  : null);

async function pedir(ruta, params = {}, token = tokenPrincipal(), { sinPrueba = false } = {}) {
  const url = new URL(ruta.startsWith("http") ? ruta : GRAPH() + ruta);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  if (token && !url.searchParams.has("access_token")) url.searchParams.set("access_token", token);
  const tok = url.searchParams.get("access_token");
  const p = tok && !sinPrueba && prueba(tok);
  if (p) url.searchParams.set("appsecret_proof", p);
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) {
    const e = new Error("Meta: " + (d.error?.error_user_msg || d.error?.message || `error ${r.status}`));
    e.codigo = d.error?.code;
    if (e.codigo === 190 && tok && tok === getAjuste("meta_token")) {
      desconectar();
      avisar("Se venció el permiso de Meta. Vuelva a conectarlo en Ajustes ⚙ → Conectar Meta para seguir viendo las redes de sus clientes.", "Meta").catch(() => {});
    }
    throw e;
  }
  return d;
}

/** Trae todas las páginas de una lista de Meta (con tope para no gastar de más). */
async function todo(ruta, params, token, max = 500) {
  const lista = [];
  let d = await pedir(ruta, { limit: 100, ...params }, token);
  for (;;) {
    lista.push(...(d.data || []));
    if (!d.paging?.next || lista.length >= max) break;
    d = await pedir(d.paging.next, {}, null);
  }
  return lista;
}

const intentar = async (fn, errores, que) => {
  try { return await fn(); } catch (e) { errores?.push(`${que}: ${e.message.replace(/^Meta: /, "")}`); return null; }
};

// ---------- Encontrar páginas, Instagram y cuentas de anuncios ----------
const normal = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const GENERICAS = new Set(["clinica", "dental", "dentista", "doctor", "doctora", "consultorio", "hospital", "salud", "spa", "estetica", "studio", "estudio", "grupo", "centro"]);

/** ¿A qué cliente pertenece este nombre? Solo si hay uno y solo uno que se parezca. */
export function clienteParecido(nombre, clientes = listarClientes()) {
  const n = normal(nombre);
  if (!n) return null;
  const hallados = clientes.filter((c) => {
    const k = normal(c.nombre);
    if (k.length < 4 || GENERICAS.has(k)) return false;
    if (n.includes(k) || (n.length >= 5 && k.includes(n))) return true;
    // También por palabras importantes del nombre ("Clínica Sonrisa" ↔ "sonrisaclinica.mx")
    const palabras = String(c.nombre).split(/\s+/).map(normal).filter((p) => p.length >= 5 && !GENERICAS.has(p));
    return palabras.length > 0 && palabras.every((p) => n.includes(p));
  });
  return hallados.length === 1 ? hallados[0] : null;
}

function guardarActivo({ id, tipo, nombre, extra, token }) {
  const antes = db.prepare("SELECT * FROM meta_activos WHERE id = ?").get(id);
  db.prepare(`INSERT INTO meta_activos (id, tipo, nombre, extra, token) VALUES (?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, extra = excluded.extra, token = COALESCE(excluded.token, meta_activos.token),
        visto = strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
    .run(id, tipo, nombre, JSON.stringify(extra || {}), token || null);
  if (!antes || (!antes.cliente_id && !antes.ligado)) {
    const c = clienteParecido(nombre) || (extra?.usuario && clienteParecido(extra.usuario));
    if (c) db.prepare("UPDATE meta_activos SET cliente_id = ?, ligado = 'auto' WHERE id = ?").run(c.id, id);
  }
  return !antes;
}

export async function descubrir() {
  if (!metaConectado()) throw new Error("Meta no está conectado. Conéctelo en Ajustes ⚙ → Conectar Meta.");
  const errores = [];
  let nuevos = 0;
  const vistos = new Set();
  const guardar = (a) => { if (vistos.has(a.id)) return; vistos.add(a.id); if (guardarActivo(a)) nuevos++; };

  // Páginas de Facebook (con su Instagram ligado) que el dueño administra.
  const camposPagina = "id,name,access_token,instagram_business_account{id,username,name}";
  const paginas = (await intentar(() => todo("/me/accounts", { fields: camposPagina }), errores, "Páginas")) || [];
  // Cuentas de anuncios a las que tiene acceso.
  const camposCuenta = "id,name,currency,account_status,business{name}";
  const cuentas = (await intentar(() => todo("/me/adaccounts", { fields: camposCuenta }), errores, "Cuentas de anuncios")) || [];

  // Lo que los clientes compartieron con su Business Manager como socio.
  const negocios = (await intentar(() => todo("/me/businesses", { fields: "id,name" }), null, "Negocios")) || [];
  for (const b of negocios) {
    for (const ruta of ["client_ad_accounts", "owned_ad_accounts"]) {
      const l = await intentar(() => todo(`/${b.id}/${ruta}`, { fields: camposCuenta }), null, ruta);
      if (l) cuentas.push(...l);
    }
    for (const ruta of ["client_pages", "owned_pages"]) {
      const l = await intentar(() => todo(`/${b.id}/${ruta}`, { fields: "id,name,instagram_business_account{id,username,name}" }), null, ruta);
      if (l) paginas.push(...l);
    }
  }

  for (const p of paginas) {
    if (!vistos.has(`page:${p.id}`) || p.access_token) {
      vistos.delete(`page:${p.id}`);
      guardar({ id: `page:${p.id}`, tipo: "pagina", nombre: p.name, token: p.access_token, extra: { instagram: p.instagram_business_account?.id || null } });
    }
    const ig = p.instagram_business_account;
    if (ig) guardar({ id: `ig:${ig.id}`, tipo: "instagram", nombre: ig.username ? `@${ig.username}` : ig.name || p.name, extra: { usuario: ig.username, pagina: p.id, pagina_nombre: p.name } });
  }
  for (const c of cuentas) {
    guardar({ id: c.id, tipo: "anuncios", nombre: c.name || c.id, extra: { moneda: c.currency, activa: c.account_status === 1, negocio: c.business?.name || null } });
  }
  // Instagram ligado: hereda el cliente de su página (y al revés) si uno de los dos ya está asignado.
  db.prepare(`UPDATE meta_activos SET cliente_id = (SELECT p.cliente_id FROM meta_activos p WHERE p.id = 'page:' || json_extract(meta_activos.extra,'$.pagina')), ligado = 'auto'
      WHERE tipo = 'instagram' AND cliente_id IS NULL AND ligado IS NULL
        AND (SELECT p.cliente_id FROM meta_activos p WHERE p.id = 'page:' || json_extract(meta_activos.extra,'$.pagina')) IS NOT NULL`).run();
  db.prepare(`UPDATE meta_activos SET cliente_id = (SELECT i.cliente_id FROM meta_activos i WHERE i.id = 'ig:' || json_extract(meta_activos.extra,'$.instagram')), ligado = 'auto'
      WHERE tipo = 'pagina' AND cliente_id IS NULL AND ligado IS NULL
        AND (SELECT i.cliente_id FROM meta_activos i WHERE i.id = 'ig:' || json_extract(meta_activos.extra,'$.instagram')) IS NOT NULL`).run();
  return { paginas: paginas.length, cuentas_anuncios: cuentas.length, nuevos, errores };
}

// ---------- Números de cada cliente ----------
const segundos = (ms) => Math.floor(ms / 1000);
const inicioDeMes = () => Date.parse(localAUTC(`${mesActual()}-01T00:00`));
const sumaAccion = (acciones, tipos) => {
  for (const t of tipos) {
    const a = (acciones || []).find((x) => x.action_type === t);
    if (a) return Number(a.value) || 0;
  }
  return 0;
};
const ultimoValor = (metrica) => {
  const v = metrica?.values;
  if (v?.length) return Number(v[v.length - 1].value) || 0;
  return Number(metrica?.total_value?.value) || 0;
};

async function numerosPagina(a, errores) {
  const token = a.token || tokenPrincipal();
  const id = a.id.slice(5);
  const datos = await intentar(() => pedir(`/${id}`, { fields: "followers_count,fan_count" }, token), errores, a.nombre);
  if (!datos) return null;
  const posts = await intentar(() => todo(`/${id}/posts`, { fields: "id", since: segundos(inicioDeMes()) }, token, 300), errores, `${a.nombre} (publicaciones)`);
  // Meta ha ido cambiando el nombre de esta métrica; se prueba en orden.
  let alcance = null;
  for (const m of ["page_impressions_unique", "page_total_media_view_unique", "page_media_view"]) {
    const r = await intentar(() => pedir(`/${id}/insights`, { metric: m, period: "days_28" }, token), null, m);
    if (r?.data?.[0]) { alcance = ultimoValor(r.data[0]); break; }
  }
  return { seguidores: datos.followers_count ?? datos.fan_count ?? 0, me_gusta: datos.fan_count ?? null, publicaciones_mes: posts ? posts.length : null, alcance_28d: alcance };
}

async function numerosInstagram(a, errores) {
  const id = a.id.slice(3);
  const pag = a.extra?.pagina && db.prepare("SELECT token FROM meta_activos WHERE id = ?").get(`page:${a.extra.pagina}`)?.token;
  const token = tokenPrincipal() || pag;
  const datos = await intentar(() => pedir(`/${id}`, { fields: "username,followers_count,media_count" }, token), errores, a.nombre);
  if (!datos) return null;
  const hasta = Date.now();
  const desde = hasta - 28 * DIA;
  const totales = {};
  for (const grupo of [["reach", "accounts_engaged", "total_interactions"], ["views"], ["profile_views"]]) {
    const r = await intentar(() => pedir(`/${id}/insights`, { metric: grupo.join(","), period: "day", metric_type: "total_value", since: segundos(desde), until: segundos(hasta) }, token), null, "insights");
    for (const m of r?.data || []) totales[m.name] = ultimoValor(m);
  }
  const media = (await intentar(() => todo(`/${id}/media`, { fields: "id,timestamp,like_count,comments_count,permalink,caption,media_type" }, token, 60), errores, `${a.nombre} (publicaciones)`)) || [];
  const delMes = media.filter((m) => Date.parse(m.timestamp) >= inicioDeMes());
  const mejor = [...delMes].sort((x, y) => (y.like_count || 0) + (y.comments_count || 0) - (x.like_count || 0) - (x.comments_count || 0))[0];
  return {
    seguidores: datos.followers_count ?? 0,
    publicaciones_total: datos.media_count ?? null,
    publicaciones_mes: delMes.length,
    me_gusta_mes: delMes.reduce((s, m) => s + (m.like_count || 0), 0),
    comentarios_mes: delMes.reduce((s, m) => s + (m.comments_count || 0), 0),
    alcance_28d: totales.reach ?? null,
    vistas_28d: totales.views ?? null,
    cuentas_interesadas_28d: totales.accounts_engaged ?? null,
    interacciones_28d: totales.total_interactions ?? null,
    visitas_perfil_28d: totales.profile_views ?? null,
    mejor_publicacion: mejor ? { enlace: mejor.permalink, texto: String(mejor.caption || "").slice(0, 120), me_gusta: mejor.like_count || 0, comentarios: mejor.comments_count || 0 } : null,
  };
}

/**
 * Publicaciones recientes de una cuenta de Instagram ajena (competencia o creador del nicho), para Tendencias.
 * Usa "business discovery" desde un Instagram ya conectado: solo funciona con cuentas de empresa o creador.
 */
export async function cuentaInstagramAjena(usuario, clienteId = null) {
  const u = String(usuario || "").trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(u)) throw new Error(`"${usuario}" no parece una cuenta de Instagram`);
  if (!metaConectado()) throw new Error("Meta no está conectado");
  const ig = (clienteId && db.prepare("SELECT * FROM meta_activos WHERE tipo = 'instagram' AND cliente_id = ? LIMIT 1").get(clienteId))
    || db.prepare("SELECT * FROM meta_activos WHERE tipo = 'instagram' ORDER BY cliente_id IS NULL, visto DESC LIMIT 1").get();
  if (!ig) throw new Error("hace falta al menos un Instagram conectado en Meta para ver otras cuentas");
  const extra = JSON.parse(ig.extra || "{}");
  const pag = extra.pagina && db.prepare("SELECT token FROM meta_activos WHERE id = ?").get(`page:${extra.pagina}`)?.token;
  const campos = `business_discovery.username(${u}){username,name,followers_count,media_count,media.limit(30){caption,like_count,comments_count,media_type,media_product_type,permalink,timestamp}}`;
  try {
    const d = await pedir(`/${ig.id.slice(3)}`, { fields: campos }, tokenPrincipal() || pag);
    if (!d.business_discovery) throw new Error("Meta: no devolvió la cuenta");
    return d.business_discovery;
  } catch (e) {
    if (/business_discovery|Invalid user id|Cannot find User|110/i.test(e.message)) throw new Error("no se encontró o no es cuenta de empresa o creador");
    throw e;
  }
}

const CAMPOS_ANUNCIOS = "spend,impressions,reach,clicks,inline_link_clicks,actions,action_values";
const RESULTADOS = {
  conversaciones: ["onsite_conversion.messaging_conversation_started_7d"],
  prospectos: ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"],
  compras: ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"],
};
const resultadosDe = (fila) => ({
  ...Object.fromEntries(Object.entries(RESULTADOS).map(([k, tipos]) => [k, sumaAccion(fila.actions, tipos)])),
  valor_compras: Math.round(sumaAccion(fila.action_values, RESULTADOS.compras) * 100) / 100,
});
const CAMPOS_CAMPANA = "campaign_id,campaign_name,objective,spend,impressions,reach,frequency,inline_link_clicks,actions,action_values";

/** Números por campaña (este mes y los últimos 7 días), para el tablero de Paid media. */
async function campanasDe(a, activas) {
  const lista = async (preset) => (await todo(`/${a.id}/insights`, { fields: CAMPOS_CAMPANA, date_preset: preset, level: "campaign" }, undefined, 200));
  const mes = (await intentar(() => lista("this_month"), null, "campañas")) || [];
  if (!mes.length) return [];
  const semana = new Map(((await intentar(() => lista("last_7d"), null, "campañas 7 días")) || []).map((f) => [f.campaign_id, f]));
  return mes.map((f) => {
    const s = semana.get(f.campaign_id);
    const r = resultadosDe(f);
    return {
      id: f.campaign_id,
      nombre: f.campaign_name || f.campaign_id,
      objetivo: f.objective || null,
      activa: activas ? activas.has(f.campaign_id) : null,
      cuenta: a.nombre,
      gasto: Number(f.spend) || 0,
      impresiones: Number(f.impressions) || 0,
      alcance: Number(f.reach) || 0,
      frecuencia: Number(f.frequency) || 0,
      clics_enlace: Number(f.inline_link_clicks) || 0,
      ...r,
      semana: s ? (() => { const rs = resultadosDe(s); return { gasto: Number(s.spend) || 0, resultados: rs.conversaciones + rs.prospectos + rs.compras }; })() : { gasto: 0, resultados: 0 },
    };
  });
}

async function numerosAnuncios(a, errores) {
  const fila = async (preset) => (await pedir(`/${a.id}/insights`, { fields: CAMPOS_ANUNCIOS, date_preset: preset, level: "account" })).data?.[0] || {};
  const este = await intentar(() => fila("this_month"), errores, a.nombre);
  if (!este) return null;
  const pasado = await intentar(() => fila("last_month"), null, "mes pasado");
  const activas = await intentar(() => todo(`/${a.id}/campaigns`, { effective_status: ["ACTIVE"], fields: "id" }, undefined, 300), null, "campañas");
  const ids = activas ? new Set(activas.map((x) => x.id)) : null;
  return {
    moneda: a.extra?.moneda || null,
    gasto_mes: Number(este.spend) || 0,
    gasto_mes_pasado: pasado ? Number(pasado.spend) || 0 : null,
    impresiones: Number(este.impressions) || 0,
    alcance: Number(este.reach) || 0,
    clics: Number(este.clicks) || 0,
    clics_enlace: Number(este.inline_link_clicks) || 0,
    ...resultadosDe(este),
    campanas_activas: ids ? ids.size : null,
    campanas: await campanasDe(a, ids),
  };
}

/** Suma los números de varias páginas, perfiles o cuentas del mismo cliente. */
function sumar(lista) {
  const r = {};
  for (const x of lista) {
    for (const [k, v] of Object.entries(x)) {
      if (typeof v === "number") r[k] = (r[k] ?? 0) + v;
      else if (v !== null && v !== undefined && r[k] === undefined) r[k] = v;
      else if (r[k] === undefined) r[k] = null;
    }
  }
  return r;
}

const mesAnterior = () => {
  const [a, m] = mesActual().split("-").map(Number);
  return new Date(Date.UTC(a, m - 2, 1)).toISOString().slice(0, 7);
};

export async function sincronizarCliente(clienteId) {
  const activos = db.prepare("SELECT * FROM meta_activos WHERE cliente_id = ?").all(clienteId).map((a) => ({ ...a, extra: JSON.parse(a.extra || "{}") }));
  if (!activos.length) return null;
  const errores = [];
  const de = (tipo) => activos.filter((a) => a.tipo === tipo);
  const fb = (await Promise.all(de("pagina").map((a) => numerosPagina(a, errores)))).filter(Boolean);
  const ig = (await Promise.all(de("instagram").map((a) => numerosInstagram(a, errores)))).filter(Boolean);
  const ads = (await Promise.all(de("anuncios").map((a) => numerosAnuncios(a, errores)))).filter(Boolean);
  const foto = {
    facebook: fb.length ? { ...sumar(fb), paginas: de("pagina").map((a) => a.nombre) } : null,
    instagram: ig.length ? { ...sumar(ig), mejor_publicacion: ig.map((x) => x.mejor_publicacion).filter(Boolean).sort((x, y) => y.me_gusta + y.comentarios - x.me_gusta - x.comentarios)[0] || null, cuentas: de("instagram").map((a) => a.nombre) } : null,
    anuncios: ads.length ? { ...sumar(ads.map(({ campanas, ...x }) => x)), campanas: ads.flatMap((x) => x.campanas || []).sort((x, y) => y.gasto - x.gasto).slice(0, 60), cuentas: de("anuncios").map((a) => a.nombre), monedas: [...new Set(ads.map((x) => x.moneda).filter(Boolean))] } : null,
    errores: errores.slice(0, 6),
  };
  // El gasto de Meta llena solo la tabla de gasto (el semáforo y el Panel general lo usan).
  if (foto.anuncios) {
    registrarGasto({ cliente: clienteId, plataforma: "meta", monto: Math.round(foto.anuncios.gasto_mes * 100) / 100, fuente: "meta" });
    if (foto.anuncios.gasto_mes_pasado !== null && foto.anuncios.gasto_mes_pasado !== undefined) {
      registrarGasto({ cliente: clienteId, plataforma: "meta", monto: Math.round(foto.anuncios.gasto_mes_pasado * 100) / 100, mes: mesAnterior(), fuente: "meta" });
    }
  }
  const fecha = ahoraLocalISO().slice(0, 10);
  db.prepare(`INSERT INTO meta_fotos (cliente_id, fecha, datos) VALUES (?,?,?)
      ON CONFLICT(cliente_id, fecha) DO UPDATE SET datos = excluded.datos, actualizado = strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
    .run(clienteId, fecha, JSON.stringify(foto));
  return foto;
}

let enCurso = null;
/** Busca lo nuevo en Meta y actualiza los números de todos los clientes ligados. */
export function actualizarTodo() {
  if (enCurso) return enCurso;
  enCurso = (async () => {
    const hallazgo = await descubrir();
    const ids = db.prepare("SELECT DISTINCT cliente_id FROM meta_activos WHERE cliente_id IS NOT NULL").all().map((r) => r.cliente_id);
    let ok = 0;
    const errores = [...hallazgo.errores];
    for (const id of ids) {
      try {
        const f = await sincronizarCliente(id);
        if (f) ok++;
        if (f?.errores?.length) errores.push(...f.errores);
      } catch (e) { errores.push(`${obtenerCliente(id)?.nombre}: ${e.message}`); }
    }
    setAjuste("meta_ultima", new Date().toISOString());
    return { ...hallazgo, clientes_actualizados: ok, errores: errores.slice(0, 10) };
  })().finally(() => { enCurso = null; });
  return enCurso;
}

// ---------- Para la pantalla y para DELTA ----------
export function ligar(activoId, cliente) {
  const a = db.prepare("SELECT * FROM meta_activos WHERE id = ?").get(String(activoId));
  if (!a) throw new Error("No encuentro esa página o cuenta de Meta");
  const c = cliente === null || cliente === "" || cliente === undefined ? null : clienteRequerido(cliente);
  db.prepare("UPDATE meta_activos SET cliente_id = ?, ligado = 'manual' WHERE id = ?").run(c?.id ?? null, a.id);
  // Instagram y su página van juntos si el otro no se había asignado a mano.
  const extra = JSON.parse(a.extra || "{}");
  const pareja = a.tipo === "pagina" && extra.instagram ? `ig:${extra.instagram}` : a.tipo === "instagram" && extra.pagina ? `page:${extra.pagina}` : null;
  if (pareja) db.prepare("UPDATE meta_activos SET cliente_id = ?, ligado = 'auto' WHERE id = ? AND (ligado IS NULL OR ligado = 'auto')").run(c?.id ?? null, pareja);
  return { id: a.id, nombre: a.nombre, cliente: c?.nombre ?? null };
}

const TIPO = { pagina: "Página de Facebook", instagram: "Instagram", anuncios: "Cuenta de anuncios" };

export function estado() {
  const expira = getAjuste("meta_expira") || null;
  return {
    disponible: metaDisponible(),
    conectado: metaConectado(),
    modo: modoSistema() ? "sistema" : "boton",
    usuario: getAjuste("meta_usuario") || null,
    expira: modoSistema() ? null : expira,
    ultima: getAjuste("meta_ultima") || null,
    activos: db.prepare(`SELECT a.id, a.tipo, a.nombre, a.extra, a.cliente_id, a.ligado, c.nombre cliente FROM meta_activos a
        LEFT JOIN clientes c ON c.id = a.cliente_id ORDER BY a.cliente_id IS NULL, c.nombre, a.tipo, a.nombre`).all()
      .map(({ extra, ...a }) => ({ ...a, tipo_nombre: TIPO[a.tipo], extra: JSON.parse(extra || "{}") })),
    clientes: listarClientes().filter((c) => c.estado !== "terminado").map((c) => ({ id: c.id, nombre: c.nombre })),
  };
}

/** Avisa una vez cuando al permiso de 60 días le queda una semana o menos. */
function revisarVencimiento() {
  const exp = getAjuste("meta_expira");
  if (modoSistema() || !exp || !getAjuste("meta_token")) return;
  const falta = Date.parse(exp) - Date.now();
  if (falta < 7 * DIA && getAjuste("meta_aviso_vence") !== exp) {
    setAjuste("meta_aviso_vence", exp);
    const dias = Math.max(0, Math.ceil(falta / DIA));
    avisar(`El permiso de Meta vence en ${dias} día${dias === 1 ? "" : "s"}. Toque Ajustes ⚙ → Conectar Meta para renovarlo (toma un minuto).`, "Meta").catch(() => {});
  }
}

export function iniciarMeta() {
  const ciclo = () => {
    try { revisarVencimiento(); } catch (e) { console.error("[meta]", e.message); }
    if (!metaConectado()) return;
    const ultima = Date.parse(getAjuste("meta_ultima") || 0) || 0;
    if (Date.now() - ultima < CADA) return;
    actualizarTodo().catch((e) => console.error("[meta]", e.message));
  };
  setTimeout(ciclo, 60_000);
  return setInterval(ciclo, 30 * 60_000);
}
