// Correo: conexión con Hotmail / Outlook.com (Microsoft OAuth + Microsoft Graph).
// Mismo trato que Gmail: DELTA lee, resume y escribe borradores; enviar solo con permiso.
import crypto from "node:crypto";
import { getAjuste, setAjuste, db } from "./db.js";

const ALCANCES = ["openid", "email", "offline_access", "User.Read", "Mail.ReadWrite", "Mail.Send"].join(" ");
const API = "https://graph.microsoft.com/v1.0/me";
const inquilino = () => process.env.MICROSOFT_TENANT || "common";
const login = (ruta) => `https://login.microsoftonline.com/${inquilino()}/oauth2/v2.0/${ruta}`;

export const outlookDisponible = () => Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
export const outlookConectado = () => outlookDisponible() && Boolean(getAjuste("outlook_refresh"));
export const cuentaOutlook = () => getAjuste("outlook_cuenta");

function urlRetorno(req) {
  const base = process.env.URL_PUBLICA || `${req.protocol}://${req.get("host")}`;
  return base.replace(/\/$/, "") + "/oauth/microsoft";
}

// ---------- Conexión ----------
const estados = new Map(); // estado -> expira (un solo uso, 10 min)

export function urlConexion(req) {
  if (!outlookDisponible()) throw new Error("Falta poner MICROSOFT_CLIENT_ID y MICROSOFT_CLIENT_SECRET en Railway (Variables). Vea la guía para conectar Hotmail.");
  const estado = crypto.randomBytes(24).toString("hex");
  const ahora = Date.now();
  for (const [k, exp] of estados) if (exp < ahora) estados.delete(k);
  estados.set(estado, ahora + 10 * 60000);
  const p = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    redirect_uri: urlRetorno(req),
    response_type: "code",
    response_mode: "query",
    scope: ALCANCES,
    prompt: "select_account",
    state: estado,
  });
  if (process.env.OUTLOOK_CUENTA) p.set("login_hint", process.env.OUTLOOK_CUENTA);
  return login("authorize") + "?" + p;
}

async function pedirToken(campos) {
  const r = await fetch(login("token"), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET,
      scope: ALCANCES,
      ...campos,
    }),
    signal: AbortSignal.timeout(15000),
  });
  return { r, d: await r.json() };
}

export async function terminarConexion(req) {
  const { code, state, error, error_description } = req.query;
  if (error) throw new Error("Microsoft no dio permiso: " + (error_description || error));
  const exp = estados.get(String(state || ""));
  estados.delete(String(state || ""));
  if (!exp || exp < Date.now()) throw new Error("El enlace de conexión caducó. Vuelva a intentarlo desde Ajustes.");
  const { r, d } = await pedirToken({ code: String(code || ""), redirect_uri: urlRetorno(req), grant_type: "authorization_code" });
  if (!r.ok || !d.refresh_token) throw new Error("Microsoft no entregó el permiso: " + (d.error_description?.split("\r\n")[0] || d.error || r.status));
  token = { valor: d.access_token, expira: Date.now() + (d.expires_in - 60) * 1000 };
  let correo = null;
  try {
    const c = d.id_token ? JSON.parse(Buffer.from(d.id_token.split(".")[1], "base64url").toString()) : {};
    correo = c.email || c.preferred_username || null;
  } catch { /* se pregunta abajo */ }
  if (!correo) {
    const yo = await fetch(API + "?$select=mail,userPrincipalName", { headers: { Authorization: `Bearer ${d.access_token}` } }).then((x) => x.json()).catch(() => ({}));
    correo = yo.mail || yo.userPrincipalName || null;
  }
  if (process.env.OUTLOOK_CUENTA && correo && correo.toLowerCase() !== process.env.OUTLOOK_CUENTA.toLowerCase()) {
    token = null;
    throw new Error(`Entró con ${correo}, pero DELTA está configurado para ${process.env.OUTLOOK_CUENTA}.`);
  }
  setAjuste("outlook_refresh", d.refresh_token);
  setAjuste("outlook_cuenta", correo || "");
  return correo;
}

export function desconectar() {
  db.prepare("DELETE FROM ajustes WHERE clave IN ('outlook_refresh','outlook_cuenta')").run();
  token = null;
}

// ---------- Llamadas a Microsoft Graph ----------
let token = null;

