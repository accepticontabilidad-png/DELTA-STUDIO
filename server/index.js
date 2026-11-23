// Servidor de DELTA: sirve la app, la API del panel, el chat y el webhook de WhatsApp.
import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, getAjuste, setAjuste } from "./db.js";
import * as agenda from "./agenda.js";
import { hablarConDelta, inicioConversacion, nuevaConversacion } from "./cerebro.js";
import { iniciarVigilante, suscribirPantalla, avisar } from "./avisos.js";
import { whatsappConfigurado, verificarWebhook, crearReceptorWebhook } from "./whatsapp.js";
import { llavesPush, guardarSuscripcion } from "./push.js";
import { zonaHoraria } from "./tiempo.js";
import { guardarArchivo, infoArchivo, MAX_BYTES, MAX_POR_MENSAJE } from "./archivos.js";
import * as seg from "./seguridad.js";
import * as gmail from "./gmail.js";
import * as outlook from "./outlook.js";
import * as correo from "./correo.js";
import * as mercados from "./mercados.js";
import * as panorama from "./panorama.js";
import * as noticias from "./noticias.js";
import * as voz from "./voz.js";
import * as agencia from "./agencia.js";
import * as finanzas from "./finanzas.js";
import * as paidmedia from "./paidmedia.js";
import * as contenido from "./contenido.js";
import * as reportes from "./reportes.js";
import * as tendencias from "./tendencias.js";
import * as seo from "./seo.js";
import * as crm from "./crm.js";
import { DEPARTAMENTOS, encargar, iniciarRutinas } from "./departamentos.js";
import * as diseno from "./diseno.js";
import * as habilidades from "./habilidades.js";
import * as higgsfield from "./higgsfield.js";
import * as meta from "./meta.js";

const aqui = path.dirname(fileURLToPath(import.meta.url));

try {
  seg.revisarClave();
} catch (e) {
  console.error("⛔ " + e.message);
  process.exit(1);
}

const app = express();
app.disable("x-powered-by");
// Detrás del servidor de la nube (Railway/Render) la conexión real llega por un proxy.
app.set("trust proxy", Number(process.env.PROXIES_DE_CONFIANZA ?? 1));
app.use(seg.cabeceras);
// Guardamos el cuerpo original para poder comprobar la firma de WhatsApp.
app.use(express.json({ limit: "200kb", verify: (req, _res, buf) => { req.cuerpoOriginal = buf; } }));

// ---------- Entrada (un solo usuario, protegido con clave) ----------
app.post("/api/entrar", async (req, res) => {
  const ip = req.ip;
  const espera = seg.bloqueado(ip);
  if (espera) return res.status(429).json({ error: `Demasiados intentos. Intente de nuevo en ${espera} min.` });

  if (!seg.claveCorrecta(String(req.body?.clave || ""))) {
    const activoBloqueo = seg.registrarFallo(ip);
    await new Promise((r) => setTimeout(r, 600)); // frena a quien intenta adivinar
    if (activoBloqueo) {
      avisar(`⚠️ Alguien intentó entrar a DELTA con clave incorrecta varias veces (IP ${ip}). Lo bloqueé un rato.`, "Alerta de seguridad").catch(() => {});
    }
    return res.status(401).json({ error: "Clave incorrecta" });
  }
  const { id, expira } = seg.crearSesion(req.get("user-agent"));
  seg.ponerCookie(req, res, id, expira);
  res.json({ ok: true });
});

app.post("/api/salir", (req, res) => {
  seg.cerrarSesion(seg.leerCookie(req));
  seg.borrarCookie(res);
  res.json({ ok: true });
});

// ---------- WhatsApp ----------
app.get("/webhook/whatsapp", verificarWebhook);
app.post("/webhook/whatsapp", crearReceptorWebhook(hablarConDelta, crm.recibirWhatsApp));

