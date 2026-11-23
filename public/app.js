// DELTA — app del panel (PC y celular)
import { sonar, sonidosActivos, activarSonidos } from "/sonidos.js";
import { iniciarTableros } from "/tableros.js";
import { iniciarAgencia } from "/agencia.js";
import { pintarFabrica, tableroDe } from "/fabrica.js";
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
    const usuario = $("#usuario-equipo").hidden ? "" : $("#usuario-equipo").value.trim();
    const r = await fetch("/api/entrar", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clave: $("#clave").value, ...(usuario ? { usuario } : {}) }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    $("#clave").value = "";
    if (usuario) guardado.set("delta_usuario", usuario);
    $("#error-entrada").hidden = true;
    iniciar(true); // el toque de "Entrar" ya permite el sonido de arranque
  } catch (err) {
    $("#error-entrada").textContent = err.message;
    $("#error-entrada").hidden = false;
  }
});

// Alguien del equipo entra con su usuario (se recuerda en este equipo)
function modoEquipoEntrada(on) {
  $("#usuario-equipo").hidden = !on;
  $("#usuario-equipo").required = on;
  $("#entrada-saludo").textContent = on ? "Hola. Entra con tu usuario y tu clave." : "Hola de nuevo, señor. ¿Me das tu clave?";
  $("#clave").placeholder = on ? "Tu clave" : "Clave de acceso";
  $("#btn-soy-equipo").textContent = on ? "Soy el dueño" : "¿Eres del equipo? Entra con tu usuario";
  if (on) { $("#usuario-equipo").value ||= guardado.get("delta_usuario") || ""; setTimeout(() => ($("#usuario-equipo").value ? $("#clave") : $("#usuario-equipo")).focus(), 30); }
}
$("#btn-soy-equipo").addEventListener("click", () => modoEquipoEntrada($("#usuario-equipo").hidden));
if (guardado.get("delta_usuario")) modoEquipoEntrada(true);

// Quién está dentro: el dueño ve todo; alguien del equipo solo sus secciones
let yo = { rol: "dueno" };
const esEquipo = () => yo.rol === "equipo";
const SIEMPRE_EQUIPO = ["tareas"];
const puedeAbrir = (n) => !esEquipo() || SIEMPRE_EQUIPO.includes(n) || yo.secciones.includes(n);
function aplicarRol(p) {
  if (p.rol !== "equipo") { yo = { rol: "dueno" }; guardado.del("delta_usuario"); document.documentElement.removeAttribute("data-rol"); return; }
  yo = { rol: "equipo", ...p.usuario };
  document.documentElement.dataset.rol = "equipo";
  document.querySelectorAll("[data-ir]").forEach((x) => x.classList.toggle("permitido", puedeAbrir(x.dataset.ir)));
  $("#menu-hola").textContent = `Hola, ${p.usuario.nombre}`;
}

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
  aplicarMood();
  aplicarRol(p);
  if (esEquipo()) return pintarPanelEquipo(p);

  hud.panel = p;
  pintarMosaicos();
  pintarSiguiente();

  if (seccionActual === "agenda") cargarAgenda().catch(() => {});


  const ahora = new Date().toISOString();
  const filaTarea = (t) => {
        const vencida = t.fecha_limite && t.fecha_limite < ahora;
        const sub = [t.cliente, t.fecha_limite ? `${fmtDia(t.fecha_limite)} ${fmtHora(t.fecha_limite)}` : null].filter(Boolean).map(esc).join(" · ");
        return `<li class="${t.prioridad === "alta" ? "alta" : ""} ${vencida ? "vencida" : ""}"><input type="checkbox" data-hecha="${t.id}" aria-label="Marcar como hecha" /><div class="cuerpo">${esc(t.titulo)}${sub ? `<span class="sub">${sub}</span>` : ""}</div></li>`;
  };
  const sinTareas = `<li class="vacio">Nada pendiente. ¡Vas impecable!</li>`;
  $("#lista-tareas").innerHTML = p.tareas.length ? p.tareas.map(filaTarea).join("") : sinTareas;
  $("#hoy-tareas").innerHTML = p.tareas.length
    ? p.tareas.slice(0, 5).map(filaTarea).join("") + (p.tareas.length > 5 ? `<li class="vacio"><a href="#/tareas" class="ver-mas">y ${p.tareas.length - 5} más ›</a></li>` : "")
    : sinTareas;

  const c = p.conexiones;
  const filas = [
    ["Cerebro (Claude)", c.cerebro], ["Calendario de DELTA", c.calendario],
    [c.gmail ? `Gmail${c.gmail_cuenta ? ` (${c.gmail_cuenta})` : ""}` : c.gmail_disponible ? "Gmail: toque Conectar Gmail" : "Gmail: faltan sus llaves de Google en Railway", c.gmail],
    [c.outlook ? `Hotmail${c.outlook_cuenta ? ` (${c.outlook_cuenta})` : ""}` : c.outlook_disponible ? "Hotmail: toque Conectar Hotmail" : "Hotmail: faltan sus llaves de Microsoft en Railway", c.outlook],
    ["Bolsa y noticias", true], [c.higgsfield ? "Higgsfield (imágenes y video con IA)" : "Higgsfield: falta su llave en Railway", c.higgsfield], ["WhatsApp", c.whatsapp], ["Avisos en este equipo", c.push],
  ].map(([n, on]) => `<li class="${on ? "on" : ""}"><span class="punto"></span>${n}</li>`);
  filas.push(`<li class="${c.meta ? "on" : ""}"><span class="punto"></span>${c.meta ? `Meta: Facebook, Instagram y anuncios de clientes${c.meta_usuario ? ` (${esc(c.meta_usuario)})` : ""}` : c.meta_disponible ? "Meta: toque Conectar Meta" : "Meta: faltan sus llaves de Meta en Railway"}</li>`);
  filas.push(`<li class="pronto"><span class="punto"></span>TikTok y Google Ads de clientes: próximamente</li>`);
  $("#lista-conexiones").innerHTML = filas.join("");

  $("#lista-avisos").innerHTML = p.avisos.length
    ? p.avisos.slice(0, 4).map((a) => `<li><div class="cuerpo">${esc(a.texto)}<span class="sub">${fmtDia(a.fecha)} ${fmtHora(a.fecha)}</span></div></li>`).join("")
    : `<li class="vacio">Sin avisos todavía.</li>`;

  pintarFrase();
  const n = p.aprobaciones_pendientes || 0;
  $("#badge-aprob").hidden = !n;
  $("#badge-aprob").textContent = n;
  $("#badge-finanzas").hidden = !p.pagos_vencidos;
  $("#badge-finanzas").textContent = p.pagos_vencidos || "";
  $("#badge-contenido").hidden = !p.contenido_atrasado;
  $("#badge-contenido").textContent = p.contenido_atrasado || "";
  $("#badge-tendencias").hidden = !p.ideas_nuevas;
  $("#badge-tendencias").textContent = p.ideas_nuevas || "";
  $("#badge-crm").hidden = !p.crm_sin_responder;
  $("#badge-crm").textContent = p.crm_sin_responder || "";
  $("#badge-seo").hidden = !p.sitios_caidos;
  $("#badge-seo").textContent = p.sitios_caidos || "";
  $("#badge-paidmedia").hidden = !p.anuncios_sin_resultados;
  $("#badge-paidmedia").textContent = p.anuncios_sin_resultados || "";
  correoConectado = { gmail: c.gmail, outlook: c.outlook };
  $("#btn-gmail").textContent = c.gmail ? "Desconectar Gmail" : "Conectar Gmail";
  $("#btn-outlook").textContent = c.outlook ? "Desconectar Hotmail" : "Conectar Hotmail";
  metaConectado = Boolean(c.meta);
  $("#btn-meta-aj").textContent = c.meta ? "Meta de clientes" : "Conectar Meta";

  if (p.voz) { vozNatural = p.voz; pintarVoz(); }
  $("#aj-zona").value = p.zona_horaria;
  $("#aj-resumen").value = p.hora_resumen || "";
}

// Lo que ve alguien del equipo: sus tareas y los avisos de sus secciones
function pintarPanelEquipo(p) {
  const ahora = new Date().toISOString();
  $("#lista-tareas").innerHTML = p.tareas.length ? p.tareas.map((t) => {
    const vencida = t.fecha_limite && t.fecha_limite < ahora;
    const sub = [t.cliente, t.fecha_limite ? `${fmtDia(t.fecha_limite)} ${fmtHora(t.fecha_limite)}` : null, t.notas].filter(Boolean).map(esc).join(" · ");
    return `<li class="${t.prioridad === "alta" ? "alta" : ""} ${vencida ? "vencida" : ""}"><input type="checkbox" data-hecha="${t.id}" aria-label="Marcar como hecha" /><div class="cuerpo">${esc(t.titulo)}${sub ? `<span class="sub">${sub}</span>` : ""}</div></li>`;
  }).join("") : `<li class="vacio">No tienes tareas pendientes. ¡Bien hecho!</li>`;
  for (const [id, n] of [["#badge-crm", p.crm_sin_responder], ["#badge-contenido", p.contenido_atrasado]]) { $(id).hidden = !n; $(id).textContent = n || ""; }
}

let correoConectado = { gmail: false, outlook: false };
let metaConectado = false;
const NOMBRE_CUENTA = { gmail: "Gmail", outlook: "Hotmail" };
const remitente = (m) => m.de.replace(/<.*>/, "").replace(/"/g, "").trim() || m.de;
const BANDEJAS = ["gmail", "outlook"];
const nuevosEn = (c) => (c?.correos || []).filter((m) => m.sin_leer).length;
const totalSinLeer = (d) => (d?.conectado ? BANDEJAS.reduce((n, k) => n + nuevosEn(d.cuentas[k]), 0) : null);
let bandeja = (() => { try { return localStorage.getItem("delta_bandeja") || "gmail"; } catch { return "gmail"; } })();
if (!BANDEJAS.includes(bandeja)) bandeja = "gmail";
let ultimoCorreo = null;
const filaMercado = (d) => {
        const c = d.cambio_dia_pct;
        const clase = c > 0 ? "sube" : c < 0 ? "baja" : "";
        return `<li><div class="cuerpo">${esc(d.nombre)}<span class="sub">${esc(d.precio?.toLocaleString("es-MX") ?? "")} ${esc(d.moneda)}</span></div><b class="${clase}">${c > 0 ? "▲" : c < 0 ? "▼" : ""} ${c ?? "–"}%</b></li>`;
};
const sinBolsa = `<li class="vacio">Sin datos de bolsa por ahora.</li>`;

async function cargarMercadosMini() {
  const ok = (await api("/mercados")).filter((d) => !d.error);
  $("#lista-mercados").innerHTML = ok.length ? ok.slice(0, 5).map(filaMercado).join("") : sinBolsa;
  pintarTicker(ok);
}

// Tablero unificado de bolsa y noticias (se arma la primera vez que se abre la sección).
let tableros = null;
async function cargarMercadosYNoticias() {
  tableros ||= iniciarTableros({ api, esc, guardado, decir });
  const [, notas] = await Promise.allSettled([tableros.cargar(), api("/noticias")]);
  $("#noticias").innerHTML = notas.status === "fulfilled"
    ? notas.value.map((t) => `<div class="tn-tema"><h3>${esc(t.tema)}</h3><ul class="lista noticias">${
        t.noticias?.length
          ? t.noticias.map((n) => `<li><div class="cuerpo"><a href="${esc(/^https:\/\//.test(n.enlace) ? n.enlace : "#")}" target="_blank" rel="noopener noreferrer">${esc(n.titulo)}</a><span class="sub">${esc(n.fuente)}${n.fecha ? " · " + fmtDia(n.fecha) + " " + fmtHora(n.fecha) : ""}</span></div></li>`).join("")
          : `<li class="vacio">${t.error ? "No se pudo cargar." : "Sin noticias hoy."}</li>`
      }</ul></div>`).join("")
    : `<p class="tenue">No se pudieron cargar las noticias.</p>`;
}

async function cargarCorreo() {
  ultimoCorreo = await api("/correo");
  for (const k of BANDEJAS) if (ultimoCorreo.cuentas?.[k]) correoConectado[k] = Boolean(ultimoCorreo.cuentas[k].conectado);
  pintarBandeja();
}

function pintarBandeja() {
  const d = ultimoCorreo;
  if (!d) return;
  document.querySelectorAll("[data-bandeja]").forEach((x) => x.classList.toggle("activa", x.dataset.bandeja === bandeja));
  for (const k of BANDEJAS) {
    const n = nuevosEn(d.cuentas[k]);
    $(`#n-${k}`).textContent = n ? n : "";
  }
  const c = d.cuentas[bandeja];
  const nombre = NOMBRE_CUENTA[bandeja];
  if (!c.conectado) {
    $("#correo-estado").textContent = c.disponible
      ? `${nombre} todavía no está conectado. Conéctelo en ⚙ Ajustes → Conectar ${nombre}.`
      : `${nombre} todavía no está conectado: faltan sus llaves en Railway (vea la guía), y luego ⚙ Ajustes → Conectar ${nombre}.`;
    $("#lista-correos").innerHTML = "";
    return;
  }
  $("#correo-estado").textContent = c.error
    ? `${c.cuenta || nombre} · No pude revisarlo ahora: ${c.error}`
    : `${c.cuenta || nombre} · bandeja de entrada, últimos 2 días`;
  $("#lista-correos").innerHTML = c.correos.length
    ? c.correos.map((m) => `<li class="${m.sin_leer ? "sin-leer" : ""}" data-abrir-correo="${esc(m.id)}" tabindex="0" role="button"><div class="cuerpo"><b>${esc(remitente(m))}</b> · ${esc(m.asunto || "(sin asunto)")}<span class="sub">${esc(m.vista_previa)}</span></div><span class="tenue hora">${fmtDia(m.fecha)} ${fmtHora(m.fecha)}</span></li>`).join("")
    : c.error ? "" : `<li class="vacio">Sin correos recientes en ${nombre}.</li>`;
}

