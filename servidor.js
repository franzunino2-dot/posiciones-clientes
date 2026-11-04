'use strict';
// Siempre el .env de ESTA carpeta.
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

// ═══════════════════════════════════════════════════════════════════════════════
// POSICIONES DE CLIENTES — backend local que conecta a Gallo/EGWS.
//
// Gallo vive en una IP privada de la oficina (192.168.1.107) — este servidor SOLO
// funciona corrido desde una máquina que llegue a esa red. Fuera de la oficina (ej.
// la versión pública de GitHub Pages) el front end sigue andando en "modo demo" con
// los datos estáticos de data.js — ver comentario en app.js.
//
// Reutiliza el mismo patrón de conexión a Gallo que ../rentafija/servidor.js (login
// multipart + token, form-data en cada llamada). Para no pedirle dos veces lo mismo
// a Gallo, la tenencia detallada (PortafolioReducido) se LEE del archivo que ya
// mantiene actualizado el crawler de rentafija (gallo_portafolios.json) en vez de
// pedirla de nuevo acá — si ese archivo no existe (rentafija nunca corrió en esta
// máquina), esta app sigue funcionando pero sin posiciones (ver /api/estado).
// ═══════════════════════════════════════════════════════════════════════════════

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const axios = require('axios');
const https = require('https');

const app = express();
const PORT = Number(process.env.PORT || 5501);
// Los mails llevan adjuntos en base64: esas rutas tienen su propio parser con más límite (ver mails.js).
app.use((req, res, next) => (req.path.startsWith('/api/mails/') ? next() : express.json()(req, res, next)));
// Archivos estáticos: SOLO lo que la página necesita. Todo lo demás de la carpeta (datos de comitentes, sesiones y
// archivos de trabajo en mercado/ e historial/, código del servidor, logs, scripts de arranque, .env, .git) no se
// sirve nunca: los datos van por la API, con sesión. Se decide por lista de permitidos y no de prohibidos porque
// Windows acepta variantes del nombre (mayúsculas, nombres cortos, puntos al final) que una lista negra no cubre.
const JS_PUBLICOS = new Set(['app', 'alyc', 'perfil', 'manager', 'resultado', 'mercado-ui', 'mapa-ui', 'fondos-ui', 'calendario-ui', 'mails-ui', 'cliente', 'data', 'importar', 'logo-eq']);
const EXT_PUBLICAS = new Set(['.html', '.css', '.png', '.jpg', '.jpeg', '.svg', '.ico', '.webp', '.woff', '.woff2']);
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  let ruta;
  try { ruta = decodeURIComponent(req.path); } catch (e) { return res.status(400).end(); }
  if (ruta === '/' || ruta.includes('..') || ruta.includes('\\') || ruta.includes(':')) return ruta === '/' ? next() : res.status(404).end();
  const m = ruta.toLowerCase().match(/^\/(?:vendor\/)?([^/]+?)(\.[a-z0-9]+)$/);
  const ok = m && ((ruta.toLowerCase().startsWith('/vendor/') && m[2] === '.js')
    || (!ruta.slice(1).includes('/') && (EXT_PUBLICAS.has(m[2]) || (m[2] === '.js' && JS_PUBLICOS.has(m[1])) || ruta.toLowerCase() === '/pagos.json')));
  return ok ? next() : res.status(404).end();
});
app.use(express.static(__dirname, { dotfiles: 'deny' }));

// ---------- Conexión a Gallo (EGWS) ----------

const GALLO_BASE = process.env.GALLO_BASE || '';
const GALLO_USER = process.env.GALLO_USER || '';
const GALLO_PASS = process.env.GALLO_PASS || '';
const GALLO_ON = !!(GALLO_BASE && GALLO_USER && GALLO_PASS);
const GALLO_WS = '/' + String(process.env.GALLO_WS || 'ws').replace(/^\/+|\/+$/g, '');
const APP_PASSWORD = process.env.APP_PASSWORD || '091218';
// Admin (ve todos los comitentes): SOLO si se define ADMIN_EMAIL en .env. Por defecto no hay admin:
// cada productor ve únicamente los comitentes que Gallo le asigna (Manager).
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase();
// Acceso de comitentes: por ahora apagado (solo entran managers y la ALyC). Se prende con CLIENTES_HABILITADOS=1 en .env.
const CLIENTES_HABILITADOS = ['1', 'true', 'si'].includes(String(process.env.CLIENTES_HABILITADOS || '').toLowerCase());
// Si se define, solo entran los comitentes de esos managers (códigos separados por coma). Vacío = todos.
const CLIENTES_MANAGERS = String(process.env.CLIENTES_MANAGERS || '').split(',').map(s => s.trim()).filter(Boolean);
// Usuario de la ALyC (ve todos los comitentes y productores): se define con ALYC_USER en .env. Mismo APP_PASSWORD.
const ALYC_USER = (process.env.ALYC_USER || '').trim().toLowerCase();
// Productores cuyo mail no figura en la lista de Managers de Gallo: "mail=códigoManager;mail=código".
const PRODUCTOR_EMAILS = {};
String(process.env.PRODUCTOR_EMAILS || '').split(';').forEach(p => { const [m, c] = p.split('='); if (m && c) PRODUCTOR_EMAILS[m.trim().toLowerCase()] = c.trim(); });

const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const gallo = GALLO_BASE ? axios.create({ baseURL: GALLO_BASE.replace(/\/$/, ''), timeout: 30000, httpsAgent }) : null;

let galloTok = { value: null, exp: 0 };
function galloForm(fields) {
  const b = '----gallo' + Math.random().toString(36).slice(2) + Date.now();
  let s = '';
  for (const [k, v] of Object.entries(fields)) { if (v == null) continue; s += `--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`; }
  s += `--${b}--\r\n`;
  return { body: s, ct: 'multipart/form-data; boundary=' + b };
}
async function galloLogin(force = false, _intentos = 3) {
  if (!GALLO_ON) throw new Error('Gallo no configurado (faltan GALLO_BASE/GALLO_USER/GALLO_PASS en .env)');
  if (!force && galloTok.value && Date.now() < galloTok.exp) return galloTok.value;
  const mp = galloForm({ user: GALLO_USER, passwd: GALLO_PASS });
  const r = await gallo.post(GALLO_WS + '/Login', mp.body, { headers: { 'Content-Type': mp.ct } });
  const tok = r.data?.Token || r.data?.token || r.data?.Resultado?.Token;
  if (!tok) {
    // Gallo es intermitente al loguearse justo después de reiniciar el proceso — a veces choca
    // con una sesión previa todavía viva del lado de ellos ("Duplicate entry ... PRIMARY").
    // Reintenta unas pocas veces con backoff antes de darse por vencido.
    if (_intentos > 1 && /duplicate entry/i.test(r.data?.Error || '')) {
      await new Promise(res => setTimeout(res, 1500));
      return galloLogin(true, _intentos - 1);
    }
    throw new Error('Login Gallo sin Token: ' + JSON.stringify(r.data).slice(0, 200));
  }
  galloTok = { value: tok, exp: Date.now() + 5 * 3600 * 1000 };
  return tok;
}
// Nota: algunos nombres de comitentes vienen con un � (U+FFFD) donde debería ir una tilde/ñ
// (ej. "GALV�N") — se probó forzar latin1 en la respuesta y empeoró (mojibake de 3 caracteres
// en vez de uno), lo que confirma que el byte original YA es un reemplazo inválido: es una
// corrupción que ya existe en la base de datos de Gallo, no algo recuperable desde acá.
async function galloPost(metodo, body = {}) {
  let tok = await galloLogin();
  const exec = t => { const mp = galloForm({ user: GALLO_USER, ...body }); return gallo.post(GALLO_WS + '/' + metodo, mp.body, { headers: { 'Content-Type': mp.ct, token: t, Token: t } }); };
  let r;
  try { r = await exec(tok); }
  catch (e) { if (!(e.response && [401, 403].includes(e.response.status))) throw e; tok = await galloLogin(true); r = await exec(tok); }
  if (r.data && r.data.IsOK === false && /token/i.test(r.data.Error || '')) { tok = await galloLogin(true); r = await exec(tok); }
  return r.data;
}
const galloResultado = x => (x && (x.Resultado || x.resultado)) || {};
const num = v => { const n2 = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n2) ? n2 : 0; };

