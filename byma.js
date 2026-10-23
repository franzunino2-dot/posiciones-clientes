// Cotizaciones en vivo de BYMA data (open.bymadata.com.ar, API pública "free") más lo que BYMA no tiene:
// acciones de EE.UU. (data912), cripto (CoinGecko) y dólar (dolarapi). Todo se junta en un solo snapshot que
// la pantalla Mercado > Contado consume cada pocos segundos. Se cachea unos segundos para no golpear a BYMA.

const axios = require('axios');
const https = require('https');
const mercado = require('./mercado');

const BASE = 'https://open.bymadata.com.ar/vanoms-be-core/rest/api/bymadata/free';
const HEADERS = {
  'Content-Type': 'application/json', Accept: 'application/json, text/plain, */*',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
  Referer: 'https://open.bymadata.com.ar/', Origin: 'https://open.bymadata.com.ar',
};
const agente = new https.Agent({ rejectUnauthorized: false });
const TTL = 8000;

// Endpoints de BYMA que responden con cuerpo vacío ({}) y lo que trae cada uno.
const FEEDS = {
  lider: 'leading-equity',          // panel líder (Merval)
  general: 'general-equity',        // panel general
  cedears: 'cedears',
  bonos: 'public-bonds',            // bonos soberanos
  letras: 'lebacs',                 // letras del Tesoro
  ons: 'negociable-obligations',
  opciones: 'options',
  indices: 'index-price',
};

const cacheFeed = {};
async function feed(clave) {
  const c = cacheFeed[clave];
  if (c && Date.now() - c.ts < TTL) return c.rows;
  if (c && c.enCurso) return c.enCurso;
  const p = (async () => {
    try {
      const r = await axios.post(`${BASE}/${FEEDS[clave]}`, {}, { headers: HEADERS, timeout: 20000, httpsAgent: agente });
      const rows = Array.isArray(r.data) ? r.data : (r.data && (r.data.data || r.data.content)) || [];
      cacheFeed[clave] = { ts: Date.now(), rows };
      return rows;
    } catch (e) {
      if (cacheFeed[clave]) return cacheFeed[clave].rows;   // BYMA caído: se sirve lo último que se tuvo
      throw e;
    }
  })();
  cacheFeed[clave] = { ...(cacheFeed[clave] || { ts: 0, rows: [] }), enCurso: p };
  try { return await p; } finally { if (cacheFeed[clave]) delete cacheFeed[clave].enCurso; }
}

// Un renglón por símbolo: se prefiere el plazo 24hs ("2") y, si no operó, contado inmediato ("1").
function porSimbolo(rows) {
  const m = {};
  rows.forEach(x => {
    const s = x.symbol;
    if (!s) return;
    const pref = x.settlementType === '2' ? 2 : x.settlementType === '1' ? 1 : 0;
    const act = m[s];
    const opero = (x.trade || 0) > 0;
    if (!act || (opero && !act._opero) || (opero === act._opero && pref > act._pref)) m[s] = { ...x, _pref: pref, _opero: opero };
  });
  return m;
}
function norm(x) {
  const prev = x.previousClosingPrice || x.previousSettlementPrice || 0;
  const ultimo = x.trade || x.settlementPrice || 0;
  const precio = ultimo || x.closingPrice || prev || 0;
  const pct = prev && ultimo ? (ultimo / prev - 1) * 100 : 0;
  return {
    t: x.symbol, p: precio, prev, pct: Math.round(pct * 100) / 100, vol: x.volumeAmount || 0, nom: x.volume || 0,
    bid: x.bidPrice || null, ask: x.offerPrice || null, max: x.tradingHighPrice || null, min: x.tradingLowPrice || null, ap: x.openingPrice || null,
    hora: x.tradeHour || null, mon: x.denominationCcy || 'ARS', venc: x.maturityDate || null,
  };
}

