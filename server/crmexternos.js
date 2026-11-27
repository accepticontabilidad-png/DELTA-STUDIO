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
for (const col of ["externo_id TEXT", "externo_etapa TEXT", "externo_actualizado TEXT", "externo_mensajes INTEGER", "ia_revisado TEXT", "externo_etiquetas TEXT"]) {
  try { db.exec(`ALTER TABLE prospectos ADD COLUMN ${col}`); } catch { /* ya existe */ }
}
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_prospectos_externo ON prospectos(externo_id)");
// venta_etiqueta = 1: en esta página la etiqueta VENTA de Pancake SÍ quiere decir que compró (así trabaja, p. ej., el Dr. Héctor).
// historia = 1: ya se trajeron completos los últimos 90 días (antes solo se traían 30 y faltaban conversaciones del mes).
for (const col of ["venta_etiqueta INTEGER", "historia INTEGER"]) { try { db.exec(`ALTER TABLE crm_fuentes ADD COLUMN ${col}`); } catch { /* ya existe */ } }

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
  // Palabras completas: "página", "comprobante", "pregunta por pago" o "tratamiento facial" NO son venta.
  if (/\b(ganad[oa]s?|vendid[oa]s?|venta|vend[ie]|cerrad[oa]|pagad[oa]|ya pago|compro|won)\b|paciente activ|cliente activ|en tratamiento|inicio (su )?tratamiento/.test(t)) return "venta";
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
  // Pancake deja pedir de un mes a la vez: se pide en tramos de 30 días hasta cubrir todo el rango
  // (antes solo se pedían los últimos 30 y se perdían las conversaciones de principios de mes).
  const ini = Math.max(Math.floor(Date.parse(desde) / 1000), fin - 92 * 86400);
  const tramos = [];
  for (let a = fin; a > ini; a -= 30 * 86400) tramos.push([Math.max(ini, a - 30 * 86400), a]);
  // Etiquetas de la página (LEAD, PERFILAMIENTO, APROBADO, VENTA…): si las usan, dicen la etapa
  const etiquetas = new Map();
  try {
    const t = await pedir(`${base}/tags?page_access_token=${encodeURIComponent(f.token)}`);
    for (const x of t.tags || []) if (x) etiquetas.set(String(x.id), x.text || x.name || "");
  } catch { /* sin etiquetas no pasa nada */ }
  const vistas = new Map();
  for (const [desdeT, hastaT] of tramos) {
    let enTramo = 0;
    for (let page = 1; page <= 60; page++) {
      const d = await pedir(`${base}/conversations?page_access_token=${encodeURIComponent(f.token)}&page_id=${encodeURIComponent(f.cuenta)}&since=${desdeT}&until=${hastaT}&page_number=${page}&order_by=updated_at`);
      if (d.success === false) {
        if (/access_token|token/i.test(d.message || "")) throw new Error(`Pancake dice que esa llave no es de la página "${f.cuenta}". Revisa el id: en WhatsApp empieza con waba_ y no es el número de teléfono.`);
        throw new Error("Pancake: " + (d.message || "no respondió"));
      }
      const c = d.conversations || [];
      for (const x of c) if (!vistas.has(x.id)) vistas.set(x.id, x);
      enTramo += c.length;
      if (!c.length || (d.total && enTramo >= d.total)) break;
    }
  }
  const lista = [...vistas.values()];
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
    // La etiqueta de venta en Pancake se pone a cualquiera que ya es cliente (clientes de antes, recomendados, postventa),
    // así que sola NO hace venta: DELTA lee el chat y decide si compró, cuándo y si vino de redes.
    // Excepción: si el dueño dijo que en esta página la etiqueta VENTA sí es venta, cuenta tal cual (sin esperar a que DELTA lea el chat).
    const confiar = f.venta_etiqueta === 1;
    for (const t of nombresTags) { const e = etapaPorNombre(t); etapa = masAvanzada(etapa, e === "venta" && !confiar ? "contactado" : e); }
    const ventaPorEtiqueta = confiar && nombresTags.some((t) => etapaPorNombre(t) === "venta");
    const adId = (c.ad_ids || [])[0] || null;
    salida.push({
      id: `pancake:${f.cuenta}:${c.id}`, conversacion: c.id, nombre: cu.name || c.from?.name || null, telefono: tel, correo: null,
      etapa, etapa_original: nombresTags.join(", ") || null, valor: null, creado: fechaPancake(c.inserted_at),
      actualizado: fechaPancake(c.updated_at), mensajes: Number(c.message_count) || 0,
      fuente: red(c), campana: adId ? (await meta.nombreAnuncio(adId)) || `Anuncio ${adId}` : null,
      solo_nuevos: true, // en Pancake no hay etapas fijas: solo se avanza, nunca se regresa lo que tú muevas
      venta_etiqueta: confiar ? ventaPorEtiqueta : undefined,
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
  const ya = db.prepare("SELECT id, etapa, externo_etapa, campana FROM prospectos WHERE externo_id = ? AND cliente_id = ?").get(x.id, f.cliente_id);
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
    if (x.solo_nuevos) db.prepare("UPDATE prospectos SET externo_etiquetas = ? WHERE id = ?").run(x.etapa_original || null, ya.id);
    // Página donde la etiqueta VENTA manda: si allá le quitaron la etiqueta, aquí deja de contar como venta.
    if (x.venta_etiqueta === false && ya.etapa === "venta" && ya.externo_etapa === "venta") {
      actualizarProspecto(ya.id, { etapa: x.etapa === "venta" ? "contactado" : x.etapa });
      db.prepare("UPDATE prospectos SET externo_etapa = ? WHERE id = ?").run(x.etapa, ya.id);
      notaProspecto(ya.id, "DELTA quitó la venta: en Pancake ya no tiene la etiqueta VENTA.");
      return "movido";
    }
    // Pancake: solo avanza (si allá ya le contestaron o lo etiquetaron más adelante), nunca regresa
    if (x.solo_nuevos && (ya.etapa !== "perdido" || x.venta_etiqueta) && masAvanzada(ya.etapa === "perdido" ? "nuevo" : ya.etapa, x.etapa) !== (ya.etapa === "perdido" ? "nuevo" : ya.etapa)) {
      actualizarProspecto(ya.id, { etapa: x.etapa });
      db.prepare(`UPDATE prospectos SET externo_etapa = ?${x.venta_etiqueta ? ", venta_revisada = 1" : ""} WHERE id = ?`).run(x.etapa, ya.id);
      return "movido";
    }
    if (x.venta_etiqueta && ya.etapa === "venta" && ya.externo_etapa !== "venta") db.prepare("UPDATE prospectos SET externo_etapa = 'venta', venta_revisada = 1 WHERE id = ?").run(ya.id);
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
  db.prepare("UPDATE prospectos SET externo_id = ?, externo_etapa = ?, creado = COALESCE(?, creado), etapa_desde = COALESCE(?, etapa_desde), externo_actualizado = ?, externo_mensajes = ?, externo_etiquetas = ? WHERE id = ?")
    .run(x.id, x.etapa, x.creado, x.creado, x.actualizado || null, x.mensajes ?? null, x.solo_nuevos ? x.etapa_original || null : null, p.id);
  if (x.venta_etiqueta) db.prepare("UPDATE prospectos SET venta_revisada = 1 WHERE id = ?").run(p.id);
  return "nuevo";
}

const vestir = ({ token, historia, ...f }) => ({ ...f, venta_etiqueta: f.venta_etiqueta === 1, nombre: TIPOS[f.tipo]?.nombre || f.tipo, token_final: token ? `…${token.slice(-4)}` : null, resultado: f.resultado ? JSON.parse(f.resultado) : null });
export function listarFuentes(cliente) {
  const c = cliente ? clienteRequerido(cliente) : null;
  return db.prepare(`SELECT * FROM crm_fuentes ${c ? "WHERE cliente_id = ?" : ""} ORDER BY id`).all(...(c ? [c.id] : [])).map(vestir);
}

/** Trae lo nuevo de una conexión. La primera vez, los últimos 90 días. */
export async function sincronizarFuente(id) {
  const f = db.prepare("SELECT * FROM crm_fuentes WHERE id = ?").get(Number(id));
  if (!f) throw new Error("Esa conexión ya no existe");
  // La misma página no puede alimentar a dos clientes: se queda con el que la conectó primero.
  const dueno = duenoDeCuenta(f);
  if (dueno) {
    const msg = `Esta llave es de la página de ${dueno}, no de este cliente. Quita esta conexión y pega la llave de la página correcta.`;
    db.prepare("UPDATE crm_fuentes SET error = ? WHERE id = ?").run(msg, f.id);
    throw new Error(`${TIPOS[f.tipo].nombre}: ${msg}`);
  }
  // Pancake: si hay conversaciones de antes sin su número de mensajes (versión vieja), se repasa el mes completo
  const repasar = f.tipo === "pancake" && db.prepare("SELECT 1 FROM prospectos WHERE externo_id LIKE ? AND (externo_mensajes IS NULL OR campana = 'Anuncio (clic a WhatsApp)') LIMIT 1").get(`pancake:${f.cuenta}:%`);
  const completa = f.tipo === "pancake" && f.historia !== 1;
  const desde = f.ultimo && !repasar && !completa ? new Date(Date.parse(f.ultimo) - DIA).toISOString() : new Date(Date.now() - 90 * DIA).toISOString();
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
    if (completa) db.prepare("UPDATE crm_fuentes SET historia = 1 WHERE id = ?").run(f.id);
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

/** Si otro cliente ya tenía conectada esa misma cuenta (antes que esta conexión), regresa su nombre. */
function duenoDeCuenta(f) {
  return db.prepare("SELECT c.nombre FROM crm_fuentes x JOIN clientes c ON c.id = x.cliente_id WHERE x.tipo = ? AND x.cuenta = ? AND x.cliente_id != ? AND x.id < ? ORDER BY x.id LIMIT 1")
    .get(f.tipo, f.cuenta, f.cliente_id, f.id ?? Number.MAX_SAFE_INTEGER)?.nombre || null;
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
  const otro = duenoDeCuenta({ tipo, cuenta: cu, cliente_id: c.id });
  if (otro) throw new Error(`Esa llave es de la página de ${otro}, no de ${c.nombre}. Pega la llave de la página de ${c.nombre}.`);
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

/** Dice si en esta página de Pancake la etiqueta VENTA sí quiere decir que compró. Al prenderlo se aplica de inmediato
 *  a lo que ya está en el CRM y se vuelven a traer los últimos 90 días; al apagarlo, DELTA vuelve a revisar esas ventas leyendo el chat. */
export async function ventaPorEtiqueta(id, si) {
  const f = db.prepare("SELECT * FROM crm_fuentes WHERE id = ?").get(Number(id));
  if (!f) throw new Error("Esa conexión ya no existe");
  if (f.tipo !== "pancake") throw new Error("Esto solo aplica a Pancake");
  const valor = si ? 1 : 0;
  db.prepare("UPDATE crm_fuentes SET venta_etiqueta = ?, historia = CASE WHEN ? = 1 THEN NULL ELSE historia END WHERE id = ?").run(valor, valor, f.id);
  const filas = db.prepare("SELECT id, etapa, externo_etapa, externo_etiquetas FROM prospectos WHERE externo_id LIKE ? AND cliente_id = ?").all(`pancake:${f.cuenta}:%`, f.cliente_id);
  let cambiadas = 0;
  for (const p of filas) {
    const tieneVenta = String(p.externo_etiquetas || "").split(", ").some((t) => t && etapaPorNombre(t) === "venta");
    if (valor && tieneVenta && p.etapa !== "venta") {
      actualizarProspecto(p.id, { etapa: "venta" });
      db.prepare("UPDATE prospectos SET externo_etapa = 'venta', venta_revisada = 1 WHERE id = ?").run(p.id);
      cambiadas++;
    } else if (valor && tieneVenta) {
      db.prepare("UPDATE prospectos SET externo_etapa = 'venta', venta_revisada = 1 WHERE id = ?").run(p.id);
    } else if (!valor && p.etapa === "venta" && p.externo_etapa === "venta") {
      db.prepare("UPDATE prospectos SET venta_revisada = NULL WHERE id = ?").run(p.id); // DELTA la vuelve a revisar leyendo el chat
    }
  }
  if (cambiadas) avisarPantalla({ tipo: "crm" });
  let r = null;
  if (valor) { try { r = await sincronizarFuente(f.id); } catch (e) { r = { error: e.message }; } }
  return { ...vestir(db.prepare("SELECT * FROM crm_fuentes WHERE id = ?").get(f.id)), cambiadas, sincronizado: r };
}

/** Prospectos de Pancake que quedaron en el cliente equivocado (por ejemplo, si un cliente tuvo un rato la llave de otro):
 *  se regresan al cliente dueño de esa página. */
export function acomodarProspectosDeOtraPagina() {
  const fuentes = db.prepare("SELECT cuenta, cliente_id FROM crm_fuentes WHERE tipo = 'pancake' ORDER BY id").all();
  const dueno = new Map();
  for (const f of fuentes) if (!dueno.has(f.cuenta)) dueno.set(f.cuenta, f.cliente_id);
  let movidos = 0;
  for (const [cuenta, cliente] of dueno) {
    movidos += db.prepare("UPDATE prospectos SET cliente_id = ? WHERE externo_id LIKE ? AND cliente_id != ?").run(cliente, `pancake:${cuenta}:%`, cliente).changes;
  }
  return movidos;
}
try { const n = acomodarProspectosDeOtraPagina(); if (n) console.log(`[crm] ${n} prospectos regresados a su cliente`); } catch (e) { console.error("[crm acomodar]", e.message); }

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
    max_tokens: 2000,
    system: `Lees chats de WhatsApp/Messenger entre un negocio y un cliente para acomodarlo en el embudo de ventas del negocio "${cliente.nombre}"${cliente.industria ? ` (${cliente.industria})` : ""}. Cada línea del chat empieza con su fecha.
Etapas: nuevo (solo preguntó o no ha contestado), contactado (ya platican, se le está perfilando, mandó o está juntando papeles/documentos, cotizó), cita (ya tiene cita/visita agendada o su crédito/trámite fue APROBADO y falta cerrar), asistio (ya fue a la sucursal/consulta), venta (SOLO si en ESTE chat se ve que compró, pagó, firmó o se le entregó. Preguntar precios, recibir cotización, decir "me interesa" o "lo pienso" NO es venta; si dudas, NO es venta), perdido (dijo que no, no califica, rechazado por buró, desistió, compró en otro lado, no era comprador).
Origen (de dónde salió esta persona): anuncio (llegó por un anuncio: menciona la publicidad o el primer mensaje es el automático de un anuncio), redes (llegó por Facebook, Instagram o WhatsApp sin decir que por recomendación), recomendado (dice que lo recomendó alguien o es familiar/amigo de un cliente), cliente (YA era cliente antes de este chat: escribe por servicio, seguimiento, garantía, pagos de algo que ya compró, o una segunda compra de alguien que ya compró), otro (no se sabe). Si no hay señal clara de recomendación o de que ya era cliente, usa redes.
Sé estricto: si ya era cliente y escribe por servicio o postventa, NO es una venta nueva (etapa según lo que pasa ahora, normalmente contactado) y origen "cliente".
fecha_venta: el día (AAAA-MM-DD) en que se ve que compró o pagó, sacado de las fechas del chat; null si no es venta.
Responde SOLO un JSON: {"etapa":"…","origen":"…","fecha_venta":"AAAA-MM-DD o null","interes":"qué busca en 2-6 palabras o null","valor":número en pesos de la venta si se menciona o null,"motivo":"por qué se perdió, corto, o null","resumen":"una frase corta (máximo 30 palabras) de lo que pasó y qué sigue"}`,
    messages: [{ role: "user", content: `Cliente: ${prospecto.nombre}${prospecto.externo_etiquetas ? `\nEtiquetas que le pusieron en Pancake (la de VENTA se pone a cualquiera que ya es cliente, no la tomes como prueba): ${prospecto.externo_etiquetas}` : ""}${prospecto.campana ? `\nLlegó por el anuncio: ${prospecto.campana}` : ""}\n\nChat:\n${chat.slice(-9000)}` }],
  });
  const t = r.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return leerRespuestaIA(t);
}

