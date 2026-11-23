// DELTA en la Mac: la app auxiliar ("DELTA Mac") que vive en la barra de arriba de la Mac del dueño.
// - Se vincula una sola vez con un código de 6 dígitos que sale en Ajustes (dura 10 minutos).
// - Después se identifica con una llave larga (aquí solo se guarda su huella).
// - DELTA le deja órdenes (abrir una app, buscar un archivo, escribir…) y la Mac las recoge,
//   las hace y contesta. Lo delicado lo confirma el dueño EN LA MAC con un cuadro, no aquí.
// - Cuando la Mac oye el doble chasquido, avisa a las pantallas abiertas para que DELTA escuche.
import crypto from "node:crypto";
import { db, getAjuste, setAjuste } from "./db.js";
import { avisarPantalla } from "./avisos.js";

db.exec(`
CREATE TABLE IF NOT EXISTS macs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  llave_hash TEXT NOT NULL UNIQUE,
  creada TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ultimo_contacto TEXT,
  version TEXT
);
`);

const huella = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
const CODIGO_MIN = 10;
const CODIGO_INTENTOS = 5;

// ---------- Acciones que DELTA puede pedirle a la Mac ----------
// riesgo: la Mac SIEMPRE muestra un cuadro de confirmación antes de hacerlo (eso lo decide la Mac,
// así que aunque alguien engañara al servidor, lo delicado no pasa sin el clic del dueño).
export const ACCIONES = {
  abrir_app: { riesgo: false, texto: "abrir una aplicación (nombre: 'Safari', 'Excel', 'WhatsApp'…)" },
  cerrar_app: { riesgo: true, texto: "cerrar una aplicación (puede perder lo que no guardó)" },
  apps_abiertas: { riesgo: false, texto: "ver qué aplicaciones están abiertas" },
  abrir_url: { riesgo: false, texto: "abrir una página web (https) en el navegador" },
  buscar_archivos: { riesgo: false, texto: "buscar archivos por nombre o contenido en su carpeta personal (Spotlight)" },
  abrir_archivo: { riesgo: false, texto: "abrir un archivo o carpeta con su programa (ruta completa, de buscar_archivos)" },
  mostrar_en_finder: { riesgo: false, texto: "mostrar un archivo en el Finder" },
  escribir_texto: { riesgo: true, texto: "escribir un texto donde esté el cursor" },
  atajo_teclado: { riesgo: true, texto: "presionar un atajo de teclado (ej. 'cmd+s', 'cmd+shift+4', 'enter')" },
  volumen: { riesgo: false, texto: "poner el volumen (0 a 100) o silenciar" },
  mover_a_papelera: { riesgo: true, texto: "mandar un archivo a la Papelera" },
  crear_nota: { riesgo: false, texto: "crear un archivo de texto en el Escritorio con un contenido" },
};

// ---------- Vinculación ----------
let codigo = null; // { hash, expira, intentos }

/** Crea un código de 6 dígitos para vincular la Mac (lo pide el dueño en Ajustes). */
export function nuevoCodigo() {
  const c = String(crypto.randomInt(0, 1e6)).padStart(6, "0");
  codigo = { hash: huella(c), expira: Date.now() + CODIGO_MIN * 60e3, intentos: 0 };
  return { codigo: c, minutos: CODIGO_MIN };
}

