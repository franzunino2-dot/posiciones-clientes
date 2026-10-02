// Lógica de la app: cálculo de posiciones, cauciones, carry trade y persistencia local.

const LS_KEY = "posiciones_clientes_v1";
const PASSWORD = "091218"; // cambiar acá si querés otra clave

function fmtMoney(n, decimals = 2) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  return n.toLocaleString("es-AR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtPct(n) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%";
}

function loadOverrides() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || "{}");
  } catch (e) {
    return {};
  }
}

function saveOverrides(data) {
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}

// Combina los datos base (en vivo de Gallo si hay backend, si no data.js) con lo editado a
// mano y guardado en el navegador.
function getClientes() {
  const overrides = loadOverrides();
  const fuente = LIVE_CLIENTES || CLIENTES;
  return fuente.map(base => {
    const ov = overrides[base.id];
    if (!ov) return JSON.parse(JSON.stringify(base));
    const cli = JSON.parse(JSON.stringify(base));
    if (ov.pesos) Object.assign(cli.pesos, ov.pesos);
    if (ov.dolares) Object.assign(cli.dolares, ov.dolares);
    if (ov.caucion) Object.assign(cli.caucion, ov.caucion);
    if (ov.ganancias) cli.ganancias = ov.ganancias;
    if (ov.detallePesos) cli.detallePesos = ov.detallePesos;
    if (ov.detalleDolares) cli.detalleDolares = ov.detalleDolares;
    if (ov.mepActualCarry !== undefined) cli.mepActualCarry = ov.mepActualCarry;
    return cli;
  });
}

function updateClienteField(id, path, value) {
  const overrides = loadOverrides();
  if (!overrides[id]) overrides[id] = {};
  const cliActual = getClientes().find(c => c.id === id);
  const keys = path.split(".");
  let src = cliActual, dstParent = overrides[id];
  for (let i = 0; i < keys.length - 1; i++) {
    if (!dstParent[keys[i]]) dstParent[keys[i]] = JSON.parse(JSON.stringify(src[keys[i]]));
    dstParent = dstParent[keys[i]];
    src = src[keys[i]];
  }
  dstParent[keys[keys.length - 1]] = value;
  saveOverrides(overrides);
}

function calcPosicion(pos) {
  // pos.factorUnidad viene de Gallo cuando el dato es en vivo (derivado del propio "importe"
  // que manda Gallo, no adivinado por ticker) — con eso alcanza para cualquier bono/ON/letra
  // sin mantener una lista fija. Si no viene (datos estáticos de demo), se usa el array BONOS.
  const factorUnidad = pos.factorUnidad !== undefined ? pos.factorUnidad : (BONOS.includes(pos.t) ? 0.01 : 1);
  const factor = pos.c * factorUnidad;
  const importe = factor * pos.p;
  const resultados = factor * (pos.p - pos.co);
  const varPct = pos.co ? ((pos.p - pos.co) / pos.co) * 100 : 0;
  const resultadoDia = factor * (pos.p - pos.pa);
  const varDiaPct = pos.pa ? ((pos.p - pos.pa) / pos.pa) * 100 : 0;
  return { importe, resultados, varPct, resultadoDia, varDiaPct };
}

function diasEntre(fechaInicioStr) {
  if (!fechaInicioStr) return 0;
  const inicio = new Date(fechaInicioStr + "T00:00:00");
  const hoy = new Date();
  const dias = Math.floor((hoy - inicio) / 86400000);
  return Math.max(dias, 0);
}

function calcInteres(saldo, tasaTNA, fechaInicioStr) {
  if (saldo >= 0) return { dias: 0, interes: 0 };
  const dias = diasEntre(fechaInicioStr);
  const interes = Math.abs(saldo) * (tasaTNA / 365) * dias;
  return { dias, interes };
}

// Carry trade: monto en pesos invertido en la letra, convertido a USD al MEP de entrada,
// comparado contra el valor actual convertido al MEP de hoy.
function calcCarry(pos, mepEntrada, mepActual) {
  const factorUnidad = pos.factorUnidad !== undefined ? pos.factorUnidad : 0.01;
  const montoPesos = pos.c * factorUnidad * pos.co;
  const valorActualPesos = pos.c * factorUnidad * pos.p;
  const usdInvertido = mepEntrada ? montoPesos / mepEntrada : null;
  const valorActualUSD = mepActual && usdInvertido !== null ? valorActualPesos / mepActual : null;
  const rendUSD = usdInvertido && valorActualUSD !== null ? (valorActualUSD / usdInvertido - 1) * 100 : null;
  const mepBreakeven = usdInvertido ? valorActualPesos / usdInvertido : null;
  return { montoPesos, valorActualPesos, usdInvertido, valorActualUSD, rendUSD, mepBreakeven };
}

// ---------- Navegación ----------

let vistaActual = "dashboard";
let clienteActualId = null;

const VISTAS_CON_SELECTOR = ["dashboardCliente", "posiciones", "rendimiento"];

function irAVista(vista) {
  vistaActual = vista;
  document.querySelectorAll(".navbtn").forEach(b => b.classList.toggle("active", b.dataset.view === vista));
  document.querySelectorAll(".view").forEach(v => v.style.display = v.id === "view-" + vista ? "block" : "none");
  if (esAdmin()) {
    document.getElementById("selectorWrap").style.display = VISTAS_CON_SELECTOR.includes(vista) ? "flex" : "none";
  }
  render();
}

function render() {
  const clientes = getClientes();
  // Un cliente (no admin) solo puede ver su propia cuenta, nunca la de otros comitentes.
  const clientesVisibles = esAdmin() ? clientes : clientes.filter(c => c.id === sesion.comitenteId);
  const sel = document.getElementById("comitenteSelect");
  if (!sel.dataset.built) {
    clientes.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = `${c.id} ${c.nombre}`;
      sel.appendChild(opt);
    });
    sel.dataset.built = "1";
    sel.value = clienteActualId || clientes[0].id;
  }
  clienteActualId = esAdmin() ? sel.value : sesion.comitenteId;
  const cli = clientesVisibles.find(c => c.id === clienteActualId);

  if (vistaActual === "general") renderDashboard(clientesVisibles);
  else if (vistaActual === "dashboardCliente") renderDashboardCliente(cli);
  else if (vistaActual === "posiciones") renderPosiciones(cli);
  else if (vistaActual === "rendimiento") renderRendimiento(cli);
  else if (vistaActual === "cauciones") renderCaucionesGlobal(clientesVisibles);
  else if (vistaActual === "carry") renderCarryTrade(clientesVisibles);
  else if (vistaActual === "comitentes") renderVistaGeneral(clientesVisibles);
  else if (vistaActual === "mercado") renderMercado();
  else if (vistaActual === "cargar") renderCargar();
  renderTicker();
}

// ---------- Dashboard ----------

