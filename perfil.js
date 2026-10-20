// Selector de perfil del usuario "general" (ALyC). Después de entrar, elige con qué perfil mira la
// plataforma: como un manager (ve a sus clientes), como un cliente (ve su cuenta) o el panel general.
// Para probar la plataforma; cada manager y cada cliente ve lo suyo cuando tengan su acceso.

let PERFIL_TIPO = "manager";
let PERFIL_ITEMS = [];
let PERFIL_GALLO = null; // código de Manager -> { email, nombre } según Gallo

const perfilNorm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function guardarSesion() {
  try { sessionStorage.setItem("sesion", JSON.stringify(sesion)); } catch (e) { /* sin storage */ }
}

async function cargarManagersGallo() {
  if (PERFIL_GALLO || !sesion || !sesion.token) return;
  try {
    const r = await fetch("/api/productores", { headers: { Authorization: "Bearer " + sesion.token } });
    const j = await r.json();
    if (j.ok) { PERFIL_GALLO = {}; j.productores.forEach(p => { PERFIL_GALLO[p.codigo] = p; }); renderPerfil(); }
  } catch (e) { /* sin mails de managers */ }
}

function mostrarSelectorPerfil() {
  ["login", "app", "clienteApp"].forEach(id => { const el = document.getElementById(id); if (el) el.style.display = "none"; });
  document.body.style.background = "";
  document.getElementById("perfil").style.display = "flex";
  document.getElementById("perfilBuscar").value = "";
  setPerfilTipo(PERFIL_TIPO);
  cargarManagersGallo();
  setTimeout(() => document.getElementById("perfilBuscar").focus(), 50);
}

function setPerfilTipo(t) {
  PERFIL_TIPO = t;
  [["manager", "pfTabManager"], ["cliente", "pfTabCliente"], ["alyc", "pfTabAlyc"]].forEach(([k, id]) => document.getElementById(id).classList.toggle("on", k === t));
  document.getElementById("perfilBuscar").style.display = t === "alyc" ? "none" : "block";
  renderPerfil();
}

function renderPerfil() {
  const lista = document.getElementById("perfilLista");
  const q = perfilNorm(document.getElementById("perfilBuscar").value);
  const clientes = getClientes();

  if (PERFIL_TIPO === "alyc") {
    PERFIL_ITEMS = [{ tipo: "alyc", nombre: "Panel ALyC" }];
    lista.innerHTML = `<button class="perfil-item" onclick="elegirPerfil(0)"><div><b>Panel de la ALyC</b><span>Todos los productores y comitentes de Equanima</span></div><div class="der"><b>${clientes.length}</b><span>comitentes</span></div></button>`;
    return;
  }

  if (PERFIL_TIPO === "manager") {
    const porManager = {};
    clientes.forEach(c => {
      const k = c.managerId || "";
      const m = porManager[k] || (porManager[k] = { tipo: "manager", managerId: k, nombre: c.productor || "Sin asignar", n: 0 });
      m.n++;
    });
    PERFIL_ITEMS = Object.values(porManager).map(m => ({ ...m, email: PERFIL_GALLO && PERFIL_GALLO[m.managerId] ? PERFIL_GALLO[m.managerId].email : "" }))
      .filter(m => !q || perfilNorm(`${m.nombre} ${m.managerId} ${m.email}`).includes(q))
      .sort((a, b) => b.n - a.n);
  } else {
    PERFIL_ITEMS = clientes.map(c => ({ tipo: "cliente", comitenteId: c.id, managerId: c.managerId || "", nombre: titulo(c.nombre), email: c.email || "", productor: c.productor || "" }))
      .filter(c => !q || perfilNorm(`${c.nombre} ${c.comitenteId} ${c.email} ${c.productor}`).includes(q))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }

  const MAX = 60;
  const filas = PERFIL_ITEMS.slice(0, MAX).map((it, i) => it.tipo === "manager"
    ? `<button class="perfil-item" onclick="elegirPerfil(${i})"><div><b>${esc(/^Sin /.test(it.nombre) ? it.nombre : titulo(it.nombre))}</b><span>${esc(it.email || "Sin mail en Gallo")} · cód. ${esc(it.managerId || "—")}</span></div><div class="der"><b>${it.n}</b><span>comitentes</span></div></button>`
    : `<button class="perfil-item" onclick="elegirPerfil(${i})"><div><b>${esc(it.nombre)}</b><span>${esc(it.email || "Sin mail en Gallo")} · cuenta ${esc(it.comitenteId)}</span></div><div class="der"><span>${esc(titulo(it.productor))}</span></div></button>`).join("");
  lista.innerHTML = (filas || `<p class="muted" style="padding:10px 2px;margin:0">No hay resultados.</p>`)
    + (PERFIL_ITEMS.length > MAX ? `<p class="muted" style="font-size:12px;margin:6px 2px">Hay ${PERFIL_ITEMS.length - MAX} más: refiná la búsqueda.</p>` : "");
}

function elegirPerfil(i) {
  const it = PERFIL_ITEMS[i];
  if (!it) return;
  sesion.rolReal = "alyc";
  sesion.perfilElegido = true;
  sesion.perfilNombre = it.tipo === "alyc" ? "" : it.nombre;
  if (it.tipo === "manager") { sesion.rol = "productor"; sesion.managerId = it.managerId; sesion.comitenteId = null; }
  else if (it.tipo === "cliente") { sesion.rol = "cliente"; sesion.comitenteId = it.comitenteId; sesion.managerId = it.managerId || null; }
  else { sesion.rol = "alyc"; sesion.managerId = null; sesion.comitenteId = null; }
  guardarSesion();
  location.reload(); // la plataforma se arma de cero con el perfil elegido
}

function cambiarPerfil() {
  sesion.rol = "alyc";
  sesion.perfilElegido = false;
  sesion.perfilNombre = "";
  sesion.managerId = null;
  sesion.comitenteId = null;
  guardarSesion();
  location.reload();
}
