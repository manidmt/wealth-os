# wealth-navigator

Frontend of Wealth OS — a personal net-worth and investing dashboard built with Vite, TanStack (Start/Router/Query), shadcn/ui (Radix) and Tailwind CSS.

It talks directly to Supabase (Postgres, Auth, Edge Functions) — there is no separate REST backend.

## Setup

```bash
npm install
cp .env.example .env   # fill in your own Supabase project's values
npm run dev
```

Required env vars (see `.env.example`):
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` — your Supabase project's URL and anon/publishable key.
- `VITE_AGENT_WS_URL` — WebSocket URL of the `wealth-agent` chat backend (optional; only needed for the in-app assistant).

## Views

| Route | Description |
|---|---|
| `/` | Dashboard — KPIs, allocation, monthly spend |
| `/net-worth` | Net worth over time |
| `/expenses` | Income/expenses by month and category |
| `/portfolio` | Investment positions and purchase-lot history |
| `/planning` | DCA investment plans and briefings |
| `/settings` | Account, exclusion rules, data export |

## Stack

- TanStack Start / Router / Query
- shadcn/ui + Radix UI, Tailwind CSS, recharts
- Supabase (Postgres, Auth, Edge Functions)
