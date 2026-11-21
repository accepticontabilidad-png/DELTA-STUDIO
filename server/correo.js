// Correo: Gmail y Hotmail/Outlook, cada uno en su propia bandeja. Este módulo reparte cada pedido a la cuenta que toca.
// Los ids de Hotmail llevan el prefijo "o:" para saber a qué cuenta pertenece cada correo o borrador.
import * as gmail from "./gmail.js";
import * as outlook from "./outlook.js";

const PREFIJO_OUTLOOK = "o:";
export const NOMBRES = { gmail: "Gmail", outlook: "Hotmail" };

const proveedores = {
  gmail: { mod: gmail, conectado: gmail.gmailConectado, disponible: gmail.gmailDisponible, cuenta: gmail.cuentaGmail },
  outlook: { mod: outlook, conectado: outlook.outlookConectado, disponible: outlook.outlookDisponible, cuenta: outlook.cuentaOutlook },
};

export function estado() {
  const r = {};
  for (const [k, p] of Object.entries(proveedores)) r[k] = { disponible: p.disponible(), conectado: p.conectado(), cuenta: p.cuenta() || null };
  return r;
}
export const conectados = () => Object.keys(proveedores).filter((k) => proveedores[k].conectado());

/** Separa "o:ABC" → { origen: "outlook", id: "ABC" }; un id sin prefijo es de Gmail. */
export function separarId(id) {
  const s = String(id || "");
  return s.startsWith(PREFIJO_OUTLOOK) ? { origen: "outlook", id: s.slice(PREFIJO_OUTLOOK.length) } : { origen: "gmail", id: s };
}
const unirId = (origen, id) => (origen === "outlook" ? PREFIJO_OUTLOOK + id : id);

const etiquetar = (origen) => (m) => ({ ...m, id: unirId(origen, m.id), origen, cuenta: proveedores[origen].cuenta() || NOMBRES[origen] });

function cuentasPedidas(cuenta) {
  const activas = conectados();
  if (!activas.length) throw new Error("No hay correo conectado. Conecte Gmail o Hotmail en Ajustes ⚙.");
  if (!cuenta || cuenta === "ambas") return activas;
  if (!proveedores[cuenta]) throw new Error("Cuenta no válida: use gmail, outlook o ambas");
  if (!proveedores[cuenta].conectado()) throw new Error(`${NOMBRES[cuenta]} no está conectado. Conéctelo en Ajustes ⚙.`);
  return [cuenta];
}

/** Pide lo mismo a varias cuentas y lo devuelve SEPARADO por cuenta. Si una falla, se avisa y sigue con la otra. */
async function porCuenta(cuentas, llamar) {
  const res = await Promise.allSettled(cuentas.map((k) => llamar(proveedores[k].mod, k)));
  const salida = {};
  res.forEach((r, i) => {
    const k = cuentas[i];
    const base = { nombre: NOMBRES[k], cuenta: proveedores[k].cuenta() || null };
    if (r.status === "fulfilled") salida[k] = { ...base, correos: (r.value?.correos || []).map(etiquetar(k)) };
    else salida[k] = { ...base, correos: [], error: String(r.reason?.message || r.reason) };
  });
  const errores = Object.values(salida).filter((c) => c.error);
  if (errores.length && errores.length === cuentas.length) throw new Error(errores.map((c) => c.error).join(" · "));
  return salida;
}

/** Busca en una cuenta o en las dos; el resultado viene separado por cuenta. La consulta usa la sintaxis de Gmail; para Hotmail se traduce lo básico. */
export async function buscarCorreos({ cuenta, consulta, max = 10 } = {}) {
  const n = Math.max(1, Math.min(25, Number(max) || 10));
  return porCuenta(cuentasPedidas(cuenta), (mod, k) => mod.buscarCorreos({ consulta: consulta || (k === "gmail" ? "in:inbox newer_than:2d" : ""), max: n }));
}

/** Las bandejas del panel, cada cuenta por su lado: lo de los últimos 2 días. */
export async function recientes(max = 20) {
  const est = estado();
  const activas = conectados();
  const datos = activas.length
    ? await porCuenta(activas, (mod, k) => mod.buscarCorreos({ consulta: k === "gmail" ? "in:inbox newer_than:2d" : "", max })).catch((e) =>
      Object.fromEntries(activas.map((k) => [k, { correos: [], error: e.message }])))
    : {};
  const cuentas = {};
  for (const k of Object.keys(proveedores)) {
    cuentas[k] = { nombre: NOMBRES[k], conectado: est[k].conectado, disponible: est[k].disponible, cuenta: est[k].cuenta, correos: [], ...(datos[k] || {}) };
  }
  return { conectado: activas.length > 0, cuentas };
}

export async function leerCorreo(idCompleto) {
  const { origen, id } = separarId(idCompleto);
  if (!proveedores[origen].conectado()) throw new Error(`${NOMBRES[origen]} no está conectado.`);
  return etiquetar(origen)(await proveedores[origen].mod.leerCorreo(id));
}

/** Guarda un borrador. Si responde a un correo, va en la misma cuenta; si no, en la que se pida (o la primera conectada). */
export async function crearBorrador({ cuenta, responder_a, ...resto }) {
  let origen;
  let original;
  if (responder_a) ({ origen, id: original } = separarId(responder_a));
  else origen = cuentasPedidas(cuenta)[0];
  if (!proveedores[origen].conectado()) throw new Error(`${NOMBRES[origen]} no está conectado.`);
  const r = await proveedores[origen].mod.crearBorrador({ ...resto, responder_a: original });
  return { ...r, borrador_id: unirId(origen, r.borrador_id), desde: proveedores[origen].cuenta() || NOMBRES[origen] };
}

export async function enviarBorrador(idCompleto) {
  const { origen, id } = separarId(idCompleto);
  if (!proveedores[origen].conectado()) throw new Error(`${NOMBRES[origen]} no está conectado.`);
  const r = await proveedores[origen].mod.enviarBorrador(id);
  return { ...r, desde: proveedores[origen].cuenta() || NOMBRES[origen] };
}

/** Para el resumen de la mañana: no leídos de las últimas 24 h, separados por cuenta. */
export async function pendientesDeHoy() {
  const cuentas = conectados();
  if (!cuentas.length) return null;
  return porCuenta(cuentas, (mod) => mod.pendientesDeHoy());
}
