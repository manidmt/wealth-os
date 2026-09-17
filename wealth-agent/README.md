# wealth-agent

FastAPI chat agent for Wealth OS: answers questions about a user's movements, portfolio and net worth by calling tools backed by Supabase, streamed over a WebSocket.

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env   # fill in your own values
uvicorn app.main:app --reload --port 8001
```

Required env vars (see `.env.example`):
- `OPENAI_API_KEY`, `MODEL` — the LLM used for the agent loop.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` — same Supabase project as `wealth-navigator`. The agent authenticates each connection with the caller's own Supabase session token, so all reads/writes run under that user's RLS policies — it never holds a service_role key.

Check it's up: `curl http://localhost:8001/health` → `{"status":"ok"}`.

## WebSocket: `/ws/{user_id}`

The client must open the connection with its Supabase access token as a WebSocket subprotocol (not a query param, so it never ends up in access logs):

```javascript
const ws = new WebSocket(`ws://localhost:8001/ws/${userId}`, ["bearer", accessToken]);
```

The server validates the token against Supabase Auth and closes the connection with `{"error": "No autorizado"}` if it doesn't belong to `user_id`.

**Client message:**

```json
{
  "message": "How much did I spend this month?",
  "history": [{ "role": "user", "content": "..." }],
  "remember": true
}
```

**Server response (streamed):**

```json
{"token": "This"}
{"token": " month"}
{"done": true}
```

## Structure

```
app/
├── main.py                  # FastAPI entrypoint
├── config.py                # Env vars
├── models/schemas.py        # Pydantic models
├── routers/chat.py          # WebSocket /ws/{user_id} + auth
├── services/
│   ├── data_service.py      # RLS-scoped Supabase client + data loading
│   ├── agent_service.py     # Agent loop + streaming
│   └── memory_service.py    # Cross-session memory (agent_memory/agent_messages)
└── tools/financial_tools.py # Tool schemas + dispatcher
```

## Tools available to the agent

| Tool | Description |
| --- | --- |
| `get_month_spend` | Total spend for a month |
| `get_top_categories` | Top spending categories |
| `get_month_comparison` | Comparison between two months |
| `get_net_worth_summary` | Total net worth |
| `get_portfolio_summary` | Portfolio breakdown, P&L, weights |
| `get_category_trend` | A category's trend over time |
| `get_live_savings_summary` | Monthly savings rate |
