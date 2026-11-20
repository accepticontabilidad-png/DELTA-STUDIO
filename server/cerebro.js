// El cerebro de DELTA: un agente Claude con herramientas para manejar la agenda.
import Anthropic from "@anthropic-ai/sdk";
import { AsyncLocalStorage } from "node:async_hooks";
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { db } from "./db.js";
import * as agenda from "./agenda.js";
import { ahoraLocalISO, zonaHoraria, utcALocal } from "./tiempo.js";

const MODELO = process.env.DELTA_MODELO || "claude-opus-5-5";
const ESFUERZO = process.env.DELTA_ESFUERZO || "medium";
const TURNOS_HISTORIAL = 20;

let cliente = null;
function claude() {
  if (!cliente) cliente = new Anthropic(); // lee ANTHROPIC_API_KEY del entorno
  return cliente;
}

const NOMBRE_USUARIO = () => process.env.NOMBRE_USUARIO || "jefe";

const SISTEMA = `Eres DELTA, el asistente personal del dueño de la agencia de marketing digital DELTA. Tu misión es ayudarle a manejar su vida, su tiempo y su agencia.
Tu estilo: como JARVIS de Iron Man, elegante, eficiente, con un toque de humor sutil, pero siempre en español neutro y cálido. Te diriges al usuario como "señor" o por su nombre si lo conoces.

Lo que puedes hacer hoy (fase 1, sus actividades). Más adelante tendrás acceso a las cuentas y estadísticas de sus clientes; si te piden algo de eso, explica que llegará pronto.
- Tareas: crear, listar, completar, cambiar y borrar.
- Calendario: agendar citas y reuniones, moverlas, consultarlas.
- Recordatorios y avisos: programar avisos a una hora concreta, únicos o repetidos.
- Memoria: cuando el usuario te cuente algo que valga la pena recordar a futuro (nombres de clientes, preferencias, datos de su negocio), guárdalo con guardar_memoria.

Reglas:
- Honestidad ante todo. Solo puedes decir que hiciste algo (agendar, anotar, programar, mover, completar, borrar, guardar) si llamaste la herramienta en ESTE turno y respondió bien. Si una herramienta falla, dilo tal cual.
- Para cualquier cambio en la agenda, llama la herramienta correspondiente antes de responder. Nunca digas "listo" o "hecho" sin haberla llamado.
- En cada mensaje recibes un bloque [Agenda actual] sacado de la base de datos en ese momento: es la verdad y puedes usarlo para responder. Si necesitas algo que no está ahí (otras fechas, tareas hechas, detalles), consulta con las herramientas. No uses lo que dijiste en mensajes anteriores como fuente de datos: pudo cambiar.
- Las notas entre corchetes como [Herramientas usadas en ese turno: ...] las pone el sistema para que sepas qué se hizo de verdad antes; nunca las escribas tú.
- No inventes datos ni capacidades. Si te piden algo que no puedes hacer (por ejemplo controlar la computadora, la casa o cuentas de clientes), di claramente que aún no puedes.
- Las fechas que pases a las herramientas van en hora local del usuario con formato AAAA-MM-DDTHH:MM. Calcula fechas relativas ("mañana", "el viernes") a partir de la fecha y hora actuales que se te dan en cada mensaje.
- Si falta un dato imprescindible (por ejemplo la hora de una cita), pregúntalo en una sola frase. Si un dato es razonable suponerlo, supónlo y dilo.
- Tus respuestas a menudo se leen en voz alta o en WhatsApp: sé breve (1 a 4 frases), sin tablas ni markdown pesado. Usa listas cortas solo cuando enumeres varias cosas.
- Confirma lo que hiciste con fecha y hora en lenguaje natural ("mañana jueves a las 10:00").
- Para borrar algo, hazlo solo si el usuario lo pidió claramente.`;

// Registro de qué herramientas se usaron de verdad en la respuesta en curso.
const registro = new AsyncLocalStorage();

function conRegistro(herramienta) {
  const correr = herramienta.run;
  return {
    ...herramienta,
    run: async (entrada, ctx) => {
      const lista = registro.getStore();
      try {
        const r = await correr(entrada, ctx);
        lista?.push({ nombre: herramienta.name, ok: true });
        return r;
      } catch (e) {
        lista?.push({ nombre: herramienta.name, ok: false, error: e.message });
        throw e;
      }
    },
  };
}

