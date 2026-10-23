// Datos de mercado para calcular el resultado por período:
//   · dólar MEP diario (argentinadatos.com)
//   · cierres diarios por especie (data912.com: acciones, cedears y bonos)
// Todo se guarda en mercado/ (gitignored) para no pedirlo de nuevo en cada consulta.

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const DIR = path.join(__dirname, 'mercado');
const VIGENCIA_MS = 10 * 3600 * 1000;      // las series y el MEP se vuelven a bajar a las 10 horas
const NEGATIVO_MS = 24 * 3600 * 1000;      // una especie sin serie no se vuelve a buscar por un día
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', Accept: 'application/json' };

fs.mkdirSync(DIR, { recursive: true });
const leer = f => { try { return JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (e) { return null; } };
const guardar = (f, v) => { try { fs.writeFileSync(path.join(DIR, f), JSON.stringify(v)); } catch (e) { /* ignorar */ } };

// ---------- Dólar MEP ----------
let mepMem = null;
async function mepSerie() {
  if (mepMem && Date.now() - mepMem.ts < VIGENCIA_MS) return mepMem;
  let guardada = leer('_mep.json');
  if (guardada && Date.now() - guardada.ts < VIGENCIA_MS) { mepMem = guardada; return mepMem; }
  try {
    const r = await axios.get('https://api.argentinadatos.com/v1/cotizaciones/dolares/bolsa', { timeout: 20000, headers: HEADERS });
    const dias = {};
    r.data.forEach(x => { if (x.fecha && x.compra && x.venta) dias[x.fecha] = (x.compra + x.venta) / 2; });
    mepMem = { ts: Date.now(), dias, orden: Object.keys(dias).sort() };
    guardar('_mep.json', mepMem);
  } catch (e) {
    if (guardada) mepMem = guardada;       // sin conexión: se usa la última copia
    else throw e;
  }
  return mepMem;
}
// MEP de un día (o del último día anterior con cotización).
function mepEn(serie, fecha) {
  if (serie.dias[fecha]) return serie.dias[fecha];
  let ult = serie.orden[0];
  for (const f of serie.orden) { if (f <= fecha) ult = f; else break; }
  return serie.dias[ult];
}

// ---------- Cierres diarios por especie ----------
const GRUPOS = ['stocks', 'cedears', 'bonds'];
const enCurso = {};
// Devuelve { fechas: [...ordenadas], cierre: { fecha: precio } } o null si data912 no tiene la especie.
async function cierresDe(ticker, origen = 'ar') {
  const t = String(ticker || '').trim();
  if (!t || /[^A-Za-z0-9.$]/.test(t)) return null;
  const archivo = (origen === 'us' ? 'hu_' : 'h_') + t.replace(/[^A-Za-z0-9]/g, '_') + '.json';
  const g = leer(archivo);
  if (g && Date.now() - g.ts < (g.fechas ? VIGENCIA_MS : NEGATIVO_MS)) return g.fechas ? g : null;
  const clave = origen + ':' + t;
  if (enCurso[clave]) return enCurso[clave];
  enCurso[clave] = (async () => {
    try {
      if (origen === 'us') {
        try {
          const r = await axios.get('https://data912.com/historical/usa_stocks/' + encodeURIComponent(t), { timeout: 15000, headers: HEADERS });
          const cierre = {};
          (r.data.dates || []).forEach((f, i) => { const c = r.data.prices[i]; if (c > 0) cierre[f] = c; });
          const fechas = Object.keys(cierre).sort();
          if (fechas.length) { const out = { ts: Date.now(), grupo: 'usa_stocks', fechas, cierre }; guardar(archivo, out); return out; }
        } catch (e) { /* sin serie */ }
        guardar(archivo, { ts: Date.now(), fechas: null });
        return null;
      }
      for (const grupo of GRUPOS) {
        try {
          const r = await axios.get(`https://data912.com/historical/${grupo}/${encodeURIComponent(t)}`, { timeout: 15000, headers: HEADERS });
          if (!Array.isArray(r.data) || !r.data.length) continue;
          const cierre = {};
          r.data.forEach(x => { if (x && x.date && x.c != null && x.c > 0) cierre[x.date] = x.c; });
          const fechas = Object.keys(cierre).sort();
          if (!fechas.length) continue;
          const out = { ts: Date.now(), grupo, fechas, cierre };
          guardar(archivo, out);
          return out;
        } catch (e) { /* siguiente grupo */ }
      }
      guardar(archivo, { ts: Date.now(), fechas: null });
      return null;
    } finally { delete enCurso[clave]; }
  })();
  return enCurso[clave];
}
// Último cierre de la serie con fecha <= la pedida (con la fecha a la que corresponde).
function cierreEn(serie, fecha) {
  if (!serie) return null;
  let lo = 0, hi = serie.fechas.length - 1, mejor = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (serie.fechas[m] <= fecha) { mejor = m; lo = m + 1; } else hi = m - 1; }
  if (mejor < 0) return null;
  const f = serie.fechas[mejor];
  return { fecha: f, precio: serie.cierre[f] };
}

module.exports = { mepSerie, mepEn, cierresDe, cierreEn };