function renderDashboard(clientes) {
  const el = document.getElementById("view-general");
  const totalCartera = clientes.reduce((a, c) => a + (c.totalPortfolio || 0), 0);
  const enCaucionPesos = clientes.filter(c => c.pesos.cuentaCorriente < 0);
  const enCaucionUSD = clientes.filter(c => c.dolares.cuentaCorrienteUSD < 0);
  const totalCaucionPesos = enCaucionPesos.reduce((a, c) => a + Math.abs(c.pesos.cuentaCorriente), 0);
  const totalCaucionUSD = enCaucionUSD.reduce((a, c) => a + Math.abs(c.dolares.cuentaCorrienteUSD), 0);

  const filasCaucion = clientes.filter(c => c.pesos.cuentaCorriente < 0 || c.dolares.cuentaCorrienteUSD < 0).map(c => `
    <tr>
      <td>${c.id}</td><td>${c.nombre}</td>
      <td class="${c.pesos.cuentaCorriente < 0 ? "neg" : ""}">$ ${fmtMoney(c.pesos.cuentaCorriente)}</td>
      <td class="${c.dolares.cuentaCorrienteUSD < 0 ? "neg" : ""}">USD ${fmtMoney(c.dolares.cuentaCorrienteUSD)}</td>
    </tr>
  `).join("");

  el.innerHTML = `
    <div class="stats-row">
      <div class="stat-card">
        <span class="stat-label">Cartera total</span>
        <span class="stat-value">$ ${fmtMoney(totalCartera, 0)}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Comitentes</span>
        <span class="stat-value">${clientes.length}</span>
      </div>
      <div class="stat-card ${totalCaucionPesos ? "warn" : ""}">
        <span class="stat-label">Caución en pesos</span>
        <span class="stat-value">$ ${fmtMoney(totalCaucionPesos, 0)}</span>
        <span class="stat-sub">${enCaucionPesos.length} cuenta(s)</span>
      </div>
      <div class="stat-card ${totalCaucionUSD ? "warn" : ""}">
        <span class="stat-label">Caución en USD</span>
        <span class="stat-value">USD ${fmtMoney(totalCaucionUSD, 0)}</span>
        <span class="stat-sub">${enCaucionUSD.length} cuenta(s)</span>
      </div>
    </div>
    <div class="panel">
      <h3>Cuentas con caución tomada</h3>
      ${filasCaucion ? `
        <table>
          <thead><tr><th>Comitente</th><th>Nombre</th><th>Cta cte $</th><th>Cta cte USD</th></tr></thead>
          <tbody>${filasCaucion}</tbody>
        </table>
      ` : `<p class="muted">Ninguna cuenta tiene caución tomada.</p>`}
    </div>
  `;
}

// ---------- Dashboard por comitente ----------

function renderDashboardCliente(cli) {
  const el = document.getElementById("view-dashboardCliente");

  const posPesos = (cli.detallePesos || []).map(p => ({ ...p, moneda: "ARS" }));
  const posDolares = (cli.detalleDolares || []).map(p => ({ ...p, moneda: "USD" }));
  const todas = [...posPesos, ...posDolares].map(p => ({ ...p, ...calcPosicion(p) }));

  let totalCostoARS = 0, totalResultadosARS = 0, totalValorARS = 0;
  todas.forEach(p => {
    const factorUnidad = p.factorUnidad !== undefined ? p.factorUnidad : (BONOS.includes(p.t) ? 0.01 : 1);
    const factor = p.c * factorUnidad;
    const fx = p.moneda === "USD" ? (cli.tc || 0) : 1;
    totalCostoARS += factor * p.co * fx;
    totalResultadosARS += p.resultados * fx;
    totalValorARS += p.importe * fx;
  });
  const rendimientoPct = totalCostoARS ? (totalResultadosARS / totalCostoARS) * 100 : null;

  let mejor = null, peor = null;
  todas.forEach(p => {
    if (!p.co) return;
    if (!mejor || p.varPct > mejor.varPct) mejor = p;
    if (!peor || p.varPct < peor.varPct) peor = p;
  });

  const distFilas = todas
    .map(p => ({ ticker: p.t, valorARS: p.importe * (p.moneda === "USD" ? (cli.tc || 0) : 1) }))
    .filter(p => p.valorARS > 0)
    .sort((a, b) => b.valorARS - a.valorARS);
  const distTop = distFilas.slice(0, 8);
  const distResto = distFilas.slice(8).reduce((a, p) => a + p.valorARS, 0);
  if (distResto > 0) distTop.push({ ticker: "Otros", valorARS: distResto });

  const saludo = esAdmin()
    ? `Cartera de <em>${titulo(cli.nombre)}.</em>`
    : `Hola, ${titulo(cli.nombre)}. <span class="soft">Esta es tu cartera.</span>`;
  const cauc = [];
  if (cli.pesos.cuentaCorriente < 0) cauc.push("$ " + fmtMoney(cli.pesos.cuentaCorriente, 0));
  if (cli.dolares.cuentaCorrienteUSD < 0) cauc.push("USD " + fmtMoney(cli.dolares.cuentaCorrienteUSD, 0));
  el.innerHTML = `
    <h1 class="hero-title">${saludo}</h1>
    <div class="hero-card">
      <div>
        <span class="pill">${LIVE_CLIENTES ? "Conectada a tu cuenta Equanima" : "Modo demo"}</span>
        <div class="stat-label" style="text-transform:none;font-size:13px">Capital actual</div>
        <h2 class="hero-big" style="border:0;padding:0;margin-bottom:8px">$ ${fmtMoney(cli.totalPortfolio, 0)}</h2>
        <p class="hero-sub">${todas.length} posiciones abiertas · T. cambio ${fmtMoney(cli.tc)}</p>
        <button class="btn-primary" onclick="irAVista('posiciones')">Ver posiciones →</button>
        <div class="hero-chips"><span>Solo lectura</span><span>${LIVE_CLIENTES ? "Datos desde Gallo" : "Datos de ejemplo"}</span></div>
      </div>
      <div class="mini-grid">
        <div class="mini ${rendimientoPct !== null && rendimientoPct < 0 ? "warn" : ""}"><span class="stat-label">Rendimiento</span>
          <b class="${rendimientoPct !== null ? (rendimientoPct < 0 ? "neg" : "pos") : ""}">${rendimientoPct !== null ? fmtPct(rendimientoPct) : "—"}</b><span class="stat-sub">Sobre costo actual</span></div>
        <div class="mini"><span class="stat-label">TIR anualizada</span><b>—</b><span class="stat-sub">Datos insuficientes</span></div>
        <div class="mini"><span class="stat-label">Mejor activo</span><b class="pos">${mejor ? mejor.t : "—"}</b><span class="stat-sub">${mejor ? fmtPct(mejor.varPct) : "Sin datos"}</span></div>
        <div class="mini"><span class="stat-label">Peor activo</span><b class="neg">${peor ? peor.t : "—"}</b><span class="stat-sub">${peor ? fmtPct(peor.varPct) : "Sin datos"}</span></div>
        <div class="mini ${cauc.length ? "warn" : ""}" style="grid-column:span 2"><span class="stat-label">Caución tomada</span>
          <b>${cauc.length ? cauc.join(" · ") : "Sin caución"}</b><span class="stat-sub">Saldo de cuenta corriente negativo</span></div>
      </div>
    </div>

    <div class="two-col">
      <div class="panel">
        <h3>Rendimiento del portfolio</h3>
        <p class="muted" style="text-align:center; padding: 30px 0;">
          Sin datos de evolución todavía — se arma con el histórico diario de operaciones.
        </p>
      </div>
      <div class="panel">
        <h3>Distribución de activos</h3>
        ${distTop.length ? distTop.map(p => `
          <div class="dist-row">
            <span class="dist-label">${p.ticker}</span>
            <div class="dist-bar-wrap"><div class="dist-bar" style="width:${totalValorARS ? (p.valorARS / totalValorARS * 100) : 0}%"></div></div>
            <span class="dist-pct">${totalValorARS ? fmtPct(p.valorARS / totalValorARS * 100) : "-"}</span>
          </div>
        `).join("") : `<p class="muted">Sin posiciones.</p>`}
      </div>
    </div>
  `;
}

