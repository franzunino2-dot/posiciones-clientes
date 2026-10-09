// Vista del comitente: simple y de solo lectura. Inicio, Portafolio y Calendario de pagos, con
// selector de moneda (ARS / USD MEP / USD CCL). La usa el cliente al entrar y el productor
// con "Ver como cliente". Los montos salen de la misma posición que informa Gallo.

const clienteVista = { id: null, tab: "inicio", staff: false, cal: null, moneda: "ARS" };
try { clienteVista.moneda = sessionStorage.getItem("monedaCli") || "ARS"; } catch (e) { /* sin storage */ }

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
      salida.push({ t: p.t, n: p.n, fecha: f.fecha, cupon, amort, ars: cupon + amort });
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

// ---------- Navegación ----------

function abrirVistaCliente(id, staff) {
  clienteVista.id = id;
  clienteVista.staff = !!staff;
  clienteVista.tab = "inicio";
  clienteVista.cal = null;
  document.getElementById("app").style.display = "none";
  document.getElementById("clienteApp").style.display = "block";
  document.body.style.background = "#f4f6fa";
  window.scrollTo(0, 0);
  cargarPagosCliente();
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
  const tabs = [["inicio", "Inicio"], ["portafolio", "Portafolio"], ["calendario", "Calendario"]];
  const monedas = [["ARS", "ARS"], ["MEP", "USD MEP"], ["CCL", "USD CCL"]];

  let cuerpo = "";
  if (clienteVista.tab === "portafolio") cuerpo = cvPortafolio(cli);
  else if (clienteVista.tab === "calendario") cuerpo = cvCalendario(cli);
  else cuerpo = cvInicio(cli);

  el.innerHTML = `
    ${clienteVista.staff ? `<div class="cv-staff">Estás viendo la cuenta como la ve el cliente · <button onclick="cerrarVistaCliente()">← Volver al panel</button></div>` : ""}
    <header class="cv-head">
      <div class="cv-brand">equanima<i>.</i></div>
      <nav class="cv-tabs">${tabs.map(([k, n]) => `<button class="${clienteVista.tab === k ? "on" : ""}" onclick="cvTab('${k}')">${n}</button>`).join("")}</nav>
      <div class="cv-right">
        <div class="cv-mon">${monedas.map(([k, n]) => `<button class="${mon === k ? "on" : ""}" ${tasas[k] ? "" : "disabled"} onclick="cvMoneda('${k}')">${n}</button>`).join("")}</div>
        ${clienteVista.staff ? "" : `<button class="cv-salir" onclick="logout()">Salir</button>`}
      </div>
    </header>
    <main class="cv-main">${cuerpo}</main>
    <footer class="cv-foot">Equanima Securities · ALyC, CNV matrícula N° 191. Información de solo lectura, tomada de tu cuenta; los valores son indicativos y pueden diferir de las liquidaciones.${PAGOS_ESTADO === "error" ? " No se pudo cargar el cronograma de pagos." : ""}</footer>`;
}

function cvTarjeta(titulo, cuerpo, accion) {
  return `<section class="cv-card"><div class="cv-card-h"><h3>${titulo}</h3>${accion || ""}</div>${cuerpo}</section>`;
}

function cvInicio(cli) {
  const pos = posicionesCliente(cli);
  const saldoARS = (cli.pesos.cuentaCorriente || 0) + (cli.dolares.cuentaCorrienteUSD || 0) * (cli.tc || 0);
  const pagos = pagosCliente(cli);
  const proximos = pagos.slice(0, 4);
  const nombre = titulo(cli.nombre);

  const tenencias = pos.slice(0, 3).map(p => `
    <div class="cv-fila">
      <div><b>${esc(p.t)}</b><span class="cv-sub">${esc(titulo(p.n))}</span></div>
      <div class="cv-der"><b>${fmtMon(cli, p.ars)}</b><span class="cv-sub">${fmtMoney(p.c, 0)} ${p.factorUnidad === 0.01 ? "nominales" : "unidades"}</span></div>
    </div>`).join("");

  const filasPagos = proximos.map(p => `
    <div class="cv-fila">
      <div><b>${esc(p.t)}</b><span class="cv-sub">${tipoPago(p)} · ${fmtFecha(p.fecha)}</span></div>
      <div class="cv-der"><b class="cv-verde">${fmtMon(cli, p.ars)}</b></div>
    </div>`).join("");

  const vacioPagos = PAGOS_ESTADO === "cargando" || PAGOS_ESTADO === "pendiente" ? "Cargando el calendario…"
    : "No hay pagos de cupones ni amortizaciones próximos en esta cartera.";

  return `
    <div class="cv-hola">Hola, ${esc(nombre)}</div>
    <section class="cv-resumen">
      <div>
        <span class="cv-etq">Valor del portafolio</span>
        <div class="cv-total">${fmtMon(cli, cli.totalPortfolio)}</div>
      </div>
      <div>
        <span class="cv-etq">Saldo en cuenta</span>
        <div class="cv-saldo ${saldoARS < 0 ? "cv-rojo" : ""}">${fmtMon(cli, saldoARS)}</div>
        <span class="cv-sub">${saldoARS < 0 ? "Saldo negativo (financiación)" : "Disponible"}</span>
      </div>
    </section>
    <div class="cv-grid">
      ${cvTarjeta("Principales tenencias", tenencias || `<p class="cv-vacio">Sin posiciones.</p>`, `<button class="cv-link" onclick="cvTab('portafolio')">Ver todo →</button>`)}
      ${cvTarjeta("Próximos pagos", filasPagos || `<p class="cv-vacio">${vacioPagos}</p>`, `<button class="cv-link" onclick="cvTab('calendario')">Calendario →</button>`)}
    </div>`;
}