// ---------- Fuentes complementarias ----------
const cacheExt = {};
async function externo(clave, ttl, fn) {
  const c = cacheExt[clave];
  if (c && Date.now() - c.ts < ttl) return c.v;
  try { const v = await fn(); cacheExt[clave] = { ts: Date.now(), v }; return v; }
  catch (e) { return c ? c.v : null; }
}
const dolar = () => externo('dolar', 30000, async () => {
  const r = await axios.get('https://dolarapi.com/v1/dolares', { timeout: 10000 });
  return r.data;
});
const cripto = () => externo('cripto', 60000, async () => {
  const r = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,cardano&vs_currencies=usd&include_24hr_change=true', { timeout: 10000 });
  const nom = { bitcoin: ['BTC', 'Bitcoin'], ethereum: ['ETH', 'Ethereum'], solana: ['SOL', 'Solana'], cardano: ['ADA', 'Cardano'] };
  return Object.entries(r.data).map(([k, v]) => ({ t: nom[k][0], n: nom[k][1], p: v.usd, pct: Math.round((v.usd_24h_change || 0) * 100) / 100 }));
});
// BYMA no informa los Globales ni las letras en su API libre: se completan con las cotizaciones de data912.
const d912 = grupo => externo('d912_' + grupo, 15000, async () => {
  const r = await axios.get('https://data912.com/live/' + grupo, { timeout: 15000 });
  const m = {}; r.data.forEach(x => { m[x.symbol] = x; });
  return m;
});
const USA = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'TSLA', 'AMD', 'NFLX', 'DIS', 'BA', 'PYPL', 'V', 'JPM', 'KO', 'BABA', 'BRK-B', 'INTC', 'MU'];
const accionesUS = () => externo('us', 20000, async () => {
  const r = await axios.get('https://data912.com/live/usa_stocks', { timeout: 15000 });
  const m = {}; r.data.forEach(x => { m[x.symbol] = x; });
  return USA.filter(t => m[t] || m[t.replace('-', '.')]).map(t => { const x = m[t] || m[t.replace('-', '.')]; return { t, p: x.c, pct: x.pct_change, vol: x.v || 0 }; });
});

// Nombres de las especies más comunes; el resto se completa con el nombre que informa Gallo en las carteras.
const NOMBRES = {
  GGAL: 'Galicia', YPFD: 'YPF', PAMP: 'Pampa', BMA: 'Macro', TXAR: 'Ternium', TECO2: 'Telecom', LOMA: 'Loma Negra', SUPV: 'Supervielle',
  ALUA: 'Aluar', BBAR: 'BBVA Argentina', BYMA: 'BYMA', CEPU: 'Central Puerto', COME: 'Comercial del Plata', CRES: 'Cresud', EDN: 'Edenor',
  MIRG: 'Mirgor', TGNO4: 'Transp. Gas del Norte', TGSU2: 'Transp. Gas del Sur', TRAN: 'Transener', VALO: 'Valores', CVH: 'Cablevision Holding',
  HARG: 'Holcim Argentina', IRSA: 'IRSA', METR: 'Metrogas', AGRO: 'Agrometal', A3: 'A3 Mercados', BOLT: 'Boldt', CAPX: 'Capex', DGCU2: 'Distrib. Gas Cuyana',
  GCLA: 'Grupo Clarín', MOLI: 'Molinos', LEDE: 'Ledesma', RICH: 'Laboratorios Richmond', SEMI: 'Molinos Semino', VIST: 'Vista Energy',
  AAPL: 'Apple', MSFT: 'Microsoft', GOOGL: 'Alphabet', AMZN: 'Amazon', META: 'Meta', NVDA: 'Nvidia', TSLA: 'Tesla', AMD: 'AMD', NFLX: 'Netflix',
  DIS: 'Disney', DISN: 'Disney', BA: 'Boeing', PYPL: 'PayPal', V: 'Visa', JPM: 'JP Morgan', KO: 'Coca-Cola', BABA: 'Alibaba', 'BRK-B': 'Berkshire',
  BRKB: 'Berkshire', INTC: 'Intel', MU: 'Micron', MELI: 'MercadoLibre', SPY: 'S&P 500 ETF', QQQ: 'Nasdaq 100 ETF', XOM: 'Exxon Mobil', PBR: 'Petrobras',
  VALE: 'Vale', ITUB: 'Itaú', GLOB: 'Globant', EWZ: 'Brasil ETF', IBIT: 'Bitcoin ETF', SHOP: 'Shopify', UNH: 'UnitedHealth', WMT: 'Walmart', NU: 'Nu Holdings',
  AL29: 'Bonar 2029', AL30: 'Bonar 2030', AL35: 'Bonar 2035', AE38: 'Bonar 2038', AL41: 'Bonar 2041',
  GD29: 'Global 2029', GD30: 'Global 2030', GD35: 'Global 2035', GD38: 'Global 2038', GD41: 'Global 2041', GD46: 'Global 2046',
};
const BONOS_PRINCIPALES = ['AL29', 'AL30', 'AL35', 'AE38', 'GD29', 'GD30', 'GD35', 'GD38', 'GD41', 'GD46'];