// ---------- Correo: Google o Microsoft regresan aquí después de que el usuario da permiso ----------
// (Llegan desde fuera, así que no traen la cookie; se valida con el "estado" de un solo uso.)
function retornoOAuth(nombre, mod, clave) {
  return async (req, res) => {
    try {
      const cuenta = await mod.terminarConexion(req);
      avisar(`${nombre} conectado${cuenta ? ` (${cuenta})` : ""}. Ya puedo leer y ordenar ese correo.`, "Correo").catch(() => {});
      res.redirect(`/?correo=ok&cuenta=${clave}`);
    } catch (e) {
      console.error(`[${clave}]`, e.message);
      res.redirect(`/?correo=error&cuenta=${clave}&motivo=` + encodeURIComponent(e.message.slice(0, 200)));
    }
  };
}
const retornoGmail = retornoOAuth("Gmail", gmail, "gmail");
app.get("/oauth/google", async (req, res) => {
  // La misma dirección de regreso sirve para Gmail y para Google de SEO (Search Console y Analytics).
  if (!seo.esRetornoSeo(req)) return retornoGmail(req, res);
  try {
    const cuenta = await seo.terminarConexion(req);
    avisar(`Google conectado para SEO${cuenta ? ` (${cuenta})` : ""}. Ya puedo ver las visitas y posiciones de sus clientes.`, "SEO y web").catch(() => {});
    res.redirect("/?seo=ok#/seo");
  } catch (e) {
    console.error("[seo]", e.message);
    res.redirect("/?seo=error&motivo=" + encodeURIComponent(e.message.slice(0, 200)) + "#/seo");
  }
});
app.get("/oauth/microsoft", retornoOAuth("Hotmail", outlook, "outlook"));
// Meta (Facebook e Instagram de los clientes): mismo camino, regresa a Cuentas.
app.get("/oauth/meta", async (req, res) => {
  try {
    const nombre = await meta.terminarConexion(req);
    avisar(`Meta conectado${nombre ? ` (${nombre})` : ""}. Estoy buscando las páginas, Instagram y cuentas de anuncios de sus clientes.`, "Meta").catch(() => {});
    res.redirect("/?meta=ok#/cuentas");
  } catch (e) {
    console.error("[meta]", e.message);
    res.redirect("/?meta=error&motivo=" + encodeURIComponent(e.message.slice(0, 200)) + "#/cuentas");
  }
});

// ---------- Formulario público de prospectos de cada cliente (/p/<token>) ----------
app.get("/p/:token", (req, res) => {
  const x = crm.clientePorFormulario(req.params.token);
  if (!x) return res.status(404).type("text").send("Este formulario no existe o ya no está disponible.");
  res.set("X-Robots-Tag", "noindex").type("html").send(crm.paginaFormulario(x, { enviado: req.query.ok === "1" }));
});
app.post("/p/:token", express.urlencoded({ extended: false, limit: "20kb" }), (req, res) => {
  const x = crm.clientePorFormulario(req.params.token);
  if (!x) return res.status(404).type("text").send("Este formulario no existe o ya no está disponible.");
  try {
    crm.recibirFormulario(req.params.token, req.body || {}, req.ip);
    res.redirect(303, `/p/${req.params.token}?ok=1`);
  } catch (e) {
    res.status(400).type("html").send(crm.paginaFormulario(x, { error: e.message, datos: req.body || {} }));
  }
});

// ---------- Reporte mensual para el cliente (link que el dueño crea y puede quitar) ----------
app.get("/r/:token", (req, res) => {
  let d = null;
  try { d = reportes.porToken(req.params.token); } catch (e) { console.error("[reportes]", e.message); }
  res.setHeader("Cache-Control", "no-store");
  if (!d) return res.status(404).type("html").send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Reporte</title><link rel="stylesheet" href="/reporte.css"><body class="rp-pagina"><article class="rp"><p class="rp-vacio">Este reporte ya no está disponible. Pídele a tu agencia un link nuevo.</p></article></body>');
  res.type("html").send(reportes.paginaReporte(d, { imprimir: req.query.imprimir === "1" }));
});

// ---------- API del panel ----------
const api = express.Router();
api.use(seg.protegido);

