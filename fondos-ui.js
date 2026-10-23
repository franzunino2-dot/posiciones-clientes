// Mercado > Fondos: fondos comunes de inversión argentinos (datos de Fonditos, CAFCI/CNV).
// Ranking por rentabilidad, buscador, ficha con gráfico del valor de la cuotaparte y tasas de referencia.
// El servidor guarda las respuestas porque la clave permite pocas consultas por día.

const FD = { periodo: "30d", categoria: "", ranking: null, ficha: null, rango: "1A", tasas: null, estado: null, qSeq: 0, qTimer: null, cargando: false, error: "", geo: null };
const FD_PERIODOS = [["1d", "1 día"], ["7d", "7 días"], ["30d", "30 días"], ["90d", "90 días"], ["ytd", "En el año"], ["1y", "1 año"]];
const FD_CATEGORIAS = ["MERCADO DE DINERO", "RENTA FIJA", "RENTA MIXTA", "RENTA VARIABLE", "RETORNO TOTAL"];

const fdAuth = () => ({ Authorization: "Bearer " + sesion.token });
function fdBig(v) {
  if (v == null) return "—";
  if (v >= 1e12) return "$ " + fmtMoney(v / 1e12, 2) + " billones";
  if (v >= 1e9) return "$ " + fmtMoney(v / 1e9, 1) + " mil M";
  if (v >= 1e6) return "$ " + fmtMoney(v / 1e6, 0) + " M";
  return "$ " + fmtMoney(v, 0);
}
const fdPct = (v, d = 2) => (v == null ? "—" : (v > 0 ? "+" : "") + fmtMoney(v, d) + "%");
const fdChip = v => (v == null ? `<span class="mk-chip">—</span>` : `<span class="mk-chip ${v < 0 ? "neg" : "pos"}">${fdPct(v)}</span>`);
const fdTit = s => mkTitulo(String(s || ""));

async function fdPedir(ruta, query) {
  const r = await fetch("/api/fondos/" + ruta + "?" + new URLSearchParams(query).toString(), { headers: fdAuth() });
  const j = await r.json();
  if (j.usadas != null) FD.estado = { usadas: j.usadas, limite: j.limite, restantes: j.restantes };
  fdPintarCupo();
  return j;
}

function renderFondos() {
  const el = document.getElementById("view-fondos");
  if (!el.querySelector("#fdRank")) {
    el.innerHTML = `
      <div class="mk-cab">
        <div><span class="mk-sup">FONDOS COMUNES DE INVERSIÓN</span><h1>Fondos</h1><span class="mk-sub" id="fdSub">Datos de CAFCI / CNV a través de Fonditos</span></div>
        <span class="mk-sub" id="fdCupo" title="La clave de prueba permite 50 consultas por día; lo ya consultado se guarda unas horas"></span>
      </div>
      <div class="mk-buscar">
        <span class="mk-lupa">⌕</span><input id="fdQ" type="text" autocomplete="off" placeholder="Buscar un fondo (ej. Fima, Balanz, Alpha, Pionero)…" oninput="fdBuscar(this.value)">
        <button class="mk-x" id="fdQx" onclick="fdLimpiar()" style="display:none">✕</button>
        <div class="mk-res" id="fdRes"></div>
      </div>
      <div id="fdFicha"></div>
      <div class="mk-grid"><div id="fdRank"></div><div id="fdSide"></div></div>`;
  }
  fdPintarRanking();
  fdPintarSide();
  if (!FD.ranking && !FD.cargando) fdCargarRanking();
  if (!FD.tasas) fdCargarTasas();
}

function fdPintarCupo() {
  const e = document.getElementById("fdCupo");
  if (e && FD.estado) e.textContent = `Consultas de hoy: ${FD.estado.usadas} de ${FD.estado.limite}`;
}

// ---------- Ranking ----------
async function fdCargarRanking() {
  FD.cargando = true; FD.error = ""; fdPintarRanking();
  try {
    const j = await fdPedir("ranking", { periodo: FD.periodo, categoria: FD.categoria, limite: 20 });
    if (j.ok) FD.ranking = j; else { FD.ranking = null; FD.error = j.error || "No se pudo traer el ranking"; }
  } catch (e) { FD.ranking = null; FD.error = "No se pudo traer el ranking"; }
  FD.cargando = false;
  fdPintarRanking();
}
function fdPeriodo(p) { FD.periodo = p; FD.ranking = null; fdCargarRanking(); }
function fdCategoria(c) { FD.categoria = c; FD.ranking = null; fdCargarRanking(); }

