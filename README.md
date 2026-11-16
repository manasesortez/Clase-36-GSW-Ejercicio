# Clase 36 – Ejercicio integrador: plataforma de votación en alta disponibilidad

Gestión de Servidores Web · Unidad 3 · Clúster + balanceo de carga

> **Caso:** una plataforma de votación en línea para una elección estudiantil necesita garantizar que el
> servicio nunca se caiga durante el día de votación, incluso si un servidor individual falla.

Este repositorio trae el sistema **ya implementado**: una landing page (frontend) y una API (backend) que
corren en un clúster de 3 nodos detrás de un balanceador Nginx.

```
Usuario (navegador / curl)
   |
   v   http://localhost:8088          <- único puerto abierto hacia afuera
[ lb: Nginx 1.29 ]
   |   red privada clusternet
   +------> nodo1:9090 ┐
   +------> nodo2:9090 ├── volumen compartido "votos"
   +------> nodo3:9090 ┘
```

## Requisitos

- Docker Desktop (Windows / macOS) abierto, o Docker Engine + Compose (Linux).
- Git.
- El puerto **8088** libre (apague el clúster de la Clase 35 con `docker compose down` en su carpeta).

## Levantar

```bash
git clone https://github.com/manasesortez/Clase-36-GSW-Ejercicio.git
cd Clase-36-GSW-Ejercicio
docker compose up -d --build
docker compose ps
```

Abrir **http://localhost:8088** en el navegador.

## Estructura

```
.
├── docker-compose.yml     # 3 nodos + lb, red clusternet, volumen votos, healthchecks
├── nginx/nginx.conf       # balanceador (upstream, reintento en otro nodo, timeouts)
├── app/
│   ├── Dockerfile         # node:22-alpine, sin dependencias externas
│   ├── server.js          # API + servidor de archivos estáticos
│   └── public/            # landing page: arquitectura en vivo, votar, resultados, clúster, consola API
└── scripts/
    ├── prueba.ps1         # N peticiones con nodo, HTTP y tiempo (Windows)
    └── prueba.sh          # lo mismo para Linux / macOS
```

## API

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/health` | Health check del nodo (`{"estado":"saludable","nodo":"nodo1",...}`) |
| GET | `/api/info` | Qué nodo atendió, uptime y peticiones atendidas |
| GET | `/api/cluster` | Estado de los 3 nodos: el nodo que atiende consulta a los otros por `clusternet` |
| GET | `/api/candidatos` | Lista de planillas con sus propuestas |
| GET | `/api/resultados` | Conteo de votos (igual en los 3 nodos) y votos registrados por cada nodo |
| GET | `/api/votos/{carnet}` | Consulta si un carnet ya votó y qué nodo registró el voto |
| POST | `/api/votar` | Body `{"carnet":"2026-0001","candidato":"azul"}` → 201, 400 o 409 (ya votó) |

Todas las respuestas traen el encabezado `X-Nodo` (nodo que respondió) y `X-Upstream` (IP:puerto que eligió Nginx).

## Pruebas rápidas

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File .\scripts\prueba.ps1
docker compose stop nodo2
powershell -ExecutionPolicy Bypass -File .\scripts\prueba.ps1
docker compose start nodo2
```

```bash
# Linux / macOS
bash scripts/prueba.sh
docker compose stop nodo2
bash scripts/prueba.sh
docker compose start nodo2
```

## Decisiones de diseño

- **Solo `lb` publica un puerto.** Los nodos no tienen `ports:`; solo se alcanzan por `clusternet`.
- **`zone` en el `upstream`**: los workers de Nginx comparten el turno del Round Robin (sin esto, peticiones
  sueltas caen siempre en `nodo1`).
- **`proxy_connect_timeout 2s`**: un nodo apagado se detecta en 2 s y no en los 60 s por defecto.
- **IPs fijas + `extra_hosts` en `lb`**: Nginx lee `nodo1..3` de su `/etc/hosts`, así arranca y se
  reinicia aunque un nodo esté apagado (sin el error `host not found in upstream`). Se descartó
  `resolve` (DNS dinámico): en las pruebas producía un 502 ocasional al apagar un nodo.
- **Volumen `votos` compartido**: todos los nodos ven los mismos resultados. El bloqueo de voto doble usa
  la creación atómica de un archivo por carnet, así que no hay votos dobles aunque lleguen a nodos distintos.
- **`depends_on: service_healthy`**: el balanceador arranca cuando los 3 nodos ya pasaron su health check.
- **Apagado limpio (SIGTERM)**: `docker compose stop nodo2` tarda ~1 s, no 10 s.

## Apagar

```bash
docker compose down        # conserva los votos
docker compose down -v     # borra también los votos
```
