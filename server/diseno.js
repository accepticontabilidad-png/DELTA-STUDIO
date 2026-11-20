// Estudio de Diseño: convierte los diseños (HTML/CSS que escribe el departamento) en PNG listos para subir,
// y guarda las imágenes y videos hechos con IA (Higgsfield). Todo queda en la carpeta privada de datos.
import fs from "node:fs";
import path from "node:path";
import { db, DATA_DIR } from "./db.js";
import { crearZip } from "./zip.js";

const CARPETA = path.join(DATA_DIR, "diseno");
const PIEZAS = path.join(CARPETA, "piezas");
const MEDIOS = path.join(CARPETA, "medios");
fs.mkdirSync(PIEZAS, { recursive: true });
fs.mkdirSync(MEDIOS, { recursive: true });

db.exec(`
CREATE TABLE IF NOT EXISTS piezas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trabajo_id INTEGER,
  cliente_id INTEGER,
  tipo TEXT NOT NULL,             -- carrusel | post | historia | portada | video
  titulo TEXT NOT NULL,
  ancho INTEGER, alto INTEGER,
  diseno TEXT,                    -- JSON { css, slides: [html] } para poder corregirla
  archivos TEXT NOT NULL,         -- JSON [nombre]
  texto TEXT,                     -- copy / caption con hashtags
  creada TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS medios_ia (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trabajo_id INTEGER,
  tipo TEXT NOT NULL,             -- imagen | video
  prompt TEXT NOT NULL,
  modelo TEXT,
  archivo TEXT NOT NULL,
  creado TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`);

export const FORMATOS = {
  carrusel: { ancho: 1080, alto: 1350, nombre: "Carrusel 4:5" },
  post: { ancho: 1080, alto: 1350, nombre: "Post 4:5" },
  cuadrado: { ancho: 1080, alto: 1080, nombre: "Post cuadrado 1:1" },
  historia: { ancho: 1080, alto: 1920, nombre: "Historia 9:16" },
  portada: { ancho: 1080, alto: 1920, nombre: "Portada de reel 9:16" },
};

