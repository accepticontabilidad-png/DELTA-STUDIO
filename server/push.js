// Notificaciones al celular/PC a través de la app instalada (Web Push).
import * as webpush from "web-push";
import { db, getAjuste, setAjuste } from "./db.js";

// Las llaves se generan solas la primera vez y se guardan en la base de datos.
let llaves = null;
export function llavesPush() {
  if (llaves) return llaves;
  const pub = process.env.VAPID_PUBLIC_KEY || getAjuste("vapid_publica");
  const priv = process.env.VAPID_PRIVATE_KEY || getAjuste("vapid_privada");
  if (pub && priv) llaves = { publicKey: pub, privateKey: priv };
  else {
    llaves = webpush.generateVAPIDKeys();
    setAjuste("vapid_publica", llaves.publicKey);
    setAjuste("vapid_privada", llaves.privateKey);
  }
  webpush.setVapidDetails(process.env.VAPID_CONTACTO || "mailto:avisos@delta.local", llaves.publicKey, llaves.privateKey);
  return llaves;
}

export function guardarSuscripcion(sub) {
  if (!sub?.endpoint) throw new Error("Suscripción no válida");
  db.prepare("INSERT INTO suscripciones_push (endpoint, datos) VALUES (?, ?) ON CONFLICT(endpoint) DO UPDATE SET datos = excluded.datos")
    .run(sub.endpoint, JSON.stringify(sub));
}

export async function enviarPush(titulo, cuerpo) {
  llavesPush();
  const subs = db.prepare("SELECT endpoint, datos FROM suscripciones_push").all();
  let enviados = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification(JSON.parse(s.datos), JSON.stringify({ titulo, cuerpo }));
      enviados++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) db.prepare("DELETE FROM suscripciones_push WHERE endpoint = ?").run(s.endpoint);
      else console.error("[push]", e.message);
    }
  }
  return enviados;
}
