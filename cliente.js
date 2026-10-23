// Vista del comitente: simple y de solo lectura. Inicio, Portafolio y Calendario de pagos, con
// selector de moneda (ARS / USD MEP / USD CCL). La usa el cliente al entrar y el productor
// con "Ver como cliente". Los montos salen de la misma posición que informa Gallo.

const clienteVista = { id: null, tab: "inicio", staff: false, cal: null, moneda: "ARS" };
try { clienteVista.moneda = sessionStorage.getItem("monedaCli") || "ARS"; } catch (e) { /* sin storage */ }
// Estado de las pantallas nuevas: filtros del calendario, modo del cashflow y filtros de Actividad.
Object.assign(clienteVista, { calTipo: "Todos", cashModo: "grafico", cashTicker: "", dia: null, act: { q: "", tipo: "Todos", n: 25 } });

let ACT = null;                    // movimientos del comitente: [{ f, a, m, t, c, q, p, n }]
let ACT_ESTADO = "pendiente";      // pendiente | cargando | listo

let PAGOS = null;            // { bonistas: { SIMBOLO: [[fecha, cupon, amort, moneda]] }, ons: { BASE: { moneda, flujos } } }
let PAGOS_ESTADO = "pendiente"; // pendiente | cargando | listo | error

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const PALETA = ["#0ea5e9", "#6366f1", "#14b8a6", "#f59e0b", "#ec4899", "#84cc16", "#f97316", "#8b5cf6", "#64748b"];

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// ---------- Monedas ----------

// Todo se calcula en pesos y se convierte al final. MEP = tipo de cambio de Gallo para esta cuenta;
// CCL = ese mismo tipo de cambio ajustado por la brecha CCL/MEP del día (dolarapi).
function tasasCliente(cli) {
  const tc = cli.tc || 0;
  const bolsa = MERCADO.dolares.find(d => d.casa === "bolsa");
  const ccl = MERCADO.dolares.find(d => d.casa === "contadoconliqui");
  const cclRate = tc && bolsa && ccl && bolsa.venta ? tc * ccl.venta / bolsa.venta : tc;
  return { ARS: 1, MEP: tc, CCL: cclRate };
}

function monedaEfectiva(cli) {
  const t = tasasCliente(cli);
  return t[clienteVista.moneda] ? clienteVista.moneda : "ARS";
}

function convertir(cli, ars) {
  const m = monedaEfectiva(cli);
  return ars / tasasCliente(cli)[m];
}

function fmtMon(cli, ars, opts = {}) {
  const m = monedaEfectiva(cli);
  const v = convertir(cli, ars);
  const dec = opts.dec !== undefined ? opts.dec : (m === "ARS" ? (Math.abs(v) < 100 ? 2 : 0) : 2);
  return (v < 0 ? "-" : "") + (m === "ARS" ? "$ " : "USD ") + fmtMoney(Math.abs(v), dec);
}

// ---------- Posiciones y pagos ----------

function posicionesCliente(cli) {
  const lista = [];
  [["ARS", cli.detallePesos], ["USD", cli.detalleDolares]].forEach(([mon, arr]) => (arr || []).forEach(p => {
    const c = calcPosicion(p);
    const fx = mon === "USD" ? (cli.tc || 0) : 1;
    lista.push({ ...p, mon, importe: c.importe, varPct: c.varPct, ars: c.importe * fx });
  }));
  return lista.filter(p => Math.abs(p.ars) > 0.5).sort((a, b) => b.ars - a.ars);
}

async function cargarPagosCliente() {
  if (PAGOS_ESTADO !== "pendiente") return;
  PAGOS_ESTADO = "cargando";
  let data = null;
  try {
    if (sesion && sesion.token) {
      const r = await fetch("/api/pagos", { headers: { Authorization: "Bearer " + sesion.token } });
      const j = await r.json();
      if (j.ok && (j.bonistas || j.ons)) data = j;
    }
  } catch (e) { /* sin backend: se usa la copia estática */ }
  if (!data) {
    try { const r = await fetch("pagos.json"); if (r.ok) data = await r.json(); } catch (e) { /* sin copia */ }
  }
  PAGOS = data;
  PAGOS_ESTADO = data ? "listo" : "error";
  if (clienteVista.id) renderCliente();
}

// Cronograma por 100 VN de una especie. Gallo usa sufijo D/C/O según la plaza (MEP/CCL/pesos), el
// cronograma es el mismo, así que se prueba el ticker exacto y después la base con cada sufijo.
function flujosDe(t) {
  if (!PAGOS) return null;
  const T = String(t).toUpperCase();
  const base = "DCO".includes(T.slice(-1)) && !/\d/.test(T.slice(-1)) ? T.slice(0, -1) : T;
  const b = PAGOS.bonistas || {}, o = PAGOS.ons || {};
  const deBonistas = arr => arr.map(f => ({ fecha: f[0], cupon: f[1], amort: f[2], mon: f[3] }));
  const deOns = x => x.flujos.map(f => ({ fecha: f[0], cupon: f[1], amort: f[2], mon: x.moneda }));
  if (b[T]) return deBonistas(b[T]);
  // Bopreal: Gallo los llama BPOD7, bonistas BPD7D.
  const bop = T.replace(/^BPO([A-D]\d)$/, "BP$1D");
  if (bop !== T && b[bop]) return deBonistas(b[bop]);
  if (o[base]) return deOns(o[base]);
  for (const s of ["D", "C", "O"]) if (b[base + s]) return deBonistas(b[base + s]);
  if (o[T]) return deOns(o[T]);
  return null;
}

