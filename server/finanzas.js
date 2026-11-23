// Finanzas de la agencia: lo que cobra a cada cliente, quién debe, los gastos de la agencia,
// la utilidad y el margen. Y el "Pulso": lo que necesita atención hoy, en una sola caja.
//
// Ideas:
// - La mensualidad de cada cliente es su "Pago mensual" (clientes.presupuesto_mensual).
//   Cada mes DELTA crea sola un cobro por cliente activo ("Mensualidad"), que vence el día de pago
//   del cliente (día 5 si no se dijo otro). Se marca pagado cuando llega el dinero.
// - Se pueden anotar cobros extra (un proyecto, una sesión de fotos…).
// - Los gastos son de la AGENCIA (nómina, programas, renta…). Lo que el cliente invierte en
//   anuncios es dinero del cliente y no cuenta como gasto de la agencia.
// - Un gasto "fijo" se repite cada mes desde su fecha hasta que se da de baja.
import { db } from "./db.js";
import { ahoraLocalISO, rangoDelDia } from "./tiempo.js";
import * as agencia from "./agencia.js";
import { avisosParaPulso } from "./paidmedia.js";
import { sitiosCaidos } from "./seo.js";
import { avisosCrm } from "./crm.js";
import { listarContenido } from "./contenido.js";

// Las tablas cobros y gastos_agencia se crean en db.js.

export const CATEGORIAS = {
  nomina: "Nómina y colaboradores",
  herramientas: "Programas y herramientas",
  oficina: "Oficina y servicios",
  produccion: "Producción (fotos, video, impresos)",
  publicidad: "Publicidad de la agencia",
  impuestos: "Impuestos y contador",
  otros: "Otros",
};

const DIA = 864e5;
const hoyLocal = () => ahoraLocalISO().slice(0, 10);
const mesActual = () => ahoraLocalISO().slice(0, 7);
const MES = /^\d{4}-\d{2}$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function monto(x) {
  const n = Number(String(x ?? "").replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n <= 0) throw new Error("El monto debe ser un número mayor a cero");
  return Math.round(n * 100) / 100;
}
function fecha(x, nombre = "fecha") {
  if (!x) return hoyLocal();
  const t = String(x).slice(0, 10);
  if (!FECHA.test(t) || isNaN(new Date(t + "T12:00:00Z"))) throw new Error(`La ${nombre} no es válida (AAAA-MM-DD)`);
  return t;
}
function mesValido(m) {
  const t = m || mesActual();
  if (!MES.test(t)) throw new Error("Mes no válido (AAAA-MM)");
  return t;
}
/** Suma meses a "AAAA-MM". */
export function mover(mes, n) {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 7);
}
const diasDelMes = (mes) => { const [a, m] = mes.split("-").map(Number); return new Date(Date.UTC(a, m, 0)).getUTCDate(); };
const diasEntre = (a, b) => Math.round((new Date(b + "T12:00:00Z") - new Date(a + "T12:00:00Z")) / DIA);

/** Día del mes en que vence la mensualidad de un cliente (5 si no se dijo otro). */
const diaDePago = (c) => Math.min(28, Math.max(1, Number(c.dia_pago) || 5));
const venceEn = (mes, dia) => `${mes}-${String(Math.min(dia, diasDelMes(mes))).padStart(2, "0")}`;

// ---------- Cobros ----------
/**
 * Crea la mensualidad del mes para cada cliente activo que paga algo y aún no la tiene.
 * No crea meses pasados (eso se anota a mano) ni toca las que ya existen.
 */