/** La Mac manda el código; si es correcto recibe su llave permanente. */
export function vincular({ codigo: intento, nombre, version } = {}) {
  const c = codigo;
  if (!c || Date.now() > c.expira) throw new Error("El código ya venció. Pida uno nuevo en DELTA → Ajustes → Mi Mac.");
  c.intentos++;
  if (c.intentos > CODIGO_INTENTOS) { codigo = null; throw new Error("Demasiados intentos. Pida un código nuevo."); }
  const limpio = String(intento || "").replace(/\D/g, "");
  if (!crypto.timingSafeEqual(Buffer.from(huella(limpio)), Buffer.from(c.hash))) throw new Error("Código incorrecto.");
  codigo = null;
  const llave = "dmac_" + crypto.randomBytes(32).toString("base64url");
  const n = String(nombre || "Mi Mac").replace(/[^\p{L}\p{N} '’._-]/gu, "").slice(0, 60) || "Mi Mac";
  const r = db.prepare("INSERT INTO macs (nombre, llave_hash, version, ultimo_contacto) VALUES (?, ?, ?, ?)")
    .run(n, huella(llave), String(version || "").slice(0, 20), new Date().toISOString());
  avisarPantalla({ tipo: "mac", estado: "vinculada" });
  return { llave, id: Number(r.lastInsertRowid), nombre: n };
}

/** Quién es la Mac que llama (por su llave), o null. */
export function macDeLlave(llave) {
  if (!llave || typeof llave !== "string" || !llave.startsWith("dmac_") || llave.length > 100) return null;
  return db.prepare("SELECT id, nombre FROM macs WHERE llave_hash = ?").get(huella(llave)) || null;
}

export function desvincular(id) {
  if (id) db.prepare("DELETE FROM macs WHERE id = ?").run(Number(id));
  else db.prepare("DELETE FROM macs").run();
  for (const [, p] of pendientes) p.terminar({ ok: false, error: "La Mac se desvinculó." });
  avisarPantalla({ tipo: "mac", estado: "desvinculada" });
  return { ok: true };
}

// ---------- Conexión de la Mac (pregunta seguido si hay órdenes) ----------
const EN_LINEA_MS = 75e3;
const esperando = new Map(); // macId -> función que entrega órdenes a la petición abierta
const cola = []; // órdenes que nadie ha recogido todavía
const pendientes = new Map(); // id -> { orden, terminar }

function tocar(mac, version) {
  db.prepare("UPDATE macs SET ultimo_contacto = ?, version = COALESCE(?, version) WHERE id = ?")
    .run(new Date().toISOString(), version ? String(version).slice(0, 20) : null, mac.id);
}

/** Petición larga de la Mac: devuelve órdenes en cuanto haya, o [] tras ~25 s. */
export function esperarOrdenes(mac, { version, ms = 25e3 } = {}) {
  tocar(mac, version);
  const listas = cola.splice(0, cola.length);
  if (listas.length) return Promise.resolve(listas);
  return new Promise((resolver) => {
    const anterior = esperando.get(mac.id);
    if (anterior) anterior([]); // solo una petición abierta por Mac
    const t = setTimeout(() => { if (esperando.get(mac.id) === entregar) esperando.delete(mac.id); resolver([]); }, ms);
    function entregar(ordenes) { clearTimeout(t); if (esperando.get(mac.id) === entregar) esperando.delete(mac.id); resolver(ordenes); }
    esperando.set(mac.id, entregar);
  });
}

/** Órdenes que no llegaron (la Mac colgó): vuelven al frente de la fila. */
export function devolver(ordenes) {
  cola.unshift(...ordenes.filter((o) => pendientes.has(o.id)));
}

/** La Mac contesta cómo le fue con una orden. */
export function recibirResultado(mac, { id, ok, resultado, error } = {}) {
  tocar(mac);
  const p = pendientes.get(String(id));
  if (!p) return { ok: false };
  p.terminar(ok ? { ok: true, resultado: resultado ?? null } : { ok: false, error: String(error || "No se pudo.").slice(0, 500) });
  return { ok: true };
}

/** ¿Hay una Mac vinculada y conectada ahora? */
export function estado() {
  const macs = db.prepare("SELECT id, nombre, creada, ultimo_contacto, version FROM macs ORDER BY id").all();
  const ahora = Date.now();
  return {
    macs: macs.map((m) => ({ ...m, en_linea: esperando.has(m.id) || (m.ultimo_contacto && ahora - Date.parse(m.ultimo_contacto) < EN_LINEA_MS) })),
    control_activo: getAjuste("mac_control", "1") === "1",
    descarga: URL_DESCARGA,
    instalar: COMANDO_INSTALAR,
  };
}

const RELEASE = "https://github.com/accepticontabilidad-png/DELTA-STUDIO/releases/download/delta-mac";
export const URL_DESCARGA = `${RELEASE}/DELTA-Mac.zip`;
// Un solo comando para la Terminal: descarga, instala en Aplicaciones y abre (sin el aviso de "app no verificada").
export const COMANDO_INSTALAR = `curl -fsSL ${RELEASE}/instalar.sh | bash`;

export function activarControl(activo) {
  setAjuste("mac_control", activo ? "1" : "0");
  return estado();
}

/**
 * DELTA le pide algo a la Mac y espera la respuesta (lo delicado espera hasta que el dueño
 * conteste el cuadro en la Mac, por eso el tiempo es largo).
 */
export function pedir(accion, datos = {}, { espera } = {}) {
  if (!ACCIONES[accion]) return Promise.reject(new Error(`No conozco la acción "${accion}".`));
  if (getAjuste("mac_control", "1") !== "1") return Promise.reject(new Error("El control de la Mac está apagado en Ajustes."));
  const { macs } = estado();
  if (!macs.length) return Promise.reject(new Error("Todavía no hay una Mac vinculada. Se instala la app DELTA Mac y se vincula en Ajustes → Mi Mac."));
  if (!macs.some((m) => m.en_linea)) return Promise.reject(new Error("La Mac no está conectada ahora (puede estar apagada, dormida o con la app DELTA Mac cerrada)."));
  const id = crypto.randomUUID();
  const orden = { id, accion, datos, riesgo: ACCIONES[accion].riesgo, creada: new Date().toISOString() };
  const limite = espera ?? (ACCIONES[accion].riesgo ? 90e3 : 30e3);
  return new Promise((resolver, rechazar) => {
    const t = setTimeout(() => {
      pendientes.delete(id);
      const i = cola.indexOf(orden);
      if (i >= 0) cola.splice(i, 1);
      rechazar(new Error(ACCIONES[accion].riesgo ? "Nadie confirmó en la Mac a tiempo, así que no se hizo." : "La Mac no contestó a tiempo."));
    }, limite);
    pendientes.set(id, {
      orden,
      terminar: (r) => {
        clearTimeout(t);
        pendientes.delete(id);
        if (r.ok) resolver(r.resultado);
        else rechazar(new Error(r.error));
      },
    });
    const [primera] = esperando.values();
    if (primera) primera([orden]);
    else cola.push(orden);
  });
}

// ---------- Chasquido ----------
let ultimoDespertar = 0;
/** La Mac oyó el doble chasquido: las pantallas abiertas de DELTA se ponen a escuchar. */
export function despertar(mac) {
  tocar(mac);
  ultimoDespertar = Date.now();
  avisarPantalla({ tipo: "despertar" });
  return { ok: true };
}
/** Para la pantalla que se acaba de abrir por el chasquido: ¿hubo uno hace poco? (se consume) */
export function despertarReciente() {
  const si = Date.now() - ultimoDespertar < 20e3;
  if (si) ultimoDespertar = 0;
  return { despertar: si };
}

// Solo para pruebas
export function _reiniciar() {
  codigo = null;
  cola.length = 0;
  for (const [, f] of esperando) f([]);
  esperando.clear();
  pendientes.clear();
  ultimoDespertar = 0;
  db.prepare("DELETE FROM macs").run();
  setAjuste("mac_control", "1");
}
