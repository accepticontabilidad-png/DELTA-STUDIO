// Medidor de gasto de la API de Claude: anota lo que cuesta cada llamada, suma lo del mes
// y frena a DELTA antes de pasar el tope que el dueño fija en Ajustes.
import { db, getAjuste, setAjuste } from "./db.js";
import { ahoraLocalISO } from "./tiempo.js";
import { avisar } from "./avisos.js";

db.exec(`
CREATE TABLE IF NOT EXISTS gasto_api (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  mes TEXT NOT NULL,                 -- AAAA-MM en la zona horaria del dueño
  origen TEXT NOT NULL,              -- chat | departamento id
  modelo TEXT NOT NULL,
  entrada INTEGER NOT NULL DEFAULT 0,
  salida INTEGER NOT NULL DEFAULT 0,
  cache_escritura INTEGER NOT NULL DEFAULT 0,
  cache_lectura INTEGER NOT NULL DEFAULT 0,
  busquedas INTEGER NOT NULL DEFAULT 0,
  costo REAL NOT NULL                -- dólares
);
CREATE INDEX IF NOT EXISTS gasto_api_mes ON gasto_api (mes);
`);

// Precios por millón de tokens (USD), lista pública de Anthropic (nov 2026).
// lectura = tokens leídos de la caché; la escritura de caché cuesta 1.25 veces la entrada.
export const PRECIOS = {
  "claude-opus-5-5": { entrada: 4, salida: 20, lectura: 0.2 },
  "claude-opus-5": { entrada: 5, salida: 25, lectura: 0.5 },
  "claude-opus-4-8": { entrada: 5, salida: 25, lectura: 0.5 },
  "claude-opus-4-7": { entrada: 5, salida: 25, lectura: 0.5 },
  "claude-opus-4-6": { entrada: 5, salida: 25, lectura: 0.5 },
  "claude-sonnet-5-5": { entrada: 2, salida: 10, lectura: 0.1 },
  "claude-sonnet-5": { entrada: 2, salida: 10, lectura: 0.2 },
  "claude-sonnet-4-6": { entrada: 3, salida: 15, lectura: 0.3 },
  "claude-haiku-5-5": { entrada: 0.1, salida: 0.5, lectura: 0.01, largo: { umbral: 100_000, entrada: 0.5, salida: 2.5, lectura: 0.05 } },
  "claude-haiku-4-5": { entrada: 1, salida: 5, lectura: 0.1 },
  "claude-fable-5-2": { entrada: 8, salida: 40, lectura: 0.2 },
};
const PRECIO_DESCONOCIDO = { entrada: 8, salida: 40, lectura: 0.8 }; // si aparece un modelo nuevo, se cuenta caro para no quedarse cortos
const POR_BUSQUEDA = 0.01; // búsqueda web: 10 USD por cada mil

export const MODELO_ECONOMICO = process.env.DELTA_MODELO_ECONOMICO || "claude-haiku-5-5";
const TOPE_INICIAL = Number(process.env.DELTA_TOPE_USD) || 90;
const RESERVA = 0.5; // se deja de empezar trabajo nuevo cuando faltan menos de 50 centavos

function precioDe(modelo = "") {
  const base = Object.keys(PRECIOS).sort((a, b) => b.length - a.length).find((k) => modelo.startsWith(k));
  return base ? PRECIOS[base] : PRECIO_DESCONOCIDO;
}

/** Costo en dólares de una respuesta de la API, según su modelo y sus tokens. */
export function costoDe(modelo, u = {}) {
  let p = precioDe(modelo);
  const entrada = u.input_tokens || 0;
  const escritura = u.cache_creation_input_tokens || 0;
  const lectura = u.cache_read_input_tokens || 0;
  if (p.largo && entrada + escritura + lectura > p.largo.umbral) p = p.largo;
  const busquedas = u.server_tool_use?.web_search_requests || 0;
  return (entrada * p.entrada + escritura * p.entrada * 1.25 + lectura * p.lectura + (u.output_tokens || 0) * p.salida) / 1e6 + busquedas * POR_BUSQUEDA;
}

export const mesActual = () => ahoraLocalISO().slice(0, 7);

export function tope() {
  const t = Number(getAjuste("gasto_tope", TOPE_INICIAL));
  return Number.isFinite(t) && t >= 0 ? t : TOPE_INICIAL;
}

const ajusteDelMes = (mes = mesActual()) => Number(getAjuste(`gasto_previo_${mes}`, 0)) || 0;

export function gastadoDelMes(mes = mesActual()) {
  const { total } = db.prepare("SELECT COALESCE(SUM(costo), 0) total FROM gasto_api WHERE mes = ?").get(mes);
  return total + ajusteDelMes(mes);
}

/** ¿Se puede empezar algo nuevo sin riesgo de pasar el tope? */
export function hayPresupuesto() {
  return gastadoDelMes() + RESERVA < tope();
}

/** ¿Ya se llegó al tope? (para cortar a media tarea) */
export const topeAlcanzado = () => gastadoDelMes() >= tope();

export class SinPresupuesto extends Error {
  constructor() {
    super(`Se llegó al tope de gasto del mes (${usd(tope())}).`);
    this.name = "SinPresupuesto";
  }
}

export const usd = (n) => `USD ${(Math.round(n * 100) / 100).toFixed(2)}`;

