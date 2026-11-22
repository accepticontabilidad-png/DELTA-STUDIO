// La agencia: clientes, proyectos, trabajos de los departamentos y aprobaciones.
import { db } from "./db.js";
import { localAUTC, ahoraLocalISO } from "./tiempo.js";

const ESTADOS_CLIENTE = ["activo", "pausado", "prospecto", "terminado"];
const ESTADOS_PROYECTO = ["pendiente", "en_proceso", "revision", "entregado", "cancelado"];
const CAMPOS_CLIENTE = ["nombre", "industria", "contacto", "correo", "telefono", "redes", "servicios", "presupuesto_mensual", "notas", "estado", "salud_manual", "salud_nota", "presupuesto_anuncios", "dia_pago"];
const NUMERICOS = ["presupuesto_mensual", "presupuesto_anuncios", "dia_pago"];
const SALUDES = ["verde", "amarillo", "rojo"];
export const PLATAFORMAS = { meta: "Meta (Facebook e Instagram)", google: "Google", tiktok: "TikTok", otra: "Otra" };

// ---------- Clientes ----------
export function crearCliente(datos) {
  const nombre = String(datos.nombre || "").trim();
  if (!nombre) throw new Error("El cliente necesita un nombre");
  if (buscarCliente(nombre, true)) throw new Error(`Ya existe un cliente llamado "${nombre}"`);
  const estado = ESTADOS_CLIENTE.includes(datos.estado) ? datos.estado : "activo";
  const r = db
    .prepare("INSERT INTO clientes (nombre, industria, contacto, correo, telefono, redes, servicios, presupuesto_mensual, notas, estado, presupuesto_anuncios, salud_manual, salud_nota, dia_pago) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(nombre, datos.industria || null, datos.contacto || null, datos.correo || null, datos.telefono || null, datos.redes || null, datos.servicios || null, numero(datos.presupuesto_mensual), datos.notas || null, estado,
      numero(datos.presupuesto_anuncios), SALUDES.includes(datos.salud_manual) ? datos.salud_manual : null, datos.salud_nota || null,
      Number.isInteger(Number(datos.dia_pago)) && datos.dia_pago >= 1 && datos.dia_pago <= 28 ? Number(datos.dia_pago) : null);
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
  for (const k of CAMPOS_CLIENTE) if (cambios[k] !== undefined) n[k] = NUMERICOS.includes(k) ? numero(cambios[k]) : cambios[k];
  if (!ESTADOS_CLIENTE.includes(n.estado)) throw new Error("Estado no válido: " + n.estado);
  if (["", "auto", "automatica"].includes(n.salud_manual)) n.salud_manual = null;
  if (n.salud_manual && !SALUDES.includes(n.salud_manual)) throw new Error("Salud no válida: " + n.salud_manual);
  if (!n.salud_manual) n.salud_nota = null;
  for (const k of NUMERICOS) if (n[k] !== null && !Number.isFinite(n[k])) throw new Error("Debe ser un número: " + k);
  if (n.dia_pago !== null && (n.dia_pago < 1 || n.dia_pago > 28 || !Number.isInteger(n.dia_pago))) throw new Error("El día de pago va del 1 al 28");
  db.prepare(`UPDATE clientes SET ${CAMPOS_CLIENTE.map((k) => `${k}=?`).join(", ")} WHERE id=?`).run(...CAMPOS_CLIENTE.map((k) => n[k]), c.id);
  return obtenerCliente(c.id);
}

