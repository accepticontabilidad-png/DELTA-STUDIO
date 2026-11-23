// DELTA — Inicio "vivo": efectos de centro de mando (HUD) sobre el Inicio y el Modo DELTA.
// - Tarjetas que se inclinan en 3D y un borde de luz que sigue al cursor (solo con mouse).
// - Rayos de datos que salen del orbe hacia cada tarjeta (solo PC con tres columnas).
// - Satélites alrededor del orbe en Modo DELTA con lo más importante del día.
// - Anillo de texto que gira alrededor del orbe, onda al tocarlo y orbe que sigue un poco al cursor.
// Todo se apaga con "reducir movimiento" y cuando la pestaña no está a la vista.

const $ = (s) => document.querySelector(s);
const reducir = matchMedia("(prefers-reduced-motion: reduce)").matches;
const conMouse = matchMedia("(hover: hover) and (pointer: fine)").matches;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const seccion = () => $('.seccion[data-seccion="inicio"]');
const visible = () => seccion()?.classList.contains("visible") && !document.hidden;
const enModoDelta = () => seccion()?.classList.contains("modo-delta");
const esDia = () => document.documentElement.dataset.mood === "dia";

// ---------- Tarjetas con inclinación 3D y borde de luz ----------
const INCLINABLES = ".hud-card, .hud-tile, .hud-hero, .satelite";
function iniciarInclinacion() {
  if (!conMouse || reducir) return;
  let activa = null;
  const soltar = () => {
    if (!activa) return;
    activa.classList.remove("vivo-inclinada");
    activa.style.removeProperty("--rx");
    activa.style.removeProperty("--ry");
    activa = null;
  };
  document.addEventListener("pointermove", (e) => {
    const card = e.target.closest?.(INCLINABLES);
    if (card !== activa) soltar();
    if (!card || !card.closest(".seccion.inicio")) return;
    activa = card;
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    // Menos inclinación en tarjetas grandes para que no se vea exagerado
    const fuerza = Math.max(2.2, Math.min(7, 900 / Math.max(r.width, r.height)));
    card.style.setProperty("--rx", `${(-y * fuerza).toFixed(2)}deg`);
    card.style.setProperty("--ry", `${(x * fuerza).toFixed(2)}deg`);
    card.style.setProperty("--giro", `${(Math.atan2(y, x) * 180 / Math.PI + 90).toFixed(1)}deg`);
    card.style.setProperty("--mx", `${e.clientX - r.left}px`);
    card.style.setProperty("--my", `${e.clientY - r.top}px`);
    card.classList.add("vivo-inclinada");
    rayos.foco = card;
  }, { passive: true });
  document.addEventListener("pointerleave", soltar);
  document.addEventListener("pointerout", (e) => { if (!e.relatedTarget) { soltar(); rayos.foco = null; } });
}

