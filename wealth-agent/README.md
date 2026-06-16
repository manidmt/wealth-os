# Financial Agent API

Backend de un agente financiero personal con FastAPI y WebSockets. Analiza gastos, inversiones y patrimonio neto a partir de datos reales del usuario almacenados en Supabase.

---

## Requisitos

- Python 3.10+
- Conda o venv
- Cuenta en [OpenAI](https://platform.openai.com/) con acceso a `gpt-4o`
- Proyecto en [Supabase](https://supabase.com/) con las tablas `movements` y `portfolio`

---

## Instalación

```bash
# 1. Clonar el repositorio
git clone https://github.com/tu-usuario/financial-agent.git
cd financial-agent

# 2. Crear entorno e instalar dependencias
conda create -n financial-agent python=3.11
conda activate financial-agent
pip install -r requirements.txt

# 3. Configurar variables de entorno
cp .env.example .env
```

Edita el `.env` con tus credenciales:

```
OPENAI_API_KEY=sk-...
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_KEY=your-anon-key
MODEL=gpt-4o
```

---

## Arrancar el servidor

```bash
conda activate financial-agent
uvicorn app.main:app --reload --port 8000
```

Verifica que funciona:

```bash
curl http://localhost:8000/health
# {"status":"ok"}
```

---

## Estructura del proyecto

```
financial-agent/
├── .env.example
├── requirements.txt
├── README.md
└── app/
    ├── main.py                  # Punto de entrada FastAPI
    ├── config.py                # Variables de entorno
    ├── models/
    │   └── schemas.py           # Modelos Pydantic
    ├── routers/
    │   └── chat.py              # WebSocket /ws/{user_id}
    ├── services/
    │   ├── data_service.py      # Carga de datos desde Supabase
    │   └── agent_service.py     # Loop agéntico + streaming
    └── tools/
        └── financial_tools.py   # Tools, schemas y dispatcher
```

---

## Conexión WebSocket

**Endpoint:** `ws://localhost:8000/ws/{user_id}`

**Mensaje del cliente:**

```json
{
  "message": "¿Cuánto gasté este mes?",
  "history": [
    { "role": "user", "content": "mensaje anterior" },
    { "role": "assistant", "content": "respuesta anterior" }
  ]
}
```

**Respuesta del servidor (streaming):**

```json
{"token": "Este"}
{"token": " mes"}
{"token": " has gastado..."}
{"done": true}
```

**Ejemplo en JavaScript:**

```javascript
const ws = new WebSocket("ws://localhost:8000/ws/USER_ID");

let fullResponse = "";

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.token) fullResponse += data.token;
  if (data.done) console.log(fullResponse);
  if (data.error) console.error(data.error);
};

ws.send(
  JSON.stringify({
    message: "¿Cuánto gasté este mes?",
    history: [],
  }),
);
```

---

## Tablas Supabase

**movements**

| columna     | tipo    |
| ----------- | ------- |
| user_id     | uuid    |
| date        | date    |
| type        | text    |
| category    | text    |
| description | text    |
| amount      | numeric |
| currency    | text    |

**portfolio**

| columna      | tipo    |
| ------------ | ------- |
| user_id      | uuid    |
| assetName    | text    |
| ticker       | text    |
| quantity     | numeric |
| avgCost      | numeric |
| currentPrice | numeric |

---

## Tools disponibles

| Tool                       | Descripción                 |
| -------------------------- | --------------------------- |
| `get_month_spend`          | Gasto total de un mes       |
| `get_top_categories`       | Top categorías por gasto    |
| `get_month_comparison`     | Comparación entre dos meses |
| `get_net_worth_summary`    | Patrimonio neto total       |
| `get_portfolio_summary`    | Desglose del portfolio      |
| `get_category_trend`       | Evolución de una categoría  |
| `get_live_savings_summary` | Tasa de ahorro mensual      |