function fdPintarRanking() {
  const box = document.getElementById("fdRank");
  if (!box) return;
  const rows = FD.ranking && FD.ranking.datos && FD.ranking.datos.rows || [];
  const d = FD.ranking && FD.ranking.datos;
  const filas = rows.map((r, i) => `
    <tr class="clic" onclick="fdAbrir('${mkEsc(r.fondo).replace(/'/g, "&#39;")}')">
      <td class="muted">${i + 1}</td>
      <td><b>${mkEsc(r.fondo)}</b><br><span class="muted" style="font-size:11px">${mkEsc(fdTit(r.subcategoria || r.categoria))}</span></td>
      <td>${mkEsc(r.moneda || "")}</td><td>${fmtMoney(r.vcp_to, r.vcp_to < 100 ? 4 : 2)}</td>
      <td>${fdChip(r.return_pct)}</td><td>${r.tna_pct == null ? "—" : fmtMoney(r.tna_pct, 1) + "%"}</td></tr>`).join("");
  box.innerHTML = `
    <section class="mk-card">
      <h3>RANKING POR RENTABILIDAD${d ? ` · ${mkEsc(d.from)} al ${mkEsc(d.to)}` : ""}</h3>
      <div class="pl-presets" style="margin-bottom:10px" id="fdFiltros">
        ${FD_PERIODOS.map(([p, n]) => `<button class="${FD.periodo === p ? "on" : ""}" onclick="fdPeriodo('${p}')">${n}</button>`).join("")}
        <select onchange="fdCategoria(this.value)" style="margin-left:auto"><option value="">Todas las categorías</option>${FD_CATEGORIAS.map(c => `<option value="${c}" ${FD.categoria === c ? "selected" : ""}>${fdTit(c)}</option>`).join("")}</select>
      </div>
      ${FD.cargando ? `<p class="mk-vacio">Trayendo el ranking…</p>` : FD.error ? `<p class="mk-vacio">${mkEsc(FD.error)}</p>` : `
      <div class="table-wrap"><table>
        <thead><tr><th>#</th><th>Fondo</th><th>Moneda</th><th>Valor cuotaparte</th><th>Rendimiento</th><th>TNA</th></tr></thead>
        <tbody>${filas || `<tr><td colspan="6" class="muted">Sin resultados.</td></tr>`}</tbody>
      </table></div>
      ${FD.ranking && (FD.ranking.cache || FD.ranking.vencido) ? `<p class="mk-nota">Datos guardados ${FD.ranking.vencido ? "(el cupo del día se agotó, se muestra lo último)" : "del " + new Date(FD.ranking.ts).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}.</p>` : ""}`}
    </section>`;
}

// ---------- Tasas de referencia ----------
async function fdCargarTasas() {
  try { const j = await fdPedir("tasas", {}); if (j.ok) { FD.tasas = j.datos; fdPintarSide(); } } catch (e) { /* sin tasas */ }
}
function fdPintarSide() {
  const box = document.getElementById("fdSide");
  if (!box) return;
  const t = FD.tasas;
  if (!t) { box.innerHTML = `<section class="mk-card"><h3>TASAS DE REFERENCIA</h3><p class="mk-vacio">Cargando…</p></section>`; return; }
  const tna = v => (v == null ? "—" : fmtMoney(v * 100, 2) + "%");
  const fila = (n, v, sub) => `<div class="mk-fila sin"><span class="mk-n">${n}${sub ? ` <i>· ${sub}</i>` : ""}</span><span class="mk-p">${v}</span></div>`;
  const ta = t.tasas || {}, dol = t.dolares || {};
  box.innerHTML = `
    <section class="mk-card"><h3>TASAS DE REFERENCIA · TNA</h3>
      ${fila("Caución", tna(ta.caucion && ta.caucion.tna), "BYMA/MAE")}${fila("TAMAR", tna(ta.tamar && ta.tamar.tna), "BCRA")}${fila("BADLAR", tna(ta.badlar && ta.badlar.tna), "BCRA")}
      ${fila("LECAP corta", tna(ta.lecap_corta && ta.lecap_corta.tea), ta.lecap_corta ? "TEA · " + ta.lecap_corta.ticker : "")}
      ${fila("Inflación implícita", tna(ta.inflacion_implicita_1a && ta.inflacion_implicita_1a.tea), "TEA · 1 año")}
    </section>
    <section class="mk-card"><h3>DÓLAR Y RIESGO PAÍS</h3>
      ${fila("MEP", "$ " + fmtMoney(dol.mep && dol.mep.valor, 2), dol.mep ? fdPct(dol.mep.variacion_1d * 100) + " hoy" : "")}
      ${fila("CCL", "$ " + fmtMoney(dol.ccl && dol.ccl.valor, 2), dol.ccl ? fdPct(dol.ccl.variacion_1d * 100) + " hoy" : "")}
      ${fila("Oficial A3500", "$ " + fmtMoney(dol.oficial_a3500 && dol.oficial_a3500.valor, 2))}
      ${fila("Riesgo país", t.riesgo_pais ? fmtMoney(t.riesgo_pais.valor, 0) + " pb" : "—")}
    </section>`;
}

