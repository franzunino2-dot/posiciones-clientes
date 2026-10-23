// Inicio > Calendario (manager): pagos de cupones y amortizaciones de las tenencias de sus clientes,
// con descarga en Excel y PDF (con el logo de Equanima, igual que el flujo de fondos de renta fija).
// El cronograma por 100 VN sale de /api/pagos (cliente.js: cargarPagosCliente, pagosCliente).

const CAL = { cliente: "", tipo: "Todos", horizonte: "12", q: "", mon: "USD", mostrar: 150 };
const CAL_HORIZONTES = [["3", "3 meses"], ["6", "6 meses"], ["12", "12 meses"], ["0", "Todo"]];

function calEsON(t) {
  const T = String(t).toUpperCase();
  const base = "DCO".includes(T.slice(-1)) && !/\d/.test(T.slice(-1)) ? T.slice(0, -1) : T;
  const o = (PAGOS && PAGOS.ons) || {};
  return !!(o[base] || o[T]);
}

// Una fila por pago (cupón y amortización juntos) y comitente, en la moneda original del bono.
function calFilas(clientes) {
  const lista = CAL.cliente ? clientes.filter(c => c.id === CAL.cliente) : clientes;
  const hoy = todayStr();
  let hasta = null;
  if (+CAL.horizonte) { const d = new Date(hoy + "T12:00:00"); d.setMonth(d.getMonth() + +CAL.horizonte); hasta = d.toISOString().slice(0, 10); }
  const q = CAL.q.trim().toLowerCase();
  const filas = [];
  lista.forEach(c => pagosCliente(c).forEach(p => {
    const on = calEsON(p.t);
    if (CAL.tipo === "ON" && !on) return;
    if (hasta && p.fecha > hasta) return;
    const nombre = titulo(p.n || "");
    if (q && !(`${p.t} ${nombre} ${c.id} ${c.nombre}`.toLowerCase().includes(q))) return;
    filas.push({ fecha: p.fecha, cid: c.id, cnombre: titulo(c.nombre || ""), t: p.t, nombre, on, vn: p.vn, mon: p.mon, interes: p.cuponOrig, amort: p.amortOrig, total: p.cuponOrig + p.amortOrig });
  }));
  return filas.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.t.localeCompare(b.t) || a.cid.localeCompare(b.cid));
}

const calMonedas = filas => [...new Set(filas.map(f => f.mon))].sort((a, b) => (a === "USD" ? -1 : 1) - (b === "USD" ? -1 : 1));
const calSimbolo = m => (m === "USD" ? "USD " : "$ ");
const calNum = v => fmtMoney(v, 2);
function calTotales(filas) {
  const t = {};
  filas.forEach(f => { const x = t[f.mon] || (t[f.mon] = { interes: 0, amort: 0, total: 0 }); x.interes += f.interes; x.amort += f.amort; x.total += f.total; });
  return t;
}

