// Voz natural de DELTA (ElevenLabs). Convierte las respuestas en audio con una voz clonada.
// Si no hay clave o falla el servicio, la app vuelve sola a la voz del navegador.
// La voz es un ajuste: se puede crear, cambiar o borrar desde Ajustes sin tocar el código.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, getAjuste, setAjuste, db } from "./db.js";

const API = () => (process.env.ELEVENLABS_URL || "https://api.elevenlabs.io").replace(/\/$/, "");
const clave = () => process.env.ELEVENLABS_API_KEY || "";
const modelo = () => process.env.ELEVENLABS_MODELO || "eleven_multilingual_v2";

export const MAX_TEXTO = 2500; // caracteres por respuesta hablada
export const MAX_MUESTRA = 10 * 1024 * 1024; // 10 MB por grabación
export const MAX_MUESTRAS = 8;

const CACHE = path.join(DATA_DIR, "voz-cache");
const MUESTRAS = path.join(DATA_DIR, "voz-muestras");
const MAX_CACHE = 400; // audios guardados; los más viejos se borran
fs.mkdirSync(CACHE, { recursive: true, mode: 0o700 });
fs.mkdirSync(MUESTRAS, { recursive: true, mode: 0o700 });

/** Voz en uso: la creada desde Ajustes o, si no hay, la de la variable ELEVENLABS_VOZ_ID. */
export function vozActual() {
  const id = getAjuste("voz_id") || process.env.ELEVENLABS_VOZ_ID || "";
  if (!id) return null;
  return { id, nombre: getAjuste("voz_nombre") || "Voz personalizada", desde: getAjuste("voz_id") ? "app" : "variable" };
}

export function estadoVoz() {
  const voz = vozActual();
  return {
    disponible: Boolean(clave()),
    activa: Boolean(clave() && voz && getAjuste("voz_activa", "1") === "1"),
    encendida: getAjuste("voz_activa", "1") === "1",
    voz: voz ? { nombre: voz.nombre, desde: voz.desde } : null,
    muestras: listarMuestras().length,
  };
}

export function encenderVoz(si) {
  setAjuste("voz_activa", si ? "1" : "0");
  return estadoVoz();
}