export function generarMensualidades(mes = mesActual()) {
  if (mes > mesActual()) return 0;
  const clientes = db.prepare("SELECT * FROM clientes WHERE estado = 'activo' AND presupuesto_mensual > 0").all();
  const meter = db.prepare(`INSERT OR IGNORE INTO cobros (cliente_id, tipo, concepto, monto, mes, vence) VALUES (?, 'mensualidad', ?, ?, ?, ?)`);
  // Si cambió el pago mensual o el día de pago, la mensualidad aún sin pagar de este mes se ajusta.
  const ajustar = db.prepare(`UPDATE cobros SET monto = ?, vence = ? WHERE tipo = 'mensualidad' AND cliente_id = ? AND mes = ? AND pagado IS NULL AND notas IS NULL`);
  let n = 0;
  for (const c of clientes) {
    // Un cliente dado de alta después de ese mes no debía nada en ese mes.
    if (String(c.creado).slice(0, 7) > mes) continue;
    const vence = venceEn(mes, diaDePago(c));
    const nuevo = meter.run(c.id, `Mensualidad ${nombreMes(mes)}`, c.presupuesto_mensual, mes, vence).changes;
    if (!nuevo && mes === mesActual()) ajustar.run(c.presupuesto_mensual, vence, c.id, mes);
    n += nuevo;
  }
  return n;
}

const NOMBRES_MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const nombreMes = (mes) => `${NOMBRES_MES[Number(mes.slice(5, 7)) - 1]} ${mes.slice(0, 4)}`;

function conEstado(c, hoy = hoyLocal()) {
  if (!c) return c;
  const atraso = !c.pagado && c.vence < hoy ? diasEntre(c.vence, hoy) : 0;
  return { ...c, estado: c.pagado ? "pagado" : atraso ? "vencido" : "pendiente", dias_atraso: atraso, dias_para_vencer: c.pagado || atraso ? null : diasEntre(hoy, c.vence) };
}

export function obtenerCobro(id) {
  return conEstado(db.prepare("SELECT co.*, c.nombre AS cliente FROM cobros co JOIN clientes c ON c.id = co.cliente_id WHERE co.id = ?").get(Number(id)));
}

export function registrarCobro({ cliente, concepto, monto: m, mes, vence, pagado, notas }) {
  const c = agencia.clienteRequerido(cliente);
  const mm = mesValido(mes);
  const v = vence ? fecha(vence, "fecha de vencimiento") : venceEn(mm, diaDePago(c));
  const r = db.prepare("INSERT INTO cobros (cliente_id, tipo, concepto, monto, mes, vence, pagado, notas) VALUES (?, 'extra', ?, ?, ?, ?, ?, ?)")
    .run(c.id, String(concepto || "").trim() || "Cobro extra", monto(m), mm, v, pagado ? fecha(pagado === true ? null : pagado, "fecha de pago") : null, notas || null);
  return obtenerCobro(Number(r.lastInsertRowid));
}

/** Marca un cobro como pagado (o lo regresa a pendiente con pagado = false). */
export function marcarPagado(id, pagado = true) {
  const c = obtenerCobro(id);
  if (!c) throw new Error(`No existe el cobro ${id}`);
  const valor = pagado === false || pagado === null ? null : fecha(pagado === true ? null : pagado, "fecha de pago");
  db.prepare("UPDATE cobros SET pagado = ? WHERE id = ?").run(valor, c.id);
  return obtenerCobro(c.id);
}

/** Busca el cobro pendiente más viejo de un cliente (para "ya pagó Clínica Sonrisa"). */
export function cobroPendienteDe(cliente) {
  const c = agencia.clienteRequerido(cliente);
  const fila = db.prepare("SELECT id FROM cobros WHERE cliente_id = ? AND pagado IS NULL ORDER BY vence, id LIMIT 1").get(c.id);
  if (!fila) throw new Error(`${c.nombre} no tiene cobros pendientes`);
  return obtenerCobro(fila.id);
}

export function actualizarCobro(id, cambios) {
  const c = obtenerCobro(id);
  if (!c) throw new Error(`No existe el cobro ${id}`);
  const n = {
    concepto: cambios.concepto !== undefined ? String(cambios.concepto).trim() || c.concepto : c.concepto,
    monto: cambios.monto !== undefined ? monto(cambios.monto) : c.monto,
    vence: cambios.vence !== undefined ? fecha(cambios.vence, "fecha de vencimiento") : c.vence,
    notas: cambios.notas !== undefined ? cambios.notas || null : c.notas,
  };
  db.prepare("UPDATE cobros SET concepto = ?, monto = ?, vence = ?, notas = ? WHERE id = ?").run(n.concepto, n.monto, n.vence, n.notas, c.id);
  return obtenerCobro(c.id);
}

