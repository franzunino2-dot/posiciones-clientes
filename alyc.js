// Panel de la ALyC (usuario "general"): visión de toda la cartera de Equanima — productores,
// comitentes y AUM — con el mismo selector de moneda que la vista del comitente.

let monedaAlyc = "ARS";
try { monedaAlyc = sessionStorage.getItem("monedaAlyc") || "ARS"; } catch (e) { /* sin storage */ }

// Mail de cada productor en Gallo (con ese mail entra). Se pide una vez al abrir el panel.
let PRODUCTORES_GALLO = null;
async function cargarProductoresAlyc() {
  if (PRODUCTORES_GALLO || !sesion || !sesion.token) return;
  try {
    const r = await fetch("/api/productores", { headers: { Authorization: "Bearer " + sesion.token } });
    const j = await r.json();
    if (j.ok) { PRODUCTORES_GALLO = {}; j.productores.forEach(p => { PRODUCTORES_GALLO[p.codigo] = p; }); render(); }
  } catch (e) { /* sin dato de acceso */ }
}

function setMonedaAlyc(m) {
  monedaAlyc = m;
  try { sessionStorage.setItem("monedaAlyc", m); } catch (e) { /* sin storage */ }
  render();
}

// Valor de un comitente en la moneda elegida: cada cuenta se pasa con su propio tipo de cambio
// de Gallo (MEP); el CCL lo ajusta por la brecha CCL/MEP del día.
function valorAlyc(c, ars) {
  if (monedaAlyc === "ARS" || !c.tc) return ars;
  if (monedaAlyc === "MEP") return ars / c.tc;
  const bolsa = MERCADO.dolares.find(d => d.casa === "bolsa");
  const ccl = MERCADO.dolares.find(d => d.casa === "contadoconliqui");
  const brecha = bolsa && ccl && bolsa.venta ? ccl.venta / bolsa.venta : 1;
  return ars / (c.tc * brecha);
}

function fmtAlyc(v) {
  return (monedaAlyc === "ARS" ? "$ " : "USD ") + fmtMoney(v, monedaAlyc === "ARS" ? 0 : 0);
}

function filtrarAlyc(txt) {
  const q = txt.trim().toLowerCase();
  document.querySelectorAll("#tablaAlycCom tbody tr").forEach(tr => { tr.style.display = !q || tr.dataset.q.includes(q) ? "" : "none"; });
}

function verComitenteAlyc(id) {
  document.getElementById("comitenteSelect").value = id;
  irAVista("dashboardCliente");
}

function accesoProductor(cod) {
  if (!PRODUCTORES_GALLO) return '<span class="muted">…</span>';
  const g = PRODUCTORES_GALLO[cod];
  const mails = g ? [...new Set([g.email, ...g.extra].filter(Boolean))] : [];
  return mails.length ? mails.map(esc).join("<br>") : '<span class="neg">Sin mail en Gallo</span>';
}

function renderAlyc(clientes) {
  cargarProductoresAlyc();
  const el = document.getElementById("view-alyc");
  const total = clientes.reduce((a, c) => a + valorAlyc(c, c.totalPortfolio || 0), 0);
  const conFinanciacion = clientes.filter(c => (c.pesos.cuentaCorriente || 0) < 0 || (c.dolares.cuentaCorrienteUSD || 0) < 0).length;

  const porProductor = {};
  clientes.forEach(c => {
    const k = c.managerId || "";
    const p = porProductor[k] || (porProductor[k] = { cod: k, nombre: c.productor || "Sin asignar", n: 0, aum: 0 });
    p.n++; p.aum += valorAlyc(c, c.totalPortfolio || 0);
  });
  const productores = Object.values(porProductor).sort((a, b) => b.aum - a.aum);

  const filasProd = productores.map(p => `
    <tr><td><b>${esc(p.nombre)}</b></td><td>${p.n}</td><td>${fmtAlyc(p.aum)}</td><td>${total ? fmtPct(p.aum / total * 100) : "-"}</td><td>${accesoProductor(p.cod)}</td></tr>`).join("");
  const filasCom = clientes.slice().sort((a, b) => (b.totalPortfolio || 0) - (a.totalPortfolio || 0)).map(c => `
    <tr data-q="${esc((c.id + " " + c.nombre + " " + (c.productor || "")).toLowerCase())}">
      <td>${esc(c.id)} · ${esc(titulo(c.nombre))}</td><td class="muted">${esc(c.productor || "")}</td>
      <td>${fmtAlyc(valorAlyc(c, c.totalPortfolio || 0))}</td>
      <td><button onclick="verComitenteAlyc('${esc(c.id)}')">Cartera</button> <button onclick="abrirVistaCliente('${esc(c.id)}', true)">Ver como cliente</button></td>
    </tr>`).join("");

  const botones = [["ARS", "ARS"], ["MEP", "USD MEP"], ["CCL", "USD CCL"]].map(([k, n]) => `<button class="periodo-btn ${monedaAlyc === k ? "active" : ""}" onclick="setMonedaAlyc('${k}')">${n}</button>`).join("");

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
      <h1 class="hero-title" style="margin-bottom:6px">Hola, ${esc(sesion.email)}. <span class="soft">Panel de la <em>ALyC.</em></span></h1>
      <div class="moneda-toggle">${botones}</div>
    </div>
    <div class="stats-row">
      <div class="stat-card"><span class="stat-label">Productores</span><span class="stat-value">${productores.length}</span><span class="stat-sub">con comitentes asignados</span></div>
      <div class="stat-card"><span class="stat-label">Comitentes</span><span class="stat-value">${clientes.length}</span><span class="stat-sub">${clientes.reduce((a, c) => a + (c.detallePesos || []).length + (c.detalleDolares || []).length, 0)} tenencias</span></div>
      <div class="stat-card"><span class="stat-label">AUM total</span><span class="stat-value">${fmtAlyc(total)}</span><span class="stat-sub">Valor de portafolio, neto de financiación</span></div>
      <div class="stat-card ${conFinanciacion ? "warn" : ""}"><span class="stat-label">Con financiación</span><span class="stat-value">${conFinanciacion}</span><span class="stat-sub">Saldo de cuenta corriente negativo</span></div>
    </div>
    <div class="two-col">
      <div class="panel" style="flex:1">
        <h3>Productores</h3>
        <div class="table-wrap"><table><thead><tr><th>Productor</th><th>Comitentes</th><th>AUM</th><th>% del total</th><th>Acceso (mail en Gallo)</th></tr></thead><tbody>${filasProd}</tbody></table></div>
      </div>
      <div class="panel" style="flex:1.5">
        <h3>Comitentes</h3>
        <input type="search" placeholder="Buscar comitente o productor…" oninput="filtrarAlyc(this.value)" style="width:100%;margin-bottom:10px">
        <div class="table-wrap"><table id="tablaAlycCom"><thead><tr><th>Comitente</th><th>Productor</th><th>Valor portafolio</th><th></th></tr></thead><tbody>${filasCom}</tbody></table></div>
      </div>
    </div>`;
}
