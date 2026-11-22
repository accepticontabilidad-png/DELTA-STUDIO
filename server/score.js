// Delta Score: una calificación de 0 a 100 por cliente, con el desglose en palabras.
//
// Junta cinco partes. Cada una da puntos; si de una parte no hay datos (por ejemplo, el cliente
// no tiene Meta asignado o no paga mensualidad), esa parte no cuenta y el resto se reescala a 100.
//   Entregas (25)  · ¿va al día con lo que le prometimos? (proyectos y piezas de contenido)
//   Pagos (20)     · ¿nos paga a tiempo?
//   Anuncios (20)  · ¿el gasto va dentro del tope y está dando resultados (mensajes, prospectos, compras)?
//   Redes (20)     · ¿sus seguidores crecen y estamos publicando este mes?
//   Seguimiento (15) · ¿hay cosas esperando aprobación (nuestra o del cliente) o lleva un mes sin movimiento?
// El semáforo sigue mandando: un cliente en rojo no pasa de 49 y uno en amarillo no pasa de 64,
// para que la calificación y el color nunca se contradigan (verde 65+, amarillo 50-64, rojo <50).
import { db } from "./db.js";
import { ahoraLocalISO } from "./tiempo.js";
import { estadoContenido } from "./contenido.js";

const DIA = 864e5;
export const NIVELES = [
  { min: 80, clave: "excelente", nombre: "Excelente", color: "verde" },
  { min: 65, clave: "saludable", nombre: "Saludable", color: "verde" },
  { min: 50, clave: "atencion", nombre: "Atención", color: "amarillo" },
  { min: 0, clave: "riesgo", nombre: "En riesgo", color: "rojo" },
];
export const nivelDe = (n) => NIVELES.find((x) => n >= x.min);

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

/**
 * @param c    fila del cliente (con id, nombre, estado, presupuesto_anuncios…)
 * @param o    { salud, gastoMes, meta } ya calculados por agencia.js (para no repetir consultas)
 */