/** Saca el JSON de la respuesta de la IA aunque venga con texto alrededor, cortada o con la etapa con acentos/mayúsculas. */
export function leerRespuestaIA(t) {
  const txt = String(t || "").replace(/```(json)?/g, "");
  const ini = txt.indexOf("{");
  let x = null;
  if (ini >= 0) {
    const fin = txt.lastIndexOf("}");
    for (const intento of [txt.slice(ini, fin + 1), txt.slice(ini) + '"}', txt.slice(ini) + "}"]) {
      try { x = JSON.parse(intento); break; } catch { /* sigue */ }
    }
  }
  if (!x) {
    // Último recurso: campo por campo
    const campo = (k) => { const m = new RegExp(`"${k}"\\s*:\\s*("([^"]*)"|[\\d.]+|null)`).exec(txt); return m ? (m[2] ?? (m[1] === "null" ? null : Number(m[1]))) : undefined; };
    const etapa = campo("etapa");
    if (!etapa) return { _crudo: txt.slice(0, 300) };
    x = { etapa, origen: campo("origen"), fecha_venta: campo("fecha_venta"), valor: campo("valor"), interes: campo("interes"), motivo: campo("motivo"), resumen: campo("resumen") };
  }
  const n = (v) => String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const e = n(x.etapa).replace(/\s+/g, "_");
  x.etapa = { cita_agendada: "cita", asistio_a_la_cita: "asistio", vendido: "venta", compro: "venta", perdida: "perdido" }[e] || e;
  if (x.origen) x.origen = n(x.origen).replace("anuncios", "anuncio").replace("recomendacion", "recomendado");
  if (x.fecha_venta) { const f = String(x.fecha_venta).match(/\d{4}-\d{2}-\d{2}/); x.fecha_venta = f ? f[0] : null; }
  return x;
}

