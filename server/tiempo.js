// Utilidades de fecha y hora en la zona horaria del usuario.
import { getAjuste } from "./db.js";

export function zonaHoraria() {
  return getAjuste("zona_horaria") || process.env.ZONA_HORARIA || "America/Mexico_City";
}

// Diferencia (en minutos) entre la zona dada y UTC en un instante.
function offsetMinutos(fecha, zona) {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: zona,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(fecha);
  const v = Object.fromEntries(partes.map((p) => [p.type, p.value]));
  const comoUTC = Date.UTC(+v.year, +v.month - 1, +v.day, +v.hour, +v.minute, +v.second);
  return (comoUTC - fecha.getTime()) / 60000;
}

/**
 * Convierte una hora local del usuario ("2026-11-20T09:30" o "2026-11-20 09:30")
 * a ISO UTC. Si el texto ya trae zona (Z o +hh:mm) se respeta.
 */
export function localAUTC(texto, zona = zonaHoraria()) {
  if (!texto) return null;
  const limpio = String(texto).trim().replace(" ", "T");
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(limpio)) {
    const d = new Date(limpio);
    if (isNaN(d)) throw new Error(`Fecha no válida: ${texto}`);
    return d.toISOString();
  }
  const m = limpio.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) throw new Error(`Fecha no válida: ${texto}. Usa el formato AAAA-MM-DDTHH:MM`);
  const [, a, mes, dia, h = "09", min = "00", s = "00"] = m;
  const comoUTC = Date.UTC(+a, +mes - 1, +dia, +h, +min, +s);
  // Dos pasadas para acertar en los cambios de horario.
  let utc = comoUTC - offsetMinutos(new Date(comoUTC), zona) * 60000;
  utc = comoUTC - offsetMinutos(new Date(utc), zona) * 60000;
  return new Date(utc).toISOString();
}

/** Muestra una fecha UTC como hora local legible en español. */
export function utcALocal(iso, zona = zonaHoraria()) {
  if (!iso) return null;
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: zona,
    weekday: "long", day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

/** Fecha y hora local en formato AAAA-MM-DDTHH:MM (para el contexto del modelo). */
export function ahoraLocalISO(zona = zonaHoraria()) {
  const v = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: zona, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
    }).formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  return `${v.year}-${v.month}-${v.day}T${v.hour}:${v.minute}`;
}

/** Inicio y fin (UTC) del día local que contiene la fecha dada. */
export function rangoDelDia(fechaLocal /* AAAA-MM-DD */, zona = zonaHoraria()) {
  const desde = localAUTC(`${fechaLocal}T00:00`, zona);
  const hasta = new Date(new Date(localAUTC(`${fechaLocal}T23:59`, zona)).getTime() + 59999).toISOString();
  return { desde, hasta };
}

/** Siguiente ocurrencia de un recordatorio repetido. */
export function siguiente(iso, repetir) {
  const d = new Date(iso);
  if (repetir === "diario") d.setUTCDate(d.getUTCDate() + 1);
  else if (repetir === "semanal") d.setUTCDate(d.getUTCDate() + 7);
  else if (repetir === "mensual") d.setUTCMonth(d.getUTCMonth() + 1);
  else return null;
  return d.toISOString();
}