// ---------- Posiciones (vista por comitente) ----------

let monedaPosiciones = "ARS";

function setMonedaPosiciones(m) {
  monedaPosiciones = m;
  render();
}

function renderPosiciones(cli) {
  const el = document.getElementById("view-posiciones");
  const key = monedaPosiciones === "ARS" ? "detallePesos" : "detalleDolares";
  const simbolo = monedaPosiciones === "ARS" ? "$" : "USD";
  const posiciones = cli[key] || [];
  const ganancias = (cli.ganancias || []).filter(g => (g.moneda || "ARS") === monedaPosiciones);

  const totalNoRealizado = posiciones.reduce((a, p) => a + calcPosicion(p).resultados, 0);
  const totalRealizado = ganancias.reduce((a, g) => a + ((parseFloat(g.ventaRescate) || 0) - (parseFloat(g.costo) || 0)), 0);
  const totalTotal = totalNoRealizado + totalRealizado;

  el.innerHTML = `
    <div class="moneda-toggle">
      <button class="periodo-btn ${monedaPosiciones === "ARS" ? "active" : ""}" onclick="setMonedaPosiciones('ARS')">Pesos</button>
      <button class="periodo-btn ${monedaPosiciones === "USD" ? "active" : ""}" onclick="setMonedaPosiciones('USD')">Dólares</button>
    </div>

    <div class="stats-row">
      <div class="stat-card">
        <span class="stat-label">Actuales</span>
        <span class="stat-value">${posiciones.length}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Cerradas</span>
        <span class="stat-value">${ganancias.length}</span>
      </div>
      <div class="stat-card ${totalNoRealizado < 0 ? "warn" : ""}">
        <span class="stat-label">P&L no realizado</span>
        <span class="stat-value ${totalNoRealizado < 0 ? "neg" : "pos"}">${simbolo} ${fmtMoney(totalNoRealizado)}</span>
      </div>
      <div class="stat-card ${totalRealizado < 0 ? "warn" : ""}">
        <span class="stat-label">P&L realizado</span>
        <span class="stat-value ${totalRealizado < 0 ? "neg" : "pos"}">${simbolo} ${fmtMoney(totalRealizado)}</span>
      </div>
      <div class="stat-card ${totalTotal < 0 ? "warn" : ""}">
        <span class="stat-label">P&L total</span>
        <span class="stat-value ${totalTotal < 0 ? "neg" : "pos"}">${simbolo} ${fmtMoney(totalTotal)}</span>
      </div>
    </div>

    <div class="panel">
      <h3>Resumen del comitente</h3>
      <div class="row"><span>Portafolio en pesos</span><b>$ ${fmtMoney(cli.pesos.valor)}</b></div>
      <div class="row ${cli.pesos.cuentaCorriente < 0 ? "neg" : "pos"}">
        <span>Cuenta corriente pesos</span><b>$ ${fmtMoney(cli.pesos.cuentaCorriente)}</b>
      </div>
      <div class="row"><span>Portafolio en dólares</span><b>USD ${fmtMoney(cli.dolares.valorUSD)} · $ ${fmtMoney(cli.dolares.valorARS)}</b></div>
      <div class="row ${cli.dolares.cuentaCorrienteUSD < 0 ? "neg" : "pos"}">
        <span>Cuenta corriente dólares</span><b>USD ${fmtMoney(cli.dolares.cuentaCorrienteUSD)} · $ ${fmtMoney(cli.dolares.cuentaCorrienteARS)}</b>
      </div>
      <div class="row"><span>T. Cambio</span><b>${fmtMoney(cli.tc)}</b></div>
      ${cli.alertas ? `<div class="alerta">${cli.alertas.map(a => `⚠️ ${a}`).join("<br>")}</div>` : ""}
    </div>

    ${(cli.pesos.cuentaCorriente < 0 || cli.dolares.cuentaCorrienteUSD < 0) ? `
      <div class="panel"><h3>Caución de esta cuenta</h3><div id="caucionInline"></div></div>
    ` : ""}

    <div class="panel">
      <h3>Actuales</h3>
      <p class="muted">Valor, costo y P&L latente de posiciones abiertas.</p>
      <div class="table-wrap" id="tablaActuales"></div>
    </div>

    <div class="panel">
      <h3>Cerradas</h3>
      <p class="muted">P&L realizado por activo. Cargá cantidad, costo y venta/rescate para cada posición cerrada.</p>
      <div class="table-wrap" id="tablaCerradas"></div>
    </div>
  `;

  if (document.getElementById("caucionInline")) renderCaucionCliente(cli, "caucionInline");
  renderActuales(cli, key, simbolo);
  renderCerradas(cli, monedaPosiciones, simbolo);
}

function renderCaucionCliente(cli, elId) {
  const el = document.getElementById(elId);
  const bloques = [];

  if (cli.pesos.cuentaCorriente < 0) {
    const fecha = cli.caucion.fechaInicioPesos || todayStr();
    const { dias, interes } = calcInteres(cli.pesos.cuentaCorriente, TASA_TNA_ARS, fecha);
    bloques.push(`
      <div class="caucion-box">
        <h4>Caución en pesos (24% TNA)</h4>
        <div class="row"><span>Saldo adeudado</span><b>$ ${fmtMoney(cli.pesos.cuentaCorriente)}</b></div>
        <div class="row"><span>Fecha inicio</span>
          ${esAdmin() ? `<input type="date" value="${fecha}" onchange="updateClienteField('${cli.id}','caucion.fechaInicioPesos', this.value); render();">` : `<b>${fecha}</b>`}
        </div>
        <div class="row"><span>Días transcurridos</span><b>${dias}</b></div>
        <div class="row"><span>Interés devengado</span><b>$ ${fmtMoney(interes)}</b></div>
        <div class="row"><span>Total adeudado hoy</span><b>$ ${fmtMoney(Math.abs(cli.pesos.cuentaCorriente) + interes)}</b></div>
      </div>
    `);
  }

  if (cli.dolares.cuentaCorrienteUSD < 0) {
    const fecha = cli.caucion.fechaInicioUSD || todayStr();
    const { dias, interes } = calcInteres(cli.dolares.cuentaCorrienteUSD, TASA_TNA_USD, fecha);
    bloques.push(`
      <div class="caucion-box">
        <h4>Caución en dólares (2% TNA)</h4>
        <div class="row"><span>Saldo adeudado</span><b>USD ${fmtMoney(cli.dolares.cuentaCorrienteUSD)}</b></div>
        <div class="row"><span>Fecha inicio</span>
          ${esAdmin() ? `<input type="date" value="${fecha}" onchange="updateClienteField('${cli.id}','caucion.fechaInicioUSD', this.value); render();">` : `<b>${fecha}</b>`}
        </div>
        <div class="row"><span>Días transcurridos</span><b>${dias}</b></div>
        <div class="row"><span>Interés devengado</span><b>USD ${fmtMoney(interes)}</b></div>
        <div class="row"><span>Total adeudado hoy</span><b>USD ${fmtMoney(Math.abs(cli.dolares.cuentaCorrienteUSD) + interes)}</b></div>
      </div>
    `);
  }

  el.innerHTML = `<div class="caucion-grid">${bloques.join("")}</div>`;
}

