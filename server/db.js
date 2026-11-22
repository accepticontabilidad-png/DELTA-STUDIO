// Base de datos local de DELTA (un solo archivo SQLite).
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = process.env.DATA_DIR || "./data";
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

-- ---------- Agencia ----------
CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  industria TEXT,
  contacto TEXT,
  correo TEXT,
  telefono TEXT,
  redes TEXT,                                    -- cuentas y sitio web, texto libre
  servicios TEXT,                                -- qué le hace la agencia
  presupuesto_mensual REAL,
  notas TEXT,
  estado TEXT NOT NULL DEFAULT 'activo',         -- activo | pausado | prospecto | terminado
  creado TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS proyectos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER REFERENCES clientes(id),
  titulo TEXT NOT NULL,
  departamento TEXT,
  brief TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente',      -- pendiente | en_proceso | revision | entregado | cancelado
  entrega TEXT,                                  -- ISO UTC
  creado TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Lo que entrega cada departamento (reportes, propuestas, guiones…)
CREATE TABLE IF NOT EXISTS trabajos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  departamento TEXT NOT NULL,
  cliente_id INTEGER REFERENCES clientes(id),
  proyecto_id INTEGER REFERENCES proyectos(id),
  encargo TEXT NOT NULL,
  resultado TEXT,
  estado TEXT NOT NULL DEFAULT 'en_proceso',     -- en_proceso | listo | fallo
  creado TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  terminado TEXT
);

-- Lo que espera el sí o no del dueño
CREATE TABLE IF NOT EXISTS aprobaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  departamento TEXT NOT NULL,
  cliente_id INTEGER REFERENCES clientes(id),
  trabajo_id INTEGER REFERENCES trabajos(id),
  tipo TEXT NOT NULL,                            -- publicacion | mensaje_cliente | correo | presupuesto | entrega | factura | otro
  titulo TEXT NOT NULL,
  contenido TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente',      -- pendiente | aprobada | rechazada
  comentario TEXT,
  creada TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resuelta TEXT
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
// Y qué archivos adjuntó el usuario en cada mensaje (lista de ids en JSON).
try {
  db.exec("ALTER TABLE conversacion ADD COLUMN archivos TEXT");
} catch {
  /* ya existe */
}

// Agencia, tableros (Panel general y Cuentas): salud del cliente, tope de anuncios y gasto por mes.
for (const col of [
  "salud_manual TEXT",          // null = automática | verde | amarillo | rojo
  "salud_nota TEXT",            // por qué se marcó a mano
  "presupuesto_anuncios REAL",  // tope mensual de inversión en anuncios
  "dia_pago INTEGER",           // Finanzas: día del mes en que vence su mensualidad (5 si no se dice)
]) {
  try {
    db.exec(`ALTER TABLE clientes ADD COLUMN ${col}`);
  } catch {
    /* ya existe */
  }
}
// Gasto en anuncios por cliente, mes y plataforma. Hoy se captura a mano;
// cuando se conecten Meta, Google o TikTok, escribirán aquí con su propia "fuente".
db.exec(`
CREATE TABLE IF NOT EXISTS gasto_anuncios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  mes TEXT NOT NULL,                             -- AAAA-MM (mes local)
  plataforma TEXT NOT NULL,                      -- meta | google | tiktok | otra
  monto REAL NOT NULL DEFAULT 0,
  fuente TEXT NOT NULL DEFAULT 'manual',         -- manual | meta | google | tiktok
  actualizado TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (cliente_id, mes, plataforma)
);
`);

// Meta (Facebook, Instagram y cuentas de anuncios de los clientes).
// meta_activos: lo que DELTA encontró en la cuenta de Meta del dueño y a qué cliente pertenece.
// meta_fotos: una foto de los números de cada cliente por día (seguidores, alcance, anuncios…).
db.exec(`
CREATE TABLE IF NOT EXISTS meta_activos (
  id TEXT PRIMARY KEY,                           -- act_123 | page:123 | ig:123
  tipo TEXT NOT NULL,                            -- anuncios | pagina | instagram
  nombre TEXT NOT NULL,
  extra TEXT,                                    -- JSON: moneda, usuario de Instagram, página ligada…
  token TEXT,                                    -- permiso propio de la página (nunca sale a la pantalla)
  cliente_id INTEGER REFERENCES clientes(id),
  ligado TEXT,                                   -- auto | manual
  visto TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS meta_fotos (
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  fecha TEXT NOT NULL,                           -- AAAA-MM-DD local
  datos TEXT NOT NULL,                           -- JSON
  actualizado TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (cliente_id, fecha)
);
`);

// Finanzas de la agencia (ver finanzas.js): cobros a clientes y gastos de la agencia.
db.exec(`
CREATE TABLE IF NOT EXISTS cobros (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  tipo TEXT NOT NULL DEFAULT 'extra',            -- mensualidad | extra
  concepto TEXT NOT NULL,
  monto REAL NOT NULL,
  mes TEXT NOT NULL,                             -- AAAA-MM: mes al que corresponde el ingreso
  vence TEXT NOT NULL,                           -- AAAA-MM-DD (local)
  pagado TEXT,                                   -- AAAA-MM-DD (local) cuando llegó el dinero
  notas TEXT,
  creado TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS cobros_mensualidad ON cobros (cliente_id, mes) WHERE tipo = 'mensualidad';
CREATE TABLE IF NOT EXISTS gastos_agencia (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  concepto TEXT NOT NULL,
  categoria TEXT NOT NULL DEFAULT 'otros',
  monto REAL NOT NULL,
  fecha TEXT NOT NULL,                           -- AAAA-MM-DD (local)
  fijo INTEGER NOT NULL DEFAULT 0,               -- 1 = se repite cada mes desde su fecha
  baja TEXT,                                     -- AAAA-MM: último mes en que cuenta un gasto fijo
  cliente_id INTEGER REFERENCES clientes(id),    -- si el gasto es por un cliente (para su rentabilidad)
  creado TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`);

// Paid media: resultados que el cliente reporta (prospectos, ventas y cuánto vendió) por mes.
// Cuando existen, mandan sobre lo que mide Meta (el cliente sabe lo que de verdad vendió).
db.exec(`
CREATE TABLE IF NOT EXISTS resultados_anuncios (
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  mes TEXT NOT NULL,                             -- AAAA-MM (mes local)
  prospectos INTEGER,                            -- mensajes o prospectos que llegaron por anuncios
  ventas INTEGER,                                -- ventas cerradas
  valor_ventas REAL,                             -- cuánto vendió por los anuncios
  nota TEXT,
  actualizado TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (cliente_id, mes)
);
`);

export function getAjuste(clave, porDefecto = null) {
  const fila = db.prepare("SELECT valor FROM ajustes WHERE clave = ?").get(clave);
  return fila ? fila.valor : porDefecto;
}

export function setAjuste(clave, valor) {
  db.prepare(
    "INSERT INTO ajustes (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor",
  ).run(clave, String(valor));
}
