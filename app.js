// Lógica de la app: cálculo de posiciones, cauciones y persistencia local.

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

// ---------- Render ----------

let clienteActualId = null;

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
  renderResumen(cli);
  renderCaucion(cli);
  renderDetalle(cli, "detallePesos", "tablaPesos", false);
  renderDetalle(cli, "detalleDolares", "tablaDolares", true);
  renderGanancias(cli);
  renderVistaGeneral(clientes);
}

function renderResumen(cli) {
  const el = document.getElementById("resumen");
  el.innerHTML = `
    <div class="card">
      <div class="row"><span>Total Portafolio</span><b>$ ${fmtMoney(cli.totalPortfolio)}</b></div>
      <div class="row"><span>Portafolio en pesos</span><b>$ ${fmtMoney(cli.pesos.valor)}</b></div>
      <div class="row ${cli.pesos.cuentaCorriente < 0 ? "neg" : "pos"}">
        <span>Cuenta corriente pesos</span><b>$ ${fmtMoney(cli.pesos.cuentaCorriente)}</b>
      </div>
      <div class="row"><span>Portafolio en dólares</span><b>USD ${fmtMoney(cli.dolares.valorUSD)} · $ ${fmtMoney(cli.dolares.valorARS)}</b></div>
      <div class="row ${cli.dolares.cuentaCorrienteUSD < 0 ? "neg" : "pos"}">
        <span>Cuenta corriente dólares</span><b>USD ${fmtMoney(cli.dolares.cuentaCorrienteUSD)} · $ ${fmtMoney(cli.dolares.cuentaCorrienteARS)}</b>
      </div>
      <div class="row"><span>T. Cambio</span><b>${fmtMoney(cli.tc)}</b></div>
    </div>
    ${cli.alertas ? `<div class="alerta">${cli.alertas.map(a => `⚠️ ${a}`).join("<br>")}</div>` : ""}
  `;
}

function renderCaucion(cli) {
  const el = document.getElementById("caucion");
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

  el.innerHTML = bloques.length ? bloques.join("") : `<p class="muted">Esta cuenta no tiene caución tomada.</p>`;
}

