// DELTA — app del panel (PC y celular)
const $ = (s) => document.querySelector(s);
const guardado = {
  get: (k, d = null) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} },
};

let token = guardado.get("delta_token");
let zona = Intl.DateTimeFormat().resolvedOptions().timeZone;

// ---------------- API ----------------
async function api(ruta, opciones = {}) {
  const r = await fetch(`/api${ruta}`, {
    ...opciones,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
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
    const r = await fetch("/api/entrar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clave: $("#clave").value }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    token = d.token;
    guardado.set("delta_token", token);
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
    <div><b style="color:${p.hoy.vencidas ? "var(--rojo)" : "inherit"}">${p.hoy.vencidas}</b><span>atrasadas</span></div>`;

  $("#lista-eventos").innerHTML = p.eventos.length
    ? p.eventos.map((e) => `<li><div class="cuerpo">${esc(e.titulo)}<span class="sub">${fmtDia(e.inicio)} · ${fmtHora(e.inicio)}${e.lugar ? " · " + esc(e.lugar) : ""}</span></div><button class="x" data-borrar-evento="${e.id}" title="Borrar">✕</button></li>`).join("")
    : `<li class="vacio">Sin citas en los próximos 7 días.</li>`;

  $("#lista-recordatorios").innerHTML = p.recordatorios.length
    ? p.recordatorios.map((r) => `<li><div class="cuerpo">${esc(r.mensaje)}<span class="sub">${fmtDia(r.cuando)} · ${fmtHora(r.cuando)}${r.repetir !== "no" ? " · " + r.repetir : ""}</span></div><button class="x" data-borrar-recordatorio="${r.id}" title="Cancelar">✕</button></li>`).join("")
    : `<li class="vacio">Sin recordatorios.</li>`;

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

// ---------------- Orbe animado ----------------
const orbe = (() => {
  const lienzo = $("#lienzo");
  const ctx = lienzo.getContext("2d");
  let estado = "reposo";
  let energia = 0.2;
  const textos = { reposo: "Toque para hablar", escuchando: "Escuchando…", pensando: "Pensando…", hablando: "Hablando…" };
  const colores = { reposo: [63, 208, 255], escuchando: [255, 181, 71], pensando: [140, 160, 255], hablando: [63, 230, 255] };
  let color = [...colores.reposo];

  function dibujar(t) {
    const W = lienzo.width, C = W / 2;
    ctx.clearRect(0, 0, W, W);
    const objetivo = { reposo: 0.25, escuchando: 0.8, pensando: 0.55, hablando: 0.7 + 0.3 * Math.abs(Math.sin(t / 120)) }[estado];
    energia += (objetivo - energia) * 0.06;
    color = color.map((c, i) => c + (colores[estado][i] - c) * 0.06);
    const [r, g, b] = color.map(Math.round);
    const rgba = (a) => `rgba(${r},${g},${b},${a})`;

    // Halo
    const halo = ctx.createRadialGradient(C, C, W * 0.05, C, C, W * 0.48);
    halo.addColorStop(0, rgba(0.35 * energia + 0.1));
    halo.addColorStop(1, rgba(0));
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, W);

    // Anillos giratorios
    const anillos = [[0.42, 1, 0.0006, [0.1, 0.6]], [0.37, 2, -0.0009, [0.3, 0.9]], [0.32, 1.5, 0.0013, [0.05, 0.35]]];
    anillos.forEach(([rad, grosor, vel, [a0, a1]], i) => {
      const giro = t * vel * (1 + energia);
      ctx.strokeStyle = rgba(0.35 + 0.4 * energia);
      ctx.lineWidth = grosor * 2;
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        const ini = giro + (k * Math.PI * 2) / 3 + a0 * Math.PI;
        ctx.arc(C, C, W * rad, ini, ini + (a1 - a0) * Math.PI * 0.6);
        ctx.stroke();
      }
      if (i === 0) { // marcas
        ctx.strokeStyle = rgba(0.18);
        ctx.lineWidth = 2;
        for (let k = 0; k < 60; k++) {
          const a = (k / 60) * Math.PI * 2 - giro * 0.3;
          const r1 = W * 0.455, r2 = W * (k % 5 ? 0.465 : 0.475);
          ctx.beginPath();
          ctx.moveTo(C + Math.cos(a) * r1, C + Math.sin(a) * r1);
          ctx.lineTo(C + Math.cos(a) * r2, C + Math.sin(a) * r2);
          ctx.stroke();
        }
      }
    });

    // Núcleo con onda
    ctx.beginPath();
    const puntos = 90;
    for (let k = 0; k <= puntos; k++) {
      const a = (k / puntos) * Math.PI * 2;
      const onda = Math.sin(a * 6 + t / 260) * Math.sin(a * 3 - t / 410) * 10 * energia;
      const rad = W * (0.2 + 0.02 * Math.sin(t / 700)) + onda;
      const x = C + Math.cos(a) * rad, y = C + Math.sin(a) * rad;
      k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    const nucleo = ctx.createRadialGradient(C, C, 0, C, C, W * 0.23);
    nucleo.addColorStop(0, "rgba(255,255,255,0.95)");
    nucleo.addColorStop(0.25, rgba(0.9));
    nucleo.addColorStop(1, rgba(0.08));
    ctx.fillStyle = nucleo;
    ctx.shadowColor = rgba(0.9);
    ctx.shadowBlur = 40 * energia + 10;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Delta en el centro
    ctx.strokeStyle = "rgba(3,15,25,0.65)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    const s = W * 0.07;
    ctx.moveTo(C, C - s); ctx.lineTo(C + s * 0.95, C + s * 0.65); ctx.lineTo(C - s * 0.95, C + s * 0.65); ctx.closePath();
    ctx.stroke();

    requestAnimationFrame(dibujar);
  }
  requestAnimationFrame(dibujar);
  return {
    estado(e) { estado = e; $("#estado-orbe").textContent = textos[e]; },
  };
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
  const fuente = new EventSource(`/api/vivo?token=${encodeURIComponent(token || "")}`);
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
