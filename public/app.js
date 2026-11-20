// DELTA — app del panel (PC y celular)
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
    ["Cerebro (Claude)", c.cerebro], ["Calendario de DELTA", c.calendario], ["WhatsApp", c.whatsapp], ["Avisos en este equipo", c.push],
  ].map(([n, on]) => `<li class="${on ? "on" : ""}"><span class="punto"></span>${n}</li>`);
  filas.push(`<li class="pronto"><span class="punto"></span>Cuentas de clientes (Meta, Instagram, TikTok): próximamente</li>`);
  $("#lista-conexiones").innerHTML = filas.join("");

  $("#lista-avisos").innerHTML = p.avisos.length
    ? p.avisos.map((a) => `<li><div class="cuerpo">${esc(a.texto)}<span class="sub">${fmtDia(a.fecha)} ${fmtHora(a.fecha)}</span></div></li>`).join("")
    : `<li class="vacio">Sin avisos todavía.</li>`;

  $("#aj-zona").value = p.zona_horaria;
  $("#aj-resumen").value = p.hora_resumen || "";
}

document.addEventListener("click", async (e) => {
  const t = e.target;
  try {
    if (t.dataset.hecha) { await api(`/tareas/${t.dataset.hecha}`, { method: "PATCH", body: { estado: "hecha" } }); await cargarPanel(); }
    if (t.dataset.borrarEvento) { await api(`/eventos/${t.dataset.borrarEvento}`, { method: "DELETE" }); await cargarPanel(); }
    if (t.dataset.borrarRecordatorio) { await api(`/recordatorios/${t.dataset.borrarRecordatorio}`, { method: "DELETE" }); await cargarPanel(); }
  } catch (err) { burbuja("aviso", err.message); }
});

$("#form-tarea").addEventListener("submit", async (e) => {
  e.preventDefault();
  const titulo = $("#nueva-tarea").value.trim();
  if (!titulo) return;
  $("#nueva-tarea").value = "";
  await api("/tareas", { method: "POST", body: { titulo } });
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

function rangoVisible() {
  const hoy = agendaEstado.dia || claveDia(new Date());
  if (agendaEstado.vista === "dia") return [hoy, hoy];
  const lunes = sumarDias(hoy, -((diaSemana(hoy) + 6) % 7));
  return [lunes, sumarDias(lunes, 6)];
}

async function cargarAgenda() {
  if (!agendaEstado.dia) agendaEstado.dia = claveDia(new Date());
  const [desde, hasta] = rangoVisible();
  const datos = await api(`/agenda?desde=${desde}&hasta=${hasta}`);
  const hoy = claveDia(new Date());

  const titulo = agendaEstado.vista === "dia"
    ? (desde === hoy ? "Hoy, " : "") + nombreDia(desde, { weekday: "long", day: "numeric", month: "long" })
    : `${nombreDia(desde, { day: "numeric", month: "short" })} – ${nombreDia(hasta, { day: "numeric", month: "short", year: "numeric" })}`;
  $("#ag-titulo").textContent = titulo.charAt(0).toUpperCase() + titulo.slice(1);

  const items = [
    ...datos.eventos.map((e) => ({ tipo: "evento", cuando: e.inicio, titulo: e.titulo, sub: [e.lugar, e.cliente].filter(Boolean).join(" · "), borrar: `data-borrar-evento="${e.id}"` })),
    ...datos.tareas.map((t) => ({ tipo: "tarea", cuando: t.fecha_limite, titulo: t.titulo, sub: [t.cliente, t.prioridad === "alta" ? "prioridad alta" : ""].filter(Boolean).join(" · "), hecha: t.estado === "hecha" })),
    ...datos.recordatorios.map((r) => ({ tipo: "recordatorio", cuando: r.cuando, titulo: r.mensaje, sub: r.repetir !== "no" ? `se repite: ${r.repetir}` : "", borrar: `data-borrar-recordatorio="${r.id}"` })),
  ].sort((a, b) => a.cuando.localeCompare(b.cuando));

  const dias = [];
  for (let d = desde; d <= hasta; d = sumarDias(d, 1)) dias.push(d);
  $("#ag-contenido").innerHTML = dias.map((d) => {
    const delDia = items.filter((i) => claveDia(new Date(i.cuando)) === d);
    const cabeza = agendaEstado.vista === "semana"
      ? `<h4><span>${esc(nombreDia(d, { weekday: "long", day: "numeric" }))}</span>${d === hoy ? "<span>hoy</span>" : ""}</h4>` : "";
    const lista = delDia.length
      ? `<ul>${delDia.map((i) => `<li class="ag-item ${i.tipo}${i.hecha ? " hecha" : ""}"><span class="ag-hora">${fmtHora(i.cuando)}</span><span class="ag-texto">${esc(i.titulo)}${i.sub ? `<span class="sub">${esc(i.sub)}</span>` : ""}</span>${i.borrar ? `<button class="x" ${i.borrar} title="Borrar" aria-label="Borrar">✕</button>` : "<span></span>"}</li>`).join("")}</ul>`
      : `<div class="ag-vacio">${agendaEstado.vista === "dia" ? "Nada agendado este día." : "Libre"}</div>`;
    return `<div class="ag-dia${d === hoy ? " hoy" : ""}">${cabeza}${lista}</div>`;
  }).join("");
}

document.querySelectorAll("[data-vista]").forEach((b) => b.addEventListener("click", () => {
  agendaEstado.vista = b.dataset.vista;
  document.querySelectorAll("[data-vista]").forEach((x) => x.classList.toggle("activa", x === b));
  cargarAgenda();
}));
$("#ag-ant").addEventListener("click", () => { agendaEstado.dia = sumarDias(agendaEstado.dia, agendaEstado.vista === "dia" ? -1 : -7); cargarAgenda(); });
$("#ag-sig").addEventListener("click", () => { agendaEstado.dia = sumarDias(agendaEstado.dia, agendaEstado.vista === "dia" ? 1 : 7); cargarAgenda(); });
$("#ag-hoy").addEventListener("click", () => { agendaEstado.dia = claveDia(new Date()); cargarAgenda(); });

// Agregar cita, tarea o recordatorio a mano
let tipoNuevo = "cita";
function elegirTipo(tipo) {
  tipoNuevo = tipo;
  document.querySelectorAll("[data-tipo]").forEach((b) => b.classList.toggle("activa", b.dataset.tipo === tipo));
  $("#agregar").className = `dialogo tipo-${tipo}`;
}
document.querySelectorAll("[data-tipo]").forEach((b) => b.addEventListener("click", () => elegirTipo(b.dataset.tipo)));
$("#ag-agregar").addEventListener("click", () => {
  $("#form-agregar").reset();
  $("#ag-f-dia").value = agendaEstado.dia || claveDia(new Date());
  $("#ag-f-msg").hidden = true;
  elegirTipo("cita");
  $("#agregar").showModal();
});
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
    agendaEstado.dia = $("#ag-f-dia").value;
    await cargarPanel();
  } catch (err) {
    $("#ag-f-msg").textContent = err.message;
    $("#ag-f-msg").hidden = false;
  }
});

