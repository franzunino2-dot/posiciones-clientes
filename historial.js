// Historial de cada comitente, bajado de Gallo (EGWS) sin que nadie suba archivos.
//   CtaCte           → cuenta corriente en pesos       (comi, fecd, fech con año de 4 dígitos)
//   CtaCteMonedaExt  → cuenta corriente en dólares     (mismos parámetros)
// Con las dos se arma lo mismo que el "Activity" de Gallo: los movimientos de la cuenta (pestaña
// Actividad) y las ganancias realizadas (con el mismo reconstructor que usa la carga manual).
// Todo queda en historial/ (gitignored, solo en esta máquina) y se refresca solo.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, 'historial');
const INDICE = path.join(DIR, '_ganancias.json'); // { id: { actualizado, ganancias } } para no leer 800 archivos por pedido
const DESDE = '01/01/2020';
const VERSION = 3;                                // se sube cuando cambia cómo se arma el historial: fuerza a bajar todo de nuevo
const VIGENCIA_MS = 20 * 3600 * 1000;             // se vuelve a bajar una cuenta si tiene más de 20 horas

const pad = n => String(n).padStart(2, '0');
const hoyGallo = () => { const d = new Date(); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
const iso = s => {
  const m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  return m ? `${m[3].length === 2 ? '20' + m[3] : m[3]}-${pad(m[2])}-${pad(m[1])}` : null;
};
const num = v => { if (v === null || v === undefined || v === '') return null; const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null; };
const dormir = ms => new Promise(r => setTimeout(r, ms));

// ---------- Clasificación de comprobantes ----------
// Se decide por el código y, si no alcanza, por la descripción que Gallo informa en Totales
// ("VTU$  VENTA CABLE"). Lo que no se reconoce queda como "Otro" y se informa en el estado.
const POR_CODIGO = {
  // operaciones de compra y venta
  CPRA: 'Compra', COTR: 'Compra', 'CPU$': 'Compra', CPUC: 'Compra', CRCN: 'Compra', CRCM: 'Compra', CNGC: 'Compra', CBLO: 'Compra', EJPC: 'Compra',
  COPR: 'Compra', CPTR: 'Compra', CFBY: 'Compra', CMIN: 'Compra', CTIN: 'Compra',
  VTAS: 'Venta', 'VTU$': 'Venta', VTUC: 'Venta', VRCM: 'Venta', VRCN: 'Venta', VBLO: 'Venta',
  VTPR: 'Venta', VPTR: 'Venta', VFBY: 'Venta', VTIN: 'Venta',
  // rentas y dividendos
  DIV: 'Dividendo', RTA: 'Renta',
  // gastos y créditos de la cuenta
  DECU: 'Retención', DU$S: 'Retención', DBC: 'Retención', DRIG: 'Retención',
  BTDB: 'Bonificación', NOCR: 'Crédito', 'CU$V': 'Crédito', CIND: 'Crédito', NCC: 'Crédito', NCCD: 'Crédito',
  // movimientos de fondos y títulos
  DETR: 'Depósito', 'CU$S': 'Depósito', COBR: 'Depósito', INLO: 'Depósito',
  PAGO: 'Extracción', 'PAU$': 'Extracción', RTTR: 'Extracción', EGCA: 'Extracción', EGLO: 'Extracción',
  // derivados y garantías
  DEIN: 'Ajuste', NCIN: 'Ajuste', 'EGO$': 'Garantía', 'DGO$': 'Garantía',
  // cauciones (no se muestran en Actividad)
  TCCD: 'Caución', TOCT: 'Caución', CCCD: 'Caución', CCTE: 'Caución',
  // fondos comunes de inversión
  'LIQ. RES. US': 'Rescate', 'LIQ. SUS. US': 'Suscripción', 'LIQ. RESC.': 'Rescate', 'LIQ. SUSC.': 'Suscripción',
  // operaciones de MAE y rueda SENEBI sin garantía
  INCR: 'Compra', DECR: 'Venta', VSCC: 'Venta',
  // créditos y débitos varios
  CCHB: 'Crédito', CCHM: 'Crédito', CDMI: 'Bonificación', DCPD: 'Retención', DECA: 'Retención',
  // garantías y ajustes de derivados
  DEGI: 'Garantía', DEGO: 'Garantía', DGIP: 'Garantía', ENGI: 'Garantía', ENGO: 'Garantía', EGIP: 'Garantía', DIND: 'Ajuste',
};
const SALDOS = new Set(['S.A.', 'SALDO ANT.']); // filas de saldo anterior, no son movimientos
const OPCIONES = new Set(['COPR', 'VTPR', 'CPTR', 'VPTR', 'EGO$', 'DGO$']);
const FUTUROS = new Set(['CFBY', 'VFBY', 'CMIN', 'CTIN', 'VTIN', 'DEIN', 'NCIN']);
function tipoDe(codigo, desc) {
  if (POR_CODIGO[codigo]) return POR_CODIGO[codigo];
  const d = String(desc || '').toUpperCase();
  if (/COMPRA/.test(d)) return 'Compra';
  if (/VTA|VENTA/.test(d)) return 'Venta';
  if (/DIVIDEND|RENTA|AMORTIZ/.test(d)) return 'Dividendo';
  if (/CAUCION/.test(d)) return 'Caución';
  if (/DEPOSITO|COBRO|INGRESO/.test(d)) return 'Depósito';
  if (/PAGO|EGRESO|RETIRO/.test(d)) return 'Extracción';
  return 'Otro';
}
function claseDe(esp, ticker, codigo) {
  if (OPCIONES.has(codigo)) return 'Opción';
  if (FUTUROS.has(codigo)) return 'Futuro';
  const e = String(esp || '').toUpperCase();
  if (!ticker || /ESPECIES VARIAS/.test(e)) return 'Dinero';
  if (/^CEDEAR/.test(e)) return 'Cedear';
  if (/^(ON |OBLIG)/.test(e) || /\bON\b/.test(e)) return 'ON';
  if (/BONO|LETRA|BOPREAL|STEP UP|TESORO|REP(UBLICA)? ARGENTINA|\bAL ?\d\d\b|\bGD ?\d\d\b/.test(e)) return 'Bono';
  if (/\bFCI\b|FONDO|CUOTAPARTE|TORONTO TRUST|ALLARIA|COMPASS|PIONERO|SCHRODER|FIMA|ADCAP|AHORRO|BALANZ/.test(e)) return 'FCI';
  return 'Acción';
}

// ---------- Reconstructor de ganancias (el mismo de importar.js) ----------
let _imp = null;
function importador() {
  if (!_imp) {
    const ctx = { console };
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'importar.js'), 'utf8') + '\nthis.reconstruirActivity = reconstruirActivity;', ctx);
    _imp = ctx;
  }
  return _imp;
}

