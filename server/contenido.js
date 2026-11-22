// Producción de contenido por etapas: cada pieza (reel, carrusel, post, historia…) de cada cliente
// avanza por planeado → por grabar → en edición → esperando al cliente → aprobado → publicado.
// "Atrasado" no es una etapa: es cualquier pieza que no se ha publicado y ya pasó su fecha.
import { db } from "./db.js";
import { ahoraLocalISO } from "./tiempo.js";
import { clienteRequerido } from "./agencia.js";

export const ETAPAS = [
  { clave: "planeado", nombre: "Planeado" },
  { clave: "grabar", nombre: "Por grabar" },
  { clave: "edicion", nombre: "En edición" },
  { clave: "cliente", nombre: "Esperando al cliente" },
  { clave: "aprobado", nombre: "Aprobado" },
  { clave: "publicado", nombre: "Publicado" },
];
const CLAVES = ETAPAS.map((e) => e.clave);
export const FORMATOS = { reel: "Reel", carrusel: "Carrusel", post: "Post", historia: "Historia", video: "Video", blog: "Blog", otro: "Otro" };
export const REDES = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", youtube: "YouTube", linkedin: "LinkedIn", web: "Web", otra: "Otra" };
const SINONIMOS = {
  planeado: "planeado", planeada: "planeado", idea: "planeado", plan: "planeado",
  grabar: "grabar", "por grabar": "grabar", grabacion: "grabar", "grabación": "grabar", produccion: "grabar", "producción": "grabar", diseno: "grabar", "diseño": "grabar",
  edicion: "edicion", "edición": "edicion", "en edicion": "edicion", "en edición": "edicion", editando: "edicion",
  cliente: "cliente", "esperando al cliente": "cliente", "esperando cliente": "cliente", revision: "cliente", "revisión": "cliente", "con el cliente": "cliente",
  aprobado: "aprobado", aprobada: "aprobado", listo: "aprobado", lista: "aprobado", programado: "aprobado", programada: "aprobado",
  publicado: "publicado", publicada: "publicado", "ya salió": "publicado",
};
export const ESPERA_CLIENTE_DIAS = 2;
const DIA = 864e5;
const hoyLocal = () => ahoraLocalISO().slice(0, 10);
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MES = /^\d{4}-\d{2}$/;

export function etapaValida(x) {
  const t = String(x ?? "").trim().toLowerCase();
  const e = SINONIMOS[t] || (CLAVES.includes(t) ? t : null);
  if (!e) throw new Error(`Etapa no válida. Usa: ${ETAPAS.map((x) => x.nombre.toLowerCase()).join(", ")}`);
  return e;
}
function fechaValida(x) {
  if (x === null || x === "") return null;
  const t = String(x).slice(0, 10);
  if (!FECHA.test(t) || isNaN(new Date(t + "T12:00:00Z"))) throw new Error("La fecha de publicación no es válida (AAAA-MM-DD)");
  return t;
}
const opcion = (x, lista, nombre) => {
  if (x === undefined || x === null || x === "") return null;
  const t = String(x).trim().toLowerCase();
  if (lista[t]) return t;
  const k = Object.entries(lista).find(([, v]) => v.toLowerCase() === t)?.[0];
  if (!k) throw new Error(`${nombre} no válido. Usa: ${Object.values(lista).join(", ")}`);
  return k;
};
const diasEntre = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / DIA);

/** La pieza con lo que se calcula: nombre de etapa, si va atrasada y cuántos días lleva esperando. */
function vestir(p, hoy = hoyLocal()) {
  if (!p) return null;
  const atrasada = p.etapa !== "publicado" && p.publicar && p.publicar < hoy;
  const diasEtapa = Math.max(0, Math.floor((Date.now() - Date.parse(p.etapa_desde)) / DIA));
  return {
    ...p,
    etapa_nombre: ETAPAS.find((e) => e.clave === p.etapa)?.nombre || p.etapa,
    formato_nombre: FORMATOS[p.formato] || p.formato,
    red_nombre: p.red ? REDES[p.red] || p.red : null,
    atrasada: Boolean(atrasada),
    dias_atraso: atrasada ? diasEntre(p.publicar, hoy) : 0,
    dias_para_publicar: p.publicar && p.etapa !== "publicado" && !atrasada ? diasEntre(hoy, p.publicar) : null,
    dias_en_etapa: diasEtapa,
    espera_cliente_larga: p.etapa === "cliente" && diasEtapa >= ESPERA_CLIENTE_DIAS,
    a_tiempo: p.etapa === "publicado" && p.publicar && p.publicado ? p.publicado <= p.publicar : null,
  };
}

const SELECT = "SELECT k.*, c.nombre cliente FROM contenidos k JOIN clientes c ON c.id = k.cliente_id";
export const obtenerContenido = (id) => vestir(db.prepare(`${SELECT} WHERE k.id = ?`).get(Number(id)));

