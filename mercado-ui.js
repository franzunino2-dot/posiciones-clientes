// Mercado > Contado: cotizaciones en vivo de BYMA data (acciones, cedears, bonos, ONs, letras), más dólar, cripto
// y acciones de EE.UU. Buscador con ficha y gráfico por especie, favoritos y "tu cartera".

const MK = { data: null, ts: 0, moneda: "ARS", graficos: {}, ficha: null, rango: "1M", favs: [], timer: null, edad: null, qSeq: 0, qTimer: null, geo: null };
try { MK.moneda = sessionStorage.getItem("mkMoneda") || "ARS"; MK.favs = JSON.parse(localStorage.getItem("mkFavs") || "[]"); } catch (e) { /* sin storage */ }

const mkColor = t => { let h = 0; for (const c of String(t)) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 45% 38%)`; };
const mkEsc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const mkTitulo = s => String(s || "").toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());

function mkMep() {
  const d = MK.data && MK.data.dolar.find(x => x.casa === "bolsa");
  return d ? d.venta : 0;
}
// Precio de un renglón en la moneda elegida. Los renglones traen el precio en pesos (p) y, cuando existe, la serie en dólares (usd).
function mkPrecio(r) {
  const mep = mkMep() || 1;
  if (r.src === "us" || r.eeuu) return MK.moneda === "USD" ? { v: r.p, mon: "USD" } : { v: r.p * mep, mon: "ARS" };
  if (MK.moneda === "USD") return { v: r.usd != null ? r.usd : r.p / mep, mon: "USD" };
  return { v: r.p, mon: "ARS" };
}
function mkFmt(v, mon) {
  if (v == null || isNaN(v)) return "—";
  const dec = mon === "USD" ? 2 : (Math.abs(v - Math.round(v)) < 0.005 && v >= 100 ? 0 : 2);
  return (mon === "USD" ? "USD " : "$ ") + fmtMoney(v, dec);
}
const mkChip = pct => `<span class="mk-chip ${pct < 0 ? "neg" : "pos"}">${pct > 0 ? "+" : ""}${fmtMoney(pct, 2)}%</span>`;
const mkEsFav = (t, src) => MK.favs.some(f => f.t === t && f.src === src);
function mkFav(t, src) {
  const i = MK.favs.findIndex(f => f.t === t && f.src === src);
  if (i >= 0) MK.favs.splice(i, 1); else MK.favs.push({ t, src });
  try { localStorage.setItem("mkFavs", JSON.stringify(MK.favs)); } catch (e) { /* sin storage */ }
  mkPintar();
  if (MK.ficha) mkPintarFicha();
}

// ---------- Estructura de la pantalla ----------

function renderMercadoContado() {
  const el = document.getElementById("view-mercado");
  if (!el.querySelector("#mkMain")) {
    el.innerHTML = `
      <div class="mk-cab">
        <div><span class="mk-sup">COTIZACIONES EN VIVO</span><h1>Mercado</h1><span class="mk-sub" id="mkEdad">Cargando…</span></div>
        <div class="mk-mon"><button id="mkBtnARS" onclick="mkMoneda('ARS')">Pesos</button><button id="mkBtnUSD" onclick="mkMoneda('USD')">Dólares</button></div>
      </div>
      <div class="mk-buscar">
        <span class="mk-lupa">⌕</span><input id="mkQ" type="text" autocomplete="off" placeholder="Buscar acción o ticker (ej. GGAL, NVDA, AL30, YM34O)…" oninput="mkBuscar(this.value)">
        <button class="mk-x" id="mkQx" onclick="mkLimpiarBusqueda()" style="display:none">✕</button>
        <div class="mk-res" id="mkRes"></div>
      </div>
      <div id="mkDetalle"></div>
      <div class="mk-grid"><div id="mkMain"></div><div id="mkSide"></div></div>`;
  }
  mkBotonesMoneda();
  if (MK.data) mkPintar();
  mkCargar();
  if (!MK.timer) MK.timer = setInterval(() => { if (vistaActual === "mercado") mkCargar(); }, 10000);
  if (!MK.edad) MK.edad = setInterval(() => {
    const e = document.getElementById("mkEdad");
    if (e && MK.ts) e.textContent = "Actualizado hace " + Math.max(0, Math.round((Date.now() - MK.ts) / 1000)) + "s";
  }, 1000);
}

function mkBotonesMoneda() {
  const a = document.getElementById("mkBtnARS"), u = document.getElementById("mkBtnUSD");
  if (a) a.className = MK.moneda === "ARS" ? "on" : "";
  if (u) u.className = MK.moneda === "USD" ? "on" : "";
}
function mkMoneda(m) {
  MK.moneda = m;
  try { sessionStorage.setItem("mkMoneda", m); } catch (e) { /* sin storage */ }
  mkBotonesMoneda(); mkPintar();
  if (MK.ficha) mkPintarFicha();
}

async function mkCargar() {
  if (!sesion || !sesion.token) return;
  try {
    const r = await fetch("/api/mercado", { headers: { Authorization: "Bearer " + sesion.token } });
    const j = await r.json();
    if (j.ok) { MK.data = j; MK.ts = j.ts; mkPintar(); }
    else if (!MK.data) { const e = document.getElementById("mkEdad"); if (e) e.textContent = "No se pudo traer el mercado."; }
  } catch (e) { /* queda lo último que se tuvo */ }
}

// ---------- Secciones ----------

function mkFila(r, tipo, nombre) {
  const p = mkPrecio(r), src = r.src || (r.eeuu ? "us" : "byma");
  return `<div class="mk-fila" onclick="mkAbrir('${mkEsc(r.t)}','${src}')">
    <span class="mk-ico" style="background:${mkColor(r.t)}">${mkEsc(r.t[0])}</span>
    <span class="mk-t">${mkEsc(r.t)}</span><span class="mk-n">${mkEsc(nombre != null ? nombre : (MK.data.nombres[r.t] || ""))}</span>
    <span class="mk-p">${mkFmt(p.v, p.mon)}</span>${mkChip(r.pct)}
    <span class="mk-spark" data-t="${mkEsc(r.t)}" data-eeuu="${r.eeuu ? 1 : ""}"></span>
    <button class="mk-star ${mkEsFav(r.t, src) ? "on" : ""}" onclick="event.stopPropagation();mkFav('${mkEsc(r.t)}','${src}')" aria-label="Favorito">${mkEsFav(r.t, src) ? "★" : "☆"}</button>
  </div>`;
}
const mkSeccion = (titulo, cuerpo, extra) => `<section class="mk-card"><h3>${titulo}${extra || ""}</h3>${cuerpo}</section>`;

function mkMapa() {
  const d = MK.data, m = {};
  [d.generalAcc, d.cedears, d.bonosTodos, d.letras, d.ons, d.acciones, d.bonos].forEach(l => (l || []).forEach(r => { m[r.t] = r; }));
  return m;
}

function mkTenencias() {
  // Lo que tiene el cliente o, si es un manager, lo que más tienen sus clientes.
  const tot = {};
  try { getClientes().forEach(c => posicionesCliente(c).forEach(p => { tot[p.t] = (tot[p.t] || 0) + p.ars; })); } catch (e) { /* sin cartera */ }
  return Object.entries(tot).sort((a, b) => b[1] - a[1]).slice(0, 8).map(e => e[0]);
}

function mkPintar() {
  const d = MK.data, main = document.getElementById("mkMain"), side = document.getElementById("mkSide");
  if (!d || !main || !side) return;
  const mapa = mkMapa();
  const nom = t => d.nombres[t] || "";

  // Tu cartera y favoritos
  const propios = mkTenencias().filter(t => mapa[t]).map(t => ({ ...mapa[t], src: "byma" }));
  const favs = MK.favs.map(f => { const base = f.src === "us" ? (d.us.find(x => x.t === f.t) && { ...d.us.find(x => x.t === f.t), eeuu: true, src: "us" }) : (mapa[f.t] && { ...mapa[f.t], src: f.src }); return base; }).filter(Boolean);
  const vistos = new Set(); const cartera = [...favs, ...propios].filter(r => { const k = r.t + (r.src || ""); if (vistos.has(k)) return false; vistos.add(k); return true; });
  const titCartera = esAdmin() && sesion.rol !== "alyc" ? "TUS CLIENTES Y FAVORITOS" : esAdmin() ? "LO QUE TIENEN LOS CLIENTES Y FAVORITOS" : "TU CARTERA Y FAVORITOS";

  // Hot movers: lo que más sube y más baja entre acciones y cedears con volumen
  const candidatos = [...d.acciones, ...d.cedears].filter(r => r.vol >= 20e6 && r.prev > 0);
  const suben = candidatos.slice().sort((a, b) => b.pct - a.pct).slice(0, 3), bajan = candidatos.slice().sort((a, b) => a.pct - b.pct).slice(0, 3);
  const tarjeta = r => { const p = mkPrecio(r); return `<div class="mk-mov ${r.pct < 0 ? "neg" : "pos"}" onclick="mkAbrir('${mkEsc(r.t)}','byma')"><b>${mkEsc(r.t)}</b><span>${mkFmt(p.v, p.mon)}</span>${mkChip(r.pct)}<span class="mk-spark" data-t="${mkEsc(r.t)}"></span></div>`; };

  main.innerHTML = [
    mkSeccion(titCartera, cartera.length ? cartera.map(r => mkFila(r)).join("") : `<p class="mk-vacio">Marcá una especie con ☆ para verla acá.</p>`),
    mkSeccion("HOT MOVERS · ACCIONES Y CEDEARS", `<div class="mk-movs">${[...suben, ...bajan].map(tarjeta).join("") || `<p class="mk-vacio">Sin datos de rueda.</p>`}</div>`),
    d.indices && d.indices.length ? mkSeccion("ÍNDICES AR", d.indices.map(i => `<div class="mk-fila sin"><span class="mk-ico" style="background:${mkColor(i.t)}">${mkEsc(i.t[0])}</span><span class="mk-t">${mkEsc(i.t)}</span><span class="mk-n">${mkEsc(i.n)}</span><span class="mk-p">${fmtMoney(i.p, 0)}</span>${mkChip(i.pct)}<span class="mk-spark"></span><span class="mk-star"></span></div>`).join("")) : "",
    mkSeccion("ACCIONES AR · MERVAL", d.acciones.slice(0, 12).map(r => mkFila({ ...r, src: "byma" })).join("")),
    mkSeccion("CEDEARS", d.cedears.slice(0, 20).map(r => mkFila({ ...r, src: "byma" })).join("")),
    mkSeccion("ACCIONES US", (d.us || []).map(r => mkFila({ ...r, eeuu: true, src: "us" }, "", d.nombres[r.t] || "")).join("")),
  ].join("");

  const dol = d.dolar.filter(x => x.casa !== "cripto" || true);
  const etq = { oficial: "OFICIAL", blue: "BLUE", bolsa: "MEP", contadoconliqui: "CCL", cripto: "CRIPTO" };
  side.innerHTML = [
    mkSeccion("CRIPTO", (d.cripto || []).map(c => `<div class="mk-fila sin"><span class="mk-ico" style="background:${mkColor(c.t)}">${mkEsc(c.t[0])}</span><span class="mk-t">${mkEsc(c.t)}</span><span class="mk-p">USD ${fmtMoney(c.p, c.p < 10 ? 4 : 2)}</span>${mkChip(c.pct)}</div>`).join("") || `<p class="mk-vacio">Sin datos.</p>`),
    mkSeccion("DÓLAR", `<div class="mk-dolar">${dol.map(x => `<div class="mk-dtile"><span>${etq[x.casa] || x.nombre}</span><b>$${fmtMoney(x.venta, 0)}</b><small>Cpa $${fmtMoney(x.compra, 0)}</small></div>`).join("")}</div>`),
    mkSeccion("BONOS AR", d.bonos.map(r => { const p = mkPrecio(r); return `<div class="mk-fila corta" onclick="mkAbrir('${mkEsc(r.t)}','${r.nom ? "d912" : "byma"}')"><span class="mk-ico" style="background:${mkColor(r.t)}">${mkEsc(r.t[0])}</span><span class="mk-t">${mkEsc(r.t)}</span><span class="mk-p">${mkFmt(p.v, p.mon)}</span>${mkChip(r.pct)}</div>`; }).join("")),
    mkSeccion("OBLIGACIONES NEGOCIABLES", d.ons.slice(0, 8).map(r => { const p = mkPrecio(r); return `<div class="mk-fila corta" onclick="mkAbrir('${mkEsc(r.t)}','byma')"><span class="mk-ico" style="background:${mkColor(r.t)}">${mkEsc(r.t[0])}</span><span class="mk-t">${mkEsc(r.t)}</span><span class="mk-p">${mkFmt(p.v, p.mon)}</span>${mkChip(r.pct)}</div>`; }).join("")),
    mkSeccion("LETRAS DEL TESORO", d.letras.slice(0, 6).map(r => `<div class="mk-fila corta" onclick="mkAbrir('${mkEsc(r.t)}','d912')"><span class="mk-ico" style="background:${mkColor(r.t)}">${mkEsc(r.t[0])}</span><span class="mk-t">${mkEsc(r.t)}</span><span class="mk-p">${mkFmt(mkPrecio(r).v, mkPrecio(r).mon)}</span>${mkChip(r.pct)}</div>`).join("")),
  ].join("");

  mkCargarGraficos();
  mkBuscarSiHay();
}

// ---------- Minigráficos ----------

async function mkCargarGraficos() {
  const pendientes = [...document.querySelectorAll("#view-mercado .mk-spark[data-t]")].filter(e => !(e.dataset.t in MK.graficos) && !e.dataset.eeuu).map(e => e.dataset.t);
  const unicos = [...new Set(pendientes)];
  mkPintarSparks();
  if (!unicos.length) return;
  unicos.forEach(t => { MK.graficos[t] = null; }); // marca "pedido" para no repetirlo
  try {
    for (let i = 0; i < unicos.length; i += 40) {
      const r = await fetch("/api/mercado/graficos?t=" + encodeURIComponent(unicos.slice(i, i + 40).join(",")), { headers: { Authorization: "Bearer " + sesion.token } });
      const j = await r.json();
      if (j.ok) Object.assign(MK.graficos, j.series);
      mkPintarSparks();
    }
  } catch (e) { /* sin minigráficos */ }
}
function mkLinea(vals, w, h, suave) {
  const mn = Math.min(...vals), mx = Math.max(...vals), rg = mx - mn || 1;
  const pts = vals.map((v, i) => [i / (vals.length - 1 || 1) * w, h - 2 - (v - mn) / rg * (h - 4)]);
  return suave ? pts.map((p, i) => i === 0 ? `M${p[0].toFixed(1)},${p[1].toFixed(1)}` : `Q${pts[i - 1][0].toFixed(1)},${pts[i - 1][1].toFixed(1)} ${((p[0] + pts[i - 1][0]) / 2).toFixed(1)},${((p[1] + pts[i - 1][1]) / 2).toFixed(1)}`).join(" ") : pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
}
function mkPintarSparks() {
  document.querySelectorAll("#view-mercado .mk-spark[data-t]").forEach(e => {
    const s = MK.graficos[e.dataset.t];
    if (!s || s.length < 3 || e.dataset.listo === String(s.length)) return;
    const sube = s[s.length - 1] >= s[0], col = sube ? "var(--green)" : "var(--red)";
    e.innerHTML = `<svg viewBox="0 0 80 26" preserveAspectRatio="none"><path d="${mkLinea(s, 80, 26, true)} L80,26 L0,26 Z" fill="${col}" opacity=".12"/><path d="${mkLinea(s, 80, 26, true)}" fill="none" stroke="${col}" stroke-width="1.4" vector-effect="non-scaling-stroke"/></svg>`;
    e.dataset.listo = String(s.length);
  });
}

// ---------- Buscador ----------

function mkBuscar(txt) {
  const q = txt.trim();
  document.getElementById("mkQx").style.display = q ? "block" : "none";
  clearTimeout(MK.qTimer);
  if (!q) { document.getElementById("mkRes").innerHTML = ""; return; }
  const seq = ++MK.qSeq;
  MK.qTimer = setTimeout(async () => {
    try {
      const r = await fetch("/api/mercado/buscar?q=" + encodeURIComponent(q), { headers: { Authorization: "Bearer " + sesion.token } });
      const j = await r.json();
      if (seq !== MK.qSeq) return;
      const res = j.resultados || [];
      document.getElementById("mkRes").innerHTML = res.length
        ? res.map(x => `<div class="mk-r" onclick="mkAbrir('${mkEsc(x.t)}','${x.src}')"><span class="mk-ico" style="background:${mkColor(x.t)}">${mkEsc(x.t[0])}</span><span class="mk-t">${mkEsc(x.t)}</span><span class="mk-n">${mkEsc(x.n || x.tipo)}${x.n ? ` <i>· ${mkEsc(x.tipo)}</i>` : ""}</span><span class="mk-mercado">${mkEsc(x.mercado)}${x.mon !== "ARS" ? " · " + mkEsc(x.mon) : ""}</span></div>`).join("")
        : `<div class="mk-r vacio">No encontré nada con “${mkEsc(q)}”.</div>`;
    } catch (e) { /* sin resultados */ }
  }, 220);
}
function mkBuscarSiHay() { /* los resultados no se tocan en cada refresco */ }
function mkLimpiarBusqueda() {
  const q = document.getElementById("mkQ"); q.value = "";
  document.getElementById("mkRes").innerHTML = ""; document.getElementById("mkQx").style.display = "none";
}

// ---------- Ficha con gráfico ----------

async function mkAbrir(t, src) {
  mkLimpiarBusqueda();
  MK.ficha = { t, src, cargando: true, datos: null };
  MK.rango = "1M";
  mkPintarFicha();
  document.getElementById("mkDetalle").scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    const r = await fetch(`/api/mercado/ficha?t=${encodeURIComponent(t)}&src=${encodeURIComponent(src || "")}`, { headers: { Authorization: "Bearer " + sesion.token } });
    const j = await r.json();
    if (!MK.ficha || MK.ficha.t !== t) return;
    MK.ficha = { t, src, cargando: false, datos: j.ok ? j : null, error: j.ok ? "" : (j.error || "No se pudo traer la especie") };
  } catch (e) { MK.ficha = { t, src, cargando: false, datos: null, error: "No se pudo traer la especie" }; }
  mkPintarFicha();
}
function mkCerrarFicha() { MK.ficha = null; document.getElementById("mkDetalle").innerHTML = ""; }
function mkRango(r) { MK.rango = r; mkPintarFicha(); }

const MK_DIAS = { "1S": 7, "1M": 30, "3M": 91, "6M": 182, "1A": 365, Hist: null };
const MK_NOM_RANGO = { "1S": "1 semana", "1M": "1 mes", "3M": "3 meses", "6M": "6 meses", "1A": "1 año", Hist: "histórico" };
function mkPintarFicha() {
  const box = document.getElementById("mkDetalle");
  const F = MK.ficha;
  if (!box || !F) return;
  if (F.cargando) { box.innerHTML = `<section class="mk-card mk-ficha"><p class="mk-vacio">Cargando ${mkEsc(F.t)}…</p></section>`; return; }
  const d = F.datos;
  if (!d) { box.innerHTML = `<section class="mk-card mk-ficha"><button class="mk-x" onclick="mkCerrarFicha()">✕</button><p class="mk-vacio">${mkEsc(F.error || "Sin datos")}</p></section>`; return; }
  const usd = MK.moneda === "USD", k = usd ? 2 : 1, mon = usd ? "USD" : "ARS";
  const it = d.item;
  const precio = usd ? d.usd : d.ars;
  // serie del rango elegido
  let serie = d.serie ? d.serie.map(x => [x[0], x[k]]) : null, cambio = null;
  if (serie && serie.length) {
    const ult = serie[serie.length - 1][0], dias = MK_DIAS[MK.rango];
    if (dias) { const lim = new Date(Date.parse(ult + "T12:00:00Z") - dias * 86400000).toISOString().slice(0, 10); serie = serie.filter(x => x[0] >= lim); }
    if (serie.length > 1) { const a = serie[0][1], b = precio || serie[serie.length - 1][1]; cambio = { abs: b - a, pct: a ? (b / a - 1) * 100 : 0 }; }
  }
  const col = cambio && cambio.abs < 0 ? "neg" : "pos";
  const src = F.src;
  const nativoUsd = it.mon !== "ARS"; // moneda en la que cotiza la especie (BYMA informa apertura, máximo y mínimo en esa moneda)
  const statNum = v => (v == null ? "—" : mkFmt(usd ? (nativoUsd ? v : v / (d.mep || 1)) : (nativoUsd ? v * (d.mep || 1) : v), mon));
  box.innerHTML = `
    <section class="mk-card mk-ficha">
      <div class="mk-fch-cab">
        <div>
          <div class="mk-fch-nom"><span class="mk-ico" style="background:${mkColor(it.t)}">${mkEsc(it.t[0])}</span><b>${mkEsc(it.t)}</b><span class="mk-n">${mkEsc(it.n || it.tipo)} · ${mkEsc(it.tipo)} · ${mkEsc(it.mercado)}</span></div>
          <div class="mk-fch-precio">${mkFmt(precio, mon)}</div>
          ${cambio ? `<div class="mk-fch-var ${col}">${cambio.abs > 0 ? "+" : "−"}${mkFmt(Math.abs(cambio.abs), mon)} (${cambio.pct > 0 ? "+" : ""}${fmtMoney(cambio.pct, 2)}%) <span>${MK_NOM_RANGO[MK.rango]}</span></div>` : `<div class="mk-fch-var"><span>${it.pct > 0 ? "+" : ""}${fmtMoney(it.pct, 2)}% hoy</span></div>`}
        </div>
        <div class="mk-fch-acc"><button class="mk-star ${mkEsFav(it.t, src) ? "on" : ""}" onclick="mkFav('${mkEsc(it.t)}','${src}')">${mkEsFav(it.t, src) ? "★" : "☆"}</button><button class="mk-x" onclick="mkCerrarFicha()">✕</button></div>
      </div>
      ${serie && serie.length > 2 ? `<div class="mk-chart-wrap">${mkGrafico(serie, mon)}<div class="mk-tip" id="mkTip"></div></div>
        <div class="mk-rangos">${Object.keys(MK_DIAS).map(r => `<button class="${MK.rango === r ? "on" : ""}" onclick="mkRango('${r}')">${r}</button>`).join("")}</div>`
        : `<p class="mk-vacio">Esta especie no tiene serie histórica disponible.</p>`}
      <div class="mk-stats">
        <div><span>Apertura</span><b>${statNum(d.ap)}</b></div><div><span>Máximo</span><b>${statNum(d.max)}</b></div>
        <div><span>Mínimo</span><b>${statNum(d.min)}</b></div><div><span>Volumen</span><b>${d.vol ? fmtMoney(d.vol / 1e6, 1) + " M" : "—"}</b></div>
      </div>
      ${d.aprox ? `<p class="mk-nota">Serie en dólares aproximada: precio en pesos al MEP de cada día.</p>` : ""}
    </section>`;
  MK.geo = serie && serie.length > 2 ? { serie, mon } : null;
}

function mkGrafico(serie, mon) {
  const W = 900, H = 250, pl = 6, pr = 6, pt = 24, pb = 26;
  const vals = serie.map(x => x[1]), mn = Math.min(...vals), mx = Math.max(...vals), rg = mx - mn || 1;
  const xs = i => pl + i / (serie.length - 1) * (W - pl - pr), ys = v => pt + (1 - (v - mn) / rg) * (H - pt - pb);
  const pts = vals.map((v, i) => [xs(i), ys(v)]);
  const curva = pts.map((p, i) => i === 0 ? `M${p[0].toFixed(1)},${p[1].toFixed(1)}` : `Q${pts[i - 1][0].toFixed(1)},${pts[i - 1][1].toFixed(1)} ${((p[0] + pts[i - 1][0]) / 2).toFixed(1)},${((p[1] + pts[i - 1][1]) / 2).toFixed(1)}`).join(" ");
  const sube = vals[vals.length - 1] >= vals[0], col = sube ? "var(--green)" : "var(--red)";
  const iMax = vals.indexOf(mx), iMin = vals.indexOf(mn);
  const ticks = 6, lbl = [];
  for (let i = 0; i < ticks; i++) { const idx = Math.round(i * (serie.length - 1) / (ticks - 1)); lbl.push([xs(idx), serie[idx][0]]); }
  const fecha = f => { const [y, m, dd] = f.split("-"); const mes = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"][+m - 1]; return serie.length > 400 ? `${mes} ${y.slice(2)}` : `${+dd} ${mes}`; };
  return `<svg viewBox="0 0 ${W} ${H}" class="mk-chart" onmousemove="mkHover(event)" onmouseleave="mkHoverFin()">
    <defs><linearGradient id="mkGr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".28"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    <line x1="${pl}" x2="${W - pr}" y1="${ys(mx)}" y2="${ys(mx)}" stroke="var(--muted)" stroke-dasharray="2 4" opacity=".5"/>
    <text x="${pl + 2}" y="${ys(mx) - 6}" class="mk-eje">${mkFmt(mx, mon)}</text>
    <path d="${curva} L${pts[pts.length - 1][0].toFixed(1)},${H - pb} L${pts[0][0].toFixed(1)},${H - pb} Z" fill="url(#mkGr)"/>
    <path d="${curva}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round"/>
    <text x="${Math.min(Math.max(xs(iMin), 60), W - 60)}" y="${Math.min(ys(mn) + 16, H - pb - 2)}" text-anchor="middle" class="mk-eje">${mkFmt(mn, mon)}</text>
    <circle cx="${pts[pts.length - 1][0]}" cy="${pts[pts.length - 1][1]}" r="4" fill="${col}"/>
    ${lbl.map(([x, f]) => `<text x="${Math.min(Math.max(x, 22), W - 22)}" y="${H - 6}" text-anchor="middle" class="mk-eje">${fecha(f)}</text>`).join("")}
    <line id="mkGuia" x1="0" x2="0" y1="${pt}" y2="${H - pb}" stroke="var(--muted)" opacity="0" />
    <circle id="mkPunto" r="4" fill="${col}" opacity="0"/>
  </svg>`;
}
function mkHover(ev) {
  const g = MK.geo; if (!g) return;
  const svg = ev.currentTarget, r = svg.getBoundingClientRect();
  const fx = (ev.clientX - r.left) / r.width;
  const i = Math.max(0, Math.min(g.serie.length - 1, Math.round(fx * (g.serie.length - 1))));
  const W = 900, H = 250, pl = 6, pr = 6, pt = 24, pb = 26;
  const vals = g.serie.map(x => x[1]), mn = Math.min(...vals), mx = Math.max(...vals), rg = mx - mn || 1;
  const x = pl + i / (g.serie.length - 1) * (W - pl - pr), y = pt + (1 - (vals[i] - mn) / rg) * (H - pt - pb);
  const guia = document.getElementById("mkGuia"), punto = document.getElementById("mkPunto"), tip = document.getElementById("mkTip");
  guia.setAttribute("x1", x); guia.setAttribute("x2", x); guia.setAttribute("opacity", ".6");
  punto.setAttribute("cx", x); punto.setAttribute("cy", y); punto.setAttribute("opacity", "1");
  const [yy, mm, dd] = g.serie[i][0].split("-");
  tip.textContent = `${dd}/${mm}/${yy} · ${mkFmt(vals[i], g.mon)}`;
  tip.style.display = "block"; tip.style.left = Math.min(Math.max(fx * 100, 12), 88) + "%";
}
function mkHoverFin() {
  ["mkGuia", "mkPunto"].forEach(id => { const e = document.getElementById(id); if (e) e.setAttribute("opacity", "0"); });
  const t = document.getElementById("mkTip"); if (t) t.style.display = "none";
}
