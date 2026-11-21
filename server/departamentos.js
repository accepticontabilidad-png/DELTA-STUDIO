// Los departamentos de la agencia: cada uno es un agente Claude especialista.
// DELTA (el director) les encarga trabajo; corren en segundo plano para que el chat nunca espere,
// y lo que haya que enviar, publicar, gastar o facturar lo dejan en la bandeja de Aprobaciones.
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import * as agencia from "./agencia.js";
import * as noticias from "./noticias.js";
import * as habilidades from "./habilidades.js";
import * as diseno from "./diseno.js";
import * as higgsfield from "./higgsfield.js";
import { avisar, avisarPantalla } from "./avisos.js";
import { db, getAjuste, setAjuste } from "./db.js";
import { ahoraLocalISO, utcALocal } from "./tiempo.js";
import * as gasto from "./gasto.js";

const MODELO = process.env.DELTA_MODELO_DEPTOS || "claude-sonnet-5-5";
const BUSQUEDA_WEB = process.env.DELTA_BUSQUEDA_WEB !== "no";
const A_LA_VEZ = 2;

export const DEPARTAMENTOS = [
  {
    id: "tendencias",
    nombre: "Tendencias",
    resumen: "Coolhunting, social listening e innovación: qué viene antes de que sea masivo.",
    funcion: "Rastreas cambios culturales, estéticos y de consumo antes de que se vuelvan masivos; monitoreas conversaciones, memes, audios y formatos virales y comportamientos emergentes; exploras tecnologías nuevas (IA, realidad aumentada, formatos nuevos) que se puedan aplicar en campañas. Entregas: reporte de tendencias con qué es, por qué importa, ejemplo y cómo aplicarlo a cada cliente.",
    web: true,
  },
  {
    id: "cuentas",
    nombre: "Cuentas y clientes",
    resumen: "El vínculo con cada cliente: briefs, seguimiento de entregas y proyectos.",
    funcion: "Gestionas la relación con los clientes: levantas briefings (haces las preguntas correctas y los dejas por escrito), coordinas entregas, das seguimiento a proyectos y propones el siguiente paso con cada cliente. Puedes crear y actualizar proyectos. Los mensajes o correos para clientes los redactas completos y los mandas a aprobación.",
  },
  {
    id: "estrategia",
    nombre: "Estrategia y planning",
    resumen: "Mercado, competencia y consumidor para definir planes y posicionamiento.",
    funcion: "Analizas el mercado, la competencia y al consumidor para definir planes de acción, posicionamiento, mensajes clave, audiencias y objetivos medibles. Entregas planes claros por etapas, con KPIs.",
    web: true,
  },
  {
    id: "creatividad",
    nombre: "Creatividad y diseño",
    resumen: "Conceptos, piezas gráficas, identidad de marca y copywriting.",
    funcion: "Desarrollas conceptos creativos, ideas de piezas gráficas (con descripción visual precisa y textos), identidad de marca y copywriting persuasivo. Das varias opciones y recomiendas una. Cuando algo sea para entregar al cliente, pides aprobación.",
  },
  {
    id: "diseno",
    nombre: "Diseño",
    resumen: "Tu diseñadora: carruseles, posts, historias y videos terminados, listos para descargar y subir.",
    funcion: `Eres la diseñadora gráfica y directora de arte de la agencia. No solo propones: ENTREGAS las piezas terminadas como imágenes listas para subir (carruseles, posts, historias, portadas de reel) y, si Higgsfield está conectado, imágenes y videos hechos con IA.
Cómo trabajas:
1. Entiende el objetivo, el público y la marca del cliente (ver_cliente). Si una habilidad aplica (carruseles, ganchos, guiones, prompts de Higgsfield…), léela y síguela.
2. Escribe el copy: gancho fuerte en la primera slide, una idea por slide, textos cortos y legibles en el celular, cierre con llamada a la acción.
3. Diseña cada slide en HTML y CSS y llama a crear_pieza. Te devuelve una hoja de contacto con todas las slides en chico: revísala con ojo de directora de arte (legibilidad, jerarquía, contraste, que nada se corte ni se encime, consistencia entre slides) y corrige con reemplaza_id hasta que quede profesional. Máximo 3 rondas.
4. Si conviene una foto o ilustración, créala con generar_imagen_ia y úsala dentro del diseño con src="medio:ID". Para un video, usa generar_video_ia (puede animar una slide o una imagen).
5. Termina con: qué entregaste (con el número de cada pieza), el texto para publicar (caption con hashtags) y recomendaciones de publicación.
Reglas de diseño en HTML: cada slide es un fragmento HTML dentro de un <section class="slide"> del tamaño exacto (carrusel y post 1080x1350, cuadrado 1080x1080, historia y portada 1080x1920); usa posiciones y tamaños en px; textos de mínimo 34px (títulos de 80 a 130px); deja márgenes de al menos 80px (en historias, 250px arriba y abajo libres para la interfaz de Instagram); puedes usar Google Fonts con @import en el css; nada de JavaScript ni imágenes de internet (solo medio:ID, SVG en línea, degradados y CSS). Numera las slides del carrusel de forma discreta si ayuda. Cuida la marca del cliente: colores, tono y la regulación de salud.`,
  },
  {
    id: "video",
    nombre: "Edición de video",
    resumen: "Guiones, ganchos, storyboards y videos con IA.",
    funcion: "Escribes guiones de video (reels, TikTok, anuncios, YouTube) con gancho en los primeros 3 segundos, storyboard por escenas, texto en pantalla, subtítulos, música sugerida e indicaciones de edición. Escribes prompts de video para IA y, si Higgsfield está conectado, generas clips cortos con generar_video_ia (de 3 a 15 segundos; para un reel largo, genera las tomas clave y explica cómo unirlas). Si no está conectado, dejas los prompts listos para producirlo.",
  },
  {
    id: "contenido",
    nombre: "Contenido y redes",
    resumen: "Calendarios editoriales, formatos por red y comunidad.",
    funcion: "Planificas calendarios editoriales (fecha, red, formato, tema, copy, hashtags), adaptas cada idea al formato de cada red social y propones respuestas para la comunidad. Las publicaciones listas para salir van a aprobación (todavía no se publican solas: las cuentas se conectan al final).",
    web: true,
  },
  {
    id: "medios",
    nombre: "Medios pagados",
    resumen: "Trafficker: compra y optimización de anuncios en buscadores y redes.",
    funcion: "Planeas y optimizas pauta pagada (Meta, Google, TikTok): estructura de campañas, audiencias, presupuesto por etapa, creativos a probar y KPIs. Las cuentas publicitarias aún no están conectadas: trabajas con lo que te den y lo dices. Cualquier gasto o cambio de presupuesto va a aprobación.",
  },
  {
    id: "seo",
    nombre: "SEO y desarrollo web",
    resumen: "Posicionamiento orgánico y sitios o landing pages.",
    funcion: "Mejoras el posicionamiento orgánico: palabras clave, estructura de páginas, títulos y descripciones, contenido para blog, SEO local (Google Maps) y propuestas de landing pages con sus textos. Los cambios a sitios van a aprobación.",
    web: true,
  },
  {
    id: "analitica",
    nombre: "Analítica y datos",
    resumen: "Métricas, rendimiento de campañas, reportes y ROI.",
    funcion: "Mides métricas, evalúas el rendimiento y armas reportes de resultados y ROI con conclusiones y recomendaciones. Mientras no estén conectadas las cuentas, trabajas con los datos que te pasen y nunca inventas números. Enviar un reporte al cliente va a aprobación.",
  },
  {
    id: "finanzas",
    nombre: "Administración y finanzas",
    resumen: "Presupuestos, facturación, cobros, nómina y recursos.",
    funcion: "Administras presupuestos por cliente, cotizaciones, facturación, cobros, nómina y recursos internos. Calculas con cuidado y muestras las cuentas. Emitir una factura, mandar un cobro o hacer un pago siempre va a aprobación; nunca mueves dinero.",
  },
];
export const deptoPorId = (id) => DEPARTAMENTOS.find((d) => d.id === id);

