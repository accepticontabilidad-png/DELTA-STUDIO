// Traer prospectos de otros CRM donde ya viven los clientes: Kommo, HighLevel (GoHighLevel) y Pancake.
// SOLO LECTURA: DELTA nunca escribe, mueve ni manda nada en esos sistemas.
// Cada conexión es de un cliente; la llave se guarda en la base de DELTA y nunca regresa a la pantalla.
import { db } from "./db.js";
import { clienteRequerido } from "./agencia.js";
import { crearProspecto, actualizarProspecto, normalizarTelefono, obtenerProspecto } from "./crm.js";
import { avisarPantalla } from "./avisos.js";

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
for (const col of ["externo_id TEXT", "externo_etapa TEXT"]) {
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
  if (/(cita|agend|appoint|book|confirm)/.test(t)) return "cita";
  if (/(contact|seguim|respond|calific|negoci|cotiz|interesad|propuesta|follow)/.test(t)) return "contactado";
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
async function leerPancake(f, { desde }) {
  const base = `https://pages.fm/api/public_api/v1/pages/${encodeURIComponent(f.cuenta)}`;
  const fin = Math.floor(Date.now() / 1000);
  // Pancake deja pedir de un mes a la vez
  const ini = Math.max(Math.floor(Date.parse(desde) / 1000), fin - 30 * 86400);
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
  const fecha = (t) => (t ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : t + "Z").toISOString() : null);
  return lista.filter((c) => (c.type || "INBOX") === "INBOX").map((c) => {
    const cu = c.customers?.[0] || {};
    let tel = (c.recent_phone_numbers || []).map((x) => x.phone_number || x).find((x) => typeof x === "string" && x) || null;
    // En WhatsApp el "id" de la persona es su número
    if (!tel && red(c) === "whatsapp") tel = [cu.fb_id, c.from?.phone, c.from?.id, c.page_customer?.phone_number].map((x) => String(x || "").replace(/\D/g, "")).find((x) => x.length >= 10 && x.length <= 15) || null;
    return {
      id: `pancake:${f.cuenta}:${c.id}`, nombre: cu.name || c.from?.name || null, telefono: tel, correo: null,
      // Si lo último lo mandó la clínica, ya le contestaron
      etapa: c.last_sent_by?.id && c.from?.id && String(c.last_sent_by.id) !== String(c.from.id) ? "contactado" : "nuevo",
      etapa_original: null, valor: null, creado: fecha(c.inserted_at),
      fuente: red(c), campana: c.ad_ids?.length ? "Anuncio (clic a WhatsApp)" : null,
      solo_nuevos: true, // en Pancake no hay etapas: no se pisa lo que tú muevas
    };
  });
}

const LECTORES = { kommo: leerKommo, ghl: leerGhl, pancake: leerPancake };

// ---------- Guardar en el CRM de DELTA ----------
function guardar(f, x) {
  if (!x.nombre && !x.telefono) return "vacio";
  let tel = null;
  try { tel = normalizarTelefono(x.telefono); } catch { /* raro: se omite */ }
  const ya = db.prepare("SELECT id, etapa, externo_etapa FROM prospectos WHERE externo_id = ?").get(x.id);
  if (ya) {
    // Solo se mueve si cambió allá (así no se pisa lo que tú cambies en DELTA)
    if (!x.solo_nuevos && x.etapa !== ya.externo_etapa) {
      const cambios = { etapa: x.etapa };
      if (x.etapa === "venta" && x.valor) cambios.valor = x.valor;
      actualizarProspecto(ya.id, cambios);
      db.prepare("UPDATE prospectos SET externo_etapa = ? WHERE id = ?").run(x.etapa, ya.id);
      return "movido";
    }
    // Pancake: si allá ya le contestaron y aquí sigue como nuevo, pasa a contactado
    if (x.solo_nuevos && x.etapa === "contactado" && ya.etapa === "nuevo") {
      actualizarProspecto(ya.id, { etapa: "contactado" });
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
  db.prepare("UPDATE prospectos SET externo_id = ?, externo_etapa = ?, creado = COALESCE(?, creado), etapa_desde = COALESCE(?, etapa_desde) WHERE id = ?")
    .run(x.id, x.etapa, x.creado, x.creado, p.id);
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
  const desde = f.ultimo ? new Date(Date.parse(f.ultimo) - DIA).toISOString() : new Date(Date.now() - 90 * DIA).toISOString();
  const inicio = new Date().toISOString();
  try {
    const lista = await LECTORES[f.tipo](f, { desde });
    const r = { revisados: lista.length, nuevos: 0, movidos: 0 };
    for (const x of lista) {
      const q = guardar(f, x);
      if (q === "nuevo") r.nuevos++;
      if (q === "movido") r.movidos++;
    }
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
  try { return await sincronizarFuente(id); }
  catch (e) {
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
    try { nuevos += (await sincronizarFuente(f.id)).nuevos; } catch (e) { console.error("[crm externos]", e.message); }
  }
  return { nuevos };
}
