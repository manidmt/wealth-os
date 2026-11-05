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

## MCP server

`app/mcp_server.py` exposes the same financial data to local AI assistants over
[MCP](https://modelcontextprotocol.io) (stdio — no port is opened). It is a separate
entrypoint from the FastAPI app and has its own dependency set, because `mcp` requires
`uvicorn>=0.31.1` while the agent is pinned to `0.30.1`:

```bash
python -m venv .venv
.venv/bin/pip install -r requirements-mcp-dev.txt   # or requirements-mcp.txt without pytest
.venv/bin/python -m app.mcp_server                  # stdio: the client spawns it
```

### Read-only by construction

Queries do not run as the owner. A dedicated Supabase account reads the data, and the
`data_readers` table plus SELECT-only RLS policies (migration
`20260922120000_mcp_data_readers.sql`) are what allow it. The reader has no insert,
update or delete policy, so Postgres — not application code — rejects every write.
Revoke access by deleting the row:

```sql
delete from public.data_readers where reader_id = '<reader uid>';
```

`scripts/verify_reader_readonly.py` checks the lock against the live project: reads
work, only the owner's rows are visible, and insert/update/delete have no effect.

```bash
READER_EMAIL=... READER_PASSWORD=... OWNER_USER_ID=... python scripts/verify_reader_readonly.py
```

### Credentials

`~/.config/wealth-mcp/env`, `chmod 600` (the loader refuses to start otherwise).
Override the path with `WEALTH_MCP_ENV`.

```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=<anon key>
READER_EMAIL=<reader account>
READER_PASSWORD=<reader password>
OWNER_USER_ID=<uuid of the user whose data is exposed>
```

Not the system keyring: the client may run as a lingering user service, and after a
reboot the keyring stays locked until a graphical login. It would not protect anything
either — a local assistant runs as the same Unix user. The protection is that the
credential cannot write.

### Tools

Seven wrap `financial_tools`; `list_movements` is the only one that returns rows, and
its limits live in the function rather than in the tool description: the range caps at
366 days, `limit` caps at 200 (over-asking is clamped, not rejected), and the response
carries `matchedCount` and `truncated`. Fields are whitelisted — no `id`, `user_id` or
`created_at` reaches the model — and `description_untrusted` is stripped of IBANs, card
numbers (including masked forms), URLs and invisible characters, then truncated to 80
characters. Bank-supplied text is data, never instructions; no regex makes it
trustworthy, which is why nothing here can write.

| Tool | Arguments |
| --- | --- |
| `get_month_spend` | `month` |
| `get_top_categories` | `month`, `limit` |
| `get_month_comparison` | `current_month`, `previous_month` |
| `get_category_trend` | `category`, `months` |
| `get_savings_summary` | `month` |
| `get_net_worth_summary` | — |
| `get_portfolio_summary` | — |
| `list_movements` | `start_date`, `end_date`, `category`, `type`, `min_amount`, `limit` |

Data is cached in memory for 5 minutes (`CACHE_TTL_SECONDS`). Every call appends one
JSON line to `~/.local/state/wealth-mcp/audit.log` (`WEALTH_MCP_AUDIT_LOG` to move it)
with the tool, its arguments and the row count — never amounts or descriptions, so the
log is not a second copy of the data.

Whatever a tool returns reaches whichever model the client uses. That is inherent to
letting an assistant see the data; the limits above bound it, they do not remove it.

### Registering it with a client

```bash
# OpenClaw
openclaw mcp add wealth-os \
  --command "$PWD/.venv/bin/python" --arg -m --arg app.mcp_server --cwd "$PWD"
openclaw mcp probe wealth-os    # expect: 8 tools

# Claude Code
claude mcp add wealth-os -- "$PWD/.venv/bin/python" -m app.mcp_server
```

Poke at it by hand with `npx @modelcontextprotocol/inspector .venv/bin/python -m app.mcp_server`.

## Structure

```
app/
├── main.py                  # FastAPI entrypoint
├── config.py                # Env vars
├── mcp_config.py            # MCP reader credentials (~/.config/wealth-mcp/env)
├── mcp_server.py            # MCP server (stdio): 8 read-only tools, cache, audit log
├── models/schemas.py        # Pydantic models
├── routers/chat.py          # WebSocket /ws/{user_id} + auth
├── services/
│   ├── data_service.py      # RLS-scoped Supabase client + data loading
│   ├── reader_client.py     # Read-only Supabase session for the MCP server
│   ├── agent_service.py     # Agent loop + streaming
│   └── memory_service.py    # Cross-session memory (agent_memory/agent_messages)
└── tools/
    ├── financial_tools.py   # Tool schemas + dispatcher (FastAPI agent)
    └── movement_tools.py    # list_movements + description sanitizer (MCP)
```

## Tests

```bash
.venv/bin/python -m pytest                                    # everything (69 tests)
python -m pytest tests/test_data_service.py tests/test_financial_tools.py   # FastAPI agent only
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
