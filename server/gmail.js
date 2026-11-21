// Correo: conexión con Gmail (Google OAuth). DELTA lee, resume y escribe borradores.
// Enviar solo se permite con un borrador que el usuario ya vio en un turno anterior.
import crypto from "node:crypto";
import { getAjuste, setAjuste, db } from "./db.js";

const ALCANCES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "openid",
  "email",
].join(" ");
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export const gmailDisponible = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
export const gmailConectado = () => gmailDisponible() && Boolean(getAjuste("gmail_refresh"));
export const cuentaGmail = () => getAjuste("gmail_cuenta");

function urlRetorno(req) {
  const base = process.env.URL_PUBLICA || `${req.protocol}://${req.get("host")}`;
  return base.replace(/\/$/, "") + "/oauth/google";
}

// ---------- Conexión ----------
const estados = new Map(); // estado -> expira (un solo uso, 10 min)

export function urlConexion(req) {
  if (!gmailDisponible()) throw new Error("Falta poner GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en Railway (Variables). Vea la guía para conectar Gmail.");
  const estado = crypto.randomBytes(24).toString("hex");
  const ahora = Date.now();
  for (const [k, exp] of estados) if (exp < ahora) estados.delete(k);
  estados.set(estado, ahora + 10 * 60000);
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: urlRetorno(req),
    response_type: "code",
    scope: ALCANCES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: estado,
  });
  if (process.env.GMAIL_CUENTA) p.set("login_hint", process.env.GMAIL_CUENTA);
  return "https://accounts.google.com/o/oauth2/v2/auth?" + p;
}

export async function terminarConexion(req) {
  const { code, state, error } = req.query;
  if (error) throw new Error("Google no dio permiso: " + error);
  const exp = estados.get(String(state || ""));
  estados.delete(String(state || ""));
  if (!exp || exp < Date.now()) throw new Error("El enlace de conexión caducó. Vuelva a intentarlo desde Ajustes.");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: String(code || ""),
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: urlRetorno(req),
      grant_type: "authorization_code",
    }),
  });
  const d = await r.json();
  if (!r.ok || !d.refresh_token) throw new Error("Google no entregó el permiso: " + (d.error_description || d.error || r.status));
  const correo = d.id_token ? JSON.parse(Buffer.from(d.id_token.split(".")[1], "base64url").toString()).email : null;
  if (process.env.GMAIL_CUENTA && correo && correo.toLowerCase() !== process.env.GMAIL_CUENTA.toLowerCase()) {
    throw new Error(`Entró con ${correo}, pero DELTA está configurado para ${process.env.GMAIL_CUENTA}.`);
  }
  setAjuste("gmail_refresh", d.refresh_token);
  setAjuste("gmail_cuenta", correo || "");
  token = { valor: d.access_token, expira: Date.now() + (d.expires_in - 60) * 1000 };
  return correo;
}

export function desconectar() {
  db.prepare("DELETE FROM ajustes WHERE clave IN ('gmail_refresh','gmail_cuenta')").run();
  token = null;
}

// ---------- Llamadas a Gmail ----------
let token = null;

async function accessToken() {
  if (token && token.expira > Date.now()) return token.valor;
  const refresh = getAjuste("gmail_refresh");
  if (!gmailDisponible() || !refresh) throw new Error("Gmail no está conectado. Conéctelo en Ajustes ⚙ → Conectar Gmail.");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refresh,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: "refresh_token",
    }),
  });
  const d = await r.json();
  if (!r.ok) {
    if (d.error === "invalid_grant") desconectar();
    throw new Error("Se perdió el permiso de Gmail; vuelva a conectarlo en Ajustes.");
  }
  token = { valor: d.access_token, expira: Date.now() + (d.expires_in - 60) * 1000 };
  return token.valor;
}

async function gmail(ruta, opciones = {}) {
  const r = await fetch(API + ruta, {
    ...opciones,
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json", ...(opciones.headers || {}) },
    signal: AbortSignal.timeout(15000),
  });
  const d = r.status === 204 ? {} : await r.json();
  if (!r.ok) throw new Error("Gmail: " + (d.error?.message || r.status));
  return d;
}

const cabecera = (msg, nombre) => msg.payload?.headers?.find((h) => h.name.toLowerCase() === nombre.toLowerCase())?.value || "";

function resumen(msg) {
  return {
    id: msg.id,
    hilo: msg.threadId,
    de: cabecera(msg, "From"),
    para: cabecera(msg, "To"),
    asunto: cabecera(msg, "Subject"),
    fecha: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : cabecera(msg, "Date"),
    vista_previa: msg.snippet,
    sin_leer: (msg.labelIds || []).includes("UNREAD"),
    importante: (msg.labelIds || []).includes("IMPORTANT"),
  };
}

