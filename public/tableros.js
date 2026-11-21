// Tableros de "Mercados y noticias": bolsa (velas, barras, dona, listas) y centro de noticias
// (globo con los lugares de las noticias, panel financiero, videos y resumen de la situación).
// Todo se dibuja aquí mismo (SVG y canvas), sin librerías de afuera.

const NS = "http://www.w3.org/2000/svg";
const $ = (s) => document.querySelector(s);
const PERIODOS = [["hoy", "Hoy"], ["5d", "5D"], ["1m", "1M"], ["3m", "3M"], ["6m", "6M"], ["1a", "1A"], ["5a", "5A"]];
const quieto = matchMedia("(prefers-reduced-motion: reduce)").matches;

export function iniciarTableros({ api, esc, guardado, decir }) {
  const num = (x, dec) => (typeof x === "number" ? x.toLocaleString("es-MX", { minimumFractionDigits: dec ?? (Math.abs(x) >= 1000 ? 0 : 2), maximumFractionDigits: dec ?? (Math.abs(x) >= 1000 ? 0 : 2) }) : "–");
  const signo = (c) => (c > 0 ? "sube" : c < 0 ? "baja" : "igual");
  const flecha = (c) => (c > 0 ? "▲" : c < 0 ? "▼" : "•");
  const pctTxt = (c) => (typeof c === "number" ? `${c > 0 ? "+" : ""}${c.toFixed(2)}%` : "–");
  const haceRato = (iso) => {
    if (!iso) return "";
    const m = Math.round((Date.now() - new Date(iso)) / 60e3);
    if (m < 1) return "justo ahora";
    if (m < 60) return `hace ${m} min`;
    const h = Math.round(m / 60);
    return h < 24 ? `hace ${h} h` : `hace ${Math.round(h / 24)} d`;
  };

  // =====================================================================
  //  BOLSA
  // =====================================================================
  let tablero = null;
  let elegido = guardado.get("delta_bolsa_simbolo") || null;
  let periodo = guardado.get("delta_bolsa_periodo") || "3m";
  let velasActuales = null;

  $("#tb-periodos").innerHTML = PERIODOS.map(([k, t]) => `<button type="button" data-periodo="${k}">${t}</button>`).join("");
  $("#tb-periodos").addEventListener("click", (e) => {
    const b = e.target.closest("[data-periodo]");
    if (!b) return;
    periodo = b.dataset.periodo;
    guardado.set("delta_bolsa_periodo", periodo);
    cargarVelas();
  });

  function elegir(simbolo) {
    elegido = simbolo;
    guardado.set("delta_bolsa_simbolo", simbolo);
    pintarSeleccion();
    cargarVelas();
  }
  document.addEventListener("click", (e) => {
    const x = e.target.closest("[data-simbolo]");
    if (x && x.closest(".mercados-noticias")) elegir(x.dataset.simbolo);
  });

  async function cargarBolsa() {
    tablero = await api("/bolsa/tablero");
    const ok = tablero.items.filter((d) => !d.error);
    if (!ok.length) {
      $("#tb-kpis").innerHTML = `<p class="tenue">Sin datos de bolsa por ahora. Intento de nuevo en unos minutos.</p>`;
      return;
    }
    if (!elegido || !ok.some((d) => d.simbolo === elegido)) elegido = ok[0].simbolo;
    pintarKpis(ok);
    pintarLista(tablero.items);
    pintarBarras(ok);
    pintarDona(ok);
    pintarExtremos(ok);
    pintarSeleccion();
    $("#tb-hora").textContent = `Actualizado ${haceRato(tablero.hora)}`;
    if (!velasActuales || velasActuales.simbolo !== elegido) cargarVelas();
  }

  // Línea pequeña con su sombra (para tarjetas y listas)
  let idSpark = 0;
  function spark(serie, clase, w = 120, h = 34) {
    if (!serie?.length) return "";
    const min = Math.min(...serie), max = Math.max(...serie), r = max - min || 1;
    const pts = serie.map((v, i) => [((i / (serie.length - 1 || 1)) * w).toFixed(1), (h - 2 - ((v - min) / r) * (h - 4)).toFixed(1)]);
    const d = "M" + pts.map((p) => p.join(",")).join("L");
    const id = `sp${++idSpark}`;
    return `<svg class="spark ${clase}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="st-a"/><stop offset="1" class="st-b"/></linearGradient></defs>
      <path d="${d}L${w},${h}L0,${h}Z" fill="url(#${id})"/><path d="${d}" class="sp-linea"/></svg>`;
  }

  function pintarKpis(ok) {
    $("#tb-kpis").innerHTML = ok.slice(0, 4).map((d) => `
      <button type="button" class="tb-kpi" data-simbolo="${esc(d.simbolo)}">
        <span class="tb-kpi-nombre">${esc(d.nombre)}</span>
        <b>${num(d.precio)} <small>${esc(d.moneda)}</small></b>
        <span class="tb-chip ${signo(d.cambio_dia_pct)}">${flecha(d.cambio_dia_pct)} ${pctTxt(d.cambio_dia_pct)}</span>
        <span class="tb-kpi-mes">Mes ${pctTxt(d.cambio_mes_pct)}</span>
        ${spark(d.serie, signo(d.cambio_mes_pct))}
      </button>`).join("");
  }

  function pintarLista(items) {
    $("#tb-lista").innerHTML = items.map((d) => d.error
      ? `<li class="tb-fila apagada"><span class="tb-fila-nombre">${esc(d.nombre || d.simbolo)}<small>sin datos</small></span></li>`
      : `<li class="tb-fila" data-simbolo="${esc(d.simbolo)}" tabindex="0">
          <span class="tb-fila-nombre">${esc(d.nombre)}<small>${esc(d.simbolo)} · ${esc(d.tipo)}</small></span>
          ${spark(d.serie.slice(-20), signo(d.cambio_dia_pct), 60, 22)}
          <span class="tb-fila-precio">${num(d.precio)}<small class="${signo(d.cambio_dia_pct)}">${flecha(d.cambio_dia_pct)} ${pctTxt(d.cambio_dia_pct)}</small></span>
        </li>`).join("");
  }

  function pintarSeleccion() {
    document.querySelectorAll(".mercados-noticias [data-simbolo]").forEach((x) => x.classList.toggle("elegido", x.dataset.simbolo === elegido));
    const d = tablero?.items.find((x) => x.simbolo === elegido);
    if (!d || d.error) return;
    $("#tb-sel-nombre").textContent = d.nombre;
    $("#tb-sel-simbolo").textContent = `${d.simbolo} · ${d.tipo}`;
    $("#tb-sel-precio").textContent = `${num(d.precio)} ${d.moneda}`;
    const c = $("#tb-sel-cambio");
    c.className = `tb-chip ${signo(d.cambio_dia_pct)}`;
    c.textContent = `${flecha(d.cambio_dia_pct)} ${pctTxt(d.cambio_dia_pct)} hoy`;
    $("#tb-preguntar").dataset.pedir = `¿Cómo ves ${d.nombre} (${d.simbolo})? Dame contexto, tendencia y riesgos. Solo información, no asesoría.`;
    pintarRango(d);
  }

  function pintarRango(d) {
    const caja = $("#tb-rango");
    if (typeof d.min_52s !== "number" || typeof d.max_52s !== "number" || d.max_52s <= d.min_52s) { caja.hidden = true; return; }
    caja.hidden = false;
    const p = Math.max(0, Math.min(100, ((d.precio - d.min_52s) / (d.max_52s - d.min_52s)) * 100));
    caja.innerHTML = `<h3>Rango de 52 semanas · ${esc(d.nombre)}</h3>
      <svg class="tb-rango-barra" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
        <rect x="0" y="4" width="100" height="2" rx="1" class="r-fondo"/><rect x="0" y="4" width="${p.toFixed(1)}" height="2" rx="1" class="r-lleno"/>
      </svg>
      <span class="tb-rango-marca" id="tb-rango-marca"></span>
      <div class="tb-rango-txt"><span>${num(d.min_52s)}</span><b>${p < 15 ? "Cerca de su mínimo" : p > 85 ? "Cerca de su máximo" : `Al ${Math.round(p)}% de su rango`}</b><span>${num(d.max_52s)}</span></div>`;
    $("#tb-rango-marca").style.left = `${p}%`;
  }

  async function cargarVelas() {
    document.querySelectorAll("[data-periodo]").forEach((b) => b.classList.toggle("activa", b.dataset.periodo === periodo));
    if (!elegido) return;
    $("#tb-grafica-caja").classList.add("cargando");
    try {
      velasActuales = await api(`/bolsa/velas/${encodeURIComponent(elegido)}?periodo=${periodo}`);
      velasActuales.simbolo = elegido;
      pintarVelas();
    } catch (e) {
      $("#tb-grafica").innerHTML = "";
      $("#tb-grafica-msg").textContent = "No se pudo cargar la gráfica. " + e.message;
    } finally {
      $("#tb-grafica-caja").classList.remove("cargando");
    }
  }

  function el(tag, attrs, padre) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    padre?.appendChild(n);
    return n;
  }

  // Gráfica de velas con volumen, promedio de 20 y precio actual
  function pintarVelas() {
    const svg = $("#tb-grafica");
    const v = velasActuales?.velas || [];
    $("#tb-grafica-msg").textContent = v.length ? "" : "Sin movimientos en este periodo.";
    svg.innerHTML = "";
    if (!v.length) return;
    const W = Math.max(280, svg.clientWidth || 600), H = Math.max(220, svg.clientHeight || 340);
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const der = 58, abajo = 22, alturaVol = H * 0.18;
    const ancho = W - der, alto = H - abajo - alturaVol - 8;
    let min = Math.min(...v.map((x) => x.l)), max = Math.max(...v.map((x) => x.h));
    const pad = (max - min) * 0.06 || 1; min -= pad; max += pad;
    const y = (p) => 6 + (1 - (p - min) / (max - min)) * (alto - 6);
    const paso = ancho / v.length;
    const x = (i) => i * paso + paso / 2;
    const cuerpo = Math.max(1, Math.min(14, paso * 0.62));

    const g = el("g", {}, svg);
    for (let k = 0; k <= 4; k++) {
      const p = min + ((max - min) * k) / 4;
      el("line", { x1: 0, x2: ancho, y1: y(p), y2: y(p), class: "g-rejilla" }, g);
      el("text", { x: ancho + 6, y: y(p) + 4, class: "g-eje" }, g).textContent = num(p);
    }
    const fmtF = periodo === "hoy" || periodo === "5d"
      ? new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", ...(periodo === "5d" ? { weekday: "short" } : {}) })
      : new Intl.DateTimeFormat("es-MX", periodo === "5a" ? { month: "short", year: "2-digit" } : { day: "numeric", month: "short" });
    const marcas = Math.min(6, v.length);
    for (let k = 0; k < marcas; k++) {
      const i = Math.round((k * (v.length - 1)) / Math.max(1, marcas - 1));
      el("text", { x: Math.min(ancho - 20, Math.max(18, x(i))), y: H - 6, class: "g-eje medio" }, g).textContent = fmtF.format(v[i].t);
    }
    // Volumen
    const maxV = Math.max(...v.map((c) => c.v)) || 1;
    const baseV = H - abajo;
    if (maxV > 1) v.forEach((c, i) => {
      const h = (c.v / maxV) * alturaVol;
      el("rect", { x: x(i) - cuerpo / 2, y: baseV - h, width: cuerpo, height: Math.max(0.5, h), class: `g-vol ${c.c >= c.o ? "sube" : "baja"}` }, g);
    });
    // Velas
    v.forEach((c, i) => {
      const cls = c.c >= c.o ? "sube" : "baja";
      el("line", { x1: x(i), x2: x(i), y1: y(c.h), y2: y(c.l), class: `g-mecha ${cls}` }, g);
      const top = y(Math.max(c.o, c.c));
      el("rect", { x: x(i) - cuerpo / 2, y: top, width: cuerpo, height: Math.max(1, y(Math.min(c.o, c.c)) - top), rx: cuerpo > 4 ? 1.2 : 0, class: `g-vela ${cls}` }, g);
    });
    // Promedio de 20 periodos
    if (v.length > 22) {
      let d = "";
      v.forEach((c, i) => {
        if (i < 19) return;
        let s = 0;
        for (let k = i - 19; k <= i; k++) s += v[k].c;
        d += `${d ? "L" : "M"}${x(i).toFixed(1)},${y(s / 20).toFixed(1)}`;
      });
      el("path", { d, class: "g-media" }, g);
    }
    // Precio actual
    const ult = velasActuales.precio ?? v.at(-1).c;
    el("line", { x1: 0, x2: ancho, y1: y(ult), y2: y(ult), class: "g-actual" }, g);
    el("rect", { x: ancho + 1, y: y(ult) - 9, width: der - 2, height: 18, rx: 4, class: "g-actual-caja" }, g);
    el("text", { x: ancho + 6, y: y(ult) + 4, class: "g-actual-txt" }, g).textContent = num(ult);
    // Cruz que sigue al mouse
    const cruz = el("g", { class: "g-cruz", visibility: "hidden" }, svg);
    const lv = el("line", { y1: 0, y2: H - abajo, class: "g-cruz-l" }, cruz);
    const lh = el("line", { x1: 0, x2: ancho, class: "g-cruz-l" }, cruz);
    const tip = $("#tb-tip");
    const fmtTip = new Intl.DateTimeFormat("es-MX", periodo === "hoy" || periodo === "5d" ? { weekday: "short", hour: "2-digit", minute: "2-digit" } : { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    svg.onpointermove = (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(v.length - 1, Math.floor(px / paso)));
      const c = v[i];
      const py = ((e.clientY - r.top) / r.height) * H;
      cruz.setAttribute("visibility", "visible");
      lv.setAttribute("x1", x(i)); lv.setAttribute("x2", x(i));
      lh.setAttribute("y1", py); lh.setAttribute("y2", py);
      const cambio = ((c.c - c.o) / c.o) * 100;
      tip.innerHTML = `<b>${esc(fmtTip.format(c.t))}</b><span>Abrió <i>${num(c.o)}</i></span><span>Máx <i>${num(c.h)}</i></span><span>Mín <i>${num(c.l)}</i></span><span>Cerró <i class="${signo(cambio)}">${num(c.c)}</i></span>${c.v ? `<span>Vol <i>${num(c.v, 0)}</i></span>` : ""}`;
      tip.hidden = false;
      const izq = (x(i) / W) * r.width;
      tip.style.left = `${izq > r.width / 2 ? izq - tip.offsetWidth - 14 : izq + 14}px`;
      tip.style.top = "10px";
    };
    svg.onpointerleave = () => { cruz.setAttribute("visibility", "hidden"); tip.hidden = true; };
    const primero = v[0].o, cambioP = ((ult - primero) / primero) * 100;
    const nombreP = PERIODOS.find((p) => p[0] === periodo)?.[1] || "";
    $("#tb-sel-periodo").className = `tb-sel-periodo ${signo(cambioP)}`;
    $("#tb-sel-periodo").textContent = `${pctTxt(cambioP)} en ${nombreP}`;
  }

  // Barras: cuánto se movió cada uno hoy
  function pintarBarras(ok) {
    const svg = $("#tb-barras");
    const datos = ok.filter((d) => typeof d.cambio_dia_pct === "number").sort((a, b) => b.cambio_dia_pct - a.cambio_dia_pct);
    svg.innerHTML = "";
    const W = Math.max(260, svg.clientWidth || 360), fila = 24, H = datos.length * fila + 6;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("height", H);
    const etiqueta = Math.min(130, W * 0.36), valor = 58, centro = etiqueta + (W - etiqueta - valor) / 2, mitad = (W - etiqueta - valor) / 2 - 4;
    const tope = Math.max(...datos.map((d) => Math.abs(d.cambio_dia_pct)), 0.5);
    el("line", { x1: centro, x2: centro, y1: 0, y2: H, class: "g-rejilla" }, svg);
    datos.forEach((d, i) => {
      const yy = i * fila + 4;
      const g = el("g", { class: "tb-barra", "data-simbolo": d.simbolo }, svg);
      el("text", { x: 0, y: yy + 14, class: "g-etq" }, g).textContent = d.nombre.length > 18 ? d.nombre.slice(0, 17) + "…" : d.nombre;
      const largo = (Math.abs(d.cambio_dia_pct) / tope) * mitad;
      el("rect", { x: d.cambio_dia_pct >= 0 ? centro : centro - largo, y: yy + 3, width: Math.max(2, largo), height: fila - 10, rx: 3, class: `g-barra ${signo(d.cambio_dia_pct)}` }, g);
      el("text", { x: W, y: yy + 14, class: `g-valor ${signo(d.cambio_dia_pct)}` }, g).textContent = pctTxt(d.cambio_dia_pct);
    });
  }

  // Dona: cuántos suben y cuántos bajan
  function pintarDona(ok) {
    const sube = ok.filter((d) => d.cambio_dia_pct > 0).length;
    const baja = ok.filter((d) => d.cambio_dia_pct < 0).length;
    const igual = ok.length - sube - baja;
    const R = 52, C = 2 * Math.PI * R;
    let ini = 0;
    const arco = (n, cls) => {
      if (!n) return "";
      const largo = (n / ok.length) * C;
      const s = `<circle r="${R}" cx="70" cy="70" class="d-arco ${cls}" stroke-dasharray="${Math.max(0, largo - 3)} ${C}" stroke-dashoffset="${-ini}"/>`;
      ini += largo;
      return s;
    };
    const prom = ok.reduce((s, d) => s + (d.cambio_dia_pct || 0), 0) / ok.length;
    const humor = sube > baja * 1.5 ? "Día verde" : baja > sube * 1.5 ? "Día rojo" : "Día mixto";
    $("#tb-dona").innerHTML = `
      <svg viewBox="0 0 140 140" class="dona" aria-hidden="true">
        <circle r="${R}" cx="70" cy="70" class="d-fondo"/>
        <g transform="rotate(-90 70 70)">${arco(sube, "sube")}${arco(baja, "baja")}${arco(igual, "igual")}</g>
        <text x="70" y="66" class="d-num">${sube}/${ok.length}</text><text x="70" y="84" class="d-sub">suben</text>
      </svg>
      <div class="dona-info">
        <b class="${signo(prom)}">${humor}</b>
        <span><i class="pt sube"></i>${sube} suben</span><span><i class="pt baja"></i>${baja} bajan</span>${igual ? `<span><i class="pt igual"></i>${igual} sin cambio</span>` : ""}
        <small>Promedio de tu lista: <b class="${signo(prom)}">${pctTxt(prom)}</b></small>
      </div>`;
  }

  function pintarExtremos(ok) {
    const orden = ok.filter((d) => typeof d.cambio_dia_pct === "number").sort((a, b) => b.cambio_dia_pct - a.cambio_dia_pct);
    const fila = (d) => `<li data-simbolo="${esc(d.simbolo)}"><span>${esc(d.nombre)}</span><b class="${signo(d.cambio_dia_pct)}">${pctTxt(d.cambio_dia_pct)}</b></li>`;
    $("#tb-suben").innerHTML = orden.filter((d) => d.cambio_dia_pct > 0).slice(0, 3).map(fila).join("") || `<li class="vacio">Nada en verde hoy</li>`;
    $("#tb-bajan").innerHTML = orden.filter((d) => d.cambio_dia_pct < 0).reverse().slice(0, 3).map(fila).join("") || `<li class="vacio">Nada en rojo hoy</li>`;
  }

  // =====================================================================
  //  NOTICIAS
  // =====================================================================
  let mapaDatos = null;
  let lugarElegido = null;

  async function cargarNoticias() {
    const [m, vids, res] = await Promise.allSettled([api("/noticias/mapa"), api("/noticias/videos"), api("/noticias/resumen")]);
    if (m.status === "fulfilled") {
      mapaDatos = m.value;
      globo.puntos(mapaDatos.puntos);
      if (!lugarElegido || !mapaDatos.puntos.some((p) => p.lugar === lugarElegido)) lugarElegido = mapaDatos.puntos[0]?.lugar || null;
      pintarLugar();
      $("#tn-contador").textContent = `${mapaDatos.puntos.length} lugares · ${mapaDatos.puntos.reduce((s, p) => s + p.noticias.length, 0)} noticias`;
    } else {
      $("#tn-lugar").innerHTML = `<p class="tenue">No se pudieron cargar las noticias del mundo.</p>`;
    }
    pintarVideos(vids.status === "fulfilled" ? vids.value : null);
    pintarResumen(res.status === "fulfilled" ? res.value : { error: res.reason?.message });
  }

  function pintarLugar() {
    const p = mapaDatos?.puntos.find((x) => x.lugar === lugarElegido);
    globo.elegir(p);
    const otros = (mapaDatos?.puntos || []).slice(0, 12);
    $("#tn-lugares").innerHTML = otros.map((x) => `<button type="button" class="chip-lugar${x.lugar === lugarElegido ? " activa" : ""}" data-lugar="${esc(x.lugar)}">${esc(x.lugar)} <i>${x.noticias.length}</i></button>`).join("");
    if (!p) { $("#tn-lugar").innerHTML = ""; return; }
    $("#tn-lugar-nombre").textContent = p.lugar;
    $("#tn-lugar").innerHTML = p.noticias.slice(0, 6).map((n) => `<li><a href="${esc(/^https:\/\//.test(n.enlace) ? n.enlace : "#")}" target="_blank" rel="noopener noreferrer">${esc(n.titulo)}</a><span class="sub">${esc(n.fuente)}${n.fecha ? " · " + haceRato(n.fecha) : ""}</span></li>`).join("");
  }
  $("#tn-lugares").addEventListener("click", (e) => {
    const b = e.target.closest("[data-lugar]");
    if (!b) return;
    lugarElegido = b.dataset.lugar;
    pintarLugar();
    globo.mirarA(mapaDatos.puntos.find((x) => x.lugar === lugarElegido));
  });

  function pintarVideos(lista) {
    const caja = $("#tn-videos");
    if (!lista?.length) { caja.innerHTML = `<p class="tenue">Los videos de noticieros no cargaron por ahora.</p>`; return; }
    caja.innerHTML = lista.map((v) => `
      <button type="button" class="tn-video" data-video="${esc(v.id)}" data-titulo="${esc(v.titulo)}">
        <span class="tn-mini"><img src="${esc(v.imagen)}" alt="" loading="lazy" referrerpolicy="no-referrer"/><i class="tn-play"></i><em>${esc(v.canal)}</em></span>
        <span class="tn-video-txt">${esc(v.titulo)}<small>${haceRato(v.fecha)}</small></span>
      </button>`).join("");
  }
  $("#tn-videos").addEventListener("click", (e) => {
    const b = e.target.closest("[data-video]");
    if (!b || !/^[\w-]{11}$/.test(b.dataset.video)) return;
    const caja = $("#tn-reproductor");
    caja.innerHTML = "";
    const f = document.createElement("iframe");
    f.src = `https://www.youtube-nocookie.com/embed/${b.dataset.video}?autoplay=1&rel=0`;
    f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
    f.allowFullscreen = true;
    f.referrerPolicy = "strict-origin-when-cross-origin";
    caja.appendChild(f);
    $("#dlg-video-titulo").textContent = b.dataset.titulo;
    $("#dlg-video-yt").href = `https://www.youtube.com/watch?v=${b.dataset.video}`;
    $("#dlg-video").showModal();
  });
  $("#dlg-video").addEventListener("close", () => { $("#tn-reproductor").innerHTML = ""; });
  $("#dlg-video-cerrar").addEventListener("click", () => $("#dlg-video").close());

  let resumenTexto = "";
  function pintarResumen(r) {
    const caja = $("#tn-resumen");
    if (!r?.texto) {
      caja.innerHTML = `<p class="tenue">${r?.error ? esc(r.error) + ". " : ""}Toque “Actualizar” para que DELTA prepare el resumen.</p>`;
      $("#tn-resumen-hora").textContent = "";
      return;
    }
    resumenTexto = r.texto;
    const lineas = r.texto.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    caja.innerHTML = lineas.map((l, i) => {
      if (l.startsWith("•")) {
        const [, tema, resto] = l.match(/^•\s*([^:]{2,40}):\s*(.*)$/) || [null, "", l.slice(1).trim()];
        return `<p class="tn-punto">${tema ? `<b>${esc(tema)}</b>` : ""}${esc(resto)}</p>`;
      }
      if (/^ojo:/i.test(l)) return `<p class="tn-ojo">${esc(l)}</p>`;
      return i === 0 ? `<p class="tn-panorama">${esc(l)}</p>` : `<p>${esc(l)}</p>`;
    }).join("");
    $("#tn-resumen-hora").textContent = `Hecho por DELTA ${haceRato(r.hora)}${r.fuentes ? ` con ${r.fuentes} titulares` : ""}`;
  }
  $("#tn-resumen-nuevo").addEventListener("click", async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    b.textContent = "Leyendo noticias…";
    try { pintarResumen(await api("/noticias/resumen", { method: "POST" })); }
    catch (err) { pintarResumen({ error: err.message, texto: resumenTexto || null }); }
    finally { b.disabled = false; b.textContent = "Actualizar"; }
  });
  $("#tn-resumen-oir").addEventListener("click", () => { if (resumenTexto) decir(resumenTexto.replace(/•/g, "")); });

  // ---------- Globo ----------
  const globo = crearGlobo($("#tn-globo"), (p) => { lugarElegido = p.lugar; pintarLugar(); });
  fetch("/datos/mundo.json").then((r) => r.json()).then((m) => globo.mundo(m)).catch(() => {});

  // ---------- Carga y redibujo ----------
  async function cargar() {
    await Promise.allSettled([cargarBolsa(), cargarNoticias()]);
  }

  let espera;
  new ResizeObserver(() => {
    clearTimeout(espera);
    espera = setTimeout(() => {
      if (tablero) pintarBarras(tablero.items.filter((d) => !d.error));
      if (velasActuales) pintarVelas();
    }, 120);
  }).observe($("#tablero"));

  return { cargar };
}