let cliente = null;
const claude = () => (cliente ||= new Anthropic());

function sistema(d) {
  return `Eres el departamento de ${d.nombre} de DELTA Marketing, una agencia boutique de marketing médico (clínicas, doctores, salud y bienestar). Trabajas para el dueño de la agencia; DELTA, su asistente, es la directora que te encarga el trabajo.

Tu función: ${d.funcion}

Reglas:
- Trabajas en español, claro y profesional. Tu respuesta final es el entregable: empieza con un título de una línea y después el contenido, con viñetas y secciones cortas. Nada de relleno.
- Usa ver_cliente para conocer al cliente antes de trabajar para él.
- Nunca inventes datos, cifras ni resultados. Si algo es una suposición, dilo. Si te falta información clave, trabaja con lo razonable y al final lista las preguntas pendientes.
- Marketing de salud: respeta la regulación de publicidad sanitaria (en México, COFEPRIS): nada de prometer curas ni resultados garantizados, ni testimonios engañosos ni antes/después sin cuidado.
- Puedes investigar, analizar, proponer y escribir borradores por tu cuenta. Todo lo que tenga que salir de la agencia o costar dinero (publicar, mandar un mensaje o correo a un cliente, entregar una pieza, gastar en anuncios, facturar o cobrar) NO lo haces: lo dejas listo y lo mandas a la bandeja del dueño con pedir_aprobacion, con el contenido final completo.
- Todavía no hay cuentas de Meta, Google, TikTok ni WhatsApp conectadas (se conectan al final del plan). No digas que publicaste, enviaste o gastaste nada.
${habilidades.resumenParaAgente()}${["diseno", "video"].includes(d.id) ? (higgsfield.higgsfieldDisponible() ? "- Higgsfield está conectado: puedes generar imágenes y videos con IA (cuestan dinero; solo los que se van a usar).\n" : "- Higgsfield todavía no está conectado: no puedes generar imágenes ni videos con IA. Diseña con tipografía, formas, degradados y SVG, y deja los prompts de IA escritos al final por si el dueño los quiere hacer.\n") : ""}${d.web ? "- Puedes buscar en internet (web_search) y en noticias para investigar. Cita las fuentes con su nombre." : ""}
Fecha y hora actuales: ${ahoraLocalISO()} (${utcALocal(new Date().toISOString())}).`;
}