let snap = null;
async function snapshot(nombresExtra) {
  if (snap && Date.now() - snap.ts < TTL) return snap.v;
  const [lider, general, cedears, bonos, letras, ons, indices] = await Promise.all(
    ['lider', 'general', 'cedears', 'bonos', 'letras', 'ons', 'indices'].map(k => feed(k).catch(() => []))
  );
  const [dol, cri, us, d9bon, d9let] = await Promise.all([dolar(), cripto(), accionesUS(), d912('arg_bonds'), d912('arg_notes')]);

  const solo = (rows, filtro) => Object.values(porSimbolo(rows.filter(filtro)));
  const ars = x => (x.denominationCcy || 'ARS') === 'ARS';
  const mLider = porSimbolo(lider.filter(ars)), mGeneral = porSimbolo(general.filter(ars));
  const acciones = Object.values(mLider).map(norm).filter(x => x.p > 0).sort((a, b) => b.vol - a.vol);
  const generalAcc = Object.values(mGeneral).map(norm).filter(x => x.p > 0).sort((a, b) => b.vol - a.vol);

  // Cedears: serie en pesos; la serie "D" (dólar MEP) sirve para el modo Dólares.
  const mCed = porSimbolo(cedears);
  const ced = Object.values(mCed)
    .filter(x => ars(x) && x.trade > 0)
    .filter(x => !(/[BCD]$/.test(x.symbol) && mCed[x.symbol.slice(0, -1)] && ars(mCed[x.symbol.slice(0, -1)])))
    .map(x => { const n = norm(x); const d = mCed[x.symbol + 'D']; return { ...n, usd: d && d.trade ? d.trade : null }; })
    .filter(x => x.p > 0)
    .sort((a, b) => b.vol - a.vol);

  // Bonos soberanos: pesos y su serie D (dólar MEP).
  const mBon = porSimbolo(bonos);
  const bon = BONOS_PRINCIPALES.map(t => {
    if (mBon[t]) { const n = norm(mBon[t]); const d = mBon[t + 'D']; return { ...n, usd: d && d.trade ? d.trade : null, venc: mBon[t].maturityDate || null }; }
    const x = d9bon && d9bon[t]; // Globales: data912
    if (!x || !x.c) return null;
    const d = d9bon[t + 'D'];
    return { t, p: x.c, prev: 0, pct: x.pct_change || 0, vol: 0, nom: x.v || 0, bid: x.px_bid || null, ask: x.px_ask || null, max: null, min: null, ap: null, hora: null, mon: 'ARS', usd: d && d.c ? d.c : null, venc: null };
  }).filter(Boolean);
  const bonosTodos = Object.values(mBon).filter(x => ars(x) && !/[CD]$/.test(x.symbol)).map(norm).filter(x => x.p > 0);
  const letrasTodas = Object.values(d9let || {}).filter(x => x.c > 0).map(x => ({ t: x.symbol, p: x.c, prev: 0, pct: x.pct_change || 0, vol: (x.v || 0) * x.c / 100, nom: x.v || 0, bid: x.px_bid || null, ask: x.px_ask || null, max: null, min: null, ap: null, hora: null, mon: 'ARS' })).sort((a, b) => b.vol - a.vol);
  const mOns = porSimbolo(ons);
  const onsTodas = Object.values(mOns).filter(x => ars(x) && /O$/.test(x.symbol)).map(x => { const n = norm(x); const d = mOns[x.symbol.slice(0, -1) + 'D']; return { ...n, usd: d && d.trade ? d.trade : null }; })
    .filter(x => x.p > 0).sort((a, b) => b.vol - a.vol);

  const idx = (indices || []).map(x => ({ t: x.symbol, n: x.description || x.symbol, p: x.trade || x.price || 0, pct: Math.round((x.variation || 0) * 10000) / 100 }));

  const v = {
    ok: true, ts: Date.now(),
    acciones, generalAcc, cedears: ced, bonos: bon, bonosTodos, letras: letrasTodas, ons: onsTodas, indices: idx,
    us: us || [], cripto: cri || [],
    dolar: (dol || []).filter(d => ['oficial', 'blue', 'bolsa', 'contadoconliqui', 'cripto'].includes(d.casa)).map(d => ({ casa: d.casa, nombre: d.nombre, compra: d.compra, venta: d.venta, ts: d.fechaActualizacion })),
    nombres: { ...(nombresExtra || {}), ...NOMBRES },
  };
  snap = { ts: Date.now(), v };
  return v;
}

