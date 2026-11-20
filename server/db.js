// Base de datos local de DELTA (un solo archivo SQLite).
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || "./data";
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, "delta.db"));

db.exec(`
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS tareas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo TEXT NOT NULL,
  notas TEXT,
  cliente TEXT,
  prioridad TEXT NOT NULL DEFAULT 'normal',      -- baja | normal | alta
  fecha_limite TEXT,                             -- ISO UTC
  estado TEXT NOT NULL DEFAULT 'pendiente',      -- pendiente | hecha
  creada TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completada TEXT
);

CREATE TABLE IF NOT EXISTS eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo TEXT NOT NULL,
  inicio TEXT NOT NULL,                          -- ISO UTC
  fin TEXT,
  lugar TEXT,
  notas TEXT,
  cliente TEXT,
  aviso_min INTEGER DEFAULT 15,                  -- minutos antes para avisar
  avisado INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS recordatorios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mensaje TEXT NOT NULL,
  cuando TEXT NOT NULL,                          -- ISO UTC del próximo aviso
  repetir TEXT NOT NULL DEFAULT 'no',            -- no | diario | semanal | mensual
  activo INTEGER NOT NULL DEFAULT 1,
  creado TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS memorias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dato TEXT NOT NULL,
  creada TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS conversacion (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rol TEXT NOT NULL,                             -- user | assistant
  texto TEXT NOT NULL,
  canal TEXT NOT NULL DEFAULT 'app',             -- app | telegram
  fecha TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS avisos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  texto TEXT NOT NULL,
  fecha TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  leido INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ajustes (
  clave TEXT PRIMARY KEY,
  valor TEXT
);

CREATE TABLE IF NOT EXISTS suscripciones_push (
  endpoint TEXT PRIMARY KEY,
  datos TEXT NOT NULL
);
`);

// Columna añadida después: qué herramientas usó DELTA en cada respuesta.
try {
  db.exec("ALTER TABLE conversacion ADD COLUMN acciones TEXT");
} catch {
  /* ya existe */
}

export function getAjuste(clave, porDefecto = null) {
  const fila = db.prepare("SELECT valor FROM ajustes WHERE clave = ?").get(clave);
  return fila ? fila.valor : porDefecto;
}

export function setAjuste(clave, valor) {
  db.prepare(
    "INSERT INTO ajustes (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor",
  ).run(clave, String(valor));
}