// Pagos futuros de la cartera: cantidad (VN) x flujo por 100 VN.
function pagosCliente(cli) {
  const hoy = todayStr();
  const tc = cli.tc || 0;
  const salida = [];
  posicionesCliente(cli).forEach(p => {
    if (p.c <= 0) return;
    const fl = flujosDe(p.t);
    if (!fl) return;
    fl.filter(f => f.fecha >= hoy && (f.cupon > 0 || f.amort > 0)).forEach(f => {
      const fx = f.mon === "USD" ? tc : 1;
      const cupon = p.c * f.cupon / 100 * fx, amort = p.c * f.amort / 100 * fx;
      salida.push({ t: p.t, n: p.n, fecha: f.fecha, cupon, amort, ars: cupon + amort, vn: p.c, mon: f.mon, cuponOrig: p.c * f.cupon / 100, amortOrig: p.c * f.amort / 100, clase: claseActivo(p) });
    });
  });
  return salida.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.t.localeCompare(b.t));
}

function fmtFecha(f) {
  const [y, m, d] = f.split("-");
  return `${d}/${m}/${y}`;
}

function tipoPago(p) {
  if (p.cupon > 0 && p.amort > 0) return "Cupón y amortización";
  return p.amort > 0 ? "Amortización" : "Cupón";
}

// Clase de activo para mostrar (Docta: "Asset class"). Gallo en vivo trae el nombre; si no, se deduce.
function claseActivo(p) {
  const n = String(p.n || "").toUpperCase();
  if (/CEDEAR/.test(n)) return "Cedear";
  if (p.factorUnidad === 0.01 || (typeof BONOS !== "undefined" && BONOS.includes(p.t))) return "Bono";
  return "Acción";
}

// Cada pago se abre en eventos: un cupón y/o una amortización (así se filtra y se pinta por tipo).
function eventosPago(pagos, filtro) {
  const ev = [];
  pagos.forEach(p => {
    if (p.cupon > 0) ev.push({ ...p, tipo: "Cupón", ars: p.cupon, orig: p.cuponOrig });
    if (p.amort > 0) ev.push({ ...p, tipo: "Amortización", ars: p.amort, orig: p.amortOrig });
  });
  return (filtro && filtro !== "Todos" ? ev.filter(e => e.tipo === filtro) : ev)
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.t.localeCompare(b.t) || a.tipo.localeCompare(b.tipo));
}

// Importe corto para celdas chicas: 438,7 k / 5,1 M, en la moneda elegida.
function fmtCorto(cli, ars) {
  const m = monedaEfectiva(cli), v = Math.abs(convertir(cli, ars));
  const pref = m === "ARS" ? "$ " : "USD ";
  if (v >= 1e9) return pref + (v / 1e9).toLocaleString("es-AR", { maximumFractionDigits: 2 }) + " B";
  if (v >= 1e6) return pref + (v / 1e6).toLocaleString("es-AR", { maximumFractionDigits: 2 }) + " M";
  if (v >= 1e3) return pref + (v / 1e3).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + " k";
  return pref + v.toLocaleString("es-AR", { maximumFractionDigits: 0 });
}

