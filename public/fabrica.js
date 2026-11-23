// La "Fábrica": los departamentos de la agencia vistos como una oficina animada.
// Cada departamento es una sala con sus agentes en sus escritorios; cuando trabajan, las pantallas
// se encienden y teclean, y los mensajeros llevan los entregables a la sala de DELTA (la directora).
// Todo es SVG dibujado aquí mismo (la CSP no deja estilos en línea en el HTML: los colores van en clases).
const NS = "http://www.w3.org/2000/svg";

// Datos visuales de cada sala (lo de negocio viene de /api/departamentos).
const INFO = {
  direccion: { icono: "✦", color: "#8b73ff", puestos: [] },
  tendencias: { icono: "🔭", color: "#ff9ee8", puestos: ["Coolhunter", "Escucha social", "Innovación"], tablero: "tendencias" },
  cuentas: { icono: "🤝", color: "#4fe3b0", puestos: ["Ejecutiva", "Brief", "Seguimiento"], tablero: "cuentas" },
  estrategia: { icono: "♟️", color: "#7fb2ff", puestos: ["Planner", "Mercado", "Consumidor"] },
  creatividad: { icono: "💡", color: "#ffcf5c", puestos: ["Concepto", "Copy", "Dirección"] },
  diseno: { icono: "🎨", color: "#ff8a8a", puestos: ["Diseñadora", "Arte", "Retoque"], tablero: "estudio" },
  video: { icono: "🎬", color: "#c08bff", puestos: ["Guion", "Edición", "Storyboard"], tablero: "estudio" },
  contenido: { icono: "📱", color: "#5fd6ff", puestos: ["Calendario", "Redes", "Comunidad"], tablero: "contenido" },
  medios: { icono: "📣", color: "#ffa05c", puestos: ["Trafficker", "Audiencias", "Pujas"], tablero: "paidmedia" },
  seo: { icono: "🔎", color: "#9be35f", puestos: ["Palabras clave", "Web", "Local"], tablero: "seo" },
  analitica: { icono: "📊", color: "#5ce1e6", puestos: ["Métricas", "Reportes", "ROI"], tablero: "analitica" },
  finanzas: { icono: "💼", color: "#e6c35c", puestos: ["Cobranza", "Presupuestos", "Nómina"], tablero: "finanzas" },
};
export const tableroDe = (id) => INFO[id]?.tablero || null;

const ORDEN_PC = ["tendencias", "estrategia", "direccion", "cuentas", "creatividad", "diseno", "video", "contenido", "medios", "seo", "analitica", "finanzas"];
const ORDEN_CEL = ["direccion", "tendencias", "estrategia", "cuentas", "creatividad", "diseno", "video", "contenido", "medios", "seo", "analitica", "finanzas"];
// Nombres cortos para el rótulo de cada sala (el nombre completo sale al abrirla).
const CORTO = { cuentas: "Cuentas", estrategia: "Estrategia", creatividad: "Creatividad", video: "Video", contenido: "Contenido", medios: "Medios pagados", seo: "SEO y web", analitica: "Analítica", finanzas: "Finanzas" };
const PIELES = ["#f1c7a5", "#d9a37c", "#b57b55", "#8a5a3c", "#f5d3b8", "#c98e66"];
const PELOS = ["#2b1d16", "#5a3a22", "#1a1a24", "#a8642f", "#d9b26a", "#3d2a4f"];