function herramientasDe(d, ctx) {
  const json = (x) => JSON.stringify(x);
  const lista = [
    betaTool({
      name: "ver_cliente",
      description: "Ficha de un cliente (datos, servicios, presupuesto, proyectos, trabajos recientes).",
      inputSchema: { type: "object", properties: { cliente: { type: "string", description: "Nombre o id" } }, required: ["cliente"], additionalProperties: false },
      run: ({ cliente }) => json(agencia.fichaCliente(cliente)),
    }),
    betaTool({
      name: "listar_clientes",
      description: "Lista los clientes de la agencia con su estado y presupuesto.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      run: () => json(agencia.listarClientes().map(({ notas, ...c }) => c)),
    }),
    betaTool({
      name: "ver_trabajo_anterior",
      description: "Lee un entregable anterior de cualquier departamento, por su id.",
      inputSchema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"], additionalProperties: false },
      run: ({ id }) => json(agencia.obtenerTrabajo(id) || { error: "No existe" }),
    }),
    betaTool({
      name: "pedir_aprobacion",
      description: "Manda algo a la bandeja de aprobaciones del dueño (publicación, mensaje o correo a cliente, entrega, gasto en anuncios, factura…). Incluye el contenido final completo, listo para usar.",
      inputSchema: {
        type: "object",
        properties: {
          tipo: { type: "string", enum: ["publicacion", "mensaje_cliente", "correo", "presupuesto", "entrega", "factura", "otro"] },
          titulo: { type: "string", description: "Qué se aprueba, en una línea" },
          contenido: { type: "string", description: "El contenido exacto que saldría" },
        },
        required: ["tipo", "titulo", "contenido"],
        additionalProperties: false,
      },
      run: (i) => {
        const a = agencia.pedirAprobacion({ ...i, departamento: d.id, cliente_id: ctx.cliente_id, trabajo_id: ctx.trabajo_id });
        ctx.aprobaciones.push(a.id);
        return json({ ok: true, aprobacion_id: a.id, nota: "Quedó en la bandeja del dueño. No se ha enviado nada." });
      },
    }),
  ];
  lista.push(...herramientasDeHabilidades());
  if (["diseno", "video"].includes(d.id)) lista.push(...herramientasDeDiseno(d, ctx));
  if (["tendencias", "estrategia", "contenido", "seo", "creatividad", "video", "diseno"].includes(d.id)) {
    lista.push(betaTool({
      name: "buscar_noticias",
      description: "Noticias recientes sobre un tema (Google Noticias).",
      inputSchema: { type: "object", properties: { tema: { type: "string" }, dias: { type: "integer", description: "1 a 7" } }, required: ["tema"], additionalProperties: false },
      run: async ({ tema, dias }) => json(await noticias.noticias(tema, 8, dias || 7)),
    }));
  }
  if (d.id === "cuentas") {
    lista.push(
      betaTool({
        name: "crear_proyecto",
        description: "Crea un proyecto para un cliente (con brief y fecha de entrega si se sabe).",
        inputSchema: {
          type: "object",
          properties: { cliente: { type: "string" }, titulo: { type: "string" }, departamento: { type: "string" }, brief: { type: "string" }, entrega: { type: "string", description: "AAAA-MM-DDTHH:MM hora local" } },
          required: ["titulo"],
          additionalProperties: false,
        },
        run: (i) => json(agencia.crearProyecto(i)),
      }),
      betaTool({
        name: "actualizar_proyecto",
        description: "Cambia estado, brief, fecha de entrega o departamento de un proyecto.",
        inputSchema: {
          type: "object",
          properties: { id: { type: "integer" }, estado: { type: "string", enum: ["pendiente", "en_proceso", "revision", "entregado", "cancelado"] }, brief: { type: "string" }, entrega: { type: "string" }, departamento: { type: "string" } },
          required: ["id"],
          additionalProperties: false,
        },
        run: ({ id, ...c }) => json(agencia.actualizarProyecto(id, c)),
      }),
    );
  }
  if (d.web && BUSQUEDA_WEB && !ctx.sinWeb) lista.push({ type: "web_search_20250305", name: "web_search", max_uses: 6 });
  return lista;
}

