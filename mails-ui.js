// Panel ALyC > Mails a clientes: redactar con IA, previsualizar, probar y enviar. Ver mails.js (servidor).

const ML = { estado: null, dest: null, managers: [], sel: new Set(), asunto: "", cuerpo: "", instr: "", redactando: false, msg: "", msgOk: true, prueba: "", envios: [], confirmando: false, vistaTimer: null, pollTimer: null };
const mlAuth = () => ({ Authorization: "Bearer " + sesion.token, "Content-Type": "application/json" });
const mlEsc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function mlApi(ruta, cuerpo) {
  const r = await fetch("/api/mails/" + ruta, cuerpo === undefined ? { headers: mlAuth() } : { method: "POST", headers: mlAuth(), body: JSON.stringify(cuerpo) });
  return r.json();
}

// Destinatarios según los managers tildados (ninguno tildado = todos). Sin los dados de baja ni los mails inválidos.
function mlLista() {
  const base = (ML.dest || []).filter(d => d.valido && !d.baja);
  return ML.sel.size ? base.filter(d => d.managers.some(m => ML.sel.has(m))) : base;
}

async function renderMails() {
  const el = document.getElementById("view-mails");
  if (!ML.estado) {
    el.innerHTML = `<div class="mk-cab"><div><span class="mk-sup">PANEL ALYC</span><h1>Mails a clientes</h1></div></div><p class="mk-vacio">Cargando…</p>`;
    try {
      const [e, d] = await Promise.all([mlApi("estado"), mlApi("destinatarios")]);
      if (!e.ok || !d.ok) throw new Error(e.error || d.error);
      ML.estado = e; ML.dest = d.destinatarios; ML.managers = d.managers;
      mlEnvios();
    } catch (err) { el.innerHTML += `<p class="mk-vacio">No se pudo cargar: ${mlEsc(err.message)}</p>`; return; }
  }
  mlPintar();
}

