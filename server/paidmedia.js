// Paid media: cuánto invierten los clientes en anuncios y qué les regresa.
//
// De dónde salen los números:
//  - Inversión: la tabla gasto_anuncios (Meta la llena sola; Google, TikTok u otras se anotan a mano).
//  - Resultados: lo que mide Meta (mensajes, prospectos, compras y su valor) en la foto del mes,
//    y lo que el cliente reporta a mano (resultados_anuncios). Lo reportado manda: es lo que de verdad vendió.
//  - Campañas: las de Meta, con lo de este mes y lo de los últimos 7 días.
// Avisos: campañas que gastan sin resultados, costo por contacto muy alto, público cansado (frecuencia),
// retorno menor a lo invertido y topes de presupuesto.
import { db } from "./db.js";
import { ahoraLocalISO } from "./tiempo.js";
import * as agencia from "./agencia.js";

const MES = /^\d{4}-\d{2}$/;
const mesActual = () => ahoraLocalISO().slice(0, 7);
const mover = (mes, n) => { const [a, m] = mes.split("-").map(Number); return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 7); };
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const nombreMes = (mes) => `${MESES[Number(mes.slice(5)) - 1]} ${mes.slice(0, 4)}`;
const r2 = (n) => Math.round(n * 100) / 100;
const div = (a, b) => (b > 0 ? a / b : null);
const dinero = (n) => "$" + Math.round(n).toLocaleString("es-MX");

// Umbrales de los avisos (en la moneda de la cuenta, casi siempre pesos).
export const UMBRALES = {
  sin_resultados_mes: 500,   // gastó esto en el mes sin un solo resultado
  sin_resultados_semana: 300, // o esto en los últimos 7 días, estando activa
  cpl_veces: 1.8,            // cuesta 1.8 veces más que el promedio del cliente
  cpl_gasto_min: 300,
  frecuencia: 4,             // la misma persona vio el anuncio 4 veces o más
  roas_rojo: 1,              // vende menos de lo que invierte
  roas_amarillo: 2,
  roas_gasto_min: 1000,
};

// Objetivos de Meta donde no se esperan mensajes ni ventas (se miden por alcance o clics).
const SOLO_ALCANCE = new Set(["OUTCOME_AWARENESS", "OUTCOME_TRAFFIC", "REACH", "BRAND_AWARENESS", "LINK_CLICKS", "POST_ENGAGEMENT", "VIDEO_VIEWS", "PAGE_LIKES"]);
const OBJETIVO = {
  OUTCOME_AWARENESS: "Reconocimiento", OUTCOME_TRAFFIC: "Tráfico", OUTCOME_ENGAGEMENT: "Interacción / mensajes",
  OUTCOME_LEADS: "Prospectos", OUTCOME_SALES: "Ventas", OUTCOME_APP_PROMOTION: "App",
  MESSAGES: "Mensajes", LEAD_GENERATION: "Prospectos", CONVERSIONS: "Conversiones", REACH: "Alcance", LINK_CLICKS: "Clics",
};

function mesValido(m) {
  const t = m || mesActual();
  if (!MES.test(t)) throw new Error("Mes no válido (AAAA-MM)");
  return t;
}

/** La última foto de Meta del cliente dentro de ese mes (los números de anuncios de ese mes). */
function anunciosMeta(clienteId, mes) {
  const f = db.prepare("SELECT datos, actualizado FROM meta_fotos WHERE cliente_id = ? AND fecha LIKE ? ORDER BY fecha DESC LIMIT 1").get(clienteId, `${mes}-%`);
  if (!f) return null;
  const a = JSON.parse(f.datos).anuncios;
  return a ? { ...a, actualizado: f.actualizado } : null;
}

const reportado = (clienteId, mes) => db.prepare("SELECT prospectos, ventas, valor_ventas, nota, actualizado FROM resultados_anuncios WHERE cliente_id = ? AND mes = ?").get(clienteId, mes) || null;

const numeroOpcional = (x, nombre, entero = false) => {
  if (x === undefined || x === null || x === "") return null;
  const n = Number(String(x).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) throw new Error(`${nombre} debe ser un número (0 o más)`);
  return entero ? Math.round(n) : r2(n);
};

