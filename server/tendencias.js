// Tendencias: lo que se está moviendo en el nicho de cada cliente y, con eso, ideas listas para usar.
//
// Fuentes (todas funcionan sin pagar nada extra):
//  - Google Tendencias: lo que México está buscando hoy (RSS público, sin clave).
//  - Google Noticias: lo nuevo de los temas del cliente esta semana (RSS público, sin clave).
//  - Instagram: las publicaciones de las cuentas de referencia del cliente (competencia o creadores del nicho)
//    que están funcionando muy por encima de su promedio. Se leen con el Meta que ya está conectado
//    ("business discovery"): solo cuentas de empresa o creador, nunca personales.
// Con esas señales, Claude propone ideas concretas (gancho, formato, pasos) que se pasan a Contenido con un toque.
// Se actualiza sola cada lunes temprano; también con el botón "Buscar ahora".
import Anthropic from "@anthropic-ai/sdk";
import { db, getAjuste, setAjuste } from "./db.js";
import { listarClientes, clienteRequerido } from "./agencia.js";
import { conCache } from "./cache.js";
import * as noticias from "./noticias.js";
import * as meta from "./meta.js";
import { FORMATOS, REDES, crearContenido } from "./contenido.js";
import { ahoraLocalISO } from "./tiempo.js";
import { avisar } from "./avisos.js";

const MODELO = process.env.DELTA_MODELO_TENDENCIAS || "claude-sonnet-5-5";
const PAIS = () => (process.env.TENDENCIAS_PAIS || "MX").toUpperCase();
const DIA = 864e5;

db.exec(`
CREATE TABLE IF NOT EXISTS tendencias_config (
  cliente_id INTEGER PRIMARY KEY REFERENCES clientes(id),
  palabras TEXT,                                 -- JSON: temas del nicho ("cardiología", "colesterol")
  cuentas TEXT,                                  -- JSON: cuentas de Instagram de referencia, sin @
  actualizado TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS tendencias_busquedas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  fecha TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  senales TEXT NOT NULL,                         -- JSON: lo que se encontró en cada fuente
  avisos TEXT                                    -- JSON: fuentes que no respondieron
);
CREATE TABLE IF NOT EXISTS tendencias_ideas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  busqueda_id INTEGER REFERENCES tendencias_busquedas(id),
  titulo TEXT NOT NULL,
  gancho TEXT,
  formato TEXT,
  red TEXT,
  por_que TEXT,
  pasos TEXT,                                    -- JSON: lista corta de pasos o escenas
  basada_en TEXT,
  urgencia TEXT,                                 -- hoy | semana | siempre
  estado TEXT NOT NULL DEFAULT 'nueva',          -- nueva | usada | descartada
  contenido_id INTEGER,
  creado TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ideas_cliente ON tendencias_ideas(cliente_id, estado);
`);