function mlPintar() {
  const el = document.getElementById("view-mails");
  const e = ML.estado, lista = mlLista();
  const puede = e.smtp;
  const cuentas = lista.reduce((a, d) => a + d.cuentas.length, 0);
  const enCurso = ML.envios.find(x => x.estado === "enviando");
  el.innerHTML = `
    <div class="mk-cab">
      <div><span class="mk-sup">PANEL ALYC</span><h1>Mails a clientes</h1><span class="mk-sub">Redactá con IA, mirá cómo queda, probalo en tu mail y enviá a los clientes de Equanima.</span></div>
    </div>
    ${e.faltan.length ? `<div class="mk-card" style="border-color:var(--accent)"><h3>FALTA CONFIGURAR</h3><p class="mk-nota" style="font-size:13px;margin:0">Cargá en el archivo <b>.env</b> de este servidor: ${e.faltan.map(mlEsc).join("; ")}. Después reiniciá el servidor. ${e.smtp ? "" : "Hasta entonces no se puede enviar, ni siquiera de prueba."}</p></div>` : ""}
    <div class="ml-grid">
      <div>
        <section class="mk-card">
          <h3>1 · QUÉ QUERÉS COMUNICAR</h3>
          <textarea id="mlInstr" rows="3" placeholder="Ej.: Avisar que el lunes es feriado, que no hay operatoria y que se retoma el martes." oninput="ML.instr=this.value">${mlEsc(ML.instr)}</textarea>
          <div class="mk-pills" style="margin:10px 0 0">
            <button class="on" onclick="mlRedactar()" ${ML.redactando || !e.ia ? "disabled" : ""}>${ML.redactando ? "Redactando…" : (ML.cuerpo ? "Mejorar con IA" : "Redactar con IA")}</button>
            ${e.ia ? "" : `<span class="mk-nota">Sin la clave de IA podés escribir el mail a mano.</span>`}
          </div>
        </section>
        <section class="mk-card">
          <h3>2 · EL MAIL</h3>
          <input id="mlAsunto" type="text" style="width:100%;margin-bottom:10px" placeholder="Asunto" maxlength="120" value="${mlEsc(ML.asunto)}" oninput="ML.asunto=this.value; mlVista()">
          <textarea id="mlCuerpo" rows="11" placeholder="Escribí el texto. Separá los párrafos con una línea en blanco. No hace falta el saludo ni la firma: se agregan solos." oninput="ML.cuerpo=this.value; mlVista()">${mlEsc(ML.cuerpo)}</textarea>
          <p class="mk-nota">Se agrega solo: saludo ("Hola Nombre," cuando se conoce el nombre), firma de Equanima Securities y el pie legal con la opción de baja.</p>
        </section>
        <section class="mk-card">
          <h3>3 · A QUIÉN</h3>
          <div class="ml-mgrs">
            <label class="ml-chk"><input type="checkbox" ${ML.sel.size ? "" : "checked"} onchange="mlTodos()"> <b>Todos los clientes</b></label>
            ${ML.managers.map(m => { const n = (ML.dest || []).filter(d => d.valido && !d.baja && d.managers.includes(m.codigo)).length; return `<label class="ml-chk"><input type="checkbox" ${ML.sel.has(m.codigo) ? "checked" : ""} onchange="mlManager('${mlEsc(m.codigo)}', this.checked)"> ${mlEsc(m.nombre)} <span class="mk-nota">${n}</span></label>`; }).join("")}
          </div>
          <p style="margin:12px 0 0;font-size:15px"><b>${lista.length}</b> mails distintos <span class="mk-nota">· ${cuentas} cuentas${e.destinatarios.bajas ? ` · ${e.destinatarios.bajas} dados de baja excluidos` : ""}${e.destinatarios.invalidos ? ` · ${e.destinatarios.invalidos} mails inválidos excluidos` : ""}</span></p>
        </section>
        <section class="mk-card">
          <h3>4 · PROBAR Y ENVIAR</h3>
          ${ML.msg ? `<p class="${ML.msgOk ? "pos" : "neg"}" style="margin:0 0 10px;font-size:13px">${mlEsc(ML.msg)}</p>` : ""}
          <div class="mk-pills" style="margin-bottom:6px">
            <input id="mlPrueba" type="email" placeholder="Tu mail para la prueba" value="${mlEsc(ML.prueba)}" oninput="ML.prueba=this.value" style="min-width:250px">
            <button onclick="mlProbar()" ${puede ? "" : "disabled"}>Enviar prueba</button>
          </div>
          <p class="mk-nota" style="margin:0 0 14px">La prueba sale solo a esa dirección, marcada [PRUEBA].</p>
          ${ML.confirmando ? `
            <div class="ml-confirma">
              <p style="margin:0 0 8px;font-size:14px">Vas a enviar <b>"${mlEsc(ML.asunto)}"</b> a <b>${lista.length}</b> mails distintos. No se puede deshacer. Escribí la cantidad para confirmar:</p>
              <div class="mk-pills" style="margin:0">
                <input id="mlConfirmar" type="text" inputmode="numeric" placeholder="${lista.length}" style="width:110px">
                <button class="on" onclick="mlEnviar()">Confirmar y enviar</button>
                <button onclick="ML.confirmando=false; mlPintar()">Cancelar</button>
              </div>
            </div>` : `
            <button class="btn-primary" onclick="mlPedirConfirmacion()" ${puede && e.masivo && lista.length && !enCurso ? "" : "disabled"}>Enviar a ${lista.length} destinatarios…</button>
            ${!e.masivo ? `<p class="mk-nota" style="margin:8px 0 0">El envío a varios está apagado: se habilita con <b>MAIL_ENVIO_MASIVO=1</b> en el .env, cuando cumplimiento lo haya aprobado.</p>` : ""}
            ${enCurso ? `<p class="mk-nota" style="margin:8px 0 0">Hay un envío en curso.</p>` : ""}`}
        </section>
        ${ML.envios.length ? `<section class="mk-card"><h3>ENVÍOS RECIENTES</h3><div class="table-wrap"><table><thead><tr><th>Asunto</th><th>Estado</th><th>Enviados</th><th>Fallidos</th><th>Inicio</th></tr></thead><tbody>${ML.envios.map(x => `<tr><td>${mlEsc(x.asunto)}</td><td>${x.estado === "enviando" ? "Enviando…" : x.estado === "terminado" ? "Terminado" : "Error"}</td><td>${x.enviados} de ${x.total}</td><td class="${x.fallidos ? "neg" : ""}">${x.fallidos}</td><td>${new Date(x.inicio).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}</td></tr>`).join("")}</tbody></table></div></section>` : ""}
      </div>
      <div class="ml-vista"><section class="mk-card" style="position:sticky;top:12px"><h3>ASÍ LO VA A VER EL CLIENTE</h3><iframe id="mlFrame" title="Vista previa del mail" sandbox="" style="width:100%;height:640px;border:1px solid var(--border);background:#edf1f4"></iframe></section></div>
    </div>`;
  mlVista(true);
}

