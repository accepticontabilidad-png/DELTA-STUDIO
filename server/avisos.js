// Vigilante de avisos: revisa cada 30 s si toca avisar de un recordatorio o de una cita.
import { db, getAjuste, setAjuste } from "./db.js";
import { enviarWhatsApp } from "./whatsapp.js";
import { enviarPush } from "./push.js";
import { utcALocal, ahoraLocalISO, siguiente } from "./tiempo.js";
import { resumenDelDia, legible } from "./agenda.js";

const oyentes = new Set(); // pantallas abiertas de la app (tiempo real)
export function suscribirPantalla(fn) {
  oyentes.add(fn);
  return () => oyentes.delete(fn);
}

export async function avisar(texto, titulo = "DELTA") {
  db.prepare("INSERT INTO avisos (texto) VALUES (?)").run(texto);
  for (const fn of oyentes) try { fn({ tipo: "aviso", texto }); } catch {}
  await Promise.allSettled([
    enviarPush(titulo, texto),
    enviarWhatsApp(`🔔 ${texto}`).catch((e) => console.error("[whatsapp]", e.message)),
  ]);
}

const hora = (iso) => utcALocal(iso).split(", ").slice(-1)[0];

async function revisar() {
  const ahora = new Date().toISOString();

  // Recordatorios vencidos
  const pendientes = db.prepare("SELECT * FROM recordatorios WHERE activo = 1 AND cuando <= ?").all(ahora);
  for (const r of pendientes) {
    await avisar(`Recordatorio: ${r.mensaje}`);
    let prox = siguiente(r.cuando, r.repetir);
    while (prox && prox <= ahora) prox = siguiente(prox, r.repetir);
    if (prox) db.prepare("UPDATE recordatorios SET cuando = ? WHERE id = ?").run(prox, r.id);
    else db.prepare("UPDATE recordatorios SET activo = 0 WHERE id = ?").run(r.id);
  }

  // Citas que están por empezar
  const eventos = db.prepare("SELECT * FROM eventos WHERE avisado = 0 AND inicio >= ?").all(new Date(Date.now() - 5 * 60000).toISOString());
  for (const e of eventos) {
    const avisarDesde = new Date(new Date(e.inicio).getTime() - (e.aviso_min ?? 15) * 60000).toISOString();
    if (avisarDesde <= ahora) {
      await avisar(`En ${e.aviso_min ?? 15} min: ${e.titulo} a las ${hora(e.inicio)}${e.lugar ? ` en ${e.lugar}` : ""}.`);
      db.prepare("UPDATE eventos SET avisado = 1 WHERE id = ?").run(e.id);
    }
  }

  // Resumen de la mañana (una vez al día, a la hora elegida)
  const horaResumen = getAjuste("hora_resumen", process.env.HORA_RESUMEN || "08:00");
  const local = ahoraLocalISO();
  const hoy = local.slice(0, 10);
  // Solo dentro de las 3 horas siguientes, para no dar los "buenos días" de noche si el servidor arrancó tarde.
  const minutos = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const tras = horaResumen ? minutos(local.slice(11)) - minutos(horaResumen) : -1;
  if (horaResumen && tras >= 0 && tras < 180 && getAjuste("ultimo_resumen") !== hoy) {
    setAjuste("ultimo_resumen", hoy);
    const r = legible(resumenDelDia(hoy));
    const partes = [`Buenos días, señor. Hoy tiene ${r.eventos.length} cita(s) y ${r.total_pendientes} tarea(s) pendiente(s).`];
    for (const e of r.eventos) partes.push(`• ${e.inicio.split(", ").slice(-1)[0]} ${e.titulo}`);
    if (r.tareas_vencidas.length) partes.push(`Atrasadas: ${r.tareas_vencidas.map((t) => t.titulo).join(", ")}.`);
    await avisar(partes.join("\n"), "Resumen del día");
  }
}

export function iniciarVigilante() {
  const ciclo = () => revisar().catch((e) => console.error("[avisos]", e));
  ciclo();
  return setInterval(ciclo, 30_000);
}
