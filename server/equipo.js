// Equipo: usuarios propios para quien trabaja con el dueño (rol "Equipo"), con permisos por sección
// y por cliente, sus tareas asignadas y un historial de quién cambió qué.
// Lo personal del dueño (DELTA, agenda, correo, bolsa, finanzas, ajustes) nunca se comparte.
import crypto from "node:crypto";
import { db } from "./db.js";
import { alcance, clientesPermitidos, puedeVerCliente } from "./alcance.js";
import { cerrarSesionesDe } from "./seguridad.js";
import { listarTareas } from "./agenda.js";

/** Secciones que el dueño puede compartir. Paid media y Analítica muestran a todos los clientes juntos. */
export const SECCIONES_EQUIPO = {
  crm: { nombre: "CRM y embudo" },
  contenido: { nombre: "Contenido" },
  tendencias: { nombre: "Tendencias" },
  seo: { nombre: "SEO y web" },
  paidmedia: { nombre: "Paid media", todos: true },
  analitica: { nombre: "Analítica", todos: true },
};
const CLAVE_MIN = 10;

const json = (x, d) => { try { return JSON.parse(x); } catch { return d; } };
function vestir(u) {
  if (!u) return null;
  const { clave_hash, sal, ...r } = u;
  return { ...r, secciones: json(u.secciones, []), clientes: u.clientes === null ? null : json(u.clientes, []), activo: Boolean(u.activo) };
}
const hash = (clave, sal) => crypto.scryptSync(String(clave), sal, 32).toString("hex");

