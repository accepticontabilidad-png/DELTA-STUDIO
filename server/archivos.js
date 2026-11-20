// Archivos que el usuario adjunta en el chat (fotos, PDF, Word, Excel, CSV, texto).
// Se guardan en privado en la carpeta de datos con un nombre al azar; nunca se publican.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { db, DATA_DIR } from "./db.js";

export const MAX_BYTES = 10 * 1024 * 1024; // 10 MB por archivo
export const MAX_POR_MENSAJE = 5;
const MAX_IMAGEN = 5 * 1024 * 1024; // límite de la API para imágenes
const MAX_TEXTO = 300_000; // caracteres que se le pasan a DELTA de un Word/Excel/CSV
const CARPETA = path.join(DATA_DIR, "archivos");
fs.mkdirSync(CARPETA, { recursive: true, mode: 0o700 });

db.exec(`CREATE TABLE IF NOT EXISTS archivos (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL,
  mime TEXT NOT NULL,
  tamano INTEGER NOT NULL,
  texto TEXT,
  fecha TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
)`);

const esId = (id) => typeof id === "string" && /^[a-f0-9]{32}$/.test(id);

function limpiarNombre(nombre) {
  const n = String(nombre || "archivo").replace(/[\u0000-\u001f\\/:*?"<>|]/g, "_").trim().slice(0, 120);
  return n || "archivo";
}

/** Reconoce el tipo por su contenido (no por el nombre, que se puede falsificar). */
function detectar(buf, nombre) {
  const ext = path.extname(nombre).toLowerCase();
  const empieza = (...bytes) => bytes.every((b, i) => buf[i] === b);
  if (empieza(0xff, 0xd8, 0xff)) return { tipo: "imagen", mime: "image/jpeg" };
  if (empieza(0x89, 0x50, 0x4e, 0x47)) return { tipo: "imagen", mime: "image/png" };
  if (buf.subarray(0, 4).toString("latin1") === "GIF8") return { tipo: "imagen", mime: "image/gif" };
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return { tipo: "imagen", mime: "image/webp" };
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return { tipo: "pdf", mime: "application/pdf" };
  if (/ftyp(heic|heix|mif1|msf1)/.test(buf.subarray(4, 12).toString("latin1"))) {
    throw new Error("Esa foto está en formato HEIC. En el iPhone, compártala como JPG o tome una captura de pantalla.");
  }
  if (empieza(0x50, 0x4b, 0x03, 0x04)) {
    if (ext === ".docx") return { tipo: "word", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
    if (ext === ".xlsx") return { tipo: "excel", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
    throw new Error("Por ahora leo Word (.docx) y Excel (.xlsx); ese archivo comprimido no lo reconozco.");
  }
  if (empieza(0xd0, 0xcf, 0x11, 0xe0)) {
    throw new Error("Ese es un Word o Excel antiguo (.doc / .xls). Guárdelo como .docx o .xlsx y vuelva a adjuntarlo.");
  }
  if (!buf.includes(0)) {
    const texto = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    return { tipo: "texto", mime: ext === ".csv" ? "text/csv" : "text/plain", texto };
  }
  throw new Error("No reconozco ese tipo de archivo. Puedo leer fotos, PDF, Word, Excel, CSV y texto.");
}

// ---------- Lector mínimo de ZIP (los .docx y .xlsx son ZIP) ----------
function leerZip(buf) {
  let fin = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  }
  if (fin < 0) throw new Error("El archivo está dañado o no es un Office válido.");
  const total = buf.readUInt16LE(fin + 10);
  let p = buf.readUInt32LE(fin + 16);
  const entradas = new Map();
  for (let n = 0; n < total && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const metodo = buf.readUInt16LE(p + 10);
    const comprimido = buf.readUInt32LE(p + 20);
    const largoNombre = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const comentario = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nombre = buf.subarray(p + 46, p + 46 + largoNombre).toString("utf8");
    entradas.set(nombre, { metodo, comprimido, local });
    p += 46 + largoNombre + extra + comentario;
  }
  return (nombre) => {
    const e = entradas.get(nombre);
    if (!e) return null;
    const ini = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
    const datos = buf.subarray(ini, ini + e.comprimido);
    if (e.metodo === 0) return datos.toString("utf8");
    if (e.metodo === 8) return zlib.inflateRawSync(datos, { maxOutputLength: 40 * 1024 * 1024 }).toString("utf8");
    throw new Error("Formato de compresión no soportado.");
  };
}

const ENTIDADES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decodificar = (s) =>
  s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, c) =>
    c[0] === "#" ? String.fromCodePoint(c[1].toLowerCase() === "x" ? parseInt(c.slice(2), 16) : Number(c.slice(1))) : ENTIDADES[c] ?? m);

function textoDeWord(buf) {
  const leer = leerZip(buf);
  const xml = leer("word/document.xml");
  if (!xml) throw new Error("No encontré el texto de ese Word.");
  return decodificar(
    xml
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<w:br[^>]*\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<\/w:tc>/g, "\t")
      .replace(/<[^>]+>/g, ""),
  ).replace(/\n{3,}/g, "\n\n").trim();
}