// ---------- Utilidades ----------
const normal = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const json = (t, d) => { try { return JSON.parse(t) ?? d; } catch { return d; } };
const ENT = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'" };
const texto = (s) => String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "").replace(/&(amp|lt|gt|quot|#39|apos);/g, (m) => ENT[m]).trim();
const campo = (x, tag) => texto((x.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1]);
const PALABRAS_VACIAS = new Set(["de", "la", "el", "los", "las", "y", "en", "para", "con", "del", "por", "un", "una", "al"]);

/** Cuántas búsquedas: "200 K+" → 200000; "2 mil+" → 2000. */
export function traficoANumero(t) {
  const m = String(t || "").replace(/,/g, "").match(/([\d.]+)\s*(k|m|mil|mill)?/i);
  if (!m) return null;
  const n = Number(m[1]);
  const x = { k: 1e3, mil: 1e3, m: 1e6, mill: 1e6 }[String(m[2] || "").toLowerCase()] || 1;
  return Math.round(n * x);
}

/** Lee el RSS de Google Tendencias ("Trending now"). Separado para poder probarlo. */
export function leerGoogleTendencias(xml) {
  return [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    const notas = [...it.matchAll(/<ht:news_item>([\s\S]*?)<\/ht:news_item>/g)].map(([, n]) => ({
      titulo: campo(n, "ht:news_item_title"), enlace: campo(n, "ht:news_item_url"), fuente: campo(n, "ht:news_item_source"),
    })).filter((n) => n.titulo).slice(0, 3);
    const trafico = campo(it, "ht:approx_traffic");
    const fecha = campo(it, "pubDate");
    return { tema: campo(it, "title"), busquedas: trafico || null, n: traficoANumero(trafico), fecha: fecha && !isNaN(Date.parse(fecha)) ? new Date(fecha).toISOString() : null, noticias: notas };
  }).filter((x) => x.tema);
}

async function googleDirecto() {
  const url = `https://trends.google.com/trending/rss?geo=${encodeURIComponent(PAIS())}`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (DELTA asistente)" }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`Google Tendencias respondió ${r.status}`);
  return leerGoogleTendencias(await r.text());
}

/** Lo que todo el país busca hoy (una hora de memoria; si Google no responde, lo último que se vio). */
export async function busquedasHoy() {
  try {
    const lista = await conCache(`tendencias:google:${PAIS()}`, 60 * 60e3, async () => {
      const l = await fuentes.google();
      if (l.length) setAjuste("tendencias_google_ultimo", JSON.stringify({ fecha: new Date().toISOString(), lista: l }));
      return l;
    });
    return { fecha: new Date().toISOString(), lista, pais: PAIS() };
  } catch (e) {
    const u = json(getAjuste("tendencias_google_ultimo"), null);
    return { fecha: u?.fecha || null, lista: u?.lista || [], pais: PAIS(), error: `Google Tendencias no respondió (${e.message}).` };
  }
}

/** Las búsquedas del día que tocan el nicho del cliente (por sus palabras clave). */
export function relevantes(lista, palabras) {
  const claves = palabras.flatMap((p) => normal(p).split(/[^a-z0-9ñ]+/)).filter((p) => p.length >= 4 && !PALABRAS_VACIAS.has(p));
  if (!claves.length) return [];
  return lista.filter((t) => {
    const todo = normal([t.tema, ...t.noticias.map((n) => n.titulo)].join(" "));
    return claves.some((k) => new RegExp(`\\b${k}`).test(todo));
  });
}

/**
 * De una cuenta de Instagram, las publicaciones recientes que funcionan muy por encima de lo normal
 * para esa misma cuenta (interacciones / mediana de la cuenta). Eso es "lo que está pegando".
 */
export function destacadas(cuenta, { dias = 30, minimo = 1.8, ahora = Date.now() } = {}) {
  const media = (cuenta?.media?.data || cuenta?.media || []).filter((m) => m && m.timestamp);
  if (media.length < 4) return [];
  const inter = (m) => (m.like_count || 0) + 2 * (m.comments_count || 0);
  const orden = media.map(inter).sort((a, b) => a - b);
  const mitad = Math.floor(orden.length / 2);
  const mediana = orden.length % 2 ? orden[mitad] : (orden[mitad - 1] + orden[mitad]) / 2;
  if (!mediana) return [];
  return media
    .filter((m) => ahora - Date.parse(m.timestamp) <= dias * DIA)
    .map((m) => ({ m, veces: inter(m) / mediana }))
    .filter(({ m, veces }) => veces >= minimo && inter(m) >= 20)
    .sort((a, b) => b.veces - a.veces)
    .slice(0, 3)
    .map(({ m, veces }) => ({
      cuenta: cuenta.username,
      seguidores: cuenta.followers_count ?? null,
      texto: String(m.caption || "").replace(/\s+/g, " ").trim().slice(0, 220),
      formato: m.media_product_type === "REELS" ? "reel" : m.media_type === "CAROUSEL_ALBUM" ? "carrusel" : m.media_type === "VIDEO" ? "video" : "post",
      me_gusta: m.like_count ?? null,
      comentarios: m.comments_count ?? null,
      veces: Math.round(veces * 10) / 10,
      enlace: m.permalink || null,
      fecha: m.timestamp,
    }));
}

async function instagramDe(cuentas, clienteId) {
  const avisos = [];
  const res = await Promise.allSettled(cuentas.map((u) => meta.cuentaInstagramAjena(u, clienteId)));
  const lista = [];
  res.forEach((r, i) => {
    if (r.status === "fulfilled") lista.push(...destacadas(r.value));
    else avisos.push(`@${cuentas[i]}: ${r.reason.message.replace(/^Meta: /, "")}`);
  });
  return { lista: lista.sort((a, b) => b.veces - a.veces).slice(0, 8), avisos };
}

async function noticiasDe(palabras) {
  const res = await Promise.allSettled(palabras.slice(0, 4).map((p) => noticias.noticias(p, 4, 7)));
  const vistas = new Set();
  const lista = [];
  const avisos = [];
  res.forEach((r, i) => {
    if (r.status !== "fulfilled") { avisos.push(`Noticias de "${palabras[i]}": ${r.reason.message}`); return; }
    for (const n of r.value) {
      const k = normal(n.titulo).slice(0, 60);
      if (vistas.has(k)) continue;
      vistas.add(k);
      lista.push({ ...n, tema: palabras[i] });
    }
  });
  return { lista: lista.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, 10), avisos };
}

