// CRM de prospectos de los clientes y su embudo: prospecto → contactado → cita → asistió → venta.
//
// Cada prospecto es una persona interesada en el servicio de un cliente (un paciente potencial de la clínica).
// Llegan de cuatro formas:
//  - A mano o de viva voz con DELTA ("entró un prospecto para Kardia: Laura, 33 1234 5678, por anuncios").
//  - Por el formulario público de cada cliente (/p/<token>), que se pone en su Instagram o su sitio.
//  - Por WhatsApp, si el número del cliente está conectado a la API de WhatsApp (Cloud API de Meta).
//  - (Más adelante) de los formularios de anuncios de Meta.
// DELTA NUNCA manda mensajes sola: prepara borradores y el dueño los envía con un toque
// (por la API si el número está conectado, o abriendo WhatsApp con el texto ya escrito).
import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { clienteRequerido, obtenerCliente, gastoDelMes } from "./agencia.js";
import { ahoraLocalISO, localAUTC, utcALocal, zonaHoraria } from "./tiempo.js";
import { avisar, avisarPantalla } from "./avisos.js";
import { db, getAjuste, setAjuste } from "./db.js";
import * as meta from "./meta.js";

export const ETAPAS = [
  { clave: "nuevo", nombre: "Nuevo" },
  { clave: "contactado", nombre: "Contactado" },
  { clave: "cita", nombre: "Cita agendada" },
  { clave: "asistio", nombre: "Asistió" },
  { clave: "venta", nombre: "Venta" },
  { clave: "perdido", nombre: "Perdido" },
];
const RANGO = { nuevo: 0, contactado: 1, cita: 2, asistio: 3, venta: 4 };
const CLAVES = ETAPAS.map((e) => e.clave);
export const FUENTES = { anuncios: "Anuncios", whatsapp: "WhatsApp", instagram: "Instagram", facebook: "Facebook", google: "Google", web: "Sitio / formulario", referido: "Recomendación", llamada: "Llamada", otra: "Otra" };
const SINONIMOS = {
  nuevo: "nuevo", nueva: "nuevo", prospecto: "nuevo", lead: "nuevo",
  contactado: "contactado", contactada: "contactado", "en contacto": "contactado", respondido: "contactado", respondida: "contactado",
  cita: "cita", "cita agendada": "cita", agendado: "cita", agendada: "cita", "con cita": "cita", "agendó": "cita", agendo: "cita",
  asistio: "asistio", "asistió": "asistio", vino: "asistio", "fue a la cita": "asistio", consulta: "asistio",
  venta: "venta", vendido: "venta", vendida: "venta", cerrado: "venta", cerrada: "venta", paciente: "venta", compro: "venta", "compró": "venta", "pagó": "venta", pago: "venta",
  perdido: "perdido", perdida: "perdido", "no le interesa": "perdido", descartado: "perdido", descartada: "perdido", "no contesta": "perdido",
};
export const HORAS_SIN_RESPUESTA = 24;
const DIA = 864e5;
const VENTANA_WA = 24 * 3600e3;

db.exec(`
CREATE TABLE IF NOT EXISTS prospectos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  nombre TEXT NOT NULL,
  telefono TEXT,                                 -- solo dígitos, con lada de país (52…)
  correo TEXT,
  fuente TEXT NOT NULL DEFAULT 'otra',
  campana TEXT,                                  -- de qué anuncio o campaña vino, si se sabe
  interes TEXT,                                  -- qué servicio le interesa
  etapa TEXT NOT NULL DEFAULT 'nuevo',
  alcanzo INTEGER NOT NULL DEFAULT 0,            -- etapa más avanzada a la que llegó (para el embudo)
  valor REAL,                                    -- cuánto compró (si hubo venta)
  cita TEXT,                                     -- AAAA-MM-DDTHH:MM hora local
  motivo_perdido TEXT,
  notas TEXT,
  responsable TEXT,                              -- quién lo atiende (más adelante: usuario del equipo)
  creado TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  etapa_desde TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  primer_contacto TEXT,                          -- cuándo se le respondió por primera vez
  ultimo_entrante TEXT,                          -- su último mensaje de WhatsApp (ventana de 24 h)
  actualizado TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_prospectos_cliente ON prospectos(cliente_id, etapa);
CREATE INDEX IF NOT EXISTS idx_prospectos_tel ON prospectos(telefono);
CREATE TABLE IF NOT EXISTS prospecto_eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prospecto_id INTEGER NOT NULL REFERENCES prospectos(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,                            -- nota | etapa | entrante | saliente | borrador
  texto TEXT,
  estado TEXT,                                   -- borrador: pendiente | enviado | descartado
  wa_id TEXT,                                    -- id del mensaje de WhatsApp
  fecha TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_eventos_prospecto ON prospecto_eventos(prospecto_id);
CREATE TABLE IF NOT EXISTS crm_config (
  cliente_id INTEGER PRIMARY KEY REFERENCES clientes(id),
  wa_phone_id TEXT,                              -- id del número de WhatsApp del cliente en la Cloud API
  wa_numero TEXT,                                -- el número, para mostrarlo
  form_token TEXT UNIQUE,                        -- formulario público /p/<token>
  bienvenida TEXT                                -- texto del formulario
);
`);
// De dónde salió y cuándo se cerró cada venta (para contar las ventas de redes del mes en que se cerraron).
for (const col of ["venta_fecha TEXT", "origen TEXT", "venta_revisada INTEGER"]) { try { db.exec(`ALTER TABLE prospectos ADD COLUMN ${col}`); } catch { /* ya existe */ } }
export const ORIGENES = { anuncio: "Anuncio", redes: "Redes sociales", recomendado: "Recomendación", cliente: "Ya era cliente", otro: "Otro" };
const REDES = new Set(["anuncios", "instagram", "facebook", "whatsapp"]);
/** ¿Esta venta cuenta como venta de redes/anuncios? Si DELTA o el dueño ya dijeron de dónde salió, manda eso. */
export function esDeRedes(p) {
  // Solo la recomendación o quien ya era cliente quedan fuera; "otro" en un chat de redes sigue siendo de redes.
  if (p.origen === "anuncio" || p.origen === "redes") return true;
  if (p.origen === "recomendado" || p.origen === "cliente") return false;
  return !!p.campana || REDES.has(p.fuente);
}
function origenValido(x) {
  if (x === null || x === "") return null;
  const t = String(x).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  if (ORIGENES[t]) return t;
  if (/anunc|publicidad|campa|\bad/.test(t)) return "anuncio";
  if (/redes|instagram|facebook|whats|social|tiktok/.test(t)) return "redes";
  if (/recomend|referid|conocid|amig/.test(t)) return "recomendado";
  if (/cliente|ya compr|anterior|postventa|servicio/.test(t)) return "cliente";
  if (/otro|directo|llam|visit/.test(t)) return "otro";
  throw new Error(`Origen no válido: ${x}. Usa anuncio, redes, recomendado, cliente u otro`);
}
// Ventas que ya no están en "venta" (se corrigieron a mano antes de este arreglo) dejan de contar como venta.
db.exec("UPDATE prospectos SET alcanzo = 3 WHERE alcanzo >= 4 AND etapa != 'venta'");
// Para la utilidad del cliente: cuánto vale una venta en promedio (si no se anotó el monto) y su margen (%).
for (const col of ["ticket REAL", "margen REAL"]) { try { db.exec(`ALTER TABLE crm_config ADD COLUMN ${col}`); } catch { /* ya existe */ } }
try {
  db.exec("ALTER TABLE prospectos ADD COLUMN meta_lead_id TEXT"); // formulario de anuncio de Meta del que vino
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_prospectos_meta ON prospectos(meta_lead_id)");
} catch {
  /* ya existe */
}