// ---------- Identidad (GetClientes + Manager) — quién es quién por email ----------
// Cache corto: esto define quién puede entrar y qué ve, así que se refresca seguido.

let identidadCache = { clientes: [], managers: [], exp: 0 };
// Última lista de managers que Gallo contestó bien: si al arrancar no la da (pasa cuando el crawler de rentafija
// inicia sesión justo en el medio), nadie con mail de manager podría entrar hasta el próximo reinicio.
const MANAGERS_FILE = path.join(__dirname, 'mercado', 'managers.json');
try { identidadCache.managers = JSON.parse(fs.readFileSync(MANAGERS_FILE, 'utf8')); } catch (e) { /* primera vez */ }
async function getIdentidad() {
  if (Date.now() < identidadCache.exp && identidadCache.clientes.length) return identidadCache;
  // Gallo es intermitente: una respuesta vacía o con error NO se cachea (antes quedaba "0
  // comitentes" fijado 10 minutos). Se reintenta, y si no hay nada se avisa en vez de mostrar vacío.
  for (let intento = 0; intento < 3; intento++) {
    const [cliR, mgrR] = await Promise.allSettled([galloPost('GetClientes', {}), galloPost('Manager', {})]);
    const clientes = cliR.status === 'fulfilled' ? (galloResultado(cliR.value).Clientes || []) : [];
    const mgrs = mgrR.status === 'fulfilled' ? (galloResultado(mgrR.value).Manager || []) : [];
    if (clientes.length && !mgrs.length && intento < 2) { await new Promise(r => setTimeout(r, 1500)); continue; }
    if (clientes.length) {
      if (mgrs.length) { try { fs.mkdirSync(path.dirname(MANAGERS_FILE), { recursive: true }); fs.writeFileSync(MANAGERS_FILE, JSON.stringify(mgrs)); } catch (e) { /* ignorar */ } }
      identidadCache = { clientes, managers: mgrs.length ? mgrs : identidadCache.managers, exp: Date.now() + (mgrs.length ? 10 : 1) * 60000 };
      return identidadCache;
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  if (identidadCache.clientes.length) return identidadCache; // sirve lo último bueno antes que nada
  throw new Error('Gallo no respondió (GetClientes vacío o con error). Reintentá en unos segundos.');
}

// ---------- Tenencia detallada por comitente ----------
// Se lee del archivo que mantiene actualizado ../rentafija/servidor.js (mismo Gallo,
// evita pedirle lo mismo dos veces desde dos procesos distintos).

const PORTAFOLIO_FILE = path.join(__dirname, '..', 'rentafija', 'gallo_portafolios.json');
// Historial completo de cada cuenta (CtaCte + CtaCteMonedaExt de Gallo): actividad y ganancias realizadas.
const historial = require('./historial').crearHistorial({ galloPost, listarComitentes: async () => Object.keys(leerPortafolios()) });
// Posición en vivo: al abrir una cuenta se le pide a Gallo su portafolio en el momento y se usa por encima
// de la última bajada del crawler (que refresca cada cuenta cada ~45 minutos).
const portafolioFresco = {}; // código -> { activos, resumen, ts }
// Cronograma de pagos de un título (por 100 VN): el mismo que usa la vista del cliente para el calendario.
async function cronogramaDe(t) {
  const P = await cargarPagos();
  if (!P) return null;
  const T = String(t).toUpperCase();
  const base = 'DCO'.includes(T.slice(-1)) && !/\d/.test(T.slice(-1)) ? T.slice(0, -1) : T;
  const b = P.bonistas || {}, o = P.ons || {};
  const deB = arr => arr.map(f => ({ fecha: f[0], cupon: f[1] || 0, amort: f[2] || 0 }));
  const deO = x => x.flujos.map(f => ({ fecha: f[0], cupon: f[1] || 0, amort: f[2] || 0 }));
  if (b[T]) return deB(b[T]);
  const bop = T.replace(/^BPO([A-D]\d)$/, 'BP$1D');
  if (bop !== T && b[bop]) return deB(b[bop]);
  if (o[base]) return deO(o[base]);
  for (const s of ['D', 'C', 'O']) if (b[base + s]) return deB(b[base + s]);
  if (o[T]) return deO(o[T]);
  return null;
}
const resultados = require('./pl').crearPL({ historial, leerPortafolios: () => leerPortafolios(), cronogramaDe });
function leerPortafolios() {
  let base = {};
  try { base = JSON.parse(fs.readFileSync(PORTAFOLIO_FILE, 'utf8')); } catch (e) { /* sin archivo */ }
  Object.entries(portafolioFresco).forEach(([id, p]) => { if (!base[id] || p.ts > (base[id].ts || 0)) base[id] = p; });
  return base;
}
function parsePortafolio(r) {
  const resu = galloResultado(r);
  const n2 = v => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : 0; };
  const activos = [];
  (resu.Activos || []).forEach(a => {
    (a.Subtotal || []).forEach(sub => {
      if (!sub.CodigoEspecie) return; // filas de resumen de efectivo, sin especie real
      activos.push({
        tipoActivo: a.TipoActivo || '', ticker: String(sub.Ticker || '').trim(), especie: sub.Especie || sub.NombreEspecieReducido || '',
        cantidad: n2(sub.Cantidad), precio: n2(sub.Precio), importe: n2(sub.Importe), costo: n2(sub.Costo),
        variacionPct: n2(sub.Variacion), resultado: n2(sub.Resultado), codigoEspecie: sub.CodigoEspecie || '',
      });
    });
  });
  return { resumen: resu.Totales || {}, activos };
}

// ---------- Adaptador: forma de Gallo -> forma que espera app.js/data.js ----------

// Gallo lleva dos cuentas en dólares: "USD MEP" (títulos que liquidan acá) y "USD" a secas, que es el dólar cable
// (liquida afuera, con su propio tipo de cambio). Se muestran por separado; cada título se pasa a dólares con el
// tipo de cambio de SU cuenta, así el valor en pesos sigue coincidiendo con el importe que informa Gallo.
function tcDolaresGlobal(portafolio) {
  const g = { mep: 0, cable: 0 };
  for (const p of Object.values(portafolio)) {
    for (const d of (p.resumen?.Detalle || [])) {
      if (!(num(d.TipoCambio) > 1) || !(d.Detalle || '').includes('Cuenta Corriente')) continue;
      if (d.Moneda === 'USD MEP' && !g.mep) g.mep = num(d.TipoCambio);
      if (d.Moneda === 'USD' && !g.cable) g.cable = num(d.TipoCambio);
    }
    if (g.mep && g.cable) break;
  }
  return g;
}

// ---------- Cierre anterior de cada especie ----------
// Gallo informa solo el precio actual. Para la variación del día ("Movimientos del día", resultado del día) hace
// falta el cierre anterior, que sale de data912 (la misma serie que usa el resultado por período). Se baja en
// segundo plano, de a pocas especies a la vez: mientras no llegó, la especie queda sin variación.
const mercado = require('./mercado');
const isoLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const CIERRES = { f: null, precio: {}, pedidos: new Set(), cola: [], activos: 0 };
function procesarCierres() {
  while (CIERRES.activos < 4 && CIERRES.cola.length) {
    const t = CIERRES.cola.shift(), f = CIERRES.f;
    CIERRES.activos++;
    mercado.cierresDe(t).then(serie => {
      if (CIERRES.f !== f) return; // cambió el día mientras tanto
      const hoy = new Date(f + 'T12:00:00');
      const ayer = new Date(hoy); ayer.setDate(ayer.getDate() - 1);
      const habil = new Date(hoy); do { habil.setDate(habil.getDate() - 1); } while ([0, 6].includes(habil.getDay()));
      const c = mercado.cierreEn(serie, isoLocal(ayer));
      if (!c) { CIERRES.precio[t] = null; return; }
      // Se acepta el cierre del día hábil anterior; uno más viejo solo si la serie se bajó hoy (feriado en el medio)
      // y no tiene más de 6 días. Así una serie vieja guardada no da como "de hoy" la variación de varios días.
      const bajadaHoy = serie.ts >= new Date(f + 'T00:00:00').getTime();
      const dias = Math.round((hoy - new Date(c.fecha + 'T12:00:00')) / 86400000);
      CIERRES.precio[t] = c.fecha >= isoLocal(habil) || (bajadaHoy && dias <= 6) ? c.precio : null;
    }).catch(() => { if (CIERRES.f === f) CIERRES.precio[t] = null; })
      .finally(() => { CIERRES.activos--; procesarCierres(); });
  }
}
// Cierre anterior en pesos, en la misma unidad que el precio de Gallo; null si todavía no está o no es confiable.
function cierreAnterior(ticker, precioGallo) {
  const hoy = isoLocal(new Date());
  if (CIERRES.f !== hoy) Object.assign(CIERRES, { f: hoy, precio: {}, pedidos: new Set(), cola: [] });
  if (!ticker) return null;
  if (!(ticker in CIERRES.precio)) {
    if (!CIERRES.pedidos.has(ticker)) { CIERRES.pedidos.add(ticker); CIERRES.cola.push(ticker); procesarCierres(); }
    return null;
  }
  const c = CIERRES.precio[ticker];
  // Sanidad: si la serie está en otra unidad (o es otra especie con el mismo ticker) no se usa.
  if (!c || !(precioGallo > 0) || c / precioGallo < 0.75 || c / precioGallo > 1.33) return null;
  return c;
}

function armarCliente(cod, cli, mgrMap, portafolio, tcGlobal = {}) {
  const costosCuenta = historial.costosDe(cod) || {};
  const p = portafolio[cod] || { activos: [], resumen: {} };
  const detalle = p.resumen?.Detalle || [];
  const buscar = (moneda, detalleTxt) => detalle.find(d => d.Moneda === moneda && (d.Detalle || '').includes(detalleTxt));

  const ctaCteArs = buscar('Pesos', 'Cuenta Corriente');
  const ctaMep = buscar('USD MEP', 'Cuenta Corriente'), ctaCable = buscar('USD', 'Cuenta Corriente');
  // La caución en dólares se toma vendiendo USD (sintético "USD MEP"), no es la cuenta de
  // efectivo en USD real — por eso "USD MEP" tiene prioridad sobre "USD" acá.
  const ctaCteUsd = ctaMep || ctaCable;
  const tcMep = ctaMep ? num(ctaMep.TipoCambio) : (tcGlobal.mep || 0);
  const tcCable = ctaCable ? num(ctaCable.TipoCambio) : (tcGlobal.cable || 0);
  const tc = tcMep || tcCable || (detalle.find(d => num(d.TipoCambio) > 1)?.TipoCambio ? num(detalle.find(d => num(d.TipoCambio) > 1).TipoCambio) : 0);

  // Gallo cotiza algunos instrumentos (bonos/ONs/letras) "cada 100 nominales" y otros
  // (acciones/CEDEARs) directo — pero manda "importe" ya calculado bien en los dos casos.
  // En vez de adivinar por ticker (no escala a los ~800 comitentes con cientos de especies
  // distintas), el factor de unidad se DERIVA del propio importe que manda Gallo.
  const conFactor = a => {
    const bruto = a.cantidad * (a.precio || 0);
    // 0,01 = bonos/ONs/letras (precio cada 100 VN); 0,001 = fondos comunes (precio cada 1.000 cuotapartes); 1 = el resto.
    const razon = bruto ? a.importe / bruto : 1;
    const factorUnidad = Math.abs(razon - 0.01) < 0.001 ? 0.01 : Math.abs(razon - 0.001) < 0.0001 ? 0.001 : 1;
    // Gallo tarda en informar el costo de una compra reciente (o no lo informa si la posición ingresó sin costo): si
    // es cero o negativo se usa el promedio de las compras del historial, siempre que la cantidad coincida con la de hoy.
    let co = a.costo, costoDeCompras = false;
    if (!(co > 0)) {
      const c = costosCuenta[a.ticker], usd = /usd/i.test(a.tipoActivo || '');
      const m = c && (usd ? c.USD : c.ARS);
      if (m && Math.abs(m.q - a.cantidad) <= Math.max(1, Math.abs(a.cantidad) * 0.005)) { co = m.u / factorUnidad; costoDeCompras = true; }
    }
    // pa = cierre anterior (en pesos, como el precio de Gallo); sin cierre conocido queda igual al precio: variación 0.
    const pa = cierreAnterior(a.ticker, a.precio) || a.precio;
    return { t: a.ticker, n: a.especie, c: a.cantidad, p: a.precio, co, pa, factorUnidad, ...(costoDeCompras ? { costoDeCompras: true, costoMoneda: /usd/i.test(a.tipoActivo || '') ? 'USD' : 'ARS' } : {}) };
  };
  const activos = p.activos || [];
  const detallePesos = activos.filter(a => !/usd/i.test(a.tipoActivo || '') && a.ticker).map(conFactor);
  // Las especies que cotizan en dólares vienen de Gallo con precio/costo/importe en PESOS (ej. GD30 a
  // 87.400 = USD 57 x 1.532). Se pasan a USD con el mismo tipo de cambio que usa la app para
  // volver a pesos, así el total en pesos coincide exactamente con el importe que informa Gallo.
  const esUsd = a => /usd/i.test(a.tipoActivo || '') && a.ticker;
  const esCable = a => !/mep/i.test(a.tipoActivo || '');
  const detalleDolares = activos.filter(esUsd).map(a => {
    const d = conFactor(a);
    d.cable = esCable(a);
    d.tcPos = (d.cable ? tcCable : tcMep) || tc;
    if (d.tcPos > 0) { d.p = a.precio / d.tcPos; if (!d.costoDeCompras) d.co = a.costo / d.tcPos; d.pa = d.pa / d.tcPos; }
    return d;
  });
  const valorDolaresARS = activos.filter(esUsd).reduce((acc, a) => acc + num(a.importe), 0);
  const valorCableARS = activos.filter(a => esUsd(a) && esCable(a)).reduce((acc, a) => acc + num(a.importe), 0);
  const valorMepARS = valorDolaresARS - valorCableARS;
  const mgr = mgrMap[String(cli?.Manager ?? '')];

  return {
    id: cod,
    nombre: cli?.Nombre || '',
    email: (cli?.Email || '').toLowerCase(),
    managerId: String(cli?.Manager ?? ''),
    productor: mgr ? mgr.Nombre : (cli?.Manager != null ? 'Sin nombre en Gallo (cód. ' + cli.Manager + ')' : 'Sin asignar'),
    tc: tc || 0,
    totalPortfolio: num(p.resumen?.TotalPosicion),
    pesos: {
      // Suma de la tenencia real (activos en pesos), no "Tenencia Disponible" del resumen —
      // esa fila excluye lo que está en garantía y subestimaría el total.
      valor: detallePesos.reduce((a, x) => a + x.c * x.factorUnidad * x.p, 0),
      cuentaCorriente: ctaCteArs ? num(ctaCteArs.Importe) : 0,
    },
    dolares: {
      valorUSD: (tcMep > 0 ? valorMepARS / tcMep : 0) + (tcCable > 0 ? valorCableARS / tcCable : 0),
      valorARS: valorDolaresARS,
      cuentaCorrienteUSD: ctaCteUsd ? num(ctaCteUsd.Cantidad || ctaCteUsd.Importe) : 0,
      cuentaCorrienteARS: ctaCteUsd ? num(ctaCteUsd.Importe) : 0,
      // Desglose por cuenta: efectivo y títulos en USD MEP y en USD cable (cada uno en dólares de su cuenta).
      mep: { efectivoUSD: ctaMep ? num(ctaMep.Cantidad || 0) : 0, efectivoARS: ctaMep ? num(ctaMep.Importe) : 0, valorUSD: tcMep > 0 ? valorMepARS / tcMep : 0, valorARS: valorMepARS, tc: tcMep },
      cable: { efectivoUSD: ctaCable ? num(ctaCable.Cantidad || 0) : 0, efectivoARS: ctaCable ? num(ctaCable.Importe) : 0, valorUSD: tcCable > 0 ? valorCableARS / tcCable : 0, valorARS: valorCableARS, tc: tcCable },
    },
    detallePesos,
    detalleDolares,
    caucion: { fechaInicioPesos: null, fechaInicioUSD: null },
    ganancias: [],
    fuente: 'gallo',
    actualizado: p.ts || null,
  };
}

async function armarComitentes() {
  const { clientes, managers } = await getIdentidad();
  const portafolio = leerPortafolios();
  const mgrMap = {}; managers.forEach(m => { if (m && m.Codigo != null) mgrMap[String(m.Codigo)] = m; });
  const tcGlobal = tcDolaresGlobal(portafolio);
  return clientes
    .filter(c => c.CodigoComitente != null)
    .map(c => armarCliente(String(c.CodigoComitente), c, mgrMap, portafolio, tcGlobal));
}

// ---------- Sesiones (simple, en memoria — este server solo corre local) ----------

// token -> { email, rol, comitenteId }. Se guardan en disco (mercado/sesiones.json, fuera del repo) para que un
// reinicio del servidor no saque a nadie de la página; vencen a los 7 días.
const SESIONES_FILE = path.join(__dirname, 'mercado', 'sesiones.json');
const SESION_VIDA = 7 * 86400000;
const sesiones = new Map();
try {
  Object.entries(JSON.parse(fs.readFileSync(SESIONES_FILE, 'utf8'))).forEach(([t, s]) => { if (Date.now() - (s._t || 0) < SESION_VIDA) sesiones.set(t, s); });
} catch (e) { /* primera vez */ }
let sesionesTimer = null;
const guardarSesiones = () => {
  clearTimeout(sesionesTimer);
  sesionesTimer = setTimeout(() => {
    try { fs.mkdirSync(path.dirname(SESIONES_FILE), { recursive: true }); fs.writeFileSync(SESIONES_FILE, JSON.stringify(Object.fromEntries(sesiones))); } catch (e) { /* ignorar */ }
  }, 300);
};
const sesionesSet = sesiones.set.bind(sesiones);
sesiones.set = (t, s) => { sesionesSet(t, { ...s, _t: Date.now() }); guardarSesiones(); return sesiones; };
function nuevoToken() { return crypto.randomBytes(24).toString('hex'); }
function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.query.token;
  const sesion = sesiones.get(token);
  if (!sesion) return res.status(401).json({ ok: false, error: 'No autenticado' });
  req.sesion = sesion;
  next();
}

