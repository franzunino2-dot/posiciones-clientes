// Mercado > Mapa: mapa de calor. Cada cuadrado es una especie: el tamaño es lo operado en la rueda y el color es la
// variación del día. Tres mapas: S&P 500 por sector (tamaño = capitalización), acciones del Merval y cedears.

const MP = { modo: "sp500", timer: null, resize: null, sp: null, spTs: 0 };

// Color según la variación del día: verde hacia +3%, rojo hacia -3%, tono oscuro cerca de 0.
function mpColor(p) {
  const c = Math.max(-3, Math.min(3, p)), t = Math.abs(c) / 3;
  const mez = (a, b) => a.map((x, i) => Math.round(x + (b[i] - x) * t));
  const rgb = c >= 0 ? mez([20, 88, 60], [47, 207, 147]) : mez([106, 53, 43], [238, 106, 88]);
  return `rgb(${rgb.join(",")})`;
}

// Treemap "squarified": reparte el rectángulo entre los valores manteniendo los cuadrados lo más parecidos a cuadrados posible.
function mpDistribuir(items, x, y, w, h) {
  const total = items.reduce((a, i) => a + i.v, 0);
  if (!total || !items.length) return [];
  const esc = (w * h) / total, nodos = items.map(i => ({ ...i, area: i.v * esc }));
  const salida = [];
  const peor = (fila, lado) => {
    const s = fila.reduce((a, n) => a + n.area, 0), mx = Math.max(...fila.map(n => n.area)), mn = Math.min(...fila.map(n => n.area));
    return Math.max(lado * lado * mx / (s * s), (s * s) / (lado * lado * mn));
  };
  let rx = x, ry = y, rw = w, rh = h, fila = [];
  const colocar = () => {
    const s = fila.reduce((a, n) => a + n.area, 0);
    if (rw >= rh) { // fila vertical a la izquierda
      const fw = s / rh; let yy = ry;
      fila.forEach(n => { const nh = n.area / fw; salida.push({ ...n, x: rx, y: yy, w: fw, h: nh }); yy += nh; });
      rx += fw; rw -= fw;
    } else { // fila horizontal arriba
      const fh = s / rw; let xx = rx;
      fila.forEach(n => { const nw = n.area / fh; salida.push({ ...n, x: xx, y: ry, w: nw, h: fh }); xx += nw; });
      ry += fh; rh -= fh;
    }
    fila = [];
  };
  nodos.forEach(n => {
    const lado = Math.min(rw, rh);
    if (!fila.length || peor([...fila, n], lado) <= peor(fila, lado)) fila.push(n);
    else { colocar(); fila.push(n); }
  });
  if (fila.length) colocar();
  return salida;
}

function mpItems() {
  const d = MK.data;
  if (!d) return [];
  if (MP.modo === "merval") return d.acciones.filter(r => r.vol > 0).slice(0, 40).map(r => ({ t: r.t, pct: r.pct, v: r.vol, p: r.p, mon: "ARS", src: "byma" }));
  if (MP.modo === "cedears") return d.cedears.filter(r => r.vol > 0).slice(0, 90).map(r => ({ t: r.t, pct: r.pct, v: r.vol, p: r.p, mon: "ARS", src: "byma" }));
  return [];
}

const MP_TEXTO = {
  merval: "Acciones del Merval · tamaño = volumen operado en pesos · color = % del día",
  cedears: "Cedears más operados · tamaño = volumen operado en pesos · color = % del día",
  sp500: "S&P 500 · por sector · tamaño = capitalización de mercado · color = % del día",
};

function renderMapa() {
  const el = document.getElementById("view-mapa");
  if (!el.querySelector("#mpCont")) {
    el.innerHTML = `
      <div class="mk-cab">
        <div><span class="mk-sup">MAPA DE CALOR</span><h1>Mapa</h1><span class="mk-sub" id="mpEdad">Cargando…</span></div>
        <div class="mk-mon"><button data-m="sp500" onclick="mpModo('sp500')">S&amp;P 500</button><button data-m="merval" onclick="mpModo('merval')">Merval</button><button data-m="cedears" onclick="mpModo('cedears')">Cedears</button></div>
      </div>
      <p class="mk-sub" id="mpTexto" style="margin:0 0 10px"></p>
      <div class="mp-caja">
        <div class="mp-leyenda">${[3, 2, 1, 0, -1, -2, -3].map(p => `<span><i style="background:${mpColor(p)}"></i>${p > 0 ? "+" : ""}${p}%</span>`).join("")}</div>
        <div id="mpCont" class="mp-cont"></div>
      </div>`;
    window.addEventListener("resize", () => { clearTimeout(MP.resize); MP.resize = setTimeout(() => { if (vistaActual === "mapa") mpPintar(); }, 150); });
  }
  mpPintar();
  if (MP.modo === "sp500") mpCargarSP();
  mkCargar().then(() => { if (vistaActual === "mapa" && MP.modo !== "sp500") mpPintar(); });
  if (!MP.timer) MP.timer = setInterval(() => {
    if (vistaActual !== "mapa") return;
    if (MP.modo === "sp500") mpCargarSP(); else mkCargar().then(() => { if (vistaActual === "mapa") mpPintar(); });
  }, 15000);
}

