// Inicio del manager: resumen de todos sus clientes y un buscador rápido por ticker o por comitente
// que dice quién tiene qué. Todo sale de la posición que ya trae la plataforma de Gallo.

let monedaInicio = "ARS";
try { monedaInicio = sessionStorage.getItem("monedaInicio") || "ARS"; } catch (e) { /* sin storage */ }
let inicioQ = "";
let inicioAbierto = null;               // comitente abierto en el panel de detalle
let inicioOrden = { k: "valor", dir: -1 };
let INICIO = { filas: [], indice: {} }; // datos del último render, los usa el buscador

const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function setMonedaInicio(m) {
  monedaInicio = m;
  try { sessionStorage.setItem("monedaInicio", m); } catch (e) { /* sin storage */ }
  render();
  if (inicioQ) inicioBuscar(inicioQ, true);
}

// Todo se calcula en pesos y se pasa a la moneda elegida con el tipo de cambio de cada cuenta.
function convInicio(c, ars) {
  if (monedaInicio === "ARS" || !c.tc) return ars;
  if (monedaInicio === "MEP") return ars / c.tc;
  const bolsa = MERCADO.dolares.find(d => d.casa === "bolsa");
  const ccl = MERCADO.dolares.find(d => d.casa === "contadoconliqui");
  const brecha = bolsa && ccl && bolsa.venta ? ccl.venta / bolsa.venta : 1;
  return ars / (c.tc * brecha);
}
const fmtInicio = (v, dec = 0) => (v < 0 ? "-" : "") + (monedaInicio === "ARS" ? "$ " : "USD ") + fmtMoney(Math.abs(v), dec);
const claseRes = v => (v < 0 ? "neg" : "pos");

function datosInicio(clientes) {
  const indice = {};
  const filas = clientes.map(c => {
    const pos = posicionesCliente(c);
    const res = resultadosCliente(c);
    pos.forEach(p => {
      const t = p.t;
      const e = indice[t] || (indice[t] = { ticker: t, nombre: p.n, holders: [], valorArs: 0, cantidad: 0 });
      e.holders.push({ c, p });
      e.valorArs += p.ars; e.cantidad += p.c;
    });
    return {
      c, pos, res,
      valor: c.totalPortfolio || 0,
      saldoARS: c.pesos.cuentaCorriente || 0, saldoUSD: c.dolares.cuentaCorrienteUSD || 0,
      financiado: (c.pesos.cuentaCorriente || 0) < 0 || (c.dolares.cuentaCorrienteUSD || 0) < 0,
    };
  });
  return { filas, indice };
}