// ---------- Buscador ----------
function fdBuscar(txt) {
  const q = txt.trim();
  document.getElementById("fdQx").style.display = q ? "block" : "none";
  clearTimeout(FD.qTimer);
  if (q.length < 2) { document.getElementById("fdRes").innerHTML = ""; return; }
  const seq = ++FD.qSeq;
  FD.qTimer = setTimeout(async () => {
    try {
      const j = await fdPedir("buscar", { q, limite: 8 });
      if (seq !== FD.qSeq) return;
      const lista = j.ok && j.datos && j.datos.data || [];
      document.getElementById("fdRes").innerHTML = j.ok
        ? (lista.length ? lista.map(f => `<div class="mk-r" onclick="fdAbrir('${mkEsc(f.fondo).replace(/'/g, "&#39;")}')"><span class="mk-ico" style="background:${mkColor(f.fondo)}">${mkEsc(f.fondo[0])}</span><span class="mk-n">${mkEsc(f.fondo)} <i>· ${mkEsc(fdTit(f.categoria))}</i></span><span class="mk-mercado">${fmtMoney(f.vcp, f.vcp < 100 ? 4 : 2)} · ${mkEsc(f.moneda || "")}</span></div>`).join("") : `<div class="mk-r vacio">No encontré fondos con “${mkEsc(q)}”.</div>`)
        : `<div class="mk-r vacio">${mkEsc(j.error || "No se pudo buscar")}</div>`;
    } catch (e) { /* sin resultados */ }
  }, 450);
}
function fdLimpiar() { const q = document.getElementById("fdQ"); q.value = ""; document.getElementById("fdRes").innerHTML = ""; document.getElementById("fdQx").style.display = "none"; }

// ---------- Ficha con gráfico ----------
async function fdAbrir(nombre) {
  fdLimpiar();
  FD.ficha = { fondo: nombre, cargando: true };
  FD.rango = "1A";
  fdPintarFicha();
  document.getElementById("fdFicha").scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    const [f, s] = [await fdPedir("ficha", { fondo: nombre }), await fdPedir("serie", { fondo: nombre, dias: 365 })];
    if (!FD.ficha || FD.ficha.fondo !== nombre) return;
    FD.ficha = { fondo: nombre, cargando: false, ficha: f.ok ? f.datos : null, serie: s.ok ? (s.datos.data || []) : null, error: f.ok ? "" : f.error };
  } catch (e) { FD.ficha = { fondo: nombre, cargando: false, error: "No se pudo traer el fondo" }; }
  fdPintarFicha();
}
function fdCerrar() { FD.ficha = null; document.getElementById("fdFicha").innerHTML = ""; }
function fdRango(r) { FD.rango = r; fdPintarFicha(); }