// La dirección pública de la app (para armar links completos cuando DELTA los da por WhatsApp o por voz).
function guardarUrlBase(req) {
  if (process.env.URL_PUBLICA) return;
  const base = `${req.protocol}://${req.get("host")}`;
  if (/^https?:\/\/[\w.-]+(:\d+)?$/.test(base) && getAjuste("url_base") !== base) setAjuste("url_base", base);
}

const envolver = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (e) {
    console.error(e);
    // Errores de la API de Claude u otros internos no se muestran tal cual.
    const interno = e?.status || e?.name === "APIError" || /Anthropic|ECONN|fetch/i.test(String(e?.constructor?.name) + e?.message);
    res.status(interno ? 502 : 400).json({ error: interno ? "DELTA no pudo completar eso ahora. Intente de nuevo." : e.message });
  }
};

api.post("/chat", envolver(async (req) => {
  const archivos = Array.isArray(req.body?.archivos) ? req.body.archivos : [];
  if (archivos.length > MAX_POR_MENSAJE) throw new Error(`Máximo ${MAX_POR_MENSAJE} archivos por mensaje`);
  if (archivos.some((id) => !infoArchivo(id))) throw new Error("Uno de los archivos ya no existe; adjúntelo de nuevo");
  let texto = String(req.body?.texto || "").trim();
  if (!texto && archivos.length) texto = "Revise lo que le adjunto, por favor.";
  if (!texto) throw new Error("Mensaje vacío");
  if (texto.length > 4000) throw new Error("Mensaje demasiado largo");
  const info = {};
  const respuesta = await hablarConDelta(texto, req.body?.canal === "voz" ? "voz" : "app", archivos, info);
  return { respuesta, hizo_cambio: Boolean(info.hizoCambio), abrir: info.abrir || null };
}));

api.get("/historial", envolver(() =>
  db.prepare("SELECT rol, texto, canal, fecha, archivos FROM conversacion WHERE id >= ? ORDER BY id DESC LIMIT 40")
    .all(inicioConversacion())
    .reverse()
    .map(({ archivos, ...m }) => ({ ...m, archivos: archivos ? JSON.parse(archivos).map(infoArchivo).filter(Boolean).map((a) => a.nombre) : [] })),
));

// Archivos adjuntos: llegan tal cual (sin JSON), uno por petición, y se guardan en privado.
api.post(
  "/archivos",
  express.raw({ type: () => true, limit: MAX_BYTES }),
  envolver((req) => guardarArchivo(req.body, decodeURIComponent(String(req.get("x-nombre") || "archivo")))),
);

// Empieza una conversación nueva: DELTA olvida la plática anterior (no la agenda ni su memoria).
api.post("/conversacion/nueva", envolver(() => { nuevaConversacion(); return { ok: true }; }));

api.get("/agenda", envolver((req) => agenda.agendaRango(String(req.query.desde || ""), String(req.query.hasta || ""))));