export function fichaCliente(clave) {
  const c = clienteRequerido(clave);
  const mes = mesActual();
  return {
    ...c,
    salud: saludCliente(c),
    proyectos: db.prepare("SELECT * FROM proyectos WHERE cliente_id = ? ORDER BY estado IN ('entregado','cancelado'), entrega IS NULL, entrega").all(c.id),
    trabajos_recientes: db.prepare("SELECT id, departamento, encargo, estado, creado FROM trabajos WHERE cliente_id = ? ORDER BY id DESC LIMIT 8").all(c.id),
    aprobaciones_pendientes: db.prepare("SELECT id, tipo, titulo, creada FROM aprobaciones WHERE cliente_id = ? AND estado = 'pendiente' ORDER BY id").all(c.id),
    juntas: juntasDeCliente(c, { limite: 6 }),
    gasto: {
      mes,
      total: gastoDelMes(c.id, mes),
      tope: c.presupuesto_anuncios,
      por_plataforma: db.prepare("SELECT plataforma, monto, fuente, actualizado FROM gasto_anuncios WHERE cliente_id = ? AND mes = ? ORDER BY monto DESC").all(c.id, mes),
      historial: historialGasto(c.id, 6),
    },
    meta: metaDeCliente(c.id),
  };
}

// ---------- Meta (Facebook, Instagram y anuncios), lo que dejó la última actualización ----------
/** Los números de Meta del cliente: la foto más reciente y cuánto cambió contra hace ~30 días. */
export function metaDeCliente(clienteId) {
  const activos = db.prepare("SELECT id, tipo, nombre FROM meta_activos WHERE cliente_id = ? ORDER BY tipo, nombre").all(clienteId);
  if (!activos.length) return null;
  const hoy = db.prepare("SELECT fecha, datos, actualizado FROM meta_fotos WHERE cliente_id = ? ORDER BY fecha DESC LIMIT 1").get(clienteId);
  if (!hoy) return { activos, actualizado: null };
  const antes = db.prepare("SELECT fecha, datos FROM meta_fotos WHERE cliente_id = ? AND fecha <= date(?, '-28 days') ORDER BY fecha DESC LIMIT 1").get(clienteId, hoy.fecha)
    || db.prepare("SELECT fecha, datos FROM meta_fotos WHERE cliente_id = ? AND fecha < ? ORDER BY fecha LIMIT 1").get(clienteId, hoy.fecha);
  const d = JSON.parse(hoy.datos);
  const a = antes ? JSON.parse(antes.datos) : null;
  const cambio = (red) => (a?.[red] && d[red] && Number.isFinite(a[red].seguidores) ? d[red].seguidores - a[red].seguidores : null);
  return {
    activos,
    actualizado: hoy.actualizado,
    ...d,
    seguidores_cambio: { facebook: cambio("facebook"), instagram: cambio("instagram"), desde: antes?.fecha || null },
  };
}

// ---------- Juntas (eventos de la agenda ligados al cliente) ----------
/** Próximas juntas del cliente: eventos cuyo campo "cliente" o título lo nombran. */
export function juntasDeCliente(c, { limite = 5, desde = new Date().toISOString() } = {}) {
  return db.prepare(`SELECT id, titulo, inicio, fin, lugar FROM eventos
      WHERE inicio >= ? AND (lower(cliente) = lower(?) OR cliente LIKE ? OR titulo LIKE ?)
      ORDER BY inicio LIMIT ?`)
    .all(desde, c.nombre, `%${c.nombre}%`, `%${c.nombre}%`, limite);
}

// ---------- Gasto en anuncios ----------
export const mesActual = () => ahoraLocalISO().slice(0, 7);

export function gastoDelMes(clienteId, mes = mesActual()) {
  return db.prepare("SELECT COALESCE(SUM(monto),0) n FROM gasto_anuncios WHERE cliente_id = ? AND mes = ?").get(clienteId, mes).n;
}

function historialGasto(clienteId, meses) {
  const [a, m] = mesActual().split("-").map(Number);
  const lista = [];
  for (let i = meses - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(a, m - 1 - i, 1));
    const clave = d.toISOString().slice(0, 7);
    lista.push({ mes: clave, total: gastoDelMes(clienteId, clave) });
  }
  return lista;
}

