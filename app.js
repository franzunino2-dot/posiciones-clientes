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

// Combina los datos base (data.js) con lo editado a mano y guardado en el navegador.
function getClientes() {
  const overrides = loadOverrides();
  return CLIENTES.map(base => {
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
  const esBono = BONOS.includes(pos.t);
  const factor = esBono ? pos.c / 100 : pos.c;
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
  const montoPesos = (pos.c / 100) * pos.co;
  const valorActualPesos = (pos.c / 100) * pos.p;
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
  document.getElementById("selectorWrap").style.display = VISTAS_CON_SELECTOR.includes(vista) ? "flex" : "none";
  render();
}

function render() {
  const clientes = getClientes();
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
  clienteActualId = sel.value;
  const cli = clientes.find(c => c.id === clienteActualId);

  if (vistaActual === "general") renderDashboard(clientes);
  else if (vistaActual === "dashboardCliente") renderDashboardCliente(cli);
  else if (vistaActual === "posiciones") renderPosiciones(cli);
  else if (vistaActual === "rendimiento") renderRendimiento(cli);
  else if (vistaActual === "cauciones") renderCaucionesGlobal(clientes);
  else if (vistaActual === "carry") renderCarryTrade(clientes);
  else if (vistaActual === "comitentes") renderVistaGeneral(clientes);
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
    const esBono = BONOS.includes(p.t);
    const factor = esBono ? p.c / 100 : p.c;
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

  el.innerHTML = `
    <div class="stats-row">
      <div class="stat-card">
        <span class="stat-label">Capital actual</span>
        <span class="stat-value">$ ${fmtMoney(cli.totalPortfolio, 0)}</span>
      </div>
      <div class="stat-card ${rendimientoPct !== null && rendimientoPct < 0 ? "warn" : ""}">
        <span class="stat-label">Rendimiento</span>
        <span class="stat-value ${rendimientoPct !== null ? (rendimientoPct < 0 ? "neg" : "pos") : ""}">${rendimientoPct !== null ? fmtPct(rendimientoPct) : "—"}</span>
        <span class="stat-sub">${rendimientoPct !== null ? "Sobre costo actual" : "Sin costo cargado"}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">TIR anualizada</span>
        <span class="stat-value">—</span>
        <span class="stat-sub">Datos insuficientes</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Mejor activo</span>
        <span class="stat-value pos">${mejor ? mejor.t : "—"}</span>
        <span class="stat-sub">${mejor ? fmtPct(mejor.varPct) : "Sin datos"}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Peor activo</span>
        <span class="stat-value neg">${peor ? peor.t : "—"}</span>
        <span class="stat-sub">${peor ? fmtPct(peor.varPct) : "Sin datos"}</span>
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
          <input type="date" value="${fecha}" onchange="updateClienteField('${cli.id}','caucion.fechaInicioPesos', this.value); render();">
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
          <input type="date" value="${fecha}" onchange="updateClienteField('${cli.id}','caucion.fechaInicioUSD', this.value); render();">
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
    const tipo = BONOS.includes(pos.t) ? "Bono/Letra" : "Acción/CEDEAR";
    return `
      <tr>
        <td>${pos.t}<br><span class="muted" style="font-size:11px">${pos.n}</span></td>
        <td>${simbolo} ${fmtMoney(importe)}</td>
        <td><input type="number" value="${pos.c}" step="any" onchange="editarPosicion('${cli.id}','${key}',${i},'c',this.value)"></td>
        <td><input type="number" value="${pos.p}" step="any" onchange="editarPosicion('${cli.id}','${key}',${i},'p',this.value)"></td>
        <td><input type="number" value="${pos.co}" step="any" onchange="editarPosicion('${cli.id}','${key}',${i},'co',this.value)"></td>
        <td class="${resultados < 0 ? "neg" : "pos"}">${simbolo} ${fmtMoney(resultados)}</td>
        <td class="muted">-</td>
        <td>${tipo}</td>
        <td>Equanima</td>
        <td><button onclick="borrarPosicion('${cli.id}','${key}',${i})">✕</button></td>
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
    <button onclick="agregarPosicion('${cli.id}','${key}')">+ Agregar posición</button>
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
          <td><input value="${g.ticker}" onchange="editarGanancia('${cli.id}',${i},'ticker',this.value)"></td>
          <td>Equanima</td>
          <td><input type="number" value="${g.cantidad || 0}" step="any" onchange="editarGanancia('${cli.id}',${i},'cantidad',this.value)"></td>
          <td><input type="number" value="${g.costo || 0}" step="any" onchange="editarGanancia('${cli.id}',${i},'costo',this.value)"></td>
          <td><input type="number" value="${g.ventaRescate || 0}" step="any" onchange="editarGanancia('${cli.id}',${i},'ventaRescate',this.value)"></td>
          <td class="${pnl < 0 ? "neg" : "pos"}">${simbolo} ${fmtMoney(pnl)}</td>
          <td class="${pct !== null && pct < 0 ? "neg" : pct !== null ? "pos" : ""}">${pct !== null ? fmtPct(pct) : "-"}</td>
          <td><input type="date" value="${g.fecha}" onchange="editarGanancia('${cli.id}',${i},'fecha',this.value)"></td>
          <td><button onclick="borrarGanancia('${cli.id}',${i})">✕</button></td>
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
  const btn = document.createElement("div");
  el.insertAdjacentHTML("beforeend", `<button onclick="agregarGanancia('${cli.id}','${moneda}')">+ Agregar posición cerrada</button>`);
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
      <p class="muted">Basado en el precio vs. precio anterior cargado para cada posición.</p>
    `;
  } else {
    el.innerHTML = `
      <div class="periodo-tabs">${tabsHtml}</div>
      <div class="panel">
        <p class="muted">Todavía no hay histórico diario cargado para armar este período. A medida que vayamos
        procesando los archivos de operaciones día a día, esta vista se va a ir completando sola.</p>
      </div>
    `;
  }
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
    const letras = (cli.detallePesos || [])
      .map((pos, idx) => ({ pos, idx }))
      .filter(({ pos }) => BONOS.includes(pos.t));
    if (!letras.length) return "";

    const mepActual = cli.mepActualCarry !== undefined ? cli.mepActualCarry : cli.tc;

    const filas = letras.map(({ pos, idx }) => {
      const { montoPesos, valorActualPesos, usdInvertido, valorActualUSD, rendUSD, mepBreakeven } = calcCarry(pos, pos.mepEntrada, mepActual);
      return `
        <tr>
          <td>${pos.t}</td>
          <td>${pos.n}</td>
          <td>$ ${fmtMoney(montoPesos)}</td>
          <td><input type="number" step="any" placeholder="MEP entrada" value="${pos.mepEntrada || ""}"
              onchange="editarMepEntrada('${cli.id}',${idx},this.value)"></td>
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
          <input type="number" step="any" value="${mepActual || ""}" onchange="editarMepActual('${cli.id}', this.value)">
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Ticker</th><th>Nombre</th><th>Monto $ invertido</th><th>MEP entrada</th><th>USD invertidos</th>
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
  const filas = clientes.map(c => {
    const enCaucionPesos = c.pesos.cuentaCorriente < 0;
    const enCaucionUSD = c.dolares.cuentaCorrienteUSD < 0;
    let estado = "Sin caución";
    if (enCaucionPesos && enCaucionUSD) estado = "Caución $ y USD";
    else if (enCaucionPesos) estado = "Caución en pesos";
    else if (enCaucionUSD) estado = "Caución en USD";
    return `
      <tr class="${(enCaucionPesos || enCaucionUSD) ? "fila-caucion" : ""}">
        <td>${c.id}</td><td>${c.nombre}</td>
        <td>$ ${fmtMoney(c.totalPortfolio)}</td>
        <td class="${enCaucionPesos ? "neg" : ""}">$ ${fmtMoney(c.pesos.cuentaCorriente)}</td>
        <td class="${enCaucionUSD ? "neg" : ""}">USD ${fmtMoney(c.dolares.cuentaCorrienteUSD)}</td>
        <td>${estado}</td>
      </tr>
    `;
  }).join("");
  el.innerHTML = `
    <div class="panel">
      <div class="table-wrap">
      <table>
        <thead><tr><th>Comitente</th><th>Nombre</th><th>Total portafolio</th><th>Cta cte $</th><th>Cta cte USD</th><th>Estado</th></tr></thead>
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

function checkLogin() {
  if (sessionStorage.getItem("logged_in") === "1") {
    document.getElementById("login").style.display = "none";
    document.getElementById("app").style.display = "flex";
    init();
  }
}

function doLogin() {
  const pass = document.getElementById("passInput").value;
  if (pass === PASSWORD) {
    sessionStorage.setItem("logged_in", "1");
    document.getElementById("login").style.display = "none";
    document.getElementById("app").style.display = "flex";
    init();
  } else {
    document.getElementById("loginError").textContent = "Contraseña incorrecta";
  }
}

function logout() {
  sessionStorage.removeItem("logged_in");
  location.reload();
}

function init() {
  document.querySelectorAll(".navbtn").forEach(b => {
    b.addEventListener("click", () => irAVista(b.dataset.view));
  });
  const sel = document.getElementById("comitenteSelect");
  sel.addEventListener("change", render);
  document.getElementById("btnExportar").addEventListener("click", exportarEstado);
  document.getElementById("btnLogout").addEventListener("click", logout);
  document.getElementById("fecha").textContent = new Date().toLocaleDateString("es-AR", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  irAVista("general");
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btnLogin").addEventListener("click", doLogin);
  document.getElementById("passInput").addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
  checkLogin();
});
