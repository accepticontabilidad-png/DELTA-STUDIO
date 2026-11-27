// Crear campañas de Meta desde DELTA (estilo "en un minuto") y los botones de Paid media.
//
// Cómo funciona "Crear campaña":
//  1. El dueño elige cliente, objetivo, qué anunciar y cuánto al día.
//  2. Claude propone la estrategia: público, 3 opciones de texto y la idea de la imagen. Se apoya en lo que
//     ya le funcionó a ESE cliente en Meta (sus campañas con mejores resultados).
//  3. La imagen la hace Higgsfield (o se usa una pieza del Estudio de diseño).
//  4. "Dejar lista en Meta" sube imagen, campaña, conjunto y anuncio, TODO EN PAUSA: no gasta nada.
//  5. Solo cuando el dueño toca "Aprobar y encender" (y confirma) se prende. DELTA (el chat) no tiene
//     herramienta para esto: siempre es un toque en la pantalla.
//
// También: pausar o encender una campaña que ya existe y cambiarle el presupuesto diario (con confirmación).
// Necesita el permiso ads_management de Meta (ver README, "Crear campañas").
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "./db.js";
import * as agencia from "./agencia.js";
import * as meta from "./meta.js";
import * as higgsfield from "./higgsfield.js";
import * as diseno from "./diseno.js";
import { ahoraLocalISO } from "./tiempo.js";

db.exec(`
CREATE TABLE IF NOT EXISTS campanas_delta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  objetivo TEXT NOT NULL,                        -- whatsapp | messenger | sitio | alcance
  oferta TEXT NOT NULL,                          -- qué se anuncia, en palabras del dueño
  enlace TEXT,                                   -- sitio web (objetivo sitio)
  presupuesto_diario REAL NOT NULL,
  dias INTEGER,                                  -- NULL = sin fecha de fin
  propuesta TEXT,                                -- JSON: nombre, resumen, por_que, publico, textos, prompt_imagen, consejos
  texto_elegido INTEGER NOT NULL DEFAULT 0,
  medio_id INTEGER,                              -- imagen de Higgsfield (medios_ia)
  pieza TEXT,                                    -- o una pieza del Estudio: "id/archivo.png"
  cuenta_id TEXT,                                -- act_123
  pagina_id TEXT,                                -- id de la página de Facebook (sin "page:")
  meta TEXT,                                     -- JSON: imagen, campana, conjunto, creativo, anuncio (ids)
  estado TEXT NOT NULL DEFAULT 'borrador',       -- borrador | en_meta | activa | descartada
  error TEXT,
  creado TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  actualizado TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`);

export const OBJETIVOS = {
  whatsapp: { nombre: "Mensajes por WhatsApp", meta: "OUTCOME_ENGAGEMENT", destino: "WHATSAPP", optimiza: "CONVERSATIONS", boton: "WHATSAPP_MESSAGE" },
  messenger: { nombre: "Mensajes por Messenger", meta: "OUTCOME_ENGAGEMENT", destino: "MESSENGER", optimiza: "CONVERSATIONS", boton: "MESSAGE_PAGE" },
  sitio: { nombre: "Visitas al sitio web", meta: "OUTCOME_TRAFFIC", destino: "WEBSITE", optimiza: "LINK_CLICKS", boton: "LEARN_MORE" },
  alcance: { nombre: "Que la conozcan (alcance)", meta: "OUTCOME_AWARENESS", destino: null, optimiza: "REACH", boton: "LEARN_MORE" },
};
const GENEROS = { todos: undefined, mujeres: [2], hombres: [1] };
const MODELO = () => process.env.DELTA_MODELO_CAMPANAS || process.env.DELTA_MODELO_DEPTOS || "claude-sonnet-5-5";

// Para pruebas: se puede cambiar Meta, Claude y la imagen por versiones de mentira.
let graph = meta.graph;
let proponer = null;
let imagenIA = null;
export const _dePrueba = ({ graph: g, proponer: p, imagen: i } = {}) => { if (g) graph = g; if (p) proponer = p; if (i) imagenIA = i; };

const json = (t, d) => { try { return JSON.parse(t) ?? d; } catch { return d; } };
const r2 = (n) => Math.round(n * 100) / 100;