// ---------- Utilidades ----------
const ahoraISO = () => new Date().toISOString();
const MES = /^\d{4}-\d{2}$/;

/** Teléfono a solo dígitos con lada de país: "33 1234 5678" → "523312345678". */
export function normalizarTelefono(t) {
  if (t === undefined || t === null || t === "") return null;
  let d = String(t).replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10) d = "52" + d; // número mexicano sin lada de país
  if (d.length === 13 && d.startsWith("521")) d = "52" + d.slice(3); // formato viejo de celular MX
  if (d.length < 10 || d.length > 15) throw new Error(`"${t}" no parece un teléfono`);
  return d;
}
export const telefonoBonito = (d) => {
  if (!d) return null;
  const m = String(d).match(/^52(\d{2})(\d{4})(\d{4})$/);
  return m ? `${m[1]} ${m[2]} ${m[3]}` : "+" + d;
};

export function etapaValida(x) {
  const t = String(x ?? "").trim().toLowerCase();
  const e = SINONIMOS[t] || (CLAVES.includes(t) ? t : null);
  if (!e) throw new Error(`Etapa no válida. Usa: ${ETAPAS.map((x) => x.nombre.toLowerCase()).join(", ")}`);
  return e;
}
function fuenteValida(x) {
  if (!x) return "otra";
  const t = String(x).trim().toLowerCase();
  if (FUENTES[t]) return t;
  if (/anuncio|meta ads|facebook ads|campa/.test(t)) return "anuncios";
  if (/whats/.test(t)) return "whatsapp";
  if (/insta|ig\b/.test(t)) return "instagram";
  if (/face|fb\b/.test(t)) return "facebook";
  if (/google|maps/.test(t)) return "google";
  if (/web|sitio|p[aá]gina|formulario/.test(t)) return "web";
  if (/recomend|referid|amig|conocid/.test(t)) return "referido";
  if (/llam|tel/.test(t)) return "llamada";
  return "otra";
}
function citaValida(x) {
  if (x === null || x === "") return null;
  const t = String(x).trim().replace(" ", "T").slice(0, 16);
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(t)) throw new Error("La cita debe ir como AAAA-MM-DD HH:MM");
  return t.length === 10 ? t + "T10:00" : t;
}
function numeroValido(x) {
  if (x === null || x === "" || x === undefined) return null;
  const n = Number(String(x).replace(/[$,\s]/g, ""));
  if (!isFinite(n) || n < 0) throw new Error("El valor debe ser un número");
  return Math.round(n * 100) / 100;
}

function vestir(p) {
  if (!p) return null;
  const horas = (Date.now() - Date.parse(p.creado)) / 3600e3;
  const sinResponder = p.etapa === "nuevo" && !p.primer_contacto;
  const hoy = ahoraLocalISO().slice(0, 10);
  const ventana = p.ultimo_entrante ? Date.parse(p.ultimo_entrante) + VENTANA_WA - Date.now() : null;
  return {
    ...p,
    etapa_nombre: ETAPAS.find((e) => e.clave === p.etapa)?.nombre || p.etapa,
    fuente_nombre: FUENTES[p.fuente] || p.fuente,
    telefono_bonito: telefonoBonito(p.telefono),
    horas_esperando: sinResponder ? Math.floor(horas) : null,
    sin_responder: sinResponder && horas >= HORAS_SIN_RESPUESTA,
    cita_hoy: p.etapa === "cita" && p.cita?.startsWith(hoy),
    cita_pasada: p.etapa === "cita" && p.cita && p.cita.slice(0, 10) < hoy,
    dias_en_etapa: Math.max(0, Math.floor((Date.now() - Date.parse(p.etapa_desde)) / DIA)),
    whatsapp_abierto: ventana !== null && ventana > 0,
  };
}

const SELECT = "SELECT p.*, c.nombre cliente FROM prospectos p JOIN clientes c ON c.id = p.cliente_id";
export const obtenerProspecto = (id) => vestir(db.prepare(`${SELECT} WHERE p.id = ?`).get(Number(id)));
function prospectoRequerido(id) {
  const p = obtenerProspecto(id);
  if (!p) throw new Error(`No existe el prospecto ${id}`);
  return p;
}
const evento = (pid, tipo, texto, extra = {}) =>
  db.prepare("INSERT INTO prospecto_eventos (prospecto_id, tipo, texto, estado, wa_id) VALUES (?,?,?,?,?)").run(pid, tipo, texto ? String(texto).slice(0, 4000) : null, extra.estado || null, extra.wa_id || null).lastInsertRowid;