/** Anota una respuesta de la API. */
export function registrar(origen, mensaje) {
  if (!mensaje?.usage) return 0;
  const u = mensaje.usage;
  const modelo = mensaje.model || "desconocido";
  const costo = costoDe(modelo, u);
  db.prepare(
    "INSERT INTO gasto_api (mes, origen, modelo, entrada, salida, cache_escritura, cache_lectura, busquedas, costo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(mesActual(), origen, modelo, u.input_tokens || 0, u.output_tokens || 0, u.cache_creation_input_tokens || 0, u.cache_read_input_tokens || 0, u.server_tool_use?.web_search_requests || 0, costo);
  revisarAvisos();
  return costo;
}

/** Avisa una sola vez al mes al pasar el 80 % y al llegar al tope. */
export function revisarAvisos() {
  const mes = mesActual();
  const t = tope();
  if (!t) return;
  const g = gastadoDelMes(mes);
  const enviar = (clave, texto) => {
    if (getAjuste(clave)) return;
    setAjuste(clave, "si");
    avisar(texto, "Gasto de DELTA").catch((e) => console.error("[gasto]", e));
  };
  if (!hayPresupuesto()) enviar(`gasto_aviso_tope_${mes}_${t}`, `Llegamos al tope de gasto de este mes (${usd(g)} de ${usd(t)}). Dejé de usar a Claude para no pasarme. Si quiere seguir, suba el tope en Ajustes.`);
  else if (g >= t * 0.8) enviar(`gasto_aviso_80_${mes}_${t}`, `Ojo: ya va el ${Math.round((g / t) * 100)} % del tope del mes (${usd(g)} de ${usd(t)}). Desde ahora uso el modelo económico para casi todo.`);
}

/**
 * Corre un toolRunner contando cada llamada a la API y cortando si se llega al tope.
 * Devuelve el último mensaje y si se cortó por presupuesto.
 */
export async function correrConMedidor(cliente, origen, params) {
  if (!hayPresupuesto()) throw new SinPresupuesto();
  const runner = cliente.beta.messages.toolRunner(params);
  let ultimo = null;
  let cortado = false;
  for await (const mensaje of runner) {
    ultimo = mensaje;
    registrar(origen, mensaje);
    if (mensaje.stop_reason === "tool_use" && topeAlcanzado()) { cortado = true; break; }
  }
  return { final: ultimo, cortado };
}

// ---------- Ajustes ----------
export const MODOS = ["auto", "fuerte", "economico"];
export const modoModelo = () => (MODOS.includes(getAjuste("modelo_modo")) ? getAjuste("modelo_modo") : "auto");

export function guardarAjustes({ tope: nuevoTope, ya_gastado, modo } = {}) {
  if (nuevoTope !== undefined && nuevoTope !== "") {
    const t = Number(nuevoTope);
    if (!Number.isFinite(t) || t < 0 || t > 10000) throw new Error("El tope debe ser un número entre 0 y 10,000 dólares");
    setAjuste("gasto_tope", Math.round(t * 100) / 100);
  }
  if (ya_gastado !== undefined && ya_gastado !== "") {
    // El dueño escribe lo que dice la consola de Claude para este mes; se guarda la diferencia.
    const real = Number(ya_gastado);
    if (!Number.isFinite(real) || real < 0) throw new Error("Lo gastado debe ser un número de dólares");
    const mes = mesActual();
    const medido = gastadoDelMes(mes) - ajusteDelMes(mes);
    setAjuste(`gasto_previo_${mes}`, Math.max(0, real - medido));
  }
  if (modo !== undefined) {
    if (!MODOS.includes(modo)) throw new Error("Modo de modelo no válido");
    setAjuste("modelo_modo", modo);
  }
  revisarAvisos();
  return estado();
}

const NOMBRE_MODELO = (m) => (/haiku/.test(m) ? "Económico (Haiku)" : /sonnet/.test(m) ? "Departamentos (Sonnet)" : /opus/.test(m) ? "Fuerte (Opus)" : m);

export function estado() {
  const mes = mesActual();
  const t = tope();
  const g = gastadoDelMes(mes);
  const porModelo = db.prepare("SELECT modelo, SUM(costo) costo, COUNT(*) llamadas FROM gasto_api WHERE mes = ? GROUP BY modelo ORDER BY costo DESC").all(mes);
  const porOrigen = db.prepare("SELECT origen, SUM(costo) costo, COUNT(*) llamadas FROM gasto_api WHERE mes = ? GROUP BY origen ORDER BY costo DESC").all(mes);
  const hoy = db.prepare("SELECT COALESCE(SUM(costo), 0) c FROM gasto_api WHERE mes = ? AND fecha >= ?").get(mes, new Date(Date.now() - 864e5).toISOString()).c;
  const juntar = (filas, nombre) => {
    const mapa = new Map();
    for (const f of filas) {
      const k = nombre(f);
      const a = mapa.get(k) || { nombre: k, costo: 0, llamadas: 0 };
      a.costo += f.costo; a.llamadas += f.llamadas;
      mapa.set(k, a);
    }
    return [...mapa.values()].map((a) => ({ ...a, costo: Math.round(a.costo * 10000) / 10000 }));
  };
  return {
    mes,
    gastado: Math.round(g * 10000) / 10000,
    tope: t,
    porcentaje: t ? Math.min(100, Math.round((g / t) * 1000) / 10) : 100,
    bloqueado: !hayPresupuesto(),
    ahorro: g >= t * 0.8,
    ultimas_24h: Math.round(hoy * 10000) / 10000,
    ajuste_manual: Math.round(ajusteDelMes(mes) * 100) / 100,
    modo: modoModelo(),
    por_modelo: juntar(porModelo, (f) => NOMBRE_MODELO(f.modelo)),
    por_origen: juntar(porOrigen, (f) => (f.origen === "chat" ? "Conversación con DELTA" : `Departamento: ${f.origen}`)),
  };
}
