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
import * as correo from "./gmail.js";
import * as mercados from "./mercados.js";

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
app.post("/webhook/whatsapp", crearReceptorWebhook(hablarConDelta));

// ---------- Gmail: Google regresa aquí después de que el usuario da permiso ----------
// (Llega desde Google, así que no trae la cookie; se valida con el "estado" de un solo uso.)
app.get("/oauth/google", async (req, res) => {
  try {
    const cuenta = await correo.terminarConexion(req);
    avisar(`Gmail conectado${cuenta ? ` (${cuenta})` : ""}. Ya puedo leer y ordenar su correo, señor.`, "Correo").catch(() => {});
    res.redirect("/?gmail=ok");
  } catch (e) {
    console.error("[gmail]", e.message);
    res.redirect("/?gmail=error&motivo=" + encodeURIComponent(e.message.slice(0, 200)));
  }
});

// ---------- API del panel ----------
const api = express.Router();
api.use(seg.protegido);

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
  return { respuesta, hizo_cambio: Boolean(info.hizoCambio) };
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

api.get("/panel", envolver(() => {
  const hoy = agenda.resumenDelDia();
  return {
    zona_horaria: zonaHoraria(),
    hora_resumen: getAjuste("hora_resumen", process.env.HORA_RESUMEN || "08:00"),
    tareas: agenda.listarTareas({ estado: "pendiente" }),
    eventos: agenda.listarEventos({}),
    recordatorios: agenda.listarRecordatorios(),
    memorias: agenda.listarMemorias(),
    avisos: db.prepare("SELECT * FROM avisos ORDER BY id DESC LIMIT 10").all(),
    hoy: { eventos: hoy.eventos.length, vencidas: hoy.tareas_vencidas.length, pendientes: hoy.total_pendientes },
    conexiones: {
      cerebro: Boolean(process.env.ANTHROPIC_API_KEY),
      whatsapp: whatsappConfigurado(),
      push: db.prepare("SELECT COUNT(*) n FROM suscripciones_push").get().n > 0,
      calendario: true,
      gmail: correo.gmailConectado(),
      gmail_disponible: correo.gmailDisponible(),
      gmail_cuenta: correo.cuentaGmail(),
    },
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

api.get("/gmail/conectar", envolver((req) => ({ url: correo.urlConexion(req) })));
api.post("/gmail/desconectar", envolver(() => { correo.desconectar(); return { ok: true }; }));
api.get("/mercados", envolver(() => mercados.verMercados(null, "dia")));

api.get("/push/llave", envolver(() => ({ llave: llavesPush().publicKey })));
api.post("/push/suscribir", envolver((req) => { guardarSuscripcion(req.body); return { ok: true }; }));
api.post("/salir-de-todo", (_req, res) => {
  seg.cerrarTodas();
  seg.borrarCookie(res);
  res.json({ ok: true });
});
api.post("/push/prueba", envolver(async () => { await avisar("Prueba de aviso. Todo en orden, señor."); return { ok: true }; }));

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
  res.status(grande ? 413 : 400).json({ error: grande ? "El archivo pesa más de 10 MB." : "No se pudo recibir eso." });
});

app.use("/api", api);

// ---------- App (PWA) ----------
app.use(express.static(path.join(aqui, "..", "public"), { extensions: ["html"] }));
app.get("/salud", (_req, res) => res.json({ ok: true }));

const PUERTO = Number(process.env.PORT || 3000);
app.listen(PUERTO, () => {
  console.log(`DELTA en línea: http://localhost:${PUERTO}`);
  iniciarVigilante();
});