api.get("/panel", envolver((req) => {
  guardarUrlBase(req);
  const hoy = agenda.resumenDelDia();
  return {
    zona_horaria: zonaHoraria(),
    hora_resumen: getAjuste("hora_resumen", process.env.HORA_RESUMEN || "08:00"),
    tareas: agenda.listarTareas({ estado: "pendiente" }),
    eventos: agenda.listarEventos({}),
    recordatorios: agenda.listarRecordatorios(),
    memorias: agenda.listarMemorias(),
    avisos: db.prepare("SELECT * FROM avisos ORDER BY id DESC LIMIT 10").all(),
    voz: voz.estadoVoz(),
    hoy: { eventos: hoy.eventos.length, vencidas: hoy.tareas_vencidas.length, pendientes: hoy.total_pendientes },
    conexiones: {
      cerebro: Boolean(process.env.ANTHROPIC_API_KEY),
      whatsapp: whatsappConfigurado(),
      push: db.prepare("SELECT COUNT(*) n FROM suscripciones_push").get().n > 0,
      calendario: true,
      gmail: gmail.gmailConectado(),
      gmail_disponible: gmail.gmailDisponible(),
      gmail_cuenta: gmail.cuentaGmail(),
      outlook: outlook.outlookConectado(),
      outlook_disponible: outlook.outlookDisponible(),
      outlook_cuenta: outlook.cuentaOutlook(),
      higgsfield: higgsfield.higgsfieldDisponible(),
      meta: meta.metaConectado(),
      meta_disponible: meta.metaDisponible(),
      meta_usuario: meta.estado().usuario,
    },
    aprobaciones_pendientes: agencia.listarAprobaciones({ estado: "pendiente" }).length,
    pagos_vencidos: (finanzas.generarMensualidades(), finanzas.listarCobros({ estado: "vencido" }).length),
    contenido_atrasado: (() => { try { return contenido.listarContenido().filter((p) => p.atrasada).length; } catch { return 0; } })(),
    ideas_nuevas: (() => { try { return tendencias.ideasNuevas(); } catch { return 0; } })(),
    sitios_caidos: (() => { try { return seo.sitiosCaidos().length; } catch { return 0; } })(),
    crm_sin_responder: (() => { try { return crm.avisosCrm().sin_responder.length; } catch { return 0; } })(),
    anuncios_sin_resultados: (() => { try { return paidmedia.avisosParaPulso().sin_resultados.length; } catch { return 0; } })(),
  };
}));

api.post("/tareas", envolver((req) => agenda.crearTarea(req.body || {})));
api.patch("/tareas/:id", envolver((req) => agenda.actualizarTarea(Number(req.params.id), req.body || {})));
api.delete("/tareas/:id", envolver((req) => agenda.borrarTarea(Number(req.params.id))));
api.post("/eventos", envolver((req) => agenda.crearEvento(req.body || {})));
api.delete("/eventos/:id", envolver((req) => agenda.borrarEvento(Number(req.params.id))));
api.post("/recordatorios", envolver((req) => agenda.crearRecordatorio(req.body || {})));
api.delete("/recordatorios/:id", envolver((req) => agenda.cancelarRecordatorio(Number(req.params.id))));

api.post("/ajustes", envolver((req) => {
  const { zona_horaria, hora_resumen } = req.body || {};
  if (zona_horaria) {
    new Intl.DateTimeFormat("es", { timeZone: zona_horaria }); // valida
    setAjuste("zona_horaria", zona_horaria);
  }
  if (hora_resumen !== undefined) {
    if (hora_resumen && !/^\d{2}:\d{2}$/.test(hora_resumen)) throw new Error("Hora no válida (HH:MM)");
    setAjuste("hora_resumen", hora_resumen);
  }
  return { ok: true };
}));

api.get("/gmail/conectar", envolver((req) => ({ url: gmail.urlConexion(req) })));
api.post("/gmail/desconectar", envolver(() => { gmail.desconectar(); return { ok: true }; }));
api.get("/outlook/conectar", envolver((req) => ({ url: outlook.urlConexion(req) })));
api.post("/outlook/desconectar", envolver(() => { outlook.desconectar(); return { ok: true }; }));
api.get("/mercados", envolver(() => mercados.verMercados(null, "dia")));
api.get("/noticias", envolver(() => noticias.titulares(4)));
// Tableros de "Mercados y noticias"
api.get("/bolsa/tablero", envolver(() => mercados.tablero()));
api.get("/bolsa/velas/:simbolo", envolver((req) => mercados.velas(req.params.simbolo, String(req.query.periodo || "3m"))));
api.get("/noticias/mapa", envolver(() => panorama.mapa()));
api.get("/noticias/videos", envolver(() => panorama.videos()));
api.get("/noticias/resumen", envolver(() => panorama.resumen(false)));
api.post("/noticias/resumen", envolver(() => panorama.resumen(true)));
api.get("/correo", envolver(() => correo.recientes(25)));
api.get("/correo/mensaje", envolver((req) => correo.leerCorreo(String(req.query.id || ""))));
const datosCorreo = (b = {}) => {
  const texto = (x, max) => (x == null ? undefined : String(x).slice(0, max));
  return {
    cuenta: b.cuenta === "outlook" ? "outlook" : b.cuenta === "gmail" ? "gmail" : undefined,
    para: texto(b.para, 1000), cc: texto(b.cc, 1000), asunto: texto(b.asunto, 300),
    cuerpo: texto(b.cuerpo, 50000), responder_a: texto(b.responder_a, 300) || undefined,
  };
};
api.post("/correo/borrador", envolver((req) => correo.crearBorrador(datosCorreo(req.body))));
api.post("/correo/enviar", envolver((req) => correo.enviarAhora(datosCorreo(req.body))));