document.addEventListener("click", (e) => {
  const a = e.target.closest?.("[data-abrir-bandeja]");
  if (a) { bandeja = a.dataset.abrirBandeja; try { localStorage.setItem("delta_bandeja", bandeja); } catch { /* sin almacenamiento */ } }
});
// ---------- Leer, escribir y contestar correos ----------
let correoAbierto = null;
const soloCorreo = (t = "") => (String(t).match(/<([^>]+)>/)?.[1] || String(t)).trim();

async function abrirCorreo(id) {
  const dlg = $("#dlg-correo");
  $("#co-cuenta").textContent = "Abriendo…";
  $("#co-asunto").textContent = "";
  $("#co-de").textContent = "";
  $("#co-para").textContent = "";
  $("#co-fecha").textContent = "";
  $("#co-adjuntos").hidden = true;
  $("#co-texto").textContent = "";
  correoAbierto = null;
  if (!dlg.open) dlg.showModal();
  try {
    const m = await api(`/correo/mensaje?id=${encodeURIComponent(id)}`);
    correoAbierto = m;
    $("#co-cuenta").textContent = `${NOMBRE_CUENTA[m.origen] || "Correo"} · ${m.cuenta || ""}`;
    $("#co-asunto").textContent = m.asunto || "(sin asunto)";
    $("#co-de").textContent = `De: ${m.de}`;
    $("#co-para").textContent = m.para ? `Para: ${m.para}` : "";
    $("#co-fecha").textContent = `${fmtDia(m.fecha)} ${fmtHora(m.fecha)}`;
    if (m.adjuntos?.length) { $("#co-adjuntos").hidden = false; $("#co-adjuntos").textContent = `📎 ${m.adjuntos.join(", ")}`; }
    $("#co-texto").textContent = m.texto || m.vista_previa || "(Sin texto)";
  } catch (err) {
    $("#co-cuenta").textContent = "Correo";
    $("#co-texto").textContent = `No pude abrir este correo: ${err.message}`;
  }
}

function abrirRedactar({ responder } = {}) {
  const conectadas = ["gmail", "outlook"].filter((k) => correoConectado[k]);
  if (!conectadas.length) { burbuja("aviso", "Primero conecte Gmail o Hotmail en ⚙ Ajustes."); return; }
  const sel = $("#rd-cuenta");
  sel.innerHTML = conectadas.map((k) => `<option value="${k}">${NOMBRE_CUENTA[k]}</option>`).join("");
  sel.value = responder?.origen && conectadas.includes(responder.origen) ? responder.origen : conectadas.includes(bandeja) ? bandeja : conectadas[0];
  sel.disabled = Boolean(responder);
  $("#rd-responder").value = responder?.id || "";
  $("#rd-titulo").textContent = responder ? "Responder" : "Nuevo correo";
  $("#rd-para").value = responder ? soloCorreo(responder.de) : "";
  $("#rd-cc").value = "";
  $("#rd-asunto").value = responder ? (/^(re|rv|fw|fwd):/i.test(responder.asunto || "") ? responder.asunto : `Re: ${responder.asunto || ""}`) : "";
  $("#rd-cuerpo").value = "";
  $("#rd-msg").hidden = true;
  $("#rd-msg").classList.remove("ok");
  rdConfirmar = false;
  $("#rd-enviar").textContent = "Enviar";
  $("#dlg-redactar").showModal();
  setTimeout(() => (responder ? $("#rd-cuerpo") : $("#rd-para")).focus(), 50);
}

let rdConfirmar = false;
const datosRedactar = () => ({
  cuenta: $("#rd-cuenta").value,
  para: $("#rd-para").value.trim(),
  cc: $("#rd-cc").value.trim(),
  asunto: $("#rd-asunto").value.trim(),
  cuerpo: $("#rd-cuerpo").value,
  responder_a: $("#rd-responder").value || undefined,
});
const avisoRedactar = (texto, ok = false) => { $("#rd-msg").hidden = false; $("#rd-msg").textContent = texto; $("#rd-msg").classList.toggle("ok", ok); };

$("#btn-redactar").addEventListener("click", () => abrirRedactar());
$("#co-cerrar").addEventListener("click", () => $("#dlg-correo").close());
$("#co-responder").addEventListener("click", () => {
  if (!correoAbierto) return;
  const m = correoAbierto;
  $("#dlg-correo").close();
  abrirRedactar({ responder: m });
});
$("#co-delta").addEventListener("click", () => {
  if (!correoAbierto) return;
  const m = correoAbierto;
  $("#dlg-correo").close();
  if (!conDelta()) location.hash = "#/delta";
  enviar(`Ayúdame a contestar este correo de ${NOMBRE_CUENTA[m.origen]} (id ${m.id}) de ${m.de}, asunto "${m.asunto || "(sin asunto)"}". Léelo, dime en una frase qué pide y prepárame un borrador de respuesta para que lo revise antes de enviar.`);
});
$("#rd-cancelar").addEventListener("click", () => $("#dlg-redactar").close());
$("#rd-borrador").addEventListener("click", async () => {
  const d = datosRedactar();
  if (!d.para && !d.responder_a) return avisoRedactar("Falta a quién va el correo.");
  try {
    $("#rd-borrador").disabled = true;
    await api("/correo/borrador", { method: "POST", body: d });
    avisoRedactar(`Guardado en Borradores de ${NOMBRE_CUENTA[d.cuenta]}. No se envió.`, true);
  } catch (err) { avisoRedactar(err.message); } finally { $("#rd-borrador").disabled = false; }
});
$("#rd-enviar").addEventListener("click", async () => {
  const d = datosRedactar();
  if (!d.para && !d.responder_a) return avisoRedactar("Falta a quién va el correo.");
  if (!d.cuerpo.trim()) return avisoRedactar("El mensaje está vacío.");
  // Doble toque para enviar: el primero muestra a quién va, el segundo lo manda.
  if (!rdConfirmar) {
    rdConfirmar = true;
    $("#rd-enviar").textContent = "Sí, enviar";
    return avisoRedactar(`Se enviará desde ${NOMBRE_CUENTA[d.cuenta]} a ${d.para || "quien escribió el correo"}. Toque "Sí, enviar" para confirmar.`, true);
  }
  try {
    $("#rd-enviar").disabled = true;
    const r = await api("/correo/enviar", { method: "POST", body: d });
    $("#dlg-redactar").close();
    sonar("accion");
    burbuja("aviso", `Correo enviado desde ${NOMBRE_CUENTA[d.cuenta]}${r.para ? ` a ${r.para}` : ""}.`);
    hud.extraEn = 0;
    cargarCorreo().catch(() => {});
  } catch (err) {
    rdConfirmar = false;
    $("#rd-enviar").textContent = "Enviar";
    avisoRedactar(`No se pudo enviar: ${err.message}`);
  } finally { $("#rd-enviar").disabled = false; }
});
for (const id of ["#rd-para", "#rd-cc", "#rd-asunto", "#rd-cuerpo"]) {
  $(id).addEventListener("input", () => { if (rdConfirmar) { rdConfirmar = false; $("#rd-enviar").textContent = "Enviar"; $("#rd-msg").hidden = true; } });
}
document.addEventListener("click", (e) => {
  const li = e.target.closest?.("[data-abrir-correo]");
  if (li) abrirCorreo(li.dataset.abrirCorreo);
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const li = e.target.closest?.("[data-abrir-correo]");
  if (li) abrirCorreo(li.dataset.abrirCorreo);
});

document.querySelectorAll("[data-bandeja]").forEach((b) => b.addEventListener("click", () => {
  bandeja = b.dataset.bandeja;
  try { localStorage.setItem("delta_bandeja", bandeja); } catch { /* sin almacenamiento */ }
  pintarBandeja();
}));