function leer(f) {
  if (!f) return null;
  const c = agencia.obtenerCliente(f.cliente_id);
  const propuesta = json(f.propuesta, null);
  const m = json(f.meta, {});
  const num = String(f.cuenta_id || "").replace(/^act_/, "");
  return {
    ...f,
    cliente: c?.nombre || null,
    objetivo_nombre: OBJETIVOS[f.objetivo]?.nombre || f.objetivo,
    propuesta,
    meta: m,
    imagen_url: f.medio_id ? `/api/diseno/medios/${f.medio_id}` : f.pieza ? `/api/diseno/piezas/${f.pieza}` : null,
    administrador: m.campana && num ? `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${num}&selected_campaign_ids=${m.campana}` : null,
  };
}

export function obtener(id) {
  return leer(db.prepare("SELECT * FROM campanas_delta WHERE id = ?").get(Number(id)));
}
function requerida(id) {
  const c = obtener(id);
  if (!c) throw new Error("No existe esa campaña");
  return c;
}

export function listar({ cliente } = {}) {
  const c = cliente ? agencia.clienteRequerido(cliente) : null;
  const filas = c
    ? db.prepare("SELECT * FROM campanas_delta WHERE cliente_id = ? AND estado != 'descartada' ORDER BY id DESC LIMIT 40").all(c.id)
    : db.prepare("SELECT * FROM campanas_delta WHERE estado != 'descartada' ORDER BY id DESC LIMIT 40").all();
  return filas.map(leer);
}

/** Lo que hace falta para crear campañas, para que la pantalla lo diga claro. */
export async function estado() {
  const conectado = meta.metaConectado();
  let faltan = null;
  if (conectado) faltan = await meta.permisosFaltantes(meta.PERMISOS_ANUNCIOS);
  const activos = db.prepare("SELECT id, tipo, nombre, cliente_id, extra FROM meta_activos WHERE cliente_id IS NOT NULL AND tipo IN ('anuncios','pagina')").all();
  const clientes = agencia.listarClientes().filter((c) => c.estado !== "terminado").map((c) => ({
    id: c.id, nombre: c.nombre,
    cuentas: activos.filter((a) => a.cliente_id === c.id && a.tipo === "anuncios").map((a) => ({ id: a.id, nombre: a.nombre, moneda: json(a.extra, {}).moneda || null })),
    paginas: activos.filter((a) => a.cliente_id === c.id && a.tipo === "pagina").map((a) => ({ id: a.id.replace(/^page:/, ""), nombre: a.nombre })),
  }));
  return {
    meta_conectado: conectado,
    puede_crear: conectado && Array.isArray(faltan) ? faltan.length === 0 : conectado ? null : false,
    falta_permiso: Array.isArray(faltan) && faltan.length > 0,
    higgsfield: higgsfield.higgsfieldDisponible(),
    claude: Boolean(process.env.ANTHROPIC_API_KEY) || Boolean(proponer),
    objetivos: Object.fromEntries(Object.entries(OBJETIVOS).map(([k, o]) => [k, o.nombre])),
    clientes,
    piezas: diseno.listarPiezas({ limite: 30 }).map((p) => ({ id: p.id, titulo: p.titulo, cliente: p.cliente, archivo: p.archivos[0], tipo: p.tipo })),
  };
}

// ---------- 1 y 2. La propuesta ----------
/** Las campañas de este cliente que mejor le han funcionado (de la última foto de Meta). */
function loQueFunciono(clienteId) {
  const f = db.prepare("SELECT datos FROM meta_fotos WHERE cliente_id = ? ORDER BY fecha DESC LIMIT 1").get(clienteId);
  const camp = json(f?.datos, {})?.anuncios?.campanas || [];
  return camp
    .map((k) => ({ ...k, resultados: (k.conversaciones || 0) + (k.prospectos || 0) + (k.compras || 0) }))
    .filter((k) => k.gasto > 0 && k.resultados > 0)
    .sort((a, b) => a.gasto / a.resultados - b.gasto / b.resultados)
    .slice(0, 5)
    .map((k) => `- "${k.nombre}": ${k.resultados} resultados con $${Math.round(k.gasto)} (≈ $${Math.round(k.gasto / k.resultados)} c/u)`);
}

