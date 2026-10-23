// Datos de fondos comunes de inversión desde el servidor MCP de Fonditos (mcp.fonditos.ar), por HTTP.
// La clave de muestra permite 50 consultas por día y 10 por minuto, así que:
//   · cada respuesta se guarda en disco por varias horas (mercado/fonditos-cache.json),
//   · los pedidos van en cola con una pausa entre uno y otro,
//   · se cuenta el cupo del día y, si se agota, se sirve lo último guardado.
// La clave sale de FONDITOS_KEY en .env y nunca viaja al navegador.

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const URL = 'https://mcp.fonditos.ar/mcp';
const DIR = path.join(__dirname, 'mercado');
const ARCHIVO = path.join(DIR, 'fonditos-cache.json');
const LIMITE_DIA = 50, RESERVA = 3, PAUSA_MS = 6500;
const HORA = 3600 * 1000;
// Cuánto dura cada tipo de dato antes de volver a pedirlo.
const VIGENCIA = { ranking_fondos: 3 * HORA, ficha_fondo: 12 * HORA, serie_fondo: 12 * HORA, buscar_fondos: 24 * HORA, listar_fondos: 24 * HORA, comparar_fondos: 12 * HORA, rendimiento_vs_peers: 12 * HORA, tasas_mercado: 2 * HORA, serie_cer: 24 * HORA, serie_rendimiento_grupo: 12 * HORA };

let cache = {};         // clave -> { ts, v }
let cupo = { dia: '', usadas: 0 };
try { const g = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8')); cache = g.cache || {}; cupo = g.cupo || cupo; } catch (e) { /* primera vez */ }
const hoy = () => new Date().toISOString().slice(0, 10);
function guardar() { try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(ARCHIVO, JSON.stringify({ cache, cupo })); } catch (e) { /* ignorar */ } }
function cupoHoy() { if (cupo.dia !== hoy()) cupo = { dia: hoy(), usadas: 0 }; return cupo; }

let sesion = null, idRpc = 100, cola = Promise.resolve(), ultimo = 0;
const clave = () => (process.env.FONDITOS_KEY || '').trim();
const parsear = d => { const m = String(d).split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).filter(Boolean); return m.length ? JSON.parse(m[m.length - 1]) : JSON.parse(d); };

async function rpc(method, params, esNotif) {
  const h = { Authorization: 'Bearer ' + clave(), 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  if (sesion) h['Mcp-Session-Id'] = sesion;
  const cuerpo = esNotif ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', id: idRpc++, method, params };
  const r = await axios.post(URL, cuerpo, { headers: h, timeout: 60000, validateStatus: () => true, responseType: 'text', transformResponse: x => x });
  if (r.headers['mcp-session-id']) sesion = r.headers['mcp-session-id'];
  if (esNotif) return null;
  if (r.status === 401 || r.status === 403) throw Object.assign(new Error('Fonditos rechazó la clave'), { codigo: 'clave' });
  if (r.status >= 400 && !r.data) throw new Error('Fonditos respondió ' + r.status);
  return r.data ? parsear(r.data) : null;
}
async function iniciar() {
  sesion = null;
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'posiciones-clientes', version: '1' } });
  await rpc('notifications/initialized', null, true);
}

async function llamarMcp(nombre, args) {
  if (!sesion) await iniciar();
  let r = await rpc('tools/call', { name: nombre, arguments: args });
  if (r && r.error && /session/i.test(JSON.stringify(r.error))) { await iniciar(); r = await rpc('tools/call', { name: nombre, arguments: args }); }
  if (!r) throw new Error('Fonditos no respondió');
  if (r.error) throw new Error(String(r.error.message || JSON.stringify(r.error)).slice(0, 200));
  const res = r.result || {};
  let datos = res.structuredContent;
  if (!datos) { const t = (res.content || []).map(c => c.text).join(''); try { datos = JSON.parse(t); } catch (e) { datos = { texto: t }; } }
  if (res.isError) throw new Error(String(datos && (datos.error || datos.message || datos.texto) || 'Fonditos devolvió un error').slice(0, 220));
  return datos;
}

function llamar(nombre, args) {
  if (!clave()) return Promise.reject(Object.assign(new Error('Falta la clave de Fonditos (FONDITOS_KEY en el archivo .env)'), { codigo: 'sinClave' }));
  const k = nombre + '|' + JSON.stringify(args || {});
  const c = cache[k];
  const vig = VIGENCIA[nombre] || 6 * HORA;
  if (c && Date.now() - c.ts < vig) return Promise.resolve({ datos: c.v, ts: c.ts, cache: true });
  const turno = cola.then(async () => {
    const q = cupoHoy();
    if (q.usadas >= LIMITE_DIA - RESERVA) {
      if (c) return { datos: c.v, ts: c.ts, cache: true, vencido: true };
      throw Object.assign(new Error('Se agotó el cupo diario de consultas de Fonditos (' + LIMITE_DIA + ' por día). Se renueva mañana.'), { codigo: 'cupo' });
    }
    const espera = ultimo + PAUSA_MS - Date.now();
    if (espera > 0) await new Promise(r => setTimeout(r, espera));
    try {
      const datos = await llamarMcp(nombre, args);
      ultimo = Date.now(); q.usadas++;
      cache[k] = { ts: Date.now(), v: datos }; guardar();
      return { datos, ts: Date.now(), cache: false };
    } catch (e) {
      ultimo = Date.now();
      if (c) return { datos: c.v, ts: c.ts, cache: true, vencido: true };
      throw e;
    }
  });
  cola = turno.catch(() => {});
  return turno;
}

const estado = () => ({ configurado: !!clave(), usadas: cupoHoy().usadas, limite: LIMITE_DIA, restantes: Math.max(0, LIMITE_DIA - RESERVA - cupoHoy().usadas) });

module.exports = { llamar, estado };
