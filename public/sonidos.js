// Sonidos de DELTA: tonos cortos y suaves generados en el momento (Web Audio).
// No usan archivos de audio; son originales de DELTA.
let ctx = null;
let maestro = null;

const activos = () => {
  try { return localStorage.getItem("delta_sonidos") !== "0"; } catch { return true; }
};

function contexto() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    maestro = ctx.createGain();
    maestro.gain.value = 0.22;
    // Un poco de eco corto para que suene "de cabina", sin ensuciar.
    const eco = ctx.createDelay();
    eco.delayTime.value = 0.09;
    const retro = ctx.createGain();
    retro.gain.value = 0.22;
    const filtro = ctx.createBiquadFilter();
    filtro.type = "lowpass";
    filtro.frequency.value = 3200;
    maestro.connect(ctx.destination);
    maestro.connect(eco);
    eco.connect(filtro);
    filtro.connect(retro);
    retro.connect(eco);
    retro.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

// Los navegadores solo dejan sonar después de que el usuario toca algo.
const despertar = () => contexto();
["pointerdown", "keydown", "touchstart"].forEach((e) => window.addEventListener(e, despertar, { once: true, passive: true }));

/** Un tono con subida y caída suave. */
function tono(c, { frec, hasta, inicio = 0, dur = 0.12, tipo = "sine", vol = 1 }) {
  const t = c.currentTime + inicio;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = tipo;
  osc.frequency.setValueAtTime(frec, t);
  if (hasta) osc.frequency.exponentialRampToValueAtTime(hasta, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g);
  g.connect(maestro);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

const SONIDOS = {
  // Empieza a escuchar: barrido que sube y un destello.
  escuchar: (c) => {
    tono(c, { frec: 520, hasta: 1040, dur: 0.16, tipo: "triangle", vol: 0.7 });
    tono(c, { frec: 1560, inicio: 0.13, dur: 0.14, vol: 0.35 });
  },
  // Deja de escuchar: barrido que baja.
  fin_escuchar: (c) => tono(c, { frec: 900, hasta: 480, dur: 0.14, tipo: "triangle", vol: 0.5 }),
  // Mensaje enviado: un "blip" corto.
  enviar: (c) => {
    tono(c, { frec: 880, dur: 0.07, tipo: "triangle", vol: 0.55 });
    tono(c, { frec: 1320, inicio: 0.06, dur: 0.09, vol: 0.4 });
  },
  // Llega la respuesta: dos notas suaves que bajan.
  respuesta: (c) => {
    tono(c, { frec: 1174.7, dur: 0.16, vol: 0.45 });
    tono(c, { frec: 880, inicio: 0.09, dur: 0.24, vol: 0.4 });
  },
  // Acción hecha (cita, tarea, recordatorio, archivo leído): acorde que sube.
  accion: (c) => {
    [659.3, 830.6, 987.8, 1318.5].forEach((f, i) => tono(c, { frec: f, inicio: i * 0.06, dur: 0.22, tipo: i % 2 ? "sine" : "triangle", vol: 0.42 }));
  },
  // Archivo listo para enviar: chasquido breve.
  archivo: (c) => {
    tono(c, { frec: 1400, hasta: 2100, dur: 0.06, tipo: "triangle", vol: 0.4 });
  },
  // Aviso o recordatorio: dos pulsos claros, repetidos.
  aviso: (c) => {
    for (let i = 0; i < 2; i++) {
      tono(c, { frec: 1318.5, inicio: i * 0.32, dur: 0.12, tipo: "triangle", vol: 0.6 });
      tono(c, { frec: 1760, inicio: i * 0.32 + 0.11, dur: 0.16, vol: 0.5 });
    }
  },
  // Arranque de DELTA: un grave que crece, un barrido que sube, destellos y un acorde de impacto.
  arranque: (c) => {
    tono(c, { frec: 45, hasta: 98, dur: 1.5, vol: 0.9 });
    tono(c, { frec: 160, hasta: 1500, dur: 1.15, tipo: "triangle", vol: 0.22 });
    tono(c, { frec: 240, hasta: 2200, inicio: 0.15, dur: 1.0, tipo: "sawtooth", vol: 0.05 });
    [1318.5, 1568, 1975.5, 2637].forEach((f, i) => tono(c, { frec: f, inicio: 0.6 + i * 0.07, dur: 0.45, vol: 0.16 }));
    [130.8, 196, 261.6, 329.6, 392, 523.3, 784].forEach((f, i) => tono(c, { frec: f, inicio: 1.12, dur: 2.6, tipo: i % 2 ? "sine" : "triangle", vol: 0.26 }));
    tono(c, { frec: 65.4, inicio: 1.12, dur: 2.8, vol: 1 });
    tono(c, { frec: 3136, inicio: 1.12, dur: 0.9, vol: 0.08 });
  },
  // Algo falló: tono grave corto.
  error: (c) => {
    tono(c, { frec: 330, hasta: 220, dur: 0.22, tipo: "sawtooth", vol: 0.18 });
    tono(c, { frec: 220, inicio: 0.02, dur: 0.22, vol: 0.4 });
  },
};

/** Toca un sonido por nombre, si están activados. */
export function sonar(nombre, { forzar = false } = {}) {
  if (!forzar && !activos()) return;
  const c = contexto();
  if (!c || !SONIDOS[nombre]) return;
  try { SONIDOS[nombre](c); } catch { /* sin sonido, sin problema */ }
}

export function sonidosActivos() { return activos(); }
export function activarSonidos(si) {
  try { localStorage.setItem("delta_sonidos", si ? "1" : "0"); } catch {}
}