function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.query.token;
  const sesion = sesiones.get(token);
  if (!sesion || (sesion.rol !== 'admin' && sesion.rol !== 'alyc')) return res.status(401).json({ ok: false, error: 'Solo admin o ALyC' });
  next();
}

// Diagnóstico SIN exponer nunca token/credenciales ni datos de clientes — solo si cada
// paso funcionó y, si falló, el código de error (nunca el body completo de la respuesta).
// Requiere sesión de admin — este server solo corre local, pero igual no queda abierto.
app.get('/api/debug/gallo', requireAdmin, async (req, res) => {
  const out = {};
  try { await galloLogin(true); out.login = 'ok'; }
  catch (e) { out.login = 'error'; out.loginErrorStatus = e.response?.status || null; out.loginErrorMsg = String(e.message || '').slice(0, 200); }
  try {
    const r = await galloPost('GetClientes', {});
    const arr = galloResultado(r).Clientes || [];
    out.clientes = { count: arr.length, isOK: r?.IsOK ?? null, error: r?.Error || null };
  } catch (e) { out.clientes = 'error'; out.clientesErrorStatus = e.response?.status || null; out.clientesErrorMsg = String(e.message || '').slice(0, 200); }
  try {
    const r = await galloPost('Manager', {});
    const arr = galloResultado(r).Manager || [];
    out.manager = { count: arr.length, isOK: r?.IsOK ?? null, error: r?.Error || null };
  } catch (e) { out.manager = 'error'; out.managerErrorStatus = e.response?.status || null; out.managerErrorMsg = String(e.message || '').slice(0, 200); }
  res.json(out);
});