function usuarioValido(x) {
  const t = String(x || "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(t)) throw new Error("El usuario debe tener de 3 a 30 letras o números, sin espacios (ej. sofia o sofi.agencia)");
  return t;
}
function claveValida(x) {
  const t = String(x || "");
  if (t.length < CLAVE_MIN) throw new Error(`La clave debe tener al menos ${CLAVE_MIN} caracteres`);
  if (t.length > 200) throw new Error("La clave es demasiado larga");
  if (process.env.CLAVE_ACCESO && t === process.env.CLAVE_ACCESO) throw new Error("No uses tu propia clave para alguien del equipo");
  return t;
}
function seccionesValidas(lista, clientes) {
  const l = [...new Set((Array.isArray(lista) ? lista : []).map(String))].filter((s) => SECCIONES_EQUIPO[s]);
  // Si solo ve algunos clientes, no puede abrir pantallas que juntan a todos.
  return clientes ? l.filter((s) => !SECCIONES_EQUIPO[s].todos) : l;
}
function clientesValidos(lista) {
  if (lista === null || lista === undefined || lista === "todos") return null;
  const ids = [...new Set((Array.isArray(lista) ? lista : [lista]).map(Number).filter(Boolean))];
  const existen = ids.filter((id) => db.prepare("SELECT 1 FROM clientes WHERE id = ?").get(id));
  if (!existen.length) throw new Error("Elige al menos un cliente (o todos)");
  return existen;
}

export const obtenerUsuario = (id) => vestir(db.prepare("SELECT * FROM usuarios WHERE id = ?").get(Number(id)));
export function listarUsuarios() {
  const nombres = Object.fromEntries(db.prepare("SELECT id, nombre FROM clientes").all().map((c) => [c.id, c.nombre]));
  const pendientes = db.prepare("SELECT COUNT(*) n FROM tareas WHERE asignada_a = ? AND estado = 'pendiente'");
  return db.prepare("SELECT * FROM usuarios ORDER BY activo DESC, nombre").all().map(vestir).map((u) => ({
    ...u,
    clientes_nombres: u.clientes ? u.clientes.map((id) => nombres[id]).filter(Boolean) : null,
    tareas_pendientes: pendientes.get(u.id).n,
  }));
}

export function crearUsuario({ nombre, usuario, clave, secciones, clientes } = {}) {
  const n = String(nombre || "").trim().slice(0, 80);
  if (!n) throw new Error("Falta el nombre");
  const u = usuarioValido(usuario);
  if (db.prepare("SELECT 1 FROM usuarios WHERE usuario = ?").get(u)) throw new Error(`Ya existe el usuario "${u}"`);
  const sal = crypto.randomBytes(16).toString("hex");
  const cl = clientesValidos(clientes);
  const r = db.prepare("INSERT INTO usuarios (nombre, usuario, clave_hash, sal, secciones, clientes) VALUES (?,?,?,?,?,?)")
    .run(n, u, hash(claveValida(clave), sal), sal, JSON.stringify(seccionesValidas(secciones, cl)), cl ? JSON.stringify(cl) : null);
  return obtenerUsuario(r.lastInsertRowid);
}

export function actualizarUsuario(id, { nombre, usuario, clave, secciones, clientes, activo } = {}) {
  const u = obtenerUsuario(id);
  if (!u) throw new Error("Esa persona ya no existe");
  const sets = [], vals = [];
  const poner = (c, v) => { sets.push(`${c} = ?`); vals.push(v); };
  if (nombre !== undefined) { const n = String(nombre).trim().slice(0, 80); if (!n) throw new Error("Falta el nombre"); poner("nombre", n); }
  if (usuario !== undefined) {
    const x = usuarioValido(usuario);
    if (db.prepare("SELECT 1 FROM usuarios WHERE usuario = ? AND id != ?").get(x, u.id)) throw new Error(`Ya existe el usuario "${x}"`);
    poner("usuario", x);
  }
  const cl = clientes !== undefined ? clientesValidos(clientes) : u.clientes;
  if (clientes !== undefined) poner("clientes", cl ? JSON.stringify(cl) : null);
  if (secciones !== undefined || clientes !== undefined) poner("secciones", JSON.stringify(seccionesValidas(secciones ?? u.secciones, cl)));
  let cerrar = false;
  if (clave) {
    const sal = crypto.randomBytes(16).toString("hex");
    poner("clave_hash", hash(claveValida(clave), sal)); poner("sal", sal);
    cerrar = true;
  }
  if (activo !== undefined) { poner("activo", activo ? 1 : 0); if (!activo) cerrar = true; }
  if (sets.length) db.prepare(`UPDATE usuarios SET ${sets.join(", ")} WHERE id = ?`).run(...vals, u.id);
  if (cerrar) cerrarSesionesDe(u.id); // con clave nueva o sin acceso, se le cierra la sesión al momento
  return obtenerUsuario(u.id);
}

/** Quita a la persona. Sus tareas pendientes regresan al dueño; el historial se conserva. */
export function borrarUsuario(id) {
  const u = obtenerUsuario(id);
  if (!u) return { ok: true };
  cerrarSesionesDe(u.id);
  db.prepare("UPDATE tareas SET asignada_a = NULL WHERE asignada_a = ?").run(u.id);
  db.prepare("DELETE FROM usuarios WHERE id = ?").run(u.id);
  return { ok: true, nombre: u.nombre };
}

const HASH_FALSO = hash("x".repeat(CLAVE_MIN), "0".repeat(32));
/** Revisa usuario y clave. Devuelve la persona o null (tarda lo mismo exista o no). */
export function verificarUsuario(usuario, clave) {
  const t = String(usuario || "").trim().toLowerCase();
  const f = /^[a-z0-9._-]{3,30}$/.test(t) ? db.prepare("SELECT * FROM usuarios WHERE usuario = ?").get(t) : null;
  const calc = Buffer.from(hash(String(clave || ""), f?.sal || "0".repeat(32)), "hex");
  const ok = crypto.timingSafeEqual(calc, Buffer.from(f?.clave_hash || HASH_FALSO, "hex"));
  if (!f || !ok || !f.activo) return null;
  db.prepare("UPDATE usuarios SET ultimo_acceso = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(f.id);
  return vestir(f);
}

// =====================================================================
//  Qué puede hacer alguien del equipo en la API
// =====================================================================
// [método, ruta, sección (null = siempre)]. Todo lo que no está aquí se le niega.
const PERMISOS = [
  ["GET", /^\/panel$/, null],
  ["GET", /^\/cuentas$/, null],
  ["POST", /^\/tareas$/, null],
  ["PATCH", /^\/tareas\/\d+$/, null],
  ["GET", /^\/crm(\/reporte)?$/, "crm"],
  ["*", /^\/crm\/prospectos(\/\d+(\/(nota|sugerir|borrador|enviar|enviado))?)?$/, "crm"],
  ["DELETE", /^\/crm\/borradores\/\d+$/, "crm"],
  ["GET", /^\/contenido$/, "contenido"],
  ["*", /^\/contenido(\/\d+)?$/, "contenido"],
  ["GET", /^\/tendencias$/, "tendencias"],
  ["*", /^\/tendencias\/(config|buscar|ideas\/\d+(\/contenido)?)$/, "tendencias"],
  ["GET", /^\/seo$/, "seo"],
  ["PUT", /^\/seo\/config$/, "seo"],
  ["POST", /^\/seo\/revisar$/, "seo"],
  ["GET", /^\/paidmedia$/, "paidmedia"],
  ["*", /^\/paidmedia\/resultados$/, "paidmedia"],
  ["GET", /^\/analitica$/, "analitica"],
  ["GET", /^\/reportes(\/pagina)?$/, "analitica"],
];
// Pantallas que trabajan un cliente a la vez: si no dice cuál, se usa el primero que puede ver.
const UN_CLIENTE = [/^\/crm(\/reporte)?$/, /^\/contenido$/];
// De qué cliente es cada cosa que se toca por id.
const DUENO_DE = [
  [/^\/crm\/prospectos\/(\d+)/, "SELECT cliente_id FROM prospectos WHERE id = ?"],
  [/^\/crm\/borradores\/(\d+)/, "SELECT p.cliente_id FROM prospecto_eventos e JOIN prospectos p ON p.id = e.prospecto_id WHERE e.id = ?"],
  [/^\/contenido\/(\d+)/, "SELECT cliente_id FROM contenidos WHERE id = ?"],
  [/^\/tendencias\/ideas\/(\d+)/, "SELECT cliente_id FROM tendencias_ideas WHERE id = ?"],
];

export function permitido(u, metodo, ruta) {
  const p = PERMISOS.find(([m, re]) => (m === "*" || m === metodo || (m === "GET" && metodo === "HEAD")) && re.test(ruta));
  return Boolean(p && (p[2] === null || u.secciones.includes(p[2])));
}

const negar = (res, texto = "Esto no está en tus permisos. Pídeselo a tu jefe.") => res.status(403).json({ error: texto });

/**
 * Va justo después de revisar la sesión. Al dueño lo deja pasar; a alguien del equipo solo a sus
 * secciones y sus clientes, y todo lo que hace corre "dentro" de su alcance.
 */
export function autorizar(req, res, next) {
  if (!req.usuarioId) { registrarSiCambia(req, res); return next(); }
  const u = obtenerUsuario(req.usuarioId);
  if (!u?.activo) { cerrarSesionesDe(req.usuarioId); return res.status(401).json({ error: "No autorizado" }); }
  req.usuario = u;
  const ruta = req.path;
  if (!permitido(u, req.method, ruta)) return negar(res);
  return alcance.run({ usuario: u }, () => {
    const p = clientesPermitidos();
    if (p) {
      // Cliente que pide por la dirección o en lo que manda
      for (const x of [req.query?.cliente, req.body?.cliente]) {
        if (x === undefined || x === null || x === "") continue;
        const c = /^\d+$/.test(String(x)) ? Number(x) : db.prepare("SELECT id FROM clientes WHERE lower(nombre) = lower(?)").get(String(x).trim())?.id;
        if (!c || !p.has(c)) return negar(res, "No tienes acceso a ese cliente");
      }
      if (req.method === "GET" && !req.query?.cliente && UN_CLIENTE.some((re) => re.test(ruta))) {
        const primero = [...p].find((id) => db.prepare("SELECT 1 FROM clientes WHERE id = ? AND estado != 'terminado'").get(id)) ?? [...p][0];
        req.url += `${req.url.includes("?") ? "&" : "?"}cliente=${primero}`;
      }
    }
    // Lo que se toca por id tiene que ser de un cliente suyo
    for (const [re, sql] of DUENO_DE) {
      const m = ruta.match(re);
      if (m) {
        const f = db.prepare(sql).get(Number(m[1]));
        if (f && !puedeVerCliente(f.cliente_id)) return negar(res, "No tienes acceso a ese cliente");
      }
    }
    // Sus tareas: solo las que le asignaron
    const t = ruta.match(/^\/tareas\/(\d+)$/);
    if (t) {
      const f = db.prepare("SELECT asignada_a FROM tareas WHERE id = ?").get(Number(t[1]));
      if (!f || f.asignada_a !== u.id) return negar(res, "Esa tarea no es tuya");
      const sobra = Object.keys(req.body || {}).filter((k) => !["estado", "notas"].includes(k));
      if (sobra.length) return negar(res, "Solo puedes marcarla como hecha o agregarle notas");
    }
    if (req.method === "POST" && ruta === "/tareas") req.body = { ...(req.body || {}), asignada_a: u.id, para: undefined };
    // Por si acaso: de lo que se responde se quita cualquier cosa de otros clientes
    if (p) {
      const json = res.json.bind(res);
      res.json = (d) => json(filtrarClientes(d, p));
    }
    registrarSiCambia(req, res);
    next();
  });
}

export function filtrarClientes(d, p) {
  if (Array.isArray(d)) return d.filter((x) => !(x && typeof x === "object" && x.cliente_id != null && !p.has(Number(x.cliente_id)))).map((x) => filtrarClientes(x, p));
  if (d && typeof d === "object") return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, filtrarClientes(v, p)]));
  return d;
}

