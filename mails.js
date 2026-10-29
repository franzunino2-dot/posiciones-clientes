// Mails a los clientes de Equanima: redacción con IA, vista previa, envío de prueba y envío por tandas.
//
// Todo pasa por la sesión de la ALyC. Nada sale si no están cargadas las credenciales en .env, y el envío a más de
// una persona exige además MAIL_ENVIO_MASIVO=1 y que quien envía escriba la cantidad exacta de destinatarios.
//
// .env:
//   MAIL_SMTP_HOST, MAIL_SMTP_PORT (587 por defecto), MAIL_SMTP_USER, MAIL_SMTP_PASS   servidor de correo
//   MAIL_FROM            remitente, ej. Equanima Securities <info@equanimasecurities.com>
//   MAIL_REPLY_TO        opcional, a dónde llegan las respuestas
//   ANTHROPIC_API_KEY    para redactar con IA (opcional: sin clave se escribe a mano)
//   MAIL_ENVIO_MASIVO=1  habilita el envío a varios destinatarios (apagado por defecto)
//   MAIL_LOTE (20) y MAIL_PAUSA_MS (4000)   cuántos mails por tanda y la pausa entre tandas

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const nodemailer = require('nodemailer');

const DIR = path.join(__dirname, 'mercado');
const LOG = path.join(DIR, 'mails-envios.jsonl');
const BAJAS = path.join(DIR, 'mails-baja.json');
const LOGO = path.join(__dirname, 'logo-equanima.png');
const MODELO_IA = process.env.MAIL_MODELO_IA || 'claude-sonnet-5-5';

const cfg = () => ({
  host: (process.env.MAIL_SMTP_HOST || '').trim(),
  port: Number(process.env.MAIL_SMTP_PORT || 587),
  user: (process.env.MAIL_SMTP_USER || '').trim(),
  pass: process.env.MAIL_SMTP_PASS || '',
  from: (process.env.MAIL_FROM || '').trim(),
  replyTo: (process.env.MAIL_REPLY_TO || '').trim(),
  ia: (process.env.ANTHROPIC_API_KEY || '').trim(),
  masivo: ['1', 'true', 'si'].includes(String(process.env.MAIL_ENVIO_MASIVO || '').toLowerCase()),
  lote: Math.max(1, Number(process.env.MAIL_LOTE || 20)),
  pausa: Math.max(0, Number(process.env.MAIL_PAUSA_MS || 4000)),
});
const smtpListo = c => !!(c.host && c.user && c.pass && c.from);

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const limpiaLinea = s => String(s || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200); // el asunto no puede traer saltos de línea
const mailValido = m => /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/.test(m);

// Nombre de pila para el saludo: solo cuando Gallo lo trae como "Apellido, Nombre". Si no, saludo sin nombre
// (en el resto el orden de apellido y nombre no es confiable y un saludo con el nombre equivocado es peor que ninguno).
function nombrePila(nombre) {
  const m = String(nombre || '').split(',');
  if (m.length !== 2 || !m[1].trim()) return '';
  const n = m[1].trim().split(/\s+/)[0].toLowerCase();
  return n.charAt(0).toUpperCase() + n.slice(1);
}

function leerBajas() { try { return new Set(JSON.parse(fs.readFileSync(BAJAS, 'utf8')).map(x => String(x).toLowerCase())); } catch (e) { return new Set(); } }
function guardarBajas(set) { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(BAJAS, JSON.stringify([...set].sort())); }