function renderActuales(cli, key, simbolo) {
  const el = document.getElementById("tablaActuales");
  const filas = cli[key] || [];
  if (!filas.length) {
    el.innerHTML = `<p class="muted">No hay posiciones abiertas.</p>`;
    return;
  }
  let totalImporte = 0, totalResultados = 0;
  const filasHtml = filas.map((pos, i) => {
    const { importe, resultados } = calcPosicion(pos);
    totalImporte += importe; totalResultados += resultados;
    const esBono = pos.factorUnidad !== undefined ? pos.factorUnidad === 0.01 : BONOS.includes(pos.t);
    const tipo = esBono ? "Bono/Letra" : "Acción/CEDEAR";
    return `
      <tr>
        <td>${pos.t}<br><span class="muted" style="font-size:11px">${pos.n}</span></td>
        <td>${simbolo} ${fmtMoney(importe)}</td>
        <td>${esAdmin() ? `<input type="number" value="${pos.c}" step="any" onchange="editarPosicion('${cli.id}','${key}',${i},'c',this.value)">` : fmtMoney(pos.c, 0)}</td>
        <td>${esAdmin() ? `<input type="number" value="${pos.p}" step="any" onchange="editarPosicion('${cli.id}','${key}',${i},'p',this.value)">` : fmtMoney(pos.p)}</td>
        <td>${esAdmin() ? `<input type="number" value="${pos.co}" step="any" onchange="editarPosicion('${cli.id}','${key}',${i},'co',this.value)">` : fmtMoney(pos.co)}</td>
        <td class="${resultados < 0 ? "neg" : "pos"}">${simbolo} ${fmtMoney(resultados)}</td>
        <td class="muted">-</td>
        <td>${tipo}</td>
        <td>Equanima</td>
        <td>${esAdmin() ? `<button onclick="borrarPosicion('${cli.id}','${key}',${i})">✕</button>` : ""}</td>
      </tr>
    `;
  }).join("");
  el.innerHTML = `
    <table>
      <thead>
        <tr><th>Activo</th><th>Valor</th><th>Cantidad</th><th>Precio</th><th>Costo Prom.</th>
        <th>P&L No Realiz.</th><th>P&L Realiz.</th><th>Tipo</th><th>Broker</th><th></th></tr>
      </thead>
      <tbody>${filasHtml}</tbody>
      <tfoot>
        <tr><td>Subtotal</td><td>${simbolo} ${fmtMoney(totalImporte)}</td><td></td><td></td><td></td>
        <td class="${totalResultados < 0 ? "neg" : "pos"}">${simbolo} ${fmtMoney(totalResultados)}</td><td></td><td></td><td></td><td></td></tr>
      </tfoot>
    </table>
    ${esAdmin() ? `<button onclick="agregarPosicion('${cli.id}','${key}')">+ Agregar posición</button>` : ""}
  `;
}

function editarPosicion(id, key, idx, campo, valor) {
  const cli = getClientes().find(c => c.id === id);
  cli[key][idx][campo] = parseFloat(valor.toString().replace(",", ".")) || 0;
  const overrides = loadOverrides();
  if (!overrides[id]) overrides[id] = {};
  overrides[id][key] = cli[key];
  saveOverrides(overrides);
  render();
}

function agregarPosicion(id, key) {
  const cli = getClientes().find(c => c.id === id);
  cli[key].push({ t: "NUEVO", n: "", c: 0, p: 0, co: 0, pa: 0 });
  const overrides = loadOverrides();
  if (!overrides[id]) overrides[id] = {};
  overrides[id][key] = cli[key];
  saveOverrides(overrides);
  render();
}

function borrarPosicion(id, key, idx) {
  const cli = getClientes().find(c => c.id === id);
  cli[key].splice(idx, 1);
  const overrides = loadOverrides();
  if (!overrides[id]) overrides[id] = {};
  overrides[id][key] = cli[key];
  saveOverrides(overrides);
  render();
}

function renderCerradas(cli, moneda, simbolo) {
  const el = document.getElementById("tablaCerradas");
  const todas = cli.ganancias || [];
  const indices = todas.map((g, i) => i).filter(i => (todas[i].moneda || "ARS") === moneda);
  if (!indices.length) {
    el.innerHTML = `<p class="muted">Todavía no hay posiciones cerradas con movimientos económicos.</p>`;
  } else {
    const filas = indices.map(i => {
      const g = todas[i];
      const costo = parseFloat(g.costo) || 0;
      const venta = parseFloat(g.ventaRescate) || 0;
      const pnl = venta - costo;
      const pct = costo ? (pnl / costo) * 100 : null;
      return `
        <tr>
          <td>${esAdmin() ? `<input value="${g.ticker}" onchange="editarGanancia('${cli.id}',${i},'ticker',this.value)">` : g.ticker}</td>
          <td>Equanima</td>
          <td>${esAdmin() ? `<input type="number" value="${g.cantidad || 0}" step="any" onchange="editarGanancia('${cli.id}',${i},'cantidad',this.value)">` : fmtMoney(g.cantidad || 0, 0)}</td>
          <td>${esAdmin() ? `<input type="number" value="${g.costo || 0}" step="any" onchange="editarGanancia('${cli.id}',${i},'costo',this.value)">` : fmtMoney(g.costo || 0)}</td>
          <td>${esAdmin() ? `<input type="number" value="${g.ventaRescate || 0}" step="any" onchange="editarGanancia('${cli.id}',${i},'ventaRescate',this.value)">` : fmtMoney(g.ventaRescate || 0)}</td>
          <td class="${pnl < 0 ? "neg" : "pos"}">${simbolo} ${fmtMoney(pnl)}</td>
          <td class="${pct !== null && pct < 0 ? "neg" : pct !== null ? "pos" : ""}">${pct !== null ? fmtPct(pct) : "-"}</td>
          <td>${esAdmin() ? `<input type="date" value="${g.fecha}" onchange="editarGanancia('${cli.id}',${i},'fecha',this.value)">` : g.fecha}</td>
          <td>${esAdmin() ? `<button onclick="borrarGanancia('${cli.id}',${i})">✕</button>` : ""}</td>
        </tr>
      `;
    }).join("");
    el.innerHTML = `
      <table>
        <thead><tr><th>Activo</th><th>Broker</th><th>Cantidad</th><th>Costo</th><th>Venta/Rescate</th>
        <th>P&L Realiz.</th><th>%</th><th>Período</th><th></th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
    `;
  }
  if (esAdmin()) {
    el.insertAdjacentHTML("beforeend", `<button onclick="agregarGanancia('${cli.id}','${moneda}')">+ Agregar posición cerrada</button>`);
  }
}