// Solo NOMBRES de campos (nunca valores) — para depurar el "shape" sin exponer PII.
app.get('/api/debug/gallo-shape', requireAdmin, async (req, res) => {
  try {
    const [cliR, mgrR] = await Promise.all([galloPost('GetClientes', {}), galloPost('Manager', {})]);
    const cliArr = galloResultado(cliR).Clientes || [];
    const mgrArr = galloResultado(mgrR).Manager || [];
    res.json({
      ok: true,
      clienteKeys: cliArr[0] ? Object.keys(cliArr[0]) : [],
      managerKeys: mgrArr[0] ? Object.keys(mgrArr[0]) : [],
      resultadoTopKeys: { clientes: Object.keys(galloResultado(cliR)), manager: Object.keys(galloResultado(mgrR)) },
    });
  } catch (e) { res.status(502).json({ ok: false, error: String(e.message || '').slice(0, 200) }); }
});

// Sonda de métodos EGWS con parámetros arbitrarios (p_<nombre>=valor). Devuelve solo
// estructura/errores/conteos, nunca filas completas. Solo admin.
app.get('/api/debug/probe/:metodo', requireAdmin, async (req, res) => {
  const metodo = String(req.params.metodo).replace(/[^A-Za-z]/g, '');
  const body = {};
  Object.entries(req.query).forEach(([k, v]) => { if (k.startsWith('p_')) body[k.slice(2)] = v; });
  try {
    const r = await galloPost(metodo, body);
    const resu = r && (r.Resultado || r.resultado);
    let arr = Array.isArray(resu) ? resu : (resu && Array.isArray(resu.Detalle) ? resu.Detalle : null);
    // CtaCteMonedaExt agrupa las filas en Detalle[].Movimientos: se aplanan para contar.
    if (arr && arr[0] && Array.isArray(arr[0].Movimientos)) arr = arr.flatMap(g => g.Movimientos || []);
    const distintos = (campo, max) => arr ? [...new Set(arr.map(x => x[campo]).filter(Boolean))].slice(0, max) : null;
    res.json({
      metodo, enviado: Object.keys(body), IsOK: r?.IsOK ?? null, Error: r?.Error || null,
      topKeys: resu && !Array.isArray(resu) ? Object.keys(resu) : null,
      filas: arr ? arr.length : null,
      keysFila: arr && arr[0] ? Object.keys(arr[0]) : null,
      comprobantes: distintos('Operacion', 40), ejemplosEspecie: distintos('Especie', 6),
      fechas: arr ? (() => { const f = arr.map(x => x.FechaOperacion).filter(Boolean); return { primera: f[f.length - 1] || null, ultima: f[0] || null, saldoAnterior: arr.some(x => x.Operacion === 'S.A.') }; })() : null,
    });
  } catch (e) { res.status(502).json({ ok: false, error: String(e.message || '').slice(0, 200), data: e.response?.data ? String(JSON.stringify(e.response.data)).slice(0, 300) : null }); }
});