const DIAS_LARGOS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
function fechaLarga(f) {
  const d = new Date(f + "T00:00:00");
  const s = `${DIAS_LARGOS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()].toLowerCase()} de ${d.getFullYear()}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function cargarActividadCliente() {
  if (ACT_ESTADO !== "pendiente") return;
  ACT_ESTADO = "cargando";
  let lista = null;
  try {
    if (sesion && sesion.token) {
      const r = await fetch("/api/actividad/" + encodeURIComponent(clienteVista.id), { headers: { Authorization: "Bearer " + sesion.token } });
      const j = await r.json();
      if (j.ok) lista = j.movimientos;
    }
  } catch (e) { /* sin backend: no hay actividad que mostrar */ }
  if (!lista && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    // Prueba local sin backend: lee la copia local actividad.json (está en .gitignore, no se publica).
    try { const r = await fetch("actividad.json"); if (r.ok) lista = (await r.json())[clienteVista.id] || null; } catch (e) { /* sin copia */ }
  }
  ACT = lista || [];
  ACT_ESTADO = "listo";
  if (clienteVista.id) renderCliente();
}

// ---------- Navegación ----------

function abrirVistaCliente(id, staff) {
  clienteVista.id = id;
  clienteVista.staff = !!staff;
  clienteVista.tab = "inicio";
  clienteVista.cal = null;
  Object.assign(clienteVista, { calTipo: "Todos", cashModo: "grafico", cashTicker: "", dia: null, act: { q: "", tipo: "Todos", n: 25 } });
  ACT = null; ACT_ESTADO = "pendiente";
  document.getElementById("app").style.display = "none";
  document.getElementById("clienteApp").style.display = "block";
  document.body.style.background = "#f4f6fa";
  window.scrollTo(0, 0);
  cargarPagosCliente();
  cargarActividadCliente();
  actualizarCuentaEnVivo(id);
  renderCliente();
}

function cerrarVistaCliente() {
  clienteVista.id = null;
  document.getElementById("clienteApp").style.display = "none";
  document.body.style.background = "";
  document.getElementById("app").style.display = "flex";
}

function cvTab(t) { clienteVista.tab = t; renderCliente(); window.scrollTo(0, 0); }
function cvMoneda(m) {
  clienteVista.moneda = m;
  try { sessionStorage.setItem("monedaCli", m); } catch (e) { /* sin storage */ }
  renderCliente();
}
function cvMes(delta) {
  const c = clienteVista.cal;
  const d = new Date(c.y, c.m + delta, 1);
  clienteVista.cal = { y: d.getFullYear(), m: d.getMonth() };
  renderCliente();
}
function cvIrMes(y, m) { clienteVista.cal = { y, m }; clienteVista.tab = "calendario"; renderCliente(); window.scrollTo(0, 0); }

// ---------- Render ----------

function renderCliente() {
  if (!clienteVista.id) return;
  const el = document.getElementById("clienteApp");
  const cli = getClientes().find(c => c.id === clienteVista.id);
  if (!cli) { el.innerHTML = `<p style="padding:30px">No se encontró la cuenta.</p>`; return; }
  const tasas = tasasCliente(cli);
  const mon = monedaEfectiva(cli);
  const tabs = [["inicio", "Inicio"], ["portafolio", "Portafolio"], ["actividad", "Actividad"], ["calendario", "Calendario"]];
  const monedas = [["ARS", "ARS"], ["MEP", "USD MEP"], ["CCL", "USD CCL"]];

  let cuerpo = "";
  if (clienteVista.tab === "portafolio") cuerpo = cvPortafolio(cli);
  else if (clienteVista.tab === "actividad") cuerpo = cvActividad(cli);
  else if (clienteVista.tab === "calendario") cuerpo = cvCalendario(cli);
  else cuerpo = cvInicio(cli);

  el.innerHTML = `
    ${!clienteVista.staff && sesion && sesion.rolReal === "alyc" ? `<div class="cv-staff">Estás viendo la plataforma como cliente: ${esc(sesion.perfilNombre || "")} · <button onclick="cambiarPerfil()">Cambiar perfil</button></div>` : ""}
    ${clienteVista.staff ? `<div class="cv-staff">Estás viendo la cuenta como la ve el cliente · <button onclick="cerrarVistaCliente()">← Volver al panel</button></div>` : ""}
    <header class="cv-head">
      <div class="cv-brand">equanima<i>.</i></div>
      <nav class="cv-tabs">${tabs.map(([k, n]) => `<button class="${clienteVista.tab === k ? "on" : ""}" onclick="cvTab('${k}')">${n}</button>`).join("")}</nav>
      <div class="cv-right">
        <div class="cv-mon">${monedas.map(([k, n]) => `<button class="${mon === k ? "on" : ""}" ${tasas[k] ? "" : "disabled"} onclick="cvMoneda('${k}')">${n}</button>`).join("")}</div>
        <span class="cv-vivo vivo-estado">${esc(VIVO.texto)}</span><button class="cv-act" onclick="actualizarCuentaEnVivo(clienteVista.id, true)" title="Actualizar ahora" aria-label="Actualizar ahora">↻</button>
        ${clienteVista.staff ? "" : `<button class="cv-salir" onclick="logout()">Salir</button>`}
      </div>
    </header>
    <main class="cv-main">${cuerpo}</main>
    <footer class="cv-foot">Equanima Securities · ALyC, CNV matrícula N° 191. ${cli.actualizado ? " Posición al " + new Date(cli.actualizado).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short", hour12: false }) + "." : ""} Información de solo lectura, tomada de tu cuenta; los valores son indicativos y pueden diferir de las liquidaciones.${PAGOS_ESTADO === "error" ? " No se pudo cargar el cronograma de pagos." : ""}</footer>`;
}

function cvTarjeta(titulo, cuerpo, accion) {
  return `<section class="cv-card"><div class="cv-card-h"><h3>${titulo}</h3>${accion || ""}</div>${cuerpo}</section>`;
}

// Resultado de la cartera: no realizado (tenencias abiertas contra su costo promedio) y realizado
// (operaciones cerradas cargadas desde el Activity). Todo en pesos; se convierte al mostrar.
function resultadosCliente(cli) {
  const tc = cli.tc || 0;
  let noReal = 0, costoAbierto = 0;
  posicionesCliente(cli).forEach(p => {
    const fx = p.mon === "USD" ? tc : 1;
    const factor = p.c * (p.factorUnidad !== undefined ? p.factorUnidad : (BONOS.includes(p.t) ? 0.01 : 1));
    noReal += (p.importe - factor * p.co) * fx;
    costoAbierto += factor * p.co * fx;
  });
  const gan = cli.ganancias || [];
  let real = 0, costoReal = 0;
  gan.forEach(g => {
    const fx = (g.moneda || "ARS") === "USD" ? tc : 1;
    const costo = (parseFloat(g.costo) || 0) * fx;
    real += ((parseFloat(g.ventaRescate) || 0) * fx) - costo;
    costoReal += costo;
  });
  const fechas = gan.map(g => g.fecha).filter(Boolean).sort();
  return { noReal, costoAbierto, noRealPct: costoAbierto ? noReal / costoAbierto * 100 : null,
    real, realPct: costoReal ? real / costoReal * 100 : null, nOps: gan.length, desde: fechas[0] || null, tieneHistorial: gan.length > 0 };
}

function cvSigno(v) { return v > 0 ? "+" : ""; }

function cvResultados(cli) {
  const r = resultadosCliente(cli);
  const clase = v => (v < 0 ? "cv-rojo" : "cv-verde");
  const montoPct = (ars, pct) => `<b class="${clase(ars)}">${cvSigno(ars)}${fmtMon(cli, ars)}</b>${pct !== null ? `<span class="cv-sub">${cvSigno(pct)}${fmtPct(pct)}</span>` : ""}`;
  const total = r.noReal + (r.tieneHistorial ? r.real : 0);
  return `
    <section class="cv-card cv-pl">
      <div class="cv-card-h"><h3>Resultado</h3></div>
      <div class="cv-pl-grid">
        <div><span class="cv-etq">No realizado</span><div class="cv-pl-v">${montoPct(r.noReal, r.noRealPct)}</div><span class="cv-sub">Tenencias actuales contra su costo</span></div>
        <div><span class="cv-etq">Realizado</span><div class="cv-pl-v">${r.tieneHistorial ? montoPct(r.real, r.realPct) : '<b class="cv-gris">—</b>'}</div>
          <span class="cv-sub">${r.tieneHistorial ? `${r.nOps} operaciones cerradas desde ${fmtFecha(r.desde)}` : "Historial de operaciones todavía no cargado"}</span></div>
        <div><span class="cv-etq">Total${r.tieneHistorial ? "" : " (solo no realizado)"}</span><div class="cv-pl-v"><b class="${clase(total)}">${cvSigno(total)}${fmtMon(cli, total)}</b></div><span class="cv-sub">Realizado + no realizado</span></div>
      </div>
    </section>`;
}

function cvInicio(cli) {
  const pos = posicionesCliente(cli);
  const tc = cli.tc || 0;
  const saldoARS = (cli.pesos.cuentaCorriente || 0) + (cli.dolares.cuentaCorrienteUSD || 0) * tc;
  const pagos = pagosCliente(cli);
  const proximos = pagos.slice(0, 4);
  const nombre = titulo(cli.nombre);
  const hora = new Date().getHours();
  const saludo = hora < 12 ? "Buenos días" : hora < 20 ? "Buenas tardes" : "Buenas noches";
  const totalPos = pos.reduce((a, p) => a + p.ars, 0);

  // Cambio de hoy: precio actual contra el cierre anterior, en pesos.
  let difDia = 0;
  pos.forEach(p => { difDia += calcPosicion(p).resultadoDia * (p.mon === "USD" ? tc : 1); });
  const baseAnt = totalPos - difDia, pctDia = baseAnt ? difDia / baseAnt * 100 : 0;
  const signo = difDia > 0 ? "+" : "";

  const mov = pos.map(p => ({ t: p.t, pct: calcPosicion(p).varDiaPct })).filter(x => isFinite(x.pct) && Math.abs(x.pct) > 0.004);
  const subas = mov.filter(x => x.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, 3);
  const bajas = mov.filter(x => x.pct < 0).sort((a, b) => a.pct - b.pct).slice(0, 3);
  const filaMov = x => `<div class="cv-mov"><span>${esc(x.t)}</span><b class="${x.pct > 0 ? "cv-verde" : "cv-rojo"}">${x.pct > 0 ? "+" : ""}${fmtPct(x.pct)}</b></div>`;

  const tenencias = pos.slice(0, 3).map(p => `
    <div class="cv-fila">
      <div><b>${esc(p.t)}</b><span class="cv-sub">${totalPos ? fmtPct(p.ars / totalPos * 100) : "-"} del portafolio</span></div>
      <div class="cv-der"><b>${fmtMon(cli, p.ars)}</b><span class="cv-sub">${fmtMoney(p.c, 0)} ${p.factorUnidad === 0.01 ? "nominales" : "unidades"}</span></div>
    </div>`).join("");

  const filasPagos = proximos.map(p => `
    <div class="cv-fila">
      <div><b>${esc(p.t)}</b><span class="cv-sub">${tipoPago(p)} · ${fmtFecha(p.fecha)}</span></div>
      <div class="cv-der"><b class="cv-verde">${fmtMon(cli, p.ars)}</b></div>
    </div>`).join("");

  const vacioPagos = PAGOS_ESTADO === "cargando" || PAGOS_ESTADO === "pendiente" ? "Cargando el calendario…"
    : "No hay pagos de cupones ni amortizaciones próximos en esta cartera.";

  const cuerpoMov = (subas.length || bajas.length) ? `
    <div class="cv-movs">
      <div><span class="cv-etq">▲ Subas</span>${subas.map(filaMov).join("") || `<p class="cv-vacio">—</p>`}</div>
      <div><span class="cv-etq">▼ Bajas</span>${bajas.map(filaMov).join("") || `<p class="cv-vacio">—</p>`}</div>
    </div>` : `<p class="cv-vacio">Todavía no hay variación de precios hoy.</p>`;

  return `
    <div class="cv-hola">${saludo}, ${esc(nombre)}</div>
    <section class="cv-resumen">
      <div>
        <span class="cv-etq">Valor del portafolio</span>
        <div class="cv-total">${fmtMon(cli, cli.totalPortfolio)}</div>
        ${baseAnt ? `<div class="cv-var ${difDia < 0 ? "cv-rojo" : "cv-verde"}">${signo}${fmtMon(cli, difDia)} (${signo}${fmtPct(pctDia)}) hoy</div>` : ""}
      </div>
      <div>
        <span class="cv-etq">Saldo en cuenta</span>
        <div class="cv-saldo ${saldoARS < 0 ? "cv-rojo" : ""}">${fmtMon(cli, saldoARS)}</div>
        <span class="cv-sub">${saldoARS < 0 ? "Saldo negativo (financiación)" : "Disponible"}</span>
      </div>
    </section>
    ${cvResultados(cli)}
    <div class="cv-grid cv-grid3">
      ${cvTarjeta("Principales tenencias", tenencias || `<p class="cv-vacio">Sin posiciones.</p>`, `<button class="cv-link" onclick="cvTab('portafolio')">Ver todo →</button>`)}
      ${cvTarjeta("Movimientos del día", cuerpoMov)}
      ${cvTarjeta("Próximos pagos", filasPagos || `<p class="cv-vacio">${vacioPagos}</p>`, `<button class="cv-link" onclick="cvTab('calendario')">Calendario →</button>`)}
    </div>`;
}

function cvPortafolio(cli) {
  const tc = cli.tc || 0;
  const pos = posicionesCliente(cli).map(p => {
    const c = calcPosicion(p), fx = p.mon === "USD" ? tc : 1;
    return { ...p, clase: claseActivo(p), valorARS: c.importe * fx, costoARS: (c.importe - c.resultados) * fx, pnlARS: c.resultados * fx };
  });
  const total = pos.reduce((a, p) => a + p.ars, 0);
  const costo = pos.reduce((a, p) => a + p.costoARS, 0), pnlNoReal = pos.reduce((a, p) => a + p.pnlARS, 0);
  const realizado = (cli.ganancias || []).reduce((a, g) => a + (g.ventaRescate - g.costo) * (g.moneda === "USD" ? tc : 1), 0);
  const pnlTotal = pnlNoReal + realizado, pnlPct = costo ? pnlNoReal / costo * 100 : 0;
  const sPesos = cli.pesos.cuentaCorriente || 0, sUsd = cli.dolares.cuentaCorrienteUSD || 0;
  const saldoTot = sPesos + sUsd * tc;

  const principales = pos.slice(0, 8), resto = pos.slice(8).reduce((a, p) => a + p.ars, 0);
  const trozos = principales.map((p, i) => ({ nombre: p.t, ars: p.ars, color: PALETA[i] }));
  if (resto > 0) trozos.push({ nombre: "Otros", ars: resto, color: PALETA[8] });
  let acum = 0;
  const gradiente = total > 0 ? trozos.map(t => { const ini = acum / total * 100; acum += t.ars; return `${t.color} ${ini}% ${acum / total * 100}%`; }).join(",") : "#e5e9f0 0 100%";

  const filas = pos.map(p => `
    <tr>
      <td><b>${esc(p.t)}</b><span class="cv-sub">${esc(titulo(p.n))}</span></td>
      <td><span class="cv-pill claro">Abierto</span></td>
      <td class="n">${p.mon === "USD" ? "USD " : "$ "}${fmtMoney(p.p, 2)}</td>
      <td>${esc(p.clase)}</td>
      <td class="n">${fmtMoney(p.c, 0)}</td>
      <td class="n">${fmtMon(cli, p.costoARS)}</td>
      <td class="n"><b>${fmtMon(cli, p.valorARS)}</b></td>
      <td class="n ${p.pnlARS < 0 ? "cv-rojo" : "cv-verde"}">${p.co ? (p.pnlARS > 0 ? "+" : "") + fmtMon(cli, p.pnlARS) : "—"}<span class="cv-sub">${p.co ? (p.varPct > 0 ? "+" : "") + fmtPct(p.varPct) : ""}</span></td>
    </tr>`).join("");
  const filaSaldo = (nombre, ars) => `<tr class="cv-saldo-fila"><td colspan="6"><b>${nombre}</b></td><td class="n ${ars < 0 ? "cv-rojo" : ""}"><b>${fmtMon(cli, ars)}</b></td><td></td></tr>`;

  return `
    <div class="cv-grid cv-grid3">
      <section class="cv-card cv-kpi">
        <span class="cv-etq">Valor del portafolio</span>
        <div class="cv-kpi-n">${fmtMon(cli, cli.totalPortfolio)}</div>
        <div class="cv-kpi-p"><div><span class="cv-sub">Costo base</span>${fmtMon(cli, costo)}</div><div><span class="cv-sub">Valor de mercado</span>${fmtMon(cli, total)}</div></div>
      </section>
      <section class="cv-card cv-kpi">
        <span class="cv-etq">Rendimiento (P&amp;L)</span>
        <div class="cv-kpi-n ${pnlTotal < 0 ? "cv-rojo" : "cv-verde"}">${pnlTotal > 0 ? "+" : ""}${fmtMon(cli, pnlTotal)} <small>${pnlPct > 0 ? "+" : ""}${fmtPct(pnlPct)}</small></div>
        <div class="cv-kpi-p"><div><span class="cv-sub">No realizado</span><span class="${pnlNoReal < 0 ? "cv-rojo" : "cv-verde"}">${pnlNoReal > 0 ? "+" : ""}${fmtMon(cli, pnlNoReal)}</span></div><div><span class="cv-sub">Realizado</span>${realizado ? `<span class="${realizado < 0 ? "cv-rojo" : "cv-verde"}">${realizado > 0 ? "+" : ""}${fmtMon(cli, realizado)}</span>` : "—"}</div></div>
      </section>
      <section class="cv-card cv-kpi">
        <span class="cv-etq">Saldo en cuenta</span>
        <div class="cv-kpi-n ${saldoTot < 0 ? "cv-rojo" : ""}">${fmtMon(cli, saldoTot)}</div>
        <div class="cv-kpi-p"><div><span class="cv-sub">Pesos</span><span class="${sPesos < 0 ? "cv-rojo" : ""}">${fmtMon(cli, sPesos)}</span></div><div><span class="cv-sub">Dólares</span><span class="${sUsd < 0 ? "cv-rojo" : ""}">${sUsd < 0 ? "-" : ""}USD ${fmtMoney(Math.abs(sUsd), 2)}</span></div></div>
      </section>
    </div>
    ${cvTarjeta("Posiciones", `
      <div class="cv-tabla"><table>
        <thead><tr><th>Ticker</th><th>Estado</th><th class="n">Precio actual</th><th>Clase</th><th class="n">Cantidad</th><th class="n">Costo base</th><th class="n">Valor de mercado</th><th class="n">P&amp;L no realizado</th></tr></thead>
        <tbody>${filas || `<tr><td colspan="8" class="cv-vacio">Sin posiciones.</td></tr>`}${filaSaldo("Saldo en pesos", sPesos)}${filaSaldo("Saldo en dólares", sUsd * tc)}</tbody>
      </table></div>
      <p class="cv-nota">P&amp;L no realizado = precio actual contra el costo promedio. El precio de cada activo está en su moneda de cotización; los importes se muestran en la moneda elegida arriba.</p>`)}
    ${cvTarjeta("Composición", `
      <div class="cv-donut-wrap">
        <div class="cv-donut" style="background:conic-gradient(${gradiente})"><div><span class="cv-sub">Total</span><b>${fmtMon(cli, total)}</b></div></div>
        <ul class="cv-leyenda">${trozos.map(t => `<li><i style="background:${t.color}"></i>${esc(t.nombre)}<span>${total ? fmtPct(t.ars / total * 100) : "-"}</span></li>`).join("")}</ul>
      </div>`)}`;
}

// ---------- Actividad ----------

function cvActFiltro(k, v) {
  clienteVista.act[k] = v; clienteVista.act.n = 25; renderCliente();
  if (k === "q") { const i = document.getElementById("cvActQ"); if (i) { i.focus(); i.setSelectionRange(v.length, v.length); } }
}
function cvActMas() { clienteVista.act.n += 25; renderCliente(); }

function cvActividad(cli) {
  if (ACT_ESTADO !== "listo") return cvTarjeta("Actividad", `<p class="cv-vacio">Cargando los movimientos…</p>`);
  if (!ACT.length) return cvTarjeta("Actividad", `<p class="cv-vacio">Todavía no hay movimientos cargados para esta cuenta.</p>`);
  const f = clienteVista.act;
  const tipos = ["Todos", ...[...new Set(ACT.map(x => x.t))].sort()];
  let lista = ACT.slice().sort((a, b) => b.f.localeCompare(a.f) || (b.k || 0) - (a.k || 0));
  if (f.tipo !== "Todos") lista = lista.filter(x => x.t === f.tipo);
  if (f.q) { const q = f.q.toUpperCase(); lista = lista.filter(x => (x.a + " " + (x.d || "")).toUpperCase().includes(q)); }
  const clasePill = t => /^(Compra|Depósito)$/.test(t) ? "oscuro" : /^(Venta|Extracción|Retención)$/.test(t) ? "rojo" : "claro";
  const dmy = s => { const [y, m, d] = s.split("-"); return `${d}/${m}/${y.slice(2)}`; };
  const filas = lista.slice(0, f.n).map(x => `
    <tr>
      <td class="nw">${dmy(x.f)}</td>
      <td><b>${esc(x.a)}</b>${x.d ? `<span class="cv-sub">${esc(x.d)}</span>` : ""}</td>
      <td><span class="cv-pill claro">${esc(x.m)}</span></td>
      <td><span class="cv-pill ${clasePill(x.t)}">${esc(x.t)}</span></td>
      <td>${esc(x.c || "—")}</td>
      <td class="n">${x.q ? fmtMoney(x.q, Number.isInteger(x.q) ? 0 : 2) : "—"}</td>
      <td class="n">${x.p ? (x.m === "USD" ? "USD " : "ARS ") + fmtMoney(x.p, 2) : "—"}</td>
      <td class="n ${x.n < 0 ? "cv-rojo" : ""}"><b>${x.n == null ? "—" : (x.n < 0 ? "-" : "") + (x.m === "USD" ? "USD " : "ARS ") + fmtMoney(Math.abs(x.n), 2)}</b></td>
    </tr>`).join("");
  return cvTarjeta("Actividad", `
    <div class="cv-filtros">
      <input id="cvActQ" type="search" placeholder="Buscar activo…" value="${esc(f.q)}" oninput="cvActFiltro('q', this.value)">
      <select onchange="cvActFiltro('tipo', this.value)">${tipos.map(t => `<option ${t === f.tipo ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>
      <span class="cv-sub">${lista.length} movimientos</span>
    </div>
    <div class="cv-tabla"><table>
      <thead><tr><th>Fecha</th><th>Activo</th><th>Moneda</th><th>Tipo</th><th>Clase</th><th class="n">Cantidad</th><th class="n">Precio</th><th class="n">Monto neto</th></tr></thead>
      <tbody>${filas || `<tr><td colspan="8" class="cv-vacio">No hay movimientos con ese filtro.</td></tr>`}</tbody>
    </table></div>
    ${lista.length > f.n ? `<div class="cv-mas-wrap"><button class="cv-btn" onclick="cvActMas()">Mostrar más</button></div>` : ""}
    <p class="cv-nota">Movimientos de tu cuenta en pesos y en dólares: compras, ventas, dividendos, retenciones y movimientos de fondos. Los montos son netos de comisión y derechos.</p>`);
}

// ---------- Calendario ----------

function cvDia(f) { clienteVista.dia = f; renderCliente(); }
function cvCerrarDia(ev) { if (ev && ev.target !== ev.currentTarget) return; clienteVista.dia = null; renderCliente(); }
function cvCalTipo(v) { clienteVista.calTipo = v; renderCliente(); }
function cvCash(k, v) { clienteVista[k] = v; renderCliente(); }

function cvModalDia(cli, eventos) {
  const f = clienteVista.dia;
  const del = eventos.filter(e => e.fecha === f);
  if (!del.length) return "";
  const nCup = del.filter(e => e.tipo === "Cupón").length, nAm = del.filter(e => e.tipo === "Amortización").length;
  const total = del.reduce((a, e) => a + e.ars, 0);
  const porTicker = {};
  del.forEach(e => (porTicker[e.t] = porTicker[e.t] || []).push(e));
  const bloques = Object.entries(porTicker).map(([t, lista]) => `
    <div class="cv-mod-bloque">
      <div class="cv-mod-t"><b>${esc(t)}</b><span class="cv-sub">${esc(lista[0].clase)} · ${esc(titulo(lista[0].n))}</span></div>
      ${lista.map(e => `
        <div class="cv-mod-ev">
          <div class="cv-mod-h"><span><i class="cv-pt ${e.tipo === "Cupón" ? "cup" : "am"}"></i>${e.tipo}</span><b>${fmtMon(cli, e.ars)}</b></div>
          <div class="cv-mod-d"><span>Cantidad (VN)</span><span>${fmtMoney(e.vn, 0)}</span></div>
          ${e.mon === "USD" ? `<div class="cv-mod-d"><span>Monto original</span><span>USD ${fmtMoney(e.orig, 2)}</span></div>` : ""}
        </div>`).join("")}
    </div>`).join("");
  return `
    <div class="cv-modal-bg" onclick="cvCerrarDia(event)">
      <div class="cv-modal">
        <button class="cv-x" onclick="cvCerrarDia()" aria-label="Cerrar">×</button>
        <h3>${fechaLarga(f)}</h3>
        <div class="cv-mod-res">
          <span>${nCup ? `<span class="cv-tag cup">${nCup} Cupón</span>` : ""}${nAm ? `<span class="cv-tag am">${nAm} Amortización</span>` : ""}</span>
          <b>${fmtMon(cli, total)}</b>
        </div>
        ${bloques}
      </div>
    </div>`;
}

function cvCalendario(cli) {
  const hoy = new Date();
  const pagos = pagosCliente(cli);
  const hoyStr = todayStr();
  if (!clienteVista.cal) {
    // Abre en el mes actual, o en el del próximo pago si este mes no hay ninguno.
    const mesHoy = hoyStr.slice(0, 7);
    const ref = pagos.length && !pagos.some(p => p.fecha.startsWith(mesHoy)) ? pagos[0].fecha : mesHoy + "-01";
    clienteVista.cal = { y: +ref.slice(0, 4), m: +ref.slice(5, 7) - 1 };
  }
  const { y, m } = clienteVista.cal;

  if (PAGOS_ESTADO === "cargando" || PAGOS_ESTADO === "pendiente") return cvTarjeta("Calendario de eventos", `<p class="cv-vacio">Cargando el calendario…</p>`);
  if (PAGOS_ESTADO === "error") return cvTarjeta("Calendario de eventos", `<p class="cv-vacio">No se pudo cargar el cronograma de pagos. Probá de nuevo más tarde.</p>`);

  const todos = eventosPago(pagos, "Todos");
  const eventos = eventosPago(pagos, clienteVista.calTipo);
  const prefijo = `${y}-${String(m + 1).padStart(2, "0")}`;
  const delMes = eventos.filter(e => e.fecha.startsWith(prefijo));
  const porDia = {};
  delMes.forEach(e => (porDia[+e.fecha.slice(8)] = porDia[+e.fecha.slice(8)] || []).push(e));

  const offset = (new Date(y, m, 1).getDay() + 6) % 7; // semana desde el lunes
  const diasMes = new Date(y, m + 1, 0).getDate();
  let celdas = "";
  for (let i = 0; i < offset; i++) celdas += `<div class="cv-dia vacio"></div>`;
  for (let d = 1; d <= diasMes; d++) {
    const lista = porDia[d] || [];
    const fecha = `${prefijo}-${String(d).padStart(2, "0")}`;
    const nCup = lista.filter(e => e.tipo === "Cupón").length, nAm = lista.filter(e => e.tipo === "Amortización").length;
    const suma = lista.reduce((a, e) => a + e.ars, 0);
    const tags = (nCup ? `<span class="cv-tag cup">•${nCup}</span>` : "") + (nAm ? `<span class="cv-tag am">•${nAm}</span>` : "");
    celdas += `<div class="cv-dia ${fecha === hoyStr ? "hoy" : ""} ${lista.length ? "con" : ""}" ${lista.length ? `onclick="cvDia('${fecha}')" role="button" tabindex="0"` : ""}>
      <span class="cv-num">${d}</span>${tags ? `<div class="cv-tags">${tags}</div>` : ""}${lista.length ? `<span class="cv-dtot">${fmtCorto(cli, suma)}</span>` : ""}</div>`;
  }
  const totalMes = delMes.reduce((a, e) => a + e.ars, 0);

  // Cashflow de la cartera: todo lo que se cobra desde hoy, por mes.
  const tickers = [...new Set(todos.map(e => e.t))].sort();
  const cf = clienteVista.cashTicker ? todos.filter(e => e.t === clienteVista.cashTicker) : todos;
  let cuerpoCf = "";
  if (!cf.length) cuerpoCf = `<p class="cv-vacio">No hay pagos futuros${clienteVista.cashTicker ? " para ese activo" : " en esta cartera"}.</p>`;
  else if (clienteVista.cashModo === "tabla") {
    cuerpoCf = `<div class="cv-tabla"><table>
      <thead><tr><th>Fecha</th><th>Ticker</th><th>Tipo</th><th class="n">Cantidad (VN)</th><th class="n">Monto</th></tr></thead>
      <tbody>${cf.slice(0, 80).map(e => `<tr><td class="nw">${fmtFecha(e.fecha)}</td><td><b>${esc(e.t)}</b></td><td><i class="cv-pt ${e.tipo === "Cupón" ? "cup" : "am"}"></i>${e.tipo}</td><td class="n">${fmtMoney(e.vn, 0)}</td><td class="n"><b>${fmtMon(cli, e.ars)}</b></td></tr>`).join("")}</tbody>
    </table></div>${cf.length > 80 ? `<p class="cv-nota">Se muestran los primeros 80 pagos de ${cf.length}.</p>` : ""}`;
  } else {
    const porMes = {};
    cf.forEach(e => { const k = e.fecha.slice(0, 7); const x = porMes[k] || (porMes[k] = { cup: 0, am: 0 }); if (e.tipo === "Cupón") x.cup += e.ars; else x.am += e.ars; });
    const claves = Object.keys(porMes).sort();
    const meses = []; // línea de tiempo continua, con los meses sin pagos vacíos
    for (let [yy, mm] = claves[0].split("-").map(Number); `${yy}-${String(mm).padStart(2, "0")}` <= claves[claves.length - 1];) { meses.push(`${yy}-${String(mm).padStart(2, "0")}`); mm++; if (mm > 12) { mm = 1; yy++; } }
    const mx = Math.max(...meses.map(k => (porMes[k] ? porMes[k].cup + porMes[k].am : 0)), 1);
    cuerpoCf = `<div class="cv-cf"><div class="cv-cf-barras">${meses.map(k => {
      const x = porMes[k] || { cup: 0, am: 0 }, tot = x.cup + x.am, [yy, mm] = k.split("-");
      const tip = `${MESES[+mm - 1]} ${yy}: ${fmtMon(cli, tot)}${tot ? ` (amortización ${fmtMon(cli, x.am)}, interés ${fmtMon(cli, x.cup)})` : ""}`;
      return `<div class="cv-cf-b" title="${esc(tip)}"><div class="cv-cf-col"><i class="cup" style="height:${x.cup / mx * 100}%"></i><i class="am" style="height:${x.am / mx * 100}%"></i></div><span>${+mm === 1 || k === meses[0] ? `${MESES[+mm - 1].slice(0, 3)} ${yy.slice(2)}` : MESES[+mm - 1].slice(0, 1)}</span></div>`;
    }).join("")}</div></div>
    <div class="cv-leyenda-h"><span><i class="cv-pt cfam"></i>Amortización</span><span><i class="cv-pt cfint"></i>Interés</span><span class="cv-sub">Pasá el mouse por una barra para ver el detalle</span></div>`;
  }

  return `
    ${cvTarjeta(`${MESES[m]} ${y}`, `
      <div class="cv-cal-barra">
        <div class="cv-leyenda-h"><span><i class="cv-pt cup"></i>Cupón</span><span><i class="cv-pt am"></i>Amortización</span></div>
        <div class="cv-cal-der">
          ${delMes.length ? `<span class="cv-sub">Total del mes <b>${fmtMon(cli, totalMes)}</b></span>` : ""}
          <select onchange="cvCalTipo(this.value)">${["Todos", "Cupón", "Amortización"].map(t => `<option value="${t}" ${t === clienteVista.calTipo ? "selected" : ""}>${t === "Todos" ? "Todos los tipos" : t}</option>`).join("")}</select>
        </div>
      </div>
      <div class="cv-semana">${["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map(d => `<span>${d}</span>`).join("")}</div>
      <div class="cv-mes">${celdas}</div>
      <p class="cv-nota">Tocá un día con pagos para ver el detalle.</p>`,
      `<div class="cv-nav"><button onclick="cvMes(-1)" aria-label="Mes anterior">‹</button><button onclick="cvMes(1)" aria-label="Mes siguiente">›</button></div>`)}
    ${cvTarjeta("Cashflows", `
      <div class="cv-filtros">
        <div class="cv-seg"><button class="${clienteVista.cashModo === "tabla" ? "on" : ""}" onclick="cvCash('cashModo','tabla')">Tabla</button><button class="${clienteVista.cashModo !== "tabla" ? "on" : ""}" onclick="cvCash('cashModo','grafico')">Gráfico</button></div>
        <select onchange="cvCash('cashTicker', this.value)"><option value="">Todos los activos</option>${tickers.map(t => `<option ${t === clienteVista.cashTicker ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>
      </div>
      ${cuerpoCf}
      <p class="cv-nota">Cupones y amortizaciones de los bonos, letras y obligaciones negociables de tu cartera, calculados sobre los nominales que tenés hoy. Los pagos en dólares se convierten al tipo de cambio actual de tu cuenta. Los dividendos de acciones no están incluidos.</p>`)}
    ${clienteVista.dia ? cvModalDia(cli, todos) : ""}`;
}