const ESQUEMA = {
  type: "object",
  properties: {
    nombre: { type: "string", description: "Nombre corto de la campaña para el Administrador de anuncios" },
    resumen: { type: "string", description: "La estrategia explicada en 2 a 4 frases sencillas, para alguien que no sabe de marketing" },
    por_que: { type: "string", description: "Por qué este enfoque, en 1 o 2 frases (menciona lo que ya le funcionó si aplica)" },
    publico: {
      type: "object",
      properties: {
        edad_min: { type: "integer", minimum: 18, maximum: 65 },
        edad_max: { type: "integer", minimum: 18, maximum: 65 },
        genero: { type: "string", enum: ["todos", "mujeres", "hombres"] },
        ciudad: { type: "string", description: "Ciudad principal donde está el negocio (vacío = todo México)" },
        radio_km: { type: "integer", minimum: 10, maximum: 80 },
        descripcion: { type: "string", description: "A quién le habla, en una frase" },
      },
      required: ["edad_min", "edad_max", "genero", "ciudad", "radio_km", "descripcion"],
      additionalProperties: false,
    },
    textos: {
      type: "array",
      description: "Exactamente 3 opciones de anuncio con enfoques distintos",
      items: {
        type: "object",
        properties: {
          enfoque: { type: "string", description: "En 2 a 4 palabras (p. ej. 'Dolor y solución')" },
          texto: { type: "string", description: "Texto principal del anuncio: gancho en la primera línea, 2 a 5 líneas, llamada a la acción" },
          titulo: { type: "string", description: "Título corto (máx. 40 caracteres)" },
          descripcion: { type: "string", description: "Descripción corta (máx. 30 caracteres)" },
        },
        required: ["enfoque", "texto", "titulo", "descripcion"],
        additionalProperties: false,
      },
    },
    prompt_imagen: { type: "string", description: "Descripción en inglés de la foto del anuncio para un generador de imágenes: escena realista, luz, encuadre. SIN textos ni letras en la imagen." },
    consejos: { type: "array", items: { type: "string" }, description: "2 o 3 cosas a vigilar los primeros días, en frases cortas" },
  },
  required: ["nombre", "resumen", "por_que", "publico", "textos", "prompt_imagen", "consejos"],
  additionalProperties: false,
};

let claude = null;
async function pedirPropuesta(ctx) {
  if (proponer) return proponer(ctx);
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Falta la llave de Claude (ANTHROPIC_API_KEY) para que DELTA arme la campaña.");
  claude ||= new Anthropic();
  const { c, objetivo, oferta, presupuesto_diario, dias, indicaciones, funciono } = ctx;
  const r = await claude.messages.create({
    model: MODELO(),
    max_tokens: 3000,
    system: `Eres trafficker y copywriter senior de DELTA Marketing, una agencia de marketing médico en México (clínicas, doctores, salud y bienestar). Armas campañas de Meta (Facebook e Instagram) que venden, para negocios locales.
Reglas:
- Español de México, cálido y directo. Gancho fuerte en la primera línea. Nada de relleno ni emojis de más (1 o 2 está bien).
- Publicidad de salud (COFEPRIS): no prometas curas ni resultados garantizados, nada de antes/después, ni "el mejor", ni precios u ofertas que el dueño no dio.
- El público: negocio local, así que ciudad y radio. Edades y género solo si la oferta lo pide; si no, amplio.
- La imagen: una foto realista y profesional que detenga el scroll; sin texto dentro (Meta castiga el texto en la imagen).
- Nunca inventes cifras del cliente.`,
    tools: [{ name: "proponer_campana", description: "Entrega la campaña propuesta", input_schema: ESQUEMA }],
    tool_choice: { type: "tool", name: "proponer_campana" },
    messages: [{
      role: "user",
      content: `Cliente: ${c.nombre}${c.industria ? ` (${c.industria})` : ""}
Servicios: ${c.servicios || "—"}
Redes y sitio: ${c.redes || "—"}
Notas del cliente: ${String(c.notas || "—").slice(0, 1500)}
Objetivo: ${OBJETIVOS[objetivo].nombre}
Qué quiere anunciar: ${oferta}
Presupuesto: $${presupuesto_diario} al día${dias ? ` durante ${dias} días` : " (sin fecha de fin)"}
${indicaciones ? `Indicaciones del dueño: ${indicaciones}\n` : ""}Lo que ya le funcionó a este cliente en Meta:
${funciono.length ? funciono.join("\n") : "(todavía no hay campañas con resultados para comparar)"}

Arma la campaña.`,
    }],
  });
  const bloque = r.content.find((b) => b.type === "tool_use");
  if (!bloque) throw new Error("DELTA no pudo armar la campaña. Intente de nuevo.");
  return bloque.input;
}

