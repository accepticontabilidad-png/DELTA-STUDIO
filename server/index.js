// Servidor de DELTA: sirve la app, la API del panel, el chat y el webhook de WhatsApp.
import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, getAjuste, setAjuste } from "./db.js";
import * as agenda from "./agenda.js";
import { hablarConDelta } from "./cerebro.js";
import { iniciarVigilante, suscribirPantalla, avisar } from "./avisos.js";
import { whatsappConfigurado, verificarWebhook, crearReceptorWebhook } from "./whatsapp.js";
import { llavesPush, guardarSuscripcion } from "./push.js";
import { zonaHoraria } from "./tiempo.js";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "1mb" }));

// ---------- Acceso (un solo usuario, protegido con clave) ----------
const CLAVE = process.env.CLAVE_ACCESO || "";
if (!CLAVE) console.warn("⚠️  Falta CLAVE_ACCESO: la app quedará abierta a cualquiera que tenga el enlace.");
const tokenValido = () => crypto.createHmac("sha256", CLAVE || "sin-clave").update("delta-v1").digest("hex");

function protegido(req, res, next) {
  if (!CLAVE) return next();
  const t = (req.headers.authorization || "").replace(/^Bearer /, "") || req.query.token;
  if (t && t.length === tokenValido().length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(tokenValido()))) return next();
  res.status(401).json({ error: "No autorizado" });
}

app.post("/api/entrar", (req, res) => {
  const clave = String(req.body?.clave || "");
  const a = crypto.createHash("sha256").update(clave).digest();
  const b = crypto.createHash("sha256").update(CLAVE).digest();
  if (!CLAVE || crypto.timingSafeEqual(a, b)) return res.json({ token: tokenValido() });
  res.status(401).json({ error: "Clave incorrecta" });
});

// ---------- WhatsApp ----------
app.get("/webhook/whatsapp", verificarWebhook);
app.post("/webhook/whatsapp", crearReceptorWebhook(hablarConDelta));

// ---------- API del panel ----------
const api = express.Router();
api.use(protegido);

const envolver = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
};

api.post("/chat", envolver(async (req) => {
  const texto = String(req.body?.texto || "").trim();
  if (!texto) throw new Error("Mensaje vacío");
  const respuesta = await hablarConDelta(texto, req.body?.canal === "voz" ? "voz" : "app");
  return { respuesta };
}));

api.get("/historial", envolver(() =>
  db.prepare("SELECT rol, texto, canal, fecha FROM conversacion ORDER BY id DESC LIMIT 40").all().reverse(),
));

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

api.get("/push/llave", envolver(() => ({ llave: llavesPush().publicKey })));
api.post("/push/suscribir", envolver((req) => { guardarSuscripcion(req.body); return { ok: true }; }));
api.post("/push/prueba", envolver(async () => { await avisar("Prueba de aviso. Todo en orden, señor."); return { ok: true }; }));

// Avisos en tiempo real para la pantalla abierta
api.get("/vivo", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  const quitar = suscribirPantalla((d) => res.write(`data: ${JSON.stringify(d)}\n\n`));
  const latido = setInterval(() => res.write(": ok\n\n"), 25000);
  req.on("close", () => { quitar(); clearInterval(latido); });
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
