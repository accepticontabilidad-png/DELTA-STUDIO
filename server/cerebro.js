// El cerebro de DELTA: un agente Claude con herramientas para manejar la agenda.
import Anthropic from "@anthropic-ai/sdk";
import { AsyncLocalStorage } from "node:async_hooks";
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { db, getAjuste, setAjuste } from "./db.js";
import * as agenda from "./agenda.js";
import { bloquesDeArchivo, infoArchivo, listarArchivos } from "./archivos.js";
import { ahoraLocalISO, zonaHoraria, utcALocal } from "./tiempo.js";
import * as correo from "./correo.js";
import * as mercados from "./mercados.js";
import * as noticias from "./noticias.js";
import * as agencia from "./agencia.js";
import * as finanzas from "./finanzas.js";
import * as paidmedia from "./paidmedia.js";
import * as contenido from "./contenido.js";
import * as reportes from "./reportes.js";
import * as tendencias from "./tendencias.js";
import * as seo from "./seo.js";
import * as crm from "./crm.js";
import * as meta from "./meta.js";
import { DEPARTAMENTOS, encargar } from "./departamentos.js";
import * as mac from "./mac.js";

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
- En la PC hay un menú a la izquierda con secciones: Inicio (tú: el orbe y la conversación, y a la derecha el resumen de Hoy con próximas citas, pendientes, mercados y avisos), Agenda, Tareas, Correo, Mercados y noticias, y la parte de Agencia: Panel general (de un vistazo: clientes activos, cuántas cosas esperan su aprobación, gasto en anuncios del mes contra el tope, alertas del día, salud de la cartera en verde/amarillo/rojo, gasto por cliente, próximas entregas, juntas con clientes y actividad de los departamentos), Cuentas (una ficha por cliente con su semáforo de salud y los motivos, entregas, próximas juntas, gasto en anuncios por plataforma y lo que espera aprobación; ahí se dan de alta clientes, se agendan juntas y se anota el gasto), Departamentos (una tarjeta por departamento con sus trabajos y un cuadro para encargarles algo), Estudio de diseño (los carruseles, posts, historias y videos que hizo Diseño, para verlos y descargarlos) y Aprobaciones (aprobar o rechazar con un toque). En el celular hay una barra abajo con Inicio, Agenda, Tareas, Correo y "Más" (abre el menú completo). Desde cualquier sección, el botón redondo con tu logo abajo a la derecha regresa a hablar contigo.
- Agenda: es un calendario con tres vistas: "Día" y "Semana" (por horas) y "Mes" (cuadrícula con las citas dentro de cada día). Flechas para avanzar o retroceder y "Hoy". Tocar un día del mes abre ese día; tocar una cita muestra su detalle y permite borrarla; tocar una hora vacía abre "Agregar" con esa hora. Botón "+ Agregar" para crear cita, tarea o recordatorio a mano.
- Correo: dos bandejas separadas, una pestaña para Gmail y otra para Hotmail, cada una con sus correos recientes, y botón "Resumir con DELTA". Al tocar un correo se abre completo con "Responder" (él mismo escribe y envía, con doble toque para confirmar) y "Que DELTA lo conteste" (te lo pide a ti: prepara el borrador y espera su confirmación). Con "+ Redactar" escribe un correo nuevo desde Gmail o Hotmail. En Inicio, la tarjeta de Correo también muestra las dos cuentas por separado. Mercados y noticias: un solo tablero con arriba los índices principales; un globo terráqueo que gira con puntos en los lugares donde hay noticias (al tocar uno se ven sus titulares) y arcos desde México; su lista de bolsa con líneas de tendencia; el "Resumen de la situación" que tú preparas cada pocas horas con los titulares (se puede escuchar o actualizar); una gráfica de velas del símbolo elegido (hoy, 5 días, 1, 3 y 6 meses, 1 y 5 años) con volumen y promedio de 20; barras con el cambio del día, una dona de cuántos suben y bajan, lo que más se mueve y el rango de 52 semanas; videos recientes de noticieros (N+, Milenio, CNN, DW, BBC, Euronews) que se ven ahí mismo; y los titulares de sus temas. Botones "Analizar bolsa" y "Platicar noticias".
- Archivos: junto a donde se escribe hay un clip 📎 para adjuntar fotos (en el celular también la cámara), PDF, Word (.docx), Excel (.xlsx), CSV o texto, hasta 10 MB cada uno y 5 por mensaje. Tú los lees y analizas. Se guardan en privado.
- Pantalla Tareas: lista de pendientes; se marcan como hechas con la casilla y se agregan escribiendo arriba.
- Botón de engranaje ⚙ (arriba a la derecha): conexiones activas, zona horaria, hora del resumen diario, respuestas en voz alta, manos libres, activar avisos en el equipo, instalar la app, conectar o desconectar Gmail y Hotmail, empezar conversación nueva y cerrar sesión.
- Para hablar contigo: tocar el orbe o el micrófono.

Lo que puedes hacer hoy (sus actividades diarias). Las redes y anuncios de Meta de sus clientes los ves con redes_cliente (TikTok y Google todavía no están conectados; si te piden eso, explica que llegará pronto).
- Tareas: crear, listar, completar, cambiar y borrar.
- Calendario: agendar citas y reuniones, moverlas, consultarlas.
- Recordatorios y avisos: programar avisos a una hora concreta, únicos o repetidos.
- Archivos: cuando el usuario adjunte algo, léelo con cuidado y responde a lo que pide (resumir, analizar números, revisar un contrato, describir una foto, sacar fechas para agendar…). Si no dice qué quiere, da un resumen breve y pregunta qué necesita. Si te pregunta por un archivo anterior que ya no tienes a la vista, usa leer_archivo con el id que aparece en "[Adjuntó: …]".
- Memoria: cuando el usuario te cuente algo que valga la pena recordar a futuro (nombres de clientes, preferencias, datos de su negocio), guárdalo con guardar_memoria.
- Correo (Gmail y Hotmail): el usuario tiene dos cuentas. Puedes buscar y leer sus correos en las dos a la vez o en una sola, resumirlos, separar lo urgente, sacar citas y tareas de ellos, y escribir borradores de respuesta. Al usuario le gustan SEPARADAS: los resultados vienen agrupados por cuenta y así debes presentarlos siempre, primero lo de Gmail y luego lo de Hotmail (o solo la que pida), sin mezclarlas. Para buscar usa la sintaxis de Gmail (is:unread, from:, subject:, newer_than:2d, has:attachment…); para Hotmail se traduce sola. Al responder un correo, el borrador sale de la misma cuenta que lo recibió. Si una cuenta no está conectada, dile que la conecte en Ajustes ⚙ → "Conectar Gmail" o "Conectar Hotmail".
- Enviar correos: NUNCA envíes sin permiso. Primero crea el borrador con crear_borrador y muéstrale al usuario a quién va, el asunto y el texto. Solo usa enviar_borrador cuando, en un mensaje posterior, el usuario diga claramente que lo envíes. El sistema bloquea enviar un borrador creado en el mismo turno.
- Bolsa y mercados: cotizaciones de su lista de seguimiento (índices, acciones, dólar, cripto), cómo van en el día, el mes o el año, y alertas cuando algo se mueve fuerte. Puede agregar o quitar símbolos de su lista; si no sabes el símbolo, búscalo con buscar_simbolo. Las acciones de la Bolsa Mexicana terminan en .MX (ej. WALMEX.MX).
- Ideas de inversión: cuando pida ideas, usa analizar_accion y noticias para dar un análisis informativo (tendencia, rango del año, noticias que la mueven, riesgos). Presenta siempre ventajas y riesgos, recuerda en una frase corta que es información y no asesoría financiera, y sugiere diversificar. Nunca prometas rendimientos. No puedes comprar ni vender nada.
- Noticias: titulares del día por tema (sus temas guardados o cualquier otro). Puede agregar o quitar temas. Al resumir noticias, menciona la fuente.