// ---------------- Conversación ----------------
function burbuja(rol, texto) {
  const div = document.createElement("div");
  div.className = `burbuja ${rol}`;
  div.textContent = texto;
  $("#conversacion").appendChild(div);
  $("#conversacion").scrollTop = $("#conversacion").scrollHeight;
  return div;
}

async function cargarHistorial() {
  const h = await api("/historial");
  $("#conversacion").innerHTML = "";
  if (!h.length) burbuja("assistant", "A sus órdenes, señor. Puede pedirme que agende una cita, anote una tarea o le recuerde algo.");
  h.forEach((m) => burbuja(m.rol, m.texto));
}

let ocupado = false;
async function enviar(texto, canal = "app") {
  if (!texto || ocupado) return;
  ocupado = true;
  burbuja("user", texto);
  const espera = burbuja("assistant pensando", "Procesando…");
  orbe.estado("pensando");
  try {
    const { respuesta } = await api("/chat", { method: "POST", body: { texto, canal } });
    espera.className = "burbuja assistant";
    espera.textContent = respuesta;
    if (canal === "voz" || guardado.get("delta_voz") === "1") hablar(respuesta);
    else orbe.estado("reposo");
    cargarPanel();
  } catch (err) {
    espera.className = "burbuja aviso";
    espera.textContent = "No pude completar eso: " + err.message;
    orbe.estado("reposo");
  } finally {
    ocupado = false;
  }
}

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
  reconocedor.onstart = () => { escuchando = true; orbe.estado("escuchando"); $("#btn-mic").classList.add("escuchando"); };
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
    else orbe.estado("reposo");
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
  $("#aj-manos").checked = manosLibres;
  $("#aj-msg").textContent = "";
  $("#ajustes").showModal();
});
$("#btn-push").addEventListener("click", activarPush);
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