const PENDIENTE = `(etapa = 'venta' AND venta_revisada IS NULL) OR (etapa != 'venta' AND COALESCE(externo_mensajes, 0) >= 4 AND (ia_revisado IS NULL OR externo_actualizado > ia_revisado))`;

/** Lee con DELTA los chats de Pancake que cambiaron desde la última vez y mueve a cada quien a su etapa. */
export async function leerChats(fuenteId, { max = 40 } = {}) {
  const f = db.prepare("SELECT * FROM crm_fuentes WHERE id = ?").get(Number(fuenteId));
  if (!f) throw new Error("Esa conexión ya no existe");
  if (f.tipo !== "pancake") throw new Error("Por ahora DELTA lee los chats de Pancake");
  const dueno = duenoDeCuenta(f);
  if (dueno) throw new Error(`Esta llave es de la página de ${dueno}, no de este cliente`);
  const cliente = db.prepare("SELECT * FROM clientes WHERE id = ?").get(f.cliente_id);
  // Primero las ventas que nadie ha confirmado (las que salieron de la etiqueta), luego los chats que cambiaron.
  const pendientes = db.prepare(`SELECT id, nombre, etapa, externo_id, valor, interes, origen, campana, externo_etiquetas FROM prospectos
      WHERE externo_id LIKE ? AND cliente_id = ? AND (${PENDIENTE})
      ORDER BY (etapa = 'venta') DESC, externo_actualizado DESC LIMIT ?`).all(`pancake:${f.cuenta}:%`, f.cliente_id, Number(max));
  const r = { leidos: 0, movidos: 0, ventas: 0, perdidos: 0, errores: 0 };
  for (const p of pendientes) {
    try {
      const conversacion = p.externo_id.split(":").slice(2).join(":");
      const chat = chatsDePrueba ? await chatsDePrueba(conversacion) : await chatPancake(f, conversacion);
      const ahora = new Date().toISOString();
      if (!chat) { db.prepare("UPDATE prospectos SET ia_revisado = ?, venta_revisada = CASE WHEN etapa = 'venta' THEN 0 ELSE venta_revisada END WHERE id = ?").run(ahora, p.id); continue; }
      const x = await entenderChat(cliente, p, chat);
      r.leidos++;
      db.prepare("UPDATE prospectos SET ia_revisado = ? WHERE id = ?").run(ahora, p.id);
      if (!x || !["nuevo", "contactado", "cita", "asistio", "venta", "perdido"].includes(x.etapa)) {
        r.sin_entender = (r.sin_entender || 0) + 1;
        r.ejemplo = String(x?._crudo || JSON.stringify(x) || "").slice(0, 300);
        console.error("[crm chats] no entendí la respuesta", p.id, r.ejemplo);
        continue;
      }
      const cambios = {};
      const origen = ["anuncio", "redes", "recomendado", "cliente", "otro"].includes(x.origen) ? x.origen : null;
      const fechaVenta = /^\d{4}-\d{2}-\d{2}$/.test(String(x.fecha_venta || "")) ? x.fecha_venta : null;
      if (origen && origen !== p.origen) cambios.origen = origen;
      if (f.venta_etiqueta === 1) {
        // Aquí la etiqueta VENTA de Pancake es la que manda: leer el chat no pone ni quita ventas.
        if (p.etapa === "venta") {
          db.prepare("UPDATE prospectos SET venta_revisada = 1 WHERE id = ?").run(p.id);
          continue;
        }
        if (x.etapa === "venta") x.etapa = p.etapa; // dice que compró pero no tiene la etiqueta: se queda donde está
        if (x.etapa === p.etapa) { if (x.interes && !p.interes) actualizarProspecto(p.id, { interes: String(x.interes) }, { automatico: true }); if (x.resumen) notaProspecto(p.id, `DELTA leyó el chat: ${String(x.resumen).slice(0, 400)}`); continue; }
      }
      if (p.etapa === "venta") {
        // Revisión de una venta sin confirmar: si el chat no muestra compra, deja de contar como venta.
        if (x.etapa !== "venta") {
          actualizarProspecto(p.id, { ...cambios, etapa: x.etapa, ...(x.etapa === "perdido" && x.motivo ? { motivo_perdido: String(x.motivo) } : {}) }, { automatico: true });
          db.prepare("UPDATE prospectos SET venta_revisada = 1 WHERE id = ?").run(p.id);
          notaProspecto(p.id, `DELTA quitó la venta: en el chat no se ve que haya comprado${origen === "cliente" ? " (ya era cliente y escribió por otra cosa)" : ""}. ${String(x.resumen || "").slice(0, 300)}`);
          r.movidos++; r.quitadas = (r.quitadas || 0) + 1;
          continue;
        }
        if (fechaVenta) cambios.venta_fecha = fechaVenta;
        if (Number(x.valor) > 0 && !p.valor) cambios.valor = Number(x.valor);
        actualizarProspecto(p.id, cambios, { automatico: true });
        db.prepare("UPDATE prospectos SET venta_revisada = 1 WHERE id = ?").run(p.id);
        if (x.resumen) notaProspecto(p.id, `DELTA confirmó la venta${fechaVenta ? ` (${fechaVenta})` : ""}: ${String(x.resumen).slice(0, 300)}`);
        r.confirmadas = (r.confirmadas || 0) + 1;
        continue;
      }
      if (x.etapa === "venta" && fechaVenta) cambios.venta_fecha = fechaVenta;
      if (x.interes && !p.interes) cambios.interes = String(x.interes);
      if (x.etapa === "venta" && Number(x.valor) > 0 && !p.valor) cambios.valor = Number(x.valor);
      // Solo avanza; "perdido" solo si no había llegado a venta
      if (x.etapa === "perdido" && p.etapa !== "perdido") { cambios.etapa = "perdido"; if (x.motivo) cambios.motivo_perdido = String(x.motivo); }
      else if (x.etapa !== "perdido" && masAvanzada(p.etapa === "perdido" ? "nuevo" : p.etapa, x.etapa) === x.etapa && x.etapa !== p.etapa) cambios.etapa = x.etapa;
      if (Object.keys(cambios).length) {
        actualizarProspecto(p.id, cambios, { automatico: true });
        if (cambios.etapa === "venta") db.prepare("UPDATE prospectos SET venta_revisada = 1 WHERE id = ?").run(p.id);
        if (cambios.etapa) { r.movidos++; if (cambios.etapa === "venta") r.ventas++; if (cambios.etapa === "perdido") r.perdidos++; }
      }
      if (x.resumen) notaProspecto(p.id, `DELTA leyó el chat: ${String(x.resumen).slice(0, 400)}`);
    } catch (e) {
      r.errores++;
      console.error("[crm chats]", p.id, e.message);
      if (/ANTHROPIC_API_KEY|credit|billing|429|rate/i.test(e.message)) break;
    }
  }
  r.pendientes = Math.max(0, db.prepare(`SELECT COUNT(*) n FROM prospectos WHERE externo_id LIKE ? AND cliente_id = ? AND (${PENDIENTE})`).get(`pancake:${f.cuenta}:%`, f.cliente_id).n);
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

// ---------- Arreglo: ventas que salieron solo de una etiqueta de Pancake mal leída ----------
// Antes, etiquetas como "Tratamiento facial", "Página" o "Comprobante" contaban como venta. Se vuelven a revisar
// con la regla nueva; las que ya no son venta regresan a su etapa y DELTA vuelve a leer su chat para decidir.
export function revisarVentasPorEtiqueta() {
  const confiables = new Set(db.prepare("SELECT cuenta FROM crm_fuentes WHERE tipo = 'pancake' AND venta_etiqueta = 1").all().map((r) => r.cuenta));
  const filas = db.prepare("SELECT id, notas, externo_id FROM prospectos WHERE externo_id LIKE 'pancake:%' AND etapa = 'venta' AND externo_etapa = 'venta'").all()
    .filter((f) => !confiables.has(f.externo_id.split(":")[1]));
  let corregidas = 0;
  for (const f of filas) {
    const m = /\(etapa: ([^)\n]*)\)/.exec(f.notas || "");
    const tags = m ? m[1].split(", ").filter(Boolean) : [];
    let e = "contactado";
    for (const t of tags) e = masAvanzada(e, etapaPorNombre(t));
    if (e === "venta") continue;
    actualizarProspecto(f.id, { etapa: e });
    db.prepare("UPDATE prospectos SET externo_etapa = ?, ia_revisado = NULL WHERE id = ?").run(e, f.id);
    notaProspecto(f.id, `DELTA quitó la venta: la etiqueta de Pancake${tags.length ? ` "${tags.join(", ")}"` : ""} no quiere decir que compró. Vuelvo a leer su chat para confirmarlo.`);
    corregidas++;
  }
  return corregidas;
}
try { const n = revisarVentasPorEtiqueta(); if (n) console.log(`[crm] ${n} ventas por etiqueta corregidas`); } catch (e) { console.error("[crm ventas]", e.message); }