// ---------- Navegador para "tomar la foto" de cada slide ----------
const CANDIDATOS = [process.env.CHROMIUM_PATH, "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter(Boolean);
const rutaChromium = () => CANDIDATOS.find((p) => fs.existsSync(p));
export const puedeRenderizar = () => Boolean(rutaChromium());

let fila = Promise.resolve();
/** Un render a la vez, para no llenar la memoria del servidor. */
function enFila(fn) {
  const r = fila.then(fn, fn);
  fila = r.catch(() => {});
  return r;
}

const PERMITIDOS = /^(data:|about:|https:\/\/fonts\.(googleapis|gstatic)\.com\/)/;

async function conNavegador(fn) {
  const ejecutable = rutaChromium();
  if (!ejecutable) throw new Error("El servidor no tiene el navegador para crear las imágenes (Chromium).");
  const { chromium } = await import("playwright-core");
  const nav = await chromium.launch({ executablePath: ejecutable, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--font-render-hinting=none"] });
  try {
    // Los diseños son solo HTML y CSS: sin JavaScript y sin internet (salvo Google Fonts).
    const contexto = await nav.newContext({ javaScriptEnabled: false, deviceScaleFactor: 1 });
    await contexto.route("**/*", (r) => (PERMITIDOS.test(r.request().url()) ? r.continue() : r.abort()));
    const pagina = await contexto.newPage();
    return await fn(pagina);
  } finally {
    await nav.close().catch(() => {});
  }
}

const tipoDe = (archivo) => ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".mp4": "video/mp4" })[path.extname(archivo).toLowerCase()] || "application/octet-stream";

/** Cambia "medio:12" por la imagen real (las imágenes hechas con IA se usan así dentro de los diseños). */
function ponerMedios(html) {
  return html.replace(/medio:(\d+)/g, (todo, id) => {
    const m = obtenerMedio(id);
    if (!m || m.tipo !== "imagen") return todo;
    return `data:${tipoDe(m.archivo)};base64,${fs.readFileSync(path.join(MEDIOS, m.archivo)).toString("base64")}`;
  });
}

export function documento({ css = "", slides, ancho, alto }) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#ffffff;width:${ancho}px}
body{font-family:"Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased}
.slide{width:${ancho}px;height:${alto}px;position:relative;overflow:hidden}
.slide>*{position:relative}
img{display:block;max-width:100%}
</style>
<style>${css}</style></head><body>
${slides.map((s, i) => `<section class="slide" data-n="${i + 1}">${s}</section>`).join("\n")}
</body></html>`;
}

/** Renderiza cada slide como PNG del tamaño exacto. Devuelve los PNG y una hoja de contacto (JPG) para revisarlos. */
export function renderizar({ css, slides, ancho, alto }) {
  return enFila(() => conNavegador(async (pagina) => {
    await pagina.setViewportSize({ width: ancho, height: alto });
    await pagina.setContent(ponerMedios(documento({ css, slides, ancho, alto })), { waitUntil: "networkidle", timeout: 30_000 }).catch(() => {});
    await pagina.evaluate(() => document.fonts?.ready).catch(() => {});
    const elementos = await pagina.locator(".slide").all();
    const pngs = [];
    for (const el of elementos) pngs.push(Buffer.from(await el.screenshot({ type: "png" })));
    // Hoja de contacto: todas las slides en chico, para que el departamento revise su trabajo.
    const cols = Math.min(pngs.length, alto > ancho * 1.5 ? 5 : 4);
    const w = 300;
    const h = Math.round((alto / ancho) * w);
    const filas = Math.ceil(pngs.length / cols);
    await pagina.setViewportSize({ width: cols * (w + 12) + 12, height: filas * (h + 12) + 12 });
    await pagina.setContent(`<body style="margin:0;padding:6px;background:#222;display:flex;flex-wrap:wrap">${pngs.map((p) => `<img style="width:${w}px;height:${h}px;margin:6px" src="data:image/png;base64,${p.toString("base64")}">`).join("")}</body>`, { waitUntil: "load" });
    const hoja = Buffer.from(await pagina.screenshot({ type: "jpeg", quality: 70, fullPage: true }));
    return { pngs, hoja };
  }));
}

// ---------- Piezas ----------
const leerPieza = (p) => p && { ...p, diseno: p.diseno ? JSON.parse(p.diseno) : null, archivos: JSON.parse(p.archivos) };

export function obtenerPieza(id) {
  return leerPieza(db.prepare("SELECT p.*, c.nombre AS cliente FROM piezas p LEFT JOIN clientes c ON c.id = p.cliente_id WHERE p.id = ?").get(Number(id)));
}

export function listarPiezas({ limite = 60, trabajo_id } = {}) {
  const filas = trabajo_id
    ? db.prepare("SELECT p.*, c.nombre AS cliente FROM piezas p LEFT JOIN clientes c ON c.id = p.cliente_id WHERE trabajo_id = ? ORDER BY id").all(Number(trabajo_id))
    : db.prepare("SELECT p.*, c.nombre AS cliente FROM piezas p LEFT JOIN clientes c ON c.id = p.cliente_id ORDER BY id DESC LIMIT ?").all(limite);
  return filas.map((p) => { const { diseno, ...x } = leerPieza(p); return x; });
}

/**
 * Crea (o corrige, con reemplaza_id) una pieza diseñada en HTML: carrusel, post, historia o portada.
 * slides: lista de HTML, uno por slide. css: estilos compartidos.
 */
export async function crearPieza({ titulo, tipo = "carrusel", css = "", slides, texto, reemplaza_id, trabajo_id, cliente_id }) {
  const f = FORMATOS[tipo];
  if (!f) throw new Error(`Tipo no válido. Opciones: ${Object.keys(FORMATOS).join(", ")}`);
  if (!Array.isArray(slides) || !slides.length) throw new Error("Faltan las slides (una lista de HTML)");
  if (slides.length > 20) throw new Error("Máximo 20 slides por pieza");
  if (["post", "cuadrado"].includes(tipo) && slides.length > 1) tipo = "carrusel";
  const { pngs, hoja } = await renderizar({ css, slides, ancho: f.ancho, alto: f.alto });
  let id = reemplaza_id ? Number(reemplaza_id) : null;
  const anterior = id ? obtenerPieza(id) : null;
  if (id && !anterior) throw new Error(`No existe la pieza ${id}`);
  const archivos = pngs.map((_, i) => `${String(i + 1).padStart(2, "0")}.png`);
  const diseno = JSON.stringify({ css, slides });
  if (anterior) {
    fs.rmSync(path.join(PIEZAS, String(id)), { recursive: true, force: true });
    db.prepare("UPDATE piezas SET titulo=?, tipo=?, ancho=?, alto=?, diseno=?, archivos=?, texto=COALESCE(?, texto) WHERE id=?")
      .run(titulo || anterior.titulo, tipo, f.ancho, f.alto, diseno, JSON.stringify(archivos), texto ?? null, id);
  } else {
    const r = db.prepare("INSERT INTO piezas (trabajo_id, cliente_id, tipo, titulo, ancho, alto, diseno, archivos, texto) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(trabajo_id ?? null, cliente_id ?? null, tipo, String(titulo || "Diseño").slice(0, 200), f.ancho, f.alto, diseno, JSON.stringify(archivos), texto ?? null);
    id = Number(r.lastInsertRowid);
  }
  const dir = path.join(PIEZAS, String(id));
  fs.mkdirSync(dir, { recursive: true });
  pngs.forEach((p, i) => fs.writeFileSync(path.join(dir, archivos[i]), p));
  return { pieza: obtenerPieza(id), hoja };
}

export function borrarPieza(id) {
  const p = obtenerPieza(id);
  if (!p) throw new Error("No existe esa pieza");
  fs.rmSync(path.join(PIEZAS, String(p.id)), { recursive: true, force: true });
  db.prepare("DELETE FROM piezas WHERE id = ?").run(p.id);
  return { ok: true };
}

/** Ruta segura de un archivo de una pieza (para descargarlo). */
export function archivoDePieza(id, nombre) {
  const p = obtenerPieza(id);
  if (!p || !p.archivos.includes(nombre)) return null;
  return { ruta: path.join(PIEZAS, String(p.id), nombre), tipo: tipoDe(nombre), pieza: p };
}

const nombreLimpio = (s) => String(s || "diseno").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "diseno";

export function zipDePieza(id) {
  const p = obtenerPieza(id);
  if (!p) throw new Error("No existe esa pieza");
  const base = nombreLimpio(p.titulo);
  const archivos = p.archivos.map((a) => ({ ruta: `${base}/${base}-${a}`, datos: fs.readFileSync(path.join(PIEZAS, String(p.id), a)) }));
  if (p.texto) archivos.push({ ruta: `${base}/texto-para-publicar.txt`, datos: Buffer.from(p.texto, "utf8") });
  return { nombre: `${base}.zip`, datos: crearZip(archivos) };
}

// ---------- Imágenes y videos hechos con IA ----------
export function guardarMedio({ tipo, prompt, modelo, datos, tipoContenido, trabajo_id }) {
  const ext = tipo === "video" ? ".mp4" : /jpe?g/.test(tipoContenido || "") ? ".jpg" : /webp/.test(tipoContenido || "") ? ".webp" : ".png";
  const r = db.prepare("INSERT INTO medios_ia (trabajo_id, tipo, prompt, modelo, archivo) VALUES (?,?,?,?,?)").run(trabajo_id ?? null, tipo, String(prompt).slice(0, 4000), modelo || null, "pendiente");
  const id = Number(r.lastInsertRowid);
  const archivo = `${id}${ext}`;
  fs.writeFileSync(path.join(MEDIOS, archivo), datos);
  db.prepare("UPDATE medios_ia SET archivo = ? WHERE id = ?").run(archivo, id);
  return obtenerMedio(id);
}

export function obtenerMedio(id) {
  return db.prepare("SELECT * FROM medios_ia WHERE id = ?").get(Number(id));
}

export function archivoDeMedio(id) {
  const m = obtenerMedio(id);
  if (!m || m.archivo === "pendiente") return null;
  return { ruta: path.join(MEDIOS, m.archivo), tipo: tipoDe(m.archivo), medio: m };
}

/** Un video hecho con IA también se muestra en el Estudio como pieza. */
export function piezaDeVideo({ medio, titulo, texto, trabajo_id, cliente_id, formato }) {
  const dims = formato === "horizontal" ? [1920, 1080] : ["post", "cuadrado"].includes(formato) ? [1080, 1080] : [1080, 1920];
  const r = db.prepare("INSERT INTO piezas (trabajo_id, cliente_id, tipo, titulo, ancho, alto, diseno, archivos, texto) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(trabajo_id ?? null, cliente_id ?? null, "video", String(titulo || "Video").slice(0, 200), dims[0], dims[1], null, JSON.stringify(["video.mp4"]), texto ?? null);
  const id = Number(r.lastInsertRowid);
  fs.mkdirSync(path.join(PIEZAS, String(id)), { recursive: true });
  fs.copyFileSync(path.join(MEDIOS, medio.archivo), path.join(PIEZAS, String(id), "video.mp4"));
  return obtenerPieza(id);
}
