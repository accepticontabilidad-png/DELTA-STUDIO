// Bolsa y mercados: cotizaciones gratuitas (Yahoo Finance, sin clave) y lista de seguimiento.
// DELTA solo informa: nunca compra ni vende.
import { getAjuste, setAjuste } from "./db.js";
import { conCache } from "./cache.js";

const UA = { "User-Agent": "Mozilla/5.0 (DELTA asistente)" };

export const LISTA_INICIAL = [
  { simbolo: "^GSPC", nombre: "S&P 500" },
  { simbolo: "^IXIC", nombre: "Nasdaq" },
  { simbolo: "^MXX", nombre: "IPC Bolsa Mexicana" },
  { simbolo: "MXN=X", nombre: "Dólar / peso" },
  { simbolo: "AAPL", nombre: "Apple" },
  { simbolo: "MSFT", nombre: "Microsoft" },
  { simbolo: "NVDA", nombre: "Nvidia" },
  { simbolo: "AMZN", nombre: "Amazon" },
  { simbolo: "WALMEX.MX", nombre: "Walmart de México" },
  { simbolo: "BTC-USD", nombre: "Bitcoin" },
];

export function lista() {
  try {
    const l = JSON.parse(getAjuste("lista_mercados", "null"));
    if (Array.isArray(l)) return l;
  } catch {}
  return LISTA_INICIAL;
}

const limpiar = (s) => String(s || "").trim().toUpperCase();

export function agregar(simbolo, nombre) {
  const s = limpiar(simbolo);
  if (!/^[\^A-Z0-9.=\-]{1,20}$/.test(s)) throw new Error("Símbolo no válido");
  const l = lista().filter((x) => x.simbolo !== s);
  l.push({ simbolo: s, nombre: String(nombre || s).slice(0, 60) });
  if (l.length > 40) throw new Error("La lista ya tiene 40 símbolos; quite alguno primero");
  setAjuste("lista_mercados", JSON.stringify(l));
  return l;
}

export function quitar(simbolo) {
  const s = limpiar(simbolo);
  const antes = lista();
  const l = antes.filter((x) => x.simbolo !== s);
  if (l.length === antes.length) throw new Error(`${s} no está en la lista`);
  setAjuste("lista_mercados", JSON.stringify(l));
  return l;
}

const pct = (a, b) => (b ? Math.round(((a - b) / b) * 10000) / 100 : null);

/** Convierte la respuesta de Yahoo en un resumen sencillo. Separado para poder probarlo. */
export function interpretarGrafica(json, nombre) {
  const r = json?.chart?.result?.[0];
  if (!r) throw new Error(json?.chart?.error?.description || "Sin datos");
  const m = r.meta || {};
  // Cierres por día de bolsa (con su fecha), sin huecos.
  const ts = r.timestamp || [];
  const crudos = r.indicators?.quote?.[0]?.close || [];
  const off = Number(m.gmtoffset) || 0;
  const diaDe = (t) => Math.floor((t + off) / 86400);
  const filas = ts.map((t, i) => ({ dia: diaDe(t), c: crudos[i] })).filter((f) => typeof f.c === "number");
  const cierres = filas.map((f) => f.c);
  const precio = m.regularMarketPrice ?? cierres.at(-1);
  // Cierre anterior = último cierre de un día ANTERIOR al de la cotización actual.
  // (Si se toma "el penúltimo de la lista" y hoy aún no tiene barra, se compara contra hace 2 días.)
  const hoy = m.regularMarketTime ? diaDe(m.regularMarketTime) : filas.at(-1)?.dia;
  const previos = filas.filter((f) => f.dia < hoy);
  const anterior = previos.length ? previos.at(-1).c : m.chartPreviousClose ?? m.previousClose;
  const inicio = cierres[0];
  const red = (x) => (typeof x === "number" ? Math.round(x * 100) / 100 : null);
  return {
    simbolo: m.symbol,
    nombre: nombre || m.shortName || m.longName || m.symbol,
    precio: red(precio),
    moneda: m.currency || "",
    cambio_dia_pct: pct(precio, anterior),
    cambio_periodo_pct: pct(precio, inicio),
    max_52s: red(m.fiftyTwoWeekHigh),
    min_52s: red(m.fiftyTwoWeekLow),
    hora: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null,
  };
}

const RANGOS = { dia: "5d", semana: "5d", mes: "1mo", "3meses": "3mo", anio: "1y", "5anios": "5y" };

export function cotizacion(simbolo, periodo = "mes", nombre) {
  // Un minuto de memoria: varias pantallas y la alerta de bolsa comparten la misma consulta.
  return conCache(`bolsa:${limpiar(simbolo)}:${periodo}:${nombre || ""}`, 60e3, () => cotizacionDirecta(simbolo, periodo, nombre));
}