function herramientasDeHabilidades() {
  if (!habilidades.activas().length) return [];
  return [
    betaTool({
      name: "usar_habilidad",
      description: "Lee una habilidad (skill) por su nombre: su SKILL.md con las instrucciones y la lista de archivos de apoyo. Si el texto es largo, vuelve a llamarla con 'desde'.",
      inputSchema: { type: "object", properties: { nombre: { type: "string" }, desde: { type: "integer" } }, required: ["nombre"], additionalProperties: false },
      run: ({ nombre, desde }) => habilidades.leer(nombre, desde || 0),
    }),
    betaTool({
      name: "leer_archivo_habilidad",
      description: "Lee un archivo de apoyo de una habilidad (por ejemplo references/ejemplos.md o brandkit.md).",
      inputSchema: { type: "object", properties: { nombre: { type: "string", description: "La habilidad" }, ruta: { type: "string" }, desde: { type: "integer" } }, required: ["nombre", "ruta"], additionalProperties: false },
      run: ({ nombre, ruta, desde }) => habilidades.leerArchivo(nombre, ruta, desde || 0),
    }),
  ];
}

const imagenParaClaude = (datos, tipo = "image/jpeg") => ({ type: "image", source: { type: "base64", media_type: tipo, data: datos.toString("base64") } });