const el = (tag, attrs = {}, padre) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  if (padre) padre.appendChild(n);
  return n;
};
const corta = (s, n) => { s = String(s || "").replace(/[#*_`>]/g, "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const azar = (a, b) => a + Math.random() * (b - a);
const sinMovimiento = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

let estado = null; // { caja, svg, modo, salas: Map, caminantes: [], plano, deptos }

function plano(cel) {
  const cols = cel ? 2 : 4, W = cel ? 290 : 272, H = cel ? 236 : 214, G = 46, M = 22;
  const filas = Math.ceil(12 / cols);
  const ancho = M * 2 + cols * W + (cols - 1) * G;
  const alto = M + filas * (H + G);
  const sala = (i) => {
    const c = i % cols, f = Math.floor(i / cols);
    const x = M + c * (W + G), y = M + f * (H + G);
    return { x, y, w: W, h: H, fila: f, col: c, puerta: { x: x + W / 2, y: y + H }, pasillo: y + H + G / 2 };
  };
  // Pasillos verticales: entre columnas y en las orillas.
  const verticales = [M / 2, ...Array.from({ length: cols - 1 }, (_, c) => M + (c + 1) * W + c * G + G / 2), ancho - M / 2];
  return { cols, W, H, G, M, ancho, alto, sala, verticales, cel };
}

function dibujarAgente(g, x, y, i, color) {
  const a = el("g", { class: `fab-agente${i % 2 ? "" : " habla"}`, transform: `translate(${x} ${y})` }, g);
  el("circle", { class: "fab-silla", r: 15, cx: 0, cy: 6 }, a);
  const cuerpo = el("g", { class: "fab-cuerpo" }, a);
  el("ellipse", { rx: 14, ry: 10, cx: 0, cy: 2, fill: color, class: "fab-torso" }, cuerpo);
  el("circle", { class: "fab-mano m1", r: 3.6, cx: -9, cy: -9, fill: PIELES[i % PIELES.length] }, cuerpo);
  el("circle", { class: "fab-mano m2", r: 3.6, cx: 9, cy: -9, fill: PIELES[i % PIELES.length] }, cuerpo);
  // Se ven de espaldas (miran su pantalla): cabeza con pelo y orejitas.
  el("circle", { r: 2.6, cx: -8.4, cy: -2, fill: PIELES[(i * 7 + 3) % PIELES.length] }, cuerpo);
  el("circle", { r: 2.6, cx: 8.4, cy: -2, fill: PIELES[(i * 7 + 3) % PIELES.length] }, cuerpo);
  el("circle", { r: 8.5, cx: 0, cy: -1, fill: PELOS[(i * 5 + 1) % PELOS.length] }, cuerpo);
  el("circle", { r: 3, cx: -2.5, cy: -4, class: "fab-brillo-pelo" }, cuerpo);
  const globo = el("g", { class: "fab-tecleo", transform: "translate(16 -24)" }, a);
  el("rect", { x: 0, y: -9, width: 26, height: 15, rx: 7.5, class: "fab-globo" }, globo);
  for (let k = 0; k < 3; k++) el("circle", { cx: 7 + k * 6, cy: -1.5, r: 1.8, class: `fab-punto p${k}` }, globo);
  return a;
}

function dibujarSala(capa, s, d, p) {
  const info = INFO[d.id] || { icono: "•", color: "#8b73ff", puestos: ["Agente", "Agente", "Agente"] };
  const g = el("g", { class: "fab-sala", "data-sala": d.id, tabindex: 0, role: "button", "aria-label": `Abrir ${d.nombre}` }, capa);
  el("rect", { x: s.x + 4, y: s.y + 6, width: s.w, height: s.h, rx: 16, class: "fab-sombra" }, g);
  el("rect", { x: s.x, y: s.y, width: s.w, height: s.h, rx: 16, class: "fab-piso" }, g);
  el("rect", { x: s.x, y: s.y, width: s.w, height: s.h, rx: 16, fill: "url(#fab-baldosa)", class: "fab-baldosa" }, g);
  el("rect", { x: s.x, y: s.y, width: s.w, height: s.h, rx: 16, class: "fab-muro", stroke: info.color, color: info.color }, g);
  // Puerta (hueco en el muro de abajo)
  el("rect", { x: s.puerta.x - 18, y: s.y + s.h - 3, width: 36, height: 6, class: "fab-puerta" }, g);
  // Rótulo
  const fs = p.cel ? 17 : 15;
  el("rect", { x: s.x + 10, y: s.y + 10, width: s.w - 20, height: 28, rx: 9, class: "fab-rotulo" }, g);
  el("circle", { cx: s.x + 24, cy: s.y + 24, r: 5, fill: info.color, class: "fab-foco" }, g);
  const t = el("text", { x: s.x + 36, y: s.y + 29, class: "fab-nombre", "font-size": fs }, g);
  t.textContent = `${info.icono} ${corta(CORTO[d.id] || d.nombre, 18)}`;
  const chip = el("g", { class: "fab-chip" }, g);
  el("rect", { x: s.x + s.w - 92, y: s.y + 15, width: 76, height: 18, rx: 9, class: "fab-chip-fondo" }, chip);
  const tc = el("text", { x: s.x + s.w - 54, y: s.y + 28, class: "fab-chip-texto", "text-anchor": "middle", "font-size": 10.5 }, chip);
  tc.textContent = "trabajando";

  if (d.id === "direccion") return dibujarDireccion(g, s, p);

  // Escritorios con sus agentes
  const puestos = info.puestos.length ? info.puestos : ["Agente", "Agente", "Agente"];
  const paso = (s.w - 40) / puestos.length;
  puestos.forEach((puesto, i) => {
    const cx = s.x + 20 + paso * i + paso / 2, cy = s.y + 66;
    el("rect", { x: cx - 32, y: cy - 10, width: 64, height: 26, rx: 5, class: "fab-mesa" }, g);
    el("rect", { x: cx - 17, y: cy - 7, width: 34, height: 5, rx: 2, class: "fab-monitor" }, g);
    el("rect", { x: cx - 14, y: cy + 5, width: 28, height: 6, rx: 2, class: "fab-teclado" }, g);
    el("rect", { x: cx - 26, y: cy - 4, width: 12, height: 3, rx: 1, class: "fab-luz-monitor", fill: info.color }, g);
    dibujarAgente(g, cx, cy + 31, i + d.id.length, info.color).classList.toggle("habla", i !== 1);
    const tag = el("text", { x: cx, y: cy + 66, class: "fab-tag", "text-anchor": "middle", "font-size": p.cel ? 11.5 : 10 }, g);
    tag.textContent = puesto;
  });
  // Mesa de juntas, planta y pizarrón
  const by = s.y + s.h - 68;
  el("rect", { x: s.x + 18, y: by, width: 74, height: 30, rx: 15, class: "fab-mesa-juntas" }, g);
  for (const dx of [8, 37, 66]) el("circle", { cx: s.x + 18 + dx, cy: by - 7, r: 5, class: "fab-silla-chica" }, g);
  el("circle", { cx: s.x + s.w - 22, cy: by + 4, r: 11, class: "fab-maceta" }, g);
  for (const [dx, dy] of [[-6, -4], [5, -6], [0, 4], [7, 4], [-7, 5]]) el("circle", { cx: s.x + s.w - 22 + dx, cy: by + 4 + dy, r: 6, class: "fab-hoja" }, g);
  const pz = el("g", { class: "fab-pizarron" }, g);
  el("rect", { x: s.x + 104, y: by - 8, width: s.w - 150, height: 40, rx: 6, class: "fab-pizarra" }, pz);
  let pts = "";
  for (let k = 0; k <= 8; k++) pts += `${s.x + 112 + k * ((s.w - 166) / 8)},${by + 22 - Math.abs(Math.sin(k * 1.3 + d.id.length)) * 22} `;
  el("polyline", { points: pts.trim(), class: "fab-grafica", stroke: info.color }, pz);
  // Estado (lo que hace o lo último que entregó)
  el("rect", { x: s.x + 10, y: s.y + s.h - 30, width: s.w - 20, height: 22, rx: 8, class: "fab-estado-fondo" }, g);
  el("text", { x: s.x + 20, y: s.y + s.h - 15, class: "fab-estado", "font-size": p.cel ? 12 : 11 }, g);
  return g;
}

function dibujarDireccion(g, s, p) {
  g.classList.add("fab-direccion");
  const cx = s.x + s.w * 0.4, cy = s.y + s.h / 2 + 2;
  for (const r of [62, 48]) el("circle", { cx, cy, r, class: "fab-anillo" }, g);
  el("circle", { cx, cy, r: 32, fill: "url(#fab-orbe)", class: "fab-orbe" }, g);
  el("circle", { cx: cx - 10, cy: cy - 11, r: 8, class: "fab-orbe-brillo" }, g);
  const t = el("text", { x: cx, y: s.y + s.h - 16, "text-anchor": "middle", class: "fab-delta", "font-size": p.cel ? 14 : 12 }, g);
  t.textContent = "DELTA · DIRECTORA";
  // Bandeja de aprobaciones (va a #/aprobaciones)
  const b = el("g", { class: "fab-bandeja", "data-ir-fab": "aprobaciones", tabindex: 0, role: "button", "aria-label": "Abrir Aprobaciones" }, g);
  const bx = s.x + s.w - 84, byy = cy - 26;
  el("rect", { x: bx, y: byy, width: 70, height: 52, rx: 10, class: "fab-bandeja-fondo" }, b);
  el("text", { x: bx + 35, y: byy + 26, "text-anchor": "middle", class: "fab-bandeja-num", "font-size": 20 }, b);
  const tb = el("text", { x: bx + 35, y: byy + 42, "text-anchor": "middle", class: "fab-bandeja-texto", "font-size": 9.5 }, b);
  tb.textContent = "por aprobar";
  // Cafetera de la oficina
  el("rect", { x: s.x + 16, y: s.y + 56, width: 30, height: 34, rx: 6, class: "fab-cafetera" }, g);
  el("circle", { cx: s.x + 31, cy: s.y + 68, r: 5, class: "fab-cafe" }, g);
  const tcafe = el("text", { x: s.x + 19, y: s.y + 104, class: "fab-tag", "font-size": 10 }, g);
  tcafe.textContent = "café";
  return g;
}

function construir(caja) {
  const cel = caja.clientWidth < 720;
  const p = plano(cel);
  const svg = el("svg", { viewBox: `0 0 ${p.ancho} ${p.alto}`, class: "fab-svg", role: "img", "aria-label": "Oficina de los departamentos" });
  const defs = el("defs", {}, svg);
  const pat = el("pattern", { id: "fab-baldosa", width: 24, height: 24, patternUnits: "userSpaceOnUse" }, defs);
  el("path", { d: "M24 0H0V24", class: "fab-junta" }, pat);
  const rg = el("radialGradient", { id: "fab-orbe", cx: "35%", cy: "30%", r: "75%" }, defs);
  el("stop", { offset: "0%", "stop-color": "#ffffff" }, rg);
  el("stop", { offset: "35%", "stop-color": "#c9bfff" }, rg);
  el("stop", { offset: "75%", "stop-color": "#7b5cff" }, rg);
  el("stop", { offset: "100%", "stop-color": "#3a1f9c" }, rg);
  el("rect", { x: 0, y: 0, width: p.ancho, height: p.alto, rx: 22, class: "fab-suelo" }, svg);
  // Pasillos
  const pas = el("g", { class: "fab-pasillos" }, svg);
  const filas = Math.ceil(12 / p.cols);
  for (let f = 0; f < filas; f++) {
    const y = p.sala(f * p.cols).pasillo;
    el("line", { x1: p.verticales[0], y1: y, x2: p.verticales.at(-1), y2: y, class: "fab-camino" }, pas);
  }
  for (const x of p.verticales) el("line", { x1: x, y1: p.M / 2, x2: x, y2: p.sala((filas - 1) * p.cols).pasillo, class: "fab-camino" }, pas);
  const capaSalas = el("g", {}, svg);
  const capaCaminantes = el("g", { class: "fab-caminantes" }, svg);
  caja.replaceChildren(svg);
  return { caja, svg, p, capaSalas, capaCaminantes, modo: cel ? "cel" : "pc", salas: new Map(), caminantes: [], ultimo: 0, corriendo: false };
}

function pintarSalas(deptos) {
  const { p, capaSalas } = estado;
  const orden = estado.modo === "cel" ? ORDEN_CEL : ORDEN_PC;
  const porId = Object.fromEntries(deptos.map((d) => [d.id, d]));
  const lista = [...orden.filter((id) => id === "direccion" || porId[id]), ...deptos.map((d) => d.id).filter((id) => !orden.includes(id))].slice(0, 12);
  capaSalas.replaceChildren();
  estado.salas.clear();
  lista.forEach((id, i) => {
    const s = p.sala(i);
    const d = id === "direccion" ? { id, nombre: "Dirección" } : porId[id];
    const g = dibujarSala(capaSalas, s, d, p);
    estado.salas.set(id, { s, g });
  });
  estado.firma = lista.join(",");
}

// Pone al día lo que cambia con los datos (sin redibujar la oficina, así los que caminan no brincan).
function actualizarDatos(deptos, extra) {
  for (const d of deptos) {
    const sala = estado.salas.get(d.id);
    if (!sala) continue;
    const g = sala.g;
    const activo = d.trabajando > 0;
    g.classList.toggle("trabajando", activo);
    g.classList.toggle("quieta", !activo);
    const enCurso = d.trabajos.find((t) => t.estado === "en_proceso");
    const ultimo = d.trabajos.find((t) => t.estado !== "en_proceso");
    const texto = g.querySelector(".fab-estado");
    const largo = estado.modo === "cel" ? 34 : 36;
    if (texto) texto.textContent = enCurso ? `✍️ ${corta(enCurso.encargo, largo)}` : ultimo ? `✓ ${corta(ultimo.encargo || ultimo.extracto, largo)}` : "Esperando un encargo";
    g.querySelector(".fab-chip-texto").textContent = activo ? (d.trabajando > 1 ? `${d.trabajando} encargos` : "trabajando") : "";
  }
  const num = estado.svg.querySelector(".fab-bandeja-num");
  if (num) num.textContent = String(extra.pendientes ?? "–");
  estado.svg.querySelector(".fab-direccion")?.classList.toggle("con-pendientes", (extra.pendientes || 0) > 0);
  ajustarCaminantes(deptos);
}

// ---------- Los que caminan por los pasillos ----------
function ruta(desde, hasta) {
  const { p } = estado;
  const pts = [];
  const a = desde, b = hasta;
  pts.push({ x: a.x, y: a.pasillo });
  if (a.fila !== b.fila) {
    const vx = p.verticales.reduce((m, x) => (Math.abs(x - (a.x + b.x) / 2) < Math.abs(m - (a.x + b.x) / 2) ? x : m), p.verticales[0]);
    pts.push({ x: vx, y: a.pasillo }, { x: vx, y: b.pasillo });
  }
  pts.push({ x: b.x, y: b.pasillo }, { x: b.x, y: b.y });
  return pts;
}
const puertaDe = (id) => {
  const s = estado.salas.get(id)?.s;
  return s && { x: s.puerta.x + azar(-12, 12), y: s.puerta.y - 6, pasillo: s.pasillo, fila: s.fila };
};

function nuevoCaminante(tipo, casa) {
  const ids = [...estado.salas.keys()];
  const origen = casa || ids[Math.floor(Math.random() * ids.length)];
  const info = INFO[origen] || INFO.direccion;
  const g = el("g", { class: `fab-caminante ${tipo}` }, estado.capaCaminantes);
  el("ellipse", { rx: 10, ry: 4, cx: 0, cy: 12, class: "fab-sombra-chica" }, g);
  const c = el("g", { class: "fab-cuerpo-camina" }, g);
  el("ellipse", { rx: 11, ry: 8, cx: 0, cy: 2, fill: info.color }, c);
  const n = Math.floor(Math.random() * 99);
  el("circle", { r: 7, cx: 0, cy: -2, fill: PIELES[n % PIELES.length] }, c);
  el("path", { d: "M-7 -2 a7 7 0 0 1 14 0 q-7 -4 -14 0z", fill: PELOS[n % PELOS.length] }, c);
  if (tipo === "mensajero") {
    const doc = el("g", { class: "fab-doc", transform: "translate(9 -4)" }, c);
    el("rect", { x: 0, y: -8, width: 12, height: 15, rx: 2, class: "fab-hoja-doc" }, doc);
    for (const y of [-4, -1, 2]) el("line", { x1: 2.5, y1: y, x2: 9.5, y2: y, class: "fab-renglon" }, doc);
  }
  const ini = puertaDe(origen);
  const w = { g, c, tipo, casa: origen, x: ini.x, y: ini.y, puntos: [], espera: azar(0, 2.5), dondeEsta: origen, vel: azar(48, 70), fase: Math.random() * 6 };
  estado.caminantes.push(w);
  return w;
}

function siguienteDestino(w) {
  const ids = [...estado.salas.keys()];
  let destino;
  if (w.tipo === "mensajero") destino = w.dondeEsta === "direccion" ? w.casa : "direccion";
  else do destino = ids[Math.floor(Math.random() * ids.length)]; while (destino === w.dondeEsta && ids.length > 1);
  const a = puertaDe(w.dondeEsta), b = puertaDe(destino);
  if (!a || !b) return;
  w.puntos = ruta({ ...a, x: w.x }, b);
  w.destino = destino;
  w.g.classList.toggle("lleva", w.tipo === "mensajero" && destino === "direccion");
}

function ajustarCaminantes(deptos) {
  const activos = deptos.filter((d) => d.trabajando > 0).map((d) => d.id).filter((id) => estado.salas.has(id));
  // Un mensajero por cada departamento que está trabajando (lleva y trae entregables a DELTA).
  for (const w of estado.caminantes.filter((x) => x.tipo === "mensajero" && !activos.includes(x.casa))) { w.g.remove(); w.fuera = true; }
  estado.caminantes = estado.caminantes.filter((x) => !x.fuera);
  for (const id of activos) if (!estado.caminantes.some((x) => x.tipo === "mensajero" && x.casa === id)) nuevoCaminante("mensajero", id);
  const paseantes = estado.modo === "cel" ? 3 : 5;
  while (estado.caminantes.filter((x) => x.tipo === "paseo").length < paseantes) nuevoCaminante("paseo");
}

function mover(dt) {
  for (const w of estado.caminantes) {
    if (w.espera > 0) { w.espera -= dt; w.g.classList.add("parado"); }
    else {
      if (!w.puntos.length) siguienteDestino(w);
      let avance = w.vel * dt;
      while (avance > 0 && w.puntos.length) {
        const pt = w.puntos[0];
        const dx = pt.x - w.x, dy = pt.y - w.y, dist = Math.hypot(dx, dy);
        if (dist <= avance) { w.x = pt.x; w.y = pt.y; avance -= dist; w.puntos.shift(); }
        else { w.x += (dx / dist) * avance; w.y += (dy / dist) * avance; avance = 0; }
      }
      if (!w.puntos.length) { w.dondeEsta = w.destino || w.dondeEsta; w.espera = w.tipo === "mensajero" ? azar(1.2, 2.4) : azar(1.5, 5); }
      w.g.classList.remove("parado");
      w.fase += dt * 10;
    }
    const brinco = w.espera > 0 ? 0 : Math.abs(Math.sin(w.fase)) * -2.2;
    w.g.setAttribute("transform", `translate(${w.x.toFixed(1)} ${w.y.toFixed(1)})`);
    w.c.setAttribute("transform", `translate(0 ${brinco.toFixed(2)})`);
  }
}

function bucle(t) {
  if (!estado || !estado.caja.isConnected || estado.caja.offsetParent === null || document.hidden) { estado && (estado.corriendo = false); return; }
  const dt = Math.min(0.05, (t - (estado.ultimo || t)) / 1000);
  estado.ultimo = t;
  mover(dt);
  requestAnimationFrame(bucle);
}
function arrancar() {
  if (!estado || estado.corriendo) return;
  if (sinMovimiento()) { mover(0); return; }
  estado.corriendo = true;
  estado.ultimo = 0;
  requestAnimationFrame(bucle);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) arrancar(); });

// ---------- Lo que se llama desde app.js ----------
let ultimos = null;
export function pintarFabrica(caja, deptos, extra = {}, alAbrir) {
  ultimos = { caja, deptos, extra, alAbrir };
  const modo = caja.clientWidth < 720 ? "cel" : "pc";
  if (!estado || estado.caja !== caja || estado.modo !== modo || !caja.contains(estado.svg)) estado = construir(caja);
  const orden = estado.modo === "cel" ? ORDEN_CEL : ORDEN_PC;
  const firma = [...orden.filter((id) => id === "direccion" || deptos.some((d) => d.id === id)), ...deptos.map((d) => d.id).filter((id) => !orden.includes(id))].slice(0, 12).join(",");
  if (estado.firma !== firma) { estado.caminantes.forEach((w) => w.g.remove()); estado.caminantes = []; pintarSalas(deptos); }
  actualizarDatos(deptos, extra);
  if (!caja.dataset.listo) {
    caja.dataset.listo = "1";
    const abrir = (e) => {
      const ir = e.target.closest("[data-ir-fab]");
      if (ir) { location.hash = "#/" + ir.dataset.irFab; return; }
      const sala = e.target.closest("[data-sala]");
      if (sala && sala.dataset.sala !== "direccion") ultimos.alAbrir?.(sala.dataset.sala);
      else if (sala) location.hash = "#/agencia";
    };
    caja.addEventListener("click", abrir);
    caja.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrir(e); } });
    let t;
    addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => { if (ultimos && caja.offsetParent) pintarFabrica(caja, ultimos.deptos, ultimos.extra, ultimos.alAbrir); }, 250); });
  }
  arrancar();
}
