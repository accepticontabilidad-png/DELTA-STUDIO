// Analítica y reporte mensual por cliente.
//
// - datosReporte(): junta los números del mes de un cliente (Meta, anuncios, contenido y, si se quiere, Delta Score).
// - Lo convierte en frases sencillas, listas para el cliente (sin palabras como CPL o ROAS).
// - htmlReporte(): la misma hoja para la app, para el link del cliente y para guardarla como PDF (imprimir).
// - Link para el cliente: solo existe si el dueño lo crea, y se puede quitar. DELTA nunca lo envía sola.
// - Cada mes, los primeros días, DELTA deja listos los reportes del mes anterior y avisa al dueño para que los revise.
import crypto from "node:crypto";
import { db, getAjuste, setAjuste } from "./db.js";
import { ahoraLocalISO } from "./tiempo.js";
import * as agencia from "./agencia.js";
import { paidMediaCliente } from "./paidmedia.js";
import { listarContenido } from "./contenido.js";
import { avisar } from "./avisos.js";

db.exec(`
CREATE TABLE IF NOT EXISTS reportes (
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  mes TEXT NOT NULL,                             -- AAAA-MM
  nota TEXT,                                     -- mensaje de la agencia para el cliente
  con_score INTEGER NOT NULL DEFAULT 0,          -- 1 = mostrar el Delta Score al cliente
  token TEXT UNIQUE,                             -- link para el cliente (NULL = sin link)
  compartido TEXT,                               -- cuándo se creó el link
  creado TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  actualizado TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (cliente_id, mes)
);
`);

const MES = /^\d{4}-\d{2}$/;
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const mesActual = () => ahoraLocalISO().slice(0, 7);
export const mover = (mes, n) => { const [a, m] = mes.split("-").map(Number); return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 7); };
export const nombreMes = (mes) => `${MESES[Number(mes.slice(5)) - 1]} ${mes.slice(0, 4)}`;
const num = (n) => Math.round(n).toLocaleString("es-MX");
const dinero = (n) => "$" + Math.round(n).toLocaleString("es-MX");
const pct = (a, b) => (b ? Math.round(((a - b) / b) * 1000) / 10 : null);
const plural = (n, uno, varios) => `${num(n)} ${n === 1 ? uno : varios}`;
export const nombreAgencia = () => getAjuste("agencia_nombre") || "Delta Marketing";

function mesValido(m) {
  const t = m || mover(mesActual(), -1);
  if (!MES.test(t)) throw new Error("Mes no válido (AAAA-MM)");
  if (t > mesActual()) throw new Error("Ese mes todavía no llega");
  return t;
}

/** La foto de Meta del cierre del mes (la última de ese mes). */
function fotoDelMes(clienteId, mes) {
  const f = db.prepare("SELECT fecha, datos FROM meta_fotos WHERE cliente_id = ? AND fecha LIKE ? ORDER BY fecha DESC LIMIT 1").get(clienteId, `${mes}-%`);
  return f ? { fecha: f.fecha, ...JSON.parse(f.datos) } : null;
}
/** La foto con la que se compara: la última del mes anterior o, si no hay, la primera del mismo mes. */
function fotoDeInicio(clienteId, mes) {
  const f = db.prepare("SELECT fecha, datos FROM meta_fotos WHERE cliente_id = ? AND fecha < ? ORDER BY fecha DESC LIMIT 1").get(clienteId, `${mes}-01`)
    || db.prepare("SELECT fecha, datos FROM meta_fotos WHERE cliente_id = ? AND fecha LIKE ? ORDER BY fecha LIMIT 1").get(clienteId, `${mes}-%`);
  return f ? { fecha: f.fecha, ...JSON.parse(f.datos) } : null;
}

export function filaReporte(clienteId, mes) {
  return db.prepare("SELECT * FROM reportes WHERE cliente_id = ? AND mes = ?").get(clienteId, mes) || null;
}

