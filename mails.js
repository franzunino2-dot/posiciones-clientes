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
//   ANTHROPIC_WORKSPACE_ID  solo si la clave es de usuario (sk-ant-usr-...): el ID del espacio de trabajo (wrkspc_...)
//   MAIL_ENVIO_MASIVO=1  habilita el envío a varios destinatarios (apagado por defecto)
//   MAIL_LOTE (20) y MAIL_PAUSA_MS (4000)   cuántos mails por tanda y la pausa entre tandas

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const express = require('express');
const nodemailer = require('nodemailer');

const DIR = path.join(__dirname, 'mercado');
const LOG = path.join(DIR, 'mails-envios.jsonl');
const BAJAS = path.join(DIR, 'mails-baja.json');
const GRUPOS = path.join(DIR, 'mails-grupos.json');
// Imágenes del mail (PNG de alta resolución de la marca): viajan como adjuntos en línea (cid) y en la vista previa van incrustadas.
const IMAGENES = {
  'logo-blanco': path.join(__dirname, 'mail-logo-blanco.png'),
  'delta-blanco': path.join(__dirname, 'mail-delta-blanco.png'),
  'delta': path.join(__dirname, 'mail-delta.png'),
};
// Adjuntos: los elige quien redacta y salen en todos los mails del envío. Tope bajo a propósito: cada destinatario recibe su copia.
const ADJ_MAX = 3, ADJ_BYTES = 5 * 1024 * 1024;
const ADJ_TIPOS = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', csv: 'text/csv', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xls: 'application/vnd.ms-excel', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword' };
const MAIL_INFO = 'info@equanimasecurities.com';
const MODELO_IA = process.env.MAIL_MODELO_IA || 'claude-sonnet-5-5';

