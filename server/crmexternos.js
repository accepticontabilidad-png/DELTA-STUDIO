// Traer prospectos de otros CRM donde ya viven los clientes: Kommo, HighLevel (GoHighLevel) y Pancake.
// SOLO LECTURA: DELTA nunca escribe, mueve ni manda nada en esos sistemas.
// Cada conexión es de un cliente; la llave se guarda en la base de DELTA y nunca regresa a la pantalla.
import { db } from "./db.js";
import { clienteRequerido } from "./agencia.js";
import { crearProspecto, actualizarProspecto, normalizarTelefono, obtenerProspecto, notaProspecto } from "./crm.js";
import { avisarPantalla } from "./avisos.js";
import Anthropic from "@anthropic-ai/sdk";
import * as meta from "./meta.js";

db.exec(`
CREATE TABLE IF NOT EXISTS crm_fuentes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  tipo TEXT NOT NULL,                 -- kommo | ghl | pancake
  cuenta TEXT NOT NULL,               -- kommo: subdominio · ghl: id de la sub-cuenta · pancake: id de la página
  token TEXT NOT NULL,
  creado TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ultimo TEXT,                        -- última vez que se trajo bien
  resultado TEXT,                     -- resumen de la última vez
  error TEXT
);
`);
for (const col of ["externo_id TEXT", "externo_etapa TEXT", "externo_actualizado TEXT", "externo_mensajes INTEGER", "ia_revisado TEXT"]) {
  try { db.exec(`ALTER TABLE prospectos ADD COLUMN ${col}`); } catch { /* ya existe */ }
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_prospectos_externo ON prospectos(externo_id)");

export const TIPOS = {
  kommo: { nombre: "Kommo", cuenta: "Subdominio de Kommo", ejemplo: "miclinica (de miclinica.kommo.com)" },
  ghl: { nombre: "GoHighLevel", cuenta: "Id de la sub-cuenta (Location ID)", ejemplo: "Ajustes → Perfil del negocio" },
  pancake: { nombre: "Pancake", cuenta: "Id de la página en Pancake (opcional)", ejemplo: "DELTA lo saca de la llave" },
};
const DIA = 864e5;

let fetchDePrueba = null;
export const _fetchDePrueba = (fn) => { fetchDePrueba = fn; };
async function pedir(url, opciones = {}) {
  if (fetchDePrueba) return fetchDePrueba(url, opciones);
  const r = await fetch(url, { ...opciones, headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (DELTA CRM)", ...(opciones.headers || {}) }, signal: AbortSignal.timeout(25000) });
  const texto = r.status === 204 ? "" : await r.text();
  let d = {};
  try { d = texto ? JSON.parse(texto) : {}; } catch {
    if (!r.ok || /<html/i.test(texto)) throw new Error(`El servicio no dejó entrar a DELTA (respondió ${r.status} sin datos). Intenta de nuevo en unos minutos.`);
  }
  if (r.status === 401 || r.status === 403) throw new Error("La llave no es válida o no tiene permiso de lectura");
  if (!r.ok) throw new Error(d.message || d.error || d.title || `error ${r.status}`);
  return d;
}

// ---------- Etapas: de cualquier nombre a las de DELTA ----------
const sinAcentos = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export function etapaPorNombre(nombre) {
  const t = sinAcentos(nombre);
  if (/(ganad|vend|venta|cerrad|pag[oa]|compr|won|paciente activ|tratamiento)/.test(t)) return "venta";
  if (/(perdid|descart|no interes|no le interes|no contest|lost|basura|spam|cancel)/.test(t)) return "perdido";
  if (/(asisti|vino|atendid|consulta realiz|valorad|showed)/.test(t)) return "asistio";
  if (/(cita|agend|appoint|book|confirm|aprobad)/.test(t)) return "cita";
  if (/(contact|seguim|respond|calific|negoci|cotiz|interesad|propuesta|follow|perfil|papeles|document)/.test(t)) return "contactado";
  return "nuevo";
}

// ---------- Kommo ----------
async function leerKommo(f, { desde }) {
  const base = `https://${f.cuenta}.kommo.com/api/v4`;
  const h = { headers: { Authorization: `Bearer ${f.token}` } };
  const etapas = {};
  const pl = await pedir(`${base}/leads/pipelines`, h);
  for (const p of pl._embedded?.pipelines || []) for (const s of p._embedded?.statuses || []) etapas[s.id] = s.name;
  const leads = [];
  for (let page = 1; page <= 20; page++) {
    const d = await pedir(`${base}/leads?with=contacts&limit=250&page=${page}&filter[updated_at][from]=${Math.floor(Date.parse(desde) / 1000)}`, h);
    const l = d?._embedded?.leads || [];
    leads.push(...l);
    if (l.length < 250 || !d._links?.next) break;
  }
  // Datos de contacto (teléfono y correo) en grupos
  const ids = [...new Set(leads.flatMap((l) => (l._embedded?.contacts || []).filter((c) => c.is_main !== false).map((c) => c.id)))];
  const contactos = {};
  for (let i = 0; i < ids.length; i += 200) {
    const q = ids.slice(i, i + 200).map((id) => `filter[id][]=${id}`).join("&");
    const d = await pedir(`${base}/contacts?limit=250&${q}`, h);
    for (const c of d?._embedded?.contacts || []) contactos[c.id] = c;
  }
  const campo = (c, code) => c?.custom_fields_values?.find((x) => x.field_code === code)?.values?.[0]?.value || null;
  return leads.map((l) => {
    const c = contactos[(l._embedded?.contacts || []).find((x) => x.is_main !== false)?.id];
    const etapa = l.status_id === 142 ? "venta" : l.status_id === 143 ? "perdido" : etapaPorNombre(etapas[l.status_id]);
    return {
      id: `kommo:${f.cuenta}:${l.id}`, nombre: c?.name || l.name, telefono: campo(c, "PHONE"), correo: campo(c, "EMAIL"),
      etapa, etapa_original: etapas[l.status_id] || null, valor: l.price || null, creado: l.created_at ? new Date(l.created_at * 1000).toISOString() : null,
      fuente: "otra", interes: l.name && c?.name && l.name !== c.name ? l.name : null,
    };
  });
}

// ---------- HighLevel ----------
async function leerGhl(f, { desde }) {
  const base = "https://services.leadconnectorhq.com";
  const h = { headers: { Authorization: `Bearer ${f.token}`, Version: "2021-07-28", Accept: "application/json" } };
  const etapas = {};
  try {
    const pl = await pedir(`${base}/opportunities/pipelines?locationId=${encodeURIComponent(f.cuenta)}`, h);
    for (const p of pl.pipelines || []) for (const s of p.stages || []) etapas[s.id] = s.name;
  } catch { /* sin nombres de etapa: se usa el estado */ }
  const lista = [];
  let page = 1;
  const corte = Date.parse(desde);
  for (; page <= 50; page++) {
    const d = await pedir(`${base}/opportunities/search?location_id=${encodeURIComponent(f.cuenta)}&status=all&limit=100&page=${page}&order=added_desc`, h);
    const o = d.opportunities || [];
    lista.push(...o);
    // Vienen de la más nueva a la más vieja: se para al pasar el corte (salvo que se hayan movido hace poco)
    if (o.length < 100 || !d.meta?.nextPage || o.every((x) => Date.parse(x.updatedAt || x.createdAt) < corte)) break;
  }
  const fuente = (s) => { const t = sinAcentos(s); return /facebook|meta|fb|instagram|ig/.test(t) ? "anuncios" : /whats/.test(t) ? "whatsapp" : /google/.test(t) ? "google" : /web|form|landing/.test(t) ? "web" : /refer|recomend/.test(t) ? "referido" : "otra"; };
  return lista.filter((o) => Date.parse(o.updatedAt || o.createdAt) >= corte).map((o) => ({
    id: `ghl:${o.id}`, nombre: o.contact?.name || o.name, telefono: o.contact?.phone || null, correo: o.contact?.email || null,
    etapa: o.status === "won" ? "venta" : ["lost", "abandoned"].includes(o.status) ? "perdido" : etapaPorNombre(etapas[o.pipelineStageId]),
    etapa_original: etapas[o.pipelineStageId] || o.status || null, valor: o.monetaryValue || null, creado: o.createdAt || null,
    fuente: fuente(o.source), campana: o.source || null, interes: o.name && o.contact?.name && o.name !== o.contact.name ? o.name : null,
  }));
}

// ---------- Pancake ----------
const RANGO = { nuevo: 0, contactado: 1, cita: 2, asistio: 3, venta: 4 };
const masAvanzada = (a, b) => ((RANGO[b] ?? -1) > (RANGO[a] ?? -1) ? b : a);
const basePancake = (f) => `https://pages.fm/api/public_api/v1/pages/${encodeURIComponent(f.cuenta)}`;

async function leerPancake(f, { desde }) {
  const base = basePancake(f);
  const fin = Math.floor(Date.now() / 1000);
  // Pancake deja pedir de un mes a la vez
  const ini = Math.max(Math.floor(Date.parse(desde) / 1000), fin - 30 * 86400);
  // Etiquetas de la página (LEAD, PERFILAMIENTO, APROBADO, VENTA…): si las usan, dicen la etapa
  const etiquetas = new Map();
  try {
    const t = await pedir(`${base}/tags?page_access_token=${encodeURIComponent(f.token)}`);
    for (const x of t.tags || []) if (x) etiquetas.set(String(x.id), x.text || x.name || "");
  } catch { /* sin etiquetas no pasa nada */ }
  const lista = [];
  for (let page = 1; page <= 30; page++) {
    const d = await pedir(`${base}/conversations?page_access_token=${encodeURIComponent(f.token)}&page_id=${encodeURIComponent(f.cuenta)}&since=${ini}&until=${fin}&page_number=${page}&order_by=updated_at`);
    if (d.success === false) {
      if (/access_token|token/i.test(d.message || "")) throw new Error(`Pancake dice que esa llave no es de la página "${f.cuenta}". Revisa el id: en WhatsApp empieza con waba_ y no es el número de teléfono.`);
      throw new Error("Pancake: " + (d.message || "no respondió"));
    }
    const c = d.conversations || [];
    lista.push(...c);
    if (!c.length || (d.total && lista.length >= d.total)) break;
  }
  const red = (c) => { const t = String(c.id || c.customer_id || ""); return /^wa(ba)?_|whatsapp/i.test(t) ? "whatsapp" : /^ig(o)?_|^ig|instagram/i.test(t) || c.platform === "instagram" ? "instagram" : "facebook"; };
  const salida = [];
  for (const c of lista.filter((c) => (c.type || "INBOX") === "INBOX")) {
    const cu = c.customers?.[0] || {};
    let tel = (c.recent_phone_numbers || []).map((x) => x.phone_number || x).find((x) => typeof x === "string" && x) || null;
    // En WhatsApp el "id" de la persona es su número
    if (!tel && red(c) === "whatsapp") tel = [cu.fb_id, c.from?.phone, c.from?.id, c.page_customer?.phone_number].map((x) => String(x || "").replace(/\D/g, "")).find((x) => x.length >= 10 && x.length <= 15) || null;
    const nombresTags = (c.tags || []).filter((t) => t !== null && t !== undefined).map((t) => (typeof t === "object" ? t.text || t.name || etiquetas.get(String(t.id)) : etiquetas.get(String(t)))).filter(Boolean);
    // Si lo último lo mandó la clínica, ya le contestaron
    let etapa = c.last_sent_by?.id && c.from?.id && String(c.last_sent_by.id) !== String(c.from.id) ? "contactado" : "nuevo";
    for (const t of nombresTags) etapa = masAvanzada(etapa, etapaPorNombre(t));
    const adId = (c.ad_ids || [])[0] || null;
    salida.push({
      id: `pancake:${f.cuenta}:${c.id}`, conversacion: c.id, nombre: cu.name || c.from?.name || null, telefono: tel, correo: null,
      etapa, etapa_original: nombresTags.join(", ") || null, valor: null, creado: fechaPancake(c.inserted_at),
      actualizado: fechaPancake(c.updated_at), mensajes: Number(c.message_count) || 0,
      fuente: red(c), campana: adId ? (await meta.nombreAnuncio(adId)) || `Anuncio ${adId}` : null,
      solo_nuevos: true, // en Pancake no hay etapas fijas: solo se avanza, nunca se regresa lo que tú muevas
    });
  }
  return salida;
}
const fechaPancake = (t) => (t ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : t + "Z").toISOString() : null);

/** Los últimos mensajes de una conversación de Pancake, como texto (Cliente / Negocio). */
async function chatPancake(f, conversacion, mensajes = 60) {
  const base = basePancake(f);
  let todos = [];
  for (let n = 0; n < mensajes; n += 30) {
    const d = await pedir(`${base}/conversations/${encodeURIComponent(conversacion)}/messages?page_access_token=${encodeURIComponent(f.token)}${n ? `&current_count=${n}` : ""}`);
    const m = d.messages || [];
    todos = [...m, ...todos];
    if (m.length < 30) break;
  }
  const limpio = (h) => String(h || "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
  const idPagina = f.cuenta;
  return todos.map((m) => {
    const quien = String(m.from?.id) === idPagina || String(m.from?.id) === String(m.page_id) ? "Negocio" : "Cliente";
    const texto = limpio(m.message) || (m.attachments?.length ? `[${m.attachments.map((a) => a.type || "archivo").join(", ")}]` : "");
    return texto ? `${String(m.inserted_at || "").slice(0, 16).replace("T", " ")} ${quien}: ${texto}` : null;
  }).filter(Boolean).join("\n");
}

const LECTORES = { kommo: leerKommo, ghl: leerGhl, pancake: leerPancake };

// ---------- Guardar en el CRM de DELTA ----------
function guardar(f, x) {
  if (!x.nombre && !x.telefono) return "vacio";
  let tel = null;
  try { tel = normalizarTelefono(x.telefono); } catch { /* raro: se omite */ }
  const ya = db.prepare("SELECT id, etapa, externo_etapa, campana FROM prospectos WHERE externo_id = ?").get(x.id);
  if (ya) {
    if (x.campana && x.campana !== ya.campana && (!ya.campana || /^Anuncio( \(clic a WhatsApp\)| \d+)?$/.test(ya.campana))) db.prepare("UPDATE prospectos SET campana = ? WHERE id = ?").run(x.campana.slice(0, 160), ya.id);
    // Solo se mueve si cambió allá (así no se pisa lo que tú cambies en DELTA)
    if (!x.solo_nuevos && x.etapa !== ya.externo_etapa) {
      const cambios = { etapa: x.etapa };
      if (x.etapa === "venta" && x.valor) cambios.valor = x.valor;
      actualizarProspecto(ya.id, cambios);
      db.prepare("UPDATE prospectos SET externo_etapa = ? WHERE id = ?").run(x.etapa, ya.id);
      return "movido";
    }
    if (x.actualizado) db.prepare("UPDATE prospectos SET externo_actualizado = ?, externo_mensajes = ? WHERE id = ?").run(x.actualizado, x.mensajes ?? null, ya.id);
    // Pancake: solo avanza (si allá ya le contestaron o lo etiquetaron más adelante), nunca regresa
    if (x.solo_nuevos && ya.etapa !== "perdido" && masAvanzada(ya.etapa, x.etapa) !== ya.etapa) {
      actualizarProspecto(ya.id, { etapa: x.etapa });
      db.prepare("UPDATE prospectos SET externo_etapa = ? WHERE id = ?").run(x.etapa, ya.id);
      return "movido";
    }
    return "igual";
  }
  const p = crearProspecto({
    cliente: f.cliente_id, nombre: x.nombre, telefono: tel, correo: x.correo, fuente: x.fuente, campana: x.campana || null, interes: x.interes || null,
    etapa: x.etapa, valor: x.etapa === "venta" ? x.valor : null,
    notas: [`Viene de ${TIPOS[f.tipo].nombre}${x.etapa_original ? ` (etapa: ${x.etapa_original})` : ""}`].join("\n"),
  }, { origen: f.tipo });
  if (p.ya_existia) {
    if (!obtenerProspecto(p.id).externo_id) db.prepare("UPDATE prospectos SET externo_id = ?, externo_etapa = ? WHERE id = ?").run(x.id, x.etapa, p.id);
    return "igual";
  }
  db.prepare("UPDATE prospectos SET externo_id = ?, externo_etapa = ?, creado = COALESCE(?, creado), etapa_desde = COALESCE(?, etapa_desde), externo_actualizado = ?, externo_mensajes = ? WHERE id = ?")
    .run(x.id, x.etapa, x.creado, x.creado, x.actualizado || null, x.mensajes ?? null, p.id);
  return "nuevo";
}

const vestir = ({ token, ...f }) => ({ ...f, nombre: TIPOS[f.tipo]?.nombre || f.tipo, token_final: token ? `…${token.slice(-4)}` : null, resultado: f.resultado ? JSON.parse(f.resultado) : null });
export function listarFuentes(cliente) {
  const c = cliente ? clienteRequerido(cliente) : null;
  return db.prepare(`SELECT * FROM crm_fuentes ${c ? "WHERE cliente_id = ?" : ""} ORDER BY id`).all(...(c ? [c.id] : [])).map(vestir);
}

/** Trae lo nuevo de una conexión. La primera vez, los últimos 90 días. */
export async function sincronizarFuente(id) {
  const f = db.prepare("SELECT * FROM crm_fuentes WHERE id = ?").get(Number(id));
  if (!f) throw new Error("Esa conexión ya no existe");
  // Pancake: si hay conversaciones de antes sin su número de mensajes (versión vieja), se repasa el mes completo
  const repasar = f.tipo === "pancake" && db.prepare("SELECT 1 FROM prospectos WHERE externo_id LIKE ? AND (externo_mensajes IS NULL OR campana = 'Anuncio (clic a WhatsApp)') LIMIT 1").get(`pancake:${f.cuenta}:%`);
  const desde = f.ultimo && !repasar ? new Date(Date.parse(f.ultimo) - DIA).toISOString() : new Date(Date.now() - 90 * DIA).toISOString();
  const inicio = new Date().toISOString();
  try {
    const lista = await LECTORES[f.tipo](f, { desde });
    const r = { revisados: lista.length, nuevos: 0, movidos: 0 };
    for (const x of lista) {
      const q = guardar(f, x);
      if (q === "nuevo") r.nuevos++;
      if (q === "movido") r.movidos++;
    }
    if (repasar) {
      db.prepare("UPDATE prospectos SET externo_mensajes = 0 WHERE externo_id LIKE ? AND externo_mensajes IS NULL").run(`pancake:${f.cuenta}:%`);
      db.prepare("UPDATE prospectos SET campana = 'Anuncio' WHERE externo_id LIKE ? AND campana = 'Anuncio (clic a WhatsApp)'").run(`pancake:${f.cuenta}:%`);
    }
    const previo = f.resultado ? JSON.parse(f.resultado) : {};
    if (previo.chats) r.chats = previo.chats;
    db.prepare("UPDATE crm_fuentes SET ultimo = ?, resultado = ?, error = NULL WHERE id = ?").run(inicio, JSON.stringify(r), f.id);
    if (r.nuevos || r.movidos) avisarPantalla({ tipo: "crm" });
    return { ...vestir({ ...f, ultimo: inicio, resultado: JSON.stringify(r), error: null }), ...r };
  } catch (e) {
    db.prepare("UPDATE crm_fuentes SET error = ? WHERE id = ?").run(String(e.message).slice(0, 300), f.id);
    throw new Error(`${TIPOS[f.tipo].nombre}: ${e.message}`);
  }
}

/** La llave de Pancake es un JWT cuyo contenido trae el id de la página ({ id, timestamp }). */
export function idDeLlavePancake(llave) {
  try {
    const parte = String(llave || "").split(".")[1];
    const d = JSON.parse(Buffer.from(parte.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    return typeof d.id === "string" && /^[\w.-]{2,80}$/.test(d.id) ? d.id : null;
  } catch { return null; }
}

/** Conecta (o cambia la llave de) un CRM externo para un cliente y trae sus prospectos. */
export async function conectarFuente({ cliente, tipo, cuenta, token } = {}) {
  const c = clienteRequerido(cliente);
  if (!TIPOS[tipo]) throw new Error("Elige Kommo, GoHighLevel o Pancake");
  let cu = String(cuenta || "").trim();
  let tk = String(token || "").trim();
  // Si se pegaron al revés (la llave en el id), se acomodan solos
  if (/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(cu) && tk.length < 60 && !/^eyJ/.test(tk)) [cu, tk] = [tk, cu];
  if (tipo === "pancake") {
    // Si pegaron la llave en cualquiera de los dos lados, se usa esa
    if (!/^eyJ/.test(tk) && /^eyJ/.test(cu)) tk = cu;
    // La llave de Pancake ya trae dentro el id de su página: no hace falta escribirlo
    const id = idDeLlavePancake(tk);
    cu = id || cu.replace(/^https?:\/\/[^/]+\//, "").replace(/[/?#].*$/, "");
  }
  if (tipo === "kommo") cu = cu.replace(/^https?:\/\//, "").replace(/\.kommo\.com.*$/i, "").replace(/\/.*$/, "").toLowerCase();
  if (!cu || !/^[\w.-]{2,80}$/.test(cu)) throw new Error(`Falta el dato: ${TIPOS[tipo].cuenta}`);
  if (tk.length < 10) throw new Error("Pega la llave completa");
  const ya = db.prepare("SELECT id FROM crm_fuentes WHERE cliente_id = ? AND tipo = ? AND cuenta = ?").get(c.id, tipo, cu);
  const id = ya ? (db.prepare("UPDATE crm_fuentes SET token = ?, error = NULL WHERE id = ?").run(tk, ya.id), ya.id)
    : db.prepare("INSERT INTO crm_fuentes (cliente_id, tipo, cuenta, token) VALUES (?,?,?,?)").run(c.id, tipo, cu, tk).lastInsertRowid;
  try {
    const r = await sincronizarFuente(id);
    if (tipo === "pancake" && process.env.ANTHROPIC_API_KEY) leerChatsEnFondo(id, { max: 80 });
    return r;
  } catch (e) {
    if (!ya) db.prepare("DELETE FROM crm_fuentes WHERE id = ?").run(id); // si la llave no sirve, no se queda guardada
    throw e;
  }
}

export function quitarFuente(id) {
  db.prepare("DELETE FROM crm_fuentes WHERE id = ?").run(Number(id));
  return { ok: true }; // los prospectos que ya llegaron se quedan
}

/** Cada hora: todas las conexiones. */
export async function sincronizarTodas() {
  let nuevos = 0;
  for (const f of db.prepare("SELECT f.id FROM crm_fuentes f JOIN clientes c ON c.id = f.cliente_id WHERE c.estado != 'terminado'").all()) {
    try { nuevos += (await sincronizarFuente(f.id)).nuevos; } catch (e) { console.error("[crm externos]", e.message); continue; }
    const tipo = db.prepare("SELECT tipo FROM crm_fuentes WHERE id = ?").get(f.id)?.tipo;
    if (tipo === "pancake" && process.env.ANTHROPIC_API_KEY) await leerChats(f.id, { max: 30 }).catch((e) => console.error("[crm chats]", e.message));
  }
  return { nuevos };
}

// ---------- DELTA lee los chats y acomoda el embudo ----------
let claude = null;
let chatsDePrueba = null, iaDePrueba = null;
export const _chatsDePrueba = (fn) => { chatsDePrueba = fn; };
export const _iaDePrueba = (fn) => { iaDePrueba = fn; };
const leyendo = new Map(); // fuente -> promesa

/** Lo que Claude entiende de un chat: etapa, qué quiere, valor y un resumen. */
async function entenderChat(cliente, prospecto, chat) {
  if (iaDePrueba) return iaDePrueba(prospecto, chat);
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Falta ANTHROPIC_API_KEY");
  claude ||= new Anthropic();
  const r = await claude.messages.create({
    model: process.env.DELTA_MODELO_CRM || "claude-haiku-5-5",
    max_tokens: 400,
    system: `Lees chats de WhatsApp/Messenger entre un negocio y un cliente para acomodarlo en el embudo de ventas del negocio "${cliente.nombre}"${cliente.industria ? ` (${cliente.industria})` : ""}.
Etapas: nuevo (solo preguntó o no ha contestado), contactado (ya platican, se le está perfilando, mandó o está juntando papeles/documentos, cotizó), cita (ya tiene cita/visita agendada o su crédito/trámite fue APROBADO y falta cerrar), asistio (ya fue a la sucursal/consulta), venta (compró, pagó, firmó, se le entregó; "ya es cliente"), perdido (dijo que no, no califica, rechazado por buró, desistió, compró en otro lado, no era comprador).
Responde SOLO un JSON: {"etapa":"…","interes":"qué busca en 2-6 palabras o null","valor":número en pesos de la venta si se menciona o null,"motivo":"por qué se perdió, corto, o null","resumen":"una frase de lo que pasó y qué sigue"}`,
    messages: [{ role: "user", content: `Cliente: ${prospecto.nombre}\n\nChat:\n${chat.slice(-9000)}` }],
  });
  const t = r.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const m = t.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

/** Lee con DELTA los chats de Pancake que cambiaron desde la última vez y mueve a cada quien a su etapa. */
export async function leerChats(fuenteId, { max = 40 } = {}) {
  const f = db.prepare("SELECT * FROM crm_fuentes WHERE id = ?").get(Number(fuenteId));
  if (!f) throw new Error("Esa conexión ya no existe");
  if (f.tipo !== "pancake") throw new Error("Por ahora DELTA lee los chats de Pancake");
  const cliente = db.prepare("SELECT * FROM clientes WHERE id = ?").get(f.cliente_id);
  const pendientes = db.prepare(`SELECT id, nombre, etapa, externo_id, valor, interes FROM prospectos
      WHERE externo_id LIKE ? AND etapa NOT IN ('venta') AND COALESCE(externo_mensajes, 0) >= 4
        AND (ia_revisado IS NULL OR externo_actualizado > ia_revisado)
      ORDER BY externo_actualizado DESC LIMIT ?`).all(`pancake:${f.cuenta}:%`, Number(max));
  const r = { leidos: 0, movidos: 0, ventas: 0, perdidos: 0, errores: 0 };
  for (const p of pendientes) {
    try {
      const conversacion = p.externo_id.split(":").slice(2).join(":");
      const chat = chatsDePrueba ? await chatsDePrueba(conversacion) : await chatPancake(f, conversacion);
      const ahora = new Date().toISOString();
      if (!chat) { db.prepare("UPDATE prospectos SET ia_revisado = ? WHERE id = ?").run(ahora, p.id); continue; }
      const x = await entenderChat(cliente, p, chat);
      r.leidos++;
      db.prepare("UPDATE prospectos SET ia_revisado = ? WHERE id = ?").run(ahora, p.id);
      if (!x || !["nuevo", "contactado", "cita", "asistio", "venta", "perdido"].includes(x.etapa)) continue;
      const cambios = {};
      if (x.interes && !p.interes) cambios.interes = String(x.interes);
      if (x.etapa === "venta" && Number(x.valor) > 0 && !p.valor) cambios.valor = Number(x.valor);
      // Solo avanza; "perdido" solo si no había llegado a venta
      if (x.etapa === "perdido" && p.etapa !== "perdido") { cambios.etapa = "perdido"; if (x.motivo) cambios.motivo_perdido = String(x.motivo); }
      else if (x.etapa !== "perdido" && masAvanzada(p.etapa === "perdido" ? "nuevo" : p.etapa, x.etapa) === x.etapa && x.etapa !== p.etapa) cambios.etapa = x.etapa;
      if (Object.keys(cambios).length) {
        actualizarProspecto(p.id, cambios);
        if (cambios.etapa) { r.movidos++; if (cambios.etapa === "venta") r.ventas++; if (cambios.etapa === "perdido") r.perdidos++; }
      }
      if (x.resumen) notaProspecto(p.id, `DELTA leyó el chat: ${String(x.resumen).slice(0, 400)}`);
    } catch (e) {
      r.errores++;
      console.error("[crm chats]", p.id, e.message);
      if (/ANTHROPIC_API_KEY|credit|billing|429|rate/i.test(e.message)) break;
    }
  }
  r.pendientes = Math.max(0, db.prepare(`SELECT COUNT(*) n FROM prospectos WHERE externo_id LIKE ? AND etapa NOT IN ('venta') AND COALESCE(externo_mensajes, 0) >= 4 AND (ia_revisado IS NULL OR externo_actualizado > ia_revisado)`).get(`pancake:${f.cuenta}:%`).n);
  db.prepare("UPDATE crm_fuentes SET resultado = json_set(COALESCE(resultado, '{}'), '$.chats', json(?)) WHERE id = ?").run(JSON.stringify({ ...r, fecha: new Date().toISOString() }), f.id);
  if (r.movidos) avisarPantalla({ tipo: "crm" });
  return r;
}

/** Igual, pero en segundo plano (para el botón): regresa de inmediato. */
export function leerChatsEnFondo(fuenteId, opciones) {
  const k = Number(fuenteId);
  if (!leyendo.has(k)) leyendo.set(k, leerChats(k, opciones).catch((e) => console.error("[crm chats]", e.message)).finally(() => leyendo.delete(k)));
  return { leyendo: true };
}
