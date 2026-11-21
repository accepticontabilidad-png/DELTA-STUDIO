// Centro de noticias: titulares del mundo ubicados en el globo, videos de noticieros
// y un resumen de la situación hecho por DELTA. Fuentes gratuitas, sin clave.
import Anthropic from "@anthropic-ai/sdk";
import { getAjuste, setAjuste } from "./db.js";
import { conCache } from "./cache.js";
import { noticias, leerRSS } from "./noticias.js";

const UA = { "User-Agent": "Mozilla/5.0 (DELTA asistente)" };

// Búsquedas que alimentan el globo. "centro" es dónde cae la noticia si el titular no nombra un lugar.
export const REGIONES = [
  { consulta: "noticias internacionales", region: "Mundo" },
  { consulta: "México", region: "México", centro: [23.6, -102.5] },
  { consulta: "Estados Unidos", region: "Estados Unidos", centro: [39.5, -98.4] },
  { consulta: "América Latina", region: "América Latina", centro: [-10, -60] },
  { consulta: "Europa", region: "Europa", centro: [50, 10] },
  { consulta: "Medio Oriente", region: "Medio Oriente", centro: [29, 45] },
  { consulta: "Asia China Japón India", region: "Asia", centro: [30, 105] },
  { consulta: "África", region: "África", centro: [5, 20] },
  { consulta: "economía mundial mercados", region: "Mundo" },
];