/** Busca correos con la sintaxis de Gmail (ej. "is:unread newer_than:1d"). */
export async function buscarCorreos({ consulta = "in:inbox newer_than:2d", max = 10 } = {}) {
  const n = Math.max(1, Math.min(25, Number(max) || 10));
  const lista = await gmail(`/messages?maxResults=${n}&q=${encodeURIComponent(consulta)}`);
  const ids = (lista.messages || []).map((m) => m.id);
  const msgs = await Promise.all(
    ids.map((id) => gmail(`/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`)),
  );
  return { total_aprox: lista.resultSizeEstimate ?? ids.length, correos: msgs.map(resumen) };
}

/** Saca el texto legible de un mensaje MIME. Separado para poder probarlo. */
export function textoDeMensaje(payload) {
  const partes = [];
  const recorrer = (p) => {
    if (!p) return;
    if (p.parts) return p.parts.forEach(recorrer);
    if (p.body?.data && /^text\/(plain|html)/.test(p.mimeType || "")) {
      partes.push({ tipo: p.mimeType, texto: Buffer.from(p.body.data, "base64url").toString("utf8") });
    }
  };
  recorrer(payload);
  const plano = partes.find((p) => p.tipo.startsWith("text/plain"));
  if (plano) return plano.texto.trim();
  const html = partes.find((p) => p.tipo.startsWith("text/html"));
  if (!html) return "";
  return html.texto
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/tr>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

export async function leerCorreo(id) {
  const msg = await gmail(`/messages/${encodeURIComponent(id)}?format=full`);
  const adjuntos = [];
  const buscar = (p) => {
    if (p?.filename) adjuntos.push(p.filename);
    p?.parts?.forEach(buscar);
  };
  buscar(msg.payload);
  const texto = textoDeMensaje(msg.payload);
  return {
    ...resumen(msg),
    texto: texto.length > 12000 ? texto.slice(0, 12000) + "\n[…recortado]" : texto,
    adjuntos,
    message_id: cabecera(msg, "Message-ID"),
  };
}

const codificarCabecera = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString("base64")}?=`);
const sinSaltos = (s) => String(s || "").replace(/[\r\n]+/g, " ").trim();

/** Arma el correo en formato MIME. Separado para poder probarlo. */
export function armarMIME({ para, cc, asunto, cuerpo, enRespuestaA }) {
  const lineas = [
    `To: ${sinSaltos(para)}`,
    cc ? `Cc: ${sinSaltos(cc)}` : null,
    `Subject: ${codificarCabecera(sinSaltos(asunto))}`,
    enRespuestaA ? `In-Reply-To: ${sinSaltos(enRespuestaA)}` : null,
    enRespuestaA ? `References: ${sinSaltos(enRespuestaA)}` : null,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(String(cuerpo || "")).toString("base64").replace(/.{76}/g, "$&\r\n"),
  ].filter((l) => l !== null);
  return Buffer.from(lineas.join("\r\n")).toString("base64url");
}

export async function crearBorrador({ para, cc, asunto, cuerpo, responder_a }) {
  let hilo, enRespuestaA;
  if (responder_a) {
    const orig = await leerCorreo(responder_a);
    hilo = orig.hilo;
    enRespuestaA = orig.message_id;
    para ||= orig.de;
    asunto ||= /^re:/i.test(orig.asunto) ? orig.asunto : `Re: ${orig.asunto}`;
  }
  if (!para) throw new Error("Falta el destinatario");
  const d = await gmail("/drafts", {
    method: "POST",
    body: JSON.stringify({ message: { raw: armarMIME({ para, cc, asunto, cuerpo, enRespuestaA }), ...(hilo ? { threadId: hilo } : {}) } }),
  });
  return { borrador_id: d.id, para, asunto, cuerpo, nota: "Guardado en Borradores de Gmail. No se ha enviado." };
}

export async function enviarBorrador(id) {
  const d = await gmail("/drafts/send", { method: "POST", body: JSON.stringify({ id }) });
  return { enviado: true, correo_id: d.id };
}

/** Para el resumen de la mañana: no leídos de las últimas 24 h. */
export async function pendientesDeHoy() {
  if (!gmailConectado()) return null;
  return buscarCorreos({ consulta: "in:inbox is:unread newer_than:1d -category:promotions -category:social", max: 8 });
}
