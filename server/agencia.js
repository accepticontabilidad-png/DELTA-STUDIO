// La agencia: clientes, proyectos, trabajos de los departamentos y aprobaciones.
import { db } from "./db.js";
import { localAUTC } from "./tiempo.js";

const ESTADOS_CLIENTE = ["activo", "pausado", "prospecto", "terminado"];
const ESTADOS_PROYECTO = ["pendiente", "en_proceso", "revision", "entregado", "cancelado"];
const CAMPOS_CLIENTE = ["nombre", "industria", "contacto", "correo", "telefono", "redes", "servicios", "presupuesto_mensual", "notas", "estado"];

// ---------- Clientes ----------
export function crearCliente(datos) {
  const nombre = String(datos.nombre || "").trim();
  if (!nombre) throw new Error("El cliente necesita un nombre");
  if (buscarCliente(nombre, true)) throw new Error(`Ya existe un cliente llamado "${nombre}"`);
  const estado = ESTADOS_CLIENTE.includes(datos.estado) ? datos.estado : "activo";
  const r = db
    .prepare("INSERT INTO clientes (nombre, industria, contacto, correo, telefono, redes, servicios, presupuesto_mensual, notas, estado) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(nombre, datos.industria || null, datos.contacto || null, datos.correo || null, datos.telefono || null, datos.redes || null, datos.servicios || null, numero(datos.presupuesto_mensual), datos.notas || null, estado);
  return obtenerCliente(Number(r.lastInsertRowid));
}

const numero = (x) => (x === undefined || x === null || x === "" ? null : Number(x));

export function obtenerCliente(id) {
  return db.prepare("SELECT * FROM clientes WHERE id = ?").get(Number(id));
}

/** Busca por id o por nombre (exacto o parecido). */
export function buscarCliente(clave, exacto = false) {
  if (clave === undefined || clave === null || clave === "") return null;
  if (/^\d+$/.test(String(clave))) return obtenerCliente(clave);
  const t = String(clave).trim();
  return db.prepare("SELECT * FROM clientes WHERE lower(nombre) = lower(?)").get(t)
    || (exacto ? null : db.prepare("SELECT * FROM clientes WHERE nombre LIKE ? ORDER BY length(nombre) LIMIT 1").get(`%${t}%`));
}

export function clienteRequerido(clave) {
  const c = buscarCliente(clave);
  if (!c) throw new Error(`No encuentro al cliente "${clave}"`);
  return c;
}

export function listarClientes({ estado } = {}) {
  const filas = estado && estado !== "todos"
    ? db.prepare("SELECT * FROM clientes WHERE estado = ? ORDER BY nombre").all(estado)
    : db.prepare("SELECT * FROM clientes ORDER BY estado = 'activo' DESC, nombre").all();
  const abiertos = db.prepare("SELECT COUNT(*) n FROM proyectos WHERE cliente_id = ? AND estado NOT IN ('entregado','cancelado')");
  return filas.map((c) => ({ ...c, proyectos_abiertos: abiertos.get(c.id).n }));
}

export function actualizarCliente(clave, cambios) {
  const c = clienteRequerido(clave);
  const n = { ...c };
  for (const k of CAMPOS_CLIENTE) if (cambios[k] !== undefined) n[k] = k === "presupuesto_mensual" ? numero(cambios[k]) : cambios[k];
  if (!ESTADOS_CLIENTE.includes(n.estado)) throw new Error("Estado no válido: " + n.estado);
  db.prepare(`UPDATE clientes SET ${CAMPOS_CLIENTE.map((k) => `${k}=?`).join(", ")} WHERE id=?`).run(...CAMPOS_CLIENTE.map((k) => n[k]), c.id);
  return obtenerCliente(c.id);
}

export function fichaCliente(clave) {
  const c = clienteRequerido(clave);
  return {
    ...c,
    proyectos: db.prepare("SELECT * FROM proyectos WHERE cliente_id = ? ORDER BY estado IN ('entregado','cancelado'), entrega IS NULL, entrega").all(c.id),
    trabajos_recientes: db.prepare("SELECT id, departamento, encargo, estado, creado FROM trabajos WHERE cliente_id = ? ORDER BY id DESC LIMIT 8").all(c.id),
    aprobaciones_pendientes: db.prepare("SELECT id, tipo, titulo FROM aprobaciones WHERE cliente_id = ? AND estado = 'pendiente'").all(c.id),
  };
}

// ---------- Proyectos ----------
export function crearProyecto({ cliente, titulo, departamento, brief, entrega, estado }) {
  if (!String(titulo || "").trim()) throw new Error("El proyecto necesita un título");
  const c = cliente ? clienteRequerido(cliente) : null;
  const r = db
    .prepare("INSERT INTO proyectos (cliente_id, titulo, departamento, brief, entrega, estado) VALUES (?,?,?,?,?,?)")
    .run(c?.id ?? null, titulo.trim(), departamento || null, brief || null, entrega ? localAUTC(entrega) : null, ESTADOS_PROYECTO.includes(estado) ? estado : "pendiente");
  return obtenerProyecto(Number(r.lastInsertRowid));
}

export function obtenerProyecto(id) {
  return db.prepare("SELECT p.*, c.nombre AS cliente FROM proyectos p LEFT JOIN clientes c ON c.id = p.cliente_id WHERE p.id = ?").get(Number(id));
}

export function actualizarProyecto(id, cambios) {
  const p = obtenerProyecto(id);
  if (!p) throw new Error(`No existe el proyecto ${id}`);
  const n = { ...p };
  for (const k of ["titulo", "departamento", "brief", "estado"]) if (cambios[k] !== undefined) n[k] = cambios[k];
  if (cambios.entrega !== undefined) n.entrega = cambios.entrega ? localAUTC(cambios.entrega) : null;
  if (cambios.cliente !== undefined) n.cliente_id = cambios.cliente ? clienteRequerido(cambios.cliente).id : null;
  if (!ESTADOS_PROYECTO.includes(n.estado)) throw new Error("Estado no válido: " + n.estado);
  db.prepare("UPDATE proyectos SET cliente_id=?, titulo=?, departamento=?, brief=?, estado=?, entrega=? WHERE id=?")
    .run(n.cliente_id, n.titulo, n.departamento, n.brief, n.estado, n.entrega, p.id);
  return obtenerProyecto(p.id);
}

export function listarProyectos({ cliente, estado = "abiertos" } = {}) {
  let sql = "SELECT p.*, c.nombre AS cliente FROM proyectos p LEFT JOIN clientes c ON c.id = p.cliente_id WHERE 1=1";
  const args = [];
  if (cliente) { sql += " AND p.cliente_id = ?"; args.push(clienteRequerido(cliente).id); }
  if (estado === "abiertos") sql += " AND p.estado NOT IN ('entregado','cancelado')";
  else if (estado && estado !== "todos") { sql += " AND p.estado = ?"; args.push(estado); }
  sql += " ORDER BY p.entrega IS NULL, p.entrega, p.id DESC";
  return db.prepare(sql).all(...args);
}

// ---------- Trabajos de los departamentos ----------
export function crearTrabajo({ departamento, cliente_id, proyecto_id, encargo }) {
  const r = db.prepare("INSERT INTO trabajos (departamento, cliente_id, proyecto_id, encargo) VALUES (?,?,?,?)")
    .run(departamento, cliente_id ?? null, proyecto_id ?? null, encargo);
  return Number(r.lastInsertRowid);
}

export function terminarTrabajo(id, { resultado, estado = "listo" }) {
  db.prepare("UPDATE trabajos SET resultado = ?, estado = ?, terminado = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(resultado, estado, id);
  return obtenerTrabajo(id);
}

export function obtenerTrabajo(id) {
  return db.prepare("SELECT t.*, c.nombre AS cliente FROM trabajos t LEFT JOIN clientes c ON c.id = t.cliente_id WHERE t.id = ?").get(Number(id));
}

export function listarTrabajos({ departamento, cliente, limite = 20 } = {}) {
  let sql = "SELECT t.*, c.nombre AS cliente FROM trabajos t LEFT JOIN clientes c ON c.id = t.cliente_id WHERE 1=1";
  const args = [];
  if (departamento) { sql += " AND t.departamento = ?"; args.push(departamento); }
  if (cliente) { sql += " AND t.cliente_id = ?"; args.push(clienteRequerido(cliente).id); }
  sql += " ORDER BY t.id DESC LIMIT ?";
  args.push(Math.min(100, Number(limite) || 20));
  return db.prepare(sql).all(...args);
}

// ---------- Aprobaciones ----------
const TIPOS = ["publicacion", "mensaje_cliente", "correo", "presupuesto", "entrega", "factura", "otro"];

export function pedirAprobacion({ departamento, cliente_id, trabajo_id, tipo, titulo, contenido }) {
  if (!String(titulo || "").trim() || !String(contenido || "").trim()) throw new Error("La aprobación necesita título y contenido");
  const r = db.prepare("INSERT INTO aprobaciones (departamento, cliente_id, trabajo_id, tipo, titulo, contenido) VALUES (?,?,?,?,?,?)")
    .run(departamento, cliente_id ?? null, trabajo_id ?? null, TIPOS.includes(tipo) ? tipo : "otro", titulo.trim(), contenido.trim());
  return obtenerAprobacion(Number(r.lastInsertRowid));
}

export function obtenerAprobacion(id) {
  return db.prepare("SELECT a.*, c.nombre AS cliente FROM aprobaciones a LEFT JOIN clientes c ON c.id = a.cliente_id WHERE a.id = ?").get(Number(id));
}

export function listarAprobaciones({ estado = "pendiente", limite = 50 } = {}) {
  const filtro = estado === "todas" ? "" : "WHERE a.estado = ?";
  const args = estado === "todas" ? [] : [estado];
  return db.prepare(`SELECT a.*, c.nombre AS cliente FROM aprobaciones a LEFT JOIN clientes c ON c.id = a.cliente_id ${filtro} ORDER BY a.id DESC LIMIT ?`)
    .all(...args, Math.min(200, Number(limite) || 50));
}

export function resolverAprobacion(id, decision, comentario) {
  const a = obtenerAprobacion(id);
  if (!a) throw new Error(`No existe la aprobación ${id}`);
  if (a.estado !== "pendiente") throw new Error(`La aprobación ${id} ya estaba ${a.estado}`);
  if (!["aprobada", "rechazada"].includes(decision)) throw new Error("La decisión debe ser aprobada o rechazada");
  db.prepare("UPDATE aprobaciones SET estado = ?, comentario = ?, resuelta = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
    .run(decision, comentario || null, a.id);
  return obtenerAprobacion(a.id);
}

// ---------- Tablero ----------
export function tablero() {
  const uno = (sql, ...a) => db.prepare(sql).get(...a).n;
  const enSieteDias = new Date(Date.now() + 7 * 864e5).toISOString();
  return {
    clientes_activos: uno("SELECT COUNT(*) n FROM clientes WHERE estado = 'activo'"),
    proyectos_abiertos: uno("SELECT COUNT(*) n FROM proyectos WHERE estado NOT IN ('entregado','cancelado')"),
    entregas_semana: uno("SELECT COUNT(*) n FROM proyectos WHERE estado NOT IN ('entregado','cancelado') AND entrega IS NOT NULL AND entrega <= ?", enSieteDias),
    atrasados: uno("SELECT COUNT(*) n FROM proyectos WHERE estado NOT IN ('entregado','cancelado') AND entrega IS NOT NULL AND entrega < ?", new Date().toISOString()),
    aprobaciones_pendientes: uno("SELECT COUNT(*) n FROM aprobaciones WHERE estado = 'pendiente'"),
    trabajando: uno("SELECT COUNT(*) n FROM trabajos WHERE estado = 'en_proceso'"),
    presupuesto_mensual: db.prepare("SELECT COALESCE(SUM(presupuesto_mensual),0) n FROM clientes WHERE estado = 'activo'").get().n,
    clientes: listarClientes(),
    proximas_entregas: listarProyectos({}).slice(0, 8),
    actividad: listarTrabajos({ limite: 8 }).map(({ resultado, ...t }) => ({ ...t, extracto: (resultado || "").slice(0, 180) })),
  };
}
