// SEO y web: cómo está el sitio de cada cliente y cómo le va en Google.
//
// Dos partes:
//  1. Revisión del sitio (no necesita nada conectado): DELTA abre la página de inicio y hasta 9 páginas más,
//     revisa títulos, descripciones, encabezados, imágenes sin texto, si Google la puede ver, sitemap, robots,
//     y mide la velocidad en celular con Google PageSpeed. Resultado: "páginas por mejorar" en palabras sencillas.
//  2. Google (opcional): con "Conectar Google para SEO" (las mismas GOOGLE_CLIENT_ID/SECRET de Gmail),
//     Search Console da clics, apariciones y posición en Google; Analytics da las visitas al sitio.
// Solo LEE. No cambia nada del sitio.
import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import { db, getAjuste, setAjuste } from "./db.js";
import { listarClientes, clienteRequerido } from "./agencia.js";
import { conCache, olvidarCache } from "./cache.js";
import { ahoraLocalISO } from "./tiempo.js";
import { avisar } from "./avisos.js";

const DIA = 864e5;
const MAX_PAGINAS = 10;
const MAX_BYTES = 2_000_000;
const AGENTE = "Mozilla/5.0 (compatible; DELTA-SEO/1.0; revision del sitio)";

db.exec(`
CREATE TABLE IF NOT EXISTS seo_config (
  cliente_id INTEGER PRIMARY KEY REFERENCES clientes(id),
  sitio TEXT,                                    -- https://clinica.mx
  gsc_sitio TEXT,                                -- propiedad de Search Console (sc-domain:clinica.mx o https://clinica.mx/)
  ga4_propiedad TEXT,                            -- properties/123456
  actualizado TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS seo_revisiones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  fecha TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  datos TEXT NOT NULL
);
`);

const json = (t, d) => { try { return JSON.parse(t) ?? d; } catch { return d; } };
const redondo = (n, d = 1) => (n === null || n === undefined || isNaN(n) ? null : Math.round(n * 10 ** d) / 10 ** d);

// ---------- Direcciones ----------
/** Deja una dirección de sitio limpia: "clinica.mx" → "https://clinica.mx". */
export function normalizarSitio(t) {
  let s = String(t || "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  let u;
  try { u = new URL(s); } catch { throw new Error(`"${t}" no parece la dirección de un sitio`); }
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname)) throw new Error(`"${t}" no parece la dirección de un sitio`);
  return `${u.protocol}//${u.hostname.toLowerCase()}${u.port ? ":" + u.port : ""}`;
}
const dominio = (u) => { if (/^sc-domain:/.test(u)) return u.slice(10).replace(/^www\./, "").toLowerCase(); try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return String(u || "").replace(/^sc-domain:/, "").replace(/^www\./, "").toLowerCase(); } };
const REDES = /instagram|facebook|fb\.com|tiktok|youtube|youtu\.be|linkedin|twitter|x\.com|wa\.me|whatsapp|linktr\.ee|google\.com|maps\.app/i;

/** Busca el sitio web en el texto libre de "redes" del cliente. */
export function sitioDeTexto(texto) {
  const l = String(texto || "").match(/(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/[^\s,;]*)?/gi) || [];
  const s = l.find((x) => !REDES.test(x) && !/@/.test(x));
  try { return s ? normalizarSitio(s) : null; } catch { return null; }
}

// No se deja revisar direcciones internas (la red de Railway, la propia máquina…).
function ipPrivada(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const x = ip.toLowerCase();
  return x === "::1" || x === "::" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe80") || x.startsWith("::ffff:127.") || x.startsWith("::ffff:10.") || x.startsWith("::ffff:192.168.");
}
async function hostPublico(url) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error("Solo se revisan páginas web (http o https)");
  if (u.hostname === "localhost" || net.isIP(u.hostname)) throw new Error("Solo se revisan sitios públicos");
  const ips = await dns.lookup(u.hostname, { all: true }).catch(() => { throw new Error(`No existe el sitio ${u.hostname} (no se encontró en internet)`); });
  if (ips.some((i) => ipPrivada(i.address))) throw new Error("Solo se revisan sitios públicos");
}

/** Abre una página siguiendo hasta 5 redirecciones (cada una revisada). */
async function pedirPagina(url) {
  let actual = url;
  const inicio = Date.now();
  for (let i = 0; i < 6; i++) {
    await hostPublico(actual);
    const r = await fetch(actual, { redirect: "manual", headers: { "User-Agent": AGENTE, Accept: "text/html,application/xhtml+xml,*/*;q=0.5" }, signal: AbortSignal.timeout(15000) });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) {
      actual = new URL(r.headers.get("location"), actual).href;
      continue;
    }
    const tipo = r.headers.get("content-type") || "";
    let html = "";
    if (/html|xml|text\/plain/i.test(tipo) && r.body) {
      const lector = r.body.getReader();
      const partes = [];
      let n = 0;
      for (;;) {
        const { done, value } = await lector.read();
        if (done) break;
        partes.push(value);
        n += value.length;
        if (n > MAX_BYTES) { lector.cancel().catch(() => {}); break; }
      }
      html = Buffer.concat(partes).toString("utf8");
    }
    return { status: r.status, url: actual, html, tipo, ms: Date.now() - inicio, redirecciones: i };
  }
  throw new Error("La página redirige demasiadas veces");
}

