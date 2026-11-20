// Habilidades de DELTA: las mismas "skills" que el dueño usa con Claude (carpetas con un SKILL.md).
// Se suben desde Ajustes (un .zip, un .skill o un SKILL.md suelto) y se guardan en la base de datos privada,
// nunca en el repositorio. Los departamentos ven la lista y leen la que les sirve, como hace Claude.
import { db } from "./db.js";
import { leerZip } from "./zip.js";

db.exec(`
CREATE TABLE IF NOT EXISTS habilidades (
  nombre TEXT PRIMARY KEY,
  descripcion TEXT NOT NULL,
  archivos TEXT NOT NULL,          -- JSON { "SKILL.md": "...", "references/x.md": "..." }
  activa INTEGER NOT NULL DEFAULT 1,
  creada TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`);

const TEXTO = /\.(md|markdown|txt|html?|css|js|mjs|cjs|json|ya?ml|py|csv|svg|xml)$/i;
const MAX_ARCHIVO = 400_000;
const MAX_LECTURA = 60_000;

/** Lee el encabezado YAML (name y description) de un SKILL.md. */
export function leerEncabezado(texto) {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(texto);
  const datos = {};
  if (!m) return datos;
  const lineas = m[1].split(/\r?\n/);
  for (let i = 0; i < lineas.length; i++) {
    const c = /^([A-Za-z_-]+):\s*(.*)$/.exec(lineas[i]);
    if (!c) continue;
    let valor = c[2].trim();
    if (/^[>|][-+]?$/.test(valor) || valor === "") {
      const bloque = [];
      while (i + 1 < lineas.length && (/^\s+\S/.test(lineas[i + 1]) || lineas[i + 1].trim() === "")) bloque.push(lineas[++i].trim());
      valor = bloque.join(" ").replace(/\s+/g, " ").trim();
    }
    datos[c[1]] = valor.replace(/^["']|["']$/g, "");
  }
  return datos;
}

const limpiarNombre = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);

/**
 * Importa una o varias habilidades. Acepta un .zip / .skill (con una o muchas carpetas que tengan SKILL.md)
 * o un SKILL.md suelto. Si ya existía una con el mismo nombre, la reemplaza.
 */
export function importar(buf, nombreArchivo = "") {
  if (!buf?.length) throw new Error("El archivo está vacío");
  let archivos;
  if (buf.readUInt32LE(0) === 0x04034b50) {
    archivos = leerZip(buf).filter((a) => !/(^|\/)(__MACOSX|\.)/.test(a.ruta));
  } else if (/\.(md|markdown|txt)$/i.test(nombreArchivo) || /^﻿?---/.test(buf.subarray(0, 10).toString())) {
    archivos = [{ ruta: "SKILL.md", datos: buf }];
  } else {
    throw new Error("Sube un .zip, un .skill o un SKILL.md");
  }
  const raices = archivos.filter((a) => /(^|\/)SKILL\.md$/i.test(a.ruta)).map((a) => a.ruta.replace(/SKILL\.md$/i, ""));
  if (!raices.length) throw new Error("No encontré ningún SKILL.md adentro");
  // De la más profunda a la más corta, para que cada archivo quede con su habilidad.
  raices.sort((a, b) => b.length - a.length);
  const usados = new Set();
  const guardadas = [];
  for (const raiz of raices) {
    const propios = {};
    for (const a of archivos) {
      if (!a.ruta.startsWith(raiz) || usados.has(a.ruta)) continue;
      const rel = a.ruta.slice(raiz.length);
      if (!TEXTO.test(rel) || a.datos.length > MAX_ARCHIVO) continue;
      propios[/^SKILL\.md$/i.test(rel) ? "SKILL.md" : rel] = a.datos.toString("utf8");
      usados.add(a.ruta);
    }
    const enc = leerEncabezado(propios["SKILL.md"] || "");
    const nombre = limpiarNombre(enc.name || raiz.split("/").filter(Boolean).pop() || nombreArchivo.replace(/\.[^.]+$/, ""));
    if (!nombre) throw new Error("Una habilidad no tiene nombre (falta name: en su SKILL.md)");
    const descripcion = (enc.description || "").slice(0, 1500) || "(sin descripción)";
    db.prepare("INSERT INTO habilidades (nombre, descripcion, archivos) VALUES (?,?,?) ON CONFLICT(nombre) DO UPDATE SET descripcion=excluded.descripcion, archivos=excluded.archivos, activa=1")
      .run(nombre, descripcion, JSON.stringify(propios));
    guardadas.push(nombre);
  }
  return { guardadas, total: listar().length };
}

export function listar() {
  return db.prepare("SELECT nombre, descripcion, activa, archivos, creada FROM habilidades ORDER BY nombre").all()
    .map(({ archivos, ...h }) => ({ ...h, activa: Boolean(h.activa), archivos: Object.keys(JSON.parse(archivos)).length }));
}

export const activas = () => listar().filter((h) => h.activa);

function obtener(nombre) {
  const h = db.prepare("SELECT * FROM habilidades WHERE nombre = ?").get(limpiarNombre(nombre))
    || db.prepare("SELECT * FROM habilidades WHERE nombre LIKE ? ORDER BY length(nombre) LIMIT 1").get(`%${limpiarNombre(nombre)}%`);
  if (!h) throw new Error(`No tengo la habilidad "${nombre}". Disponibles: ${activas().map((x) => x.nombre).join(", ") || "ninguna"}`);
  return { ...h, archivos: JSON.parse(h.archivos) };
}

const trozo = (texto, desde = 0) => {
  const parte = texto.slice(desde, desde + MAX_LECTURA);
  const resto = texto.length - desde - parte.length;
  return resto > 0 ? `${parte}\n\n[… faltan ${resto} caracteres: vuelve a leer con desde=${desde + parte.length}]` : parte;
};

/** Lo que lee un departamento al usar una habilidad: su SKILL.md y la lista de archivos de apoyo. */
export function leer(nombre, desde = 0) {
  const h = obtener(nombre);
  const otros = Object.keys(h.archivos).filter((r) => r !== "SKILL.md");
  return `# Habilidad: ${h.nombre}\n\n${trozo(h.archivos["SKILL.md"] || "", desde)}${otros.length && !desde ? `\n\n---\nArchivos de apoyo (léelos con leer_archivo_habilidad cuando el SKILL.md lo indique):\n${otros.map((r) => `- ${r} (${h.archivos[r].length} caracteres)`).join("\n")}` : ""}`;
}

export function leerArchivo(nombre, ruta, desde = 0) {
  const h = obtener(nombre);
  const limpia = String(ruta || "").replace(/^\.?\//, "");
  const clave = Object.keys(h.archivos).find((r) => r === limpia) || Object.keys(h.archivos).find((r) => r.endsWith("/" + limpia) || r.split("/").pop() === limpia);
  if (!clave) throw new Error(`La habilidad ${h.nombre} no tiene "${ruta}". Tiene: ${Object.keys(h.archivos).join(", ")}`);
  return trozo(h.archivos[clave], desde);
}

export function cambiar(nombre, activa) {
  const h = obtener(nombre);
  db.prepare("UPDATE habilidades SET activa = ? WHERE nombre = ?").run(activa ? 1 : 0, h.nombre);
  return { ok: true };
}

export function borrar(nombre) {
  const r = db.prepare("DELETE FROM habilidades WHERE nombre = ?").run(limpiarNombre(nombre));
  if (!r.changes) throw new Error("Esa habilidad no existe");
  return { ok: true };
}

/** Texto para el prompt de los departamentos. */
export function resumenParaAgente() {
  const lista = activas();
  if (!lista.length) return "";
  return `
Habilidades (las mismas skills que el dueño usa con Claude). Antes de un trabajo, revisa si alguna aplica; si aplica, léela con usar_habilidad y síguela paso a paso:
${lista.map((h) => `- ${h.nombre}: ${h.descripcion.slice(0, 350)}`).join("\n")}
Al seguir una habilidad, adáptala a cómo trabajas aquí:
- No tienes navegador, Playwright, terminal ni las carpetas de la computadora del dueño. Donde la habilidad diga abrir Higgsfield en el navegador, exportar con un script o guardar en una carpeta, usa tus herramientas (crear_pieza, generar_imagen_ia, generar_video_ia) si las tienes; si no, deja el material listo (textos, prompts) y dilo.
- No puedes hacer preguntas a mitad del trabajo: si la habilidad pide preguntar algo, decide lo más razonable, sigue, y al final lista las preguntas pendientes.
- Si una habilidad trae la marca personal de otra persona (su nombre, @usuario, paleta o brandkit), úsala como referencia de estilo solo si el encargo lo pide. Por defecto, la marca es la del cliente del encargo (o DELTA Marketing).
`;
}
