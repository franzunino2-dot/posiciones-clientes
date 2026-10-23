// Composición del S&P 500 para el mapa de calor:
//   · pesos: tenencias diarias del ETF SPY de State Street (el peso de cada empresa es proporcional a su capitalización)
//   · sectores GICS: lista de Wikipedia
//   · precio y variación del día: data912 (acciones de EE.UU.)
// La composición cambia poco: se baja una vez por día y se guarda en mercado/sp500.json.

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const XLSX = require('./vendor/xlsx.full.min.js');

const ARCHIVO = path.join(__dirname, 'mercado', 'sp500.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';
const URL_SPY = 'https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/holdings-daily-us-en-spy.xlsx';
const URL_WIKI = 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies';
const SECTORES = {
  'Information Technology': 'Tecnología', 'Health Care': 'Salud', Financials: 'Financieras', 'Consumer Discretionary': 'Consumo discrecional',
  'Communication Services': 'Comunicaciones', Industrials: 'Industriales', 'Consumer Staples': 'Consumo básico', Energy: 'Energía',
  Utilities: 'Servicios públicos', 'Real Estate': 'Inmobiliarias', Materials: 'Materiales',
};
const clave = t => String(t || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const limpiar = h => h.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&#\d+;/g, '').replace(/\s+/g, ' ').trim();

async function bajarComposicion() {
  const [spy, wiki] = await Promise.all([
    axios.get(URL_SPY, { responseType: 'arraybuffer', timeout: 40000, headers: { 'User-Agent': UA } }),
    axios.get(URL_WIKI, { responseType: 'text', timeout: 40000, headers: { 'User-Agent': UA } }),
  ]);
  // Sectores desde la tabla "constituents" de Wikipedia: símbolo, empresa, sector GICS.
  const sectores = {}, nombres = {};
  const tabla = String(wiki.data).split('id="constituents"')[1] || '';
  (tabla.split('</table>')[0].split('<tr').slice(2)).forEach(tr => {
    const celdas = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => limpiar(m[1]));
    if (celdas.length >= 3 && celdas[0]) { sectores[clave(celdas[0])] = celdas[2]; nombres[clave(celdas[0])] = celdas[1]; }
  });
  // Pesos desde las tenencias de SPY.
  const wb = XLSX.read(Buffer.from(spy.data));
  const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
  const fecha = ((filas.find(r => r && /^Holdings/.test(r[0] || '')) || [])[1] || '').replace(/^As of\s*/i, '');
  const hi = filas.findIndex(r => r && r[0] === 'Name');
  const items = filas.slice(hi + 1).filter(r => r[1] && Number(r[4]) > 0 && sectores[clave(r[1])]).map(r => ({
    t: String(r[1]).trim(), k: clave(r[1]), n: nombres[clave(r[1])] || String(r[0]), peso: Number(r[4]), sector: SECTORES[sectores[clave(r[1])]] || sectores[clave(r[1])],
  }));
  if (items.length < 300) throw new Error('La composición del S&P 500 vino incompleta');
  return { ts: Date.now(), fecha, items };
}

let mem = null;
async function composicion() {
  if (mem && Date.now() - mem.ts < 20 * 3600000) return mem;
  try { const g = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8')); if (Date.now() - g.ts < 20 * 3600000) { mem = g; return mem; } } catch (e) { /* sin copia */ }
  try {
    mem = await bajarComposicion();
    fs.mkdirSync(path.dirname(ARCHIVO), { recursive: true });
    fs.writeFileSync(ARCHIVO, JSON.stringify(mem));
  } catch (e) {
    if (!mem) { try { mem = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8')); } catch (e2) { throw e; } }
  }
  return mem;
}

// precios: mapa data912 { SIMBOLO: { c, pct_change } }
async function mapa(precios) {
  const comp = await composicion();
  const porClave = {};
  Object.values(precios || {}).forEach(x => { porClave[clave(x.symbol)] = x; });
  const items = comp.items.map(i => {
    const x = porClave[i.k];
    return { t: i.t, n: i.n, sector: i.sector, peso: i.peso, p: x ? x.c : null, pct: x && x.pct_change != null ? x.pct_change : null };
  }).filter(i => i.pct != null && i.p > 0);
  return { ok: true, ts: Date.now(), fecha: comp.fecha, items };
}

module.exports = { mapa };
