// Lógica de tareas, calendario, recordatorios y memoria.
// La usan tanto el cerebro de DELTA (herramientas) como el panel de la app.
import { db } from "./db.js";
import { localAUTC, utcALocal, rangoDelDia, ahoraLocalISO } from "./tiempo.js";

const PRIORIDADES = ["baja", "normal", "alta"];
const REPETIR = ["no", "diario", "semanal", "mensual"];

// ---------- Tareas ----------
export function crearTarea({ titulo, notas, cliente, prioridad = "normal", fecha_limite }) {
  if (!titulo?.trim()) throw new Error("La tarea necesita un título");
  if (!PRIORIDADES.includes(prioridad)) prioridad = "normal";
  const r = db
    .prepare("INSERT INTO tareas (titulo, notas, cliente, prioridad, fecha_limite) VALUES (?, ?, ?, ?, ?)")
    .run(titulo.trim(), notas || null, cliente || null, prioridad, fecha_limite ? localAUTC(fecha_limite) : null);
  return obtenerTarea(Number(r.lastInsertRowid));
}

export function obtenerTarea(id) {
  return db.prepare("SELECT * FROM tareas WHERE id = ?").get(id);
}

export function listarTareas({ estado = "pendiente", cliente } = {}) {
  let sql = "SELECT * FROM tareas WHERE 1=1";
  const args = [];
  if (estado && estado !== "todas") { sql += " AND estado = ?"; args.push(estado); }
  if (cliente) { sql += " AND cliente LIKE ?"; args.push(`%${cliente}%`); }
  sql += " ORDER BY estado, CASE prioridad WHEN 'alta' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, fecha_limite IS NULL, fecha_limite, id";
  return db.prepare(sql).all(...args);
}

export function actualizarTarea(id, cambios) {
  const actual = obtenerTarea(id);
  if (!actual) throw new Error(`No existe la tarea ${id}`);
  const n = { ...actual };
  for (const k of ["titulo", "notas", "cliente", "prioridad"]) if (cambios[k] !== undefined) n[k] = cambios[k];
  if (cambios.fecha_limite !== undefined) n.fecha_limite = cambios.fecha_limite ? localAUTC(cambios.fecha_limite) : null;
  if (cambios.estado === "hecha" && actual.estado !== "hecha") { n.estado = "hecha"; n.completada = new Date().toISOString(); }
  if (cambios.estado === "pendiente") { n.estado = "pendiente"; n.completada = null; }
  db.prepare(
    "UPDATE tareas SET titulo=?, notas=?, cliente=?, prioridad=?, fecha_limite=?, estado=?, completada=? WHERE id=?",
  ).run(n.titulo, n.notas, n.cliente, n.prioridad, n.fecha_limite, n.estado, n.completada, id);
  return obtenerTarea(id);
}

export function borrarTarea(id) {
  const t = obtenerTarea(id);
  if (!t) throw new Error(`No existe la tarea ${id}`);
  db.prepare("DELETE FROM tareas WHERE id = ?").run(id);
  return t;
}