/**
 * Anota cuánto lleva gastado un cliente en una plataforma en el mes (el total del mes, no un abono).
 * Lo usa la pantalla de Cuentas y DELTA; los conectores de Meta o Google usarán la misma función con su fuente.
 */
export function registrarGasto({ cliente, plataforma = "meta", monto, mes, fuente = "manual" }) {
  const c = clienteRequerido(cliente);
  const p = String(plataforma || "").toLowerCase();
  if (!PLATAFORMAS[p]) throw new Error("Plataforma no válida: usa meta, google, tiktok u otra");
  const n = Number(String(monto ?? "").replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) throw new Error("El monto debe ser un número positivo");
  const m = mes || mesActual();
  if (!/^\d{4}-\d{2}$/.test(m)) throw new Error("Mes no válido (AAAA-MM)");
  db.prepare(`INSERT INTO gasto_anuncios (cliente_id, mes, plataforma, monto, fuente) VALUES (?,?,?,?,?)
      ON CONFLICT(cliente_id, mes, plataforma) DO UPDATE SET monto = excluded.monto, fuente = excluded.fuente, actualizado = strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
    .run(c.id, m, p, n, fuente);
  return { cliente: c.nombre, mes: m, plataforma: p, monto: n, total_mes: gastoDelMes(c.id, m), tope: c.presupuesto_anuncios };
}

// ---------- Salud del cliente (semáforo) ----------
const DIA = 864e5;

/**
 * Verde, amarillo o rojo, con los motivos en palabras.
 * Rojo: entregas atrasadas o anuncios por encima del tope. Amarillo: entrega en menos de 2 días,
 * algo esperando aprobación más de 2 días, anuncios arriba del 85 % del tope o un mes sin movimiento.
 * Si el dueño la marcó a mano, manda lo que él dijo.
 */
export function saludCliente(c) {
  const ahora = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const rojo = [], amarillo = [];
  const abiertos = db.prepare("SELECT titulo, entrega FROM proyectos WHERE cliente_id = ? AND estado NOT IN ('entregado','cancelado') AND entrega IS NOT NULL ORDER BY entrega").all(c.id);
  const atrasados = abiertos.filter((p) => p.entrega < iso(ahora));
  const pronto = abiertos.filter((p) => p.entrega >= iso(ahora) && p.entrega <= iso(ahora + 2 * DIA));
  if (atrasados.length) rojo.push(atrasados.length === 1 ? `Entrega atrasada: ${atrasados[0].titulo}` : `${atrasados.length} entregas atrasadas`);
  if (pronto.length) amarillo.push(pronto.length === 1 ? `Entrega pronto: ${pronto[0].titulo}` : `${pronto.length} entregas en los próximos 2 días`);
  const esperando = db.prepare("SELECT COUNT(*) n FROM aprobaciones WHERE cliente_id = ? AND estado = 'pendiente' AND creada < ?").get(c.id, iso(ahora - 2 * DIA)).n;
  if (esperando) amarillo.push(`${esperando === 1 ? "1 cosa espera" : `${esperando} cosas esperan`} tu aprobación hace más de 2 días`);
  const gasto = gastoDelMes(c.id);
  const tope = c.presupuesto_anuncios;
  const uso = tope ? gasto / tope : null;
  if (uso !== null && uso > 1) rojo.push(`Anuncios: se pasó del tope (${Math.round(uso * 100)} %)`);
  else if (uso !== null && uso >= 0.85) amarillo.push(`Anuncios: va en ${Math.round(uso * 100)} % del tope`);
  if (c.estado === "activo") {
    const ultimo = db.prepare(`SELECT MAX(f) f FROM (
        SELECT creado f FROM proyectos WHERE cliente_id = ?1 UNION ALL
        SELECT creado FROM trabajos WHERE cliente_id = ?1 UNION ALL
        SELECT creada FROM aprobaciones WHERE cliente_id = ?1 UNION ALL
        SELECT actualizado FROM gasto_anuncios WHERE cliente_id = ?1 UNION ALL
        SELECT inicio FROM eventos WHERE inicio <= ?2 AND (lower(cliente) = lower(?3) OR titulo LIKE ?4) UNION ALL
        SELECT creado FROM clientes WHERE id = ?1)`).get(c.id, iso(ahora), c.nombre, `%${c.nombre}%`).f;
    if (ultimo && ultimo < iso(ahora - 30 * DIA)) amarillo.push("Sin movimiento en más de un mes");
  }
  const automatico = rojo.length ? "rojo" : amarillo.length ? "amarillo" : "verde";
  const motivos = [...rojo, ...amarillo];
  if (c.salud_manual && SALUDES.includes(c.salud_manual)) {
    return { nivel: c.salud_manual, manual: true, automatico, motivos: [`Marcado a mano${c.salud_nota ? `: ${c.salud_nota}` : ""}`, ...motivos] };
  }
  return { nivel: automatico, manual: false, automatico, motivos: motivos.length ? motivos : ["Todo en orden"] };
}

/** Las cuentas (clientes que no han terminado) con su semáforo y lo más importante de cada una. */
export function cuentas() {
  const mes = mesActual();
  const ahora = new Date().toISOString();
  const orden = { rojo: 0, amarillo: 1, verde: 2 };
  return listarClientes()
    .filter((c) => c.estado !== "terminado")
    .map((c) => {
      const prox = db.prepare("SELECT titulo, entrega FROM proyectos WHERE cliente_id = ? AND estado NOT IN ('entregado','cancelado') AND entrega IS NOT NULL AND entrega >= ? ORDER BY entrega LIMIT 1").get(c.id, ahora);
      const junta = juntasDeCliente(c, { limite: 1 })[0] || null;
      return {
        id: c.id, nombre: c.nombre, industria: c.industria, estado: c.estado, servicios: c.servicios,
        presupuesto_mensual: c.presupuesto_mensual, presupuesto_anuncios: c.presupuesto_anuncios,
        proyectos_abiertos: c.proyectos_abiertos,
        por_aprobar: db.prepare("SELECT COUNT(*) n FROM aprobaciones WHERE cliente_id = ? AND estado = 'pendiente'").get(c.id).n,
        gasto_mes: gastoDelMes(c.id, mes),
        proxima_entrega: prox || null,
        proxima_junta: junta,
        salud: saludCliente(c),
      };
    })
    .sort((a, b) => (a.estado === "activo" ? 0 : 1) - (b.estado === "activo" ? 0 : 1) || orden[a.salud.nivel] - orden[b.salud.nivel] || a.nombre.localeCompare(b.nombre, "es"));
}

/** Lo que hay que atender hoy en la agencia, de lo más urgente a lo informativo. */
export function alertasDelDia(lista = cuentas()) {
  const ahora = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const alertas = [];
  const proy = db.prepare(`SELECT p.id, p.titulo, p.entrega, c.id cliente_id, c.nombre cliente FROM proyectos p LEFT JOIN clientes c ON c.id = p.cliente_id
      WHERE p.estado NOT IN ('entregado','cancelado') AND p.entrega IS NOT NULL AND p.entrega <= ? ORDER BY p.entrega`).all(iso(ahora + 1.5 * DIA));
  for (const p of proy) {
    const tarde = p.entrega < iso(ahora);
    alertas.push({ nivel: tarde ? "rojo" : "amarillo", tipo: "entrega", cliente_id: p.cliente_id, cliente: p.cliente,
      texto: tarde ? `Entrega atrasada: ${p.titulo}` : `Entrega por vencer: ${p.titulo}`, cuando: p.entrega });
  }
  const finDia = iso(new Date(localAUTC(ahoraLocalISO().slice(0, 10) + "T23:59")).getTime() + 59999);
  const juntas = db.prepare("SELECT id, titulo, inicio, cliente FROM eventos WHERE inicio >= ? AND inicio <= ? AND cliente IS NOT NULL AND cliente != '' ORDER BY inicio").all(iso(ahora - 3600e3), finDia);
  for (const j of juntas) {
    const c = buscarCliente(j.cliente);
    alertas.push({ nivel: "info", tipo: "junta", cliente_id: c?.id ?? null, cliente: c?.nombre || j.cliente, texto: `Junta hoy: ${j.titulo}`, cuando: j.inicio });
  }
  const viejas = db.prepare("SELECT COUNT(*) n, MIN(creada) desde FROM aprobaciones WHERE estado = 'pendiente' AND creada < ?").get(iso(ahora - DIA));
  if (viejas.n) alertas.push({ nivel: "amarillo", tipo: "aprobacion", texto: `${viejas.n === 1 ? "1 cosa espera" : `${viejas.n} cosas esperan`} tu sí desde hace más de un día`, cuando: viejas.desde });
  for (const c of lista) {
    if (c.presupuesto_anuncios && c.gasto_mes / c.presupuesto_anuncios >= 0.85) {
      const pct = Math.round((c.gasto_mes / c.presupuesto_anuncios) * 100);
      alertas.push({ nivel: pct > 100 ? "rojo" : "amarillo", tipo: "gasto", cliente_id: c.id, cliente: c.nombre, texto: pct > 100 ? `Anuncios pasados del tope (${pct} %)` : `Anuncios al ${pct} % del tope` });
    }
    if (c.salud.manual && c.salud.nivel !== "verde") alertas.push({ nivel: c.salud.nivel, tipo: "salud", cliente_id: c.id, cliente: c.nombre, texto: c.salud.motivos[0] });
  }
  const peso = { rojo: 0, amarillo: 1, info: 2 };
  return alertas.sort((a, b) => peso[a.nivel] - peso[b.nivel] || String(a.cuando || "").localeCompare(String(b.cuando || "")));
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
  const lista = cuentas();
  const activos = lista.filter((c) => c.estado === "activo");
  const mes = mesActual();
  const juntas = db.prepare("SELECT id, titulo, inicio, lugar, cliente FROM eventos WHERE inicio >= ? AND inicio <= ? AND cliente IS NOT NULL AND cliente != '' ORDER BY inicio LIMIT 8")
    .all(new Date().toISOString(), enSieteDias);
  return {
    mes,
    gasto_anuncios_mes: db.prepare("SELECT COALESCE(SUM(monto),0) n FROM gasto_anuncios WHERE mes = ?").get(mes).n,
    tope_anuncios: activos.reduce((s, c) => s + (c.presupuesto_anuncios || 0), 0),
    gasto_por_plataforma: db.prepare("SELECT plataforma, SUM(monto) monto FROM gasto_anuncios WHERE mes = ? GROUP BY plataforma ORDER BY monto DESC").all(mes),
    gasto_por_cliente: lista.filter((c) => c.gasto_mes || c.presupuesto_anuncios).map((c) => ({ id: c.id, nombre: c.nombre, gasto: c.gasto_mes, tope: c.presupuesto_anuncios })).sort((a, b) => b.gasto - a.gasto),
    salud: { verde: activos.filter((c) => c.salud.nivel === "verde").length, amarillo: activos.filter((c) => c.salud.nivel === "amarillo").length, rojo: activos.filter((c) => c.salud.nivel === "rojo").length },
    prospectos: lista.filter((c) => c.estado === "prospecto").length,
    alertas: alertasDelDia(lista),
    juntas: juntas.map((j) => ({ ...j, cliente_id: buscarCliente(j.cliente)?.id ?? null })),
    aprobacion_mas_vieja: db.prepare("SELECT MIN(creada) f FROM aprobaciones WHERE estado = 'pendiente'").get().f,
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