async function accessToken() {
  if (token && token.expira > Date.now()) return token.valor;
  const refresh = getAjuste("outlook_refresh");
  if (!outlookDisponible() || !refresh) throw new Error("Hotmail no está conectado. Conéctelo en Ajustes ⚙ → Conectar Hotmail.");
  const { r, d } = await pedirToken({ refresh_token: refresh, grant_type: "refresh_token" });
  if (!r.ok) {
    if (d.error === "invalid_grant") desconectar();
    throw new Error("Se perdió el permiso de Hotmail; vuelva a conectarlo en Ajustes.");
  }
  // Microsoft cambia el permiso de larga duración cada vez: hay que guardar el nuevo.
  if (d.refresh_token) setAjuste("outlook_refresh", d.refresh_token);
  token = { valor: d.access_token, expira: Date.now() + (d.expires_in - 60) * 1000 };
  return token.valor;
}

async function graph(ruta, opciones = {}) {
  const r = await fetch(API + ruta, {
    ...opciones,
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json", ...(opciones.headers || {}) },
    signal: AbortSignal.timeout(15000),
  });
  const d = r.status === 202 || r.status === 204 ? {} : await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Hotmail: " + (d.error?.message || r.status));
  return d;
}

const direccion = (x) => {
  const e = x?.emailAddress;
  if (!e) return "";
  return e.name && e.name !== e.address ? `${e.name} <${e.address}>` : e.address || e.name || "";
};

/** Convierte un mensaje de Graph al mismo formato que usa DELTA para Gmail. Separado para poder probarlo. */
export function resumen(m) {
  return {
    id: m.id,
    hilo: m.conversationId,
    de: direccion(m.from || m.sender),
    para: (m.toRecipients || []).map(direccion).join(", "),
    asunto: m.subject || "",
    fecha: m.receivedDateTime || m.sentDateTime || "",
    vista_previa: (m.bodyPreview || "").replace(/\s+/g, " ").trim(),
    sin_leer: m.isRead === false,
    importante: m.importance === "high",
  };
}

/**
 * Traduce lo básico de la sintaxis de Gmail (que DELTA ya conoce) a lo que entiende Outlook.
 * Devuelve palabras para $search y filtros que se aplican aparte.
 */