// ---------- Crear y mover ----------
export function crearProspecto({ cliente, nombre, telefono, correo, fuente, campana, interes, notas, valor, cita, etapa, responsable } = {}, { origen = "manual" } = {}) {
  const c = clienteRequerido(cliente);
  const tel = normalizarTelefono(telefono);
  const n = String(nombre || "").trim().slice(0, 120) || (tel ? telefonoBonito(tel) : "");
  if (!n) throw new Error("Falta el nombre o el teléfono del prospecto");
  // Si ya existe (mismo teléfono con el mismo cliente) y sigue abierto, no se duplica.
  if (tel) {
    const ya = db.prepare("SELECT id FROM prospectos WHERE cliente_id = ? AND telefono = ? AND etapa NOT IN ('venta','perdido') ORDER BY id DESC LIMIT 1").get(c.id, tel);
    if (ya) {
      if (notas) evento(ya.id, "nota", notas);
      return { ...obtenerProspecto(ya.id), ya_existia: true };
    }
  }
  const e = etapa ? etapaValida(etapa) : "nuevo";
  const r = db.prepare(`INSERT INTO prospectos (cliente_id, nombre, telefono, correo, fuente, campana, interes, etapa, alcanzo, valor, cita, notas, primer_contacto, responsable)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    c.id, n, tel, correo ? String(correo).trim().slice(0, 160) : null, fuenteValida(fuente), campana ? String(campana).slice(0, 160) : null,
    interes ? String(interes).slice(0, 160) : null, e, RANGO[e] ?? 0, numeroValido(valor), cita ? citaValida(cita) : null,
    notas ? String(notas).slice(0, 2000) : null, e !== "nuevo" ? ahoraISO() : null, responsable ? String(responsable).trim().slice(0, 80) : null);
  const id = r.lastInsertRowid;
  evento(id, "etapa", origen === "formulario" ? "Llegó por el formulario" : origen === "meta" ? "Llenó un formulario de anuncio en Meta" : origen === "kommo" ? "Llegó desde Kommo" : origen === "ghl" ? "Llegó desde GoHighLevel" : origen === "pancake" ? "Llegó desde Pancake" : origen === "messenger" ? "Escribió por Messenger" : origen === "instagram" ? "Escribió por Instagram" : origen === "whatsapp" ? "Escribió por WhatsApp" : "Prospecto nuevo");
  avisarPantalla({ tipo: "crm" });
  return obtenerProspecto(id);
}

export function actualizarProspecto(id, cambios = {}, opciones = {}) {
  const p = prospectoRequerido(id);
  const sets = [], vals = [];
  const poner = (col, v) => { sets.push(`${col} = ?`); vals.push(v); };
  if (cambios.nombre !== undefined) { const t = String(cambios.nombre).trim(); if (!t) throw new Error("El nombre no puede quedar vacío"); poner("nombre", t.slice(0, 120)); }
  if (cambios.telefono !== undefined) poner("telefono", normalizarTelefono(cambios.telefono));
  if (cambios.correo !== undefined) poner("correo", cambios.correo ? String(cambios.correo).slice(0, 160) : null);
  if (cambios.fuente !== undefined) poner("fuente", fuenteValida(cambios.fuente));
  for (const k of ["campana", "interes", "motivo_perdido", "responsable"]) if (cambios[k] !== undefined) poner(k, cambios[k] ? String(cambios[k]).slice(0, 160) : null);
  if (cambios.notas !== undefined) poner("notas", cambios.notas ? String(cambios.notas).slice(0, 2000) : null);
  if (cambios.valor !== undefined) poner("valor", numeroValido(cambios.valor));
  if (cambios.cliente !== undefined) poner("cliente_id", clienteRequerido(cambios.cliente).id);
  if (cambios.origen !== undefined) poner("origen", origenValido(cambios.origen));
  if (cambios.venta_fecha !== undefined) {
    const f = cambios.venta_fecha ? String(cambios.venta_fecha).slice(0, 10) : null;
    if (f && !/^\d{4}-\d{2}-\d{2}$/.test(f)) throw new Error("La fecha de venta va como AAAA-MM-DD");
    poner("venta_fecha", f);
  }
  // Cuando la venta la confirma el dueño (o DELTA leyendo el chat), ya no se vuelve a revisar sola.
  if (!opciones.automatico && (cambios.etapa === "venta" || p.etapa === "venta" || cambios.origen !== undefined)) poner("venta_revisada", 1);
  let e = p.etapa;
  if (cambios.cita !== undefined) {
    const ci = cambios.cita ? citaValida(cambios.cita) : null;
    poner("cita", ci);
    if (ci && cambios.etapa === undefined && RANGO[p.etapa] !== undefined && RANGO[p.etapa] < RANGO.cita) cambios.etapa = "cita";
    if (ci && ci !== p.cita) evento(p.id, "etapa", `Cita: ${utcALocal(localAUTC(ci))}`);
  }
  if (cambios.etapa !== undefined) e = etapaValida(cambios.etapa);
  if (e !== p.etapa) {
    poner("etapa", e);
    if (e === "venta" && cambios.venta_fecha === undefined) poner("venta_fecha", ahoraLocalISO().slice(0, 10));
    if (p.etapa === "venta" && e !== "venta" && cambios.venta_fecha === undefined) poner("venta_fecha", null);
    sets.push("etapa_desde = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    // Lo más lejos que llegó se conserva para el embudo, salvo la venta: si sale de "venta" es que no fue venta.
    if (p.etapa === "venta" && e !== "venta") poner("alcanzo", RANGO[e] ?? Math.min(p.alcanzo, RANGO.asistio));
    else if (RANGO[e] !== undefined) poner("alcanzo", Math.max(p.alcanzo, RANGO[e]));
    if (e !== "nuevo" && !p.primer_contacto) poner("primer_contacto", ahoraISO());
    evento(p.id, "etapa", `${p.etapa_nombre} → ${ETAPAS.find((x) => x.clave === e).nombre}${e === "perdido" && cambios.motivo_perdido ? ` (${cambios.motivo_perdido})` : ""}`);
  }
  if (!sets.length) return obtenerProspecto(p.id);
  sets.push("actualizado = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  db.prepare(`UPDATE prospectos SET ${sets.join(", ")} WHERE id = ?`).run(...vals, p.id);
  avisarPantalla({ tipo: "crm" });
  return obtenerProspecto(p.id);
}

/** Avanza (+1) o regresa (-1) en el embudo (sin pasar a "perdido"). */
export function moverProspecto(id, paso = 1) {
  const p = prospectoRequerido(id);
  const orden = CLAVES.filter((k) => k !== "perdido");
  const i = p.etapa === "perdido" ? 0 : Math.min(orden.length - 1, Math.max(0, orden.indexOf(p.etapa) + (paso < 0 ? -1 : 1)));
  return actualizarProspecto(id, { etapa: orden[i] });
}

export function notaProspecto(id, texto) {
  const p = prospectoRequerido(id);
  if (!String(texto || "").trim()) throw new Error("La nota está vacía");
  evento(p.id, "nota", String(texto).trim());
  db.prepare("UPDATE prospectos SET actualizado = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(p.id);
  return fichaProspecto(p.id);
}

export function borrarProspecto(id) {
  const p = prospectoRequerido(id);
  db.prepare("DELETE FROM prospecto_eventos WHERE prospecto_id = ?").run(p.id);
  db.prepare("DELETE FROM prospectos WHERE id = ?").run(p.id);
  avisarPantalla({ tipo: "crm" });
  return { ok: true, nombre: p.nombre };
}

/** Prospecto con su historial (notas, cambios de etapa y mensajes) y lo de WhatsApp. */
export function fichaProspecto(id) {
  const p = prospectoRequerido(id);
  const eventos = db.prepare("SELECT * FROM prospecto_eventos WHERE prospecto_id = ? ORDER BY id").all(p.id);
  return {
    ...p,
    historial: eventos.filter((e) => e.tipo !== "borrador" || e.estado !== "descartado"),
    borradores: eventos.filter((e) => e.tipo === "borrador" && e.estado === "pendiente"),
    whatsapp_api: whatsappDeCliente(p.cliente_id).listo,
    link_whatsapp: p.telefono ? linkWhatsApp(p.telefono) : null,
  };
}

/** Busca por nombre o teléfono (y cliente si se da), para que DELTA lo encuentre de viva voz. */
export function buscarProspecto({ id, nombre, telefono, cliente } = {}) {
  if (id) return prospectoRequerido(id);
  const c = cliente ? clienteRequerido(cliente) : null;
  let filas;
  if (telefono) {
    const t = normalizarTelefono(telefono);
    filas = db.prepare(`${SELECT} WHERE p.telefono = ? ${c ? "AND p.cliente_id = ?" : ""} ORDER BY p.id DESC`).all(t, ...(c ? [c.id] : []));
  } else {
    if (!String(nombre || "").trim()) throw new Error("Dime el nombre o el teléfono del prospecto");
    filas = db.prepare(`${SELECT} WHERE p.nombre LIKE ? ${c ? "AND p.cliente_id = ?" : ""} ORDER BY p.etapa IN ('venta','perdido'), p.id DESC`).all(`%${String(nombre).trim()}%`, ...(c ? [c.id] : []));
  }
  if (!filas.length) throw new Error(`No encuentro a "${nombre || telefono}" en el CRM`);
  const abiertos = filas.filter((f) => !["venta", "perdido"].includes(f.etapa));
  if ((abiertos.length || filas.length) > 1 && abiertos.length !== 1) {
    throw new Error(`Hay varios: ${filas.slice(0, 5).map((f) => `${f.nombre} (${f.cliente}, ${telefonoBonito(f.telefono) || "sin teléfono"})`).join("; ")}. ¿Cuál?`);
  }
  return vestir(abiertos[0] || filas[0]);
}

export function listarProspectos({ cliente, etapa, q } = {}) {
  const c = cliente ? clienteRequerido(cliente) : null;
  let lista = db.prepare(`${SELECT} WHERE c.estado != 'terminado' ${c ? "AND p.cliente_id = ?" : ""} ORDER BY p.creado DESC LIMIT 2000`).all(...(c ? [c.id] : [])).map(vestir);
  if (etapa) { const e = etapaValida(etapa); lista = lista.filter((p) => p.etapa === e); }
  if (q) { const t = String(q).toLowerCase(); lista = lista.filter((p) => p.nombre.toLowerCase().includes(t) || (p.telefono || "").includes(t.replace(/\D/g, "") || "x")); }
  return lista;
}

// ---------- Embudo ----------
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
const dinero = (n) => (n === null || n === undefined ? null : Math.round(n * 100) / 100);

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const diaMas = (f, n) => new Date(Date.parse(`${f}T12:00:00Z`) + n * DIA).toISOString().slice(0, 10);
const diasEntre = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DIA) + 1;
const finDeMes = (m) => { const [a, n] = m.split("-").map(Number); return new Date(Date.UTC(a, n, 0)).toISOString().slice(0, 10); };

/** El periodo pedido: un mes (AAAA-MM) o un rango de fechas (AAAA-MM-DD, incluidas). Por omisión, este mes. */
export function periodo({ mes, desde, hasta } = {}) {
  if (desde || hasta) {
    const d = String(desde || hasta), h = String(hasta || desde);
    if (!FECHA.test(d) || !FECHA.test(h) || Number.isNaN(Date.parse(d)) || Number.isNaN(Date.parse(h))) throw new Error("Fecha no válida (AAAA-MM-DD)");
    const [a, b] = d <= h ? [d, h] : [h, d];
    if (diasEntre(a, b) > 800) throw new Error("El periodo es muy largo (máximo 2 años)");
    return { desde: a, hasta: b, dias: diasEntre(a, b), mes: a.slice(0, 7), es_mes: a.endsWith("-01") && b === finDeMes(a.slice(0, 7)) };
  }
  const m = mes || ahoraLocalISO().slice(0, 7);
  if (!MES.test(m)) throw new Error("Mes no válido (AAAA-MM)");
  const ini = `${m}-01`, fin = finDeMes(m);
  return { desde: ini, hasta: fin, dias: diasEntre(ini, fin), mes: m, es_mes: true };
}

/** El periodo de la misma duración justo antes (para comparar). Un mes completo se compara con el mes anterior. */
export function periodoAnterior(p) {
  if (p.es_mes) { const [a, n] = p.mes.split("-").map(Number); return periodo({ mes: `${n === 1 ? a - 1 : a}-${String(n === 1 ? 12 : n - 1).padStart(2, "0")}` }); }
  return periodo({ desde: diaMas(p.desde, -p.dias), hasta: diaMas(p.desde, -1) });
}

/** Inversión en anuncios (de Paid media) de un cliente en el periodo; si el periodo corta un mes, se reparte por días. */
function inversionPeriodo(clienteId, p) {
  let total = 0;
  for (let m = p.desde.slice(0, 7); m <= p.hasta.slice(0, 7); m = diaMas(finDeMes(m), 1).slice(0, 7)) {
    const g = gastoDelMes(clienteId, m) || 0;
    if (!g) continue;
    const ini = p.desde > `${m}-01` ? p.desde : `${m}-01`;
    const fin = p.hasta < finDeMes(m) ? p.hasta : finDeMes(m);
    total += g * (diasEntre(ini, fin) / diasEntre(`${m}-01`, finDeMes(m)));
  }
  return total;
}

/** Ventas de las personas que LLEGARON en el periodo (así las cuenta el cliente: "de los que escribieron en octubre, cuántos compraron"), separadas en las de redes/anuncios y las demás. */
export function ventasCerradas({ clientes = null, desde, hasta }) {
  const filas = db.prepare(`SELECT p.id, p.nombre, p.cliente_id, c.nombre AS cliente, p.campana, p.fuente, p.origen, p.valor, p.venta_fecha, p.creado, p.venta_revisada
      FROM prospectos p JOIN clientes c ON c.id = p.cliente_id WHERE p.etapa = 'venta' AND c.estado != 'terminado' ${clientes ? `AND p.cliente_id IN (${clientes.map(() => "?").join(",") || "NULL"})` : ""}`)
    .all(...(clientes || []));
  return filas.map((p) => ({ ...p, dia: new Date(p.creado).toLocaleDateString("en-CA", { timeZone: zonaHoraria() }), redes: esDeRedes(p), origen_nombre: p.origen ? ORIGENES[p.origen] : null }))
    .filter((p) => p.dia >= desde && p.dia <= hasta)
    .sort((a, b) => b.dia.localeCompare(a.dia));
}

/** Embudo del periodo (un mes o un rango de fechas): de los prospectos que llegaron, cuántos llegaron a cada paso, y cuánto costó cada uno. */
export function embudo({ cliente, mes, desde: d0, hasta: h0 } = {}) {
  const per = periodo({ mes, desde: d0, hasta: h0 });
  const m = per.mes;
  const c = cliente ? clienteRequerido(cliente) : null;
  const desde = localAUTC(`${per.desde}T00:00`);
  const hasta = localAUTC(`${diaMas(per.hasta, 1)}T00:00`);
  const filas = db.prepare(`SELECT p.* FROM prospectos p JOIN clientes c ON c.id = p.cliente_id WHERE p.creado >= ? AND p.creado < ? AND c.estado != 'terminado' ${c ? "AND p.cliente_id = ?" : ""}`)
    .all(desde, hasta, ...(c ? [c.id] : []));
  const llego = (r) => filas.filter((p) => p.alcanzo >= r).length;
  const total = filas.length;
  const pasos = [
    { clave: "prospectos", nombre: "Prospectos", n: total },
    { clave: "contactados", nombre: "Contactados", n: llego(1) },
    { clave: "citas", nombre: "Agendaron cita", n: llego(2) },
    { clave: "asistieron", nombre: "Asistieron", n: llego(3) },
    { clave: "ventas", nombre: "Compraron", n: llego(4) },
  ].map((x, i, l) => ({ ...x, de_anterior: i ? pct(x.n, l[i - 1].n) : null, del_total: pct(x.n, total) }));
  const ventas = filas.filter((p) => p.alcanzo >= 4);
  const valor = ventas.reduce((s, p) => s + (p.valor || 0), 0);
  const tiempos = filas.filter((p) => p.primer_contacto).map((p) => (Date.parse(p.primer_contacto) - Date.parse(p.creado)) / 60e3).sort((x, y) => x - y);
  const mediana = tiempos.length ? tiempos[Math.floor((tiempos.length - 1) / 2)] : null;
  // Inversión en anuncios del mes (de Paid media) para el costo por paso.
  const ids = c ? [c.id] : [...new Set(filas.map((p) => p.cliente_id))];
  const inversion = Math.round(ids.reduce((s, id) => s + inversionPeriodo(id, per), 0) * 100) / 100;
  const porFuente = Object.entries(FUENTES).map(([k, nombre]) => {
    const l = filas.filter((p) => p.fuente === k);
    return { fuente: k, nombre, prospectos: l.length, citas: l.filter((p) => p.alcanzo >= 2).length, ventas: l.filter((p) => p.alcanzo >= 4).length };
  }).filter((x) => x.prospectos).sort((x, y) => y.prospectos - x.prospectos);
  // Lo que dice Meta del mes: conversaciones que abrieron los anuncios de mensajes y formularios llenados.
  const fotos = !per.es_mes ? [] : ids.map((id) => db.prepare("SELECT datos FROM meta_fotos WHERE cliente_id = ? AND fecha LIKE ? ORDER BY fecha DESC LIMIT 1").get(id, `${m}%`)).filter(Boolean)
    .map((f) => { try { return JSON.parse(f.datos).anuncios; } catch { return null; } }).filter(Boolean);
  const metaMes = fotos.length ? { conversaciones: fotos.reduce((s2, a) => s2 + (a.conversaciones || 0), 0), formularios: fotos.reduce((s2, a) => s2 + (a.prospectos || 0), 0), gasto: fotos.reduce((s2, a) => s2 + (a.gasto_mes || 0), 0) } : null;
  if (metaMes) metaMes.costo_conversacion = metaMes.conversaciones ? dinero(metaMes.gasto / metaMes.conversaciones) : null;
  return {
    mes: m,
    desde: per.desde,
    hasta: per.hasta,
    dias: per.dias,
    es_mes: per.es_mes,
    meta: metaMes,
    pasos,
    prospectos: total,
    citas: llego(2),
    ventas: ventas.length,
    ventas_cerradas: (() => {
      const l = ventasCerradas({ clientes: c ? [c.id] : null, desde: per.desde, hasta: per.hasta });
      const r = l.filter((x) => x.redes);
      return { redes: r.length, otras: l.length - r.length, valor_redes: dinero(r.reduce((s2, x) => s2 + (x.valor || 0), 0)),
        lista: l.slice(0, 40).map((x) => ({ id: x.id, nombre: x.nombre, cliente: x.cliente, llego: x.dia, compro: x.venta_fecha, origen: x.origen_nombre || (x.redes ? "Redes (sin confirmar)" : "Otro (sin confirmar)"), cuenta_como_redes: x.redes, valor: x.valor })) };
    })(),
    valor_ventas: dinero(valor),
    ticket_promedio: ventas.filter((p) => p.valor).length ? dinero(valor / ventas.filter((p) => p.valor).length) : null,
    cierre_pct: pct(ventas.length, total),
    perdidos: filas.filter((p) => p.etapa === "perdido").length,
    respuesta_minutos: mediana === null ? null : Math.round(mediana),
    inversion: inversion || null,
    costo_prospecto: inversion && total ? dinero(inversion / total) : null,
    costo_cita: inversion && llego(2) ? dinero(inversion / llego(2)) : null,
    costo_venta: inversion && ventas.length ? dinero(inversion / ventas.length) : null,
    retorno: inversion && valor ? Math.round((valor / inversion) * 100) / 100 : null,
    por_fuente: porFuente,
  };
}

// ---------- Formularios de anuncios de Meta → CRM ----------
/**
 * Trae al CRM a quien llenó un formulario instantáneo en los anuncios de Meta de este cliente.
 * Cada persona entra una sola vez (por su id de Meta). No le escribe a nadie.
 */
export async function importarDeMeta(cliente) {
  const c = clienteRequerido(cliente);
  const clave = `crm_meta_desde_${c.id}`;
  const desde = getAjuste(clave) || null;
  const inicio = new Date().toISOString();
  let nuevos = 0, repetidos = 0, formularios = 0, paginas = 0, sinPermisoForms = false;
  // 1) Formularios instantáneos
  try {
    const r = await meta.formulariosDeCliente(c.id, { desde });
    paginas = r.paginas; formularios = r.formularios;
    for (const l of r.leads.sort((a, b) => a.fecha.localeCompare(b.fecha))) {
      if (db.prepare("SELECT 1 FROM prospectos WHERE meta_lead_id = ?").get(l.id)) { repetidos++; continue; }
      if (!l.nombre && !l.telefono) continue;
      let tel = null;
      try { tel = normalizarTelefono(l.telefono); } catch { /* teléfono raro: se guarda en notas */ }
      const notas = [...l.respuestas, l.telefono && !tel ? `teléfono: ${l.telefono}` : null, l.anuncio ? `anuncio: ${l.anuncio}` : null, l.formulario ? `formulario: ${l.formulario}` : null].filter(Boolean).join("\n");
      const p = crearProspecto({ cliente: c.id, nombre: l.nombre, telefono: tel, correo: l.correo, fuente: "anuncios", campana: l.campana, notas: notas || null }, { origen: "meta" });
      if (p.ya_existia) { repetidos++; db.prepare("UPDATE prospectos SET meta_lead_id = COALESCE(meta_lead_id, ?) WHERE id = ?").run(l.id, p.id); continue; }
      fechar(p.id, l.id, l.fecha);
      nuevos++;
    }
  } catch (e) { if (e.permiso === false) sinPermisoForms = true; else throw e; }
  // 2) Quien escribió por Messenger o Instagram (anuncios de mensajes incluidos)
  let mensajes = 0;
  const m = await meta.conversacionesDeCliente(c.id, { desde: desde ? new Date(Date.parse(desde) - DIA).toISOString() : null });
  paginas = paginas || m.paginas;
  for (const x of m.conversaciones.sort((a, b) => a.fecha.localeCompare(b.fecha))) {
    if (db.prepare("SELECT 1 FROM prospectos WHERE meta_lead_id = ?").get(x.id)) { repetidos++; continue; }
    const red = x.plataforma === "instagram" ? "Instagram" : "Messenger";
    const p = crearProspecto({ cliente: c.id, nombre: x.nombre || `Alguien por ${red}`, fuente: x.plataforma === "instagram" ? "instagram" : "facebook",
      notas: x.ultimo ? `Último mensaje por ${red}${x.de_ellos === false ? " (de la clínica)" : ""}: "${x.ultimo}"` : null }, { origen: x.plataforma });
    if (p.ya_existia) { repetidos++; continue; }
    fechar(p.id, x.id, x.fecha);
    nuevos++; mensajes++;
  }
  setAjuste(clave, inicio);
  if (nuevos) avisarPantalla({ tipo: "crm" });
  return { cliente: c.nombre, paginas, formularios, mensajes, nuevos, repetidos, sin_permiso: sinPermisoForms, sin_permiso_mensajes: m.sin_permiso };
}

function fechar(id, metaId, fecha) {
  db.prepare("UPDATE prospectos SET meta_lead_id = ?, creado = ?, etapa_desde = ? WHERE id = ?").run(metaId, fecha, fecha, id);
  db.prepare("UPDATE prospecto_eventos SET fecha = ? WHERE prospecto_id = ? AND tipo = 'etapa'").run(fecha, id);
}

/** Revisa formularios y mensajes de Meta de todos los clientes con página ligada (cada hora). */
export async function importarTodoMeta() {
  if (!meta.metaConectado()) return null;
  const ids = db.prepare("SELECT DISTINCT a.cliente_id FROM meta_activos a JOIN clientes c ON c.id = a.cliente_id WHERE a.tipo = 'pagina' AND c.estado != 'terminado'").all().map((x) => x.cliente_id);
  let nuevos = 0;
  for (const id of ids) {
    try { nuevos += (await importarDeMeta(id)).nuevos; }
    catch (e) { console.error("[crm meta]", id, e.message); }
  }
  const faltan = await meta.permisosFaltantes();
  if (faltan) setAjuste("crm_meta_faltan", JSON.stringify(faltan));
  setAjuste("crm_actualizado", new Date().toISOString());
  if (nuevos) avisar(`Llegaron ${nuevos} prospecto${nuevos === 1 ? "" : "s"} nuevo${nuevos === 1 ? "" : "s"} de Meta (formularios y mensajes). Están en el CRM.`, "CRM").catch(() => {});
  return { nuevos, faltan };
}

/** Los permisos de Meta que le faltan al CRM, en palabras sencillas. */
function faltanMeta() {
  try { return JSON.parse(getAjuste("crm_meta_faltan") || "[]").map((k) => meta.PERMISOS_CRM[k]).filter(Boolean); } catch { return []; }
}

export function iniciarCrm() {
  const correr = () => importarTodoMeta().catch((e) => console.error("[crm meta]", e.message));
  setTimeout(correr, 90e3);
  setInterval(correr, 3600e3);
}

/** El tablero del CRM: columnas por etapa, lo urgente y el embudo del mes. */
export function tableroCrm({ cliente, mes, desde, hasta } = {}) {
  const lista = listarProspectos({ cliente });
  const hace30 = new Date(Date.now() - 30 * DIA).toISOString();
  // Ventas y perdidos solo de los últimos 30 días, para que el tablero no se llene.
  const visibles = lista.filter((p) => !["venta", "perdido"].includes(p.etapa) || p.etapa_desde >= hace30);
  const orden = (a, b) => (b.sin_responder - a.sin_responder) || String(a.cita || "9").localeCompare(String(b.cita || "9")) || b.creado.localeCompare(a.creado);
  const e = embudo({ cliente, mes, desde, hasta });
  const ant = periodoAnterior(periodo({ mes, desde, hasta }));
  return {
    cliente: cliente ? clienteRequerido(cliente).nombre : null,
    etapas: ETAPAS.map((x) => ({ ...x, prospectos: visibles.filter((p) => p.etapa === x.clave).sort(orden) })),
    sin_responder: lista.filter((p) => p.sin_responder).sort((a, b) => b.horas_esperando - a.horas_esperando),
    esperando: lista.filter((p) => p.etapa === "nuevo" && !p.primer_contacto),
    citas_hoy: lista.filter((p) => p.cita_hoy).sort((a, b) => a.cita.localeCompare(b.cita)),
    citas_pasadas: lista.filter((p) => p.cita_pasada),
    borradores: db.prepare(`SELECT e.id, e.texto, e.fecha, p.id prospecto_id, p.nombre, c.nombre cliente FROM prospecto_eventos e JOIN prospectos p ON p.id = e.prospecto_id JOIN clientes c ON c.id = p.cliente_id
        WHERE e.tipo = 'borrador' AND e.estado = 'pendiente' ${cliente ? "AND p.cliente_id = ?" : ""} ORDER BY e.id DESC LIMIT 20`).all(...(cliente ? [clienteRequerido(cliente).id] : [])),
    embudo: e,
    actualizado: getAjuste("crm_actualizado") || null, // última vez que DELTA trajo todo solo (cada hora)
    meta: { conectado: meta.metaConectado(), faltan: meta.metaConectado() ? faltanMeta() : [], paginas: cliente ? db.prepare("SELECT COUNT(*) n FROM meta_activos WHERE cliente_id = ? AND tipo = 'pagina'").get(clienteRequerido(cliente).id).n : null },
    embudo_anterior: embudo({ cliente, desde: ant.desde, hasta: ant.hasta }),
    fuentes: FUENTES,
  };
}

/** Lo que necesita el Pulso. */
export function avisosCrm() {
  const l = listarProspectos();
  return { sin_responder: l.filter((p) => p.sin_responder), citas_hoy: l.filter((p) => p.cita_hoy), citas_pasadas: l.filter((p) => p.cita_pasada) };
}

// ---------- Formulario público ----------
export function configCrm(cliente) {
  const c = clienteRequerido(cliente);
  const f = db.prepare("SELECT * FROM crm_config WHERE cliente_id = ?").get(c.id) || {};
  return { cliente: c.nombre, cliente_id: c.id, wa_phone_id: f.wa_phone_id || null, wa_numero: f.wa_numero ? telefonoBonito(f.wa_numero) : null, formulario: f.form_token ? `/p/${f.form_token}` : null, bienvenida: f.bienvenida || null };
}

export function configurarCrm({ cliente, wa_phone_id, wa_numero, formulario, bienvenida } = {}) {
  const c = clienteRequerido(cliente);
  db.prepare("INSERT OR IGNORE INTO crm_config (cliente_id) VALUES (?)").run(c.id);
  if (wa_phone_id !== undefined) {
    const id = wa_phone_id ? String(wa_phone_id).replace(/\D/g, "") : null;
    if (wa_phone_id && !id) throw new Error("El id del número de WhatsApp son solo números (viene en Meta → WhatsApp → Configuración de la API)");
    db.prepare("UPDATE crm_config SET wa_phone_id = ? WHERE cliente_id = ?").run(id, c.id);
  }
  if (wa_numero !== undefined) db.prepare("UPDATE crm_config SET wa_numero = ? WHERE cliente_id = ?").run(wa_numero ? normalizarTelefono(wa_numero) : null, c.id);
  if (bienvenida !== undefined) db.prepare("UPDATE crm_config SET bienvenida = ? WHERE cliente_id = ?").run(bienvenida ? String(bienvenida).slice(0, 300) : null, c.id);
  if (formulario === true) {
    const actual = db.prepare("SELECT form_token FROM crm_config WHERE cliente_id = ?").get(c.id)?.form_token;
    if (!actual) db.prepare("UPDATE crm_config SET form_token = ? WHERE cliente_id = ?").run(crypto.randomBytes(12).toString("base64url"), c.id);
  } else if (formulario === false) db.prepare("UPDATE crm_config SET form_token = NULL WHERE cliente_id = ?").run(c.id);
  return configCrm(c.id);
}

/** Valor promedio de una venta y margen (%) de un cliente, para calcular su utilidad en el tablero. */
export function utilidadConfig(cliente) {
  const c = clienteRequerido(cliente);
  const f = db.prepare("SELECT ticket, margen FROM crm_config WHERE cliente_id = ?").get(c.id) || {};
  return { cliente: c.nombre, cliente_id: c.id, ticket: f.ticket ?? null, margen: f.margen ?? null };
}

export function guardarUtilidad({ cliente, ticket, margen } = {}) {
  const c = clienteRequerido(cliente);
  db.prepare("INSERT OR IGNORE INTO crm_config (cliente_id) VALUES (?)").run(c.id);
  const num = (x, que, max) => {
    if (x === null || x === "" || x === undefined) return null;
    const n = Number(String(x).replace(/[$,%\s]/g, ""));
    if (!Number.isFinite(n) || n < 0 || n > max) throw new Error(`${que} no es válido`);
    return Math.round(n * 100) / 100;
  };
  if (ticket !== undefined) db.prepare("UPDATE crm_config SET ticket = ? WHERE cliente_id = ?").run(num(ticket, "El valor promedio de una venta", 1e9), c.id);
  if (margen !== undefined) db.prepare("UPDATE crm_config SET margen = ? WHERE cliente_id = ?").run(num(margen, "El margen (de 0 a 100 %)", 100), c.id);
  return utilidadConfig(c.id);
}

export function clientePorFormulario(token) {
  if (!/^[A-Za-z0-9_-]{16}$/.test(String(token || ""))) return null;
  const f = db.prepare("SELECT * FROM crm_config WHERE form_token = ?").get(String(token));
  if (!f) return null;
  const c = obtenerCliente(f.cliente_id);
  return c && c.estado !== "terminado" ? { cliente: c, bienvenida: f.bienvenida } : null;
}

const intentos = new Map(); // ip -> [tiempos]
/** Recibe el formulario público. Devuelve true si se guardó. */
export function recibirFormulario(token, cuerpo = {}, ip = "") {
  const x = clientePorFormulario(token);
  if (!x) throw new Error("Este formulario ya no está disponible");
  if (cuerpo.sitio_web) return true; // campo trampa: lo llenan los robots, no las personas
  const ahora = Date.now();
  const l = (intentos.get(ip) || []).filter((t) => ahora - t < 10 * 60e3);
  if (l.length >= 5) throw new Error("Ya recibimos tus datos. Si necesitas algo más, intenta en unos minutos.");
  l.push(ahora);
  intentos.set(ip, l);
  if (intentos.size > 5000) intentos.delete(intentos.keys().next().value);
  const nombre = String(cuerpo.nombre || "").trim();
  if (!nombre) throw new Error("Escribe tu nombre");
  if (!String(cuerpo.telefono || "").trim()) throw new Error("Escribe tu teléfono o WhatsApp");
  let tel;
  try { tel = normalizarTelefono(cuerpo.telefono); } catch { throw new Error("Revisa tu teléfono: deben ser 10 dígitos"); }
  const p = crearProspecto({ cliente: x.cliente.id, nombre, telefono: tel, correo: cuerpo.correo, fuente: "web", interes: cuerpo.interes, notas: cuerpo.mensaje ? `Mensaje: ${String(cuerpo.mensaje).slice(0, 1000)}` : null }, { origen: "formulario" });
  if (!p.ya_existia) avisar(`Nuevo prospecto para ${x.cliente.nombre}: ${p.nombre} (${telefonoBonito(tel)}) por el formulario. Está en CRM, esperando respuesta.`, "CRM").catch(() => {});
  return true;
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/** Página pública del formulario (sin scripts; el estilo viene de /formulario.css). */
export function paginaFormulario(x, { enviado = false, error = null, datos = {} } = {}) {
  const n = esc(x.cliente.nombre);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${n} · Contacto</title><link rel="stylesheet" href="/formulario.css"></head>
<body><main class="fm">
<h1>${n}</h1>
${enviado ? `<p class="fm-ok">¡Gracias! Recibimos tus datos y te escribimos muy pronto.</p>` : `
<p class="fm-intro">${esc(x.bienvenida || "Déjanos tus datos y te contactamos por WhatsApp para resolver tus dudas o agendar tu cita.")}</p>
${error ? `<p class="fm-error">${esc(error)}</p>` : ""}
<form method="post">
<label>Nombre<input name="nombre" required maxlength="120" autocomplete="name" value="${esc(datos.nombre)}"></label>
<label>Teléfono o WhatsApp<input name="telefono" required maxlength="20" inputmode="tel" autocomplete="tel" value="${esc(datos.telefono)}"></label>
<label>Correo <small>(opcional)</small><input name="correo" type="email" maxlength="160" autocomplete="email" value="${esc(datos.correo)}"></label>
<label>¿Qué te interesa? <small>(opcional)</small><input name="interes" maxlength="160" value="${esc(datos.interes)}"></label>
<label>Mensaje <small>(opcional)</small><textarea name="mensaje" rows="3" maxlength="1000">${esc(datos.mensaje)}</textarea></label>
<label class="fm-trampa" aria-hidden="true">No llenar<input name="sitio_web" tabindex="-1" autocomplete="off"></label>
<button type="submit">Enviar</button>
<p class="fm-aviso">Usaremos tus datos solo para contactarte sobre tu consulta.</p>
</form>`}
</main></body></html>`;
}

// ---------- WhatsApp ----------
const API_WA = "https://graph.facebook.com/v21.0";
export function linkWhatsApp(telefono, texto = "") {
  return `https://wa.me/${String(telefono).replace(/\D/g, "")}${texto ? `?text=${encodeURIComponent(texto)}` : ""}`;
}
export function whatsappDeCliente(clienteId) {
  const f = db.prepare("SELECT wa_phone_id FROM crm_config WHERE cliente_id = ?").get(clienteId);
  return { phone_id: f?.wa_phone_id || null, listo: Boolean(f?.wa_phone_id && process.env.WHATSAPP_TOKEN) };
}
/** ¿Este número de la Cloud API es de un cliente? (los mensajes que le lleguen van al CRM) */
export const clientePorNumeroWA = (phoneId) => (phoneId ? db.prepare("SELECT cliente_id FROM crm_config WHERE wa_phone_id = ?").get(String(phoneId))?.cliente_id || null : null);

/** Un mensaje que un prospecto le mandó al WhatsApp de un cliente (llega por el webhook). */
export function recibirWhatsApp({ phoneId, de, nombre, texto, waId, tipo = "text" }) {
  const clienteId = clientePorNumeroWA(phoneId);
  if (!clienteId) return null;
  if (waId && db.prepare("SELECT 1 FROM prospecto_eventos WHERE wa_id = ?").get(waId)) return null; // ya lo teníamos
  const tel = normalizarTelefono(de);
  let p = db.prepare("SELECT id FROM prospectos WHERE cliente_id = ? AND telefono = ? ORDER BY etapa IN ('venta','perdido'), id DESC LIMIT 1").get(clienteId, tel);
  let nuevo = false;
  if (!p) {
    p = crearProspecto({ cliente: clienteId, nombre: nombre || null, telefono: tel, fuente: "whatsapp" }, { origen: "whatsapp" });
    nuevo = true;
  }
  const contenido = texto || (tipo === "audio" ? "🎤 Nota de voz" : tipo === "image" ? "📷 Imagen" : `(${tipo})`);
  evento(p.id, "entrante", contenido, { wa_id: waId });
  db.prepare("UPDATE prospectos SET ultimo_entrante = strftime('%Y-%m-%dT%H:%M:%fZ','now'), actualizado = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(p.id);
  if (nuevo) avisar(`Nuevo prospecto para ${obtenerCliente(clienteId).nombre} por WhatsApp: ${nombre || telefonoBonito(tel)} dice "${contenido.slice(0, 80)}". Está en CRM.`, "CRM").catch(() => {});
  avisarPantalla({ tipo: "crm" });
  return obtenerProspecto(p.id);
}

let enviarAPI = async (phoneId, para, texto) => {
  const r = await fetch(`${API_WA}/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: para, type: "text", text: { body: texto } }),
    signal: AbortSignal.timeout(20000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("WhatsApp: " + (d?.error?.message || `error ${r.status}`));
  return d.messages?.[0]?.id || null;
};
export function _enviarDePrueba(fn) { enviarAPI = fn; }

/** Guarda un borrador de mensaje para el prospecto (no lo envía). */
export function guardarBorrador(id, texto) {
  const p = prospectoRequerido(id);
  const t = String(texto || "").trim();
  if (!t) throw new Error("El mensaje está vacío");
  const eid = evento(p.id, "borrador", t.slice(0, 2000), { estado: "pendiente" });
  avisarPantalla({ tipo: "crm" });
  return { borrador_id: eid, prospecto: p.nombre, texto: t, link_whatsapp: p.telefono ? linkWhatsApp(p.telefono, t) : null };
}

export function descartarBorrador(borradorId) {
  db.prepare("UPDATE prospecto_eventos SET estado = 'descartado' WHERE id = ? AND tipo = 'borrador'").run(Number(borradorId));
  return { ok: true };
}

/**
 * Envía por la API de WhatsApp del cliente. Solo se llama cuando el DUEÑO toca "Enviar" en la pantalla
 * (DELTA no tiene herramienta para esto). WhatsApp solo deja texto libre dentro de 24 h desde el último
 * mensaje del prospecto; fuera de esa ventana se usa "Abrir en WhatsApp".
 */
export async function enviarWhatsAppProspecto(id, { texto, borrador_id } = {}) {
  const p = prospectoRequerido(id);
  let t = String(texto || "").trim();
  if (borrador_id) {
    const b = db.prepare("SELECT * FROM prospecto_eventos WHERE id = ? AND prospecto_id = ? AND tipo = 'borrador'").get(Number(borrador_id), p.id);
    if (!b || b.estado !== "pendiente") throw new Error("Ese borrador ya no está pendiente");
    t ||= b.texto;
  }
  if (!t) throw new Error("El mensaje está vacío");
  if (!p.telefono) throw new Error("Este prospecto no tiene teléfono");
  const wa = whatsappDeCliente(p.cliente_id);
  if (!wa.listo) throw new Error("El WhatsApp de este cliente no está conectado. Usa \"Abrir en WhatsApp\".");
  if (!p.whatsapp_abierto) throw new Error("Pasaron más de 24 horas desde su último mensaje y WhatsApp ya no deja escribirle libremente. Usa \"Abrir en WhatsApp\" desde el teléfono del cliente.");
  const waId = await enviarAPI(wa.phone_id, p.telefono, t.slice(0, 4000));
  evento(p.id, "saliente", t, { wa_id: waId });
  if (borrador_id) db.prepare("UPDATE prospecto_eventos SET estado = 'enviado' WHERE id = ?").run(Number(borrador_id));
  if (p.etapa === "nuevo") actualizarProspecto(p.id, { etapa: "contactado" });
  else db.prepare("UPDATE prospectos SET primer_contacto = COALESCE(primer_contacto, strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE id = ?").run(p.id);
  return fichaProspecto(p.id);
}

/** El dueño dice que ya le escribió (por ejemplo, después de "Abrir en WhatsApp"). */
export function marcarEnviado(id, { texto, borrador_id } = {}) {
  const p = prospectoRequerido(id);
  if (borrador_id) {
    const b = db.prepare("SELECT * FROM prospecto_eventos WHERE id = ? AND prospecto_id = ? AND tipo = 'borrador'").get(Number(borrador_id), p.id);
    if (b) { db.prepare("UPDATE prospecto_eventos SET estado = 'enviado', tipo = 'saliente' WHERE id = ?").run(b.id); }
  } else if (texto) evento(p.id, "saliente", texto);
  if (p.etapa === "nuevo") actualizarProspecto(p.id, { etapa: "contactado" });
  return fichaProspecto(p.id);
}

// ---------- Borrador con Claude ----------
let claude = null;
const PLANTILLAS = {
  nuevo: (p, c) => `¡Hola${p.nombre && !/^\+?\d/.test(p.nombre) ? ` ${p.nombre.split(" ")[0]}` : ""}! Gracias por escribir a ${c}. ${p.interes ? `Con gusto te damos información sobre ${p.interes}. ` : ""}¿Te gustaría agendar una cita? Dime qué día y horario te acomodan.`,
  contactado: (p, c) => `Hola${p.nombre ? ` ${p.nombre.split(" ")[0]}` : ""}, te escribo de ${c} para ver si pudiste revisar la información. ¿Te aparto un espacio esta semana?`,
  cita: (p, c) => `Hola${p.nombre ? ` ${p.nombre.split(" ")[0]}` : ""}, te recordamos tu cita en ${c}${p.cita ? ` el ${utcALocal(localAUTC(p.cita))}` : ""}. ¿Nos confirmas tu asistencia?`,
  asistio: (p, c) => `Hola${p.nombre ? ` ${p.nombre.split(" ")[0]}` : ""}, gracias por visitarnos en ${c}. ¿Tienes alguna duda sobre lo que platicamos? Aquí estamos para ayudarte.`,
  venta: (p, c) => `Hola${p.nombre ? ` ${p.nombre.split(" ")[0]}` : ""}, gracias por tu confianza en ${c}. ¿Cómo te has sentido?`,
  perdido: (p, c) => `Hola${p.nombre ? ` ${p.nombre.split(" ")[0]}` : ""}, en ${c} seguimos a tus órdenes por si más adelante quieres retomar tu consulta.`,
};

/** DELTA propone un mensaje para el prospecto según su etapa y lo que ha platicado. Queda como borrador. */
export async function sugerirMensaje(id, { indicacion } = {}) {
  const f = fichaProspecto(id);
  const c = obtenerCliente(f.cliente_id);
  let texto = null;
  if (process.env.ANTHROPIC_API_KEY) {
    claude ||= new Anthropic();
    const plática = f.historial.filter((e) => ["entrante", "saliente", "nota"].includes(e.tipo)).slice(-12)
      .map((e) => `${e.tipo === "entrante" ? "Prospecto" : e.tipo === "saliente" ? "Clínica" : "Nota interna"}: ${e.texto}`).join("\n");
    const r = await claude.messages.create({
      model: process.env.DELTA_MODELO_CRM || "claude-haiku-5-5",
      max_tokens: 600,
      system: `Escribes mensajes de WhatsApp en nombre de ${c.nombre}${c.industria ? ` (${c.industria})` : ""}, un negocio de salud en México, para sus prospectos. Español de México, cálido, breve (2 a 4 frases), sin emojis de más, sin prometer resultados médicos ni precios que no te den. El objetivo es avanzar al siguiente paso (agendar cita, confirmarla, dar seguimiento). Responde SOLO con el texto del mensaje.`,
      messages: [{ role: "user", content: `Prospecto: ${f.nombre}. Etapa: ${f.etapa_nombre}. Le interesa: ${f.interes || "—"}. Cita: ${f.cita ? utcALocal(localAUTC(f.cita)) : "—"}. Servicios del negocio: ${c.servicios || "—"}.
Conversación reciente:
${plática || "(todavía no hay mensajes)"}
${indicacion ? `\nIndicación del dueño: ${indicacion}` : ""}
Escribe el siguiente mensaje para el prospecto.` }],
    });
    texto = r.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim().replace(/^"|"$/g, "");
  }
  if (!texto) texto = (PLANTILLAS[f.etapa] || PLANTILLAS.nuevo)(f, c.nombre);
  return guardarBorrador(f.id, texto);
}