export function deltaScore(c, { salud, gastoMes = 0, meta = null } = {}) {
  const ahora = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const hoy = ahoraLocalISO().slice(0, 10);
  const partes = [];

  // ---- Entregas (25)
  {
    const abiertas = db.prepare("SELECT entrega FROM proyectos WHERE cliente_id = ? AND estado NOT IN ('entregado','cancelado')").all(c.id);
    const atrasadas = abiertas.filter((p) => p.entrega && p.entrega < iso(ahora)).length;
    const pronto = abiertas.filter((p) => p.entrega && p.entrega >= iso(ahora) && p.entrega <= iso(ahora + 2 * DIA)).length;
    const hechas = db.prepare("SELECT COUNT(*) n FROM proyectos WHERE cliente_id = ? AND estado = 'entregado'").get(c.id).n;
    // El contenido (reels, carruseles, posts…) también es entrega: cada pieza atrasada resta.
    const k = estadoContenido(c.id);
    const kAtrasadas = k.atrasadas.length;
    if (abiertas.length || hechas || k.hay) {
      const pts = Math.max(0, 25 - atrasadas * 12 - pronto * 3 - Math.min(15, kAtrasadas * 5));
      const notas = [];
      if (atrasadas) notas.push(plural(atrasadas, "entrega atrasada", "entregas atrasadas"));
      if (kAtrasadas) notas.push(plural(kAtrasadas, "pieza de contenido atrasada", "piezas de contenido atrasadas"));
      if (!notas.length && pronto) notas.push(plural(pronto, "entrega vence en 2 días", "entregas vencen en 2 días"));
      partes.push({ clave: "entregas", nombre: "Entregas", max: 25, pts,
        nota: notas.join(" · ") || (abiertas.length || k.hay ? "Todo al día" : "Sin entregas abiertas") });
    }
  }

  // ---- Pagos (20)
  {
    const pendientes = db.prepare("SELECT vence, monto FROM cobros WHERE cliente_id = ? AND pagado IS NULL AND monto > 0").all(c.id);
    const tieneCobros = pendientes.length || db.prepare("SELECT 1 FROM cobros WHERE cliente_id = ? AND monto > 0 LIMIT 1").get(c.id);
    if (tieneCobros) {
      const atraso = Math.max(0, ...pendientes.filter((p) => p.vence < hoy).map((p) => Math.round((Date.parse(hoy) - Date.parse(p.vence)) / DIA)));
      const pts = atraso === 0 ? 20 : atraso <= 7 ? 12 : atraso <= 30 ? 5 : 0;
      partes.push({ clave: "pagos", nombre: "Pagos", max: 20, pts,
        nota: atraso ? `Pago con ${plural(atraso, "día", "días")} de retraso` : pendientes.length ? "Al corriente (tiene un pago por vencer)" : "Al corriente" });
    }
  }

  // ---- Anuncios (20): tope y resultados
  {
    const ad = meta?.anuncios;
    const tope = c.presupuesto_anuncios;
    const gasto = Math.max(gastoMes || 0, ad?.gasto_mes || 0);
    if (tope || gasto) {
      let pts = 20;
      const notas = [];
      if (tope) {
        const uso = gasto / tope;
        if (uso > 1) { pts -= 12; notas.push(`Se pasó del tope (${Math.round(uso * 100)} %)`); }
        else if (uso >= 0.85) { pts -= 5; notas.push(`Va en ${Math.round(uso * 100)} % del tope`); }
      }
      if (ad && ad.gasto_mes > 0) {
        const resultados = (ad.conversaciones || 0) + (ad.prospectos || 0) + (ad.compras || 0);
        if (!resultados && ad.gasto_mes >= 500) { pts -= 8; notas.push("Gasta en anuncios pero sin mensajes, prospectos ni compras este mes"); }
        else if (resultados) notas.push(`${resultados} resultado${resultados === 1 ? "" : "s"} este mes`);
      }
      partes.push({ clave: "anuncios", nombre: "Anuncios", max: 20, pts: Math.max(0, pts), nota: notas.join(" · ") || "Dentro del tope" });
    }
  }

  // ---- Redes (20): seguidores y constancia de publicaciones (con Meta)
  if (meta && (meta.instagram || meta.facebook)) {
    let pts = 20;
    const notas = [];
    const cambios = [meta.seguidores_cambio?.instagram, meta.seguidores_cambio?.facebook].filter((x) => x !== null && x !== undefined);
    if (cambios.length) {
      const neto = cambios.reduce((s, x) => s + x, 0);
      if (neto < 0) { pts -= 8; notas.push(`Perdió ${Math.abs(neto)} seguidores`); }
      else if (neto === 0) { pts -= 3; notas.push("Seguidores sin crecer"); }
      else notas.push(`+${neto} seguidores`);
    }
    const posts = (meta.instagram?.publicaciones_mes || 0) + (meta.facebook?.publicaciones_mes || 0);
    const diaDelMes = Number(hoy.slice(8, 10));
    if (diaDelMes >= 8) {
      if (!posts) { pts -= 10; notas.push("Sin publicaciones este mes"); }
      else if (posts < Math.floor(diaDelMes / 7)) { pts -= 4; notas.push(`Solo ${plural(posts, "publicación", "publicaciones")} este mes`); }
      else notas.push(`${plural(posts, "publicación", "publicaciones")} este mes`);
    }
    partes.push({ clave: "redes", nombre: "Redes", max: 20, pts: Math.max(0, pts), nota: notas.join(" · ") || "En orden" });
  }

  // ---- Atención (15): aprobaciones detenidas y movimiento
  {
    let pts = 15;
    const notas = [];
    const esperando = db.prepare("SELECT COUNT(*) n FROM aprobaciones WHERE cliente_id = ? AND estado = 'pendiente' AND creada < ?").get(c.id, iso(ahora - 2 * DIA)).n;
    if (esperando) { pts -= Math.min(8, esperando * 4); notas.push(`${plural(esperando, "cosa espera", "cosas esperan")} aprobación hace más de 2 días`); }
    const kEsperando = estadoContenido(c.id).esperando.length;
    if (kEsperando) { pts -= Math.min(6, kEsperando * 3); notas.push(`${plural(kEsperando, "pieza espera", "piezas esperan")} al cliente hace 2 días o más`); }
    if ((salud?.motivos || []).some((m) => /Sin movimiento/.test(m))) { pts -= 7; notas.push("Un mes sin movimiento"); }
    partes.push({ clave: "atencion", nombre: "Seguimiento", max: 15, pts: Math.max(0, pts), nota: notas.join(" · ") || "Al día" });
  }

  const max = partes.reduce((s, p) => s + p.max, 0);
  let puntos = max ? Math.round((partes.reduce((s, p) => s + p.pts, 0) / max) * 100) : 100;
  const auto = salud?.automatico;
  let tope = null;
  if (auto === "rojo" && puntos > 49) { puntos = 49; tope = "rojo"; }
  else if (auto === "amarillo" && puntos > 64) { puntos = 64; tope = "amarillo"; }
  const n = nivelDe(puntos);
  const peor = [...partes].filter((p) => p.pts < p.max).sort((a, b) => (a.pts / a.max) - (b.pts / b.max))[0];
  return {
    puntos,
    nivel: n.clave,
    nivel_nombre: n.nombre,
    color: n.color,
    partes: partes.map((p) => ({ ...p, pct: Math.round((p.pts / p.max) * 100) })),
    sin_datos: ["entregas", "pagos", "anuncios", "redes"].filter((k) => !partes.some((p) => p.clave === k)),
    limitado_por_semaforo: tope,
    resumen: peor ? `${peor.nombre}: ${peor.nota}` : "Todo en orden",
  };
}