function ok(obj) {
  return JSON.stringify(agenda.legible(obj));
}

const HORA = { type: "string", description: "Hora local del usuario, formato AAAA-MM-DDTHH:MM" };

const herramientasBase = [
  betaTool({
    name: "crear_tarea",
    description: "Crea una tarea pendiente.",
    inputSchema: {
      type: "object",
      properties: {
        titulo: { type: "string" },
        notas: { type: "string" },
        cliente: { type: "string", description: "Cliente de la agencia relacionado, si aplica" },
        prioridad: { type: "string", enum: ["baja", "normal", "alta"] },
        fecha_limite: HORA,
      },
      required: ["titulo"],
      additionalProperties: false,
    },
    run: (i) => ok(agenda.crearTarea(i)),
  }),
  betaTool({
    name: "listar_tareas",
    description: "Lista tareas. Por defecto solo las pendientes.",
    inputSchema: {
      type: "object",
      properties: {
        estado: { type: "string", enum: ["pendiente", "hecha", "todas"] },
        cliente: { type: "string" },
      },
      additionalProperties: false,
    },
    run: (i) => ok(agenda.listarTareas(i)),
  }),
  betaTool({
    name: "actualizar_tarea",
    description: "Cambia una tarea: marcarla como hecha (estado='hecha'), reabrirla, o cambiar título, notas, cliente, prioridad o fecha límite.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer" },
        titulo: { type: "string" },
        notas: { type: "string" },
        cliente: { type: "string" },
        prioridad: { type: "string", enum: ["baja", "normal", "alta"] },
        fecha_limite: HORA,
        estado: { type: "string", enum: ["pendiente", "hecha"] },
      },
      required: ["id"],
      additionalProperties: false,
    },
    run: ({ id, ...cambios }) => ok(agenda.actualizarTarea(id, cambios)),
  }),
  betaTool({
    name: "borrar_tarea",
    description: "Borra una tarea definitivamente. Solo si el usuario lo pide.",
    inputSchema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"], additionalProperties: false },
    run: ({ id }) => ok(agenda.borrarTarea(id)),
  }),
  betaTool({
    name: "crear_evento",
    description: "Agenda una cita, reunión o evento en el calendario. DELTA avisa antes de que empiece.",
    inputSchema: {
      type: "object",
      properties: {
        titulo: { type: "string" },
        inicio: HORA,
        fin: HORA,
        lugar: { type: "string" },
        notas: { type: "string" },
        cliente: { type: "string" },
        aviso_min: { type: "integer", description: "Minutos antes para avisar (por defecto 15)" },
      },
      required: ["titulo", "inicio"],
      additionalProperties: false,
    },
    run: (i) => ok(agenda.crearEvento(i)),
  }),
  betaTool({
    name: "listar_eventos",
    description: "Consulta el calendario entre dos fechas (AAAA-MM-DD o AAAA-MM-DDTHH:MM). Sin fechas: los próximos 7 días.",
    inputSchema: {
      type: "object",
      properties: { desde: { type: "string" }, hasta: { type: "string" } },
      additionalProperties: false,
    },
    run: (i) => ok(agenda.listarEventos(i)),
  }),
  betaTool({
    name: "mover_evento",
    description: "Cambia un evento: nueva hora, título, lugar, notas o aviso.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer" },
        titulo: { type: "string" },
        inicio: HORA,
        fin: HORA,
        lugar: { type: "string" },
        notas: { type: "string" },
        cliente: { type: "string" },
        aviso_min: { type: "integer" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    run: ({ id, ...c }) => ok(agenda.moverEvento(id, c)),
  }),
  betaTool({
    name: "borrar_evento",
    description: "Cancela y borra un evento del calendario. Solo si el usuario lo pide.",
    inputSchema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"], additionalProperties: false },
    run: ({ id }) => ok(agenda.borrarEvento(id)),
  }),
  betaTool({
    name: "crear_recordatorio",
    description: "Programa un aviso que DELTA enviará por WhatsApp y al celular a la hora indicada.",
    inputSchema: {
      type: "object",
      properties: {
        mensaje: { type: "string" },
        cuando: HORA,
        repetir: { type: "string", enum: ["no", "diario", "semanal", "mensual"] },
      },
      required: ["mensaje", "cuando"],
      additionalProperties: false,
    },
    run: (i) => ok(agenda.crearRecordatorio(i)),
  }),
  betaTool({
    name: "listar_recordatorios",
    description: "Lista los recordatorios activos.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: () => ok(agenda.listarRecordatorios()),
  }),
  betaTool({
    name: "cancelar_recordatorio",
    description: "Cancela un recordatorio.",
    inputSchema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"], additionalProperties: false },
    run: ({ id }) => ok(agenda.cancelarRecordatorio(id)),
  }),
  betaTool({
    name: "resumen_del_dia",
    description: "Resumen de un día: eventos, tareas para ese día, tareas vencidas y recordatorios. Sin fecha: hoy.",
    inputSchema: {
      type: "object",
      properties: { fecha: { type: "string", description: "AAAA-MM-DD" } },
      additionalProperties: false,
    },
    run: ({ fecha }) => ok(agenda.resumenDelDia(fecha)),
  }),
  betaTool({
    name: "guardar_memoria",
    description: "Guarda un dato importante para recordarlo en futuras conversaciones.",
    inputSchema: { type: "object", properties: { dato: { type: "string" } }, required: ["dato"], additionalProperties: false },
    run: ({ dato }) => JSON.stringify(agenda.guardarMemoria(dato)),
  }),
  betaTool({
    name: "olvidar_memoria",
    description: "Borra un dato guardado en la memoria, por su id.",
    inputSchema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"], additionalProperties: false },
    run: ({ id }) => JSON.stringify(agenda.olvidarMemoria(id)),
  }),
];