/** Todos los números del mes del cliente, con las frases para el cliente. */
export function datosReporte(cliente, mes, { conScore } = {}) {
  const c = agencia.clienteRequerido(cliente);
  const m = mesValido(mes);
  const fila = filaReporte(c.id, m);
  const verScore = conScore ?? Boolean(fila?.con_score);

  // ---- Redes (Meta)
  const fin = fotoDelMes(c.id, m);
  const ini = fotoDeInicio(c.id, m);
  const red = (k) => {
    const f = fin?.[k];
    if (!f) return null;
    const antes = ini && ini.fecha !== fin.fecha ? ini[k]?.seguidores : null;
    return {
      seguidores: f.seguidores ?? null,
      cambio: antes !== null && antes !== undefined && f.seguidores !== null ? f.seguidores - antes : null,
      cambio_pct: antes ? pct(f.seguidores, antes) : null,
      alcance: f.alcance_28d ?? null,
      interacciones: f.interacciones_28d ?? null,
      publicaciones: f.publicaciones_mes ?? null,
      visitas_perfil: f.visitas_perfil_28d ?? null,
      mejor: f.mejor_publicacion || null,
    };
  };
  const redes = fin ? { instagram: red("instagram"), facebook: red("facebook"), fecha: fin.fecha } : null;

  // ---- Anuncios
  const pm = paidMediaCliente(c, m);
  const pmAntes = paidMediaCliente(c, mover(m, -1));
  const anuncios = pm.inversion > 0 || pm.contactos || pm.ventas ? {
    inversion: pm.inversion,
    contactos: pm.contactos,
    costo_por_contacto: pm.costo_por_contacto,
    ventas: pm.ventas,
    valor_ventas: pm.valor_ventas,
    retorno: pm.roas,
    plataformas: pm.por_plataforma.map((p) => p.plataforma),
    antes: { inversion: pmAntes.inversion, contactos: pmAntes.contactos, costo_por_contacto: pmAntes.costo_por_contacto },
    mejores: pm.campanas.filter((k) => k.resultados && !k.solo_alcance).sort((a, b) => (a.costo_resultado ?? 1e9) - (b.costo_resultado ?? 1e9)).slice(0, 3)
      .map((k) => ({ nombre: k.nombre, resultados: k.resultados, costo: k.costo_resultado, gasto: k.gasto })),
  } : null;

  // ---- Contenido
  const piezas = listarContenido({ cliente: c.id, mes: m });
  const publicadas = piezas.filter((p) => p.etapa === "publicado" && (p.publicado || p.publicar || "").startsWith(m));
  const planeadas = piezas.filter((p) => p.publicar?.startsWith(m));
  const conFecha = publicadas.filter((p) => p.a_tiempo !== null);
  const siguiente = listarContenido({ cliente: c.id }).filter((p) => p.etapa !== "publicado" && p.publicar?.startsWith(mover(m, 1)));
  const contenido = publicadas.length || planeadas.length || siguiente.length ? {
    publicadas: publicadas.map((p) => ({ titulo: p.titulo, formato: p.formato_nombre, red: p.red_nombre, fecha: p.publicado || p.publicar, enlace: p.enlace })),
    planeadas: planeadas.length,
    a_tiempo_pct: conFecha.length ? Math.round((conFecha.filter((p) => p.a_tiempo).length / conFecha.length) * 100) : null,
    formatos: Object.entries(publicadas.reduce((o, p) => ((o[p.formato_nombre] = (o[p.formato_nombre] || 0) + 1), o), {})).map(([nombre, n]) => ({ nombre, n })).sort((a, b) => b.n - a.n),
    siguiente_mes: siguiente.map((p) => ({ titulo: p.titulo, formato: p.formato_nombre, fecha: p.publicar })),
  } : null;

  // ---- Delta Score (solo si se quiere mostrar; es la calificación de hoy)
  const ev = agencia.evaluarCliente(c);
  const score = { puntos: ev.score.puntos, nivel: ev.score.nivel_nombre, color: ev.score.color, partes: ev.score.partes.map((p) => ({ nombre: p.nombre, pct: p.pct, nota: p.nota })) };

  const d = {
    cliente: { id: c.id, nombre: c.nombre, industria: c.industria || null },
    agencia: nombreAgencia(),
    mes: m,
    nombre_mes: nombreMes(m),
    es_mes_actual: m === mesActual(),
    redes, anuncios, contenido,
    score,
    con_score: verScore,
    nota: fila?.nota || null,
    link: fila?.token ? rutaPublica(fila.token) : null,
    compartido: fila?.compartido || null,
    hay_datos: Boolean(redes || anuncios || contenido),
  };
  d.logros = logros(d);
  d.titular = titular(d);
  return d;
}