app.get('/api/debug/portafolio/:cod', requireAdmin, (req, res) => {
  const portafolio = leerPortafolios();
  const p = portafolio[req.params.cod];
  if (!p) return res.json({ ok: false, error: 'sin datos' });
  res.json({ ok: true, activos: (p.activos || []).map(a => ({ tipoActivo: a.tipoActivo, ticker: a.ticker, cantidad: a.cantidad, precio: a.precio, importe: a.importe, costo: a.costo })) });
});

// Productores con el mail que tienen cargado en Gallo (con ese mail entran). Solo para la ALyC.
app.get('/api/productores', requireAuth, async (req, res) => {
  if (req.sesion.rol !== 'alyc' && req.sesion.rol !== 'admin') return res.status(403).json({ ok: false, error: 'Solo la ALyC' });
  try {
    const { managers } = await getIdentidad();
    const extra = {}; Object.entries(PRODUCTOR_EMAILS).forEach(([mail, cod]) => { (extra[cod] = extra[cod] || []).push(mail); });
    res.json({ ok: true, productores: managers.filter(m => m && m.Codigo != null).map(m => ({
      codigo: String(m.Codigo), nombre: m.Nombre || '', email: (m.Email || '').trim().toLowerCase(), extra: extra[String(m.Codigo)] || [],
    })) });
  } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
});

app.get('/api/estado', (req, res) => {
  const portafolio = leerPortafolios();
  res.json({
    ok: true,
    galloConfigurado: GALLO_ON,
    portafoliosDisponibles: Object.keys(portafolio).length,
    archivoPortafolios: PORTAFOLIO_FILE,
  });
});

app.post('/api/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const pass = String(req.body?.password || '');
    if (pass !== APP_PASSWORD) return res.status(401).json({ ok: false, error: 'Contraseña incorrecta' });
    if (!email) return res.status(400).json({ ok: false, error: 'Falta email' });

    if (ALYC_USER && email === ALYC_USER) {
      const token = nuevoToken();
      sesiones.set(token, { email, rol: 'alyc', comitenteId: null });
      return res.json({ ok: true, token, email, rol: 'alyc' });
    }

    if (ADMIN_EMAIL && email === ADMIN_EMAIL) {
      const token = nuevoToken();
      sesiones.set(token, { email, rol: 'admin', comitenteId: null });
      return res.json({ ok: true, token, email, rol: 'admin' });
    }

    if (!GALLO_ON) return res.status(503).json({ ok: false, error: 'Gallo no configurado en este servidor — no se puede validar el email en vivo' });

    const { clientes, managers } = await getIdentidad();
    if (PRODUCTOR_EMAILS[email]) {
      const token = nuevoToken();
      const managerId = PRODUCTOR_EMAILS[email];
      sesiones.set(token, { email, rol: 'productor', managerId, comitenteId: null });
      return res.json({ ok: true, token, email, rol: 'productor', managerId });
    }
    const mgr = managers.find(m => (m.Email || '').toLowerCase() === email);
    if (mgr) {
      const token = nuevoToken();
      const managerId = String(mgr.Codigo);
      sesiones.set(token, { email, rol: 'productor', managerId, comitenteId: null });
      return res.json({ ok: true, token, email, rol: 'productor', managerId });
    }
    // Un mismo mail puede estar en varias cuentas (familia, sociedad): el cliente las ve todas.
    const cuentas = clientes.filter(c => (c.Email || '').trim().toLowerCase() === email);
    if (cuentas.length && !CLIENTES_HABILITADOS) {
      return res.status(403).json({ ok: false, error: 'Por ahora el acceso es solo para managers. El acceso de comitentes se habilita más adelante.' });
    }
    const habilitadas = cuentas.filter(c => !CLIENTES_MANAGERS.length || CLIENTES_MANAGERS.includes(String(c.Manager ?? '')));
    if (cuentas.length && !habilitadas.length) {
      return res.status(403).json({ ok: false, error: 'Tu acceso todavía no está habilitado. Consultá con tu manager.' });
    }
    if (habilitadas.length) {
      const token = nuevoToken();
      const comitenteIds = habilitadas.map(c => String(c.CodigoComitente));
      const comitenteId = comitenteIds[0];
      sesiones.set(token, { email, rol: 'cliente', comitenteId, comitenteIds });
      return res.json({ ok: true, token, email, rol: 'cliente', comitenteId, comitenteIds });
    }
    return res.status(404).json({ ok: false, error: 'Email no encontrado en Gallo (ni como productor ni como comitente)' });
  } catch (e) {
    res.status(502).json({ ok: false, error: 'Error consultando Gallo: ' + (e.response?.data ? JSON.stringify(e.response.data).slice(0, 300) : e.message) });
  }
});