/** Deja el texto listo para leerse en voz alta (sin viñetas, enlaces ni emojis). */
export function limpiarParaVoz(texto) {
  return String(texto || "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[•*_#`>|~]/g, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXTO);
}

async function llamar(ruta, opciones = {}) {
  const r = await fetch(API() + ruta, { ...opciones, headers: { "xi-api-key": clave(), ...(opciones.headers || {}) } });
  if (!r.ok) {
    let detalle = "";
    try { const d = await r.json(); detalle = d?.detail?.message || d?.detail?.status || (typeof d?.detail === "string" ? d.detail : ""); } catch {}
    const e = new Error(mensajeError(r.status, detalle));
    e.estado = r.status;
    throw e;
  }
  return r;
}

function mensajeError(estado, detalle) {
  if (estado === 401) return "La clave de ElevenLabs no es válida. Revísela en Railway.";
  if (/quota|credits/i.test(detalle)) return "Se acabaron los créditos de voz de este mes en ElevenLabs.";
  if (/can_not_use_instant_voice_cloning|subscription|plan/i.test(detalle)) return "Su plan de ElevenLabs no permite clonar voces. Necesita al menos el plan Starter.";
  if (estado === 404) return "Esa voz ya no existe en ElevenLabs.";
  return "El servicio de voz no respondió" + (detalle ? `: ${detalle.slice(0, 160)}` : ".");
}

/** Devuelve el audio MP3 del texto con la voz actual. Lo guarda para no pagar dos veces la misma frase. */
export async function sintetizar(textoOriginal) {
  if (!clave()) throw new Error("La voz natural no está configurada.");
  const voz = vozActual();
  if (!voz) throw new Error("Todavía no hay una voz creada.");
  const texto = limpiarParaVoz(textoOriginal);
  if (!texto) throw new Error("No hay nada que decir.");
  const huella = crypto.createHash("sha256").update(`${voz.id}|${modelo()}|${texto}`).digest("hex");
  const archivo = path.join(CACHE, huella + ".mp3");
  try {
    const audio = fs.readFileSync(archivo);
    const ahora = new Date();
    fs.utimesSync(archivo, ahora, ahora);
    return audio;
  } catch {}
  const r = await llamar(`/v1/text-to-speech/${encodeURIComponent(voz.id)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text: texto,
      model_id: modelo(),
      language_code: modelo().includes("multilingual_v2") ? undefined : "es",
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
    }),
  });
  const audio = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(archivo, audio, { mode: 0o600 });
  podarCache();
  return audio;
}

function podarCache() {
  const archivos = fs.readdirSync(CACHE).filter((f) => f.endsWith(".mp3"));
  if (archivos.length <= MAX_CACHE) return;
  archivos
    .map((f) => ({ f, t: fs.statSync(path.join(CACHE, f)).mtimeMs }))
    .sort((a, b) => a.t - b.t)
    .slice(0, archivos.length - MAX_CACHE)
    .forEach(({ f }) => fs.rmSync(path.join(CACHE, f), { force: true }));
}

function vaciarCache() {
  for (const f of fs.readdirSync(CACHE)) fs.rmSync(path.join(CACHE, f), { force: true });
}

// ---------- Grabaciones para crear la voz ----------
function tipoAudio(buf) {
  const txt = (a, b) => buf.subarray(a, b).toString("latin1");
  if (txt(0, 4) === "OggS") return { ext: ".ogg", mime: "audio/ogg" };
  if (txt(0, 3) === "ID3" || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return { ext: ".mp3", mime: "audio/mpeg" };
  if (txt(0, 4) === "RIFF" && txt(8, 12) === "WAVE") return { ext: ".wav", mime: "audio/wav" };
  if (txt(4, 8) === "ftyp") return { ext: ".m4a", mime: "audio/mp4" };
  if (txt(0, 4) === "fLaC") return { ext: ".flac", mime: "audio/flac" };
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return { ext: ".webm", mime: "audio/webm" };
  return null;
}

function listarMuestras() {
  return fs.readdirSync(MUESTRAS).filter((f) => /^[a-f0-9]{16}\.\w+$/.test(f));
}

export function guardarMuestra(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 1000) throw new Error("La grabación está vacía.");
  if (buf.length > MAX_MUESTRA) throw new Error("La grabación pesa más de 10 MB.");
  const tipo = tipoAudio(buf);
  if (!tipo) throw new Error("No reconozco ese audio. Sirven notas de voz de WhatsApp (.ogg), MP3, M4A o WAV.");
  if (listarMuestras().length >= MAX_MUESTRAS) throw new Error(`Máximo ${MAX_MUESTRAS} grabaciones.`);
  const nombre = crypto.randomBytes(8).toString("hex") + tipo.ext;
  fs.writeFileSync(path.join(MUESTRAS, nombre), buf, { mode: 0o600 });
  return { muestras: listarMuestras().length };
}

export function borrarMuestras() {
  for (const f of fs.readdirSync(MUESTRAS)) fs.rmSync(path.join(MUESTRAS, f), { force: true });
}

const MIMES = { ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".flac": "audio/flac", ".webm": "audio/webm" };

/** Crea la voz en ElevenLabs con las grabaciones subidas. Si ya había una creada desde DELTA, la reemplaza. */
export async function crearVoz({ nombre, permiso }) {
  if (!clave()) throw new Error("Primero ponga la clave de ElevenLabs en Railway (ELEVENLABS_API_KEY).");
  if (permiso !== true) throw new Error("Confirme que la dueña de la voz dio su permiso.");
  const muestras = listarMuestras();
  if (!muestras.length) throw new Error("Suba al menos una grabación de voz.");
  const limpio = String(nombre || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 60) || "Voz de DELTA";

  const form = new FormData();
  form.append("name", `DELTA - ${limpio}`);
  form.append("description", "Voz de DELTA creada con permiso de la persona.");
  form.append("remove_background_noise", "true");
  for (const f of muestras) {
    const buf = fs.readFileSync(path.join(MUESTRAS, f));
    form.append("files", new Blob([buf], { type: MIMES[path.extname(f)] || "application/octet-stream" }), f);
  }
  const r = await llamar("/v1/voices/add", { method: "POST", body: form });
  const { voice_id } = await r.json();
  if (!voice_id) throw new Error("ElevenLabs no devolvió la voz.");

  const anterior = getAjuste("voz_id");
  setAjuste("voz_id", voice_id);
  setAjuste("voz_nombre", limpio);
  setAjuste("voz_activa", "1");
  borrarMuestras();
  vaciarCache();
  if (anterior && anterior !== voice_id) await llamar(`/v1/voices/${encodeURIComponent(anterior)}`, { method: "DELETE" }).catch(() => {});
  return estadoVoz();
}

/** Borra la voz de ElevenLabs y de DELTA. DELTA vuelve a la voz del navegador. */
export async function borrarVoz() {
  const id = getAjuste("voz_id");
  if (id && clave()) {
    try {
      await llamar(`/v1/voices/${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch (e) {
      if (e.estado !== 404) throw e;
    }
  }
  db.prepare("DELETE FROM ajustes WHERE clave IN ('voz_id', 'voz_nombre')").run();
  borrarMuestras();
  vaciarCache();
  return estadoVoz();
}