// ---------------- Mood de día y de noche ----------------
const MOOD_COLOR = { dia: "#f4f1ff", noche: "#04030c" };
function moodActual() {
  const m = guardado.get("delta_mood", "auto");
  if (m === "dia" || m === "noche") return m;
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: zona, hour: "numeric", hourCycle: "h23" }).format(new Date()));
  return h >= 7 && h < 19 ? "dia" : "noche";
}
function aplicarMood() {
  const m = moodActual();
  const raiz = document.documentElement;
  if (raiz.dataset.mood !== m) {
    raiz.classList.add("cambiando-mood");
    raiz.dataset.mood = m;
    setTimeout(() => raiz.classList.remove("cambiando-mood"), 900);
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", MOOD_COLOR[m]);
  const b = $("#btn-mood");
  if (b) b.setAttribute("aria-label", m === "dia" ? "Cambiar a modo noche" : "Cambiar a modo día");
}
$("#btn-mood").addEventListener("click", () => {
  guardado.set("delta_mood", moodActual() === "dia" ? "noche" : "dia"); // al tocarlo, se queda fijo hasta volver a "automático"
  aplicarMood();
  sonar("accion");
});
setInterval(aplicarMood, 60_000);
aplicarMood();

// ---------------- Inicio tipo centro de mando (HUD) ----------------
const hud = { panel: null, correo: null, noticias: null, extraEn: 0 };
const ICONOS = {
  cita: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  tarea: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 12 3 3 5-6"/></svg>',
  correo: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  aprob: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>',
};
const horaEn = (fecha) => Number(new Intl.DateTimeFormat("en-US", { timeZone: zona, hour: "numeric", hourCycle: "h23" }).format(fecha));

function pintarMosaicos() {
  const p = hud.panel;
  if (!p) return;
  const sinLeer = totalSinLeer(hud.correo);
  const mosaicos = [
    { ir: "agenda", icono: ICONOS.cita, n: p.hoy.eventos, txt: p.hoy.eventos === 1 ? "cita hoy" : "citas hoy" },
    { ir: "tareas", icono: ICONOS.tarea, n: p.hoy.pendientes, txt: "pendientes", alerta: p.hoy.vencidas ? `${p.hoy.vencidas} atrasada${p.hoy.vencidas === 1 ? "" : "s"}` : "" },
    { ir: "correo", icono: ICONOS.correo, n: sinLeer, txt: sinLeer == null ? "correo" : "sin leer" },
    { ir: "aprobaciones", icono: ICONOS.aprob, n: p.aprobaciones_pendientes || 0, txt: "por aprobar" },
  ];
  const html = mosaicos.map((m) => `<a class="hud-tile" href="#/${m.ir}"><span class="hud-tile-icono">${m.icono}</span><b data-cuenta="${m.n ?? ""}">${m.n ?? "–"}</b><span>${m.txt}</span>${m.alerta ? `<em>${m.alerta}</em>` : ""}</a>`).join("");
  for (const sel of ["#resumen-hoy", "#hoy-mini"]) {
    const caja = $(sel);
    const antes = [...caja.querySelectorAll("b")].map((b) => b.textContent);
    caja.innerHTML = html;
    caja.querySelectorAll("b[data-cuenta]").forEach((b, i) => { if (b.dataset.cuenta !== "" && antes[i] !== b.dataset.cuenta) contar(b, Number(b.dataset.cuenta)); });
  }
}

// Los números suben de 0 a su valor (rápido y suave).
function contar(el, hasta) {
  if (!hasta || matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = hasta; return; }
  const ini = performance.now(), dur = 700;
  const paso = (t) => {
    const k = Math.min(1, (t - ini) / dur);
    el.textContent = Math.round(hasta * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(paso);
  };
  requestAnimationFrame(paso);
}

function faltaPara(iso) {
  const min = Math.round((new Date(iso) - Date.now()) / 60000);
  if (min <= 0) return "ahora";
  if (min < 60) return `en ${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h < 24) return `en ${h} h${m ? ` ${m} min` : ""}`;
  return fmtDia(iso).toLowerCase();
}

function pintarSiguiente() {
  const p = hud.panel;
  const caja = $("#hud-siguiente");
  if (!p || !caja) return;
  const prox = p.eventos.find((e) => new Date(e.fin || e.inicio) > Date.now()) || null;
  caja.innerHTML = prox
    ? `<span class="hud-etiqueta">Siguiente</span><b>${esc(prox.titulo)}</b><span class="sub">${fmtDia(prox.inicio)} ${fmtHora(prox.inicio)}${prox.lugar ? " · " + esc(prox.lugar) : ""}</span><span class="hud-cuenta">${faltaPara(prox.inicio)}</span>`
    : `<span class="hud-etiqueta">Siguiente</span><b>Agenda libre</b><span class="sub">No tienes citas en los próximos días.</span>`;
  const resto = p.eventos.filter((e) => e !== prox && new Date(e.fin || e.inicio) > Date.now()).slice(0, 3);
  $("#hoy-citas").innerHTML = resto.map((e) => `<li><div class="cuerpo">${esc(e.titulo)}<span class="sub">${fmtDia(e.inicio)} ${fmtHora(e.inicio)}${e.lugar ? " · " + esc(e.lugar) : ""}</span></div></li>`).join("");
}

function momentoDelDia(h = horaEn(new Date())) {
  return h < 12 && h >= 5 ? "Buenos días" : h < 19 && h >= 12 ? "Buenas tardes" : "Buenas noches";
}

function pintarFrase() {
  const p = hud.panel;
  if (!p) return;
  $("#hud-saludo").textContent = momentoDelDia();
  const prox = p.eventos.find((e) => new Date(e.inicio) > Date.now());
  const partes = [];
  if (prox && new Date(prox.inicio) - Date.now() < 864e5) partes.push(`Tu siguiente cita es ${faltaPara(prox.inicio)}: ${prox.titulo}.`);
  else partes.push("Sin citas por delante hoy.");
  if (p.hoy.vencidas) partes.push(`Ojo: ${p.hoy.vencidas} pendiente${p.hoy.vencidas === 1 ? "" : "s"} atrasado${p.hoy.vencidas === 1 ? "" : "s"}.`);
  else if (!p.hoy.pendientes) partes.push("Todo al día.");
  $("#hud-frase").textContent = partes.join(" ");
}

function relojHud() {
  const ahora = new Date();
  const partes = Object.fromEntries(new Intl.DateTimeFormat("es-MX", { timeZone: zona, hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true }).formatToParts(ahora).map((x) => [x.type, x.value]));
  if (!$("#hud-hora")) return;
  $("#hud-hora").textContent = `${partes.hour}:${partes.minute}`;
  $("#hud-seg").textContent = partes.second;
  $("#hud-ampm").textContent = (partes.dayPeriod || "").replace(/\s/g, "").toLowerCase();
  $("#hud-fecha").textContent = new Intl.DateTimeFormat("es-MX", { timeZone: zona, weekday: "long", day: "numeric", month: "long" }).format(ahora);
  // Barra fina con cuánto del día ya pasó
  const h = horaEn(ahora), m = Number(partes.minute);
  $("#hud-progreso").style.width = `${((h * 60 + m) / 1440) * 100}%`;
  if (partes.second === "00") { pintarFrase(); pintarSiguiente(); }
}

const CLIMA = [
  [[0], "Despejado", "sol"], [[1], "Casi despejado", "sol"], [[2], "Parcialmente nublado", "nube-sol"], [[3], "Nublado", "nube"],
  [[45, 48], "Neblina", "nube"], [[51, 53, 55, 56, 57], "Llovizna", "lluvia"], [[61, 63, 65, 66, 67, 80, 81, 82], "Lluvia", "lluvia"],
  [[71, 73, 75, 77, 85, 86], "Nieve", "nube"], [[95, 96, 99], "Tormenta", "tormenta"],
];
const ICONO_CLIMA = {
  sol: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/>',
  luna: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  "nube-sol": '<path d="M8 4.5v1.6M3.6 8.6h1.6M4.9 5.4l1.1 1.1M11.6 5.4l-1.1 1.1"/><path d="M5.6 11a3 3 0 0 1 5.3-2.2"/><path d="M8 19h9a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6 1A3 3 0 0 0 8 19z"/>',
  nube: '<path d="M7 19h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 19z"/>',
  lluvia: '<path d="M7 15h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 15z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>',
  tormenta: '<path d="M7 15h10a4 4 0 0 0 .5-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 15z"/><path d="m12 15-2 4h3l-2 4"/>',
};
function pintarClima(d) {
  const c = d?.current;
  if (!c) return;
  const [, texto, icono] = CLIMA.find(([codigos]) => codigos.includes(c.weather_code)) || [null, "", "nube"];
  const ico = !c.is_day && icono === "sol" ? "luna" : icono;
  const max = d.daily?.temperature_2m_max?.[0], min = d.daily?.temperature_2m_min?.[0];
  $("#hud-clima").innerHTML = `<svg viewBox="0 0 24 24">${ICONO_CLIMA[ico]}</svg><div><b>${Math.round(c.temperature_2m)}°</b><span>${texto}${max != null ? ` · ${Math.round(max)}° / ${Math.round(min)}°` : ""}</span></div>`;
  $("#hud-clima").hidden = false;
}

function pintarTicker(lista) {
  const caja = $("#hud-ticker-caja");
  if (!lista.length) { caja.hidden = true; return; }
  const item = (d) => {
    const c = d.cambio_dia_pct;
    return `<span class="tk"><b>${esc(d.nombre)}</b> ${esc(d.precio?.toLocaleString("es-MX") ?? "")} <i class="${c > 0 ? "sube" : c < 0 ? "baja" : ""}">${c > 0 ? "▲" : c < 0 ? "▼" : ""} ${c ?? "–"}%</i></span>`;
  };
  const fila = lista.map(item).join("");
  $("#hud-ticker").innerHTML = fila + fila; // dos veces para que el carrusel no tenga corte
  $("#hud-ticker").style.animationDuration = `${Math.max(30, lista.length * 6)}s`;
  caja.hidden = false;
}

// Correo y noticias del inicio: cada 5 minutos como máximo.
async function cargarHudExtra() {
  if (Date.now() - hud.extraEn < 290e3) return;
  hud.extraEn = Date.now();
  const [correo, notas] = await Promise.allSettled([api("/correo"), api("/noticias")]);
  hud.correo = correo.status === "fulfilled" ? correo.value : null;
  hud.noticias = notas.status === "fulfilled" ? notas.value : null;
  const c = hud.correo;
  const filaMini = (m) => `<li class="${m.sin_leer ? "sin-leer" : ""}"><div class="cuerpo"><b>${esc(remitente(m))}</b><span class="sub">${esc(m.asunto || "(sin asunto)")}</span></div><span class="tenue hora">${fmtHora(m.fecha)}</span></li>`;
  const bloque = (k) => {
    const x = c.cuentas[k];
    const nombre = NOMBRE_CUENTA[k];
    let filas;
    if (!x.conectado) filas = `<li class="vacio">Conéctelo en ⚙ Ajustes.</li>`;
    else if (x.error) filas = `<li class="vacio">No pude revisarlo ahora.</li>`;
    else {
      const nuevos = x.correos.filter((m) => m.sin_leer);
      const ver = (nuevos.length ? nuevos : x.correos).slice(0, 2);
      filas = ver.length ? ver.map(filaMini).join("") : `<li class="vacio">Bandeja tranquila.</li>`;
    }
    const n = nuevosEn(x);
    return `<a href="#/correo" class="hud-bandeja" data-abrir-bandeja="${k}"><span>${nombre}</span>${n ? `<b>${n} sin leer</b>` : ""}</a><ul class="lista correos-mini">${filas}</ul>`;
  };
  $("#hud-correo").innerHTML = !c
    ? `<ul class="lista correos-mini"><li class="vacio">No pude revisar el correo ahora.</li></ul>`
    : BANDEJAS.map(bloque).join("");
  const titulares = (hud.noticias || []).flatMap((t) => (t.noticias || []).slice(0, 1).map((n) => ({ ...n, tema: t.tema }))).slice(0, 4);
  $("#hud-noticias").innerHTML = titulares.length
    ? titulares.map((n) => `<li><div class="cuerpo"><span class="hud-tema">${esc(n.tema)}</span><a href="${esc(/^https:\/\//.test(n.enlace) ? n.enlace : "#")}" target="_blank" rel="noopener noreferrer">${esc(n.titulo)}</a><span class="sub">${esc(n.fuente || "")}</span></div></li>`).join("")
    : `<li class="vacio">Sin titulares por ahora.</li>`;
  pintarMosaicos();
}

// Brillo que sigue al cursor sobre las tarjetas
document.addEventListener("pointermove", (e) => {
  const card = e.target.closest?.(".hud-card, .hud-tile");
  if (!card) return;
  const r = card.getBoundingClientRect();
  card.style.setProperty("--mx", `${e.clientX - r.left}px`);
  card.style.setProperty("--my", `${e.clientY - r.top}px`);
}, { passive: true });

// ---- Conversación: "pensando" y respuesta que se va escribiendo ----
const FRASES_PENSANDO = ["Déjame ver", "Revisando", "Un segundito", "Ya casi"];
function burbujaPensando() {
  const b = burbuja("assistant pensando", "");
  b.innerHTML = `<span class="pensando-texto">${FRASES_PENSANDO[0]}</span><span class="puntos"><i></i><i></i><i></i></span>`;
  let i = 0;
  b._frases = setInterval(() => {
    const t = b.querySelector(".pensando-texto");
    if (!t) return clearInterval(b._frases);
    i = (i + 1) % FRASES_PENSANDO.length;
    t.textContent = FRASES_PENSANDO[i];
  }, 2200);
  return b;
}
function escribir(el, texto) {
  clearInterval(el._frases);
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || texto.length > 1800) { el.textContent = texto; return; }
  const conv = $("#conversacion");
  const ini = performance.now();
  const dur = Math.min(2200, 300 + texto.length * 12);
  el.classList.add("escribiendo");
  const paso = (t) => {
    const k = Math.min(1, (t - ini) / dur);
    el.textContent = texto.slice(0, Math.ceil(texto.length * k));
    conv.scrollTop = conv.scrollHeight;
    if (k < 1) requestAnimationFrame(paso);
    else el.classList.remove("escribiendo");
  };
  requestAnimationFrame(paso);
}

// ---- Saludo con el resumen del día (una vez al día, al abrir) ----
const NUMEROS = ["doce", "una", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once"];
function horaHablada(iso) {
  const f = new Date(iso);
  const h = horaEn(f);
  const m = Number(new Intl.DateTimeFormat("en-US", { timeZone: zona, minute: "2-digit" }).format(f));
  const n = NUMEROS[h % 12];
  const min = m === 0 ? "" : m === 15 ? " y cuarto" : m === 30 ? " y media" : ` y ${m}`;
  const parte = h < 6 ? "de la madrugada" : h < 12 ? "de la mañana" : h < 20 ? "de la tarde" : "de la noche";
  return `${h % 12 === 1 ? "la" : "las"} ${n}${min} ${parte}`;
}
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

function textoSaludo() {
  const p = hud.panel;
  if (!p) return null;
  const frases = [`${momentoDelDia()}.`];
  const hoyClave = claveDia(new Date());
  const deHoy = p.eventos.filter((e) => claveDia(new Date(e.inicio)) === hoyClave && new Date(e.inicio) > Date.now());
  if (deHoy.length) frases.push(`${deHoy.length === 1 ? "Te queda una cita" : `Te quedan ${deHoy.length} citas`} hoy; ${deHoy.length === 1 ? "es" : "la siguiente es"} ${deHoy[0].titulo}, a ${horaHablada(deHoy[0].inicio)}.`);
  else frases.push("Hoy ya no tienes citas.");
  if (p.hoy.pendientes) frases.push(`Llevas ${plural(p.hoy.pendientes, "pendiente", "pendientes")}${p.hoy.vencidas ? `, y ${p.hoy.vencidas === 1 ? "uno está atrasado" : `${p.hoy.vencidas} están atrasados`}` : ""}.`);
  else frases.push("Y no tienes pendientes, vas impecable.");
  const nG = hud.correo?.conectado ? nuevosEn(hud.correo.cuentas.gmail) : 0;
  const nH = hud.correo?.conectado ? nuevosEn(hud.correo.cuentas.outlook) : 0;
  if (nG && nH) frases.push(`Tienes ${plural(nG, "correo nuevo", "correos nuevos")} en Gmail y ${nH} en Hotmail.`);
  else if (nG || nH) frases.push(`Tienes ${plural(nG || nH, "correo nuevo", "correos nuevos")} en ${nG ? "Gmail" : "Hotmail"}.`);
  if (p.aprobaciones_pendientes) frases.push(`La agencia te dejó ${plural(p.aprobaciones_pendientes, "cosa", "cosas")} para aprobar.`);
  frases.push("¿Por dónde empezamos?");
  return frases.join(" ");
}
const saludoPendiente = () => guardado.get("delta_saludo") !== "0" && guardado.get("delta_saludo_dia") !== claveDia(new Date()) && !!hud.panel;
async function saludoDelDia(conVoz) {
  if (!saludoPendiente()) return;
  guardado.set("delta_saludo_dia", claveDia(new Date()));
  // Espera un poco al correo para incluir los no leídos (sin pasar de 3 segundos).
  if (!hud.correo) await Promise.race([cargarHudExtra().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
  const texto = textoSaludo();
  if (!texto) return;
  escribir(burbuja("assistant", ""), texto);
  if (conVoz) hablar(texto);
}

// ---- Accesos rápidos, manos libres y "mantén espacio para hablar" ----
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-rellenar]");
  if (!b) return;
  const t = $("#texto");
  t.value = b.dataset.rellenar;
  t.focus();
  t.setSelectionRange(t.value.length, t.value.length);
});
function pintarManos() {
  const b = $("#btn-manos");
  b.setAttribute("aria-pressed", manosLibres ? "true" : "false");
  b.classList.toggle("on", manosLibres);
}
$("#btn-manos").addEventListener("click", () => {
  manosLibres = !manosLibres;
  guardado.set("delta_manos", manosLibres ? "1" : "0");
  pintarManos();
  sonar(manosLibres ? "escuchar" : "fin_escuchar");
  if (manosLibres) {
    burbuja("aviso", "Manos libres encendido: empieza tu frase con «Delta» u «Oye Delta».");
    if (!escuchando) escuchar();
  } else if (escuchando) reconocedor?.stop();
});
let espacioHablando = false;
const escribiendoEn = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(el.tagName));
addEventListener("keydown", (e) => {
  if (e.code !== "Space" || e.repeat || escribiendoEn(e.target) || document.querySelector("dialog[open]") || $("#app").hidden) return;
  e.preventDefault();
  if (!conDelta()) location.hash = "#/delta";
  espacioHablando = true;
  if (!escuchando) escuchar();
});
addEventListener("keyup", (e) => {
  if (e.code !== "Space" || !espacioHablando) return;
  espacioHablando = false;
  if (escuchando && !manosLibres) setTimeout(() => reconocedor?.stop(), 250); // deja terminar la última palabra
});