// Lugares que DELTA reconoce en un titular (sin acentos, en minúsculas). El primero que aparezca gana.
const L = (lat, lon, ...nombres) => ({ lat, lon, nombres });
export const LUGARES = {
  "Ciudad de México": L(19.43, -99.13, "cdmx", "ciudad de mexico"),
  Monterrey: L(25.69, -100.32, "monterrey", "nuevo leon"),
  Guadalajara: L(20.67, -103.35, "guadalajara", "jalisco"),
  Sinaloa: L(24.8, -107.39, "sinaloa", "culiacan"),
  Chihuahua: L(28.63, -106.07, "chihuahua", "ciudad juarez"),
  Tamaulipas: L(24.27, -98.84, "tamaulipas"),
  Oaxaca: L(17.07, -96.72, "oaxaca"),
  Chiapas: L(16.75, -93.12, "chiapas"),
  Guerrero: L(17.55, -99.5, "guerrero", "acapulco"),
  Michoacán: L(19.57, -101.71, "michoacan"),
  Veracruz: L(19.17, -96.13, "veracruz"),
  Yucatán: L(20.97, -89.62, "yucatan", "merida", "cancun", "quintana roo"),
  "Baja California": L(32.52, -117.04, "tijuana", "baja california"),
  México: L(23.6, -102.5, "mexico", "mexicano", "mexicana", "sheinbaum", "banxico", "pemex"),
  Washington: L(38.9, -77.04, "washington", "casa blanca", "trump", "congreso de eu", "reserva federal", "la fed"),
  "Nueva York": L(40.71, -74.0, "nueva york", "wall street", "naciones unidas"),
  California: L(36.78, -119.42, "california", "los angeles", "silicon valley", "san francisco"),
  Texas: L(31.0, -100.0, "texas", "houston", "dallas"),
  Florida: L(27.66, -81.52, "florida", "miami"),
  "Estados Unidos": L(39.5, -98.4, "estados unidos", "eeuu", "ee.uu", "eu ", "estadounidense"),
  Canadá: L(56.1, -106.3, "canada", "canadiense", "carney"),
  Guatemala: L(15.78, -90.23, "guatemala"),
  Honduras: L(15.2, -86.24, "honduras"),
  "El Salvador": L(13.79, -88.9, "el salvador", "bukele"),
  Nicaragua: L(12.87, -85.21, "nicaragua"),
  "Costa Rica": L(9.75, -83.75, "costa rica"),
  Panamá: L(8.54, -80.78, "panama"),
  Cuba: L(21.52, -77.78, "cuba", "la habana"),
  Haití: L(18.97, -72.29, "haiti"),
  "República Dominicana": L(18.74, -70.16, "republica dominicana"),
  "Puerto Rico": L(18.22, -66.59, "puerto rico"),
  Venezuela: L(6.42, -66.59, "venezuela", "caracas", "maduro"),
  Colombia: L(4.57, -74.3, "colombia", "bogota", "petro"),
  Ecuador: L(-1.83, -78.18, "ecuador", "quito"),
  Perú: L(-9.19, -75.02, "peru", "lima"),
  Bolivia: L(-16.29, -63.59, "bolivia"),
  Brasil: L(-14.24, -51.93, "brasil", "lula", "sao paulo", "rio de janeiro"),
  Chile: L(-35.68, -71.54, "chile", "santiago de chile"),
  Argentina: L(-38.42, -63.62, "argentina", "buenos aires", "milei"),
  Uruguay: L(-32.52, -55.77, "uruguay"),
  Paraguay: L(-23.44, -58.44, "paraguay"),
  "Reino Unido": L(51.51, -0.13, "reino unido", "londres", "britanico", "britanica", "inglaterra"),
  España: L(40.42, -3.7, "espana", "madrid", "barcelona", "espanol"),
  Francia: L(48.86, 2.35, "francia", "paris", "macron", "frances"),
  Alemania: L(52.52, 13.4, "alemania", "berlin", "aleman"),
  Italia: L(41.9, 12.5, "italia", "roma", "italiano"),
  Vaticano: L(41.9, 12.45, "vaticano", "papa leon", "el papa"),
  Portugal: L(38.72, -9.14, "portugal", "lisboa"),
  "Países Bajos": L(52.37, 4.9, "paises bajos", "holanda", "amsterdam"),
  Bruselas: L(50.85, 4.35, "belgica", "bruselas", "union europea", "comision europea", "otan"),
  Europa: L(50, 10, "europa", "europeo", "europea"),
  Suiza: L(46.95, 7.45, "suiza", "ginebra", "davos"),
  Polonia: L(52.23, 21.01, "polonia", "varsovia"),
  Ucrania: L(50.45, 30.52, "ucrania", "kiev", "kyiv", "zelenski"),
  Rusia: L(55.76, 37.62, "rusia", "moscu", "putin", "kremlin", "ruso", "rusa"),
  Turquía: L(39.93, 32.86, "turquia", "estambul", "erdogan"),
  Grecia: L(37.98, 23.73, "grecia", "atenas"),
  Israel: L(31.77, 35.21, "israel", "israeli", "netanyahu", "jerusalen", "tel aviv"),
  Gaza: L(31.5, 34.47, "gaza", "palestina", "palestino", "hamas", "cisjordania"),
  Líbano: L(33.89, 35.5, "libano", "beirut", "hezbola"),
  Siria: L(33.51, 36.29, "siria", "damasco"),
  Irán: L(35.69, 51.39, "iran", "teheran", "irani"),
  Irak: L(33.31, 44.36, "irak", "bagdad"),
  "Arabia Saudita": L(24.71, 46.68, "arabia saudita", "saudi", "riad", "opep"),
  Yemen: L(15.37, 44.19, "yemen", "huties"),
  Emiratos: L(25.2, 55.27, "emiratos", "dubai", "abu dabi", "qatar", "catar", "doha"),
  Egipto: L(30.04, 31.24, "egipto", "el cairo"),
  Sudán: L(15.5, 32.56, "sudan", "jartum"),
  Nigeria: L(9.08, 7.4, "nigeria"),
  Kenia: L(-1.29, 36.82, "kenia", "nairobi"),
  Etiopía: L(9.03, 38.74, "etiopia"),
  Congo: L(-4.32, 15.31, "congo", "kinshasa"),
  Sudáfrica: L(-25.75, 28.19, "sudafrica", "johannesburgo", "ciudad del cabo"),
  Marruecos: L(33.97, -6.85, "marruecos", "rabat"),
  India: L(28.61, 77.21, "india", "nueva delhi", "modi", "bombay"),
  Pakistán: L(33.68, 73.05, "pakistan"),
  Afganistán: L(34.56, 69.21, "afganistan", "talibanes"),
  China: L(39.9, 116.4, "china", "pekin", "beijing", "xi jinping", "chino", "china", "shanghai"),
  "Hong Kong": L(22.32, 114.17, "hong kong"),
  Taiwán: L(25.03, 121.57, "taiwan"),
  Japón: L(35.68, 139.69, "japon", "tokio", "japones"),
  "Corea del Sur": L(37.57, 126.98, "corea del sur", "seul"),
  "Corea del Norte": L(39.04, 125.76, "corea del norte", "pyongyang", "kim jong"),
  Filipinas: L(14.6, 120.98, "filipinas", "manila"),
  Vietnam: L(21.03, 105.85, "vietnam"),
  Tailandia: L(13.76, 100.5, "tailandia", "bangkok"),
  Indonesia: L(-6.21, 106.85, "indonesia", "yakarta"),
  Australia: L(-35.28, 149.13, "australia", "sidney", "sydney"),
  "Medio Oriente": L(29, 45, "medio oriente"),
  Antártida: L(-75, 0, "antartida", "antartico"),
};