// ---------- Rayos de datos del orbe a las tarjetas ----------
const rayos = { foco: null };
function iniciarRayos() {
  const lienzo = $("#hud-rayos");
  if (!lienzo || reducir) return;
  const ctx = lienzo.getContext("2d");
  let W = 0, H = 0, dpr = 1, ultimo = 0;
  const medir = () => {
    const s = seccion();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = s.clientWidth; H = s.clientHeight;
    lienzo.width = W * dpr; lienzo.height = H * dpr;
  };
  if ("ResizeObserver" in window) new ResizeObserver(medir).observe(seccion());
  const tresColumnas = () => innerWidth > 1280;

  function cuadro(t) {
    requestAnimationFrame(cuadro);
    if (t - ultimo < 33) return; // ~30 cuadros por segundo bastan y cuidan la batería
    ultimo = t;
    if (!visible() || enModoDelta() || !tresColumnas()) { if (lienzo.dataset.limpio !== "1") { ctx.clearRect(0, 0, lienzo.width, lienzo.height); lienzo.dataset.limpio = "1"; } return; }
    lienzo.dataset.limpio = "0";
    if (!W) medir();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const base = seccion().getBoundingClientRect();
    const orbe = $("#orbe").getBoundingClientRect();
    const cx = orbe.left + orbe.width / 2 - base.left, cy = orbe.top + orbe.height / 2 - base.top, R = orbe.width * 0.47;
    const dia = esDia();
    const col = dia ? [90, 60, 220] : [170, 150, 255];
    const rosa = dia ? [200, 70, 160] : [255, 158, 232];
    const tarjetas = [...document.querySelectorAll(".hud-izq > .hud-hero, .hud-izq > .hud-card, .hud-izq > .hud-tiles, .hud-der > .hud-card")];
    tarjetas.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      if (r.bottom < base.top + 40 || r.top > base.bottom - 10 || !r.height) return;
      const izq = el.closest(".hud-izq") != null;
      const tx = (izq ? r.right : r.left) - base.left + (izq ? 2 : -2);
      const ty = Math.max(r.top + 18, Math.min(r.bottom - 18, r.top + Math.min(r.height / 2, 60))) - base.top;
      const ang = Math.atan2(ty - cy, tx - cx);
      const sx = cx + Math.cos(ang) * R, sy = cy + Math.sin(ang) * R;
      const c1x = sx + Math.cos(ang) * 60, c1y = sy + Math.sin(ang) * 60;
      const c2x = tx + (izq ? 70 : -70), c2y = ty;
      const foco = rayos.foco && (rayos.foco === el || el.contains(rayos.foco));
      const a = foco ? 0.55 : 0.16;
      // Línea base
      const g = ctx.createLinearGradient(sx, sy, tx, ty);
      g.addColorStop(0, `rgba(${col},0)`);
      g.addColorStop(0.35, `rgba(${col},${a})`);
      g.addColorStop(1, `rgba(${foco ? rosa : col},${a * 1.3})`);
      ctx.strokeStyle = g;
      ctx.lineWidth = foco ? 1.4 : 1;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.bezierCurveTo(c1x, c1y, c2x, c2y, tx, ty); ctx.stroke();
      // Punto de llegada
      ctx.fillStyle = `rgba(${foco ? rosa : col},${foco ? 0.95 : 0.55})`;
      ctx.beginPath(); ctx.arc(tx, ty, foco ? 2.6 : 1.8, 0, Math.PI * 2); ctx.fill();
      // Pulsos de datos que viajan del orbe a la tarjeta
      const pulsos = foco ? 3 : 1;
      for (let k = 0; k < pulsos; k++) {
        const u = ((t / (foco ? 1300 : 2600) + i * 0.37 + k / pulsos) % 1);
        const v = 1 - u;
        const px = v * v * v * sx + 3 * v * v * u * c1x + 3 * v * u * u * c2x + u * u * u * tx;
        const py = v * v * v * sy + 3 * v * v * u * c1y + 3 * v * u * u * c2y + u * u * u * ty;
        const alfa = Math.sin(u * Math.PI) * (foco ? 1 : 0.7);
        const brillo = ctx.createRadialGradient(px, py, 0, px, py, foco ? 9 : 6);
        brillo.addColorStop(0, `rgba(255,255,255,${alfa})`);
        brillo.addColorStop(0.35, `rgba(${foco ? rosa : col},${alfa * 0.8})`);
        brillo.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = brillo;
        ctx.beginPath(); ctx.arc(px, py, foco ? 9 : 6, 0, Math.PI * 2); ctx.fill();
      }
    });
  }
  requestAnimationFrame(cuadro);
}

// ---------- Satélites alrededor del orbe (Modo DELTA) ----------
const ICON = {
  cita: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  tarea: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 12 3 3 5-6"/></svg>',
  correo: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  bolsa: '<svg viewBox="0 0 24 24"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>',
};
let satDatos = [];
function pintarSatelites() {
  const caja = $("#satelites");
  if (!caja) return;
  caja.innerHTML = satDatos.map((s, i) => `<a class="satelite${s.alerta ? " alerta" : ""}" href="#/${s.ir}" style="--i:${i}"><span class="sat-icono">${s.icono}</span><span class="sat-txt"><small>${esc(s.etiqueta)}</small><b>${esc(s.valor)}</b>${s.sub ? `<em>${esc(s.sub)}</em>` : ""}</span></a>`).join("");
  colocarSatelites();
}