function crearHistorial({ galloPost, listarComitentes }) {
  fs.mkdirSync(DIR, { recursive: true });
  let indice = {};
  try { indice = JSON.parse(fs.readFileSync(INDICE, 'utf8')); } catch (e) { /* primera vez */ }
  const estado = { corriendo: false, total: 0, hechas: 0, errores: 0, ultimoError: '', desconocidos: {}, iniciada: null, terminada: null };
  const archivo = id => path.join(DIR, String(id).replace(/[^0-9]/g, '') + '.json');
  let sucio = 0;
  const guardarIndice = () => { try { fs.writeFileSync(INDICE, JSON.stringify(indice)); sucio = 0; } catch (e) { /* ignorar */ } };

  // Filas normalizadas de las dos cuentas corrientes.
  function normalizar(x, mon) {
    return {
      f: iso(x.FechaOperacion), fl: iso(x.FechaLiquidacion),
      c: String(x.Operacion || x.Comprobante || '').trim(), n: num(x.NroComprobante) ?? num(x.Numero),
      t: String(x.Ticker || '').trim(), ce: String(x.CodigoEspecie || '').trim(), e: String(x.Especie || '').trim(),
      q: num(x.Cantidad), p: num(x.Precio), i: num(x.Importe), s: num(x.Saldo), r: String(x.Referencia || '').trim(), m: mon,
    };
  }

  // Gallo invalida el token si otro proceso inicia sesión con el mismo usuario (ej. el crawler de rentafija):
  // se reintenta con espera creciente en vez de dar la cuenta por perdida.
  async function conReintentos(fn) {
    let ultimo;
    for (let i = 0; i < 4; i++) {
      try {
        const r = await fn();
        if (r && r.IsOK === false && /token|duplicate|sesi[oó]n|autorizada|solicitud/i.test(String(r.Error || ''))) throw new Error(r.Error);
        return r;
      } catch (e) { ultimo = e; await dormir(1500 * (i + 1)); }
    }
    throw ultimo;
  }

  async function bajar(id) {
    const params = { comi: String(id), fecd: DESDE, fech: hoyGallo() };
    const rp = await conReintentos(() => galloPost('CtaCte', params));
    const ru = await conReintentos(() => galloPost('CtaCteMonedaExt', params));
    if (!rp || rp.IsOK === false) throw new Error('CtaCte: ' + String(rp && rp.Error || 'sin respuesta').slice(0, 120));
    if (!ru || ru.IsOK === false) throw new Error('CtaCteMonedaExt: ' + String(ru && ru.Error || 'sin respuesta').slice(0, 120));
    const resP = rp.Resultado || {}, resU = ru.Resultado || {};
    let pesos = (Array.isArray(resP.Detalle) ? resP.Detalle : []).map(x => normalizar(x, 'ARS')).filter(x => x.f && !SALDOS.has(x.c));
    let usd = [];
    (Array.isArray(resU.Detalle) ? resU.Detalle : []).forEach(g => {
      if (Array.isArray(g.Movimientos)) g.Movimientos.forEach(x => usd.push(normalizar(x, 'USD')));
      else usd.push(normalizar(g, 'USD'));
    });
    usd = usd.filter(x => x.f && !SALDOS.has(x.c));
    // Cada operación en dólares (CPU$, VTU$, CU$S...) también deja en la cuenta de pesos una fila marcadora
    // sin importe ni precio: es la misma operación, así que se descarta para no contarla dos veces.
    const claveUsd = new Set(usd.map(x => x.c + '|' + x.n));
    pesos = pesos.filter(x => !(x.i == null && claveUsd.has(x.c + '|' + x.n)));
    const codigos = {};
    [...(Array.isArray(resP.Totales) ? resP.Totales : []), ...(Array.isArray(resU.Totales) ? resU.Totales : [])].forEach(t => {
      const m = String(t.Operacion || '').match(/^(\S+)\s+(.*)$/);
      if (m) codigos[m[1]] = m[2].trim();
    });
    return { id: String(id), actualizado: new Date().toISOString(), desde: DESDE, pesos, usd, codigos };
  }

  // Movimientos en el formato de la pestaña Actividad: { f, k, a, d, m, t, c, q, p, n }.
  function aMovimientos(h) {
    const salida = [];
    [...h.pesos, ...h.usd].forEach(x => {
      const tipo = tipoDe(x.c, h.codigos[x.c]);
      if (tipo === 'Otro') estado.desconocidos[x.c] = (estado.desconocidos[x.c] || 0) + 1;
      if (tipo === 'Caución') return; // las cauciones diarias no se listan
      const dinero = !x.t || /VARIAS/i.test(x.t) || /ESPECIES VARIAS/i.test(x.e);
      const nombre = tipo === 'Caución' ? 'Caución' : dinero ? (tipo === 'Retención' ? 'Cuenta' : tipo === 'Bonificación' ? 'Arancel' : 'Fondos') : x.t;
      salida.push({
        f: x.f, k: x.n || 0, a: nombre, m: x.m, t: tipo, n: x.i,
        ...(dinero ? {} : { d: x.e.startsWith(x.t) ? x.e.slice(x.t.length).replace(/^\s*[-–]?\s*/, '') || x.e : x.e }), c: claseDe(x.e, dinero ? '' : x.t, x.c),
        ...(x.q ? { q: x.q } : {}), ...(x.p ? { p: x.p } : {}), ...(x.r && dinero ? { d: x.r } : {}),
      });
    });
    return salida.sort((a, b) => b.f.localeCompare(a.f) || (b.k || 0) - (a.k || 0));
  }

  // Ganancias realizadas: las mismas reglas que la carga manual del Activity.
  function aGanancias(h) {
    const filas = [];
    // El reconstructor reconoce compra y venta por código: se traducen los códigos equivalentes (rueda MEP, MAE,
    // FCI...) a los básicos. Opciones y futuros quedan afuera: su resultado no es compra/venta de un título.
    const comp = x => {
      if (OPCIONES.has(x.c) || FUTUROS.has(x.c)) return x.c;
      const t = tipoDe(x.c, h.codigos[x.c]);
      return t === 'Compra' || t === 'Suscripción' ? 'CPRA' : t === 'Venta' || t === 'Rescate' ? 'VTAS' : x.c;
    };
    h.pesos.forEach(x => filas.push({ fecha: x.f, comp: comp(x), nro: x.n || 0, ticker: x.t, cant: x.q, precio: x.p, moneda: 'PESOS', impPesos: x.i, impMoneda: null }));
    h.usd.forEach(x => filas.push({ fecha: x.f, comp: comp(x), nro: x.n || 0, ticker: x.t, cant: x.q, precio: x.p, moneda: 'USD', impPesos: null, impMoneda: x.i }));
    return importador().reconstruirActivity(filas);
  }

  async function actualizar(id) {
    const h = await bajar(id);
    const g = aGanancias(h);
    fs.writeFileSync(archivo(id), JSON.stringify(h));
    indice[String(id)] = { v: VERSION, actualizado: h.actualizado, ganancias: g.ganancias, operaciones: g.operaciones };
    if (++sucio >= 25) guardarIndice();
    const suma = mon => Math.round(g.ganancias.filter(x => x.moneda === mon).reduce((a, x) => a + x.ventaRescate - x.costo, 0));
    return { id: String(id), pesos: h.pesos.length, usd: h.usd.length, ganancias: g.ganancias.length, realizadoARS: suma('ARS'), realizadoUSD: suma('USD'), primera: g.ganancias.map(x => x.fecha).sort()[0] || null, sucios: g.sucios, mixtos: g.mixtos.length, ignorados: g.ignorados };
  }

  function obsoleta(id) {
    const i = indice[String(id)];
    return !i || i.v !== VERSION || (Date.now() - Date.parse(i.actualizado)) > VIGENCIA_MS;
  }

  // Baja todas las cuentas que faltan o están vencidas, de a pocas y sin apurar a Gallo.
  async function refrescarTodas(forzar = false) {
    if (estado.corriendo) return estado;
    estado.corriendo = true; estado.errores = 0; estado.hechas = 0; estado.ultimoError = ''; estado.iniciada = new Date().toISOString(); estado.terminada = null;
    try {
      const ids = (await listarComitentes()).map(String).filter(id => forzar || obsoleta(id));
      estado.total = ids.length;
      let cola = ids.slice(); const trabajadores = 2;
      await Promise.all(Array.from({ length: trabajadores }, async () => {
        while (cola.length) {
          const id = cola.shift();
          try { await actualizar(id); }
          catch (e) { estado.errores++; estado.ultimoError = id + ': ' + String(e.message || e).slice(0, 160); }
          estado.hechas++;
          await dormir(120);
        }
      }));
    } finally {
      guardarIndice();
      estado.corriendo = false; estado.terminada = new Date().toISOString();
    }
    return estado;
  }

  return {
    estado: () => ({ ...estado, cuentas: Object.keys(indice).length }),
    actualizar,
    refrescarTodas,
    gananciasDe: id => indice[String(id)] || null,
    // Los movimientos se arman al pedirlos desde lo guardado: así un cambio de clasificación no obliga a volver a bajar todo.
    movimientosDe: id => { try { return aMovimientos(JSON.parse(fs.readFileSync(archivo(id), 'utf8'))); } catch (e) { return null; } },
    crudoDe: id => { try { return JSON.parse(fs.readFileSync(archivo(id), 'utf8')); } catch (e) { return null; } },
    // Arranque: espera un poco a que el servidor esté listo, baja lo que falta y revisa cada 3 horas.
    iniciar() {
      const ciclo = () => refrescarTodas(false).catch(e => { estado.ultimoError = String(e.message || e).slice(0, 160); });
      setTimeout(ciclo, 20000);
      setInterval(ciclo, 3 * 3600 * 1000);
    },
  };
}

module.exports = { crearHistorial };
