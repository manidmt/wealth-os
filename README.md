# Wealth OS

Monorepo de Wealth OS.

- `wealth-navigator/` — frontend (Vite + React + TanStack + Supabase). Repo de origen: manidmt/wealth-navigator.
- `wealth-agent/` — agente FastAPI (asistente). Fork de LCabelloC/wealth-agent.
- `docs/` — documentación e informes.

## Desarrollo
- Frontend: `cd wealth-navigator && npm install && npm run dev` (sirve en :8090 vía wealth-navigator.service).
- Agente: `cd wealth-agent && uvicorn app.main:app --host 127.0.0.1 --port 8001` (vía wealth-agent.service).