// =======================================================================
//  Globo terráqueo (canvas, proyección ortográfica) con los lugares de las noticias
// =======================================================================
function crearGlobo(canvas, alElegir) {
  const ctx = canvas.getContext("2d");
  const RAD = Math.PI / 180;
  let tierra = [], fronteras = [], puntos = [], elegido = null;
  let lon0 = 95, lat0 = 18; // empieza mirando a México
  let objetivo = null, arrastre = null, ultimoToque = 0, t0 = performance.now();
  let W = 0, H = 0, R = 0, cx = 0, cy = 0, dpr = 1, colores = null, coloresEn = 0;
  const CASA = [19.43, -99.13]; // Ciudad de México: de aquí salen los arcos

  const vec = (lat, lon) => {
    const a = lat * RAD, b = (lon + lon0) * RAD, c = lat0 * RAD;
    const x = Math.cos(a) * Math.sin(b);
    const y0 = Math.sin(a), z0 = Math.cos(a) * Math.cos(b);
    return [x, y0 * Math.cos(c) - z0 * Math.sin(c), y0 * Math.sin(c) + z0 * Math.cos(c)];
  };
  const pantalla = (v, alt = 1) => [cx + v[0] * R * alt, cy - v[1] * R * alt];

  function leerColores() {
    const s = getComputedStyle(document.documentElement);
    const dia = document.documentElement.dataset.mood === "dia";
    colores = {
      dia,
      acento: s.getPropertyValue("--cian").trim() || "#8b73ff",
      rosa: s.getPropertyValue("--dorado").trim() || "#ff9ee8",
      lila: s.getPropertyValue("--lila").trim() || "#c9bfff",
    };
  }

  function medir() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    R = Math.min(W, H) * 0.4; cx = W / 2; cy = H / 2;
  }

  function trazarAnillo(anillo, cerrar) {
    let prev = null;
    ctx.beginPath();
    for (const [lon, lat] of anillo) {
      const v = vec(lat, lon);
      let p;
      if (v[2] >= 0) p = pantalla(v);
      else { const n = Math.hypot(v[0], v[1]) || 1; p = [cx + (v[0] / n) * R, cy - (v[1] / n) * R]; } // al borde
      if (!prev) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
      prev = p;
    }
    if (cerrar) ctx.closePath();
  }

  function lineaVisible(coords) {
    ctx.beginPath();
    let pluma = false;
    for (const [lon, lat] of coords) {
      const v = vec(lat, lon);
      if (v[2] < 0.02) { pluma = false; continue; }
      const p = pantalla(v);
      if (!pluma) { ctx.moveTo(p[0], p[1]); pluma = true; } else ctx.lineTo(p[0], p[1]);
    }
  }

  function dibujar(ahora) {
    if (!canvas.isConnected || canvas.offsetParent === null) return;
    if (ahora - coloresEn > 1000) { leerColores(); coloresEn = ahora; }
    const { dia, acento, rosa } = colores;
    const t = (ahora - t0) / 1000;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Halo de atmósfera
    const halo = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.35);
    halo.addColorStop(0, dia ? "rgba(106,76,240,.28)" : "rgba(139,115,255,.45)");
    halo.addColorStop(1, "rgba(139,115,255,0)");
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.35, 0, 7); ctx.fill();

    // Anillos de órbita (decoración)
    ctx.save();
    ctx.translate(cx, cy);
    for (const [k, inc, vel] of [[1.32, -0.32, 0.15], [1.48, 0.22, -0.1]]) {
      ctx.save();
      ctx.rotate(inc);
      ctx.setLineDash([2, 7]);
      ctx.lineDashOffset = -t * 30 * vel * 10;
      ctx.strokeStyle = dia ? "rgba(82,50,216,.35)" : "rgba(183,166,255,.35)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(0, 0, R * k, R * k * 0.28, 0, 0, 7); ctx.stroke();
      const ang = t * vel * 2;
      ctx.setLineDash([]);
      ctx.fillStyle = rosa;
      ctx.beginPath(); ctx.arc(Math.cos(ang) * R * k, Math.sin(ang) * R * k * 0.28, 2.2, 0, 7); ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    // Océano
    const mar = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
    if (dia) { mar.addColorStop(0, "#ffffff"); mar.addColorStop(0.6, "#e6defe"); mar.addColorStop(1, "#c9bbff"); }
    else { mar.addColorStop(0, "#2a1f6e"); mar.addColorStop(0.65, "#120c38"); mar.addColorStop(1, "#06041a"); }
    ctx.fillStyle = mar;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();

    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.clip();
    // Meridianos y paralelos
    ctx.strokeStyle = dia ? "rgba(82,50,216,.12)" : "rgba(183,166,255,.12)";
    ctx.lineWidth = 0.6;
    for (let lo = -180; lo < 180; lo += 30) { const l = []; for (let la = -90; la <= 90; la += 5) l.push([lo, la]); lineaVisible(l); ctx.stroke(); }
    for (let la = -60; la <= 60; la += 30) { const l = []; for (let lo = -180; lo <= 180; lo += 5) l.push([lo, la]); lineaVisible(l); ctx.stroke(); }
    // Continentes
    ctx.fillStyle = dia ? "rgba(106,76,240,.30)" : "rgba(139,115,255,.30)";
    ctx.strokeStyle = dia ? "rgba(82,50,216,.65)" : "rgba(201,191,255,.7)";
    ctx.lineWidth = 0.8;
    for (const a of tierra) {
      if (!a.some(([lon, lat]) => vec(lat, lon)[2] > 0)) continue;
      trazarAnillo(a, true); ctx.fill();
      lineaVisible(a); ctx.stroke();
    }
    ctx.strokeStyle = dia ? "rgba(82,50,216,.28)" : "rgba(201,191,255,.28)";
    ctx.lineWidth = 0.5;
    for (const f of fronteras) { lineaVisible(f); ctx.stroke(); }
    ctx.restore();

    // Brillo del borde
    const borde = ctx.createRadialGradient(cx, cy, R * 0.82, cx, cy, R);
    borde.addColorStop(0, "rgba(0,0,0,0)");
    borde.addColorStop(1, dia ? "rgba(106,76,240,.35)" : "rgba(139,115,255,.55)");
    ctx.fillStyle = borde;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();

    // Arcos desde México hacia los lugares con más noticias
    ctx.lineWidth = 1.2;
    puntos.slice(0, 8).forEach((p, idx) => {
      if (Math.abs(p.lat - CASA[0]) + Math.abs(p.lon - CASA[1]) < 8) return;
      const a = esfera(CASA[0], CASA[1]), b = esfera(p.lat, p.lon);
      const ang = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
      if (ang < 0.05) return;
      const fase = ((t * 0.35 + idx * 0.17) % 1);
      ctx.strokeStyle = idx % 2 ? acento : rosa;
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      let pluma = false;
      for (let k = 0; k <= 40; k++) {
        const s = k / 40;
        const v = rotar(slerp(a, b, ang, s));
        const alt = 1 + Math.sin(Math.PI * s) * Math.min(0.25, ang * 0.12);
        if (v[2] < 0 && Math.hypot(v[0] * alt, v[1] * alt) < 1) { pluma = false; continue; }
        const q = pantalla(v, alt);
        if (!pluma) { ctx.moveTo(q[0], q[1]); pluma = true; } else ctx.lineTo(q[0], q[1]);
      }
      ctx.stroke();
      // destello que viaja por el arco
      const v = rotar(slerp(a, b, ang, fase));
      const alt = 1 + Math.sin(Math.PI * fase) * Math.min(0.25, ang * 0.12);
      if (!(v[2] < 0 && Math.hypot(v[0] * alt, v[1] * alt) < 1)) {
        const q = pantalla(v, alt);
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.arc(q[0], q[1], 1.8, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
    });

    // Puntos de noticias
    visibles = [];
    const etiquetas = [];
    const maxN = Math.max(1, ...puntos.map((p) => p.noticias.length));
    const orden = elegido ? [elegido, ...puntos.filter((p) => p !== elegido)] : puntos;
    orden.forEach((p) => {
      const idx = puntos.indexOf(p);
      const v = vec(p.lat, p.lon);
      if (v[2] < 0.05) return;
      const [x, y] = pantalla(v);
      const fuerza = p.noticias.length / maxN;
      const r = 2.5 + fuerza * 4;
      const caliente = fuerza > 0.5;
      const color = caliente ? rosa : acento;
      const pulso = (t * 0.8 + idx * 0.13) % 1;
      ctx.globalAlpha = (1 - pulso) * 0.7 * v[2];
      ctx.strokeStyle = color; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(x, y, r + pulso * 14, 0, 7); ctx.stroke();
      ctx.globalAlpha = v[2];
      ctx.shadowColor = color; ctx.shadowBlur = 12;
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(x, y, r * 0.4, 0, 7); ctx.fill();
      if (p === elegido) {
        ctx.strokeStyle = dia ? "#160f36" : "#fff"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, r + 5, 0, 7); ctx.stroke();
      }
      const libre = !etiquetas.some((e) => Math.abs(e[1] - y) < 13 && x < e[0] + e[2] && x + 90 > e[0]);
      if ((idx < 10 && libre) || p === elegido) {
        etiquetas.push([x, y, 14 + p.lugar.length * 7.5]);
        ctx.font = `${p === elegido ? 700 : 600} ${p === elegido ? 12 : 10.5}px Montserrat, system-ui, sans-serif`;
        ctx.fillStyle = dia ? "rgba(22,15,54,.92)" : "rgba(236,235,255,.92)";
        ctx.shadowColor = dia ? "rgba(255,255,255,.9)" : "rgba(0,0,0,.8)"; ctx.shadowBlur = 4;
        ctx.fillText(p.lugar.toUpperCase(), x + r + 5, y + 4);
        ctx.shadowBlur = 0;
      }
      ctx.globalAlpha = 1;
      visibles.push({ p, x, y, r });
    });
  }
  let visibles = [];

  const esfera = (lat, lon) => [Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD), Math.cos(lat * RAD) * Math.cos(lon * RAD)];
  function rotar([x0, y0, z0]) {
    const b = lon0 * RAD, c = lat0 * RAD;
    const x = x0 * Math.cos(b) + z0 * Math.sin(b), z1 = -x0 * Math.sin(b) + z0 * Math.cos(b);
    return [x, y0 * Math.cos(c) - z1 * Math.sin(c), y0 * Math.sin(c) + z1 * Math.cos(c)];
  }
  function slerp(a, b, ang, s) {
    const k1 = Math.sin((1 - s) * ang) / Math.sin(ang), k2 = Math.sin(s * ang) / Math.sin(ang);
    return [a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2];
  }

  let antes = performance.now();
  function cuadro(ahora) {
    const dt = Math.min(0.1, (ahora - antes) / 1000);
    antes = ahora;
    if (canvas.offsetParent !== null) {
      const caja = canvas.getBoundingClientRect();
      if (canvas.width === 0 || Math.abs(caja.width - W) > 1 || Math.abs(caja.height - H) > 1) medir();
      if (objetivo) {
        let d = ((objetivo[1] - lon0 + 540) % 360) - 180;
        lon0 += d * Math.min(1, dt * 4);
        lat0 += (objetivo[0] - lat0) * Math.min(1, dt * 4);
        if (Math.abs(d) < 0.3 && Math.abs(objetivo[0] - lat0) < 0.3) objetivo = null;
      } else if (!arrastre && !quieto && ahora - ultimoToque > 6000) lon0 -= dt * 5;
      dibujar(ahora);
    }
    requestAnimationFrame(cuadro);
  }
  requestAnimationFrame(cuadro);

  canvas.addEventListener("pointerdown", (e) => {
    arrastre = { x: e.clientX, y: e.clientY, lon: lon0, lat: lat0, movio: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!arrastre) {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      canvas.style.cursor = visibles.some((v) => Math.hypot(v.x - x, v.y - y) < v.r + 8) ? "pointer" : "grab";
      return;
    }
    const dx = e.clientX - arrastre.x, dy = e.clientY - arrastre.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) arrastre.movio = true;
    objetivo = null;
    lon0 = arrastre.lon + dx * 0.35;
    lat0 = Math.max(-60, Math.min(60, arrastre.lat + dy * 0.35));
    ultimoToque = performance.now();
  });
  canvas.addEventListener("pointerup", (e) => {
    const a = arrastre;
    arrastre = null;
    ultimoToque = performance.now();
    if (a?.movio) return;
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const cerca = visibles.map((v) => ({ ...v, d: Math.hypot(v.x - x, v.y - y) })).filter((v) => v.d < v.r + 12).sort((p, q) => p.d - q.d)[0];
    if (cerca) { elegido = cerca.p; alElegir(cerca.p); }
  });

  return {
    mundo(m) { tierra = (m.tierra || []).filter((a) => Math.min(...a.map((p) => p[1])) > -60); fronteras = m.fronteras || []; },
    puntos(l) { puntos = l || []; },
    elegir(p) { elegido = p || null; },
    mirarA(p) { if (p) { objetivo = [Math.max(-45, Math.min(45, p.lat)), -p.lon]; ultimoToque = performance.now(); } },
  };
}