// ---------- Voz natural (ElevenLabs) ----------
api.get("/voz", envolver(() => voz.estadoVoz()));
api.post("/voz/encender", envolver((req) => voz.encenderVoz(Boolean(req.body?.activa))));
api.post("/voz/hablar", async (req, res) => {
  try {
    const audio = await voz.sintetizar(String(req.body?.texto || ""));
    res.set({ "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=86400" }).send(audio);
  } catch (e) {
    console.error("[voz]", e.message);
    res.status(503).json({ error: e.message });
  }
});
api.post(
  "/voz/muestras",
  express.raw({ type: () => true, limit: voz.MAX_MUESTRA }),
  envolver((req) => voz.guardarMuestra(req.body)),
);
api.delete("/voz/muestras", envolver(() => { voz.borrarMuestras(); return voz.estadoVoz(); }));
api.post("/voz/crear", envolver((req) => voz.crearVoz({ nombre: req.body?.nombre, permiso: req.body?.permiso })));
api.delete("/voz", envolver(() => voz.borrarVoz()));

// ---------- Agencia ----------
api.get("/agencia", envolver(() => agencia.tablero()));
api.post("/clientes", envolver((req) => agencia.crearCliente(req.body || {})));
api.get("/clientes/:id", envolver((req) => agencia.fichaCliente(req.params.id)));
api.patch("/clientes/:id", envolver((req) => agencia.actualizarCliente(req.params.id, req.body || {})));
api.get("/cuentas", envolver(() => agencia.cuentas()));
api.post("/clientes/:id/gasto", envolver((req) => agencia.registrarGasto({
  cliente: agencia.clienteRequerido(req.params.id).id, plataforma: req.body?.plataforma, monto: req.body?.monto, mes: req.body?.mes || undefined,
})));
// ---------- Finanzas de la agencia y Pulso ----------
api.get("/finanzas", envolver((req) => finanzas.finanzas(req.query.mes ? String(req.query.mes) : undefined)));
api.get("/pulso", envolver(() => finanzas.pulso()));
api.get("/analitica", envolver((req) => reportes.analitica(req.query.mes ? String(req.query.mes) : undefined)));
api.get("/reportes", envolver((req) => {
  const d = reportes.datosReporte(String(req.query.cliente || ""), req.query.mes ? String(req.query.mes) : undefined);
  return { ...d, html: reportes.htmlReporte(d), link: d.link ? reportes.urlCompleta(d.link) : null };
}));
api.get("/reportes/pagina", (req, res) => {
  try {
    const d = reportes.datosReporte(String(req.query.cliente || ""), req.query.mes ? String(req.query.mes) : undefined);
    res.setHeader("Cache-Control", "no-store");
    res.type("html").send(reportes.paginaReporte(d, { imprimir: req.query.imprimir === "1" }));
  } catch (e) { res.status(400).type("text").send(e.message); }
});
api.patch("/reportes", envolver((req) => reportes.guardarReporte(req.body || {})));
api.post("/reportes/link", envolver((req) => {
  guardarUrlBase(req);
  return reportes.crearLink(req.body || {});
}));
api.delete("/reportes/link", envolver((req) => reportes.quitarLink({ cliente: req.query.cliente, mes: req.query.mes })));
api.get("/crm", envolver((req) => crm.tableroCrm({ cliente: req.query.cliente ? String(req.query.cliente) : undefined, mes: req.query.mes ? String(req.query.mes) : undefined })));
api.post("/crm/prospectos", envolver((req) => crm.crearProspecto(req.body || {})));
api.get("/crm/prospectos/:id", envolver((req) => crm.fichaProspecto(Number(req.params.id))));
api.patch("/crm/prospectos/:id", envolver((req) => {
  const b = req.body || {};
  if (b.mover) return crm.moverProspecto(Number(req.params.id), Number(b.mover));
  return crm.actualizarProspecto(Number(req.params.id), b);
}));
api.delete("/crm/prospectos/:id", envolver((req) => crm.borrarProspecto(Number(req.params.id))));
api.post("/crm/prospectos/:id/nota", envolver((req) => crm.notaProspecto(Number(req.params.id), req.body?.texto)));
api.post("/crm/prospectos/:id/sugerir", envolver((req) => crm.sugerirMensaje(Number(req.params.id), req.body || {})));
api.post("/crm/prospectos/:id/borrador", envolver((req) => crm.guardarBorrador(Number(req.params.id), req.body?.texto)));
api.delete("/crm/borradores/:id", envolver((req) => crm.descartarBorrador(Number(req.params.id))));
// Enviar SIEMPRE lo pide el dueño con un toque en la pantalla; DELTA no tiene herramienta para esto.
api.post("/crm/prospectos/:id/enviar", envolver((req) => crm.enviarWhatsAppProspecto(Number(req.params.id), req.body || {})));
api.post("/crm/prospectos/:id/enviado", envolver((req) => crm.marcarEnviado(Number(req.params.id), req.body || {})));
api.get("/crm/config", envolver((req) => ({ ...crm.configCrm(String(req.query.cliente || "")), whatsapp_token: Boolean(process.env.WHATSAPP_TOKEN) })));
api.put("/crm/config", envolver((req) => crm.configurarCrm(req.body || {})));
api.get("/seo", envolver((req) => seo.tableroSeo({ cliente: req.query.cliente ? String(req.query.cliente) : undefined })));
api.put("/seo/config", envolver((req) => seo.configurarSeo(req.body || {})));
api.post("/seo/revisar", envolver((req) => seo.revisarSitio(req.body?.cliente)));
api.get("/seo/propiedades", envolver(() => seo.propiedades()));
api.get("/seo/google/conectar", envolver((req) => ({ url: seo.urlConexion(req) })));
api.post("/seo/google/desconectar", envolver(() => { seo.desconectarGoogle(); return { ok: true }; }));
api.get("/tendencias", envolver((req) => tendencias.tableroTendencias({ cliente: req.query.cliente ? String(req.query.cliente) : undefined })));
api.put("/tendencias/config", envolver((req) => tendencias.configurarTendencias(req.body || {})));
api.post("/tendencias/buscar", envolver((req) => tendencias.buscarTendencias(req.body?.cliente)));
api.post("/tendencias/ideas/:id/contenido", envolver((req) => tendencias.ideaAContenido(Number(req.params.id), req.body || {})));
api.delete("/tendencias/ideas/:id", envolver((req) => tendencias.descartarIdea(Number(req.params.id))));
api.get("/contenido", envolver((req) => contenido.tableroContenido({ cliente: req.query.cliente ? String(req.query.cliente) : undefined, mes: req.query.mes ? String(req.query.mes) : undefined })));
api.post("/contenido", envolver((req) => contenido.crearContenido(req.body || {})));
api.patch("/contenido/:id", envolver((req) => {
  const b = req.body || {};
  if (b.mover) return contenido.moverContenido(Number(req.params.id), Number(b.mover));
  return contenido.actualizarContenido(Number(req.params.id), b);
}));
api.delete("/contenido/:id", envolver((req) => contenido.borrarContenido(Number(req.params.id))));
api.get("/paidmedia", envolver((req) => paidmedia.paidMedia(req.query.mes ? String(req.query.mes) : undefined)));
api.put("/paidmedia/resultados", envolver((req) => paidmedia.registrarResultados(req.body || {})));
api.delete("/paidmedia/resultados", envolver((req) => paidmedia.borrarResultados({ cliente: req.query.cliente, mes: req.query.mes })));
api.post("/cobros", envolver((req) => finanzas.registrarCobro(req.body || {})));
api.patch("/cobros/:id", envolver((req) => {
  const b = req.body || {};
  if (b.pagado !== undefined) return finanzas.marcarPagado(Number(req.params.id), b.pagado);
  return finanzas.actualizarCobro(Number(req.params.id), b);
}));
api.delete("/cobros/:id", envolver((req) => finanzas.borrarCobro(Number(req.params.id))));
api.post("/gastos", envolver((req) => finanzas.registrarGastoAgencia(req.body || {})));
api.delete("/gastos/:id", envolver((req) => finanzas.borrarGasto(Number(req.params.id))));
// Junta con el cliente: es un evento normal de la agenda, ligado al cliente (avisa igual que los demás).
api.post("/clientes/:id/junta", envolver((req) => {
  const c = agencia.clienteRequerido(req.params.id);
  const titulo = String(req.body?.titulo || "").trim().slice(0, 200) || `Junta con ${c.nombre}`;
  if (!req.body?.inicio) throw new Error("La junta necesita fecha y hora");
  return agenda.crearEvento({ titulo, inicio: String(req.body?.inicio || ""), lugar: req.body?.lugar ? String(req.body.lugar).slice(0, 200) : undefined, cliente: c.nombre });
}));
// Meta: qué páginas, Instagram y cuentas de anuncios encontró DELTA y de qué cliente es cada una.
api.get("/meta", envolver(() => meta.estado()));
api.get("/meta/conectar", envolver((req) => ({ url: meta.urlConexion(req) })));
api.post("/meta/desconectar", envolver(() => { meta.desconectar(); return { ok: true }; }));
api.post("/meta/actualizar", envolver(() => meta.actualizarTodo()));
api.patch("/meta/activos/:id", envolver((req) => meta.ligar(req.params.id, req.body?.cliente_id ?? null)));
api.post("/clientes/:id/meta", envolver(async (req) => {
  const c = agencia.clienteRequerido(req.params.id);
  await meta.sincronizarCliente(c.id);
  return agencia.metaDeCliente(c.id);
}));
api.post("/proyectos", envolver((req) => agencia.crearProyecto(req.body || {})));
api.patch("/proyectos/:id", envolver((req) => agencia.actualizarProyecto(Number(req.params.id), req.body || {})));
api.get("/departamentos", envolver(() => {
  const trabajos = agencia.listarTrabajos({ limite: 100 });
  return DEPARTAMENTOS.map(({ id, nombre, resumen }) => {
    const suyos = trabajos.filter((t) => t.departamento === id);
    return {
      id, nombre, resumen,
      trabajando: suyos.filter((t) => t.estado === "en_proceso").length,
      ultimo: suyos[0] ? { fecha: suyos[0].terminado || suyos[0].creado, estado: suyos[0].estado } : null,
      trabajos: suyos.slice(0, 6).map(({ resultado, ...t }) => ({ ...t, extracto: (resultado || "").slice(0, 200) })),
    };
  });
}));
api.post("/departamentos/:id/encargo", envolver((req) => encargar({
  departamento: req.params.id,
  encargo: String(req.body?.encargo || "").slice(0, 4000),
  cliente: req.body?.cliente || undefined,
  origen: "app",
})));
api.get("/trabajos/:id", envolver((req) => {
  const t = agencia.obtenerTrabajo(req.params.id);
  if (!t) throw new Error("No existe ese trabajo");
  return t;
}));
api.get("/aprobaciones", envolver((req) => agencia.listarAprobaciones({ estado: String(req.query.estado || "pendiente") })));
api.post("/aprobaciones/:id", envolver((req) => agencia.resolverAprobacion(Number(req.params.id), req.body?.decision, req.body?.comentario)));