// Ganancias realizadas cargadas desde archivos Activity de Gallo. Se guardan en el servidor
// (no en el navegador) para que las vea quien corresponda. El archivo queda fuera del repo.
const GANANCIAS_FILE = path.join(__dirname, 'ganancias.json');
function leerGanancias() { try { return JSON.parse(fs.readFileSync(GANANCIAS_FILE, 'utf8')); } catch (e) { return {}; } }

async function comitentesVisibles(sesion) {
  const todos = await armarComitentes();
  const gan = leerGanancias();
  todos.forEach(c => {
    const auto = historial.gananciasDe(c.id);
    if (auto) { c.ganancias = auto.ganancias; c.gananciasInfo = { cargado: auto.actualizado, archivo: 'Gallo (cuenta corriente)', por: 'automático' }; }
    else if (gan[c.id]) { c.ganancias = gan[c.id].ganancias; c.gananciasInfo = { cargado: gan[c.id].cargado, archivo: gan[c.id].archivo, por: gan[c.id].por }; }
  });
  if (sesion.rol === 'admin' || sesion.rol === 'alyc') return todos;
  if (sesion.rol === 'productor') return todos.filter(c => c.managerId === sesion.managerId); // el productor ve los comitentes cuyo Manager es él
  const mias = sesion.comitenteIds && sesion.comitenteIds.length ? sesion.comitenteIds : [sesion.comitenteId];
  return todos.filter(c => mias.includes(c.id));
}

app.get('/api/comitentes', requireAuth, async (req, res) => {
  try {
    res.json({ ok: true, comitentes: await comitentesVisibles(req.sesion) });
  } catch (e) {
    res.status(502).json({ ok: false, error: 'Error consultando Gallo: ' + (e.response?.data ? JSON.stringify(e.response.data).slice(0, 300) : e.message) });
  }
});

// Cargar las ganancias de un comitente (resultado de procesar su Activity). Solo admin, o el
// productor dueño de ese comitente.
app.post('/api/ganancias/:id', requireAuth, async (req, res) => {
  try {
    const { sesion } = req;
    if (sesion.rol === 'cliente') return res.status(403).json({ ok: false, error: 'Solo el productor o el administrador pueden cargar archivos' });
    const id = String(req.params.id).replace(/[^0-9]/g, '');
    const visibles = await comitentesVisibles(sesion);
    if (!visibles.some(c => c.id === id)) return res.status(403).json({ ok: false, error: 'Ese comitente no es de tu cartera' });
    const g = req.body?.ganancias;
    const valida = x => x && /^\d{4}-\d{2}-\d{2}$/.test(x.fecha) && typeof x.ticker === 'string' && ['ARS', 'USD'].includes(x.moneda) && isFinite(x.cantidad) && isFinite(x.costo) && isFinite(x.ventaRescate);
    if (!Array.isArray(g) || g.length > 5000 || !g.every(valida)) return res.status(400).json({ ok: false, error: 'Formato de ganancias inválido' });
    const todo = leerGanancias();
    todo[id] = { cargado: new Date().toISOString(), archivo: String(req.body?.archivo || '').slice(0, 200), por: sesion.email, ganancias: g };
    fs.writeFileSync(GANANCIAS_FILE, JSON.stringify(todo));
    res.json({ ok: true, guardadas: g.length });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// ---------- Calendario de pagos ----------
// Cronograma de cupones y amortizaciones por 100 VN. Dos fuentes: bonistas.com (bonos, Bopreal, letras,
// ONs) y, para las ONs, el archivo ons_flujos.json que mantiene ../rentafija. Se cachea 1 hora en memoria
// y en disco (si bonistas no responde se usa la última copia).
const PAGOS_CACHE = path.join(__dirname, 'pagos-cache.json');
const ONS_FLUJOS_FILE = path.join(__dirname, '..', 'rentafija', 'ons_flujos.json');
let pagosMem = { val: null, exp: 0 };
async function cargarPagos() {
  if (pagosMem.val && Date.now() < pagosMem.exp) return pagosMem.val;
  let bonistas = null;
  try {
    const r = await axios.get('https://bonistas.com/proximos-pagos', { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', Accept: 'text/html' }, timeout: 15000, responseType: 'text' });
    const html = String(r.data);
    const ini = html.indexOf('id="__NEXT_DATA__"');
    const desde = ini < 0 ? -1 : html.indexOf('>', ini) + 1;
    const hasta = desde > 0 ? html.indexOf('</script>', desde) : -1;
    const lista = hasta > desde ? (JSON.parse(html.slice(desde, hasta))?.props?.pageProps?.initialPayments || []) : [];
    if (lista.length) {
      bonistas = {};
      lista.forEach(p => { (bonistas[String(p.symbol).toUpperCase()] = bonistas[String(p.symbol).toUpperCase()] || []).push([p.fecha, p.cupon || 0, p.principal || 0, /USD/i.test(p.moneda) ? 'USD' : 'ARS']); });
    }
  } catch (e) { /* se usa la copia guardada */ }
  let ons = null;
  try { const j = JSON.parse(fs.readFileSync(ONS_FLUJOS_FILE, 'utf8')); ons = {}; Object.entries(j).forEach(([base, o]) => { ons[base] = { moneda: /USD/i.test(o.mon) ? 'USD' : 'ARS', flujos: o.flows }; }); } catch (e) { /* sin ons_flujos */ }
  let val = { bonistas, ons, generado: new Date().toISOString() };
  if (val.bonistas) { try { fs.writeFileSync(PAGOS_CACHE, JSON.stringify(val)); } catch (e) { /* ignorar */ } }
  else { try { val = JSON.parse(fs.readFileSync(PAGOS_CACHE, 'utf8')); if (ons) val.ons = ons; } catch (e) { /* sin copia */ } }
  pagosMem = { val, exp: Date.now() + 3600000 };
  return val;
}
app.get('/api/pagos', requireAuth, async (req, res) => {
  try { res.json({ ok: true, ...(await cargarPagos()) }); }
  catch (e) { res.status(502).json({ ok: false, error: e.message }); }
});

// ---------- Actividad (movimientos de la cuenta) ----------
// actividad.json (gitignored, solo en esta máquina) = { "1238": [ { f, a, d, m, t, c, q, p, n } ] }. Cada comitente
// ve solo la suya; el productor, las de su cartera; la ALyC, todas (lo decide comitentesVisibles).
const ACTIVIDAD_FILE = path.join(__dirname, 'actividad.json');
app.get('/api/actividad/:id', requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id).replace(/[^0-9]/g, '');
    const visibles = await comitentesVisibles(req.sesion);
    if (!visibles.some(c => c.id === id)) return res.status(403).json({ ok: false, error: 'Esa cuenta no es de tu cartera' });
    const auto = historial.movimientosDe(id);
    if (auto) return res.json({ ok: true, origen: 'gallo', movimientos: auto });
    let todo = {};
    try { todo = JSON.parse(fs.readFileSync(ACTIVIDAD_FILE, 'utf8')); } catch (e) { /* todavía no hay archivo */ }
    res.json({ ok: true, origen: 'archivo', movimientos: Array.isArray(todo[id]) ? todo[id] : [] });
  } catch (e) {
    res.status(502).json({ ok: false, error: e.message });
  }
});

// Actualiza una cuenta en el momento: portafolio (posición y saldos) e historial (actividad y ganancias).
// Devuelve la cuenta ya armada. Se pide al abrir una cuenta; un mismo pedido repetido en 15 s reusa el anterior.
const cuentaEnCurso = {};
// El crawler de rentafija usa el mismo usuario de Gallo: si inicia sesión justo en el medio, el token de acá
// queda inválido. Se reintenta con una pausa antes de dar el pedido por perdido.
async function reintentar(fn, veces = 4) {
  let ult;
  for (let i = 0; i < veces; i++) {
    try { return await fn(); }
    catch (e) { ult = e; if (!/token|sesi[oó]n|autorizada|duplicate|solicitud/i.test(String(e && e.message || e))) break; await new Promise(r => setTimeout(r, 1200 * (i + 1))); }
  }
  throw ult;
}
app.post('/api/cuenta/:id/actualizar', requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id).replace(/[^0-9]/g, '');
    const visibles = await comitentesVisibles(req.sesion);
    if (!visibles.some(c => c.id === id)) return res.status(403).json({ ok: false, error: 'Esa cuenta no es de tu cartera' });
    const previo = cuentaEnCurso[id];
    let tarea = previo && Date.now() - previo.t < 15000 ? previo.p : null;
    if (!tarea) {
      tarea = Promise.allSettled([
        reintentar(async () => {
          const r = await galloPost('PortafolioReducido', { comi: id });
          if (!r || r.IsOK === false) throw new Error(String(r && r.Error || 'sin respuesta').slice(0, 120));
          portafolioFresco[id] = { ...parsePortafolio(r), ts: Date.now() };
        }),
        reintentar(() => historial.actualizar(id)),
      ]);
      cuentaEnCurso[id] = { t: Date.now(), p: tarea };
    }
    const [pf, hs] = await tarea;
    if (pf.status === 'rejected' && hs.status === 'rejected') return res.status(502).json({ ok: false, error: String(pf.reason && pf.reason.message || 'Gallo no respondió').slice(0, 160) });
    const actual = (await comitentesVisibles(req.sesion)).find(c => c.id === id);
    res.json({
      ok: true, comitente: actual, portafolio: pf.status === 'fulfilled', historial: hs.status === 'fulfilled', ts: Date.now(),
      ...(pf.status === 'rejected' ? { errorPortafolio: String(pf.reason && pf.reason.message || pf.reason).slice(0, 160) } : {}),
      ...(hs.status === 'rejected' ? { errorHistorial: String(hs.reason && hs.reason.message || hs.reason).slice(0, 160) } : {}),
    });
  } catch (e) { res.status(502).json({ ok: false, error: String(e.message || e).slice(0, 200) }); }
});