La agencia (eres su directora):
- Llevas la ficha de cada cliente (crear_cliente, ver_cliente, actualizar_cliente) y sus proyectos con fecha de entrega (crear_proyecto, actualizar_proyecto). Cuando el usuario mencione un cliente nuevo, ofrécete a darlo de alta.
- Tienes ${DEPARTAMENTOS.length} departamentos, cada uno es un especialista: ${DEPARTAMENTOS.map((d) => `${d.nombre} (${d.id}): ${d.resumen}`).join(" | ")}.
- Para trabajo de agencia (investigar tendencias, plan de estrategia, copys, guiones de video, calendario editorial, plan de pauta, SEO, reporte, cotización…) usa encargar_a_departamento con un encargo claro y completo (objetivo, cliente, formato de entrega, fechas). Si toca a varios departamentos, haz un encargo a cada uno. Los departamentos trabajan en segundo plano: responde al usuario que ya lo encargaste y que le avisarás cuando esté; no esperes ni inventes el resultado.
- Para ver lo que entregaron usa ver_trabajos y leer_trabajo, y resume lo importante.
- Diseño (diseno) entrega piezas TERMINADAS en imagen: carruseles, posts, historias, portadas y, con Higgsfield conectado, imágenes y videos con IA. Cuando pidan "hazme un carrusel/post/historia/video", encárgaselo a Diseño (con el tema, el cliente y el estilo). Al terminar, las piezas aparecen en el Estudio de diseño para descargarlas.
- Aprobaciones: los departamentos dejan en la bandeja lo que tiene que salir de la agencia o cuesta dinero. Solo usa resolver_aprobacion cuando el usuario diga claramente que aprueba o rechaza ese punto. Aprobar todavía no publica ni envía nada solo (Meta y WhatsApp se conectan al final): queda aprobado y listo para usarse.
- Pantallas de la agencia: Panel general (Pulso, resumen y alertas del día), Finanzas (cobros, gastos, utilidad), Paid media (anuncios, costo por contacto y retorno), Contenido (piezas por etapa), Tendencias (lo viral del nicho e ideas), SEO y web (sitio y Google), CRM (prospectos y embudo), Analítica (reporte mensual de cada cliente), Cuentas (ficha y semáforo de cada cliente), Departamentos (tarjetas con su trabajo) y Aprobaciones.
- Delta Score: calificación de 0 a 100 por cliente (80+ Excelente, 65-79 Saludable, 50-64 Atención, menos de 50 En riesgo). Junta Entregas (25), Pagos (20), Anuncios con tope y resultados (20), Redes con seguidores y publicaciones de Meta (20) y Seguimiento (15: aprobaciones detenidas y movimiento); lo que no tiene datos no cuenta. Un cliente en rojo no pasa de 49 y en amarillo no pasa de 64 (el color del semáforo y el de la calificación siempre coinciden). Viene en ver_cliente (score.partes con la nota de cada parte) y en tablero_agencia (score_clientes, del más bajo al más alto). Cuando pregunten "cómo va" un cliente, da su calificación y di qué parte la baja y qué haría subirla.
- Salud de cada cliente (semáforo): rojo si tiene entregas atrasadas, los anuncios se pasaron del tope o un pago lleva más de 30 días de retraso; amarillo si una entrega vence en menos de 2 días, un pago lleva más de 7 días de retraso, su Delta Score baja de 65 (rojo si baja de 50), algo espera aprobación más de 2 días, los anuncios van arriba del 85 % del tope o lleva un mes sin movimiento; si no, verde. El dueño puede marcarla a mano (salud_manual) con una nota. Cuando pregunte cómo van sus clientes, usa tablero_agencia o ver_cliente y explica los motivos en palabras sencillas.
- Meta (Facebook, Instagram y anuncios de los clientes): se conecta en Ajustes ⚙ → "Conectar Meta". Ya conectado, DELTA lee sola cada 6 horas los seguidores, alcance y publicaciones de las páginas e Instagram de cada cliente, y el gasto y resultados de sus cuentas de anuncios; el gasto de Meta se anota solo (no uses registrar_gasto_anuncios para Meta salvo que Meta no esté conectado). Para hablar de las redes o los anuncios de un cliente usa redes_cliente; si los números son viejos o pide lo más reciente, usa actualizar_meta. Si una página o cuenta no está asignada al cliente correcto, usa asignar_meta. Tú solo LEES: no publicas ni cambias campañas. Para crear una campaña, pausarla o cambiar su presupuesto, dile que en Paid media están "+ Crear campaña" y los botones de cada campaña: DELTA arma la campaña (estrategia, textos e imagen), la sube a Meta en pausa y él la enciende con un toque.
- Finanzas de la agencia (pantalla Finanzas): lo que cobra a cada cliente, quién debe, los gastos de la agencia, la utilidad y el margen. La mensualidad de cada cliente es su presupuesto_mensual; DELTA crea sola un cobro "Mensualidad" por cliente activo cada mes que vence en su dia_pago (5 si no se dijo). Cuando el usuario diga que un cliente ya pagó, usa marcar_pagado. Para cobros extra (un proyecto, una sesión de fotos) usa registrar_cobro; para gastos de la agencia (nómina, programas, renta, contador…) usa registrar_gasto_agencia, con fijo=true si se repite cada mes. Lo que el cliente invierte en anuncios NO es gasto de la agencia. Para "cómo van las finanzas", "quién me debe" o "cuánto gané" usa finanzas_agencia. Solo con cifras que dé el usuario: nunca inventes montos.
- Reporte mensual (pantalla Analítica): para "prepárame el reporte de Kardia" usa reporte_cliente (por defecto el mes pasado) y cuéntalo en 3 o 4 frases. Para dejarlo listo usa compartir_reporte (mensaje de la agencia, mostrar o no la calificación, crear el link). Crear el link NO es enviarlo: nunca lo mandes al cliente por tu cuenta. Si el usuario quiere enviarlo, prepara el borrador del correo con el link (crear_borrador) y espera su confirmación. Los primeros días de cada mes los reportes del mes anterior se dejan listos solos y se avisa al dueño.
- Contenido por etapas (pantalla Contenido): cada pieza de cada cliente (reel, carrusel, post, historia…) pasa por planeado → por grabar → en edición → esperando al cliente → aprobado → publicado. "Atrasada" = no publicada y ya pasó su fecha. Usa contenido_agencia para "cómo va el contenido", crear_contenido para agregar piezas y mover_contenido cuando digan "ya grabamos el reel de Kardia", "se lo mandé al cliente", "ya lo aprobó", "ya salió" o cambien la fecha. Una pieza atrasada pone al cliente en amarillo (rojo con más de 3 días) y baja su Delta Score; esperar al cliente 2 días o más también resta.
- Tendencias (pantalla Tendencias): por cliente, lo que está funcionando en su nicho (publicaciones de sus cuentas de Instagram de referencia muy por encima de su promedio), las búsquedas de Google de hoy que tocan su tema y noticias de la semana, más ideas listas (gancho, formato, pasos). Cada lunes temprano se buscan solas. Para "qué está de moda", "dame ideas para Kardia" usa tendencias_cliente; si no hay o son viejas, buscar_tendencias. Para configurar su nicho o sus cuentas de referencia, configurar_tendencias. Para "pásala a contenido" usa usar_idea. Instagram solo deja ver cuentas de empresa o creador.
- SEO y web (pantalla SEO y web): DELTA revisa el sitio de cada cliente cada lunes (títulos, descripciones, encabezados, imágenes sin texto, si Google lo puede ver, sitemap y velocidad en celular) y avisa si un sitio no abre. Si Google está conectado para SEO, también ve visitas (Analytics) y clics y posición en Google (Search Console). Para "cómo va la web de Kardia" usa seo_cliente y empieza por lo rojo y las oportunidades "casi en primera página"; para revisar ya, revisar_sitio; para anotar su sitio, configurar_seo. Explica sin tecnicismos ("posición promedio en Google", no "avg position"). Solo lees: no cambias el sitio.
- Equipo (pantalla Equipo): personas que trabajan con el dueño y entran a DELTA con su propio usuario. Solo ven las secciones y clientes que él les permite, sus tareas y nada personal (ni a ti, ni agenda, correo, bolsa, finanzas o ajustes). Para "ponle a Sofi que…", "pídele a Sofi…" usa crear_tarea con para. Dar o quitar accesos y permisos se hace en la pantalla Equipo (abrir_seccion "equipo"); tú no creas usuarios ni claves.
- CRM y embudo (pantalla CRM): los prospectos de cada cliente (pacientes potenciales) y su embudo: nuevo → contactado → cita agendada → asistió → venta (o perdido). Llegan a mano, por el formulario público de cada cliente o por el WhatsApp del cliente si está conectado. Para "cómo va el embudo", "cuántas citas", "quién no ha recibido respuesta" usa crm_agencia y empieza por los que llevan más de un día sin respuesta. Cuando digan "entró un prospecto", usa crear_prospecto; "ya agendó", "ya vino", "compró 12 mil", "no le interesó", usa actualizar_prospecto. Ventas: se cuentan en el mes en que LLEGÓ la persona (de los que escribieron en octubre, cuántos compraron), y la tarjeta de ventas cuenta solo las de redes/anuncios (las de recomendación o de quien ya era cliente van aparte). crm_agencia trae en embudo.ventas_cerradas la lista con id, día en que llegó, día en que compró y origen. Si el dueño dice que las ventas de un mes no cuadran ("fueron 3, no 11"), dale esa lista y corrige cada una con actualizar_prospecto (por id): la que no fue venta, a su etapa real; la que no vino de redes, origen recomendado/cliente/otro;  Si no sabe cuáles son, pregúntale cuáles fueron las de redes y corrige el resto. Hazlo de verdad con la herramienta, no solo lo digas. Para escribirle a un prospecto usa borrador_whatsapp: NUNCA envías mensajes; queda como borrador y el dueño lo manda desde CRM. Di "prospectos" o "pacientes potenciales", no "leads".
- Paid media (pantalla Paid media): inversión en anuncios de cada cliente, contactos (mensajes + prospectos), costo por contacto, ventas y retorno (ROAS: pesos vendidos por cada peso invertido; 3 o más es bueno, menos de 1 pierde dinero). Los números de campañas vienen de Meta; lo que el cliente reporta (prospectos, ventas, cuánto vendió) se anota con registrar_resultados_anuncios y manda sobre Meta. Para "cómo van los anuncios", "qué campaña no sirve" o "cuánto le cuesta cada cliente" usa paid_media y empieza por los avisos rojos (campañas gastando sin resultados). Explica en palabras sencillas: "costo por contacto", no "CPL". Solo lees: no puedes apagar ni cambiar campañas; recomienda qué hacer y el dueño lo hace en Meta.
- Pulso de la agencia: para "¿qué necesita mi atención hoy?" usa pulso_agencia (clientes en rojo, pagos vencidos, entregas atrasadas, aprobaciones, topes de anuncios, tareas vencidas, juntas de hoy) y responde empezando por lo urgente.
- Gasto en anuncios de Google y TikTok: todavía no están conectados; se anota a mano con registrar_gasto_anuncios (el total que lleva en el mes por plataforma). Nunca inventes cifras de gasto ni de redes. Para una junta con un cliente, crea el evento con el campo cliente lleno.

