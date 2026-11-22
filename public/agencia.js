// Tableros de la agencia: "Panel general" (todo de un vistazo) y "Cuentas" (una ficha por cliente
// con su semáforo de salud). Mismo estilo que el tablero de Mercados y noticias; todo se dibuja aquí
// (SVG y HTML), sin librerías de afuera. Los datos salen de la base de DELTA y se editan aquí mismo.

const $ = (s) => document.querySelector(s);
const SALUD_TXT = { verde: "Verde", amarillo: "Amarillo", rojo: "Rojo" };
const SALUD_FRASE = { verde: "Todo en orden", amarillo: "Hay que echarle ojo", rojo: "Necesita atención hoy" };
const PLATAFORMA = { meta: "Meta", google: "Google", tiktok: "TikTok", otra: "Otra" };
const ESTADO_CL = { activo: "Activo", prospecto: "Prospecto", pausado: "Pausado", terminado: "Terminado" };
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
    const conOjo = cuentas.filter((c) => c.estado === "activo" && c.salud.nivel !== "verde").slice(0, 5);
    $("#pg-semaforo").innerHTML = conOjo.length
      ? conOjo.map((c) => `<li data-cuenta="${c.id}" tabindex="0">${foco(c.salud.nivel)}<span><b>${esc(c.nombre)}</b><small>${esc(c.salud.motivos[0])}</small></span></li>`).join("")
      : activos ? `<li class="pg-vacio">Todos tus clientes activos están en verde.</li>` : `<li class="pg-vacio">Da de alta tu primer cliente en Cuentas.</li>`;

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
            <span class="cu-t-cabeza">${foco(c.salud.nivel)}<b>${esc(c.nombre)}</b>${c.estado !== "activo" ? `<span class="chip ${c.estado}">${esc(ESTADO_CL[c.estado])}</span>` : ""}</span>
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
            <button type="button" class="ag-agregar" data-pedir="${esc(`¿Cómo va ${c.nombre}? Revisa su ficha (salud, entregas, juntas, anuncios y aprobaciones) y dime el siguiente paso con este cliente.`)}">Siguiente paso con DELTA</button>
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
    if (e.target.closest("[data-abrir-meta]")) return void abrirMeta().catch((err) => avisar(err.message));
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

  return { cargarPanelGeneral, cargarCuentas, cargarFinanzas: () => prepararFinanzas().then(cargarFinanzas), abrirCuenta, abrirMeta, refrescarFicha: () => (ficha ? cargarFicha(ficha.id) : Promise.resolve()) };
}
