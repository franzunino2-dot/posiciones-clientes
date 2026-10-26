// Resultado de una cuenta en un período, en pesos y en dólares.
//
//   resultado = valor al final − valor al inicio − aportes y retiros del período
//
// El valor al final sale de Gallo. El valor al inicio se reconstruye hacia atrás desde la posición actual:
// a las cantidades y al efectivo de hoy se les deshacen los movimientos del historial posteriores a esa fecha,
// y las tenencias se valúan con el cierre de ese día (data912) o, si no hay serie, con el último precio
// operado por los clientes de Equanima en esa especie. Lo que no tiene precio queda al precio de hoy y se avisa.

const { tipoDe, FUTUROS } = require('./historial');
const mercado = require('./mercado');

const FLUJOS_EFECTIVO = new Set(['COBR', 'CU$S', 'PAGO', 'PAU$']);
const FLUJOS_TITULOS = new Set(['DETR', 'RTTR']);
const INTERESES = new Set(['TCCD', 'TOCT', 'CCCD', 'CCTE']);
const DIA = 86400000;

const isoHoy = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const sumarDias = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * DIA).toISOString().slice(0, 10);
const dias = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / DIA);
const num = v => { const n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : 0; };
const factorCercano = r => (Math.abs(r - 0.01) < 0.002 ? 0.01 : Math.abs(r - 0.001) < 0.0002 ? 0.001 : Math.abs(r - 1) < 0.15 ? 1 : null);

// Cauciones: tomadora (T) y colocadora (C), con sus patas de contado y de término. Las patas de una operación
// tienen la misma fecha de concertación; el costo (o la renta) es lo que queda al sumar las dos.
const CAUC_T = new Set(['TCCD', 'TOCT', 'TCCM', 'TCTM']), CAUC_C = new Set(['CCCD', 'CCTE', 'CCCM', 'CCTM']);
const CAUC_CONTADO = new Set(['TCCD', 'TCCM', 'CCCD', 'CCCM']);

