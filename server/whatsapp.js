// Conexión con WhatsApp (WhatsApp Cloud API de Meta).
// Variables necesarias:
//   WHATSAPP_TOKEN            token de acceso permanente de la app de Meta
//   WHATSAPP_PHONE_ID         id del número de WhatsApp Business que usa DELTA
//   WHATSAPP_VERIFY_TOKEN     palabra secreta para validar el webhook
//   WHATSAPP_APP_SECRET       "secreto de la app" de Meta: con él se comprueba que cada mensaje viene de verdad de Meta
//   WHATSAPP_MI_NUMERO        tu número personal (solo se atiende a este número), ej. 5215512345678
//   WHATSAPP_PLANTILLA        (opcional) plantilla aprobada para avisos fuera de la ventana de 24 h
//   WHATSAPP_PLANTILLA_IDIOMA (opcional) idioma de la plantilla, por defecto es_MX
import crypto from "node:crypto";
import { getAjuste, setAjuste } from "./db.js";

const API = "https://graph.facebook.com/v21.0";

export const whatsappConfigurado = () =>
  Boolean(
    process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID && process.env.WHATSAPP_MI_NUMERO && process.env.WHATSAPP_APP_SECRET,
  );

const iguales = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/**
 * Comprueba la firma que Meta pone en cada mensaje (cabecera X-Hub-Signature-256).
 * Sin esto, cualquiera podría fingir ser tu número y darle órdenes a DELTA.
 */
export function firmaValida(cuerpoOriginal, firma, secreto = process.env.WHATSAPP_APP_SECRET) {
  if (!secreto || !cuerpoOriginal || !firma) return false;
  const esperada = "sha256=" + crypto.createHmac("sha256", secreto).update(cuerpoOriginal).digest("hex");
  return iguales(esperada, firma);
}

// Meta a veces reenvía el mismo mensaje; lo atendemos una sola vez.
const vistos = new Set();
function yaVisto(id) {
  if (!id) return false;
  if (vistos.has(id)) return true;
  vistos.add(id);
  if (vistos.size > 500) vistos.delete(vistos.values().next().value);
  return false;
}

const soloDigitos = (n) => String(n || "").replace(/\D/g, "");

async function llamar(cuerpo) {
  const r = await fetch(`${API}/${process.env.WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", ...cuerpo }),
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(datos?.error?.message || `WhatsApp respondió ${r.status}`);
  return datos;
}

/**
 * Envía texto a tu WhatsApp. WhatsApp solo permite texto libre dentro de las 24 h
 * siguientes a tu último mensaje; fuera de esa ventana se usa la plantilla aprobada.
 */
export async function enviarWhatsApp(texto) {
  if (!whatsappConfigurado()) return false;
  const para = soloDigitos(process.env.WHATSAPP_MI_NUMERO);
  const ultimo = Number(getAjuste("whatsapp_ultimo_mensaje", 0));
  const dentroVentana = Date.now() - ultimo < 23.5 * 3600 * 1000;

  if (dentroVentana || !process.env.WHATSAPP_PLANTILLA) {
    await llamar({ to: para, type: "text", text: { body: texto.slice(0, 4000) } });
  } else {
    await llamar({
      to: para,
      type: "template",
      template: {
        name: process.env.WHATSAPP_PLANTILLA,
        language: { code: process.env.WHATSAPP_PLANTILLA_IDIOMA || "es_MX" },
        components: [{ type: "body", parameters: [{ type: "text", text: texto.slice(0, 1000) }] }],
      },
    });
  }
  return true;
}

/** Verificación del webhook (Meta lo llama una vez al configurarlo). */
export function verificarWebhook(req, res) {
  const { "hub.mode": modo, "hub.verify_token": token, "hub.challenge": reto } = req.query;
  if (modo === "subscribe" && process.env.WHATSAPP_VERIFY_TOKEN && iguales(token || "", process.env.WHATSAPP_VERIFY_TOKEN)) {
    return res.status(200).type("text/plain").send(String(reto).replace(/[^0-9A-Za-z_-]/g, ""));
  }
  return res.sendStatus(403);
}

/** Mensajes entrantes de WhatsApp. Solo atiende a tu número. */
export function crearReceptorWebhook(responder) {
  return async (req, res) => {
    if (!firmaValida(req.cuerpoOriginal, req.get("X-Hub-Signature-256"))) {
      console.warn("[whatsapp] mensaje rechazado: firma no válida");
      return res.sendStatus(401);
    }
    res.sendStatus(200); // Meta exige respuesta rápida; procesamos después.
    try {
      const cambios = req.body?.entry?.flatMap((e) => e.changes || []) || [];
      for (const c of cambios) {
        for (const m of c.value?.messages || []) {
          if (soloDigitos(m.from) !== soloDigitos(process.env.WHATSAPP_MI_NUMERO)) continue;
          if (yaVisto(m.id)) continue;
          setAjuste("whatsapp_ultimo_mensaje", Date.now());
          let texto = m.text?.body;
          if (!texto && m.type === "audio") {
            await enviarWhatsApp("Por aquí todavía solo te entiendo por texto. Las notas de voz ya vienen; mientras, escríbeme o háblame en la app.");
            continue;
          }
          if (!texto) continue;
          const respuesta = await responder(texto, "whatsapp");
          await enviarWhatsApp(respuesta);
        }
      }
    } catch (e) {
      console.error("[whatsapp]", e.message);
    }
  };
}
