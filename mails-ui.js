// Panel ALyC > Mails a clientes: redactar con IA, previsualizar, probar y enviar. Ver mails.js (servidor).

const ML = {
  estado: null, dest: null, managers: [], grupos: [],
  sel: new Set(), indiv: new Set(), gsel: new Set(), busca: "", res: [], gnombre: "",
  asunto: "", titulo: "", segmento: "", cuerpo: "", botonTexto: "", botonUrl: "", instr: "", adj: [], bajas: [], bajaMail: "",
  redactando: false, msg: "", msgOk: true, prueba: "", envios: [], confirmando: false, vistaTimer: null, pollTimer: null,
};
const ML_SEGMENTOS = ["Empresas", "Financiamiento PyME", "Banca Privada", "Institucionales"];
const mlAuth = () => ({ Authorization: "Bearer " + sesion.token, "Content-Type": "application/json" });
const mlEsc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const mlNorm = s => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

async function mlApi(ruta, cuerpo, metodo) {
  const r = await fetch("/api/mails/" + ruta, cuerpo === undefined && !metodo ? { headers: mlAuth() } : { method: metodo || "POST", headers: mlAuth(), body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  return r.json();
}

// Los campos del mail tal como los espera el servidor.
const mlMail = () => ({ asunto: ML.asunto, titulo: ML.titulo, segmento: ML.segmento, cuerpo: ML.cuerpo, botonTexto: ML.botonTexto, botonUrl: ML.botonUrl });
const ML_ADJ_MAX = 3, ML_ADJ_BYTES = 5 * 1024 * 1024, ML_ADJ_EXT = ["pdf", "png", "jpg", "jpeg", "csv", "xlsx", "xls", "docx", "doc"];
const mlTam = n => n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
const mlAdjuntos = () => ML.adj.map(a => ({ nombre: a.nombre, datos: a.datos }));
const mlHayFiltro = () => ML.sel.size || ML.indiv.size || ML.gsel.size;
const mlMailsDeGrupos = () => { const s = new Set(); ML.grupos.filter(g => ML.gsel.has(g.id)).forEach(g => g.emails.forEach(e => s.add(e))); return s; };

// Destinatarios: la unión de los managers, los grupos y los clientes elegidos a mano (nada elegido = todos).
// Siempre sin los dados de baja ni los mails inválidos.
function mlLista() {
  const base = (ML.dest || []).filter(d => d.valido && !d.baja);
  if (!mlHayFiltro()) return base;
  const delGrupo = mlMailsDeGrupos();
  return base.filter(d => d.managers.some(m => ML.sel.has(m)) || ML.indiv.has(d.email) || delGrupo.has(d.email));
}

async function renderMails() {
  const el = document.getElementById("view-mails");
  if (!ML.estado) {
    el.innerHTML = `<div class="mk-cab"><div><span class="mk-sup">PANEL ALYC</span><h1>Mails a clientes</h1></div></div><p class="mk-vacio">Cargando…</p>`;
    try {
      const [e, d, g, b] = await Promise.all([mlApi("estado"), mlApi("destinatarios"), mlApi("grupos"), mlApi("bajas")]);
      if (!e.ok || !d.ok) throw new Error(e.error || d.error);
      ML.estado = e; ML.dest = d.destinatarios; ML.managers = d.managers; ML.grupos = g.ok ? g.grupos : []; ML.bajas = b.ok ? b.bajas : [];
      mlEnvios();
    } catch (err) { el.innerHTML += `<p class="mk-vacio">No se pudo cargar: ${mlEsc(err.message)}</p>`; return; }
  }
  mlPintar();
}

// Resultados del buscador: por nombre, mail, número de cuenta o manager.
function mlBuscarLista() {
  const q = mlNorm(ML.busca).trim();
  if (q.length < 2) return [];
  const mgr = Object.fromEntries(ML.managers.map(m => [m.codigo, mlNorm(m.nombre)]));
  const partes = q.split(/\s+/);
  return (ML.dest || []).filter(d => d.valido && !d.baja).filter(d => {
    const pajar = mlNorm(d.nombre + " " + d.email + " " + d.cuentas.join(" ") + " " + d.managers.map(m => mgr[m] || "").join(" "));
    return partes.every(p => pajar.includes(p));
  });
}

function mlHtmlResultados() {
  if (mlNorm(ML.busca).trim().length < 2) return `<p class="mk-nota" style="margin:8px 0 0">Buscá por nombre, mail, número de cuenta o manager. Tildá los que quieras y guardalos como grupo.</p>`;
  const todos = mlBuscarLista(); ML.res = todos.slice(0, 40);
  if (!todos.length) return `<p class="mk-nota" style="margin:8px 0 0">No hay clientes con esa búsqueda.</p>`;
  const todosElegidos = todos.every(d => ML.indiv.has(d.email));
  return `<div class="mk-pills" style="margin:8px 0 0"><button onclick="mlElegirResultados(${todosElegidos ? "false" : "true"})">${todosElegidos ? "Quitar" : "Elegir"} los ${todos.length} resultados</button><span class="mk-nota">${todos.length > 40 ? "Se muestran 40: afinó la búsqueda para ver el resto." : ""}</span></div>
    <div class="ml-res">${ML.res.map((d, i) => `<label class="ml-fila"><input type="checkbox" ${ML.indiv.has(d.email) ? "checked" : ""} onchange="mlIndiv(${i}, this.checked)"><span class="ml-n">${mlEsc(d.nombre || "(sin nombre)")}</span><span class="mk-nota">${mlEsc(d.email)} · cta ${mlEsc(d.cuentas.slice(0, 3).join(", "))}${d.cuentas.length > 3 ? "…" : ""}</span><button class="ml-baja" title="Sacarlo de la lista de difusión: no recibe más mails" onclick="event.preventDefault(); mlBaja(${i})">Sacar de la lista</button></label>`).join("")}</div>`;
}

function mlPintar() {
  const el = document.getElementById("view-mails");
  const y = window.scrollY;
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
          <p class="mk-nota" style="margin:8px 0 0">La IA sigue la guía de piezas de Equanima: voz de Securities, sin recomendaciones ni datos inventados. Lo que no le contás queda como TBD para que lo completes.</p>
        </section>
        <section class="mk-card">
          <h3>2 · EL MAIL</h3>
          <input id="mlAsunto" type="text" style="width:100%;margin-bottom:10px" placeholder="Asunto (lo que se ve en la bandeja)" maxlength="120" value="${mlEsc(ML.asunto)}" oninput="ML.asunto=this.value; mlVista()">
          <div class="ml-dos">
            <input id="mlTitulo" type="text" placeholder="Título dentro del mail (si lo dejás vacío, el asunto)" maxlength="100" value="${mlEsc(ML.titulo)}" oninput="ML.titulo=this.value; mlVista()">
            <select id="mlSegmento" onchange="ML.segmento=this.value; mlVista()"><option value="">Sin segmento (comunicación regular)</option>${ML_SEGMENTOS.map(s => `<option ${ML.segmento === s ? "selected" : ""}>${s}</option>`).join("")}</select>
          </div>
          <textarea id="mlCuerpo" rows="11" placeholder="Escribí el texto. Separá los párrafos con una línea en blanco. No hace falta el saludo ni la firma: se agregan solos." oninput="ML.cuerpo=this.value; mlVista()">${mlEsc(ML.cuerpo)}</textarea>
          <p class="mk-nota">Para una lista, empezá cada línea con "- ". Para resaltar una frase clave, ponela entre **dos asteriscos**.</p>
          <div class="ml-dos" style="margin-top:10px">
            <input id="mlBotonTexto" type="text" placeholder="Botón (opcional): texto, ej. Coordinar una reunión" maxlength="60" value="${mlEsc(ML.botonTexto)}" oninput="ML.botonTexto=this.value; mlVista()">
            <input id="mlBotonUrl" type="text" placeholder="Link del botón (vacío: mail de Equanima)" value="${mlEsc(ML.botonUrl)}" oninput="ML.botonUrl=this.value; mlVista()">
          </div>
          <div class="ml-adj">
            <label class="ml-adj-btn">Adjuntar archivos<input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.csv,.xlsx,.xls,.docx,.doc" onchange="mlAdjuntar(this.files)" ${ML.adj.length >= ML_ADJ_MAX ? "disabled" : ""}></label>
            <span class="mk-nota">Hasta ${ML_ADJ_MAX} archivos y 5 MB en total (PDF, imágenes, Excel, Word, CSV). Cada cliente recibe su copia.</span>
            ${ML.adj.map((a, i) => `<span class="ml-adj-it">${mlEsc(a.nombre)} <span class="mk-nota">${mlTam(a.tam)}</span><button class="ml-x" title="Quitar" onclick="mlQuitarAdjunto(${i})">×</button></span>`).join("")}
          </div>
          <p class="mk-nota">Se agrega solo: saludo ("Hola, Nombre:" cuando se conoce el nombre), firma, pie legal de Equanima Securities y la opción de baja.</p>
        </section>
        <section class="mk-card">
          <h3>3 · A QUIÉN</h3>
          <div class="ml-mgrs">
            <label class="ml-chk"><input type="checkbox" ${mlHayFiltro() ? "" : "checked"} onchange="mlTodos()"> <b>Todos los clientes</b></label>
            ${ML.managers.map(m => { const n = (ML.dest || []).filter(d => d.valido && !d.baja && d.managers.includes(m.codigo)).length; return `<label class="ml-chk"><input type="checkbox" ${ML.sel.has(m.codigo) ? "checked" : ""} onchange="mlManager('${mlEsc(m.codigo)}', this.checked)"> ${mlEsc(m.nombre)} <span class="mk-nota">${n}</span></label>`; }).join("")}
          </div>
          ${ML.grupos.length ? `<h4 class="ml-sub">MIS GRUPOS</h4><div class="ml-mgrs">${ML.grupos.map(g => `<label class="ml-chk"><input type="checkbox" ${ML.gsel.has(g.id) ? "checked" : ""} onchange="mlGrupo('${mlEsc(g.id)}', this.checked)"> ${mlEsc(g.nombre)} <span class="mk-nota">${g.emails.length}</span><button class="ml-x" title="Borrar el grupo" onclick="event.preventDefault(); mlBorrarGrupo('${mlEsc(g.id)}')">×</button></label>`).join("")}</div>` : ""}
          <h4 class="ml-sub">BUSCAR CLIENTES</h4>
          <input id="mlBusca" type="search" style="width:100%" placeholder="Nombre, mail, número de cuenta o manager" value="${mlEsc(ML.busca)}" oninput="mlBuscar(this.value)" autocomplete="off">
          <div id="mlRes">${mlHtmlResultados()}</div>
          <p style="margin:14px 0 0;font-size:15px"><b>${lista.length}</b> mails distintos <span class="mk-nota">· ${cuentas} cuentas${ML.indiv.size ? ` · ${ML.indiv.size} elegidos a mano` : ""}${e.destinatarios.bajas ? ` · ${e.destinatarios.bajas} dados de baja excluidos` : ""}${e.destinatarios.invalidos ? ` · ${e.destinatarios.invalidos} mails inválidos excluidos` : ""}</span></p>
          ${mlHayFiltro() ? `<div class="mk-pills" style="margin:10px 0 0">
            <input id="mlGrupoNombre" type="text" placeholder="Nombre del grupo" maxlength="60" value="${mlEsc(ML.gnombre)}" oninput="ML.gnombre=this.value" style="min-width:200px">
            <button onclick="mlGuardarGrupo()" ${lista.length ? "" : "disabled"}>Guardar estos ${lista.length} como grupo</button>
            <button onclick="mlTodos()">Limpiar selección</button>
          </div>` : ""}
        </section>
        <section class="mk-card">
          <h3>LISTA DE BAJA <span class="mk-nota">· ${ML.bajas.length} ${ML.bajas.length === 1 ? "persona" : "personas"} fuera de la difusión</span></h3>
          <p class="mk-nota" style="margin:0 0 10px">Quien está acá no recibe ningún mail, aunque esté en un manager o en un grupo. Para sacar a un cliente, buscalo arriba y tocá "Sacar de la lista". Si alguien responde BAJA a un mail, cargalo acá.</p>
          <div class="mk-pills" style="margin:0 0 10px">
            <input id="mlBajaMail" type="email" placeholder="Mail a dar de baja" value="${mlEsc(ML.bajaMail)}" oninput="ML.bajaMail=this.value" onkeydown="if(event.key==='Enter')mlBajaManual()" style="min-width:250px">
            <button onclick="mlBajaManual()">Sacar de la lista</button>
          </div>
          ${ML.bajas.length ? `<div class="ml-res">${ML.bajas.map((b, i) => `<div class="ml-fila"><span class="ml-n">${mlEsc(b.nombre || "(no es cliente)")}</span><span class="mk-nota">${mlEsc(b.email)}</span><button class="ml-baja" onclick="mlReactivar(${i})">Volver a incluir</button></div>`).join("")}</div>` : `<p class="mk-nota" style="margin:0">Nadie dado de baja por ahora.</p>`}
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
              <p style="margin:0 0 8px;font-size:14px">Vas a enviar <b>"${mlEsc(ML.asunto)}"</b>${ML.adj.length ? ` con ${ML.adj.length} adjunto${ML.adj.length > 1 ? "s" : ""}` : ""} a <b>${lista.length}</b> mails distintos. No se puede deshacer. Escribí la cantidad para confirmar:</p>
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
      <div class="ml-vista"><section class="mk-card" style="position:sticky;top:12px"><h3>ASÍ LO VA A VER EL CLIENTE</h3><iframe id="mlFrame" title="Vista previa del mail" sandbox="" style="width:100%;height:720px;border:1px solid var(--border);background:#edf1f4"></iframe></section></div>
    </div>`;
  window.scrollTo(0, y);
  mlVista(true);
}

function mlVista(ya) {
  clearTimeout(ML.vistaTimer);
  ML.vistaTimer = setTimeout(async () => {
    const f = document.getElementById("mlFrame"); if (!f) return;
    try {
      const m = mlMail(); if (!m.cuerpo) m.cuerpo = "El texto del mail va a aparecer acá.";
      if (!m.asunto && !m.titulo) m.titulo = "El título del mail";
      const j = await mlApi("vista", m); if (j.ok) f.srcdoc = j.html;
    } catch (e) { /* sin vista */ }
  }, ya ? 0 : 450);
}

// Lee los archivos elegidos y los guarda en base64; se mandan con la prueba y con el envío.
async function mlAdjuntar(files) {
  const leer = f => new Promise((ok, mal) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] || ""); r.onerror = () => mal(new Error("No se pudo leer " + f.name)); r.readAsDataURL(f); });
  ML.msg = "";
  for (const f of files) {
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    const total = ML.adj.reduce((s, a) => s + a.tam, 0) + f.size;
    if (ML.adj.length >= ML_ADJ_MAX) { ML.msg = "Ya hay " + ML_ADJ_MAX + " archivos adjuntos."; ML.msgOk = false; break; }
    if (!ML_ADJ_EXT.includes(ext)) { ML.msg = `"${f.name}" no se puede adjuntar (tipos: ${ML_ADJ_EXT.join(", ")}).`; ML.msgOk = false; continue; }
    if (total > ML_ADJ_BYTES) { ML.msg = `Con "${f.name}" los adjuntos pasan los 5 MB.`; ML.msgOk = false; continue; }
    try { ML.adj.push({ nombre: f.name, tam: f.size, datos: await leer(f) }); } catch (e) { ML.msg = e.message; ML.msgOk = false; }
  }
  mlPintar();
}
function mlQuitarAdjunto(i) { ML.adj.splice(i, 1); mlPintar(); }

// Baja = sacar el mail de toda difusión (queda en mercado/mails-baja.json y se excluye en cada envío). Es reversible.
async function mlCambiarBaja(email, quitar) {
  const j = await mlApi("baja", { email, quitar: !!quitar });
  if (!j.ok) throw new Error(j.error || "No se pudo actualizar la lista de baja");
  const d = (ML.dest || []).find(x => x.email === email); if (d) d.baja = !quitar;
  if (!quitar) { ML.indiv.delete(email); if (!ML.bajas.some(b => b.email === email)) ML.bajas.push({ email, nombre: d ? d.nombre : "" }); }
  else ML.bajas = ML.bajas.filter(b => b.email !== email);
  ML.bajas.sort((a, b) => a.email.localeCompare(b.email));
  ML.estado.destinatarios.bajas = (ML.dest || []).filter(x => x.baja).length;
}
async function mlBaja(i) {
  const d = ML.res[i]; if (!d) return;
  if (!confirm(`¿Sacar a ${d.nombre || d.email} (${d.email}) de la lista de difusión? No va a recibir más mails de Equanima desde esta página. Después lo podés volver a incluir.`)) return;
  try { await mlCambiarBaja(d.email, false); ML.msg = `${d.email} fuera de la lista de difusión.`; ML.msgOk = true; } catch (e) { ML.msg = e.message; ML.msgOk = false; }
  mlPintar();
}
async function mlBajaManual() {
  const email = ML.bajaMail.trim().toLowerCase(); if (!email) return;
  try { await mlCambiarBaja(email, false); ML.bajaMail = ""; ML.msg = `${email} fuera de la lista de difusión.`; ML.msgOk = true; } catch (e) { ML.msg = e.message; ML.msgOk = false; }
  mlPintar();
}
async function mlReactivar(i) {
  const b = ML.bajas[i]; if (!b) return;
  try { await mlCambiarBaja(b.email, true); ML.msg = `${b.email} vuelve a estar en la difusión.`; ML.msgOk = true; } catch (e) { ML.msg = e.message; ML.msgOk = false; }
  mlPintar();
}

function mlTodos() { ML.sel.clear(); ML.indiv.clear(); ML.gsel.clear(); mlPintar(); }
function mlManager(cod, on) { if (on) ML.sel.add(cod); else ML.sel.delete(cod); mlPintar(); }
function mlGrupo(id, on) { if (on) ML.gsel.add(id); else ML.gsel.delete(id); mlPintar(); }

// El buscador solo repinta sus resultados, así no se pierde el foco mientras se escribe.
function mlBuscar(v) { ML.busca = v; const r = document.getElementById("mlRes"); if (r) r.innerHTML = mlHtmlResultados(); }
function mlIndiv(i, on) { const d = ML.res[i]; if (!d) return; if (on) ML.indiv.add(d.email); else ML.indiv.delete(d.email); mlPintar(); }
function mlElegirResultados(on) { mlBuscarLista().forEach(d => { if (on) ML.indiv.add(d.email); else ML.indiv.delete(d.email); }); mlPintar(); }

async function mlGuardarGrupo() {
  const emails = mlLista().map(d => d.email);
  try {
    const j = await mlApi("grupos", { nombre: ML.gnombre, emails });
    if (j.ok) {
      ML.grupos = j.grupos; ML.sel.clear(); ML.indiv.clear(); ML.gsel = new Set([j.grupo.id]); ML.gnombre = "";
      ML.msg = `Grupo "${j.grupo.nombre}" guardado con ${j.grupo.emails.length} mails. Ya lo podés elegir cuando quieras.`; ML.msgOk = true;
    } else { ML.msg = j.error; ML.msgOk = false; }
  } catch (e) { ML.msg = "No se pudo guardar el grupo: " + e.message; ML.msgOk = false; }
  mlPintar();
}

async function mlBorrarGrupo(id) {
  const g = ML.grupos.find(x => x.id === id); if (!g || !confirm(`¿Borrar el grupo "${g.nombre}"? Los clientes no se tocan, solo la lista.`)) return;
  try {
    const j = await mlApi("grupos/" + encodeURIComponent(id), undefined, "DELETE");
    if (j.ok) { ML.grupos = j.grupos; ML.gsel.delete(id); } else { ML.msg = j.error; ML.msgOk = false; }
  } catch (e) { ML.msg = "No se pudo borrar el grupo: " + e.message; ML.msgOk = false; }
  mlPintar();
}

async function mlRedactar() {
  ML.redactando = true; ML.msg = ""; mlPintar();
  try {
    const j = await mlApi("redactar", { instruccion: ML.instr, borrador: ML.cuerpo ? `Asunto: ${ML.asunto}\nTítulo: ${ML.titulo}\n\n${ML.cuerpo}` : "" });
    if (j.ok) {
      ML.asunto = j.asunto; ML.titulo = j.titulo; ML.segmento = ML_SEGMENTOS.includes(j.segmento) ? j.segmento : ""; ML.cuerpo = j.cuerpo; ML.botonTexto = j.botonTexto; ML.botonUrl = j.botonUrl;
      ML.msg = /\bTBD\b/.test(j.cuerpo + j.titulo + j.asunto) ? "Listo el borrador, pero hay datos marcados TBD que faltan: completalos antes de enviar." : "Listo el borrador. Revisalo y editá lo que haga falta antes de enviar."; ML.msgOk = true;
    } else { ML.msg = j.error; ML.msgOk = false; }
  } catch (e) { ML.msg = "No se pudo redactar: " + e.message; ML.msgOk = false; }
  ML.redactando = false; mlPintar();
}

async function mlProbar() {
  ML.msg = ""; ML.msgOk = true;
  try {
    const j = await mlApi("prueba", { ...mlMail(), adjuntos: mlAdjuntos(), a: ML.prueba });
    ML.msg = j.ok ? `Prueba enviada a ${j.enviado}. Revisá la bandeja de entrada (y el spam).` : j.error; ML.msgOk = !!j.ok;
  } catch (e) { ML.msg = "No se pudo enviar la prueba: " + e.message; ML.msgOk = false; }
  mlPintar();
}

function mlPedirConfirmacion() {
  if (!ML.asunto.trim() || !ML.cuerpo.trim()) { ML.msg = "Falta el asunto o el texto del mail."; ML.msgOk = false; mlPintar(); return; }
  if (/\bTBD\b/.test([ML.asunto, ML.titulo, ML.cuerpo, ML.botonTexto].join(" "))) { ML.msg = "El mail todavía tiene un TBD: falta completar un dato. Reemplazalo antes de enviar."; ML.msgOk = false; mlPintar(); return; }
  ML.msg = ""; ML.confirmando = true; mlPintar();
  setTimeout(() => { const i = document.getElementById("mlConfirmar"); if (i) i.focus(); }, 50);
}

async function mlEnviar() {
  const n = (document.getElementById("mlConfirmar") || {}).value;
  try {
    // Se manda la lista ya resuelta (managers, grupos y elegidos a mano), el servidor la vuelve a filtrar por bajas y validez.
    const j = await mlApi("enviar", { ...mlMail(), adjuntos: mlAdjuntos(), emails: mlHayFiltro() ? mlLista().map(d => d.email) : undefined, confirmar: Number(n) });
    if (j.ok) { ML.msg = `Envío iniciado a ${j.total} mails. Sale por tandas: podés seguir el avance abajo.`; ML.msgOk = true; ML.confirmando = false; mlEnvios(); }
    else { ML.msg = j.error; ML.msgOk = false; }
  } catch (e) { ML.msg = "No se pudo iniciar el envío: " + e.message; ML.msgOk = false; }
  mlPintar();
}

async function mlEnvios() {
  try { const j = await mlApi("envios"); if (j.ok) ML.envios = j.envios; } catch (e) { /* sin lista */ }
  clearTimeout(ML.pollTimer);
  if (ML.envios.some(x => x.estado === "enviando")) ML.pollTimer = setTimeout(async () => { await mlEnvios(); if (vistaActual === "mails" && !ML.confirmando) { const a = document.activeElement; if (!a || !/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) mlPintar(); } }, 3000);
}