/** Lo bueno del mes, en frases cortas y sin tecnicismos. Solo con datos reales. */
function logros(d) {
  const r = [];
  const { redes, anuncios: a, contenido: k } = d;
  for (const [clave, nombre] of [["instagram", "Instagram"], ["facebook", "Facebook"]]) {
    const x = redes?.[clave];
    if (!x) continue;
    if (x.cambio > 0) r.push({ tipo: "bien", texto: `Ganaste ${plural(x.cambio, "seguidor", "seguidores")} en ${nombre}${x.cambio_pct ? ` (+${x.cambio_pct.toLocaleString("es-MX")} %)` : ""}. Ya son ${num(x.seguidores)}.` });
    else if (x.cambio < 0) r.push({ tipo: "ojo", texto: `${nombre} bajó ${plural(-x.cambio, "seguidor", "seguidores")} este mes; vamos a reforzar el contenido para recuperarlos.` });
    if (x.alcance) r.push({ tipo: "bien", texto: `Tu cuenta de ${nombre} llegó a ${num(x.alcance)} personas en los últimos 28 días.` });
  }
  if (a) {
    if (a.contactos) {
      let t = `Los anuncios trajeron ${plural(a.contactos, "contacto nuevo", "contactos nuevos")} (mensajes y personas interesadas)`;
      if (a.costo_por_contacto) t += `, a ${dinero(a.costo_por_contacto)} cada uno`;
      const baja = a.antes.costo_por_contacto && a.costo_por_contacto ? pct(a.costo_por_contacto, a.antes.costo_por_contacto) : null;
      if (baja !== null && baja <= -5) t += `: ${Math.abs(Math.round(baja))} % más barato que el mes pasado`;
      r.push({ tipo: "bien", texto: t + "." });
    } else if (a.inversion > 0 && a.contactos === 0) {
      r.push({ tipo: "ojo", texto: `Invertimos ${dinero(a.inversion)} en anuncios y este mes no llegaron contactos; ya estamos ajustando la campaña.` });
    }
    if (a.retorno !== null && a.valor_ventas) {
      r.push({ tipo: a.retorno >= 1 ? "bien" : "ojo", texto: a.retorno >= 1
        ? `Por cada peso invertido en anuncios se vendieron ${a.retorno.toLocaleString("es-MX", { maximumFractionDigits: 1 })} pesos (${dinero(a.valor_ventas)} en total).`
        : `Las ventas por anuncios (${dinero(a.valor_ventas)}) todavía no cubren lo invertido; estamos cambiando la estrategia para mejorarlo.` });
    }
  }
  if (k?.publicadas.length) {
    r.push({ tipo: "bien", texto: `Publicamos ${plural(k.publicadas.length, "pieza", "piezas")} de contenido${k.formatos.length ? ` (${k.formatos.map((f) => `${f.n} ${f.nombre.toLowerCase()}${f.n === 1 ? "" : "s"}`).join(", ")})` : ""}${k.a_tiempo_pct === 100 ? ", todas a tiempo" : k.a_tiempo_pct !== null ? `, ${k.a_tiempo_pct} % a tiempo` : ""}.` });
  }
  return r;
}

function titular(d) {
  const a = d.anuncios, ig = d.redes?.instagram, k = d.contenido;
  if (a?.contactos) return `${plural(a.contactos, "contacto nuevo", "contactos nuevos")} por anuncios en ${d.nombre_mes.split(" ")[0]}`;
  if (ig?.cambio > 0) return `+${num(ig.cambio)} seguidores en Instagram en ${d.nombre_mes.split(" ")[0]}`;
  if (k?.publicadas.length) return `${plural(k.publicadas.length, "pieza publicada", "piezas publicadas")} en ${d.nombre_mes.split(" ")[0]}`;
  return `Tu reporte de ${d.nombre_mes}`;
}

// ---------- Guardar mensaje, mostrar calificación y link para el cliente ----------
function asegurar(clienteId, mes) {
  db.prepare("INSERT OR IGNORE INTO reportes (cliente_id, mes) VALUES (?, ?)").run(clienteId, mes);
  return filaReporte(clienteId, mes);
}

export function guardarReporte({ cliente, mes, nota, con_score } = {}) {
  const c = agencia.clienteRequerido(cliente);
  const m = mesValido(mes);
  asegurar(c.id, m);
  if (nota !== undefined) db.prepare("UPDATE reportes SET nota = ?, actualizado = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE cliente_id = ? AND mes = ?").run(nota ? String(nota).slice(0, 2000) : null, c.id, m);
  if (con_score !== undefined) db.prepare("UPDATE reportes SET con_score = ?, actualizado = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE cliente_id = ? AND mes = ?").run(con_score ? 1 : 0, c.id, m);
  return datosReporte(c.id, m);
}

