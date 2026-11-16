// Plataforma de votación estudiantil - un nodo del clúster.
// Sin dependencias externas: solo módulos de Node.js.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const PORT = Number(process.env.PORT) || 9090;
const NODO = process.env.NODO || os.hostname();
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const VOTOS_FILE = path.join(DATA_DIR, "votos.jsonl");
const CARNETS_DIR = path.join(DATA_DIR, "carnets");
const PUBLIC_DIR = path.join(__dirname, "public");
const INICIO = Date.now();

const CANDIDATOS = [
  { id: "azul", nombre: "Planilla Azul", lema: "Más laboratorios abiertos", color: "#2563eb" },
  { id: "verde", nombre: "Planilla Verde", lema: "Campus sostenible", color: "#16a34a" },
  { id: "naranja", nombre: "Planilla Naranja", lema: "Becas y transporte", color: "#ea580c" },
];

fs.mkdirSync(CARNETS_DIR, { recursive: true });

let peticionesAtendidas = 0;

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Nodo": NODO,
  });
  res.end(body);
}

function leerVotos() {
  if (!fs.existsSync(VOTOS_FILE)) return [];
  return fs
    .readFileSync(VOTOS_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((linea) => JSON.parse(linea));
}

function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    let datos = "";
    req.on("data", (c) => {
      datos += c;
      if (datos.length > 10_000) reject(new Error("Cuerpo demasiado grande"));
    });
    req.on("end", () => {
      try {
        resolve(datos ? JSON.parse(datos) : {});
      } catch {
        reject(new Error("JSON inválido"));
      }
    });
    req.on("error", reject);
  });
}

const TIPOS = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function servirEstatico(req, res, ruta) {
  const archivo = ruta === "/" ? "/index.html" : ruta;
  const completo = path.normalize(path.join(PUBLIC_DIR, archivo));
  if (!completo.startsWith(PUBLIC_DIR) || !fs.existsSync(completo) || fs.statSync(completo).isDirectory()) {
    return json(res, 404, { error: "No encontrado", ruta, nodo: NODO });
  }
  res.writeHead(200, {
    "Content-Type": TIPOS[path.extname(completo)] || "application/octet-stream",
    "X-Nodo": NODO,
  });
  fs.createReadStream(completo).pipe(res);
}

const servidor = http.createServer(async (req, res) => {
  peticionesAtendidas++;
  const url = new URL(req.url, "http://localhost");
  const ruta = url.pathname;
  const inicio = Date.now();
  res.on("finish", () => {
    if (ruta !== "/health") {
      console.log(`[${NODO}] ${req.method} ${ruta} -> ${res.statusCode} (${Date.now() - inicio} ms)`);
    }
  });

  try {
    // Health check: lo usan Docker (healthcheck) y las pruebas por el balanceador.
    if (req.method === "GET" && ruta === "/health") {
      return json(res, 200, { estado: "saludable", nodo: NODO, timestamp: new Date().toISOString() });
    }

    // Qué nodo atendió la petición (lo usa el monitor de la página).
    if (req.method === "GET" && ruta === "/api/info") {
      return json(res, 200, {
        nodo: NODO,
        hostname: os.hostname(),
        uptimeSegundos: Math.round((Date.now() - INICIO) / 1000),
        peticionesAtendidas,
        timestamp: new Date().toISOString(),
      });
    }

    if (req.method === "GET" && ruta === "/api/candidatos") {
      return json(res, 200, { nodo: NODO, candidatos: CANDIDATOS });
    }

    if (req.method === "GET" && ruta === "/api/resultados") {
      const votos = leerVotos();
      const conteo = Object.fromEntries(CANDIDATOS.map((c) => [c.id, 0]));
      const porNodo = {};
      for (const v of votos) {
        if (v.candidato in conteo) conteo[v.candidato]++;
        porNodo[v.nodo] = (porNodo[v.nodo] || 0) + 1;
      }
      return json(res, 200, {
        nodo: NODO,
        total: votos.length,
        resultados: CANDIDATOS.map((c) => ({ ...c, votos: conteo[c.id] })),
        votosRegistradosPorNodo: porNodo,
      });
    }

    // Consulta: ¿este carnet ya votó?
    const matchCarnet = ruta.match(/^\/api\/votos\/([A-Za-z0-9-]{4,20})$/);
    if (req.method === "GET" && matchCarnet) {
      const carnet = matchCarnet[1].toUpperCase();
      const voto = leerVotos().find((v) => v.carnet === carnet);
      return json(res, 200, {
        nodo: NODO,
        carnet,
        yaVoto: Boolean(voto),
        fecha: voto ? voto.fecha : null,
        atendidoPor: voto ? voto.nodo : null,
      });
    }

    if (req.method === "POST" && ruta === "/api/votar") {
      const { carnet, candidato } = await leerCuerpo(req);
      const c = String(carnet || "").trim().toUpperCase();
      if (!/^[A-Z0-9-]{4,20}$/.test(c)) {
        return json(res, 400, { ok: false, nodo: NODO, mensaje: "Carnet inválido (4 a 20 letras, números o guiones)." });
      }
      if (!CANDIDATOS.some((x) => x.id === candidato)) {
        return json(res, 400, { ok: false, nodo: NODO, mensaje: "Candidato inválido." });
      }
      // Crear el archivo del carnet con 'wx' es atómico: si dos nodos reciben el mismo
      // carnet a la vez, solo uno lo logra. Así no hay votos dobles en el clúster.
      try {
        fs.closeSync(fs.openSync(path.join(CARNETS_DIR, c), "wx"));
      } catch (e) {
        if (e.code === "EEXIST") {
          return json(res, 409, { ok: false, nodo: NODO, mensaje: `El carnet ${c} ya votó.` });
        }
        throw e;
      }
      const voto = { carnet: c, candidato, nodo: NODO, fecha: new Date().toISOString() };
      fs.appendFileSync(VOTOS_FILE, JSON.stringify(voto) + "\n");
      return json(res, 201, { ok: true, nodo: NODO, mensaje: `Voto registrado por ${NODO}.`, voto });
    }

    if (req.method === "GET" && !ruta.startsWith("/api/")) {
      return servirEstatico(req, res, ruta);
    }

    return json(res, 404, { error: "No encontrado", ruta, nodo: NODO });
  } catch (e) {
    console.error(`[${NODO}] Error:`, e.message);
    return json(res, 500, { ok: false, nodo: NODO, mensaje: e.message });
  }
});

servidor.listen(PORT, () => {
  console.log(`[${NODO}] Plataforma de votación escuchando en el puerto ${PORT}`);
});

// Apagado limpio: sin esto, "docker compose stop" espera 10 s antes de matar el proceso.
for (const senal of ["SIGTERM", "SIGINT"]) {
  process.on(senal, () => {
    console.log(`[${NODO}] Recibí ${senal}, apagando...`);
    servidor.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