function crearPL({ historial, leerPortafolios, cronogramaDe }) {
  // Libro de precios: lo que se operó en cada especie, en cualquier cuenta de Equanima.
  let libro = null, libroTs = 0;
  function armarLibro() {
    if (libro && Date.now() - libroTs < 30 * 60000) return libro;
    const l = {};
    for (const id of historial.ids()) {
      const h = historial.crudoDe(id);
      if (!h) continue;
      [['ARS', h.pesos], ['USD', h.usd]].forEach(([mon, filas]) => filas.forEach(x => {
        if (!x.t || /VARIAS/i.test(x.t) || !x.q || !x.i || FUTUROS.has(x.c)) return;
        const tipo = tipoDe(x.c, h.codigos[x.c]);
        if (tipo !== 'Compra' && tipo !== 'Venta') return;
        const unidad = Math.abs(x.i) / Math.abs(x.q);
        if (!(unidad > 0)) return;
        (l[x.t] = l[x.t] || []).push({ f: x.f, u: unidad, mon, p: x.p || null });
      }));
    }
    Object.values(l).forEach(a => a.sort((x, y) => (x.f < y.f ? -1 : x.f > y.f ? 1 : 0)));
    libro = l; libroTs = Date.now();
    return libro;
  }
  const ultimoOperado = (ticker, fecha) => {
    const a = armarLibro()[ticker];
    if (!a) return null;
    let mejor = null;
    for (const x of a) { if (x.f <= fecha) mejor = x; else break; }
    return mejor;
  };

  async function calcular(id, desdeIso, hastaIso) {
    const h = historial.crudoDe(id);
    const port = leerPortafolios()[id];
    if (!h) throw new Error('Todavía no hay historial de esta cuenta');
    if (!port || !port.resumen) throw new Error('Todavía no hay posición de esta cuenta');
    const hoy = isoHoy();
    let d2 = hastaIso || hoy; if (d2 > hoy) d2 = hoy;
    let desde = desdeIso || d2; if (desde > d2) desde = d2;
    const d1 = sumarDias(desde, -1); // se parte del cierre del día anterior al primero pedido

    const mep = await mercado.mepSerie();
    const detalle = port.resumen.Detalle || [];
    // Tipo de cambio que usa Gallo para esta cuenta: el de la línea USD MEP (la línea USD a secas va a cable).
    const tcGallo = num((detalle.find(x => /MEP/i.test(x.Moneda || '') && num(x.TipoCambio) > 1) || detalle.find(x => num(x.TipoCambio) > 1) || {}).TipoCambio) || mercado.mepEn(mep, hoy);
    const mepDia = d => (d >= hoy ? tcGallo : mercado.mepEn(mep, d));

    // Efectivo de hoy según Gallo (cuentas corrientes).
    // El efectivo en dólares cable (línea "USD") vale más que el MEP: se lleva a dólares MEP equivalentes con la
    // relación de tipos de cambio de Gallo, así hoy coincide con el total que informa Gallo.
    const tcCableGallo = num((detalle.find(x => /^usd$/i.test(x.Moneda || '') && num(x.TipoCambio) > 1) || {}).TipoCambio);
    const ratioCable = tcCableGallo && tcGallo ? tcCableGallo / tcGallo : 1;
    let cajaArs = 0, cajaUsd = 0;
    detalle.filter(x => /Cuenta Corriente/i.test(x.Detalle || '')).forEach(x => {
      if (/^pesos$/i.test(x.Moneda || '')) cajaArs += num(x.Importe); else cajaUsd += num(x.Cantidad) * (/^usd$/i.test(x.Moneda || '') ? ratioCable : 1);
    });
    // Tenencias de hoy por especie (suma de las filas con el mismo ticker).
    const hold = {};
    (port.activos || []).forEach(a => {
      if (!a.ticker) return;
      const e = hold[a.ticker] || (hold[a.ticker] = { q: 0, imp: 0, precio: a.precio, factor: null });
      e.q += a.cantidad; e.imp += a.importe;
      const b = a.cantidad * (a.precio || 0);
      if (b) e.factor = factorCercano(a.importe / b);
    });
    const valorHoy = num(port.resumen.TotalPosicion);

    // Movimientos de títulos y de efectivo.
    const filas = [];
    h.pesos.forEach(x => filas.push({ ...x, mon: 'ARS' }));
    h.usd.forEach(x => filas.push({ ...x, mon: 'USD' }));
    const conTicker = filas.filter(x => x.t && !/VARIAS/i.test(x.t) && x.q && !FUTUROS.has(x.c));

    // Series de precios de las especies en juego (solo las que tuvieron cantidad en alguna de las dos fechas).
    const tickers = new Set(Object.keys(hold));
    conTicker.filter(x => x.f > d1).forEach(x => tickers.add(x.t));
    const series = {};
    await Promise.all([...tickers].map(async t => {
      const e = hold[t];
      const s = await mercado.cierresDe(t);
      if (!s) return;
      if (e && e.q && e.precio) { // sanidad: el último cierre tiene que parecerse al precio que informa Gallo
        const u = mercado.cierreEn(s, hoy);
        const r = u ? u.precio / e.precio : null;
        if (!r || r < 0.75 || r > 1.33) return;
      }
      series[t] = s;
    }));

    const estimadas = {}; // especie -> cómo se valuó cuando no hubo precio propio
    function unidadEn(t, d) {
      const e = hold[t];
      // 1) cierre de la serie × factor
      const s = series[t];
      let factor = e && e.factor;
      if (!factor) { const ult = ultimoOperado(t, hoy); if (ult && ult.p) factor = factorCercano(ult.u / ult.p); }
      if (s && factor) { const c = mercado.cierreEn(s, d); if (c && dias(c.fecha, d) <= 7) return { v: c.precio * factor, fuente: 'serie' }; }
      // 2) último precio operado por los clientes
      const op = ultimoOperado(t, d);
      if (op && dias(op.f, d) <= 120) return { v: op.mon === 'USD' ? op.u * mepDia(d) : op.u, fuente: 'operado' };
      // 3) el precio de hoy
      if (e && e.q) { estimadas[t] = true; return { v: e.imp / e.q, fuente: 'actual' }; }
      return { v: 0, fuente: 'sin precio' };
    }

    const valorEn = d => {
      if (d >= hoy) return { ars: valorHoy, tc: tcGallo, usd: valorHoy / tcGallo, tenencias: null };
      let tenencias = 0, valuado = 0, aPrecioActual = 0;
      const qty = {};
      Object.keys(hold).forEach(t => { qty[t] = hold[t].q; });
      conTicker.forEach(x => { if (x.f > d) qty[x.t] = (qty[x.t] || 0) - x.q; });
      Object.entries(qty).forEach(([t, q]) => {
        if (Math.abs(q) < 1e-9) return;
        const u = unidadEn(t, d);
        const v = q * u.v;
        tenencias += v; valuado += Math.abs(v);
        if (u.fuente === 'actual' || u.fuente === 'sin precio') aPrecioActual += Math.abs(v);
      });
      let ars = cajaArs, usd = cajaUsd;
      filas.forEach(x => { if (x.f > d && x.i) { if (x.mon === 'ARS') ars -= x.i; else usd -= x.i; } });
      const tc = mepDia(d);
      const total = tenencias + ars + usd * tc;
      return { ars: total, tc, usd: total / tc, tenencias, valuado, aPrecioActual };
    };

    const v1 = valorEn(d1), v2 = valorEn(d2);

    // Aportes y retiros del período (efectivo y títulos que entran o salen de la cuenta).
    const flujos = [];
    filas.filter(x => x.f > d1 && x.f <= d2).forEach(x => {
      if (FLUJOS_EFECTIVO.has(x.c) && x.i) {
        const tc = mepDia(x.f);
        flujos.push({ f: x.f, c: x.c, ars: x.mon === 'ARS' ? x.i : x.i * tc, usd: x.mon === 'USD' ? x.i : x.i / tc });
      } else if (FLUJOS_TITULOS.has(x.c) && x.q && x.t && !/VARIAS/i.test(x.t)) {
        const u = unidadEn(x.t, x.f), tc = mepDia(x.f), ars = x.q * u.v;
        flujos.push({ f: x.f, c: x.c, t: x.t, ars, usd: ars / tc });
      }
    });
    const dur = Math.max(1, dias(d1, d2));
    const sumF = k => flujos.reduce((a, f) => a + f[k], 0);
    const ponderado = k => flujos.reduce((a, f) => a + f[k] * (dias(f.f, d2) / dur), 0);
    const armar = (k, v0, v1v) => {
      const res = v1v - v0 - sumF(k);
      const base = v0 + ponderado(k);
      return { inicio: v0, fin: v1v, flujos: sumF(k), resultado: res, pct: base > 0 ? res / base * 100 : null };
    };
    const ars = armar('ars', v1.ars, v2.ars), usd = armar('usd', v1.usd, v2.usd);

    // Desglose del resultado: lo que ya se cobró o se realizó y el resto (cambio en lo no realizado).
    const en = x => x.f > d1 && x.f <= d2;
    const valor = x => { const tc = mepDia(x.f); return x.mon === 'ARS' ? { ars: x.i, usd: x.i / tc } : { ars: x.i * tc, usd: x.i }; };
    const grupo = pred => filas.filter(x => en(x) && x.i && pred(x)).reduce((a, x) => { const v = valor(x); return { ars: a.ars + v.ars, usd: a.usd + v.usd }; }, { ars: 0, usd: 0 });
    const cobros = grupo(x => x.c === 'DIV' || x.c === 'RTA');
    const intereses = grupo(x => INTERESES.has(x.c));
    const gastos = grupo(x => { const t = tipoDe(x.c, h.codigos[x.c]); return t === 'Retención' || t === 'Bonificación' || t === 'Crédito' || t === 'Ajuste'; });
    const g = historial.gananciasDe(id);
    const realizado = (g ? g.ganancias : []).filter(x => x.fecha > d1 && x.fecha <= d2).reduce((a, x) => {
      const p = x.ventaRescate - x.costo, tc = mepDia(x.fecha);
      return (x.moneda || 'ARS') === 'USD' ? { ars: a.ars + p * tc, usd: a.usd + p } : { ars: a.ars + p, usd: a.usd + p / tc };
    }, { ars: 0, usd: 0 });
    const desglose = k => {
      const resto = (k === 'ars' ? ars : usd).resultado - realizado[k] - cobros[k] - intereses[k] - gastos[k];
      return { realizado: realizado[k], cobros: cobros[k], intereses: intereses[k], gastos: gastos[k], noRealizado: resto };
    };

    return {
      ok: true, id: String(id), desde, hasta: d2, base: d1, tc: { inicio: v1.tc, fin: v2.tc },
      ars: { ...ars, desglose: desglose('ars') }, usd: { ...usd, desglose: desglose('usd') },
      precios: {
        estimadas: Object.keys(estimadas),
        pctEstimado: v1.valuado ? Math.round((v1.aPrecioActual || 0) / v1.valuado * 100) : 0,
      },
      historialDesde: [...h.pesos, ...h.usd].map(x => x.f).sort()[0] || null,
    };
  }

  // Cobros (dividendos y rentas) y cauciones de una cuenta entre dos fechas, en la moneda de cada movimiento.
  // Las rentas de bonos y ONs vienen de Gallo juntas con la amortización ("RENTA Y AMORTIZACION"): con el
  // cronograma del título se separa lo que es interés de lo que es devolución de capital. Si no hay cronograma
  // (los títulos que ya pagaron y no figuran en las fuentes) el cobro queda "sin desglose" y no se suma al total.
  async function flujosPeriodo(id, desde, hasta) {
    const h = historial.crudoDe(id);
    if (!h) throw new Error('Todavía no hay historial de esta cuenta');
    const hoy = isoHoy();
    const d2 = hasta && hasta < hoy ? hasta : hoy;
    const en = f => f && (!desde || f >= desde) && f <= d2;
    const filas = [];
    h.pesos.forEach(x => filas.push({ ...x, mon: 'ARS' }));
    h.usd.forEach(x => filas.push({ ...x, mon: 'USD' }));

    const cobros = [];
    const cache = {};
    for (const x of filas) {
      if ((x.c !== 'DIV' && x.c !== 'RTA') || !x.i || !en(x.f)) continue;
      const base = { f: x.f, t: x.t || '', n: x.e || '', mon: x.mon, monto: x.i };
      if (x.c === 'DIV') { cobros.push({ ...base, tipo: 'Dividendo', renta: x.i, amort: 0, desglose: true }); continue; }
      let sched = cache[x.t];
      if (sched === undefined) { try { sched = (cronogramaDe && await cronogramaDe(x.t)) || null; } catch (e) { sched = null; } cache[x.t] = sched; }
      let m = null;
      if (sched) sched.filter(s => s.cupon + s.amort > 0).forEach(s => { const dd = Math.abs(dias(s.fecha, x.f)); if (dd <= 5 && (!m || dd < m.dd)) m = { ...s, dd }; });
      if (m) { const k = m.cupon / (m.cupon + m.amort); cobros.push({ ...base, tipo: 'Renta', renta: x.i * k, amort: x.i * (1 - k), desglose: true }); }
      else cobros.push({ ...base, tipo: 'Renta y amortización', renta: null, amort: null, desglose: false });
    }
    cobros.sort((a, b) => (a.f < b.f ? 1 : a.f > b.f ? -1 : 0));

    // Cauciones: se agrupan por fecha de concertación, moneda y lado; se cuentan solo las que tienen sus dos patas.
    const grupos = {};
    for (const x of filas) {
      const esT = CAUC_T.has(x.c), esC = CAUC_C.has(x.c);
      if ((!esT && !esC) || !x.i || !en(x.f)) continue;
      const k = `${x.f}|${x.mon}|${esT ? 'T' : 'C'}`;
      const g = grupos[k] || (grupos[k] = { f: x.f, mon: x.mon, lado: esT ? 'T' : 'C', contado: 0, termino: 0, fl: x.fl });
      if (CAUC_CONTADO.has(x.c)) g.contado += x.i; else { g.termino += x.i; if (x.fl > g.fl) g.fl = x.fl; }
    }
    const detalle = [], vacio = () => ({ costo: 0, renta: 0, n: 0 });
    const tot = { ARS: vacio(), USD: vacio() };
    let incompletas = 0;
    Object.values(grupos).forEach(g => {
      const a = Math.abs(g.contado), b = Math.abs(g.termino);
      if (!a || !b || b / a < 0.9 || b / a > 1.25) { incompletas++; return; }
      const neto = g.contado + g.termino; // tomadora: negativo (costo); colocadora: positivo (renta)
      detalle.push({ f: g.f, fl: g.fl, lado: g.lado === 'T' ? 'Tomadora' : 'Colocadora', mon: g.mon, capital: a, interes: neto });
      const t = tot[g.mon]; t.n++;
      if (g.lado === 'T') t.costo += neto; else t.renta += neto;
    });
    detalle.sort((a, b) => (a.f < b.f ? 1 : a.f > b.f ? -1 : 0));
    return { ok: true, id: String(id), desde: desde || null, hasta: d2, cobros, cauciones: { totales: tot, detalle, incompletas } };
  }

  return { calcular, flujosPeriodo };
}

module.exports = { crearPL };