// ---------------- Agencia ----------------
const dinero = (n) => (n ? "$" + Number(n).toLocaleString("es-MX", { maximumFractionDigits: 0 }) : "–");
const ESTADO_PROY = { pendiente: "Pendiente", en_proceso: "En proceso", revision: "En revisión", entregado: "Entregado", cancelado: "Cancelado" };
const TIPO_APROB = { publicacion: "Publicación", mensaje_cliente: "Mensaje a cliente", correo: "Correo", presupuesto: "Gasto en anuncios", entrega: "Entrega", factura: "Factura", otro: "Otro" };
let deptosCache = [];
const nombreDepto = (id) => deptosCache.find((d) => d.id === id)?.nombre || id;

/** Markdown sencillo (títulos, negritas, viñetas, enlaces) sobre texto ya escapado. */
function md(texto) {
  const lineas = esc(texto).split("\n");
  let html = "", enLista = false;
  for (const l of lineas) {
    const vi = l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)/);
    if (vi && !enLista) { html += "<ul>"; enLista = true; }
    if (!vi && enLista) { html += "</ul>"; enLista = false; }
    let t = (vi ? vi[1] : l)
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    const h = t.match(/^(#{1,4})\s+(.*)/);
    if (vi) html += `<li>${t}</li>`;
    else if (h) html += `<h4>${h[2]}</h4>`;
    else if (/^\s*(-{3,}|_{3,})\s*$/.test(t)) html += "<hr />";
    else if (t.trim()) html += `<p>${t}</p>`;
  }
  return html + (enLista ? "</ul>" : "");
}

// Panel general y Cuentas viven en /agencia.js (mismo estilo que el tablero de Mercados).
let agenciaUI = null;
const agenciaTableros = () => (agenciaUI ||= iniciarAgencia({
  api, esc, guardado, fmtDia, fmtHora, dinero, ESTADO_PROY, filaTrabajo, sonar,
  zona: () => zona,
  restringido: () => esEquipo() && !yo.todos_los_clientes, // ve solo algunos clientes: uno a la vez
  esEquipo,
  nombreDepto,
  avisar: (texto) => burbuja("aviso", texto),
  editarCliente: (c) => abrirFormCliente(c),
}));
async function cargarTablero() {
  if (!deptosCache.length) deptosCache = await api("/departamentos").catch(() => []);
  return agenciaTableros().cargarPanelGeneral();
}
async function cargarCuentas() {
  if (!deptosCache.length) deptosCache = await api("/departamentos").catch(() => []);
  return agenciaTableros().cargarCuentas();
}

function filaTrabajo(t) {
  const estado = t.estado === "en_proceso" ? `<span class="chip trabajando">trabajando…</span>` : t.estado === "fallo" ? `<span class="chip fallo">falló</span>` : "";
  return `<li data-trabajo="${t.id}"><div class="cuerpo"><b>${esc(nombreDepto(t.departamento))}</b>${t.cliente ? " · " + esc(t.cliente) : ""}<span class="sub">${esc((t.extracto || t.encargo || "").replace(/[#*]/g, "").slice(0, 140))}</span></div>${estado}<span class="tenue num">${fmtDia(t.terminado || t.creado)}</span></li>`;
}

function tarjetaDepto(d, opciones) {
  return `<article class="depto panel" data-depto="${d.id}">
      <header><h3>${esc(d.nombre)}</h3>${d.trabajando ? `<span class="chip trabajando">trabajando…</span>` : ""}</header>
      <p class="tenue">${esc(d.resumen)}</p>
      <ul class="lista clickable">${d.trabajos.length ? d.trabajos.slice(0, 3).map(filaTrabajo).join("") : `<li class="vacio">Sin trabajos todavía.</li>`}</ul>
      <form class="encargo" data-encargo="${d.id}">
        <textarea rows="2" maxlength="4000" placeholder="¿Qué le encarga a ${esc(d.nombre)}?"></textarea>
        <div class="form-mini"><select>${opciones}</select><button type="submit">Encargar</button></div>
      </form>
    </article>`;
}

// Vista de Departamentos: "Oficina" (la fábrica animada) o "Lista" (las tarjetas de siempre).
const secDeptos = document.querySelector('.seccion[data-seccion="departamentos"]');
function vistaDeptos(v) {
  secDeptos.dataset.vistaDeptos = v;
  document.querySelectorAll("[data-vista-fab]").forEach((b) => b.classList.toggle("activa", b.dataset.vistaFab === v));
}
vistaDeptos(guardado.get("delta_vista_deptos", "fabrica") === "lista" ? "lista" : "fabrica");
document.querySelectorAll("[data-vista-fab]").forEach((b) => b.addEventListener("click", () => {
  vistaDeptos(b.dataset.vistaFab);
  guardado.set("delta_vista_deptos", b.dataset.vistaFab);
  refrescar("departamentos", true);
}));

let opcionesDeptos = "";
let pendientesFab = null;
function abrirDepto(id) {
  const d = deptosCache.find((x) => x.id === id);
  if (!d) return;
  $("#dd-cuerpo").innerHTML = tarjetaDepto(d, opcionesDeptos);
  const tablero = tableroDe(id);
  $("#dd-tablero").hidden = !(tablero && puedeAbrir(tablero));
  if (tablero) $("#dd-tablero").href = "#/" + tablero;
  sonar("accion");
  $("#dlg-depto").showModal();
}
$("#dd-cerrar").addEventListener("click", () => $("#dlg-depto").close());
$("#dd-tablero").addEventListener("click", () => $("#dlg-depto").close());

async function cargarDeptos() {
  const [deptos, tab, pend] = await Promise.all([api("/departamentos"), api("/agencia"), api("/aprobaciones?estado=pendiente").catch(() => null)]);
  deptosCache = deptos;
  if (Array.isArray(pend)) pendientesFab = pend.length;
  const opciones = opcionesDeptos = `<option value="">Sin cliente</option>` + tab.clientes.filter((c) => c.estado !== "terminado").map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("");
  if (secDeptos.dataset.vistaDeptos === "fabrica") {
    const activos = deptos.filter((d) => d.trabajando > 0);
    const hoy = deptos.reduce((n, d) => n + d.trabajos.filter((t) => t.estado === "listo" && fmtDia(t.terminado || t.creado) === fmtDia(new Date().toISOString())).length, 0);
    $("#fab-barra").innerHTML = `<span class="pastilla-fab ${activos.length ? "vivo" : ""}"><span class="led"></span><b>${activos.length}</b> ${activos.length === 1 ? "departamento trabajando" : "departamentos trabajando"}</span>
      <span class="pastilla-fab"><b>${deptos.length}</b> departamentos</span>
      <span class="pastilla-fab"><b>${hoy}</b> entregados hoy</span>
      ${pendientesFab != null ? `<a class="pastilla-fab" href="#/aprobaciones"><b>${pendientesFab}</b> por aprobar</a>` : ""}
      <span class="ayuda">Toque una sala para encargarle algo</span>`;
    pintarFabrica($("#fabrica"), deptos, { pendientes: pendientesFab }, abrirDepto);
    return;
  }
  // No se repinta una tarjeta mientras se escribe en ella.
  const escribiendo = document.activeElement?.closest?.("#deptos .depto")?.dataset.depto;
  const viejas = Object.fromEntries([...document.querySelectorAll("#deptos .depto")].map((x) => [x.dataset.depto, x]));
  $("#deptos").innerHTML = deptos.map((d) => (d.id === escribiendo && viejas[d.id] ? viejas[d.id].outerHTML : tarjetaDepto(d, opciones))).join("");
}

let filtroAprob = "pendiente";
async function cargarAprobaciones() {
  if (!deptosCache.length) deptosCache = await api("/departamentos").catch(() => []);
  const lista = await api(`/aprobaciones?estado=${filtroAprob}`);
  $("#lista-aprob").innerHTML = lista.length
    ? lista.map((a) => `<li class="aprob-item ${a.estado}">
        <div class="cuerpo">
          <span class="sub">${esc(nombreDepto(a.departamento))}${a.cliente ? " · " + esc(a.cliente) : ""} · ${esc(TIPO_APROB[a.tipo] || a.tipo)} · ${fmtDia(a.creada)} ${fmtHora(a.creada)}</span>
          <b>${esc(a.titulo)}</b>
          <div class="aprob-contenido md">${md(a.contenido)}</div>
          ${a.estado === "pendiente"
            ? `<div class="form-mini aprob-acciones"><input type="text" placeholder="Comentario (opcional)" maxlength="500" /><button type="button" data-resolver="${a.id}" data-decision="rechazada" class="rechazar">Rechazar</button><button type="button" data-resolver="${a.id}" data-decision="aprobada" class="aprobar">Aprobar</button></div>`
            : `<span class="chip ${a.estado}">${esc(a.estado)}</span>${a.comentario ? ` <span class="tenue">“${esc(a.comentario)}”</span>` : ""}`}
        </div></li>`).join("")
    : `<li class="vacio">${filtroAprob === "pendiente" ? "Nada pendiente de aprobar. Todo en orden." : "Sin historial todavía."}</li>`;
}

document.querySelectorAll("[data-aprob]").forEach((b) => b.addEventListener("click", () => {
  filtroAprob = b.dataset.aprob;
  document.querySelectorAll("[data-aprob]").forEach((x) => x.classList.toggle("activa", x === b));
  refrescar("aprobaciones", true);
}));

async function abrirTrabajo(id) {
  const t = await api(`/trabajos/${id}`);
  $("#tr-meta").textContent = `${nombreDepto(t.departamento)}${t.cliente ? " · " + t.cliente : ""} · ${fmtDia(t.terminado || t.creado)}`;
  $("#tr-cuerpo").innerHTML = t.estado === "en_proceso"
    ? `<p class="tenue">Trabajando en: ${esc(t.encargo)}</p>`
    : `<p class="tenue"><b>Encargo:</b> ${esc(t.encargo)}</p><hr />${md(t.resultado || "")}`;
  if (t.departamento === "diseno" || t.departamento === "video") {
    const { piezas } = await api(`/diseno?trabajo=${t.id}`).catch(() => ({ piezas: [] }));
    if (piezas.length) {
      piezasCache = [...piezas, ...piezasCache.filter((x) => !piezas.some((p) => p.id === x.id))];
      $("#tr-cuerpo").insertAdjacentHTML("afterbegin", `<div class="trabajo-piezas">${piezas.map((p) => `<button type="button" data-pieza="${p.id}" title="${esc(p.titulo)}">${miniPieza(p)}</button>`).join("")}</div><p class="tenue">Toca un diseño para verlo y descargarlo.</p>`);
    }
  }
  $("#tr-copiar").onclick = () => navigator.clipboard?.writeText(t.resultado || "").then(() => { $("#tr-copiar").textContent = "Copiado ✓"; setTimeout(() => ($("#tr-copiar").textContent = "Copiar"), 1500); });
  $("#dlg-trabajo").showModal();
}
$("#tr-cerrar").addEventListener("click", () => $("#dlg-trabajo").close());

document.addEventListener("change", async (e) => {
  const sel = e.target.closest("[data-proyecto]");
  if (!sel) return;
  await api(`/proyectos/${sel.dataset.proyecto}`, { method: "PATCH", body: { estado: sel.value } }).catch((err) => burbuja("aviso", err.message));
  sonar("accion");
  refrescar(seccionActual, true);
});