function cvPortafolio(cli) {
  const pos = posicionesCliente(cli);
  const total = pos.reduce((a, p) => a + p.ars, 0);
  const principales = pos.slice(0, 8), resto = pos.slice(8).reduce((a, p) => a + p.ars, 0);
  const trozos = principales.map((p, i) => ({ nombre: p.t, ars: p.ars, color: PALETA[i] }));
  if (resto > 0) trozos.push({ nombre: "Otros", ars: resto, color: PALETA[8] });
  let acum = 0;
  const gradiente = total > 0 ? trozos.map(t => { const ini = acum / total * 100; acum += t.ars; return `${t.color} ${ini}% ${acum / total * 100}%`; }).join(",") : "#e5e9f0 0 100%";

  const filas = pos.map(p => `
    <tr>
      <td><b>${esc(p.t)}</b><span class="cv-sub">${esc(titulo(p.n))}</span></td>
      <td class="n">${fmtMoney(p.c, 0)}</td>
      <td class="n">${p.mon === "USD" ? "USD " : "$ "}${fmtMoney(p.p, 2)}</td>
      <td class="n"><b>${fmtMon(cli, p.ars)}</b></td>
      <td class="n ${p.varPct < 0 ? "cv-rojo" : "cv-verde"}">${p.co ? (p.varPct > 0 ? "+" : "") + fmtPct(p.varPct) : "—"}</td>
      <td class="n">${total ? fmtPct(p.ars / total * 100) : "-"}</td>
    </tr>`).join("");

  const sPesos = cli.pesos.cuentaCorriente || 0, sUsd = cli.dolares.cuentaCorrienteUSD || 0;
  const filaSaldo = (nombre, ars) => `<tr class="cv-saldo-fila"><td><b>${nombre}</b></td><td></td><td></td><td class="n ${ars < 0 ? "cv-rojo" : ""}"><b>${fmtMon(cli, ars)}</b></td><td></td><td></td></tr>`;

  return `
    <div class="cv-grid cv-grid-port">
      ${cvTarjeta("Composición", `
        <div class="cv-donut-wrap">
          <div class="cv-donut" style="background:conic-gradient(${gradiente})"><div><span class="cv-sub">Total</span><b>${fmtMon(cli, total)}</b></div></div>
          <ul class="cv-leyenda">${trozos.map(t => `<li><i style="background:${t.color}"></i>${esc(t.nombre)}<span>${total ? fmtPct(t.ars / total * 100) : "-"}</span></li>`).join("")}</ul>
        </div>`)}
      ${cvTarjeta("Resumen", `
        <div class="cv-fila"><span>Valor del portafolio</span><b>${fmtMon(cli, cli.totalPortfolio)}</b></div>
        <div class="cv-fila"><span>Tenencias</span><b>${fmtMon(cli, total)}</b></div>
        <div class="cv-fila"><span>Saldo en pesos</span><b class="${sPesos < 0 ? "cv-rojo" : ""}">${fmtMon(cli, sPesos)}</b></div>
        <div class="cv-fila"><span>Saldo en dólares</span><b class="${sUsd < 0 ? "cv-rojo" : ""}">${sUsd < 0 ? "-" : ""}USD ${fmtMoney(Math.abs(sUsd), 2)}</b></div>
        <div class="cv-fila"><span>Posiciones</span><b>${pos.length}</b></div>`)}
    </div>
    ${cvTarjeta("Tenencias", `
      <div class="cv-tabla"><table>
        <thead><tr><th>Activo</th><th class="n">Cantidad</th><th class="n">Precio</th><th class="n">Valor</th><th class="n">Resultado</th><th class="n">% cartera</th></tr></thead>
        <tbody>${filas || `<tr><td colspan="6" class="cv-vacio">Sin posiciones.</td></tr>`}${filaSaldo("Saldo en pesos", sPesos)}${filaSaldo("Saldo en dólares", sUsd * (cli.tc || 0))}</tbody>
      </table></div>
      <p class="cv-nota">Resultado = variación del precio actual contra el costo promedio, en la moneda de cotización de cada activo. Precios según la última tenencia informada.</p>`)}`;
}