function renderCalendario(clientes) {
  const el = document.getElementById("view-calendario");
  if (PAGOS_ESTADO === "pendiente") cargarPagosCliente().then(() => { if (vistaActual === "calendario") renderCalendario(getClientes()); });
  if (PAGOS_ESTADO === "cargando") setTimeout(() => { if (vistaActual === "calendario" && PAGOS_ESTADO !== "cargando") renderCalendario(getClientes()); else if (vistaActual === "calendario" && PAGOS_ESTADO === "cargando") renderCalendario(getClientes()); }, 800);
  const cab = `
    <div class="mk-cab">
      <div><span class="mk-sup">INICIO</span><h1>Calendario de pagos</h1><span class="mk-sub">Cupones y amortizaciones de las ONs y bonos que tienen tus clientes</span></div>
      <div class="mk-pills" style="margin:0"><button onclick="calExportarPDF()">⬇ PDF</button><button onclick="calExportarExcel()">⬇ Excel</button></div>
    </div>`;
  if (PAGOS_ESTADO === "pendiente" || PAGOS_ESTADO === "cargando") { el.innerHTML = cab + `<p class="mk-vacio">Cargando el cronograma de pagos…</p>`; return; }
  if (PAGOS_ESTADO === "error") { el.innerHTML = cab + `<p class="mk-vacio">No se pudo cargar el cronograma de pagos. Probá de nuevo más tarde.</p>`; return; }

  const conPosicion = clientes.filter(c => (c.detallePesos || []).length || (c.detalleDolares || []).length);
  const filas = calFilas(clientes);
  const mons = calMonedas(filas);
  if (mons.length && !mons.includes(CAL.mon)) CAL.mon = mons[0];
  const tot = calTotales(filas);
  const hoy = todayStr(), en30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  const prox = calTotales(filas.filter(f => f.fecha <= en30));
  const nCli = new Set(filas.map(f => f.cid)).size;
  const tile = (etq, valor, sub) => `<div class="cal-tile"><span>${etq}</span><b>${valor}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
  const tiles = [
    ...mons.map(m => tile(`PRÓXIMOS 30 DÍAS · ${m}`, `${calSimbolo(m)}${calNum((prox[m] || { total: 0 }).total)}`, `de ${calSimbolo(m)}${calNum(tot[m].total)} en el período`)),
    tile("PAGOS", fmtMoney(filas.length, 0), `${fmtMoney(nCli, 0)} clientes · ${fmtMoney(new Set(filas.map(f => f.t)).size, 0)} instrumentos`),
  ].join("");

  // Barras por mes, en la moneda elegida.
  const porMes = {};
  filas.filter(f => f.mon === CAL.mon).forEach(f => { const k = f.fecha.slice(0, 7); const x = porMes[k] || (porMes[k] = { cup: 0, am: 0 }); x.cup += f.interes; x.am += f.amort; });
  const claves = Object.keys(porMes).sort(), meses = [];
  if (claves.length) for (let [y, m] = claves[0].split("-").map(Number); `${y}-${String(m).padStart(2, "0")}` <= claves[claves.length - 1];) { meses.push(`${y}-${String(m).padStart(2, "0")}`); if (++m > 12) { m = 1; y++; } }
  const mx = Math.max(...meses.map(k => (porMes[k] ? porMes[k].cup + porMes[k].am : 0)), 1);
  const corto = v => (v >= 1e6 ? fmtMoney(v / 1e6, 1) + " M" : v >= 1e3 ? fmtMoney(v / 1e3, 0) + " k" : fmtMoney(v, 0));
  const barras = meses.length ? `<div class="cal-bars">${meses.map(k => {
    const x = porMes[k] || { cup: 0, am: 0 }, t = x.cup + x.am, [y, m] = k.split("-");
    return `<div class="cal-col" title="${MESES[+m - 1]} ${y}: ${calSimbolo(CAL.mon)}${calNum(t)} (interés ${calNum(x.cup)} · amortización ${calNum(x.am)})">
      <span class="cal-v">${t ? corto(t) : ""}</span>
      <div class="cal-stack"><i class="cup" style="height:${x.cup / mx * 100}%"></i><i class="am" style="height:${x.am / mx * 100}%"></i></div>
      <span class="cal-m">${MESES[+m - 1].slice(0, 3)}${+m === 1 || k === meses[0] ? " " + y.slice(2) : ""}</span></div>`;
  }).join("")}</div><div class="cal-ley"><span><i style="background:var(--accent)"></i>Interés</span><span><i style="background:var(--green)"></i>Amortización</span></div>` : `<p class="mk-vacio">No hay pagos en este período.</p>`;

  // Detalle agrupado por mes.
  let cuerpo = "", mesAct = "";
  filas.slice(0, CAL.mostrar).forEach(f => {
    const k = f.fecha.slice(0, 7);
    if (k !== mesAct) { mesAct = k; cuerpo += `<tr class="cal-mes"><td colspan="9">${MESES[+k.slice(5) - 1].toUpperCase()} ${k.slice(0, 4)}</td></tr>`; }
    cuerpo += `<tr class="${f.fecha === hoy ? "hoy" : ""}"><td class="nw">${fmtFecha(f.fecha)}</td><td>${esc(f.cid)} <span class="muted">${esc(f.cnombre)}</span></td>
      <td><b>${esc(f.t)}</b>${f.on ? `<span class="cal-on">ON</span>` : ""}</td><td class="muted">${esc(f.nombre)}</td><td>${fmtMoney(f.vn, 0)}</td>
      <td>${f.interes ? calNum(f.interes) : "—"}</td><td>${f.amort ? calNum(f.amort) : "—"}</td><td><b>${calNum(f.total)}</b></td><td>${f.mon}</td></tr>`;
  });
  const pie = mons.map(m => `<tr><td colspan="5"><b>Total ${m}</b></td><td><b>${calNum(tot[m].interes)}</b></td><td><b>${calNum(tot[m].amort)}</b></td><td><b>${calNum(tot[m].total)}</b></td><td>${m}</td></tr>`).join("");
  const opts = clientes.filter(c => conPosicion.includes(c)).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)))
    .map(c => `<option value="${esc(c.id)}" ${CAL.cliente === c.id ? "selected" : ""}>${esc(c.id)} ${esc(titulo(c.nombre || ""))}</option>`).join("");
  const foco = document.activeElement && document.activeElement.id === "calQ";

  el.innerHTML = cab + `
    <div class="mk-pills">
      <select onchange="calSet('cliente', this.value)"><option value="">Todos mis clientes</option>${opts}</select>
      <button class="${CAL.tipo === "Todos" ? "on" : ""}" onclick="calSet('tipo','Todos')">ONs y bonos</button>
      <button class="${CAL.tipo === "ON" ? "on" : ""}" onclick="calSet('tipo','ON')">Solo ONs</button>
      <span class="muted" style="margin-left:8px">Hasta</span>
      ${CAL_HORIZONTES.map(([v, n]) => `<button class="${CAL.horizonte === v ? "on" : ""}" onclick="calSet('horizonte','${v}')">${n}</button>`).join("")}
      <input type="search" id="calQ" placeholder="Ticker o comitente…" value="${esc(CAL.q)}" oninput="calBuscar(this.value)" style="margin-left:auto">
    </div>
    ${filas.length ? `<div class="cal-tiles">${tiles}</div>
    <section class="mk-card"><h3>PAGOS POR MES${mons.length > 1 ? "" : " · " + CAL.mon}</h3>
      ${mons.length > 1 ? `<div class="mk-pills">${mons.map(m => `<button class="${CAL.mon === m ? "on" : ""}" onclick="calSet('mon','${m}')">${m}</button>`).join("")}</div>` : ""}
      ${barras}</section>
    <section class="mk-card"><h3>DETALLE DE PAGOS</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Fecha</th><th>Comitente</th><th>Ticker</th><th>Instrumento</th><th>VN</th><th>Interés</th><th>Amortización</th><th>Total</th><th>Mon.</th></tr></thead>
        <tbody>${cuerpo}</tbody><tfoot>${pie}</tfoot>
      </table></div>
      ${filas.length > CAL.mostrar ? `<p class="mk-nota">Se muestran los primeros ${CAL.mostrar} pagos de ${filas.length}. <a href="#" onclick="calMas();return false">Mostrar más</a> · las descargas llevan todos.</p>` : ""}
      <p class="mk-nota">Montos teóricos del cronograma de cada emisión sobre el VN que tiene cada cliente, en la moneda de cada instrumento. Fuente: bonistas.com y cronogramas de ONs.</p>
    </section>`
    : `<p class="mk-vacio">${clientes.length ? "No hay pagos futuros con estos filtros." : "Todavía no hay clientes cargados."}</p>`}`;
  if (foco) { const i = document.getElementById("calQ"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
}

function calSet(k, v) { CAL[k] = v; CAL.mostrar = 150; renderCalendario(getClientes()); }
function calMas() { CAL.mostrar += 300; renderCalendario(getClientes()); }
let calTimer = null;
function calBuscar(v) { CAL.q = v; CAL.mostrar = 150; clearTimeout(calTimer); calTimer = setTimeout(() => renderCalendario(getClientes()), 250); }

// ---------- Descargas ----------

const calArchivo = () => `CalendarioPagos_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
function calDescripcion() {
  const cli = CAL.cliente ? getClientes().find(c => c.id === CAL.cliente) : null;
  const hor = +CAL.horizonte ? `próximos ${CAL.horizonte} meses` : "todo el cronograma";
  return `${cli ? `Comitente ${cli.id} ${titulo(cli.nombre || "")}` : "Todos los clientes"}  ·  ${CAL.tipo === "ON" ? "Solo ONs" : "ONs y bonos"}  ·  ${hor}`;
}

// Aplica estilos (colores, negritas, bordes) a una hoja; mismo diseño que el Excel del flujo de fondos de renta fija.
function calEstiloHoja(ws, o) {
  const rng = XLSX.utils.decode_range(ws["!ref"]);
  const NAVY = { rgb: "0A1628" }, WHITE = { rgb: "FFFFFF" }, HDR = { rgb: "DCE3F0" }, ALT = { rgb: "F4F7FB" };
  const bd = { style: "thin", color: { rgb: "D0D7E2" } }, BOX = { top: bd, bottom: bd, left: bd, right: bd };
  const ha = c => ({ l: "left", r: "right", c: "center" }[(o.cols && o.cols[c]) || "left"] || "left");
  for (let R = rng.s.r; R <= rng.e.r; R++) {
    for (let C = rng.s.c; C <= rng.e.c; C++) {
      const ref = XLSX.utils.encode_cell({ r: R, c: C });
      let cell = ws[ref]; if (!cell) { cell = { t: "s", v: "" }; ws[ref] = cell; }
      if (R === o.titleRow) cell.s = { font: { bold: true, color: WHITE, sz: 14 }, fill: { fgColor: NAVY }, alignment: { horizontal: "center", vertical: "center" } };
      else if (R === o.subRow) cell.s = { font: { italic: true, color: WHITE, sz: 10 }, fill: { fgColor: NAVY }, alignment: { horizontal: "center" } };
      else if (R === o.headRow) cell.s = { font: { bold: true, color: { rgb: "1F2A44" } }, fill: { fgColor: HDR }, alignment: { horizontal: ha(C), vertical: "center" }, border: BOX };
      else if (R >= o.totalRow) cell.s = { font: { bold: true, color: WHITE }, fill: { fgColor: NAVY }, alignment: { horizontal: ha(C) } };
      else if (R > o.headRow) { cell.s = { alignment: { horizontal: ha(C) }, border: BOX }; if ((R - o.headRow) % 2 === 0) cell.s.fill = { fgColor: ALT }; }
      if (typeof cell.v === "number" && R > o.headRow && (o.numCols || []).includes(C)) cell.z = "#,##0.00";
    }
  }
  ws["!rows"] = ws["!rows"] || []; ws["!rows"][o.titleRow] = { hpt: 22 }; if (o.subRow != null) ws["!rows"][o.subRow] = { hpt: 16 };
}

function calDatosDescarga() {
  const filas = calFilas(getClientes());
  return { filas, mons: calMonedas(filas), tot: calTotales(filas) };
}

function calExportarExcel() {
  const { filas, mons, tot } = calDatosDescarga();
  if (!filas.length || typeof XLSX === "undefined") { alert("No hay pagos para descargar con estos filtros"); return; }
  const wb = XLSX.utils.book_new();
  const fstr = new Date().toLocaleDateString("es-AR");
  const n2 = v => +v.toFixed(2);

  const s1 = [["Calendario de Pagos — Cartera de ONs y Bonos"], [`${calDescripcion()}  ·  al ${fstr}  ·  Montos estimados sobre VN`], [],
    ["Fecha de pago", "Comitente", "Nombre", "Ticker", "Instrumento", "VN tenencia", "Interés", "Amort.", "Total", "Moneda"]];
  filas.forEach(f => s1.push([fmtFecha(f.fecha), f.cid, f.cnombre, f.t, f.nombre, f.vn, n2(f.interes), n2(f.amort), n2(f.total), f.mon]));
  s1.push([]);
  mons.forEach(m => s1.push(["", "", "", "", `Total ${m}`, "", n2(tot[m].interes), n2(tot[m].amort), n2(tot[m].total), m]));
  const ws1 = XLSX.utils.aoa_to_sheet(s1);
  ws1["!cols"] = [{ wch: 13 }, { wch: 10 }, { wch: 28 }, { wch: 9 }, { wch: 34 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 9 }];
  ws1["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 9 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 9 } }];
  calEstiloHoja(ws1, { titleRow: 0, subRow: 1, headRow: 3, totalRow: s1.length - mons.length, numCols: [5, 6, 7, 8], cols: ["c", "c", "l", "c", "l", "r", "r", "r", "r", "c"] });
  XLSX.utils.book_append_sheet(wb, ws1, "Calendario de pagos");

  // Hoja 2: resumen por instrumento y moneda.
  const porT = {};
  filas.forEach(f => { const k = f.t + "|" + f.mon; const x = porT[k] || (porT[k] = { t: f.t, nombre: f.nombre, mon: f.mon, vn: 0, interes: 0, amort: 0, ult: f.fecha, cli: new Set() }); x.interes += f.interes; x.amort += f.amort; x.cli.add(f.cid); if (f.fecha > x.ult) x.ult = f.fecha; });
  const s2 = [["Resumen por Instrumento"], [], ["Ticker", "Instrumento", "Clientes", "Intereses", "Amortización", "Total", "Último pago", "Moneda"]];
  Object.values(porT).sort((a, b) => a.t.localeCompare(b.t)).forEach(x => s2.push([x.t, x.nombre, x.cli.size, n2(x.interes), n2(x.amort), n2(x.interes + x.amort), fmtFecha(x.ult), x.mon]));
  s2.push([]);
  mons.forEach(m => s2.push(["TOTAL " + m, "", "", n2(tot[m].interes), n2(tot[m].amort), n2(tot[m].total), "", m]));
  const ws2 = XLSX.utils.aoa_to_sheet(s2);
  ws2["!cols"] = [{ wch: 10 }, { wch: 36 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 13 }, { wch: 9 }];
  ws2["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 7 } }];
  calEstiloHoja(ws2, { titleRow: 0, subRow: -1, headRow: 2, totalRow: s2.length - mons.length, numCols: [3, 4, 5], cols: ["c", "l", "c", "r", "r", "r", "c", "c"] });
  XLSX.utils.book_append_sheet(wb, ws2, "Resumen por instrumento");

  // Hoja 3: totales por mes y moneda.
  const porM = {};
  filas.forEach(f => { const k = f.fecha.slice(0, 7) + "|" + f.mon; const x = porM[k] || (porM[k] = { k: f.fecha.slice(0, 7), mon: f.mon, interes: 0, amort: 0 }); x.interes += f.interes; x.amort += f.amort; });
  const s3 = [["Pagos por Mes"], [], ["Mes", "Intereses", "Amortización", "Total", "Moneda"]];
  Object.values(porM).sort((a, b) => a.k.localeCompare(b.k) || a.mon.localeCompare(b.mon)).forEach(x => s3.push([`${MESES[+x.k.slice(5) - 1]} ${x.k.slice(0, 4)}`, n2(x.interes), n2(x.amort), n2(x.interes + x.amort), x.mon]));
  s3.push([]);
  mons.forEach(m => s3.push(["TOTAL " + m, n2(tot[m].interes), n2(tot[m].amort), n2(tot[m].total), m]));
  const ws3 = XLSX.utils.aoa_to_sheet(s3);
  ws3["!cols"] = [{ wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 9 }];
  ws3["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }];
  calEstiloHoja(ws3, { titleRow: 0, subRow: -1, headRow: 2, totalRow: s3.length - mons.length, numCols: [1, 2, 3], cols: ["l", "r", "r", "r", "c"] });
  XLSX.utils.book_append_sheet(wb, ws3, "Pagos por mes");

  XLSX.writeFile(wb, calArchivo() + ".xlsx");
}

function calExportarPDF() {
  const { filas, mons, tot } = calDatosDescarga();
  if (!filas.length) { alert("No hay pagos para descargar con estos filtros"); return; }
  if (!(window.jspdf && window.jspdf.jsPDF)) { alert("No se pudo generar el PDF"); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
  try { doc.addImage(EQ_LOGO_PDF, "PNG", 40, 26, 4.24 * 26, 26); } catch (e) { /* sin logo */ }
  doc.setFont("helvetica", "bold"); doc.setFontSize(16); doc.setTextColor(15, 23, 42);
  doc.text("Calendario de Pagos", 40, 80);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(100, 116, 139);
  doc.text(`Fecha: ${new Date().toLocaleDateString("es-AR")}   ·   ${calDescripcion()}`, 40, 96);
  const body = filas.map(f => [fmtFecha(f.fecha), `${f.cid} ${f.cnombre}`, f.t, f.nombre, fmtMoney(f.vn, 0), f.interes ? calNum(f.interes) : "—", f.amort ? calNum(f.amort) : "—", calNum(f.total), f.mon]);
  doc.autoTable({
    startY: 110,
    head: [["Fecha de pago", "Comitente", "Ticker", "Instrumento", "VN", "Interés", "Amortización", "Total", "Mon."]],
    body,
    foot: mons.map(m => [`Total ${m}`, "", "", "", "", calNum(tot[m].interes), calNum(tot[m].amort), calNum(tot[m].total), m]),
    styles: { fontSize: 8, cellPadding: 3, lineColor: [226, 232, 240], lineWidth: 0.4 },
    headStyles: { fillColor: [10, 22, 40], textColor: 255, fontStyle: "bold" },
    footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: { 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" }, 8: { halign: "center" } },
    margin: { left: 40, right: 40 },
    showFoot: "lastPage",
  });
  const paginas = doc.getNumberOfPages();
  for (let i = 1; i <= paginas; i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120, 130, 150); doc.text(`Equanima Securities · Montos teóricos del cronograma de cada emisión sobre el VN en cartera · Página ${i} de ${paginas}`, 40, doc.internal.pageSize.getHeight() - 18); }
  doc.save(calArchivo() + ".pdf");
}