function limpiarPropuesta(p) {
  const pub = p.publico || {};
  let min = Math.max(18, Math.min(65, Number(pub.edad_min) || 18));
  let max = Math.max(18, Math.min(65, Number(pub.edad_max) || 65));
  if (min > max) [min, max] = [max, min];
  return {
    nombre: String(p.nombre || "Campaña DELTA").slice(0, 120),
    resumen: String(p.resumen || ""),
    por_que: String(p.por_que || ""),
    publico: {
      edad_min: min, edad_max: max,
      genero: GENEROS[pub.genero] !== undefined || pub.genero === "todos" ? pub.genero : "todos",
      ciudad: String(pub.ciudad || "").slice(0, 80),
      radio_km: Math.max(10, Math.min(80, Number(pub.radio_km) || 20)),
      descripcion: String(pub.descripcion || ""),
    },
    textos: (Array.isArray(p.textos) ? p.textos : []).slice(0, 3).map((t) => ({
      enfoque: String(t.enfoque || ""), texto: String(t.texto || "").slice(0, 2000),
      titulo: String(t.titulo || "").slice(0, 80), descripcion: String(t.descripcion || "").slice(0, 60),
    })),
    prompt_imagen: String(p.prompt_imagen || "").slice(0, 3000),
    consejos: (Array.isArray(p.consejos) ? p.consejos : []).slice(0, 4).map(String),
  };
}

