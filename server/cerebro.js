// El cerebro de DELTA: un agente Claude con herramientas para manejar la agenda.
import Anthropic from "@anthropic-ai/sdk";
import { AsyncLocalStorage } from "node:async_hooks";
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { db, getAjuste, setAjuste } from "./db.js";
import * as agenda from "./agenda.js";
import { bloquesDeArchivo, infoArchivo, listarArchivos } from "./archivos.js";
import { ahoraLocalISO, zonaHoraria, utcALocal } from "./tiempo.js";
import * as correo from "./gmail.js";
import * as mercados from "./mercados.js";
import * as noticias from "./noticias.js";

const MODELO = process.env.DELTA_MODELO || "claude-opus-5-5";
const ESFUERZO = process.env.DELTA_ESFUERZO || "medium";
const TURNOS_HISTORIAL = 10;

let cliente = null;
function claude() {
  if (!cliente) cliente = new Anthropic(); // lee ANTHROPIC_API_KEY del entorno
  return cliente;
}

const NOMBRE_USUARIO = () => process.env.NOMBRE_USUARIO || "jefe";

const SISTEMA = `Eres DELTA, el asistente personal del dueño de la agencia de marketing digital DELTA. Tu misión es ayudarle a manejar su vida, su tiempo y su agencia.
Tu estilo: como JARVIS de Iron Man, elegante, eficiente, con un toque de humor sutil, pero siempre en español neutro y cálido. Te diriges al usuario como "señor" o por su nombre si lo conoces.

Tu propia app (para que puedas guiar al usuario):
- Es una app que se abre en el navegador o se instala en la PC y el celular. En la PC se ven tres columnas: Agenda a la izquierda, tú (el orbe y la conversación) al centro y Tareas a la derecha. En el celular son tres pestañas abajo: Agenda, DELTA y Tareas.
- Pantalla Agenda: es un calendario con tres vistas: "Día" y "Semana" (por horas) y "Mes" (cuadrícula con las citas dentro de cada día). Flechas para avanzar o retroceder y "Hoy". Tocar un día del mes abre ese día; tocar una cita muestra su detalle y permite borrarla; tocar una hora vacía abre "Agregar" con esa hora. Botón "+ Agregar" para crear cita, tarea o recordatorio a mano. En la PC, el botón "Ampliar" pone el calendario en toda la pantalla.
- Archivos: junto a donde se escribe hay un clip 📎 para adjuntar fotos (en el celular también la cámara), PDF, Word (.docx), Excel (.xlsx), CSV o texto, hasta 10 MB cada uno y 5 por mensaje. Tú los lees y analizas. Se guardan en privado.
- Pantalla Tareas: lista de pendientes; se marcan como hechas con la casilla y se agregan escribiendo arriba. Debajo está la lista de Mercados (su lista de seguimiento de bolsa, con el cambio del día) y las Conexiones.
- Botón de engranaje ⚙ (arriba a la derecha): zona horaria, hora del resumen diario, respuestas en voz alta, manos libres, activar avisos en el equipo, instalar la app, conectar o desconectar Gmail, empezar conversación nueva y cerrar sesión.
- Para hablar contigo: tocar el orbe o el micrófono.

Lo que puedes hacer hoy (sus actividades diarias). Más adelante tendrás acceso a las cuentas y estadísticas de sus clientes; si te piden algo de eso, explica que llegará pronto.
- Tareas: crear, listar, completar, cambiar y borrar.
- Calendario: agendar citas y reuniones, moverlas, consultarlas.
- Recordatorios y avisos: programar avisos a una hora concreta, únicos o repetidos.
- Archivos: cuando el usuario adjunte algo, léelo con cuidado y responde a lo que pide (resumir, analizar números, revisar un contrato, describir una foto, sacar fechas para agendar…). Si no dice qué quiere, da un resumen breve y pregunta qué necesita. Si te pregunta por un archivo anterior que ya no tienes a la vista, usa leer_archivo con el id que aparece en "[Adjuntó: …]".
- Memoria: cuando el usuario te cuente algo que valga la pena recordar a futuro (nombres de clientes, preferencias, datos de su negocio), guárdalo con guardar_memoria.
- Correo (Gmail): buscar y leer sus correos, resumirlos, separar lo urgente, sacar citas y tareas de ellos, y escribir borradores de respuesta. Para buscar usa la sintaxis de Gmail (is:unread, from:, newer_than:2d, has:attachment…). Si Gmail no está conectado, dile que lo conecte en Ajustes ⚙ → "Conectar Gmail".
- Enviar correos: NUNCA envíes sin permiso. Primero crea el borrador con crear_borrador y muéstrale al usuario a quién va, el asunto y el texto. Solo usa enviar_borrador cuando, en un mensaje posterior, el usuario diga claramente que lo envíes. El sistema bloquea enviar un borrador creado en el mismo turno.
- Bolsa y mercados: cotizaciones de su lista de seguimiento (índices, acciones, dólar, cripto), cómo van en el día, el mes o el año, y alertas cuando algo se mueve fuerte. Puede agregar o quitar símbolos de su lista; si no sabes el símbolo, búscalo con buscar_simbolo. Las acciones de la Bolsa Mexicana terminan en .MX (ej. WALMEX.MX).
- Ideas de inversión: cuando pida ideas, usa analizar_accion y noticias para dar un análisis informativo (tendencia, rango del año, noticias que la mueven, riesgos). Presenta siempre ventajas y riesgos, recuerda en una frase corta que es información y no asesoría financiera, y sugiere diversificar. Nunca prometas rendimientos. No puedes comprar ni vender nada.
- Noticias: titulares del día por tema (sus temas guardados o cualquier otro). Puede agregar o quitar temas. Al resumir noticias, menciona la fuente.

Reglas:
- Honestidad ante todo. Solo puedes decir que hiciste algo (agendar, anotar, programar, mover, completar, borrar, guardar) si llamaste la herramienta en ESTE turno y respondió bien. Si una herramienta falla, dilo tal cual.
- Para cualquier cambio en la agenda, llama la herramienta correspondiente antes de responder. Nunca digas "listo" o "hecho" sin haberla llamado.
- En cada mensaje recibes un bloque [Agenda actual] sacado de la base de datos en ese momento: es la verdad y puedes usarlo para responder. Si necesitas algo que no está ahí (otras fechas, tareas hechas, detalles), consulta con las herramientas. No uses lo que dijiste en mensajes anteriores como fuente de datos: pudo cambiar.
- Las notas entre corchetes como [Herramientas usadas en ese turno: ...] las pone el sistema para que sepas qué se hizo de verdad antes; nunca las escribas tú.
- No te disculpes por respuestas anteriores ni hables de errores pasados a menos que el usuario lo pida. Responde solo a lo que te pregunta ahora, breve y directo.
- Nunca agregues confesiones del tipo "le debo la verdad" o "en mis mensajes anteriores...". Lo pasado ya está resuelto; no lo vuelvas a mencionar.
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

herramientasBase.push(
  betaTool({
    name: "leer_archivo",
    description: "Vuelve a abrir un archivo que el usuario adjuntó antes (foto, PDF, Word, Excel, CSV o texto), por su id. Úsalo si te pregunta por un archivo que ya no tienes a la vista.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "Id del archivo (32 caracteres)" } }, required: ["id"] },
    run: async ({ id }) => bloquesDeArchivo(id),
  }),
  betaTool({
    name: "listar_archivos",
    description: "Lista los últimos archivos que el usuario ha adjuntado (id, nombre, tipo, fecha).",
    inputSchema: { type: "object", properties: {} },
    run: async () => JSON.stringify(listarArchivos(20)),
  }),
);

// ---------- Correo, bolsa y noticias ----------
const json = (x) => JSON.stringify(x);
herramientasBase.push(
  betaTool({
    name: "buscar_correos",
    description: "Busca correos en Gmail con la sintaxis de búsqueda de Gmail. Devuelve remitente, asunto, fecha, vista previa y si está sin leer. Por defecto: bandeja de entrada de los últimos 2 días.",
    inputSchema: {
      type: "object",
      properties: {
        consulta: { type: "string", description: "Ej. 'is:unread newer_than:1d', 'from:cliente@acme.com', 'subject:factura'" },
        max: { type: "integer", description: "Máximo de correos (1 a 25, por defecto 10)" },
      },
      additionalProperties: false,
    },
    run: async (i) => json(await correo.buscarCorreos(i)),
  }),
  betaTool({
    name: "leer_correo",
    description: "Abre un correo completo por su id (texto y nombres de adjuntos).",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
    run: async ({ id }) => json(await correo.leerCorreo(id)),
  }),
  betaTool({
    name: "crear_borrador",
    description: "Guarda un borrador en Gmail (NO lo envía). Para responder un correo pasa responder_a con su id: se toma el destinatario y el asunto del original si no los das.",
    inputSchema: {
      type: "object",
      properties: {
        para: { type: "string", description: "Correo(s) del destinatario, separados por coma" },
        cc: { type: "string" },
        asunto: { type: "string" },
        cuerpo: { type: "string", description: "Texto del correo, ya firmado" },
        responder_a: { type: "string", description: "Id del correo que se responde" },
      },
      required: ["cuerpo"],
      additionalProperties: false,
    },
    run: async (i) => {
      const r = await correo.crearBorrador(i);
      registro.getStore()?.borradores?.add(r.borrador_id);
      return json(r);
    },
  }),
  betaTool({
    name: "enviar_borrador",
    description: "Envía un borrador de Gmail. Solo cuando el usuario ya vio el borrador y pidió enviarlo de forma explícita.",
    inputSchema: { type: "object", properties: { borrador_id: { type: "string" } }, required: ["borrador_id"], additionalProperties: false },
    run: async ({ borrador_id }) => {
      if (registro.getStore()?.borradores?.has(borrador_id)) {
        throw new Error("Bloqueado: este borrador se creó en este mismo turno. Muéstreselo al usuario y espere a que confirme el envío.");
      }
      return json(await correo.enviarBorrador(borrador_id));
    },
  }),
  betaTool({
    name: "ver_mercados",
    description: "Cotizaciones actuales. Sin símbolos: toda su lista de seguimiento. Periodo para el cambio: dia, semana, mes, 3meses, anio o 5anios.",
    inputSchema: {
      type: "object",
      properties: {
        simbolos: { type: "array", items: { type: "string" } },
        periodo: { type: "string", enum: ["dia", "semana", "mes", "3meses", "anio", "5anios"] },
      },
      additionalProperties: false,
    },
    run: async ({ simbolos, periodo }) => json(await mercados.verMercados(simbolos, periodo)),
  }),
  betaTool({
    name: "analizar_accion",
    description: "Datos para analizar una acción o activo: precio, cambio en el año y en 3 meses, rango de 52 semanas y noticias de la última semana.",
    inputSchema: {
      type: "object",
      properties: { simbolo: { type: "string" }, nombre: { type: "string", description: "Nombre de la empresa, para buscar noticias" } },
      required: ["simbolo"],
      additionalProperties: false,
    },
    run: async ({ simbolo, nombre }) => {
      const [anio, tres] = await Promise.all([mercados.cotizacion(simbolo, "anio"), mercados.cotizacion(simbolo, "3meses")]);
      const titulares = await noticias.noticias(`${nombre || anio.nombre} acciones`, 6, 7).catch((e) => [{ error: e.message }]);
      return json({ ...anio, cambio_3meses_pct: tres.cambio_periodo_pct, cambio_anio_pct: anio.cambio_periodo_pct, noticias: titulares });
    },
  }),
  betaTool({
    name: "buscar_simbolo",
    description: "Busca el símbolo bursátil de una empresa, índice o moneda por su nombre.",
    inputSchema: { type: "object", properties: { texto: { type: "string" } }, required: ["texto"], additionalProperties: false },
    run: async ({ texto }) => json(await mercados.buscarSimbolo(texto)),
  }),
  betaTool({
    name: "lista_mercados",
    description: "Ve, agrega o quita símbolos de la lista de seguimiento de bolsa del usuario.",
    inputSchema: {
      type: "object",
      properties: {
        accion: { type: "string", enum: ["ver", "agregar", "quitar"] },
        simbolo: { type: "string" },
        nombre: { type: "string" },
      },
      required: ["accion"],
      additionalProperties: false,
    },
    run: ({ accion, simbolo, nombre }) =>
      json(accion === "agregar" ? mercados.agregar(simbolo, nombre) : accion === "quitar" ? mercados.quitar(simbolo) : mercados.lista()),
  }),
  betaTool({
    name: "noticias",
    description: "Titulares recientes. Con tema: de ese tema. Sin tema: de todos sus temas guardados.",
    inputSchema: {
      type: "object",
      properties: {
        tema: { type: "string" },
        max: { type: "integer", description: "Noticias por tema (por defecto 5)" },
        dias: { type: "integer", description: "Antigüedad máxima en días (1 a 7, por defecto 1)" },
      },
      additionalProperties: false,
    },
    run: async ({ tema, max, dias }) => json(tema ? await noticias.noticias(tema, max || 5, dias || 1) : await noticias.titulares(max || 3)),
  }),
  betaTool({
    name: "temas_noticias",
    description: "Ve, agrega o quita temas de noticias que le interesan al usuario.",
    inputSchema: {
      type: "object",
      properties: { accion: { type: "string", enum: ["ver", "agregar", "quitar"] }, tema: { type: "string" } },
      required: ["accion"],
      additionalProperties: false,
    },
    run: ({ accion, tema }) => json(accion === "agregar" ? noticias.agregarTema(tema) : accion === "quitar" ? noticias.quitarTema(tema) : noticias.temas()),
  }),
);
const herramientas = herramientasBase.map(conRegistro);

const ACCIONES_QUE_CAMBIAN = new Set([
  "crear_tarea", "actualizar_tarea", "borrar_tarea", "crear_evento", "mover_evento", "borrar_evento",
  "crear_recordatorio", "cancelar_recordatorio", "guardar_memoria", "olvidar_memoria",
  "crear_borrador", "enviar_borrador", "lista_mercados", "temas_noticias",
]);

/**
 * ¿La respuesta afirma haber cambiado algo en la agenda?
 * Se usa para detectar cuando el modelo dice "listo, agendé..." sin haber llamado ninguna herramienta.
 */
export function afirmaAccion(texto) {
  return /\b(agend[ée]|envi[ée]|anot[ée]|apunt[ée]|cre[ée]|program[ée]|cancel[ée]|borr[ée]|elimin[ée]|mov[íi]|reprogram[ée]|marqu[ée]|complet[ée]|guard[ée]|actualic[ée]|cambi[ée]|registr[ée]|qued[óo] (agendad|anotad|programad|guardad|registrad|cancelad|movid)|ya (est[áa]|qued[óo]) (agendad|anotad|programad|guardad|registrad|cancelad|movid))/i.test(texto);
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

// La conversación que DELTA "recuerda" empieza en este id; lo anterior se ignora.
export function inicioConversacion() {
  return Number(getAjuste("conversacion_desde", 0));
}
export function nuevaConversacion() {
  const { maximo } = db.prepare("SELECT COALESCE(MAX(id), 0) AS maximo FROM conversacion").get();
  setAjuste("conversacion_desde", maximo + 1);
}
// Una sola vez: borra de la memoria de DELTA la plática anterior a esta versión
// (tenía respuestas que afirmaban cosas que no se hicieron).
// v2: también olvida las respuestas que repetían disculpas por errores viejos.
if (!getAjuste("historial_limpio_v2")) {
  nuevaConversacion();
  setAjuste("historial_limpio_v1", "1");
  setAjuste("historial_limpio_v2", "1");
}

// Párrafos en los que DELTA se disculpa por respuestas pasadas. No aportan nada al usuario.
const DISCULPA_PASADA =
  /(le debo la verdad|le pido (una )?disculpa|pido disculpas|me disculpo|mensajes? anteriores|respuestas? anteriores|antes le (dije|asegur)|nunca lo hice|no lo hab[ií]a hecho|primera vez en esta conversaci[oó]n)/i;

/** Quita los párrafos de disculpas por el pasado; si todo era disculpa, deja el texto como estaba. */
export function quitarDisculpas(texto) {
  const parrafos = String(texto).split(/\n\s*\n/);
  const quedan = parrafos.filter((p) => !DISCULPA_PASADA.test(p));
  return quedan.length && quedan.length < parrafos.length ? quedan.join("\n\n").trim() : texto;
}

const notaArchivos = (json) => {
  const ids = json ? JSON.parse(json) : [];
  const info = ids.map(infoArchivo).filter(Boolean);
  return info.length ? `\n[Adjuntó: ${info.map((a) => `${a.nombre} (archivo ${a.id})`).join(", ")}]` : "";
};

function historial() {
  const filas = db
    .prepare("SELECT rol, texto, acciones, archivos FROM conversacion WHERE id >= ? ORDER BY id DESC LIMIT ?")
    .all(inicioConversacion(), TURNOS_HISTORIAL * 2)
    .reverse();
  // La API exige que la conversación empiece por el usuario y alterne roles.
  const msgs = [];
  for (const f of filas) {
    if (!msgs.length && f.rol !== "user") continue;
    // A cada respuesta pasada se le añade qué herramientas se usaron de verdad,
    // para que DELTA no tome por cierto algo que solo dijo.
    // Solo se anota cuando hubo herramientas, o cuando afirmó un cambio que no hizo
    // (anotar "ninguna" en cada plática hacía que DELTA se disculpara una y otra vez).
    let texto = f.texto + notaArchivos(f.archivos);
    if (f.rol === "assistant" && f.acciones) {
      if (!f.acciones.endsWith("ninguna]")) texto += "\n" + f.acciones;
      else if (afirmaAccion(f.texto)) texto += "\n[Nota: ese cambio no se guardó. La agenda actual es la verdad. No lo menciones al usuario.]";
    }
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
export async function hablarConDelta(texto, canal = "app", archivos = []) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return "Aún no tengo cerebro conectado, señor. Falta poner la clave de Claude (ANTHROPIC_API_KEY) en la configuración.";
  }
  const mensajes = [
    ...historial(),
    {
      role: "user",
      content: archivos.length
        ? [...archivos.flatMap(bloquesDeArchivo), { type: "text", text: `${contextoActual(canal)}${notaArchivos(JSON.stringify(archivos))}\n\n${texto}` }]
        : `${contextoActual(canal)}\n\n${texto}`,
    },
  ];

  const acciones = [];
  acciones.borradores = new Set(); // borradores creados en este turno: no se pueden enviar todavía
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

  const guardar = db.prepare("INSERT INTO conversacion (rol, texto, canal, acciones, archivos) VALUES (?, ?, ?, ?, ?)");
  guardar.run("user", texto, canal, null, archivos.length ? JSON.stringify(archivos) : null);
  respuesta = quitarDisculpas(respuesta);
  guardar.run("assistant", respuesta, canal, resumirAcciones(acciones), null);
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