export const rutaPublica = (token) => `/r/${token}`;
export function urlCompleta(ruta) {
  const base = (process.env.URL_PUBLICA || getAjuste("url_base") || "").replace(/\/$/, "");
  return base + ruta;
}

/** Crea (o devuelve) el link para el cliente. No lo envía a nadie. */
export function crearLink({ cliente, mes } = {}) {
  const c = agencia.clienteRequerido(cliente);
  const m = mesValido(mes);
  const f = asegurar(c.id, m);
  if (f.token) return { link: urlCompleta(rutaPublica(f.token)), ruta: rutaPublica(f.token), nuevo: false };
  const token = crypto.randomBytes(18).toString("base64url");
  db.prepare("UPDATE reportes SET token = ?, compartido = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE cliente_id = ? AND mes = ?").run(token, c.id, m);
  return { link: urlCompleta(rutaPublica(token)), ruta: rutaPublica(token), nuevo: true };
}

export function quitarLink({ cliente, mes } = {}) {
  const c = agencia.clienteRequerido(cliente);
  db.prepare("UPDATE reportes SET token = NULL, compartido = NULL WHERE cliente_id = ? AND mes = ?").run(c.id, mesValido(mes));
  return { ok: true };
}

export function porToken(token) {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(String(token || ""))) return null;
  const f = db.prepare("SELECT r.cliente_id, r.mes FROM reportes r JOIN clientes c ON c.id = r.cliente_id WHERE r.token = ?").get(token);
  return f ? datosReporte(f.cliente_id, f.mes) : null;
}

// ---------- Tablero de Analítica: todos los clientes en un mes ----------
export function analitica(mes) {
  const m = mesValido(mes);
  const clientes = agencia.listarClientes().filter((c) => c.estado === "activo" || c.estado === "pausado");
  const filas = clientes.map((c) => {
    const d = datosReporte(c.id, m);
    const ig = d.redes?.instagram, fb = d.redes?.facebook;
    const cambio = [ig?.cambio, fb?.cambio].filter((x) => x !== null && x !== undefined);
    return {
      id: c.id, nombre: c.nombre,
      seguidores_cambio: cambio.length ? cambio.reduce((s, x) => s + x, 0) : null,
      alcance: (ig?.alcance || 0) + (fb?.alcance || 0) || null,
      publicadas: d.contenido ? d.contenido.publicadas.length : null,
      a_tiempo_pct: d.contenido?.a_tiempo_pct ?? null,
      inversion: d.anuncios?.inversion ?? null,
      contactos: d.anuncios?.contactos ?? null,
      costo_por_contacto: d.anuncios?.costo_por_contacto ?? null,
      retorno: d.anuncios?.retorno ?? null,
      score: d.score.puntos, score_color: d.score.color,
      hay_datos: d.hay_datos,
      link: d.link, nota: Boolean(d.nota),
    };
  });
  return {
    mes: m, nombre_mes: nombreMes(m), es_mes_actual: m === mesActual(),
    // Primero los que tienen más que contar.
    clientes: filas.map((f) => ({ ...f, _n: [f.seguidores_cambio, f.publicadas || null, f.contactos, f.retorno].filter((x) => x !== null && x !== undefined).length }))
      .sort((a, b) => Number(b.hay_datos) - Number(a.hay_datos) || b._n - a._n || a.nombre.localeCompare(b.nombre)).map(({ _n, ...f }) => f),
    con_link: filas.filter((f) => f.link).length,
  };
}

// ---------- Reportes del mes anterior listos, cada mes ----------
export function prepararReportesDelMes({ hoy = ahoraLocalISO().slice(0, 10), avisarDueno = true } = {}) {
  const mes = mover(hoy.slice(0, 7), -1);
  if (getAjuste("reportes_preparados") === mes) return null;
  const listos = [];
  for (const c of agencia.listarClientes({ estado: "activo" })) {
    try {
      const d = datosReporte(c.id, mes);
      if (!d.hay_datos) continue;
      asegurar(c.id, mes);
      listos.push(c.nombre);
    } catch (e) { console.error("[reportes]", c.nombre, e.message); }
  }
  setAjuste("reportes_preparados", mes);
  // Solo avisa en la primera semana del mes (si la app se actualiza a medio mes, no avisa de un mes viejo).
  if (avisarDueno && listos.length && Number(hoy.slice(8, 10)) <= 7) {
    avisar(`Los reportes de ${nombreMes(mes)} están listos para revisar (${listos.length} cliente${listos.length === 1 ? "" : "s"}): ${listos.slice(0, 5).join(", ")}${listos.length > 5 ? "…" : ""}. Ábrelos en Analítica; nada se envía sin que tú lo digas.`, "Reportes del mes").catch(() => {});
  }
  return { mes, listos };
}

