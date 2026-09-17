# Wealth OS

A personal finance and investment tracking app: expense/income tracking, portfolio positions with per-purchase lots, and a DCA-style investment planning module, backed by Supabase.

- `wealth-navigator/` — frontend (Vite + React + TanStack + Supabase). Originally sourced from `manidmt/wealth-navigator`.
- `wealth-agent/` — FastAPI chat assistant over the app's financial data (fork of `LCabelloC/wealth-agent`).
- `docs/` — implementation plans, design specs, and reports.

## Stack
- **Frontend:** Vite, React, TanStack (Router/Query), Radix UI, Tailwind CSS, Supabase (Postgres, Auth, Edge Functions).
- **Agent:** FastAPI, OpenAI, Supabase (Python client), pandas.

## Development
- Frontend: `cd wealth-navigator && npm install && npm run dev`
- Agent: `cd wealth-agent && uvicorn app.main:app --host 127.0.0.1 --port 8001`

Both services expect their own `.env` file (Supabase URL/keys, and — for the agent — an OpenAI API key). See each subproject for the specific variables it reads.

## License
MIT — see [LICENSE](LICENSE).
