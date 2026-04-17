# StreetRoller Agent

Backend Node.js con un **agente de ventas por WhatsApp** (OpenAI + function calling) y una **API REST** para gestionar productos, clientes, inventario, ordenes y pagos.

## Stack

- **Node.js >= 18** (ESM modules)
- **Express 5**
- **PostgreSQL** (via `pg`)
- **OpenAI SDK** (`gpt-4o-mini` por defecto)
- Meta **WhatsApp Cloud API**

## Inicio rapido

```bash
git clone <repo>
cd streetrolleragent
npm install
cp .env.example .env   # editar con tus valores
npm run dev
```

## Variables de entorno

| Variable | Requerida | Descripcion |
|----------|-----------|-------------|
| `DATABASE_URL` | Si | Connection string PostgreSQL |
| `OPENAI_API_KEY` | Si | API Key de OpenAI |
| `WHATSAPP_TOKEN` | Si | Bearer token Meta |
| `WHATSAPP_PHONE_NUMBER_ID` | Si | Phone Number ID de Meta |
| `WHATSAPP_VERIFY_TOKEN` | Si | Token de verificacion del webhook |
| `META_APP_SECRET` | Recomendado | Para validar firma HMAC de Meta |
| `PORT` | No | Puerto HTTP (default: `3000`) |
| `OPENAI_MODEL` | No | Modelo OpenAI (default: `gpt-4o-mini`) |
| `AI_MAX_OUTPUT_TOKENS` | No | Limite de tokens en respuestas (default: `120`) |
| `CTX_TURNS` | No | Turnos maximos en RAM (default: `6`) |
| `CTX_TTL_MIN` | No | TTL de sesion en minutos (default: `120`) |
| `SUM_INACTIVITY_MIN` | No | Minutos de inactividad para resumir (default: `180`) |
| `SUM_SECOND_SWEEP_MIN` | No | Extra para second sweep; `0` desactiva (default: `0`) |
| `PGSSLMODE` | No | `disable` para dev local sin SSL |

Ver `.env.example` para la lista completa y `PROJECT.md` para documentacion tecnica detallada.

## Endpoints

### API REST

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| `GET` | `/api/products` | Lista productos |
| `POST` | `/api/products` | Crea producto |
| `GET` | `/api/customers` | Lista clientes |
| `POST` | `/api/customers` | Crea cliente |
| `GET` | `/api/inventory` | Lista inventario |
| `PATCH` | `/api/inventory/:productId/adjust` | Ajusta stock (`{ delta }`) |
| `GET` | `/api/orders` | Lista ordenes |
| `POST` | `/api/orders` | Crea orden |
| `GET` | `/api/payments` | Lista pagos |
| `POST` | `/api/payments` | Registra pago |
| `GET` | `/health` | Estado de la API y la DB |

### Webhooks

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| `GET/POST` | `/webhooks/whatsapp` | Webhook de WhatsApp Cloud API |
| `GET/POST` | `/webhooks/instagram` | Webhook de Instagram (verificacion + log) |

## Estructura del proyecto

```
src/
├── index.js              # Entry point
├── config/db.js          # Pool PostgreSQL
├── controllers/          # CRUD handlers
├── routes/               # Express routers
├── services/             # IA, contexto, resumenes, mensajeria
└── policy/
    ├── prompts/prompts   # System prompt del agente
    └── slots.schema.json # Politica de slots por categoria
```

## Scripts

```bash
npm run dev   # Inicia con nodemon (hot reload)
npm start     # Produccion
```

## Documentacion tecnica

Ver [`PROJECT.md`](PROJECT.md) para arquitectura detallada, esquema de BD, flujo del agente y descripcion de todos los servicios.

## Licencia

ISC License © 2025