export function iniciarReportes() {
  const ciclo = () => { try { prepararReportesDelMes(); } catch (e) { console.error("[reportes]", e.message); } };
  setTimeout(ciclo, 90_000);
  return setInterval(ciclo, 3 * 3600e3);
}

// ---------- La hoja del reporte (HTML) ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const fechaCorta = (f) => (f ? `${Number(f.slice(8, 10))} ${MESES[Number(f.slice(5, 7)) - 1].slice(0, 3)}` : "");
const flecha = (n, alReves = false) => (n === null || n === undefined || n === 0 ? "" : `<span class="rp-cambio ${(n > 0) !== alReves ? "sube" : "baja"}">${n > 0 ? "▲" : "▼"} ${Math.abs(n).toLocaleString("es-MX", { maximumFractionDigits: 1 })} %</span>`);
const dato = (nombre, valor, extra = "") => `<div class="rp-dato"><span>${esc(nombre)}</span><b>${valor}</b>${extra ? `<small>${extra}</small>` : ""}</div>`;

/** El cuerpo del reporte. Sirve igual en la app, en el link del cliente y al imprimir. */
export function htmlReporte(d) {
  const p = [];
  p.push(`<header class="rp-cabeza">
    <div class="rp-marca">${esc(d.agencia)}</div>
    <h1>${esc(d.cliente.nombre)}</h1>
    <p class="rp-periodo">Reporte de ${esc(d.nombre_mes)}${d.es_mes_actual ? " · hasta hoy" : ""}</p>
    <p class="rp-titular">${esc(d.titular)}</p>
  </header>`);
  if (d.nota) p.push(`<section class="rp-nota"><h2>Mensaje de tu agencia</h2>${esc(d.nota).split(/\n+/).map((x) => `<p>${x}</p>`).join("")}</section>`);
  if (d.logros.length) {
    p.push(`<section class="rp-logros"><h2>Lo más importante</h2><ul>${d.logros.map((l) => `<li class="${l.tipo}">${esc(l.texto)}</li>`).join("")}</ul></section>`);
  }
  const a = d.anuncios;
  if (a) {
    const cambioCosto = a.antes.costo_por_contacto && a.costo_por_contacto ? pct(a.costo_por_contacto, a.antes.costo_por_contacto) : null;
    p.push(`<section><h2>Anuncios</h2><div class="rp-datos">
      ${dato("Invertido", dinero(a.inversion), flecha(pct(a.inversion, a.antes.inversion)))}
      ${a.contactos !== null ? dato("Contactos nuevos", num(a.contactos), `mensajes y personas interesadas ${flecha(pct(a.contactos, a.antes.contactos))}`) : ""}
      ${a.costo_por_contacto ? dato("Costo por contacto", dinero(a.costo_por_contacto), flecha(cambioCosto, true)) : ""}
      ${a.valor_ventas ? dato("Ventas por anuncios", dinero(a.valor_ventas), a.ventas ? plural(a.ventas, "venta", "ventas") : "") : ""}
      ${a.retorno !== null ? dato("Retorno", `${a.retorno.toLocaleString("es-MX", { maximumFractionDigits: 1 })}×`, "pesos vendidos por cada peso invertido") : ""}
    </div>
    ${a.mejores.length ? `<h3>Las campañas que mejor funcionaron</h3><ol class="rp-lista">${a.mejores.map((k) => `<li><b>${esc(k.nombre)}</b><span>${plural(k.resultados, "contacto", "contactos")}${k.costo ? ` · ${dinero(k.costo)} c/u` : ""}</span></li>`).join("")}</ol>` : ""}
    </section>`);
  }
  const r = d.redes;
  if (r && (r.instagram || r.facebook)) {
    const bloque = (x, nombre) => x ? `<div class="rp-red"><h3>${nombre}</h3><div class="rp-datos">
        ${x.seguidores !== null ? dato("Seguidores", num(x.seguidores), x.cambio ? `${x.cambio > 0 ? "+" : "−"}${num(Math.abs(x.cambio))} este mes` : "") : ""}
        ${x.alcance ? dato("Personas alcanzadas", num(x.alcance), "últimos 28 días") : ""}
        ${x.interacciones ? dato("Interacciones", num(x.interacciones), "me gusta, comentarios y guardados") : ""}
        ${x.publicaciones !== null ? dato("Publicaciones", num(x.publicaciones), "en el mes") : ""}
      </div>
      ${x.mejor ? `<p class="rp-mejor">Lo que más gustó: <b>“${esc(x.mejor.texto || "Publicación")}”</b> · ${num(x.mejor.me_gusta)} me gusta, ${num(x.mejor.comentarios)} comentarios${x.mejor.enlace && /^https:\/\//.test(x.mejor.enlace) ? ` · <a href="${esc(x.mejor.enlace)}" rel="noopener noreferrer" target="_blank">verla</a>` : ""}</p>` : ""}
      </div>` : "";
    p.push(`<section><h2>Redes sociales</h2>${bloque(r.instagram, "Instagram")}${bloque(r.facebook, "Facebook")}</section>`);
  }
  const k = d.contenido;
  if (k) {
    p.push(`<section><h2>Contenido</h2>
      <div class="rp-datos">
        ${k.publicadas.length || k.planeadas ? dato("Publicado", num(k.publicadas.length), k.planeadas ? `de ${plural(k.planeadas, "pieza planeada", "piezas planeadas")}` : "") : ""}
        ${k.a_tiempo_pct !== null ? dato("A tiempo", `${k.a_tiempo_pct} %`) : ""}
      </div>
      ${k.publicadas.length ? `<ul class="rp-piezas">${k.publicadas.map((x) => `<li><span class="rp-fecha">${esc(fechaCorta(x.fecha))}</span><span><b>${esc(x.titulo)}</b><small>${esc([x.formato, x.red].filter(Boolean).join(" · "))}</small></span></li>`).join("")}</ul>` : ""}
      ${k.siguiente_mes.length ? `<h3>Lo que viene en ${esc(MESES[Number(mover(d.mes, 1).slice(5)) - 1])}</h3><ul class="rp-piezas sig">${k.siguiente_mes.slice(0, 8).map((x) => `<li><span class="rp-fecha">${esc(fechaCorta(x.fecha))}</span><span><b>${esc(x.titulo)}</b><small>${esc(x.formato)}</small></span></li>`).join("")}</ul>` : ""}
    </section>`);
  }
  if (d.con_score) {
    const s = d.score;
    p.push(`<section class="rp-score"><h2>Calificación de la cuenta</h2>
      <div class="rp-score-fila"><b class="c-${s.color}">${s.puntos}</b><span>de 100 · ${esc(s.nivel)}<small>Junta entregas, pagos, anuncios, redes y seguimiento. Es la calificación de hoy.</small></span></div>
      <ul class="rp-partes">${s.partes.map((x) => `<li><span>${esc(x.nombre)}</span><svg viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><rect width="100" height="6" rx="3" class="fondo"/><rect width="${Math.max(2, x.pct)}" height="6" rx="3" class="c-${x.pct >= 65 ? "verde" : x.pct >= 50 ? "amarillo" : "rojo"}"/></svg><b>${x.pct} %</b></li>`).join("")}</ul>
    </section>`);
  }
  if (!d.hay_datos) p.push(`<section><p class="rp-vacio">Todavía no hay números de este mes para ${esc(d.cliente.nombre)}.</p></section>`);
  p.push(`<footer class="rp-pie">Preparado por ${esc(d.agencia)} · ${esc(d.nombre_mes)}. Los números de redes y anuncios vienen de Meta; las ventas, de lo que nos reportas.</footer>`);
  return `<article class="rp">${p.join("\n")}</article>`;
}

/** La página completa (link del cliente o PDF). */
export function paginaReporte(d, { imprimir = false } = {}) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(d.cliente.nombre)} · Reporte de ${esc(d.nombre_mes)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/reporte.css">
<script src="/reporte.js" defer></script>
</head>
<body class="rp-pagina"${imprimir ? ' data-imprimir="1"' : ""}>
<div class="rp-barra"><button type="button" id="rp-pdf">Guardar como PDF</button></div>
${htmlReporte(d)}
</body>
</html>`;
}