// Los satélites van a los lados del orbe con una línea fina que los une a él.
// Si no caben (pantallas angostas o celular), se acomodan en una fila debajo.
function colocarSatelites() {
  const caja = $("#satelites"), lazos = $("#orbe-lazos"), escena = $("#orbe-escena"), orbe = $("#orbe");
  if (!caja || !escena || !orbe) return;
  const sats = [...caja.children];
  const E = escena.getBoundingClientRect(), O = orbe.getBoundingClientRect();
  if (!O.width || !sats.length) { lazos.innerHTML = ""; return; }
  const ancho = 214, R = O.width / 2;
  const cx = O.left - E.left + R, cy = O.top - E.top + R;
  const cabe = O.left - 40 - ancho > 10 && O.right + 40 + ancho < innerWidth - 10 && innerWidth > 900;
  caja.classList.toggle("fila", !cabe);
  if (!cabe) { lazos.innerHTML = ""; sats.forEach((s) => { s.style.left = s.style.top = ""; }); return; }
  // Posiciones: dos a la izquierda y dos a la derecha, en ángulos que abrazan el orbe
  const angulos = [-152, 152, -28, 28];
  let lineas = "";
  sats.forEach((s, i) => {
    const a = (angulos[i] ?? 0) * Math.PI / 180;
    const izq = Math.cos(a) < 0;
    const ex = cx + Math.cos(a) * R * 0.93, ey = cy + Math.sin(a) * R * 0.93;
    const sx = izq ? cx - R - 40 - ancho : cx + R + 40;
    const sy = cy + Math.sin(a) * R * 0.78 - 32;
    s.style.left = `${sx}px`;
    s.style.top = `${sy}px`;
    const fx = izq ? sx + ancho : sx, fy = sy + 32;
    const mx = (ex + fx) / 2;
    lineas += `<path d="M${ex.toFixed(1)},${ey.toFixed(1)} C${mx.toFixed(1)},${ey.toFixed(1)} ${mx.toFixed(1)},${fy.toFixed(1)} ${fx.toFixed(1)},${fy.toFixed(1)}" style="--i:${i}"/><circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="2.4" style="--i:${i}"/>`;
  });
  lazos.setAttribute("viewBox", `0 0 ${E.width} ${E.height}`);
  lazos.innerHTML = lineas;
}

// ---------- Orbe que sigue un poco al cursor y onda al tocarlo ----------
function iniciarOrbe() {
  const orbe = $("#orbe");
  if (!orbe) return;
  orbe.addEventListener("pointerdown", (e) => {
    if (reducir) return;
    const r = orbe.getBoundingClientRect();
    for (const k of [0, 1]) {
      const onda = document.createElement("span");
      onda.className = "orbe-onda";
      onda.style.left = `${e.clientX - r.left}px`;
      onda.style.top = `${e.clientY - r.top}px`;
      onda.style.animationDelay = `${k * 0.16}s`;
      orbe.appendChild(onda);
      setTimeout(() => onda.remove(), 1300);
    }
  });
  if (!conMouse || reducir) return;
  let objetivo = [0, 0], actual = [0, 0], andando = false;
  const mover = () => {
    actual = actual.map((v, i) => v + (objetivo[i] - v) * 0.08);
    orbe.style.translate = `${actual[0].toFixed(2)}px ${actual[1].toFixed(2)}px`;
    const logo = orbe.querySelector(".logo-orbe");
    if (logo) logo.style.translate = `${(actual[0] * 0.8).toFixed(2)}px ${(actual[1] * 0.8).toFixed(2)}px`;
    if (Math.abs(objetivo[0] - actual[0]) + Math.abs(objetivo[1] - actual[1]) > 0.05) requestAnimationFrame(mover);
    else andando = false;
  };
  addEventListener("pointermove", (e) => {
    if (!visible()) return;
    const r = orbe.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / innerWidth, dy = (e.clientY - (r.top + r.height / 2)) / innerHeight;
    objetivo = [dx * 18, dy * 14];
    if (!andando) { andando = true; requestAnimationFrame(mover); }
  }, { passive: true });
}