// ---------- Plantilla ----------
function htmlMail({ asunto, cuerpo, saludo }) {
  const parrafos = String(cuerpo || '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
    .map(p => `<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:#0e3852">${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  return `<!doctype html><html lang="es"><body style="margin:0;padding:0;background:#edf1f4;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#edf1f4"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-top:4px solid #0e3852">
<tr><td style="padding:28px 36px 8px"><img src="cid:logo-equanima" width="170" alt="Equanima Securities" style="display:block;border:0"></td></tr>
<tr><td style="padding:20px 36px 8px">
<p style="margin:0 0 18px;font-size:20px;font-weight:300;color:#0e3852">${esc(saludo)}</p>
${parrafos}
<p style="margin:24px 0 0;font-size:16px;color:#0e3852">Un saludo,<br><strong>Equanima Securities</strong></p>
</td></tr>
<tr><td style="padding:28px 36px 30px"><div style="border-top:1px solid #dbe3e8;padding-top:16px;font-size:12px;line-height:1.5;color:#5b7584">
Equanima Securities S.A. · Agente de Liquidación y Compensación Propio, CNV N.º 191.<br>
Recibís este mail porque sos cliente de Equanima Securities. Si no querés recibir más comunicaciones, respondé este mail con la palabra BAJA.<br>
La información de este mensaje es de carácter informativo y no constituye asesoramiento financiero ni una oferta de inversión.
</div></td></tr></table></td></tr></table></body></html>`;
}
const textoMail = ({ cuerpo, saludo }) => `${saludo}\n\n${String(cuerpo || '').trim()}\n\nUn saludo,\nEquanima Securities\n\n--\nEquanima Securities S.A. · ALyC Propio CNV N.º 191.\nSi no querés recibir más comunicaciones, respondé este mail con la palabra BAJA.`;

// ---------- Envío ----------
function transporte(c) {
  return nodemailer.createTransport({ host: c.host, port: c.port, secure: c.port === 465, auth: { user: c.user, pass: c.pass }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000 });
}
async function enviarUno(tr, c, { a, asunto, cuerpo, nombre }) {
  const saludo = nombrePila(nombre) ? `Hola ${nombrePila(nombre)},` : 'Hola,';
  const adjuntos = fs.existsSync(LOGO) ? [{ filename: 'equanima.png', path: LOGO, cid: 'logo-equanima' }] : [];
  return tr.sendMail({
    from: c.from, to: a, subject: limpiaLinea(asunto), replyTo: c.replyTo || undefined,
    html: htmlMail({ asunto, cuerpo, saludo }), text: textoMail({ cuerpo, saludo }), attachments: adjuntos,
    headers: { 'Auto-Submitted': 'auto-generated', 'X-Equanima-Origen': 'posiciones-clientes' },
  });
}
function anotar(linea) { try { fs.mkdirSync(DIR, { recursive: true }); fs.appendFileSync(LOG, JSON.stringify(linea) + '\n'); } catch (e) { /* ignorar */ } }

const trabajos = {}; // id -> estado del envío en curso o terminado (en memoria; el detalle queda en el log)

function registrar(app, { requireAuth, comitentes }) {
  const soloAlyc = (req, res, next) => (req.sesion.rol === 'alyc' || req.sesion.rol === 'admin' ? next() : res.status(403).json({ ok: false, error: 'Solo la ALyC puede enviar mails' }));

  // Destinatarios únicos por mail (varias cuentas pueden compartirlo), sin los dados de baja ni los mails mal formados.
  async function destinatarios() {
    const bajas = leerBajas();
    const por = {};
    (await comitentes()).forEach(c => {
      const m = String(c.email || '').trim().toLowerCase();
      if (!m) return;
      const e = por[m] || (por[m] = { email: m, nombre: c.nombre || '', cuentas: [], managers: new Set(), productores: new Set() });
      e.cuentas.push(c.id); e.managers.add(String(c.managerId)); if (c.productor) e.productores.add(c.productor);
    });
    return Object.values(por).map(e => ({ email: e.email, nombre: e.nombre, cuentas: e.cuentas, managers: [...e.managers], productores: [...e.productores], valido: mailValido(e.email), baja: bajas.has(e.email) }));
  }

  app.get('/api/mails/estado', requireAuth, soloAlyc, async (req, res) => {
    const c = cfg(); const d = await destinatarios();
    res.json({
      ok: true, smtp: smtpListo(c), desde: c.from || null, ia: !!c.ia, masivo: c.masivo, lote: c.lote,
      faltan: [...(smtpListo(c) ? [] : ['MAIL_SMTP_HOST, MAIL_SMTP_USER, MAIL_SMTP_PASS y MAIL_FROM']), ...(c.ia ? [] : ['ANTHROPIC_API_KEY (para redactar con IA)'])],
      destinatarios: { mails: d.length, validos: d.filter(x => x.valido && !x.baja).length, bajas: d.filter(x => x.baja).length, invalidos: d.filter(x => !x.valido).length },
    });
  });

  app.get('/api/mails/destinatarios', requireAuth, soloAlyc, async (req, res) => {
    const d = await destinatarios();
    const mgr = {}; // código de manager -> nombre
    (await comitentes()).forEach(c => { if (c.managerId != null) mgr[String(c.managerId)] = c.productor || ('Manager ' + c.managerId); });
    res.json({ ok: true, destinatarios: d, managers: Object.entries(mgr).map(([codigo, nombre]) => ({ codigo, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre)) });
  });

  app.post('/api/mails/vista', requireAuth, soloAlyc, (req, res) => {
    const { asunto, cuerpo } = req.body || {};
    // En la vista previa el logo va incrustado (en el mail real viaja como adjunto en línea).
    const logo = fs.existsSync(LOGO) ? 'data:image/png;base64,' + fs.readFileSync(LOGO).toString('base64') : '';
    res.json({ ok: true, html: htmlMail({ asunto, cuerpo, saludo: 'Hola Nombre,' }).replace('cid:logo-equanima', logo) });
  });

  // Redacción con IA: devuelve asunto y cuerpo para editar; no envía nada.
  app.post('/api/mails/redactar', requireAuth, soloAlyc, async (req, res) => {
    const c = cfg();
    if (!c.ia) return res.status(503).json({ ok: false, error: 'Falta ANTHROPIC_API_KEY en el .env para redactar con IA. Mientras tanto podés escribir el mail a mano.' });
    const instruccion = String((req.body || {}).instruccion || '').trim().slice(0, 3000);
    const borrador = String((req.body || {}).borrador || '').trim().slice(0, 6000);
    if (instruccion.length < 8) return res.status(400).json({ ok: false, error: 'Contá en una o dos frases qué querés comunicar.' });
    try {
      const sistema = `Sos quien redacta los mails de Equanima Securities, una ALyC argentina (CNV N.º 191), a sus clientes inversores.
Escribí en español rioplatense, con tono cercano, claro y profesional; tuteo con "vos" y sin jerga innecesaria. Frases cortas, párrafos de 1 a 3 oraciones.
Reglas que no se rompen:
- No des recomendaciones de inversión, no prometas rendimientos ni pronostiques precios o el dólar.
- No inventes datos, cifras, fechas, normas ni nombres: usá solo lo que te pasan. Si falta un dato necesario, dejá entre corchetes [así] lo que hay que completar.
- No incluyas saludo inicial ("Hola...") ni despedida ni firma: el sistema los agrega.
- No incluyas el pie legal.
- Texto plano, sin markdown, sin emojis.
Respondé SOLO con JSON válido: {"asunto": "...", "cuerpo": "párrafos separados por una línea en blanco"}. El asunto tiene hasta 70 caracteres.`;
      const r = await axios.post('https://api.anthropic.com/v1/messages', {
        model: MODELO_IA, max_tokens: 1200, system: sistema,
        messages: [{ role: 'user', content: borrador ? `Mejorá este borrador según la indicación.\n\nIndicación: ${instruccion}\n\nBorrador:\n${borrador}` : `Redactá el mail. Lo que hay que comunicar: ${instruccion}` }],
      }, { headers: { 'x-api-key': c.ia, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 60000 });
      const texto = ((r.data && r.data.content) || []).map(b => b.text || '').join('').trim();
      const json = JSON.parse(texto.slice(texto.indexOf('{'), texto.lastIndexOf('}') + 1));
      if (!json.asunto || !json.cuerpo) throw new Error('La IA no devolvió asunto y cuerpo');
      res.json({ ok: true, asunto: limpiaLinea(json.asunto).slice(0, 90), cuerpo: String(json.cuerpo).trim() });
    } catch (e) {
      const det = e.response && e.response.data && (e.response.data.error && e.response.data.error.message || JSON.stringify(e.response.data));
      res.status(502).json({ ok: false, error: 'No se pudo redactar con la IA: ' + String(det || e.message).slice(0, 200) });
    }
  });

  // Prueba: un solo destinatario, el que se indique.
  app.post('/api/mails/prueba', requireAuth, soloAlyc, async (req, res) => {
    const c = cfg();
    if (!smtpListo(c)) return res.status(503).json({ ok: false, error: 'Falta configurar el servidor de correo en el .env (MAIL_SMTP_HOST, MAIL_SMTP_USER, MAIL_SMTP_PASS y MAIL_FROM).' });
    const { asunto, cuerpo, a } = req.body || {};
    const destino = String(a || '').trim().toLowerCase();
    if (!mailValido(destino)) return res.status(400).json({ ok: false, error: 'Poné una dirección de mail válida para la prueba.' });
    if (!limpiaLinea(asunto) || !String(cuerpo || '').trim()) return res.status(400).json({ ok: false, error: 'Falta el asunto o el texto del mail.' });
    try {
      await enviarUno(transporte(c), c, { a: destino, asunto: '[PRUEBA] ' + limpiaLinea(asunto), cuerpo, nombre: '' });
      anotar({ ts: new Date().toISOString(), tipo: 'prueba', por: req.sesion.email, a: destino, asunto: limpiaLinea(asunto) });
      res.json({ ok: true, enviado: destino });
    } catch (e) { res.status(502).json({ ok: false, error: 'No se pudo enviar la prueba: ' + String(e.message).slice(0, 200) }); }
  });

  // Envío a varios: exige MAIL_ENVIO_MASIVO=1 y que se confirme la cantidad exacta. Sale por tandas, en segundo plano.
  app.post('/api/mails/enviar', requireAuth, soloAlyc, async (req, res) => {
    const c = cfg();
    if (!smtpListo(c)) return res.status(503).json({ ok: false, error: 'Falta configurar el servidor de correo en el .env.' });
    if (!c.masivo) return res.status(403).json({ ok: false, error: 'El envío a varios destinatarios está apagado. Se habilita con MAIL_ENVIO_MASIVO=1 en el .env cuando cumplimiento lo haya aprobado.' });
    const { asunto, cuerpo, managers, emails, confirmar } = req.body || {};
    if (!limpiaLinea(asunto) || !String(cuerpo || '').trim()) return res.status(400).json({ ok: false, error: 'Falta el asunto o el texto del mail.' });
    if (Object.values(trabajos).some(t => t.estado === 'enviando')) return res.status(409).json({ ok: false, error: 'Ya hay un envío en curso. Esperá a que termine.' });
    let lista = (await destinatarios()).filter(d => d.valido && !d.baja);
    if (Array.isArray(managers) && managers.length) lista = lista.filter(d => d.managers.some(m => managers.map(String).includes(m)));
    if (Array.isArray(emails) && emails.length) { const set = new Set(emails.map(x => String(x).toLowerCase())); lista = lista.filter(d => set.has(d.email)); }
    if (!lista.length) return res.status(400).json({ ok: false, error: 'No hay destinatarios con esos filtros.' });
    if (Number(confirmar) !== lista.length) return res.status(400).json({ ok: false, error: `Para enviar tenés que confirmar la cantidad exacta de destinatarios: son ${lista.length}.`, destinatarios: lista.length });
    const id = 'e' + Date.now();
    const t = trabajos[id] = { id, estado: 'enviando', total: lista.length, enviados: 0, fallidos: 0, asunto: limpiaLinea(asunto), por: req.sesion.email, inicio: new Date().toISOString(), errores: [] };
    anotar({ ts: t.inicio, tipo: 'inicio', id, por: t.por, asunto: t.asunto, total: t.total });
    res.json({ ok: true, id, total: t.total });
    // Segundo plano: tandas de MAIL_LOTE con pausa; un fallo no frena al resto.
    (async () => {
      const tr = transporte(c);
      for (let i = 0; i < lista.length; i += c.lote) {
        for (const d of lista.slice(i, i + c.lote)) {
          try { await enviarUno(tr, c, { a: d.email, asunto, cuerpo, nombre: d.nombre }); t.enviados++; anotar({ ts: new Date().toISOString(), tipo: 'ok', id, a: d.email }); }
          catch (e) { t.fallidos++; t.errores.push({ a: d.email, error: String(e.message).slice(0, 120) }); anotar({ ts: new Date().toISOString(), tipo: 'error', id, a: d.email, error: String(e.message).slice(0, 160) }); }
        }
        if (i + c.lote < lista.length && c.pausa) await new Promise(r => setTimeout(r, c.pausa));
      }
      t.estado = 'terminado'; t.fin = new Date().toISOString();
      anotar({ ts: t.fin, tipo: 'fin', id, enviados: t.enviados, fallidos: t.fallidos });
    })().catch(e => { t.estado = 'error'; t.error = String(e.message).slice(0, 200); });
  });

  app.get('/api/mails/envios', requireAuth, soloAlyc, (req, res) => {
    res.json({ ok: true, envios: Object.values(trabajos).sort((a, b) => b.inicio.localeCompare(a.inicio)).slice(0, 10) });
  });

  app.post('/api/mails/baja', requireAuth, soloAlyc, (req, res) => {
    const m = String((req.body || {}).email || '').trim().toLowerCase();
    if (!mailValido(m)) return res.status(400).json({ ok: false, error: 'Mail inválido.' });
    const s = leerBajas(); (req.body.quitar ? s.delete(m) : s.add(m)); guardarBajas(s);
    anotar({ ts: new Date().toISOString(), tipo: req.body.quitar ? 'alta' : 'baja', por: req.sesion.email, a: m });
    res.json({ ok: true, bajas: s.size });
  });
}

module.exports = { registrar, htmlMail, nombrePila, enviarUno };
