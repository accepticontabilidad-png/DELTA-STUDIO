// Tableros de la agencia: "Panel general" (todo de un vistazo) y "Cuentas" (una ficha por cliente
// con su semáforo de salud). Mismo estilo que el tablero de Mercados y noticias; todo se dibuja aquí
// (SVG y HTML), sin librerías de afuera. Los datos salen de la base de DELTA y se editan aquí mismo.

const $ = (s) => document.querySelector(s);
const SALUD_TXT = { verde: "Verde", amarillo: "Amarillo", rojo: "Rojo" };
const SALUD_FRASE = { verde: "Todo en orden", amarillo: "Hay que echarle ojo", rojo: "Necesita atención hoy" };
const PLATAFORMA = { meta: "Meta", google: "Google", tiktok: "TikTok", otra: "Otra" };
const ESTADO_CL = { activo: "Activo", prospecto: "Prospecto", pausado: "Pausado", terminado: "Terminado" };
const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export function iniciarAgencia(h) {
  const { api, esc, guardado, fmtDia, fmtHora, dinero, ESTADO_PROY, filaTrabajo, sonar, avisar } = h;
  const pct = (g, t) => (t ? Math.round((g / t) * 100) : null);
  const nivelGasto = (p) => (p === null ? "" : p > 100 ? "rojo" : p >= 85 ? "amarillo" : "verde");
  const nombreMes = (m) => { const [a, n] = m.split("-"); return `${MESES[Number(n) - 1]} ${a}`; };
  const diaNum = (iso) => new Intl.DateTimeFormat("es-MX", { timeZone: h.zona(), day: "numeric" }).format(new Date(iso));
  const mesCorto = (iso) => new Intl.DateTimeFormat("es-MX", { timeZone: h.zona(), month: "short" }).format(new Date(iso)).replace(".", "");
  const haceRato = (iso) => {
    if (!iso) return "";
    const m = Math.round((Date.now() - new Date(iso)) / 60e3);
    if (m < 60) return `hace ${Math.max(1, m)} min`;
    const hrs = Math.round(m / 60);
    return hrs < 24 ? `hace ${hrs} h` : `hace ${Math.round(hrs / 24)} d`;
  };
  // La política de seguridad no deja usar style="" en el HTML: las medidas van en data-* y se aplican aquí.
  const medidas = (raiz) => {
    raiz.querySelectorAll("[data-ancho]").forEach((x) => { x.style.width = `${x.dataset.ancho}%`; });
    raiz.querySelectorAll("[data-flex]").forEach((x) => { x.style.flex = x.dataset.flex; });
    raiz.querySelectorAll("[data-alto]").forEach((x) => { x.style.height = `${x.dataset.alto}%`; });
    raiz.querySelectorAll("[data-abajo]").forEach((x) => { x.style.bottom = `${x.dataset.abajo}px`; });
  };
  const vacio = (txt) => `<li class="pg-vacio">${txt}</li>`;
  const compacto = new Intl.NumberFormat("es-MX", { notation: "compact", maximumFractionDigits: 1 });
  const cifra = (n) => (n === null || n === undefined ? "–" : compacto.format(n));
  const conSigno = (n) => (n ? `${n > 0 ? "+" : "−"}${compacto.format(Math.abs(n))}` : "");
  const foco = (n) => `<i class="foco ${n}" aria-hidden="true"></i>`;
  // Delta Score: chip con el número y anillo con el desglose
  const scoreChip = (sc) => (sc ? `<span class="sc-chip c-${sc.color}" title="Delta Score: ${sc.puntos} · ${esc(sc.nivel_nombre)}">${sc.puntos}</span>` : "");
  const anillo = (sc, r = 44) => {
    const C = 2 * Math.PI * r, w = r * 2 + 16;
    return `<svg viewBox="0 0 ${w} ${w}" class="sc-anillo c-${sc.color}" aria-hidden="true">
      <circle cx="${w / 2}" cy="${w / 2}" r="${r}" class="sc-fondo"/>
      <circle cx="${w / 2}" cy="${w / 2}" r="${r}" class="sc-arco" stroke-dasharray="${(C * sc.puntos) / 100} ${C}" transform="rotate(-90 ${w / 2} ${w / 2})"/>
      <text x="${w / 2}" y="${w / 2 + 2}" class="sc-num">${sc.puntos}</text><text x="${w / 2}" y="${w / 2 + 20}" class="sc-de">de 100</text>
    </svg>`;
  };
  const SIN_DATOS = { entregas: "Entregas (agrega sus entregas)", pagos: "Pagos (anota su pago mensual)", anuncios: "Anuncios (pon su tope o anota su gasto)", redes: "Redes (asígnale su Facebook o Instagram en Meta)" };
  function panelScore(sc) {
    return `<div class="panel sc-panel">
      <div class="ag-cabeza"><h2>Delta Score</h2><span class="tb-hora">Qué tan bien va la cuenta, de 0 a 100</span></div>
      <div class="sc-cuerpo">
        <div class="sc-izq">${anillo(sc)}<b class="t-${sc.color}">${esc(sc.nivel_nombre)}</b></div>
        <div class="sc-partes">
          ${sc.partes.map((p) => `<div class="sc-parte">
            <span class="sc-p-nombre">${esc(p.nombre)}</span>
            <span class="pg-barra ${p.pct >= 80 ? "verde" : p.pct >= 50 ? "amarillo" : "rojo"}"><i data-ancho="${Math.max(3, p.pct)}"></i></span>
            <span class="sc-p-pts">${p.pts}<small>/${p.max}</small></span>
            <small class="sc-p-nota">${esc(p.nota)}</small>
          </div>`).join("")}
          ${sc.limitado_por_semaforo ? `<p class="tenue chico">Tope de ${sc.limitado_por_semaforo === "rojo" ? 49 : 64} porque el semáforo está en ${sc.limitado_por_semaforo}.</p>` : ""}
          ${sc.sin_datos.length ? `<p class="tenue chico sc-falta">Todavía no cuenta: ${sc.sin_datos.map((k) => esc(SIN_DATOS[k])).join(" · ")}.</p>` : ""}
        </div>
      </div>
    </div>`;
  }

  // Dona de tres colores (verde, amarillo, rojo)
  function dona(partes, centro, sub) {
    const total = partes.reduce((s, p) => s + p.n, 0);
    const R = 52, C = 2 * Math.PI * R;
    let ini = 0;
    const arcos = total ? partes.filter((p) => p.n).map((p) => {
      const largo = (p.n / total) * C;
      const s = `<circle r="${R}" cx="70" cy="70" class="d-arco s-${p.clase}" stroke-dasharray="${Math.max(0, largo - (partes.filter((x) => x.n).length > 1 ? 3 : 0))} ${C}" stroke-dashoffset="${-ini}"/>`;
      ini += largo;
      return s;
    }).join("") : "";
    return `<svg viewBox="0 0 140 140" class="dona" aria-hidden="true">
      <circle r="${R}" cx="70" cy="70" class="d-fondo"/>
      <g transform="rotate(-90 70 70)">${arcos}</g>
      <text x="70" y="68" class="d-num">${esc(centro)}</text><text x="70" y="86" class="d-sub">${esc(sub)}</text>
    </svg>`;
  }

  // Barra de avance (gasto contra tope)
  const barra = (g, t) => {
    const p = pct(g, t);
    if (p === null) return "";
    return `<span class="pg-barra ${nivelGasto(p)}"><i data-ancho="${Math.min(100, p)}"></i></span>`;
  };

  // =====================================================================
  //  PANEL GENERAL
  // =====================================================================
  async function cargarPanelGeneral() {
    const [t, cuentas, pulso] = await Promise.all([api("/agencia"), api("/cuentas"), api("/pulso")]);
    pintarPulso(pulso);
    const urgentes = t.alertas.filter((a) => a.nivel === "rojo").length;
    const pGasto = pct(t.gasto_anuncios_mes, t.tope_anuncios);
    const activos = t.salud.verde + t.salud.amarillo + t.salud.rojo;

    $("#pg-hora").textContent = `Actualizado ${fmtHora(new Date().toISOString())}`;
    $("#pg-kpis").innerHTML = [
      { href: "#/cuentas", nombre: "Clientes activos", valor: t.clientes_activos, extra: t.prospectos ? `${t.prospectos} prospecto${t.prospectos === 1 ? "" : "s"} en camino` : "Cartera de la agencia",
        pie: activos ? `<span class="pg-tira">${["verde", "amarillo", "rojo"].map((k) => t.salud[k] ? `<i class="s-${k}" data-flex="${t.salud[k]}"></i>` : "").join("")}</span>` : "" },
      { href: "#/aprobaciones", nombre: "Por aprobar", valor: t.aprobaciones_pendientes, extra: t.aprobacion_mas_vieja ? `La más antigua, ${haceRato(t.aprobacion_mas_vieja)}` : "Nada esperando tu sí",
        chip: t.aprobaciones_pendientes ? ["amarillo", "Pendiente"] : ["verde", "Al día"] },
      { href: "#/cuentas", nombre: "Anuncios del mes", valor: dinero(t.gasto_anuncios_mes) === "–" ? "$0" : dinero(t.gasto_anuncios_mes), extra: t.tope_anuncios ? `de ${dinero(t.tope_anuncios)} de tope` : "Sin tope definido",
        chip: pGasto !== null ? [nivelGasto(pGasto), `${pGasto} %`] : null, pie: barra(t.gasto_anuncios_mes, t.tope_anuncios) },
      { bajar: "#pg-alertas", nombre: "Alertas de hoy", valor: t.alertas.length, extra: urgentes ? `${urgentes} urgente${urgentes === 1 ? "" : "s"}` : t.alertas.length ? "Nada urgente" : "Día tranquilo",
        chip: urgentes ? ["rojo", "Atender"] : t.alertas.length ? ["amarillo", "Revisar"] : ["verde", "Todo bien"] },
      { href: "#/finanzas", nombre: "Ingreso mensual", valor: dinero(t.presupuesto_mensual) === "–" ? "$0" : dinero(t.presupuesto_mensual), extra: "Ver finanzas de la agencia" },
    ].map((k) => `<${k.href ? `a href="${k.href}"` : `button type="button" data-bajar="${k.bajar}"`} class="tb-kpi pg-kpi">
        <span class="tb-kpi-nombre">${esc(k.nombre)}</span>
        <b>${esc(k.valor)}</b>
        ${k.chip ? `<span class="tb-chip s-${k.chip[0]}">${esc(k.chip[1])}</span>` : ""}
        <span class="tb-kpi-mes">${esc(k.extra)}</span>
        <span class="pg-kpi-pie">${k.pie || ""}</span>
      </${k.href ? "a" : "button"}>`).join("");

    // Alertas
    $("#pg-alertas-n").textContent = t.alertas.length ? `${t.alertas.length} en total` : "";
    $("#pg-alertas").innerHTML = t.alertas.length
      ? t.alertas.slice(0, 12).map((a) => `<li class="pg-alerta n-${a.nivel}" ${a.cliente_id ? `data-cuenta="${a.cliente_id}" tabindex="0"` : a.tipo === "aprobacion" ? `data-ir-a="#/aprobaciones" tabindex="0"` : ""}>
          ${foco(a.nivel === "info" ? "info" : a.nivel)}
          <span class="pg-alerta-txt"><b>${esc(a.texto)}</b><small>${[a.cliente, a.cuando ? `${fmtDia(a.cuando)} ${a.tipo === "junta" ? fmtHora(a.cuando) : ""}` : ""].filter((x) => x && x.trim()).map(esc).join(" · ")}</small></span>
        </li>`).join("")
      : vacio("Sin alertas por hoy. Todo marcha bien ✨");

    // Salud de la cartera
    $("#pg-salud").innerHTML = `${dona([{ n: t.salud.verde, clase: "verde" }, { n: t.salud.amarillo, clase: "amarillo" }, { n: t.salud.rojo, clase: "rojo" }], `${t.salud.verde}/${activos}`, "en verde")}
      <div class="dona-info">
        <b class="t-${t.salud.rojo ? "rojo" : t.salud.amarillo ? "amarillo" : "verde"}">${activos ? (t.salud.rojo ? "Hay clientes en rojo" : t.salud.amarillo ? "Cartera estable" : "Cartera sana") : "Sin clientes activos"}</b>
        <span>${foco("verde")}${t.salud.verde} en verde</span><span>${foco("amarillo")}${t.salud.amarillo} en amarillo</span><span>${foco("rojo")}${t.salud.rojo} en rojo</span>
      </div>`;
    $("#pg-score").innerHTML = t.score_promedio !== null
      ? `<span>Delta Score promedio</span><b class="t-${t.score_promedio >= 65 ? "verde" : t.score_promedio >= 50 ? "amarillo" : "rojo"}">${t.score_promedio}</b><small class="tenue">de 100</small>`
      : "";
    const conOjo = t.score_clientes.filter((c) => c.puntos < 80).slice(0, 5);
    $("#pg-semaforo").innerHTML = conOjo.length
      ? conOjo.map((c) => `<li data-cuenta="${c.id}" tabindex="0">${scoreChip(c)}<span><b>${esc(c.nombre)}</b><small>${esc(c.nivel_nombre)} · ${esc(c.resumen)}</small></span></li>`).join("")
      : activos ? `<li class="pg-vacio">Todos tus clientes activos tienen 80 o más. Excelente ✨</li>` : `<li class="pg-vacio">Da de alta tu primer cliente en Cuentas.</li>`;

    // Gasto por cliente
    $("#pg-mes").textContent = nombreMes(t.mes);
    $("#pg-gasto").innerHTML = t.gasto_por_cliente.length
      ? t.gasto_por_cliente.slice(0, 8).map((c) => {
          const p = pct(c.gasto, c.tope);
          return `<div class="pg-gasto-fila" data-cuenta="${c.id}" tabindex="0">
            <span class="pg-gasto-nombre">${esc(c.nombre)}</span>
            <span class="pg-gasto-monto"><b>${dinero(c.gasto) === "–" ? "$0" : dinero(c.gasto)}</b>${c.tope ? ` <small>/ ${dinero(c.tope)}</small>` : ""}</span>
            ${c.tope ? barra(c.gasto, c.tope) : `<span class="pg-barra sin"><i data-ancho="100"></i></span>`}
            ${p !== null ? `<span class="pg-gasto-pct t-${nivelGasto(p)}">${p} %</span>` : `<span class="pg-gasto-pct tenue">sin tope</span>`}
          </div>`;
        }).join("")
      : `<p class="pg-vacio">Aún no hay gasto anotado este mes. Anótalo en la ficha de cada cliente.</p>`;
    const totalPlat = t.gasto_por_plataforma.reduce((s, p) => s + p.monto, 0);
    $("#pg-plataformas").innerHTML = totalPlat
      ? `<span class="pg-plat-barra">${t.gasto_por_plataforma.map((p) => `<i class="pl-${p.plataforma}" data-flex="${p.monto}" title="${esc(PLATAFORMA[p.plataforma])}"></i>`).join("")}</span>
         <span class="pg-plat-ley">${t.gasto_por_plataforma.map((p) => `<span><i class="pt pl-${p.plataforma}"></i>${esc(PLATAFORMA[p.plataforma])} ${Math.round((p.monto / totalPlat) * 100)} %</span>`).join("")}</span>`
      : "";

    // Entregas
    const ahora = new Date().toISOString();
    const en2 = new Date(Date.now() + 2 * 864e5).toISOString();
    $("#pg-entregas").innerHTML = t.proximas_entregas.length
      ? t.proximas_entregas.slice(0, 7).map((p) => {
          const n = !p.entrega ? "" : p.entrega < ahora ? "rojo" : p.entrega <= en2 ? "amarillo" : "";
          return `<li class="${n ? "n-" + n : ""}" ${p.cliente_id ? `data-cuenta="${p.cliente_id}" tabindex="0"` : ""}>
            <span class="pg-fecha">${p.entrega ? `<b>${diaNum(p.entrega)}</b><small>${mesCorto(p.entrega)}</small>` : `<b>–</b><small>sin fecha</small>`}</span>
            <span class="pg-linea-txt"><b>${esc(p.titulo)}</b><small>${[p.cliente, ESTADO_PROY[p.estado], n === "rojo" ? "atrasada" : p.entrega ? fmtDia(p.entrega) : ""].filter(Boolean).map(esc).join(" · ")}</small></span>
          </li>`;
        }).join("")
      : vacio("Sin entregas abiertas.");

    // Juntas
    $("#pg-juntas").innerHTML = t.juntas.length
      ? t.juntas.map((j) => `<li ${j.cliente_id ? `data-cuenta="${j.cliente_id}" tabindex="0"` : ""}>
          <span class="pg-fecha"><b>${diaNum(j.inicio)}</b><small>${mesCorto(j.inicio)}</small></span>
          <span class="pg-linea-txt"><b>${esc(j.titulo)}</b><small>${[fmtDia(j.inicio) + " " + fmtHora(j.inicio), j.cliente, j.lugar].filter(Boolean).map(esc).join(" · ")}</small></span>
        </li>`).join("")
      : vacio("No hay juntas con clientes en los próximos 7 días. Agéndalas desde la ficha de cada cuenta.");

    medidas($('[data-seccion="agencia"]'));
    $("#ag-actividad").innerHTML = t.actividad.length ? t.actividad.slice(0, 6).map(filaTrabajo).join("") : vacio("Los departamentos aún no han trabajado. Encárgueles algo en Departamentos.");
  }


  // ---------- Delta Pulse: lo que necesita atención hoy ----------
  let pulsoAbierto = false;
  function pintarPulso(p) {
    const caja = $("#pg-pulso");
    const nivel = p.urgentes ? "rojo" : p.total ? "amarillo" : "verde";
    const frase = p.urgentes ? `${p.urgentes} cosa${p.urgentes === 1 ? "" : "s"} urgente${p.urgentes === 1 ? "" : "s"} hoy`
      : p.total ? "Nada urgente, pero hay pendientes" : "Todo en orden por hoy";
    caja.className = `panel pg-pulso n-${nivel}`;
    caja.innerHTML = `
      <div class="pu-cabeza">
        <span class="pu-icono" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2.5-6 4 12 2.5-6H21"/></svg></span>
        <span class="pu-titulo"><b>Delta Pulse</b><small>¿Qué necesita mi atención hoy?</small></span>
        <span class="pu-estado t-${nivel}">${foco(nivel)}${esc(frase)}</span>
        <button type="button" class="tb-link" data-pedir="¿Qué necesita mi atención hoy en la agencia? Revisa el pulso y dime por dónde empiezo.">Por dónde empiezo</button>
      </div>
      ${p.items.length ? `<div class="pu-items ${pulsoAbierto ? "" : "corto"}">${p.items.map((x) => `<button type="button" class="pu-item n-${x.nivel}" data-ir-a="${esc(x.ir)}">
          <b class="pu-n t-${x.nivel === "info" ? "info" : x.nivel}">${x.n}</b>
          <span class="pu-txt"><span>${esc(x.texto)}</span>${x.detalle.length ? `<small>${x.detalle.map(esc).join(" · ")}</small>` : ""}</span>
        </button>`).join("")}</div>${p.items.length > 5 && !pulsoAbierto ? `<button type="button" class="tb-link pu-mas" id="pu-mas">Ver ${p.items.length - 5} más</button>` : ""}`
        : `<p class="pg-vacio">Sin pagos vencidos, entregas atrasadas ni clientes en rojo. Buen día para adelantar trabajo ✨</p>`}`;
    $("#pu-mas")?.addEventListener("click", () => { pulsoAbierto = true; pintarPulso(p); });
  }

  // =====================================================================
  //  CUENTAS
  // =====================================================================
  let lista = [];
  let filtro = guardado.get("delta_cuentas_filtro") || "todas";
  let elegida = Number(guardado.get("delta_cuenta")) || null;
  let ficha = null;

  document.querySelectorAll("#cu-filtro [data-salud]").forEach((b) => {
    b.classList.toggle("activa", b.dataset.salud === filtro);
    b.addEventListener("click", () => {
      filtro = b.dataset.salud;
      guardado.set("delta_cuentas_filtro", filtro);
      document.querySelectorAll("#cu-filtro [data-salud]").forEach((x) => x.classList.toggle("activa", x === b));
      pintarLista();
    });
  });

  async function cargarCuentas() {
    lista = await api("/cuentas");
    if (!lista.some((c) => c.id === elegida)) elegida = lista[0]?.id ?? null;
    pintarLista();
    if (elegida) await cargarFicha(elegida);
    else pintarSinCuentas();
  }

  function pintarLista() {
    const cuenta = (n) => lista.filter((c) => n === "todas" || c.salud.nivel === n).length;
    document.querySelectorAll("#cu-filtro [data-salud]").forEach((b) => {
      const n = cuenta(b.dataset.salud);
      const etq = b.dataset.salud === "todas" ? "Todas" : SALUD_TXT[b.dataset.salud];
      b.innerHTML = `${b.dataset.salud !== "todas" ? foco(b.dataset.salud) : ""}${etq} <small>${n}</small>`;
    });
    const vis = lista.filter((c) => filtro === "todas" || c.salud.nivel === filtro);
    $("#cu-lista").innerHTML = vis.length
      ? vis.map((c) => {
          const p = pct(c.gasto_mes, c.presupuesto_anuncios);
          const datos = [
            c.proyectos_abiertos ? `${c.proyectos_abiertos} entrega${c.proyectos_abiertos === 1 ? "" : "s"}` : "",
            c.proxima_junta ? `junta ${fmtDia(c.proxima_junta.inicio).toLowerCase()}` : "",
            c.por_aprobar ? `${c.por_aprobar} por aprobar` : "",
          ].filter(Boolean);
          return `<button type="button" class="cu-tarjeta s-borde-${c.salud.nivel} ${c.id === elegida ? "elegida" : ""} ${c.estado !== "activo" ? "apagada" : ""}" data-cuenta="${c.id}">
            <span class="cu-t-cabeza">${foco(c.salud.nivel)}<b>${esc(c.nombre)}</b>${c.estado !== "activo" ? `<span class="chip ${c.estado}">${esc(ESTADO_CL[c.estado])}</span>` : ""}${scoreChip(c.score)}</span>
            <span class="cu-t-sub">${esc(c.industria || c.servicios || "Sin especialidad")}</span>
            <span class="cu-t-motivo t-${c.salud.nivel}">${esc(c.salud.motivos[0])}</span>
            ${datos.length ? `<span class="cu-t-datos">${datos.map(esc).join(" · ")}</span>` : ""}
            ${c.presupuesto_anuncios ? `<span class="cu-t-gasto"><span>Anuncios ${dinero(c.gasto_mes) === "–" ? "$0" : dinero(c.gasto_mes)} / ${dinero(c.presupuesto_anuncios)}</span>${barra(c.gasto_mes, c.presupuesto_anuncios)}<small class="t-${nivelGasto(p)}">${p} %</small></span>` : ""}
          </button>`;
        }).join("")
      : `<p class="pg-vacio cu-vacio">${lista.length ? `Ningún cliente en ${SALUD_TXT[filtro]?.toLowerCase()}.` : "Aún no hay clientes."}</p>`;
    medidas($("#cu-lista"));
  }

  function pintarSinCuentas() {
    $("#cu-ficha").innerHTML = `<div class="panel cu-bienvenida">
      <h2>Tus cuentas</h2>
      <p>Aquí vive la ficha de cada cliente: su semáforo de salud, entregas, juntas, gasto en anuncios y lo que espera tu aprobación.</p>
      <p class="tenue">Toca <b>+ Cliente</b> o dile a DELTA: "da de alta a la Clínica Sonrisa, odontología, paga 15 mil al mes".</p>
    </div>`;
  }

  async function cargarFicha(id) {
    const c = await api(`/clientes/${id}`);
    ficha = c;
    pintarFicha(c);
  }

  function pintarFicha(c) {
    const s = c.salud;
    const g = c.gasto;
    const pG = pct(g.total, g.tope);
    const abiertos = c.proyectos.filter((p) => !["entregado", "cancelado"].includes(p.estado));
    const cerrados = c.proyectos.filter((p) => ["entregado", "cancelado"].includes(p.estado)).slice(0, 3);
    const ahora = new Date().toISOString();
    const en2 = new Date(Date.now() + 2 * 864e5).toISOString();
    const maxHist = Math.max(...g.historial.map((x) => x.total), g.tope || 0, 1);
    const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: h.zona() }).format(new Date());
    const datos = [["Contacto", c.contacto], ["Teléfono", c.telefono], ["Correo", c.correo], ["Servicios", c.servicios], ["Web y redes", c.redes], ["Notas", c.notas]].filter(([, v]) => v);

    $("#cu-ficha").innerHTML = `
      <div class="panel cu-cabeza s-borde-${s.nivel}">
        <div class="cu-cabeza-top">
          <div class="cu-nombre">
            <h2>${esc(c.nombre)}</h2>
            <span class="tenue">${[c.industria, ESTADO_CL[c.estado], c.creado ? `cliente desde ${mesCorto(c.creado)} ${c.creado.slice(0, 4)}` : ""].filter(Boolean).map(esc).join(" · ")}</span>
          </div>
          <div class="ag-botones">
            <button type="button" class="tb-link" id="cu-editar">Editar datos</button>
            <button type="button" class="ag-agregar" data-pedir="${esc(`¿Cómo va ${c.nombre}? Revisa su ficha (Delta Score y su desglose, salud, entregas, pagos, anuncios, redes y aprobaciones) y dime qué subiría más su calificación y el siguiente paso con este cliente.`)}">Siguiente paso con DELTA</button>
          </div>
        </div>
        <div class="cu-salud">
          <div class="semaforo" role="img" aria-label="Salud: ${SALUD_TXT[s.nivel]}">
            ${["rojo", "amarillo", "verde"].map((n) => `<i class="luz ${n} ${n === s.nivel ? "on" : ""}"></i>`).join("")}
          </div>
          <div class="cu-salud-txt">
            <b class="t-${s.nivel}">${SALUD_TXT[s.nivel]} · ${SALUD_FRASE[s.nivel]}</b>
            <ul>${s.motivos.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>
            ${s.manual && s.automatico !== s.nivel ? `<small class="tenue">Por los datos estaría en ${SALUD_TXT[s.automatico].toLowerCase()}.</small>` : ""}
          </div>
          <form class="cu-salud-form" id="cu-salud-form">
            <label class="tenue chico">Salud
              <select id="cu-salud-sel">
                <option value="auto" ${!s.manual ? "selected" : ""}>Automática</option>
                ${["verde", "amarillo", "rojo"].map((n) => `<option value="${n}" ${s.manual && c.salud_manual === n ? "selected" : ""}>${SALUD_TXT[n]} (a mano)</option>`).join("")}
              </select>
            </label>
            <input id="cu-salud-nota" type="text" maxlength="200" placeholder="¿Por qué? (opcional)" value="${esc(c.salud_nota || "")}" ${s.manual ? "" : "hidden"} />
          </form>
        </div>
      </div>

      ${c.score ? panelScore(c.score) : ""}

      <div class="cu-kpis">
        <div class="tb-kpi cu-kpi"><span class="tb-kpi-nombre">Pago mensual</span><b>${c.presupuesto_mensual ? dinero(c.presupuesto_mensual) : "–"}</b><span class="tb-kpi-mes">${esc(c.servicios || "Servicios sin anotar")}</span></div>
        <div class="tb-kpi cu-kpi"><span class="tb-kpi-nombre">Anuncios del mes</span><b>${g.total ? dinero(g.total) : "$0"}</b>${pG !== null ? `<span class="tb-chip s-${nivelGasto(pG)}">${pG} %</span>` : ""}<span class="tb-kpi-mes">${esc(nombreMes(g.mes))} · ${g.tope ? `tope ${dinero(g.tope)}` : "sin tope (ponlo en Editar datos)"}</span><span class="pg-kpi-pie">${barra(g.total, g.tope)}</span></div>
        <div class="tb-kpi cu-kpi"><span class="tb-kpi-nombre">Entregas abiertas</span><b>${abiertos.length}</b><span class="tb-kpi-mes">${abiertos.filter((p) => p.entrega && p.entrega < ahora).length ? `${abiertos.filter((p) => p.entrega && p.entrega < ahora).length} atrasada(s)` : "Ninguna atrasada"}</span></div>
        <a class="tb-kpi cu-kpi" href="#/aprobaciones"><span class="tb-kpi-nombre">Por aprobar</span><b>${c.aprobaciones_pendientes.length}</b><span class="tb-kpi-mes">${c.aprobaciones_pendientes.length ? "Toca para revisarlas" : "Nada pendiente"}</span></a>
      </div>

      ${panelMeta(c)}

      <div class="cu-paneles">
        <div class="panel cu-entregas">
          <h2>Entregas</h2>
          <ul class="pg-linea">
            ${abiertos.length ? abiertos.map((p) => {
              const n = !p.entrega ? "" : p.entrega < ahora ? "rojo" : p.entrega <= en2 ? "amarillo" : "";
              return `<li class="${n ? "n-" + n : ""}">
                <span class="pg-fecha">${p.entrega ? `<b>${diaNum(p.entrega)}</b><small>${mesCorto(p.entrega)}</small>` : `<b>–</b><small>sin fecha</small>`}</span>
                <span class="pg-linea-txt"><b>${esc(p.titulo)}</b><small>${[n === "rojo" ? "atrasada" : p.entrega ? fmtDia(p.entrega) : "", p.departamento ? h.nombreDepto(p.departamento) : ""].filter(Boolean).map(esc).join(" · ")}</small></span>
                <select data-proyecto="${p.id}" aria-label="Estado">${Object.entries(ESTADO_PROY).map(([k, v]) => `<option value="${k}" ${k === p.estado ? "selected" : ""}>${v}</option>`).join("")}</select>
              </li>`;
            }).join("") : vacio("Sin entregas abiertas.")}
            ${cerrados.map((p) => `<li class="hecha"><span class="pg-fecha"><b>✓</b><small>${esc(ESTADO_PROY[p.estado].toLowerCase())}</small></span><span class="pg-linea-txt"><b>${esc(p.titulo)}</b></span></li>`).join("")}
          </ul>
          <form class="form-mini cu-form" id="cu-form-entrega">
            <input id="cu-entrega-titulo" type="text" placeholder="Nueva entrega…" maxlength="200" required />
            <input id="cu-entrega-fecha" type="date" min="${hoy}" title="Fecha de entrega" />
            <button type="submit" aria-label="Agregar entrega">+</button>
          </form>
        </div>

        <div class="panel cu-juntas">
          <h2>Próximas juntas</h2>
          <ul class="pg-linea">
            ${c.juntas.length ? c.juntas.map((j) => `<li>
              <span class="pg-fecha"><b>${diaNum(j.inicio)}</b><small>${mesCorto(j.inicio)}</small></span>
              <span class="pg-linea-txt"><b>${esc(j.titulo)}</b><small>${[fmtDia(j.inicio) + " · " + fmtHora(j.inicio), j.lugar].filter(Boolean).map(esc).join(" · ")}</small></span>
            </li>`).join("") : vacio("Sin juntas agendadas.")}
          </ul>
          <form class="form-mini cu-form" id="cu-form-junta">
            <input id="cu-junta-titulo" type="text" placeholder="Junta de…" maxlength="200" />
            <input id="cu-junta-fecha" type="date" min="${hoy}" required title="Día" />
            <input id="cu-junta-hora" type="time" value="10:00" required title="Hora" />
            <button type="submit" aria-label="Agendar junta">+</button>
          </form>
          <p class="tenue chico">Se agenda en tu calendario y DELTA te avisa antes.</p>
        </div>

        <div class="panel cu-anuncios">
          <div class="ag-cabeza"><h2>Anuncios</h2><span class="tb-hora">${esc(nombreMes(g.mes))}</span></div>
          <ul class="cu-plataformas">
            ${g.por_plataforma.length ? g.por_plataforma.map((p) => `<li><span><i class="pt pl-${p.plataforma}"></i>${esc(PLATAFORMA[p.plataforma] || p.plataforma)}</span><b>${dinero(p.monto) === "–" ? "$0" : dinero(p.monto)}</b><small class="tenue">${p.fuente === "manual" ? "anotado a mano" : "conectado"}</small></li>`).join("") : `<li class="pg-vacio">Sin gasto anotado este mes.</li>`}
          </ul>
          <form class="form-mini cu-form" id="cu-form-gasto">
            <select id="cu-gasto-plat" aria-label="Plataforma">${Object.entries(PLATAFORMA).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
            <input id="cu-gasto-monto" type="text" inputmode="decimal" maxlength="14" placeholder="Total del mes" required />
            <button type="submit">Anotar</button>
          </form>
          <div class="cu-hist" role="img" aria-label="Gasto de los últimos 6 meses">
            ${g.historial.map((x) => `<span class="cu-hist-col ${x.mes === g.mes ? "actual" : ""}" title="${esc(nombreMes(x.mes))}: ${x.total ? dinero(x.total) : "$0"}">
              <i data-alto="${Math.max(2, (x.total / maxHist) * 100)}"></i><small>${esc(MESES[Number(x.mes.slice(5)) - 1])}</small></span>`).join("")}
            ${g.tope ? `<span class="cu-hist-tope" data-abajo="${Math.round(18 + 92 * (g.tope / maxHist))}"><small>tope</small></span>` : ""}
          </div>
        </div>

        <div class="panel cu-datos">
          <h2>Contacto y notas</h2>
          ${datos.length ? `<div class="ficha-datos">${datos.map(([k, v]) => `<div><span class="tenue">${k}</span><div>${esc(v)}</div></div>`).join("")}</div>` : `<p class="pg-vacio">Sin datos de contacto. Toca "Editar datos".</p>`}
          ${c.aprobaciones_pendientes.length ? `<h3>Esperando tu aprobación</h3><ul class="lista">${c.aprobaciones_pendientes.map((a) => `<li data-ir-a="#/aprobaciones" tabindex="0"><div class="cuerpo">${esc(a.titulo)}<span class="sub">${esc(haceRato(a.creada))}</span></div></li>`).join("")}</ul>` : ""}
          <h3>Trabajos recientes</h3>
          <ul class="lista clickable">${c.trabajos_recientes.length ? c.trabajos_recientes.slice(0, 4).map(filaTrabajo).join("") : vacio("Aún nada.")}</ul>
        </div>
      </div>`;

    medidas($("#cu-ficha"));

    // Salud a mano
    const sel = $("#cu-salud-sel"), nota = $("#cu-salud-nota");
    const guardarSalud = async () => {
      try {
        await api(`/clientes/${c.id}`, { method: "PATCH", body: { salud_manual: sel.value, salud_nota: sel.value === "auto" ? null : nota.value.trim() || null } });
        sonar("accion");
        await cargarCuentas();
      } catch (err) { avisar(err.message); }
    };
    sel.addEventListener("change", () => { nota.hidden = sel.value === "auto"; guardarSalud(); });
    nota.addEventListener("change", guardarSalud);
    $("#cu-salud-form").addEventListener("submit", (e) => { e.preventDefault(); guardarSalud(); });
    $("#cu-editar").addEventListener("click", () => h.editarCliente(c));

    const enviar = (form, fn) => $(form).addEventListener("submit", async (e) => {
      e.preventDefault();
      const b = e.target.querySelector("button");
      b.disabled = true;
      try { await fn(); sonar("accion"); await cargarCuentas(); }
      catch (err) { avisar(err.message); b.disabled = false; }
    });
    enviar("#cu-form-entrega", () => api("/proyectos", { method: "POST", body: { cliente: String(c.id), titulo: $("#cu-entrega-titulo").value.trim(), entrega: $("#cu-entrega-fecha").value ? $("#cu-entrega-fecha").value + "T12:00" : undefined } }));
    enviar("#cu-form-junta", () => api(`/clientes/${c.id}/junta`, { method: "POST", body: { titulo: $("#cu-junta-titulo").value.trim(), inicio: `${$("#cu-junta-fecha").value}T${$("#cu-junta-hora").value || "10:00"}` } }));
    enviar("#cu-form-gasto", () => api(`/clientes/${c.id}/gasto`, { method: "POST", body: { plataforma: $("#cu-gasto-plat").value, monto: $("#cu-gasto-monto").value } }));
  }

  // ---------- Meta: redes y anuncios del cliente ----------
  function panelMeta(c) {
    const m = c.meta;
    if (!m) {
      return `<div class="panel cu-meta cu-meta-vacio">
        <div class="ag-cabeza"><h2>Redes y anuncios (Meta)</h2></div>
        <p class="tenue">Aún no hay página de Facebook, Instagram ni cuenta de anuncios de Meta para ${esc(c.nombre)}.</p>
        <div class="ag-botones"><button type="button" class="tb-link" data-abrir-meta>Asignar desde Meta</button></div>
      </div>`;
    }
    const dato = (nombre, valor, extra = "", chip = "") => `<div class="tb-kpi mt-dato"><span class="tb-kpi-nombre">${nombre}</span><b>${valor}</b>${chip}<span class="tb-kpi-mes">${extra}</span></div>`;
    const cambio = (n) => (n ? `<span class="tb-chip s-${n > 0 ? "verde" : "rojo"}">${conSigno(n)}</span>` : "");
    const desde = m.seguidores_cambio?.desde ? `desde el ${Number(m.seguidores_cambio.desde.slice(8))} ${MESES[Number(m.seguidores_cambio.desde.slice(5, 7)) - 1]}` : "";
    const ig = m.instagram, fb = m.facebook, ad = m.anuncios;
    const bloques = [];
    if (ig) bloques.push(`<div class="mt-bloque"><h3><i class="pt pl-ig"></i>Instagram <small class="tenue">${esc((ig.cuentas || []).join(", "))}</small></h3><div class="mt-rejilla">
      ${dato("Seguidores", cifra(ig.seguidores), desde, cambio(m.seguidores_cambio?.instagram))}
      ${dato("Alcance", cifra(ig.alcance_28d), "últimos 28 días")}
      ${dato("Interacciones", cifra(ig.interacciones_28d), "últimos 28 días")}
      ${dato("Publicaciones", cifra(ig.publicaciones_mes), `este mes · ${cifra(ig.me_gusta_mes)} me gusta`)}
    </div>${ig.mejor_publicacion ? `<p class="tenue chico mt-mejor">La que más gustó este mes: ${ig.mejor_publicacion.enlace ? `<a href="${esc(ig.mejor_publicacion.enlace)}" target="_blank" rel="noopener">${esc(ig.mejor_publicacion.texto || "ver publicación")}</a>` : esc(ig.mejor_publicacion.texto)} · ${cifra(ig.mejor_publicacion.me_gusta)} me gusta, ${cifra(ig.mejor_publicacion.comentarios)} comentarios</p>` : ""}</div>`);
    if (fb) bloques.push(`<div class="mt-bloque"><h3><i class="pt pl-meta"></i>Facebook <small class="tenue">${esc((fb.paginas || []).join(", "))}</small></h3><div class="mt-rejilla">
      ${dato("Seguidores", cifra(fb.seguidores), desde, cambio(m.seguidores_cambio?.facebook))}
      ${dato("Alcance", cifra(fb.alcance_28d), "últimos 28 días")}
      ${dato("Publicaciones", cifra(fb.publicaciones_mes), "este mes")}
    </div></div>`);
    if (ad) {
      const res = [["conversaciones", "Conversaciones"], ["prospectos", "Prospectos"], ["compras", "Compras"]].filter(([k]) => ad[k]);
      const [kRes, nRes] = res[0] || ["clics_enlace", "Clics al enlace"];
      const costo = ad[kRes] ? ad.gasto_mes / ad[kRes] : null;
      const moneda = (ad.monedas || []).length === 1 && ad.monedas[0] !== "MXN" ? ` ${ad.monedas[0]}` : "";
      bloques.push(`<div class="mt-bloque"><h3><i class="pt pl-meta"></i>Anuncios <small class="tenue">${esc((ad.cuentas || []).join(", "))}</small></h3><div class="mt-rejilla">
        ${dato("Gasto del mes", (dinero(ad.gasto_mes) === "–" ? "$0" : dinero(ad.gasto_mes)) + moneda, ad.gasto_mes_pasado ? `mes pasado ${dinero(ad.gasto_mes_pasado)}` : "")}
        ${dato("Alcance", cifra(ad.alcance), `${cifra(ad.impresiones)} impresiones`)}
        ${dato(nRes, cifra(ad[kRes]), costo ? `${dinero(Math.round(costo * 100) / 100)} c/u` : "este mes", res.length > 1 ? `<span class="tb-chip">${res.slice(1).map(([k, n]) => `${cifra(ad[k])} ${n.toLowerCase()}`).join(" · ")}</span>` : "")}
        ${dato("Campañas activas", cifra(ad.campanas_activas), `${cifra(ad.clics)} clics este mes`)}
      </div></div>`);
    }
    return `<div class="panel cu-meta">
      <div class="ag-cabeza"><h2>Redes y anuncios (Meta)</h2>
        <span class="ag-botones"><span class="tb-hora">${m.actualizado ? `Actualizado ${haceRato(m.actualizado)}` : "Sin datos todavía"}</span>
        <button type="button" class="tb-link" data-meta-cliente="${c.id}">Actualizar</button><button type="button" class="tb-link" data-abrir-meta>Asignar</button></span></div>
      ${bloques.length ? bloques.join("") : `<p class="tenue">Ya tiene ${m.activos.length} cosa${m.activos.length === 1 ? "" : "s"} de Meta asignada${m.activos.length === 1 ? "" : "s"}. Toca Actualizar para traer sus números.</p>`}
      ${(m.errores || []).length ? `<details class="tenue chico"><summary>Meta no dejó ver ${m.errores.length === 1 ? "un dato" : `${m.errores.length} datos`}</summary><ul>${m.errores.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></details>` : ""}
    </div>`;
  }

  // Ventana "Meta de tus clientes": conectar, ver lo que encontró y decir de quién es cada cosa.
  async function abrirMeta() {
    const dlg = $("#dlg-meta");
    if (!dlg.open) dlg.showModal();
    $("#mt-msg").textContent = "";
    await pintarMeta();
  }
  async function pintarMeta() {
    const e = await api("/meta");
    const vence = e.expira ? Math.ceil((new Date(e.expira) - Date.now()) / 864e5) : null;
    $("#mt-estado").textContent = !e.disponible
      ? "Falta un paso en Railway para poder conectar Meta (META_APP_ID y META_APP_SECRET). Pídeme la guía y lo hacemos juntos."
      : !e.conectado ? "Conecta tu Facebook (el que administra las páginas y anuncios de tus clientes) y DELTA traerá sola sus números."
      : `Conectado${e.usuario ? ` como ${e.usuario}` : ""}${e.modo === "sistema" ? " con el usuario del sistema" : ""}.${e.ultima ? ` Última revisión ${haceRato(e.ultima)}.` : ""}${vence !== null ? ` El permiso dura ${vence} día${vence === 1 ? "" : "s"} más.` : ""}`;
    $("#mt-conectar").hidden = e.modo === "sistema" || !e.disponible;
    $("#mt-conectar").textContent = e.conectado ? "Volver a conectar" : "Conectar Meta";
    $("#mt-actualizar").hidden = !e.conectado;
    const opciones = (sel) => `<option value="">Sin cliente</option>` + e.clientes.map((c) => `<option value="${c.id}" ${c.id === sel ? "selected" : ""}>${esc(c.nombre)}</option>`).join("");
    const icono = { pagina: "pl-meta", instagram: "pl-ig", anuncios: "pl-meta" };
    $("#mt-lista").innerHTML = e.activos.length
      ? e.activos.map((a) => `<li class="${a.cliente_id ? "" : "sin"}">
          <span class="mt-cosa"><i class="pt ${icono[a.tipo]}"></i><b>${esc(a.nombre)}</b><small class="tenue">${esc(a.tipo_nombre)}${a.extra?.negocio ? ` · ${esc(a.extra.negocio)}` : ""}${a.extra?.pagina_nombre ? ` · de ${esc(a.extra.pagina_nombre)}` : ""}${a.ligado === "auto" && a.cliente_id ? " · asignada sola" : ""}</small></span>
          <select data-meta-activo="${esc(a.id)}" aria-label="Cliente de ${esc(a.nombre)}">${opciones(a.cliente_id)}</select>
        </li>`).join("")
      : e.conectado ? vacio("Todavía no encuentro nada. Toca Actualizar ahora.") : "";
  }
  $("#btn-meta")?.addEventListener("click", () => abrirMeta().catch((err) => avisar(err.message)));
  $("#mt-cerrar").addEventListener("click", () => { $("#dlg-meta").close(); if (ficha) cargarCuentas().catch(() => {}); });
  $("#mt-conectar").addEventListener("click", async () => {
    try { const { url } = await api("/meta/conectar"); location.href = url; } catch (err) { $("#mt-msg").textContent = err.message; }
  });
  $("#mt-actualizar").addEventListener("click", async (ev) => {
    const b = ev.currentTarget;
    b.disabled = true;
    $("#mt-msg").textContent = "Revisando Meta… puede tardar un minuto si son muchos clientes.";
    try {
      const r = await api("/meta/actualizar", { method: "POST" });
      $("#mt-msg").textContent = `Listo: ${r.paginas} página${r.paginas === 1 ? "" : "s"}, ${r.cuentas_anuncios} cuenta${r.cuentas_anuncios === 1 ? "" : "s"} de anuncios, ${r.clientes_actualizados} cliente${r.clientes_actualizados === 1 ? "" : "s"} con números nuevos.${r.errores.length ? ` Meta no dejó ver ${r.errores.length} cosa${r.errores.length === 1 ? "" : "s"} (falta algún permiso).` : ""}`;
      sonar("accion");
      await pintarMeta();
    } catch (err) { $("#mt-msg").textContent = err.message; }
    b.disabled = false;
  });
  $("#mt-lista").addEventListener("change", async (ev) => {
    const sel = ev.target.closest("[data-meta-activo]");
    if (!sel) return;
    try {
      await api(`/meta/activos/${encodeURIComponent(sel.dataset.metaActivo)}`, { method: "PATCH", body: { cliente_id: sel.value ? Number(sel.value) : null } });
      sonar("accion");
      await pintarMeta();
      $("#mt-msg").textContent = "Guardado. Toca Actualizar ahora para traer sus números.";
    } catch (err) { $("#mt-msg").textContent = err.message; }
  });

  // =====================================================================
  //  FINANZAS
  // =====================================================================
  let mesFi = null; // null = mes actual
  const dinero0 = (n) => (n ? dinero(n) : "$0");
  const conSignoPct = (n) => (n === null || n === undefined ? null : `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("es-MX", { maximumFractionDigits: 1 })} %`);
  const fechaCorta = (d) => (d ? `${Number(d.slice(8, 10))} ${MESES[Number(d.slice(5, 7)) - 1]}` : "");
  const moverMes = (m, n) => { const [a, x] = m.split("-").map(Number); return new Date(Date.UTC(a, x - 1 + n, 1)).toISOString().slice(0, 7); };
  let ultimaFi = null;

  async function cargarFinanzas() {
    const f = await api(`/finanzas${mesFi ? `?mes=${mesFi}` : ""}`);
    ultimaFi = f;
    pintarFinanzas(f);
  }

  function pintarFinanzas(f) {
    const mesLargo = f.nombre_mes.charAt(0).toUpperCase() + f.nombre_mes.slice(1);
    $("#fi-hoy").textContent = mesLargo;
    $("#fi-hoy").title = f.es_mes_actual ? "Este mes" : "Volver a este mes";
    $("#fi-despues").disabled = f.es_mes_actual;
    const chipCambio = (n, alReves = false) => (n === null ? null : [(n >= 0) !== alReves ? "verde" : "rojo", conSignoPct(n)]);
    const kpi = (k) => `<div class="tb-kpi pg-kpi fi-kpi ${k.clase || ""}" ${k.ir ? `data-fi-ir="${k.ir}" role="button" tabindex="0"` : ""}>
        <span class="tb-kpi-nombre">${esc(k.nombre)}</span>
        <b>${esc(k.valor)}</b>
        ${k.chip ? `<span class="tb-chip s-${k.chip[0]}">${esc(k.chip[1])}</span>` : ""}
        <span class="tb-kpi-mes">${esc(k.extra || "")}</span>
        <span class="pg-kpi-pie">${k.pie || ""}</span>
      </div>`;
    const pCobrado = f.facturado ? Math.round((f.cobrado / f.facturado) * 100) : null;
    $("#fi-kpis").innerHTML = [
      { nombre: "Facturación", valor: dinero0(f.facturado), chip: chipCambio(f.cambio.facturado), extra: f.anterior.facturado ? `vs ${dinero0(f.anterior.facturado)} el mes anterior` : "lo que corresponde a este mes" },
      { nombre: "Cobrado", valor: dinero0(f.cobrado), extra: pCobrado !== null ? `${pCobrado} % de lo facturado` : "dinero que ya llegó", pie: f.facturado ? barra(Math.min(f.cobrado, f.facturado), f.facturado).replace(/pg-barra \w*/, "pg-barra verde") : "" },
      { nombre: "Por cobrar", valor: dinero0(f.por_cobrar), ir: "#fi-cobranza", chip: f.vencido ? ["rojo", `${dinero0(f.vencido)} vencido`] : f.por_cobrar ? ["amarillo", "Al corriente"] : ["verde", "Nadie debe"], extra: f.cobros_vencidos ? `${f.cobros_vencidos} pago${f.cobros_vencidos === 1 ? "" : "s"} vencido${f.cobros_vencidos === 1 ? "" : "s"}` : "de todos los meses" },
      { nombre: "Gastos", valor: dinero0(f.gastos), ir: "#fi-gastos", chip: chipCambio(f.cambio.gastos, true), extra: "de la agencia (sin anuncios)" },
      { nombre: "Utilidad", valor: f.utilidad < 0 ? `−${dinero0(-f.utilidad)}` : dinero0(f.utilidad), clase: f.utilidad < 0 ? "negativa" : "", chip: chipCambio(f.cambio.utilidad), extra: "facturación − gastos" },
      { nombre: "Margen", valor: f.margen === null ? "–" : `${f.margen.toLocaleString("es-MX", { maximumFractionDigits: 1 })} %`, chip: f.margen === null ? null : [f.margen >= 40 ? "verde" : f.margen >= 15 ? "amarillo" : "rojo", f.margen >= 40 ? "Sano" : f.margen >= 15 ? "Justo" : "Bajo"], extra: "de cada peso facturado" },
      { nombre: "Ingreso fijo al mes", valor: dinero0(f.mrr), extra: f.clientes_que_pagan ? `${f.clientes_que_pagan} cliente${f.clientes_que_pagan === 1 ? "" : "s"} · promedio ${dinero0(f.ticket_promedio)}` : "Anota el pago mensual de cada cliente" },
      { nombre: `Acumulado ${f.mes.slice(0, 4)}`, valor: dinero0(f.facturado_anio), extra: `utilidad ${f.utilidad_anio < 0 ? "−" + dinero0(-f.utilidad_anio) : dinero0(f.utilidad_anio)}` },
    ].map(kpi).join("");

    // Gráfica de 12 meses: barras de ingresos y gastos, línea de utilidad
    $("#fi-grafica").innerHTML = grafica(f.historia, f.mes);

    // Rentabilidad por cliente
    $("#fi-rent-mes").textContent = mesLargo;
    const maxR = Math.max(1, ...f.rentabilidad.map((r) => r.facturado));
    $("#fi-rent").innerHTML = f.rentabilidad.length
      ? `<div class="fi-rent-fila fi-rent-cabeza tenue"><span>Cliente</span><span>Facturado</span><span>Gastos</span><span>Utilidad</span><span>Margen</span></div>` +
        f.rentabilidad.map((r) => `<div class="fi-rent-fila" data-cuenta="${r.id}" tabindex="0">
          <span class="fi-rent-nombre"><b>${esc(r.nombre)}</b><span class="pg-barra fi-rent-barra"><i data-ancho="${Math.round((r.facturado / maxR) * 100)}"></i></span>${r.pendiente ? `<small class="t-amarillo">debe ${dinero0(r.pendiente)}</small>` : ""}</span>
          <span>${dinero0(r.facturado)}</span>
          <span class="tenue">${r.gastos ? dinero0(r.gastos) : "–"}</span>
          <span class="${r.utilidad < 0 ? "t-rojo" : ""}">${r.utilidad < 0 ? "−" + dinero0(-r.utilidad) : dinero0(r.utilidad)}</span>
          <span>${r.margen === null ? "–" : `<span class="tb-chip s-${r.margen >= 40 ? "verde" : r.margen >= 15 ? "amarillo" : "rojo"}">${Math.round(r.margen)} %</span>`}</span>
        </div>`).join("") +
        (f.clientes_sin_mensualidad.length ? `<p class="tenue chico fi-aviso">Sin pago mensual anotado: ${f.clientes_sin_mensualidad.map((c) => `<a href="#/cuentas" data-cuenta="${c.id}">${esc(c.nombre)}</a>`).join(", ")}. Anótalo en su ficha (Editar datos).</p>` : "")
      : `<p class="pg-vacio">Aún no hay cobros este mes. Anota el <b>pago mensual</b> de cada cliente en Cuentas → Editar datos y DELTA crea sus mensualidades sola.</p>`;

    // Cobranza (todo lo pendiente, de cualquier mes)
    $("#fi-cobranza-n").textContent = f.pendientes.length ? `${f.pendientes.length} pendiente${f.pendientes.length === 1 ? "" : "s"}` : "";
    $("#fi-cobranza").innerHTML = f.pendientes.length
      ? f.pendientes.map((c) => filaCobro(c)).join("")
      : vacio("Nadie te debe. Todo cobrado ✨");

    // Gastos
    $("#fi-gastos-mes").textContent = mesLargo;
    const maxG = Math.max(1, ...f.gastos_por_categoria.map((g) => g.monto));
    $("#fi-categorias").innerHTML = f.gastos_por_categoria.map((g) => `<div class="fi-cat"><span>${esc(g.nombre)}</span><b>${dinero0(g.monto)}</b><span class="pg-barra"><i data-ancho="${Math.round((g.monto / maxG) * 100)}"></i></span></div>`).join("");
    $("#fi-gastos").innerHTML = f.gastos_detalle.length
      ? f.gastos_detalle.map((g) => `<li>
          <span class="pg-fecha"><b>${g.fijo ? "↻" : Number(g.fecha.slice(8, 10))}</b><small>${g.fijo ? "fijo" : MESES[Number(g.fecha.slice(5, 7)) - 1]}</small></span>
          <span class="pg-linea-txt"><b>${esc(g.concepto)}</b><small>${[f.categorias[g.categoria], g.cliente ? `por ${g.cliente}` : ""].filter(Boolean).map(esc).join(" · ")}</small></span>
          <b class="fi-monto">${dinero0(g.monto)}</b>
          <button type="button" class="fi-quitar" data-quitar-gasto="${g.id}" title="${g.fijo ? "Dar de baja desde este mes" : "Quitar"}" aria-label="Quitar">×</button>
        </li>`).join("")
      : vacio("Sin gastos anotados este mes.");

    // Pagos recibidos en el mes
    $("#fi-pagos-n").textContent = f.pagados_mes.length ? dinero0(f.cobrado) : "";
    $("#fi-pagos").innerHTML = f.pagados_mes.length
      ? f.pagados_mes.map((c) => filaCobro(c)).join("")
      : vacio(f.es_mes_actual ? "Aún no llega ningún pago este mes." : "Sin pagos ese mes.");

    // Formularios
    const clientes = cuentasParaForm();
    $("#fi-cobro-cliente").innerHTML = clientes.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("") || `<option value="">Primero da de alta un cliente</option>`;
    if (!$("#fi-gasto-cat").options.length) $("#fi-gasto-cat").innerHTML = Object.entries(f.categorias).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("");
    const elegido = $("#fi-gasto-cliente").value;
    $("#fi-gasto-cliente").innerHTML = `<option value="">De la agencia (no es por un cliente)</option>` + clientes.map((c) => `<option value="${c.id}" ${String(c.id) === elegido ? "selected" : ""}>Por ${esc(c.nombre)}</option>`).join("");

    medidas($('[data-seccion="finanzas"]'));
  }

  let clientesFi = [];
  const cuentasParaForm = () => clientesFi;

  function filaCobro(c) {
    const n = c.estado === "vencido" ? "rojo" : c.estado === "pendiente" && c.dias_para_vencer <= 3 ? "amarillo" : "";
    const cuando = c.estado === "pagado" ? `pagó el ${fechaCorta(c.pagado)}`
      : c.estado === "vencido" ? `${c.dias_atraso} día${c.dias_atraso === 1 ? "" : "s"} de retraso`
      : c.dias_para_vencer === 0 ? "vence hoy" : `vence en ${c.dias_para_vencer} día${c.dias_para_vencer === 1 ? "" : "s"}`;
    const fechaRef = c.estado === "pagado" ? c.pagado : c.vence;
    return `<li class="fi-cobro ${n ? "n-" + n : ""} ${c.estado}">
      <span class="pg-fecha"><b>${Number(fechaRef.slice(8, 10))}</b><small>${MESES[Number(fechaRef.slice(5, 7)) - 1]}</small></span>
      <span class="pg-linea-txt"><b data-cuenta="${c.cliente_id}" tabindex="0">${esc(c.cliente)}</b><small>${[c.concepto, cuando].map(esc).join(" · ")}</small></span>
      <b class="fi-monto ${n ? "t-" + n : ""}">${dinero0(c.monto)}</b>
      ${c.estado === "pagado"
        ? `<button type="button" class="fi-quitar" data-cobro-pendiente="${c.id}" title="Regresar a pendiente" aria-label="Regresar a pendiente">↺</button>`
        : `<button type="button" class="tb-link fi-pagar" data-cobro-pagado="${c.id}">Ya pagó</button>`}
    </li>`;
  }

  function grafica(h, mesSel) {
    const W = 640, H = 210, izq = 46, abajo = 22, arriba = 10;
    const max = Math.max(1, ...h.map((x) => Math.max(x.facturado, x.gastos)));
    const min = Math.min(0, ...h.map((x) => x.utilidad));
    const rango = max - min;
    const y = (v) => arriba + (H - arriba - abajo) * (1 - (v - min) / rango);
    const paso = (W - izq) / h.length;
    const ancho = Math.max(4, paso * 0.32);
    const marcas = [0, 0.5, 1].map((p) => min + rango * p);
    const etiqueta = (v) => (Math.abs(v) >= 1000 ? `${compacto.format(v)}` : Math.round(v));
    const puntos = h.map((x, i) => `${izq + paso * i + paso / 2},${y(x.utilidad).toFixed(1)}`).join(" ");
    const hayDatos = h.some((x) => x.facturado || x.gastos);
    return `<svg viewBox="0 0 ${W} ${H}" class="fi-svg" role="img" aria-label="Ingresos, gastos y utilidad de los últimos 12 meses">
      ${marcas.map((v) => `<line x1="${izq}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="fi-reja"/><text x="${izq - 6}" y="${y(v) + 4}" class="fi-eje" text-anchor="end">$${etiqueta(v)}</text>`).join("")}
      ${h.map((x, i) => {
        const cx = izq + paso * i + paso / 2;
        const sel = x.mes === mesSel ? "sel" : "";
        return `<g class="fi-mes-g ${sel}" data-fi-mes="${x.mes}">
          <title>${MESES[Number(x.mes.slice(5)) - 1]} ${x.mes.slice(0, 4)}: ingresos ${dinero0(x.facturado)}, gastos ${dinero0(x.gastos)}, utilidad ${x.utilidad < 0 ? "−" + dinero0(-x.utilidad) : dinero0(x.utilidad)}</title>
          <rect x="${cx - paso / 2}" y="${arriba}" width="${paso}" height="${H - arriba - abajo}" class="fi-zona"/>
          <rect x="${cx - ancho - 1}" y="${y(Math.max(0, x.facturado))}" width="${ancho}" height="${Math.max(0, y(0) - y(x.facturado))}" rx="2" class="fi-ing"/>
          <rect x="${cx + 1}" y="${y(Math.max(0, x.gastos))}" width="${ancho}" height="${Math.max(0, y(0) - y(x.gastos))}" rx="2" class="fi-gas"/>
          <text x="${cx}" y="${H - 6}" class="fi-eje ${sel}" text-anchor="middle">${MESES[Number(x.mes.slice(5)) - 1]}</text>
        </g>`;
      }).join("")}
      ${hayDatos ? `<polyline points="${puntos}" class="fi-util"/>${h.map((x, i) => `<circle cx="${izq + paso * i + paso / 2}" cy="${y(x.utilidad)}" r="${x.mes === mesSel ? 4 : 2.5}" class="fi-util-p"/>`).join("")}` : ""}
    </svg>
    <div class="fi-ley"><span><i class="fi-ing"></i>Ingresos</span><span><i class="fi-gas"></i>Gastos</span><span><i class="fi-util"></i>Utilidad</span>${hayDatos ? "" : `<span class="tenue">Se irá llenando mes con mes.</span>`}</div>`;
  }

  async function prepararFinanzas() {
    clientesFi = (await api("/cuentas")).filter((c) => c.estado !== "terminado");
  }

  $("#fi-antes").addEventListener("click", () => { mesFi = moverMes(ultimaFi?.mes || new Date().toISOString().slice(0, 7), -1); cargarFinanzas().catch((e) => avisar(e.message)); });
  $("#fi-despues").addEventListener("click", () => { if (!ultimaFi || ultimaFi.es_mes_actual) return; mesFi = moverMes(ultimaFi.mes, 1); cargarFinanzas().catch((e) => avisar(e.message)); });
  $("#fi-hoy").addEventListener("click", () => { mesFi = null; cargarFinanzas().catch((e) => avisar(e.message)); });
  $("#fi-grafica").addEventListener("click", (e) => {
    const g = e.target.closest("[data-fi-mes]");
    if (!g) return;
    mesFi = g.dataset.fiMes;
    cargarFinanzas().catch((err) => avisar(err.message));
  });
  const enviarFi = (form, fn, despues) => $(form).addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = e.target.querySelector("button[type=submit]");
    b.disabled = true;
    try { await fn(); sonar("accion"); e.target.reset(); despues?.(); await cargarFinanzas(); }
    catch (err) { avisar(err.message); }
    b.disabled = false;
  });
  enviarFi("#fi-form-cobro", () => api("/cobros", { method: "POST", body: {
    cliente: $("#fi-cobro-cliente").value, concepto: $("#fi-cobro-concepto").value.trim(), monto: $("#fi-cobro-monto").value,
    vence: $("#fi-cobro-vence").value || undefined, mes: ultimaFi?.mes,
  } }), () => { $("#fi-det-cobro").open = false; });
  enviarFi("#fi-form-gasto", () => api("/gastos", { method: "POST", body: {
    concepto: $("#fi-gasto-concepto").value.trim(), monto: $("#fi-gasto-monto").value, categoria: $("#fi-gasto-cat").value,
    cliente: $("#fi-gasto-cliente").value || undefined, fijo: $("#fi-gasto-fijo").checked,
    fecha: ultimaFi && !ultimaFi.es_mes_actual ? `${ultimaFi.mes}-01` : undefined,
  } }), () => { $("#fi-det-gasto").open = false; });

  // Botones de las filas: "Ya pagó", regresar a pendiente y quitar gasto (con un segundo toque para confirmar).
  $('[data-seccion="finanzas"]').addEventListener("click", async (e) => {
    const ir = e.target.closest("[data-fi-ir]");
    if (ir) {
      const destino = $(ir.dataset.fiIr);
      const det = destino?.closest("details");
      if (det) det.open = true;
      (destino?.closest(".panel") || destino)?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (det) setTimeout(() => destino.querySelector("input, select")?.focus(), 350);
      return;
    }
    const pagado = e.target.closest("[data-cobro-pagado]");
    const pendiente = e.target.closest("[data-cobro-pendiente]");
    const quitar = e.target.closest("[data-quitar-gasto]");
    const b = pagado || pendiente || quitar;
    if (!b) return;
    if (quitar && !b.classList.contains("seguro")) {
      b.classList.add("seguro");
      b.textContent = "¿Quitar?";
      setTimeout(() => { b.classList.remove("seguro"); b.textContent = "×"; }, 3000);
      return;
    }
    b.disabled = true;
    try {
      if (pagado) await api(`/cobros/${pagado.dataset.cobroPagado}`, { method: "PATCH", body: { pagado: true } });
      else if (pendiente) await api(`/cobros/${pendiente.dataset.cobroPendiente}`, { method: "PATCH", body: { pagado: false } });
      else await api(`/gastos/${quitar.dataset.quitarGasto}`, { method: "DELETE" });
      sonar("accion");
      await cargarFinanzas();
    } catch (err) { avisar(err.message); b.disabled = false; }
  });

  // =====================================================================
  //  ANALÍTICA Y REPORTE MENSUAL
  // =====================================================================
  let mesAn = null; // null = el mes pasado (el que se reporta)
  let clienteAn = Number(guardado.get("delta_an_cliente")) || null;
  let ultimaAn = null, reporteAn = null;
  const mesPasado = () => moverMes(new Date().toISOString().slice(0, 7), -1);

  async function cargarAnalitica() {
    const a = await api(`/analitica${mesAn ? `?mes=${mesAn}` : ""}`);
    ultimaAn = a;
    if (!a.clientes.some((c) => c.id === clienteAn)) clienteAn = a.clientes[0]?.id || null;
    pintarAnalitica(a);
    if (clienteAn) await cargarReporte();
    else { $("#an-hoja").innerHTML = `<article class="rp"><p class="rp-vacio">Da de alta a tus clientes para ver sus reportes.</p></article>`; }
  }

  function pintarAnalitica(a) {
    const nombre = a.nombre_mes.charAt(0).toUpperCase() + a.nombre_mes.slice(1);
    $("#an-hoy").textContent = nombre;
    $("#an-hoy").title = "Volver al mes pasado";
    $("#an-despues").disabled = a.es_mes_actual;
    $("#an-n").textContent = a.con_link ? `${a.con_link} con link` : `${a.clientes.length}`;
    const chip = (n, txt) => (n === null || n === undefined ? `<span class="tenue">–</span>` : txt);
    $("#an-lista").innerHTML = a.clientes.length
      ? a.clientes.map((c) => `<button type="button" class="an-cli ${c.id === clienteAn ? "elegida" : ""} ${c.hay_datos ? "" : "sin"}" data-an-cliente="${c.id}">
          <span class="an-cli-cabeza"><b>${esc(c.nombre)}</b>${c.link ? `<i class="an-ok" title="Tiene link para el cliente">🔗</i>` : ""}<span class="sc-chip c-${c.score_color}" title="Delta Score">${c.score}</span></span>
          ${c.hay_datos ? `<span class="an-cli-datos">
            <span><small>Seguidores</small>${chip(c.seguidores_cambio, `${c.seguidores_cambio > 0 ? "+" : c.seguidores_cambio < 0 ? "−" : ""}${Math.abs(c.seguidores_cambio).toLocaleString("es-MX")}`)}</span>
            <span><small>Publicado</small>${chip(c.publicadas, c.publicadas)}</span>
            <span><small>Contactos</small>${chip(c.contactos, Number(c.contactos).toLocaleString("es-MX"))}</span>
            <span><small>Retorno</small>${chip(c.retorno, `${Number(c.retorno).toLocaleString("es-MX", { maximumFractionDigits: 1 })}×`)}</span>
          </span>` : `<small class="tenue">Sin números este mes</small>`}
        </button>`).join("")
      : `<p class="pg-vacio">Aún no hay clientes activos.</p>`;
  }

  async function cargarReporte() {
    const mes = ultimaAn?.mes || mesPasado();
    const r = await api(`/reportes?cliente=${clienteAn}&mes=${mes}`);
    reporteAn = r;
    guardado.set("delta_an_cliente", String(clienteAn));
    $("#an-cliente-titulo").textContent = `Reporte de ${r.cliente.nombre}`;
    $("#an-estado").textContent = r.link ? "Link activo" : "Sin link";
    $("#an-estado").className = `tb-hora ${r.link ? "t-verde" : ""}`;
    $("#an-nota").value = r.nota || "";
    $("#an-score").checked = r.con_score;
    $("#an-link-caja").hidden = !r.link;
    $("#an-link-url").value = r.link ? (r.link.startsWith("http") ? r.link : location.origin + r.link) : "";
    $("#an-link").textContent = r.link ? "Abrir como lo verá el cliente" : "Crear link para el cliente";
    $("#an-delta").dataset.pedir = `Prepárame el reporte de ${r.cliente.nombre} de ${r.nombre_mes}: cuéntame en pocas frases cómo le fue, qué le diría y qué deberíamos mejorar el próximo mes. No le envíes nada.`;
    $("#an-hoja").innerHTML = r.html;
    $("#an-hoja").querySelectorAll("a[href]").forEach((x) => { x.target = "_blank"; x.rel = "noopener noreferrer"; });
  }

  $("#an-lista").addEventListener("click", (e) => {
    const b = e.target.closest("[data-an-cliente]");
    if (!b) return;
    clienteAn = Number(b.dataset.anCliente);
    $("#an-lista").querySelectorAll("[data-an-cliente]").forEach((x) => x.classList.toggle("elegida", x === b));
    cargarReporte().then(() => { if (matchMedia("(max-width: 1100px)").matches) $(".an-enviar").scrollIntoView({ behavior: "smooth", block: "start" }); }).catch((err) => avisar(err.message));
  });
  $("#an-antes").addEventListener("click", () => { mesAn = moverMes(ultimaAn?.mes || mesPasado(), -1); cargarAnalitica().catch((e) => avisar(e.message)); });
  $("#an-despues").addEventListener("click", () => { if (!ultimaAn || ultimaAn.es_mes_actual) return; mesAn = moverMes(ultimaAn.mes, 1); cargarAnalitica().catch((e) => avisar(e.message)); });
  $("#an-hoy").addEventListener("click", () => { mesAn = null; cargarAnalitica().catch((e) => avisar(e.message)); });
  const guardarAn = async (cambio) => {
    await api("/reportes", { method: "PATCH", body: { cliente: clienteAn, mes: reporteAn.mes, ...cambio } });
    sonar("accion");
    await cargarReporte();
  };
  $("#an-guardar").addEventListener("click", () => guardarAn({ nota: $("#an-nota").value.trim() }).catch((e) => avisar(e.message)));
  $("#an-score").addEventListener("change", (e) => guardarAn({ con_score: e.target.checked, nota: $("#an-nota").value.trim() }).catch((err) => avisar(err.message)));
  $("#an-pdf").addEventListener("click", () => {
    if (!reporteAn) return;
    // Primero guarda el mensaje si cambió, para que salga en el PDF.
    const nota = $("#an-nota").value.trim();
    const abrir = () => window.open(`/api/reportes/pagina?cliente=${clienteAn}&mes=${reporteAn.mes}&imprimir=1`, "_blank", "noopener");
    if (nota !== (reporteAn.nota || "")) guardarAn({ nota }).then(abrir).catch((e) => avisar(e.message));
    else abrir();
  });
  $("#an-link").addEventListener("click", async (e) => {
    if (!reporteAn) return;
    if (reporteAn.link) return void window.open($("#an-link-url").value, "_blank", "noopener");
    const b = e.currentTarget;
    b.disabled = true;
    try {
      const nota = $("#an-nota").value.trim();
      if (nota !== (reporteAn.nota || "")) await api("/reportes", { method: "PATCH", body: { cliente: clienteAn, mes: reporteAn.mes, nota } });
      await api("/reportes/link", { method: "POST", body: { cliente: clienteAn, mes: reporteAn.mes } });
      sonar("accion");
      await cargarReporte();
      await cargarAnalitica();
    } catch (err) { avisar(err.message); }
    b.disabled = false;
  });
  $("#an-copiar").addEventListener("click", async (e) => {
    const b = e.currentTarget;
    try { await navigator.clipboard.writeText($("#an-link-url").value); }
    catch { $("#an-link-url").select(); document.execCommand?.("copy"); }
    b.textContent = "¡Copiado!";
    setTimeout(() => { b.textContent = "Copiar"; }, 1800);
  });
  $("#an-quitar").addEventListener("click", async (e) => {
    const b = e.currentTarget;
    if (!b.classList.contains("seguro")) { b.classList.add("seguro"); b.textContent = "¿Quitar? El cliente ya no podrá abrirlo"; setTimeout(() => { b.classList.remove("seguro"); b.textContent = "Quitar link"; }, 4000); return; }
    try { await api(`/reportes/link?cliente=${clienteAn}&mes=${reporteAn.mes}`, { method: "DELETE" }); sonar("accion"); await cargarAnalitica(); }
    catch (err) { avisar(err.message); }
  });

  // =====================================================================
  //  CONTENIDO POR ETAPAS
  // =====================================================================
  let ultimaCt = null;
  let etapaCel = "planeado"; // en el celular se ve una columna a la vez
  let clienteCt = guardado.get("delta_ct_cliente") || "";
  const FMT_ICONO = { reel: "▶", video: "▶", carrusel: "▤", post: "▢", historia: "◔", blog: "✎", otro: "•" };

  async function cargarContenido() {
    if (!clientesFi.length) await prepararFinanzas();
    const q = clienteCt ? `?cliente=${encodeURIComponent(clienteCt)}` : "";
    let t;
    try { t = await api(`/contenido${q}`); }
    catch (err) { if (!clienteCt) throw err; clienteCt = ""; guardado.set("delta_ct_cliente", ""); t = await api("/contenido"); }
    ultimaCt = t;
    pintarContenido(t);
  }

  const fechaPieza = (p) => {
    if (p.etapa === "publicado") return p.publicado ? `salió el ${fechaCorta(p.publicado)}` : "publicado";
    if (!p.publicar) return "sin fecha";
    if (p.atrasada) return `${p.dias_atraso} día${p.dias_atraso === 1 ? "" : "s"} atrasada`;
    if (p.dias_para_publicar === 0) return "sale hoy";
    if (p.dias_para_publicar === 1) return "sale mañana";
    return `sale el ${fechaCorta(p.publicar)}`;
  };

  function tarjetaPieza(p, i, ultima) {
    const n = p.atrasada ? "rojo" : p.espera_cliente_larga || (p.dias_para_publicar !== null && p.dias_para_publicar <= 1 && p.etapa !== "aprobado") ? "amarillo" : "";
    return `<article class="ct-pieza ${n ? "n-" + n : ""}" draggable="true" data-pieza-ct="${p.id}" tabindex="0" aria-label="${esc(p.titulo)}">
      <div class="ct-p-cabeza"><span class="ct-fmt" title="${esc(p.formato_nombre)}">${FMT_ICONO[p.formato] || "•"} ${esc(p.formato_nombre)}${p.red_nombre ? ` · ${esc(p.red_nombre)}` : ""}</span></div>
      <b class="ct-p-titulo">${esc(p.titulo)}</b>
      ${clienteCt ? "" : `<span class="ct-p-cliente">${esc(p.cliente)}</span>`}
      <div class="ct-p-pie">
        <span class="ct-p-fecha ${n ? "t-" + n : "tenue"}">${esc(fechaPieza(p))}${p.etapa === "cliente" && p.dias_en_etapa ? ` · lleva ${p.dias_en_etapa} día${p.dias_en_etapa === 1 ? "" : "s"}` : ""}</span>
        ${p.responsable ? `<span class="ct-p-resp tenue" title="Responsable">${esc(p.responsable)}</span>` : ""}
      </div>
      <div class="ct-p-mover">
        <button type="button" data-ct-mover="-1" aria-label="Etapa anterior" ${i === 0 ? "disabled" : ""}>‹</button>
        <button type="button" data-ct-mover="1" aria-label="Siguiente etapa" ${ultima ? "disabled" : ""}>›</button>
      </div>
    </article>`;
  }

  function pintarContenido(t) {
    // Filtro de cliente
    const sel = $("#ct-cliente");
    if (h.restringido() && !clienteCt && t.cliente) clienteCt = String(clientesFi.find((c) => c.nombre === t.cliente)?.id || "");
    sel.innerHTML = (h.restringido() ? "" : `<option value="">Todos los clientes</option>`) + clientesFi.map((c) => `<option value="${c.id}" ${String(c.id) === String(clienteCt) ? "selected" : ""}>${esc(c.nombre)}</option>`).join("");

    const kpi = (k) => `<div class="tb-kpi pg-kpi fi-kpi" ${k.ir ? `data-ct-ir="${k.ir}" role="button" tabindex="0"` : ""}>
        <span class="tb-kpi-nombre">${esc(k.nombre)}</span>
        <b>${esc(k.valor)}</b>
        ${k.chip ? `<span class="tb-chip s-${k.chip[0]}">${esc(k.chip[1])}</span>` : ""}
        <span class="tb-kpi-mes">${esc(k.extra || "")}</span>
        <span class="pg-kpi-pie">${k.pie || ""}</span>
      </div>`;
    const abiertas = t.etapas.filter((e) => e.clave !== "publicado").reduce((s, e) => s + e.piezas.length, 0);
    const mesNombre = MESES_LARGOS[Number(t.mes.slice(5)) - 1];
    $("#ct-kpis").innerHTML = [
      { nombre: `Publicadas en ${mesNombre}`, valor: `${t.publicadas_mes}${t.total_mes ? ` de ${t.total_mes}` : ""}`, extra: t.total_mes ? "con fecha este mes" : "pon fecha a las piezas del mes",
        pie: t.total_mes ? `<span class="pg-barra verde"><i data-ancho="${Math.round((t.publicadas_mes / t.total_mes) * 100)}"></i></span>` : "" },
      { nombre: "A tiempo", valor: t.a_tiempo_pct === null ? "–" : `${t.a_tiempo_pct} %`, chip: t.a_tiempo_pct === null ? null : [t.a_tiempo_pct >= 90 ? "verde" : t.a_tiempo_pct >= 70 ? "amarillo" : "rojo", t.a_tiempo_pct >= 90 ? "Muy bien" : t.a_tiempo_pct >= 70 ? "Regular" : "Bajo"], extra: "de lo publicado este mes" },
      { nombre: "Atrasadas", valor: String(t.atrasadas.length), chip: t.atrasadas.length ? ["rojo", "Revisar hoy"] : ["verde", "Al día"], extra: t.atrasadas.length ? "ya pasó su fecha" : "nada fuera de fecha", ir: t.atrasadas.length ? "atrasadas" : null },
      { nombre: "Con el cliente", valor: String(t.etapas.find((e) => e.clave === "cliente").piezas.length), chip: t.esperando_cliente.length ? ["amarillo", "Insistir"] : null, extra: t.esperando_cliente.length ? `${t.esperando_cliente.length} lleva${t.esperando_cliente.length === 1 ? "" : "n"} 2 días o más · ${abiertas} en proceso` : `${abiertas} pieza${abiertas === 1 ? "" : "s"} en proceso · ${t.esta_semana.length} sale${t.esta_semana.length === 1 ? "" : "n"} esta semana`, ir: "cliente" },
    ].map(kpi).join("");

    // Alertas: lo atrasado y lo que espera al cliente
    const alertas = [
      ...t.atrasadas.map((p) => ({ p, nivel: "rojo", txt: `${p.dias_atraso} día${p.dias_atraso === 1 ? "" : "s"} atrasada · etapa: ${p.etapa_nombre.toLowerCase()}` })),
      ...t.esperando_cliente.filter((p) => !p.atrasada).map((p) => ({ p, nivel: "amarillo", txt: `lleva ${p.dias_en_etapa} días esperando al cliente` })),
    ];
    $("#ct-alertas").hidden = !alertas.length;
    $("#ct-alertas").innerHTML = alertas.length
      ? `<div class="ag-cabeza"><h2>Para hoy</h2><span class="tb-hora">${alertas.length} pieza${alertas.length === 1 ? "" : "s"}</span></div>
        <ul class="pm-avisos ct-avisos">${alertas.slice(0, 8).map(({ p, nivel, txt }) => `<li class="pm-aviso n-${nivel}" data-pieza-ct="${p.id}" tabindex="0">${foco(nivel)}<span class="pg-linea-txt"><b>${esc(p.titulo)}</b><small>${esc(p.cliente)} · ${esc(txt)}</small></span></li>`).join("")}</ul>`
      : "";

    // Pestañas (celular) y columnas
    $("#ct-tabs").innerHTML = t.etapas.map((e) => `<button type="button" data-ct-tab="${e.clave}" class="${e.clave === etapaCel ? "activa" : ""}">${esc(e.nombre)} <small>${e.piezas.length}</small></button>`).join("");
    $("#ct-board").innerHTML = t.etapas.map((e, i) => `<section class="ct-col ${e.clave === etapaCel ? "sel" : ""}" data-ct-etapa="${e.clave}">
        <header class="ct-col-cabeza"><span>${esc(e.nombre)}</span><small>${e.piezas.length}</small>${e.clave === "planeado" ? `<button type="button" class="ct-mas" data-ct-nueva="planeado" aria-label="Nueva pieza">+</button>` : ""}</header>
        <div class="ct-col-piezas">${e.piezas.length ? e.piezas.map((p) => tarjetaPieza(p, i, i === t.etapas.length - 1)).join("") : `<p class="ct-vacia">${e.clave === "publicado" ? "Lo publicado este mes aparece aquí" : "Nada aquí"}</p>`}</div>
      </section>`).join("");
    medidas($('[data-seccion="contenido"]'));
  }

  // Diálogo para crear o editar una pieza
  function abrirPiezaCt(p = null, etapa = "planeado") {
    const t = ultimaCt;
    if (!t) return;
    $("#ct-dlg-titulo").textContent = p ? "Editar pieza" : "Nueva pieza";
    $("#ct-id").value = p?.id || "";
    $("#ct-titulo").value = p?.titulo || "";
    $("#ct-f-cliente").innerHTML = clientesFi.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("") || `<option value="">Primero da de alta un cliente</option>`;
    $("#ct-f-cliente").value = String(p?.cliente_id || clienteCt || clientesFi[0]?.id || "");
    $("#ct-etapa").innerHTML = t.etapas.map((e) => `<option value="${e.clave}">${esc(e.nombre)}</option>`).join("");
    $("#ct-etapa").value = p?.etapa || etapa;
    $("#ct-formato").innerHTML = Object.entries(t.formatos).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("");
    $("#ct-formato").value = p?.formato || "reel";
    $("#ct-red").innerHTML = `<option value="">—</option>` + Object.entries(t.redes).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("");
    $("#ct-red").value = p?.red || "instagram";
    $("#ct-publicar").value = p?.publicar || "";
    $("#ct-responsable").value = p?.responsable || "";
    $("#ct-enlace").value = p?.enlace || "";
    $("#ct-notas").value = p?.notas || "";
    $("#ct-msg").hidden = true;
    $("#ct-borrar").hidden = !p;
    $("#ct-borrar").textContent = "Quitar";
    $("#ct-borrar").classList.remove("seguro");
    $("#dlg-contenido").showModal();
    setTimeout(() => $("#ct-titulo").focus(), 50);
  }
  const piezaPorId = (id) => ultimaCt?.etapas.flatMap((e) => e.piezas).find((p) => p.id === Number(id))
    || ultimaCt?.atrasadas.find((p) => p.id === Number(id));

  $("#form-contenido").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $("#ct-id").value;
    const datos = {
      titulo: $("#ct-titulo").value.trim(), cliente: $("#ct-f-cliente").value, etapa: $("#ct-etapa").value,
      formato: $("#ct-formato").value, red: $("#ct-red").value || null, publicar: $("#ct-publicar").value || null,
      responsable: $("#ct-responsable").value.trim() || null, enlace: $("#ct-enlace").value.trim() || null, notas: $("#ct-notas").value.trim() || null,
    };
    try {
      await api(id ? `/contenido/${id}` : "/contenido", { method: id ? "PATCH" : "POST", body: datos });
      sonar("accion");
      $("#dlg-contenido").close();
      await cargarContenido();
    } catch (err) { $("#ct-msg").textContent = err.message; $("#ct-msg").hidden = false; }
  });
  $("#ct-cancelar").addEventListener("click", () => $("#dlg-contenido").close());
  $("#ct-borrar").addEventListener("click", async (e) => {
    const b = e.currentTarget;
    if (!b.classList.contains("seguro")) { b.classList.add("seguro"); b.textContent = "¿Seguro? Toca otra vez"; return; }
    try { await api(`/contenido/${$("#ct-id").value}`, { method: "DELETE" }); sonar("accion"); $("#dlg-contenido").close(); await cargarContenido(); }
    catch (err) { $("#ct-msg").textContent = err.message; $("#ct-msg").hidden = false; }
  });
  $("#ct-nueva").addEventListener("click", () => abrirPiezaCt(null, matchMedia("(max-width: 900px)").matches ? etapaCel : "planeado"));
  $("#ct-cliente").addEventListener("change", (e) => {
    clienteCt = e.target.value;
    guardado.set("delta_ct_cliente", clienteCt);
    cargarContenido().catch((err) => avisar(err.message));
  });

  async function moverPieza(id, cambio) {
    try {
      await api(`/contenido/${id}`, { method: "PATCH", body: cambio });
      sonar("accion");
    } catch (err) { avisar(err.message); }
    await cargarContenido().catch(() => {});
  }

  const seccionCt = $('[data-seccion="contenido"]');
  seccionCt.addEventListener("click", (e) => {
    const tab = e.target.closest("[data-ct-tab]");
    if (tab) {
      etapaCel = tab.dataset.ctTab;
      seccionCt.querySelectorAll("[data-ct-tab]").forEach((x) => x.classList.toggle("activa", x === tab));
      seccionCt.querySelectorAll(".ct-col").forEach((x) => x.classList.toggle("sel", x.dataset.ctEtapa === etapaCel));
      return;
    }
    const ir = e.target.closest("[data-ct-ir]");
    if (ir) {
      if (ir.dataset.ctIr === "atrasadas") return void $("#ct-alertas").scrollIntoView({ behavior: "smooth", block: "center" });
      etapaCel = ir.dataset.ctIr;
      seccionCt.querySelector(`[data-ct-tab="${etapaCel}"]`)?.click();
      return void seccionCt.querySelector(`.ct-col[data-ct-etapa="${etapaCel}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
    const nueva = e.target.closest("[data-ct-nueva]");
    if (nueva) return abrirPiezaCt(null, nueva.dataset.ctNueva);
    const mover = e.target.closest("[data-ct-mover]");
    const tarjeta = e.target.closest("[data-pieza-ct]");
    if (mover && tarjeta) {
      mover.disabled = true;
      return void moverPieza(tarjeta.dataset.piezaCt, { mover: Number(mover.dataset.ctMover) });
    }
    if (tarjeta) abrirPiezaCt(piezaPorId(tarjeta.dataset.piezaCt));
  });
  seccionCt.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches?.("[data-pieza-ct], [data-ct-ir]")) e.target.click();
  });
  // Arrastrar y soltar entre columnas (computadora)
  let arrastrando = null;
  seccionCt.addEventListener("dragstart", (e) => {
    const t = e.target.closest?.(".ct-pieza");
    if (!t) return;
    arrastrando = t.dataset.piezaCt;
    t.classList.add("arrastrando");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", arrastrando);
  });
  seccionCt.addEventListener("dragend", (e) => {
    e.target.closest?.(".ct-pieza")?.classList.remove("arrastrando");
    seccionCt.querySelectorAll(".ct-col.encima").forEach((x) => x.classList.remove("encima"));
    arrastrando = null;
  });
  seccionCt.addEventListener("dragover", (e) => {
    const col = e.target.closest?.(".ct-col");
    if (!col || !arrastrando) return;
    e.preventDefault();
    seccionCt.querySelectorAll(".ct-col.encima").forEach((x) => x !== col && x.classList.remove("encima"));
    col.classList.add("encima");
  });
  seccionCt.addEventListener("drop", (e) => {
    const col = e.target.closest?.(".ct-col");
    if (!col || !arrastrando) return;
    e.preventDefault();
    const id = arrastrando;
    const p = piezaPorId(id);
    col.classList.remove("encima");
    if (p && p.etapa !== col.dataset.ctEtapa) moverPieza(id, { etapa: col.dataset.ctEtapa });
  });

  // =====================================================================
  //  PAID MEDIA
  // =====================================================================
  let mesPm = null; // null = mes actual
  let ultimaPm = null;
  const PLAT = { meta: "Meta", google: "Google", tiktok: "TikTok", otra: "Otra" };
  const roasNivel = (r) => (r === null || r === undefined ? null : r >= 3 ? "verde" : r >= 1 ? "amarillo" : "rojo");
  const roasTxt = (r) => (r === null || r === undefined ? "–" : `${r.toLocaleString("es-MX", { maximumFractionDigits: 1 })}x`);
  const entero = (n) => (n === null || n === undefined ? "–" : Number(n).toLocaleString("es-MX"));

  async function cargarPaidMedia() {
    if (!clientesFi.length) await prepararFinanzas();
    const p = await api(`/paidmedia${mesPm ? `?mes=${mesPm}` : ""}`);
    ultimaPm = p;
    pintarPaidMedia(p);
  }

  function pintarPaidMedia(p) {
    const mesLargo = p.nombre_mes.charAt(0).toUpperCase() + p.nombre_mes.slice(1);
    $("#pm-hoy").textContent = mesLargo;
    $("#pm-hoy").title = p.es_mes_actual ? "Este mes" : "Volver a este mes";
    $("#pm-despues").disabled = p.es_mes_actual;
    const kpi = (k) => `<div class="tb-kpi pg-kpi fi-kpi" ${k.ir ? `data-fi-ir="${k.ir}" role="button" tabindex="0"` : ""}>
        <span class="tb-kpi-nombre">${esc(k.nombre)}</span>
        <b>${esc(k.valor)}</b>
        ${k.chip ? `<span class="tb-chip s-${k.chip[0]}">${esc(k.chip[1])}</span>` : ""}
        <span class="tb-kpi-mes">${esc(k.extra || "")}</span>
        <span class="pg-kpi-pie">${k.pie || ""}</span>
      </div>`;
    const cambio = p.cambio_inversion;
    const rn = roasNivel(p.roas);
    $("#pm-kpis").innerHTML = [
      { nombre: "Inversión en anuncios", valor: dinero0(p.inversion), chip: cambio === null ? null : ["", conSignoPct(cambio)], extra: p.tope ? `de ${dinero0(p.tope)} de tope` : p.inversion_anterior ? `vs ${dinero0(p.inversion_anterior)} el mes anterior` : "de todos los clientes", pie: p.tope ? barra(p.inversion, p.tope) : "" },
      { nombre: "Contactos", valor: entero(p.contactos), extra: "mensajes y prospectos", ir: "#pm-clientes" },
      { nombre: "Costo por contacto", valor: p.costo_por_contacto === null ? "–" : dinero(p.costo_por_contacto), extra: p.costo_por_contacto === null ? "falta saber cuántos llegaron" : "promedio de la agencia" },
      { nombre: "Retorno", valor: roasTxt(p.roas), chip: rn ? [rn, rn === "verde" ? "Bueno" : rn === "amarillo" ? "Justo" : "Pierde"] : null, extra: p.valor_ventas !== null ? `${dinero0(p.valor_ventas)} vendidos${p.ventas ? ` · ${entero(p.ventas)} venta${p.ventas === 1 ? "" : "s"}` : ""}` : "anota lo que venden tus clientes" },
    ].map(kpi).join("").replace('tb-chip s-"', 'tb-chip"');

    // Avisos
    const urg = p.avisos.filter((a) => a.nivel !== "info");
    $("#pm-avisos-n").textContent = urg.length ? `${urg.length} por revisar` : "";
    $("#pm-avisos").innerHTML = p.avisos.length
      ? p.avisos.map((a) => `<li class="pm-aviso n-${a.nivel}" data-cuenta="${a.cliente_id}" tabindex="0">
          ${foco(a.nivel)}
          <span class="pg-linea-txt"><b>${esc(a.cliente)}</b><small>${esc(a.texto)}</small></span>
        </li>`).join("")
      : vacio(p.clientes.length ? "Todo en orden con los anuncios ✨" : "Aún no hay clientes con anuncios este mes.");

    // Por cliente
    $("#pm-cli-mes").textContent = mesLargo;
    $("#pm-clientes").innerHTML = p.clientes.length
      ? `<div class="fi-rent-fila fi-rent-cabeza pm-fila tenue"><span>Cliente</span><span>Inversión</span><span>Contactos</span><span>Costo c/u</span><span>Retorno</span></div>` +
        p.clientes.map((c) => {
          const r = roasNivel(c.roas);
          return `<div class="fi-rent-fila pm-fila" data-cuenta="${c.id}" tabindex="0">
            <span class="fi-rent-nombre"><b>${foco(c.nivel)}${esc(c.nombre)}</b>${c.tope ? barra(c.inversion, c.tope).replace("pg-barra", "pg-barra fi-rent-barra") : ""}<small class="tenue">${[c.tope ? `${c.uso_tope} % del tope` : "", c.fuente_resultados === "cliente" ? "lo reporta el cliente" : c.fuente_resultados === "meta" ? "según Meta" : ""].filter(Boolean).join(" · ")}</small></span>
            <span>${dinero0(c.inversion)}</span>
            <span>${entero(c.contactos)}</span>
            <span>${c.costo_por_contacto === null ? "–" : dinero(c.costo_por_contacto)}</span>
            <span>${r ? `<span class="tb-chip s-${r}">${roasTxt(c.roas)}</span>` : `<span class="tenue">–</span>`}</span>
          </div>`;
        }).join("")
      : `<p class="pg-vacio">Ningún cliente tiene anuncios este mes. Asigna sus cuentas de anuncios en <a href="#" data-abrir-meta>Meta</a> o anota su gasto en su ficha.</p>`;

    // Campañas
    const acts = p.campanas.filter((k) => k.activa).length;
    $("#pm-camp-n").textContent = p.campanas.length ? `${acts} activa${acts === 1 ? "" : "s"} · ${p.campanas.length} con gasto` : "";
    const alerta = new Map(p.avisos.filter((a) => a.campana_id).map((a) => [a.campana_id, a]));
    $("#pm-campanas").innerHTML = p.campanas.length
      ? p.campanas.map((k) => {
          const a = alerta.get(k.id);
          const res = k.solo_alcance ? `${compacto.format(k.alcance || k.impresiones)} personas` : `${entero(k.resultados)} resultado${k.resultados === 1 ? "" : "s"}`;
          return `<div class="pm-camp ${a ? "n-" + a.nivel : ""}" data-cuenta="${k.cliente_id}" tabindex="0">
            <div class="pm-camp-cabeza"><i class="pm-estado ${k.activa ? "on" : ""}" title="${k.activa ? "Activa" : "Apagada"}"></i><b>${esc(k.nombre)}</b><span class="tenue">${esc(k.cliente)}</span></div>
            <div class="pm-camp-datos">
              <span><small>Gasto</small>${dinero0(k.gasto)}</span>
              <span><small>${k.solo_alcance ? "Alcance" : "Resultados"}</small>${res}</span>
              <span><small>Costo c/u</small>${k.costo_resultado === null || k.solo_alcance ? "–" : dinero(k.costo_resultado)}</span>
              <span><small>${k.roas !== null ? "Retorno" : "Frecuencia"}</small>${k.roas !== null ? roasTxt(k.roas) : (k.frecuencia || 0).toLocaleString("es-MX", { maximumFractionDigits: 1 })}</span>
            </div>
            ${k.objetivo_nombre ? `<small class="tenue">${esc(k.objetivo_nombre)}${k.semana?.gasto ? ` · últimos 7 días: ${dinero0(k.semana.gasto)} y ${entero(k.semana.resultados)} resultado${k.semana.resultados === 1 ? "" : "s"}` : ""}</small>` : ""}
            ${a ? `<small class="t-${a.nivel}">${esc(a.texto.replace(/^"[^"]+"\s*:?\s*/, ""))}</small>` : ""}
          </div>`;
        }).join("")
      : `<p class="pg-vacio">${p.cuentas_meta ? "Meta aún no trae campañas con gasto este mes." : "Cuando conectes Meta y asignes las cuentas de anuncios a cada cliente, aquí verás cada campaña con su gasto y resultados."} <a href="#" data-abrir-meta>Abrir Meta</a></p>`;

    // Gráfica 6 meses
    $("#pm-grafica").innerHTML = graficaPm(p.historia, p.mes);

    // Plataformas
    $("#pm-plat-mes").textContent = mesLargo;
    const maxP = Math.max(1, ...p.por_plataforma.map((x) => x.monto));
    $("#pm-plataformas").innerHTML = p.por_plataforma.length
      ? p.por_plataforma.map((x) => `<div class="fi-cat"><span>${esc(PLAT[x.plataforma] || x.plataforma)}</span><b>${dinero0(x.monto)}</b><span class="pg-barra"><i data-ancho="${Math.round((x.monto / maxP) * 100)}"></i></span></div>`).join("")
      : `<p class="tenue chico">Sin inversión anotada este mes.</p>`;

    // Formulario
    const elegido = $("#pm-form-cliente").value;
    $("#pm-form-cliente").innerHTML = clientesFi.map((c) => `<option value="${c.id}" ${String(c.id) === elegido ? "selected" : ""}>${esc(c.nombre)}</option>`).join("") || `<option value="">Primero da de alta un cliente</option>`;

    medidas($('[data-seccion="paidmedia"]'));
  }

  function graficaPm(h, mesSel) {
    const W = 520, H = 190, izq = 46, der = 34, abajo = 22, arriba = 12;
    const maxI = Math.max(1, ...h.map((x) => x.inversion));
    const maxC = Math.max(1, ...h.map((x) => x.contactos));
    const alto = H - arriba - abajo;
    const yI = (v) => arriba + alto * (1 - v / maxI);
    const yC = (v) => arriba + alto * (1 - v / maxC);
    const paso = (W - izq - der) / h.length;
    const ancho = Math.max(8, paso * 0.45);
    const hayC = h.some((x) => x.contactos);
    const pts = h.map((x, i) => `${izq + paso * i + paso / 2},${yC(x.contactos).toFixed(1)}`).join(" ");
    return `<svg viewBox="0 0 ${W} ${H}" class="fi-svg" role="img" aria-label="Inversión en anuncios y contactos de los últimos 6 meses">
      ${[0, 0.5, 1].map((q) => `<line x1="${izq}" x2="${W - der}" y1="${yI(maxI * q)}" y2="${yI(maxI * q)}" class="fi-reja"/><text x="${izq - 6}" y="${yI(maxI * q) + 4}" class="fi-eje" text-anchor="end">$${maxI * q >= 1000 ? compacto.format(maxI * q) : Math.round(maxI * q)}</text>${hayC ? `<text x="${W - der + 6}" y="${yC(maxC * q) + 4}" class="fi-eje pm-eje-c">${Math.round(maxC * q)}</text>` : ""}`).join("")}
      ${h.map((x, i) => {
        const cx = izq + paso * i + paso / 2;
        const sel = x.mes === mesSel ? "sel" : "";
        return `<g class="fi-mes-g ${sel}" data-pm-mes="${x.mes}">
          <title>${MESES[Number(x.mes.slice(5)) - 1]} ${x.mes.slice(0, 4)}: ${dinero0(x.inversion)} invertidos, ${entero(x.contactos)} contactos</title>
          <rect x="${cx - paso / 2}" y="${arriba}" width="${paso}" height="${alto}" class="fi-zona"/>
          <rect x="${cx - ancho / 2}" y="${yI(x.inversion)}" width="${ancho}" height="${Math.max(0, yI(0) - yI(x.inversion))}" rx="3" class="fi-ing"/>
          <text x="${cx}" y="${H - 6}" class="fi-eje ${sel}" text-anchor="middle">${MESES[Number(x.mes.slice(5)) - 1]}</text>
        </g>`;
      }).join("")}
      ${hayC ? `<polyline points="${pts}" class="fi-util pm-linea"/>${h.map((x, i) => `<circle cx="${izq + paso * i + paso / 2}" cy="${yC(x.contactos)}" r="${x.mes === mesSel ? 4 : 2.5}" class="fi-util-p pm-punto"/>`).join("")}` : ""}
    </svg>
    <div class="fi-ley"><span><i class="fi-ing"></i>Inversión</span><span><i class="fi-util pm-linea"></i>Contactos</span>${h.some((x) => x.inversion) ? "" : `<span class="tenue">Se irá llenando mes con mes.</span>`}</div>`;
  }

  $("#pm-antes").addEventListener("click", () => { mesPm = moverMes(ultimaPm?.mes || new Date().toISOString().slice(0, 7), -1); cargarPaidMedia().catch((e) => avisar(e.message)); });
  $("#pm-despues").addEventListener("click", () => { if (!ultimaPm || ultimaPm.es_mes_actual) return; mesPm = moverMes(ultimaPm.mes, 1); cargarPaidMedia().catch((e) => avisar(e.message)); });
  $("#pm-hoy").addEventListener("click", () => { mesPm = null; cargarPaidMedia().catch((e) => avisar(e.message)); });
  $("#pm-grafica").addEventListener("click", (e) => {
    const g = e.target.closest("[data-pm-mes]");
    if (!g) return;
    mesPm = g.dataset.pmMes;
    cargarPaidMedia().catch((err) => avisar(err.message));
  });
  $("#pm-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = e.target.querySelector("button[type=submit]");
    const v = (id) => $(id).value.trim() || undefined;
    b.disabled = true;
    try {
      await api("/paidmedia/resultados", { method: "PUT", body: {
        cliente: $("#pm-form-cliente").value, mes: ultimaPm?.mes,
        prospectos: v("#pm-form-prospectos"), ventas: v("#pm-form-ventas"), valor_ventas: v("#pm-form-valor"),
      } });
      sonar("accion");
      e.target.reset();
      await cargarPaidMedia();
    } catch (err) { avisar(err.message); }
    b.disabled = false;
  });
  $('[data-seccion="paidmedia"]').addEventListener("click", (e) => {
    const ir = e.target.closest("[data-fi-ir]");
    if (!ir) return;
    const destino = $(ir.dataset.fiIr);
    (destino?.closest(".panel") || destino)?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (destino?.tagName === "FORM") setTimeout(() => destino.querySelector("select, input")?.focus(), 350);
  });

  async function abrirCuenta(id, { mover = true } = {}) {
    elegida = Number(id);
    guardado.set("delta_cuenta", String(elegida));
    if (location.hash !== "#/cuentas") location.hash = "#/cuentas";
    document.querySelectorAll("#cu-lista [data-cuenta]").forEach((x) => x.classList.toggle("elegida", Number(x.dataset.cuenta) === elegida));
    await cargarFicha(elegida);
    if (mover && matchMedia("(max-width: 900px)").matches) $("#cu-ficha").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Toques: una tarjeta, alerta, fila o entrega con data-cuenta abre la ficha del cliente.
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-abrir-meta]")) { e.preventDefault(); return void abrirMeta().catch((err) => avisar(err.message)); }
    const mc = e.target.closest("[data-meta-cliente]");
    if (mc) {
      mc.disabled = true;
      mc.textContent = "Actualizando…";
      return void api(`/clientes/${mc.dataset.metaCliente}/meta`, { method: "POST" })
        .then(() => { sonar("accion"); return cargarFicha(mc.dataset.metaCliente); })
        .catch((err) => { avisar(err.message); mc.disabled = false; mc.textContent = "Actualizar"; });
    }
    if (e.target.closest("select, input, button[type=submit], a[href]:not([data-cuenta])")) return;
    const x = e.target.closest("[data-cuenta]");
    if (x) return void abrirCuenta(x.dataset.cuenta).catch((err) => avisar(err.message));
    const ir = e.target.closest("[data-ir-a]");
    if (ir) return void (location.hash = ir.dataset.irA);
    const bajar = e.target.closest("[data-bajar]");
    if (bajar) $(bajar.dataset.bajar)?.closest(".panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const x = e.target.closest?.("[data-cuenta][tabindex], [data-ir-a][tabindex], [data-fi-ir][tabindex]");
    if (x) x.click();
  });

  // =====================================================================
  //  TENDENCIAS
  // =====================================================================
  let ultimaTe = null;
  let clienteTe = guardado.get("delta_te_cliente") || "";
  const URGENCIA = { hoy: ["rojo", "Aprovechar hoy"], semana: ["amarillo", "Esta semana"], siempre: ["verde", "No caduca"] };
  const veces = (n) => `${Number(n).toLocaleString("es-MX", { maximumFractionDigits: 1 })}×`;
  const enlaceExt = (url, txt, clase = "") => (url && /^https?:\/\//.test(url) ? `<a class="${clase}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${txt}</a>` : txt);

  async function cargarTendencias() {
    if (!clientesFi.length) await prepararFinanzas();
    const activos = clientesFi.filter((c) => c.estado === "activo");
    if (!activos.some((c) => String(c.id) === String(clienteTe))) clienteTe = activos[0] ? String(activos[0].id) : "";
    const t = await api(`/tendencias${clienteTe ? `?cliente=${encodeURIComponent(clienteTe)}` : ""}`);
    ultimaTe = t;
    pintarTendencias(t);
  }

  function pintarTendencias(t) {
    const sel = $("#te-cliente");
    sel.innerHTML = t.clientes.length
      ? t.clientes.map((c) => `<option value="${c.id}" ${String(c.id) === String(clienteTe) ? "selected" : ""}>${esc(c.nombre)}${c.ideas_nuevas ? ` · ${c.ideas_nuevas} idea${c.ideas_nuevas === 1 ? "" : "s"}` : ""}</option>`).join("")
      : `<option value="">Sin clientes activos</option>`;
    const d = t.detalle;
    $("#te-buscar").disabled = !d || d.buscando;
    $("#te-config").disabled = !d;

    // Lo que México busca hoy (para todos)
    $("#te-hoy-hora").textContent = t.hoy.error ? (t.hoy.fecha ? `visto ${haceRato(t.hoy.fecha)}` : "sin conexión") : "en vivo";
    $("#te-hoy").innerHTML = t.hoy.lista.length
      ? t.hoy.lista.slice(0, 10).map((x) => `<li><span class="te-hoy-tema">${enlaceExt(x.noticias?.[0]?.enlace, esc(x.tema))}</span>${x.busquedas ? `<small class="tenue">${esc(x.busquedas)} búsquedas</small>` : ""}</li>`).join("")
      : `<li class="pg-vacio">${t.hoy.error ? "Google Tendencias no respondió. Se intenta otra vez en un rato." : "Sin datos por ahora."}</li>`;

    if (!d) {
      $("#te-nicho").innerHTML = `<p class="pg-vacio">Da de alta a tus clientes en Cuentas para ver sus tendencias.</p>`;
      $("#te-ideas").innerHTML = ""; $("#te-ig").innerHTML = ""; $("#te-temas").innerHTML = "";
      $("#te-avisos").hidden = true; $("#te-usadas").hidden = true; $("#te-hora").textContent = "";
      return;
    }
    guardado.set("delta_te_cliente", String(d.cliente.id));

    // Nicho del cliente
    const chips = (l) => l.map((x) => `<span class="te-chip">${esc(x)}</span>`).join("");
    $("#te-nicho").innerHTML = `
      <div class="te-nicho-fila"><small>Temas${d.sugeridas ? " <i class=\"tenue\">(tomados de su ficha)</i>" : ""}</small><div class="te-chips">${d.palabras.length ? chips(d.palabras) : `<span class="tenue">Sin temas: agrégalos para buscar noticias y búsquedas.</span>`}</div></div>
      <div class="te-nicho-fila"><small>Cuentas de referencia</small><div class="te-chips">${d.cuentas.length ? d.cuentas.map((u) => enlaceExt(`https://www.instagram.com/${u}/`, `@${esc(u)}`, "te-chip")).join("") : `<span class="tenue">Sin cuentas: agrega su competencia o creadores del nicho para ver qué les funciona.</span>`}</div></div>
      ${!d.meta_conectado && d.cuentas.length ? `<p class="tenue chico">Conecta Meta (en Cuentas) para ver sus cuentas de Instagram.</p>` : ""}`;

    $("#te-hora").textContent = d.buscando ? "Buscando…" : d.ultima ? `Actualizado ${haceRato(d.ultima)}` : "Sin buscar todavía";
    $("#te-avisos").hidden = !d.avisos.length;
    $("#te-avisos").innerHTML = d.avisos.map((a) => `<li>${foco("amarillo")}<span>${esc(a)}</span></li>`).join("");

    // Ideas
    $("#te-ideas").innerHTML = d.ideas.length
      ? d.ideas.map((i) => {
        const [n, txt] = URGENCIA[i.urgencia] || URGENCIA.semana;
        return `<article class="te-idea" data-idea="${i.id}">
          <div class="te-idea-cabeza"><span class="ct-fmt">${FMT_ICONO[i.formato] || "•"} ${esc(i.formato_nombre)} · ${esc(i.red_nombre)}</span><span class="tb-chip s-${n}">${txt}</span></div>
          <b class="te-idea-titulo">${esc(i.titulo)}</b>
          ${i.gancho ? `<p class="te-gancho">“${esc(i.gancho)}”</p>` : ""}
          ${i.por_que ? `<p class="te-porque">${esc(i.por_que)}</p>` : ""}
          ${i.pasos.length ? `<details class="te-pasos"><summary>Cómo hacerlo</summary><ol>${i.pasos.map((p) => `<li>${esc(p)}</li>`).join("")}</ol></details>` : ""}
          ${i.basada_en ? `<small class="te-base tenue">Basada en: ${esc(i.basada_en)}</small>` : ""}
          <div class="te-idea-pie">
            <button type="button" class="fi-quitar" data-te-descartar="${i.id}">Descartar</button>
            <button type="button" class="ag-agregar" data-te-usar="${i.id}">Pasar a Contenido</button>
          </div>
        </article>`;
      }).join("")
      : `<p class="pg-vacio te-vacio">${d.buscando ? "Buscando lo que se mueve en su nicho…" : !t.claude ? "Las ideas las prepara DELTA con Claude; falta conectarlo." : d.ultima ? "Ya usaste o descartaste todas las ideas. Toca <b>Buscar ahora</b> para más." : "Toca <b>Buscar ahora</b> y en unos segundos tendrás ideas para este cliente."}</p>`;

    $("#te-usadas").hidden = !d.usadas.length;
    $("#te-usadas summary").textContent = `${d.usadas.length} idea${d.usadas.length === 1 ? "" : "s"} ya en Contenido`;
    $("#te-usadas ul").innerHTML = d.usadas.map((i) => `<li><a href="#/contenido">${esc(i.titulo)}</a></li>`).join("");

    // Señales
    const s = d.senales || {};
    $("#te-ig").innerHTML = (s.instagram || []).length
      ? s.instagram.map((x) => `<li class="te-sen">
          <span class="te-veces" title="Interacciones contra lo normal de esa cuenta">${veces(x.veces)}</span>
          <span class="te-sen-txt">${enlaceExt(x.enlace, `<b>@${esc(x.cuenta)}</b> · ${esc(FORMATOS_TE[x.formato] || x.formato)}`)}
            <small>${esc(x.texto || "(sin texto)")}</small>
            <small class="tenue">${cifra(x.me_gusta)} me gusta · ${cifra(x.comentarios)} comentarios · ${haceRato(x.fecha)}</small></span>
        </li>`).join("")
      : `<li class="pg-vacio">${!d.cuentas.length ? "Agrega cuentas de referencia en <b>Nicho y cuentas</b>." : d.ultima ? "Nada fuera de lo normal en sus cuentas este mes." : "Aún no se ha buscado."}</li>`;
    const temas = [
      ...(s.busquedas || []).map((x) => ({ tipo: "Google", titulo: x.tema, extra: x.busquedas ? `${x.busquedas} búsquedas hoy` : "", enlace: x.noticias?.[0]?.enlace })),
      ...(s.noticias || []).map((x) => ({ tipo: "Noticia", titulo: x.titulo, extra: [x.fuente, x.fecha && haceRato(x.fecha)].filter(Boolean).join(" · "), enlace: x.enlace })),
    ];
    $("#te-temas").innerHTML = temas.length
      ? temas.slice(0, 10).map((x) => `<li class="te-sen"><span class="te-tipo ${x.tipo === "Google" ? "g" : ""}">${x.tipo}</span><span class="te-sen-txt">${enlaceExt(x.enlace, `<b>${esc(x.titulo)}</b>`)}${x.extra ? `<small class="tenue">${esc(x.extra)}</small>` : ""}</span></li>`).join("")
      : `<li class="pg-vacio">${!d.palabras.length ? "Agrega los temas de su nicho." : d.ultima ? "Nada nuevo de su tema esta semana." : "Aún no se ha buscado."}</li>`;
  }
  const FORMATOS_TE = { reel: "Reel", carrusel: "Carrusel", video: "Video", post: "Post" };

  async function buscarTe() {
    const id = ultimaTe?.detalle?.cliente.id;
    if (!id) return;
    const b = $("#te-buscar");
    b.disabled = true;
    b.textContent = "Buscando…";
    $("#te-hora").textContent = "Buscando… (unos segundos)";
    try {
      const r = await api("/tendencias/buscar", { method: "POST", body: { cliente: id } });
      sonar("accion");
      if (r.sin_claude) avisar("Se juntaron las señales, pero las ideas necesitan que Claude esté conectado.");
    } catch (err) { avisar(err.message); }
    b.textContent = "Buscar ahora";
    await cargarTendencias().catch(() => {});
  }

  $("#te-cliente").addEventListener("change", (e) => {
    clienteTe = e.target.value;
    cargarTendencias().catch((err) => avisar(err.message));
  });
  $("#te-buscar").addEventListener("click", buscarTe);
  $("#te-config").addEventListener("click", () => {
    const d = ultimaTe?.detalle;
    if (!d) return;
    $("#te-dlg-titulo").textContent = `Nicho de ${d.cliente.nombre}`;
    $("#te-palabras").value = d.palabras.join(", ");
    $("#te-cuentas").value = d.cuentas.map((u) => "@" + u).join(", ");
    $("#te-msg").hidden = true;
    $("#dlg-tendencias").showModal();
  });
  $("#te-cancelar").addEventListener("click", () => $("#dlg-tendencias").close());
  $("#form-tendencias").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/tendencias/config", { method: "PUT", body: { cliente: ultimaTe.detalle.cliente.id, palabras: $("#te-palabras").value, cuentas: $("#te-cuentas").value } });
      $("#dlg-tendencias").close();
      await buscarTe();
    } catch (err) { $("#te-msg").textContent = err.message; $("#te-msg").hidden = false; }
  });
  $("#te-ideas").addEventListener("click", async (e) => {
    const usar = e.target.closest("[data-te-usar]");
    const quitar = e.target.closest("[data-te-descartar]");
    if (!usar && !quitar) return;
    const b = usar || quitar;
    b.disabled = true;
    try {
      if (usar) {
        await api(`/tendencias/ideas/${usar.dataset.teUsar}/contenido`, { method: "POST", body: {} });
        avisar("Lista: la idea quedó en Contenido como planeada. Ponle fecha cuando la agenden.");
      } else {
        await api(`/tendencias/ideas/${quitar.dataset.teDescartar}`, { method: "DELETE" });
      }
      sonar("accion");
      await cargarTendencias();
    } catch (err) { b.disabled = false; avisar(err.message); }
  });

  // =====================================================================
  //  SEO Y WEB
  // =====================================================================
  let ultimaSeo = null;
  let clienteSeo = guardado.get("delta_seo_cliente") || "";
  let propsSeo = null;
  const sinDominio = (u) => String(u || "").replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
  const ruta = (u) => { try { const x = new URL(u); return (x.pathname + x.search) || "/"; } catch { return u; } };
  const cambioChip = (pct, alReves = false) => {
    if (pct === null || pct === undefined) return null;
    const bueno = alReves ? pct < 0 : pct > 0;
    return [pct === 0 ? "" : bueno ? "verde" : "rojo", `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct)} %`];
  };

  async function cargarSeo() {
    const t = await api(`/seo${clienteSeo ? `?cliente=${encodeURIComponent(clienteSeo)}` : ""}`).catch(async (err) => {
      if (!clienteSeo) throw err;
      clienteSeo = "";
      return api("/seo");
    });
    if (!t.detalle && t.clientes.length) {
      clienteSeo = String(t.clientes[0].id);
      return cargarSeo();
    }
    ultimaSeo = t;
    if (t.google.conectado && !propsSeo) propsSeo = await api("/seo/propiedades").catch(() => null);
    pintarSeo(t);
  }

  function pintarSeo(t) {
    $("#seo-google").textContent = t.google.conectado ? "Google conectado ✓" : "Conectar Google";
    $("#seo-google").title = t.google.conectado ? `${t.google.cuenta || ""} · toca para desconectar` : "Para ver visitas y posiciones en Google";
    $("#seo-n").textContent = String(t.clientes.length);
    $("#seo-lista").innerHTML = t.clientes.length
      ? t.clientes.map((c) => `<button type="button" class="an-cli ${String(c.id) === String(clienteSeo) ? "elegida" : ""} ${c.sitio ? "" : "sin"}" data-seo-cliente="${c.id}">
          <span class="an-cli-cabeza"><b>${esc(c.nombre)}</b>${c.salud !== null ? `<span class="sc-chip c-${c.color}" title="Salud del sitio">${c.salud}</span>` : ""}</span>
          ${c.sitio ? `<small class="seo-dom ${c.caido ? "t-rojo" : "tenue"}">${c.caido ? "⚠ no abre · " : ""}${esc(sinDominio(c.sitio))}</small>
          <span class="an-cli-datos seo-cli-datos">
            <span><small>Visitas</small>${c.visitas === null ? `<span class="tenue">–</span>` : cifra(c.visitas)}</span>
            <span><small>Clics Google</small>${c.clics === null ? `<span class="tenue">–</span>` : cifra(c.clics)}</span>
            <span><small>Posición</small>${c.posicion === null ? `<span class="tenue">–</span>` : Number(c.posicion).toLocaleString("es-MX", { maximumFractionDigits: 1 })}</span>
          </span>` : `<small class="tenue">Sin sitio anotado</small>`}
        </button>`).join("")
      : `<p class="pg-vacio">Aún no hay clientes activos.</p>`;

    const d = t.detalle;
    $("#seo-revisar").disabled = !d || !d.sitio || d.revisando;
    if (!d) { $("#seo-titulo").textContent = "Sitio"; return; }
    guardado.set("delta_seo_cliente", String(d.cliente.id));
    const r = d.revision;
    const g = d.google || {};
    const sc = g.search_console, ga = g.analytics;
    $("#seo-titulo").textContent = d.cliente.nombre;
    $("#seo-hora").textContent = d.revisando ? "Revisando…" : r ? `Revisado ${haceRato(r.fecha)}` : d.sitio ? "Sin revisar todavía" : "";
    $("#seo-url").value = d.sitio ? sinDominio(d.sitio) : "";
    $("#seo-url").placeholder = "clinica.mx";
    // Search Console y Analytics: elegir la propiedad del cliente
    const conG = t.google.conectado;
    $("#seo-gsc-caja").hidden = !conG;
    $("#seo-ga-caja").hidden = !conG;
    if (conG) {
      const sc0 = propsSeo?.search_console || [], ga0 = propsSeo?.analytics || [];
      $("#seo-gsc").innerHTML = `<option value="">— Ninguno —</option>` + [...new Set([...sc0, d.gsc_sitio].filter(Boolean))].map((x) => `<option value="${esc(x)}" ${x === d.gsc_sitio ? "selected" : ""}>${esc(x.replace(/^sc-domain:/, ""))}</option>`).join("");
      $("#seo-ga").innerHTML = `<option value="">— Ninguna —</option>` + ga0.map((x) => `<option value="${esc(x.id)}" ${x.id === d.ga4_propiedad ? "selected" : ""}>${esc(x.nombre)}</option>`).join("")
        + (d.ga4_propiedad && !ga0.some((x) => x.id === d.ga4_propiedad) ? `<option value="${esc(d.ga4_propiedad)}" selected>${esc(d.ga4_propiedad)}</option>` : "");
    }
    const nota = $("#seo-google-nota");
    const errores = [...(g.errores || []), ...(propsSeo?.errores || [])];
    nota.hidden = false;
    nota.innerHTML = !t.google.disponible ? "Para ver visitas y posiciones en Google hace falta configurar la conexión con Google en Railway (la misma de Gmail). Mientras, la revisión del sitio funciona sin nada."
      : !conG ? "Conecta Google (arriba) para ver las visitas de Analytics y las posiciones en Search Console."
      : errores.length ? esc(errores[0])
      : !d.gsc_sitio && !d.ga4_propiedad ? "Elige su Search Console y su Analytics para ver sus números de Google."
      : "";
    nota.hidden = !nota.innerHTML;
    nota.classList.toggle("t-rojo", Boolean(errores.length));

    // KPIs
    const kpi = (k) => `<div class="tb-kpi pg-kpi fi-kpi">
        <span class="tb-kpi-nombre">${esc(k.nombre)}</span><b>${esc(k.valor)}</b>
        ${k.chip?.[1] ? `<span class="tb-chip s-${k.chip[0]}">${esc(k.chip[1])}</span>` : ""}
        <span class="tb-kpi-mes">${esc(k.extra || "")}</span><span class="pg-kpi-pie">${k.pie || ""}</span>
      </div>`;
    const cuando = sc?.periodo ? `últimos 28 días vs anteriores` : "conecta Google";
    $("#seo-kpis").innerHTML = [
      { nombre: "Salud del sitio", valor: r ? (r.caido ? "No abre" : `${r.salud}/100`) : "–", chip: r ? [r.color, r.caido ? "Urgente" : r.salud >= 80 ? "Bien" : r.salud >= 60 ? "Regular" : "Mejorar"] : null,
        extra: r ? `${r.rojos} urgente${r.rojos === 1 ? "" : "s"} · ${r.amarillos} por mejorar` : d.sitio ? "toca Revisar sitio" : "anota su sitio",
        pie: r && !r.caido ? `<span class="pg-barra ${r.color}"><i data-ancho="${r.salud}"></i></span>` : "" },
      { nombre: "Visitas al sitio", valor: ga?.visitas !== null && ga?.visitas !== undefined ? Number(ga.visitas).toLocaleString("es-MX") : "–", chip: cambioChip(ga?.visitas_cambio), extra: ga ? `${Number(ga.personas || 0).toLocaleString("es-MX")} personas · ${cuando}` : "Google Analytics · " + cuando },
      { nombre: "Clics desde Google", valor: sc ? Number(sc.clics).toLocaleString("es-MX") : "–", chip: cambioChip(sc?.clics_cambio), extra: sc ? `apareció ${cifra(sc.apariciones)} veces en Google` : "Search Console · " + cuando },
      { nombre: "Posición promedio", valor: sc?.posicion ? Number(sc.posicion).toLocaleString("es-MX", { maximumFractionDigits: 1 }) : "–",
        chip: sc?.posicion && sc.posicion_antes ? (sc.posicion < sc.posicion_antes ? ["verde", "Subió"] : sc.posicion > sc.posicion_antes ? ["rojo", "Bajó"] : ["", "Igual"]) : null,
        extra: sc?.posicion ? (sc.posicion <= 10 ? "en la primera página de Google" : `página ${Math.ceil(sc.posicion / 10)} de Google · menos es mejor`) : "lugar en Google · menos es mejor" },
    ].map(kpi).join("");

    // Búsquedas
    const filaBusq = (x, extra) => `<li><span class="seo-q">${esc(x.busqueda)}</span><span class="seo-num">${extra}</span></li>`;
    $("#seo-oport").innerHTML = !sc ? `<li class="pg-vacio">${conG ? "Elige su Search Console para verlo." : "Conecta Google para verlo."}</li>`
      : sc.casi_primera.length ? sc.casi_primera.map((x) => filaBusq(x, `<b>#${Math.round(x.posicion)}</b><small>${cifra(x.apariciones)} veces</small>`)).join("")
      : `<li class="pg-vacio">Nada entre el lugar 8 y 20 con suficientes búsquedas.</li>`;
    $("#seo-top").innerHTML = !sc ? `<li class="pg-vacio">${conG ? "Elige su Search Console para verlo." : "Conecta Google para verlo."}</li>`
      : sc.top.length ? sc.top.slice(0, 8).map((x) => filaBusq(x, `<b>${Number(x.clics).toLocaleString("es-MX")}</b><small>clics · #${Math.round(x.posicion)}</small>`)).join("")
      : `<li class="pg-vacio">Aún sin clics desde Google.</li>`;

    // Páginas por mejorar
    $("#seo-prob-n").textContent = r ? `${r.revisadas} página${r.revisadas === 1 ? "" : "s"} revisada${r.revisadas === 1 ? "" : "s"}` : "";
    $("#seo-generales").innerHTML = r ? r.generales.map((x) => `<li class="pm-aviso n-${x.nivel}">${foco(x.nivel)}<span class="pg-linea-txt"><b>${esc(x.texto)}</b><small>${esc(x.como)}</small></span></li>`).join("") : "";
    const conProb = r ? r.paginas.filter((p) => p.problemas.length) : [];
    $("#seo-paginas").innerHTML = !r ? `<p class="pg-vacio">${d.sitio ? "Toca <b>Revisar sitio</b> y en un minuto tendrás la lista." : "Anota su sitio web arriba para revisarlo."}</p>`
      : !conProb.length ? `<p class="pg-vacio">${r.caido ? "" : "Las páginas revisadas están en orden. 👌"}</p>`
      : conProb.map((p, i) => {
        const rojos = p.problemas.filter((x) => x.nivel === "rojo").length;
        return `<details class="seo-pag" ${i < 2 ? "open" : ""}>
          <summary>${foco(rojos ? "rojo" : "amarillo")}<span class="seo-pag-nombre"><b>${esc(p.titulo || ruta(p.url))}</b>${p.titulo ? `<small class="tenue">${esc(ruta(p.url))}</small>` : ""}</span><span class="tb-chip ${rojos ? "s-rojo" : "s-amarillo"}">${p.problemas.length}</span></summary>
          <ul>${p.problemas.map((x) => `<li><b>${esc(x.texto)}</b><small>${esc(x.como)}</small></li>`).join("")}</ul>
          ${/^https?:\/\//.test(p.url) ? `<a class="seo-abrir" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">Abrir página ↗</a>` : ""}
        </details>`;
      }).join("");

    // Velocidad
    const ps = r?.pagespeed;
    const medidor = (n, txt) => `<div class="seo-med ${n === null || n === undefined ? "" : n >= 90 ? "c-verde" : n >= 50 ? "c-amarillo" : "c-rojo"}"><b>${n ?? "–"}</b><small>${txt}</small></div>`;
    $("#seo-velocidad").innerHTML = ps
      ? `<div class="seo-meds">${medidor(ps.velocidad, "Velocidad")}${medidor(ps.seo, "SEO")}${medidor(ps.accesibilidad, "Accesibilidad")}${medidor(ps.buenas_practicas, "Buenas prácticas")}</div>
         <p class="tenue chico">${ps.carga_segundos ? `La parte principal tarda <b>${ps.carga_segundos} s</b> en aparecer en un celular (lo ideal: menos de 2.5 s).` : ""}${ps.usuarios_reales ? ` Con visitantes reales: ${ps.usuarios_reales.carga_segundos} s.` : ""}</p>`
      : `<p class="pg-vacio">${r?.aviso_velocidad ? esc(r.aviso_velocidad) : r?.caido ? "El sitio no abre." : "Se mide al revisar el sitio."}</p>`;

    // Canales y páginas que bajan
    const maxV = Math.max(1, ...(ga?.de_donde || []).map((x) => x.visitas));
    $("#seo-canales").innerHTML = ga?.de_donde?.length
      ? ga.de_donde.slice(0, 6).map((x) => `<div class="seo-canal"><span>${esc(x.canal)}</span><span class="pg-barra"><i data-ancho="${Math.round((x.visitas / maxV) * 100)}"></i></span><b>${Number(x.visitas).toLocaleString("es-MX")}</b></div>`).join("")
      : `<p class="pg-vacio">${conG ? "Elige su Analytics para verlo." : "Conecta Google para verlo."}</p>`;
    $("#seo-bajan-caja").hidden = !sc?.paginas_bajan?.length;
    $("#seo-bajan").innerHTML = (sc?.paginas_bajan || []).map((x) => `<li><span class="seo-q">${esc(ruta(x.pagina))}</span><span class="seo-num"><b class="t-rojo">${x.cambio} %</b><small>${x.clics_antes} → ${x.clics} clics</small></span></li>`).join("");
    $("#seo-delta").dataset.pedir = `¿Cómo va la web de ${d.cliente.nombre}? Empieza por lo urgente, luego las búsquedas casi en primera página y dime las 3 cosas que harías este mes.`;
    medidas($('[data-seccion="seo"]'));
  }

  $("#seo-lista").addEventListener("click", (e) => {
    const b = e.target.closest("[data-seo-cliente]");
    if (!b) return;
    clienteSeo = b.dataset.seoCliente;
    $("#seo-lista").querySelectorAll("[data-seo-cliente]").forEach((x) => x.classList.toggle("elegida", x === b));
    cargarSeo().then(() => { if (matchMedia("(max-width: 1100px)").matches) $(".seo-sitio").scrollIntoView({ behavior: "smooth", block: "start" }); }).catch((err) => avisar(err.message));
  });
  $("#seo-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const d = ultimaSeo?.detalle;
    if (!d) return;
    const cuerpo = { cliente: d.cliente.id, sitio: $("#seo-url").value.trim() || null };
    if (ultimaSeo.google.conectado) { cuerpo.gsc_sitio = $("#seo-gsc").value || null; cuerpo.ga4_propiedad = $("#seo-ga").value || null; }
    try {
      const antes = d.sitio;
      const r = await api("/seo/config", { method: "PUT", body: cuerpo });
      sonar("accion");
      if (r.sitio && r.sitio !== antes) return void revisarSeo();
      await cargarSeo();
    } catch (err) { avisar(err.message); }
  });
  async function revisarSeo() {
    const id = ultimaSeo?.detalle?.cliente.id;
    if (!id) return;
    const b = $("#seo-revisar");
    b.disabled = true;
    b.textContent = "Revisando…";
    $("#seo-hora").textContent = "Revisando… (hasta un minuto)";
    try { await api("/seo/revisar", { method: "POST", body: { cliente: id } }); sonar("accion"); }
    catch (err) { avisar(err.message); }
    b.textContent = "Revisar sitio";
    await cargarSeo().catch(() => {});
  }
  $("#seo-revisar").addEventListener("click", revisarSeo);
  $("#seo-google").addEventListener("click", async (e) => {
    const b = e.currentTarget;
    try {
      if (!ultimaSeo?.google.conectado) { const { url } = await api("/seo/google/conectar"); location.href = url; return; }
      if (!b.classList.contains("seguro")) { b.classList.add("seguro"); b.textContent = "¿Desconectar Google?"; setTimeout(() => { b.classList.remove("seguro"); b.textContent = "Google conectado ✓"; }, 4000); return; }
      await api("/seo/google/desconectar", { method: "POST" });
      propsSeo = null;
      await cargarSeo();
    } catch (err) { avisar(err.message); }
  });

  // =====================================================================
  //  CRM Y EMBUDO
  // =====================================================================
  let ultimaCrm = null;
  let etapaCrmCel = "nuevo";
  let clienteCrm = guardado.get("delta_crm_cliente") || "";
  let fichaCrm = null;
  const DIAS_SEM = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
  // La cita se guarda en hora local "AAAA-MM-DDTHH:MM"
  const citaBonita = (c) => {
    if (!c) return "";
    const [f, hm] = c.split("T");
    const [a, m, d] = f.split("-").map(Number);
    const hoy = new Date().toLocaleDateString("en-CA", { timeZone: h.zona() });
    const man = new Date(Date.now() + 864e5).toLocaleDateString("en-CA", { timeZone: h.zona() });
    const dia = f === hoy ? "hoy" : f === man ? "mañana" : `${DIAS_SEM[new Date(a, m - 1, d).getDay()]} ${d} ${MESES[m - 1]}`;
    const [hh, mm] = hm.split(":").map(Number);
    return `${dia}, ${hh % 12 || 12}:${String(mm).padStart(2, "0")} ${hh < 12 ? "am" : "pm"}`;
  };
  const esperaTxt = (horas) => (horas < 1 ? "acaba de llegar" : horas < 24 ? `lleva ${horas} h esperando` : `lleva ${Math.floor(horas / 24)} día${Math.floor(horas / 24) === 1 ? "" : "s"} esperando`);
  const minutosTxt = (m) => (m === null || m === undefined ? "–" : m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`);

  // ---------- Periodo (fecha, mes y año) ----------
  const hoyLocal = () => new Date().toLocaleDateString("en-CA", { timeZone: h.zona() });
  const diaMas = (f, n) => new Date(Date.parse(`${f}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
  const finMes = (a, m) => new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10); // m de 1 a 12
  const RAPIDOS = [
    ["hoy", "Hoy"], ["ayer", "Ayer"], ["7", "Últimos 7 días"], ["30", "Últimos 30 días"],
    ["mes", "Este mes"], ["mes_pasado", "Mes pasado"], ["anio", "Este año"],
  ];
  function rangoRapido(clave) {
    const hoy = hoyLocal();
    const [a, m] = hoy.split("-").map(Number);
    switch (clave) {
      case "hoy": return [hoy, hoy];
      case "ayer": return [diaMas(hoy, -1), diaMas(hoy, -1)];
      case "7": return [diaMas(hoy, -6), hoy];
      case "30": return [diaMas(hoy, -29), hoy];
      case "mes_pasado": { const am = m === 1 ? a - 1 : a, mm = m === 1 ? 12 : m - 1; return [`${am}-${String(mm).padStart(2, "0")}-01`, finMes(am, mm)]; }
      case "anio": return [`${a}-01-01`, hoy];
      default: return [`${a}-${String(m).padStart(2, "0")}-01`, finMes(a, m)];
    }
  }
  let periodoCrm = (() => {
    try { const p = JSON.parse(guardado.get("delta_crm_periodo") || "null"); if (p?.rapido || (p?.desde && p?.hasta)) return p; } catch {}
    return { rapido: "mes" };
  })();
  const rangoCrm = () => (periodoCrm.rapido ? rangoRapido(periodoCrm.rapido) : [periodoCrm.desde, periodoCrm.hasta]);
  function textoPeriodo([d, hta]) {
    const [a1, m1, d1] = d.split("-").map(Number), [a2, m2, d2] = hta.split("-").map(Number);
    if (d1 === 1 && hta === finMes(a2, m2) && a1 === a2 && m1 === m2) return `${MESES_LARGOS[m1 - 1][0].toUpperCase()}${MESES_LARGOS[m1 - 1].slice(1)} ${a1}`;
    if (d === hta) return `${d1} ${MESES[m1 - 1]} ${a1}`;
    if (a1 === a2 && m1 === m2) return `${d1} – ${d2} ${MESES[m1 - 1]} ${a1}`;
    if (a1 === a2) return `${d1} ${MESES[m1 - 1]} – ${d2} ${MESES[m2 - 1]} ${a1}`;
    return `${d1} ${MESES[m1 - 1]} ${a1} – ${d2} ${MESES[m2 - 1]} ${a2}`;
  }
  let anioCal = Number(rangoCrm()[0].slice(0, 4));
  function pintarCalendario() {
    const [d, hta] = rangoCrm();
    const hoy = hoyLocal();
    $("#crm-periodo-txt").textContent = periodoCrm.rapido && periodoCrm.rapido !== "mes" ? RAPIDOS.find((r) => r[0] === periodoCrm.rapido)[1] : textoPeriodo([d, hta]);
    $("#crm-periodo").title = textoPeriodo([d, hta]);
    $("#crm-cal-rapidos").innerHTML = RAPIDOS.map(([k, t]) => `<button type="button" data-crm-rapido="${k}" class="${periodoCrm.rapido === k ? "activa" : ""}">${t}</button>`).join("");
    $("#crm-cal-anio").textContent = anioCal;
    $('[data-crm-anio="1"]').disabled = anioCal >= Number(hoy.slice(0, 4));
    $("#crm-cal-meses").innerHTML = MESES.map((m, i) => {
      const ini = `${anioCal}-${String(i + 1).padStart(2, "0")}-01`;
      const elegido = d === ini && hta === finMes(anioCal, i + 1);
      return `<button type="button" data-crm-mes="${ini.slice(0, 7)}" class="${elegido ? "activa" : ""}" ${ini > hoy ? "disabled" : ""}>${m}</button>`;
    }).join("");
    $("#crm-desde").value = d;
    $("#crm-hasta").value = hta;
    $("#crm-desde").max = $("#crm-hasta").max = hoy;
  }
  function elegirPeriodo(p) {
    periodoCrm = p;
    guardado.set("delta_crm_periodo", JSON.stringify(p));
    filtroCrm = { campana: "", conjunto: "", anuncio: "" };
    cerrarCalendario();
    cargarCrm().catch((err) => avisar(err.message));
  }
  const cerrarCalendario = () => { $("#crm-cal").hidden = true; $("#crm-periodo").setAttribute("aria-expanded", "false"); };
  $("#crm-periodo").addEventListener("click", () => {
    const abrir = $("#crm-cal").hidden;
    if (abrir) { anioCal = Number(rangoCrm()[1].slice(0, 4)); pintarCalendario(); }
    $("#crm-cal").hidden = !abrir;
    $("#crm-periodo").setAttribute("aria-expanded", String(abrir));
  });
  $("#crm-cal").addEventListener("click", (e) => {
    const r = e.target.closest("[data-crm-rapido]");
    if (r) return elegirPeriodo({ rapido: r.dataset.crmRapido });
    const an = e.target.closest("[data-crm-anio]");
    if (an) { anioCal += Number(an.dataset.crmAnio); return pintarCalendario(); }
    const m = e.target.closest("[data-crm-mes]");
    if (m) { const [a, n] = m.dataset.crmMes.split("-").map(Number); return elegirPeriodo({ desde: `${m.dataset.crmMes}-01`, hasta: finMes(a, n) }); }
  });
  $("#crm-cal-aplicar").addEventListener("click", () => {
    let d = $("#crm-desde").value, hta = $("#crm-hasta").value;
    if (!d && !hta) return;
    d ||= hta; hta ||= d;
    if (d > hta) [d, hta] = [hta, d];
    elegirPeriodo({ desde: d, hasta: hta });
  });
  document.addEventListener("click", (e) => { if (!$("#crm-cal").hidden && !e.target.closest(".crm-periodo-caja")) cerrarCalendario(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#crm-cal").hidden) { cerrarCalendario(); $("#crm-periodo").focus(); } });

  // ---------- Cargar ----------
  let reporteCrm = null;
  let filtroCrm = { campana: "", conjunto: "", anuncio: "" };
  let nivelCrm = "campana";
  let pedidoCrm = 0;
  async function cargarCrm() {
    if (!clientesFi.length) await prepararFinanzas();
    const [d, hta] = rangoCrm();
    pintarCalendario();
    const q = (c) => `?${new URLSearchParams({ ...(c ? { cliente: c } : {}), desde: d, hasta: hta })}`;
    const n = ++pedidoCrm;
    let t;
    try { t = await api(`/crm${q(clienteCrm)}`); }
    catch (err) { if (!clienteCrm) throw err; clienteCrm = ""; guardado.set("delta_crm_cliente", ""); t = await api(`/crm${q("")}`); }
    if (n !== pedidoCrm) return;
    ultimaCrm = t;
    if (!reporteCrm || reporteCrm.desde !== d || reporteCrm.hasta !== hta || reporteCrm.cliente !== clienteCrm) reporteCrm = null;
    pintarCrm(t);
    try {
      const r = await api(`/crm/reporte${q(clienteCrm)}`);
      if (n !== pedidoCrm) return;
      reporteCrm = { ...r, cliente: clienteCrm };
    } catch (err) {
      if (n !== pedidoCrm) return;
      reporteCrm = { desde: d, hasta: hta, cliente: clienteCrm, anuncios: null, prospectos: null, error: err.message };
    }
    pintarReporte();
  }

  // ---------- Reporte estilo Looker: anuncios de Meta + lo que pasó en el CRM ----------
  const normal = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const dinero2 = (n) => (n === null || n === undefined || !Number.isFinite(n) ? "–" : "$" + n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const enteroCrm = (n) => Math.round(n || 0).toLocaleString("es-MX");
  const div = (a, b) => (b ? a / b : null);
  const vacios = () => ({ gasto: 0, impresiones: 0, clics: 0, clics_enlace: 0, conversaciones: 0, prospectos: 0, compras: 0, valor_compras: 0 });
  const NUMEROS = ["gasto", "impresiones", "clics", "clics_enlace", "conversaciones", "prospectos", "compras", "valor_compras"];
  const sumarEn = (acc, f) => { for (const k of NUMEROS) acc[k] += Number(f[k]) || 0; return acc; };
  const resultadosDe = (x) => x.conversaciones + x.prospectos + x.compras;

  let idSparkCrm = 0;
  function spark(serie) {
    const s = serie.filter((v) => v !== null && Number.isFinite(v));
    if (s.length < 2) return `<span class="pg-kpi-pie"></span>`;
    const w = 120, alto = 34;
    const min = Math.min(...s), max = Math.max(...s), r = max - min || 1;
    const pts = s.map((v, i) => [((i / (s.length - 1)) * w).toFixed(1), (alto - 2 - ((v - min) / r) * (alto - 4)).toFixed(1)]);
    const d = "M" + pts.map((p) => p.join(",")).join("L");
    const id = `crmsp${++idSparkCrm}`;
    return `<svg class="spark" viewBox="0 0 ${w} ${alto}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="st-a"/><stop offset="1" class="st-b"/></linearGradient></defs>
      <path d="${d}L${w},${alto}L0,${alto}Z" fill="url(#${id})"/><path d="${d}" class="sp-linea"/></svg>`;
  }

  // Los días del periodo agrupados (día, semana o mes según lo largo que sea).
  function cubetas(desde, hasta) {
    const dias = [];
    for (let f = desde; f <= hasta && dias.length < 800; f = diaMas(f, 1)) dias.push(f);
    const tipo = dias.length <= 62 ? "dia" : dias.length <= 190 ? "semana" : "mes";
    const grupos = [];
    const clave = (f, i) => (tipo === "dia" ? f : tipo === "semana" ? dias[Math.floor(i / 7) * 7] : f.slice(0, 7));
    const idx = new Map();
    dias.forEach((f, i) => {
      const k = clave(f, i);
      if (!idx.has(k)) { idx.set(k, grupos.length); grupos.push({ clave: k, desde: f }); }
    });
    return { tipo, grupos, de: (f) => { const i = dias.indexOf(f); return i < 0 ? -1 : idx.get(clave(f, i)); } };
  }
  const etiquetaCubeta = (c, tipo) => {
    if (tipo === "mes") { const [a, m] = c.clave.split("-").map(Number); return `${MESES[m - 1]} ${String(a).slice(2)}`; }
    const [, m, d] = c.desde.split("-").map(Number);
    return `${d} ${MESES[m - 1]}`;
  };

  const ORIGEN_VENTA = { anuncio: "Anuncio", redes: "Redes sociales", recomendado: "Recomendación", cliente: "Ya era cliente", otro: "Otro" };

  // A qué campaña, conjunto o anuncio pertenece cada prospecto del CRM (por el nombre que trae de Meta/Pancake).
  function ligarProspectos(prospectos, filas) {
    const completo = new Map(), porAnuncio = new Map(), porCampana = new Map(), repetidos = new Set();
    for (const f of filas) {
      completo.set(normal(`${f.campana} · ${f.anuncio}`), f);
      const a = normal(f.anuncio);
      if (porAnuncio.has(a) && porAnuncio.get(a).anuncio_id !== f.anuncio_id) repetidos.add(a);
      porAnuncio.set(a, f);
      porCampana.set(normal(f.campana), f.campana_id);
    }
    return prospectos.map((p) => {
      const t = normal(p.campana);
      if (!t) return { ...p };
      const f = completo.get(t) || (!repetidos.has(t) && porAnuncio.get(t));
      if (f) return { ...p, campana_id: f.campana_id, conjunto_id: f.conjunto_id, anuncio_id: f.anuncio_id };
      const c = porCampana.get(t) || porCampana.get(normal(String(p.campana).split(" · ")[0]));
      return c ? { ...p, campana_id: c } : { ...p };
    });
  }

  // Total de venta: el monto anotado en cada venta o, si no lo tiene, el valor promedio del cliente.
  function sumarVentas(ventas) {
    let valor = 0, real = 0, estimadas = 0, sinMonto = 0, ganancia = 0, conMargen = 0;
    for (const p of ventas) {
      const v = p.valor || p.ticket || 0;
      if (p.valor) real++; else if (p.ticket) estimadas++; else sinMonto++;
      valor += v;
      if (v && p.margen !== null && p.margen !== undefined) { ganancia += v * (p.margen / 100); conMargen++; }
    }
    return { valor, ventas_reales: real, estimadas, sin_monto: sinMonto, ganancia, con_margen: conMargen };
  }

  function datosReporte() {
    const t = ultimaCrm, r = reporteCrm;
    const [desde, hasta] = rangoCrm();
    const filasTodas = r?.anuncios?.filas || [];
    const hayAds = filasTodas.length > 0;
    const fc = filtroCrm;
    const pasa = (x) => (!fc.campana || x.campana_id === fc.campana) && (!fc.conjunto || x.conjunto_id === fc.conjunto) && (!fc.anuncio || x.anuncio_id === fc.anuncio);
    const filtrando = Boolean(fc.campana || fc.conjunto || fc.anuncio);
    const filas = filasTodas.filter(pasa);
    const diasAds = (r?.anuncios?.dias || []).filter(pasa);
    const prosTodos = r?.prospectos ? (hayAds ? ligarProspectos(r.prospectos, filasTodas) : r.prospectos) : null;
    const pros = prosTodos ? (filtrando ? prosTodos.filter(pasa) : prosTodos) : null;
    const tot = filas.reduce(sumarEn, vacios());
    // Ventas: de quienes llegaron en estas fechas, cuántos compraron. La tarjeta cuenta las de redes/anuncios; las de recomendación o de quien ya era cliente van aparte.
    const ventasTodas = r?.ventas ? (hayAds ? ligarProspectos(r.ventas, filasTodas) : r.ventas).filter((v) => !filtrando || pasa(v)) : null;
    const ventasRedes = ventasTodas ? ventasTodas.filter((v) => v.redes) : null;
    const crm = pros
      ? { prospectos: pros.length, citas: pros.filter((p) => p.alcanzo >= 2).length, asistieron: pros.filter((p) => p.alcanzo >= 3).length, contactados: pros.filter((p) => p.alcanzo >= 1).length,
          ...(ventasRedes ? { ventas: ventasRedes.length, ventas_otras: ventasTodas.length - ventasRedes.length, ...sumarVentas(ventasRedes) } : { ventas: pros.filter((p) => p.alcanzo >= 4).length, ...sumarVentas(pros.filter((p) => p.alcanzo >= 4)) }) }
      : { prospectos: t.embudo.prospectos, citas: t.embudo.citas, asistieron: t.embudo.pasos[3].n, ventas: t.embudo.ventas_cerradas?.redes ?? t.embudo.ventas, ventas_otras: t.embudo.ventas_cerradas?.otras || 0, contactados: t.embudo.pasos[1].n, valor: t.embudo.ventas_cerradas?.valor_redes ?? t.embudo.valor_ventas ?? 0 };
    // Series por día (o semana/mes)
    const hoy = hoyLocal();
    const cub = cubetas(desde, hasta > hoy && desde <= hoy ? hoy : hasta);
    const serie = () => cub.grupos.map(() => vacios());
    const porDia = serie();
    for (const d of diasAds) { const i = cub.de(d.fecha); if (i >= 0) sumarEn(porDia[i], d); }
    const prosDia = cub.grupos.map(() => ({ prospectos: 0, citas: 0 }));
    for (const p of pros || []) { const i = cub.de(p.dia); if (i >= 0) { prosDia[i].prospectos++; if (p.alcanzo >= 2) prosDia[i].citas++; } }
    return { t, r, desde, hasta, hayAds, filas, filasTodas, prosTodos, pros, ventas: ventasTodas, tot, crm, cub, porDia, prosDia, filtrando };
  }

  function pintarReporte() {
    const t = ultimaCrm;
    if (!t) return;
    const D = datosReporte();
    const { r, hayAds, tot, crm, cub, porDia, prosDia } = D;
    const cargando = !r;
    const txtPeriodo = textoPeriodo([D.desde, D.hasta]);
    $("#crm-embudo-mes").textContent = txtPeriodo;
    $("#crm-costos-mes").textContent = txtPeriodo;
    pintarFiltros(D);

    // Tarjetas
    const sr = t.sin_responder.length;
    const e = t.embudo, a = t.embudo_anterior;
    const cambio = (x, y) => (D.filtrando ? "" : y ? `${x >= y ? "+" : "−"}${Math.abs(Math.round(((x - y) / y) * 100))} % vs. periodo anterior` : "");
    const kpi = (k) => `<div class="tb-kpi pg-kpi fi-kpi crm-kpi ${k.clase || ""}" ${k.ir ? `data-crm-ir="${k.ir}" role="button" tabindex="0"` : ""} ${k.ayuda ? `title="${esc(k.ayuda)}"` : ""}>
        <span class="tb-kpi-nombre">${esc(k.nombre)}</span>
        <b>${esc(k.valor)}</b>
        ${k.chip ? `<span class="tb-chip s-${k.chip[0]}">${esc(k.chip[1])}</span>` : ""}
        <span class="tb-kpi-mes">${esc(k.extra || "")}</span>
        ${k.serie ? spark(k.serie) : ""}
      </div>`;
    const otras = crm.ventas_otras ? ` · +${crm.ventas_otras} por recomendación o clientes de antes` : "";
    const ventasK = { nombre: "Ventas de redes", valor: String(crm.ventas), chip: crm.prospectos ? (() => { const c = Math.round((crm.ventas / crm.prospectos) * 100); return [c >= 20 ? "verde" : c >= 10 ? "amarillo" : "rojo", `${c} % cierre`]; })() : null, extra: (crm.valor ? `total de venta ${dinero(crm.valor)}${hayAds && tot.gasto ? ` · retorno ${(crm.valor / tot.gasto).toLocaleString("es-MX", { maximumFractionDigits: 1 })}x` : ""}` : `${crm.ventas} venta${crm.ventas === 1 ? "" : "s"}`) + otras, ir: "ventas-lista" };
    const sinResp = { nombre: "Sin responder", valor: String(sr), chip: sr ? ["rojo", "Contestar hoy"] : ["verde", "Al día"], extra: `respuesta típica: ${minutosTxt(e.respuesta_minutos)}`, ir: sr ? "hoy" : null };
    let tarjetas;
    if (hayAds) {
      const res = resultadosDe(tot);
      const cpa = div(tot.gasto, crm.citas);
      tarjetas = [
        { nombre: "Inversión", valor: dinero2(tot.gasto), extra: `${enteroCrm(tot.impresiones)} impresiones`, serie: porDia.map((x) => x.gasto), clase: "k-inv" },
        { nombre: "CPC · costo por clic", valor: dinero2(div(tot.gasto, tot.clics_enlace)), extra: `${enteroCrm(tot.clics_enlace)} clics al enlace`, serie: porDia.map((x) => div(x.gasto, x.clics_enlace)), ayuda: "Inversión entre los clics al enlace del anuncio" },
        { nombre: "CPM · costo por mil", valor: dinero2(div(tot.gasto * 1000, tot.impresiones)), extra: "lo que cuesta mostrarse 1,000 veces", serie: porDia.map((x) => div(x.gasto * 1000, x.impresiones)) },
        { nombre: "CTR · tasa de clics", valor: tot.impresiones ? `${(tot.clics_enlace / tot.impresiones * 100).toLocaleString("es-MX", { maximumFractionDigits: 2 })} %` : "–", extra: "de cada 100 que lo ven, cuántos tocan", serie: porDia.map((x) => div(x.clics_enlace * 100, x.impresiones)) },
        { nombre: "CPL · costo por registro", valor: dinero2(div(tot.gasto, res)), extra: `${enteroCrm(res)} mensaje${res === 1 ? "" : "s"} o registro${res === 1 ? "" : "s"} en Meta`, serie: porDia.map((x) => div(x.gasto, resultadosDe(x))), ayuda: "Inversión entre las conversaciones y formularios que Meta cuenta" },
        { nombre: "CPA real · por cita", valor: dinero2(cpa), extra: crm.citas ? `${crm.citas} cita${crm.citas === 1 ? "" : "s"} agendada${crm.citas === 1 ? "" : "s"} en el CRM` : "aún no hay citas en estas fechas", serie: porDia.map((x, i) => div(x.gasto, prosDia[i].citas)), ir: "cita", clase: "k-real", ayuda: "Inversión entre las citas que de verdad están en el CRM" },
        ventasK, sinResp,
      ];
    } else {
      tarjetas = [
        { nombre: "Prospectos", valor: String(crm.prospectos), extra: cambio(e.prospectos, a.prospectos) || (crm.prospectos ? "" : "nadie llegó en estas fechas"), serie: prosDia.map((x) => x.prospectos), ir: "nuevo" },
        { nombre: "Agendaron cita", valor: String(crm.citas), extra: crm.prospectos ? `${Math.round((crm.citas / crm.prospectos) * 100)} % de los prospectos` : "", serie: prosDia.map((x) => x.citas), ir: "cita" },
        ventasK, sinResp,
      ];
      if (e.inversion) {
        tarjetas.unshift(
          { nombre: "Inversión", valor: dinero(e.inversion), extra: "anotada en Paid media", clase: "k-inv" },
          { nombre: "Costo por prospecto", valor: dinero2(e.costo_prospecto), extra: `${crm.prospectos} prospecto${crm.prospectos === 1 ? "" : "s"}` },
          { nombre: "CPA real · por cita", valor: dinero2(e.costo_cita), extra: `${crm.citas} cita${crm.citas === 1 ? "" : "s"} en el CRM`, clase: "k-real" },
          { nombre: "Costo por venta", valor: dinero2(e.costo_venta), extra: e.retorno ? `retorno ${e.retorno.toLocaleString("es-MX")}x` : "" },
        );
      }
    }
    $("#crm-kpis").innerHTML = tarjetas.map(kpi).join("");
    $("#crm-kpis").classList.toggle("ocho", tarjetas.length > 4);

    // Embudo
    const pasos = hayAds
      ? [["Impresiones", tot.impresiones], ["Clics al enlace", tot.clics_enlace], ["Mensajes y registros", resultadosDe(tot)], ["Prospectos (CRM)", crm.prospectos], ["Citas agendadas", crm.citas], ["Ventas", crm.ventas]]
      : [["Prospectos", crm.prospectos], ["Contactados", crm.contactados], ["Citas agendadas", crm.citas], ["Asistieron", crm.asistieron], ["Ventas", crm.ventas]];
    $("#crm-trafico").innerHTML = pasos[0][1] ? embudoSvg(pasos) : `<p class="ct-vacia">${cargando ? "Cargando…" : "Cuando lleguen prospectos en estas fechas vas a ver aquí cuántos pasan de un paso al siguiente."}</p>`;

    // Día por día
    const A = hayAds ? porDia.map((x) => x.gasto) : prosDia.map((x) => x.prospectos);
    const B = hayAds ? porDia.map((x) => resultadosDe(x)) : prosDia.map((x) => x.citas);
    const nombres = hayAds ? ["Inversión", "Mensajes y registros"] : ["Prospectos", "Citas"];
    $("#crm-dia-leyenda").innerHTML = `<span class="l-a">${nombres[0]}</span><span class="l-b">${nombres[1]}</span>`;
    $("#crm-dia").innerHTML = A.some(Boolean) || B.some(Boolean)
      ? lineasSvg(cub, A, B, nombres, hayAds)
      : `<p class="ct-vacia">${cargando ? "Cargando…" : "Sin movimiento en estas fechas."}</p>`;

    // Los mejores
    pintarMejores(D);
    // Tabla
    pintarTabla(D);
    // Costos y origen
    pintarCostos(D);
    pintarUtilidad(D);

    // Aviso si Meta tiene la cuenta pero no respondió
    const errs = r?.anuncios?.errores || [];
    $("#crm-filtros-nota").textContent = errs.length && !hayAds ? `Meta no respondió: ${errs[0]}` : "";
    medidas($('[data-seccion="crm"]'));
  }

  // Embudo en 3D: cono con aros por nivel, brillo, etiquetas al lado con línea guía y resumen abajo.
  function embudoSvg(pasos) {
    const n = pasos.length, H = 52, arriba = 22, cx = 110, wTop = 104, wBot = 26, W = 412;
    const ancho = (t) => wBot + (wTop - wBot) * Math.pow(1 - t, 1.5);
    const yDe = (t) => arriba + t * n * H;
    const ry = (w) => Math.max(4, w * 0.16);
    const f = (x) => x.toFixed(1);
    // Orilla del cono entre t0 y t1 (la última punta sube 3 px para dejar ver el aro).
    const lado = (t0, t1, signo) => {
      const pts = [];
      for (let k = 0; k <= 8; k++) { const t = t0 + ((t1 - t0) * k) / 8; pts.push(`${f(cx + signo * ancho(t))},${f(yDe(t) - (k === 8 ? 3 : 0))}`); }
      return pts;
    };
    const pct = (i) => (i && pasos[i - 1][1] ? (pasos[i][1] / pasos[i - 1][1]) * 100 : null);
    const pctTxt = (p) => (p === null ? "" : `${p && p < 0.1 ? p.toLocaleString("es-MX", { maximumSignificantDigits: 2 }) : p < 10 ? p.toLocaleString("es-MX", { maximumFractionDigits: 1 }) : Math.round(p)} %`);
    const bandas = pasos.map(([nombre, v], i) => {
      const t0 = i / n, t1 = (i + 1) / n, w0 = ancho(t0), w1 = ancho(t1), y0 = yDe(t0), y1 = yDe(t1) - 3;
      const izq = lado(t0, t1, -1), der = lado(t0, t1, 1).reverse();
      const d = `M${izq.join(" L")} A${f(w1)},${f(ry(w1))} 0 0 0 ${der[0]} L${der.slice(1).join(" L")} A${f(w0)},${f(ry(w0))} 0 0 1 ${f(cx - w0)},${f(y0)} Z`;
      const ym = (y0 + y1) / 2 + ry(w0) / 2, xr = cx + ancho((t0 + t1) / 2);
      const p = pct(i);
      return `<g class="crm-f f${i}"><title>${esc(nombre)}: ${enteroCrm(v)}${p === null ? "" : ` (${pctTxt(p)} del paso anterior)`}</title>
        <path d="${d}" class="crm-f-cuerpo"/><path d="${d}" fill="url(#crmEmbSombra)"/>
        <path d="M${f(cx - w1)},${f(y1)} A${f(w1)},${f(ry(w1))} 0 0 0 ${f(cx + w1)},${f(y1)}" class="crm-f-aro"/>
        <text x="${cx}" y="${f(ym + 6)}" class="crm-f-num">${v >= 10000 ? cifra(v) : enteroCrm(v)}</text>
        <path d="M${f(xr + 4)},${f(ym)} L${W - 160},${f(ym)}" class="crm-f-guia"/><circle cx="${f(xr + 4)}" cy="${f(ym)}" r="2.2" class="crm-f-punto"/>
        <text x="${W - 154}" y="${f(ym - 3)}" class="crm-f-nom">${esc(nombre)}</text>
        <text x="${W - 154}" y="${f(ym + 14)}" class="crm-f-pct">${p === null ? "inicio" : `${pctTxt(p)} pasa`}</text></g>`;
    }).join("");
    const r0 = ry(wTop);
    const borde = `<ellipse cx="${cx}" cy="${arriba}" rx="${wTop}" ry="${f(r0)}" class="crm-f-boca"/><ellipse cx="${cx}" cy="${f(arriba + 1.5)}" rx="${wTop - 10}" ry="${f(r0 - 3.5)}" class="crm-f-hueco"/>`;
    const brillo = `<path d="M${f(cx + wTop * 0.42)},${f(arriba + r0)} C${f(cx + wTop * 0.3)},${f(arriba + n * H * 0.45)} ${f(cx + wBot * 0.55)},${f(arriba + n * H * 0.8)} ${f(cx + wBot * 0.45)},${f(arriba + n * H - 4)}" class="crm-f-brillo"/>`;
    const alto = arriba + n * H + ry(wBot) + 6;
    const svg = `<svg viewBox="0 0 ${W} ${f(alto)}" class="crm-embudo-svg" role="img" aria-label="Embudo: ${esc(pasos.map(([k, v]) => `${k} ${v}`).join(", "))}">
      <defs><linearGradient id="crmEmbSombra" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".38"/><stop offset=".28" stop-color="#000" stop-opacity="0"/><stop offset=".55" stop-color="#fff" stop-opacity=".14"/><stop offset=".78" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".42"/></linearGradient></defs>
      ${bandas}${borde}${brillo}</svg>`;
    // Resumen abajo: conversión total, el paso que mejor convierte y donde más se pierde.
    const tasas = pasos.map((_, i) => ({ i, p: pct(i) })).filter((x) => x.p !== null && pasos[x.i - 1][1]);
    // Con anuncios, "de principio a fin" se mide desde que llega al CRM (de impresiones a venta sale un número diminuto).
    const ini = Math.max(0, pasos.findIndex(([k]) => k.startsWith("Prospectos")));
    const total = pasos[ini][1] ? (pasos[n - 1][1] / pasos[ini][1]) * 100 : null;
    const mejor = tasas.length ? tasas.reduce((a, b) => (b.p > a.p ? b : a)) : null;
    const peor = tasas.length ? tasas.reduce((a, b) => (b.p < a.p ? b : a)) : null;
    const tarjeta = (titulo, valor, pie, clase = "") => `<div class="crm-emb-res ${clase}"><small>${titulo}</small><b>${valor}</b><span>${pie}</span></div>`;
    const resumen = `<div class="crm-emb-resumen">
      ${tarjeta(ini ? "De prospecto a venta" : "De principio a fin", total === null ? "—" : pctTxt(total), `${esc(pasos[ini][0])} → ${esc(pasos[n - 1][0])}`)}
      ${mejor ? tarjeta("Mejor paso", pctTxt(mejor.p), `${esc(pasos[mejor.i - 1][0])} → ${esc(pasos[mejor.i][0])}`, "bien") : ""}
      ${peor && peor !== mejor ? tarjeta("Donde más se pierde", pctTxt(peor.p), `${esc(pasos[peor.i - 1][0])} → ${esc(pasos[peor.i][0])}`, "ojo") : ""}
    </div>`;
    return svg + resumen;
  }

  function lineasSvg(cub, A, B, nombres, hayAds) {
    const W = 560, H = 250, izq = 10, der = 10, arr = 22, abj = 24;
    const n = A.length, paso = n > 1 ? (W - izq - der) / (n - 1) : 0;
    const x = (i) => izq + (n > 1 ? paso * i : (W - izq - der) / 2);
    const maxA = Math.max(...A, 0) || 1, maxB = Math.max(...B, 0) || 1;
    const yA = (v) => arr + (H - arr - abj) * (1 - v / maxA), yB = (v) => arr + (H - arr - abj) * (1 - v / maxB);
    const lA = A.map((v, i) => `${x(i).toFixed(1)},${yA(v).toFixed(1)}`).join(" ");
    const lB = B.map((v, i) => `${x(i).toFixed(1)},${yB(v).toFixed(1)}`).join(" ");
    const base = H - abj;
    const marcas = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, l) => l.indexOf(v) === i && v >= 0);
    const fmtA = (v) => (hayAds ? dinero(v) : enteroCrm(v));
    const zonas = A.map((v, i) => `<rect x="${(x(i) - (paso || W) / 2).toFixed(1)}" y="0" width="${(paso || W).toFixed(1)}" height="${H}" class="crm-zona"><title>${esc(etiquetaCubeta(cub.grupos[i], cub.tipo))}${cub.tipo === "semana" ? " (semana)" : ""}: ${nombres[0]} ${fmtA(v)} · ${nombres[1]} ${enteroCrm(B[i])}</title></rect>`).join("");
    return `<svg viewBox="0 0 ${W} ${H}" class="crm-lineas" role="img" aria-label="${esc(nombres.join(" y "))} por ${cub.tipo === "dia" ? "día" : cub.tipo}">
      <defs><linearGradient id="crm-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="st-a"/><stop offset="1" class="st-b"/></linearGradient></defs>
      ${[0.25, 0.5, 0.75].map((f) => `<line x1="${izq}" x2="${W - der}" y1="${(arr + (H - arr - abj) * f).toFixed(1)}" y2="${(arr + (H - arr - abj) * f).toFixed(1)}" class="crm-rejilla"/>`).join("")}
      <line x1="${izq}" x2="${W - der}" y1="${base}" y2="${base}" class="crm-eje"/>
      <text x="${izq}" y="13" class="crm-tope a">máx ${esc(fmtA(maxA))}</text>
      <text x="${W - der}" y="13" class="crm-tope b">máx ${enteroCrm(maxB)}</text>
      ${n > 1 ? `<polygon points="${x(0).toFixed(1)},${base} ${lA} ${x(n - 1).toFixed(1)},${base}" class="crm-area"/>` : ""}
      <polyline points="${lA}" class="crm-linea-a"/>
      <polyline points="${lB}" class="crm-linea-b"/>
      ${n <= 45 ? B.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${yB(v).toFixed(1)}" r="2.6" class="crm-punto-b"/>`).join("") : ""}
      ${marcas.map((i) => `<text x="${x(i).toFixed(1)}" y="${H - 6}" class="crm-x" text-anchor="${i === 0 ? "start" : i === n - 1 ? "end" : "middle"}">${esc(etiquetaCubeta(cub.grupos[i], cub.tipo))}</text>`).join("")}
      ${zonas}
    </svg>`;
  }

  function pintarMejores(D) {
    const caja = $("#crm-mejores");
    let partes, centro, sub;
    if (D.hayAds) {
      $("#crm-mejores-titulo").textContent = "Los mejores anuncios";
      const porAd = new Map();
      for (const f of D.filas) {
        const x = porAd.get(f.anuncio_id) || { nombre: f.anuncio, campana: f.campana, ...vacios() };
        sumarEn(x, f);
        porAd.set(f.anuncio_id, x);
      }
      const lista = [...porAd.values()].map((x) => ({ ...x, res: resultadosDe(x) })).sort((p, q) => q.res - p.res || q.gasto - p.gasto);
      const usarGasto = !lista.some((x) => x.res);
      const valor = (x) => (usarGasto ? x.gasto : x.res);
      const top = lista.slice(0, 5);
      const resto = lista.slice(5);
      partes = top.map((x, i) => ({ n: valor(x), clase: `c${i}`, nombre: x.nombre, det: usarGasto ? dinero(x.gasto) : `${enteroCrm(x.res)} · ${dinero2(div(x.gasto, x.res))} c/u` }));
      if (resto.length) partes.push({ n: resto.reduce((s, x) => s + valor(x), 0), clase: "c5", nombre: `Otros ${resto.length}`, det: usarGasto ? dinero(resto.reduce((s, x) => s + x.gasto, 0)) : enteroCrm(resto.reduce((s, x) => s + x.res, 0)) });
      centro = usarGasto ? dinero(D.tot.gasto) : enteroCrm(resultadosDe(D.tot));
      sub = usarGasto ? "invertido" : "resultados";
    } else {
      $("#crm-mejores-titulo").textContent = "De dónde llegan";
      const cuenta = new Map();
      for (const p of D.pros || []) cuenta.set(p.fuente, (cuenta.get(p.fuente) || 0) + 1);
      const lista = D.pros ? [...cuenta.entries()].map(([k, n]) => ({ nombre: ultimaCrm.fuentes[k] || k, n })) : ultimaCrm.embudo.por_fuente.map((f) => ({ nombre: f.nombre, n: f.prospectos }));
      lista.sort((p, q) => q.n - p.n);
      partes = lista.slice(0, 6).map((x, i) => ({ ...x, clase: `c${i}`, det: `${x.n} prospecto${x.n === 1 ? "" : "s"}` }));
      centro = String(lista.reduce((s, x) => s + x.n, 0));
      sub = "prospectos";
    }
    caja.innerHTML = partes.some((p) => p.n)
      ? `<div class="crm-dona">${dona(partes, centro, sub)}</div>
         <ul class="crm-dona-lista">${partes.map((p) => `<li><i class="crm-punto ${p.clase}"></i><span class="crm-dona-nombre" title="${esc(p.nombre)}">${esc(p.nombre)}</span><small class="tenue">${esc(p.det)}</small></li>`).join("")}</ul>`
      : `<p class="ct-vacia">${reporteCrm ? "Nada que comparar en estas fechas." : "Cargando…"}</p>`;
  }

  const NIVELES = { campana: "Campaña", conjunto: "Conjunto", anuncio: "Anuncio" };
  function pintarTabla(D) {
    $("#crm-tabla-caja").hidden = !D.hayAds;
    if (!D.hayAds) return;
    const nivel = nivelCrm;
    $("#crm-nivel").querySelectorAll("[data-crm-nivel]").forEach((b) => b.classList.toggle("activa", b.dataset.crmNivel === nivel));
    const grupos = new Map();
    for (const f of D.filas) {
      const id = f[`${nivel}_id`];
      const g = grupos.get(id) || { id, nombre: f[nivel], padre: nivel === "campana" ? (D.r.anuncios.filas.some((x) => x.cliente !== f.cliente) ? f.cliente : "") : f.campana, ...vacios(), citas: 0, prospectos_crm: 0 };
      sumarEn(g, f);
      grupos.set(id, g);
    }
    for (const p of D.pros || []) {
      const g = grupos.get(p[`${nivel}_id`]);
      if (g) { g.prospectos_crm++; if (p.alcanzo >= 2) g.citas++; }
    }
    const lista = [...grupos.values()].sort((a, b) => b.gasto - a.gasto);
    const sinLigar = (D.pros || []).filter((p) => !p[`${nivel}_id`]).length;
    $("#crm-tabla-nota").textContent = `${lista.length} ${NIVELES[nivel].toLowerCase()}${lista.length === 1 ? "" : "s"}`;
    const fila = (g, total = false) => {
      const res = g.conversaciones + g.prospectos; // mensajes y formularios (las compras van aparte)
      const roas = g.gasto && g.valor_compras ? g.valor_compras / g.gasto : null;
      return `<tr ${total ? `class="total"` : `data-crm-fila="${nivel}:${esc(g.id)}" tabindex="0" title="Ver solo este ${NIVELES[nivel].toLowerCase()}"`}>
        <th scope="row"><span class="crm-t-nombre">${esc(g.nombre)}</span>${g.padre ? `<small class="tenue">${esc(g.padre)}</small>` : ""}</th>
        <td>${dinero2(g.gasto)}</td><td>${enteroCrm(g.impresiones)}</td><td>${enteroCrm(g.clics_enlace)}</td>
        <td>${g.impresiones ? `${(g.clics_enlace / g.impresiones * 100).toLocaleString("es-MX", { maximumFractionDigits: 2 })} %` : "–"}</td>
        <td>${dinero2(div(g.gasto, g.clics_enlace))}</td>
        <td>${enteroCrm(res)}</td><td>${dinero2(div(g.gasto, res))}</td>
        <td>${g.compras ? enteroCrm(g.compras) : "–"}</td><td>${g.valor_compras ? dinero2(g.valor_compras) : "–"}</td><td class="${roas === null ? "" : roas >= 2 ? "real" : roas < 1 ? "malo" : ""}">${roas === null ? "–" : `${roas.toLocaleString("es-MX", { maximumFractionDigits: 2 })}x`}</td>
        <td>${total ? D.crm.citas : g.citas || "–"}</td><td class="real">${dinero2(div(g.gasto, total ? D.crm.citas : g.citas))}</td>
      </tr>`;
    };
    $("#crm-tabla").innerHTML = `<thead><tr><th scope="col">${NIVELES[nivel]}</th><th scope="col">Inversión</th><th scope="col">Impresiones</th><th scope="col">Clics</th><th scope="col">CTR</th><th scope="col">CPC</th><th scope="col">Mensajes y registros</th><th scope="col">CPL</th><th scope="col">Compras</th><th scope="col">Valor de compras</th><th scope="col" title="Valor de compras entre inversión">ROAS</th><th scope="col">Citas CRM</th><th scope="col">CPA real</th></tr></thead>
      <tbody>${lista.slice(0, 60).map((g) => fila(g)).join("")}</tbody>
      <tfoot>${fila({ ...D.tot, nombre: "Total", padre: sinLigar && D.crm.citas ? `${sinLigar} prospecto${sinLigar === 1 ? "" : "s"} sin anuncio identificado` : "" }, true)}</tfoot>`;
  }

  function pintarFiltros(D) {
    const caja = $("#crm-filtros");
    caja.hidden = !D.hayAds;
    if (!D.hayAds) return;
    const fc = filtroCrm;
    const unicos = (lista, k) => { const m = new Map(); for (const f of lista) if (!m.has(f[`${k}_id`])) m.set(f[`${k}_id`], f[k]); return [...m.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]), "es")); };
    const todas = D.filasTodas;
    const opciones = (lista, sel, todos) => `<option value="">${todos}</option>` + lista.map(([id, n]) => `<option value="${esc(id)}" ${id === sel ? "selected" : ""}>${esc(n)}</option>`).join("");
    $("#crm-f-campana").innerHTML = opciones(unicos(todas, "campana"), fc.campana, "Todas las campañas");
    $("#crm-f-conjunto").innerHTML = opciones(unicos(todas.filter((f) => !fc.campana || f.campana_id === fc.campana), "conjunto"), fc.conjunto, "Todos los conjuntos");
    $("#crm-f-anuncio").innerHTML = opciones(unicos(todas.filter((f) => (!fc.campana || f.campana_id === fc.campana) && (!fc.conjunto || f.conjunto_id === fc.conjunto)), "anuncio"), fc.anuncio, "Todos los anuncios");
    $("#crm-f-quitar").hidden = !D.filtrando;
  }
  const cambiarFiltro = (nivel, valor) => {
    if (nivel === "campana") filtroCrm = { campana: valor, conjunto: "", anuncio: "" };
    else if (nivel === "conjunto") filtroCrm = { ...filtroCrm, conjunto: valor, anuncio: "" };
    else filtroCrm = { ...filtroCrm, anuncio: valor };
    if (valor) {
      const f = reporteCrm?.anuncios?.filas.find((x) => x[`${nivel}_id`] === valor);
      if (f) { filtroCrm.campana = f.campana_id; if (nivel === "anuncio") filtroCrm.conjunto = f.conjunto_id; }
    }
    pintarReporte();
  };
  for (const k of ["campana", "conjunto", "anuncio"]) $(`#crm-f-${k}`).addEventListener("change", (e) => cambiarFiltro(k, e.target.value));
  $("#crm-f-quitar").addEventListener("click", () => { filtroCrm = { campana: "", conjunto: "", anuncio: "" }; pintarReporte(); });
  $("#crm-nivel").addEventListener("click", (e) => {
    const b = e.target.closest("[data-crm-nivel]");
    if (b) { nivelCrm = b.dataset.crmNivel; pintarReporte(); }
  });
  $("#crm-tabla").addEventListener("click", (e) => {
    const tr = e.target.closest("[data-crm-fila]");
    if (!tr) return;
    const [nivel, ...id] = tr.dataset.crmFila.split(":");
    cambiarFiltro(nivel, id.join(":"));
    if (nivel !== "anuncio") nivelCrm = nivel === "campana" ? "conjunto" : "anuncio";
    pintarReporte();
  });
  $("#crm-tabla").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("[data-crm-fila]")) e.target.click(); });

  // ---------- Utilidad del cliente: total de venta menos la inversión en anuncios ----------
  let editandoUtilidad = false;
  function pintarUtilidad(D) {
    const caja = $("#crm-utilidad");
    const r = reporteCrm;
    if (!r?.prospectos) { caja.hidden = true; return; }
    caja.hidden = false;
    const c = D.crm;
    const inv = D.hayAds ? D.tot.gasto : (ultimaCrm.embudo.inversion || 0);
    const cfg = r.utilidad; // solo con un cliente elegido
    const margenTodas = c.ventas && c.con_margen === c.ventas - c.sin_monto && c.con_margen > 0;
    const bruta = margenTodas ? c.ganancia : c.valor;
    const util = bruta - inv;
    const roas = inv ? c.valor / inv : null;
    const notaVentas = [
      c.ventas_reales ? `${c.ventas_reales} con monto` : "",
      c.estimadas ? `${c.estimadas} con el valor promedio${cfg?.ticket ? ` (${dinero(cfg.ticket)})` : ""}` : "",
      c.sin_monto ? `${c.sin_monto} sin monto` : "",
    ].filter(Boolean).join(" · ");
    const puedeEditar = Boolean(cfg) && !h.esEquipo();
    const falta = c.sin_monto && c.ventas;
    const formulario = puedeEditar && (editandoUtilidad || falta) ? `
      <form class="crm-ut-form" id="crm-ut-form">
        ${falta && !editandoUtilidad ? `<p class="crm-ut-falta"><b>${c.sin_monto} venta${c.sin_monto === 1 ? "" : "s"} sin monto.</b> Pon cuánto deja una venta en promedio y DELTA calcula el total.</p>` : ""}
        <label>Valor promedio de una venta<input type="text" inputmode="decimal" id="crm-ut-ticket" placeholder="ej. 4500" value="${cfg.ticket ?? ""}"></label>
        <label>Margen del cliente en % (opcional)<input type="text" inputmode="decimal" id="crm-ut-margen" placeholder="ej. 60" value="${cfg.margen ?? ""}"></label>
        <button type="submit" class="crm-ut-guardar">Guardar</button>
        ${editandoUtilidad ? `<button type="button" class="tb-link" id="crm-ut-cancelar">Cancelar</button>` : ""}
      </form>` : "";
    const nivel = !c.valor ? "" : util >= 0 ? "pos" : "neg";
    caja.innerHTML = `
      <div class="ag-cabeza"><h2>Utilidad del cliente</h2>
        <span class="crm-ut-cabeza">${puedeEditar && !editandoUtilidad && !falta ? `<button type="button" class="tb-link" id="crm-ut-ajustar">Ajustar valor y margen</button>` : ""}<span class="tb-hora">${esc(textoPeriodo([D.desde, D.hasta]))}</span></span>
      </div>
      <div class="crm-ut-cuerpo">
        <div class="crm-ut-total">
          <span class="tb-kpi-nombre">Total de venta</span>
          <b>${c.valor ? dinero(c.valor) : "–"}</b>
          <small class="tenue">${c.ventas} venta${c.ventas === 1 ? "" : "s"}${notaVentas ? ` · ${esc(notaVentas)}` : ""}</small>
        </div>
        <span class="crm-ut-signo" aria-hidden="true">−</span>
        <div class="crm-ut-dato"><span class="tb-kpi-nombre">Inversión en anuncios</span><b>${inv ? dinero(inv) : "–"}</b><small class="tenue">${D.hayAds ? "según Meta" : inv ? "anotada en Paid media" : "sin inversión anotada"}</small></div>
        ${margenTodas ? `<div class="crm-ut-dato"><span class="tb-kpi-nombre">Le queda de lo vendido</span><b>${dinero(c.ganancia)}</b><small class="tenue">con su margen de ${cfg?.margen ?? "su"} %</small></div>` : ""}
        <span class="crm-ut-signo" aria-hidden="true">=</span>
        <div class="crm-ut-final ${nivel}">
          <span class="tb-kpi-nombre">${margenTodas ? "Utilidad" : "Utilidad sobre anuncios"}</span>
          <b>${c.valor ? `${util < 0 ? "−" : ""}${dinero(Math.abs(util)) === "–" ? "$0" : dinero(Math.abs(util))}` : "–"}</b>
          <small class="tenue">${roas ? `ROAS ${roas.toLocaleString("es-MX", { maximumFractionDigits: 1 })}x · por cada $1 en anuncios vendió ${dinero2(roas)}` : c.valor ? "sin inversión en estas fechas" : "aún no hay ventas con monto"}</small>
        </div>
      </div>
      ${!margenTodas && c.valor && puedeEditar && !editandoUtilidad && !falta ? `<p class="tenue chico crm-ut-nota">Es lo vendido menos los anuncios. Si pones el margen del cliente en <b>Ajustar</b>, DELTA descuenta también lo que le cuesta dar el servicio.</p>` : ""}
      ${!cfg && c.sin_monto ? `<p class="tenue chico crm-ut-nota">${c.sin_monto} venta${c.sin_monto === 1 ? "" : "s"} sin monto. Elige un cliente para poner cuánto vale una venta en promedio.</p>` : ""}
      ${formulario}
      ${(D.ventas || []).length || c.ventas ? `<details class="crm-ut-lista" id="crm-ut-lista" ${verVentas ? "open" : ""}><summary>Ver ${c.ventas === 1 ? "la venta" : `las ${c.ventas} ventas`} de redes${c.ventas_otras ? ` y ${c.ventas_otras} más` : ""} de estas fechas</summary>
        <p class="tenue chico">Toca a alguien para abrir su ficha. Si no compró, cámbialo de etapa; si no vino de redes, cambia "De dónde salió". La fecha es el día en que llegó.</p>
        <ul>${(D.ventas || (D.pros || []).filter((p) => p.alcanzo >= 4)).slice().sort((a, b) => (a.redes === false) - (b.redes === false) || b.dia.localeCompare(a.dia)).map((p) => `<li${p.redes === false ? ' class="crm-ut-otra"' : ""}><button type="button" data-prospecto="${p.id}"><b>${esc(p.nombre || "Sin nombre")}</b><span class="tenue">${esc(p.dia.split("-").reverse().slice(0, 2).join("/"))} · ${esc(p.origen ? ORIGEN_VENTA[p.origen] : ultimaCrm.fuentes[p.fuente] || p.fuente)}${p.redes === false ? " · no cuenta como de redes" : p.confirmada === false ? " · sin confirmar" : ""}${p.campana ? ` · ${esc(p.campana)}` : ""}</span><span class="crm-ut-monto">${p.valor ? dinero(p.valor) : p.ticket ? `${dinero(p.ticket)} <small class="tenue">promedio</small>` : `<small class="tenue">sin monto</small>`}</span></button></li>`).join("")}</ul>
      </details>` : ""}`;
  }
  let verVentas = false;
  $("#crm-utilidad").addEventListener("toggle", (e) => { if (e.target.id === "crm-ut-lista") verVentas = e.target.open; }, true);
  $("#crm-utilidad").addEventListener("click", (e) => {
    if (e.target.closest("#crm-ut-ajustar")) { editandoUtilidad = true; pintarReporte(); setTimeout(() => $("#crm-ut-ticket")?.focus(), 30); }
    if (e.target.closest("#crm-ut-cancelar")) { editandoUtilidad = false; pintarReporte(); }
  });
  $("#crm-utilidad").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const k = await api("/crm/utilidad", { method: "PUT", body: { cliente: clienteCrm, ticket: $("#crm-ut-ticket").value.trim(), margen: $("#crm-ut-margen").value.trim() } });
      sonar("accion");
      editandoUtilidad = false;
      for (const p of reporteCrm?.prospectos || []) { p.ticket = k.ticket; p.margen = k.margen; }
      if (reporteCrm) reporteCrm.utilidad = { ticket: k.ticket, margen: k.margen };
      pintarReporte();
    } catch (err) { avisar(err.message); }
  });

  function pintarCostos(D) {
    const e = ultimaCrm.embudo;
    const c = D.crm;
    const inv = D.hayAds ? D.tot.gasto : e.inversion;
    const costos = [
      inv ? ["Inversión en anuncios", dinero(inv)] : null,
      inv && c.prospectos ? ["Costo por prospecto", dinero2(inv / c.prospectos)] : null,
      inv && c.citas ? ["Costo por cita", dinero2(inv / c.citas)] : null,
      inv && c.ventas ? ["Costo por venta", dinero2(inv / c.ventas)] : null,
      c.ventas && c.valor ? ["Ticket promedio", dinero(c.valor / c.ventas)] : null,
      inv && c.valor ? ["Retorno", `${(c.valor / inv).toLocaleString("es-MX", { maximumFractionDigits: 1 })}x`] : null,
    ].filter(Boolean);
    if (!D.hayAds && e.meta) {
      costos.unshift(["Conversaciones por anuncios (Meta)", `${e.meta.conversaciones}${e.meta.costo_conversacion ? ` · ${dinero(e.meta.costo_conversacion)} c/u` : ""}`]);
      if (e.meta.formularios) costos.splice(1, 0, ["Formularios llenados (Meta)", String(e.meta.formularios)]);
    }
    $("#crm-costos").innerHTML = costos.length
      ? costos.map(([k, v]) => `<div><span class="tenue">${esc(k)}</span><b>${esc(v)}</b></div>`).join("")
      : c.prospectos ? `<p class="tenue chico">Liga la cuenta de anuncios del cliente en Cuentas → Meta (o anota el gasto en Paid media) para ver cuánto cuesta cada prospecto, cita y venta.</p>` : "";
    const cuenta = new Map();
    for (const p of D.pros || []) {
      const x = cuenta.get(p.fuente) || { nombre: ultimaCrm.fuentes[p.fuente] || p.fuente, prospectos: 0, citas: 0, ventas: 0 };
      x.prospectos++; if (p.alcanzo >= 2) x.citas++; if (p.alcanzo >= 4) x.ventas++;
      cuenta.set(p.fuente, x);
    }
    const fuentes = D.pros ? [...cuenta.values()].sort((a, b) => b.prospectos - a.prospectos) : e.por_fuente;
    const totalF = fuentes.reduce((s, f) => s + f.prospectos, 0);
    $("#crm-fuentes").innerHTML = fuentes.length
      ? `<span class="crm-sub tenue">De dónde llegan</span>` + fuentes.slice(0, 5).map((f) => `<div class="crm-fuente"><span>${esc(f.nombre)}</span><span class="pg-barra"><i data-ancho="${Math.round((f.prospectos / totalF) * 100)}"></i></span><small class="tenue">${f.prospectos} · ${f.citas} cita${f.citas === 1 ? "" : "s"} · ${f.ventas} venta${f.ventas === 1 ? "" : "s"}</small></div>`).join("")
      : "";
  }

  // Columnas largas (cientos de chats): se muestran de 20 en 20.
  const POR_COLUMNA = 20;
  const verCrm = {};
  function tarjetaProspecto(p, i, ultima) {
    const n = p.sin_responder || p.cita_pasada ? (p.sin_responder ? "rojo" : "amarillo") : p.cita_hoy ? "verde" : "";
    const linea = p.etapa === "nuevo" && p.horas_esperando !== null ? esperaTxt(p.horas_esperando)
      : p.etapa === "cita" && p.cita ? (p.cita_pasada ? `la cita fue ${citaBonita(p.cita)}` : `cita ${citaBonita(p.cita)}`)
      : p.etapa === "venta" ? (p.valor ? dinero(p.valor) : "venta sin monto")
      : p.etapa === "perdido" ? (p.motivo_perdido || "perdido")
      : p.dias_en_etapa ? `${p.dias_en_etapa} día${p.dias_en_etapa === 1 ? "" : "s"} en esta etapa` : "pasó a esta etapa hoy";
    return `<article class="ct-pieza crm-p ${n ? "n-" + n : ""}" draggable="true" data-prospecto="${p.id}" tabindex="0" aria-label="${esc(p.nombre)}">
      <div class="ct-p-cabeza"><span class="ct-fmt">${esc(p.fuente_nombre)}${p.whatsapp_abierto ? ` · <span class="crm-wa-on" title="Escribió en las últimas 24 h">WhatsApp abierto</span>` : ""}</span></div>
      <b class="ct-p-titulo">${esc(p.nombre)}</b>
      ${p.interes ? `<span class="ct-p-cliente">${esc(p.interes)}</span>` : ""}
      ${clienteCrm ? "" : `<span class="crm-p-cliente tenue">${esc(p.cliente)}</span>`}
      <div class="ct-p-pie">
        <span class="ct-p-fecha ${n ? "t-" + n : "tenue"}">${esc(linea)}</span>
        ${p.responsable ? `<span class="ct-p-resp tenue" title="Lo atiende">${esc(p.responsable)}</span>` : ""}
      </div>
      <div class="ct-p-mover">
        <button type="button" data-crm-mover="-1" aria-label="Etapa anterior" ${i === 0 ? "disabled" : ""}>‹</button>
        <button type="button" data-crm-mover="1" aria-label="Siguiente etapa" ${ultima ? "disabled" : ""}>›</button>
      </div>
    </article>`;
  }

  function pintarCrm(t) {
    const sel = $("#crm-cliente");
    if (h.restringido() && !clienteCrm && t.cliente) clienteCrm = String(clientesFi.find((c) => c.nombre === t.cliente)?.id || "");
    sel.innerHTML = (h.restringido() ? "" : `<option value="">Todos los clientes</option>`) + clientesFi.map((c) => `<option value="${c.id}" ${String(c.id) === String(clienteCrm) ? "selected" : ""}>${esc(c.nombre)}</option>`).join("");
    $("#crm-config").hidden = !clienteCrm;
    $("#crm-meta").hidden = !clienteCrm;
    pintarAvisoMeta(t);

    // Para hoy
    const lineas = [
      ...t.sin_responder.map((p) => ({ p, nivel: "rojo", txt: `${esperaTxt(p.horas_esperando)}${p.telefono_bonito ? ` · ${p.telefono_bonito}` : ""}` })),
      ...t.citas_hoy.map((p) => ({ p, nivel: "verde", txt: `cita ${citaBonita(p.cita)}` })),
      ...t.citas_pasadas.map((p) => ({ p, nivel: "amarillo", txt: `¿vino? su cita fue ${citaBonita(p.cita)}` })),
      ...t.esperando.filter((p) => !p.sin_responder).map((p) => ({ p, nivel: "info", txt: esperaTxt(p.horas_esperando) })),
    ];
    const bor = t.borradores;
    $("#crm-hoy").innerHTML = `<div class="ag-cabeza"><h2>Para hoy</h2><span class="tb-hora">${lineas.length ? `${lineas.length} pendiente${lineas.length === 1 ? "" : "s"}` : "todo al día"}</span></div>
      ${lineas.length ? `<ul class="pm-avisos ct-avisos">${lineas.slice(0, 10).map(({ p, nivel, txt }) => `<li class="pm-aviso n-${nivel}" data-prospecto="${p.id}" tabindex="0">${foco(nivel)}<span class="pg-linea-txt"><b>${esc(p.nombre)}</b><small>${esc(p.cliente)} · ${esc(txt)}</small></span></li>`).join("")}</ul>`
        : `<p class="ct-vacia">Nadie esperando respuesta y ninguna cita hoy.</p>`}
      ${bor.length ? `<div class="crm-bor"><span class="crm-sub tenue">Mensajes listos para mandar (${bor.length})</span>${bor.slice(0, 4).map((b) => `<button type="button" class="crm-bor-item" data-prospecto="${b.prospecto_id}"><b>${esc(b.nombre)}</b><span class="tenue">${esc(b.texto.slice(0, 90))}${b.texto.length > 90 ? "…" : ""}</span></button>`).join("")}</div>` : ""}`;

    // Pestañas (celular) y columnas
    $("#crm-tabs").innerHTML = t.etapas.map((x) => `<button type="button" data-crm-tab="${x.clave}" class="${x.clave === etapaCrmCel ? "activa" : ""}">${esc(x.nombre)} <small>${x.prospectos.length}</small></button>`).join("");
    $("#crm-board").innerHTML = t.etapas.map((x, i) => `<section class="ct-col crm-col ${x.clave === etapaCrmCel ? "sel" : ""}" data-crm-etapa="${x.clave}">
        <header class="ct-col-cabeza"><span>${esc(x.nombre)}</span><small>${x.prospectos.length}</small>${x.clave === "nuevo" ? `<button type="button" class="ct-mas" data-crm-nuevo aria-label="Nuevo prospecto">+</button>` : ""}</header>
        <div class="ct-col-piezas">${x.prospectos.length ? x.prospectos.slice(0, verCrm[x.clave] || POR_COLUMNA).map((p) => tarjetaProspecto(p, i, i === t.etapas.length - 1)).join("") + (x.prospectos.length > (verCrm[x.clave] || POR_COLUMNA) ? `<button type="button" class="crm-ver-mas" data-crm-ver="${x.clave}">Ver ${Math.min(POR_COLUMNA, x.prospectos.length - (verCrm[x.clave] || POR_COLUMNA))} más <small>(quedan ${x.prospectos.length - (verCrm[x.clave] || POR_COLUMNA)})</small></button>` : "") : `<p class="ct-vacia">${x.clave === "nuevo" ? "Aquí caen los del formulario y WhatsApp" : x.clave === "venta" || x.clave === "perdido" ? "Últimos 30 días" : "Nadie aquí"}</p>`}</div>
      </section>`).join("");
    pintarReporte();
  }

  // Por qué puede estar vacío y qué falta para que se llene solo
  function pintarAvisoMeta(t) {
    const caja = $("#crm-aviso-meta");
    const e = t.embudo;
    const vacio = !t.etapas.some((x) => x.prospectos.length);
    let html = "";
    const faltan = t.meta.faltan || [];
    if (t.meta.conectado && faltan.length) {
      html = `<b>Meta todavía no le da a DELTA permiso para ver ${esc(faltan.join(", "))}.</b>
        <p class="tenue chico">Por eso no aparecen aquí las personas que llenaron formularios o escribieron por tus anuncios. Ve a <b>Cuentas → Conectar Meta</b>, entra con tu Facebook y, cuando te lo pregunte, deja todo marcado y toca Continuar. Luego toca <b>Traer de Meta</b> y se llena solo.</p>`;
    } else if (vacio && e.meta?.conversaciones) {
      html = `<b>Tus anuncios abrieron ${e.meta.conversaciones === 1 ? "1 conversación" : `${e.meta.conversaciones} conversaciones`} este mes. Toca <b>Traer de Meta</b> para ver aquí a quien escribió por Messenger o Instagram.</b>
        <p class="tenue chico">Las que fueron por WhatsApp viven en el WhatsApp de la clínica: llegan aquí cuando conectes ese WhatsApp o su Pancake/Kommo en <b>Conexiones</b>. Mientras, agrégalas con <b>+ Prospecto</b>.</p>`;
    } else if (vacio && t.cliente && t.meta.paginas === 0) {
      html = `<b>Este cliente todavía no tiene su página de Facebook ligada.</b><p class="tenue chico">Lígala en Cuentas → Meta para traer sus formularios de anuncios.</p>`;
    }
    caja.innerHTML = html;
    caja.hidden = !html;
  }
  $("#crm-meta").addEventListener("click", async (ev) => {
    const b = ev.currentTarget;
    if (!clienteCrm) return avisar("Elige primero un cliente");
    b.disabled = true;
    const antes = b.textContent;
    b.textContent = "Buscando…";
    try {
      const r = await api("/crm/meta", { method: "POST", body: { cliente: clienteCrm } });
      const partes = [];
      if (r.nuevos) partes.push(`Traje ${r.nuevos} prospecto${r.nuevos === 1 ? "" : "s"} nuevo${r.nuevos === 1 ? "" : "s"}${r.mensajes ? ` (${r.mensajes} por mensajes)` : ""}.`);
      if (!r.paginas) partes.push("Este cliente no tiene página de Facebook ligada. Lígala en Cuentas → Meta.");
      else if (r.faltan?.length) partes.push(`Falta que Meta dé permiso para ${r.faltan.join(", ")}: vuelve a conectar Meta en Cuentas.`);
      else if (!r.nuevos) partes.push("No hay nadie nuevo en formularios ni en mensajes de Messenger o Instagram.");
      avisar(partes.join(" "));
      await cargarCrm();
    } catch (err) { avisar(err.message); }
    finally { b.disabled = false; b.textContent = antes; }
  });

  const prospectoPorId = (id) => ultimaCrm?.etapas.flatMap((e) => e.prospectos).find((p) => p.id === Number(id));

  // ----- Ficha del prospecto -----
  const HIST_ICONO = { entrante: "💬", saliente: "↗", nota: "✎", etapa: "•", borrador: "✉" };
  function pintarHistorial(f) {
    const hist = f.historial.filter((x) => !(x.tipo === "borrador" && x.estado === "pendiente"));
    $("#crm-historial").innerHTML = hist.length ? hist.map((x) => `<li class="crm-h t-${x.tipo}">
        <span class="crm-h-txt">${x.tipo === "borrador" ? `<small class="tenue">Borrador sin mandar</small>` : ""}${esc(x.texto || "")}</span>
        <small class="tenue">${HIST_ICONO[x.tipo] || ""} ${esc(fmtDia(x.fecha))} ${esc(fmtHora(x.fecha))}</small>
      </li>`).join("") : `<li class="ct-vacia">Sin movimientos todavía</li>`;
    const h0 = $("#crm-historial");
    requestAnimationFrame(() => { h0.scrollTop = h0.scrollHeight; });
    const wa = f.whatsapp_api;
    $("#crm-wa-estado").innerHTML = !f.telefono ? `<span class="tb-chip s-amarillo">Sin teléfono</span> <span class="tenue chico">Agrégale su número para escribirle.</span>`
      : wa && f.whatsapp_abierto ? `<span class="tb-chip s-verde">WhatsApp abierto</span> <span class="tenue chico">Escribió hace menos de 24 h: puedes mandarle el mensaje desde aquí.</span>`
      : wa ? `<span class="tb-chip s-amarillo">Ventana cerrada</span> <span class="tenue chico">Pasaron más de 24 h desde su último mensaje; ábrelo en WhatsApp desde el teléfono del cliente.</span>`
      : `<span class="tenue chico">${esc(f.telefono_bonito)} · DELTA te deja el mensaje listo y tú lo mandas desde WhatsApp.</span>`;
    const b = f.borradores.at(-1);
    $("#crm-mensaje").value = b?.texto || "";
    $("#crm-borrador-id").value = b?.id || "";
    actualizarBotonesWa();
  }
  function actualizarBotonesWa() {
    const f = fichaCrm;
    if (!f) return;
    const txt = $("#crm-mensaje").value.trim();
    const link = $("#crm-abrir-wa");
    link.hidden = !f.telefono;
    link.href = f.telefono ? `https://wa.me/${f.telefono}${txt ? `?text=${encodeURIComponent(txt)}` : ""}` : "#";
    $("#crm-enviar").hidden = !(f.whatsapp_api && f.whatsapp_abierto && f.telefono);
    $("#crm-enviar").disabled = !txt;
    $("#crm-marcar").disabled = !txt;
  }

  async function abrirProspecto(id = null) {
    const t = ultimaCrm;
    if (!t) return;
    fichaCrm = null;
    let f = null;
    if (id) {
      try { f = await api(`/crm/prospectos/${id}`); } catch (err) { return avisar(err.message); }
      fichaCrm = f;
    }
    $("#crm-dlg-titulo").textContent = f ? f.nombre : "Nuevo prospecto";
    $("#crm-id").value = f?.id || "";
    $("#crm-nombre").value = f?.nombre || "";
    $("#crm-telefono").value = f?.telefono_bonito || "";
    $("#crm-correo").value = f?.correo || "";
    $("#crm-f-cliente").innerHTML = clientesFi.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join("") || `<option value="">Primero da de alta un cliente</option>`;
    $("#crm-f-cliente").value = String(f?.cliente_id || clienteCrm || clientesFi[0]?.id || "");
    $("#crm-etapa").innerHTML = t.etapas.map((e) => `<option value="${e.clave}">${esc(e.nombre)}</option>`).join("");
    $("#crm-etapa").value = f?.etapa || (matchMedia("(max-width: 900px)").matches && etapaCrmCel !== "perdido" ? etapaCrmCel : "nuevo");
    $("#crm-fuente").innerHTML = Object.entries(t.fuentes).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("");
    $("#crm-fuente").value = f?.fuente || "whatsapp";
    $("#crm-interes").value = f?.interes || "";
    $("#crm-cita").value = f?.cita || "";
    $("#crm-valor").value = f?.valor ?? "";
    $("#crm-responsable").value = f?.responsable || "";
    $("#crm-motivo").value = f?.motivo_perdido || "";
    $("#crm-origen").value = f?.origen || "";
    $("#crm-venta-fecha").value = f?.venta_fecha || "";
    $("#crm-notas").value = f?.notas || "";
    $("#crm-notas-l").hidden = Boolean(f && !f.notas);
    $("#crm-nota").value = "";
    $("#crm-msg").hidden = true;
    $("#crm-borrar").hidden = !f;
    $("#crm-borrar").textContent = "Quitar";
    $("#crm-borrar").classList.remove("seguro");
    $("#crm-conversa").hidden = !f;
    $("#dlg-prospecto").classList.toggle("con-conversa", Boolean(f));
    if (f) pintarHistorial(f);
    mostrarMotivo();
    $("#dlg-prospecto").showModal();
    if (!f) setTimeout(() => $("#crm-nombre").focus(), 50);
  }
  const mostrarMotivo = () => { $("#crm-motivo-l").hidden = $("#crm-etapa").value !== "perdido"; $("#crm-venta-l").hidden = $("#crm-etapa").value !== "venta"; };
  $("#crm-etapa").addEventListener("change", mostrarMotivo);
  $("#crm-mensaje").addEventListener("input", actualizarBotonesWa);

  const errorCrm = (err) => { $("#crm-msg").textContent = err.message; $("#crm-msg").hidden = false; };
  $("#form-prospecto").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $("#crm-id").value;
    const datos = {
      nombre: $("#crm-nombre").value.trim(), telefono: $("#crm-telefono").value.trim() || null, correo: $("#crm-correo").value.trim() || null,
      cliente: $("#crm-f-cliente").value, etapa: $("#crm-etapa").value, fuente: $("#crm-fuente").value,
      interes: $("#crm-interes").value.trim() || null, cita: $("#crm-cita").value || null,
      valor: $("#crm-valor").value === "" ? null : Number($("#crm-valor").value), responsable: $("#crm-responsable").value.trim() || null,
      notas: $("#crm-notas").value.trim() || null,
    };
    if ($("#crm-etapa").value === "perdido") datos.motivo_perdido = $("#crm-motivo").value.trim() || null;
    if ($("#crm-etapa").value === "venta") { datos.origen = $("#crm-origen").value || null; if ($("#crm-venta-fecha").value) datos.venta_fecha = $("#crm-venta-fecha").value; }
    if (!datos.nombre && !datos.telefono) return errorCrm(new Error("Pon al menos el nombre o el teléfono"));
    try {
      const r = await api(id ? `/crm/prospectos/${id}` : "/crm/prospectos", { method: id ? "PATCH" : "POST", body: datos });
      sonar("accion");
      $("#dlg-prospecto").close();
      if (r?.ya_existia) avisar(`${r.nombre} ya estaba en el CRM; te abro su ficha.`);
      await cargarCrm();
      if (r?.ya_existia) abrirProspecto(r.id);
    } catch (err) { errorCrm(err); }
  });
  $("#crm-cancelar").addEventListener("click", () => $("#dlg-prospecto").close());
  $("#dlg-prospecto").addEventListener("close", () => { if (fichaCrm) cargarCrm().catch(() => {}); fichaCrm = null; });
  $("#crm-borrar").addEventListener("click", async (e) => {
    const b = e.currentTarget;
    if (!b.classList.contains("seguro")) { b.classList.add("seguro"); b.textContent = "¿Seguro? Toca otra vez"; return; }
    try { await api(`/crm/prospectos/${$("#crm-id").value}`, { method: "DELETE" }); sonar("accion"); fichaCrm = null; $("#dlg-prospecto").close(); await cargarCrm(); }
    catch (err) { errorCrm(err); }
  });
  async function accionFicha(boton, fn) {
    boton.disabled = true;
    $("#crm-msg").hidden = true;
    try { const f = await fn(); if (f?.historial) { fichaCrm = f; pintarHistorial(f); } }
    catch (err) { errorCrm(err); }
    finally { boton.disabled = false; actualizarBotonesWa(); }
  }
  $("#crm-sugerir").addEventListener("click", (e) => accionFicha(e.currentTarget, async () => {
    const b = e.currentTarget;
    const antes = b.textContent;
    b.textContent = "Pensando…";
    try {
      const r = await api(`/crm/prospectos/${fichaCrm.id}/sugerir`, { method: "POST", body: {} });
      return await api(`/crm/prospectos/${fichaCrm.id}`).then((f) => ({ ...f, borradores: f.borradores.length ? f.borradores : [{ id: r.borrador_id, texto: r.texto }] }));
    } finally { b.textContent = antes; }
  }));
  // Guarda lo escrito como borrador (si cambió) y devuelve su id
  async function borradorActual() {
    const txt = $("#crm-mensaje").value.trim();
    const bid = $("#crm-borrador-id").value;
    const previo = fichaCrm.borradores.find((b) => String(b.id) === bid);
    if (previo && previo.texto === txt) return Number(bid);
    if (previo) await api(`/crm/borradores/${bid}`, { method: "DELETE" });
    const r = await api(`/crm/prospectos/${fichaCrm.id}/borrador`, { method: "POST", body: { texto: txt } });
    return r.borrador_id;
  }
  $("#crm-enviar").addEventListener("click", (e) => accionFicha(e.currentTarget, async () => {
    const borrador_id = await borradorActual();
    const f = await api(`/crm/prospectos/${fichaCrm.id}/enviar`, { method: "POST", body: { borrador_id } });
    sonar("accion");
    avisar("Mensaje enviado por WhatsApp");
    return f;
  }));
  $("#crm-marcar").addEventListener("click", (e) => accionFicha(e.currentTarget, async () => {
    const borrador_id = await borradorActual();
    const f = await api(`/crm/prospectos/${fichaCrm.id}/enviado`, { method: "POST", body: { borrador_id } });
    sonar("accion");
    return f;
  }));
  // Al abrir WhatsApp se guarda el mensaje como borrador para luego marcarlo como enviado
  $("#crm-abrir-wa").addEventListener("click", () => {
    if (!$("#crm-mensaje").value.trim() || !fichaCrm) return;
    borradorActual().then((id) => { $("#crm-borrador-id").value = id; return api(`/crm/prospectos/${fichaCrm.id}`); })
      .then((f) => { fichaCrm = f; }).catch(() => {});
  });
  const anotar = (b) => accionFicha(b, async () => {
    const txt = $("#crm-nota").value.trim();
    if (!txt) return null;
    await api(`/crm/prospectos/${fichaCrm.id}/nota`, { method: "POST", body: { texto: txt } });
    $("#crm-nota").value = "";
    const f = await api(`/crm/prospectos/${fichaCrm.id}`);
    // no pisar lo que esté escribiendo en el mensaje
    const msg = $("#crm-mensaje").value, bid = $("#crm-borrador-id").value;
    fichaCrm = f; pintarHistorial(f); $("#crm-mensaje").value = msg; $("#crm-borrador-id").value = bid;
    return null;
  });
  $("#crm-nota-btn").addEventListener("click", (e) => anotar(e.currentTarget));
  $("#crm-nota").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); anotar($("#crm-nota-btn")); } });

  // ----- Formulario y WhatsApp del cliente -----
  let cfgCrm = null;
  async function abrirConfigCrm() {
    if (!clienteCrm) return avisar("Elige primero un cliente");
    try { cfgCrm = await api(`/crm/config?cliente=${encodeURIComponent(clienteCrm)}`); } catch (err) { return avisar(err.message); }
    $("#crm-cfg-titulo").textContent = `${cfgCrm.cliente}: conexiones`;
    pintarTipoExt();
    $("#crm-ext-msg").hidden = true;
    cargarFuentes();
    pintarLinkCrm();
    $("#crm-cfg-bienvenida").value = cfgCrm.bienvenida || "";
    $("#crm-cfg-numero").value = cfgCrm.wa_numero || "";
    $("#crm-cfg-phoneid").value = cfgCrm.wa_phone_id || "";
    $("#crm-cfg-wa-txt").textContent = cfgCrm.whatsapp_token
      ? "Con el id del número, los mensajes que le escriban al WhatsApp del cliente llegan aquí solos y puedes contestar desde DELTA (siempre tú das el clic)."
      : "Con su número, DELTA arma el link para abrir cada conversación en WhatsApp. Para que los mensajes lleguen solos aquí hace falta conectar la API de WhatsApp de Meta; te guío cuando quieras.";
    $("#crm-cfg-msg").hidden = true;
    $("#dlg-crm-config").showModal();
  }
  // ----- Kommo, GoHighLevel y Pancake -----
  let tipoExt = "kommo";
  const PASOS_EXT = {
    kommo: { cuenta: "Subdominio de Kommo", ph: "Ej. miclinica", pasos: [
      "Entra a Kommo con una cuenta de administrador.",
      "Ve a Configuración → Integraciones → Crear integración → Integración privada (no hace falta dirección de regreso).",
      "En la pestaña \"Llaves y alcances\" toca \"Generar token de larga duración\", elige que dure 1 año o más y cópialo.",
      "Pega aquí el subdominio y el token." ] },
    ghl: { cuenta: "Id de la sub-cuenta (Location ID)", ph: "Ej. ve3EPYOqQBu1uhG8jXQ2", pasos: [
      "Entra a la sub-cuenta del cliente en GoHighLevel.",
      "Ve a Settings → Private Integrations → Create New Integration.",
      "Marca solo permisos de lectura: Opportunities (ver) y Contacts (ver). Genera el token y cópialo (solo se muestra una vez).",
      "El Location ID está en Settings → Business Profile. Pega los dos aquí." ] },
    pancake: { cuenta: "", ph: "", sinCuenta: true, pasos: [
      "En Pancake abre la página del cliente → Configuración → Herramientas → <b>Public API access token</b>: toca <b>Crear Token</b> (si no hay) y luego <b>Copiar</b>.",
      "Pégala abajo en <b>Llave</b> y toca <b>Conectar y traer</b>. Listo: DELTA sola sabe de qué página es.",
      "Cada página (WhatsApp, Facebook, Instagram) tiene su propia llave; conecta las que quieras." ] },
  };
  function pintarTipoExt() {
    const x = PASOS_EXT[tipoExt];
    $("#crm-ext-tipo").querySelectorAll("[data-ext]").forEach((b) => b.classList.toggle("activa", b.dataset.ext === tipoExt));
    $("#crm-ext-pasos").innerHTML = x.pasos.map((p) => `<li>${p}</li>`).join("");
    $("#crm-ext-cuenta-l").textContent = x.cuenta;
    $("#crm-ext-cuenta").placeholder = x.ph;
    $("#crm-ext-cuenta").closest("label").hidden = Boolean(x.sinCuenta);
  }
  $("#crm-ext-tipo").addEventListener("click", (e) => { const b = e.target.closest("[data-ext]"); if (b) { tipoExt = b.dataset.ext; pintarTipoExt(); } });
  async function cargarFuentes() {
    const r = await api(`/crm/fuentes?cliente=${encodeURIComponent(clienteCrm)}`).catch(() => ({ fuentes: [] }));
    $("#crm-ext-lista").innerHTML = r.fuentes.map((f) => `<li class="crm-fuente-fila">
        <span><b>${esc(f.nombre)}</b> <small class="tenue">${esc(f.cuenta)} · llave ${esc(f.token_final || "")}</small><br>
        <small class="${f.error ? "t-rojo" : "tenue"}">${f.error ? esc(f.error) : f.ultimo ? `Última vez ${haceRato(f.ultimo)}${f.resultado ? ` · ${f.resultado.nuevos} nuevo${f.resultado.nuevos === 1 ? "" : "s"}` : ""}` : "Conectado"}</small>
        ${f.tipo === "pancake" ? `<br><small class="tenue">${f.resultado?.chats ? `DELTA leyó ${f.resultado.chats.leidos} chat${f.resultado.chats.leidos === 1 ? "" : "s"} ${haceRato(f.resultado.chats.fecha)}: ${f.resultado.chats.movidos} acomodados (${f.resultado.chats.ventas} venta${f.resultado.chats.ventas === 1 ? "" : "s"}, ${f.resultado.chats.perdidos} perdido${f.resultado.chats.perdidos === 1 ? "" : "s"})${f.resultado.chats.pendientes ? ` · faltan ${f.resultado.chats.pendientes}` : ""}` : "DELTA lee los chats y acomoda a cada quien en su etapa."}</small>` : ""}</span>
        <span class="crm-link-botones"><button type="button" data-ext-sinc="${f.id}">Traer ahora</button>${f.tipo === "pancake" ? `<button type="button" data-ext-leer="${f.id}">Leer chats</button>` : ""}<button type="button" class="peligro" data-ext-quitar="${f.id}">Quitar</button></span>
      </li>`).join("") || `<li class="tenue chico">Ninguno conectado todavía.</li>`;
  }
  $("#crm-ext-lista").addEventListener("click", async (e) => {
    const l = e.target.closest("[data-ext-leer]");
    if (l) {
      l.disabled = true; l.textContent = "Leyendo…";
      try { await api(`/crm/fuentes/${l.dataset.extLeer}/leer`, { method: "POST" }); avisar("DELTA está leyendo los chats. En unos minutos verás a cada quien en su etapa (ventas, citas, perdidos)."); }
      catch (err) { avisar(err.message); l.disabled = false; l.textContent = "Leer chats"; }
      return;
    }
    const s = e.target.closest("[data-ext-sinc]"), q = e.target.closest("[data-ext-quitar]");
    if (!s && !q) return;
    const b = s || q;
    if (q && !q.classList.contains("seguro")) { q.classList.add("seguro"); q.textContent = "¿Seguro?"; return; }
    b.disabled = true;
    try {
      if (s) { const r = await api(`/crm/fuentes/${s.dataset.extSinc}/sincronizar`, { method: "POST" }); avisar(`${r.nombre}: ${r.nuevos} nuevo${r.nuevos === 1 ? "" : "s"}, ${r.movidos} cambiaron de etapa.`); }
      else await api(`/crm/fuentes/${q.dataset.extQuitar}`, { method: "DELETE" });
      await cargarFuentes(); cargarCrm().catch(() => {});
    } catch (err) { $("#crm-ext-msg").textContent = err.message; $("#crm-ext-msg").hidden = false; await cargarFuentes(); }
  });
  $("#crm-ext-conectar").addEventListener("click", async (e) => {
    const b = e.currentTarget;
    $("#crm-ext-msg").hidden = true;
    b.disabled = true; b.textContent = "Conectando…";
    try {
      const r = await api("/crm/fuentes", { method: "POST", body: { cliente: clienteCrm, tipo: tipoExt, cuenta: $("#crm-ext-cuenta").value, token: $("#crm-ext-token").value } });
      $("#crm-ext-token").value = ""; $("#crm-ext-cuenta").value = "";
      sonar("accion");
      avisar(`${r.nombre} conectado: traje ${r.nuevos} prospecto${r.nuevos === 1 ? "" : "s"}.`);
      await cargarFuentes(); cargarCrm().catch(() => {});
    } catch (err) { $("#crm-ext-msg").textContent = err.message; $("#crm-ext-msg").hidden = false; }
    finally { b.disabled = false; b.textContent = "Conectar y traer"; }
  });

  function pintarLinkCrm() {
    const url = cfgCrm.formulario ? `${location.origin}${cfgCrm.formulario}` : null;
    $("#crm-cfg-link").innerHTML = url
      ? `<code class="crm-url">${esc(url)}</code><div class="crm-link-botones"><button type="button" data-crm-link="copiar">Copiar</button><a href="${esc(url)}" target="_blank" rel="noopener" class="tb-link">Ver</a><button type="button" data-crm-link="apagar" class="peligro">Desactivar</button></div>`
      : `<button type="button" class="primario" data-crm-link="crear">Crear formulario</button>`;
  }
  $("#crm-cfg-link").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-crm-link]");
    if (!b) return;
    const acc = b.dataset.crmLink;
    if (acc === "copiar") {
      try { await navigator.clipboard.writeText(`${location.origin}${cfgCrm.formulario}`); b.textContent = "¡Copiado!"; } catch { b.textContent = "Selecciónalo y cópialo"; }
      return;
    }
    if (acc === "apagar" && !b.classList.contains("seguro")) { b.classList.add("seguro"); b.textContent = "¿Seguro? El link dejará de funcionar"; return; }
    try {
      cfgCrm = { ...cfgCrm, ...(await api("/crm/config", { method: "PUT", body: { cliente: clienteCrm, formulario: acc === "crear" } })) };
      pintarLinkCrm();
    } catch (err) { $("#crm-cfg-msg").textContent = err.message; $("#crm-cfg-msg").hidden = false; }
  });
  $("#form-crm-config").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/crm/config", { method: "PUT", body: { cliente: clienteCrm, bienvenida: $("#crm-cfg-bienvenida").value.trim() || null, wa_numero: $("#crm-cfg-numero").value.trim() || null, wa_phone_id: $("#crm-cfg-phoneid").value.trim() || null } });
      sonar("accion");
      $("#dlg-crm-config").close();
    } catch (err) { $("#crm-cfg-msg").textContent = err.message; $("#crm-cfg-msg").hidden = false; }
  });
  $("#crm-cfg-cancelar").addEventListener("click", () => $("#dlg-crm-config").close());
  $("#crm-config").addEventListener("click", abrirConfigCrm);
  $("#crm-nuevo").addEventListener("click", () => abrirProspecto());
  $("#crm-cliente").addEventListener("change", (e) => {
    clienteCrm = e.target.value;
    guardado.set("delta_crm_cliente", clienteCrm);
    filtroCrm = { campana: "", conjunto: "", anuncio: "" };
    cargarCrm().catch((err) => avisar(err.message));
  });

  async function moverProspecto(id, cambio) {
    try { await api(`/crm/prospectos/${id}`, { method: "PATCH", body: cambio }); sonar("accion"); }
    catch (err) { avisar(err.message); }
    await cargarCrm().catch(() => {});
  }
  const seccionCrm = $('[data-seccion="crm"]');
  seccionCrm.addEventListener("click", (e) => {
    const tab = e.target.closest("[data-crm-tab]");
    if (tab) {
      etapaCrmCel = tab.dataset.crmTab;
      seccionCrm.querySelectorAll("[data-crm-tab]").forEach((x) => x.classList.toggle("activa", x === tab));
      seccionCrm.querySelectorAll(".crm-col").forEach((x) => x.classList.toggle("sel", x.dataset.crmEtapa === etapaCrmCel));
      return;
    }
    const ir = e.target.closest("[data-crm-ir]");
    if (ir) {
      if (ir.dataset.crmIr === "hoy") return void $("#crm-hoy").scrollIntoView({ behavior: "smooth", block: "center" });
      if (ir.dataset.crmIr === "ventas-lista") {
        const l = $("#crm-ut-lista");
        if (l) { l.open = true; verVentas = true; return void l.scrollIntoView({ behavior: "smooth", block: "center" }); }
        ir.dataset.crmIr = "venta";
      }
      seccionCrm.querySelector(`[data-crm-tab="${ir.dataset.crmIr}"]`)?.click();
      return void seccionCrm.querySelector(`.crm-col[data-crm-etapa="${ir.dataset.crmIr}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
    const verMas = e.target.closest("[data-crm-ver]");
    if (verMas) { const k = verMas.dataset.crmVer; verCrm[k] = (verCrm[k] || POR_COLUMNA) + POR_COLUMNA; return void pintarCrm(ultimaCrm); }
    if (e.target.closest("[data-crm-nuevo]")) return abrirProspecto();
    const mover = e.target.closest("[data-crm-mover]");
    const tarjeta = e.target.closest("[data-prospecto]");
    if (mover && tarjeta) {
      mover.disabled = true;
      return void moverProspecto(tarjeta.dataset.prospecto, { mover: Number(mover.dataset.crmMover) });
    }
    if (tarjeta) abrirProspecto(tarjeta.dataset.prospecto);
  });
  seccionCrm.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches?.("[data-prospecto], [data-crm-ir]")) e.target.click();
  });
  let arrastrandoCrm = null;
  seccionCrm.addEventListener("dragstart", (e) => {
    const t = e.target.closest?.(".crm-p");
    if (!t) return;
    arrastrandoCrm = t.dataset.prospecto;
    t.classList.add("arrastrando");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", arrastrandoCrm);
  });
  seccionCrm.addEventListener("dragend", (e) => {
    e.target.closest?.(".crm-p")?.classList.remove("arrastrando");
    seccionCrm.querySelectorAll(".crm-col.encima").forEach((x) => x.classList.remove("encima"));
    arrastrandoCrm = null;
  });
  seccionCrm.addEventListener("dragover", (e) => {
    const col = e.target.closest?.(".crm-col");
    if (!col || !arrastrandoCrm) return;
    e.preventDefault();
    seccionCrm.querySelectorAll(".crm-col.encima").forEach((x) => x !== col && x.classList.remove("encima"));
    col.classList.add("encima");
  });
  seccionCrm.addEventListener("drop", (e) => {
    const col = e.target.closest?.(".crm-col");
    if (!col || !arrastrandoCrm) return;
    e.preventDefault();
    const id = arrastrandoCrm;
    const p = prospectoPorId(id);
    col.classList.remove("encima");
    if (!p || p.etapa === col.dataset.crmEtapa) return;
    // Al soltar en "Perdido" o "Venta" conviene anotar el motivo o el monto: se abre la ficha
    moverProspecto(id, { etapa: col.dataset.crmEtapa }).then(() => {
      if (col.dataset.crmEtapa === "venta" && !p.valor) abrirProspecto(id);
      if (col.dataset.crmEtapa === "perdido") abrirProspecto(id);
    });
  });

  // =====================================================================
  //  EQUIPO (solo el dueño)
  // =====================================================================
  let ultimaEq = null;
  let filtroEq = "";
  let todosEq = true;
  async function cargarEquipo() {
    const t = await api("/equipo");
    ultimaEq = t;
    pintarEquipo(t);
  }
  function pintarEquipo(t) {
    const nomSec = (k) => t.secciones[k]?.nombre || k;
    $("#eq-personas").innerHTML = t.personas.length
      ? t.personas.map((u) => `<article class="panel eq-persona ${u.activo ? "" : "pausada"}" data-eq-persona="${u.id}" tabindex="0" role="button" aria-label="Editar a ${esc(u.nombre)}">
          <div class="eq-p-cabeza"><span class="eq-avatar" aria-hidden="true">${esc(u.nombre.trim()[0] || "?").toUpperCase()}</span>
            <span class="eq-p-nombre"><b>${esc(u.nombre)}</b><small class="tenue">@${esc(u.usuario)}</small></span>
            <span class="tb-chip s-${u.activo ? "verde" : "amarillo"}">${u.activo ? "Con acceso" : "Pausada"}</span></div>
          <div class="eq-chips">${u.secciones.length ? u.secciones.map((s) => `<span class="eq-chip">${esc(nomSec(s))}</span>`).join("") : `<span class="tenue chico">Solo sus tareas</span>`}</div>
          <p class="chico"><span class="tenue">Clientes:</span> ${u.clientes_nombres ? esc(u.clientes_nombres.join(", ") || "ninguno") : "todos"}</p>
          <p class="chico tenue">${u.ultimo_acceso ? `Entró ${haceRato(u.ultimo_acceso)}` : "Todavía no entra"} · ${u.tareas_pendientes} tarea${u.tareas_pendientes === 1 ? "" : "s"} pendiente${u.tareas_pendientes === 1 ? "" : "s"}</p>
        </article>`).join("")
      : `<div class="panel eq-vacio"><h2>Dale acceso a tu equipo</h2><p class="tenue">Crea un usuario para tu trabajadora: entra a DELTA con su propia clave y solo ve las secciones y los clientes que tú elijas. Nunca ve lo tuyo.</p><button type="button" class="ag-agregar" data-eq-nueva>+ Dar acceso</button></div>`;

    const activos = t.personas.filter((u) => u.activo);
    $("#eq-para").innerHTML = activos.map((u) => `<option value="${u.id}">${esc(u.nombre)}</option>`).join("") || `<option value="">Primero da acceso a alguien</option>`;
    $("#eq-form-tarea").querySelectorAll("input,select,button").forEach((x) => { x.disabled = !activos.length; });
    $("#eq-tareas-n").textContent = t.tareas.length ? `${t.tareas.length} pendiente${t.tareas.length === 1 ? "" : "s"}` : "";
    const ahora = new Date().toISOString();
    const fila = (x, hecha) => `<li class="${!hecha && x.fecha_limite && x.fecha_limite < ahora ? "vencida" : ""} ${hecha ? "hecha" : ""}">
        ${hecha ? `<span class="eq-ok" aria-hidden="true">✓</span>` : `<input type="checkbox" data-eq-hecha="${x.id}" aria-label="Marcar como hecha" />`}
        <div class="cuerpo">${esc(x.titulo)}<span class="sub">${[x.asignada_nombre, x.cliente, hecha ? `terminada ${haceRato(x.completada)}` : x.fecha_limite ? `para ${fmtDia(x.fecha_limite)}` : null].filter(Boolean).map(esc).join(" · ")}</span></div>
        ${hecha ? "" : `<button type="button" class="eq-quitar" data-eq-quitar="${x.id}" aria-label="Quitar tarea">×</button>`}
      </li>`;
    $("#eq-tareas").innerHTML = (t.tareas.length ? t.tareas.map((x) => fila(x, false)).join("") : `<li class="vacio">Sin tareas pendientes del equipo.</li>`)
      + (t.hechas.length ? `<li class="eq-sep tenue">Terminadas</li>${t.hechas.slice(0, 5).map((x) => fila(x, true)).join("")}` : "");

    $("#eq-filtro").innerHTML = `<option value="">Todos</option><option value="equipo">Solo el equipo</option>` + t.personas.map((u) => `<option value="${u.id}">${esc(u.nombre)}</option>`).join("");
    $("#eq-filtro").value = filtroEq;
    pintarHistorialEq(filtroEq ? null : t.historial);
  }
  async function pintarHistorialEq(lista) {
    if (!lista) lista = await api(`/equipo/historial?usuario=${encodeURIComponent(filtroEq)}`).catch(() => []);
    $("#eq-historial").innerHTML = lista.length
      ? lista.map((x) => `<li><span class="eq-h-quien ${x.usuario_id ? "" : "tu"}">${esc(x.quien)}</span><span class="eq-h-txt">${esc(x.accion)}${x.cliente ? ` <small class="tenue">· ${esc(x.cliente)}</small>` : ""}</span><small class="tenue eq-h-cuando">${esc(fmtDia(x.fecha))} ${esc(fmtHora(x.fecha))}</small></li>`).join("")
      : `<li class="vacio tenue">Aquí vas a ver quién cambió qué: prospectos, piezas, tareas.</li>`;
  }
  $("#eq-filtro").addEventListener("change", (e) => { filtroEq = e.target.value; pintarHistorialEq(null); });

  // Diálogo de una persona
  const claveAzar = () => {
    const l = "abcdefghjkmnpqrstuvwxyz23456789";
    const a = crypto.getRandomValues(new Uint32Array(12));
    return Array.from(a, (n) => l[n % l.length]).join("").replace(/(.{4})(?=.)/g, "$1-");
  };
  function pintarTodosEq() {
    $("#form-persona").querySelectorAll("[data-eq-todos]").forEach((b) => b.classList.toggle("activa", (b.dataset.eqTodos === "1") === todosEq));
    $("#eq-clientes").hidden = todosEq;
    $("#eq-secciones").querySelectorAll("input[data-todos]").forEach((x) => {
      x.disabled = !todosEq;
      if (!todosEq) x.checked = false;
      x.closest("label").classList.toggle("apagada", !todosEq);
    });
  }
  function abrirPersona(u = null) {
    const t = ultimaEq;
    if (!t) return;
    $("#eq-dlg-titulo").textContent = u ? u.nombre : "Dar acceso";
    $("#eq-id").value = u?.id || "";
    $("#eq-nombre").value = u?.nombre || "";
    $("#eq-usuario").value = u?.usuario || "";
    $("#eq-clave").value = u ? "" : claveAzar();
    $("#eq-clave").required = !u;
    $("#eq-clave-txt").textContent = u ? "Nueva clave (déjala vacía para no cambiarla)" : "Clave";
    const marcadas = u ? u.secciones : ["crm", "contenido"];
    $("#eq-secciones").innerHTML = Object.entries(t.secciones).map(([k, v]) => `<label class="eq-op"><input type="checkbox" value="${k}" ${marcadas.includes(k) ? "checked" : ""} ${v.todos ? "data-todos" : ""} /> ${esc(v.nombre)}${v.todos ? ` <small class="tenue">(todos los clientes)</small>` : ""}</label>`).join("");
    $("#eq-clientes").innerHTML = t.clientes.map((c) => `<label class="eq-op"><input type="checkbox" value="${c.id}" ${u?.clientes?.includes(c.id) ? "checked" : ""} /> ${esc(c.nombre)}</label>`).join("") || `<p class="tenue chico">Todavía no tienes clientes.</p>`;
    todosEq = !u || u.clientes === null;
    pintarTodosEq();
    $("#eq-listo").hidden = true;
    $("#eq-msg").hidden = true;
    $("#eq-guardar").hidden = false;
    $("#eq-borrar").hidden = !u;
    $("#eq-borrar").textContent = "Quitar acceso";
    $("#eq-borrar").classList.remove("seguro");
    $("#eq-pausar").hidden = !u;
    $("#eq-pausar").textContent = u?.activo === false ? "Reactivar" : "Pausar";
    $("#dlg-persona").showModal();
    if (!u) setTimeout(() => $("#eq-nombre").focus(), 50);
  }
  const errorEq = (err) => { $("#eq-msg").textContent = err.message; $("#eq-msg").hidden = false; };
  $("#eq-nombre").addEventListener("input", () => {
    if ($("#eq-id").value || $("#eq-usuario").dataset.tocado) return;
    $("#eq-usuario").value = $("#eq-nombre").value.trim().split(/\s+/)[0].normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9._-]/g, "");
  });
  $("#eq-usuario").addEventListener("input", (e) => { e.target.dataset.tocado = "1"; });
  $("#eq-generar").addEventListener("click", () => { $("#eq-clave").value = claveAzar(); });
  $("#form-persona").addEventListener("click", (e) => {
    const b = e.target.closest("[data-eq-todos]");
    if (b) { todosEq = b.dataset.eqTodos === "1"; pintarTodosEq(); }
    const c = e.target.closest("[data-eq-copiar]");
    if (c) navigator.clipboard.writeText($("#eq-listo pre").textContent).then(() => { c.textContent = "¡Copiado!"; }).catch(() => { c.textContent = "Selecciónalo y cópialo"; });
  });
  $("#form-persona").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $("#eq-id").value;
    const datos = {
      nombre: $("#eq-nombre").value.trim(), usuario: $("#eq-usuario").value.trim(),
      secciones: [...$("#eq-secciones").querySelectorAll("input:checked")].map((x) => x.value),
      clientes: todosEq ? null : [...$("#eq-clientes").querySelectorAll("input:checked")].map((x) => Number(x.value)),
    };
    const clave = $("#eq-clave").value.trim();
    if (clave) datos.clave = clave;
    if (!todosEq && !datos.clientes.length) return errorEq(new Error("Marca al menos un cliente, o elige Todos"));
    try {
      const u = await api(id ? `/equipo/personas/${id}` : "/equipo/personas", { method: id ? "PATCH" : "POST", body: datos });
      sonar("accion");
      await cargarEquipo();
      if (!id || clave) {
        // Los datos para pasárselos: la clave no se vuelve a mostrar
        $("#eq-listo").innerHTML = `<b>Listo. Pásale estos datos a ${esc(u.nombre)}:</b>
          <pre>DELTA: ${esc(location.origin)}\nUsuario: ${esc(u.usuario)}\nClave: ${esc(clave)}</pre>
          <p class="tenue chico">Que toque "¿Eres del equipo?" al entrar. Esta clave ya no se vuelve a mostrar; si la pierde, le pones una nueva.</p>
          <button type="button" data-eq-copiar>Copiar</button>`;
        $("#eq-listo").hidden = false;
        $("#eq-guardar").hidden = true;
        $("#eq-id").value = u.id;
      } else $("#dlg-persona").close();
    } catch (err) { errorEq(err); }
  });
  $("#eq-cancelar").addEventListener("click", () => $("#dlg-persona").close());
  $("#eq-pausar").addEventListener("click", async () => {
    const u = ultimaEq?.personas.find((x) => String(x.id) === $("#eq-id").value);
    if (!u) return;
    try { await api(`/equipo/personas/${u.id}`, { method: "PATCH", body: { activo: !u.activo } }); sonar("accion"); $("#dlg-persona").close(); await cargarEquipo(); }
    catch (err) { errorEq(err); }
  });
  $("#eq-borrar").addEventListener("click", async (e) => {
    const b = e.currentTarget;
    if (!b.classList.contains("seguro")) { b.classList.add("seguro"); b.textContent = "¿Seguro? Toca otra vez"; return; }
    try { await api(`/equipo/personas/${$("#eq-id").value}`, { method: "DELETE" }); sonar("accion"); $("#dlg-persona").close(); await cargarEquipo(); }
    catch (err) { errorEq(err); }
  });
  $("#eq-nueva").addEventListener("click", () => abrirPersona());
  const seccionEq = $('[data-seccion="equipo"]');
  seccionEq.addEventListener("click", async (e) => {
    if (e.target.closest("[data-eq-nueva]")) return abrirPersona();
    const hecha = e.target.closest("[data-eq-hecha]");
    if (hecha) { await api(`/tareas/${hecha.dataset.eqHecha}`, { method: "PATCH", body: { estado: "hecha" } }).catch((err) => avisar(err.message)); sonar("accion"); return cargarEquipo(); }
    const quitar = e.target.closest("[data-eq-quitar]");
    if (quitar) { await api(`/tareas/${quitar.dataset.eqQuitar}`, { method: "DELETE" }).catch((err) => avisar(err.message)); return cargarEquipo(); }
    const p = e.target.closest("[data-eq-persona]");
    if (p) abrirPersona(ultimaEq.personas.find((x) => x.id === Number(p.dataset.eqPersona)));
  });
  seccionEq.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches?.("[data-eq-persona]")) e.target.click(); });
  $("#eq-form-tarea").addEventListener("submit", async (e) => {
    e.preventDefault();
    const titulo = $("#eq-tarea").value.trim();
    if (!titulo || !$("#eq-para").value) return;
    try {
      await api("/tareas", { method: "POST", body: { titulo, asignada_a: Number($("#eq-para").value), fecha_limite: $("#eq-fecha").value ? `${$("#eq-fecha").value}T18:00` : undefined } });
      sonar("accion");
      $("#eq-tarea").value = ""; $("#eq-fecha").value = "";
      await cargarEquipo();
    } catch (err) { avisar(err.message); }
  });

  return { cargarPanelGeneral, cargarCuentas, cargarFinanzas: () => prepararFinanzas().then(cargarFinanzas), cargarPaidMedia: () => prepararFinanzas().then(cargarPaidMedia), cargarContenido: () => prepararFinanzas().then(cargarContenido), cargarTendencias: () => prepararFinanzas().then(cargarTendencias), cargarSeo, cargarAnalitica, cargarCrm: () => prepararFinanzas().then(cargarCrm), cargarEquipo, abrirCuenta, abrirMeta, refrescarFicha: () => (ficha ? cargarFicha(ficha.id) : Promise.resolve()) };
}