export function borrarCobro(id) {
  const c = obtenerCobro(id);
  if (!c) throw new Error(`No existe el cobro ${id}`);
  // Una mensualidad borrada volvería a crearse sola; se deja en cero como "no se cobra este mes".
  if (c.tipo === "mensualidad") db.prepare("UPDATE cobros SET monto = 0, pagado = COALESCE(pagado, vence), notas = 'No se cobra este mes' WHERE id = ?").run(c.id);
  else db.prepare("DELETE FROM cobros WHERE id = ?").run(c.id);
  return { ok: true, id: c.id };
}

export function listarCobros({ mes, cliente, estado } = {}) {
  let sql = "SELECT co.*, c.nombre AS cliente FROM cobros co JOIN clientes c ON c.id = co.cliente_id WHERE co.monto > 0";
  const args = [];
  if (mes) { sql += " AND co.mes = ?"; args.push(mesValido(mes)); }
  if (cliente) { sql += " AND co.cliente_id = ?"; args.push(agencia.clienteRequerido(cliente).id); }
  if (estado === "pendientes") sql += " AND co.pagado IS NULL";
  sql += " ORDER BY co.pagado IS NOT NULL, co.vence, co.id";
  const hoy = hoyLocal();
  return db.prepare(sql).all(...args).map((c) => conEstado(c, hoy)).filter((c) => !estado || estado === "pendientes" || c.estado === estado);
}

// ---------- Gastos ----------
export function registrarGastoAgencia({ concepto, monto: m, categoria, fecha: f, fijo, cliente }) {
  const t = String(concepto || "").trim();
  if (!t) throw new Error("El gasto necesita un concepto");
  const cat = CATEGORIAS[categoria] ? categoria : "otros";
  const c = cliente ? agencia.clienteRequerido(cliente) : null;
  const r = db.prepare("INSERT INTO gastos_agencia (concepto, categoria, monto, fecha, fijo, cliente_id) VALUES (?,?,?,?,?,?)")
    .run(t, cat, monto(m), fecha(f), fijo ? 1 : 0, c?.id ?? null);
  return obtenerGasto(Number(r.lastInsertRowid));
}

export function obtenerGasto(id) {
  return db.prepare("SELECT g.*, c.nombre AS cliente FROM gastos_agencia g LEFT JOIN clientes c ON c.id = g.cliente_id WHERE g.id = ?").get(Number(id));
}

/**
 * Quita un gasto. Un gasto fijo que ya contó en meses pasados no se borra: se da de baja desde
 * este mes para que los meses anteriores no cambien.
 */
export function borrarGasto(id) {
  const g = obtenerGasto(id);
  if (!g) throw new Error(`No existe el gasto ${id}`);
  const mes = mesActual();
  if (g.fijo && g.fecha.slice(0, 7) < mes) {
    db.prepare("UPDATE gastos_agencia SET baja = ? WHERE id = ?").run(mover(mes, -1), g.id);
    return { ok: true, id: g.id, baja: true };
  }
  db.prepare("DELETE FROM gastos_agencia WHERE id = ?").run(g.id);
  return { ok: true, id: g.id };
}

/** Los gastos que cuentan en un mes: los de ese mes más los fijos vigentes. */
export function gastosDelMes(mes = mesActual()) {
  const m = mesValido(mes);
  return db.prepare(`SELECT g.*, c.nombre AS cliente FROM gastos_agencia g LEFT JOIN clientes c ON c.id = g.cliente_id
      WHERE (g.fijo = 0 AND substr(g.fecha, 1, 7) = ?1)
         OR (g.fijo = 1 AND substr(g.fecha, 1, 7) <= ?1 AND (g.baja IS NULL OR g.baja >= ?1))
      ORDER BY g.monto DESC, g.id`).all(m);
}