async function pedirYahoo(simbolo, rango, intervalo = "1d") {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(limpiar(simbolo))}?range=${rango}&interval=${intervalo}`;
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(10000) });
  if (!r.ok && r.status !== 404) throw new Error(`El servicio de bolsa respondió ${r.status}`);
  return r.json();
}

async function cotizacionDirecta(simbolo, periodo, nombre) {
  return { ...interpretarGrafica(await pedirYahoo(simbolo, RANGOS[periodo] || "1mo"), nombre), periodo };
}

// ---------- Tablero de bolsa (velas, series y tipos) ----------

/** Qué es cada símbolo, para agrupar en el tablero. */
export function tipoDe(simbolo) {
  const s = limpiar(simbolo);
  if (s.startsWith("^")) return "Índice";
  if (s.endsWith("=X")) return "Divisa";
  if (/-(USD|MXN|EUR)$/.test(s)) return "Cripto";
  if (s.endsWith("=F")) return "Materia prima";
  return "Acción";
}

/** Convierte la respuesta de Yahoo en velas (apertura, máximo, mínimo, cierre y volumen). */
export function interpretarVelas(json, nombre) {
  const r = json?.chart?.result?.[0];
  if (!r) throw new Error(json?.chart?.error?.description || "Sin datos");
  const m = r.meta || {};
  const q = r.indicators?.quote?.[0] || {};
  const red = (x) => Math.round(x * 10000) / 10000;
  const velas = (r.timestamp || [])
    .map((t, i) => ({ t: t * 1000, o: q.open?.[i], h: q.high?.[i], l: q.low?.[i], c: q.close?.[i], v: q.volume?.[i] || 0 }))
    .filter((x) => [x.o, x.h, x.l, x.c].every((n) => typeof n === "number"))
    .map((x) => ({ t: x.t, o: red(x.o), h: red(x.h), l: red(x.l), c: red(x.c), v: x.v }));
  return {
    simbolo: m.symbol,
    nombre: nombre || m.shortName || m.longName || m.symbol,
    moneda: m.currency || "",
    precio: m.regularMarketPrice ?? velas.at(-1)?.c ?? null,
    anterior: m.chartPreviousClose ?? m.previousClose ?? null,
    max_52s: m.fiftyTwoWeekHigh ?? null,
    min_52s: m.fiftyTwoWeekLow ?? null,
    velas,
  };
}

export const PERIODOS_VELAS = { hoy: ["1d", "5m"], "5d": ["5d", "30m"], "1m": ["1mo", "1d"], "3m": ["3mo", "1d"], "6m": ["6mo", "1d"], "1a": ["1y", "1d"], "5a": ["5y", "1wk"] };

export function velas(simbolo, periodo = "3m") {
  const [rango, intervalo] = PERIODOS_VELAS[periodo] || PERIODOS_VELAS["3m"];
  const s = limpiar(simbolo);
  if (!/^[\^A-Z0-9.=\-]{1,20}$/.test(s)) throw new Error("Símbolo no válido");
  const nombre = lista().find((x) => x.simbolo === s)?.nombre;
  const vida = periodo === "hoy" || periodo === "5d" ? 60e3 : 5 * 60e3;
  return conCache(`velas:${s}:${periodo}`, vida, async () => ({ ...interpretarVelas(await pedirYahoo(s, rango, intervalo), nombre), periodo }));
}

/** Resumen de un símbolo para el tablero: cotización del día, cambio del mes y su línea de los últimos 3 meses. */
export function resumenTablero(simbolo, nombre) {
  return conCache(`tablero:${limpiar(simbolo)}:${nombre || ""}`, 2 * 60e3, async () => {
    const json = await pedirYahoo(simbolo, "3mo");
    const base = interpretarGrafica(json, nombre);
    const cierres = (json.chart.result[0].indicators?.quote?.[0]?.close || []).filter((c) => typeof c === "number");
    const hace1m = cierres.length > 22 ? cierres.at(-22) : cierres[0];
    return {
      ...base,
      tipo: tipoDe(simbolo),
      cambio_mes_pct: pct(base.precio, hace1m),
      cambio_3m_pct: base.cambio_periodo_pct,
      serie: cierres.slice(-40).map((c) => Math.round(c * 100) / 100),
    };
  });
}

export async function tablero() {
  const base = lista();
  const res = await Promise.allSettled(base.map((x) => resumenTablero(x.simbolo, x.nombre)));
  const items = res.map((r, i) => (r.status === "fulfilled" ? r.value : { simbolo: base[i].simbolo, nombre: base[i].nombre, tipo: tipoDe(base[i].simbolo), error: r.reason.message }));
  return { items, hora: new Date().toISOString() };
}

/** Cotiza varios símbolos; los que fallen se reportan sin tumbar a los demás. */
export async function verMercados(simbolos, periodo = "dia") {
  const base = lista();
  const pedidos = simbolos?.length ? simbolos.map((s) => base.find((x) => x.simbolo === limpiar(s)) || { simbolo: limpiar(s) }) : base;
  const res = await Promise.allSettled(pedidos.map((x) => cotizacion(x.simbolo, periodo, x.nombre)));
  return res.map((r, i) => (r.status === "fulfilled" ? r.value : { simbolo: pedidos[i].simbolo, error: r.reason.message }));
}

export async function buscarSimbolo(texto) {
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(texto)}&quotesCount=6&newsCount=0`;
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`El buscador de bolsa respondió ${r.status}`);
  const d = await r.json();
  return (d.quotes || []).map((q) => ({ simbolo: q.symbol, nombre: q.shortname || q.longname, bolsa: q.exchDisp, tipo: q.typeDisp }));
}

/** Movimientos fuertes del día en la lista (para alertas). */
export async function movimientosFuertes(umbral = Number(getAjuste("umbral_alerta_bolsa", 3))) {
  const datos = await verMercados(null, "dia");
  return datos.filter((d) => typeof d.cambio_dia_pct === "number" && Math.abs(d.cambio_dia_pct) >= umbral);
}

export function lineaCorta(d) {
  if (d.error) return `${d.simbolo}: sin datos`;
  const signo = d.cambio_dia_pct > 0 ? "▲" : d.cambio_dia_pct < 0 ? "▼" : "•";
  return `${d.nombre} ${d.precio?.toLocaleString("es-MX")} ${signo} ${d.cambio_dia_pct ?? "?"}%`;
}
