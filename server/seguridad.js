// Seguridad de DELTA: entrada con clave, sesiones, bloqueo de intentos y cabeceras protectoras.
import crypto from "node:crypto";
import { db, getAjuste, setAjuste } from "./db.js";

db.exec(`
CREATE TABLE IF NOT EXISTS sesiones (
  id_hash TEXT PRIMARY KEY,          -- solo guardamos la huella, nunca la sesión real
  creada TEXT NOT NULL,
  expira TEXT NOT NULL,
  equipo TEXT
);
`);

const COOKIE = "delta_sesion";
const DURACION_DIAS = 30;
const MIN_LARGO_CLAVE = 12;

const huella = (texto) => crypto.createHash("sha256").update(String(texto)).digest();
const huellaHex = (texto) => huella(texto).toString("hex");

/** La clave es obligatoria y debe ser larga; si no, DELTA no arranca. */
export function revisarClave(clave = process.env.CLAVE_ACCESO) {
  if (!clave || clave.length < MIN_LARGO_CLAVE) {
    throw new Error(
      `CLAVE_ACCESO falta o es muy corta (mínimo ${MIN_LARGO_CLAVE} caracteres). ` +
        "DELTA no arranca sin una clave segura para que nadie más pueda entrar.",
    );
  }
  // Si la clave cambió desde la última vez, se cierran todas las sesiones abiertas.
  const anterior = getAjuste("huella_clave");
  const actual = crypto.createHmac("sha256", "delta-clave").update(clave).digest("hex");
  if (anterior && anterior !== actual) cerrarTodas();
  setAjuste("huella_clave", actual);
}

export function claveCorrecta(intento, clave = process.env.CLAVE_ACCESO) {
  return crypto.timingSafeEqual(huella(intento), huella(clave));
}

// ---------- Sesiones ----------
export function crearSesion(equipo = "") {
  const id = crypto.randomBytes(32).toString("base64url");
  const ahora = new Date();
  const expira = new Date(ahora.getTime() + DURACION_DIAS * 864e5);
  db.prepare("INSERT INTO sesiones (id_hash, creada, expira, equipo) VALUES (?, ?, ?, ?)")
    .run(huellaHex(id), ahora.toISOString(), expira.toISOString(), String(equipo).slice(0, 200));
  db.prepare("DELETE FROM sesiones WHERE expira < ?").run(ahora.toISOString());
  return { id, expira };
}

export function sesionValida(id) {
  if (!id || id.length > 100) return false;
  const s = db.prepare("SELECT expira FROM sesiones WHERE id_hash = ?").get(huellaHex(id));
  return Boolean(s && s.expira > new Date().toISOString());
}

export function cerrarSesion(id) {
  if (id) db.prepare("DELETE FROM sesiones WHERE id_hash = ?").run(huellaHex(id));
}

export function cerrarTodas() {
  db.prepare("DELETE FROM sesiones").run();
}

export function leerCookie(req) {
  const m = (req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export function ponerCookie(req, res, id, expira) {
  const seguro = req.secure || process.env.NODE_ENV === "production";
  res.setHeader("Set-Cookie", [
    `${COOKIE}=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Strict; Expires=${expira.toUTCString()}${seguro ? "; Secure" : ""}`,
  ]);
}

export function borrarCookie(res) {
  res.setHeader("Set-Cookie", [`${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`]);
}

/**
 * Solo deja pasar a quien entró con la clave.
 * Además, toda petición que cambia algo debe traer la cabecera X-Delta, que otro
 * sitio web no puede añadir: así nadie puede usar tu sesión desde una página trampa.
 */
export function protegido(req, res, next) {
  if (!sesionValida(leerCookie(req))) return res.status(401).json({ error: "No autorizado" });
  if (req.method !== "GET" && req.method !== "HEAD" && req.get("X-Delta") !== "1") {
    return res.status(403).json({ error: "Petición rechazada" });
  }
  next();
}

// ---------- Bloqueo de intentos de adivinar la clave ----------
const POR_IP = { max: 5, ventanaMs: 15 * 60e3 };
const GLOBAL = { max: 20, ventanaMs: 60 * 60e3 };
const fallosIp = new Map();
let fallosGlobales = [];

function limpiar(lista, ventana) {
  const corte = Date.now() - ventana;
  return lista.filter((t) => t > corte);
}

/** Devuelve los minutos que hay que esperar, o 0 si se puede intentar. */
export function bloqueado(ip) {
  const propios = limpiar(fallosIp.get(ip) || [], POR_IP.ventanaMs);
  fallosIp.set(ip, propios);
  fallosGlobales = limpiar(fallosGlobales, GLOBAL.ventanaMs);
  if (propios.length >= POR_IP.max) return Math.ceil((propios[0] + POR_IP.ventanaMs - Date.now()) / 60e3);
  if (fallosGlobales.length >= GLOBAL.max) return Math.ceil((fallosGlobales[0] + GLOBAL.ventanaMs - Date.now()) / 60e3);
  return 0;
}

/** Registra un intento fallido. Devuelve true si con este se activó un bloqueo. */
export function registrarFallo(ip) {
  const ahora = Date.now();
  const propios = [...(fallosIp.get(ip) || []), ahora];
  fallosIp.set(ip, propios);
  fallosGlobales.push(ahora);
  return propios.length === POR_IP.max || fallosGlobales.length === GLOBAL.max;
}

export function reiniciarIntentos() {
  fallosIp.clear();
  fallosGlobales = [];
}

// ---------- Cabeceras que protegen la app en el navegador ----------
export function cabeceras(req, res, next) {
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self' https://api.open-meteo.com",
      "manifest-src 'self'",
      "worker-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "microphone=(self), geolocation=(self), camera=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  if (req.secure) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
}
