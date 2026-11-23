// DELTA — Inicio "vivo": efectos de centro de mando (HUD) sobre el Inicio y el Modo DELTA.
// - Tarjetas que se inclinan en 3D y un borde de luz que sigue al cursor (solo con mouse).
// - Rayos de datos que salen del orbe hacia cada tarjeta (solo PC con tres columnas).
// - Polvo de estrellas vivo alrededor del orbe en Modo DELTA.
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
const INCLINABLES = ".hud-card, .hud-tile, .hud-hero";
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

// ---------- Polvo de estrellas alrededor del orbe (Modo DELTA) ----------
// Cientos de partículas en órbitas inclinadas (como una galaxia), con profundidad:
// las que pasan "detrás" de la esfera se ven tenues. Siguen al cursor, se dispersan
// al tocar y se aceleran y brillan cuando DELTA escucha o habla.
export const orbeVivo = { energia: 0.2, estado: "reposo" };
const polvo = { parts: [], puntero: null, golpe: 0, lado: 0, R: 0, dpr: 1, inclina: [0, 0] };
function colocarPolvo() {
  const lienzo = $("#orbe-polvo"), escena = $("#orbe-escena"), orbe = $("#orbe");
  if (!lienzo || !escena || !orbe) return;
  const E = escena.getBoundingClientRect(), O = orbe.getBoundingClientRect();
  if (!O.width) return;
  const lado = Math.round(O.width * 1.9);
  polvo.R = O.width / 2;
  lienzo.style.width = lienzo.style.height = `${lado}px`;
  lienzo.style.left = `${O.left - E.left + O.width / 2 - lado / 2}px`;
  lienzo.style.top = `${O.top - E.top + O.height / 2 - lado / 2}px`;
  polvo.dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (Math.abs(polvo.lado - lado) > 2) { polvo.lado = lado; lienzo.width = lienzo.height = Math.round(lado * polvo.dpr); }
  if (!polvo.parts.length) {
    const n = innerWidth < 700 ? 230 : 460; // punto medio: vivo pero sin saturar
    // Tres "planos" de órbita con distinta inclinación y giro, más una nube interior
    const planos = [[-0.35, 0.32], [0.55, 0.42], [1.35, 0.28], [0, 1]];
    polvo.parts = Array.from({ length: n }, (_, i) => {
      // Pocas en la nube interior (1 de cada 12) para que el centro y el logo respiren
      const pl = i % 12 === 0 ? planos[3] : planos[i % 3];
      const interior = pl[1] === 1;
      // La mayoría forma un anillo denso pegado a la esfera (como en la bienvenida); unas pocas se alejan
      const q = Math.random();
      const r = interior ? 0.3 + Math.random() * 0.3 : q < 0.78 ? 0.6 + Math.pow(Math.random(), 0.8) * 0.36 : 0.96 + Math.random() * 0.55;
      return {
        r, a: Math.random() * Math.PI * 2,
        w: (interior ? 0.5 : 0.18 + Math.random() * 0.25) * (0.7 + 0.6 * Math.random()) / Math.max(0.4, r),
        giro: pl[0] + (Math.random() - 0.5) * 0.25, incl: interior ? 0.6 + Math.random() * 0.4 : pl[1] + (Math.random() - 0.5) * 0.12,
        tam: Math.random() < 0.08 ? 1.6 + Math.random() * 1.2 : 0.5 + Math.random() * 1.0,
        fase: Math.random() * 6, rosa: Math.random() < 0.2, ox: 0, oy: 0, vx: 0, vy: 0,
      };
    });
  }
}
function iniciarPolvo() {
  const lienzo = $("#orbe-polvo"), escena = $("#orbe-escena");
  if (!lienzo || reducir) return;
  const ctx = lienzo.getContext("2d");
  let ultimo = 0, antes = performance.now();
  escena.addEventListener("pointermove", (e) => {
    const r = lienzo.getBoundingClientRect();
    polvo.puntero = [(e.clientX - r.left), (e.clientY - r.top)];
    polvo.inclina = [((e.clientX - r.left) / r.width - 0.5), ((e.clientY - r.top) / r.height - 0.5)];
  }, { passive: true });
  escena.addEventListener("pointerleave", () => { polvo.puntero = null; polvo.inclina = [0, 0]; });
  escena.addEventListener("pointerdown", (e) => {
    const r = lienzo.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    polvo.golpe = 1;
    for (const p of polvo.parts) {
      const dx = p.sx - px, dy = p.sy - py, d = Math.hypot(dx, dy) || 1;
      const f = Math.max(0, 1 - d / (polvo.R * 1.6)) * 14;
      p.vx += dx / d * f; p.vy += dy / d * f;
    }
  });
  const tiltX = { v: 0 }, tiltY = { v: 0 };
  function cuadro(t) {
    requestAnimationFrame(cuadro);
    if (t - ultimo < 30) return;
    const dt = Math.min(64, t - antes); antes = t; ultimo = t;
    if (!visible() || !enModoDelta()) { if (lienzo.dataset.limpio !== "1") { ctx.clearRect(0, 0, lienzo.width, lienzo.height); lienzo.dataset.limpio = "1"; } return; }
    lienzo.dataset.limpio = "0";
    if (!polvo.lado) colocarPolvo();
    const { dpr, lado, R } = polvo;
    const C = lado / 2;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, lado, lado);
    const dia = esDia();
    ctx.globalCompositeOperation = dia ? "source-over" : "lighter";
    const e = orbeVivo.energia, activo = orbeVivo.estado !== "reposo";
    polvo.golpe *= 0.95;
    const vel = (1 + e * 2.4 + polvo.golpe * 2) * dt / 1000;
    // Todo el enjambre se inclina un poco hacia el cursor (sensación 3D)
    tiltX.v += (polvo.inclina[0] * 0.5 - tiltX.v) * 0.05;
    tiltY.v += (polvo.inclina[1] * 0.5 - tiltY.v) * 0.05;
    const latido = 1 + 0.06 * e + 0.05 * polvo.golpe;
    const esfera = R * 0.62;
    for (const p of polvo.parts) {
      p.a += p.w * vel;
      // Órbita elíptica inclinada y luego girada en su plano
      const x0 = Math.cos(p.a) * p.r, y0 = Math.sin(p.a) * p.r * p.incl;
      const z = Math.sin(p.a) * p.r * Math.sqrt(Math.max(0, 1 - p.incl * p.incl)) * (p.incl === 1 ? 0 : 1);
      const cg = Math.cos(p.giro), sg = Math.sin(p.giro);
      let x = (x0 * cg - y0 * sg) * R * latido, y = (x0 * sg + y0 * cg) * R * latido;
      x += z * R * tiltX.v * 0.6; y += z * R * tiltY.v * 0.6;
      // Ondas de voz: el radio vibra cuando habla o escucha
      if (activo) { const v = 1 + Math.sin(p.a * 6 + t / 120) * 0.035 * e; x *= v; y *= v; }
      // Empuje del toque con resorte de regreso
      p.vx += -p.ox * 0.06; p.vy += -p.oy * 0.06; p.vx *= 0.86; p.vy *= 0.86;
      p.ox += p.vx; p.oy += p.vy;
      let sx = C + x + p.ox, sy = C + y + p.oy;
      // El cursor atrae y hace remolino
      if (polvo.puntero) {
        const dx = polvo.puntero[0] - sx, dy = polvo.puntero[1] - sy, d = Math.hypot(dx, dy);
        if (d < 140) { const f = (1 - d / 140); sx += dx * f * 0.35 - dy * f * 0.2; sy += dy * f * 0.35 + dx * f * 0.2; }
      }
      p.sx = sx; p.sy = sy;
      const detras = z < 0 && Math.hypot(sx - C, sy - C) < esfera;
      const prof = 0.65 + 0.35 * (z / Math.max(0.01, p.r)); // más cerca, más grande
      const brillo = (0.45 + 0.55 * Math.abs(Math.sin(t / 900 + p.fase))) * (detras ? 0.22 : 1) * (0.85 + e * 0.7 + polvo.golpe * 0.4);
      const tam = p.tam * (0.7 + prof * 0.5) * (1 + e * 0.5);
      if (dia) ctx.fillStyle = p.rosa ? `rgba(200,70,160,${Math.min(1, brillo * 0.9)})` : `rgba(90,60,220,${Math.min(1, brillo * 0.85)})`;
      else ctx.fillStyle = p.rosa ? `rgba(255,158,232,${Math.min(1, brillo)})` : `rgba(225,218,255,${Math.min(1, brillo)})`;
      ctx.beginPath(); ctx.arc(sx, sy, tam, 0, Math.PI * 2); ctx.fill();
      // Las más grandes llevan un halito
      if (p.tam > 1.6 && !detras && !dia) {
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, tam * 5);
        g.addColorStop(0, dia ? `rgba(106,76,240,${brillo * 0.35})` : `rgba(180,160,255,${brillo * 0.45})`);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(sx, sy, tam * 5, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }
  requestAnimationFrame(cuadro);
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
  iniciarPolvo();
  const escena = $("#orbe-escena");
  if (escena && "ResizeObserver" in window) new ResizeObserver(() => colocarPolvo()).observe(escena);
  addEventListener("resize", colocarPolvo);
  addEventListener("hashchange", () => setTimeout(colocarPolvo, 60));
  return { colocar: colocarPolvo };
}
