// Higgsfield: imágenes y videos con IA para el departamento de Diseño (https://docs.higgsfield.ai).
// Llave en Railway: HIGGSFIELD_API_KEY (el "Key ID") y HIGGSFIELD_API_SECRET (el "Secret"),
// o las dos juntas como "KEY_ID:SECRET" en HIGGSFIELD_API_KEY. Se crean en https://console.higgsfield.ai
import { getAjuste, setAjuste } from "./db.js";
import { ahoraLocalISO } from "./tiempo.js";

const BASE = process.env.HIGGSFIELD_URL_BASE || "https://api.higgsfield.ai"; // otra solo para pruebas
export const MODELO_IMAGEN = process.env.HIGGSFIELD_MODELO_IMAGEN || "higgsfield-ai/soul/standard";
export const MODELO_VIDEO = process.env.HIGGSFIELD_MODELO_VIDEO || "kling-video/v3.0/pro";
const LIMITE_IMAGENES = Number(process.env.HIGGSFIELD_IMAGENES_DIA || 20);
const LIMITE_VIDEOS = Number(process.env.HIGGSFIELD_VIDEOS_DIA || 4);

function credenciales() {
  const llave = (process.env.HIGGSFIELD_API_KEY || process.env.HF_CREDENTIALS || "").trim();
  const secreto = (process.env.HIGGSFIELD_API_SECRET || "").trim();
  if (!llave) return null;
  if (llave.includes(":")) return llave;
  return secreto ? `${llave}:${secreto}` : null;
}

export const higgsfieldDisponible = () => Boolean(credenciales());

export function estado() {
  const hoy = ahoraLocalISO().slice(0, 10);
  return {
    conectado: higgsfieldDisponible(),
    falta_secreto: Boolean(process.env.HIGGSFIELD_API_KEY && !credenciales()),
    imagenes_hoy: usados("imagen", hoy), limite_imagenes: LIMITE_IMAGENES,
    videos_hoy: usados("video", hoy), limite_videos: LIMITE_VIDEOS,
  };
}

function usados(tipo, hoy) {
  const [dia, n] = String(getAjuste(`higgsfield_${tipo}s`, "") || "").split("|");
  return dia === hoy ? Number(n) || 0 : 0;
}

/** Cuida el gasto: un tope diario de imágenes y videos (se cambia con variables de entorno). */
function contar(tipo) {
  const hoy = ahoraLocalISO().slice(0, 10);
  const n = usados(tipo, hoy);
  const limite = tipo === "video" ? LIMITE_VIDEOS : LIMITE_IMAGENES;
  if (n >= limite) throw new Error(`Ya se usaron los ${limite} ${tipo}s con IA de hoy (tope para cuidar el gasto). Se puede subir con HIGGSFIELD_${tipo === "video" ? "VIDEOS" : "IMAGENES"}_DIA.`);
  setAjuste(`higgsfield_${tipo}s`, `${hoy}|${n + 1}`);
}

function requerido() {
  const c = credenciales();
  if (!c) throw new Error("Higgsfield no está conectado: falta poner HIGGSFIELD_API_KEY y HIGGSFIELD_API_SECRET en Railway.");
  return c;
}

