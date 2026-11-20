// Vigilante de avisos: revisa cada 30 s si toca avisar de un recordatorio o de una cita.
import { db, getAjuste, setAjuste } from "./db.js";
import { enviarWhatsApp } from "./whatsapp.js";
import { enviarPush } from "./push.js";
import { utcALocal, ahoraLocalISO, siguiente } from "./tiempo.js";
import { resumenDelDia, legible } from "./agenda.js";
import * as correo from "./gmail.js";
import * as mercados from "./mercados.js";
import * as noticias from "./noticias.js";

const oyentes = new Set(); // pantallas abiertas de la app (tiempo real)
/** Manda un evento a las pantallas abiertas (sin notificación), p. ej. para refrescar la agencia. */
export function avisarPantalla(evento) {
  for (const fn of oyentes) try { fn(evento); } catch {}
}

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
    partes.push(...(await extrasDelResumen()));
    await avisar(partes.join("\n"), "Resumen del día");
  }

  await revisarBolsa(local);
}

/** Correo, bolsa y noticias para el resumen de la mañana. Si algo falla, se omite sin tumbar el resumen. */
export async function extrasDelResumen() {
  const [mail, bolsa, notas] = await Promise.allSettled([
    correo.pendientesDeHoy(),
    mercados.verMercados(null, "dia"),
    noticias.titulares(1),
  ]);
  const partes = [];
  if (mail.status === "fulfilled" && mail.value) {
    const c = mail.value.correos;
    partes.push(c.length ? `\n📧 ${c.length} correo(s) sin leer:` : "\n📧 Sin correos nuevos importantes.");
    for (const m of c.slice(0, 5)) partes.push(`• ${m.de.replace(/<.*>/, "").trim() || m.de}: ${m.asunto || "(sin asunto)"}`);
  }
  if (bolsa.status === "fulfilled") {
    const ok = bolsa.value.filter((d) => !d.error).slice(0, 6);
    if (ok.length) partes.push("\n📈 Mercados:", ...ok.map((d) => "• " + mercados.lineaCorta(d)));
  }
  if (notas.status === "fulfilled") {
    const t = notas.value.filter((x) => x.noticias?.length).slice(0, 6);
    if (t.length) partes.push("\n📰 Noticias:", ...t.map((x) => `• ${x.tema}: ${x.noticias[0].titulo}`));
  }
  return partes;
}

// Alertas de bolsa: cada 20 min en horario de mercado (lunes a viernes, 8 a 16 h local), una por símbolo al día.
let ultimaRevisionBolsa = 0;
async function revisarBolsa(local) {
  if (Date.now() - ultimaRevisionBolsa < 20 * 60000) return;
  const dia = new Date(local.slice(0, 10) + "T12:00:00Z").getUTCDay();
  const h = Number(local.slice(11, 13));
  if (dia === 0 || dia === 6 || h < 8 || h >= 16) return;
  ultimaRevisionBolsa = Date.now();
  if (getAjuste("alertas_bolsa", "si") !== "si") return;
  const hoy = local.slice(0, 10);
  let avisados = {};
  try { avisados = JSON.parse(getAjuste("alertas_bolsa_hoy", "{}")); } catch {}
  if (avisados.dia !== hoy) avisados = { dia: hoy, simbolos: [] };
  const fuertes = (await mercados.movimientosFuertes().catch(() => [])).filter((d) => !avisados.simbolos.includes(d.simbolo));
  if (!fuertes.length) return;
  avisados.simbolos.push(...fuertes.map((d) => d.simbolo));
  setAjuste("alertas_bolsa_hoy", JSON.stringify(avisados));
  await avisar("Movimiento fuerte en la bolsa:\n" + fuertes.map((d) => "• " + mercados.lineaCorta(d)).join("\n"), "Bolsa");
}

export function iniciarVigilante() {
  const ciclo = () => revisar().catch((e) => console.error("[avisos]", e));
  ciclo();
  return setInterval(ciclo, 30_000);
}