// ---------- Estudio de diseño ----------
api.get("/diseno", envolver((req) => ({
  piezas: diseno.listarPiezas({ trabajo_id: req.query.trabajo || undefined }),
  higgsfield: higgsfield.estado(),
  puede_renderizar: diseno.puedeRenderizar(),
  habilidades: habilidades.activas().length,
})));
api.delete("/diseno/piezas/:id", envolver((req) => diseno.borrarPieza(req.params.id)));
api.get("/diseno/piezas/:id/zip", (req, res) => {
  try {
    const z = diseno.zipDePieza(req.params.id);
    res.set({ "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${z.nombre}"`, "Cache-Control": "private, no-store" }).send(z.datos);
  } catch (e) { res.status(404).json({ error: e.message }); }
});
api.get("/diseno/piezas/:id/:archivo", (req, res) => {
  const a = diseno.archivoDePieza(req.params.id, req.params.archivo);
  if (!a) return res.status(404).json({ error: "No existe" });
  if (req.query.descargar) res.attachment(`${a.pieza.titulo.replace(/[^\w\sáéíóúñü-]/gi, "").trim() || "diseno"}-${req.params.archivo}`);
  res.set({ "Content-Type": a.tipo, "Cache-Control": "private, max-age=300" }).sendFile(path.resolve(a.ruta));
});
api.get("/diseno/medios/:id", (req, res) => {
  const a = diseno.archivoDeMedio(req.params.id);
  if (!a) return res.status(404).json({ error: "No existe" });
  res.set({ "Content-Type": a.tipo, "Cache-Control": "private, max-age=3600" }).sendFile(path.resolve(a.ruta));
});

// ---------- Habilidades (las skills del dueño) ----------
api.get("/habilidades", envolver(() => habilidades.listar()));
api.post(
  "/habilidades",
  express.raw({ type: () => true, limit: 15 * 1024 * 1024 }),
  envolver((req) => habilidades.importar(req.body, decodeURIComponent(String(req.get("x-nombre") || "")))),
);
api.patch("/habilidades/:nombre", envolver((req) => habilidades.cambiar(req.params.nombre, Boolean(req.body?.activa))));
api.delete("/habilidades/:nombre", envolver((req) => habilidades.borrar(req.params.nombre)));

api.get("/push/llave", envolver(() => ({ llave: llavesPush().publicKey })));
api.post("/push/suscribir", envolver((req) => { guardarSuscripcion(req.body); return { ok: true }; }));
api.post("/salir-de-todo", (_req, res) => {
  seg.cerrarTodas();
  seg.borrarCookie(res);
  res.json({ ok: true });
});
api.post("/push/prueba", envolver(async () => { await avisar("Prueba de aviso. Si ves esto, todo funciona perfecto."); return { ok: true }; }));

// Avisos en tiempo real para la pantalla abierta
api.get("/vivo", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  const quitar = suscribirPantalla((d) => res.write(`data: ${JSON.stringify(d)}\n\n`));
  const latido = setInterval(() => res.write(": ok\n\n"), 25000);
  req.on("close", () => { quitar(); clearInterval(latido); });
});

// Errores al recibir datos (por ejemplo, un archivo demasiado grande).
api.use((err, _req, res, _next) => {
  const grande = err?.type === "entity.too.large";
  res.status(grande ? 413 : 400).json({ error: grande ? "El archivo es demasiado grande." : "No se pudo recibir eso." });
});

app.use("/api", api);

// ---------- App (PWA) ----------
app.use(express.static(path.join(aqui, "..", "public"), { extensions: ["html"] }));
app.get("/salud", (_req, res) => res.json({ ok: true }));

const PUERTO = Number(process.env.PORT || 3000);
app.listen(PUERTO, () => {
  console.log(`DELTA en línea: http://localhost:${PUERTO}`);
  iniciarVigilante();
  iniciarRutinas();
  meta.iniciarMeta();
  reportes.iniciarReportes();
  tendencias.iniciarTendencias();
  seo.iniciarSeo();
});