function editarGanancia(id, idx, campo, valor) {
  const cli = getClientes().find(c => c.id === id);
  if (!cli.ganancias) cli.ganancias = [];
  const numerico = ["cantidad", "costo", "ventaRescate"].includes(campo);
  cli.ganancias[idx][campo] = numerico ? (parseFloat(valor.toString().replace(",", ".")) || 0) : valor;
  const overrides = loadOverrides();
  if (!overrides[id]) overrides[id] = {};
  overrides[id].ganancias = cli.ganancias;
  saveOverrides(overrides);
  render();
}

function agregarGanancia(id, moneda) {
  const cli = getClientes().find(c => c.id === id);
  if (!cli.ganancias) cli.ganancias = [];
  cli.ganancias.push({ fecha: todayStr(), ticker: "", cantidad: 0, costo: 0, ventaRescate: 0, moneda: moneda || "ARS" });
  const overrides = loadOverrides();
  if (!overrides[id]) overrides[id] = {};
  overrides[id].ganancias = cli.ganancias;
  saveOverrides(overrides);
  render();
}

function borrarGanancia(id, idx) {
  const cli = getClientes().find(c => c.id === id);
  cli.ganancias.splice(idx, 1);
  const overrides = loadOverrides();
  if (!overrides[id]) overrides[id] = {};
  overrides[id].ganancias = cli.ganancias;
  saveOverrides(overrides);
  render();
}

// ---------- Rendimiento ----------

let periodoRendimiento = "hoy";

function setPeriodoRendimiento(p) {
  periodoRendimiento = p;
  render();
}

function renderRendimiento(cli) {
  const el = document.getElementById("view-rendimiento");
  const periodos = [
    { key: "hoy", label: "Hoy" },
    { key: "semana", label: "Semana" },
    { key: "mes", label: "Mes" },
    { key: "año", label: "Año" },
    { key: "total", label: "Total" },
  ];
  const tabsHtml = periodos.map(p => `
    <button class="periodo-btn ${periodoRendimiento === p.key ? "active" : ""}" onclick="setPeriodoRendimiento('${p.key}')">${p.label}</button>
  `).join("");

  if (periodoRendimiento === "hoy") {
    const resultadoDiaPesos = (cli.detallePesos || []).reduce((a, p) => a + calcPosicion(p).resultadoDia, 0);
    const resultadoDiaDolares = (cli.detalleDolares || []).reduce((a, p) => a + calcPosicion(p).resultadoDia, 0);
    const realizadoHoy = (cli.ganancias || []).filter(g => g.fecha === todayStr()).reduce((a, g) => a + ((parseFloat(g.ventaRescate) || 0) - (parseFloat(g.costo) || 0)), 0);
    el.innerHTML = `
      <div class="periodo-tabs">${tabsHtml}</div>
      <div class="stats-row">
        <div class="stat-card ${resultadoDiaPesos < 0 ? "warn" : ""}">
          <span class="stat-label">Resultado del día ($)</span>
          <span class="stat-value ${resultadoDiaPesos < 0 ? "neg" : "pos"}">$ ${fmtMoney(resultadoDiaPesos)}</span>
        </div>
        <div class="stat-card ${resultadoDiaDolares < 0 ? "warn" : ""}">
          <span class="stat-label">Resultado del día (USD)</span>
          <span class="stat-value ${resultadoDiaDolares < 0 ? "neg" : "pos"}">USD ${fmtMoney(resultadoDiaDolares)}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Realizado hoy</span>
          <span class="stat-value ${realizadoHoy < 0 ? "neg" : "pos"}">$ ${fmtMoney(realizadoHoy)}</span>
        </div>
      </div>
      <p class="muted">Basado en el precio vs. precio anterior cargado para cada posición, más lo realizado hoy (ganancias/pérdidas cerradas).</p>
    `;
  } else {
    renderRendimientoPeriodo(cli, periodoRendimiento, el, tabsHtml);
  }
}

function getRangoPeriodo(periodo) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  let inicio;
  if (periodo === "semana") {
    inicio = new Date(hoy); inicio.setDate(hoy.getDate() - 6);
  } else if (periodo === "mes") {
    inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  } else if (periodo === "año") {
    inicio = new Date(hoy.getFullYear(), 0, 1);
  } else {
    inicio = null; // total
  }
  return { inicio, fin: hoy };
}

function renderRendimientoPeriodo(cli, periodo, el, tabsHtml) {
  const { inicio } = getRangoPeriodo(periodo);
  const todas = (cli.ganancias || []).filter(g => (g.moneda || "ARS") === "ARS");
  const enRango = todas.filter(g => !inicio || new Date(g.fecha + "T00:00:00") >= inicio);

  const totalPnl = enRango.reduce((a, g) => a + ((parseFloat(g.ventaRescate) || 0) - (parseFloat(g.costo) || 0)), 0);
  const totalCosto = enRango.reduce((a, g) => a + (parseFloat(g.costo) || 0), 0);
  const variacionPct = totalCosto ? (totalPnl / totalCosto) * 100 : null;

  // Agrupar para el gráfico: por día si semana/mes, por mes si año/total
  const porDia = (periodo === "semana" || periodo === "mes");
  const grupos = {};
  enRango.forEach(g => {
    const key = porDia ? g.fecha : g.fecha.slice(0, 7);
    grupos[key] = (grupos[key] || 0) + ((parseFloat(g.ventaRescate) || 0) - (parseFloat(g.costo) || 0));
  });
  const claves = Object.keys(grupos).sort();
  const maxAbs = Math.max(1, ...claves.map(k => Math.abs(grupos[k])));

  const barras = claves.map(k => {
    const v = grupos[k];
    const alturaPct = Math.max(4, (Math.abs(v) / maxAbs) * 100);
    const label = porDia ? k.slice(5) : k;
    return `
      <div class="barcol" title="${label}: $ ${fmtMoney(v)}">
        <div class="barwrap"><div class="bar ${v < 0 ? "neg-bar" : "pos-bar"}" style="height:${alturaPct}%"></div></div>
        <span class="barlabel">${label}</span>
      </div>
    `;
  }).join("");

  el.innerHTML = `
    <div class="periodo-tabs">${tabsHtml}</div>
    <div class="stats-row">
      <div class="stat-card ${totalPnl < 0 ? "warn" : ""}">
        <span class="stat-label">Ganancia realizada del período</span>
        <span class="stat-value ${totalPnl < 0 ? "neg" : "pos"}">$ ${fmtMoney(totalPnl)}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Variación %</span>
        <span class="stat-value ${variacionPct !== null && variacionPct < 0 ? "neg" : "pos"}">${variacionPct !== null ? fmtPct(variacionPct) : "-"}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Operaciones cerradas</span>
        <span class="stat-value">${enRango.length}</span>
      </div>
    </div>
    <div class="panel">
      <h3>Rendimiento del período ${porDia ? "· por día" : "· por mes"}</h3>
      ${claves.length ? `<div class="barchart">${barras}</div>` : `<p class="muted">No hay ganancias realizadas registradas en este período.</p>`}
    </div>
    <p class="muted">Solo incluye ganancias/pérdidas realizadas (posiciones cerradas) en pesos. No incluye P&L no realizado de posiciones abiertas.</p>
  `;
}