function columna(ref) {
  let n = 0;
  for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
const celdaCSV = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function textoDeExcel(buf) {
  const leer = leerZip(buf);
  const compartidas = [];
  const ss = leer("xl/sharedStrings.xml");
  if (ss) for (const si of ss.match(/<si>[\s\S]*?<\/si>/g) || []) {
    compartidas.push(decodificar((si.match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join("")));
  }
  const libro = leer("xl/workbook.xml") || "";
  const rels = leer("xl/_rels/workbook.xml.rels") || "";
  const destino = {};
  for (const r of rels.match(/<Relationship\b[^>]*>/g) || []) {
    const id = r.match(/Id="([^"]+)"/)?.[1];
    const t = r.match(/Target="([^"]+)"/)?.[1];
    if (id && t) destino[id] = t.startsWith("/") ? t.slice(1) : "xl/" + t;
  }
  const salida = [];
  for (const h of libro.match(/<sheet\b[^>]*>/g) || []) {
    const nombre = decodificar(h.match(/name="([^"]*)"/)?.[1] || "Hoja");
    const archivo = destino[h.match(/r:id="([^"]+)"/)?.[1]];
    const xml = archivo && leer(archivo);
    if (!xml) continue;
    salida.push(`## Hoja: ${nombre}`);
    let filas = 0;
    for (const fila of xml.match(/<row\b[\s\S]*?<\/row>/g) || []) {
      if (++filas > 5000) { salida.push("(… hoja recortada: más de 5000 filas)"); break; }
      const valores = [];
      for (const c of fila.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []) {
        const ref = c.match(/r="([A-Z]+\d+)"/)?.[1];
        const tipo = c.match(/t="(\w+)"/)?.[1];
        let v = c.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
        if (tipo === "s") v = compartidas[Number(v)] ?? "";
        else if (tipo === "inlineStr") v = (c.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1]) ?? "";
        v = decodificar(v);
        const i = ref ? columna(ref) : valores.length;
        if (i < 0 || i > 500) continue;
        valores[i] = celdaCSV(v);
      }
      if (valores.length) salida.push(Array.from(valores, (x) => x ?? "").join(","));
    }
  }
  if (!salida.length) throw new Error("No encontré datos en ese Excel.");
  return salida.join("\n");
}

// ---------- Guardar y leer ----------
export function guardarArchivo(buf, nombreOriginal) {
  if (!Buffer.isBuffer(buf) || !buf.length) throw new Error("El archivo llegó vacío.");
  if (buf.length > MAX_BYTES) throw new Error("El archivo pesa más de 10 MB.");
  const nombre = limpiarNombre(nombreOriginal);
  const info = detectar(buf, nombre);
  if (info.tipo === "imagen" && buf.length > MAX_IMAGEN) throw new Error("La foto pesa más de 5 MB. Intente con una más ligera.");
  let texto = info.texto ?? null;
  if (info.tipo === "word") texto = textoDeWord(buf);
  if (info.tipo === "excel") texto = textoDeExcel(buf);
  if (texto && texto.length > MAX_TEXTO) texto = texto.slice(0, MAX_TEXTO) + "\n(… archivo recortado por ser muy largo)";
  if (texto !== null && !texto.trim()) throw new Error("Ese archivo no tiene texto que pueda leer.");

  const id = crypto.randomBytes(16).toString("hex");
  fs.writeFileSync(path.join(CARPETA, id), buf, { mode: 0o600 });
  db.prepare("INSERT INTO archivos (id, nombre, tipo, mime, tamano, texto) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, nombre, info.tipo, info.mime, buf.length, texto);
  return { id, nombre, tipo: info.tipo, tamano: buf.length };
}

export function infoArchivo(id) {
  if (!esId(id)) return null;
  return db.prepare("SELECT id, nombre, tipo, mime, tamano, fecha FROM archivos WHERE id = ?").get(id) ?? null;
}

export function listarArchivos(limite = 20) {
  return db.prepare("SELECT id, nombre, tipo, tamano, fecha FROM archivos ORDER BY fecha DESC LIMIT ?").all(limite);
}

/** Bloques para enviarle el archivo a Claude (foto, PDF o texto). */
export function bloquesDeArchivo(id) {
  if (!esId(id)) throw new Error("Archivo no válido");
  const a = db.prepare("SELECT * FROM archivos WHERE id = ?").get(id);
  if (!a) throw new Error("Ese archivo ya no existe");
  if (a.tipo === "imagen" || a.tipo === "pdf") {
    const data = fs.readFileSync(path.join(CARPETA, a.id)).toString("base64");
    return a.tipo === "imagen"
      ? [{ type: "text", text: `Foto adjunta: ${a.nombre}` }, { type: "image", source: { type: "base64", media_type: a.mime, data } }]
      : [{ type: "document", title: a.nombre, source: { type: "base64", media_type: "application/pdf", data } }];
  }
  return [{ type: "document", title: a.nombre, source: { type: "text", media_type: "text/plain", data: a.texto } }];
}