// ---------- Calendario (interno; luego se sincroniza con Google u Outlook) ----------
export function crearEvento({ titulo, inicio, fin, lugar, notas, cliente, aviso_min = 15 }) {
  if (!titulo?.trim()) throw new Error("El evento necesita un título");
  const ini = localAUTC(inicio);
  const r = db
    .prepare("INSERT INTO eventos (titulo, inicio, fin, lugar, notas, cliente, aviso_min) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(titulo.trim(), ini, fin ? localAUTC(fin) : null, lugar || null, notas || null, cliente || null, aviso_min ?? 15);
  return db.prepare("SELECT * FROM eventos WHERE id = ?").get(Number(r.lastInsertRowid));
}

export function listarEventos({ desde, hasta } = {}) {
  const hoy = ahoraLocalISO().slice(0, 10);
  const d = desde ? (desde.length <= 10 ? rangoDelDia(desde).desde : localAUTC(desde)) : rangoDelDia(hoy).desde;
  const h = hasta
    ? (hasta.length <= 10 ? rangoDelDia(hasta).hasta : localAUTC(hasta))
    : new Date(new Date(d).getTime() + 7 * 864e5).toISOString();
  return db.prepare("SELECT * FROM eventos WHERE inicio >= ? AND inicio <= ? ORDER BY inicio").all(d, h);
}

export function moverEvento(id, cambios) {
  const e = db.prepare("SELECT * FROM eventos WHERE id = ?").get(id);
  if (!e) throw new Error(`No existe el evento ${id}`);
  const n = { ...e };
  for (const k of ["titulo", "lugar", "notas", "cliente", "aviso_min"]) if (cambios[k] !== undefined) n[k] = cambios[k];
  if (cambios.inicio) { n.inicio = localAUTC(cambios.inicio); n.avisado = 0; }
  if (cambios.fin !== undefined) n.fin = cambios.fin ? localAUTC(cambios.fin) : null;
  db.prepare("UPDATE eventos SET titulo=?, inicio=?, fin=?, lugar=?, notas=?, cliente=?, aviso_min=?, avisado=? WHERE id=?")
    .run(n.titulo, n.inicio, n.fin, n.lugar, n.notas, n.cliente, n.aviso_min, n.avisado, id);
  return db.prepare("SELECT * FROM eventos WHERE id = ?").get(id);
}

export function borrarEvento(id) {
  const e = db.prepare("SELECT * FROM eventos WHERE id = ?").get(id);
  if (!e) throw new Error(`No existe el evento ${id}`);
  db.prepare("DELETE FROM eventos WHERE id = ?").run(id);
  return e;
}

// ---------- Recordatorios ----------
export function crearRecordatorio({ mensaje, cuando, repetir = "no" }) {
  if (!mensaje?.trim()) throw new Error("El recordatorio necesita un mensaje");
  if (!REPETIR.includes(repetir)) repetir = "no";
  const r = db
    .prepare("INSERT INTO recordatorios (mensaje, cuando, repetir) VALUES (?, ?, ?)")
    .run(mensaje.trim(), localAUTC(cuando), repetir);
  return db.prepare("SELECT * FROM recordatorios WHERE id = ?").get(Number(r.lastInsertRowid));
}

export function listarRecordatorios() {
  return db.prepare("SELECT * FROM recordatorios WHERE activo = 1 ORDER BY cuando").all();
}

export function cancelarRecordatorio(id) {
  const r = db.prepare("SELECT * FROM recordatorios WHERE id = ?").get(id);
  if (!r) throw new Error(`No existe el recordatorio ${id}`);
  db.prepare("UPDATE recordatorios SET activo = 0 WHERE id = ?").run(id);
  return r;
}

// ---------- Memoria de largo plazo ----------
export function guardarMemoria(dato) {
  const r = db.prepare("INSERT INTO memorias (dato) VALUES (?)").run(String(dato).trim());
  return { id: Number(r.lastInsertRowid), dato };
}
export function listarMemorias() {
  return db.prepare("SELECT id, dato FROM memorias ORDER BY id").all();
}
export function olvidarMemoria(id) {
  db.prepare("DELETE FROM memorias WHERE id = ?").run(id);
  return { id };
}

// ---------- Resumen ----------
export function resumenDelDia(fechaLocal = ahoraLocalISO().slice(0, 10)) {
  const { desde, hasta } = rangoDelDia(fechaLocal);
  const eventos = db.prepare("SELECT * FROM eventos WHERE inicio >= ? AND inicio <= ? ORDER BY inicio").all(desde, hasta);
  const pendientes = listarTareas({ estado: "pendiente" });
  const vencidas = pendientes.filter((t) => t.fecha_limite && t.fecha_limite < new Date().toISOString());
  const paraHoy = pendientes.filter((t) => t.fecha_limite && t.fecha_limite >= desde && t.fecha_limite <= hasta);
  const recordatorios = db
    .prepare("SELECT * FROM recordatorios WHERE activo = 1 AND cuando >= ? AND cuando <= ? ORDER BY cuando")
    .all(desde, hasta);
  return { fecha: fechaLocal, eventos, tareas_para_hoy: paraHoy, tareas_vencidas: vencidas, total_pendientes: pendientes.length, recordatorios };
}

/** Versión legible (para el modelo) de una fila con fechas UTC. */
export function legible(obj) {
  if (Array.isArray(obj)) return obj.map(legible);
  if (!obj || typeof obj !== "object") return obj;
  const o = {};
  for (const [k, v] of Object.entries(obj)) {
    if (["fecha_limite", "inicio", "fin", "cuando", "completada"].includes(k) && typeof v === "string") o[k] = utcALocal(v);
    else if (Array.isArray(v) || (v && typeof v === "object")) o[k] = legible(v);
    else o[k] = v;
  }
  return o;
}