function mpModo(m) { MP.modo = m; if (m === "sp500") mpCargarSP(); mpPintar(); }

async function mpCargarSP() {
  if (!sesion || !sesion.token || (MP.sp && Date.now() - MP.spTs < 15000)) return;
  try {
    const r = await fetch("/api/mercado/sp500", { headers: { Authorization: "Bearer " + sesion.token } });
    const j = await r.json();
    if (j.ok) { MP.sp = j; MP.spTs = Date.now(); if (vistaActual === "mapa" && MP.modo === "sp500") mpPintar(); }
  } catch (e) { /* queda lo último */ }
}

// S&P 500: primero se reparte el rectángulo entre los sectores (según su peso) y después, dentro de cada sector, entre sus empresas.
function mpTilesSP(W, H) {
  const items = (MP.sp && MP.sp.items) || [];
  const porSector = {};
  items.forEach(i => { (porSector[i.sector] = porSector[i.sector] || []).push(i); });
  const sectores = Object.entries(porSector).map(([n, l]) => ({ n, v: l.reduce((a, i) => a + i.peso, 0), l })).sort((a, b) => b.v - a.v);
  const tiles = [], etiquetas = [];
  mpDistribuir(sectores, 0, 0, W, H).forEach(sec => {
    const conTitulo = sec.h > 44 && sec.w > 70, tope = conTitulo ? 16 : 0;
    if (conTitulo) etiquetas.push({ n: sec.n, x: sec.x, y: sec.y, w: sec.w });
    mpDistribuir(sec.l.map(i => ({ ...i, v: i.peso })).sort((a, b) => b.v - a.v), sec.x, sec.y + tope, sec.w, sec.h - tope).forEach(n => {
      tiles.push({ t: n.t, pct: n.pct, p: n.p, mon: "USD", src: "us", x: n.x, y: n.y, w: n.w, h: n.h, nombre: n.n });
    });
  });
  return { tiles, etiquetas };
}

function mpPintar() {
  const cont = document.getElementById("mpCont");
  if (!cont) return;
  document.querySelectorAll("#view-mapa .mk-mon button").forEach(b => { b.className = b.dataset.m === MP.modo ? "on" : ""; });
  document.getElementById("mpTexto").textContent = MP_TEXTO[MP.modo];
  const e = document.getElementById("mpEdad");
  if (e && MK.ts) e.textContent = "Actualizado hace " + Math.max(0, Math.round((Date.now() - MK.ts) / 1000)) + "s";
  const W = cont.clientWidth || 1000, H = Math.max(440, Math.min(640, Math.round(W * 0.47)));
  const nombres = (MK.data && MK.data.nombres) || {};
  let tiles, etiquetas = [];
  if (MP.modo === "sp500") {
    if (!MP.sp) { cont.style.height = "120px"; cont.innerHTML = `<p class="mk-vacio" style="padding:20px">Cargando el S&amp;P 500…</p>`; mpCargarSP(); return; }
    ({ tiles, etiquetas } = mpTilesSP(W, H));
    const e2 = document.getElementById("mpEdad");
    if (e2) e2.textContent = "Composición al " + MP.sp.fecha + " · precios actualizados hace " + Math.max(0, Math.round((Date.now() - MP.spTs) / 1000)) + "s";
  } else {
    const items = mpItems().sort((a, b) => b.v - a.v);
    if (!items.length) { cont.innerHTML = `<p class="mk-vacio" style="padding:20px">Sin datos de la rueda todavía.</p>`; return; }
    tiles = mpDistribuir(items, 0, 0, W, H);
  }
  cont.style.height = H + "px";
  const sectoresHtml = etiquetas.map(e => `<div class="mp-sec" style="left:${e.x + 3}px;top:${e.y + 1}px;width:${e.w - 6}px">${mkEsc(e.n)}</div>`).join("");
  cont.innerHTML = sectoresHtml + tiles.map(n => {
    const chico = n.w < 46 || n.h < 30, mediano = n.w < 80 || n.h < 50;
    const fuente = Math.max(10, Math.min(22, Math.sqrt(n.w * n.h) / 7));
    const pct = `${n.pct > 0 ? "+" : ""}${fmtMoney(n.pct, 2)}%`;
    const tip = `${n.t}${(n.nombre || nombres[n.t]) ? " · " + (n.nombre || nombres[n.t]) : ""} · ${n.mon === "USD" ? "USD " : "$ "}${fmtMoney(n.p, n.p < 100 ? 2 : 0)} · ${pct}`;
    return `<div class="mp-t" title="${mkEsc(tip)}" onclick="mpAbrir('${mkEsc(n.t)}','${n.src}')" style="left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px;background:${mpColor(n.pct)}">
      ${chico ? "" : `<b style="font-size:${fuente}px">${mkEsc(n.t)}</b>${mediano ? "" : `<span style="font-size:${Math.max(10, fuente * .62)}px">${pct}</span>`}`}</div>`;
  }).join("");
}

function mpAbrir(t, src) {
  irAVista("mercado");
  setTimeout(() => mkAbrir(t, src), 60);
}
