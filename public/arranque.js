// DELTA — Arranque cinematográfico al abrir la app.
// Espera: polvo de estrellas que gira alrededor del logo y se acerca al cursor o al dedo.
// Al iniciar: las partículas se juntan en un anillo, se dibujan los anillos del HUD,
// estalla una onda de luz, aparece el logo, el nombre se "descifra", la lista de sistemas
// se enciende y DELTA da la bienvenida. Al final la cámara "entra" al orbe.
// Se puede saltar con el botón, con Esc o tocando "Saltar"; nada queda a medias.

const reducir = matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = (s, raiz = document) => raiz.querySelector(s);
const facil = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3); // salida suave
const entre = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));

export function crearArranque(el) {
  const lienzo = $("#arr-lienzo", el);
  const ctx = lienzo.getContext("2d");
  let W = 0, H = 0, dpr = 1, centro = [0, 0], R = 100;
  let modo = "espera"; // espera | animando | fin
  let t0 = 0, dur = 4300, cuadro = 0;
  let puntero = null, golpe = 0;
  let parts = [];

  function medir() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    lienzo.width = W * dpr; lienzo.height = H * dpr;
    const logo = $(".arr-logo", el).getBoundingClientRect();
    centro = logo.width ? [logo.left + logo.width / 2, logo.top + logo.height / 2] : [W / 2, H * 0.42];
    R = Math.max(70, Math.min(W, H) * 0.2);
    if (!parts.length) {
      const n = Math.round(Math.min(700, (W * H) / 2600));
      parts = Array.from({ length: n }, () => {
        const a = Math.random() * Math.PI * 2, d = R * (1.3 + Math.random() * 3.2);
        return {
          x: centro[0] + Math.cos(a) * d, y: centro[1] + Math.sin(a) * d * 0.8,
          vx: 0, vy: 0,
          anillo: 0.9 + Math.random() * 0.55, // radio final en el anillo (x R)
          ang: Math.random() * Math.PI * 2,
          vel: (0.15 + Math.random() * 0.5) * (Math.random() < 0.5 ? -1 : 1),
          r: Math.random() * 1.4 + 0.4, fase: Math.random() * 6,
          rosa: Math.random() < 0.18,
        };
      });
    }
  }

  function anillosHud(t, p, energia) {
    const [cx, cy] = centro;
    ctx.lineCap = "round";
    // Anillo fino con marcas tipo instrumento
    const marcas = 120, visibles = Math.floor(marcas * facil(p));
    for (let k = 0; k < visibles; k++) {
      const a = (k / marcas) * Math.PI * 2 - Math.PI / 2 + t * 0.00005;
      const largo = k % 10 ? 5 : 12;
      ctx.strokeStyle = `rgba(183,166,255,${k % 10 ? 0.22 : 0.55})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * R * 1.62, cy + Math.sin(a) * R * 1.62);
      ctx.lineTo(cx + Math.cos(a) * (R * 1.62 + largo), cy + Math.sin(a) * (R * 1.62 + largo));
      ctx.stroke();
    }
    // Arcos que se dibujan y giran en sentidos contrarios
    [[1.42, 0.0006, 0.62, 1.6], [1.3, -0.0009, 0.38, 1.1], [1.18, 0.0013, 0.22, 2.2], [1.52, -0.0004, 0.12, 1]].forEach(([rad, v, largo, grosor], i) => {
      const q = facil(entre(p, i * 0.12, 0.7 + i * 0.1));
      if (!q) return;
      const g = t * v * (1 + energia * 2);
      ctx.strokeStyle = i % 2 ? `rgba(255,158,232,${0.35 + 0.4 * energia})` : `rgba(183,166,255,${0.45 + 0.4 * energia})`;
      ctx.lineWidth = grosor;
      ctx.shadowColor = "rgba(139,115,255,.9)";
      ctx.shadowBlur = 10 + 14 * energia;
      for (let k = 0; k < 2; k++) {
        ctx.beginPath();
        ctx.arc(cx, cy, R * rad, g + k * Math.PI, g + k * Math.PI + largo * Math.PI * q);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
    });
    // Círculo de cristal
    const q = facil(entre(p, 0.3, 1));
    if (q) {
      const cristal = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R * 1.02);
      cristal.addColorStop(0, `rgba(201,191,255,${0.14 * q})`);
      cristal.addColorStop(0.6, `rgba(60,40,150,${0.16 * q})`);
      cristal.addColorStop(0.92, `rgba(139,115,255,${(0.22 + 0.2 * energia) * q})`);
      cristal.addColorStop(1, "rgba(139,115,255,0)");
      ctx.fillStyle = cristal;
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.02, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(233,230,255,${0.25 * q})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, R * 1.02, 0, Math.PI * 2); ctx.stroke();
    }
  }

  function dibujar(ahora) {
    if (modo === "fin") return;
    cuadro = requestAnimationFrame(dibujar);
    const t = ahora;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const [cx, cy] = centro;
    golpe *= 0.94;

    if (modo === "espera") {
      // Anillo que respira y polvo que gira; el cursor atrae y hace remolino
      const resp = 0.5 + 0.5 * Math.sin(t / 900);
      ctx.strokeStyle = `rgba(183,166,255,${0.12 + 0.12 * resp + 0.3 * golpe})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, R * (1.05 + 0.03 * resp), 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = `rgba(255,158,232,${0.08 + 0.08 * (1 - resp)})`;
      ctx.beginPath(); ctx.arc(cx, cy, R * (1.4 - 0.03 * resp), 0, Math.PI * 2); ctx.stroke();
      for (const p of parts) {
        const dx = p.x - cx, dy = p.y - cy, d = Math.hypot(dx, dy) || 1;
        // órbita lenta alrededor del centro
        p.vx += (-dy / d) * 0.012 * Math.sign(p.vel);
        p.vy += (dx / d) * 0.012 * Math.sign(p.vel);
        // se mantienen a distancia del logo
        const ideal = R * (1.4 + p.anillo * 1.6);
        p.vx -= (dx / d) * (d - ideal) * 0.00025;
        p.vy -= (dy / d) * (d - ideal) * 0.00025;
        if (puntero) {
          const ex = puntero[0] - p.x, ey = puntero[1] - p.y, e = Math.hypot(ex, ey);
          if (e < 180) { const f = (1 - e / 180) * 0.09; p.vx += ex / e * f - ey / e * f * 0.8; p.vy += ey / e * f + ex / e * f * 0.8; }
        }
        p.vx *= 0.96; p.vy *= 0.96;
        p.x += p.vx; p.y += p.vy;
        const brillo = 0.35 + 0.55 * Math.abs(Math.sin(t / 1100 + p.fase));
        ctx.fillStyle = p.rosa ? `rgba(255,158,232,${brillo})` : `rgba(220,212,255,${brillo})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
      return;
    }

    // ----- Animando -----
    const s = (t - t0) / dur; // 0 a 1
    const ms = s * 4300; // línea de tiempo pensada para 4.3 s
    const junta = facil(entre(ms, 0, 1100)); // partículas al anillo
    const estallido = entre(ms, 1100, 2000);
    const energia = Math.max(golpe, ms > 1100 && ms < 1500 ? 1 - entre(ms, 1100, 1500) : 0, ms > 1900 && ms < 3200 ? 0.35 + 0.25 * Math.abs(Math.sin(ms / 110)) : 0);

    // Resplandor central
    const halo = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 3.4);
    halo.addColorStop(0, `rgba(139,115,255,${0.08 + 0.32 * junta + 0.25 * energia})`);
    halo.addColorStop(0.45, `rgba(123,92,255,${0.05 + 0.08 * junta})`);
    halo.addColorStop(0.8, `rgba(255,158,232,${0.02 + 0.03 * junta})`);
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, H);

    anillosHud(t, entre(ms, 300, 1500), energia);

    // Partículas: espiral hacia el anillo y luego órbita
    for (const p of parts) {
      p.ang += p.vel * 0.004 * (1 + 3 * (1 - junta)) * (1 + energia * 2);
      const tx = cx + Math.cos(p.ang) * R * p.anillo * (1 + 0.04 * energia), ty = cy + Math.sin(p.ang) * R * p.anillo * (1 + 0.04 * energia);
      const k = 0.02 + 0.2 * junta;
      p.x += (tx - p.x) * k; p.y += (ty - p.y) * k;
      // En el estallido algunas salen disparadas
      let ox = 0, oy = 0;
      if (estallido > 0 && estallido < 1 && p.r > 1.3) { const e = facil(estallido) * R * 1.8 * (1 - estallido); ox = Math.cos(p.ang) * e; oy = Math.sin(p.ang) * e; }
      const brillo = 0.4 + 0.6 * Math.abs(Math.sin(t / 700 + p.fase));
      ctx.fillStyle = p.rosa ? `rgba(255,158,232,${brillo})` : `rgba(233,230,255,${brillo})`;
      ctx.beginPath(); ctx.arc(p.x + ox, p.y + oy, p.r * (1 + energia * 0.6), 0, Math.PI * 2); ctx.fill();
    }

    // Onda de choque y destello cuando "se enciende"
    if (estallido > 0 && estallido < 1) {
      const re = R * (1 + facil(estallido) * 9);
      ctx.strokeStyle = `rgba(220,206,255,${0.7 * (1 - estallido)})`;
      ctx.lineWidth = 2 + 6 * (1 - estallido);
      ctx.shadowColor = "rgba(255,158,232,.9)"; ctx.shadowBlur = 30;
      ctx.beginPath(); ctx.arc(cx, cy, re, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(255,158,232,${0.5 * (1 - estallido)})`;
      ctx.beginPath(); ctx.arc(cx, cy, re * 0.82, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
      if (estallido < 0.18) {
        // Destello breve desde el centro (no toda la pantalla)
        const f = 1 - estallido / 0.18;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.6);
        g.addColorStop(0, `rgba(240,236,255,${0.55 * f})`);
        g.addColorStop(0.3, `rgba(183,166,255,${0.18 * f})`);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
    }

    // Línea de escaneo que baja una vez
    const esc = entre(ms, 200, 1300);
    if (esc > 0 && esc < 1) {
      const y = H * esc;
      const g = ctx.createLinearGradient(0, y - 60, 0, y + 2);
      g.addColorStop(0, "rgba(139,115,255,0)");
      g.addColorStop(1, "rgba(183,166,255,.22)");
      ctx.fillStyle = g;
      ctx.fillRect(0, y - 60, W, 62);
      ctx.fillStyle = "rgba(233,230,255,.55)";
      ctx.fillRect(0, y, W, 1);
    }
  }

  // ---- Textos: nombre que se descifra, sistemas, saludo y porcentaje ----
  const SIGNOS = "ΔΛΣΞ01#%&*+<>/\\=";
  function descifrar(nodo, final, inicio, largo) {
    const letras = [...final];
    const paso = (ahora) => {
      if (modo === "fin") return;
      const q = (ahora - inicio) / largo;
      if (q < 0) return requestAnimationFrame(paso);
      nodo.textContent = letras.map((c, i) => (q > (i + 1) / letras.length ? c : c === " " ? " " : SIGNOS[Math.floor(Math.random() * SIGNOS.length)])).join("");
      if (q < 1) requestAnimationFrame(paso);
      else nodo.textContent = final;
    };
    requestAnimationFrame(paso);
  }
  function contarHasta(nodo, inicio, largo) {
    const paso = (ahora) => {
      if (modo === "fin") return;
      const q = entre(ahora, inicio, inicio + largo);
      nodo.textContent = `${Math.round(facil(q) * 100)}%`;
      if (q < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  }

  // ---- Interacción ----
  const mover = (e) => {
    puntero = [e.clientX, e.clientY];
    // Paralaje: el conjunto se inclina un poco hacia el cursor
    if (!reducir) {
      const x = (e.clientX / W - 0.5), y = (e.clientY / H - 0.5);
      el.style.setProperty("--px", `${(x * 14).toFixed(1)}px`);
      el.style.setProperty("--py", `${(y * 10).toFixed(1)}px`);
    }
  };
  const tocar = (e) => {
    golpe = 1;
    if (reducir) return;
    const o = document.createElement("span");
    o.className = "arr-onda";
    o.style.left = `${e.clientX}px`;
    o.style.top = `${e.clientY}px`;
    el.appendChild(o);
    setTimeout(() => o.remove(), 1200);
    // Las partículas cercanas salen empujadas
    for (const p of parts) {
      const dx = p.x - e.clientX, dy = p.y - e.clientY, d = Math.hypot(dx, dy) || 1;
      if (d < 220) { p.vx += dx / d * (1 - d / 220) * 9; p.vy += dy / d * (1 - d / 220) * 9; }
    }
  };
  const salir = () => { puntero = null; };

  return {
    esperar() {
      modo = "espera";
      medir();
      addEventListener("resize", medir);
      el.addEventListener("pointermove", mover);
      el.addEventListener("pointerdown", tocar);
      el.addEventListener("pointerleave", salir);
      if (!reducir) cuadro = requestAnimationFrame(dibujar);
    },
    // datos: { saludo, linea, sistemas: [texto] }; duracion en ms
    animar({ saludo, linea, sistemas = [] }, duracion) {
      dur = duracion;
      medir();
      const k = duracion / 4300; // todo se acomoda si la intro es más corta (sin sonido)
      const ahora = performance.now();
      t0 = ahora;
      modo = "animando";
      el.style.setProperty("--k", k.toFixed(3));
      $(".arr-saludo b", el).textContent = saludo;
      $(".arr-saludo span", el).textContent = linea;
      $(".arr-sistemas", el).innerHTML = sistemas.map((s, i) => `<li style="--i:${i}"><i></i>${s.replace(/[&<>"']/g, "")}<b>OK</b></li>`).join("");
      if (!reducir) {
        descifrar($(".arr-nombre", el), "DELTA", ahora + 1150 * k, 750 * k);
        contarHasta($(".arr-cifra", el), ahora + 300 * k, 1700 * k);
        cancelAnimationFrame(cuadro);
        cuadro = requestAnimationFrame(dibujar);
      } else {
        $(".arr-cifra", el).textContent = "100%";
      }
    },
    terminar() {
      modo = "fin";
      cancelAnimationFrame(cuadro);
      removeEventListener("resize", medir);
      el.removeEventListener("pointermove", mover);
      el.removeEventListener("pointerdown", tocar);
      el.removeEventListener("pointerleave", salir);
      setTimeout(() => { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, lienzo.width, lienzo.height); parts = []; }, 800);
    },
    pulso() { golpe = 1; },
  };
}
