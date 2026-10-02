// Importador de archivos "Activity" de Gallo (Excel con todas las operaciones de un comitente).
// Reconstruye las ganancias realizadas (costo promedio ponderado) y las contrasta con la tenencia actual.

const IMP_COMPRAS = ["CPRA", "COTR", "CPU$", "CPUC", "CRCN", "CBLO", "EJPC"];
const IMP_VENTAS = ["VTAS", "VTU$", "VTUC", "VRCM", "VRCN", "VBLO"];
const IMP_INGRESOS = ["DETR"]; // títulos que ingresan a la cuenta (ej. transferidos de otro broker), valuados al ingreso
const IMP_EGRESOS = ["RTTR"];  // títulos que salen de la cuenta, sin resultado

function impNum(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  const n = parseFloat(String(v).replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

function impFecha(v) {
  if (v instanceof Date) return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  if (typeof v === "number") return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const m = String(v || "").match(/^(\d+)\/(\d+)\/(\d{4})$/);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null; // formato m/d/aaaa del export
}

// Números y fechas tal como los muestra Gallo en pantalla: "1.074.108.000,00" y "22/04/25".
function impNumAR(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  const n = parseFloat(s.replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? null : n;
}
function impFechaAR(v) {
  const m = String(v || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  return m ? `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

// El "Excel" de Activity que baja Gallo es en realidad una página HTML guardada como .xls.
function leerActivityHTML(texto) {
  const doc = new DOMParser().parseFromString(texto, "text/html");
  const principal = doc.querySelector("table.table-consultas");
  const metaCeldas = [...doc.querySelectorAll("table")][0]?.querySelectorAll("td");
  if (!principal || !metaCeldas || metaCeldas.length < 2) throw new Error("No se encontró la tabla de movimientos en el archivo.");
  const celdas = r => [...r.children].map(c => c.textContent.trim());
  let filas = [...principal.querySelectorAll("tbody tr")].map(celdas).filter(r => impFechaAR(r[0]));
  const lista = filas.map(r => JSON.stringify(r));
  let repetido = false;
  if (filas.length % 2 === 0 && filas.length) {
    const h = filas.length / 2;
    if (lista.slice(0, h).join("|") === lista.slice(h).join("|")) { filas = filas.slice(0, h); repetido = true; }
  }
  return {
    comitente: metaCeldas[1].textContent.trim(), nombre: metaCeldas[0].textContent.trim(), repetido,
    filas: filas.map(r => ({
      fecha: impFechaAR(r[0]), comp: r[2], nro: impNumAR(r[3]) || 0, ticker: r[4],
      cant: impNumAR(r[5]), precio: impNumAR(r[6]), moneda: r[7], impPesos: impNumAR(r[8]), impMoneda: impNumAR(r[9]),
    })),
  };
}

function leerActivity(buffer) {
  const inicio = new TextDecoder("utf-8").decode(new Uint8Array(buffer).slice(0, 2000));
  if (/<(table|div|html)/i.test(inicio)) return leerActivityHTML(new TextDecoder("utf-8").decode(buffer));
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
  const iMeta = rows.findIndex(r => r[0] === "Usuario" && r[1] === "Comitente");
  const iHead = rows.findIndex(r => r[0] === "Fecha de Emisión");
  if (iMeta < 0 || iHead < 0) throw new Error("No parece un archivo Activity de Gallo (faltan las cabeceras Usuario/Comitente y Fecha de Emisión).");
  const meta = rows[iMeta + 1];
  let filas = rows.slice(iHead + 1).filter(r => impFecha(r[0]));
  // El reporte a veces viene repetido entero dos veces: si las dos mitades son idénticas, se usa una.
  let repetido = false;
  if (filas.length % 2 === 0 && filas.length > 0) {
    const h = filas.length / 2;
    if (JSON.stringify(filas.slice(0, h)) === JSON.stringify(filas.slice(h))) { filas = filas.slice(0, h); repetido = true; }
  }
  return {
    comitente: String(meta[1]).trim(), nombre: meta[0], repetido,
    filas: filas.map(r => ({
      fecha: impFecha(r[0]), comp: String(r[2] || "").trim(), nro: impNum(r[3]) || 0, ticker: String(r[4] || "").trim(),
      cant: impNum(r[5]), precio: impNum(r[6]), moneda: String(r[7] || "").trim(), impPesos: impNum(r[8]), impMoneda: impNum(r[9]),
    })),
  };
}

function reconstruirActivity(filas) {
  const conocidos = [...IMP_COMPRAS, ...IMP_VENTAS, ...IMP_INGRESOS, ...IMP_EGRESOS];
  const ignorados = {};
  const ops = [];
  filas.forEach(f => {
    if (!conocidos.includes(f.comp) || !f.ticker) { ignorados[f.comp] = (ignorados[f.comp] || 0) + 1; return; }
    if (!f.cant) return; // filas sin cantidad (ej. DETR en blanco)
    ops.push(f);
  });
  // Mismo día: el export lista de más nuevo a más viejo, así que se ordena por N° de comprobante ascendente.
  ops.sort((a, b) => a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.nro - b.nro);

  const pools = {};
  const sucios = {}, mixtos = [], ganancias = [];
  const pool = (t) => pools[t] || (pools[t] = { ARS: { q: 0, c: 0 }, USD: { q: 0, c: 0 } });
  ops.forEach(f => {
    const ccy = f.moneda === "PESOS" ? "ARS" : "USD";
    const imp = Math.abs(ccy === "ARS" ? (f.impPesos ?? 0) : (f.impMoneda ?? 0));
    const q = Math.abs(f.cant);
    const p = pool(f.ticker);
    if (IMP_COMPRAS.includes(f.comp) || IMP_INGRESOS.includes(f.comp)) { p[ccy].q += q; p[ccy].c += imp; return; }
    const otra = ccy === "ARS" ? "USD" : "ARS";
    const total = p.ARS.q + p.USD.q;
    if (total + 1e-6 < q) { sucios[f.ticker] = `vendió/sacó ${q} el ${f.fecha} y solo había ${total} (tenencia previa no registrada)`; p.ARS = { q: 0, c: 0 }; p.USD = { q: 0, c: 0 }; return; }
    const propio = p[ccy];
    const deEsta = Math.min(q, propio.q), deOtra = q - deEsta;
    const avg = propio.q ? propio.c / propio.q : 0;
    const esVenta = IMP_VENTAS.includes(f.comp);
    if (esVenta && deOtra < 1e-6) ganancias.push({ fecha: f.fecha, ticker: f.ticker, cantidad: q, costo: Math.round(avg * q * 100) / 100, ventaRescate: Math.round(imp * 100) / 100, moneda: ccy });
    else if (esVenta) mixtos.push({ fecha: f.fecha, ticker: f.ticker, cantidad: q, motivo: `se compró en ${otra} y se vendió en ${ccy}` });
    propio.c -= avg * deEsta; propio.q -= deEsta;
    if (deOtra > 1e-6) { const po = p[otra]; const a2 = po.q ? po.c / po.q : 0; po.c -= a2 * deOtra; po.q -= deOtra; }
  });

  const posiciones = {};
  Object.entries(pools).forEach(([t, p]) => { const q = p.ARS.q + p.USD.q; if (q > 1e-6) posiciones[t] = q; });
  return {
    ganancias: ganancias.filter(g => !sucios[g.ticker]),
    descartadasPorSucio: ganancias.filter(g => sucios[g.ticker]).length,
    sucios, mixtos, ignorados, posiciones, operaciones: ops.length,
  };
}

// ---------- Pantalla "Cargar" ----------

let ultimaCarga = null; // { lectura, resultado }

function renderCargar() {
  const el = document.getElementById("view-cargar");
  el.innerHTML = `
    <h1 class="hero-title">Cargar. <span class="soft">Traé la cartera <em>como la tengas.</em></span></h1>
    <div class="hero-card">
      <div>
        <span class="pill">Archivo Activity de Gallo</span>
        <h2 class="hero-big" style="border:0;padding:0">Subí el Excel de operaciones <em>del comitente.</em></h2>
        <p class="hero-sub">Leemos todas las operaciones, reconstruimos las ganancias realizadas y las contrastamos con la tenencia que informa Gallo.</p>
        <input type="file" id="archivoActivity" accept=".xls,.xlsx" style="display:none">
        <button class="btn-primary" onclick="document.getElementById('archivoActivity').click()">Elegir archivo →</button>
        <div class="hero-chips"><span>Se procesa en tu navegador</span><span>No se sube a ningún servidor</span></div>
      </div>
      <div class="mini-grid">
        <div class="mini" style="grid-column:span 2"><span class="stat-label">Formato que se lee hoy</span><b>Activity (.xls)</b><span class="stat-sub">Gallo → comitente → Activity, con Fecha Desde y Fecha Hasta.</span></div>
        <div class="mini"><span class="stat-label">Qué hace</span><b>Ganancias realizadas</b><span class="stat-sub">Costo promedio ponderado</span></div>
        <div class="mini"><span class="stat-label">Qué verifica</span><b>Tenencia actual</b><span class="stat-sub">Contra Gallo en vivo</span></div>
      </div>
    </div>
    <div id="resultadoCarga"></div>`;
  document.getElementById("archivoActivity").addEventListener("change", e => procesarArchivo(e.target.files[0]));
  if (ultimaCarga) mostrarResultadoCarga();
}

async function procesarArchivo(file) {
  const out = document.getElementById("resultadoCarga");
  if (!file) return;
  out.innerHTML = `<div class="panel muted">Leyendo ${file.name}…</div>`;
  try {
    const lectura = leerActivity(await file.arrayBuffer());
    ultimaCarga = { lectura, resultado: reconstruirActivity(lectura.filas), archivo: file.name };
    mostrarResultadoCarga();
  } catch (e) {
    out.innerHTML = `<div class="panel alerta">No se pudo leer el archivo: ${e.message}</div>`;
  }
}

function mostrarResultadoCarga() {
  const out = document.getElementById("resultadoCarga");
  const { lectura, resultado, archivo } = ultimaCarga;
  const cli = getClientes().find(c => c.id === lectura.comitente);
  const fechas = lectura.filas.map(f => f.fecha).sort();
  const actuales = {};
  if (cli) [...(cli.detallePesos || []), ...(cli.detalleDolares || [])].forEach(p => { actuales[p.t] = (actuales[p.t] || 0) + p.c; });
  const tickers = [...new Set([...Object.keys(resultado.posiciones), ...Object.keys(actuales)])].sort();
  const filasVer = tickers.map(t => {
    const rec = resultado.posiciones[t] || 0, vivo = actuales[t] || 0;
    const ok = Math.abs(rec - vivo) < 1;
    return `<tr><td>${t}</td><td>${fmtMoney(rec, 0)}</td><td>${cli ? fmtMoney(vivo, 0) : "-"}</td><td class="${ok ? "pos" : "neg"}">${ok ? "Coincide" : "Difiere"}</td></tr>`;
  }).join("");
  const pnlARS = resultado.ganancias.filter(g => g.moneda === "ARS").reduce((a, g) => a + g.ventaRescate - g.costo, 0);
  const pnlUSD = resultado.ganancias.filter(g => g.moneda === "USD").reduce((a, g) => a + g.ventaRescate - g.costo, 0);
  const sucios = Object.entries(resultado.sucios);
  const actualesCargadas = cli ? (cli.ganancias || []).length : 0;

  out.innerHTML = `
    <div class="stats-row">
      <div class="stat-card"><span class="stat-label">Comitente</span><span class="stat-value">${lectura.comitente}</span><span class="stat-sub">${titulo(lectura.nombre)}${cli ? "" : " — no está entre tus comitentes"}</span></div>
      <div class="stat-card"><span class="stat-label">Período</span><span class="stat-value" style="font-size:18px">${fechas[0]} → ${fechas[fechas.length - 1]}</span><span class="stat-sub">${lectura.filas.length} movimientos${lectura.repetido ? " (el reporte venía repetido, se usó una copia)" : ""}</span></div>
      <div class="stat-card"><span class="stat-label">Ganancias realizadas</span><span class="stat-value">${resultado.ganancias.length}</span><span class="stat-sub">$ ${fmtMoney(pnlARS, 0)} · USD ${fmtMoney(pnlUSD, 0)}</span></div>
      <div class="stat-card ${sucios.length || resultado.mixtos.length ? "warn" : ""}"><span class="stat-label">Para revisar</span><span class="stat-value">${sucios.length + resultado.mixtos.length}</span><span class="stat-sub">No se cargan</span></div>
    </div>
    <div class="panel">
      <h3>Qué se va a cargar</h3>
      <p class="muted">${resultado.operaciones} operaciones de compra/venta/ingreso/egreso de títulos. ${cli ? `Hoy ${lectura.comitente} tiene ${actualesCargadas} ganancias cargadas; se reemplazan por las ${resultado.ganancias.length} del archivo.` : "Entrá con un usuario que tenga acceso a este comitente para cargarlo."}</p>
      ${cli && esAdmin() ? `<button class="btn-primary" onclick="confirmarCarga()">Cargar en ${lectura.comitente} →</button>` : ""}
      <div id="msgCarga" class="muted" style="margin-top:10px"></div>
    </div>
    <div class="two-col">
      <div class="panel"><h3>Verificación contra Gallo</h3>
        <p class="muted" style="font-size:12px">Cantidad que sale de reconstruir el archivo vs. la tenencia actual que informa Gallo.</p>
        <div class="table-wrap"><table><thead><tr><th>Especie</th><th>Según el archivo</th><th>Según Gallo</th><th></th></tr></thead><tbody>${filasVer || `<tr><td colspan="4" class="muted">Sin posiciones</td></tr>`}</tbody></table></div>
      </div>
      <div class="panel"><h3>Para revisar</h3>
        ${sucios.length ? sucios.map(([t, m]) => `<p><b>${t}</b> <span class="muted">${m}. Sus ventas no se cargan.</span></p>`).join("") : ""}
        ${resultado.mixtos.length ? `<p class="muted">${resultado.mixtos.length} ventas de especies compradas en una moneda y vendidas en otra (ej. AL30 comprado en dólares y vendido en pesos): no se calcula el resultado porque falta el tipo de cambio de la operación.</p>` : ""}
        ${!sucios.length && !resultado.mixtos.length ? `<p class="muted">Nada para revisar.</p>` : ""}
        <p class="muted" style="font-size:12px;margin-top:10px">Operaciones que no se tienen en cuenta (cauciones, futuros, opciones, dividendos): ${Object.entries(resultado.ignorados).map(([k, v]) => `${k} ${v}`).join(" · ") || "ninguna"}.</p>
      </div>
    </div>`;
}

async function confirmarCarga() {
  const { lectura, resultado, archivo } = ultimaCarga;
  const id = lectura.comitente;
  const msg = document.getElementById("msgCarga");
  if (sesion && sesion.token) {
    // Modo en vivo: se guarda en el servidor, para que lo vea quien corresponda y no dependa del navegador.
    try {
      const r = await fetch("/api/ganancias/" + id, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + sesion.token },
        body: JSON.stringify({ ganancias: resultado.ganancias, archivo }),
      });
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || "error");
      await cargarComitentesLive(sesion.token);
    } catch (e) { msg.innerHTML = `<span class="neg">No se pudo guardar: ${e.message}</span>`; return; }
  } else {
    const overrides = loadOverrides();
    if (!overrides[id]) overrides[id] = {};
    overrides[id].ganancias = resultado.ganancias;
    saveOverrides(overrides);
  }
  msg.innerHTML = `<span class="pos">Listo: se cargaron ${resultado.ganancias.length} ganancias en ${id}.</span> Mirá Posiciones → Cerradas y Rendimiento.`;
}