// ---------- Cauciones (vista global) ----------

function renderCaucionesGlobal(clientes) {
  const el = document.getElementById("view-cauciones");
  const filas = [];

  clientes.forEach(c => {
    if (c.pesos.cuentaCorriente < 0) {
      const fecha = c.caucion.fechaInicioPesos || todayStr();
      const { dias, interes } = calcInteres(c.pesos.cuentaCorriente, TASA_TNA_ARS, fecha);
      filas.push(`
        <tr>
          <td>${c.id}</td><td>${c.nombre}</td><td>Pesos (24% TNA)</td>
          <td class="neg">$ ${fmtMoney(c.pesos.cuentaCorriente)}</td>
          <td><input type="date" value="${fecha}" onchange="updateClienteField('${c.id}','caucion.fechaInicioPesos', this.value); render();"></td>
          <td>${dias}</td>
          <td>$ ${fmtMoney(interes)}</td>
          <td><b>$ ${fmtMoney(Math.abs(c.pesos.cuentaCorriente) + interes)}</b></td>
        </tr>
      `);
    }
    if (c.dolares.cuentaCorrienteUSD < 0) {
      const fecha = c.caucion.fechaInicioUSD || todayStr();
      const { dias, interes } = calcInteres(c.dolares.cuentaCorrienteUSD, TASA_TNA_USD, fecha);
      filas.push(`
        <tr>
          <td>${c.id}</td><td>${c.nombre}</td><td>Dólares (2% TNA)</td>
          <td class="neg">USD ${fmtMoney(c.dolares.cuentaCorrienteUSD)}</td>
          <td><input type="date" value="${fecha}" onchange="updateClienteField('${c.id}','caucion.fechaInicioUSD', this.value); render();"></td>
          <td>${dias}</td>
          <td>USD ${fmtMoney(interes)}</td>
          <td><b>USD ${fmtMoney(Math.abs(c.dolares.cuentaCorrienteUSD) + interes)}</b></td>
        </tr>
      `);
    }
  });

  el.innerHTML = `
    <div class="panel">
      <h3>Todas las cauciones activas</h3>
      ${filas.length ? `
        <div class="table-wrap">
        <table>
          <thead><tr><th>Comitente</th><th>Nombre</th><th>Moneda</th><th>Saldo</th><th>Fecha inicio</th><th>Días</th><th>Interés devengado</th><th>Total adeudado hoy</th></tr></thead>
          <tbody>${filas.join("")}</tbody>
        </table>
        </div>
      ` : `<p class="muted">Ninguna cuenta tiene caución tomada.</p>`}
    </div>
  `;
}

// ---------- Carry Trade ----------

function renderCarryTrade(clientes) {
  const el = document.getElementById("view-carry");
  const bloques = clientes.map(cli => {
    const esLetra = pos => pos.factorUnidad !== undefined ? pos.factorUnidad === 0.01 : BONOS.includes(pos.t);
    const letras = (cli.detallePesos || [])
      .map((pos, idx) => ({ pos, idx }))
      .filter(({ pos }) => esLetra(pos));
    if (!letras.length) return "";

    const mepActual = cli.mepActualCarry !== undefined ? cli.mepActualCarry : cli.tc;

    const filas = letras.map(({ pos, idx }) => {
      const { montoPesos, valorActualPesos, usdInvertido, valorActualUSD, rendUSD, mepBreakeven } = calcCarry(pos, pos.mepEntrada, mepActual);
      return `
        <tr>
          <td>${pos.t}</td>
          <td>${pos.n}</td>
          <td>${esAdmin() ? `<input type="number" step="any" value="${pos.p}" style="width:100px"
              onchange="editarPosicion('${cli.id}','detallePesos',${idx},'p',this.value)">` : fmtMoney(pos.p)}</td>
          <td>$ ${fmtMoney(montoPesos)}</td>
          <td>${esAdmin() ? `<input type="number" step="any" placeholder="MEP entrada" value="${pos.mepEntrada || ""}"
              onchange="editarMepEntrada('${cli.id}',${idx},this.value)">` : (pos.mepEntrada ? fmtMoney(pos.mepEntrada) : "-")}</td>
          <td>${usdInvertido !== null ? "USD " + fmtMoney(usdInvertido) : "-"}</td>
          <td>$ ${fmtMoney(valorActualPesos)}</td>
          <td>${valorActualUSD !== null ? "USD " + fmtMoney(valorActualUSD) : "-"}</td>
          <td class="${rendUSD !== null && rendUSD < 0 ? "neg" : rendUSD !== null ? "pos" : ""}">${rendUSD !== null ? fmtPct(rendUSD) : "-"}</td>
          <td>${mepBreakeven !== null ? fmtMoney(mepBreakeven) : "-"}</td>
        </tr>
      `;
    }).join("");

    return `
      <div class="panel">
        <h3>${cli.id} ${cli.nombre}</h3>
        <div class="row" style="max-width:320px">
          <span>MEP actual (para valuar hoy)</span>
          ${esAdmin() ? `<input type="number" step="any" value="${mepActual || ""}" onchange="editarMepActual('${cli.id}', this.value)">` : `<b>${fmtMoney(mepActual)}</b>`}
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Ticker</th><th>Nombre</th><th>Precio actual</th><th>Monto $ invertido</th><th>MEP entrada</th><th>USD invertidos</th>
            <th>Valor actual $</th><th>Valor actual USD</th><th>Rend. USD</th><th>MEP breakeven</th></tr></thead>
            <tbody>${filas}</tbody>
          </table>
        </div>
      </div>
    `;
  }).join("");

  el.innerHTML = `
    <p class="muted" style="margin-bottom:16px">
      Cargá el dólar MEP al que se vendió para financiar cada letra ("MEP entrada"). El "MEP breakeven" es el tipo
      de cambio al que el rendimiento en dólares sería exactamente 0% — si el MEP real sube por encima de eso,
      el carry trade da pérdida en dólares aunque gane en pesos.
    </p>
    ${bloques || `<p class="muted">Ningún comitente tiene letras/bonos en pesos cargados.</p>`}
  `;
}

function editarMepEntrada(id, idx, valor) {
  const cli = getClientes().find(c => c.id === id);
  cli.detallePesos[idx].mepEntrada = parseFloat(valor.toString().replace(",", ".")) || undefined;
  const overrides = loadOverrides();
  if (!overrides[id]) overrides[id] = {};
  overrides[id].detallePesos = cli.detallePesos;
  saveOverrides(overrides);
  render();
}

function editarMepActual(id, valor) {
  const overrides = loadOverrides();
  if (!overrides[id]) overrides[id] = {};
  overrides[id].mepActualCarry = parseFloat(valor.toString().replace(",", ".")) || undefined;
  saveOverrides(overrides);
  render();
}