const normal = (s) => ` ${String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9.]+/g, " ")} `;
const BUSCADOR = Object.entries(LUGARES).flatMap(([lugar, d]) => d.nombres.map((n) => ({ lugar, n: ` ${n.trim()} ` })));

/** Dónde ocurre una noticia según su titular (o null si no nombra un lugar conocido). */
export function ubicar(titulo) {
  const t = normal(titulo);
  let mejor = null;
  for (const b of BUSCADOR) {
    const i = t.indexOf(b.n);
    if (i >= 0 && (!mejor || i < mejor.i)) mejor = { i, lugar: b.lugar };
  }
  if (!mejor) return null;
  const d = LUGARES[mejor.lugar];
  return { lugar: mejor.lugar, lat: d.lat, lon: d.lon };
}

/** Junta titulares por lugar para pintarlos como puntos en el globo. Separado para poder probarlo. */
export function agruparPorLugar(grupos) {
  const puntos = new Map();
  const vistos = new Set();
  const sinLugar = [];
  for (const g of grupos) {
    for (const n of g.noticias || []) {
      const clave = normal(n.titulo).slice(0, 70);
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      const u = ubicar(n.titulo) || (g.centro ? { lugar: g.region, lat: g.centro[0], lon: g.centro[1] } : null);
      const nota = { ...n, region: g.region };
      if (!u) { sinLugar.push(nota); continue; }
      if (!puntos.has(u.lugar)) puntos.set(u.lugar, { ...u, noticias: [] });
      puntos.get(u.lugar).noticias.push(nota);
    }
  }
  const orden = (a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0);
  const lista = [...puntos.values()].map((p) => ({ ...p, noticias: p.noticias.sort(orden) })).sort((a, b) => b.noticias.length - a.noticias.length);
  return { puntos: lista, sin_lugar: sinLugar.sort(orden) };
}

export function mapa() {
  return conCache("panorama:mapa", 10 * 60e3, async () => {
    const res = await Promise.allSettled(REGIONES.map((r) => noticias(r.consulta, 8)));
    const grupos = REGIONES.map((r, i) => ({ ...r, noticias: res[i].status === "fulfilled" ? res[i].value : [] }));
    if (!grupos.some((g) => g.noticias.length)) throw new Error("No se pudieron cargar las noticias del mundo");
    return { ...agruparPorLugar(grupos), hora: new Date().toISOString() };
  });
}

// ---------- Videos de noticieros (YouTube, RSS público) ----------
export const CANALES = [
  { handle: "nmas", nombre: "N+" },
  { handle: "MilenioTV", nombre: "Milenio" },
  { handle: "CNNee", nombre: "CNN en Español" },
  { handle: "dwespanol", nombre: "DW Español" },
  { handle: "BBCMundo", nombre: "BBC Mundo" },
  { handle: "euronewsES", nombre: "Euronews" },
];

/** Saca el id del canal de la página pública de YouTube (se guarda para no repetirlo). */
export function idDeCanal(html) {
  const m = String(html).match(/"(?:externalId|channelId)":"(UC[\w-]{22})"/) || String(html).match(/youtube\.com\/channel\/(UC[\w-]{22})/);
  return m ? m[1] : null;
}

