Perfecto 🙌 entonces te dejo el **README.md final** ya listo para que lo pegues en tu repo:

---

```markdown
# 📦 StreetRoller Agent

Este proyecto implementa un **agente de WhatsApp** con persistencia de contexto y resúmenes automáticos, además de una **API REST** para gestionar productos, clientes, inventario, órdenes y pagos.  
Está construido en **Node.js (Express)** con **PostgreSQL**, e integra **OpenAI** para respuestas inteligentes y resúmenes de conversación.

---

## 🚀 Funcionalidades principales

### 1. API REST (gestión de negocio)
- **Productos (`/api/products`)**
  - `GET /` → lista productos.
  - `POST /` → crea producto nuevo.
  
- **Clientes (`/api/customers`)**
  - `GET /` → lista clientes.
  - `POST /` → crea cliente.

- **Inventario (`/api/inventory`)**
  - `GET /` → lista inventario (con nombre de producto).
  - `PATCH /:productId/adjust` → ajusta stock (`delta` positivo o negativo).

- **Órdenes (`/api/orders`)**
  - `GET /` → lista órdenes con cliente y producto.
  - `POST /` → crea nueva orden (total calculado automáticamente).

- **Pagos (`/api/payments`)**
  - `GET /` → lista pagos.
  - `POST /` → registra pago nuevo.

- **Health (`/health`)**
  - Verifica estado de la API, DB y mensajes pendientes de resumir.

---

### 2. Agente de WhatsApp (`/webhooks/whatsapp`)
- **Recepción de mensajes desde WhatsApp Cloud API**.
- **Verificación de firma con `META_APP_SECRET`**.
- **Respuestas automáticas**:
  - `lista` → devuelve 5 productos recientes.
  - `precio <producto>` → busca precio.
  - `stock <producto>` → disponibilidad.
- **IA (OpenAI)**:
  - Si no hay respuesta en BD, responde con el asistente.
- **Persistencia de contexto**:
  - Sesiones en memoria (`context.js`).
  - Contexto rehidratado desde DB (`context.rehydrate.js`).
- **Resúmenes automáticos**:
  - Tras inactividad (`SUM_INACTIVITY_MIN`).
  - Segundo sweep periódico (`second-sweep.js`).
  - Hechos importantes se almacenan en `wa_profile`.

---

## 📂 Estructura del proyecto

```

src/
├── config/         # configuración de DB
├── controllers/    # lógica de negocio (CRUD)
├── routes/         # endpoints Express
├── services/       # IA, contexto, resúmenes
├── index.js        # servidor principal

````

---

## ⚙️ Requisitos

- Node.js >= 18  
- PostgreSQL >= 14  
- Cuenta en **Meta WhatsApp Cloud API**  
- API Key de **OpenAI**

---

## 🛠️ Instalación

1. Clonar el repo:
   ```bash
   git clone <repo>
   cd streetrolleragent
````

2. Instalar dependencias:

   ```bash
   npm install
   ```

3. Configurar variables en `.env`:

   ```env
   PORT=3000
   DATABASE_URL=postgresql://user:pass@localhost:5432/sragent?schema=public

   # WhatsApp Cloud API
   WHATSAPP_TOKEN=...
   WHATSAPP_PHONE_NUMBER_ID=...
   WHATSAPP_VERIFY_TOKEN=...
   META_APP_SECRET=...

   # OpenAI
   OPENAI_API_KEY=...
   OPENAI_MODEL=gpt-4o-mini
   AI_LANG=es

   # Configuración de contexto y resúmenes
   CTX_TURNS=8
   CTX_TTL_MIN=180
   SUM_INACTIVITY_MIN=1
   SUM_SECOND_SWEEP_MIN=1
   SUM_SWEEP_INTERVAL_SEC=30
   SWEEP_MAX_WA=10
   SWEEP_MAX_ROUNDS=5
   ```

4. Iniciar en modo desarrollo:

   ```bash
   npm run dev
   ```

5. Producción:

   ```bash
   npm start
   ```

---

## 📡 Endpoints principales

* `GET /api/products`
* `POST /api/customers`
* `PATCH /api/inventory/:productId/adjust`
* `POST /api/orders`
* `POST /api/payments`
* `GET /health`
* `POST /webhooks/whatsapp`

---

## 🧠 IA y Persistencia

* Historial de mensajes → `wa_message`.
* Resúmenes acumulados → `wa_summary`.
* Datos persistentes del cliente → `wa_profile`.
* Purga de mensajes ya resumidos para optimizar la DB.

---

## 📜 Licencia

ISC License © 2025

```