// ---------- Leer una página ----------
const ENT = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " " };
const limpiar = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENT[m]).replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/\s+/g, " ").trim();
const atributo = (tag, nombre) => { const m = tag.match(new RegExp(`\\s${nombre}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")); return m ? (m[2] ?? m[3] ?? m[4] ?? "") : null; };
const metas = (html) => [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
const metaCon = (html, attr, valor) => metas(html).find((t) => (atributo(t, attr) || "").toLowerCase() === valor);

/** Lo importante de una página para SEO. Separado para poder probarlo. */
export function analizarHTML(html, url) {
  const h = String(html || "").replace(/<!--[\s\S]*?-->/g, "").replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<style\b[\s\S]*?<\/style>/gi, "");
  const titulo = limpiar((h.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  const desc = metaCon(h, "name", "description");
  const robots = metaCon(h, "name", "robots");
  const canon = [...h.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]).find((t) => (atributo(t, "rel") || "").toLowerCase() === "canonical");
  const h1 = [...h.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => limpiar(m[1])).filter(Boolean);
  const imgs = [...h.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const sinAlt = imgs.filter((t) => { const a = atributo(t, "alt"); return a === null || !a.trim(); }).length;
  const base = new URL(url);
  const enlaces = new Set();
  for (const m of h.matchAll(/<a\b[^>]*>/gi)) {
    const href = atributo(m[0], "href");
    if (!href || /^(#|mailto:|tel:|javascript:|whatsapp:)/i.test(href)) continue;
    try {
      const u = new URL(href, base);
      if (u.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) continue;
      if (/\.(pdf|jpe?g|png|gif|webp|svg|zip|mp4|mp3|docx?|xlsx?)$/i.test(u.pathname)) continue;
      u.hash = "";
      if (/^(utm_|fbclid|gclid)/.test([...u.searchParams.keys()].join(","))) u.search = "";
      enlaces.add(u.href);
    } catch { /* enlace roto */ }
  }
  const palabras = limpiar(h.replace(/<(nav|footer|header)\b[\s\S]*?<\/\1>/gi, " ")).split(" ").filter((w) => w.length > 1).length;
  return {
    url,
    titulo: titulo || null,
    descripcion: desc ? limpiar(atributo(desc, "content")) || null : null,
    noindex: robots ? /noindex/i.test(atributo(robots, "content") || "") : false,
    canonical: canon ? atributo(canon, "href") : null,
    h1,
    imagenes: imgs.length,
    imagenes_sin_alt: sinAlt,
    celular: Boolean(metaCon(h, "name", "viewport")),
    idioma: (h.match(/<html\b[^>]*\slang\s*=\s*["']?([a-z-]+)/i) || [])[1] || null,
    imagen_compartir: Boolean(metaCon(h, "property", "og:image")),
    datos_estructurados: /application\/ld\+json/i.test(html || ""),
    palabras,
    enlaces: [...enlaces],
  };
}

/** Problemas de una página, en palabras sencillas, con qué hacer. */
export function problemasDePagina(p, { inicio = false } = {}) {
  const l = [];
  const meter = (nivel, texto, como) => l.push({ nivel, texto, como });
  if (p.status >= 400 || p.error) { meter("rojo", p.error ? `No abre: ${p.error}` : `No abre (error ${p.status})`, "Revisar que la página exista o quitar los enlaces que llevan a ella."); return l; }
  if (p.noindex) meter("rojo", "Está escondida de Google (noindex)", "Quitar la etiqueta noindex si esta página debe salir en Google.");
  if (!p.titulo) meter("rojo", "No tiene título", "Ponerle un título de 30 a 60 letras con el servicio y la ciudad.");
  else if (p.titulo.length < 25) meter("amarillo", `El título es muy corto (${p.titulo.length} letras)`, "Alargarlo a 30-60 letras con el servicio y la ciudad.");
  else if (p.titulo.length > 65) meter("amarillo", `El título es muy largo (${p.titulo.length} letras); Google lo corta`, "Dejarlo en 60 letras o menos.");
  if (!p.descripcion) meter("amarillo", "No tiene descripción para Google", "Escribir 1-2 frases (120-160 letras) que inviten a dar clic.");
  else if (p.descripcion.length > 170) meter("amarillo", "La descripción es muy larga; Google la corta", "Dejarla en 160 letras o menos.");
  else if (p.descripcion.length < 60) meter("amarillo", "La descripción es muy corta", "Alargarla a 120-160 letras.");
  if (!p.h1?.length) meter("amarillo", "No tiene encabezado principal (H1)", "Agregar un encabezado principal que diga de qué trata la página.");
  else if (p.h1.length > 1) meter("amarillo", `Tiene ${p.h1.length} encabezados principales (H1)`, "Dejar uno solo; los demás como subtítulos (H2).");
  if (p.imagenes_sin_alt) meter("amarillo", `${p.imagenes_sin_alt} imagen${p.imagenes_sin_alt === 1 ? "" : "es"} sin texto alternativo`, "Describir cada imagen (ayuda a Google y a personas con lector de pantalla).");
  if (p.palabras !== undefined && p.palabras < 150 && !inicio) meter("amarillo", `Tiene muy poco texto (${p.palabras} palabras)`, "Agregar al menos 300 palabras útiles sobre el tema.");
  if (inicio && !p.celular) meter("rojo", "No está hecha para verse en celular", "Agregar la etiqueta viewport y revisar el diseño en celular.");
  if (p.lento) meter("amarillo", `Tarda en responder (${(p.ms / 1000).toFixed(1)} s)`, "Revisar el hosting o el tamaño de la página.");
  return l;
}

/** Calificación del sitio de 0 a 100: lo técnico (60 %) y, si hay, la de Google PageSpeed (40 %). */
export function calificarSitio({ problemas, https, sitemap, pagespeed }) {
  let base = 100;
  const rojos = problemas.filter((x) => x.nivel === "rojo").length;
  const amarillos = problemas.filter((x) => x.nivel === "amarillo").length;
  base -= Math.min(45, rojos * 15) + Math.min(30, amarillos * 3);
  if (!https) base -= 15;
  if (!sitemap) base -= 5;
  base = Math.max(0, base);
  const g = pagespeed && [pagespeed.seo, pagespeed.velocidad].filter((x) => typeof x === "number");
  const total = g?.length ? base * 0.6 + (g.reduce((s, x) => s + x, 0) / g.length) * 0.4 : base;
  const puntos = Math.round(total);
  return { puntos, color: puntos >= 80 ? "verde" : puntos >= 60 ? "amarillo" : "rojo" };
}

/** ¿El robots.txt le cierra todo el sitio a Google ("Disallow: /" para todos o para Googlebot)? */
export function robotsBloqueaTodo(txt) {
  let agentes = [], enReglas = false, bloquea = false;
  for (const linea of String(txt || "").split(/\r?\n/)) {
    const [k, ...v] = linea.replace(/#.*/, "").split(":");
    const clave = k.trim().toLowerCase(), valor = v.join(":").trim();
    if (!clave) continue;
    if (clave === "user-agent") { if (enReglas) { agentes = []; enReglas = false; } agentes.push(valor.toLowerCase()); continue; }
    enReglas = true;
    if (clave === "disallow" && valor === "/" && agentes.some((a) => a === "*" || a === "googlebot")) bloquea = true;
  }
  return bloquea;
}

// ---------- PageSpeed (velocidad en celular) ----------
async function pagespeedDirecto(url) {
  const p = new URLSearchParams({ url, strategy: "mobile", locale: "es" });
  for (const c of ["performance", "seo", "accessibility", "best-practices"]) p.append("category", c);
  const llave = process.env.PAGESPEED_API_KEY || process.env.GOOGLE_API_KEY;
  if (llave) p.set("key", llave);
  const r = await fetch("https://www.googleapis.com/pagespeedonline/v5/runPagespeed?" + p, { signal: AbortSignal.timeout(60000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(r.status === 429 ? "Google PageSpeed está saturado; se intenta en la próxima revisión" : `Google PageSpeed respondió ${r.status}`);
  return leerPagespeed(d);
}

export function leerPagespeed(d) {
  const cat = d.lighthouseResult?.categories || {};
  const a = d.lighthouseResult?.audits || {};
  const pct = (x) => (typeof x?.score === "number" ? Math.round(x.score * 100) : null);
  const campo = d.loadingExperience?.metrics || {};
  return {
    velocidad: pct(cat.performance), seo: pct(cat.seo), accesibilidad: pct(cat.accessibility), buenas_practicas: pct(cat["best-practices"]),
    carga_segundos: a["largest-contentful-paint"]?.numericValue ? redondo(a["largest-contentful-paint"].numericValue / 1000) : null,
    movimiento: a["cumulative-layout-shift"]?.numericValue !== undefined ? redondo(a["cumulative-layout-shift"].numericValue, 2) : null,
    usuarios_reales: campo.LARGEST_CONTENTFUL_PAINT_MS ? { carga_segundos: redondo(campo.LARGEST_CONTENTFUL_PAINT_MS.percentile / 1000), nivel: campo.LARGEST_CONTENTFUL_PAINT_MS.category } : null,
  };
}

// Se pueden cambiar en las pruebas para no salir a internet.
const fuentes = { pagina: pedirPagina, pagespeed: pagespeedDirecto, google: pedirGoogle };
export function _fuentesDePrueba(cambios) { Object.assign(fuentes, cambios); }

// ---------- Revisión del sitio ----------
const enCurso = new Map();

export function revisarSitio(cliente) {
  const c = clienteRequerido(cliente);
  if (enCurso.has(c.id)) return enCurso.get(c.id);
  const p = revisar(c).finally(() => enCurso.delete(c.id));
  enCurso.set(c.id, p);
  return p;
}

async function abrir(url) {
  try {
    const r = await fuentes.pagina(url);
    const esHtml = /html/i.test(r.tipo || "text/html");
    return { ...r, ...(esHtml && r.status < 400 ? analizarHTML(r.html, r.url) : { url: r.url, enlaces: [] }), lento: r.ms > 3000 };
  } catch (e) {
    return { url, status: null, error: e.message, enlaces: [] };
  }
}

async function revisar(c) {
  const sitio = configSeo(c).sitio;
  if (!sitio) throw new Error(`${c.nombre} no tiene sitio web anotado. Ponlo en SEO y web → Sitio.`);
  const inicio = await abrir(sitio + "/");
  const caido = inicio.status === null || inicio.status >= 400;
  const paginas = [inicio];
  if (!caido) {
    const vistas = new Set([inicio.url.replace(/\/$/, "")]);
    const cola = inicio.enlaces.filter((u) => !vistas.has(u.replace(/\/$/, ""))).slice(0, 40);
    while (cola.length && paginas.length < MAX_PAGINAS) {
      const tanda = [];
      while (cola.length && tanda.length < 3 && paginas.length + tanda.length < MAX_PAGINAS) {
        const u = cola.shift();
        const k = u.replace(/\/$/, "");
        if (vistas.has(k)) continue;
        vistas.add(k);
        tanda.push(u);
      }
      paginas.push(...(await Promise.all(tanda.map(abrir))));
    }
  }
  // robots.txt y sitemap
  const raiz = (() => { try { const u = new URL(inicio.url); return `${u.protocol}//${u.host}`; } catch { return sitio; } })();
  let sitemap = false, robotsBloquea = false;
  if (!caido) {
    const rb = await fuentes.pagina(raiz + "/robots.txt").catch(() => null);
    const txt = rb && rb.status < 400 ? rb.html || "" : "";
    robotsBloquea = robotsBloqueaTodo(txt);
    const mapa = (txt.match(/^\s*sitemap:\s*(\S+)/im) || [])[1] || raiz + "/sitemap.xml";
    const sm = await fuentes.pagina(mapa).catch(() => null);
    sitemap = Boolean(sm && sm.status < 400 && /<(urlset|sitemapindex)/i.test(sm.html || ""));
  }
  let pagespeed = null, aviso_velocidad = null;
  if (!caido) {
    try { pagespeed = await fuentes.pagespeed(inicio.url); } catch (e) { aviso_velocidad = e.message; }
  }

  // Problemas por página y del sitio completo
  const porPagina = paginas.map((p, i) => ({
    url: p.url, titulo: p.titulo || null, status: p.status, problemas: problemasDePagina(p, { inicio: i === 0 }),
  }));
  const duplicados = (k, txt) => {
    const m = new Map();
    for (const p of paginas) if (p[k]) m.set(p[k], [...(m.get(p[k]) || []), p]);
    for (const [, l] of m) if (l.length > 1) for (const p of l) porPagina.find((x) => x.url === p.url)?.problemas.push({ nivel: "amarillo", texto: `${txt} igual al de otra${l.length > 2 ? "s" : ""} ${l.length - 1} página${l.length > 2 ? "s" : ""}`, como: "Cada página debe tener el suyo, distinto." });
  };
  duplicados("titulo", "Título");
  duplicados("descripcion", "Descripción");
  const generales = [];
  const https = /^https:/.test(inicio.url || sitio);
  if (caido) generales.push({ nivel: "rojo", texto: inicio.error ? `El sitio no abre: ${inicio.error}` : `El sitio no abre (error ${inicio.status})`, como: "Avisar al cliente y revisar el hosting o el dominio hoy." });
  else {
    if (!https) generales.push({ nivel: "rojo", texto: "El sitio no es seguro (sin https)", como: "Activar el certificado SSL en el hosting (suele ser gratis)." });
    if (robotsBloquea) generales.push({ nivel: "rojo", texto: "El archivo robots.txt le prohíbe a Google entrar al sitio", como: "Quitar 'Disallow: /' del robots.txt." });
    if (!sitemap) generales.push({ nivel: "amarillo", texto: "No tiene mapa del sitio (sitemap.xml)", como: "Crear el sitemap (los plugins de SEO lo hacen solos) y darlo de alta en Search Console." });
    if (!inicio.datos_estructurados) generales.push({ nivel: "amarillo", texto: "Google no tiene sus datos de negocio (dirección, horario, teléfono)", como: "Agregar datos estructurados de negocio local (LocalBusiness o MedicalClinic)." });
    if (!inicio.imagen_compartir) generales.push({ nivel: "amarillo", texto: "Al compartir el link en WhatsApp o redes no sale imagen", como: "Agregar la imagen para compartir (og:image)." });
    if (pagespeed?.velocidad !== null && pagespeed?.velocidad !== undefined && pagespeed.velocidad < 50) generales.push({ nivel: "rojo", texto: `Es muy lento en celular (${pagespeed.velocidad} de 100${pagespeed.carga_segundos ? `, tarda ${pagespeed.carga_segundos} s en cargar` : ""})`, como: "Comprimir imágenes, quitar plugins que no se usen y activar caché." });
    else if (pagespeed?.velocidad < 80) generales.push({ nivel: "amarillo", texto: `Podría ser más rápido en celular (${pagespeed.velocidad} de 100)`, como: "Comprimir imágenes y activar caché." });
  }
  const todos = [...generales, ...porPagina.flatMap((p) => p.problemas)];
  const calif = caido ? { puntos: 0, color: "rojo" } : calificarSitio({ problemas: todos, https, sitemap, pagespeed });
  const datos = {
    sitio, url_final: inicio.url || sitio, caido, https, sitemap, robots_bloquea: robotsBloquea,
    revisadas: paginas.length, segundos: inicio.ms ? redondo(inicio.ms / 1000) : null,
    pagespeed, aviso_velocidad, generales,
    paginas: porPagina.sort((a, b) => Number(!(a.status >= 400 || a.status === null)) - Number(!(b.status >= 400 || b.status === null)) || b.problemas.filter((x) => x.nivel === "rojo").length - a.problemas.filter((x) => x.nivel === "rojo").length || b.problemas.length - a.problemas.length),
    salud: calif.puntos, color: calif.color,
    rojos: todos.filter((x) => x.nivel === "rojo").length, amarillos: todos.filter((x) => x.nivel === "amarillo").length,
  };
  const antes = ultimaRevision(c.id);
  db.prepare("INSERT INTO seo_revisiones (cliente_id, datos) VALUES (?,?)").run(c.id, JSON.stringify(datos));
  db.prepare("DELETE FROM seo_revisiones WHERE cliente_id = ? AND id NOT IN (SELECT id FROM seo_revisiones WHERE cliente_id = ? ORDER BY id DESC LIMIT 6)").run(c.id, c.id);
  if (caido && !antes?.datos.caido) avisar(`El sitio de ${c.nombre} (${sitio}) no abre. Conviene avisarle hoy.`, "SEO y web").catch(() => {});
  return seoCliente(c.id);
}

function ultimaRevision(clienteId) {
  const r = db.prepare("SELECT * FROM seo_revisiones WHERE cliente_id = ? ORDER BY id DESC LIMIT 1").get(clienteId);
  return r ? { fecha: r.fecha, datos: json(r.datos, {}) } : null;
}

// ---------- Configuración ----------
export function configSeo(c) {
  const f = db.prepare("SELECT * FROM seo_config WHERE cliente_id = ?").get(c.id);
  const sitio = f?.sitio || sitioDeTexto(c.redes);
  return { sitio: sitio || null, sitio_sugerido: !f?.sitio && Boolean(sitio), gsc_sitio: f?.gsc_sitio || null, ga4_propiedad: f?.ga4_propiedad || null };
}

export function configurarSeo({ cliente, sitio, gsc_sitio, ga4_propiedad } = {}) {
  const c = clienteRequerido(cliente);
  const a = configSeo(c);
  const nuevo = {
    sitio: sitio === undefined ? a.sitio : sitio ? normalizarSitio(sitio) : null,
    gsc: gsc_sitio === undefined ? a.gsc_sitio : gsc_sitio ? String(gsc_sitio).slice(0, 300) : null,
    ga4: ga4_propiedad === undefined ? a.ga4_propiedad : ga4_propiedad ? String(ga4_propiedad).replace(/^(\d+)$/, "properties/$1") : null,
  };
  if (nuevo.ga4 && !/^properties\/\d+$/.test(nuevo.ga4)) throw new Error("La propiedad de Analytics debe ser un número (por ejemplo 123456789)");
  db.prepare(`INSERT INTO seo_config (cliente_id, sitio, gsc_sitio, ga4_propiedad) VALUES (?,?,?,?)
      ON CONFLICT(cliente_id) DO UPDATE SET sitio = excluded.sitio, gsc_sitio = excluded.gsc_sitio, ga4_propiedad = excluded.ga4_propiedad, actualizado = strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
    .run(c.id, nuevo.sitio, nuevo.gsc, nuevo.ga4);
  olvidarCache(`seo:google:${c.id}:`);
  return { cliente: c.nombre, ...configSeo(c) };
}

// ---------- Google (Search Console y Analytics) ----------
const ALCANCES = ["https://www.googleapis.com/auth/webmasters.readonly", "https://www.googleapis.com/auth/analytics.readonly", "openid", "email"].join(" ");
export const googleDisponible = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
export const googleConectado = () => googleDisponible() && Boolean(getAjuste("seo_google_refresh"));
const estados = new Map();
let token = null;

const retorno = (req) => (process.env.URL_PUBLICA || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "") + "/oauth/google";

export function urlConexion(req) {
  if (!googleDisponible()) throw new Error("Para conectar Google falta poner GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en Railway (las mismas de Gmail).");
  const estado = "seo_" + crypto.randomBytes(24).toString("hex");
  const ahora = Date.now();
  for (const [k, exp] of estados) if (exp < ahora) estados.delete(k);
  estados.set(estado, ahora + 10 * 60e3);
  return "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: retorno(req), response_type: "code", scope: ALCANCES,
    access_type: "offline", prompt: "consent", state: estado,
  });
}
/** ¿Este regreso de Google es de la conexión de SEO (y no de Gmail)? */
export const esRetornoSeo = (req) => String(req.query.state || "").startsWith("seo_");

export async function terminarConexion(req) {
  const { code, state, error } = req.query;
  if (error) throw new Error("Google no dio permiso: " + error);
  const exp = estados.get(String(state || ""));
  estados.delete(String(state || ""));
  if (!exp || exp < Date.now()) throw new Error("El enlace de conexión caducó. Vuelva a intentarlo desde SEO y web.");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code: String(code || ""), client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: retorno(req), grant_type: "authorization_code" }),
  });
  const d = await r.json();
  if (!r.ok || !d.refresh_token) throw new Error("Google no entregó el permiso: " + (d.error_description || d.error || r.status));
  const correo = d.id_token ? JSON.parse(Buffer.from(d.id_token.split(".")[1], "base64url").toString()).email : null;
  setAjuste("seo_google_refresh", d.refresh_token);
  setAjuste("seo_google_cuenta", correo || "");
  token = { valor: d.access_token, expira: Date.now() + (d.expires_in - 60) * 1000 };
  olvidarCache("seo:");
  setTimeout(() => ligarPropiedades().catch((e) => console.error("[seo]", e.message)), 500);
  return correo;
}

export function desconectarGoogle() {
  db.prepare("DELETE FROM ajustes WHERE clave IN ('seo_google_refresh','seo_google_cuenta')").run();
  token = null;
  olvidarCache("seo:");
}

async function tokenAcceso() {
  if (token && token.expira > Date.now()) return token.valor;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: getAjuste("seo_google_refresh") || "", client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, grant_type: "refresh_token" }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (d.error === "invalid_grant") { desconectarGoogle(); throw new Error("Se venció el permiso de Google para SEO. Vuelva a conectarlo en SEO y web."); }
    throw new Error("Google no respondió: " + (d.error_description || r.status));
  }
  token = { valor: d.access_token, expira: Date.now() + (d.expires_in - 60) * 1000 };
  return token.valor;
}

async function pedirGoogle(url, cuerpo) {
  const r = await fetch(url, {
    method: cuerpo ? "POST" : "GET",
    headers: { Authorization: `Bearer ${await tokenAcceso()}`, ...(cuerpo ? { "Content-Type": "application/json" } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined, signal: AbortSignal.timeout(20000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m = d.error?.message || `error ${r.status}`;
    if (/has not been used|is disabled/i.test(m)) throw new Error("Falta activar la API en Google Cloud (Search Console API o Google Analytics Data/Admin API).");
    throw new Error("Google: " + m);
  }
  return d;
}

/** Sitios de Search Console y propiedades de Analytics que ve la cuenta conectada. */
export async function propiedades() {
  if (!googleConectado()) return { search_console: [], analytics: [] };
  return conCache("seo:propiedades", 30 * 60e3, async () => {
    const [sc, ga] = await Promise.allSettled([
      fuentes.google("https://www.googleapis.com/webmasters/v3/sites"),
      fuentes.google("https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200"),
    ]);
    return {
      search_console: sc.status === "fulfilled" ? (sc.value.siteEntry || []).filter((s) => s.permissionLevel !== "siteUnverifiedUser").map((s) => s.siteUrl) : [],
      analytics: ga.status === "fulfilled" ? (ga.value.accountSummaries || []).flatMap((a) => (a.propertySummaries || []).map((p) => ({ id: p.property, nombre: `${p.displayName} (${a.displayName})` }))) : [],
      errores: [sc, ga].filter((x) => x.status === "rejected").map((x) => x.reason.message),
    };
  });
}

/** Liga solo cada cliente con su Search Console y su Analytics cuando el dominio o el nombre coinciden. */
export async function ligarPropiedades() {
  const p = await propiedades();
  let n = 0;
  for (const c of listarClientes()) {
    const cfg = configSeo(c);
    if (!cfg.sitio) continue;
    const dom = dominio(cfg.sitio);
    const cambios = {};
    if (!cfg.gsc_sitio) {
      const s = p.search_console.filter((x) => dominio(x) === dom);
      const elegido = s.find((x) => x.startsWith("sc-domain:")) || s[0];
      if (elegido) cambios.gsc_sitio = elegido;
    }
    if (!cfg.ga4_propiedad) {
      const clave = dom.split(".")[0];
      const g = p.analytics.filter((x) => x.nombre.toLowerCase().replace(/\s+/g, "").includes(clave));
      if (g.length === 1) cambios.ga4_propiedad = g[0].id;
    }
    if (Object.keys(cambios).length) { configurarSeo({ cliente: c.id, sitio: cfg.sitio, ...cambios }); n++; }
  }
  return n;
}

const fechaISO = (ms) => new Date(ms).toISOString().slice(0, 10);
/** Periodos de 28 días: Search Console va 2-3 días atrasado. */
export function periodos(hoy = ahoraLocalISO().slice(0, 10)) {
  const fin = Date.parse(hoy + "T12:00:00Z") - 3 * DIA;
  return { actual: { desde: fechaISO(fin - 27 * DIA), hasta: fechaISO(fin) }, antes: { desde: fechaISO(fin - 55 * DIA), hasta: fechaISO(fin - 28 * DIA) } };
}
const cambioPct = (a, b) => (a === null || b === null || b === undefined || !b ? null : Math.round(((a - b) / b) * 100));

/** Lee Search Console de un sitio y lo convierte en números sencillos. */
export async function searchConsole(sitio, p = periodos()) {
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(sitio)}/searchAnalytics/query`;
  const q = (rango, extra = {}) => fuentes.google(url, { startDate: rango.desde, endDate: rango.hasta, ...extra });
  const [tot, tot0, busq, pag, pag0] = await Promise.all([
    q(p.actual), q(p.antes),
    q(p.actual, { dimensions: ["query"], rowLimit: 250 }),
    q(p.actual, { dimensions: ["page"], rowLimit: 100 }), q(p.antes, { dimensions: ["page"], rowLimit: 100 }),
  ]);
  const t = tot.rows?.[0] || { clicks: 0, impressions: 0, position: null }, t0 = tot0.rows?.[0] || { clicks: 0, impressions: 0, position: null };
  const consultas = (busq.rows || []).map((r) => ({ busqueda: r.keys[0], clics: r.clicks, apariciones: r.impressions, posicion: redondo(r.position) }));
  const antesPag = new Map((pag0.rows || []).map((r) => [r.keys[0], r.clicks]));
  const paginas = (pag.rows || []).map((r) => ({ pagina: r.keys[0], clics: r.clicks, clics_antes: antesPag.get(r.keys[0]) ?? 0, posicion: redondo(r.position) }));
  for (const [k, v] of antesPag) if (!paginas.some((x) => x.pagina === k)) paginas.push({ pagina: k, clics: 0, clics_antes: v, posicion: null });
  return {
    periodo: p,
    clics: t.clicks, clics_antes: t0.clicks, clics_cambio: cambioPct(t.clicks, t0.clicks),
    apariciones: t.impressions, apariciones_cambio: cambioPct(t.impressions, t0.impressions),
    posicion: redondo(t.position), posicion_antes: redondo(t0.position),
    top: [...consultas].sort((a, b) => b.clics - a.clics || b.apariciones - a.apariciones).slice(0, 10),
    // A un empujón de la primera página: aparecen mucho pero entre el lugar 8 y el 20.
    casi_primera: consultas.filter((x) => x.posicion >= 8 && x.posicion <= 20 && x.apariciones >= 30).sort((a, b) => b.apariciones - a.apariciones).slice(0, 8),
    paginas_bajan: paginas.filter((x) => x.clics_antes >= 10 && x.clics <= x.clics_antes * 0.7).map((x) => ({ ...x, cambio: cambioPct(x.clics, x.clics_antes) })).sort((a, b) => a.clics - a.clics_antes - (b.clics - b.clics_antes)).slice(0, 6),
    mejores_paginas: paginas.filter((x) => x.clics > 0).sort((a, b) => b.clics - a.clics).slice(0, 5),
  };
}

/** Visitas al sitio desde Google Analytics 4. */
export async function analytics(propiedad, p = periodos()) {
  const url = `https://analyticsdata.googleapis.com/v1beta/${propiedad}:runReport`;
  const rangos = [{ startDate: p.actual.desde, endDate: p.actual.hasta }, { startDate: p.antes.desde, endDate: p.antes.hasta }];
  const [tot, canal] = await Promise.all([
    fuentes.google(url, { dateRanges: rangos, metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "keyEvents" }] }),
    fuentes.google(url, { dateRanges: [rangos[0]], dimensions: [{ name: "sessionDefaultChannelGroup" }], metrics: [{ name: "sessions" }], orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: 8 }),
  ]);
  // Con dos periodos, GA4 agrega la dimensión "dateRange" (date_range_0 = actual).
  const fila = (k) => (tot.rows || []).find((r) => r.dimensionValues?.[0]?.value === k) || (k === "date_range_0" ? tot.rows?.[0] : null);
  const num = (r, i) => (r ? Number(r.metricValues?.[i]?.value || 0) : null);
  const a = fila("date_range_0"), b = fila("date_range_1");
  const NOMBRES = { "Organic Search": "Google (sin pagar)", Direct: "Directo", "Organic Social": "Redes sociales", "Paid Social": "Anuncios en redes", "Paid Search": "Anuncios en Google", Referral: "Otros sitios", Email: "Correo", Unassigned: "Sin clasificar", "Organic Maps": "Google Maps" };
  return {
    visitas: num(a, 0), visitas_antes: num(b, 0), visitas_cambio: cambioPct(num(a, 0), num(b, 0)),
    personas: num(a, 1), contactos: num(a, 2),
    de_donde: (canal.rows || []).map((r) => ({ canal: NOMBRES[r.dimensionValues[0].value] || r.dimensionValues[0].value, visitas: Number(r.metricValues[0].value) })),
  };
}

async function datosGoogle(c, cfg) {
  if (!googleConectado() || (!cfg.gsc_sitio && !cfg.ga4_propiedad)) return null;
  return conCache(`seo:google:${c.id}:${cfg.gsc_sitio}:${cfg.ga4_propiedad}`, 3 * 3600e3, async () => {
    const [sc, ga] = await Promise.allSettled([cfg.gsc_sitio ? searchConsole(cfg.gsc_sitio) : null, cfg.ga4_propiedad ? analytics(cfg.ga4_propiedad) : null]);
    return {
      fecha: new Date().toISOString(),
      search_console: sc.status === "fulfilled" ? sc.value : null,
      analytics: ga.status === "fulfilled" ? ga.value : null,
      errores: [sc, ga].filter((x) => x.status === "rejected").map((x) => x.reason.message),
    };
  });
}

// ---------- Tablero ----------
export async function seoCliente(cliente) {
  const c = clienteRequerido(cliente);
  const cfg = configSeo(c);
  const r = ultimaRevision(c.id);
  let google = null;
  try { google = await datosGoogle(c, cfg); } catch (e) { google = { errores: [e.message] }; }
  return {
    cliente: { id: c.id, nombre: c.nombre }, ...cfg,
    revision: r ? { fecha: r.fecha, ...r.datos } : null,
    revisando: enCurso.has(c.id),
    google,
  };
}

export async function tableroSeo({ cliente } = {}) {
  const lista = listarClientes({ estado: "activo" });
  const clientes = await Promise.all(lista.map(async (c) => {
    const cfg = configSeo(c);
    const r = ultimaRevision(c.id);
    let g = null;
    try { g = await datosGoogle(c, cfg); } catch { /* se muestra en el detalle */ }
    return {
      id: c.id, nombre: c.nombre, sitio: cfg.sitio,
      salud: r?.datos.salud ?? null, color: r?.datos.color ?? null, caido: r?.datos.caido ?? false, rojos: r?.datos.rojos ?? 0, revisado: r?.fecha ?? null,
      visitas: g?.analytics?.visitas ?? null, visitas_cambio: g?.analytics?.visitas_cambio ?? null,
      clics: g?.search_console?.clics ?? null, clics_cambio: g?.search_console?.clics_cambio ?? null, posicion: g?.search_console?.posicion ?? null,
    };
  }));
  return {
    clientes,
    google: { disponible: googleDisponible(), conectado: googleConectado(), cuenta: getAjuste("seo_google_cuenta") || null },
    detalle: cliente ? await seoCliente(cliente) : null,
  };
}

/** Para el Pulso: sitios que no abren. */
export function sitiosCaidos() {
  return listarClientes({ estado: "activo" }).filter((c) => ultimaRevision(c.id)?.datos.caido).map((c) => c.nombre);
}

// ---------- Cada lunes ----------
export async function revisarSemana({ ahora = ahoraLocalISO() } = {}) {
  const dia = new Date(ahora.slice(0, 10) + "T12:00:00Z").getUTCDay();
  const semana = ahora.slice(0, 10);
  if (dia !== 1 || ahora.slice(11, 16) < "07:00" || getAjuste("seo_semana") === semana) return null;
  setAjuste("seo_semana", semana);
  const conSitio = listarClientes({ estado: "activo" }).filter((c) => configSeo(c).sitio);
  let n = 0;
  for (const c of conSitio) {
    try { await revisarSitio(c.id); n++; } catch (e) { console.error("[seo]", c.nombre, e.message); }
  }
  return { revisados: n };
}

export function iniciarSeo() {
  const ciclo = () => revisarSemana().catch((e) => console.error("[seo]", e));
  setTimeout(ciclo, 90e3);
  return setInterval(ciclo, 15 * 60e3);
}