const FD_DIAS = { "1M": 30, "3M": 91, "6M": 182, "1A": 365 };
function fdPintarFicha() {
  const box = document.getElementById("fdFicha"), F = FD.ficha;
  if (!box || !F) return;
  if (F.cargando) { box.innerHTML = `<section class="mk-card mk-ficha"><p class="mk-vacio">Trayendo ${mkEsc(F.fondo)}…</p></section>`; return; }
  if (!F.ficha) { box.innerHTML = `<section class="mk-card mk-ficha"><button class="mk-x" onclick="fdCerrar()">✕</button><p class="mk-vacio">${mkEsc(F.error || "No se encontró el fondo")}</p></section>`; return; }
  const a = F.ficha.datos_actuales || {}, m = F.ficha.metricas || {};
  let serie = (F.serie || []).filter(x => x.vcp > 0).map(x => [x.fecha, x.vcp]);
  const completa = serie.length;
  if (serie.length) { const ult = serie[serie.length - 1][0], lim = new Date(Date.parse(ult + "T12:00:00Z") - FD_DIAS[FD.rango] * 86400000).toISOString().slice(0, 10); serie = serie.filter(x => x[0] >= lim); }
  const cambio = serie.length > 1 ? (serie[serie.length - 1][1] / serie[0][1] - 1) * 100 : null;
  const dato = (n, v) => `<div><span>${n}</span><b>${v}</b></div>`;
  box.innerHTML = `
    <section class="mk-card mk-ficha">
      <div class="mk-fch-cab">
        <div>
          <div class="mk-fch-nom"><span class="mk-ico" style="background:${mkColor(F.fondo)}">${mkEsc(F.fondo[0])}</span><b>${mkEsc(F.fondo)}</b><span class="mk-n">${mkEsc(F.ficha.gestora || "")} · ${mkEsc(fdTit(F.ficha.subcategoria || a.categoria))} · ${mkEsc(a.moneda || "")}</span></div>
          <div class="mk-fch-precio">${fmtMoney(a.vcp, a.vcp < 100 ? 4 : 2)} <small style="font-size:13px;color:var(--muted);font-weight:400">valor de la cuotaparte al ${mkEsc(a.fecha || "")}</small></div>
          ${cambio != null ? `<div class="mk-fch-var ${cambio < 0 ? "neg" : "pos"}">${fdPct(cambio)} <span>${{ "1M": "1 mes", "3M": "3 meses", "6M": "6 meses", "1A": "1 año" }[FD.rango]}</span></div>` : ""}
        </div>
        <div class="mk-fch-acc"><button class="mk-x" onclick="fdCerrar()">✕</button></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0">${[["7 días", m.rend_7d], ["30 días", m.rend_30d], ["90 días", m.rend_90d], ["En el año", m.rend_ytd], ["1 año", m.rend_1y]].map(([n, v]) => `<div class="mk-dtile" style="min-width:92px"><span>${n}</span>${fdChip(v)}</div>`).join("")}</div>
      ${serie.length > 2 ? `<div class="mk-chart-wrap">${fdGrafico(serie)}<div class="mk-tip" id="fdTip"></div></div>
        <div class="mk-rangos">${Object.keys(FD_DIAS).map(r => `<button class="${FD.rango === r ? "on" : ""}" onclick="fdRango('${r}')">${r}</button>`).join("")}</div>`
        : `<p class="mk-vacio">${completa ? "No hay suficientes puntos en este período." : "Este fondo todavía no tiene historial suficiente para graficar."}</p>`}
      <div class="mk-stats" style="grid-template-columns:repeat(4,1fr)">
        ${dato("Patrimonio", fdBig(a.patrimonio))}${dato("TNA", m.tna == null ? "—" : fmtMoney(m.tna, 1) + "%")}${dato("Volatilidad", m.volatilidad == null ? "—" : fmtMoney(m.volatilidad, 2) + "%")}${dato("Sharpe", m.sharpe == null ? "—" : fmtMoney(m.sharpe, 2))}
        ${dato("Honorario de gestión", a.fee_gestion == null ? "—" : fmtMoney(a.fee_gestion, 2) + "%")}${dato("Honorario depositaria", a.fee_depositaria == null ? "—" : fmtMoney(a.fee_depositaria, 3) + "%")}${dato("Rescate", a.plazo_rescate == null ? "—" : (a.plazo_rescate === 0 ? "Inmediato" : "a " + a.plazo_rescate + " día" + (a.plazo_rescate === 1 ? "" : "s")))}${dato("Horizonte", mkEsc(a.horizonte || "—"))}
      </div>
      <p class="mk-nota">Gerente: ${mkEsc(a.sociedad_gerente || "—")} · Depositaria: ${mkEsc(a.sociedad_depositaria || "—")}. Datos de CAFCI/CNV; los rendimientos pasados no garantizan resultados futuros.</p>
    </section>`;
  FD.geo = serie.length > 2 ? serie : null;
}