function herramientasDeDiseno(d, ctx) {
  const lista = [];
  if (d.id === "diseno") {
    lista.push(betaTool({
      name: "crear_pieza",
      description: "Convierte tu diseño (HTML y CSS por slide) en imágenes PNG del tamaño exacto, listas para descargar. Devuelve el número de pieza y una hoja de contacto para revisarla. Para corregir una pieza, vuelve a llamar con reemplaza_id.",
      inputSchema: {
        type: "object",
        properties: {
          titulo: { type: "string", description: "Nombre corto de la pieza" },
          tipo: { type: "string", enum: Object.keys(diseno.FORMATOS), description: "carrusel y post 1080x1350, cuadrado 1080x1080, historia y portada 1080x1920" },
          css: { type: "string", description: "Estilos compartidos por todas las slides (puede empezar con @import de Google Fonts)" },
          slides: { type: "array", items: { type: "string" }, description: "Un fragmento HTML por slide, en orden" },
          texto: { type: "string", description: "Caption o texto para publicar, con hashtags" },
          reemplaza_id: { type: "integer", description: "Número de una pieza tuya que quieres corregir" },
        },
        required: ["titulo", "tipo", "slides"],
        additionalProperties: false,
      },
      run: async (i) => {
        const { pieza, hoja } = await diseno.crearPieza({ ...i, trabajo_id: ctx.trabajo_id, cliente_id: ctx.cliente_id });
        ctx.piezas.add(pieza.id);
        return [
          { type: "text", text: JSON.stringify({ ok: true, pieza: pieza.id, slides: pieza.archivos.length, tamano: `${pieza.ancho}x${pieza.alto}`, nota: "Ya se ve en el Estudio de diseño. Revisa la hoja de contacto y corrige si hace falta." }) },
          imagenParaClaude(hoja),
        ];
      },
    }));
    lista.push(betaTool({
      name: "ver_pieza",
      description: "Recupera el HTML y CSS de una pieza anterior (para corregirla o hacer una versión nueva).",
      inputSchema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"], additionalProperties: false },
      run: ({ id }) => {
        const p = diseno.obtenerPieza(id);
        return JSON.stringify(p ? { id: p.id, titulo: p.titulo, tipo: p.tipo, texto: p.texto, ...p.diseno } : { error: "No existe" });
      },
    }));
  }
  if (!higgsfield.higgsfieldDisponible()) return lista;
  if (d.id === "diseno") {
    lista.push(betaTool({
      name: "generar_imagen_ia",
      description: "Crea una imagen con IA (Higgsfield): foto, ilustración o fondo. Escribe el prompt en inglés, muy descriptivo (sujeto, estilo, luz, encuadre, colores) y sin texto dentro de la imagen (el texto va en el diseño). Devuelve el número de medio para usarlo en crear_pieza como src=\"medio:ID\". Cuesta dinero: genera solo las que vas a usar.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          formato: { type: "string", enum: ["post", "historia", "cuadrado", "horizontal"], description: "post sale 3:4 (se recorta a 4:5 en el diseño), historia 9:16" },
          referencia_medio: { type: "integer", description: "Opcional: una imagen anterior (medio) como referencia de estilo" },
        },
        required: ["prompt"],
        additionalProperties: false,
      },
      run: async ({ prompt, formato, referencia_medio }) => {
        let referencia_url;
        if (referencia_medio) {
          const m = diseno.archivoDeMedio(referencia_medio);
          if (m?.medio.tipo === "imagen") referencia_url = await higgsfield.subirImagen(fs.readFileSync(m.ruta), m.tipo);
        }
        const r = await higgsfield.generarImagen({ prompt, formato, referencia_url });
        const m = diseno.guardarMedio({ tipo: "imagen", prompt, modelo: r.modelo, datos: r.datos, tipoContenido: r.tipo, trabajo_id: ctx.trabajo_id });
        const salida = [{ type: "text", text: JSON.stringify({ ok: true, medio: m.id, usar_como: `medio:${m.id}` }) }];
        if (r.datos.length < 3_500_000 && /png|jpe?g|webp|gif/.test(r.tipo)) salida.push(imagenParaClaude(r.datos, r.tipo.split(";")[0]));
        return salida;
      },
    }));
  }
  lista.push(betaTool({
    name: "generar_video_ia",
    description: "Crea un video corto con IA (Higgsfield, de 3 a 15 segundos). Puede animar una slide tuya (pieza + slide) o una imagen IA (medio), o crearlo solo con el texto. Prompt en inglés: acción, movimiento de cámara, ambiente. Tarda unos minutos y cuesta dinero: hazlo solo cuando el encargo lo pida.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        titulo: { type: "string" },
        formato: { type: "string", enum: ["reel", "cuadrado", "horizontal"], description: "reel 9:16 (default)" },
        duracion: { type: "integer", description: "Segundos, de 3 a 15 (5 por defecto)" },
        desde_medio: { type: "integer", description: "Opcional: animar esta imagen IA" },
        desde_pieza: { type: "integer", description: "Opcional: animar una slide de esta pieza" },
        slide: { type: "integer", description: "Con desde_pieza: qué slide (1 por defecto)" },
        sonido: { type: "boolean", description: "Con audio generado (sí por defecto)" },
        texto: { type: "string", description: "Caption para publicar" },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    run: async ({ prompt, titulo, formato = "reel", duracion, desde_medio, desde_pieza, slide, sonido, texto }) => {
      let imagen_url;
      const fuente = desde_pieza
        ? diseno.archivoDePieza(desde_pieza, `${String(slide || 1).padStart(2, "0")}.png`)
        : desde_medio ? diseno.archivoDeMedio(desde_medio) : null;
      if ((desde_pieza || desde_medio) && (!fuente || !fuente.tipo.startsWith("image/"))) throw new Error("No encontré esa imagen para animar");
      if (fuente) imagen_url = await higgsfield.subirImagen(fs.readFileSync(fuente.ruta), fuente.tipo);
      const r = await higgsfield.generarVideo({ prompt, formato, duracion, imagen_url, sonido: sonido !== false });
      const m = diseno.guardarMedio({ tipo: "video", prompt, modelo: r.modelo, datos: r.datos, tipoContenido: "video/mp4", trabajo_id: ctx.trabajo_id });
      const p = diseno.piezaDeVideo({ medio: m, titulo: titulo || prompt.slice(0, 60), texto, trabajo_id: ctx.trabajo_id, cliente_id: ctx.cliente_id, formato });
      ctx.piezas.add(p.id);
      return JSON.stringify({ ok: true, pieza: p.id, nota: "El video ya está en el Estudio de diseño, listo para descargar." });
    },
  }));
  return lista;
}