function renderInicioManager(clientes) {
  const el = document.getElementById("view-inicio");
  INICIO = datosInicio(clientes);
  const { filas, indice } = INICIO;
  const aum = filas.reduce((a, f) => a + convInicio(f.c, f.valor), 0);
  const nPos = filas.reduce((a, f) => a + f.pos.length, 0);
  const financiados = filas.filter(f => f.financiado);
  const noReal = filas.reduce((a, f) => a + convInicio(f.c, f.res.noReal), 0);
  const costoAb = filas.reduce((a, f) => a + convInicio(f.c, f.res.costoAbierto), 0);
  const tenenciasTot = filas.reduce((a, f) => a + f.pos.reduce((s, p) => s + convInicio(f.c, p.ars), 0), 0);
  const top = Object.values(indice).sort((a, b) => b.valorArs - a.valorArs).slice(0, 8);
  const totalArs = filas.reduce((a, f) => a + f.pos.reduce((s, p) => s + p.ars, 0), 0);
  const nombre = (sesion && sesion.perfilNombre) || (filas[0] && filas[0].c.productor) || "";
  const botones = [["ARS", "ARS"], ["MEP", "USD MEP"], ["CCL", "USD CCL"]].map(([k, n]) => `<button class="periodo-btn ${monedaInicio === k ? "active" : ""}" onclick="setMonedaInicio('${k}')">${n}</button>`).join("");

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
      <h1 class="hero-title" style="margin-bottom:6px">Tus clientes${nombre ? `, ${esc(titulo(nombre).split(" ")[0])}` : ""}. <span class="soft">Todo en <em>un lugar.</em></span></h1>
      <div class="moneda-toggle">${botones}</div>
    </div>

    <div class="buscador-inicio">
      <input id="inicioBuscar" type="search" autocomplete="off" placeholder="Buscar por ticker (GGAL, AL30…) o por comitente (número o nombre) y ver qué tiene…" value="${esc(inicioQ)}" oninput="inicioBuscar(this.value)">
    </div>
    <div id="inicioResultados"></div>

    <div class="stats-row">
      <div class="stat-card clic" onclick="inicioIrTabla()"><span class="stat-label">Clientes</span><span class="stat-value">${filas.length}</span><span class="stat-sub">${nPos} posiciones abiertas</span></div>
      <div class="stat-card clic" onclick="inicioIrTabla()"><span class="stat-label">Cartera total</span><span class="stat-value">${fmtInicio(aum)}</span><span class="stat-sub">Valor de portafolio, neto de financiación</span></div>
      <div class="stat-card"><span class="stat-label">Resultado no realizado</span><span class="stat-value ${claseRes(noReal)}">${noReal > 0 ? "+" : ""}${fmtInicio(noReal)}</span><span class="stat-sub">${costoAb ? (noReal > 0 ? "+" : "") + fmtPct(noReal / costoAb * 100) + " sobre el costo" : "Sin costo informado"}</span></div>
      <div class="stat-card clic ${financiados.length ? "warn" : ""}" onclick="inicioFiltrarFinanciados()"><span class="stat-label">Con financiación</span><span class="stat-value">${financiados.length}</span><span class="stat-sub">Saldo de cuenta corriente negativo</span></div>
    </div>

    <div class="two-col">
      <div class="panel" style="flex:1">
        <h3>Lo que más tienen tus clientes</h3>
        ${top.length ? top.map((e, i) => `
          <div class="dist-row clic" onclick="inicioTicker('${esc(e.ticker)}')" title="Ver quién lo tiene">
            <span class="dist-label" style="width:80px"><b>${esc(e.ticker)}</b></span>
            <div class="dist-bar-wrap"><div class="dist-bar" style="width:${totalArs ? e.valorArs / totalArs * 100 : 0}%;background:${PALETA[i % PALETA.length]}"></div></div>
            <span class="dist-pct" style="width:120px">${e.holders.length} cli. · ${totalArs ? fmtPct(e.valorArs / totalArs * 100) : "-"}</span>
          </div>`).join("") : `<p class="muted">Sin posiciones.</p>`}
        <p class="muted" style="font-size:11px;margin:10px 0 0">Tocá un ticker para ver quiénes lo tienen. % sobre el total de tenencias (${fmtInicio(tenenciasTot)}).</p>
      </div>
      <div class="panel" style="flex:1">
        <h3>Atención</h3>
        ${financiados.length
          ? `<p class="muted" style="margin:0 0 8px;font-size:13px">Clientes con saldo negativo en pesos o dólares (caución tomada):</p>` + financiados.slice().sort((a, b) => a.saldoARS - b.saldoARS).slice(0, 6).map(f => `
            <div class="row clic" onclick="inicioAbrir('${esc(f.c.id)}')"><span>${esc(f.c.id)} · ${esc(titulo(f.c.nombre))}</span><b class="neg">${f.saldoARS < 0 ? "$ " + fmtMoney(f.saldoARS, 0) : ""}${f.saldoARS < 0 && f.saldoUSD < 0 ? " · " : ""}${f.saldoUSD < 0 ? "USD " + fmtMoney(f.saldoUSD, 0) : ""}</b></div>`).join("")
          : `<p class="muted">Ningún cliente con financiación.</p>`}
      </div>
    </div>

    <div id="inicioDetalle"></div>

    <div class="panel" id="inicioTabla">
      <h3>Todos tus clientes <span class="muted" style="font-weight:400;font-size:12px" id="inicioFiltroTxt"></span></h3>
      <div class="table-wrap"><table>
        <thead><tr>
          ${[["id", "Comitente"], ["nombre", "Nombre"], ["valor", "Valor portafolio"], ["pos", "Posiciones"], ["res", "Resultado"], ["top", "Mayor tenencia"], ["saldo", "Saldo"]].map(([k, n]) => `<th class="ord" onclick="inicioOrdenar('${k}')">${n}${inicioOrden.k === k ? (inicioOrden.dir < 0 ? " ▾" : " ▴") : ""}</th>`).join("")}
        </tr></thead>
        <tbody id="inicioFilas"></tbody>
      </table></div>
    </div>`;
  pintarFilasInicio();
  if (inicioQ) inicioBuscar(inicioQ, true);
  if (inicioAbierto) inicioAbrir(inicioAbierto, true);
}

let inicioSoloFinanciados = false;
function pintarFilasInicio() {
  const tb = document.getElementById("inicioFilas");
  if (!tb) return;
  const v = f => ({
    id: Number(f.c.id), nombre: norm(f.c.nombre), valor: convInicio(f.c, f.valor), pos: f.pos.length,
    res: f.res.noRealPct == null ? -1e9 : f.res.noRealPct, top: f.pos[0] ? f.pos[0].ars / (f.pos.reduce((s, p) => s + p.ars, 0) || 1) : 0, saldo: f.saldoARS,
  });
  let filas = INICIO.filas.filter(f => !inicioSoloFinanciados || f.financiado);
  const k = inicioOrden.k;
  filas = filas.slice().sort((a, b) => { const x = v(a)[k], y = v(b)[k]; return (x < y ? -1 : x > y ? 1 : 0) * inicioOrden.dir; });
  document.getElementById("inicioFiltroTxt").innerHTML = inicioSoloFinanciados ? `· solo con financiación <button onclick="inicioFiltrarFinanciados()">Ver todos</button>` : `· ${filas.length}`;
  tb.innerHTML = filas.map(f => {
    const tot = f.pos.reduce((s, p) => s + p.ars, 0) || 1;
    const t = f.pos[0];
    return `<tr class="clic" onclick="inicioAbrir('${esc(f.c.id)}')">
      <td>${esc(f.c.id)}</td><td>${esc(titulo(f.c.nombre))}</td>
      <td><b>${fmtInicio(convInicio(f.c, f.valor))}</b></td><td>${f.pos.length}</td>
      <td class="${f.res.noRealPct == null ? "" : claseRes(f.res.noRealPct)}">${f.res.noRealPct == null ? "—" : (f.res.noRealPct > 0 ? "+" : "") + fmtPct(f.res.noRealPct)}</td>
      <td>${t ? `<b>${esc(t.t)}</b> <span class="muted">${fmtPct(t.ars / tot * 100)}</span>` : "—"}</td>
      <td class="${f.financiado ? "neg" : ""}">${f.saldoARS ? "$ " + fmtMoney(f.saldoARS, 0) : ""}${f.saldoUSD ? (f.saldoARS ? " · " : "") + "USD " + fmtMoney(f.saldoUSD, 0) : ""}${!f.saldoARS && !f.saldoUSD ? "—" : ""}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="7" class="muted">No hay clientes.</td></tr>`;
}

function inicioOrdenar(k) {
  inicioOrden = { k, dir: inicioOrden.k === k ? -inicioOrden.dir : (k === "id" || k === "nombre" ? 1 : -1) };
  render();
}
function inicioIrTabla() { const t = document.getElementById("inicioTabla"); if (t) t.scrollIntoView({ behavior: "smooth", block: "start" }); }
function inicioFiltrarFinanciados() { inicioSoloFinanciados = !inicioSoloFinanciados; pintarFilasInicio(); inicioIrTabla(); }

// ---------- Buscador ----------

function inicioTicker(t) {
  inicioQ = t;
  const inp = document.getElementById("inicioBuscar");
  if (inp) { inp.value = t; inp.focus(); }
  inicioBuscar(t);
  const r = document.getElementById("inicioResultados");
  if (r) r.scrollIntoView({ behavior: "smooth", block: "start" });
}

function tablaTenencias(f) {
  const tot = f.pos.reduce((s, p) => s + p.ars, 0) || 1;
  return `<div class="table-wrap"><table>
    <thead><tr><th>Activo</th><th>Cantidad</th><th>Precio</th><th>Valor</th><th>% de tenencias</th><th>Resultado</th></tr></thead>
    <tbody>${f.pos.map(p => `<tr class="clic" onclick="inicioTicker('${esc(p.t)}')">
      <td><b>${esc(p.t)}</b><br><span class="muted" style="font-size:11px">${esc(titulo(p.n))}</span></td>
      <td>${fmtMoney(p.c, 0)}</td><td>${p.mon === "USD" ? "USD " : "$ "}${fmtMoney(p.p, 2)}</td>
      <td><b>${fmtInicio(convInicio(f.c, p.ars))}</b></td><td>${fmtPct(p.ars / tot * 100)}</td>
      <td class="${p.co ? claseRes(p.varPct) : ""}">${p.co ? (p.varPct > 0 ? "+" : "") + fmtPct(p.varPct) : "—"}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">Sin posiciones abiertas.</td></tr>`}</tbody>
  </table></div>`;
}

function panelCliente(f) {
  const r = f.res;
  return `
    <div class="panel resultado-busq">
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:10px">
        <div><h3 style="margin:0">${esc(f.c.id)} · ${esc(titulo(f.c.nombre))}</h3>
          <span class="muted" style="font-size:12px">${esc(f.c.email || "Sin mail en Gallo")}${f.c.productor ? " · " + esc(titulo(f.c.productor)) : ""}</span></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start">
          <button class="btn-primary" style="padding:8px 16px" onclick="inicioAbrirCartera('${esc(f.c.id)}')">Abrir cartera →</button>
          <button onclick="abrirVistaCliente('${esc(f.c.id)}', true)">Ver como cliente</button>
          <button onclick="inicioCerrarDetalle()">✕</button>
        </div>
      </div>
      <div class="stats-row" style="margin-bottom:10px">
        <div class="stat-card"><span class="stat-label">Valor portafolio</span><span class="stat-value">${fmtInicio(convInicio(f.c, f.valor))}</span></div>
        <div class="stat-card"><span class="stat-label">Saldo en pesos</span><span class="stat-value ${f.saldoARS < 0 ? "neg" : ""}">$ ${fmtMoney(f.saldoARS, 0)}</span></div>
        <div class="stat-card"><span class="stat-label">Saldo en dólares</span><span class="stat-value ${f.saldoUSD < 0 ? "neg" : ""}">USD ${fmtMoney(f.saldoUSD, 0)}</span></div>
        <div class="stat-card"><span class="stat-label">No realizado</span><span class="stat-value ${claseRes(r.noReal)}">${r.noReal > 0 ? "+" : ""}${fmtInicio(convInicio(f.c, r.noReal))}</span><span class="stat-sub">${r.noRealPct == null ? "" : (r.noRealPct > 0 ? "+" : "") + fmtPct(r.noRealPct)}</span></div>
        <div class="stat-card"><span class="stat-label">Realizado (historial)</span><span class="stat-value ${r.tieneHistorial ? claseRes(r.real) : ""}">${r.tieneHistorial ? (r.real > 0 ? "+" : "") + fmtInicio(convInicio(f.c, r.real)) : "—"}</span><span class="stat-sub">${r.tieneHistorial ? r.nOps + " operaciones" : "Sin historial"}</span></div>
      </div>
      ${tablaTenencias(f)}
    </div>`;
}

function inicioAbrir(id, sinScroll) {
  inicioAbierto = id;
  const f = INICIO.filas.find(x => x.c.id === id);
  const box = document.getElementById("inicioDetalle");
  if (!f || !box) return;
  box.innerHTML = panelCliente(f);
  if (!sinScroll) box.scrollIntoView({ behavior: "smooth", block: "start" });
}
function inicioCerrarDetalle() { inicioAbierto = null; const b = document.getElementById("inicioDetalle"); if (b) b.innerHTML = ""; }
function inicioAbrirCartera(id) {
  const sel = document.getElementById("comitenteSelect");
  if (sel) sel.value = id;
  irAVista("dashboardCliente");
}

function inicioBuscar(txt, silencioso) {
  inicioQ = txt;
  const out = document.getElementById("inicioResultados");
  if (!out) return;
  const q = norm(txt).trim();
  if (!q) { out.innerHTML = ""; return; }
  const soloNumeros = /^\d+$/.test(q);

  const tickers = Object.values(INICIO.indice)
    .filter(e => norm(e.ticker).startsWith(q) || norm(e.nombre).includes(q))
    .sort((a, b) => ((norm(b.ticker) === q) - (norm(a.ticker) === q)) || b.valorArs - a.valorArs)
    .slice(0, 4);
  const clientes = INICIO.filas
    .filter(f => f.c.id.startsWith(q) || norm(f.c.nombre).includes(q) || norm(f.c.email || "").includes(q))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 12);

  const bloqueTickers = tickers.map(e => {
    const hs = e.holders.slice().sort((a, b) => b.p.ars - a.p.ars);
    const nominales = e.holders.every(h => h.p.factorUnidad === 0.01) ? "nominales" : "unidades";
    return `
      <div class="panel resultado-busq">
        <h3 style="margin:0 0 4px"><b>${esc(e.ticker)}</b> <span class="muted" style="font-weight:400">${esc(titulo(e.nombre))}</span></h3>
        <p class="muted" style="margin:0 0 10px;font-size:13px"><b>${e.holders.length}</b> ${e.holders.length === 1 ? "cliente lo tiene" : "clientes lo tienen"} · ${fmtMoney(e.cantidad, 0)} ${nominales} · ${fmtInicio(hs.reduce((s, h) => s + convInicio(h.c, h.p.ars), 0))}</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Comitente</th><th>Nombre</th><th>Cantidad</th><th>Valor</th><th>% de su cartera</th><th>Resultado</th></tr></thead>
          <tbody>${hs.slice(0, 50).map(h => {
            const f = INICIO.filas.find(x => x.c.id === h.c.id);
            const tot = f ? f.pos.reduce((s, p) => s + p.ars, 0) || 1 : 1;
            return `<tr class="clic" onclick="inicioAbrir('${esc(h.c.id)}')"><td>${esc(h.c.id)}</td><td>${esc(titulo(h.c.nombre))}</td><td>${fmtMoney(h.p.c, 0)}</td>
              <td><b>${fmtInicio(convInicio(h.c, h.p.ars))}</b></td><td>${fmtPct(h.p.ars / tot * 100)}</td>
              <td class="${h.p.co ? claseRes(h.p.varPct) : ""}">${h.p.co ? (h.p.varPct > 0 ? "+" : "") + fmtPct(h.p.varPct) : "—"}</td></tr>`;
          }).join("")}</tbody>
        </table></div>
        ${hs.length > 50 ? `<p class="muted" style="font-size:12px">Se muestran los 50 de mayor valor.</p>` : ""}
      </div>`;
  }).join("");

  const bloqueClientes = clientes.length ? (clientes.length === 1 && !tickers.length
    ? panelCliente(clientes[0])
    : `<div class="panel resultado-busq"><h3 style="margin:0 0 8px">Clientes</h3>${clientes.map(f => `
        <div class="row clic" onclick="inicioAbrir('${esc(f.c.id)}')">
          <span><b>${esc(f.c.id)}</b> · ${esc(titulo(f.c.nombre))}<br><span class="muted" style="font-size:12px">${f.pos.slice(0, 4).map(p => esc(p.t)).join(" · ") || "Sin posiciones"}</span></span>
          <b>${fmtInicio(convInicio(f.c, f.valor))}</b></div>`).join("")}</div>`) : "";

  out.innerHTML = (soloNumeros ? bloqueClientes + bloqueTickers : bloqueTickers + bloqueClientes)
    || `<div class="panel"><p class="muted" style="margin:0">No encontré ningún ticker ni comitente con “${esc(txt)}”.</p></div>`;
}
