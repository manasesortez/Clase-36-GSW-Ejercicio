// Frontend de la plataforma de votación. Todas las peticiones pasan por el balanceador.
const $ = (id) => document.getElementById(id);
let candidatos = [];
const conteoNodos = {};
let monitorActivo = true;

async function pedir(url, opciones) {
  const inicio = performance.now();
  const res = await fetch(url, { cache: "no-store", ...opciones });
  const datos = await res.json().catch(() => ({}));
  return { res, datos, ms: Math.round(performance.now() - inicio) };
}

async function cargarCandidatos() {
  const { datos, res } = await pedir("/api/candidatos");
  candidatos = datos.candidatos || [];
  $("nodo-pagina").textContent = res.headers.get("X-Nodo") || datos.nodo;
  $("candidatos").innerHTML = candidatos
    .map(
      (c, i) => `
      <label class="candidato">
        <input type="radio" name="candidato" value="${c.id}" ${i === 0 ? "checked" : ""}>
        <span class="punto" style="background:${c.color}"></span>
        <span>${c.nombre}<small>${c.lema}</small></span>
      </label>`
    )
    .join("");
}

async function cargarResultados() {
  try {
    const { datos } = await pedir("/api/resultados");
    const total = datos.total || 0;
    $("total").textContent = total;
    $("nodo-resultados").textContent = datos.nodo;
    $("resultados").innerHTML = datos.resultados
      .map((r) => {
        const pct = total ? Math.round((r.votos / total) * 100) : 0;
        return `<div class="barra-fila">
          <div class="cab"><span>${r.nombre}</span><span>${r.votos} (${pct}%)</span></div>
          <div class="barra"><span style="width:${pct}%;background:${r.color}"></span></div>
        </div>`;
      })
      .join("");
    const porNodo = Object.entries(datos.votosRegistradosPorNodo || {})
      .map(([n, v]) => `${n}: ${v}`)
      .join(" · ");
    $("votos-por-nodo").textContent = porNodo ? `Votos registrados por: ${porNodo}` : "";
  } catch {
    /* el monitor ya muestra el error */
  }
}

$("form-voto").addEventListener("submit", async (e) => {
  e.preventDefault();
  const boton = e.target.querySelector("button");
  const msg = $("mensaje-voto");
  boton.disabled = true;
  try {
    const candidato = new FormData(e.target).get("candidato");
    const { res, datos } = await pedir("/api/votar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ carnet: $("carnet").value, candidato }),
    });
    msg.textContent = datos.mensaje || `HTTP ${res.status}`;
    msg.className = "mensaje " + (res.ok ? "ok" : "error");
    if (res.ok) $("carnet").value = "";
    cargarResultados();
  } catch (err) {
    msg.textContent = "No se pudo contactar al servidor: " + err.message;
    msg.className = "mensaje error";
  } finally {
    boton.disabled = false;
  }
});

function agregarFila(hora, nodo, estado, ms, error) {
  const fila = document.createElement("tr");
  if (error) fila.className = "fila-error";
  fila.innerHTML = `<td>${hora}</td><td class="nodo n-${nodo}">${nodo}</td>
    <td>${estado}</td><td class="${ms > 1000 ? "lento" : ""}">${ms} ms</td>`;
  const cuerpo = $("tabla-monitor");
  cuerpo.prepend(fila);
  while (cuerpo.children.length > 12) cuerpo.lastChild.remove();
}

function pintarContadores() {
  $("contadores").innerHTML = Object.keys(conteoNodos)
    .sort()
    .map((n) => `<div class="contador"><span class="n-${n}">${n}</span><b>${conteoNodos[n]}</b></div>`)
    .join("");
}

async function latido() {
  if (!monitorActivo) return;
  const hora = new Date().toLocaleTimeString();
  const badge = $("badge-estado");
  try {
    const { res, datos, ms } = await pedir("/api/info");
    const nodo = datos.nodo || "?";
    conteoNodos[nodo] = (conteoNodos[nodo] || 0) + 1;
    agregarFila(hora, nodo, res.status, ms, !res.ok);
    badge.textContent = res.ok ? "Servicio en línea" : `Error ${res.status}`;
    badge.className = "badge " + (res.ok ? "ok" : "error");
  } catch (err) {
    agregarFila(hora, "—", "sin respuesta", 0, true);
    badge.textContent = "Servicio caído";
    badge.className = "badge error";
  }
  pintarContadores();
}

$("btn-monitor").addEventListener("click", (e) => {
  monitorActivo = !monitorActivo;
  e.target.textContent = monitorActivo ? "Pausar" : "Reanudar";
});

$("form-consulta").addEventListener("submit", async (e) => {
  e.preventDefault();
  let url = $("endpoint").value;
  if (url.endsWith("/")) url += encodeURIComponent($("param").value.trim() || "2026-0001");
  try {
    const { res, datos, ms } = await pedir(url);
    $("respuesta").textContent =
      `GET ${url}  ->  HTTP ${res.status}  (${ms} ms, atendido por ${res.headers.get("X-Nodo")})\n\n` +
      JSON.stringify(datos, null, 2);
  } catch (err) {
    $("respuesta").textContent = "Error: " + err.message;
  }
});

cargarCandidatos().then(cargarResultados);
setInterval(latido, 1000);
setInterval(cargarResultados, 3000);
latido();