function validarBase({ objetivo, oferta, presupuesto_diario, dias, enlace }) {
  if (!OBJETIVOS[objetivo]) throw new Error("Elige el objetivo de la campaña");
  if (!String(oferta || "").trim()) throw new Error("Escribe qué quieres anunciar");
  const p = Number(String(presupuesto_diario ?? "").replace(/[$,\s]/g, ""));
  if (!(p > 0)) throw new Error("Escribe cuánto quieres invertir al día");
  if (p > 100000) throw new Error("Ese presupuesto diario se ve demasiado alto; revísalo");
  const d = dias === undefined || dias === null || dias === "" ? null : Math.round(Number(dias));
  if (d !== null && !(d >= 1 && d <= 90)) throw new Error("Los días deben ser de 1 a 90 (o déjalo vacío para que no tenga fin)");
  let link = String(enlace || "").trim() || null;
  if (objetivo === "sitio") {
    if (!link) throw new Error("Para llevar gente al sitio, escribe la dirección del sitio");
    if (!/^https?:\/\//i.test(link)) link = "https://" + link;
    try { new URL(link); } catch { throw new Error("Esa dirección del sitio no es válida"); }
  }
  return { objetivo, oferta: String(oferta).trim().slice(0, 600), presupuesto_diario: r2(p), dias: d, enlace: link };
}

/** Pasos 1 y 2: DELTA arma la propuesta (aún no toca Meta ni gasta en imágenes). */
export async function crear(datos = {}) {
  const c = agencia.clienteRequerido(datos.cliente);
  const base = validarBase(datos);
  const funciono = loQueFunciono(c.id);
  const propuesta = limpiarPropuesta(await pedirPropuesta({ c, ...base, indicaciones: String(datos.indicaciones || "").slice(0, 600), funciono }));
  if (!propuesta.textos.length) throw new Error("DELTA no pudo escribir los textos. Intente de nuevo.");
  const cuenta = db.prepare("SELECT id FROM meta_activos WHERE cliente_id = ? AND tipo = 'anuncios' ORDER BY visto DESC LIMIT 1").get(c.id)?.id || null;
  const pagina = db.prepare("SELECT id FROM meta_activos WHERE cliente_id = ? AND tipo = 'pagina' ORDER BY visto DESC LIMIT 1").get(c.id)?.id?.replace(/^page:/, "") || null;
  const r = db.prepare(`INSERT INTO campanas_delta (cliente_id, objetivo, oferta, enlace, presupuesto_diario, dias, propuesta, cuenta_id, pagina_id)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(c.id, base.objetivo, base.oferta, base.enlace, base.presupuesto_diario, base.dias, JSON.stringify(propuesta), cuenta, pagina);
  return obtener(Number(r.lastInsertRowid));
}

/** El dueño corrige lo que quiera antes de subirla. */
export function editar(id, cambios = {}) {
  const c = requerida(id);
  if (c.estado !== "borrador") throw new Error("Esta campaña ya está en Meta: los cambios se hacen allá o se crea otra.");
  const base = validarBase({
    objetivo: cambios.objetivo ?? c.objetivo, oferta: cambios.oferta ?? c.oferta,
    presupuesto_diario: cambios.presupuesto_diario ?? c.presupuesto_diario,
    dias: cambios.dias !== undefined ? cambios.dias : c.dias, enlace: cambios.enlace !== undefined ? cambios.enlace : c.enlace,
  });
  const p = { ...c.propuesta };
  if (cambios.publico) p.publico = limpiarPropuesta({ publico: { ...p.publico, ...cambios.publico } }).publico;
  if (Array.isArray(cambios.textos)) {
    cambios.textos.forEach((t, i) => { if (p.textos[i] && t) p.textos[i] = { ...p.textos[i], ...limpiarPropuesta({ textos: [{ ...p.textos[i], ...t }] }).textos[0] }; });
  }
  if (cambios.nombre) p.nombre = String(cambios.nombre).slice(0, 120);
  if (cambios.prompt_imagen) p.prompt_imagen = String(cambios.prompt_imagen).slice(0, 3000);
  const elegido = cambios.texto_elegido !== undefined ? Math.max(0, Math.min(p.textos.length - 1, Number(cambios.texto_elegido) || 0)) : c.texto_elegido;
  const activos = (tipo) => new Set(db.prepare("SELECT id FROM meta_activos WHERE cliente_id = ? AND tipo = ?").all(c.cliente_id, tipo).map((a) => a.id));
  let cuenta = c.cuenta_id;
  if (cambios.cuenta_id !== undefined) {
    if (!activos("anuncios").has(String(cambios.cuenta_id))) throw new Error("Esa cuenta de anuncios no es de este cliente");
    cuenta = String(cambios.cuenta_id);
  }
  let pagina = c.pagina_id;
  if (cambios.pagina_id !== undefined) {
    if (!activos("pagina").has(`page:${cambios.pagina_id}`)) throw new Error("Esa página no es de este cliente");
    pagina = String(cambios.pagina_id);
  }
  let pieza = c.pieza;
  let medio = c.medio_id;
  if (cambios.pieza !== undefined) {
    const [pid, archivo] = String(cambios.pieza || "").split("/");
    if (!diseno.archivoDePieza(pid, archivo)) throw new Error("No encuentro esa imagen del Estudio");
    pieza = `${Number(pid)}/${archivo}`;
    medio = null;
  }
  db.prepare(`UPDATE campanas_delta SET objetivo=?, oferta=?, enlace=?, presupuesto_diario=?, dias=?, propuesta=?, texto_elegido=?, cuenta_id=?, pagina_id=?, pieza=?, medio_id=?, error=NULL,
      actualizado=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`)
    .run(base.objetivo, base.oferta, base.enlace, base.presupuesto_diario, base.dias, JSON.stringify(p), elegido, cuenta, pagina, pieza, medio, c.id);
  return obtener(c.id);
}

export function descartar(id) {
  const c = requerida(id);
  if (c.estado === "activa") throw new Error("Esta campaña está encendida: primero páusala.");
  db.prepare("UPDATE campanas_delta SET estado='descartada', actualizado=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(c.id);
  return { ok: true };
}

// ---------- 3. La imagen ----------
export async function generarImagen(id, { prompt } = {}) {
  const c = requerida(id);
  if (c.estado !== "borrador") throw new Error("Esta campaña ya está en Meta");
  const texto = String(prompt || c.propuesta?.prompt_imagen || "").trim();
  if (!texto) throw new Error("Falta describir la imagen");
  const final = `${texto}. Professional advertising photo, realistic, high quality, natural light. No text, no letters, no logos, no watermarks.`;
  const r = imagenIA ? await imagenIA({ prompt: final }) : await higgsfield.generarImagen({ prompt: final, formato: "cuadrado" });
  const medio = diseno.guardarMedio({ tipo: "imagen", prompt: final, modelo: r.modelo, datos: r.datos, tipoContenido: r.tipo });
  const p = { ...c.propuesta, prompt_imagen: texto };
  db.prepare("UPDATE campanas_delta SET medio_id=?, pieza=NULL, propuesta=?, actualizado=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(medio.id, JSON.stringify(p), c.id);
  return obtener(c.id);
}

function archivoImagen(c) {
  if (c.medio_id) return diseno.archivoDeMedio(c.medio_id)?.ruta || null;
  if (c.pieza) { const [pid, a] = c.pieza.split("/"); return diseno.archivoDePieza(pid, a)?.ruta || null; }
  return null;
}

// ---------- 4. Dejarla lista en Meta, EN PAUSA ----------
/** Busca la ciudad en Meta para apuntar el anuncio ahí (con radio). */
async function ciudadMeta(nombre) {
  if (!nombre) return null;
  try {
    const d = await graph.leer("/search", { type: "adgeolocation", location_types: ["city"], q: nombre, country_code: "MX", limit: 5 });
    return (d.data || [])[0] || null;
  } catch { return null; }
}

function errorClaro(e) {
  const m = String(e.message || e);
  if (e.codigo === 200 || e.codigo === 10 || /ads_management|permission|permiso/i.test(m)) {
    return "Meta no dejó crear el anuncio: falta el permiso para manejar anuncios (ads_management) o tu usuario no tiene rol de anunciante en esa cuenta. Revisa la guía \"Crear campañas\" y vuelve a conectar Meta.";
  }
  if (/whatsapp/i.test(m)) return `Meta rechazó la parte de WhatsApp: revisa que la página del cliente tenga su número de WhatsApp ligado. (${m.replace(/^Meta: /, "")})`;
  return m;
}

/** Sube imagen, campaña, conjunto y anuncio a Meta. Todo queda en PAUSA. Si un paso falla, al reintentar sigue donde se quedó. */
export async function subirAMeta(id) {
  const c = requerida(id);
  if (!["borrador", "en_meta"].includes(c.estado)) throw new Error(c.estado === "activa" ? "Esta campaña ya está encendida" : "Esta campaña ya no está disponible");
  if (!meta.metaConectado()) throw new Error("Meta no está conectado. Conéctelo en Ajustes ⚙ → Conectar Meta.");
  if (!c.cuenta_id) throw new Error(`${c.cliente} no tiene cuenta de anuncios ligada. Asígnala en Paid media → Meta.`);
  if (!c.pagina_id) throw new Error(`${c.cliente} no tiene página de Facebook ligada. Asígnala en Paid media → Meta.`);
  const ruta = archivoImagen(c);
  if (!ruta) throw new Error("Falta la imagen del anuncio: créala con IA o elige una del Estudio.");
  const o = OBJETIVOS[c.objetivo];
  const p = c.propuesta;
  const t = p.textos[c.texto_elegido] || p.textos[0];
  const hecho = { ...c.meta };
  const guardar = () => db.prepare("UPDATE campanas_delta SET meta=?, actualizado=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(JSON.stringify(hecho), c.id);
  const cuenta = c.cuenta_id;
  try {
    // Imagen
    if (!hecho.imagen) {
      const r = await graph.escribir(`/${cuenta}/adimages`, { bytes: fs.readFileSync(ruta).toString("base64") });
      const img = Object.values(r.images || {})[0];
      if (!img?.hash) throw new Error("Meta no regresó la imagen subida");
      hecho.imagen = img.hash;
      guardar();
    }
    // Campaña (presupuesto en el conjunto)
    if (!hecho.campana) {
      const r = await graph.escribir(`/${cuenta}/campaigns`, {
        name: p.nombre, objective: o.meta, status: "PAUSED", special_ad_categories: [], is_adset_budget_sharing_enabled: false,
      });
      hecho.campana = r.id;
      guardar();
    }
    // Conjunto: público, presupuesto y fechas
    if (!hecho.conjunto) {
      const ciudad = await ciudadMeta(p.publico.ciudad);
      hecho.ciudad = ciudad ? `${ciudad.name}${ciudad.region ? `, ${ciudad.region}` : ""}` : "Todo México";
      const targeting = {
        geo_locations: ciudad ? { cities: [{ key: ciudad.key, radius: p.publico.radio_km, distance_unit: "kilometer" }] } : { countries: ["MX"] },
        age_min: p.publico.edad_min, age_max: p.publico.edad_max,
        ...(GENEROS[p.publico.genero] ? { genders: GENEROS[p.publico.genero] } : {}),
        targeting_automation: { advantage_audience: 0 },
      };
      const inicio = new Date(Date.now() + 10 * 60000);
      const r = await graph.escribir(`/${cuenta}/adsets`, {
        name: `${p.nombre} · Público`, campaign_id: hecho.campana, status: "PAUSED",
        daily_budget: Math.round(c.presupuesto_diario * 100), // Meta lo pide en centavos
        billing_event: "IMPRESSIONS", optimization_goal: o.optimiza, bid_strategy: "LOWEST_COST_WITHOUT_CAP",
        ...(o.destino ? { destination_type: o.destino } : {}),
        ...(["WHATSAPP", "MESSENGER"].includes(o.destino) ? { promoted_object: { page_id: c.pagina_id } } : {}),
        targeting, start_time: inicio.toISOString(),
        ...(c.dias ? { end_time: new Date(inicio.getTime() + c.dias * 864e5).toISOString() } : {}),
      });
      hecho.conjunto = r.id;
      guardar();
    }
    // Creativo: imagen + texto + botón
    if (!hecho.creativo) {
      const link = c.objetivo === "whatsapp" ? "https://api.whatsapp.com/send"
        : c.objetivo === "messenger" ? "https://fb.com/messenger_doc/"
        : c.enlace || `https://www.facebook.com/${c.pagina_id}`;
      const boton = c.objetivo === "whatsapp" ? { type: o.boton, value: { app_destination: "WHATSAPP" } }
        : c.objetivo === "messenger" ? { type: o.boton, value: { app_destination: "MESSENGER" } }
        : { type: o.boton, value: { link } };
      const spec = (conIg) => ({
        page_id: c.pagina_id,
        ...(conIg ? { instagram_user_id: conIg } : {}),
        link_data: { image_hash: hecho.imagen, link, message: t.texto, name: t.titulo, description: t.descripcion, call_to_action: boton },
      });
      const ig = json(db.prepare("SELECT extra FROM meta_activos WHERE id = ?").get(`page:${c.pagina_id}`)?.extra, {}).instagram || null;
      const crearCreativo = (conIg) => graph.escribir(`/${cuenta}/adcreatives`, { name: `${p.nombre} · ${t.enfoque || "Anuncio"}`, object_story_spec: spec(conIg) });
      let r;
      try { r = await crearCreativo(ig); } catch (e) {
        if (!ig || !/instagram/i.test(e.message)) throw e;
        r = await crearCreativo(null); // sin Instagram ligado a la cuenta: sale con la página
      }
      hecho.creativo = r.id;
      guardar();
    }
    // Anuncio
    if (!hecho.anuncio) {
      const r = await graph.escribir(`/${cuenta}/ads`, { name: `${p.nombre} · ${t.enfoque || "Anuncio"}`, adset_id: hecho.conjunto, creative: { creative_id: hecho.creativo }, status: "PAUSED" });
      hecho.anuncio = r.id;
      guardar();
    }
  } catch (e) {
    const msg = errorClaro(e);
    db.prepare("UPDATE campanas_delta SET error=?, actualizado=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(msg, c.id);
    throw new Error(msg);
  }
  db.prepare("UPDATE campanas_delta SET estado='en_meta', error=NULL, actualizado=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(c.id);
  return obtener(c.id);
}

// ---------- 5. Aprobar y encender ----------
/** Solo con un toque del dueño en la pantalla (y su confirmación). Prende campaña, conjunto y anuncio. */
export async function encender(id) {
  const c = requerida(id);
  if (c.estado !== "en_meta") throw new Error(c.estado === "activa" ? "Ya está encendida" : "Primero déjala lista en Meta");
  for (const k of ["anuncio", "conjunto", "campana"]) await graph.escribir(`/${c.meta[k]}`, { status: "ACTIVE" });
  db.prepare("UPDATE campanas_delta SET estado='activa', actualizado=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(c.id);
  refrescar(c.cliente_id);
  return obtener(c.id);
}

// ---------- Botones de Paid media para campañas que ya existen ----------
/** Revisa que la campaña sea de una cuenta de anuncios ligada a un cliente, y la regresa con su cliente. */
async function campanaConocida(campanaId) {
  const id = String(campanaId || "").replace(/\D/g, "");
  if (!id) throw new Error("Falta la campaña");
  const k = await graph.leer(`/${id}`, { fields: "id,name,status,effective_status,account_id,daily_budget,lifetime_budget" });
  const activo = db.prepare("SELECT cliente_id FROM meta_activos WHERE id = ? AND tipo = 'anuncios'").get(`act_${k.account_id}`);
  if (!activo?.cliente_id) throw new Error("Esa campaña no es de una cuenta de anuncios de tus clientes");
  return { ...k, cliente_id: activo.cliente_id };
}

let refrescarDePrueba = null;
export const _refrescarDePrueba = (fn) => { refrescarDePrueba = fn; };
function refrescar(clienteId) {
  if (refrescarDePrueba) return refrescarDePrueba(clienteId);
  meta.sincronizarCliente(clienteId).catch((e) => console.error("[campañas]", e.message));
}

/** Pausar (activa=false) o encender (activa=true) una campaña. */
export async function cambiarEstado(campanaId, activa) {
  const k = await campanaConocida(campanaId);
  await graph.escribir(`/${k.id}`, { status: activa ? "ACTIVE" : "PAUSED" });
  const propia = db.prepare("SELECT id FROM campanas_delta WHERE json_extract(meta,'$.campana') = ?").get(k.id);
  if (propia) db.prepare("UPDATE campanas_delta SET estado=?, actualizado=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(activa ? "activa" : "en_meta", propia.id);
  refrescar(k.cliente_id);
  return { id: k.id, nombre: k.name, activa: Boolean(activa) };
}

/** Dónde vive el presupuesto diario de una campaña (en la campaña o en sus conjuntos) y cuánto es. */
export async function presupuesto(campanaId) {
  const k = await campanaConocida(campanaId);
  const base = { id: k.id, nombre: k.name, cliente_id: k.cliente_id };
  if (k.daily_budget) return { ...base, nivel: "campana", diario: Number(k.daily_budget) / 100 };
  if (k.lifetime_budget) return { ...base, nivel: "total", diario: null, total: Number(k.lifetime_budget) / 100 };
  const d = await graph.leer(`/${k.id}/adsets`, { fields: "id,name,daily_budget,lifetime_budget,effective_status", limit: 50 });
  const conjuntos = (d.data || []).filter((a) => a.effective_status !== "DELETED" && a.effective_status !== "ARCHIVED");
  const diarios = conjuntos.filter((a) => a.daily_budget);
  if (!diarios.length) return { ...base, nivel: "total", diario: null };
  return {
    ...base, nivel: "conjuntos",
    diario: diarios.reduce((s, a) => s + Number(a.daily_budget) / 100, 0),
    conjuntos: diarios.map((a) => ({ id: a.id, nombre: a.name, diario: Number(a.daily_budget) / 100 })),
  };
}

/** Cambia el presupuesto diario total de una campaña. Si está en sus conjuntos, se reparte en la misma proporción. */
export async function cambiarPresupuesto(campanaId, nuevo) {
  const monto = Number(String(nuevo ?? "").replace(/[$,\s]/g, ""));
  if (!(monto > 0)) throw new Error("Escribe el nuevo presupuesto diario");
  const p = await presupuesto(campanaId);
  if (p.diario === null) throw new Error("Esta campaña tiene presupuesto total (no diario): cámbialo en el Administrador de anuncios.");
  if (monto > Math.max(p.diario * 5, p.diario + 500)) throw new Error(`Es más de 5 veces lo que gasta hoy ($${Math.round(p.diario)} al día). Si de verdad lo quieres, súbelo por pasos.`);
  if (p.nivel === "campana") {
    await graph.escribir(`/${p.id}`, { daily_budget: Math.round(monto * 100) });
  } else {
    for (const a of p.conjuntos) await graph.escribir(`/${a.id}`, { daily_budget: Math.max(100, Math.round((a.diario / p.diario) * monto * 100)) });
  }
  const propia = db.prepare("SELECT id FROM campanas_delta WHERE json_extract(meta,'$.campana') = ?").get(p.id);
  if (propia) db.prepare("UPDATE campanas_delta SET presupuesto_diario=? WHERE id=?").run(r2(monto), propia.id);
  refrescar(p.cliente_id);
  return { id: p.id, nombre: p.nombre, antes: r2(p.diario), ahora: r2(monto), nivel: p.nivel, fecha: ahoraLocalISO() };
}