// =====================================================================
//  Historial: quién cambió qué
// =====================================================================
const SECCION_DE = [[/^\/crm/, "crm"], [/^\/contenido/, "contenido"], [/^\/tendencias/, "tendencias"], [/^\/seo/, "seo"], [/^\/paidmedia/, "paidmedia"], [/^\/tareas/, "tareas"], [/^\/reportes/, "analitica"], [/^\/equipo/, "equipo"]];
const ETAPA_CRM = { nuevo: "Nuevo", contactado: "Contactado", cita: "Cita agendada", asistio: "Asistió", venta: "Venta", perdido: "Perdido" };

function describir(req) {
  const r = req.path, m = req.method, b = req.body || {};
  const fila = (sql, id) => (id ? db.prepare(sql).get(Number(id)) : null);
  let x;
  if ((x = r.match(/^\/crm\/prospectos\/(\d+)(?:\/(\w+))?$/))) {
    const p = fila("SELECT nombre, cliente_id FROM prospectos WHERE id = ?", x[1]);
    const n = p?.nombre || "un prospecto";
    const acc = { nota: `Anotó algo en ${n}`, sugerir: `Pidió a DELTA un mensaje para ${n}`, borrador: `Dejó un mensaje listo para ${n}`, enviar: `Le escribió por WhatsApp a ${n}`, enviado: `Marcó que ya le escribió a ${n}` }[x[2]];
    if (acc) return [acc, p?.cliente_id];
    if (m === "DELETE") return [`Quitó el prospecto ${n}`, p?.cliente_id];
    if (b.mover) return [`Movió a ${n} ${Number(b.mover) > 0 ? "a la siguiente etapa" : "a la etapa anterior"}`, p?.cliente_id];
    return [b.etapa && ETAPA_CRM[b.etapa] ? `Pasó a ${n} a ${ETAPA_CRM[b.etapa]}` : `Actualizó a ${n}`, p?.cliente_id];
  }
  if (r === "/crm/prospectos") return [`Agregó el prospecto ${b.nombre || b.telefono || ""}`.trim(), null];
  if ((x = r.match(/^\/contenido\/(\d+)$/))) {
    const p = fila("SELECT titulo, cliente_id FROM contenidos WHERE id = ?", x[1]);
    const n = p ? `"${p.titulo}"` : "una pieza";
    if (m === "DELETE") return [`Quitó la pieza ${n}`, p?.cliente_id];
    if (b.mover) return [`Movió la pieza ${n} ${Number(b.mover) > 0 ? "a la siguiente etapa" : "a la etapa anterior"}`, p?.cliente_id];
    return [b.etapa ? `Pasó la pieza ${n} a ${b.etapa}` : `Editó la pieza ${n}`, p?.cliente_id];
  }
  if (r === "/contenido") return [`Creó la pieza "${b.titulo || ""}"`, null];
  if ((x = r.match(/^\/tareas\/(\d+)$/))) {
    const t = fila("SELECT titulo FROM tareas WHERE id = ?", x[1]);
    return [b.estado === "hecha" ? `Terminó la tarea "${t?.titulo || ""}"` : m === "DELETE" ? `Borró la tarea "${t?.titulo || ""}"` : `Editó la tarea "${t?.titulo || ""}"`, null];
  }
  if (r === "/tareas") return [`Creó la tarea "${b.titulo || ""}"`, null];
  if (/^\/tendencias\/ideas\/\d+\/contenido$/.test(r)) return ["Pasó una idea de Tendencias a Contenido", null];
  if (/^\/tendencias\/ideas\/\d+$/.test(r)) return ["Descartó una idea de Tendencias", null];
  if (r === "/tendencias/buscar") return ["Buscó tendencias nuevas", null];
  if (r === "/tendencias/config") return ["Cambió los temas y cuentas de Tendencias", null];
  if (r === "/seo/revisar") return ["Revisó un sitio web", null];
  if (r === "/seo/config") return ["Cambió el sitio de un cliente en SEO", null];
  if (r === "/paidmedia/resultados") return [m === "DELETE" ? "Borró resultados de anuncios" : "Anotó resultados de anuncios", null];
  if (r === "/equipo/personas") return [`Le dio acceso a ${b.nombre || "alguien"}`, null];
  if ((x = r.match(/^\/equipo\/personas\/(\d+)$/))) {
    const n = fila("SELECT nombre FROM usuarios WHERE id = ?", x[1])?.nombre || "alguien";
    if (m === "DELETE") return [`Le quitó el acceso a ${n}`, null];
    if (b.activo === false) return [`Pausó el acceso de ${n}`, null];
    if (b.activo === true) return [`Reactivó el acceso de ${n}`, null];
    return [b.clave ? `Le cambió la clave a ${n}` : `Cambió los permisos de ${n}`, null];
  }
  return ["Hizo un cambio", null];
}

