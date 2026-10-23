// Panel "Resultado del período": ganancia o pérdida de una cuenta entre dos fechas, en pesos o en dólares.
// Los números los calcula el servidor (/api/cuenta/:id/resultado) a partir de la posición de Gallo,
// su historial de movimientos y los precios de cada día.

const PL = { id: null, desde: null, hasta: null, preset: "hoy", moneda: "ARS", datos: null, cargando: false, error: "", clase: "" };
try { PL.moneda = sessionStorage.getItem("monedaPL") || "ARS"; } catch (e) { /* sin storage */ }

const isoLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fechaDMY = s => { const [y, m, d] = s.split("-"); return `${d}/${m}/${y}`; };

function plRango(preset) {
  const hoy = new Date();
  const h = isoLocal(hoy);
  const atras = n => { const d = new Date(hoy); d.setDate(d.getDate() - n); return isoLocal(d); };
  const habilAnterior = () => { const d = new Date(hoy); do { d.setDate(d.getDate() - 1); } while ([0, 6].includes(d.getDay())); return isoLocal(d); };
  if (preset === "hoy") return { desde: h, hasta: h };
  if (preset === "ayer") { const a = habilAnterior(); return { desde: a, hasta: a }; }
  if (preset === "7d") return { desde: atras(6), hasta: h };
  if (preset === "mes") return { desde: `${h.slice(0, 7)}-01`, hasta: h };
  if (preset === "anio") return { desde: `${h.slice(0, 4)}-01-01`, hasta: h };
  if (preset === "todo") return { desde: "2020-01-01", hasta: h };
  return null;
}

// Dibuja el panel dentro de un contenedor y carga los números de la cuenta.
function pintarPanelPL(contenedor, id, clase) {
  if (!contenedor) return;
  if (PL.id !== id) { PL.id = id; PL.datos = null; PL.error = ""; Object.assign(PL, { preset: "hoy" }, plRango("hoy")); }
  PL.clase = clase || "";
  let panel = contenedor.querySelector("#plPanel");
  if (!panel) { panel = document.createElement("div"); panel.id = "plPanel"; contenedor.appendChild(panel); }
  dibujarPL();
  if (!PL.datos && !PL.cargando) plCargar();
}

function plPreset(p) { PL.preset = p; Object.assign(PL, plRango(p)); plCargar(); }
function plFechas() {
  const d = document.getElementById("plDesde").value, h = document.getElementById("plHasta").value;
  if (!d || !h) return;
  PL.preset = "custom"; PL.desde = d <= h ? d : h; PL.hasta = d <= h ? h : d;
  plCargar();
}
function plMoneda(m) { PL.moneda = m; try { sessionStorage.setItem("monedaPL", m); } catch (e) { /* sin storage */ } dibujarPL(); }

async function plCargar() {
  if (!sesion || !sesion.token || !PL.id) { PL.error = "El resultado por período está disponible con la conexión a Gallo."; dibujarPL(); return; }
  const id = PL.id, pedido = `${PL.desde}|${PL.hasta}`;
  PL.cargando = true; PL.error = ""; dibujarPL();
  try {
    const r = await fetch(`/api/cuenta/${encodeURIComponent(id)}/resultado?desde=${PL.desde}&hasta=${PL.hasta}`, { headers: { Authorization: "Bearer " + sesion.token } });
    const j = await r.json();
    if (id !== PL.id || pedido !== `${PL.desde}|${PL.hasta}`) return; // cambió la cuenta o el rango mientras tanto
    if (j.ok) PL.datos = j; else { PL.datos = null; PL.error = j.error || "No se pudo calcular el resultado."; }
  } catch (e) { PL.datos = null; PL.error = "No se pudo calcular el resultado."; }
  PL.cargando = false;
  dibujarPL();
}