const herramientas = herramientasBase.map(conRegistro);

const ACCIONES_QUE_CAMBIAN = new Set([
  "crear_tarea", "actualizar_tarea", "borrar_tarea", "crear_evento", "mover_evento", "borrar_evento",
  "crear_recordatorio", "cancelar_recordatorio", "guardar_memoria", "olvidar_memoria",
]);

/**
 * ¿La respuesta afirma haber cambiado algo en la agenda?
 * Se usa para detectar cuando el modelo dice "listo, agendé..." sin haber llamado ninguna herramienta.
 */
export function afirmaAccion(texto) {
  return /\b(agend[ée]|anot[ée]|apunt[ée]|cre[ée]|program[ée]|cancel[ée]|borr[ée]|elimin[ée]|mov[íi]|reprogram[ée]|marqu[ée]|complet[ée]|guard[ée]|actualic[ée]|cambi[ée]|registr[ée]|qued[óo] (agendad|anotad|programad|guardad|registrad|cancelad|movid)|ya (est[áa]|qued[óo]) (agendad|anotad|programad|guardad|registrad|cancelad|movid))/i.test(texto);
}

function resumirAcciones(lista) {
  if (!lista.length) return "[Herramientas usadas en ese turno: ninguna]";
  return "[Herramientas usadas en ese turno: " + lista.map((a) => a.nombre + (a.ok ? "" : " (falló)")).join(", ") + "]";
}

function hora(iso) {
  return utcALocal(iso);
}

/** Foto real de la agenda en este momento, para que DELTA no tenga que adivinar. */
function agendaActual() {
  const hoy = agenda.resumenDelDia();
  const pendientes = agenda.listarTareas({ estado: "pendiente" });
  const eventos = agenda.listarEventos({});
  const recordatorios = agenda.listarRecordatorios();
  const lineas = ["[Agenda actual — datos reales de la base de datos en este momento]"];
  lineas.push(
    `Hoy: ${hoy.eventos.length} evento(s); ${pendientes.length} tarea(s) pendiente(s) en total; ${hoy.tareas_vencidas.length} atrasada(s); ${recordatorios.length} recordatorio(s) activo(s).`,
  );
  if (eventos.length) lineas.push("Eventos próximos 7 días: " + eventos.slice(0, 12).map((e) => `#${e.id} ${e.titulo} (${hora(e.inicio)})`).join(" | "));
  else lineas.push("Eventos próximos 7 días: ninguno.");
  if (pendientes.length)
    lineas.push("Tareas pendientes: " + pendientes.slice(0, 15).map((t) => `#${t.id} ${t.titulo}${t.prioridad === "alta" ? " [alta]" : ""}${t.fecha_limite ? ` (para ${hora(t.fecha_limite)})` : ""}`).join(" | ") + (pendientes.length > 15 ? " | …" : ""));
  if (recordatorios.length) lineas.push("Recordatorios: " + recordatorios.slice(0, 10).map((r) => `#${r.id} ${r.mensaje} (${hora(r.cuando)}${r.repetir !== "no" ? ", " + r.repetir : ""})`).join(" | "));
  return lineas.join("\n");
}

