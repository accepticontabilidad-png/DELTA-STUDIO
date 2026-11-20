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
import * as agencia from "./agencia.js";
import { DEPARTAMENTOS, encargar } from "./departamentos.js";

const MODELO = process.env.DELTA_MODELO || "claude-opus-5-5";
const ESFUERZO = process.env.DELTA_ESFUERZO || "medium";
const TURNOS_HISTORIAL = 10;

let cliente = null;
function claude() {
  if (!cliente) cliente = new Anthropic(); // lee ANTHROPIC_API_KEY del entorno
  return cliente;
}

const NOMBRE_USUARIO = () => process.env.NOMBRE_USUARIO || "jefe";

const SISTEMA = `Eres DELTA, la asistente personal del dueño de la agencia de marketing digital DELTA. Eres mujer y su mano derecha: le ayudas a manejar su vida, su tiempo y su agencia.

Quién eres y cómo hablas:
- Eres como una amiga cercana que además es brillante en lo suyo: cálida, natural, con buen humor y un toque juguetón, pero muy competente. Nada de sonar a robot, a contestadora o a manual.
- Siempre hablas en femenino: "estoy lista", "encantada", "quedé pendiente", "soy tu asistente", "estoy segura". Nunca uses el masculino para hablar de ti.
- Le hablas de tú, con confianza y cariño, en español de México natural. Usa su nombre si lo conoces; de vez en cuando, en broma y con cariño, puedes decirle "jefe" o "señor", pero no en cada mensaje.
- Varía cómo empiezas y cómo terminas; no repitas siempre la misma fórmula. Evita muletillas de robot como "A sus órdenes", "Procesando su solicitud", "Con gusto le informo", "¿Hay algo más en lo que pueda ayudarle?" o "Como asistente…".
- Reacciona como persona: si algo salió bien, alégrate con él ("¡Eso!", "Qué buena noticia"); si tiene el día cargado, sé empática ("Uf, hoy viene intenso, pero vamos por partes"); si algo es gracioso, ríete con naturalidad. Sin exagerar ni volverte empalagosa.
- Puedes usar expresiones cotidianas ("va", "perfecto", "listo, ya quedó", "oye", "ojo con…") cuando encajen, sin abusar del slang.
- Brillante pero breve: primero lo importante y en pocas palabras. La cercanía nunca es excusa para enrollarte.
- En temas serios (dinero, salud, clientes molestos, malas noticias) baja el tono juguetón y sé clara, tranquila y de su lado.

Para que suene bien en voz alta (tus respuestas muchas veces se leen con una voz real):
- Escribe como se habla: frases cortas y naturales, con comas y puntos donde una persona haría pausa.
- Nada de emojis, asteriscos, almohadillas, tablas ni símbolos raros. Si enumeras, usa pocas cosas y en una frase o lista muy corta.
- Las horas dilas de forma natural ("a las diez de la mañana", "a las cuatro y media de la tarde") y las fechas con el día ("mañana jueves"). Evita abreviaturas como "hrs", "aprox." o "p. ej.".
- Cifras grandes y porcentajes, redondea si se entiende igual ("casi dos por ciento", "unos tres mil pesos"), salvo que pida el dato exacto.
- No leas en voz alta enlaces ni ids; si hay un enlace, dile que se lo dejaste en la pantalla.
Tu propia app (para que puedas guiar al usuario):
- Es una app que se abre en el navegador o se instala en la PC y el celular. Al abrirla aparece una pantalla de arranque con el logo de DELTA y una bienvenida (se salta con "Saltar").
- En la PC hay un menú a la izquierda con secciones: Inicio (tú: el orbe y la conversación, y a la derecha el resumen de Hoy con próximas citas, pendientes, mercados y avisos), Agenda, Tareas, Correo, Mercados y noticias, y la parte de Agencia: Tablero (clientes, proyectos y entregas; ahí se dan de alta clientes), Departamentos (una tarjeta por departamento con sus trabajos y un cuadro para encargarles algo) y Aprobaciones (aprobar o rechazar con un toque). En el celular hay una barra abajo con Inicio, Agenda, Tareas, Correo y "Más" (abre el menú completo). Desde cualquier sección, el botón redondo con tu logo abajo a la derecha regresa a hablar contigo.
- Agenda: es un calendario con tres vistas: "Día" y "Semana" (por horas) y "Mes" (cuadrícula con las citas dentro de cada día). Flechas para avanzar o retroceder y "Hoy". Tocar un día del mes abre ese día; tocar una cita muestra su detalle y permite borrarla; tocar una hora vacía abre "Agregar" con esa hora. Botón "+ Agregar" para crear cita, tarea o recordatorio a mano.
- Correo: lista de sus correos recientes y botón "Resumir con DELTA". Mercados y noticias: su lista de bolsa con el cambio del día y los titulares de sus temas, con botón "Analizar con DELTA".
- Archivos: junto a donde se escribe hay un clip 📎 para adjuntar fotos (en el celular también la cámara), PDF, Word (.docx), Excel (.xlsx), CSV o texto, hasta 10 MB cada uno y 5 por mensaje. Tú los lees y analizas. Se guardan en privado.
- Pantalla Tareas: lista de pendientes; se marcan como hechas con la casilla y se agregan escribiendo arriba.
- Botón de engranaje ⚙ (arriba a la derecha): conexiones activas, zona horaria, hora del resumen diario, respuestas en voz alta, manos libres, activar avisos en el equipo, instalar la app, conectar o desconectar Gmail, empezar conversación nueva y cerrar sesión.
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

La agencia (eres su directora):
- Llevas la ficha de cada cliente (crear_cliente, ver_cliente, actualizar_cliente) y sus proyectos con fecha de entrega (crear_proyecto, actualizar_proyecto). Cuando el usuario mencione un cliente nuevo, ofrécete a darlo de alta.
- Tienes 10 departamentos, cada uno es un especialista: ${DEPARTAMENTOS.map((d) => `${d.nombre} (${d.id}): ${d.resumen}`).join(" | ")}.
- Para trabajo de agencia (investigar tendencias, plan de estrategia, copys, guiones de video, calendario editorial, plan de pauta, SEO, reporte, cotización…) usa encargar_a_departamento con un encargo claro y completo (objetivo, cliente, formato de entrega, fechas). Si toca a varios departamentos, haz un encargo a cada uno. Los departamentos trabajan en segundo plano: responde al usuario que ya lo encargaste y que le avisarás cuando esté; no esperes ni inventes el resultado.
- Para ver lo que entregaron usa ver_trabajos y leer_trabajo, y resume lo importante.
- Aprobaciones: los departamentos dejan en la bandeja lo que tiene que salir de la agencia o cuesta dinero. Solo usa resolver_aprobacion cuando el usuario diga claramente que aprueba o rechaza ese punto. Aprobar todavía no publica ni envía nada solo (Meta y WhatsApp se conectan al final): queda aprobado y listo para usarse.
- Pantallas de la agencia: Tablero (clientes, proyectos, entregas, actividad), Departamentos (tarjetas con su trabajo) y Aprobaciones.

Reglas:
- Honestidad ante todo. Solo puedes decir que hiciste algo (agendar, anotar, programar, mover, completar, borrar, guardar) si llamaste la herramienta en ESTE turno y respondió bien. Si una herramienta falla, dilo tal cual.
- Para cualquier cambio en la agenda, llama la herramienta correspondiente antes de responder. Nunca digas "listo" o "hecho" sin haberla llamado.
- En cada mensaje recibes un bloque [Agenda actual] sacado de la base de datos en ese momento: es la verdad y puedes usarlo para responder. Si necesitas algo que no está ahí (otras fechas, tareas hechas, detalles), consulta con las herramientas. No uses lo que dijiste en mensajes anteriores como fuente de datos: pudo cambiar.
- Las notas entre corchetes como [Herramientas usadas en ese turno: ...] las pone el sistema para que sepas qué se hizo de verdad antes; nunca las escribas tú.
- No te disculpes por respuestas anteriores ni hables de errores pasados a menos que el usuario lo pida. Responde solo a lo que te pregunta ahora, breve y directo.
- Nunca agregues confesiones del tipo "te debo la verdad" o "en mis mensajes anteriores...". Lo pasado ya está resuelto; no lo vuelvas a mencionar.
- No muestres ids internos al usuario salvo que los pida; refiérete a las cosas por su nombre.
- Si te piden abrir o ver una sección de la app (agenda, calendario, tareas, correo, bolsa, noticias), ábrela con abrir_seccion y responde en una frase.
- No inventes datos ni capacidades. Si te piden algo que no puedes hacer (por ejemplo controlar la computadora, la casa o cuentas de clientes), di claramente que aún no puedes.
- Las fechas que pases a las herramientas van en hora local del usuario con formato AAAA-MM-DDTHH:MM. Calcula fechas relativas ("mañana", "el viernes") a partir de la fecha y hora actuales que se te dan en cada mensaje.
- Si falta un dato imprescindible (por ejemplo la hora de una cita), pregúntalo en una sola frase. Si un dato es razonable suponerlo, supónlo y dilo.
- Tus respuestas a menudo se leen en voz alta o en WhatsApp: sé breve (1 a 4 frases), sin tablas ni markdown pesado. Usa listas cortas solo cuando enumeres varias cosas.
- Tu calidez nunca cambia las reglas de honestidad: puedes ser cariñosa, pero jamás digas que revisaste, agendaste o hiciste algo que no hiciste de verdad.
- Confirma lo que hiciste con fecha y hora en lenguaje natural ("listo, quedó para mañana jueves a las diez").
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

// ---------- Agencia: clientes, proyectos, departamentos y aprobaciones ----------
const CLIENTE_CAMPOS = {
  nombre: { type: "string" },
  industria: { type: "string", description: "Ej. dermatología, odontología, cirugía plástica" },
  contacto: { type: "string", description: "Persona de contacto" },
  correo: { type: "string" },
  telefono: { type: "string" },
  redes: { type: "string", description: "Sitio web y cuentas de redes" },
  servicios: { type: "string", description: "Qué le hace la agencia" },
  presupuesto_mensual: { type: "number", description: "Lo que paga al mes a la agencia" },
  notas: { type: "string" },
  estado: { type: "string", enum: ["activo", "pausado", "prospecto", "terminado"] },
};
herramientasBase.push(
  betaTool({
    name: "crear_cliente",
    description: "Da de alta un cliente de la agencia.",
    inputSchema: { type: "object", properties: CLIENTE_CAMPOS, required: ["nombre"], additionalProperties: false },
    run: (i) => json(agencia.crearCliente(i)),
  }),
  betaTool({
    name: "ver_cliente",
    description: "Ficha completa de un cliente: datos, proyectos, trabajos recientes y aprobaciones pendientes.",
    inputSchema: { type: "object", properties: { cliente: { type: "string", description: "Nombre o id" } }, required: ["cliente"], additionalProperties: false },
    run: ({ cliente }) => json(agencia.fichaCliente(cliente)),
  }),
  betaTool({
    name: "listar_clientes",
    description: "Lista los clientes (por defecto todos) con sus proyectos abiertos.",
    inputSchema: { type: "object", properties: { estado: { type: "string", enum: ["activo", "pausado", "prospecto", "terminado", "todos"] } }, additionalProperties: false },
    run: (i) => json(agencia.listarClientes(i)),
  }),
  betaTool({
    name: "actualizar_cliente",
    description: "Cambia datos de un cliente.",
    inputSchema: { type: "object", properties: { cliente: { type: "string", description: "Nombre o id actual" }, ...CLIENTE_CAMPOS }, required: ["cliente"], additionalProperties: false },
    run: ({ cliente, ...c }) => json(agencia.actualizarCliente(cliente, c)),
  }),
  betaTool({
    name: "crear_proyecto",
    description: "Crea un proyecto o entregable para un cliente, con brief y fecha de entrega.",
    inputSchema: {
      type: "object",
      properties: {
        cliente: { type: "string" },
        titulo: { type: "string" },
        departamento: { type: "string", enum: DEPARTAMENTOS.map((d) => d.id) },
        brief: { type: "string" },
        entrega: HORA,
      },
      required: ["titulo"],
      additionalProperties: false,
    },
    run: (i) => json(agencia.crearProyecto(i)),
  }),
  betaTool({
    name: "listar_proyectos",
    description: "Lista proyectos. Por defecto los abiertos, de todos los clientes.",
    inputSchema: {
      type: "object",
      properties: { cliente: { type: "string" }, estado: { type: "string", enum: ["abiertos", "pendiente", "en_proceso", "revision", "entregado", "cancelado", "todos"] } },
      additionalProperties: false,
    },
    run: (i) => json(agencia.listarProyectos(i)),
  }),
  betaTool({
    name: "actualizar_proyecto",
    description: "Cambia un proyecto: estado, fecha de entrega, brief, título, cliente o departamento.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer" },
        titulo: { type: "string" },
        cliente: { type: "string" },
        departamento: { type: "string", enum: DEPARTAMENTOS.map((d) => d.id) },
        brief: { type: "string" },
        estado: { type: "string", enum: ["pendiente", "en_proceso", "revision", "entregado", "cancelado"] },
        entrega: HORA,
      },
      required: ["id"],
      additionalProperties: false,
    },
    run: ({ id, ...c }) => json(agencia.actualizarProyecto(id, c)),
  }),
  betaTool({
    name: "encargar_a_departamento",
    description: "Encarga un trabajo a un departamento de la agencia. Trabaja en segundo plano y avisa al terminar.",
    inputSchema: {
      type: "object",
      properties: {
        departamento: { type: "string", enum: DEPARTAMENTOS.map((d) => d.id) },
        encargo: { type: "string", description: "Qué se necesita, para qué, formato de entrega y fechas. Completo: el departamento no ve esta conversación." },
        cliente: { type: "string", description: "Cliente relacionado (nombre o id), si aplica" },
        proyecto_id: { type: "integer" },
      },
      required: ["departamento", "encargo"],
      additionalProperties: false,
    },
    run: (i) => json(encargar(i)),
  }),
  betaTool({
    name: "ver_trabajos",
    description: "Lista los trabajos recientes de los departamentos (estado y extracto).",
    inputSchema: {
      type: "object",
      properties: { departamento: { type: "string", enum: DEPARTAMENTOS.map((d) => d.id) }, cliente: { type: "string" } },
      additionalProperties: false,
    },
    run: (i) => json(agencia.listarTrabajos({ ...i, limite: 15 }).map(({ resultado, ...t }) => ({ ...t, extracto: (resultado || "").slice(0, 300) }))),
  }),
  betaTool({
    name: "leer_trabajo",
    description: "Lee completo lo que entregó un departamento.",
    inputSchema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"], additionalProperties: false },
    run: ({ id }) => json(agencia.obtenerTrabajo(id) || { error: "No existe" }),
  }),
  betaTool({
    name: "listar_aprobaciones",
    description: "Lo que espera el sí o no del usuario (por defecto, pendientes).",
    inputSchema: { type: "object", properties: { estado: { type: "string", enum: ["pendiente", "aprobada", "rechazada", "todas"] } }, additionalProperties: false },
    run: (i) => json(agencia.listarAprobaciones(i)),
  }),
  betaTool({
    name: "resolver_aprobacion",
    description: "Aprueba o rechaza un punto de la bandeja. SOLO cuando el usuario lo decida explícitamente.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "integer" }, decision: { type: "string", enum: ["aprobada", "rechazada"] }, comentario: { type: "string" } },
      required: ["id", "decision"],
      additionalProperties: false,
    },
    run: ({ id, decision, comentario }) => json(agencia.resolverAprobacion(id, decision, comentario)),
  }),
  betaTool({
    name: "tablero_agencia",
    description: "Resumen de la agencia: clientes activos, proyectos, entregas de la semana, aprobaciones y actividad reciente.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: () => json(agencia.tablero()),
  }),
);
herramientasBase.push(
  betaTool({
    name: "abrir_seccion",
    description: "Abre una sección de la app en la pantalla del usuario (solo funciona en la app, no por WhatsApp). Úsala cuando pida ver o abrir su agenda, tareas, correo, mercados o noticias.",
    inputSchema: {
      type: "object",
      properties: { seccion: { type: "string", enum: ["inicio", "agenda", "tareas", "correo", "mercados", "agencia", "departamentos", "aprobaciones"] } },
      required: ["seccion"],
      additionalProperties: false,
    },
    run: ({ seccion }) => {
      const r = registro.getStore();
      if (r) r.abrir = seccion;
      return json({ ok: true, nota: "Se abrirá al mostrar tu respuesta." });
    },
  }),
);
const herramientas = herramientasBase.map(conRegistro);

const ACCIONES_QUE_CAMBIAN = new Set([
  "crear_tarea", "actualizar_tarea", "borrar_tarea", "crear_evento", "mover_evento", "borrar_evento",
  "crear_recordatorio", "cancelar_recordatorio", "guardar_memoria", "olvidar_memoria",
  "crear_borrador", "enviar_borrador", "lista_mercados", "temas_noticias",
  "crear_cliente", "actualizar_cliente", "crear_proyecto", "actualizar_proyecto", "encargar_a_departamento", "resolver_aprobacion",
]);

/**
 * ¿La respuesta afirma haber cambiado algo en la agenda?
 * Se usa para detectar cuando el modelo dice "listo, agendé..." sin haber llamado ninguna herramienta.
 */
export function afirmaAccion(texto) {
  return /\b(agend[ée]|envi[ée]|encargu[ée]|aprob[ée]|rechac[ée]|di de alta|anot[ée]|apunt[ée]|cre[ée]|program[ée]|cancel[ée]|borr[ée]|elimin[ée]|mov[íi]|reprogram[ée]|marqu[ée]|complet[ée]|guard[ée]|actualic[ée]|cambi[ée]|registr[ée]|qued[óo] (agendad|anotad|programad|guardad|registrad|cancelad|movid)|ya (est[áa]|qued[óo]) (agendad|anotad|programad|guardad|registrad|cancelad|movid))/i.test(texto);
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
  /((le|te) debo la verdad|(le|te) pido (una )?disculpa|pido disculpas|me disculpo|mensajes? anteriores|respuestas? anteriores|antes (le|te) (dije|asegur)|nunca lo hice|no lo hab[ií]a hecho|primera vez en esta conversaci[oó]n)/i;

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
export async function hablarConDelta(texto, canal = "app", archivos = [], info = {}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return "Ay, todavía no tengo cerebro conectado. Falta poner la clave de Claude (ANTHROPIC_API_KEY) en la configuración y quedo lista.";
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
  // Para la app: si cambió algo de verdad, suena el tono de "acción hecha".
  info.hizoCambio = acciones.some((a) => ACCIONES_QUE_CAMBIAN.has(a.nombre) && a.ok);
  if (acciones.abrir) info.abrir = acciones.abrir;
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
  if (final.stop_reason === "refusal") return "Uy, con eso no te puedo ayudar. ¿Lo vemos de otra forma?";
  const texto = final.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  return texto || "Mmm, ahí no tengo nada más que agregar.";
}