/** Anota en el historial lo que cambió (solo si salió bien). */
export function registrarSiCambia(req, res) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const sec = SECCION_DE.find(([re]) => re.test(req.path))?.[1];
  if (!sec) return;
  let desc;
  try { desc = describir(req); } catch { desc = ["Hizo un cambio", null]; }
  const u = req.usuario || null;
  res.on("finish", () => {
    if (res.statusCode >= 400) return;
    let cliente = desc[1] ?? null;
    if (!cliente && req.body?.cliente) cliente = /^\d+$/.test(String(req.body.cliente)) ? Number(req.body.cliente) : db.prepare("SELECT id FROM clientes WHERE lower(nombre) = lower(?)").get(String(req.body.cliente))?.id ?? null;
    db.prepare("INSERT INTO bitacora (usuario_id, quien, seccion, accion, cliente_id) VALUES (?,?,?,?,?)")
      .run(u?.id ?? null, u?.nombre || "Tú", sec, String(desc[0]).slice(0, 300), cliente);
  });
}

export function historial({ usuario, limite = 80 } = {}) {
  const args = [];
  let sql = "SELECT b.*, c.nombre cliente FROM bitacora b LEFT JOIN clientes c ON c.id = b.cliente_id WHERE 1=1";
  if (usuario === "equipo") sql += " AND b.usuario_id IS NOT NULL";
  else if (usuario) { sql += " AND b.usuario_id = ?"; args.push(Number(usuario)); }
  sql += " ORDER BY b.id DESC LIMIT ?";
  args.push(Math.min(300, Number(limite) || 80));
  db.prepare("DELETE FROM bitacora WHERE fecha < ?").run(new Date(Date.now() - 365 * 864e5).toISOString());
  return db.prepare(sql).all(...args);
}

/** Lo que ve el dueño en la pantalla Equipo. */
export function tableroEquipo() {
  return {
    personas: listarUsuarios(),
    secciones: SECCIONES_EQUIPO,
    clientes: db.prepare("SELECT id, nombre FROM clientes WHERE estado != 'terminado' ORDER BY nombre").all(),
    tareas: listarTareas({ estado: "pendiente", asignada_a: "equipo" }),
    hechas: listarTareas({ estado: "hecha", asignada_a: "equipo" }).sort((a, b) => String(b.completada).localeCompare(String(a.completada))).slice(0, 10),
    historial: historial({ limite: 60 }),
  };
}