// ---------- Resumen ----------
const suma = (lista, k = "monto") => Math.round(lista.reduce((s, x) => s + (Number(x[k]) || 0), 0) * 100) / 100;

function numerosDelMes(mes) {
  const cobros = db.prepare("SELECT * FROM cobros WHERE mes = ? AND monto > 0").all(mes);
  const facturado = suma(cobros);
  const gastos = suma(gastosDelMes(mes));
  const cobrado = suma(db.prepare("SELECT monto FROM cobros WHERE monto > 0 AND substr(pagado, 1, 7) = ?").all(mes));
  const utilidad = Math.round((facturado - gastos) * 100) / 100;
  return { mes, facturado, cobrado, gastos, utilidad, margen: facturado ? Math.round((utilidad / facturado) * 1000) / 10 : null };
}

/** Todo lo de Finanzas para un mes: números, cobranza, gastos, rentabilidad por cliente y 12 meses de historia. */
export function finanzas(mes) {
  const m = mesValido(mes);
  generarMensualidades(mesActual());
  const hoy = hoyLocal();
  const actual = numerosDelMes(m);
  const anterior = numerosDelMes(mover(m, -1));
  const activos = db.prepare("SELECT * FROM clientes WHERE estado = 'activo'").all();
  const conPago = activos.filter((c) => c.presupuesto_mensual > 0);
  const mrr = suma(conPago, "presupuesto_mensual");
  const pendientes = listarCobros({ estado: "pendientes" });
  const vencidos = pendientes.filter((c) => c.estado === "vencido");
  const gastos = gastosDelMes(m);
  const cobrosMes = listarCobros({ mes: m });

  // Rentabilidad: lo facturado a cada cliente en el mes menos los gastos anotados a su nombre.
  const porCliente = new Map();
  for (const c of cobrosMes) {
    const x = porCliente.get(c.cliente_id) || { id: c.cliente_id, nombre: c.cliente, facturado: 0, gastos: 0, pendiente: 0 };
    x.facturado += c.monto;
    if (!c.pagado) x.pendiente += c.monto;
    porCliente.set(c.cliente_id, x);
  }
  for (const g of gastos.filter((g) => g.cliente_id)) {
    const x = porCliente.get(g.cliente_id) || { id: g.cliente_id, nombre: g.cliente, facturado: 0, gastos: 0, pendiente: 0 };
    x.gastos += g.monto;
    porCliente.set(g.cliente_id, x);
  }
  const fee = new Map(activos.map((c) => [c.id, c.presupuesto_mensual || 0]));
  const rentabilidad = [...porCliente.values()].map((x) => {
    const utilidad = Math.round((x.facturado - x.gastos) * 100) / 100;
    return { ...x, mensualidad: fee.get(x.id) || 0, utilidad, margen: x.facturado ? Math.round((utilidad / x.facturado) * 1000) / 10 : null };
  }).sort((a, b) => b.facturado - a.facturado);

  const porCategoria = Object.entries(CATEGORIAS)
    .map(([k, nombre]) => ({ categoria: k, nombre, monto: suma(gastos.filter((g) => g.categoria === k)) }))
    .filter((x) => x.monto)
    .sort((a, b) => b.monto - a.monto);

  const historia = [];
  for (let i = 11; i >= 0; i--) historia.push(numerosDelMes(mover(m, -i)));
  const enelAnio = historia.filter((h) => h.mes.slice(0, 4) === m.slice(0, 4));

  const cambio = (a, b) => (b ? Math.round(((a - b) / Math.abs(b)) * 1000) / 10 : null);
  return {
    mes: m,
    nombre_mes: nombreMes(m),
    es_mes_actual: m === mesActual(),
    hoy,
    ...actual,
    anterior,
    cambio: { facturado: cambio(actual.facturado, anterior.facturado), utilidad: cambio(actual.utilidad, anterior.utilidad), gastos: cambio(actual.gastos, anterior.gastos) },
    mrr,
    clientes_que_pagan: conPago.length,
    ticket_promedio: conPago.length ? Math.round(mrr / conPago.length) : 0,
    clientes_sin_mensualidad: activos.filter((c) => !(c.presupuesto_mensual > 0)).map((c) => ({ id: c.id, nombre: c.nombre })),
    por_cobrar: suma(pendientes),
    vencido: suma(vencidos),
    cobros_vencidos: vencidos.length,
    pendientes,
    cobros_mes: cobrosMes,
    pagados_mes: listarCobrosPagadosEn(m),
    gastos_detalle: gastos,
    gastos_por_categoria: porCategoria,
    rentabilidad,
    historia,
    facturado_anio: suma(enelAnio, "facturado"),
    utilidad_anio: suma(enelAnio, "utilidad"),
    categorias: CATEGORIAS,
  };
}