function dibujarPL() {
  const panel = document.getElementById("plPanel");
  if (!panel) return;
  const claro = PL.clase === "claro";
  const d = PL.datos, usd = PL.moneda === "USD";
  const k = usd ? "usd" : "ars";
  const m = v => (v < 0 ? "-" : "") + (usd ? "USD " : "$ ") + fmtMoney(Math.abs(v), usd ? 2 : 0);
  const signo = v => (v > 0 ? "+" : "");
  const col = v => (v < 0 ? (claro ? "cv-rojo" : "neg") : (claro ? "cv-verde" : "pos"));
  const presets = [["hoy", "Hoy"], ["ayer", "Último día hábil"], ["7d", "7 días"], ["mes", "Mes"], ["anio", "Año"], ["todo", "Todo"]];
  const hoyIso = isoLocal(new Date());

  let cuerpo = "";
  if (PL.cargando && !d) cuerpo = `<p class="pl-nota">Calculando con los precios de cada día…</p>`;
  else if (PL.error) cuerpo = `<p class="pl-nota">${esc(PL.error)}</p>`;
  else if (d) {
    const r = d[k], dg = r.desglose;
    const filas = [
      ["Operaciones cerradas", dg.realizado, "Ganancia o pérdida de lo vendido en el período"],
      ["Dividendos y rentas", dg.cobros, "Lo cobrado de acciones y bonos"],
      ["Intereses de caución", dg.intereses, "Neto de intereses ganados y pagados"],
      ["Gastos y bonificaciones", dg.gastos, "Derechos, retenciones, bonificaciones y créditos"],
      ["Cambio en lo no realizado", dg.noRealizado, "Variación de precios de la tenencia"],
    ];
    cuerpo = `
      <div class="pl-grande">
        <div><span class="pl-etq">Resultado</span><div class="pl-valor ${col(r.resultado)}">${signo(r.resultado)}${m(r.resultado)}</div>
          <span class="pl-sub ${r.pct == null ? "" : col(r.pct)}">${r.pct == null ? "" : signo(r.pct) + fmtPct(r.pct)}</span></div>
        <div class="pl-chicos">
          <div><span class="pl-etq">Valor al inicio</span><b>${m(r.inicio)}</b></div>
          <div><span class="pl-etq">Aportes y retiros</span><b>${signo(r.flujos)}${m(r.flujos)}</b></div>
          <div><span class="pl-etq">Valor al final</span><b>${m(r.fin)}</b></div>
        </div>
      </div>
      <div class="pl-desglose">${filas.map(([n, v, t]) => `<div class="pl-fila"><span title="${esc(t)}">${n}</span><b class="${col(v)}">${signo(v)}${m(v)}</b></div>`).join("")}</div>
      ${d.precios.estimadas.length ? `<p class="pl-nota">${d.precios.estimadas.length === 1 ? "La especie" : d.precios.estimadas.length + " especies"} sin precio histórico se valuó${d.precios.estimadas.length === 1 ? "" : "aron"} al precio de hoy (${esc(d.precios.estimadas.slice(0, 6).join(", "))}${d.precios.estimadas.length > 6 ? "…" : ""}): el resultado puede variar un poco.</p>` : ""}
      <p class="pl-nota">Del cierre del ${fechaDMY(d.base)} al ${d.hasta >= hoyIso ? "momento actual" : "cierre del " + fechaDMY(d.hasta)}. Valores de cada día; los dólares se calculan al MEP de cada fecha. El % está ponderado por el momento de cada aporte o retiro.</p>`;
  }

  panel.className = claro ? "cv-card" : "panel";
  panel.innerHTML = `
    <div class="pl-cab">
      <h3 style="margin:0">Resultado del período</h3>
      <div class="pl-mon">${[["ARS", "Pesos"], ["USD", "Dólares"]].map(([c, n]) => `<button class="${PL.moneda === c ? "on" : ""}" onclick="plMoneda('${c}')">${n}</button>`).join("")}</div>
    </div>
    <div class="pl-presets">${presets.map(([p, n]) => `<button class="${PL.preset === p ? "on" : ""}" onclick="plPreset('${p}')">${n}</button>`).join("")}
      <span class="pl-fechas">Desde <input type="date" id="plDesde" value="${PL.desde}" max="${hoyIso}"> hasta <input type="date" id="plHasta" value="${PL.hasta}" max="${hoyIso}"> <button onclick="plFechas()">Ver</button></span>
    </div>
    <div class="${PL.cargando && d ? "pl-cargando" : ""}">${cuerpo}</div>`;
}