const CAMPOS_CL = ["nombre", "industria", "estado", "contacto", "telefono", "correo", "servicios", "redes", "notas"];
function abrirFormCliente(c) {
  $("#cl-titulo").textContent = c ? "Editar cliente" : "Nuevo cliente";
  $("#cl-id").value = c?.id || "";
  for (const k of CAMPOS_CL) $("#cl-" + k).value = c?.[k] ?? (k === "estado" ? "activo" : "");
  $("#cl-presupuesto").value = c?.presupuesto_mensual ?? "";
  $("#cl-presupuesto-anuncios").value = c?.presupuesto_anuncios ?? "";
  $("#cl-dia-pago").value = c?.dia_pago ?? "";
  $("#cl-msg").hidden = true;
  $("#dlg-cliente").showModal();
}
$("#btn-nuevo-cliente").addEventListener("click", () => abrirFormCliente(null));
$("#cl-cancelar").addEventListener("click", () => $("#dlg-cliente").close());
$("#form-cliente").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(CAMPOS_CL.map((k) => [k, $("#cl-" + k).value.trim()]));
  const pres = $("#cl-presupuesto").value.replace(/[$,\s]/g, "");
  body.presupuesto_mensual = pres ? Number(pres) : null;
  if (pres && !Number.isFinite(body.presupuesto_mensual)) { $("#cl-msg").textContent = "El pago mensual debe ser un número."; $("#cl-msg").hidden = false; return; }
  const tope = $("#cl-presupuesto-anuncios").value.replace(/[$,\s]/g, "");
  body.presupuesto_anuncios = tope ? Number(tope) : null;
  if (tope && !Number.isFinite(body.presupuesto_anuncios)) { $("#cl-msg").textContent = "El tope de anuncios debe ser un número."; $("#cl-msg").hidden = false; return; }
  const dia = $("#cl-dia-pago").value.trim();
  body.dia_pago = dia ? Number(dia) : null;
  if (dia && !(Number.isInteger(body.dia_pago) && body.dia_pago >= 1 && body.dia_pago <= 28)) { $("#cl-msg").textContent = "El día de pago va del 1 al 28."; $("#cl-msg").hidden = false; return; }
  try {
    const id = $("#cl-id").value;
    const guardadoCl = await api(id ? `/clientes/${id}` : "/clientes", { method: id ? "PATCH" : "POST", body });
    $("#dlg-cliente").close();
    sonar("accion");
    if (!id && guardadoCl?.id) guardado.set("delta_cuenta", String(guardadoCl.id));
    refrescar(seccionActual, true);
  } catch (err) { $("#cl-msg").textContent = err.message; $("#cl-msg").hidden = false; }
});

document.addEventListener("click", async (e) => {
  const trab = e.target.closest("[data-trabajo]");
  if (trab) return abrirTrabajo(trab.dataset.trabajo).catch((err) => burbuja("aviso", err.message));
  const res = e.target.closest("[data-resolver]");
  if (res) {
    const comentario = res.closest(".aprob-acciones").querySelector("input").value.trim();
    res.disabled = true;
    try {
      await api(`/aprobaciones/${res.dataset.resolver}`, { method: "POST", body: { decision: res.dataset.decision, comentario } });
      sonar(res.dataset.decision === "aprobada" ? "accion" : "fin_escuchar");
      refrescar("aprobaciones", true);
      cargarPanel().catch(() => {});
    } catch (err) { res.disabled = false; burbuja("aviso", err.message); }
  }
});

document.addEventListener("submit", async (e) => {
  const f = e.target.closest("[data-encargo]");
  if (!f) return;
  e.preventDefault();
  const encargo = f.querySelector("textarea").value.trim();
  if (!encargo) return;
  const boton = f.querySelector("button");
  boton.disabled = true;
  try {
    await api(`/departamentos/${f.dataset.encargo}/encargo`, { method: "POST", body: { encargo, cliente: f.querySelector("select").value || undefined } });
    f.querySelector("textarea").value = "";
    f.querySelector("textarea").blur();
    sonar("enviar");
    if (f.closest("#dlg-depto")) { $("#dlg-depto").close(); burbuja("aviso", "Encargo enviado. Ya están trabajando en él."); }
    refrescar("departamentos", true);
  } catch (err) { burbuja("aviso", err.message); }
  finally { boton.disabled = false; }
});

// ---------------- Estudio de diseño ----------------
const TIPO_PIEZA = { carrusel: "Carrusel", post: "Post", cuadrado: "Post cuadrado", historia: "Historia", portada: "Portada de reel", video: "Video" };
const urlPieza = (p, archivo, descargar) => `/api/diseno/piezas/${p.id}/${archivo}${descargar ? "?descargar=1" : ""}`;
const miniPieza = (p) => p.tipo === "video"
  ? `<video src="${urlPieza(p, p.archivos[0])}#t=0.5" muted playsinline preload="metadata"></video>`
  : `<img src="${urlPieza(p, p.archivos[0])}" alt="" loading="lazy" />`;
let piezasCache = [];

async function cargarEstudio() {
  const d = await api("/diseno");
  piezasCache = d.piezas;
  const h = d.higgsfield;
  $("#estudio-estado").innerHTML = [
    `<span class="chip ${d.puede_renderizar ? "activo" : "fallo"}">${d.puede_renderizar ? "Diseños en imagen: listos" : "Diseños en imagen: falta el navegador del servidor"}</span>`,
    h.conectado
      ? `<span class="chip activo">Higgsfield conectado · hoy ${h.imagenes_hoy}/${h.limite_imagenes} imágenes y ${h.videos_hoy}/${h.limite_videos} videos</span>`
      : `<span class="chip pausado">${h.falta_secreto ? "Higgsfield: falta HIGGSFIELD_API_SECRET en Railway" : "Higgsfield sin conectar: imágenes y videos con IA apagados"}</span>`,
    `<span class="chip ${d.habilidades ? "activo" : "pausado"}">${d.habilidades ? `${d.habilidades} habilidades cargadas` : "Sin habilidades: súbelas en ⚙ Ajustes"}</span>`,
  ].join("");
  $("#estudio-piezas").innerHTML = d.piezas.length
    ? d.piezas.map((p) => `<button type="button" class="pieza" data-pieza="${p.id}">
        <div class="pieza-img">${miniPieza(p)}${p.archivos.length > 1 ? `<span class="cuenta">${p.archivos.length} slides</span>` : ""}</div>
        <div class="pieza-info"><b>${esc(p.titulo)}</b><span>${[TIPO_PIEZA[p.tipo] || p.tipo, p.cliente, fmtDia(p.creada)].filter(Boolean).map(esc).join(" · ")}</span></div>
      </button>`).join("")
    : `<p class="vacio tenue">Todavía no hay diseños. Pídele uno a DELTA o encárgaselo a Diseño en Departamentos.</p>`;
}

let visor = { pieza: null, i: 0 };
async function abrirPieza(id, i = 0) {
  const p = piezasCache.find((x) => x.id === Number(id)) || (await api("/diseno")).piezas.find((x) => x.id === Number(id));
  if (!p) return burbuja("aviso", "Ese diseño ya no existe.");
  visor = { pieza: p, i };
  $("#pz-titulo").textContent = p.titulo;
  $("#pz-meta").textContent = [TIPO_PIEZA[p.tipo] || p.tipo, `${p.ancho}×${p.alto}`, p.cliente, fmtDia(p.creada)].filter(Boolean).join(" · ");
  $("#pz-texto-caja").hidden = !p.texto;
  $("#pz-texto").textContent = p.texto || "";
  $("#pz-copiar").hidden = !p.texto;
  $("#pz-copiar").textContent = "Copiar texto";
  $("#pz-bajar-todo").href = `/api/diseno/piezas/${p.id}/zip`;
  $("#pz-bajar-todo").hidden = p.tipo === "video";
  $("#pz-miniaturas").innerHTML = p.archivos.length > 1 ? p.archivos.map((a, n) => `<button type="button" data-ir-slide="${n}"><img src="${urlPieza(p, a)}" alt="Slide ${n + 1}" loading="lazy" /></button>`).join("") : "";
  pintarVisor();
  if (!$("#dlg-pieza").open) $("#dlg-pieza").showModal();
}
function pintarVisor() {
  const { pieza: p, i } = visor;
  const a = p.archivos[i];
  $("#pz-vista").innerHTML = p.tipo === "video"
    ? `<video src="${urlPieza(p, a)}" controls playsinline autoplay loop></video>`
    : `<img src="${urlPieza(p, a)}" alt="${esc(p.titulo)} · ${i + 1}" />`;
  $("#pz-ant").disabled = i === 0;
  $("#pz-sig").disabled = i >= p.archivos.length - 1;
  $("#pz-ant").hidden = $("#pz-sig").hidden = p.archivos.length < 2;
  $("#pz-bajar-una").href = urlPieza(p, a, true);
  $("#pz-bajar-una").textContent = p.tipo === "video" ? "Descargar video" : p.archivos.length > 1 ? `Descargar slide ${i + 1}` : "Descargar";
  document.querySelectorAll("[data-ir-slide]").forEach((b) => b.classList.toggle("activa", Number(b.dataset.irSlide) === i));
}
const moverVisor = (paso) => { const n = visor.i + paso; if (visor.pieza && n >= 0 && n < visor.pieza.archivos.length) { visor.i = n; pintarVisor(); } };
$("#pz-ant").addEventListener("click", () => moverVisor(-1));
$("#pz-sig").addEventListener("click", () => moverVisor(1));
$("#pz-cerrar").addEventListener("click", () => $("#dlg-pieza").close());
$("#dlg-pieza").addEventListener("keydown", (e) => { if (e.key === "ArrowLeft") moverVisor(-1); if (e.key === "ArrowRight") moverVisor(1); });
let toqueX = null;
$("#pz-vista").addEventListener("touchstart", (e) => { toqueX = e.touches[0].clientX; }, { passive: true });
$("#pz-vista").addEventListener("touchend", (e) => { if (toqueX === null) return; const dx = e.changedTouches[0].clientX - toqueX; if (Math.abs(dx) > 40) moverVisor(dx < 0 ? 1 : -1); toqueX = null; });
$("#pz-miniaturas").addEventListener("click", (e) => { const b = e.target.closest("[data-ir-slide]"); if (b) { visor.i = Number(b.dataset.irSlide); pintarVisor(); } });
$("#pz-copiar").addEventListener("click", () => navigator.clipboard?.writeText(visor.pieza?.texto || "").then(() => { $("#pz-copiar").textContent = "Copiado ✓"; }));
$("#pz-borrar").addEventListener("click", async () => {
  const b = $("#pz-borrar");
  if (b.dataset.seguro !== "1") { b.dataset.seguro = "1"; b.textContent = "¿Seguro? Toca otra vez"; setTimeout(() => { b.dataset.seguro = ""; b.textContent = "Borrar"; }, 3000); return; }
  b.dataset.seguro = ""; b.textContent = "Borrar";
  await api(`/diseno/piezas/${visor.pieza.id}`, { method: "DELETE" }).catch((err) => burbuja("aviso", err.message));
  $("#dlg-pieza").close();
  refrescar("estudio", true);
});
document.addEventListener("click", (e) => {
  const p = e.target.closest("[data-pieza]");
  if (p) abrirPieza(p.dataset.pieza).catch((err) => burbuja("aviso", err.message));
});
$("#btn-pedir-diseno").addEventListener("click", () => setTimeout(() => document.querySelector('[data-encargo="diseno"] textarea')?.focus(), 400));

// ---------------- Secciones ----------------
// Cada sección carga sus datos solo cuando se abre (y se refresca si ya pasó un rato).
const SECCIONES = {
  // "delta" es la vista de entrada: solo DELTA en grande (usa la misma sección que el inicio, sin el tablero)
  delta: { cargar: () => Promise.all([cargarPanel(), cargarHudExtra()]), cada: 60e3 },
  inicio: { cargar: () => Promise.all([cargarPanel(), cargarMercadosMini(), cargarHudExtra()]), cada: 60e3 },
  agenda: { cargar: () => cargarAgenda(), cada: 60e3 },
  tareas: { cargar: () => cargarPanel(), cada: 60e3 },
  correo: { cargar: () => cargarCorreo(), cada: 120e3 },
  mercados: { cargar: () => cargarMercadosYNoticias(), cada: 300e3 },
  agencia: { cargar: () => cargarTablero(), cada: 30e3 },
  finanzas: { cargar: () => agenciaTableros().cargarFinanzas(), cada: 60e3 },
  analitica: { cargar: () => agenciaTableros().cargarAnalitica(), cada: 120e3 },
  contenido: { cargar: () => agenciaTableros().cargarContenido(), cada: 30e3 },
  tendencias: { cargar: () => agenciaTableros().cargarTendencias(), cada: 120e3 },
  seo: { cargar: () => agenciaTableros().cargarSeo(), cada: 120e3 },
  crm: { cargar: () => agenciaTableros().cargarCrm(), cada: 30e3 },
  equipo: { cargar: () => agenciaTableros().cargarEquipo(), cada: 60e3 },
  paidmedia: { cargar: () => agenciaTableros().cargarPaidMedia(), cada: 120e3 },
  cuentas: { cargar: () => cargarCuentas(), cada: 30e3 },
  departamentos: { cargar: () => cargarDeptos(), cada: 30e3 },
  aprobaciones: { cargar: () => cargarAprobaciones(), cada: 30e3 },
  estudio: { cargar: () => cargarEstudio(), cada: 30e3 },
};
let seccionActual = "delta";
const conDelta = (n = seccionActual) => n === "delta" || n === "inicio"; // vistas donde está el orbe
const cargadaEn = {};

