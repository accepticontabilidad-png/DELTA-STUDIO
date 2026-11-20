// Bolsa y mercados: cotizaciones gratuitas (Yahoo Finance, sin clave) y lista de seguimiento.
// DELTA solo informa: nunca compra ni vende.
import { getAjuste, setAjuste } from "./db.js";

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

export async function cotizacion(simbolo, periodo = "mes", nombre) {
  const rango = RANGOS[periodo] || "1mo";
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(limpiar(simbolo))}?range=${rango}&interval=1d`;
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(10000) });
  if (!r.ok && r.status !== 404) throw new Error(`El servicio de bolsa respondió ${r.status}`);
  return { ...interpretarGrafica(await r.json(), nombre), periodo };
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