// ---------- Configuración por cliente ----------
const limpiaPalabras = (l) => [...new Set((Array.isArray(l) ? l : String(l || "").split(/[,\n;]/)).map((x) => String(x).trim().slice(0, 60)).filter(Boolean))].slice(0, 6);
const limpiaCuentas = (l) => {
  const lista = (Array.isArray(l) ? l : String(l || "").split(/[,\s;]+/))
    .map((x) => String(x).trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/[/?].*$/, "").replace(/^@/, "").toLowerCase())
    .filter(Boolean);
  for (const u of lista) if (!/^[a-z0-9._]{1,30}$/.test(u)) throw new Error(`"${u}" no parece una cuenta de Instagram`);
  return [...new Set(lista)].slice(0, 8);
};

/** Temas del nicho: los que se guardaron o, si no hay, los que se deducen de la ficha del cliente. */
export function configCliente(c) {
  const f = db.prepare("SELECT * FROM tendencias_config WHERE cliente_id = ?").get(c.id);
  const guardadas = json(f?.palabras, []);
  const sugeridas = limpiaPalabras([c.industria, ...String(c.servicios || "").split(/[,;\n]/)].filter(Boolean)).slice(0, 4);
  return { palabras: guardadas.length ? guardadas : sugeridas, sugeridas: !guardadas.length && sugeridas.length > 0, cuentas: json(f?.cuentas, []) };
}