function refrescar(nombre, forzar = false) {
  const s = SECCIONES[nombre];
  if (!s?.cargar) return;
  if (!forzar && Date.now() - (cargadaEn[nombre] || 0) < s.cada) return;
  cargadaEn[nombre] = Date.now();
  s.cargar().catch(() => { cargadaEn[nombre] = 0; });
}

function mostrarSeccion(nombre) {
  if (!SECCIONES[nombre]) nombre = "delta";
  if (!puedeAbrir(nombre)) { nombre = "tareas"; history.replaceState(null, "", "#/tareas"); }
  seccionActual = nombre;
  const vista = nombre === "delta" ? "inicio" : nombre;
  document.querySelectorAll(".seccion").forEach((x) => x.classList.toggle("visible", x.dataset.seccion === vista));
  document.querySelector('.seccion[data-seccion="inicio"]').classList.toggle("modo-delta", nombre === "delta");
  document.querySelectorAll("[data-ir]").forEach((x) => x.classList.toggle("activa", x.dataset.ir === nombre));
  pintarMenu();
  $("#mini-orbe").hidden = conDelta(nombre) || esEquipo();
  document.body.dataset.seccion = nombre;
  cerrarMenu();
  refrescar(nombre);
  if (conDelta(nombre)) $("#conversacion").scrollTop = $("#conversacion").scrollHeight;
}

const seccionDeLaDireccion = () => (location.hash.match(/^#\/(\w+)/) || [])[1] || "delta";
addEventListener("hashchange", () => mostrarSeccion(seccionDeLaDireccion()));

// Menú en el celular: se abre con "Más"
// Grupos del menú (Personal, Agencia, Herramientas) que se pliegan para que la barra no sea tan larga.
var menuCerrados = (() => { try { return new Set(JSON.parse(guardado.get("delta_menu_cerrados") || '["herramientas"]')); } catch { return new Set(["herramientas"]); } })();
(() => {
  let grupo = null;
  for (const x of $("#menu").children) {
    if (x.classList.contains("menu-grupo") && x.id !== "menu-hola") {
      grupo = x.textContent.trim().toLowerCase();
      x.dataset.grupo = grupo;
      x.setAttribute("role", "button");
      x.tabIndex = 0;
      continue;
    }
    if (grupo && x.classList.contains("menu-item") && !x.classList.contains("solo-equipo")) x.dataset.enGrupo = grupo;
  }
  const alternar = (g) => {
    if (menuCerrados.has(g)) menuCerrados.delete(g); else menuCerrados.add(g);
    guardado.set("delta_menu_cerrados", JSON.stringify([...menuCerrados]));
    pintarMenu();
  };
  $("#menu").addEventListener("click", (e) => { const g = e.target.closest("[data-grupo]"); if (g) alternar(g.dataset.grupo); });
  $("#menu").addEventListener("keydown", (e) => { const g = e.target.closest("[data-grupo]"); if (g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); alternar(g.dataset.grupo); } });
})();
function pintarMenu() {
  for (const g of document.querySelectorAll("#menu [data-grupo]")) {
    const cerrado = menuCerrados.has(g.dataset.grupo);
    g.classList.toggle("cerrado", cerrado);
    g.setAttribute("aria-expanded", String(!cerrado));
    const items = [...document.querySelectorAll(`#menu [data-en-grupo="${g.dataset.grupo}"]`)];
    g.classList.toggle("con-aviso", cerrado && items.some((x) => x.querySelector(".badge:not([hidden])")));
  }
  for (const x of document.querySelectorAll("#menu [data-en-grupo]")) x.classList.toggle("plegado", menuCerrados.has(x.dataset.enGrupo) && !x.classList.contains("activa"));
}
pintarMenu();

function cerrarMenu() { $("#menu").classList.remove("abierto"); $("#menu-fondo").hidden = true; }
$("#btn-mas").addEventListener("click", () => { $("#menu").classList.add("abierto"); $("#menu-fondo").hidden = false; });
$("#btn-menu-pc").addEventListener("click", () => { $("#menu").classList.add("abierto"); $("#menu-fondo").hidden = false; });
$("#menu-fondo").addEventListener("click", cerrarMenu);

// Botones "Resumir con DELTA" / "Analizar con DELTA": llevan la pregunta al chat.
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-pedir]");
  if (!b) return;
  if (!conDelta()) location.hash = "#/delta";
  enviar(b.dataset.pedir);
});

for (const boton of document.querySelectorAll("[data-correo]")) {
  boton.addEventListener("click", async () => {
    const k = boton.dataset.correo;
    try {
      if (correoConectado[k]) {
        await api(`/${k}/desconectar`, { method: "POST" });
        $("#aj-msg").textContent = `${NOMBRE_CUENTA[k]} desconectado.`;
        hud.extraEn = 0;
        return cargarPanel();
      }
      const { url } = await api(`/${k}/conectar`);
      location.href = url;
    } catch (err) { $("#aj-msg").textContent = err.message; }
  });
}

// Meta: si ya está conectado abre la ventana de clientes; si no, va a Facebook a dar permiso.
$("#btn-meta-aj").addEventListener("click", async () => {
  try {
    if (metaConectado) {
      $("#ajustes").close();
      location.hash = "#/cuentas";
      return void agenciaTableros().abrirMeta();
    }
    const { url } = await api("/meta/conectar");
    location.href = url;
  } catch (err) { $("#aj-msg").textContent = err.message; }
});
{
  const q = new URLSearchParams(location.search);
  const m = q.get("meta");
  if (m) {
    history.replaceState(null, "", "/" + location.hash);
    setTimeout(() => {
      burbuja("aviso", m === "ok" ? "Meta conectado. Estoy buscando las páginas, Instagram y cuentas de anuncios de sus clientes; en un momento le enseño qué encontré." : `No se pudo conectar Meta: ${q.get("motivo") || "intente de nuevo"}`);
      if (m === "ok") setTimeout(() => agenciaTableros().abrirMeta().catch(() => {}), 2500);
    }, 800);
  }
}