// ---------- Comitentes (vista general) ----------

function renderVistaGeneral(clientes) {
  const el = document.getElementById("view-comitentes");
  const conProductor = clientes.some(c => c.productor);
  const grupos = {};
  clientes.forEach(c => {
    const k = c.productor || "—";
    const g = grupos[k] || (grupos[k] = { nombre: k, n: 0, cartera: 0, caucion: 0, conActivity: 0 });
    g.n++; g.cartera += c.totalPortfolio || 0;
    if (c.pesos.cuentaCorriente < 0 || c.dolares.cuentaCorrienteUSD < 0) g.caucion++;
    if (c.gananciasInfo) g.conActivity++;
  });
  const resumen = Object.values(grupos).sort((a, b) => b.cartera - a.cartera).map(g => `
    <tr><td>${g.nombre}</td><td>${g.n}</td><td>$ ${fmtMoney(g.cartera, 0)}</td><td>${g.caucion}</td><td>${g.conActivity} de ${g.n}</td></tr>`).join("");
  const filas = clientes.map(c => {
    const enCaucionPesos = c.pesos.cuentaCorriente < 0;
    const enCaucionUSD = c.dolares.cuentaCorrienteUSD < 0;
    let estado = "Sin caución";
    if (enCaucionPesos && enCaucionUSD) estado = "Caución $ y USD";
    else if (enCaucionPesos) estado = "Caución en pesos";
    else if (enCaucionUSD) estado = "Caución en USD";
    const act = c.gananciasInfo ? "Cargado " + new Date(c.gananciasInfo.cargado).toLocaleDateString("es-AR") : (c.ganancias && c.ganancias.length ? "Manual" : "Falta");
    return `
      <tr class="${(enCaucionPesos || enCaucionUSD) ? "fila-caucion" : ""}">
        <td>${c.id}</td><td>${c.nombre}</td>${conProductor ? `<td>${c.productor}</td>` : ""}
        <td>$ ${fmtMoney(c.totalPortfolio)}</td>
        <td class="${enCaucionPesos ? "neg" : ""}">$ ${fmtMoney(c.pesos.cuentaCorriente)}</td>
        <td class="${enCaucionUSD ? "neg" : ""}">USD ${fmtMoney(c.dolares.cuentaCorrienteUSD)}</td>
        <td>${estado}</td><td class="${act === "Falta" ? "muted" : ""}">${act}</td>
      </tr>
    `;
  }).join("");
  el.innerHTML = `
    ${conProductor ? `<div class="panel"><h3>Productores</h3>
      <p class="muted" style="font-size:12px">Cada comitente pertenece al productor (Manager) que tiene asignado en Gallo. "Activity" cuenta cuántos ya tienen cargado su historial de operaciones.</p>
      <div class="table-wrap"><table><thead><tr><th>Productor</th><th>Comitentes</th><th>Cartera total</th><th>Con caución</th><th>Activity cargado</th></tr></thead><tbody>${resumen}</tbody></table></div></div>` : ""}
    <div class="panel">
      <div class="table-wrap">
      <table>
        <thead><tr><th>Comitente</th><th>Nombre</th>${conProductor ? "<th>Productor</th>" : ""}<th>Total portafolio</th><th>Cta cte $</th><th>Cta cte USD</th><th>Estado</th><th>Activity</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
      </div>
    </div>
  `;
}

function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

// ---------- Mercado: barra de precios + vista Mercado ----------
// Dólares: API pública dolarapi.com (compra/venta, sin variación diaria). Especies: último
// precio que informa Gallo para las carteras visibles. No se inventa ni variación ni índices.

const MERCADO = { dolares: [], ts: null };
const NOMBRES_DOLAR = { oficial: "Dólar Oficial", blue: "Dólar Blue", bolsa: "Dólar MEP", contadoconliqui: "Dólar CCL", mayorista: "Mayorista", cripto: "Cripto" };

function titulo(s) {
  return String(s || "").toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
}

async function cargarDolares() {
  try {
    const r = await fetch("https://dolarapi.com/v1/dolares");
    MERCADO.dolares = await r.json();
    MERCADO.ts = new Date();
  } catch (e) { /* sin internet: el ticker muestra solo las especies */ }
  renderTicker();
  if (vistaActual === "mercado") render();
}

function bymaAbierto() {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/Argentina/Buenos_Aires", weekday: "short", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date());
  const get = t => p.find(x => x.type === t).value;
  const dia = get("weekday"), min = (parseInt(get("hour")) % 24) * 60 + parseInt(get("minute"));
  return !["Sat", "Sun"].includes(dia) && min >= 11 * 60 && min < 17 * 60;
}

function especiesVisibles() {
  const mapa = {};
  getClientes().forEach(c => {
    [["ARS", c.detallePesos], ["USD", c.detalleDolares]].forEach(([moneda, lista]) => (lista || []).forEach(p => {
      const { importe } = calcPosicion(p);
      const fx = moneda === "USD" ? (c.tc || 0) : 1;
      const e = mapa[p.t] || (mapa[p.t] = { t: p.t, n: p.n, p: p.p, moneda, holders: 0, valorARS: 0 });
      e.holders++; e.valorARS += importe * fx; e.p = p.p;
    }));
  });
  return Object.values(mapa).sort((a, b) => b.valorARS - a.valorARS);
}

function renderTicker() {
  const items = [];
  MERCADO.dolares.filter(d => NOMBRES_DOLAR[d.casa]).forEach(d => items.push([NOMBRES_DOLAR[d.casa].toUpperCase(), "$ " + fmtMoney(d.venta)]));
  especiesVisibles().slice(0, 10).forEach(e => items.push([e.t, (e.moneda === "USD" ? "USD " : "$ ") + fmtMoney(e.p)]));
  const html = items.map(([n, v]) => `<span class="tk"><span class="n">${n}</span><span class="v">${v}</span></span>`).join("");
  document.getElementById("tickerMove").innerHTML = html + html;
  const ab = bymaAbierto();
  document.getElementById("mktBadges").innerHTML = `<span class="mkt ${ab ? "open" : ""}">BYMA · ${ab ? "Mercado abierto" : "Mercado cerrado"}</span>`;
}

