// Noticias por tema: Google Noticias (RSS gratuito, sin clave).
import { getAjuste, setAjuste } from "./db.js";
import { conCache } from "./cache.js";

export const TEMAS_INICIALES = [
  "marketing digital",
  "tendencias",
  "inteligencia artificial",
  "ciencia",
  "arte",
  "cine",
  "economía mundial",
  "política México",
];

export function temas() {
  try {
    const t = JSON.parse(getAjuste("temas_noticias", "null"));
    if (Array.isArray(t)) return t;
  } catch {}
  return TEMAS_INICIALES;
}

export function agregarTema(tema) {
  const t = String(tema || "").trim().slice(0, 80);
  if (!t) throw new Error("Tema vacío");
  const l = temas().filter((x) => x.toLowerCase() !== t.toLowerCase());
  l.push(t);
  if (l.length > 15) throw new Error("Ya hay 15 temas; quite alguno primero");
  setAjuste("temas_noticias", JSON.stringify(l));
  return l;
}

export function quitarTema(tema) {
  const antes = temas();
  const l = antes.filter((x) => x.toLowerCase() !== String(tema).trim().toLowerCase());
  if (l.length === antes.length) throw new Error(`"${tema}" no está en sus temas`);
  setAjuste("temas_noticias", JSON.stringify(l));
  return l;
}

const ENTIDADES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'" };
const texto = (s) =>
  String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|apos);/g, (m) => ENTIDADES[m])
    .trim();
const campo = (item, tag) => texto((item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1]);

/** Lee un RSS y devuelve sus noticias. Separado para poder probarlo. */
export function leerRSS(xml) {
  return [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
    const fuente = campo(item, "source");
    let titulo = campo(item, "title");
    if (fuente && titulo.endsWith(` - ${fuente}`)) titulo = titulo.slice(0, -(fuente.length + 3));
    const fecha = campo(item, "pubDate");
    return { titulo, fuente, enlace: campo(item, "link"), fecha: fecha ? new Date(fecha).toISOString() : null };
  });
}

export function noticias(tema, max = 6, dias = 1) {
  // Diez minutos de memoria por tema.
  return conCache(`noticias:${String(tema).toLowerCase()}:${max}:${dias}`, 10 * 60e3, () => noticiasDirecto(tema, max, dias));
}

async function noticiasDirecto(tema, max, dias) {
  const q = `${tema} when:${Math.max(1, Math.min(7, dias))}d`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=es-419&gl=MX&ceid=MX:es-419`;
  const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (DELTA asistente)" }, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`Google Noticias respondió ${r.status}`);
  return leerRSS(await r.text()).slice(0, Math.max(1, Math.min(15, max)));
}

/** Titulares de todos los temas guardados. */
export async function titulares(porTema = 3) {
  const lista = temas();
  const res = await Promise.allSettled(lista.map((t) => noticias(t, porTema)));
  return lista.map((tema, i) => (res[i].status === "fulfilled" ? { tema, noticias: res[i].value } : { tema, error: res[i].reason.message }));
}