function cvCalendario(cli) {
  const hoy = new Date();
  const pagos = pagosCliente(cli);
  if (!clienteVista.cal) {
    // Abre en el mes actual, o en el del próximo pago si este mes no hay ninguno.
    const mesHoy = todayStr().slice(0, 7);
    const ref = pagos.length && !pagos.some(p => p.fecha.startsWith(mesHoy)) ? pagos[0].fecha : mesHoy + "-01";
    clienteVista.cal = { y: +ref.slice(0, 4), m: +ref.slice(5, 7) - 1 };
  }
  const { y, m } = clienteVista.cal;

  if (PAGOS_ESTADO === "cargando" || PAGOS_ESTADO === "pendiente") return cvTarjeta("Calendario de pagos", `<p class="cv-vacio">Cargando el calendario…</p>`);
  if (PAGOS_ESTADO === "error") return cvTarjeta("Calendario de pagos", `<p class="cv-vacio">No se pudo cargar el cronograma de pagos. Probá de nuevo más tarde.</p>`);

  const prefijo = `${y}-${String(m + 1).padStart(2, "0")}`;
  const delMes = pagos.filter(p => p.fecha.startsWith(prefijo));
  const porDia = {};
  delMes.forEach(p => (porDia[+p.fecha.slice(8)] = porDia[+p.fecha.slice(8)] || []).push(p));

  const primero = new Date(y, m, 1);
  const offset = (primero.getDay() + 6) % 7; // semana desde el lunes
  const diasMes = new Date(y, m + 1, 0).getDate();
  const hoyStr = todayStr();
  let celdas = "";
  for (let i = 0; i < offset; i++) celdas += `<div class="cv-dia vacio"></div>`;
  for (let d = 1; d <= diasMes; d++) {
    const lista = porDia[d] || [];
    const esHoy = `${prefijo}-${String(d).padStart(2, "0")}` === hoyStr;
    const chips = lista.slice(0, 2).map(p => `<span class="cv-chip ${p.amort > 0 ? "am" : ""}">${esc(p.t)}</span>`).join("") + (lista.length > 2 ? `<span class="cv-mas">+${lista.length - 2}</span>` : "");
    celdas += `<div class="cv-dia ${esHoy ? "hoy" : ""} ${lista.length ? "con" : ""}"><span class="cv-num">${d}</span>${chips}</div>`;
  }

  const totalCupon = delMes.reduce((a, p) => a + p.cupon, 0), totalAmort = delMes.reduce((a, p) => a + p.amort, 0);
  const detalle = delMes.map(p => `
    <div class="cv-fila">
      <div><b>${esc(p.t)}</b><span class="cv-sub">${fmtFecha(p.fecha)} · ${tipoPago(p)}</span></div>
      <div class="cv-der"><b class="cv-verde">${fmtMon(cli, p.ars)}</b></div>
    </div>`).join("");

  // Próximos 12 meses: total por mes (clic para ir al mes).
  const meses = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() + i, 1);
    const pre = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    meses.push({ y: d.getFullYear(), m: d.getMonth(), ars: pagos.filter(p => p.fecha.startsWith(pre)).reduce((a, p) => a + p.ars, 0) });
  }
  const maxMes = Math.max(...meses.map(x => x.ars), 1);
  const barras = meses.map(x => `
    <button class="cv-barra ${x.y === y && x.m === m ? "on" : ""}" onclick="cvIrMes(${x.y},${x.m})" title="${fmtMon(cli, x.ars)}">
      <span class="cv-barra-v" style="height:${Math.max(x.ars / maxMes * 100, x.ars > 0 ? 4 : 0)}%"></span>
      <span class="cv-barra-l">${MESES[x.m].slice(0, 3)}</span>
    </button>`).join("");

  return `
    <div class="cv-grid cv-grid-cal">
      ${cvTarjeta(`${MESES[m]} ${y}`, `
        <div class="cv-semana">${["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map(d => `<span>${d}</span>`).join("")}</div>
        <div class="cv-mes">${celdas}</div>`,
        `<div class="cv-nav"><button onclick="cvMes(-1)" aria-label="Mes anterior">‹</button><button onclick="cvMes(1)" aria-label="Mes siguiente">›</button></div>`)}
      ${cvTarjeta("Pagos del mes", delMes.length ? `
        <div class="cv-fila cv-tot"><span>Total del mes</span><b>${fmtMon(cli, totalCupon + totalAmort)}</b></div>
        <div class="cv-fila"><span class="cv-sub">Cupones</span><span>${fmtMon(cli, totalCupon)}</span></div>
        <div class="cv-fila"><span class="cv-sub">Amortizaciones</span><span>${fmtMon(cli, totalAmort)}</span></div>
        <div class="cv-sep"></div>${detalle}` : `<p class="cv-vacio">No hay pagos este mes.</p>`)}
    </div>
    ${cvTarjeta("Próximos 12 meses", `<div class="cv-barras">${barras}</div><p class="cv-nota">Cupones y amortizaciones de los bonos, letras y obligaciones negociables de tu cartera, calculados sobre los nominales que tenés hoy. Los pagos en dólares se convierten al tipo de cambio actual de tu cuenta. Los dividendos de acciones no están incluidos.</p>`)}`;
}