// Pulso de una cuenta que se está mirando: la página lo pide cada ~20 s. Es un solo pedido liviano a Gallo (la
// posición); si cambió la cantidad de algún título o un saldo (compra, venta, depósito, cobro) recién ahí se baja
// también el historial, para que Actividad, Rendimiento y el resultado reflejen la operación enseguida.
const firmaCuenta = p => {
  const act = (p.activos || []).filter(a => a.ticker).map(a => a.ticker + ':' + a.cantidad).sort().join('|');
  const caja = ((p.resumen || {}).Detalle || []).filter(d => /Cuenta Corriente|Liquidar/i.test(d.Detalle || '')).map(d => d.Moneda + d.Detalle + ':' + (d.Cantidad ?? d.Importe)).sort().join('|');
  return act + '#' + caja;
};
const cantidades = p => Object.fromEntries((p.activos || []).filter(a => a.ticker).map(a => [a.ticker, a.cantidad]));
const pulsoEnCurso = {};
app.post('/api/cuenta/:id/pulso', requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id).replace(/[^0-9]/g, '');
    const visibles = await comitentesVisibles(req.sesion);
    if (!visibles.some(c => c.id === id)) return res.status(403).json({ ok: false, error: 'Esa cuenta no es de tu cartera' });
    const previo = pulsoEnCurso[id];
    let tarea = previo && Date.now() - previo.t < 8000 ? previo.p : null;
    if (!tarea) {
      tarea = (async () => {
        const antes = leerPortafolios()[id];
        await reintentar(async () => {
          const r = await galloPost('PortafolioReducido', { comi: id });
          if (!r || r.IsOK === false) throw new Error(String(r && r.Error || 'sin respuesta').slice(0, 120));
          portafolioFresco[id] = { ...parsePortafolio(r), ts: Date.now() };
        });
        const cambio = !!antes && firmaCuenta(antes) !== firmaCuenta(portafolioFresco[id]);
        const cambios = [];
        if (cambio) {
          const a = cantidades(antes), b = cantidades(portafolioFresco[id]);
          new Set([...Object.keys(a), ...Object.keys(b)]).forEach(t => { const d = (b[t] || 0) - (a[t] || 0); if (Math.abs(d) > 1e-9) cambios.push({ t, delta: d, ahora: b[t] || 0 }); });
        }
        let historialOk = null;
        if (cambio) { try { await reintentar(() => historial.actualizar(id)); historialOk = true; } catch (e) { historialOk = false; } }
        return { cambio, cambios, historialOk };
      })();
      pulsoEnCurso[id] = { t: Date.now(), p: tarea };
      tarea.catch(() => { delete pulsoEnCurso[id]; });
    }
    const r = await tarea;
    const actual = (await comitentesVisibles(req.sesion)).find(c => c.id === id);
    res.json({ ok: true, comitente: actual, ts: Date.now(), ...r });
  } catch (e) { res.status(502).json({ ok: false, error: String(e.message || e).slice(0, 200) }); }
});

// Resultado de la cuenta en un período (pesos y dólares). desde y hasta en AAAA-MM-DD, ambos inclusive.
// Cobros (dividendos y rentas) y cauciones del período, para la pantalla Rendimiento.
app.get('/api/cuenta/:id/flujos', requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id).replace(/[^0-9]/g, '');
    const fecha = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
    const visibles = await comitentesVisibles(req.sesion);
    if (!visibles.some(c => c.id === id)) return res.status(403).json({ ok: false, error: 'Esa cuenta no es de tu cartera' });
    res.json(await resultados.flujosPeriodo(id, fecha(req.query.desde), fecha(req.query.hasta)));
  } catch (e) { res.status(502).json({ ok: false, error: String(e.message || e).slice(0, 200) }); }
});

app.get('/api/cuenta/:id/resultado', requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id).replace(/[^0-9]/g, '');
    const fecha = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
    const visibles = await comitentesVisibles(req.sesion);
    if (!visibles.some(c => c.id === id)) return res.status(403).json({ ok: false, error: 'Esa cuenta no es de tu cartera' });
    res.json(await resultados.calcular(id, fecha(req.query.desde), fecha(req.query.hasta)));
  } catch (e) { res.status(502).json({ ok: false, error: String(e.message || e).slice(0, 200) }); }
});