// Regreso de Google después de conectarlo para SEO (Search Console y Analytics)
{
  const q = new URLSearchParams(location.search);
  const m = q.get("seo");
  if (m) {
    history.replaceState(null, "", "/" + location.hash);
    setTimeout(() => burbuja("aviso", m === "ok" ? "Google conectado. Ya puedo ver las visitas y las posiciones en Google de sus clientes." : `No se pudo conectar Google: ${q.get("motivo") || "intente de nuevo"}`), 800);
  }
}
// Regreso de Google o Microsoft después de conectar un correo
{
  const q = new URLSearchParams(location.search);
  const estado = q.get("correo") || q.get("gmail");
  if (estado) {
    const nombre = NOMBRE_CUENTA[q.get("cuenta")] || "Gmail";
    history.replaceState(null, "", "/");
    setTimeout(() => burbuja("aviso", estado === "ok" ? `${nombre} conectado. Pregúnteme por su correo cuando guste.` : `No se pudo conectar ${nombre}: ${q.get("motivo") || "intente de nuevo"}`), 800);
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

// La Agenda tiene su propia sección a pantalla completa.
document.body.classList.add("cal-amplio");

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
  if (!h.length) burbuja("assistant", "¡Hola! Aquí estoy. Pídeme lo que quieras: agendar una cita, anotar una tarea o recordarte algo.");
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
  const espera = burbujaPensando(texto);
  orbe.estado("pensando");
  try {
    const { respuesta, hizo_cambio, abrir } = await api("/chat", { method: "POST", body: { texto, canal, archivos } });
    if (abrir && SECCIONES[abrir]) setTimeout(() => { location.hash = "#/" + abrir; }, 900);
    sonar(hizo_cambio || archivos.length ? "accion" : "respuesta");
    espera.className = "burbuja assistant";
    escribir(espera, respuesta);
    if (canal === "voz" || guardado.get("delta_voz") === "1") hablar(respuesta);
    else orbe.estado("reposo");
    cargarPanel();
    if (seccionActual === "agenda") cargarAgenda().catch(() => {});
  } catch (err) {
    sonar("error");
    clearInterval(espera._frases);
    espera.className = "burbuja aviso";
    espera.textContent = "Uy, no pude con eso: " + err.message;
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

function hablarNavegador(texto, { alEmpezar, alTerminar, voz = vozEspanol, rate = 1.03, pitch = 0.95 } = {}) {
  if (!("speechSynthesis" in window)) return alTerminar?.();
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(texto.replace(/[•*_#]/g, ""));
  const v = voz();
  if (v) u.voice = v;
  u.lang = v?.lang || "es-MX";
  u.rate = rate;
  u.pitch = pitch;
  u.onstart = () => alEmpezar?.();
  u.onend = () => alTerminar?.();
  speechSynthesis.speak(u);
}

// ---------------- Voz natural (voz clonada en el servidor) ----------------
// Si está configurada, DELTA habla con esa voz; si falla, usa la del navegador sin que se note.
let vozNatural = { disponible: false, activa: false, voz: null };
const reproductor = new Audio();
const ecoActivo = () => guardado.get("delta_voz_eco") !== "0";

// Eco muy suave: la voz pasa por una "sala" pequeña hecha en el navegador (10 % de eco, 90 % voz limpia).
let sala = null;
function salaDeEco() {
  if (sala) return sala;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  try {
    const ctx = new Ctx();
    const fuente = ctx.createMediaElementSource(reproductor);
    const seco = ctx.createGain();
    const humedo = ctx.createGain();
    const eco = ctx.createConvolver();
    const filtro = ctx.createBiquadFilter(); // el eco sin agudos suena más cálido y no ensucia
    filtro.type = "lowpass";
    filtro.frequency.value = 4500;
    // Respuesta de una sala pequeña: ruido que se apaga en ~0.9 s, con un pequeño retraso inicial.
    const dur = 0.9, retraso = 0.025, n = Math.floor(ctx.sampleRate * dur);
    const ir = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < n; i++) {
        const t = i / ctx.sampleRate;
        d[i] = t < retraso ? 0 : (Math.random() * 2 - 1) * Math.pow(1 - (t - retraso) / (dur - retraso), 3.2);
      }
    }
    eco.buffer = ir;
    const medidor = ctx.createAnalyser(); // para que el orbe "baile" con la voz real
    medidor.fftSize = 256;
    medidor.smoothingTimeConstant = 0.7;
    fuente.connect(medidor);
    fuente.connect(seco).connect(ctx.destination);
    fuente.connect(filtro).connect(eco).connect(humedo).connect(ctx.destination);
    sala = { ctx, seco, humedo, medidor };
    ajustarEco();
    return sala;
  } catch (e) {
    console.warn("[eco]", e.message);
    return null;
  }
}
function ajustarEco() {
  if (!sala) return;
  const on = ecoActivo();
  sala.seco.gain.value = on ? 0.92 : 1;
  sala.humedo.gain.value = on ? 0.1 : 0;
}
let urlAudio = null;
let turnoVoz = 0;
const SILENCIO = "data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjYwLjE2LjEwMAAAAAAAAAAAAAAA//NwwAAAAAAAAAAAAEluZm8AAAAPAAAABgAAAykAWlpaWlpaWlpaWlpaWlpaWnt7e3t7e3t7e3t7e3t7e3t7nJycnJycnJycnJycnJycnL29vb29vb29vb29vb29vb293t7e3t7e3t7e3t7e3t7e3t7/////////////////////AAAAAExhdmM2MC4zMQAAAAAAAAAAAAAAACQCowAAAAAAAAMpso+sIAAAAAAAAAAAAAAAAAD/80DEAAAAA0gAAAAATEFNRTMuMTAwVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQsRbAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/zQMSkAAADSAAAAABVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NCxKMAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//NAxKQAAANIAAAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/80LEowAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=";
// iPhone y Safari solo dejan sonar audio después de un toque: en el primero se "despierta" el reproductor.
function despertarReproductor() {
  removeEventListener("pointerdown", despertarReproductor, true);
  removeEventListener("keydown", despertarReproductor, true);
  if (!reproductor.src || reproductor.src === SILENCIO) { reproductor.src = SILENCIO; reproductor.play().catch(() => {}); }
  if (vozNatural.activa) salaDeEco()?.ctx.resume().catch(() => {});
}
addEventListener("pointerdown", despertarReproductor, true);
addEventListener("keydown", despertarReproductor, true);

const usarVozNatural = () => vozNatural.activa;

function callarVoz() {
  turnoVoz++;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  reproductor.onended = reproductor.onplaying = null;
  reproductor.pause();
}

async function decir(texto, opciones = {}) {
  callarVoz();
  const turno = turnoVoz;
  let motivo = vozNatural.voz ? (vozNatural.activa ? "" : "está apagada") : "todavía no hay una voz creada";
  if (usarVozNatural()) {
    try {
      const r = await fetch("/api/voz/hablar", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Delta": "1" },
        body: JSON.stringify({ texto }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "sin voz");
      const audio = await r.blob();
      if (turno !== turnoVoz) return { natural: false }; // mientras tanto se pidió callar o decir otra cosa
      if (urlAudio) URL.revokeObjectURL(urlAudio);
      urlAudio = URL.createObjectURL(audio);
      reproductor.src = urlAudio;
      {
        const s = salaDeEco(); // siempre: además del eco, mide la voz para animar el orbe
        if (s && s.ctx.state !== "running") await s.ctx.resume().catch(() => {});
      }
      reproductor.onplaying = () => opciones.alEmpezar?.();
      reproductor.onended = () => opciones.alTerminar?.();
      await reproductor.play();
      return { natural: true };
    } catch (e) {
      console.warn("[voz natural]", e.message);
      motivo = e.message;
      if (turno !== turnoVoz) return { natural: false, motivo };
    }
  }
  hablarNavegador(texto, opciones);
  return { natural: false, motivo };
}

function hablar(texto) {
  decir(texto, {
    alEmpezar: () => orbe.estado("hablando"),
    alTerminar: () => { orbe.estado("reposo"); if (manosLibres) escuchar(); },
  });
}

function escuchar() {
  if (!Reconocimiento) {
    burbuja("aviso", "Este navegador no permite hablarme. En la PC use Chrome o Edge; en iPhone, Safari reciente.");
    return;
  }
  if (escuchando) { reconocedor?.stop(); return; }
  callarVoz();
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
    orbe.pulso();
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
  const textos = { reposo: "Toca para hablar", escuchando: "Escuchando", pensando: "Pensando…", hablando: "Hablando" };
  const colores = { reposo: [139, 115, 255], escuchando: [255, 158, 232], pensando: [183, 166, 255], hablando: [160, 135, 255] };
  let color = [...colores.reposo];
  let empuje = 0; // golpes de energía cuando la persona habla
  const freq = new Uint8Array(128);
  const reducir = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Nivel real de la voz de DELTA (0 a 1) cuando suena la voz natural.
  function nivelVoz() {
    const m = sala?.medidor;
    if (!m || reproductor.paused) return null;
    m.getByteFrequencyData(freq);
    let suma = 0;
    for (let i = 2; i < 60; i++) suma += freq[i];
    return Math.min(1, suma / (58 * 150));
  }
  const chispas = Array.from({ length: 55 }, () => ({ a: Math.random() * Math.PI * 2, r: 0.2 + Math.random() * 0.28, v: (Math.random() - 0.5) * 0.002, t: Math.random() * 3 }));

  // El lienzo se ajusta al tamaño real del orbe para que se vea nítido aunque esté muy grande.
  function ajustarLienzo() {
    const lado = Math.round(Math.min(1600, Math.max(300, lienzo.clientWidth * Math.min(window.devicePixelRatio || 1, 2))));
    if (lado && Math.abs(lienzo.width - lado) > 4) { lienzo.width = lienzo.height = lado; }
  }
  if ("ResizeObserver" in window) new ResizeObserver(ajustarLienzo).observe(lienzo);
  function dibujar(t) {
    const W = lienzo.width, C = W / 2, e = W / 600; // e: escala de trazos respecto al tamaño original
    ctx.clearRect(0, 0, W, W);
    const nivel = estado === "hablando" ? nivelVoz() : null;
    empuje *= 0.94;
    const objetivo = {
      reposo: 0.25 + 0.04 * Math.sin(t / 1400),
      escuchando: 0.6 + 0.4 * empuje,
      pensando: 0.5 + 0.12 * Math.sin(t / 260),
      hablando: nivel != null ? 0.38 + nivel * 0.9 : 0.65 + 0.35 * Math.abs(Math.sin(t / 120)),
    }[estado];
    energia += (objetivo - energia) * (nivel != null ? 0.25 : 0.06);
    color = color.map((c, i) => c + (colores[estado][i] - c) * 0.06);
    const [r, g, b] = color.map(Math.round);
    const dia = document.documentElement.dataset.mood === "dia";
    const rgba = (a) => `rgba(${r},${g},${b},${a})`;
    // De día los trazos (anillos, marcas, cometa) van en un violeta más profundo y firme para que se lean sobre el fondo claro
    const tinta = dia ? (a) => `rgba(${Math.round(r * 0.55)},${Math.round(g * 0.45)},${Math.round(b * 0.85)},${Math.min(1, a * 2.1)})` : rgba;

    // Resplandor de fondo: núcleo violeta y un borde rosado muy tenue
    const halo = ctx.createRadialGradient(C, C, W * 0.05, C, C, W * 0.5);
    halo.addColorStop(0, rgba(0.26 * energia + 0.1));
    halo.addColorStop(0.5, rgba(0.05 + 0.04 * energia));
    halo.addColorStop(0.78, `rgba(255,158,232,${0.025 + 0.03 * energia})`);
    halo.addColorStop(1, rgba(0));
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, W);

    // Esfera de cristal detrás del logo (con un reflejo arriba a la izquierda)
    const R = W * (0.305 + 0.006 * Math.sin(t / 1600) + 0.01 * energia);
    const cristal = ctx.createRadialGradient(C - R * 0.3, C - R * 0.35, R * 0.1, C, C, R);
    // De día la esfera es una gema violeta intensa para que el logo resalte sobre el fondo claro
    cristal.addColorStop(0, dia ? "rgba(150,120,255,0.75)" : "rgba(201,191,255,0.10)");
    cristal.addColorStop(0.6, dia ? "rgba(60,36,170,0.82)" : "rgba(60,40,150,0.10)");
    cristal.addColorStop(0.92, rgba(0.16 + 0.12 * energia));
    cristal.addColorStop(1, rgba(0));
    ctx.fillStyle = cristal;
    ctx.beginPath(); ctx.arc(C, C, R, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(233,230,255,${0.1 + 0.15 * energia})`;
    ctx.lineWidth = 1 * e;
    ctx.beginPath(); ctx.arc(C, C, R, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 2 * e;
    ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(C, C, R * 0.9, Math.PI * 1.12, Math.PI * 1.38); ctx.stroke();

    // Polvo de estrellas que orbita
    for (const p of chispas) {
      p.a += p.v * (1 + energia * 3);
      const rr = W * (p.r + 0.01 * Math.sin(t / 900 + p.t));
      const brillo = 0.2 + 0.7 * Math.pow(Math.abs(Math.sin(t / 900 + p.t)), 3);
      ctx.fillStyle = dia ? `rgba(106,76,240,${brillo * (0.45 + energia * 0.5)})` : `rgba(233,230,255,${brillo * (0.35 + energia * 0.6)})`;
      ctx.beginPath();
      ctx.arc(C + Math.cos(p.a) * rr, C + Math.sin(p.a) * rr, (0.7 + p.t * 0.25) * e, 0, Math.PI * 2);
      ctx.fill();
    }

    // Anillo exterior muy fino con degradado que gira
    const giro0 = t * 0.00012 * (1 + energia * 2);
    const conico = ctx.createConicGradient ? ctx.createConicGradient(giro0, C, C) : null;
    if (conico) {
      conico.addColorStop(0, tinta(0.05));
      conico.addColorStop(0.35, tinta(0.55 + 0.35 * energia));
      conico.addColorStop(0.5, dia ? `rgba(200,64,158,${0.55 + 0.3 * energia})` : `rgba(255,158,232,${0.35 + 0.3 * energia})`);
      conico.addColorStop(0.7, tinta(0.08));
      conico.addColorStop(1, tinta(0.05));
    }
    ctx.strokeStyle = conico || tinta(0.35);
    ctx.lineWidth = 1.2 * e;
    ctx.beginPath(); ctx.arc(C, C, W * 0.445, 0, Math.PI * 2); ctx.stroke();

    // Marcas finas tipo instrumento
    ctx.lineWidth = 1 * e;
    for (let k = 0; k < 120; k++) {
      const a = (k / 120) * Math.PI * 2 - giro0 * 0.6;
      const largo = k % 10 ? 0.008 : 0.02;
      ctx.strokeStyle = tinta(k % 10 ? 0.14 : 0.32);
      ctx.beginPath();
      ctx.moveTo(C + Math.cos(a) * W * 0.465, C + Math.sin(a) * W * 0.465);
      ctx.lineTo(C + Math.cos(a) * W * (0.465 + largo), C + Math.sin(a) * W * (0.465 + largo));
      ctx.stroke();
    }

    // Cometa: un punto de luz que recorre el anillo dejando estela
    const ac = t * 0.0006 * (1 + energia * 1.5);
    for (let k = 0; k < 24; k++) {
      ctx.strokeStyle = tinta((1 - k / 24) * (0.5 + 0.4 * energia));
      ctx.lineWidth = (2.2 - k * 0.07) * e;
      ctx.beginPath();
      ctx.arc(C, C, W * 0.445, ac - (k + 1) * 0.02, ac - k * 0.02);
      ctx.stroke();
    }
    const cx = C + Math.cos(ac) * W * 0.445, cy = C + Math.sin(ac) * W * 0.445;
    const punta = ctx.createRadialGradient(cx, cy, 0, cx, cy, 10 * e);
    punta.addColorStop(0, "rgba(255,255,255,0.95)");
    punta.addColorStop(0.4, tinta(0.6));
    punta.addColorStop(1, tinta(0));
    ctx.fillStyle = punta;
    ctx.beginPath(); ctx.arc(cx, cy, 10 * e, 0, Math.PI * 2); ctx.fill();

    // Dos arcos finos que giran en sentidos contrarios
    [[0.395, -0.0005, 0.9], [0.375, 0.0008, 0.5]].forEach(([rad, vel, largo]) => {
      const g = t * vel * (1 + energia);
      ctx.strokeStyle = tinta(0.22 + 0.45 * energia);
      ctx.lineWidth = 1.3 * e;
      ctx.shadowColor = tinta(0.8);
      ctx.shadowBlur = 8 * energia * e;
      for (let k = 0; k < 2; k++) {
        ctx.beginPath();
        ctx.arc(C, C, W * rad, g + k * Math.PI, g + k * Math.PI + largo * Math.PI * 0.55);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    });

    // Anillo de puntos
    for (let k = 0; k < 90; k++) {
      const a = (k / 90) * Math.PI * 2 + t * 0.00007;
      ctx.fillStyle = tinta(0.12 + 0.1 * Math.abs(Math.sin(k / 4 + t / 1300)));
      ctx.beginPath();
      ctx.arc(C + Math.cos(a) * W * 0.352, C + Math.sin(a) * W * 0.352, 0.9 * e, 0, Math.PI * 2);
      ctx.fill();
    }

    // Barras de audio en círculo (tipo ecualizador) mientras DELTA habla o escucha
    if (energia > 0.4 && estado !== "reposo") {
      const barras = 64;
      ctx.lineCap = "round";
      ctx.lineWidth = 2 * e;
      for (let k = 0; k < barras; k++) {
        const a = (k / barras) * Math.PI * 2 - Math.PI / 2;
        const v = nivel != null
          ? freq[2 + (k < barras / 2 ? k : barras - k)] / 255
          : Math.abs(Math.sin(k * 0.9 + t / 140) * Math.sin(k * 0.37 - t / 330));
        const largo = W * (0.012 + v * 0.07 * energia);
        const r1 = W * 0.318;
        ctx.strokeStyle = tinta(0.18 + 0.6 * v * energia);
        ctx.beginPath();
        ctx.moveTo(C + Math.cos(a) * r1, C + Math.sin(a) * r1);
        ctx.lineTo(C + Math.cos(a) * (r1 + largo), C + Math.sin(a) * (r1 + largo));
        ctx.stroke();
      }
    }

    // Dos ondas de voz muy finas alrededor del logo (solo se notan cuando hay energía)
    for (const [fase, alfa] of [[0, 1], [1.7, 0.5]]) {
      ctx.beginPath();
      const puntos = 140;
      for (let k = 0; k <= puntos; k++) {
        const a = (k / puntos) * Math.PI * 2;
        const onda = Math.sin(a * 7 + t / 230 + fase) * Math.sin(a * 3 - t / 380) * 16 * energia * e;
        const rad = R * 0.94 + onda;
        const x = C + Math.cos(a) * rad, y = C + Math.sin(a) * rad;
        k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.strokeStyle = tinta((0.08 + 0.5 * Math.max(0, energia - 0.25)) * alfa);
      ctx.lineWidth = 1 * e;
      ctx.stroke();
    }

    // En reposo y con "reducir movimiento" se dibuja más lento para cuidar la batería.
    if (reducir && estado === "reposo") setTimeout(() => requestAnimationFrame(dibujar), 250);
    else requestAnimationFrame(dibujar);
  }
  requestAnimationFrame(dibujar);
  return {
    estado(e) { estado = e; $("#estado-orbe").textContent = textos[e]; $("#orbe").dataset.estado = e; },
    pulso() { empuje = Math.min(1, empuje + 0.55); },
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
  relojHud();
}
setInterval(reloj, 10_000);
// En el inicio, el reloj grande lleva segundos.
setInterval(() => { if (seccionActual === "inicio" && !document.hidden) relojHud(); }, 1000);

async function clima() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(async ({ coords }) => {
    try {
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${coords.latitude.toFixed(2)}&longitude=${coords.longitude.toFixed(2)}&current=temperature_2m,weather_code,is_day&daily=temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=auto`);
      const d = await r.json();
      $("#clima").textContent = `${Math.round(d.current.temperature_2m)}°C`;
      pintarClima(d);
    } catch {}
  }, () => {}, { maximumAge: 3600e3 });
}


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
    if (d.tipo === "crm" && seccionActual === "crm") refrescar("crm", true);
    if (d.tipo === "agencia" && ["agencia", "finanzas", "contenido", "paidmedia", "cuentas", "departamentos", "aprobaciones", "estudio"].includes(seccionActual)) refrescar(seccionActual, true);
    if (d.tipo === "aviso" && ["agencia", "finanzas", "contenido", "paidmedia", "cuentas", "departamentos", "aprobaciones", "estudio"].includes(seccionActual)) refrescar(seccionActual, true);
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
  $("#aj-saludo").checked = guardado.get("delta_saludo") !== "0";
  $("#aj-mood-auto").checked = !["dia", "noche"].includes(guardado.get("delta_mood"));
  $("#aj-msg").textContent = "";
  $("#voz-msg").textContent = "";
  $("#hab-msg").textContent = "";
  cargarHabilidades();
  $("#ajustes").showModal();
});
$("#btn-push").addEventListener("click", activarPush);