export function configurarTendencias({ cliente, palabras, cuentas } = {}) {
  const c = clienteRequerido(cliente);
  const antes = configCliente(c);
  const p = palabras === undefined ? (antes.sugeridas ? [] : antes.palabras) : limpiaPalabras(palabras);
  const k = cuentas === undefined ? antes.cuentas : limpiaCuentas(cuentas);
  db.prepare(`INSERT INTO tendencias_config (cliente_id, palabras, cuentas) VALUES (?,?,?)
      ON CONFLICT(cliente_id) DO UPDATE SET palabras = excluded.palabras, cuentas = excluded.cuentas, actualizado = strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
    .run(c.id, JSON.stringify(p), JSON.stringify(k));
  return { cliente: c.nombre, ...configCliente(c) };
}

// ---------- Ideas con Claude ----------
let claude = null;
const IDEAS_SCHEMA = {
  type: "object",
  properties: {
    ideas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          titulo: { type: "string", description: "Nombre corto de la pieza, como se anotaría en el calendario" },
          gancho: { type: "string", description: "La primera frase o los primeros 3 segundos, tal cual se diría o se leería" },
          formato: { type: "string", enum: Object.keys(FORMATOS) },
          red: { type: "string", enum: Object.keys(REDES) },
          por_que: { type: "string", description: "Por qué funciona ahora, en una frase sencilla" },
          pasos: { type: "array", items: { type: "string" }, description: "3 a 5 escenas, slides o pasos cortos" },
          basada_en: { type: "string", description: "La señal en la que se basa (cuenta, búsqueda, noticia o fecha). Vacío si es idea de temporada" },
          urgencia: { type: "string", enum: ["hoy", "semana", "siempre"], description: "hoy = aprovechar ya; semana = esta semana; siempre = no caduca" },
        },
        required: ["titulo", "gancho", "formato", "red", "por_que", "pasos", "basada_en", "urgencia"],
        additionalProperties: false,
      },
    },
  },
  required: ["ideas"],
  additionalProperties: false,
};

async function ideasConClaude(c, senales, palabras) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  claude ||= new Anthropic();
  const usadas = db.prepare("SELECT titulo FROM tendencias_ideas WHERE cliente_id = ? ORDER BY id DESC LIMIT 30").all(c.id).map((x) => x.titulo);
  const pedido = `Cliente: ${c.nombre}${c.industria ? ` (${c.industria})` : ""}.
Servicios: ${c.servicios || "—"}. Notas: ${String(c.notas || "—").slice(0, 400)}.
Temas de su nicho: ${palabras.join(", ") || "—"}.
Fecha de hoy: ${ahoraLocalISO().slice(0, 10)} (México).

Señales de esta semana:
${JSON.stringify(senales).slice(0, 9000)}

Ideas que ya se propusieron antes (no las repitas): ${usadas.join(" | ") || "ninguna"}.

Propón de 4 a 6 ideas de contenido para sus redes, listas para producir. Prioriza lo que está funcionando en Instagram en su nicho (adapta el formato y el ángulo, nunca copies) y las búsquedas o noticias que tocan su tema. Si las señales son pocas, completa con fechas y temporadas de las próximas semanas. Español de México, natural y cálido. Respeta la publicidad sanitaria (COFEPRIS): nada de prometer curas ni resultados garantizados.`;
  const r = await claude.messages.create({
    model: MODELO,
    max_tokens: 4000,
    system: "Eres el departamento de Tendencias de una agencia boutique de marketing médico en México. Conviertes lo que se está moviendo en redes y búsquedas en ideas de contenido concretas y fáciles de grabar. Nunca inventes datos ni cifras.",
    tools: [{ name: "guardar_ideas", description: "Guarda las ideas propuestas.", input_schema: IDEAS_SCHEMA }],
    tool_choice: { type: "tool", name: "guardar_ideas" },
    messages: [{ role: "user", content: pedido }],
  });
  const uso = r.content.find((b) => b.type === "tool_use");
  return uso?.input?.ideas || [];
}

// Se pueden cambiar en las pruebas para no salir a internet.
const fuentes = { google: googleDirecto, noticias: noticiasDe, instagram: instagramDe, ideas: ideasConClaude };
export function _fuentesDePrueba(cambios) { Object.assign(fuentes, cambios); }

// ---------- Buscar ----------
const corriendo = new Map();

/** Busca las tendencias del cliente y deja ideas nuevas. Tarda unos segundos (sale a internet). */
export function buscarTendencias(cliente) {
  const c = clienteRequerido(cliente);
  if (corriendo.has(c.id)) return corriendo.get(c.id);
  const p = buscar(c).finally(() => corriendo.delete(c.id));
  corriendo.set(c.id, p);
  return p;
}

async function buscar(c) {
  const { palabras, cuentas } = configCliente(c);
  const avisos = [];
  const [hoy, nots, ig] = await Promise.all([
    busquedasHoy(),
    palabras.length ? fuentes.noticias(palabras).catch((e) => ({ lista: [], avisos: [e.message] })) : { lista: [], avisos: [] },
    cuentas.length && meta.metaConectado() ? fuentes.instagram(cuentas, c.id).catch((e) => ({ lista: [], avisos: [e.message] })) : { lista: [], avisos: [] },
  ]);
  if (hoy.error) avisos.push(hoy.error);
  avisos.push(...nots.avisos, ...ig.avisos);
  if (cuentas.length && !meta.metaConectado()) avisos.push("Meta no está conectado: no se pudieron ver las cuentas de Instagram de referencia.");
  const senales = {
    instagram: ig.lista,
    busquedas: relevantes(hoy.lista, palabras).slice(0, 6),
    noticias: nots.lista,
    hoy_en_mexico: hoy.lista.slice(0, 10).map((t) => ({ tema: t.tema, busquedas: t.busquedas })),
  };
  const b = db.prepare("INSERT INTO tendencias_busquedas (cliente_id, senales, avisos) VALUES (?,?,?)").run(c.id, JSON.stringify(senales), JSON.stringify(avisos));
  let ideas = null;
  try {
    ideas = await fuentes.ideas(c, { ...senales, hoy_en_mexico: senales.hoy_en_mexico.slice(0, 6) }, palabras);
  } catch (e) {
    console.error("[tendencias]", e);
    avisos.push("No se pudieron preparar las ideas esta vez. Intenta de nuevo en un rato.");
    db.prepare("UPDATE tendencias_busquedas SET avisos = ? WHERE id = ?").run(JSON.stringify(avisos), b.lastInsertRowid);
  }
  const nuevas = guardarIdeas(c.id, b.lastInsertRowid, ideas || []);
  // Solo se guardan las últimas 8 búsquedas por cliente.
  db.prepare("DELETE FROM tendencias_busquedas WHERE cliente_id = ? AND id NOT IN (SELECT id FROM tendencias_busquedas WHERE cliente_id = ? ORDER BY id DESC LIMIT 8)").run(c.id, c.id);
  return { ...tendenciasCliente(c.id), ideas_nuevas: nuevas, sin_claude: ideas === null && !process.env.ANTHROPIC_API_KEY };
}

function guardarIdeas(clienteId, busquedaId, ideas) {
  const ins = db.prepare(`INSERT INTO tendencias_ideas (cliente_id, busqueda_id, titulo, gancho, formato, red, por_que, pasos, basada_en, urgencia)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
  let n = 0;
  // Las ideas nuevas que nadie usó de la búsqueda anterior se archivan para que no se amontonen.
  if (ideas.length) db.prepare("UPDATE tendencias_ideas SET estado = 'descartada' WHERE cliente_id = ? AND estado = 'nueva' AND creado < ?").run(clienteId, new Date(Date.now() - 14 * DIA).toISOString());
  for (const i of ideas.slice(0, 8)) {
    const titulo = String(i.titulo || "").trim().slice(0, 200);
    if (!titulo) continue;
    ins.run(clienteId, busquedaId, titulo, String(i.gancho || "").slice(0, 400) || null,
      FORMATOS[i.formato] ? i.formato : "reel", REDES[i.red] ? i.red : "instagram", String(i.por_que || "").slice(0, 400) || null,
      JSON.stringify((Array.isArray(i.pasos) ? i.pasos : []).map((x) => String(x).slice(0, 300)).slice(0, 6)),
      String(i.basada_en || "").slice(0, 300) || null, ["hoy", "semana", "siempre"].includes(i.urgencia) ? i.urgencia : "semana");
    n++;
  }
  return n;
}

// ---------- Leer ----------
const ORDEN_URGENCIA = { hoy: 0, semana: 1, siempre: 2 };
function idea(x) {
  return {
    id: x.id, titulo: x.titulo, gancho: x.gancho, formato: x.formato, formato_nombre: FORMATOS[x.formato] || x.formato,
    red: x.red, red_nombre: REDES[x.red] || x.red, por_que: x.por_que, pasos: json(x.pasos, []), basada_en: x.basada_en,
    urgencia: x.urgencia, estado: x.estado, contenido_id: x.contenido_id, creado: x.creado,
  };
}

export function tendenciasCliente(cliente) {
  const c = clienteRequerido(cliente);
  const cfg = configCliente(c);
  const b = db.prepare("SELECT * FROM tendencias_busquedas WHERE cliente_id = ? ORDER BY id DESC LIMIT 1").get(c.id);
  const ideas = db.prepare("SELECT * FROM tendencias_ideas WHERE cliente_id = ? AND estado != 'descartada' ORDER BY id DESC LIMIT 40").all(c.id).map(idea);
  const nuevas = ideas.filter((i) => i.estado === "nueva").sort((a, z) => ORDEN_URGENCIA[a.urgencia] - ORDEN_URGENCIA[z.urgencia] || z.id - a.id);
  return {
    cliente: { id: c.id, nombre: c.nombre, industria: c.industria },
    ...cfg,
    meta_conectado: meta.metaConectado(),
    ultima: b?.fecha || null,
    senales: b ? json(b.senales, {}) : null,
    avisos: b ? json(b.avisos, []) : [],
    ideas: nuevas,
    usadas: ideas.filter((i) => i.estado === "usada").slice(0, 10),
    buscando: corriendo.has(c.id),
  };
}

/** Tablero: lo que México busca hoy y el resumen por cliente; con cliente, también su detalle. */
export async function tableroTendencias({ cliente } = {}) {
  const hoy = await busquedasHoy();
  const clientes = listarClientes({ estado: "activo" }).map((c) => {
    const cfg = configCliente(c);
    const u = db.prepare("SELECT fecha FROM tendencias_busquedas WHERE cliente_id = ? ORDER BY id DESC LIMIT 1").get(c.id);
    const n = db.prepare("SELECT COUNT(*) n FROM tendencias_ideas WHERE cliente_id = ? AND estado = 'nueva'").get(c.id).n;
    return { id: c.id, nombre: c.nombre, palabras: cfg.palabras, cuentas: cfg.cuentas.length, ultima: u?.fecha || null, ideas_nuevas: n };
  });
  return {
    hoy: { ...hoy, lista: hoy.lista.slice(0, 12) },
    clientes,
    ideas_nuevas: clientes.reduce((s, c) => s + c.ideas_nuevas, 0),
    detalle: cliente ? tendenciasCliente(cliente) : null,
    claude: Boolean(process.env.ANTHROPIC_API_KEY),
  };
}

export const ideasNuevas = () => db.prepare("SELECT COUNT(*) n FROM tendencias_ideas i JOIN clientes c ON c.id = i.cliente_id WHERE i.estado = 'nueva' AND c.estado = 'activo'").get().n;

// ---------- Usar las ideas ----------
function ideaRequerida(id) {
  const x = db.prepare("SELECT * FROM tendencias_ideas WHERE id = ?").get(Number(id));
  if (!x) throw new Error(`No existe la idea ${id}`);
  return x;
}

/** Pasa una idea al tablero de Contenido (etapa "planeado"), con el gancho y los pasos en las notas. */
export function ideaAContenido(id, { publicar, responsable } = {}) {
  const x = ideaRequerida(id);
  if (x.estado === "usada" && x.contenido_id) throw new Error("Esa idea ya está en Contenido");
  const i = idea(x);
  const notas = [
    i.gancho && `Gancho: "${i.gancho}"`,
    i.pasos.length && i.pasos.map((p, n) => `${n + 1}. ${p}`).join("\n"),
    i.por_que && `Por qué: ${i.por_que}`,
    i.basada_en && `Tendencia: ${i.basada_en}`,
  ].filter(Boolean).join("\n\n");
  const pieza = crearContenido({ cliente: x.cliente_id, titulo: i.titulo, formato: i.formato, red: i.red, etapa: "planeado", publicar: publicar || null, responsable, notas });
  db.prepare("UPDATE tendencias_ideas SET estado = 'usada', contenido_id = ? WHERE id = ?").run(pieza.id, x.id);
  return { idea: idea(ideaRequerida(id)), pieza };
}

export function descartarIdea(id) {
  ideaRequerida(id);
  db.prepare("UPDATE tendencias_ideas SET estado = 'descartada' WHERE id = ?").run(Number(id));
  return { ok: true };
}

/** Busca una idea nueva por su título (para DELTA: "pasa la idea del reel de colesterol a contenido"). */
export function buscarIdea({ titulo, cliente } = {}) {
  const q = normal(titulo).trim();
  if (!q) throw new Error("Falta decir qué idea");
  const c = cliente ? clienteRequerido(cliente) : null;
  const l = db.prepare(`SELECT * FROM tendencias_ideas WHERE estado = 'nueva' ${c ? "AND cliente_id = ?" : ""} ORDER BY id DESC LIMIT 200`).all(...(c ? [c.id] : []))
    .filter((x) => normal(x.titulo).includes(q));
  if (!l.length) throw new Error(`No encuentro una idea nueva que diga "${titulo}"`);
  if (l.length > 1) throw new Error(`Hay varias ideas con "${titulo}": ${l.slice(0, 5).map((x) => x.titulo).join(" | ")}. ¿Cuál?`);
  return idea(l[0]);
}

// ---------- Cada lunes ----------
/** Lunes desde las 8:00: busca tendencias de todos los clientes activos (una vez por semana) y avisa. */
export async function revisarSemana({ ahora = ahoraLocalISO(), avisarDueno = true } = {}) {
  if (getAjuste("rutina_tendencias_clientes", "si") !== "si") return null;
  const dia = new Date(ahora.slice(0, 10) + "T12:00:00Z").getUTCDay();
  const semana = ahora.slice(0, 10);
  if (dia !== 1 || ahora.slice(11, 16) < "08:00" || getAjuste("tendencias_semana") === semana) return null;
  setAjuste("tendencias_semana", semana);
  const activos = listarClientes({ estado: "activo" }).filter((c) => configCliente(c).palabras.length || configCliente(c).cuentas.length);
  let total = 0;
  const con = [];
  for (const c of activos) {
    try {
      const r = await buscarTendencias(c.id);
      total += r.ideas_nuevas;
      if (r.ideas_nuevas) con.push(c.nombre);
    } catch (e) { console.error("[tendencias]", c.nombre, e.message); }
  }
  if (avisarDueno && total) {
    await avisar(`Ya están las tendencias de la semana: ${total} idea${total === 1 ? "" : "s"} nueva${total === 1 ? "" : "s"} para ${con.join(", ")}. Están en Tendencias, listas para pasar a Contenido.`, "Tendencias").catch(() => {});
  }
  return { clientes: activos.length, ideas: total };
}

export function iniciarTendencias() {
  const ciclo = () => revisarSemana().catch((e) => console.error("[tendencias]", e));
  setTimeout(ciclo, 60e3);
  return setInterval(ciclo, 15 * 60e3);
}