function fdGrafico(serie) {
  const W = 900, H = 240, pl = 6, pr = 6, pt = 22, pb = 26;
  const vals = serie.map(x => x[1]), mn = Math.min(...vals), mx = Math.max(...vals), rg = mx - mn || 1;
  const xs = i => pl + i / (serie.length - 1) * (W - pl - pr), ys = v => pt + (1 - (v - mn) / rg) * (H - pt - pb);
  const pts = vals.map((v, i) => [xs(i), ys(v)]);
  const curva = pts.map((p, i) => i === 0 ? `M${p[0].toFixed(1)},${p[1].toFixed(1)}` : `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const sube = vals[vals.length - 1] >= vals[0], col = sube ? "var(--green)" : "var(--red)";
  const lbl = [];
  for (let i = 0; i < 6; i++) { const idx = Math.round(i * (serie.length - 1) / 5); lbl.push([xs(idx), serie[idx][0]]); }
  const fecha = f => { const [y, m, dd] = f.split("-"); return `${+dd} ${["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"][+m - 1]}`; };
  const f2 = v => fmtMoney(v, v < 100 ? 4 : 2);
  return `<svg viewBox="0 0 ${W} ${H}" class="mk-chart" onmousemove="fdHover(event)" onmouseleave="fdHoverFin()">
    <defs><linearGradient id="fdGr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".25"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    <line x1="${pl}" x2="${W - pr}" y1="${ys(mx)}" y2="${ys(mx)}" stroke="var(--muted)" stroke-dasharray="2 4" opacity=".5"/>
    <text x="${pl + 2}" y="${ys(mx) - 6}" class="mk-eje">${f2(mx)}</text>
    <path d="${curva} L${pts[pts.length - 1][0].toFixed(1)},${H - pb} L${pts[0][0].toFixed(1)},${H - pb} Z" fill="url(#fdGr)"/>
    <path d="${curva}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round"/>
    <text x="${Math.min(Math.max(xs(vals.indexOf(mn)), 50), W - 50)}" y="${Math.min(ys(mn) + 16, H - pb - 2)}" text-anchor="middle" class="mk-eje">${f2(mn)}</text>
    <circle cx="${pts[pts.length - 1][0]}" cy="${pts[pts.length - 1][1]}" r="4" fill="${col}"/>
    ${lbl.map(([x, f]) => `<text x="${Math.min(Math.max(x, 22), W - 22)}" y="${H - 6}" text-anchor="middle" class="mk-eje">${fecha(f)}</text>`).join("")}
    <line id="fdGuia" x1="0" x2="0" y1="${pt}" y2="${H - pb}" stroke="var(--muted)" opacity="0"/><circle id="fdPunto" r="4" fill="${col}" opacity="0"/>
  </svg>`;
}
function fdHover(ev) {
  const g = FD.geo; if (!g) return;
  const r = ev.currentTarget.getBoundingClientRect(), fx = (ev.clientX - r.left) / r.width;
  const i = Math.max(0, Math.min(g.length - 1, Math.round(fx * (g.length - 1))));
  const W = 900, H = 240, pl = 6, pr = 6, pt = 22, pb = 26, vals = g.map(x => x[1]), mn = Math.min(...vals), mx = Math.max(...vals), rg = mx - mn || 1;
  const x = pl + i / (g.length - 1) * (W - pl - pr), y = pt + (1 - (vals[i] - mn) / rg) * (H - pt - pb);
  const guia = document.getElementById("fdGuia"), punto = document.getElementById("fdPunto"), tip = document.getElementById("fdTip");
  guia.setAttribute("x1", x); guia.setAttribute("x2", x); guia.setAttribute("opacity", ".6");
  punto.setAttribute("cx", x); punto.setAttribute("cy", y); punto.setAttribute("opacity", "1");
  const [yy, mm, dd] = g[i][0].split("-");
  tip.textContent = `${dd}/${mm}/${yy} · ${fmtMoney(vals[i], vals[i] < 100 ? 4 : 2)}`;
  tip.style.display = "block"; tip.style.left = Math.min(Math.max(fx * 100, 12), 88) + "%";
}
function fdHoverFin() {
  ["fdGuia", "fdPunto"].forEach(id => { const e = document.getElementById(id); if (e) e.setAttribute("opacity", "0"); });
  const t = document.getElementById("fdTip"); if (t) t.style.display = "none";
}