// Últimos cierres (para el minigráfico de cada fila). Usa las series diarias de data912, guardadas en disco.
async function minigraficos(tickers, dias = 30) {
  const out = {};
  const lista = [...new Set(tickers)].filter(t => /^[A-Za-z0-9.-]{1,10}$/.test(t)).slice(0, 60);
  await Promise.all(lista.map(async t => {
    const s = await mercado.cierresDe(t);
    if (!s) return;
    out[t] = s.fechas.slice(-dias).map(f => s.cierre[f]);
  }));
  return out;
}

// ---------- Buscador y ficha de una especie ----------
// Índice de todo lo que se puede buscar: BYMA (acciones, cedears, bonos, ONs, letras) y EE.UU.
let indiceBusq = { ts: 0, items: [] };
async function indice(nombresExtra) {
  if (Date.now() - indiceBusq.ts < 15000) return indiceBusq.items;
  const [lider, general, cedears, bonos, ons] = await Promise.all(['lider', 'general', 'cedears', 'bonos', 'ons'].map(k => feed(k).catch(() => [])));
  const [usa, adrs, d9let, d9bon] = await Promise.all([d912('usa_stocks'), d912('usa_adrs'), d912('arg_notes'), d912('arg_bonds')]);
  const nombres = { ...(nombresExtra || {}), ...NOMBRES };
  const items = [];
  const nombreDe = t => {
    if (nombres[t]) return nombres[t];
    const base = t.replace(/[CD]$/, '');
    if (base !== t && nombres[base]) return nombres[base] + (/D$/.test(t) ? ' · dólar MEP' : ' · dólar cable');
    return '';
  };
  const sumar = (rows, tipo) => Object.values(porSimbolo(rows)).forEach(x => {
    const n = norm(x);
    items.push({ t: x.symbol, n: nombreDe(x.symbol), tipo, mercado: 'BYMA', mon: n.mon === 'USD' ? 'USD MEP' : n.mon === 'EXT' ? 'USD cable' : 'ARS', p: n.p, pct: n.pct, src: 'byma' });
  });
  sumar(lider, 'Acción local'); sumar(general, 'Acción local'); sumar(cedears, 'Cedear'); sumar(bonos, 'Bono'); sumar(ons, 'ON');
  const vistos = new Set(items.map(i => i.t));
  Object.values(d9bon || {}).forEach(x => { if (x.c > 0 && !vistos.has(x.symbol)) { vistos.add(x.symbol); items.push({ t: x.symbol, n: nombreDe(x.symbol), tipo: 'Bono', mercado: 'BYMA', mon: /D$/.test(x.symbol) ? 'USD MEP' : /C$/.test(x.symbol) ? 'USD cable' : 'ARS', p: x.c, pct: x.pct_change || 0, src: 'd912' }); } });
  Object.values(d9let || {}).forEach(x => { if (x.c > 0 && !vistos.has(x.symbol)) { vistos.add(x.symbol); items.push({ t: x.symbol, n: 'Letra del Tesoro', tipo: 'Letra', mercado: 'BYMA', mon: 'ARS', p: x.c, pct: x.pct_change || 0, src: 'd912' }); } });
  Object.values(usa || {}).forEach(x => { if (x.c > 0) items.push({ t: x.symbol, n: nombres[x.symbol] || '', tipo: 'Acción EE.UU.', mercado: 'EE.UU.', mon: 'USD', p: x.c, pct: x.pct_change || 0, src: 'us' }); });
  Object.values(adrs || {}).forEach(x => { if (x.c > 0) items.push({ t: x.symbol, n: (nombres[x.symbol] || '') , tipo: 'ADR', mercado: 'NYSE / NASDAQ', mon: 'USD', p: x.c, pct: x.pct_change || 0, src: 'us', adr: true }); });
  indiceBusq = { ts: Date.now(), items };
  return items;
}