async function canalId(handle) {
  const guardados = JSON.parse(getAjuste("canales_youtube", "{}") || "{}");
  if (guardados[handle]) return guardados[handle];
  const r = await fetch(`https://www.youtube.com/@${encodeURIComponent(handle)}`, { headers: { ...UA, "Accept-Language": "es" }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`YouTube respondió ${r.status}`);
  const id = idDeCanal(await r.text());
  if (!id) throw new Error("No se encontró el canal");
  setAjuste("canales_youtube", JSON.stringify({ ...guardados, [handle]: id }));
  return id;
}

/** Lee el RSS de un canal de YouTube. Separado para poder probarlo. */
export function leerVideos(xml, canal) {
  return [...String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => {
    const id = (e.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/) || [])[1];
    const titulo = leerRSS(`<item><title>${(e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || ""}</title></item>`)[0]?.titulo || "";
    const fecha = (e.match(/<published>([^<]+)<\/published>/) || [])[1];
    return id ? { id, titulo, canal, fecha: fecha ? new Date(fecha).toISOString() : null, imagen: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` } : null;
  }).filter(Boolean);
}

export function videos(max = 8) {
  return conCache("panorama:videos", 15 * 60e3, async () => {
    const res = await Promise.allSettled(CANALES.map(async (c) => {
      const id = await canalId(c.handle);
      const r = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, { headers: UA, signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(`YouTube respondió ${r.status}`);
      return leerVideos(await r.text(), c.nombre).slice(0, 3);
    }));
    const todos = res.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    // Alterna canales para que no salgan todos del mismo noticiero.
    const porCanal = new Map();
    for (const v of todos.sort((a, b) => new Date(b.fecha || 0) - new Date(a.fecha || 0))) {
      if (!porCanal.has(v.canal)) porCanal.set(v.canal, []);
      porCanal.get(v.canal).push(v);
    }
    const salida = [];
    for (let ronda = 0; salida.length < max && ronda < 3; ronda++) for (const l of porCanal.values()) if (l[ronda] && salida.length < max) salida.push(l[ronda]);
    return salida;
  });
}

// ---------- Resumen de la situación (lo escribe DELTA con un modelo ligero) ----------
const MODELO_RESUMEN = process.env.DELTA_MODELO_LIGERO || "claude-haiku-5-5";
const VIDA_RESUMEN = 3 * 3600e3; // se rehace cada 3 horas como máximo (cuida el gasto)
let cliente = null;

export function resumenGuardado() {
  try { return JSON.parse(getAjuste("resumen_situacion", "null")); } catch { return null; }
}

let enCurso = null;
export async function resumen(forzar = false) {
  const g = resumenGuardado();
  const edad = g ? Date.now() - new Date(g.hora).getTime() : Infinity;
  if (edad < (forzar ? 10 * 60e3 : VIDA_RESUMEN)) return g; // aunque lo pidan, no más de uno cada 10 min
  if (!process.env.ANTHROPIC_API_KEY) return g || { texto: null, hora: null, error: "Falta la llave de Claude" };
  return (enCurso ||= hacerResumen().finally(() => { enCurso = null; }));
}

async function hacerResumen() {
  const m = await mapa();
  const titulares = [...m.puntos.flatMap((p) => p.noticias.slice(0, 3).map((n) => `[${p.lugar}] ${n.titulo} (${n.fuente})`)), ...m.sin_lugar.slice(0, 8).map((n) => `[${n.region}] ${n.titulo} (${n.fuente})`)].slice(0, 60);
  cliente ||= new Anthropic();
  const r = await cliente.messages.create({
    model: MODELO_RESUMEN,
    max_tokens: 900,
    system: "Eres DELTA, la asistente personal (mujer, cálida, clara y nada robótica) de un empresario mexicano dueño de una agencia de marketing. Escribes en español de México.",
    messages: [{
      role: "user",
      content: `Estos son los titulares de las últimas horas:\n\n${titulares.join("\n")}\n\nEscribe un "resumen de la situación" del mundo para tu jefe. Formato exacto:\n- Primera línea: una frase de panorama general (máximo 25 palabras).\n- Luego de 4 a 6 líneas, cada una empezando con "• " y el nombre del lugar o tema en mayúsculas seguido de dos puntos, con lo esencial en una o dos frases.\n- Última línea, empezando con "Ojo: ", lo que podría afectar a México, a los mercados o a su negocio.\nSolo usa lo que dicen los titulares; no inventes datos. Sin markdown ni negritas.`,
    }],
  });
  const texto = r.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  if (!texto) throw new Error("No se pudo escribir el resumen");
  const nuevo = { texto, hora: new Date().toISOString(), fuentes: titulares.length };
  setAjuste("resumen_situacion", JSON.stringify(nuevo));
  return nuevo;
}