// Mercado en vivo (BYMA data + dólar, cripto y acciones de EE.UU.). Los nombres que BYMA no informa
// se completan con el que Gallo usa para cada especie en las carteras.
const byma = require('./byma');
let nombresGallo = { ts: 0, v: {} };
function nombresDeGallo() {
  if (Date.now() - nombresGallo.ts < 30 * 60000) return nombresGallo.v;
  const v = {};
  Object.values(leerPortafolios()).forEach(p => (p.activos || []).forEach(a => { if (a.ticker && a.especie && !v[a.ticker]) v[a.ticker] = a.especie; }));
  nombresGallo = { ts: Date.now(), v };
  return v;
}
app.get('/api/mercado', requireAuth, async (req, res) => {
  try { res.json(await byma.snapshot(nombresDeGallo())); }
  catch (e) { res.status(502).json({ ok: false, error: String(e.message || e).slice(0, 200) }); }
});
app.get('/api/mercado/graficos', requireAuth, async (req, res) => {
  try { res.json({ ok: true, series: await byma.minigraficos(String(req.query.t || '').split(',').filter(Boolean)) }); }
  catch (e) { res.status(502).json({ ok: false, error: String(e.message || e).slice(0, 200) }); }
});

// ---------- Fondos comunes de inversión (Fonditos, por su servidor MCP) ----------
// La clave (FONDITOS_KEY en .env) permite 50 consultas por día: fonditos.js guarda cada respuesta en disco y cuenta el cupo.
const fonditosMcp = require('./fonditos');
const textoOpt = v => (v == null || v === '' ? undefined : String(v));
const numOpt = v => { const n = parseInt(v, 10); return isFinite(n) ? n : undefined; };
const sinVacios = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
function rutaFondos(ruta, herramienta, args) {
  app.get('/api/fondos/' + ruta, requireAuth, async (req, res) => {
    try {
      const a = args(req.query);
      if (a === null) return res.status(400).json({ ok: false, error: 'Faltan datos para la consulta' });
      const r = await fonditosMcp.llamar(herramienta, sinVacios(a));
      res.json({ ok: true, ts: r.ts, cache: r.cache, vencido: !!r.vencido, ...fonditosMcp.estado(), datos: r.datos });
    } catch (e) {
      res.status(e.codigo === 'sinClave' ? 503 : e.codigo === 'cupo' ? 429 : 502).json({ ok: false, codigo: e.codigo || null, error: String(e.message || e).slice(0, 240), ...fonditosMcp.estado() });
    }
  });
}
app.get('/api/fondos/estado', requireAuth, (req, res) => res.json({ ok: true, ...fonditosMcp.estado() }));
rutaFondos('ranking', 'ranking_fondos', q => ({ periodo: textoOpt(q.periodo) || '30d', categoria: textoOpt(q.categoria), subcategoria: textoOpt(q.subcategoria), clase: textoOpt(q.clase), limite: numOpt(q.limite) || 20 }));
rutaFondos('buscar', 'buscar_fondos', q => (textoOpt(q.q) ? { q: textoOpt(q.q), limite: numOpt(q.limite) || 8 } : null));
rutaFondos('ficha', 'ficha_fondo', q => (textoOpt(q.fondo) ? { fondo: textoOpt(q.fondo) } : null));
rutaFondos('serie', 'serie_fondo', q => (textoOpt(q.fondo) ? { fondo: textoOpt(q.fondo), dias: numOpt(q.dias), from: textoOpt(q.from), to: textoOpt(q.to) } : null));
rutaFondos('comparar', 'comparar_fondos', q => (textoOpt(q.fondos) ? { fondos: String(q.fondos).split('|').filter(Boolean).slice(0, 6), from: textoOpt(q.from), to: textoOpt(q.to) } : null));
rutaFondos('peers', 'rendimiento_vs_peers', q => (textoOpt(q.fondo) ? { fondo: textoOpt(q.fondo) } : null));
rutaFondos('lista', 'listar_fondos', q => ({ categoria: textoOpt(q.categoria), limite: numOpt(q.limite) || 50 }));
rutaFondos('tasas', 'tasas_mercado', q => ({ fecha: textoOpt(q.fecha) }));
rutaFondos('cer', 'serie_cer', q => ({ from: textoOpt(q.from), to: textoOpt(q.to) }));

app.get('/api/mercado/sp500', requireAuth, async (req, res) => {
  try { res.json(await require('./sp500').mapa(await byma.usaStocks())); }
  catch (e) { res.status(502).json({ ok: false, error: String(e.message || e).slice(0, 200) }); }
});
app.get('/api/mercado/buscar', requireAuth, async (req, res) => {
  try { res.json({ ok: true, resultados: await byma.buscar(req.query.q, nombresDeGallo()) }); }
  catch (e) { res.status(502).json({ ok: false, error: String(e.message || e).slice(0, 200) }); }
});
app.get('/api/mercado/ficha', requireAuth, async (req, res) => {
  try {
    const f = await byma.ficha(String(req.query.t || '').trim(), String(req.query.src || ''), nombresDeGallo());
    res.json(f || { ok: false, error: 'No encontré esa especie' });
  } catch (e) { res.status(502).json({ ok: false, error: String(e.message || e).slice(0, 200) }); }
});

// Estado y refresco del historial automático. Solo la ALyC puede lanzar la bajada de todas las cuentas.
app.get('/api/historial/estado', requireAuth, (req, res) => {
  if (req.sesion.rol !== 'alyc' && req.sesion.rol !== 'admin') return res.status(403).json({ ok: false, error: 'Solo la ALyC' });
  res.json({ ok: true, ...historial.estado() });
});
app.post('/api/historial/refrescar', requireAuth, (req, res) => {
  if (req.sesion.rol !== 'alyc' && req.sesion.rol !== 'admin') return res.status(403).json({ ok: false, error: 'Solo la ALyC' });
  historial.refrescarTodas(!!(req.body && req.body.forzar)).catch(() => {});
  res.json({ ok: true, ...historial.estado() });
});
app.post('/api/historial/:id/refrescar', requireAuth, async (req, res) => {
  try {
    const id = String(req.params.id).replace(/[^0-9]/g, '');
    const visibles = await comitentesVisibles(req.sesion);
    if (!visibles.some(c => c.id === id)) return res.status(403).json({ ok: false, error: 'Esa cuenta no es de tu cartera' });
    res.json({ ok: true, resumen: await historial.actualizar(id) });
  } catch (e) { res.status(502).json({ ok: false, error: String(e.message || e).slice(0, 200) }); }
});

// Mails a los clientes (redacción con IA, prueba y envío por tandas; solo la ALyC). Ver mails.js.
require('./mails').registrar(app, { requireAuth, comitentes: armarComitentes });

app.listen(PORT, () => {
  console.log(`Posiciones de Clientes escuchando en http://localhost:${PORT}`);
  if (GALLO_ON) historial.iniciar();
  console.log(GALLO_ON ? '✅ Gallo configurado (GALLO_BASE=' + GALLO_BASE + ')' : '⚠️  Gallo NO configurado — solo funcionará el login admin y el modo demo del front');
});