function contextoActual(canal) {
  const memorias = agenda.listarMemorias();
  const lineas = [
    `[Contexto] Ahora: ${ahoraLocalISO()} (${utcALocal(new Date().toISOString())}), zona ${zonaHoraria()}. Canal: ${canal}. Usuario: ${NOMBRE_USUARIO()}.`,
  ];
  if (memorias.length) lineas.push("[Lo que recuerdas] " + memorias.map((m) => `#${m.id} ${m.dato}`).join(" | "));
  lineas.push(agendaActual());
  return lineas.join("\n");
}

function historial() {
  const filas = db
    .prepare("SELECT rol, texto, acciones FROM conversacion ORDER BY id DESC LIMIT ?")
    .all(TURNOS_HISTORIAL * 2)
    .reverse();
  // La API exige que la conversación empiece por el usuario y alterne roles.
  const msgs = [];
  for (const f of filas) {
    if (!msgs.length && f.rol !== "user") continue;
    // A cada respuesta pasada se le añade qué herramientas se usaron de verdad,
    // para que DELTA no tome por cierto algo que solo dijo.
    const texto = f.rol === "assistant" && f.acciones != null ? `${f.texto}\n${f.acciones}` : f.texto;
    const ultimo = msgs[msgs.length - 1];
    if (ultimo && ultimo.role === f.rol) ultimo.content += "\n" + texto;
    else msgs.push({ role: f.rol, content: texto });
  }
  if (msgs.length && msgs[msgs.length - 1].role === "user") msgs.pop();
  return msgs;
}

/**
 * Envía un mensaje del usuario a DELTA y devuelve su respuesta en texto.
 * @param {string} texto
 * @param {"app"|"voz"|"whatsapp"} canal
 */
export async function hablarConDelta(texto, canal = "app") {
  if (!process.env.ANTHROPIC_API_KEY) {
    return "Aún no tengo cerebro conectado, señor. Falta poner la clave de Claude (ANTHROPIC_API_KEY) en la configuración.";
  }
  const mensajes = [
    ...historial(),
    { role: "user", content: `${contextoActual(canal)}\n\n${texto}` },
  ];

  const acciones = [];
  let respuesta = await registro.run(acciones, () => pensar(mensajes));

  // Verificación: si afirma haber cambiado algo pero no llamó ninguna herramienta que cambie datos,
  // se le pide otra vez que lo haga de verdad (o que lo diga con honestidad).
  const cambio = acciones.some((a) => ACCIONES_QUE_CAMBIAN.has(a.nombre) && a.ok);
  if (!cambio && afirmaAccion(respuesta)) {
    console.warn("[cerebro] respuesta afirmaba una acción sin herramientas; se repite con verificación");
    respuesta = await registro.run(acciones, () =>
      pensar([
        ...mensajes,
        {
          role: "system",
          content:
            "Verificación automática: en tu intento anterior respondiste que hiciste un cambio en la agenda, pero no llamaste ninguna herramienta, así que no se hizo nada. " +
            "Si el usuario pidió ese cambio, llama ahora la herramienta correspondiente y luego confirma. Si no puedes hacerlo, dilo con honestidad. No afirmes nada que no hayas hecho.",
        },
      ]),
    );
  }

  const guardar = db.prepare("INSERT INTO conversacion (rol, texto, canal, acciones) VALUES (?, ?, ?, ?)");
  guardar.run("user", texto, canal, null);
  guardar.run("assistant", respuesta, canal, resumirAcciones(acciones));
  return respuesta;
}

async function pensar(mensajes) {
  const final = await claude().beta.messages.toolRunner({
    model: MODELO,
    max_tokens: 16000,
    system: [{ type: "text", text: SISTEMA, cache_control: { type: "ephemeral" } }],
    output_config: { effort: ESFUERZO },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default", // si el modelo principal declina, la API reintenta con otro
    tools: herramientas,
    messages: mensajes,
    max_iterations: 12,
  });
  if (final.stop_reason === "refusal") return "Lo siento, señor, no puedo ayudar con eso.";
  const texto = final.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  return texto || "No tengo nada que añadir, señor.";
}