function renderDetalle(cli, key, tablaId, esDolar) {
  const el = document.getElementById(tablaId);
  const filas = cli[key] || [];
  if (!filas.length) {
    el.innerHTML = `<p class="muted">Sin posiciones ${esDolar ? "en dólares" : "en pesos"}.</p>`;
    return;
  }
  let totalImporte = 0, totalResultados = 0, totalResultadoDia = 0;
  const filasHtml = filas.map((pos, i) => {
    const { importe, resultados, varPct, resultadoDia, varDiaPct } = calcPosicion(pos);
    totalImporte += importe; totalResultados += resultados; totalResultadoDia += resultadoDia;
    return `
      <tr>
        <td>${pos.t}</td>
        <td>${pos.n}</td>
        <td><input type="number" value="${pos.c}" step="any" onchange="editarPosicion('${cli.id}','${key}',${i},'c',this.value)"></td>
        <td><input type="number" value="${pos.p}" step="any" onchange="editarPosicion('${cli.id}','${key}',${i},'p',this.value)"></td>
        <td>${fmtMoney(importe)}</td>
        <td><input type="number" value="${pos.co}" step="any" onchange="editarPosicion('${cli.id}','${key}',${i},'co',this.value)"></td>
        <td class="${resultados < 0 ? "neg" : "pos"}">${fmtPct(varPct)}</td>
        <td class="${resultados < 0 ? "neg" : "pos"}">${fmtMoney(resultados)}</td>
        <td><input type="number" value="${pos.pa}" step="any" onchange="editarPosicion('${cli.id}','${key}',${i},'pa',this.value)"></td>
        <td class="${resultadoDia < 0 ? "neg" : "pos"}">${fmtPct(varDiaPct)}</td>
        <td class="${resultadoDia < 0 ? "neg" : "pos"}">${fmtMoney(resultadoDia)}</td>
        <td><button onclick="borrarPosicion('${cli.id}','${key}',${i})">✕</button></td>
      </tr>
    `;
  }).join("");
  el.innerHTML = `
    <table>
      <thead>
        <tr><th>Ticker</th><th>Nombre</th><th>Cantidad</th><th>Precio</th><th>Importe</th><th>Costo</th>
        <th>%Var</th><th>Resultados</th><th>Precio ant.</th><th>%Var día</th><th>Resultado día</th><th></th></tr>
      </thead>
      <tbody>${filasHtml}</tbody>
      <tfoot>
        <tr><td colspan="4">Subtotal</td><td>${fmtMoney(totalImporte)}</td><td></td><td></td>
        <td class="${totalResultados < 0 ? "neg" : "pos"}">${fmtMoney(totalResultados)}</td><td></td><td></td>
        <td class="${totalResultadoDia < 0 ? "neg" : "pos"}">${fmtMoney(totalResultadoDia)}</td><td></td></tr>
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

function renderGanancias(cli) {
  const el = document.getElementById("ganancias");
  const filas = (cli.ganancias || []).map((g, i) => `
    <tr>
      <td><input value="${g.fecha}" onchange="editarGanancia('${cli.id}',${i},'fecha',this.value)"></td>
      <td><input value="${g.ticker}" onchange="editarGanancia('${cli.id}',${i},'ticker',this.value)"></td>
      <td><input type="number" value="${g.monto}" step="any" onchange="editarGanancia('${cli.id}',${i},'monto',this.value)"></td>
      <td><input value="${g.nota || ""}" onchange="editarGanancia('${cli.id}',${i},'nota',this.value)"></td>
      <td><button onclick="borrarGanancia('${cli.id}',${i})">✕</button></td>
    </tr>
  `).join("");
  const total = (cli.ganancias || []).reduce((a, g) => a + (parseFloat(g.monto) || 0), 0);
  el.innerHTML = `
    <table>
      <thead><tr><th>Fecha</th><th>Especie</th><th>Monto realizado ($)</th><th>Nota</th><th></th></tr></thead>
      <tbody>${filas}</tbody>
      <tfoot><tr><td colspan="2">Total realizado</td><td class="${total < 0 ? "neg" : "pos"}">${fmtMoney(total)}</td><td colspan="2"></td></tr></tfoot>
    </table>
    <button onclick="agregarGanancia('${cli.id}')">+ Agregar ganancia/pérdida realizada</button>
  `;
}

function editarGanancia(id, idx, campo, valor) {
  const cli = getClientes().find(c => c.id === id);
  if (!cli.ganancias) cli.ganancias = [];
  cli.ganancias[idx][campo] = campo === "monto" ? (parseFloat(valor.toString().replace(",", ".")) || 0) : valor;
  const overrides = loadOverrides();
  if (!overrides[id]) overrides[id] = {};
  overrides[id].ganancias = cli.ganancias;
  saveOverrides(overrides);
  render();
}

function agregarGanancia(id) {
  const cli = getClientes().find(c => c.id === id);
  if (!cli.ganancias) cli.ganancias = [];
  cli.ganancias.push({ fecha: todayStr(), ticker: "", monto: 0, nota: "" });
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

function renderVistaGeneral(clientes) {
  const el = document.getElementById("vistaGeneral");
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
    <table>
      <thead><tr><th>Comitente</th><th>Nombre</th><th>Total portafolio</th><th>Cta cte $</th><th>Cta cte USD</th><th>Estado</th></tr></thead>
      <tbody>${filas}</tbody>
    </table>
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
    document.getElementById("app").style.display = "block";
    init();
  }
}

function doLogin() {
  const pass = document.getElementById("passInput").value;
  if (pass === PASSWORD) {
    sessionStorage.setItem("logged_in", "1");
    document.getElementById("login").style.display = "none";
    document.getElementById("app").style.display = "block";
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
  const sel = document.getElementById("comitenteSelect");
  sel.addEventListener("change", render);
  document.getElementById("btnExportar").addEventListener("click", exportarEstado);
  document.getElementById("btnLogout").addEventListener("click", logout);
  document.getElementById("fecha").textContent = new Date().toLocaleDateString("es-AR", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  render();
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btnLogin").addEventListener("click", doLogin);
  document.getElementById("passInput").addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
  checkLogin();
});