export function crearContenido({ cliente, titulo, formato, red, etapa, publicar, responsable, notas, enlace } = {}) {
  const c = clienteRequerido(cliente);
  const t = String(titulo || "").trim();
  if (!t) throw new Error("Falta el título de la pieza");
  const e = etapa ? etapaValida(etapa) : "planeado";
  const r = db.prepare(`INSERT INTO contenidos (cliente_id, titulo, formato, red, etapa, publicar, responsable, notas, enlace, publicado)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    c.id, t.slice(0, 200), opcion(formato, FORMATOS, "Formato") || "post", opcion(red, REDES, "Red"), e, fechaValida(publicar ?? null),
    responsable ? String(responsable).slice(0, 80) : null, notas ? String(notas).slice(0, 1000) : null, enlace ? String(enlace).slice(0, 500) : null,
    e === "publicado" ? (publicar && String(publicar).slice(0, 10) <= hoyLocal() ? fechaValida(publicar) : hoyLocal()) : null);
  return obtenerContenido(r.lastInsertRowid);
}

/** Cambia la etapa u otros datos. Al cambiar de etapa se reinicia el reloj de "cuánto lleva ahí". */
export function actualizarContenido(id, cambios = {}) {
  const p = db.prepare("SELECT * FROM contenidos WHERE id = ?").get(Number(id));
  if (!p) throw new Error(`No existe la pieza ${id}`);
  const sets = [], vals = [];
  const poner = (col, v) => { sets.push(`${col} = ?`); vals.push(v); };
  if (cambios.titulo !== undefined) { const t = String(cambios.titulo).trim(); if (!t) throw new Error("El título no puede quedar vacío"); poner("titulo", t.slice(0, 200)); }
  if (cambios.formato !== undefined) poner("formato", opcion(cambios.formato, FORMATOS, "Formato") || "post");
  if (cambios.red !== undefined) poner("red", opcion(cambios.red, REDES, "Red"));
  if (cambios.publicar !== undefined) poner("publicar", fechaValida(cambios.publicar));
  for (const k of ["responsable", "notas", "enlace"]) if (cambios[k] !== undefined) poner(k, cambios[k] ? String(cambios[k]).slice(0, k === "notas" ? 1000 : 500) : null);
  if (cambios.cliente !== undefined) poner("cliente_id", clienteRequerido(cambios.cliente).id);
  if (cambios.etapa !== undefined) {
    const e = etapaValida(cambios.etapa);
    if (e !== p.etapa) {
      poner("etapa", e);
      sets.push("etapa_desde = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
      poner("publicado", e === "publicado" ? (cambios.publicado ? fechaValida(cambios.publicado) : hoyLocal()) : null);
    }
  }
  if (!sets.length) return obtenerContenido(p.id);
  sets.push("actualizado = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  db.prepare(`UPDATE contenidos SET ${sets.join(", ")} WHERE id = ?`).run(...vals, p.id);
  return obtenerContenido(p.id);
}

/** Avanza (+1) o regresa (-1) una etapa. */
export function moverContenido(id, paso = 1) {
  const p = db.prepare("SELECT etapa FROM contenidos WHERE id = ?").get(Number(id));
  if (!p) throw new Error(`No existe la pieza ${id}`);
  const i = Math.min(CLAVES.length - 1, Math.max(0, CLAVES.indexOf(p.etapa) + (paso < 0 ? -1 : 1)));
  return actualizarContenido(id, { etapa: CLAVES[i] });
}

export function borrarContenido(id) {
  const p = obtenerContenido(id);
  if (!p) throw new Error(`No existe la pieza ${id}`);
  db.prepare("DELETE FROM contenidos WHERE id = ?").run(p.id);
  return { ok: true, titulo: p.titulo };
}

/** Busca una pieza por id o por parte del título (y cliente si se da), para que DELTA la encuentre de viva voz. */
export function buscarContenido({ id, titulo, cliente } = {}) {
  if (id) { const p = obtenerContenido(id); if (!p) throw new Error(`No existe la pieza ${id}`); return p; }
  if (!titulo) throw new Error("Dime qué pieza (su título) o su número");
  const c = cliente ? clienteRequerido(cliente) : null;
  const filas = db.prepare(`${SELECT} WHERE k.titulo LIKE ? ${c ? "AND k.cliente_id = ?" : ""} ORDER BY k.etapa = 'publicado', k.publicar`)
    .all(`%${String(titulo).trim()}%`, ...(c ? [c.id] : []));
  if (!filas.length) throw new Error(`No encuentro una pieza que se llame "${titulo}"`);
  const abiertas = filas.filter((f) => f.etapa !== "publicado");
  if ((abiertas.length || filas.length) > 1 && abiertas.length !== 1) {
    throw new Error(`Hay varias piezas parecidas: ${filas.slice(0, 5).map((f) => `#${f.id} ${f.titulo} (${f.cliente})`).join("; ")}. Dime cuál.`);
  }
  return vestir(abiertas[0] || filas[0]);
}

/** Piezas de un cliente (o todas). Con mes = AAAA-MM, lo publicado se limita a ese mes; lo pendiente sale siempre. */
export function listarContenido({ cliente, mes, etapa } = {}) {
  const c = cliente ? clienteRequerido(cliente) : null;
  const filas = db.prepare(`${SELECT} WHERE c.estado != 'terminado' ${c ? "AND k.cliente_id = ?" : ""} ORDER BY COALESCE(k.publicar, '9999'), k.id`).all(...(c ? [c.id] : []));
  const hoy = hoyLocal();
  let lista = filas.map((f) => vestir(f, hoy));
  if (mes) {
    if (!MES.test(mes)) throw new Error("Mes no válido (AAAA-MM)");
    // Lo que falta por publicar sale siempre; lo publicado, solo si salió (o debía salir) ese mes.
    lista = lista.filter((p) => p.etapa !== "publicado" || (p.publicado || p.publicar || "").startsWith(mes));
  }
  if (etapa) {
    if (etapa === "atrasado") lista = lista.filter((p) => p.atrasada);
    else { const e = etapaValida(etapa); lista = lista.filter((p) => p.etapa === e); }
  }
  return lista;
}

/** El tablero: columnas por etapa, lo atrasado y números del mes. */
export function tableroContenido({ cliente, mes } = {}) {
  const hoy = hoyLocal();
  const m = mes || hoy.slice(0, 7);
  const lista = listarContenido({ cliente, mes: m });
  const delMes = lista.filter((p) => p.publicar?.startsWith(m));
  const publicadas = delMes.filter((p) => p.etapa === "publicado");
  const conFecha = publicadas.filter((p) => p.a_tiempo !== null);
  const atrasadas = lista.filter((p) => p.atrasada).sort((a, b) => b.dias_atraso - a.dias_atraso);
  const esperando = lista.filter((p) => p.espera_cliente_larga);
  const semana = lista.filter((p) => p.dias_para_publicar !== null && p.dias_para_publicar <= 7 && !["aprobado", "publicado"].includes(p.etapa));
  const porCliente = new Map();
  for (const p of delMes) {
    const x = porCliente.get(p.cliente_id) || { id: p.cliente_id, nombre: p.cliente, total: 0, publicadas: 0, atrasadas: 0, esperando: 0 };
    x.total++;
    if (p.etapa === "publicado") x.publicadas++;
    porCliente.set(p.cliente_id, x);
  }
  for (const p of lista) {
    const x = porCliente.get(p.cliente_id) || { id: p.cliente_id, nombre: p.cliente, total: 0, publicadas: 0, atrasadas: 0, esperando: 0 };
    if (p.atrasada) x.atrasadas++;
    if (p.espera_cliente_larga) x.esperando++;
    porCliente.set(p.cliente_id, x);
  }
  return {
    mes: m,
    es_mes_actual: m === hoy.slice(0, 7),
    cliente: cliente ? clienteRequerido(cliente).nombre : null,
    etapas: ETAPAS.map((e) => ({ ...e, piezas: lista.filter((p) => p.etapa === e.clave) })),
    total_mes: delMes.length,
    publicadas_mes: publicadas.length,
    a_tiempo_pct: conFecha.length ? Math.round((conFecha.filter((p) => p.a_tiempo).length / conFecha.length) * 100) : null,
    atrasadas,
    esperando_cliente: esperando,
    esta_semana: semana,
    por_cliente: [...porCliente.values()].sort((a, b) => b.atrasadas - a.atrasadas || b.total - a.total),
    formatos: FORMATOS,
    redes: REDES,
  };
}

/** Lo que el semáforo, el Delta Score y el Pulso necesitan de un cliente. */
export function estadoContenido(clienteId) {
  const hoy = hoyLocal();
  const abiertas = db.prepare("SELECT * FROM contenidos WHERE cliente_id = ? AND etapa != 'publicado'").all(clienteId).map((p) => vestir(p, hoy));
  const hay = abiertas.length || db.prepare("SELECT 1 FROM contenidos WHERE cliente_id = ? LIMIT 1").get(clienteId);
  return {
    hay: Boolean(hay),
    atrasadas: abiertas.filter((p) => p.atrasada),
    esperando: abiertas.filter((p) => p.espera_cliente_larga),
    pronto: abiertas.filter((p) => p.dias_para_publicar !== null && p.dias_para_publicar <= 1 && !["aprobado"].includes(p.etapa)),
  };
}

