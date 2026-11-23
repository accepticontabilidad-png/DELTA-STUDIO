// Reporte del CRM por fechas, al estilo de los tableros de Looker Studio:
// lo que dicen los anuncios de Meta (inversión, CPC, CPM, CTR, por campaña, conjunto y anuncio, día por día)
// junto con lo que pasó de verdad en el CRM (prospectos, citas y ventas) para sacar el costo REAL por cita.
// Solo lee: no toca campañas ni le escribe a nadie.
import { db } from "./db.js";
import { listarClientes, clienteRequerido } from "./agencia.js";
import { zonaHoraria } from "./tiempo.js";
import { conCache } from "./cache.js";
import * as meta from "./meta.js";
import { periodo, ventasCerradas } from "./crm.js";
import { estadoPorTelefono, estadoPorNombre } from "./lada.js";

const VIDA = 20 * 60e3; // 20 min: Meta no cambia tan rápido y así el tablero abre al instante

/** Suma gasto, impresiones y resultados de filas con la misma clave. */
function juntar(filas, clave) {
  const m = new Map();
  for (const f of filas) {
    const k = clave(f); if (!k) continue;
    const a = m.get(k) || { gasto: 0, impresiones: 0, resultados: 0 };
    a.gasto += f.gasto || 0; a.impresiones += f.impresiones || 0; a.resultados += f.resultados || 0;
    m.set(k, a);
  }
  return [...m.entries()].sort(([x], [y]) => (x < y ? -1 : 1));
}

const diaLocal = (iso, zona) => new Date(iso).toLocaleDateString("en-CA", { timeZone: zona });

/** Los números del periodo para el tablero del CRM. `cliente` vacío = todos los clientes. */
export async function reporteCrm({ cliente, desde, hasta, mes } = {}) {
  const per = periodo({ mes, desde, hasta });
  const clientes = cliente ? [clienteRequerido(cliente)] : listarClientes().filter((c) => c.estado !== "terminado");
  const ids = clientes.map((c) => c.id);
  const nombre = new Map(clientes.map((c) => [c.id, c.nombre]));

  // Meta no tiene números del futuro: si el periodo sigue, se pide solo hasta hoy.
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: zonaHoraria() });
  const hastaMeta = per.hasta > hoy && per.desde <= hoy ? hoy : per.hasta;

  // Anuncios de Meta de cada cliente que tenga cuenta de anuncios ligada.
  const conCuenta = ids.length
    ? db.prepare(`SELECT DISTINCT cliente_id FROM meta_activos WHERE tipo = 'anuncios' AND cliente_id IN (${ids.map(() => "?").join(",")})`).all(...ids).map((r) => r.cliente_id)
    : [];
  const partes = await Promise.all(conCuenta.map(async (id) => {
    try {
      const r = await conCache(`crmrep:${id}:${per.desde}:${hastaMeta}`, VIDA, () => meta.reporteAnunciosCliente(id, { desde: per.desde, hasta: hastaMeta }));
      return r ? { id, ...r } : null;
    } catch (e) {
      return { id, anuncios: [], dias: [], errores: [e.message.replace(/^Meta: /, "")] };
    }
  }));
  const ok = partes.filter(Boolean);
  const conCliente = (lista, id) => lista.map((x) => ({ ...x, cliente: nombre.get(id) }));
  const anuncios = ok.length ? {
    cuentas: ok.flatMap((x) => x.cuentas || []),
    moneda: ok.map((x) => x.moneda).find(Boolean) || null,
    filas: ok.flatMap((x) => conCliente(x.anuncios || [], x.id)),
    dias: ok.flatMap((x) => (x.dias || []).map((d) => ({
      fecha: d.fecha, campana_id: d.campana_id, conjunto_id: d.conjunto_id, anuncio_id: d.anuncio_id,
      gasto: d.gasto, impresiones: d.impresiones, clics: d.clics, clics_enlace: d.clics_enlace,
      conversaciones: d.conversaciones, prospectos: d.prospectos, compras: d.compras,
    }))),
    // Por edad y por estado, sumando todas las cuentas.
    edades: juntar(ok.flatMap((x) => x.edades || []), (e) => e.rango).map(([rango, v]) => ({ rango, ...v })),
    regiones: juntar(ok.flatMap((x) => x.regiones || []).map((r) => ({ ...r, estado: estadoPorNombre(r.nombre) })).filter((r) => r.estado), (r) => r.estado).map(([estado, v]) => ({ estado, ...v })),
    errores: ok.flatMap((x) => x.errores || []).slice(0, 4),
  } : null;

  // Lo que pasó en el CRM en esas fechas (por día de llegada), para el costo real por prospecto, cita y venta.
  const zona = zonaHoraria();
  const filas = ids.length
    ? db.prepare(`SELECT p.id, p.nombre, p.cliente_id, p.creado, p.campana, p.fuente, p.alcanzo, p.etapa, p.valor, p.telefono, k.ticket, k.margen FROM prospectos p LEFT JOIN crm_config k ON k.cliente_id = p.cliente_id WHERE p.cliente_id IN (${ids.map(() => "?").join(",")}) AND p.creado >= ? AND p.creado < ?`)
      .all(...ids, new Date(Date.parse(`${per.desde}T00:00:00Z`) - 864e5).toISOString(), new Date(Date.parse(`${per.hasta}T00:00:00Z`) + 2 * 864e5).toISOString())
    : [];
  const prospectos = filas
    .map((p) => ({ id: p.id, nombre: p.alcanzo >= 4 ? p.nombre : undefined, dia: diaLocal(p.creado, zona), cliente: nombre.get(p.cliente_id), campana: p.campana || null, fuente: p.fuente, alcanzo: p.alcanzo, perdido: p.etapa === "perdido", valor: p.valor || 0, ticket: p.ticket ?? null, margen: p.margen ?? null, estado: estadoPorTelefono(p.telefono) }))
    .filter((p) => p.dia >= per.desde && p.dia <= per.hasta);

  // Valor promedio y margen del cliente elegido (para el recuadro de utilidad).
  const k = cliente ? db.prepare("SELECT ticket, margen FROM crm_config WHERE cliente_id = ?").get(clientes[0].id) || {} : {};
  return {
    utilidad: cliente ? { ticket: k.ticket ?? null, margen: k.margen ?? null } : null,
    desde: per.desde,
    hasta: per.hasta,
    dias: per.dias,
    meta_conectado: meta.metaConectado(),
    clientes_con_cuenta: conCuenta.length,
    anuncios,
    prospectos,
    // Ventas de quienes llegaron en estas fechas, marcando cuáles vinieron de redes o anuncios.
    ventas: ((cfg) => ventasCerradas({ clientes: ids, desde: per.desde, hasta: per.hasta }).map((v) => ({
      id: v.id, nombre: v.nombre, dia: v.dia, compro: v.venta_fecha || null, cliente: nombre.get(v.cliente_id), campana: v.campana || null, fuente: v.fuente,
      origen: v.origen || null, redes: v.redes, confirmada: v.venta_revisada === 1, valor: v.valor || 0,
      ticket: cfg.get(v.cliente_id)?.ticket ?? null, margen: cfg.get(v.cliente_id)?.margen ?? null,
    })))(new Map(db.prepare("SELECT cliente_id, ticket, margen FROM crm_config").all().map((k) => [k.cliente_id, k]))),
  };
}