// Habilidades (las skills del dueño)
async function cargarHabilidades() {
  const lista = await api("/habilidades").catch(() => []);
  $("#hab-lista").innerHTML = lista.length
    ? lista.map((h) => `<li><input type="checkbox" data-hab-activa="${esc(h.nombre)}" ${h.activa ? "checked" : ""} title="Activa" /><div class="cuerpo">${esc(h.nombre)}<span class="sub" title="${esc(h.descripcion)}">${esc(h.descripcion)}</span></div><button type="button" data-hab-borrar="${esc(h.nombre)}">Quitar</button></li>`).join("")
    : `<li class="vacio">Todavía no hay habilidades.</li>`;
}
$("#hab-archivo").addEventListener("change", async (e) => {
  const archivos = [...e.target.files];
  if (!archivos.length) return;
  $("#hab-msg").textContent = "Subiendo…";
  const nuevas = [];
  try {
    for (const f of archivos) {
      const r = await fetch("/api/habilidades", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/octet-stream", "X-Delta": "1", "X-Nombre": encodeURIComponent(f.name) }, body: f });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`${f.name}: ${d.error || "no se pudo subir"}`);
      nuevas.push(...d.guardadas);
    }
    $("#hab-msg").textContent = `Listo: ${nuevas.length} habilidad${nuevas.length === 1 ? "" : "es"} (${nuevas.join(", ")}).`;
    sonar("accion");
  } catch (err) { $("#hab-msg").textContent = err.message; }
  e.target.value = "";
  cargarHabilidades();
});
$("#hab-lista").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-hab-borrar]");
  if (!b) return;
  if (b.dataset.seguro !== "1") { b.dataset.seguro = "1"; b.textContent = "¿Seguro?"; return; }
  await api(`/habilidades/${encodeURIComponent(b.dataset.habBorrar)}`, { method: "DELETE" }).catch((err) => { $("#hab-msg").textContent = err.message; });
  cargarHabilidades();
});
$("#hab-lista").addEventListener("change", (e) => {
  const c = e.target.closest("[data-hab-activa]");
  if (c) api(`/habilidades/${encodeURIComponent(c.dataset.habActiva)}`, { method: "PATCH", body: { activa: c.checked } }).catch((err) => { $("#hab-msg").textContent = err.message; });
});
$("#aj-sonidos").addEventListener("change", (e) => { activarSonidos(e.target.checked); if (e.target.checked) sonar("accion"); });
$("#btn-nueva-conv").addEventListener("click", async () => {
  await api("/conversacion/nueva", { method: "POST" });
  $("#ajustes").close();
  cargarHistorial();
});
$("#menu-salir").addEventListener("click", async () => {
  await fetch("/api/salir", { method: "POST", credentials: "same-origin" });
  location.reload();
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
  guardado.set("delta_saludo", $("#aj-saludo").checked ? "1" : "0");
  if ($("#aj-mood-auto").checked) guardado.set("delta_mood", "auto");
  else if (!["dia", "noche"].includes(guardado.get("delta_mood"))) guardado.set("delta_mood", moodActual());
  aplicarMood();
  pintarManos();
  try {
    await api("/ajustes", { method: "POST", body: { zona_horaria: $("#aj-zona").value.trim(), hora_resumen: $("#aj-resumen").value } });
    cargarPanel();
  } catch (e) { burbuja("aviso", e.message); }
  if (manosLibres && !escuchando) escuchar();
});

// Los mensajes de Ajustes se muestran donde la persona los vea (el cuadro es largo).
for (const id of ["#aj-msg", "#voz-msg"]) {
  new MutationObserver(() => { if ($(id).textContent) $(id).scrollIntoView({ block: "nearest", behavior: "smooth" }); })
    .observe($(id), { childList: true, characterData: true, subtree: true });
}

// ---------------- Ajustes: voz de DELTA ----------------
let borrarVozPendiente = false;
function pintarVoz() {
  const v = vozNatural;
  $("#voz-estado").textContent = !v.disponible
    ? "Ahora DELTA usa la voz del equipo. Para una voz natural falta poner la clave de ElevenLabs en Railway."
    : !v.voz
      ? "Todavía no hay una voz natural. Créela aquí abajo con grabaciones de la persona."
      : `Voz actual: ${v.voz.nombre}.`;
  $("#voz-fila-natural").hidden = !v.voz || !v.disponible;
  $("#voz-fila-eco").hidden = !v.voz || !v.disponible;
  $("#aj-voz-eco").checked = ecoActivo();
  $("#voz-botones").hidden = !v.voz || !v.disponible;
  $("#btn-voz-borrar").hidden = v.voz?.desde !== "app";
  $("#aj-voz-natural").checked = v.encendida;
  $("#voz-crear").hidden = !v.disponible;
  if (v.disponible && !v.voz) $("#voz-crear").open = true;
  borrarVozPendiente = false;
  $("#btn-voz-borrar").textContent = "Borrar esta voz";
}

$("#aj-voz-natural").addEventListener("change", async (e) => {
  try { vozNatural = await api("/voz/encender", { method: "POST", body: { activa: e.target.checked } }); pintarVoz(); }
  catch (err) { $("#voz-msg").textContent = err.message; }
});

$("#aj-voz-eco").addEventListener("change", (e) => {
  guardado.set("delta_voz_eco", e.target.checked ? "1" : "0");
  ajustarEco();
  $("#voz-msg").textContent = e.target.checked ? "Eco suave activado. Toque Probar voz para oírlo." : "Eco quitado.";
});

$("#btn-voz-probar").addEventListener("click", async () => {
  const msg = $("#voz-msg");
  msg.textContent = "Probando la voz…";
  const r = await decir("¡Hola! Soy DELTA. Así sueno ahora, ¿qué te parece?");
  msg.textContent = r.natural ? "Así suena la voz natural. Si no oye nada, suba el volumen del equipo." : `No se pudo usar la voz natural${r.motivo ? ": " + r.motivo : ""}. Sonó la voz del equipo.`;
});

$("#btn-voz-borrar").addEventListener("click", async () => {
  if (!borrarVozPendiente) {
    borrarVozPendiente = true;
    $("#btn-voz-borrar").textContent = "¿Seguro? Toque otra vez para borrarla";
    return;
  }
  $("#voz-msg").textContent = "Borrando la voz…";
  try {
    vozNatural = await api("/voz", { method: "DELETE" });
    pintarVoz();
    $("#voz-msg").textContent = "Voz borrada. DELTA vuelve a la voz del equipo.";
  } catch (err) { $("#voz-msg").textContent = err.message; }
});

$("#btn-voz-crear").addEventListener("click", async () => {
  const msg = $("#voz-msg");
  const archivos = [...$("#voz-archivos").files];
  if (!archivos.length) { msg.textContent = "Elija al menos una grabación."; return; }
  if (archivos.length > 8) { msg.textContent = "Máximo 8 grabaciones."; return; }
  if (!$("#voz-permiso").checked) { msg.textContent = "Confirme que la dueña de la voz dio su permiso."; return; }
  const boton = $("#btn-voz-crear");
  boton.disabled = true;
  try {
    await api("/voz/muestras", { method: "DELETE" });
    for (const [i, a] of archivos.entries()) {
      msg.textContent = `Subiendo grabación ${i + 1} de ${archivos.length}…`;
      const r = await fetch("/api/voz/muestras", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/octet-stream", "X-Delta": "1" },
        body: a,
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`${a.name}: ${d.error || "no se pudo subir"}`);
    }
    msg.textContent = "Creando la voz… (tarda unos segundos)";
    vozNatural = await api("/voz/crear", { method: "POST", body: { nombre: $("#voz-nombre").value, permiso: true } });
    $("#voz-archivos").value = "";
    $("#voz-permiso").checked = false;
    $("#voz-crear").open = false;
    pintarVoz();
    msg.textContent = "¡Listo! Esta es la voz nueva de DELTA.";
    decir("¡Hola! Desde ahora te voy a hablar con esta voz.");
  } catch (err) {
    msg.textContent = err.message;
  } finally {
    boton.disabled = false;
  }
});

// ---------------- Arranque: DELTA en grande, sonido y bienvenida ----------------
function vozMujer() {
  const voces = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("es"));
  const mujeres = /paulina|m[oó]nica|dalia|elvira|sabina|helena|laura|lupe|marisol|elena|isabela|camila|valentina|ximena|renata|francisca|sofia|luc[ií]a|google espa[nñ]ol/i;
  return voces.find((v) => mujeres.test(v.name) && /mx|419|us/i.test(v.lang))
    || voces.find((v) => mujeres.test(v.name))
    || vozEspanol();
}

function bienvenida() {
  // Después del "Bienvenido", DELTA cuenta cómo viene el día (una vez al día).
  const siguiente = saludoPendiente() ? () => setTimeout(() => saludoDelDia(true), 350) : undefined;
  decir("Bienvenido, señor.", { voz: vozMujer, rate: 0.9, pitch: 1.05, alTerminar: siguiente });
}

function arranque(conToque) {
  return new Promise((listo) => {
    let visto = false;
    try { visto = sessionStorage.getItem("delta_arranque") === "1"; } catch {}
    if (visto) return listo();
    try { sessionStorage.setItem("delta_arranque", "1"); } catch {}
    const el = $("#arranque");
    const conSonido = sonidosActivos();
    const reloj = [];
    let terminado = false;
    const terminar = () => {
      if (terminado) return;
      terminado = true;
      reloj.forEach(clearTimeout);
      el.classList.add("saliendo");
      setTimeout(() => { el.hidden = true; el.className = "arranque"; }, 700);
      removeEventListener("keydown", tecla);
      listo();
    };
    const empezar = () => {
      el.classList.remove("esperando");
      el.classList.add("animando");
      if (conSonido) {
        sonar("arranque");
        reloj.push(setTimeout(bienvenida, 1900));
      }
      reloj.push(setTimeout(terminar, conSonido ? 4300 : 2700));
    };
    const tecla = (e) => {
      if (e.key === "Escape") { callarVoz(); terminar(); }
      else if (el.classList.contains("esperando")) empezar();
    };
    addEventListener("keydown", tecla);
    $("#arr-saltar").onclick = (e) => { e.stopPropagation(); callarVoz(); terminar(); };
    el.hidden = false;
    // Los navegadores no dejan sonar nada hasta que la persona toca la pantalla.
    if (conSonido && !conToque) {
      el.classList.add("esperando");
      el.onclick = () => { if (el.classList.contains("esperando")) empezar(); };
    } else {
      el.onclick = null;
      empezar();
    }
  });
}
// Las voces del navegador llegan un momento después de abrir la app.
if ("speechSynthesis" in window) speechSynthesis.getVoices();

// ---------------- Inicio ----------------
async function iniciar(conToque = false) {
  try {
    await cargarPanel();
  } catch {
    return; // muestra la entrada
  }
  $("#entrada").hidden = true;
  $("#app").hidden = false;
  if (esEquipo()) {
    // Alguien del equipo: sin DELTA, sin saludo, sin lo personal del dueño
    reloj();
    cargadaEn.tareas = Date.now();
    mostrarSeccion(seccionDeLaDireccion());
    setInterval(() => { cargarPanel().catch(() => {}); refrescar(seccionActual); }, 60_000);
    return;
  }
  arranque(conToque).then(() => {
    // Si el arranque no habló (ya se había visto o sin sonido), el saludo se muestra escrito y se intenta decir.
    setTimeout(() => { if (saludoPendiente()) saludoDelDia(sonidosActivos()); }, 2500);
  });
  pintarManos();
  // La primera vez, DELTA adopta la zona horaria de este equipo.
  if (!guardado.get("delta_zona_enviada")) {
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
    api("/ajustes", { method: "POST", body: { zona_horaria: local } }).then(() => { guardado.set("delta_zona_enviada", "1"); zona = local; }).catch(() => {});
  }
  reloj();
  clima();
  cargarHistorial();
  conectarVivo();
  cargadaEn.inicio = cargadaEn.tareas = Date.now(); // el panel ya se cargó arriba
  cargarMercadosMini().catch(() => {});
  cargarHudExtra().catch(() => {});
  mostrarSeccion(seccionDeLaDireccion());
  // Cada minuto se refresca solo lo que está a la vista.
  setInterval(() => { cargarPanel().catch(() => {}); refrescar(seccionActual); }, 60_000);
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
iniciar();
