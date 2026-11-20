// DELTA — app del panel (PC y celular)
import { sonar, sonidosActivos, activarSonidos } from "/sonidos.js";
const $ = (s) => document.querySelector(s);
const guardado = {
  get: (k, d = null) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};

guardado.del("delta_token"); // versiones anteriores guardaban la sesión aquí; ahora va en una cookie protegida
let zona = Intl.DateTimeFormat().resolvedOptions().timeZone;

// ---------------- API ----------------
async function api(ruta, opciones = {}) {
  const r = await fetch(`/api${ruta}`, {
    ...opciones,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Delta": "1" },
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
  });
  if (r.status === 401) { mostrarEntrada(); throw new Error("No autorizado"); }
  const datos = await r.json();
  if (!r.ok) throw new Error(datos.error || "Error");
  return datos;
}

// ---------------- Entrada ----------------
function mostrarEntrada() {
  $("#app").hidden = true;
  $("#entrada").hidden = false;
}
$("#form-entrada").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const r = await fetch("/api/entrar", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clave: $("#clave").value }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    $("#clave").value = "";
    $("#error-entrada").hidden = true;
    iniciar();
  } catch (err) {
    $("#error-entrada").textContent = err.message;
    $("#error-entrada").hidden = false;
  }
});

// ---------------- Formato ----------------
const fmtHora = (iso) => new Intl.DateTimeFormat("es-MX", { timeZone: zona, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const fmtDia = (iso) => {
  const d = new Date(iso);
  const hoy = new Date();
  const clave = (x) => new Intl.DateTimeFormat("en-CA", { timeZone: zona }).format(x);
  const manana = new Date(Date.now() + 864e5);
  if (clave(d) === clave(hoy)) return "Hoy";
  if (clave(d) === clave(manana)) return "Mañana";
  return new Intl.DateTimeFormat("es-MX", { timeZone: zona, weekday: "short", day: "numeric", month: "short" }).format(d);
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---------------- Panel ----------------
async function cargarPanel() {
  const p = await api("/panel");
  zona = p.zona_horaria || zona;

  $("#resumen-hoy").innerHTML = `
    <div><b>${p.hoy.eventos}</b><span>citas hoy</span></div>
    <div><b>${p.hoy.pendientes}</b><span>pendientes</span></div>
    <div><b class="${p.hoy.vencidas ? "alerta" : ""}">${p.hoy.vencidas}</b><span>atrasadas</span></div>`;

  cargarAgenda().catch(() => {});

  const ahora = new Date().toISOString();
  $("#lista-tareas").innerHTML = p.tareas.length
    ? p.tareas.map((t) => {
        const vencida = t.fecha_limite && t.fecha_limite < ahora;
        const sub = [t.cliente, t.fecha_limite ? `${fmtDia(t.fecha_limite)} ${fmtHora(t.fecha_limite)}` : null].filter(Boolean).map(esc).join(" · ");
        return `<li class="${t.prioridad === "alta" ? "alta" : ""} ${vencida ? "vencida" : ""}"><input type="checkbox" data-hecha="${t.id}" aria-label="Marcar como hecha" /><div class="cuerpo">${esc(t.titulo)}${sub ? `<span class="sub">${sub}</span>` : ""}</div></li>`;
      }).join("")
    : `<li class="vacio">Nada pendiente. Impecable, señor.</li>`;

  const c = p.conexiones;
  const filas = [
    ["Cerebro (Claude)", c.cerebro], ["Calendario de DELTA", c.calendario],
    [c.gmail ? `Gmail${c.gmail_cuenta ? ` (${c.gmail_cuenta})` : ""}` : "Gmail: conéctelo en ⚙ Ajustes", c.gmail],
    ["Bolsa y noticias", true], ["WhatsApp", c.whatsapp], ["Avisos en este equipo", c.push],
  ].map(([n, on]) => `<li class="${on ? "on" : ""}"><span class="punto"></span>${n}</li>`);
  filas.push(`<li class="pronto"><span class="punto"></span>Cuentas de clientes (Meta, Instagram, TikTok): próximamente</li>`);
  $("#lista-conexiones").innerHTML = filas.join("");

  $("#lista-avisos").innerHTML = p.avisos.length
    ? p.avisos.map((a) => `<li><div class="cuerpo">${esc(a.texto)}<span class="sub">${fmtDia(a.fecha)} ${fmtHora(a.fecha)}</span></div></li>`).join("")
    : `<li class="vacio">Sin avisos todavía.</li>`;

  gmailConectado = c.gmail;
  $("#btn-gmail").textContent = c.gmail ? "Desconectar Gmail" : "Conectar Gmail";
  $("#btn-gmail").hidden = !c.gmail_disponible && !c.gmail;
  cargarMercados().catch(() => {});

  $("#aj-zona").value = p.zona_horaria;
  $("#aj-resumen").value = p.hora_resumen || "";
}

let gmailConectado = false;
let mercadosCargados = 0;
async function cargarMercados() {
  if (Date.now() - mercadosCargados < 5 * 60000) return; // cada 5 min basta
  mercadosCargados = Date.now();
  const datos = await api("/mercados");
  const ok = datos.filter((d) => !d.error);
  $("#lista-mercados").innerHTML = ok.length
    ? ok.map((d) => {
        const c = d.cambio_dia_pct;
        const clase = c > 0 ? "sube" : c < 0 ? "baja" : "";
        return `<li><div class="cuerpo">${esc(d.nombre)}<span class="sub">${esc(d.precio?.toLocaleString("es-MX") ?? "")} ${esc(d.moneda)}</span></div><b class="${clase}">${c > 0 ? "▲" : c < 0 ? "▼" : ""} ${c ?? "–"}%</b></li>`;
      }).join("")
    : `<li class="vacio">Sin datos de bolsa por ahora.</li>`;
}

$("#btn-gmail").addEventListener("click", async () => {
  try {
    if (gmailConectado) {
      await api("/gmail/desconectar", { method: "POST" });
      $("#aj-msg").textContent = "Gmail desconectado.";
      return cargarPanel();
    }
    const { url } = await api("/gmail/conectar");
    location.href = url;
  } catch (err) { $("#aj-msg").textContent = err.message; }
});

// Regreso de Google después de conectar Gmail
{
  const q = new URLSearchParams(location.search);
  if (q.get("gmail")) {
    history.replaceState(null, "", "/");
    setTimeout(() => burbuja("aviso", q.get("gmail") === "ok" ? "Gmail conectado. Pregúnteme por su correo cuando guste." : `No se pudo conectar Gmail: ${q.get("motivo") || "intente de nuevo"}`), 800);
  }
}

document.addEventListener("click", async (e) => {
  const t = e.target;
  try {
    if (t.dataset.hecha) { await api(`/tareas/${t.dataset.hecha}`, { method: "PATCH", body: { estado: "hecha" } }); sonar("accion"); await cargarPanel(); }
    if (t.dataset.borrarEvento) { await api(`/eventos/${t.dataset.borrarEvento}`, { method: "DELETE" }); sonar("fin_escuchar"); await cargarPanel(); }
    if (t.dataset.borrarRecordatorio) { await api(`/recordatorios/${t.dataset.borrarRecordatorio}`, { method: "DELETE" }); sonar("fin_escuchar"); await cargarPanel(); }
  } catch (err) { sonar("error"); burbuja("aviso", err.message); }
});

$("#form-tarea").addEventListener("submit", async (e) => {
  e.preventDefault();
  const titulo = $("#nueva-tarea").value.trim();
  if (!titulo) return;
  $("#nueva-tarea").value = "";
  await api("/tareas", { method: "POST", body: { titulo } });
  sonar("accion");
  cargarPanel();
});

// ---------------- Pantalla de Agenda ----------------
const agendaEstado = { vista: "dia", dia: null }; // dia = AAAA-MM-DD (día local de referencia)
const claveDia = (fecha) => new Intl.DateTimeFormat("en-CA", { timeZone: zona }).format(fecha);
const sumarDias = (dia, n) => {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
};
const diaSemana = (dia) => new Date(dia + "T12:00:00Z").getUTCDay(); // 0 = domingo
const nombreDia = (dia, opciones) => new Intl.DateTimeFormat("es-MX", { timeZone: "UTC", ...opciones }).format(new Date(dia + "T12:00:00Z"));

const sumarMeses = (dia, n) => {
  const [a, m] = dia.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 10);
};
const minutosDelDia = (iso) => {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: zona, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  return Number(p.find((x) => x.type === "hour").value) * 60 + Number(p.find((x) => x.type === "minute").value);
};
const lunesDe = (dia) => sumarDias(dia, -((diaSemana(dia) + 6) % 7));
const mayuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const HORA_PX = 48;
const horaCorta = (iso) => fmtHora(iso).replace(/\s*([ap])\.?\s*m\.?/i, "$1m").replace(/^0/, "");
let agendaItems = [];

agendaEstado.vista = ["dia", "semana", "mes"].includes(guardado.get("delta_vista")) ? guardado.get("delta_vista") : "dia";
document.querySelectorAll("[data-vista]").forEach((x) => x.classList.toggle("activa", x.dataset.vista === agendaEstado.vista));

function rangoVisible() {
  const ref = agendaEstado.dia || claveDia(new Date());
  if (agendaEstado.vista === "dia") return [ref, ref];
  if (agendaEstado.vista === "semana") { const l = lunesDe(ref); return [l, sumarDias(l, 6)]; }
  const l = lunesDe(ref.slice(0, 8) + "01");
  return [l, sumarDias(l, 41)]; // 6 semanas
}

async function cargarAgenda() {
  if (!agendaEstado.dia) agendaEstado.dia = claveDia(new Date());
  const [desde, hasta] = rangoVisible();
  const datos = await api(`/agenda?desde=${desde}&hasta=${hasta}`);
  const hoy = claveDia(new Date());
  const v = agendaEstado.vista;

  const titulo = v === "dia"
    ? (desde === hoy ? "Hoy, " : "") + nombreDia(desde, { weekday: "long", day: "numeric", month: "long" })
    : v === "semana"
      ? `${nombreDia(desde, { day: "numeric", month: "short" })} – ${nombreDia(hasta, { day: "numeric", month: "short", year: "numeric" })}`
      : nombreDia(agendaEstado.dia, { month: "long", year: "numeric" });
  $("#ag-titulo").textContent = mayuscula(titulo);

  agendaItems = [
    ...datos.eventos.map((e) => ({ tipo: "evento", cuando: e.inicio, fin: e.fin, titulo: e.titulo, lugar: e.lugar, sub: [e.cliente, e.notas].filter(Boolean).join(" · "), borrar: { attr: "data-borrar-evento", id: e.id } })),
    ...datos.tareas.map((t) => ({ tipo: "tarea", cuando: t.fecha_limite, titulo: t.titulo, sub: [t.cliente, t.prioridad === "alta" ? "prioridad alta" : "", t.notas].filter(Boolean).join(" · "), hecha: t.estado === "hecha", id: t.id })),
    ...datos.recordatorios.map((r) => ({ tipo: "recordatorio", cuando: r.cuando, titulo: r.mensaje, sub: r.repetir !== "no" ? `Se repite: ${r.repetir}` : "", borrar: { attr: "data-borrar-recordatorio", id: r.id } })),
  ].sort((a, b) => a.cuando.localeCompare(b.cuando))
    .map((i, n) => ({ ...i, n, dia: claveDia(new Date(i.cuando)), ini: minutosDelDia(i.cuando) }));

  const dias = [];
  for (let d = desde; d <= hasta; d = sumarDias(d, 1)) dias.push(d);
  const cont = $("#ag-contenido");
  cont.className = `ag-contenido vista-${v}`;
  if (v === "mes") cont.innerHTML = vistaMes(dias, hoy);
  else { cont.innerHTML = vistaHoras(dias, hoy); colocarHoras(cont); }
}

function vistaMes(dias, hoy) {
  const mes = agendaEstado.dia.slice(0, 7);
  const cab = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"].map((d) => `<span>${d}</span>`).join("");
  const celdas = dias.map((d) => {
    const del = agendaItems.filter((i) => i.dia === d);
    const chips = del.slice(0, 3).map((i) => `<span class="chip ${i.tipo}${i.hecha ? " hecha" : ""}"><b>${horaCorta(i.cuando)}</b> ${esc(i.titulo)}</span>`).join("");
    const mas = del.length > 3 ? `<span class="mas">+${del.length - 3} más</span>` : "";
    const clases = ["cal-celda", d.slice(0, 7) !== mes ? "fuera" : "", d === hoy ? "hoy" : "", del.length ? "con" : ""].filter(Boolean).join(" ");
    return `<button type="button" class="${clases}" data-ir-dia="${d}" aria-label="${esc(nombreDia(d, { weekday: "long", day: "numeric", month: "long" }))}, ${del.length} cosas"><span class="num">${Number(d.slice(8))}</span><span class="chips">${chips}${mas}</span></button>`;
  }).join("");
  return `<div class="cal-mes"><div class="cal-sem">${cab}</div><div class="cal-celdas">${celdas}</div></div>`;
}

function vistaHoras(dias, hoy) {
  const items = agendaItems.filter((i) => dias.includes(i.dia));
  const dur = (i) => (i.tipo === "evento" ? (i.fin ? Math.max(15, (new Date(i.fin) - new Date(i.cuando)) / 6e4) : 60) : 30);
  let ini = 8 * 60, fin = 20 * 60;
  for (const i of items) { ini = Math.min(ini, Math.floor(i.ini / 60) * 60); fin = Math.max(fin, Math.min(24 * 60, Math.ceil((i.ini + dur(i)) / 60) * 60)); }
  agendaEstado.horas = { ini, fin };
  const regla = [];
  for (let m = ini; m < fin; m += 60) regla.push(`<span>${String(m / 60).padStart(2, "0")}:00</span>`);
  const cab = agendaEstado.vista === "semana"
    ? `<div class="cal-cab"><span></span>${dias.map((d) => `<button type="button" class="cal-cab-dia${d === hoy ? " hoy" : ""}" data-ir-dia="${d}"><small>${nombreDia(d, { weekday: "short" }).replace(".", "")}</small><b>${Number(d.slice(8))}</b></button>`).join("")}</div>`
    : "";
  const ahora = minutosDelDia(new Date().toISOString());
  const cols = dias.map((d) => {
    const del = items.filter((i) => i.dia === d);
    // Carriles: si dos cosas se enciman, se ponen lado a lado.
    let grupo = [], finGrupo = -1, carriles = [];
    const cerrar = () => { const n = carriles.length; grupo.forEach((g) => (g.de = n)); grupo = []; carriles = []; };
    for (const i of del) {
      const f = i.ini + dur(i);
      if (i.ini >= finGrupo) cerrar();
      let c = carriles.findIndex((x) => x <= i.ini);
      if (c < 0) { c = carriles.length; carriles.push(f); } else carriles[c] = f;
      i.carril = c; grupo.push(i); finGrupo = Math.max(finGrupo, f);
    }
    cerrar();
    const evs = del.map((i) => `<button type="button" class="cal-ev ${i.tipo}${i.hecha ? " hecha" : ""}" data-item="${i.n}" data-top="${i.ini - ini}" data-alto="${dur(i)}" data-carril="${i.carril}" data-de="${i.de}"><b>${horaCorta(i.cuando)}</b> <span>${esc(i.titulo)}</span></button>`).join("");
    const linea = d === hoy && ahora >= ini && ahora <= fin ? `<div class="cal-ahora" data-top="${ahora - ini}"></div>` : "";
    return `<div class="cal-col${d === hoy ? " hoy" : ""}" data-dia="${d}">${evs}${linea}</div>`;
  }).join("");
  const vacio = agendaEstado.vista === "dia" && !items.length ? `<p class="ag-vacio">Nada agendado este día. Toque una hora para agregar algo.</p>` : "";
  return `${vacio}<div class="cal-horas dias-${dias.length}">${cab}<div class="cal-cuerpo"><div class="cal-regla">${regla.join("")}</div>${cols}</div></div>`;
}

// Las posiciones se ponen con JS (la política de seguridad no permite estilos en el HTML).
function colocarHoras(cont) {
  const { ini, fin } = agendaEstado.horas;
  const px = (min) => (min / 60) * HORA_PX;
  cont.querySelectorAll(".cal-col, .cal-regla").forEach((c) => (c.style.height = px(fin - ini) + "px"));
  cont.querySelectorAll("[data-top]").forEach((el) => {
    el.style.top = px(Number(el.dataset.top)) + "px";
    if (el.dataset.alto) {
      const alto = Math.max(22, px(Number(el.dataset.alto)) - 2);
      el.style.height = alto + "px";
      el.classList.toggle("corto", alto < 40);
      const de = Number(el.dataset.de) || 1, c = Number(el.dataset.carril) || 0;
      el.style.left = `calc(${(100 / de) * c}% + 2px)`;
      el.style.width = `calc(${100 / de}% - 4px)`;
    }
  });
  const primero = cont.querySelector(".cal-ev, .cal-ahora");
  const caja = cont.querySelector(".cal-cuerpo");
  if (caja) caja.scrollTop = primero ? Math.max(0, primero.offsetTop - 40) : px(Math.max(0, 9 * 60 - ini));
}

function verDetalle(i) {
  const tipos = { evento: "Cita", tarea: "Tarea", recordatorio: "Recordatorio" };
  $("#det-tipo").textContent = tipos[i.tipo];
  $("#det-tipo").className = `det-tipo ${i.tipo}`;
  $("#det-titulo").textContent = i.titulo;
  $("#det-cuando").textContent = mayuscula(`${nombreDia(i.dia, { weekday: "long", day: "numeric", month: "long" })}, ${fmtHora(i.cuando)}${i.fin ? " a " + fmtHora(i.fin) : ""}`);
  $("#det-lugar").textContent = i.lugar ? `📍 ${i.lugar}` : "";
  $("#det-lugar").hidden = !i.lugar;
  $("#det-sub").textContent = i.sub || "";
  $("#det-sub").hidden = !i.sub;
  const acc = [];
  if (i.tipo === "tarea" && !i.hecha) acc.push(`<button type="button" data-hecha="${i.id}" class="primario">Marcar como hecha</button>`);
  if (i.borrar) acc.push(`<button type="button" ${i.borrar.attr}="${i.borrar.id}">${i.tipo === "evento" ? "Borrar cita" : "Quitar recordatorio"}</button>`);
  $("#det-acciones").innerHTML = acc.join("") + `<button type="button" id="det-cerrar">Cerrar</button>`;
  $("#detalle").showModal();
}
$("#detalle").addEventListener("click", (e) => {
  if (e.target === $("#detalle") || e.target.id === "det-cerrar") $("#detalle").close();
  else if (e.target.closest("[data-hecha],[data-borrar-evento],[data-borrar-recordatorio]")) setTimeout(() => $("#detalle").close(), 0);
});

function abrirAgregar(dia, hora) {
  $("#form-agregar").reset();
  $("#ag-f-dia").value = dia || agendaEstado.dia || claveDia(new Date());
  if (hora) $("#ag-f-hora").value = hora;
  $("#ag-f-msg").hidden = true;
  elegirTipo("cita");
  $("#agregar").showModal();
}

$("#ag-contenido").addEventListener("click", (e) => {
  const item = e.target.closest("[data-item]");
  if (item) return verDetalle(agendaItems[Number(item.dataset.item)]);
  const ir = e.target.closest("[data-ir-dia]");
  if (ir) { agendaEstado.dia = ir.dataset.irDia; cambiarVista("dia"); return; }
  const col = e.target.closest(".cal-col");
  if (col && e.target === col) {
    const min = agendaEstado.horas.ini + Math.floor(((e.offsetY / HORA_PX) * 60) / 30) * 30;
    abrirAgregar(col.dataset.dia, `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`);
  }
});

function cambiarVista(v) {
  agendaEstado.vista = v;
  guardado.set("delta_vista", v);
  document.querySelectorAll("[data-vista]").forEach((x) => x.classList.toggle("activa", x.dataset.vista === v));
  cargarAgenda();
}
document.querySelectorAll("[data-vista]").forEach((b) => b.addEventListener("click", () => cambiarVista(b.dataset.vista)));
const mover = (n) => {
  const v = agendaEstado.vista;
  agendaEstado.dia = v === "mes" ? sumarMeses(agendaEstado.dia, n) : sumarDias(agendaEstado.dia, v === "dia" ? n : 7 * n);
  cargarAgenda();
};
$("#ag-ant").addEventListener("click", () => mover(-1));
$("#ag-sig").addEventListener("click", () => mover(1));
$("#ag-hoy").addEventListener("click", () => { agendaEstado.dia = claveDia(new Date()); cargarAgenda(); });

// En la computadora, el calendario se puede ampliar a toda la pantalla.
function ampliar(si) {
  document.body.classList.toggle("cal-amplio", si);
  $("#ag-ampliar").textContent = si ? "⤡ Reducir" : "⤢ Ampliar";
  guardado.set("delta_cal_amplio", si ? "1" : "");
}
$("#ag-ampliar").addEventListener("click", () => { ampliar(!document.body.classList.contains("cal-amplio")); cargarAgenda(); });
ampliar(guardado.get("delta_cal_amplio") === "1");

// Agregar cita, tarea o recordatorio a mano
let tipoNuevo = "cita";
function elegirTipo(tipo) {
  tipoNuevo = tipo;
  document.querySelectorAll("[data-tipo]").forEach((b) => b.classList.toggle("activa", b.dataset.tipo === tipo));
  $("#agregar").className = `dialogo tipo-${tipo}`;
}
document.querySelectorAll("[data-tipo]").forEach((b) => b.addEventListener("click", () => elegirTipo(b.dataset.tipo)));
$("#ag-agregar").addEventListener("click", () => abrirAgregar());
$("#ag-f-cancelar").addEventListener("click", () => $("#agregar").close());
$("#form-agregar").addEventListener("submit", async (e) => {
  e.preventDefault();
  const titulo = $("#ag-f-titulo").value.trim();
  const cuando = `${$("#ag-f-dia").value}T${$("#ag-f-hora").value || "09:00"}`;
  try {
    if (tipoNuevo === "cita") await api("/eventos", { method: "POST", body: { titulo, inicio: cuando, lugar: $("#ag-f-lugar").value.trim() || undefined } });
    else if (tipoNuevo === "tarea") await api("/tareas", { method: "POST", body: { titulo, fecha_limite: cuando } });
    else await api("/recordatorios", { method: "POST", body: { mensaje: titulo, cuando, repetir: $("#ag-f-repetir").value } });
    $("#agregar").close();
    sonar("accion");
    agendaEstado.dia = $("#ag-f-dia").value;
    await cargarPanel();
  } catch (err) {
    sonar("error");
    $("#ag-f-msg").textContent = err.message;
    $("#ag-f-msg").hidden = false;
  }
});

// ---------------- Conversación ----------------
function burbuja(rol, texto, archivos = []) {
  const div = document.createElement("div");
  div.className = `burbuja ${rol}`;
  div.textContent = texto;
  if (archivos.length) {
    const lista = document.createElement("div");
    lista.className = "burbuja-archivos";
    for (const n of archivos) { const s = document.createElement("span"); s.textContent = "📎 " + n; lista.appendChild(s); }
    div.prepend(lista);
  }
  $("#conversacion").appendChild(div);
  $("#conversacion").scrollTop = $("#conversacion").scrollHeight;
  return div;
}

async function cargarHistorial() {
  const h = await api("/historial");
  $("#conversacion").innerHTML = "";
  if (!h.length) burbuja("assistant", "A sus órdenes, señor. Puede pedirme que agende una cita, anote una tarea o le recuerde algo.");
  h.forEach((m) => burbuja(m.rol, m.texto, m.archivos || []));
}

let ocupado = false;
async function enviar(texto, canal = "app") {
  const listos = adjuntos.filter((a) => a.id);
  if ((!texto && !listos.length) || ocupado) return;
  if (adjuntos.some((a) => a.subiendo)) { burbuja("aviso", "Espere un momento, todavía se está subiendo el archivo."); return; }
  ocupado = true;
  const archivos = listos.map((a) => a.id);
  burbuja("user", texto, listos.map((a) => a.nombre));
  sonar("enviar");
  adjuntos = adjuntos.filter((a) => !a.id && !a.error);
  pintarAdjuntos();
  const espera = burbuja("assistant pensando", "Procesando…");
  orbe.estado("pensando");
  try {
    const { respuesta, hizo_cambio } = await api("/chat", { method: "POST", body: { texto, canal, archivos } });
    sonar(hizo_cambio || archivos.length ? "accion" : "respuesta");
    espera.className = "burbuja assistant";
    espera.textContent = respuesta;
    if (canal === "voz" || guardado.get("delta_voz") === "1") hablar(respuesta);
    else orbe.estado("reposo");
    cargarPanel();
  } catch (err) {
    sonar("error");
    espera.className = "burbuja aviso";
    espera.textContent = "No pude completar eso: " + err.message;
    orbe.estado("reposo");
  } finally {
    ocupado = false;
  }
}

// ---------------- Archivos adjuntos ----------------
const MAX_MB = 10;
let adjuntos = []; // { clave, nombre, tamano, subiendo, id, error }
const tamanoLegible = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");

function pintarAdjuntos() {
  const caja = $("#adjuntos");
  caja.hidden = !adjuntos.length;
  caja.innerHTML = adjuntos.map((a) => `<span class="adjunto${a.subiendo ? " subiendo" : ""}${a.error ? " error" : ""}" title="${esc(a.error || a.nombre)}">📎 <span class="nombre">${esc(a.nombre)}</span><small>${a.error ? esc(a.error) : a.subiendo ? "subiendo…" : tamanoLegible(a.tamano)}</small><button type="button" data-quitar-adjunto="${a.clave}" aria-label="Quitar">✕</button></span>`).join("");
}
$("#adjuntos").addEventListener("click", (e) => {
  const b = e.target.closest("[data-quitar-adjunto]");
  if (!b) return;
  adjuntos = adjuntos.filter((a) => String(a.clave) !== b.dataset.quitarAdjunto);
  pintarAdjuntos();
});

// Las fotos se achican antes de subirlas (más rápido y dentro del límite).
async function achicarFoto(archivo) {
  if (!/^image\/(jpeg|png|webp)$/.test(archivo.type) || archivo.size < 1.5 * 1048576) return archivo;
  try {
    const img = await createImageBitmap(archivo);
    const escala = Math.min(1, 2000 / Math.max(img.width, img.height));
    const lienzo = document.createElement("canvas");
    lienzo.width = Math.round(img.width * escala);
    lienzo.height = Math.round(img.height * escala);
    lienzo.getContext("2d").drawImage(img, 0, 0, lienzo.width, lienzo.height);
    const blob = await new Promise((r) => lienzo.toBlob(r, "image/jpeg", 0.85));
    return blob ? new File([blob], archivo.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : archivo;
  } catch { return archivo; }
}

async function subir(archivo) {
  const a = { clave: Math.random().toString(36).slice(2), nombre: archivo.name, tamano: archivo.size, subiendo: true };
  adjuntos.push(a);
  pintarAdjuntos();
  try {
    if (adjuntos.filter((x) => !x.error).length > 5) throw new Error("máximo 5 por mensaje");
    const listo = await achicarFoto(archivo);
    if (listo.size > MAX_MB * 1048576) throw new Error(`pesa más de ${MAX_MB} MB`);
    const r = await fetch("/api/archivos", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/octet-stream", "X-Delta": "1", "X-Nombre": encodeURIComponent(listo.name) },
      body: listo,
    });
    if (r.status === 401) { mostrarEntrada(); throw new Error("sesión cerrada"); }
    const datos = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(datos.error || "no se pudo subir");
    Object.assign(a, { id: datos.id, nombre: datos.nombre, tamano: datos.tamano });
    sonar("archivo");
  } catch (err) {
    sonar("error");
    a.error = err.message;
  } finally {
    a.subiendo = false;
    pintarAdjuntos();
  }
}
$("#btn-clip").addEventListener("click", () => $("#archivo").click());
$("#archivo").addEventListener("change", (e) => {
  for (const f of e.target.files) subir(f);
  e.target.value = "";
  $("#texto").focus();
});

$("#form-chat").addEventListener("submit", (e) => {
  e.preventDefault();
  const t = $("#texto").value.trim();
  $("#texto").value = "";
  enviar(t, "app");
});

// ---------------- Voz ----------------
const Reconocimiento = window.SpeechRecognition || window.webkitSpeechRecognition;
let reconocedor = null;
let escuchando = false;
let manosLibres = guardado.get("delta_manos") === "1";

function vozEspanol() {
  const voces = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("es"));
  return voces.find((v) => /mx|419|us/i.test(v.lang) && /google|natural|neural|paulina|jorge/i.test(v.name))
    || voces.find((v) => /natural|neural|google/i.test(v.name)) || voces[0];
}

function hablar(texto) {
  if (!("speechSynthesis" in window)) return orbe.estado("reposo");
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(texto.replace(/[•*_#]/g, ""));
  const v = vozEspanol();
  if (v) u.voice = v;
  u.lang = v?.lang || "es-MX";
  u.rate = 1.03;
  u.pitch = 0.95;
  u.onstart = () => orbe.estado("hablando");
  u.onend = () => { orbe.estado("reposo"); if (manosLibres) escuchar(); };
  speechSynthesis.speak(u);
}

function escuchar() {
  if (!Reconocimiento) {
    burbuja("aviso", "Este navegador no permite hablarme. En la PC use Chrome o Edge; en iPhone, Safari reciente.");
    return;
  }
  if (escuchando) { reconocedor?.stop(); return; }
  speechSynthesis?.cancel();
  reconocedor = new Reconocimiento();
  reconocedor.lang = "es-MX";
  reconocedor.interimResults = true;
  reconocedor.continuous = false;
  let final = "";
  reconocedor.onstart = () => { if (!manosLibres) sonar("escuchar"); escuchando = true; orbe.estado("escuchando"); $("#btn-mic").classList.add("escuchando"); };
  reconocedor.onresult = (ev) => {
    let parcial = "";
    for (const r of ev.results) (r.isFinal ? (final = r[0].transcript) : (parcial += r[0].transcript));
    $("#texto").value = final || parcial;
  };
  reconocedor.onerror = (ev) => { if (ev.error === "not-allowed") burbuja("aviso", "Necesito permiso para usar el micrófono."); };
  reconocedor.onend = () => {
    escuchando = false;
    $("#btn-mic").classList.remove("escuchando");
    let texto = (final || $("#texto").value).trim();
    $("#texto").value = "";
    if (manosLibres) {
      // En manos libres solo se atiende lo que empieza con "Delta".
      const m = texto.match(/^\s*(oye\s+)?delta[\s,.:]*(.*)$/i);
      if (!m) { orbe.estado("reposo"); return setTimeout(() => manosLibres && !ocupado && escuchar(), 300); }
      texto = m[2].trim() || "Hola";
    }
    if (texto) enviar(texto, "voz");
    else { if (!manosLibres) sonar("fin_escuchar"); orbe.estado("reposo"); }
  };
  reconocedor.start();
}

$("#orbe").addEventListener("click", escuchar);
$("#btn-mic").addEventListener("click", escuchar);
if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = () => {};

// ---------------- Orbe animado (logo DELTA al centro) ----------------
const orbe = (() => {
  const lienzo = $("#lienzo");
  const ctx = lienzo.getContext("2d");
  let estado = "reposo";
  let energia = 0.2;
  const textos = { reposo: "Toque para hablar", escuchando: "Escuchando", pensando: "Pensando", hablando: "Hablando" };
  const colores = { reposo: [139, 115, 255], escuchando: [255, 158, 232], pensando: [183, 166, 255], hablando: [160, 135, 255] };
  let color = [...colores.reposo];
  const chispas = Array.from({ length: 70 }, () => ({ a: Math.random() * Math.PI * 2, r: 0.2 + Math.random() * 0.28, v: (Math.random() - 0.5) * 0.002, t: Math.random() * 3 }));

  function dibujar(t) {
    const W = lienzo.width, C = W / 2;
    ctx.clearRect(0, 0, W, W);
    const objetivo = { reposo: 0.25, escuchando: 0.85, pensando: 0.55, hablando: 0.65 + 0.35 * Math.abs(Math.sin(t / 120)) }[estado];
    energia += (objetivo - energia) * 0.06;
    color = color.map((c, i) => c + (colores[estado][i] - c) * 0.06);
    const [r, g, b] = color.map(Math.round);
    const rgba = (a) => `rgba(${r},${g},${b},${a})`;

    // Resplandor de fondo
    const halo = ctx.createRadialGradient(C, C, W * 0.04, C, C, W * 0.48);
    halo.addColorStop(0, rgba(0.32 * energia + 0.12));
    halo.addColorStop(0.55, rgba(0.06));
    halo.addColorStop(1, rgba(0));
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, W);

    // Partículas orbitando (como polvo de estrellas)
    for (const p of chispas) {
      p.a += p.v * (1 + energia * 3);
      const rr = W * (p.r + 0.01 * Math.sin(t / 900 + p.t));
      const brillo = 0.25 + 0.6 * Math.abs(Math.sin(t / 700 + p.t));
      ctx.fillStyle = `rgba(233,230,255,${brillo * (0.4 + energia * 0.6)})`;
      ctx.beginPath();
      ctx.arc(C + Math.cos(p.a) * rr, C + Math.sin(p.a) * rr, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Anillos de neón
    const anillos = [[0.44, 1.2, 0.0005, 0.55], [0.39, 2.2, -0.0008, 0.8], [0.345, 1, 0.0012, 0.35]];
    anillos.forEach(([rad, grosor, vel, largo], i) => {
      const giro = t * vel * (1 + energia);
      ctx.strokeStyle = rgba(0.3 + 0.45 * energia);
      ctx.lineWidth = grosor * 2;
      ctx.shadowColor = rgba(0.9);
      ctx.shadowBlur = 12 * energia;
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        const ini = giro + (k * Math.PI * 2) / 3;
        ctx.arc(C, C, W * rad, ini, ini + largo * Math.PI * 0.6);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      if (i === 0) { // marcas tipo instrumento
        ctx.strokeStyle = rgba(0.18);
        ctx.lineWidth = 2;
        for (let k = 0; k < 72; k++) {
          const a = (k / 72) * Math.PI * 2 - giro * 0.3;
          const r1 = W * 0.465, r2 = W * (k % 6 ? 0.475 : 0.488);
          ctx.beginPath();
          ctx.moveTo(C + Math.cos(a) * r1, C + Math.sin(a) * r1);
          ctx.lineTo(C + Math.cos(a) * r2, C + Math.sin(a) * r2);
          ctx.stroke();
        }
      }
    });

    // Onda de voz alrededor del logo
    ctx.beginPath();
    const puntos = 120;
    for (let k = 0; k <= puntos; k++) {
      const a = (k / puntos) * Math.PI * 2;
      const onda = Math.sin(a * 7 + t / 230) * Math.sin(a * 3 - t / 380) * 14 * energia;
      const rad = W * 0.29 + onda;
      const x = C + Math.cos(a) * rad, y = C + Math.sin(a) * rad;
      k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.strokeStyle = rgba(0.25 + 0.5 * energia);
    ctx.lineWidth = 1.5;
    ctx.stroke();

    requestAnimationFrame(dibujar);
  }
  requestAnimationFrame(dibujar);
  return {
    estado(e) { estado = e; $("#estado-orbe").textContent = textos[e]; $("#orbe").dataset.estado = e; },
  };
})();

// ---------------- Fondo: cielo estrellado y malla de puntos ----------------
(() => {
  const lienzo = $("#estrellas");
  const ctx = lienzo.getContext("2d");
  let W, H, estrellas;
  const reducir = matchMedia("(prefers-reduced-motion: reduce)").matches;
  function medir() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    lienzo.width = W * dpr; lienzo.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    estrellas = Array.from({ length: Math.round((W * H) / 5000) }, () => ({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.2 + 0.2, f: Math.random() * 6 }));
  }
  function dibujar(t = 0) {
    ctx.clearRect(0, 0, W, H);
    for (const e of estrellas) {
      const a = 0.35 + 0.45 * Math.abs(Math.sin(t / 1600 + e.f));
      ctx.fillStyle = e.r > 1 ? `rgba(201,191,255,${a})` : `rgba(255,255,255,${a * 0.8})`;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2); ctx.fill();
    }
    // Malla de puntos ondulada (como en la portada)
    const filas = 14, cols = Math.ceil(W / 18);
    for (let i = 0; i < filas; i++) {
      const prof = i / filas;
      for (let j = 0; j <= cols; j++) {
        const x = (j / cols) * W;
        const y = H - 150 + i * 11 + Math.sin(j / 7 + t / 2200 + i / 3) * 16 * (1 - prof * 0.5) + Math.sin(j / 19 - t / 3100) * 22;
        ctx.fillStyle = `rgba(139,115,255,${0.08 + 0.32 * prof})`;
        ctx.fillRect(x, y, 1.6, 1.6);
      }
    }
    if (!reducir) requestAnimationFrame(dibujar);
  }
  addEventListener("resize", medir);
  medir();
  requestAnimationFrame(dibujar);
})();

// ---------------- Reloj y clima ----------------
function reloj() {
  $("#reloj").textContent = new Intl.DateTimeFormat("es-MX", { timeZone: zona, hour: "2-digit", minute: "2-digit" }).format(new Date());
}
setInterval(reloj, 10_000);

async function clima() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(async ({ coords }) => {
    try {
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${coords.latitude.toFixed(2)}&longitude=${coords.longitude.toFixed(2)}&current=temperature_2m`);
      const d = await r.json();
      $("#clima").textContent = `${Math.round(d.current.temperature_2m)}°C`;
    } catch {}
  }, () => {}, { maximumAge: 3600e3 });
}

// ---------------- Pestañas (celular) ----------------
function irA(tab) {
  document.querySelectorAll(".rejilla > [data-tab]").forEach((s) => s.classList.toggle("visible", s.dataset.tab === tab));
  document.querySelectorAll(".pestanas button").forEach((b) => b.classList.toggle("activa", b.dataset.ir === tab));
}
document.querySelectorAll(".pestanas button").forEach((b) => b.addEventListener("click", () => irA(b.dataset.ir)));
irA("hablar");

// ---------------- Avisos en vivo ----------------
function conectarVivo() {
  const fuente = new EventSource("/api/vivo");
  fuente.onmessage = (ev) => {
    const d = JSON.parse(ev.data);
    if (d.tipo === "aviso") {
      sonar("aviso");
      burbuja("aviso", "🔔 " + d.texto);
      if (guardado.get("delta_voz") === "1") hablar(d.texto);
      cargarPanel();
    }
  };
}

// ---------------- Notificaciones push ----------------
function base64AUint8(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
async function activarPush() {
  const msg = $("#aj-msg");
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("Este navegador no admite avisos. En iPhone, primero instale la app en la pantalla de inicio.");
    const permiso = await Notification.requestPermission();
    if (permiso !== "granted") throw new Error("Permiso de notificaciones denegado.");
    const reg = await navigator.serviceWorker.ready;
    const { llave } = await api("/push/llave");
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64AUint8(llave) });
    await api("/push/suscribir", { method: "POST", body: sub.toJSON() });
    msg.textContent = "Avisos activados en este equipo.";
    cargarPanel();
  } catch (e) {
    msg.textContent = e.message;
  }
}

// ---------------- Ajustes ----------------
let eventoInstalar = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); eventoInstalar = e; $("#btn-instalar").hidden = false; });
$("#btn-instalar").addEventListener("click", async () => { eventoInstalar?.prompt(); eventoInstalar = null; $("#btn-instalar").hidden = true; });
$("#btn-ajustes").addEventListener("click", () => {
  $("#aj-voz").checked = guardado.get("delta_voz") === "1";
  $("#aj-sonidos").checked = sonidosActivos();
  $("#aj-manos").checked = manosLibres;
  $("#aj-msg").textContent = "";
  $("#ajustes").showModal();
});
$("#btn-push").addEventListener("click", activarPush);
$("#aj-sonidos").addEventListener("change", (e) => { activarSonidos(e.target.checked); if (e.target.checked) sonar("accion"); });
$("#btn-nueva-conv").addEventListener("click", async () => {
  await api("/conversacion/nueva", { method: "POST" });
  $("#ajustes").close();
  cargarHistorial();
});
$("#btn-salir").addEventListener("click", async () => {
  await fetch("/api/salir", { method: "POST", credentials: "same-origin" });
  location.reload();
});
$("#btn-salir-todo").addEventListener("click", async () => {
  await api("/salir-de-todo", { method: "POST" }).catch(() => {});
  location.reload();
});
$("#btn-prueba").addEventListener("click", async () => { await api("/push/prueba", { method: "POST" }); $("#aj-msg").textContent = "Aviso enviado."; });
$("#aj-guardar").addEventListener("click", async () => {
  guardado.set("delta_voz", $("#aj-voz").checked ? "1" : "0");
  manosLibres = $("#aj-manos").checked;
  guardado.set("delta_manos", manosLibres ? "1" : "0");
  try {
    await api("/ajustes", { method: "POST", body: { zona_horaria: $("#aj-zona").value.trim(), hora_resumen: $("#aj-resumen").value } });
    cargarPanel();
  } catch (e) { burbuja("aviso", e.message); }
  if (manosLibres && !escuchando) escuchar();
});

// ---------------- Inicio ----------------
async function iniciar() {
  try {
    await cargarPanel();
  } catch {
    return; // muestra la entrada
  }
  $("#entrada").hidden = true;
  $("#app").hidden = false;
  // La primera vez, DELTA adopta la zona horaria de este equipo.
  if (!guardado.get("delta_zona_enviada")) {
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
    api("/ajustes", { method: "POST", body: { zona_horaria: local } }).then(() => { guardado.set("delta_zona_enviada", "1"); zona = local; }).catch(() => {});
  }
  reloj();
  clima();
  cargarHistorial();
  conectarVivo();
  setInterval(() => cargarPanel().catch(() => {}), 60_000);
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
iniciar();