async function correrAgente(d, ctx, encargo) {
  const contexto = ctx.cliente_id ? `\n\n[Cliente del encargo: ${agencia.obtenerCliente(ctx.cliente_id)?.nombre} (id ${ctx.cliente_id})]` : "";
  const { final, cortado } = await gasto.correrConMedidor(claude(), d.id, {
    model: MODELO,
    max_tokens: d.id === "diseno" ? 20000 : 12000,
    system: [{ type: "text", text: sistema(d) }],
    output_config: { effort: "medium" },
    tools: herramientasDe(d, ctx),
    messages: [{ role: "user", content: encargo + contexto }],
    max_iterations: d.id === "diseno" ? 30 : 15,
  });
  if (cortado) throw new gasto.SinPresupuesto();
  if (final.stop_reason === "refusal") throw new Error("El modelo no quiso hacer este encargo");
  return final.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}

// ---------- Cola de trabajo (en segundo plano) ----------
const cola = [];
let corriendo = 0;

/** Encarga algo a un departamento. Devuelve al instante; el resultado llega como aviso. */
export function encargar({ departamento, encargo, cliente, proyecto_id, origen = "director" }) {
  const d = deptoPorId(departamento);
  if (!d) throw new Error(`No existe el departamento "${departamento}". Opciones: ${DEPARTAMENTOS.map((x) => x.id).join(", ")}`);
  if (!String(encargo || "").trim()) throw new Error("Falta decir qué se encarga");
  if (!gasto.hayPresupuesto()) throw new Error(`La agencia está en pausa: se llegó al tope de gasto del mes (${gasto.usd(gasto.tope())}). Puede subirlo en Ajustes.`);
  const c = cliente ? agencia.clienteRequerido(cliente) : null;
  const id = agencia.crearTrabajo({ departamento: d.id, cliente_id: c?.id, proyecto_id, encargo: encargo.trim() });
  cola.push({ id, d, encargo: encargo.trim(), cliente_id: c?.id ?? null, origen });
  avisarPantalla({ tipo: "agencia" });
  siguiente();
  return { trabajo_id: id, departamento: d.nombre, cliente: c?.nombre ?? null, estado: "en_proceso", en_cola: Math.max(0, cola.length - (A_LA_VEZ - corriendo)) };
}