function renderMercado() {
  const el = document.getElementById("view-mercado");
  const dolares = MERCADO.dolares.map(d => `
    <tr><td>${NOMBRES_DOLAR[d.casa] || d.nombre}</td><td>$ ${fmtMoney(d.compra)}</td><td>$ ${fmtMoney(d.venta)}</td>
    <td class="muted">${new Date(d.fechaActualizacion).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}</td></tr>`).join("");
  const esp = especiesVisibles().slice(0, 40).map(e => `
    <tr><td>${e.t}<br><span class="muted" style="font-size:11px">${e.n}</span></td>
    <td>${e.moneda === "USD" ? "USD" : "$"} ${fmtMoney(e.p)}</td><td>${e.holders}</td><td>$ ${fmtMoney(e.valorARS, 0)}</td></tr>`).join("");
  el.innerHTML = `
    <h1 class="hero-title">Mercado. <span class="soft">Los precios que mueven <em>tu cartera.</em></span></h1>
    <div class="two-col">
      <div class="panel">
        <h3>Dólar</h3>
        ${dolares ? `<div class="table-wrap"><table><thead><tr><th>Cotización</th><th>Compra</th><th>Venta</th><th>Actualizado</th></tr></thead><tbody>${dolares}</tbody></table></div>`
                  : `<p class="muted">No se pudo traer la cotización (sin conexión a dolarapi.com).</p>`}
        <p class="muted" style="font-size:11px;margin-top:10px">Fuente: dolarapi.com.</p>
      </div>
      <div class="panel">
        <h3>Especies en cartera</h3>
        <div class="table-wrap"><table><thead><tr><th>Especie</th><th>Último precio</th><th>Comitentes</th><th>Valor en cartera</th></tr></thead><tbody>${esp}</tbody></table></div>
        <p class="muted" style="font-size:11px;margin-top:10px">Precio según la última tenencia informada por Gallo; no es cotización en tiempo real.</p>
      </div>
    </div>`;
}

function exportarEstado() {
  const clientes = getClientes();
  const blob = new Blob([JSON.stringify(clientes, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `posiciones_${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- Login ----------
// Dos modos, elegidos automáticamente según si el backend (servidor.js) está corriendo:
//  - LIVE: hay backend local conectado a Gallo/EGWS. El email se valida en vivo contra
//    Clientes/Managers de Gallo, y las posiciones vienen reales (ver LIVE_CLIENTES).
//  - DEMO: no hay backend (ej. GitHub Pages). Se usan los emails/contraseña estáticos de
//    data.js, igual que antes.

let sesion = null; // { email, rol: 'admin'|'productor'|'cliente', comitenteId?, managerId? }
let LIVE_CLIENTES = null; // null = modo demo (data.js); array = modo live (Gallo)

function esAdmin() {
  // "admin"/"productor" ven la app completa (selector, edición) sobre su propio universo de
  // comitentes — el backend ya restringe qué comitentes le llegan a cada uno.
  return sesion && (sesion.rol === "admin" || sesion.rol === "productor");
}

function resolverSesionDemo(email, pass) {
  if (pass !== PASSWORD_DEMO) return null;
  const mail = (email || "").trim().toLowerCase();
  if (mail === ADMIN_EMAIL.toLowerCase()) {
    return { email: mail, rol: "admin", comitenteId: null };
  }
  const cliente = CLIENTES.find(c => (c.email || "").toLowerCase() === mail);
  if (cliente) return { email: mail, rol: "cliente", comitenteId: cliente.id };
  return null;
}

// Trae las posiciones en vivo del backend y las completa con las ganancias realizadas ya
// reconstruidas a mano en data.js (Gallo no tiene ese historial) para los comitentes que las
// tengan cargadas — así no se pierde ese trabajo al pasar a datos en vivo.
async function cargarComitentesLive(token) {
  const r = await fetch("/api/comitentes", { headers: { Authorization: "Bearer " + token } });
  const data = await r.json();
  if (!data.ok) throw new Error(data.error || "Error trayendo comitentes");
  LIVE_CLIENTES = data.comitentes.map(c => {
    const estatico = CLIENTES.find(e => e.id === c.id);
    if (estatico && estatico.ganancias && estatico.ganancias.length && !c.ganancias.length) {
      c.ganancias = estatico.ganancias;
    }
    return c;
  });
}

async function checkLogin() {
  const guardada = sessionStorage.getItem("sesion");
  if (!guardada) return;
  sesion = JSON.parse(guardada);
  if (sesion.token) {
    try { await cargarComitentesLive(sesion.token); }
    catch (e) { document.getElementById("loginError").textContent = "Se perdió la conexión con Gallo — volvé a entrar."; sessionStorage.removeItem("sesion"); return; }
  }
  document.getElementById("login").style.display = "none";
  document.getElementById("app").style.display = "flex";
  init();
}

async function doLogin() {
  const email = document.getElementById("emailInput").value;
  const pass = document.getElementById("passInput").value;
  const err = document.getElementById("loginError");
  err.textContent = "";

  let backendDisponible = true;
  let resultado = null;
  try {
    const r = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: pass }),
    });
    const data = await r.json();
    if (data.ok) {
      resultado = { email: email.trim().toLowerCase(), rol: data.rol, comitenteId: data.comitenteId || null, managerId: data.managerId || null, token: data.token };
    } else if (r.status !== 503) {
      // 503 = "Gallo no configurado en este server" → cae al modo demo. Cualquier otro
      // rechazo (contraseña/email inválidos) es una respuesta real, no un problema de conexión.
      err.textContent = data.error || "Email o contraseña incorrectos";
      return;
    } else {
      backendDisponible = false;
    }
  } catch (e) {
    backendDisponible = false; // sin backend corriendo (ej. GitHub Pages) → modo demo
  }

  if (resultado) {
    try { await cargarComitentesLive(resultado.token); }
    catch (e) { err.textContent = "No se pudo traer la posición desde Gallo: " + e.message; return; }
  } else if (!backendDisponible) {
    resultado = resolverSesionDemo(email, pass);
    if (!resultado) { err.textContent = "Email o contraseña incorrectos"; return; }
  }

  sesion = resultado;
  sessionStorage.setItem("sesion", JSON.stringify(sesion));
  document.getElementById("login").style.display = "none";
  document.getElementById("app").style.display = "flex";
  init();
}

function logout() {
  sessionStorage.removeItem("sesion");
  location.reload();
}

function init() {
  document.querySelectorAll(".navbtn").forEach(b => {
    if (b.dataset.adminOnly === "1" && !esAdmin()) return;
    b.addEventListener("click", () => irAVista(b.dataset.view));
  });
  if (!esAdmin()) document.querySelectorAll("[data-admin-only]").forEach(b => b.style.display = "none");
  cargarDolares();
  setInterval(cargarDolares, 120000);

  if (esAdmin()) {
    document.getElementById("selectorWrap").style.removeProperty("display");
    const sel = document.getElementById("comitenteSelect");
    sel.addEventListener("change", render);
  } else {
    document.getElementById("selectorWrap").style.display = "none";
    const cli = getClientes().find(c => c.id === sesion.comitenteId);
    clienteActualId = sesion.comitenteId;
    const fijo = document.getElementById("clienteFijo");
    fijo.textContent = `${cli.id} ${cli.nombre}`;
    fijo.style.display = "inline";
  }

  document.getElementById("userBadge").textContent = (LIVE_CLIENTES ? "🟢 En vivo (Gallo) — " : "⚪ Modo demo — ") + sesion.email;
  if (esAdmin()) {
    document.getElementById("btnExportar").addEventListener("click", exportarEstado);
  } else {
    document.getElementById("btnExportar").style.display = "none";
  }
  document.getElementById("btnLogout").addEventListener("click", logout);
  document.getElementById("fecha").textContent = new Date().toLocaleDateString("es-AR", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  irAVista(esAdmin() ? "general" : "dashboardCliente");
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btnLogin").addEventListener("click", doLogin);
  document.getElementById("passInput").addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
  document.getElementById("emailInput").addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
  checkLogin();
});