/** Anota lo que el cliente reporta del mes: prospectos, ventas y cuánto vendió por anuncios. */
export function registrarResultados({ cliente, mes, prospectos, ventas, valor_ventas, nota } = {}) {
  const c = agencia.clienteRequerido(cliente);
  const m = mesValido(mes);
  const datos = {
    prospectos: numeroOpcional(prospectos, "Los prospectos", true),
    ventas: numeroOpcional(ventas, "Las ventas", true),
    valor_ventas: numeroOpcional(valor_ventas, "Lo vendido"),
  };
  if (Object.values(datos).every((v) => v === null) && !nota) throw new Error("Dime al menos los prospectos, las ventas o cuánto vendió");
  const antes = reportado(c.id, m);
  // Lo que no se dice se queda como estaba.
  const final = Object.fromEntries(Object.entries(datos).map(([k, v]) => [k, v ?? antes?.[k] ?? null]));
  db.prepare(`INSERT INTO resultados_anuncios (cliente_id, mes, prospectos, ventas, valor_ventas, nota) VALUES (?,?,?,?,?,?)
      ON CONFLICT(cliente_id, mes) DO UPDATE SET prospectos = excluded.prospectos, ventas = excluded.ventas, valor_ventas = excluded.valor_ventas,
        nota = COALESCE(excluded.nota, resultados_anuncios.nota), actualizado = strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
    .run(c.id, m, final.prospectos, final.ventas, final.valor_ventas, nota ? String(nota).slice(0, 300) : null);
  return { cliente: c.nombre, mes: m, ...final, numeros: paidMediaCliente(c, m) };
}

export function borrarResultados({ cliente, mes } = {}) {
  const c = agencia.clienteRequerido(cliente);
  db.prepare("DELETE FROM resultados_anuncios WHERE cliente_id = ? AND mes = ?").run(c.id, mesValido(mes));
  return { ok: true };
}

const resultadosCampana = (x) => (x.conversaciones || 0) + (x.prospectos || 0) + (x.compras || 0);

/** Los números de Paid media de un cliente en un mes, con sus avisos. */
export function paidMediaCliente(c, mes = mesActual()) {
  const inversion = agencia.gastoDelMes(c.id, mes);
  const porPlataforma = db.prepare("SELECT plataforma, monto, fuente FROM gasto_anuncios WHERE cliente_id = ? AND mes = ? AND monto > 0 ORDER BY monto DESC").all(c.id, mes);
  const m = anunciosMeta(c.id, mes);
  const rep = reportado(c.id, mes);
  const tieneMeta = Boolean(db.prepare("SELECT 1 FROM meta_activos WHERE cliente_id = ? AND tipo = 'anuncios' LIMIT 1").get(c.id));
  const tope = c.presupuesto_anuncios || null;

  // Contactos = mensajes + prospectos. Si el cliente reportó, manda lo suyo y se compara contra toda la inversión;
  // si no, se usa lo de Meta y se compara solo contra lo gastado en Meta.
  const metaContactos = m ? (m.conversaciones || 0) + (m.prospectos || 0) : null;
  const contactos = rep?.prospectos ?? metaContactos;
  const baseContactos = rep?.prospectos !== null && rep?.prospectos !== undefined ? inversion : (m?.gasto_mes || 0);
  const ventas = rep?.ventas ?? (m ? m.compras || 0 : null);
  const valor = rep?.valor_ventas ?? (m && m.valor_compras > 0 ? m.valor_compras : null);
  const baseValor = rep?.valor_ventas !== null && rep?.valor_ventas !== undefined ? inversion : (m?.gasto_mes || 0);
  const cpl = contactos ? div(baseContactos, contactos) : null;
  const roas = valor !== null ? div(valor, baseValor) : null;

  const campanas = (m?.campanas || []).map((x) => {
    const res = resultadosCampana(x);
    const soloAlcance = SOLO_ALCANCE.has(x.objetivo);
    return {
      ...x,
      objetivo_nombre: OBJETIVO[x.objetivo] || null,
      solo_alcance: soloAlcance,
      resultados: res,
      costo_resultado: res ? r2(x.gasto / res) : null,
      roas: x.valor_compras > 0 && x.gasto > 0 ? r2(x.valor_compras / x.gasto) : null,
      ctr: x.impresiones ? r2((x.clics_enlace / x.impresiones) * 100) : null,
    };
  });

  // ---- Avisos
  const avisos = [];
  const aviso = (nivel, texto, extra = {}) => avisos.push({ nivel, texto, cliente_id: c.id, cliente: c.nombre, ...extra });
  const conResultados = campanas.filter((x) => x.resultados && !x.solo_alcance);
  const cplCliente = div(conResultados.reduce((s, x) => s + x.gasto, 0), conResultados.reduce((s, x) => s + x.resultados, 0));
  for (const x of campanas) {
    const etiqueta = { campana: x.nombre, campana_id: x.id };
    if (!x.solo_alcance && x.activa !== false && x.semana?.gasto >= UMBRALES.sin_resultados_semana && !x.semana.resultados) {
      aviso("rojo", `"${x.nombre}" gastó ${dinero(x.semana.gasto)} en 7 días sin mensajes, prospectos ni ventas`, { ...etiqueta, tipo: "sin_resultados" });
    } else if (!x.solo_alcance && x.gasto >= UMBRALES.sin_resultados_mes && !x.resultados) {
      aviso(x.activa === false ? "amarillo" : "rojo", `"${x.nombre}" lleva ${dinero(x.gasto)} este mes sin mensajes, prospectos ni ventas${x.activa === false ? " (ya está apagada)" : ""}`, { ...etiqueta, tipo: "sin_resultados" });
    } else if (x.activa !== false && x.costo_resultado && cplCliente && conResultados.length > 1 && x.gasto >= UMBRALES.cpl_gasto_min && x.costo_resultado > cplCliente * UMBRALES.cpl_veces) {
      aviso("amarillo", `"${x.nombre}" cuesta ${dinero(x.costo_resultado)} por resultado, ${Math.round(x.costo_resultado / cplCliente * 10) / 10} veces el promedio del cliente`, { ...etiqueta, tipo: "costo_alto" });
    }
    if (x.activa !== false && x.frecuencia >= UMBRALES.frecuencia) {
      aviso("amarillo", `"${x.nombre}": la misma gente ya vio el anuncio ${x.frecuencia.toLocaleString("es-MX", { maximumFractionDigits: 1 })} veces; toca cambiar el anuncio o el público`, { ...etiqueta, tipo: "cansancio" });
    }
  }
  if (roas !== null && baseValor >= UMBRALES.roas_gasto_min) {
    if (roas < UMBRALES.roas_rojo) aviso("rojo", `Vende ${dinero(valor)} con ${dinero(baseValor)} invertidos: recupera menos de lo que gasta`, { tipo: "retorno" });
    else if (roas < UMBRALES.roas_amarillo) aviso("amarillo", `Retorno bajo: ${roas.toFixed(1)} pesos por cada peso invertido`, { tipo: "retorno" });
  }
  if (!campanas.length && inversion >= UMBRALES.sin_resultados_mes && contactos === 0 && !ventas) {
    aviso("rojo", `Invirtió ${dinero(inversion)} este mes y no hay mensajes, prospectos ni ventas anotados`, { tipo: "sin_resultados" });
  }
  if (tope && inversion > tope) aviso("rojo", `Se pasó del tope de anuncios (${Math.round((inversion / tope) * 100)} %)`, { tipo: "tope" });
  else if (tope && inversion / tope >= 0.85) aviso("amarillo", `Va en ${Math.round((inversion / tope) * 100)} % del tope de anuncios`, { tipo: "tope" });
  if (inversion > 0 && contactos === null && ventas === null) {
    aviso("info", tieneMeta ? "Meta aún no trae resultados de este mes" : "Sin resultados: anota los prospectos y ventas que te reporte el cliente", { tipo: "sin_datos" });
  }

  const peso = { rojo: 0, amarillo: 1, info: 2 };
  avisos.sort((a, b) => peso[a.nivel] - peso[b.nivel]);
  const nivel = avisos.some((a) => a.nivel === "rojo") ? "rojo" : avisos.some((a) => a.nivel === "amarillo") ? "amarillo" : "verde";
  return {
    id: c.id,
    nombre: c.nombre,
    nivel,
    inversion: r2(inversion),
    tope,
    uso_tope: tope ? Math.round((inversion / tope) * 100) : null,
    por_plataforma: porPlataforma,
    contactos,
    costo_por_contacto: cpl !== null ? r2(cpl) : null,
    ventas,
    valor_ventas: valor,
    roas: roas !== null ? r2(roas) : null,
    fuente_resultados: rep ? "cliente" : m ? "meta" : null,
    reportado: rep,
    meta: m ? {
      gasto: m.gasto_mes || 0, impresiones: m.impresiones || 0, alcance: m.alcance || 0, clics_enlace: m.clics_enlace || 0,
      conversaciones: m.conversaciones || 0, prospectos: m.prospectos || 0, compras: m.compras || 0, valor_compras: m.valor_compras || 0,
      ctr: m.impresiones ? r2((m.clics_enlace / m.impresiones) * 100) : null,
      cpm: m.impresiones ? r2((m.gasto_mes / m.impresiones) * 1000) : null,
      campanas_activas: m.campanas_activas ?? null,
      actualizado: m.actualizado,
    } : null,
    tiene_meta: tieneMeta,
    campanas,
    avisos,
  };
}

/** El tablero de Paid media de la agencia para un mes. */
export function paidMedia(mes) {
  const m = mesValido(mes);
  const clientes = agencia.listarClientes().filter((c) => c.estado !== "terminado");
  const lista = clientes
    .map((c) => paidMediaCliente(c, m))
    .filter((x) => x.inversion > 0 || x.tope || x.tiene_meta || x.reportado);
  const suma = (k, xs = lista) => xs.reduce((s, x) => s + (x[k] || 0), 0);
  const conContactos = lista.filter((x) => x.contactos);
  const conValor = lista.filter((x) => x.valor_ventas !== null);
  // Para el costo por contacto y el retorno se usa la misma base que en cada cliente.
  const base = (x, k) => (x.reportado?.[k] !== null && x.reportado?.[k] !== undefined ? x.inversion : x.meta?.gasto || 0);
  const inversionContactos = conContactos.reduce((s, x) => s + base(x, "prospectos"), 0);
  const inversionValor = conValor.reduce((s, x) => s + base(x, "valor_ventas"), 0);
  const contactos = suma("contactos", conContactos);
  const valor = suma("valor_ventas", conValor);
  const anterior = db.prepare("SELECT COALESCE(SUM(monto),0) n FROM gasto_anuncios WHERE mes = ?").get(mover(m, -1)).n;
  const inversion = suma("inversion");
  const campanas = lista.flatMap((x) => x.campanas.map((k) => ({ ...k, cliente_id: x.id, cliente: x.nombre }))).sort((a, b) => b.gasto - a.gasto);
  const avisos = lista.flatMap((x) => x.avisos);
  const peso = { rojo: 0, amarillo: 1, info: 2 };
  avisos.sort((a, b) => peso[a.nivel] - peso[b.nivel]);

  // Historia de 6 meses: inversión y contactos.
  const historia = [];
  for (let i = 5; i >= 0; i--) {
    const k = mover(m, -i);
    let cont = 0;
    for (const c of clientes) {
      const rep = reportado(c.id, k);
      if (rep?.prospectos !== null && rep?.prospectos !== undefined) cont += rep.prospectos;
      else { const a = anunciosMeta(c.id, k); if (a) cont += (a.conversaciones || 0) + (a.prospectos || 0); }
    }
    historia.push({ mes: k, inversion: db.prepare("SELECT COALESCE(SUM(monto),0) n FROM gasto_anuncios WHERE mes = ?").get(k).n, contactos: cont });
  }

  const orden = { rojo: 0, amarillo: 1, verde: 2 };
  lista.sort((a, b) => orden[a.nivel] - orden[b.nivel] || b.inversion - a.inversion);
  const meta = db.prepare("SELECT COUNT(*) n FROM meta_activos WHERE tipo = 'anuncios' AND cliente_id IS NOT NULL").get().n;
  return {
    mes: m,
    nombre_mes: nombreMes(m),
    es_mes_actual: m === mesActual(),
    inversion: r2(inversion),
    inversion_anterior: r2(anterior),
    cambio_inversion: anterior ? Math.round(((inversion - anterior) / anterior) * 1000) / 10 : null,
    tope: suma("tope"),
    contactos,
    costo_por_contacto: contactos ? r2(inversionContactos / contactos) : null,
    ventas: lista.some((x) => x.ventas !== null) ? suma("ventas") : null,
    valor_ventas: conValor.length ? r2(valor) : null,
    roas: conValor.length && inversionValor ? r2(valor / inversionValor) : null,
    por_plataforma: db.prepare("SELECT plataforma, SUM(monto) monto FROM gasto_anuncios WHERE mes = ? AND monto > 0 GROUP BY plataforma ORDER BY monto DESC").all(m),
    clientes: lista,
    campanas: campanas.slice(0, 40),
    campanas_activas: campanas.filter((k) => k.activa).length,
    avisos,
    rojos: avisos.filter((a) => a.nivel === "rojo").length,
    historia,
    cuentas_meta: meta,
    umbrales: UMBRALES,
  };
}

/** Para el Pulso: cuántas campañas gastan sin resultados y cuántos clientes venden menos de lo que invierten. */
export function avisosParaPulso() {
  const p = paidMedia();
  return {
    sin_resultados: p.avisos.filter((a) => a.tipo === "sin_resultados" && a.nivel === "rojo"),
    retorno: p.avisos.filter((a) => a.tipo === "retorno" && a.nivel === "rojo"),
  };
}