async function pedir(ruta, { metodo = "POST", cuerpo } = {}) {
  const url = ruta.startsWith("http") ? ruta : `${BASE}/${ruta.replace(/^\//, "")}`;
  if (!url.startsWith(BASE + "/")) throw new Error("Dirección de Higgsfield no válida");
  const r = await fetch(url, {
    method: metodo,
    headers: { Authorization: `Key ${requerido()}`, "Content-Type": "application/json", Accept: "application/json" },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const texto = await r.text();
  let datos;
  try { datos = JSON.parse(texto); } catch { datos = { detail: texto.slice(0, 300) }; }
  if (r.status === 401) throw new Error("Higgsfield rechazó la llave (revisa HIGGSFIELD_API_KEY y HIGGSFIELD_API_SECRET).");
  if (r.status === 402) throw new Error("La cuenta de Higgsfield no tiene saldo suficiente.");
  if (!r.ok) throw new Error(`Higgsfield respondió ${r.status}: ${JSON.stringify(datos.detail || datos).slice(0, 300)}`);
  return datos;
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Envía un trabajo y espera el resultado (Higgsfield trabaja en cola). */
async function generar(endpoint, cuerpo, minutos) {
  const envio = await pedir(endpoint, { cuerpo });
  const estadoUrl = envio.status_url || `${BASE}/requests/${envio.request_id}/status`;
  const limite = Date.now() + minutos * 60_000;
  let espera = 2000;
  let r = envio;
  while (!["completed", "failed", "nsfw", "canceled"].includes(r.status)) {
    if (Date.now() > limite) throw new Error(`Higgsfield tardó más de ${minutos} minutos; el trabajo ${envio.request_id} quedó en su cola.`);
    await dormir(espera + Math.random() * 500);
    espera = Math.min(espera * 1.5, 10_000);
    try { r = await pedir(estadoUrl, { metodo: "GET" }); } catch (e) { if (/rechazó/.test(e.message)) throw e; }
  }
  if (r.status === "nsfw") throw new Error("Higgsfield rechazó el contenido por sus reglas de moderación (no se cobra). Cambia el prompt.");
  if (r.status !== "completed") throw new Error(`Higgsfield no pudo generar (${r.status}${r.error ? ": " + r.error : ""}). No se cobra.`);
  return { ...r, request_id: envio.request_id };
}

async function descargar(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error("No pude descargar el resultado de Higgsfield");
  return { datos: Buffer.from(await r.arrayBuffer()), tipo: r.headers.get("content-type") || "" };
}

/** Sube una imagen nuestra para usarla como referencia o primer cuadro de un video. Devuelve su URL pública. */
export async function subirImagen(datos, tipo = "image/png") {
  const u = await pedir("files/generate-upload-url", { cuerpo: { content_type: tipo } });
  const r = await fetch(u.upload_url, { method: "PUT", headers: { "Content-Type": tipo, ...(u.upload_headers || {}) }, body: datos, signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error("No pude subir la imagen a Higgsfield");
  return u.public_url;
}

// Proporciones que acepta cada modelo
const PROP_IMAGEN = { carrusel: "3:4", post: "3:4", vertical: "3:4", historia: "9:16", reel: "9:16", cuadrado: "1:1", horizontal: "16:9" };
const PROP_VIDEO = { historia: "9:16", reel: "9:16", vertical: "9:16", carrusel: "9:16", post: "1:1", cuadrado: "1:1", horizontal: "16:9" };

/** Genera una imagen. formato: carrusel | post | historia | cuadrado | horizontal */
export async function generarImagen({ prompt, formato = "post", referencia_url }) {
  requerido();
  if (!String(prompt || "").trim()) throw new Error("Falta el prompt de la imagen");
  contar("imagen");
  const r = await generar(MODELO_IMAGEN, {
    prompt: String(prompt).slice(0, 4000),
    aspect_ratio: PROP_IMAGEN[formato] || "3:4",
    resolution: "1080p",
    batch_size: 1,
    enhance_prompt: true,
    ...(referencia_url ? { image_reference_url: referencia_url } : {}),
  }, 8);
  const url = r.images?.[0]?.url;
  if (!url) throw new Error("Higgsfield terminó pero no devolvió imagen");
  return { ...(await descargar(url)), request_id: r.request_id, modelo: MODELO_IMAGEN };
}

/** Genera un video. Con imagen_url anima esa imagen (primer cuadro); sin ella, lo crea desde el texto. */
export async function generarVideo({ prompt, formato = "reel", duracion = 5, imagen_url, sonido = true }) {
  requerido();
  if (!String(prompt || "").trim()) throw new Error("Falta describir el video");
  contar("video");
  const segundos = Math.max(3, Math.min(15, Math.round(Number(duracion) || 5)));
  const cuerpo = { prompt: String(prompt).slice(0, 2500), duration: segundos, aspect_ratio: PROP_VIDEO[formato] || "9:16", sound: sonido ? "on" : "off" };
  if (imagen_url) cuerpo.image_url = imagen_url;
  const r = await generar(`${MODELO_VIDEO}/${imagen_url ? "image-to-video" : "text-to-video"}`, cuerpo, 20);
  const url = r.video?.url;
  if (!url) throw new Error("Higgsfield terminó pero no devolvió video");
  return { ...(await descargar(url)), request_id: r.request_id, modelo: MODELO_VIDEO };
}