// ---------- Datos que llegan de la app ----------
export function datosVivos({ panel, sinLeer, mercados, clima, fecha, siguiente }) {
  const sats = [];
  if (panel) {
    sats.push(siguiente
      ? { ir: "agenda", icono: ICON.cita, etiqueta: "Siguiente cita", valor: siguiente.cuando, sub: siguiente.titulo }
      : { ir: "agenda", icono: ICON.cita, etiqueta: "Agenda", valor: "Libre", sub: "Sin citas por delante" });
    const v = panel.hoy?.vencidas || 0;
    sats.push({ ir: "tareas", icono: ICON.tarea, etiqueta: "Pendientes", valor: String(panel.hoy?.pendientes ?? 0), sub: v ? `${v} atrasado${v === 1 ? "" : "s"}` : "Todo al día", alerta: v > 0 });
  }
  if (sinLeer != null) sats.push({ ir: "correo", icono: ICON.correo, etiqueta: "Correo", valor: sinLeer ? `${sinLeer} sin leer` : "Al día", sub: sinLeer ? "Gmail y Hotmail" : "Bandeja tranquila" });
  const m = (mercados || [])[0];
  if (m) {
    const c = m.cambio_dia_pct;
    sats.push({ ir: "mercados", icono: ICON.bolsa, etiqueta: m.nombre, valor: `${c > 0 ? "▲" : c < 0 ? "▼" : ""} ${c ?? "–"}%`, sub: `${m.precio?.toLocaleString("es-MX") ?? ""} ${m.moneda || ""}`, sube: c > 0, baja: c < 0 });
  }
  const clave = JSON.stringify(sats);
  if (clave !== JSON.stringify(satDatos)) { satDatos = sats; pintarSatelites(); }
  // Marcar sube/baja en el satélite de bolsa
  const ult = $("#satelites")?.lastElementChild;
  const sb = sats[sats.length - 1];
  if (ult && sb?.ir === "mercados") ult.classList.toggle("sube", !!sb.sube), ult.classList.toggle("baja", !!sb.baja);

  // Anillo de texto alrededor del orbe
  const partes = ["DELTA", "EN LÍNEA"];
  if (fecha) partes.push(fecha.toUpperCase());
  if (panel) partes.push(`${panel.hoy?.eventos ?? 0} CITA${panel.hoy?.eventos === 1 ? "" : "S"} HOY`, `${panel.hoy?.pendientes ?? 0} PENDIENTES`);
  if (sinLeer) partes.push(`${sinLeer} CORREOS NUEVOS`);
  if (clima) partes.push(clima.toUpperCase());
  const linea = partes.join("  ·  ") + "  ·  ";
  if (linea !== anilloTexto) { anilloTexto = linea; pintarAnillo(); }
}

// La cinta de texto corre sobre el arco: se mide una vuelta y se repite sin corte.
let anilloTexto = "", reintento = 0;
function pintarAnillo() {
  clearTimeout(reintento);
  const tp = $("#anillo-txt");
  if (!tp) return;
  tp.querySelector("animate")?.remove();
  tp.textContent = anilloTexto;
  let largo = 0;
  try { largo = tp.parentNode.getComputedTextLength(); } catch {}
  if (!largo) { reintento = setTimeout(pintarAnillo, 2000); return; } // aún no se ve (otra sección abierta): se intenta luego
  const veces = Math.max(2, Math.ceil(240 / largo) + 1); // el arco mide ~235 unidades
  tp.textContent = anilloTexto.repeat(veces);
  if (reducir) return;
  const anim = document.createElementNS("http://www.w3.org/2000/svg", "animate");
  anim.setAttribute("attributeName", "startOffset");
  anim.setAttribute("from", "0");
  anim.setAttribute("to", String(-largo));
  anim.setAttribute("dur", `${(largo / 9).toFixed(1)}s`);
  anim.setAttribute("repeatCount", "indefinite");
  tp.appendChild(anim);
  try { anim.beginElement(); } catch {}
}

export function iniciarInicioVivo() {
  iniciarInclinacion();
  iniciarRayos();
  iniciarOrbe();
  const escena = $("#orbe-escena");
  if (escena && "ResizeObserver" in window) new ResizeObserver(() => colocarSatelites()).observe(escena);
  addEventListener("resize", colocarSatelites);
  addEventListener("hashchange", () => setTimeout(colocarSatelites, 60));
  return { colocar: colocarSatelites };
}