const cfg = () => ({
  host: (process.env.MAIL_SMTP_HOST || '').trim(),
  port: Number(process.env.MAIL_SMTP_PORT || 587),
  user: (process.env.MAIL_SMTP_USER || '').trim(),
  pass: process.env.MAIL_SMTP_PASS || '',
  from: (process.env.MAIL_FROM || '').trim(),
  replyTo: (process.env.MAIL_REPLY_TO || '').trim(),
  ia: (process.env.ANTHROPIC_API_KEY || '').trim(),
  iaEspacio: (process.env.ANTHROPIC_WORKSPACE_ID || '').trim(), // solo para claves de usuario (sk-ant-usr-), que no están atadas a un espacio de trabajo
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
// Mail HTML de Equanima Securities, construido sobre las plantillas de mail del grupo (comunicación regular y comercial):
// banda petróleo con el lockup y el delta, título, texto, lista opcional sobre reglas finas, botón opcional, firma con delta y
// pie legal fijo. Estilos en línea y tablas (lo que exigen Gmail y Outlook). Los bloques legales son fijos: no los toca la IA.
const C = { deep: '#0E3852', dark: '#082740', muted: '#44606E', soft: '#B3DCEA', line: '#D8DFE4', alt: '#EDF1F4' };
const FUENTE = 'Helvetica, Arial, sans-serif';

// La IA y quien escribe pueden marcar con **doble asterisco** una frase clave por párrafo.
const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, `<strong style="color:${C.deep}">$1</strong>`);

// Sin guion largo ni medio (regla de estilo de Equanima): entre números es "a", en el resto una coma.
const sinGuionLargo = s => String(s == null ? '' : s).replace(/(\d)\s*[–—]\s*(\d)/g, '$1 a $2').replace(/\s*[–—]\s*/g, ', ');

function urlBoton(u) {
  const s = String(u || '').trim();
  return /^(https:\/\/|mailto:)[^\s"<>]+$/i.test(s) ? s : 'mailto:' + MAIL_INFO;
}

function bloquesCuerpo(cuerpo) {
  return String(cuerpo || '').split(/\n{2,}/).map(b => b.trim()).filter(Boolean).map(b => {
    const lineas = b.split('\n').map(l => l.trim()).filter(Boolean);
    if (lineas.length && lineas.every(l => /^[-•]\s+/.test(l))) {
      const filas = lineas.map(l => l.replace(/^[-•]\s+/, ''));
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:18px;">${filas.map((t, i) =>
        `<tr><td style="padding:11px 0;border-top:1px solid ${C.line};${i === filas.length - 1 ? `border-bottom:1px solid ${C.line};` : ''}font-family:${FUENTE};font-size:14px;line-height:1.5;color:${C.muted};">${inline(t)}</td></tr>`).join('')}</table>`;
    }
    return `<p style="margin:14px 0 0;font-size:14px;line-height:1.6;color:${C.muted};">${lineas.map(inline).join('<br>')}</p>`;
  }).join('');
}

// Valida y decodifica los adjuntos que llegan del panel ([{nombre, datos en base64}]). Devuelve { files } o { error }.
function prepararAdjuntos(lista) {
  if (!Array.isArray(lista) || !lista.length) return { files: [] };
  if (lista.length > ADJ_MAX) return { error: `Se pueden adjuntar hasta ${ADJ_MAX} archivos.` };
  let total = 0; const files = [];
  for (const a of lista) {
    const nombre = String((a && a.nombre) || '').replace(/[\\/:*?"<>|\r\n]+/g, '_').trim().slice(0, 90);
    const ext = (nombre.split('.').pop() || '').toLowerCase();
    if (!nombre || !ADJ_TIPOS[ext]) return { error: `El archivo "${nombre || '?'}" no se puede adjuntar. Tipos permitidos: ${Object.keys(ADJ_TIPOS).join(', ')}.` };
    const buf = Buffer.from(String((a && a.datos) || ''), 'base64');
    if (!buf.length) return { error: `El archivo "${nombre}" está vacío.` };
    total += buf.length; files.push({ filename: nombre, content: buf, contentType: ADJ_TIPOS[ext] });
  }
  if (total > ADJ_BYTES) return { error: `Los adjuntos pesan ${(total / 1048576).toFixed(1)} MB y el máximo es ${ADJ_BYTES / 1048576} MB en total.` };
  return { files };
}

// img(cid) arma la etiqueta de imagen: en el mail real apunta al adjunto en línea (cid:), en la vista previa a un data URI.
function htmlMail({ titulo, segmento, cuerpo, saludo, botonTexto, botonUrl }, img = cid => `cid:${cid}`) {
  const boton = limpiaLinea(botonTexto).slice(0, 60);
  return `<!doctype html>
<html lang="es-AR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(titulo)}</title></head>
<body style="margin:0;padding:0;background-color:${C.alt};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.alt};"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:640px;max-width:100%;background-color:#FFFFFF;border-radius:2px;overflow:hidden;">
<tr><td align="left" style="background-color:${C.deep};padding:26px 40px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td align="left" valign="middle" style="line-height:0;"><img src="${img('logo-blanco')}" alt="Equanima Securities" width="107" height="24" style="display:block;height:24px;width:auto;border:0;"></td>
<td width="22" valign="middle" style="width:22px;line-height:0;"><img src="${img('delta-blanco')}" alt="" width="22" height="22" style="display:block;border:0;width:22px;height:22px;"></td>
</tr></table></td></tr>
<tr><td style="padding:36px 44px 8px;font-family:${FUENTE};">
${segmento ? `<p style="margin:0;font-size:11px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase;color:${C.muted};">${esc(segmento)}</p>` : ''}
<h1 style="margin:${segmento ? 8 : 0}px 0 0;font-size:19px;line-height:1.3;font-weight:bold;color:${C.deep};">${esc(titulo)}</h1>
<p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:${C.muted};">${esc(saludo)}</p>
${bloquesCuerpo(cuerpo)}
${boton ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px;"><tr><td align="center" style="background-color:${C.deep};border-radius:999px;"><a href="${esc(urlBoton(botonUrl))}" style="display:inline-block;padding:13px 30px;font-family:${FUENTE};font-size:14px;font-weight:bold;color:#FFFFFF;text-decoration:none;">${esc(boton)}</a></td></tr></table>` : ''}
<p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:${C.muted};">Muchas gracias,</p>
</td></tr>
<tr><td style="padding:24px 44px 34px;font-family:${FUENTE};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="97" valign="top" style="width:97px;padding-right:16px;line-height:0;"><img src="${img('delta')}" alt="" width="97" height="98" style="display:block;border:0;width:97px;height:98px;"></td>
<td valign="top" style="padding-left:16px;border-left:1px solid #CBD3D6;">
<p style="margin:0;font-size:14px;line-height:1.4;font-weight:bold;color:${C.deep};">Equipo Equanima Securities</p>
<p style="margin:4px 0 0;font-size:12px;line-height:1.55;color:${C.muted};">Equanima Securities S.A.<br>ALyC Propio CNV N.º 191 · ACyDI CNV N.º 197<br>Alicia M. de Justo 140, 1B, CP1107 CABA, Argentina<br><a href="https://www.equanimasecurities.com" style="color:${C.deep};">www.equanimasecurities.com</a></p>
</td></tr></table></td></tr>
<tr><td style="background-color:${C.dark};padding:22px 44px;font-family:${FUENTE};">
<p style="margin:0;font-size:11px;line-height:1.6;color:${C.soft};">Equanima Securities S.A. es Agente de Liquidación y Compensación propio, Matrícula CNV N.º 191, y Agente de Colocación y Distribución Integral de FCI, Matrícula CNV N.º 197. Miembro de BYMA, A3 Mercados y MAV. Los valores negociables se registran en subcuentas comitentes a nombre de cada titular en Caja de Valores S.A.</p>
<p style="margin:10px 0 0;font-size:11px;line-height:1.6;color:${C.soft};">Este mensaje tiene carácter meramente informativo. No constituye una recomendación de inversión, ni una oferta de compra o venta de valores negociables.</p>
<p style="margin:10px 0 0;font-size:11px;line-height:1.6;color:${C.soft};">Si no querés recibir más comunicaciones, respondé este mail con la palabra BAJA. · <a href="mailto:${MAIL_INFO}" style="color:#FFFFFF;">${MAIL_INFO}</a></p>
</td></tr>
</table></td></tr></table></body></html>`;
}
const textoMail = ({ titulo, segmento, cuerpo, saludo, botonTexto, botonUrl }) => [
  segmento ? String(segmento).toUpperCase() : '', titulo, '', saludo, '', String(cuerpo || '').replace(/\*\*/g, '').trim(),
  botonTexto ? `\n${limpiaLinea(botonTexto)}: ${urlBoton(botonUrl)}` : '',
  '\nMuchas gracias,\nEquipo Equanima Securities\nEquanima Securities S.A.\nALyC Propio CNV N.º 191 · ACyDI CNV N.º 197\nAlicia M. de Justo 140, 1B, CP1107 CABA, Argentina\nwww.equanimasecurities.com',
  '\n--\nEste mensaje tiene carácter meramente informativo. No constituye una recomendación de inversión, ni una oferta de compra o venta de valores negociables.\nSi no querés recibir más comunicaciones, respondé este mail con la palabra BAJA.',
].join('\n');

const saludoDe = nombre => (nombrePila(nombre) ? `Hola, ${nombrePila(nombre)}:` : 'Estimados:');
// Los campos del mail tal como llegan del panel, con el título por defecto igual al asunto.
const campos = b => ({
  asunto: sinGuionLargo(limpiaLinea(b.asunto)), titulo: sinGuionLargo(limpiaLinea(b.titulo) || limpiaLinea(b.asunto)), segmento: limpiaLinea(b.segmento).slice(0, 40),
  cuerpo: sinGuionLargo(String(b.cuerpo || '').trim()), botonTexto: sinGuionLargo(limpiaLinea(b.botonTexto)), botonUrl: String(b.botonUrl || '').trim(),
});

// ---------- Envío ----------
function transporte(c) {
  return nodemailer.createTransport({ host: c.host, port: c.port, secure: c.port === 465, auth: { user: c.user, pass: c.pass }, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000 });
}
async function enviarUno(tr, c, { a, mail, nombre, prefijoAsunto = '', adjuntos: extra = [] }) {
  const m = campos(mail), saludo = saludoDe(nombre);
  const adjuntos = Object.entries(IMAGENES).filter(([, p]) => fs.existsSync(p)).map(([cid, p]) => ({ filename: cid + '.png', path: p, cid })).concat(extra);
  return tr.sendMail({
    from: c.from, to: a, subject: prefijoAsunto + m.asunto, replyTo: c.replyTo || undefined,
    html: htmlMail({ ...m, saludo }), text: textoMail({ ...m, saludo }), attachments: adjuntos,
    headers: { 'Auto-Submitted': 'auto-generated', 'X-Equanima-Origen': 'posiciones-clientes' },
  });
}
// Vista previa: las imágenes van incrustadas porque no hay adjuntos en línea.
function htmlVista(mail) {
  const datos = {};
  Object.entries(IMAGENES).forEach(([cid, p]) => { if (fs.existsSync(p)) datos[cid] = 'data:image/png;base64,' + fs.readFileSync(p).toString('base64'); });
  return htmlMail({ ...campos(mail), saludo: 'Hola, Nombre:' }, cid => datos[cid] || '');
}
function anotar(linea) { try { fs.mkdirSync(DIR, { recursive: true }); fs.appendFileSync(LOG, JSON.stringify(linea) + '\n'); } catch (e) { /* ignorar */ } }

const trabajos = {}; // id -> estado del envío en curso o terminado (en memoria; el detalle queda en el log)

function registrar(app, { requireAuth, comitentes }) {
  app.use('/api/mails', express.json({ limit: '12mb' }));
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
    res.json({ ok: true, html: htmlVista(req.body || {}) });
  });

  // Grupos de destinatarios: listas con nombre de mails, guardadas en el servidor para reusarlas.
  const leerGrupos = () => { try { const g = JSON.parse(fs.readFileSync(GRUPOS, 'utf8')); return Array.isArray(g) ? g : []; } catch (e) { return []; } };
  const guardarGrupos = g => { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(GRUPOS, JSON.stringify(g)); };

  app.get('/api/mails/grupos', requireAuth, soloAlyc, (req, res) => res.json({ ok: true, grupos: leerGrupos() }));

  // Crea el grupo o, si ya existe uno con ese nombre, lo reemplaza.
  app.post('/api/mails/grupos', requireAuth, soloAlyc, (req, res) => {
    const nombre = limpiaLinea((req.body || {}).nombre).slice(0, 60);
    const emails = [...new Set(((req.body || {}).emails || []).map(x => String(x).trim().toLowerCase()).filter(mailValido))];
    if (!nombre) return res.status(400).json({ ok: false, error: 'Ponele un nombre al grupo.' });
    if (!emails.length) return res.status(400).json({ ok: false, error: 'El grupo no tiene ningún mail. Elegí destinatarios antes de guardarlo.' });
    const g = leerGrupos(); const i = g.findIndex(x => x.nombre.toLowerCase() === nombre.toLowerCase());
    const grupo = { id: i >= 0 ? g[i].id : 'g' + Date.now().toString(36), nombre, emails, por: req.sesion.email, actualizado: new Date().toISOString() };
    if (i >= 0) g[i] = grupo; else g.push(grupo);
    guardarGrupos(g);
    anotar({ ts: grupo.actualizado, tipo: i >= 0 ? 'grupo-actualizado' : 'grupo-creado', por: req.sesion.email, grupo: nombre, mails: emails.length });
    res.json({ ok: true, grupo, grupos: g });
  });

  app.delete('/api/mails/grupos/:id', requireAuth, soloAlyc, (req, res) => {
    const g = leerGrupos(); const x = g.find(y => y.id === req.params.id);
    if (!x) return res.status(404).json({ ok: false, error: 'Ese grupo no existe.' });
    const resto = g.filter(y => y.id !== x.id); guardarGrupos(resto);
    anotar({ ts: new Date().toISOString(), tipo: 'grupo-borrado', por: req.sesion.email, grupo: x.nombre });
    res.json({ ok: true, grupos: resto });
  });

  // Redacción con IA: devuelve asunto y cuerpo para editar; no envía nada.
  app.post('/api/mails/redactar', requireAuth, soloAlyc, async (req, res) => {
    const c = cfg();
    if (!c.ia) return res.status(503).json({ ok: false, error: 'Falta ANTHROPIC_API_KEY en el .env para redactar con IA. Mientras tanto podés escribir el mail a mano.' });
    const instruccion = String((req.body || {}).instruccion || '').trim().slice(0, 3000);
    const borrador = String((req.body || {}).borrador || '').trim().slice(0, 6000);
    if (instruccion.length < 8) return res.status(400).json({ ok: false, error: 'Contá en una o dos frases qué querés comunicar.' });
    try {
      // Voz y reglas de EQUANIMA-DOCS.md (guía de piezas del grupo). Securities opera: nunca se le atribuye a Equanima Capital ni al revés.
      const sistema = `Sos quien redacta los mails de Equanima Securities S.A., Agente de Liquidación y Compensación propio (CNV N.º 191), a sus clientes. Equanima Securities opera en el mercado de capitales; el asesoramiento y la estructuración financiera son de Equanima Capital S.A., otra sociedad: no mezcles lo que hace cada una.
Voz:
- Español rioplatense con tuteo institucional ("vos", "tenés", "podés", "escribinos"); nunca "tú" ni "usted".
- Tono sobrio, concreto y profesional. Frases cortas. Sin emojis, sin signos de exclamación y sin superlativos vacíos ("increíble", "único", "líder").
- Puntuación: nunca uses el guion largo (—) ni el guion medio (–), ni para incisos, ni para rangos, ni para listas. Usá punto, dos puntos, coma o paréntesis. Para rangos: "de 10 a 12". Para negativos, el guion corto normal ("-3,2%").
- Números en formato argentino, tal como vienen en lo que te pasan (punto de miles, coma decimal: "2.410.520", "38,4%", "$1.523"). No los reformatees ni los redondees.
Reglas de contenido que no se rompen:
- Solo usás cifras, fechas, nombres, precios y hechos que estén en lo que te pasan. Nada de conocimiento propio, estimaciones ni "aproximadamente".
- Si hace falta un dato y no te lo dieron, escribí exactamente TBD en ese lugar. Nunca lo completes con un valor plausible.
- No des recomendaciones de inversión, no prometas rendimientos, no compares con otros agentes y no pronostiques precios ni el dólar. Se describe, no se recomienda.
- No incluyas saludo inicial, despedida, firma ni pie legal: la plantilla los agrega. Tampoco repitas el título dentro del cuerpo.
Estructura del mail:
- "titulo": el título que va dentro del mail, claro y declarativo, hasta 80 caracteres, sin guiones largos (por ejemplo "Operatoria 9 y 10 de julio de 2026").
- "cuerpo": de 2 a 8 párrafos cortos separados por una línea en blanco. Texto plano: la única marca permitida es **doble asterisco** para una frase clave por párrafo como máximo. Para una lista de 2 a 4 puntos, escribí un bloque donde cada línea empieza con "- ".
- "segmento": solo si es un mail comercial, uno de: Empresas, Financiamiento PyME, Banca Privada, Institucionales. Si no, "".
- "boton_texto" y "boton_url": solo si el mail pide una acción concreta (por ejemplo coordinar una reunión). Un solo botón. Si no hay destino, boton_url queda "" (se usa info@equanimasecurities.com). Si no corresponde botón, ambos "".
Respondé SOLO con JSON válido con estas claves: {"asunto": "hasta 70 caracteres", "titulo": "...", "segmento": "", "cuerpo": "...", "boton_texto": "", "boton_url": ""}.`;
      const r = await axios.post('https://api.anthropic.com/v1/messages', {
        model: MODELO_IA, max_tokens: 1800, system: sistema,
        messages: [{ role: 'user', content: borrador ? `Mejorá este borrador según la indicación.\n\nIndicación: ${instruccion}\n\nBorrador:\n${borrador}` : `Redactá el mail. Lo que hay que comunicar: ${instruccion}` }],
      }, { headers: { 'x-api-key': c.ia, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', ...(c.iaEspacio ? { 'anthropic-workspace-id': c.iaEspacio } : {}) }, timeout: 60000 });
      const texto = ((r.data && r.data.content) || []).map(b => b.text || '').join('').trim();
      const json = JSON.parse(texto.slice(texto.indexOf('{'), texto.lastIndexOf('}') + 1));
      if (!json.asunto || !json.cuerpo) throw new Error('La IA no devolvió asunto y cuerpo');
      const m = campos({ asunto: String(json.asunto).slice(0, 90), titulo: json.titulo, segmento: json.segmento, cuerpo: json.cuerpo, botonTexto: json.boton_texto, botonUrl: json.boton_url });
      res.json({ ok: true, asunto: m.asunto.slice(0, 90), titulo: m.titulo.slice(0, 100), segmento: m.segmento, cuerpo: m.cuerpo, botonTexto: m.botonTexto, botonUrl: m.botonUrl });
    } catch (e) {
      const det = e.response && e.response.data && (e.response.data.error && e.response.data.error.message || JSON.stringify(e.response.data));
      res.status(502).json({ ok: false, error: 'No se pudo redactar con la IA: ' + String(det || e.message).slice(0, 200) });
    }
  });

  // Prueba: un solo destinatario, el que se indique.
  app.post('/api/mails/prueba', requireAuth, soloAlyc, async (req, res) => {
    const c = cfg();
    if (!smtpListo(c)) return res.status(503).json({ ok: false, error: 'Falta configurar el servidor de correo en el .env (MAIL_SMTP_HOST, MAIL_SMTP_USER, MAIL_SMTP_PASS y MAIL_FROM).' });
    const { a } = req.body || {};
    const destino = String(a || '').trim().toLowerCase();
    if (!mailValido(destino)) return res.status(400).json({ ok: false, error: 'Poné una dirección de mail válida para la prueba.' });
    if (!limpiaLinea(req.body.asunto) || !String(req.body.cuerpo || '').trim()) return res.status(400).json({ ok: false, error: 'Falta el asunto o el texto del mail.' });
    const adj = prepararAdjuntos(req.body.adjuntos);
    if (adj.error) return res.status(400).json({ ok: false, error: adj.error });
    try {
      await enviarUno(transporte(c), c, { a: destino, mail: req.body, nombre: '', prefijoAsunto: '[PRUEBA] ', adjuntos: adj.files });
      anotar({ ts: new Date().toISOString(), tipo: 'prueba', por: req.sesion.email, a: destino, asunto: limpiaLinea(req.body.asunto), adjuntos: adj.files.map(f => f.filename) });
      res.json({ ok: true, enviado: destino });
    } catch (e) { res.status(502).json({ ok: false, error: 'No se pudo enviar la prueba: ' + String(e.message).slice(0, 200) }); }
  });

  // Envío a varios: exige MAIL_ENVIO_MASIVO=1 y que se confirme la cantidad exacta. Sale por tandas, en segundo plano.
  app.post('/api/mails/enviar', requireAuth, soloAlyc, async (req, res) => {
    const c = cfg();
    if (!smtpListo(c)) return res.status(503).json({ ok: false, error: 'Falta configurar el servidor de correo en el .env.' });
    if (!c.masivo) return res.status(403).json({ ok: false, error: 'El envío a varios destinatarios está apagado. Se habilita con MAIL_ENVIO_MASIVO=1 en el .env cuando cumplimiento lo haya aprobado.' });
    const { asunto, cuerpo, managers, emails, confirmar } = req.body || {};
    const mail = req.body || {};
    if (/\bTBD\b/.test([asunto, mail.titulo, cuerpo, mail.botonTexto].join(' '))) return res.status(400).json({ ok: false, error: 'El mail todavía tiene un TBD: falta completar un dato. Reemplazalo antes de enviar.' });
    if (!limpiaLinea(asunto) || !String(cuerpo || '').trim()) return res.status(400).json({ ok: false, error: 'Falta el asunto o el texto del mail.' });
    if (Object.values(trabajos).some(t => t.estado === 'enviando')) return res.status(409).json({ ok: false, error: 'Ya hay un envío en curso. Esperá a que termine.' });
    let lista = (await destinatarios()).filter(d => d.valido && !d.baja);
    if (Array.isArray(managers) && managers.length) lista = lista.filter(d => d.managers.some(m => managers.map(String).includes(m)));
    if (Array.isArray(emails) && emails.length) { const set = new Set(emails.map(x => String(x).toLowerCase())); lista = lista.filter(d => set.has(d.email)); }
    if (!lista.length) return res.status(400).json({ ok: false, error: 'No hay destinatarios con esos filtros.' });
    const adj = prepararAdjuntos(mail.adjuntos);
    if (adj.error) return res.status(400).json({ ok: false, error: adj.error });
    if (Number(confirmar) !== lista.length) return res.status(400).json({ ok: false, error: `Para enviar tenés que confirmar la cantidad exacta de destinatarios: son ${lista.length}.`, destinatarios: lista.length });
    const id = 'e' + Date.now();
    const t = trabajos[id] = { id, estado: 'enviando', total: lista.length, enviados: 0, fallidos: 0, asunto: limpiaLinea(asunto), por: req.sesion.email, inicio: new Date().toISOString(), errores: [], adjuntos: adj.files.map(f => f.filename) };
    anotar({ ts: t.inicio, tipo: 'inicio', id, por: t.por, asunto: t.asunto, total: t.total, adjuntos: t.adjuntos });
    res.json({ ok: true, id, total: t.total });
    // Segundo plano: tandas de MAIL_LOTE con pausa; un fallo no frena al resto.
    (async () => {
      const tr = transporte(c);
      for (let i = 0; i < lista.length; i += c.lote) {
        for (const d of lista.slice(i, i + c.lote)) {
          try { await enviarUno(tr, c, { a: d.email, mail, nombre: d.nombre, adjuntos: adj.files }); t.enviados++; anotar({ ts: new Date().toISOString(), tipo: 'ok', id, a: d.email }); }
          catch (e) { t.fallidos++; t.errores.push({ a: d.email, error: String(e.message).slice(0, 120) }); anotar({ ts: new Date().toISOString(), tipo: 'error', id, a: d.email, error: String(e.message).slice(0, 160) }); }
        }
        if (i + c.lote < lista.length && c.pausa) await new Promise(r => setTimeout(r, c.pausa));
      }
      t.estado = 'terminado'; t.fin = new Date().toISOString();
      anotar({ ts: t.fin, tipo: 'fin', id, enviados: t.enviados, fallidos: t.fallidos });
    })().catch(e => { t.estado = 'error'; t.error = String(e.message).slice(0, 200); });
  });

  // Lista de baja con el nombre del cliente cuando el mail es de un comitente (puede haber mails dados de baja que no son clientes).
  app.get('/api/mails/bajas', requireAuth, soloAlyc, async (req, res) => {
    const nombres = Object.fromEntries((await destinatarios()).map(d => [d.email, d.nombre]));
    res.json({ ok: true, bajas: [...leerBajas()].sort().map(email => ({ email, nombre: nombres[email] || '' })) });
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

module.exports = { registrar, htmlMail, htmlVista, nombrePila, enviarUno };