function listarCobrosPagadosEn(mes) {
  return db.prepare("SELECT co.*, c.nombre AS cliente FROM cobros co JOIN clientes c ON c.id = co.cliente_id WHERE co.monto > 0 AND substr(co.pagado, 1, 7) = ? ORDER BY co.pagado DESC, co.id DESC")
    .all(mes).map((c) => conEstado(c));
}

// ---------- Pulso: lo que necesita atención hoy ----------
/**
 * Cuenta, en una sola lista, lo que pide atención hoy en la agencia. Cada renglón dice cuántos,
 * qué tan urgente es, a dónde lleva al tocarlo y los nombres que lo explican.
 * Solo aparecen los renglones que tienen algo; si no hay nada, la lista viene vacía.
 */
export function pulso() {
  generarMensualidades(mesActual());
  const ahora = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const hoy = hoyLocal();
  const lista = agencia.cuentas();
  const activos = lista.filter((c) => c.estado === "activo");
  const nombres = (xs, k = "nombre") => [...new Set(xs.map((x) => x[k]).filter(Boolean))].slice(0, 3);
  const r = [];
  const meter = (clave, n, nivel, texto, ir, detalle = []) => { if (n) r.push({ clave, n, nivel, texto, ir, detalle }); };

  const rojos = activos.filter((c) => c.salud.nivel === "rojo");
  const amarillos = activos.filter((c) => c.salud.nivel === "amarillo");
  meter("clientes_rojo", rojos.length, "rojo", rojos.length === 1 ? "cliente en rojo" : "clientes en rojo", "#/cuentas", nombres(rojos));
  meter("clientes_amarillo", amarillos.length, "amarillo", amarillos.length === 1 ? "cliente para echarle ojo" : "clientes para echarles ojo", "#/cuentas", nombres(amarillos));

  const vencidos = listarCobros({ estado: "vencido" });
  meter("pagos_vencidos", vencidos.length, "rojo", vencidos.length === 1 ? "pago vencido" : "pagos vencidos", "#/finanzas",
    vencidos.length ? [`${dineroTexto(suma(vencidos))} por cobrar`, ...nombres(vencidos, "cliente")] : []);
  const porVencer = listarCobros({ estado: "pendiente" }).filter((c) => c.dias_para_vencer !== null && c.dias_para_vencer <= 3);
  meter("pagos_por_vencer", porVencer.length, "amarillo", porVencer.length === 1 ? "pago vence en 3 días o menos" : "pagos vencen en 3 días o menos", "#/finanzas", nombres(porVencer, "cliente"));

  const atrasadas = db.prepare(`SELECT p.titulo, c.nombre cliente FROM proyectos p LEFT JOIN clientes c ON c.id = p.cliente_id
      WHERE p.estado NOT IN ('entregado','cancelado') AND p.entrega IS NOT NULL AND p.entrega < ? ORDER BY p.entrega`).all(iso(ahora));
  meter("entregas_atrasadas", atrasadas.length, "rojo", atrasadas.length === 1 ? "entrega atrasada" : "entregas atrasadas", "#/cuentas", atrasadas.slice(0, 3).map((p) => p.cliente ? `${p.titulo} (${p.cliente})` : p.titulo));
  const pronto = db.prepare(`SELECT p.titulo, c.nombre cliente FROM proyectos p LEFT JOIN clientes c ON c.id = p.cliente_id
      WHERE p.estado NOT IN ('entregado','cancelado') AND p.entrega IS NOT NULL AND p.entrega >= ? AND p.entrega <= ? ORDER BY p.entrega`).all(iso(ahora), iso(ahora + 2 * DIA));
  meter("entregas_pronto", pronto.length, "amarillo", pronto.length === 1 ? "entrega en los próximos 2 días" : "entregas en los próximos 2 días", "#/cuentas", pronto.slice(0, 3).map((p) => p.titulo));

  const aprob = db.prepare("SELECT a.titulo, c.nombre cliente, a.creada FROM aprobaciones a LEFT JOIN clientes c ON c.id = a.cliente_id WHERE a.estado = 'pendiente' ORDER BY a.creada").all();
  const viejas = aprob.filter((a) => a.creada < iso(ahora - DIA)).length;
  meter("aprobaciones", aprob.length, viejas ? "amarillo" : "info", aprob.length === 1 ? "cosa espera tu aprobación" : "cosas esperan tu aprobación", "#/aprobaciones",
    viejas ? [`${viejas} desde hace más de un día`] : aprob.slice(0, 2).map((a) => a.titulo));

  const pasados = activos.filter((c) => c.presupuesto_anuncios && c.gasto_mes > c.presupuesto_anuncios);
  const cerca = activos.filter((c) => c.presupuesto_anuncios && c.gasto_mes <= c.presupuesto_anuncios && c.gasto_mes / c.presupuesto_anuncios >= 0.85);
  meter("anuncios_pasados", pasados.length, "rojo", pasados.length === 1 ? "cliente pasado del tope de anuncios" : "clientes pasados del tope de anuncios", "#/cuentas", nombres(pasados));
  meter("anuncios_cerca", cerca.length, "amarillo", cerca.length === 1 ? "cliente cerca del tope de anuncios" : "clientes cerca del tope de anuncios", "#/cuentas", nombres(cerca));

  const piezas = listarContenido();
  const kAtr = piezas.filter((p) => p.atrasada).sort((a, b) => b.dias_atraso - a.dias_atraso);
  meter("contenido_atrasado", kAtr.length, "rojo", kAtr.length === 1 ? "pieza de contenido atrasada" : "piezas de contenido atrasadas", "#/contenido", kAtr.slice(0, 3).map((p) => `${p.titulo} (${p.cliente})`));
  const kEsp = piezas.filter((p) => p.espera_cliente_larga);
  meter("contenido_cliente", kEsp.length, "amarillo", kEsp.length === 1 ? "pieza lleva 2 días o más esperando al cliente" : "piezas llevan 2 días o más esperando al cliente", "#/contenido", nombres(kEsp, "cliente"));
  const kPronto = piezas.filter((p) => p.dias_para_publicar !== null && p.dias_para_publicar <= 1 && !["aprobado", "publicado"].includes(p.etapa));
  meter("contenido_pronto", kPronto.length, "amarillo", kPronto.length === 1 ? "pieza sale hoy o mañana y aún no está aprobada" : "piezas salen hoy o mañana y aún no están aprobadas", "#/contenido", kPronto.slice(0, 3).map((p) => `${p.titulo} (${p.cliente})`));

  const pm = avisosParaPulso();
  meter("anuncios_sin_resultados", pm.sin_resultados.length, "rojo", pm.sin_resultados.length === 1 ? "campaña gastando sin resultados" : "campañas gastando sin resultados", "#/paidmedia",
    pm.sin_resultados.slice(0, 3).map((a) => a.campana ? `${a.campana} (${a.cliente})` : a.cliente));
  meter("anuncios_retorno", pm.retorno.length, "rojo", pm.retorno.length === 1 ? "cliente vende menos de lo que invierte en anuncios" : "clientes venden menos de lo que invierten en anuncios", "#/paidmedia", nombres(pm.retorno, "cliente"));

  const crm = avisosCrm();
  meter("crm_sin_responder", crm.sin_responder.length, "rojo", crm.sin_responder.length === 1 ? "prospecto lleva más de un día sin respuesta" : "prospectos llevan más de un día sin respuesta", "#/crm",
    crm.sin_responder.slice(0, 3).map((p) => `${p.nombre} (${p.cliente})`));
  meter("crm_citas_pasadas", crm.citas_pasadas.length, "amarillo", crm.citas_pasadas.length === 1 ? "cita ya pasó: ¿asistió?" : "citas ya pasaron: ¿asistieron?", "#/crm", crm.citas_pasadas.slice(0, 3).map((p) => `${p.nombre} (${p.cliente})`));
  meter("crm_citas_hoy", crm.citas_hoy.length, "info", crm.citas_hoy.length === 1 ? "cita de prospecto hoy" : "citas de prospectos hoy", "#/crm", crm.citas_hoy.slice(0, 3).map((p) => `${p.nombre} ${p.cita.slice(11, 16)} (${p.cliente})`));

  const caidos = sitiosCaidos();
  meter("sitio_caido", caidos.length, "rojo", caidos.length === 1 ? "sitio web de cliente no abre" : "sitios web de clientes no abren", "#/seo", caidos.slice(0, 3));

  const tareas = db.prepare("SELECT titulo FROM tareas WHERE estado = 'pendiente' AND fecha_limite IS NOT NULL AND fecha_limite < ? ORDER BY fecha_limite").all(iso(ahora));
  meter("tareas_vencidas", tareas.length, "amarillo", tareas.length === 1 ? "tarea vencida" : "tareas vencidas", "#/tareas", tareas.slice(0, 3).map((t) => t.titulo));

  const { hasta: finHoy } = rangoDelDia(hoy);
  const juntas = db.prepare("SELECT titulo, inicio, cliente FROM eventos WHERE inicio >= ? AND inicio <= ? AND cliente IS NOT NULL AND cliente != '' ORDER BY inicio").all(iso(ahora - 3600e3), finHoy);
  meter("juntas_hoy", juntas.length, "info", juntas.length === 1 ? "junta con cliente hoy" : "juntas con clientes hoy", "#/agenda", juntas.slice(0, 3).map((j) => j.titulo));

  const caida = activos.map((c) => ({ c, m: agencia.metaDeCliente(c.id) })).filter(({ m }) => {
    const s = m?.seguidores_cambio;
    return s && ((s.instagram !== null && s.instagram < 0) || (s.facebook !== null && s.facebook < 0));
  });
  meter("seguidores_bajan", caida.length, "amarillo", caida.length === 1 ? "cuenta perdiendo seguidores" : "cuentas perdiendo seguidores", "#/cuentas", caida.slice(0, 3).map(({ c }) => c.nombre));

  const sinMensualidad = activos.filter((c) => !(c.presupuesto_mensual > 0));
  meter("sin_mensualidad", sinMensualidad.length, "info", sinMensualidad.length === 1 ? "cliente activo sin pago mensual anotado" : "clientes activos sin pago mensual anotado", "#/finanzas", nombres(sinMensualidad));

  const peso = { rojo: 0, amarillo: 1, info: 2 };
  r.sort((a, b) => peso[a.nivel] - peso[b.nivel]);
  return {
    items: r,
    urgentes: r.filter((x) => x.nivel === "rojo").reduce((s, x) => s + x.n, 0),
    total: r.filter((x) => x.nivel !== "info").reduce((s, x) => s + x.n, 0),
  };
}

const dineroTexto = (n) => "$" + Number(n).toLocaleString("es-MX", { maximumFractionDigits: 0 });