Su Mac (app DELTA Mac, en la barra de arriba de su Mac):
- Con usar_mac manejas su Mac de verdad: abrir y cerrar aplicaciones, ver cuáles están abiertas, abrir páginas web, buscar archivos en su carpeta personal y abrirlos o mostrarlos en el Finder, escribir texto donde esté el cursor, presionar atajos de teclado, subir o bajar el volumen, crear una nota en el Escritorio y mandar un archivo a la Papelera.
- Para "ábreme el contrato de Kardia": primero buscar_archivos, luego abrir_archivo con la ruta que salió. Si salen varios parecidos, pregunta cuál.
- Lo delicado (cerrar apps, escribir, atajos, Papelera) la Mac se lo pregunta a él con un cuadro; avísale en una frase que lo confirme en la Mac. Si dice que no o nadie contesta, no se hizo: dilo así.
- Nunca borres, cierres ni escribas algo que él no pidió claramente. Nunca escribas claves ni datos de tarjetas.
- Si la Mac no está conectada o vinculada, dilo tal cual y explica que se vincula en Ajustes → Mi Mac.
- Se enciende con dos chasquidos de dedos cerca de la Mac: la app abre DELTA y te pone a escuchar.

Reglas:
- Honestidad ante todo. Solo puedes decir que hiciste algo (agendar, anotar, programar, mover, completar, borrar, guardar) si llamaste la herramienta en ESTE turno y respondió bien. Si una herramienta falla, dilo tal cual.
- Para cualquier cambio en la agenda, llama la herramienta correspondiente antes de responder. Nunca digas "listo" o "hecho" sin haberla llamado.
- En cada mensaje recibes un bloque [Agenda actual] sacado de la base de datos en ese momento: es la verdad y puedes usarlo para responder. Si necesitas algo que no está ahí (otras fechas, tareas hechas, detalles), consulta con las herramientas. No uses lo que dijiste en mensajes anteriores como fuente de datos: pudo cambiar.
- Las notas entre corchetes como [Herramientas usadas en ese turno: ...] las pone el sistema para que sepas qué se hizo de verdad antes; nunca las escribas tú.
- No te disculpes por respuestas anteriores ni hables de errores pasados a menos que el usuario lo pida. Responde solo a lo que te pregunta ahora, breve y directo.
- Nunca agregues confesiones del tipo "te debo la verdad" o "en mis mensajes anteriores...". Lo pasado ya está resuelto; no lo vuelvas a mencionar.
- No muestres ids internos al usuario salvo que los pida; refiérete a las cosas por su nombre.
- Si te piden abrir o ver una sección de la app (agenda, calendario, tareas, correo, bolsa, noticias), ábrela con abrir_seccion y responde en una frase.
- No inventes datos ni capacidades. Si te piden algo que no puedes hacer (por ejemplo controlar la casa), di claramente que aún no puedes.
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
    description: "Crea una tarea pendiente. Con 'para' se le asigna a alguien del equipo (la verá al entrar con su usuario).",
    inputSchema: {
      type: "object",
      properties: {
        titulo: { type: "string" },
        para: { type: "string", description: "Nombre o usuario de la persona del equipo a quien se le asigna. Omitir si es para el dueño." },
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
        para: { type: "string", description: "Reasignarla a alguien del equipo por nombre; 'yo' la regresa al dueño." },
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
    description: "Busca correos en sus cuentas (Gmail y Hotmail) con la sintaxis de búsqueda de Gmail. Devuelve los resultados separados por cuenta (gmail y outlook): remitente, asunto, fecha, vista previa y si está sin leer. Por defecto: las dos bandejas de entrada, últimos 2 días.",
    inputSchema: {
      type: "object",
      properties: {
        cuenta: { type: "string", enum: ["ambas", "gmail", "outlook"], description: "En qué cuenta buscar. outlook = Hotmail. Por defecto: ambas" },
        consulta: { type: "string", description: "Ej. 'is:unread newer_than:1d', 'from:cliente@acme.com', 'subject:factura'" },
        max: { type: "integer", description: "Máximo de correos (1 a 25, por defecto 10)" },
      },
      additionalProperties: false,
    },
    run: async (i) => json(await correo.buscarCorreos(i)),
  }),
  betaTool({
    name: "leer_correo",
    description: "Abre un correo completo por su id (texto y nombres de adjuntos), de cualquiera de sus cuentas.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
    run: async ({ id }) => json(await correo.leerCorreo(id)),
  }),
  betaTool({
    name: "crear_borrador",
    description: "Guarda un borrador (NO lo envía). Para responder un correo pasa responder_a con su id: sale de la misma cuenta y se toma el destinatario y el asunto del original si no los das. Para un correo nuevo, elige la cuenta (gmail u outlook = Hotmail); si no la das, se usa Gmail si está conectado.",
    inputSchema: {
      type: "object",
      properties: {
        cuenta: { type: "string", enum: ["gmail", "outlook"], description: "Desde qué cuenta, solo para correos nuevos" },
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
    description: "Envía un borrador (de Gmail o de Hotmail). Solo cuando el usuario ya vio el borrador y pidió enviarlo de forma explícita.",
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
  presupuesto_anuncios: { type: "number", description: "Tope mensual de inversión en anuncios del cliente" },
  dia_pago: { type: "integer", minimum: 1, maximum: 28, description: "Día del mes en que vence su mensualidad (5 si no se dice)" },
  salud_manual: { type: "string", enum: ["auto", "verde", "amarillo", "rojo"], description: "Solo si el dueño quiere marcar la salud a mano; auto la regresa al cálculo automático" },
  salud_nota: { type: "string", description: "Por qué se marcó así la salud" },
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
    description: "Ficha completa de un cliente: datos, Delta Score con su desglose, semáforo, proyectos, juntas, gasto en anuncios, números de Meta, trabajos recientes y aprobaciones pendientes.",
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
    description: "Panel general de la agencia: clientes activos, salud de la cartera, alertas del día, gasto en anuncios del mes, proyectos, entregas, juntas, aprobaciones y actividad reciente.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: () => json(agencia.tablero()),
  }),
  betaTool({
    name: "registrar_gasto_anuncios",
    description: "Anota cuánto lleva gastado un cliente en anuncios este mes en una plataforma (el TOTAL del mes, reemplaza la cifra anterior de esa plataforma). Solo con cifras que dé el usuario.",
    inputSchema: {
      type: "object",
      properties: {
        cliente: { type: "string", description: "Nombre o id" },
        plataforma: { type: "string", enum: ["meta", "google", "tiktok", "otra"] },
        monto: { type: "number" },
        mes: { type: "string", description: "AAAA-MM; si no se dice, el mes actual" },
      },
      required: ["cliente", "plataforma", "monto"],
      additionalProperties: false,
    },
    run: (i) => json(agencia.registrarGasto(i)),
  }),
);
herramientasBase.push(
  betaTool({
    name: "pulso_agencia",
    description: "Lo que necesita atención hoy en la agencia, contado y ordenado de lo urgente a lo informativo: clientes en rojo o amarillo, pagos vencidos o por vencer, entregas atrasadas o próximas, cosas por aprobar, anuncios pasados del tope, tareas vencidas, juntas de hoy y cuentas perdiendo seguidores.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: () => json(finanzas.pulso()),
  }),
  betaTool({
    name: "finanzas_agencia",
    description: "Finanzas de la agencia de un mes: facturado, cobrado, por cobrar y vencido, gastos, utilidad, margen, ingreso fijo mensual (MRR), ticket promedio, quién debe y cuántos días de atraso, gastos por categoría, rentabilidad por cliente e historia de 12 meses.",
    inputSchema: { type: "object", properties: { mes: { type: "string", description: "AAAA-MM; si no se dice, el mes actual" } }, additionalProperties: false },
    run: ({ mes }) => {
      const f = finanzas.finanzas(mes);
      const { categorias, cobros_mes, ...resto } = f;
      return json(resto);
    },
  }),
  betaTool({
    name: "reporte_cliente",
    description: "Reporte mensual de un cliente, en lenguaje sencillo y listo para él: logros del mes, anuncios (invertido, contactos, costo por contacto, ventas, retorno), redes (seguidores, alcance, publicaciones), contenido publicado y lo que viene, mensaje de la agencia y, si se eligió, la calificación. Dice si ya tiene link para el cliente. Sin cliente: resumen de todos (tablero de Analítica).",
    inputSchema: { type: "object", properties: { cliente: { type: "string", description: "Nombre o id" }, mes: { type: "string", description: "AAAA-MM; el mes pasado si no se dice" } }, additionalProperties: false },
    run: ({ cliente, mes }) => {
      if (!cliente) return json(reportes.analitica(mes));
      const d = reportes.datosReporte(cliente, mes);
      return json({ ...d, link: d.link ? reportes.urlCompleta(d.link) : null, score: d.con_score ? d.score : undefined });
    },
  }),
  betaTool({
    name: "compartir_reporte",
    description: "Prepara el reporte para el cliente: guarda el mensaje de la agencia (nota), elige si se muestra la calificación (con_score) y crea el link para el cliente (link=true) o lo quita (link=false). NO lo envía a nadie: para mandarlo, primero muestra el link al usuario y, solo si lo pide, prepara un borrador de correo con crear_borrador.",
    inputSchema: {
      type: "object",
      properties: {
        cliente: { type: "string" },
        mes: { type: "string", description: "AAAA-MM; el mes pasado si no se dice" },
        nota: { type: "string", description: "Mensaje de la agencia para el cliente" },
        con_score: { type: "boolean" },
        link: { type: "boolean", description: "true crea el link; false lo quita" },
      },
      required: ["cliente"],
      additionalProperties: false,
    },
    run: ({ cliente, mes, nota, con_score, link }) => {
      const r = {};
      if (nota !== undefined || con_score !== undefined) reportes.guardarReporte({ cliente, mes, nota, con_score });
      if (link === true) Object.assign(r, reportes.crearLink({ cliente, mes }));
      if (link === false) Object.assign(r, reportes.quitarLink({ cliente, mes }), { link: null });
      const d = reportes.datosReporte(cliente, mes);
      return json({ ...r, cliente: d.cliente.nombre, mes: d.nombre_mes, link: d.link ? reportes.urlCompleta(d.link) : null, nota: d.nota, con_score: d.con_score, enviado: false });
    },
  }),
  betaTool({
    name: "contenido_agencia",
    description: "Producción de contenido por etapas (planeado, por grabar, en edición, esperando al cliente, aprobado, publicado): piezas de cada etapa con su cliente, formato, red y fecha de publicación; lo atrasado, lo que lleva 2 días o más esperando al cliente, lo que sale esta semana, cuántas se publicaron este mes y qué % salió a tiempo. Con cliente, solo ese cliente.",
    inputSchema: { type: "object", properties: { cliente: { type: "string", description: "Nombre o id" }, mes: { type: "string", description: "AAAA-MM; el actual si no se dice" } }, additionalProperties: false },
    run: ({ cliente, mes }) => {
      const t = contenido.tableroContenido({ cliente, mes });
      const corto = (p) => ({ id: p.id, titulo: p.titulo, cliente: p.cliente, formato: p.formato_nombre, red: p.red_nombre, etapa: p.etapa_nombre, publicar: p.publicar, responsable: p.responsable, atrasada: p.atrasada, dias_atraso: p.dias_atraso, dias_en_etapa: p.dias_en_etapa });
      return json({ ...t, formatos: undefined, redes: undefined, etapas: t.etapas.map((e) => ({ etapa: e.nombre, n: e.piezas.length, piezas: e.piezas.slice(0, 15).map(corto) })), atrasadas: t.atrasadas.map(corto), esperando_cliente: t.esperando_cliente.map(corto), esta_semana: t.esta_semana.map(corto) });
    },
  }),
  betaTool({
    name: "crear_contenido",
    description: "Agrega una pieza de contenido de un cliente al tablero (reel, carrusel, post, historia, video, blog). Empieza en 'planeado' si no se dice otra etapa.",
    inputSchema: {
      type: "object",
      properties: {
        cliente: { type: "string", description: "Nombre o id" },
        titulo: { type: "string" },
        formato: { type: "string", enum: Object.keys(contenido.FORMATOS) },
        red: { type: "string", enum: Object.keys(contenido.REDES) },
        etapa: { type: "string", enum: contenido.ETAPAS.map((e) => e.clave) },
        publicar: { type: "string", description: "AAAA-MM-DD: cuándo debe salir" },
        responsable: { type: "string" },
        notas: { type: "string" },
      },
      required: ["cliente", "titulo"],
      additionalProperties: false,
    },
    run: (i) => json(contenido.crearContenido(i)),
  }),
  betaTool({
    name: "mover_contenido",
    description: "Cambia una pieza de contenido: su etapa (planeado, grabar, edicion, cliente = esperando al cliente, aprobado, publicado), su fecha de publicación u otros datos. Encuéntrala por id o por parte del título (y cliente). borrar=true la quita.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "integer" },
        titulo: { type: "string", description: "Parte del título para encontrarla" },
        cliente: { type: "string", description: "Nombre o id, ayuda a encontrarla" },
        etapa: { type: "string", enum: contenido.ETAPAS.map((e) => e.clave) },
        publicar: { type: "string", description: "Nueva fecha AAAA-MM-DD" },
        nuevo_titulo: { type: "string" },
        responsable: { type: "string" },
        notas: { type: "string" },
        enlace: { type: "string" },
        borrar: { type: "boolean" },
      },
      additionalProperties: false,
    },
    run: ({ id, titulo, cliente, borrar, nuevo_titulo, ...cambios }) => {
      const p = contenido.buscarContenido({ id, titulo, cliente });
      if (borrar) return json(contenido.borrarContenido(p.id));
      return json(contenido.actualizarContenido(p.id, { ...cambios, ...(nuevo_titulo ? { titulo: nuevo_titulo } : {}) }));
    },
  }),
  betaTool({
    name: "paid_media",
    description: "Tablero de Paid media de un mes: inversión en anuncios por cliente y total, contactos (mensajes + prospectos), costo por contacto, ventas, lo vendido y retorno (ROAS = pesos vendidos por cada peso invertido), campañas de Meta con sus resultados de este mes y de los últimos 7 días, y avisos (campañas que gastan sin resultados, costo muy alto, público cansado, retorno bajo, topes). Con cliente, solo ese cliente.",
    inputSchema: { type: "object", properties: { mes: { type: "string", description: "AAAA-MM; el actual si no se dice" }, cliente: { type: "string", description: "Nombre o id, para ver solo ese cliente" } }, additionalProperties: false },
    run: ({ mes, cliente }) => {
      if (cliente) return json(paidmedia.paidMediaCliente(agencia.clienteRequerido(cliente), mes || undefined));
      const { umbrales, ...p } = paidmedia.paidMedia(mes);
      return json({ ...p, campanas: p.campanas.slice(0, 20) });
    },
  }),
  betaTool({
    name: "registrar_resultados_anuncios",
    description: "Anota lo que un cliente reporta que le dejaron sus anuncios en un mes: prospectos (mensajes o interesados que llegaron), ventas cerradas y cuánto vendió. Manda sobre lo que mide Meta. Lo que no se diga se queda como estaba. Solo con cifras que dé el usuario.",
    inputSchema: {
      type: "object",
      properties: {
        cliente: { type: "string", description: "Nombre o id" },
        mes: { type: "string", description: "AAAA-MM; el actual si no se dice" },
        prospectos: { type: "integer" },
        ventas: { type: "integer" },
        valor_ventas: { type: "number", description: "Cuánto vendió por los anuncios" },
        nota: { type: "string" },
      },
      required: ["cliente"],
      additionalProperties: false,
    },
    run: (i) => json(paidmedia.registrarResultados(i)),
  }),
  betaTool({
    name: "marcar_pagado",
    description: "Marca que un cliente ya pagó. Con id marca ese cobro; con cliente marca su cobro pendiente más viejo. pagado = fecha AAAA-MM-DD (hoy si no se dice) o false para regresarlo a pendiente.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "integer", description: "Id del cobro" }, cliente: { type: "string", description: "Nombre o id del cliente" }, pagado: { anyOf: [{ type: "string" }, { type: "boolean" }], description: "AAAA-MM-DD, true (hoy) o false (no ha pagado)" } },
      additionalProperties: false,
    },
    run: ({ id, cliente, pagado = true }) => {
      if (!id && !cliente) throw new Error("Dime qué cliente pagó o el número de cobro");
      const cobro = id ? finanzas.obtenerCobro(id) : finanzas.cobroPendienteDe(cliente);
      if (!cobro) throw new Error(`No existe el cobro ${id}`);
      return json(finanzas.marcarPagado(cobro.id, pagado));
    },
  }),
  betaTool({
    name: "registrar_cobro",
    description: "Anota un cobro EXTRA a un cliente (un proyecto, una sesión de fotos…). Las mensualidades se crean solas; no las anotes aquí. Solo con cifras que dé el usuario.",
    inputSchema: {
      type: "object",
      properties: {
        cliente: { type: "string", description: "Nombre o id" },
        concepto: { type: "string" },
        monto: { type: "number" },
        mes: { type: "string", description: "AAAA-MM al que corresponde; el actual si no se dice" },
        vence: { type: "string", description: "AAAA-MM-DD; si no se dice, su día de pago" },
        pagado: { type: "string", description: "AAAA-MM-DD si ya lo pagó" },
      },
      required: ["cliente", "concepto", "monto"],
      additionalProperties: false,
    },
    run: (i) => json(finanzas.registrarCobro(i)),
  }),
  betaTool({
    name: "registrar_gasto_agencia",
    description: "Anota un gasto de la AGENCIA (no el gasto en anuncios de un cliente). fijo=true si se repite cada mes (nómina, programas, renta). cliente solo si el gasto fue por ese cliente (cuenta en su rentabilidad).",
    inputSchema: {
      type: "object",
      properties: {
        concepto: { type: "string" },
        monto: { type: "number" },
        categoria: { type: "string", enum: Object.keys(finanzas.CATEGORIAS) },
        fecha: { type: "string", description: "AAAA-MM-DD; hoy si no se dice" },
        fijo: { type: "boolean" },
        cliente: { type: "string", description: "Nombre o id, solo si fue por un cliente" },
      },
      required: ["concepto", "monto"],
      additionalProperties: false,
    },
    run: (i) => json(finanzas.registrarGastoAgencia(i)),
  }),
);
herramientasBase.push(
  betaTool({
    name: "redes_cliente",
    description: "Números de Meta de un cliente (de la última actualización): seguidores de Facebook e Instagram y cuánto cambiaron, alcance de 28 días, publicaciones e interacciones del mes, su mejor publicación, y de sus anuncios el gasto del mes, alcance, clics, conversaciones, prospectos, compras y campañas activas.",
    inputSchema: { type: "object", properties: { cliente: { type: "string", description: "Nombre o id" } }, required: ["cliente"], additionalProperties: false },
    run: ({ cliente }) => {
      const c = agencia.clienteRequerido(cliente);
      return json(agencia.metaDeCliente(c.id) || { nota: `${c.nombre} no tiene páginas, Instagram ni cuentas de anuncios de Meta asignadas. Se asignan en Cuentas → Meta.` });
    },
  }),
  betaTool({
    name: "actualizar_meta",
    description: "Pide a Meta los números más recientes. Con cliente, solo los de ese cliente (rápido); sin cliente, busca páginas y cuentas nuevas y actualiza a todos.",
    inputSchema: { type: "object", properties: { cliente: { type: "string", description: "Nombre o id (opcional)" } }, additionalProperties: false },
    run: async ({ cliente }) => {
      if (!meta.metaConectado()) throw new Error("Meta no está conectado. Se conecta en Ajustes ⚙ → Conectar Meta.");
      if (cliente) {
        const c = agencia.clienteRequerido(cliente);
        await meta.sincronizarCliente(c.id);
        return json(agencia.metaDeCliente(c.id));
      }
      return json(await meta.actualizarTodo());
    },
  }),
  betaTool({
    name: "asignar_meta",
    description: "Dice de qué cliente es una página de Facebook, un Instagram o una cuenta de anuncios de Meta (o la quita con cliente vacío). Sin datos, lista lo que hay y a quién está asignado.",
    inputSchema: {
      type: "object",
      properties: {
        activo: { type: "string", description: "id (act_…, page:…, ig:…) o nombre de la página/cuenta" },
        cliente: { type: "string", description: "Nombre o id del cliente; vacío para quitarla" },
      },
      additionalProperties: false,
    },
    run: ({ activo, cliente }) => {
      const e = meta.estado();
      if (!activo) return json(e.activos.map(({ id, tipo_nombre, nombre, cliente }) => ({ id, tipo: tipo_nombre, nombre, cliente })));
      const t = String(activo).toLowerCase();
      const a = e.activos.find((x) => x.id === activo) || e.activos.find((x) => x.nombre.toLowerCase() === t) || e.activos.find((x) => x.nombre.toLowerCase().includes(t));
      if (!a) throw new Error(`No encuentro "${activo}" entre lo conectado de Meta`);
      return json(meta.ligar(a.id, cliente || null));
    },
  }),
);
herramientasBase.push(
  betaTool({
    name: "tendencias_cliente",
    description: "Tendencias del nicho de un cliente: publicaciones de sus cuentas de Instagram de referencia que están funcionando muy por encima de lo normal (veces = cuántas veces su promedio), búsquedas de Google de hoy que tocan su tema, noticias de la semana y las ideas de contenido ya preparadas (gancho, formato, pasos). Sin cliente: lo que México busca hoy y cuántas ideas nuevas tiene cada cliente.",
    inputSchema: { type: "object", properties: { cliente: { type: "string", description: "Nombre o id" } }, additionalProperties: false },
    run: async ({ cliente }) => json(cliente ? tendencias.tendenciasCliente(cliente) : await tendencias.tableroTendencias()),
  }),
  betaTool({
    name: "configurar_tendencias",
    description: "Guarda los temas del nicho de un cliente (palabras: 'cardiología', 'colesterol', 'salud del corazón') y sus cuentas de Instagram de referencia (competencia o creadores del nicho, sin @; deben ser de empresa o creador). Lo que no se pase se queda igual.",
    inputSchema: {
      type: "object",
      properties: { cliente: { type: "string" }, palabras: { type: "array", items: { type: "string" }, description: "Hasta 6" }, cuentas: { type: "array", items: { type: "string" }, description: "Hasta 8 usuarios de Instagram" } },
      required: ["cliente"],
      additionalProperties: false,
    },
    run: (x) => json(tendencias.configurarTendencias(x)),
  }),
  betaTool({
    name: "buscar_tendencias",
    description: "Busca ahora mismo lo que se está moviendo en el nicho de un cliente (Instagram, Google y noticias) y prepara ideas nuevas. Tarda unos 20 a 40 segundos. Úsala solo si la piden o si las tendencias del cliente tienen más de una semana.",
    inputSchema: { type: "object", properties: { cliente: { type: "string" } }, required: ["cliente"], additionalProperties: false },
    run: async ({ cliente }) => json(await tendencias.buscarTendencias(cliente)),
  }),
  betaTool({
    name: "usar_idea",
    description: "Pasa una idea de Tendencias al tablero de Contenido (queda como 'planeado', con el gancho y los pasos en las notas), o la descarta (descartar=true). Busca la idea por parte de su título.",
    inputSchema: {
      type: "object",
      properties: { titulo: { type: "string" }, cliente: { type: "string" }, publicar: { type: "string", description: "AAAA-MM-DD, opcional" }, descartar: { type: "boolean" } },
      required: ["titulo"],
      additionalProperties: false,
    },
    run: ({ titulo, cliente, publicar, descartar }) => {
      const i = tendencias.buscarIdea({ titulo, cliente });
      return json(descartar ? { descartada: i.titulo, ...tendencias.descartarIdea(i.id) } : tendencias.ideaAContenido(i.id, { publicar }));
    },
  }),
);
herramientasBase.push(
  betaTool({
    name: "seo_cliente",
    description: "SEO y web de un cliente: calificación del sitio (0-100), si abre, velocidad en celular, páginas por mejorar con qué hacer; y si Google está conectado, visitas (Analytics), clics y posición promedio en Google (Search Console) de los últimos 28 días contra los 28 anteriores, búsquedas que más traen, búsquedas 'casi en primera página' (oportunidades) y páginas que perdieron clics. Sin cliente: resumen de todos.",
    inputSchema: { type: "object", properties: { cliente: { type: "string" } }, additionalProperties: false },
    run: async ({ cliente }) => json(cliente ? await seo.seoCliente(cliente) : await seo.tableroSeo()),
  }),
  betaTool({
    name: "revisar_sitio",
    description: "Revisa ahora el sitio web de un cliente (hasta 10 páginas y la velocidad en celular). Tarda de 20 segundos a un minuto. Úsala si la piden o si la última revisión tiene más de una semana.",
    inputSchema: { type: "object", properties: { cliente: { type: "string" } }, required: ["cliente"], additionalProperties: false },
    run: async ({ cliente }) => json(await seo.revisarSitio(cliente)),
  }),
  betaTool({
    name: "configurar_seo",
    description: "Guarda el sitio web de un cliente y, si se sabe, su propiedad de Search Console (sc-domain:dominio.mx o https://dominio.mx/) y su propiedad de Google Analytics (número). Lo que no se pase se queda igual.",
    inputSchema: {
      type: "object",
      properties: { cliente: { type: "string" }, sitio: { type: "string" }, gsc_sitio: { type: "string" }, ga4_propiedad: { type: "string" } },
      required: ["cliente"],
      additionalProperties: false,
    },
    run: (x) => json(seo.configurarSeo(x)),
  }),
);
herramientasBase.push(
  betaTool({
    name: "crm_agencia",
    description: "CRM de prospectos de los clientes y su embudo del mes (prospectos → contactados → cita → asistieron → compraron), con porcentajes, valor vendido, tiempo de respuesta, costo por prospecto/cita/venta (con la inversión en anuncios) y de dónde llegan. Incluye quién lleva más de un día sin respuesta, citas de hoy y citas pasadas sin confirmar si asistió. Con nombre o teléfono: la ficha de ese prospecto con su historial y mensajes.",
    inputSchema: {
      type: "object",
      properties: { cliente: { type: "string" }, mes: { type: "string", description: "AAAA-MM" }, prospecto: { type: "string", description: "Nombre o teléfono de un prospecto" } },
      additionalProperties: false,
    },
    run: ({ cliente, mes, prospecto }) => {
      if (prospecto) {
        const p = crm.buscarProspecto(/\d{7,}/.test(prospecto.replace(/\D/g, "")) ? { telefono: prospecto, cliente } : { nombre: prospecto, cliente });
        return json(crm.fichaProspecto(p.id));
      }
      const t = crm.tableroCrm({ cliente, mes });
      const corto = (p) => ({ nombre: p.nombre, cliente: p.cliente, etapa: p.etapa_nombre, fuente: p.fuente_nombre, cita: p.cita, horas_esperando: p.horas_esperando });
      return json({ embudo: t.embudo, embudo_mes_anterior: { mes: t.embudo_anterior.mes, prospectos: t.embudo_anterior.prospectos, ventas: t.embudo_anterior.ventas, cierre_pct: t.embudo_anterior.cierre_pct },
        sin_responder: t.sin_responder.map(corto), citas_hoy: t.citas_hoy.map(corto), citas_pasadas: t.citas_pasadas.map(corto),
        abiertos: t.etapas.filter((e) => !["venta", "perdido"].includes(e.clave)).map((e) => ({ etapa: e.nombre, n: e.prospectos.length })), borradores_pendientes: t.borradores.length });
    },
  }),
  betaTool({
    name: "crear_prospecto",
    description: "Agrega un prospecto (persona interesada) al CRM de un cliente. Si ya existe con ese teléfono, no lo duplica.",
    inputSchema: {
      type: "object",
      properties: {
        cliente: { type: "string" }, nombre: { type: "string" }, telefono: { type: "string" }, correo: { type: "string" },
        fuente: { type: "string", description: "anuncios, whatsapp, instagram, facebook, google, web, referido, llamada u otra" },
        interes: { type: "string", description: "Qué servicio le interesa" }, notas: { type: "string" },
        etapa: { type: "string" }, cita: { type: "string", description: "AAAA-MM-DDTHH:MM hora local" }, valor: { type: "number" },
      },
      required: ["cliente"],
      additionalProperties: false,
    },
    run: (x) => json(crm.crearProspecto(x)),
  }),
  betaTool({
    name: "actualizar_prospecto",
    description: "Cambia la etapa de un prospecto (contactado, cita, asistió, venta, perdido), su cita, cuánto compró (valor), el motivo si se perdió, de dónde salió (origen) y el día en que compró (venta_fecha), o agrega una nota. Se busca por id, nombre o teléfono. Ej.: 'Laura de Kardia ya agendó para el jueves a las 5', 'Pedro compró 12 mil', 'Lalo no fue venta de redes, ya era cliente' (origen cliente), 'esa venta fue en octubre' (venta_fecha). Para quitar una venta que no fue, pásalo a la etapa en la que de verdad está (normalmente contactado).",
    inputSchema: {
      type: "object",
      properties: {
        prospecto: { type: "string", description: "Nombre o teléfono (o el id de la lista de ventas)" }, id: { type: "integer", description: "id del prospecto, si lo tienes de la lista de ventas" }, cliente: { type: "string" },
        origen: { type: "string", enum: ["anuncio", "redes", "recomendado", "cliente", "otro"], description: "De dónde salió: recomendado o cliente (ya era cliente) NO cuentan como venta de redes; anuncio, redes u otro sí (si llegó por chat de redes)" },
        venta_fecha: { type: "string", description: "AAAA-MM-DD: día en que compró" },
        etapa: { type: "string" }, cita: { type: "string", description: "AAAA-MM-DDTHH:MM hora local" }, valor: { type: "number" },
        motivo_perdido: { type: "string" }, interes: { type: "string" }, nota: { type: "string" },
      },
      additionalProperties: false,
    },
    run: ({ prospecto, id, cliente, nota, ...cambios }) => {
      if (!id && /^#?\d{1,6}$/.test(String(prospecto || "").trim())) id = Number(String(prospecto).replace("#", ""));
      const p = id ? crm.buscarProspecto({ id }) : crm.buscarProspecto(/\d{7,}/.test(String(prospecto || "").replace(/\D/g, "")) ? { telefono: prospecto, cliente } : { nombre: prospecto, cliente });
      if (nota) crm.notaProspecto(p.id, nota);
      return json(Object.keys(cambios).length ? crm.actualizarProspecto(p.id, cambios) : crm.obtenerProspecto(p.id));
    },
  }),
  betaTool({
    name: "borrador_whatsapp",
    description: "Prepara un mensaje de WhatsApp para un prospecto y lo deja como BORRADOR en su ficha del CRM. NO lo envía: el dueño lo revisa y lo manda él desde la pantalla CRM (o con el link que abre WhatsApp). Si no das texto, DELTA lo redacta según la etapa y la conversación.",
    inputSchema: {
      type: "object",
      properties: { prospecto: { type: "string" }, cliente: { type: "string" }, texto: { type: "string" }, indicacion: { type: "string", description: "Qué debe decir, si no das el texto" } },
      required: ["prospecto"],
      additionalProperties: false,
    },
    run: async ({ prospecto, cliente, texto, indicacion }) => {
      const p = crm.buscarProspecto(/\d{7,}/.test(prospecto.replace(/\D/g, "")) ? { telefono: prospecto, cliente } : { nombre: prospecto, cliente });
      return json({ ...(texto ? crm.guardarBorrador(p.id, texto) : await crm.sugerirMensaje(p.id, { indicacion })), nota: "Quedó como borrador. No se ha enviado: el dueño lo manda desde CRM." });
    },
  }),
);
herramientasBase.push(
  betaTool({
    name: "usar_mac",
    description:
      "Maneja la Mac del dueño a través de la app DELTA Mac. Acciones: " +
      Object.entries(mac.ACCIONES).map(([k, v]) => `${k}: ${v.texto}${v.riesgo ? " [se confirma en la Mac]" : ""}`).join("; ") +
      ". Devuelve lo que hizo la Mac o el motivo por el que no se pudo.",
    inputSchema: {
      type: "object",
      properties: {
        accion: { type: "string", enum: Object.keys(mac.ACCIONES) },
        app: { type: "string", description: "Nombre de la aplicación (abrir_app, cerrar_app)" },
        url: { type: "string", description: "Dirección https (abrir_url)" },
        consulta: { type: "string", description: "Qué buscar (buscar_archivos): parte del nombre o palabras del contenido" },
        ruta: { type: "string", description: "Ruta completa del archivo o carpeta (abrir_archivo, mostrar_en_finder, mover_a_papelera)" },
        texto: { type: "string", description: "Texto a escribir (escribir_texto) o contenido de la nota (crear_nota)" },
        titulo: { type: "string", description: "Nombre de la nota (crear_nota)" },
        teclas: { type: "string", description: "Atajo, ej. 'cmd+c', 'cmd+shift+4', 'enter', 'esc' (atajo_teclado)" },
        nivel: { type: "number", description: "Volumen de 0 a 100 (volumen); 0 silencia" },
      },
      required: ["accion"],
      additionalProperties: false,
    },
    run: async ({ accion, ...datos }) => json({ ok: true, resultado: await mac.pedir(accion, datos) }),
  }),
  betaTool({
    name: "abrir_seccion",
    description: "Abre una sección de la app en la pantalla del usuario (solo funciona en la app, no por WhatsApp). Úsala cuando pida ver o abrir su agenda, tareas, correo, mercados o noticias.",
    inputSchema: {
      type: "object",
      properties: { seccion: { type: "string", enum: ["inicio", "agenda", "tareas", "correo", "mercados", "agencia", "finanzas", "paidmedia", "contenido", "tendencias", "seo", "crm", "equipo", "analitica", "cuentas", "departamentos", "estudio", "aprobaciones"] } },
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
  "crear_cliente", "actualizar_cliente", "registrar_gasto_anuncios", "crear_proyecto", "actualizar_proyecto", "encargar_a_departamento", "resolver_aprobacion",
  "asignar_meta", "marcar_pagado", "registrar_cobro", "registrar_gasto_agencia", "registrar_resultados_anuncios", "crear_contenido", "mover_contenido", "compartir_reporte",
  "configurar_tendencias", "buscar_tendencias", "usar_idea", "configurar_seo", "revisar_sitio",
  "crear_prospecto", "actualizar_prospecto", "borrador_whatsapp", "usar_mac",
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