function siguiente() {
  while (corriendo < A_LA_VEZ && cola.length) {
    const t = cola.shift();
    corriendo++;
    ejecutar(t).finally(() => { corriendo--; siguiente(); });
  }
}

async function ejecutar({ id, d, encargo, cliente_id, origen }) {
  const ctx = { trabajo_id: id, cliente_id, aprobaciones: [], piezas: new Set() };
  try {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("Falta la clave de Claude");
    let resultado;
    try {
      resultado = await correrAgente(d, ctx, encargo);
    } catch (e) {
      // Si la búsqueda web no está disponible en la cuenta, se intenta sin ella.
      if (!/web_search/i.test(e?.message || "")) throw e;
      ctx.sinWeb = true;
      resultado = await correrAgente(d, ctx, encargo);
    }
    agencia.terminarTrabajo(id, { resultado: resultado || "(sin contenido)" });
    const titulo = (resultado.split("\n").find((l) => l.trim()) || encargo).replace(/^[#*\s]+|[*]+$/g, "").slice(0, 120);
    let extra = ctx.aprobaciones.length ? ` Dejó ${ctx.aprobaciones.length} cosa(s) en Aprobaciones.` : "";
    if (ctx.piezas.size) extra += ` ${ctx.piezas.size === 1 ? "La pieza ya está" : `Las ${ctx.piezas.size} piezas ya están`} en el Estudio de diseño.`;
    await avisar(`${d.nombre} terminó: ${titulo}.${extra}`, `Agencia · ${d.nombre}`);
  } catch (e) {
    console.error(`[${d.id}]`, e);
    const sinDinero = e instanceof gasto.SinPresupuesto;
    agencia.terminarTrabajo(id, { resultado: sinDinero ? "Se detuvo al llegar al tope de gasto del mes. Puede subir el tope en Ajustes y pedirlo de nuevo." : "No se pudo completar: " + (e.message || e), estado: "fallo" });
    if (!sinDinero) await avisar(`${d.nombre} no pudo terminar el encargo #${id}. Si quieres, se lo pido otra vez.`, `Agencia · ${d.nombre}`).catch(() => {});
  } finally {
    avisarPantalla({ tipo: "agencia" });
  }
}

// Si el servidor se reinició a media tarea, esos trabajos no van a terminar solos.
db.prepare("UPDATE trabajos SET estado = 'fallo', resultado = 'Se interrumpió por un reinicio del servidor. Puede pedirlo de nuevo.' WHERE estado = 'en_proceso'").run();

// ---------- Rutinas ----------
// Lunes a las 9:00: reporte semanal de tendencias (solo si hay clientes activos).
export function revisarRutinas() {
  const local = ahoraLocalISO();
  const dia = new Date(local.slice(0, 10) + "T12:00:00Z").getUTCDay();
  const hora = local.slice(11, 16);
  const semana = local.slice(0, 10);
  if (getAjuste("rutina_tendencias", "si") !== "si") return;
  if (dia !== 1 || hora < "09:00" || hora > "12:00" || getAjuste("ultima_rutina_tendencias") === semana) return;
  setAjuste("ultima_rutina_tendencias", semana);
  const activos = agencia.listarClientes({ estado: "activo" });
  if (!activos.length || !gasto.hayPresupuesto()) return;
  encargar({
    departamento: "tendencias",
    origen: "rutina",
    encargo: `Reporte semanal de tendencias para la agencia. Revisa lo más relevante de esta semana en marketing de salud, redes sociales, formatos y audios virales, e IA aplicada a marketing. Para cada tendencia: qué es, por qué importa, y una idea concreta para cada cliente activo (${activos.map((c) => c.nombre).join(", ")}).`,
  });
}

export function iniciarRutinas() {
  const ciclo = () => { try { revisarRutinas(); } catch (e) { console.error("[rutinas]", e); } };
  ciclo();
  return setInterval(ciclo, 5 * 60_000);
}