function mlVista(ya) {
  clearTimeout(ML.vistaTimer);
  ML.vistaTimer = setTimeout(async () => {
    const f = document.getElementById("mlFrame"); if (!f) return;
    try { const j = await mlApi("vista", { asunto: ML.asunto, cuerpo: ML.cuerpo || "El texto del mail va a aparecer acá." }); if (j.ok) f.srcdoc = j.html; } catch (e) { /* sin vista */ }
  }, ya ? 0 : 450);
}

function mlTodos() { ML.sel.clear(); mlPintar(); }
function mlManager(cod, on) { if (on) ML.sel.add(cod); else ML.sel.delete(cod); mlPintar(); }

async function mlRedactar() {
  ML.redactando = true; ML.msg = ""; mlPintar();
  try {
    const j = await mlApi("redactar", { instruccion: ML.instr, borrador: ML.cuerpo ? `Asunto: ${ML.asunto}\n\n${ML.cuerpo}` : "" });
    if (j.ok) { ML.asunto = j.asunto; ML.cuerpo = j.cuerpo; ML.msg = "Listo el borrador. Revisalo y editá lo que haga falta antes de enviar."; ML.msgOk = true; }
    else { ML.msg = j.error; ML.msgOk = false; }
  } catch (e) { ML.msg = "No se pudo redactar: " + e.message; ML.msgOk = false; }
  ML.redactando = false; mlPintar();
}

async function mlProbar() {
  ML.msg = ""; ML.msgOk = true;
  try {
    const j = await mlApi("prueba", { asunto: ML.asunto, cuerpo: ML.cuerpo, a: ML.prueba });
    ML.msg = j.ok ? `Prueba enviada a ${j.enviado}. Revisá la bandeja de entrada (y el spam).` : j.error; ML.msgOk = !!j.ok;
  } catch (e) { ML.msg = "No se pudo enviar la prueba: " + e.message; ML.msgOk = false; }
  mlPintar();
}

function mlPedirConfirmacion() {
  if (!ML.asunto.trim() || !ML.cuerpo.trim()) { ML.msg = "Falta el asunto o el texto del mail."; ML.msgOk = false; mlPintar(); return; }
  ML.msg = ""; ML.confirmando = true; mlPintar();
  setTimeout(() => { const i = document.getElementById("mlConfirmar"); if (i) i.focus(); }, 50);
}

async function mlEnviar() {
  const n = (document.getElementById("mlConfirmar") || {}).value;
  try {
    const j = await mlApi("enviar", { asunto: ML.asunto, cuerpo: ML.cuerpo, managers: [...ML.sel], confirmar: Number(n) });
    if (j.ok) { ML.msg = `Envío iniciado a ${j.total} mails. Sale por tandas: podés seguir el avance abajo.`; ML.msgOk = true; ML.confirmando = false; mlEnvios(); }
    else { ML.msg = j.error; ML.msgOk = false; }
  } catch (e) { ML.msg = "No se pudo iniciar el envío: " + e.message; ML.msgOk = false; }
  mlPintar();
}

async function mlEnvios() {
  try { const j = await mlApi("envios"); if (j.ok) ML.envios = j.envios; } catch (e) { /* sin lista */ }
  clearTimeout(ML.pollTimer);
  if (ML.envios.some(x => x.estado === "enviando")) ML.pollTimer = setTimeout(async () => { await mlEnvios(); if (vistaActual === "mails" && !ML.confirmando) { const a = document.activeElement; if (!a || !/^(INPUT|TEXTAREA)$/.test(a.tagName)) mlPintar(); } }, 3000);
}