export function traducirConsulta(consulta = "") {
  let texto = ` ${String(consulta)} `;
  const f = { sinLeer: false, dias: null, adjuntos: false, buscar: "" };
  texto = texto.replace(/\s-?(in:\S+|label:\S+|category:\S+|is:read|is:important|is:starred)(?=\s)/gi, " ");
  texto = texto.replace(/\sis:unread(?=\s)/gi, () => ((f.sinLeer = true), " "));
  texto = texto.replace(/\shas:attachment(?=\s)/gi, () => ((f.adjuntos = true), " "));
  texto = texto.replace(/\snewer_than:(\d+)([dmy])(?=\s)/gi, (_, n, u) => {
    f.dias = Number(n) * (u.toLowerCase() === "m" ? 30 : u.toLowerCase() === "y" ? 365 : 1);
    return " ";
  });
  // from:, to:, subject: y palabras sueltas sí los entiende Outlook tal cual.
  f.buscar = texto.replace(/"/g, "").replace(/\s+/g, " ").trim();
  return f;
}

const CAMPOS = "id,conversationId,subject,from,sender,toRecipients,receivedDateTime,bodyPreview,isRead,importance,hasAttachments";

/** Busca correos. Acepta la misma sintaxis básica que Gmail (is:unread, from:, newer_than:2d…). */
export async function buscarCorreos({ consulta = "", max = 10 } = {}) {
  const n = Math.max(1, Math.min(25, Number(max) || 10));
  const f = traducirConsulta(consulta);
  const dias = f.dias ?? (f.buscar ? null : 2);
  let lista;
  if (f.buscar) {
    // Outlook no deja combinar búsqueda por palabras con filtros: se filtra aquí.
    const d = await graph(`/messages?$search=${encodeURIComponent(`"${f.buscar}"`)}&$top=${Math.min(50, n * 3)}&$select=${CAMPOS}`);
    lista = d.value || [];
  } else {
    const filtros = [];
    if (dias) filtros.push(`receivedDateTime ge ${new Date(Date.now() - dias * 864e5).toISOString()}`);
    if (f.sinLeer) filtros.push("isRead eq false");
    const q = new URLSearchParams({ $top: String(n), $select: CAMPOS, $orderby: "receivedDateTime desc" });
    if (filtros.length) q.set("$filter", filtros.join(" and "));
    const d = await graph(`/mailFolders/inbox/messages?${q}`);
    lista = d.value || [];
  }
  const desde = dias ? Date.now() - dias * 864e5 : 0;
  lista = lista
    .filter((m) => (!f.sinLeer || m.isRead === false) && (!f.adjuntos || m.hasAttachments) && (!desde || Date.parse(m.receivedDateTime) >= desde))
    .sort((a, b) => Date.parse(b.receivedDateTime) - Date.parse(a.receivedDateTime))
    .slice(0, n);
  return { total_aprox: lista.length, correos: lista.map(resumen) };
}

export async function leerCorreo(id) {
  const ruta = `/messages/${encodeURIComponent(id)}`;
  const [m, adj] = await Promise.all([
    graph(`${ruta}?$select=${CAMPOS},body,internetMessageId`, { headers: { Prefer: 'outlook.body-content-type="text"' } }),
    graph(`${ruta}/attachments?$select=name`).catch(() => ({ value: [] })),
  ]);
  const texto = String(m.body?.content || "").replace(/\r\n/g, "\n").replace(/\n\s*\n\s*\n+/g, "\n\n").trim();
  return {
    ...resumen(m),
    texto: texto.length > 12000 ? texto.slice(0, 12000) + "\n[…recortado]" : texto,
    adjuntos: (adj.value || []).map((a) => a.name).filter(Boolean),
    message_id: m.internetMessageId || "",
  };
}

/** "Ana <ana@x.com>, b@y.com" → destinatarios de Graph. Separado para poder probarlo. */
export function destinatarios(texto) {
  return String(texto || "")
    .split(/[,;]/)
    .map((s) => s.replace(/[\r\n]+/g, " ").trim())
    .filter(Boolean)
    .map((s) => {
      const m = s.match(/^(.*?)<([^>]+)>$/);
      const address = (m ? m[2] : s).trim();
      const name = m ? m[1].replace(/"/g, "").trim() : "";
      return { emailAddress: name ? { address, name } : { address } };
    });
}

export async function crearBorrador({ para, cc, asunto, cuerpo, responder_a }) {
  let d;
  if (responder_a) {
    // Respuesta en el mismo hilo, con el correo original citado abajo.
    const extra = {};
    if (para) extra.toRecipients = destinatarios(para);
    if (cc) extra.ccRecipients = destinatarios(cc);
    d = await graph(`/messages/${encodeURIComponent(responder_a)}/createReply`, {
      method: "POST",
      body: JSON.stringify({ comment: String(cuerpo || ""), ...(Object.keys(extra).length ? { message: extra } : {}) }),
    });
    if (asunto) await graph(`/messages/${encodeURIComponent(d.id)}`, { method: "PATCH", body: JSON.stringify({ subject: String(asunto).replace(/[\r\n]+/g, " ") }) });
  } else {
    if (!para) throw new Error("Falta el destinatario");
    d = await graph("/messages", {
      method: "POST",
      body: JSON.stringify({
        subject: String(asunto || "").replace(/[\r\n]+/g, " "),
        body: { contentType: "Text", content: String(cuerpo || "") },
        toRecipients: destinatarios(para),
        ...(cc ? { ccRecipients: destinatarios(cc) } : {}),
      }),
    });
  }
  return {
    borrador_id: d.id,
    para: para || (d.toRecipients || []).map(direccion).join(", "),
    asunto: asunto || d.subject || "",
    cuerpo,
    nota: "Guardado en Borradores de Hotmail. No se ha enviado.",
  };
}

export async function enviarBorrador(id) {
  await graph(`/messages/${encodeURIComponent(id)}/send`, { method: "POST" });
  return { enviado: true };
}

/** Para el resumen de la mañana: no leídos de las últimas 24 h (sin "Otros"). */
export async function pendientesDeHoy() {
  if (!outlookConectado()) return null;
  const q = new URLSearchParams({
    $top: "15",
    $select: CAMPOS + ",inferenceClassification",
    $orderby: "receivedDateTime desc",
    $filter: `receivedDateTime ge ${new Date(Date.now() - 864e5).toISOString()} and isRead eq false`,
  });
  const d = await graph(`/mailFolders/inbox/messages?${q}`);
  const lista = (d.value || []).filter((m) => m.inferenceClassification !== "other").slice(0, 8);
  return { total_aprox: lista.length, correos: lista.map(resumen) };
}