async function buscar(q, nombresExtra) {
  const txt = String(q || '').trim().toUpperCase();
  if (!txt) return [];
  const items = await indice(nombresExtra);
  const puntaje = it => {
    const t = it.t.toUpperCase(), n = (it.n || '').toUpperCase();
    if (t === txt) return 0;
    if (t.startsWith(txt)) return 1 + (it.mon === 'ARS' || it.src === 'us' ? 0 : 0.5) + (t.length - txt.length) * 0.01;
    if (n.includes(txt)) return 3;
    return null;
  };
  return items.map(it => ({ it, s: puntaje(it) })).filter(x => x.s !== null)
    .sort((a, b) => a.s - b.s || (b.it.pct !== 0) - (a.it.pct !== 0)).slice(0, 12).map(x => x.it);
}

// Ficha de una especie: cotización, apertura, máximo, mínimo, volumen y serie diaria en pesos y en dólares.
async function ficha(t, src, nombresExtra) {
  const items = await indice(nombresExtra);
  const it = items.find(x => x.t === t && (src ? x.src === src || (src === 'byma' && x.src === 'd912') : true)) || items.find(x => x.t === t);
  if (!it) return null;
  const mep = await mercado.mepSerie();
  const hoyMep = mercado.mepEn(mep, new Date().toISOString().slice(0, 10));
  let stats = { ap: null, max: null, min: null, prev: null, vol: null, hora: null };
  // Datos del día: BYMA los informa por plazo; se toma el mismo renglón que usa el listado.
  const FEED = { 'Acción local': ['lider', 'general'], Cedear: ['cedears'], Bono: ['bonos'], ON: ['ons'] };
  for (const f of FEED[it.tipo] || []) {
    const m = porSimbolo(await feed(f).catch(() => []));
    if (m[t]) { const n = norm(m[t]); stats = { ap: n.ap, max: n.max, min: n.min, prev: n.prev, vol: n.vol, hora: n.hora }; break; }
  }
  // Serie diaria
  let serie = null, aprox = false, origenMon = it.mon === 'ARS' ? 'ARS' : 'USD';
  if (it.src === 'us') {
    const s = await mercado.cierresDe(t, 'us');
    if (s) serie = s.fechas.map(f => [f, s.cierre[f]]);
  } else {
    let s = await mercado.cierresDe(t);
    if (!s && /[CD]$/.test(t)) { // serie en dólares sin histórico propio: se aproxima con la de pesos al MEP de cada día
      const base = await mercado.cierresDe(t.slice(0, -1));
      if (base) { aprox = true; serie = base.fechas.map(f => [f, base.cierre[f] / mercado.mepEn(mep, f)]); origenMon = 'USD'; }
    }
    if (s) serie = s.fechas.map(f => [f, s.cierre[f]]);
  }
  if (serie && serie.length > 1500) { // se achica lo más viejo para no mandar décadas de días
    const viejo = serie.slice(0, serie.length - 600), nuevo = serie.slice(-600), paso = Math.ceil(viejo.length / 700);
    serie = viejo.filter((_, i) => i % paso === 0).concat(nuevo);
  }
  const conv = serie ? serie.map(([f, v]) => origenMon === 'ARS' ? [f, v, v / mercado.mepEn(mep, f)] : [f, v * mercado.mepEn(mep, f), v]) : null; // [fecha, ARS, USD]
  const dolarHoy = origenMon === 'ARS' ? it.p / hoyMep : it.p;
  const pesosHoy = origenMon === 'ARS' ? it.p : it.p * hoyMep;
  return { ok: true, item: it, mep: hoyMep, ars: pesosHoy, usd: dolarHoy, ...stats, serie: conv, aprox };
}

module.exports = { snapshot, minigraficos, buscar, ficha };
