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
app.use(express.json());
app.use(express.static(__dirname));

// ---------- Conexión a Gallo (EGWS) ----------

const GALLO_BASE = process.env.GALLO_BASE || '';
const GALLO_USER = process.env.GALLO_USER || '';
const GALLO_PASS = process.env.GALLO_PASS || '';
const GALLO_ON = !!(GALLO_BASE && GALLO_USER && GALLO_PASS);
const GALLO_WS = '/' + String(process.env.GALLO_WS || 'ws').replace(/^\/+|\/+$/g, '');
const APP_PASSWORD = process.env.APP_PASSWORD || '091218';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'fzunino@equanimasecurities.com').toLowerCase();

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
async function getIdentidad() {
  if (Date.now() < identidadCache.exp && identidadCache.clientes.length) return identidadCache;
  // Gallo es intermitente: una respuesta vacía o con error NO se cachea (antes quedaba "0
  // comitentes" fijado 10 minutos). Se reintenta, y si no hay nada se avisa en vez de mostrar vacío.
  for (let intento = 0; intento < 3; intento++) {
    const [cliR, mgrR] = await Promise.allSettled([galloPost('GetClientes', {}), galloPost('Manager', {})]);
    const clientes = cliR.status === 'fulfilled' ? (galloResultado(cliR.value).Clientes || []) : [];
    if (clientes.length) {
      const managers = mgrR.status === 'fulfilled' ? (galloResultado(mgrR.value).Manager || []) : identidadCache.managers;
      identidadCache = { clientes, managers, exp: Date.now() + 10 * 60000 };
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
function leerPortafolios() {
  try { return JSON.parse(fs.readFileSync(PORTAFOLIO_FILE, 'utf8')); }
  catch (e) { return {}; }
}

// ---------- Adaptador: forma de Gallo -> forma que espera app.js/data.js ----------

function armarCliente(cod, cli, mgrMap, portafolio) {
  const p = portafolio[cod] || { activos: [], resumen: {} };
  const detalle = p.resumen?.Detalle || [];
  const buscar = (moneda, detalleTxt) => detalle.find(d => d.Moneda === moneda && (d.Detalle || '').includes(detalleTxt));

  const ctaCteArs = buscar('Pesos', 'Cuenta Corriente');
  // La caución en dólares se toma vendiendo USD (sintético "USD MEP"), no es la cuenta de
  // efectivo en USD real — por eso "USD MEP" tiene prioridad sobre "USD" acá.
  const ctaCteUsd = buscar('USD MEP', 'Cuenta Corriente') || buscar('USD', 'Cuenta Corriente');
  const tc = ctaCteUsd ? num(ctaCteUsd.TipoCambio) : (detalle.find(d => num(d.TipoCambio) > 1)?.TipoCambio ? num(detalle.find(d => num(d.TipoCambio) > 1).TipoCambio) : 0);

  // Gallo cotiza algunos instrumentos (bonos/ONs/letras) "cada 100 nominales" y otros
  // (acciones/CEDEARs) directo — pero manda "importe" ya calculado bien en los dos casos.
  // En vez de adivinar por ticker (no escala a los ~800 comitentes con cientos de especies
  // distintas), el factor de unidad se DERIVA del propio importe que manda Gallo.
  const conFactor = a => {
    const bruto = a.cantidad * (a.precio || 0);
    const factorUnidad = bruto ? (Math.abs(a.importe / bruto - 0.01) < 0.001 ? 0.01 : 1) : 1;
    return { t: a.ticker, n: a.especie, c: a.cantidad, p: a.precio, co: a.costo, pa: a.precio, factorUnidad };
  };
  const activos = p.activos || [];
  const detallePesos = activos.filter(a => !/usd/i.test(a.tipoActivo || '') && a.ticker).map(conFactor);
  // Las especies que cotizan en dólares vienen de Gallo con precio/costo/importe en PESOS (ej. GD30 a
  // 87.400 = USD 57 x 1.532). Se pasan a USD con el mismo tipo de cambio que usa la app para
  // volver a pesos, así el total en pesos coincide exactamente con el importe que informa Gallo.
  const detalleDolares = activos.filter(a => /usd/i.test(a.tipoActivo || '') && a.ticker).map(a => {
    const d = conFactor(a);
    if (tc > 0) { d.p = a.precio / tc; d.co = a.costo / tc; d.pa = d.p; }
    return d;
  });
  const valorDolaresARS = activos.filter(a => /usd/i.test(a.tipoActivo || '') && a.ticker).reduce((acc, a) => acc + num(a.importe), 0);
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
      valorUSD: tc > 0 ? valorDolaresARS / tc : 0,
      valorARS: valorDolaresARS,
      cuentaCorrienteUSD: ctaCteUsd ? num(ctaCteUsd.Cantidad || ctaCteUsd.Importe) : 0,
      cuentaCorrienteARS: ctaCteUsd ? num(ctaCteUsd.Importe) : 0,
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
  return clientes
    .filter(c => c.CodigoComitente != null)
    .map(c => armarCliente(String(c.CodigoComitente), c, mgrMap, portafolio));
}

// ---------- Sesiones (simple, en memoria — este server solo corre local) ----------

const sesiones = new Map(); // token -> { email, rol, comitenteId }
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
  if (!sesion || sesion.rol !== 'admin') return res.status(401).json({ ok: false, error: 'Solo admin' });
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
    const arr = Array.isArray(resu) ? resu : (resu && Array.isArray(resu.Detalle) ? resu.Detalle : null);
    res.json({
      metodo, enviado: Object.keys(body), IsOK: r?.IsOK ?? null, Error: r?.Error || null,
      topKeys: resu && !Array.isArray(resu) ? Object.keys(resu) : null,
      filas: arr ? arr.length : null,
      keysFila: arr && arr[0] ? Object.keys(arr[0]) : null,
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

    if (email === ADMIN_EMAIL) {
      const token = nuevoToken();
      sesiones.set(token, { email, rol: 'admin', comitenteId: null });
      return res.json({ ok: true, token, email, rol: 'admin' });
    }

    if (!GALLO_ON) return res.status(503).json({ ok: false, error: 'Gallo no configurado en este servidor — no se puede validar el email en vivo' });

    const { clientes, managers } = await getIdentidad();
    const mgr = managers.find(m => (m.Email || '').toLowerCase() === email);
    if (mgr) {
      const token = nuevoToken();
      const managerId = String(mgr.Codigo);
      sesiones.set(token, { email, rol: 'productor', managerId, comitenteId: null });
      return res.json({ ok: true, token, email, rol: 'productor', managerId });
    }
    const cli = clientes.find(c => (c.Email || '').toLowerCase() === email);
    if (cli) {
      const token = nuevoToken();
      const comitenteId = String(cli.CodigoComitente);
      sesiones.set(token, { email, rol: 'cliente', comitenteId });
      return res.json({ ok: true, token, email, rol: 'cliente', comitenteId });
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
  todos.forEach(c => { if (gan[c.id]) { c.ganancias = gan[c.id].ganancias; c.gananciasInfo = { cargado: gan[c.id].cargado, archivo: gan[c.id].archivo, por: gan[c.id].por }; } });
  if (sesion.rol === 'admin') return todos;
  if (sesion.rol === 'productor') return todos.filter(c => c.managerId === sesion.managerId); // el productor ve los comitentes cuyo Manager es él
  return todos.filter(c => c.id === sesion.comitenteId);
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

app.listen(PORT, () => {
  console.log(`Posiciones de Clientes escuchando en http://localhost:${PORT}`);
  console.log(GALLO_ON ? '✅ Gallo configurado (GALLO_BASE=' + GALLO_BASE + ')' : '⚠️  Gallo NO configurado — solo funcionará el login admin y el modo demo del front');
});
