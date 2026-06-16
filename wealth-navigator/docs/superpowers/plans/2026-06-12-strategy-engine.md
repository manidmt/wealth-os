# Strategy Engine (Fase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modelar en `/planning` el sistema de estrategias semipasivas del Excel: multiplicadores por señales de mercado, pólvora seca con disparos/cooldowns, rutina mensual/anual con checklist, LOG de aportaciones y aviso Telegram.

**Architecture:** Tabla global `market_signals` alimentada por Edge Function `signals-sync` (pg_cron diario). Motor de reglas declarativas puro en `supabase/functions/_shared/strategy-engine.ts` (re-exportado a `src/lib/` para frontend y tests — un solo fichero fuente compartido entre Deno y Vite). Reglas JSON en `investment_plans.multiplier_rules`. UI compuesta en `src/components/planning/`.

**Tech Stack:** Supabase (Postgres + RLS + Edge Functions Deno + pg_cron), React + TanStack Router/Query, Vitest (nuevo), Yahoo Finance chart API, FRED API.

**Spec:** `docs/superpowers/specs/2026-06-12-strategy-engine-design.md`

---

## Estructura de ficheros

| Fichero | Responsabilidad |
|---|---|
| `supabase/functions/_shared/strategy-engine.ts` | Motor puro: tipos de regla + evaluación (fuente única) |
| `src/lib/strategy-engine.ts` | Re-export del motor para el frontend |
| `src/lib/strategy-engine.test.ts` | Tests Vitest del motor |
| `supabase/migrations/20260612190000_strategy_engine.sql` | Columnas y tablas nuevas |
| `src/lib/planning-api.ts` | Tipos extendidos + hooks routine_logs + fire dry powder |
| `src/lib/signals-api.ts` | Hooks market_signals + edición manual |
| `supabase/functions/signals-sync/index.ts` | Fetch Yahoo/FRED → upsert señales |
| `supabase/functions/routine-summary/index.ts` | JSON resumen para Telegram |
| `scripts/seed-strategies.ts` | Seed estrategias del Excel + histórico ATH/200WMA |
| `src/components/planning/StrategyCard.tsx` | Tarjeta estrategia (cuota efectiva, pólvora, semáforo) |
| `src/components/planning/SignalsPanel.tsx` | Tabla señales + edición manual |
| `src/components/planning/MonthlyRoutine.tsx` | Checklist mensual + registro inline + disparos |
| `src/components/planning/JanuaryWizard.tsx` | Fijar multiplicadores anuales |
| `src/components/planning/ContributionLog.tsx` | LOG con precio medio ponderado |
| `src/routes/planning.tsx` | Composición de secciones |

---

### Task 0: Prerrequisitos (acciones del usuario — bloquean Tasks 2, 8, 9, 10, 16)

- [ ] **Step 1: Autenticar la CLI de Supabase** (el usuario debe ejecutar, es interactivo):

```bash
cd ~/.openclaw/workspace/projects/wealth-os/wealth-navigator
npx supabase login          # abre navegador; alternativamente exportar SUPABASE_ACCESS_TOKEN
npx supabase link --project-ref pqfixpcbupdslrdfealq
```

- [ ] **Step 2: Obtener FRED API key** (gratuita): registrarse en https://fred.stlouisfed.org/docs/api/api_key.html

- [ ] **Step 3: Guardar secret:**

```bash
npx supabase secrets set FRED_API_KEY=<la_key>
```

Verificar: `npx supabase secrets list` muestra `FRED_API_KEY`.

---

### Task 1: Configurar Vitest

**Files:**
- Modify: `package.json`
- Create: `src/lib/strategy-engine.test.ts` (smoke, se reemplaza en Task 3)

- [ ] **Step 1: Instalar Vitest**

```bash
npm install -D vitest
```

- [ ] **Step 2: Añadir script en `package.json`** (tras `"format"`):

```json
"test": "vitest run"
```

- [ ] **Step 3: Smoke test** — crear `src/lib/strategy-engine.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

describe("vitest setup", () => {
  it("runs", () => expect(1 + 1).toBe(2));
});
```

- [ ] **Step 4: Run** `npm test` → Expected: `1 passed`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/lib/strategy-engine.test.ts
git commit -m "chore: add vitest"
```

---

### Task 2: Migración de base de datos

**Files:**
- Create: `supabase/migrations/20260612190000_strategy_engine.sql`

- [ ] **Step 1: Escribir la migración** — contenido completo:

```sql
-- Estrategias: columnas nuevas en investment_plans
alter table public.investment_plans
  add column if not exists asset_class text
    check (asset_class in ('rv_core','rv_opp','gold','btc','rf')),
  add column if not exists multiplier_rules jsonb,
  add column if not exists dry_powder jsonb,
  add column if not exists annual_multiplier numeric not null default 1,
  add column if not exists annual_multiplier_year int;

-- LOG: columnas nuevas en plan_contributions
alter table public.plan_contributions
  add column if not exists price numeric,
  add column if not exists units numeric,
  add column if not exists multiplier numeric,
  add column if not exists signal_note text;

-- Señales de mercado (tabla global, sin user_id)
create table if not exists public.market_signals (
  signal_key text not null,
  date date not null,
  value numeric not null,
  source text not null default 'auto' check (source in ('auto','manual')),
  updated_at timestamptz not null default now(),
  primary key (signal_key, date)
);
alter table public.market_signals enable row level security;
create policy "read signals" on public.market_signals
  for select to authenticated using (true);
create policy "manual insert" on public.market_signals
  for insert to authenticated with check (source = 'manual');
create policy "manual update" on public.market_signals
  for update to authenticated using (true) with check (source = 'manual');

-- Estado de rutinas
create table if not exists public.routine_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period text not null,
  items jsonb not null default '[]',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, period)
);
alter table public.routine_logs enable row level security;
create policy "own routine logs" on public.routine_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

- [ ] **Step 2: Aplicar**

```bash
npx supabase db push
```

Si `db push` falla por divergencia de historial de migraciones, pegar el SQL en el SQL Editor del dashboard de Supabase y marcar: `npx supabase migration repair --status applied 20260612190000`.

- [ ] **Step 3: Verificar** (la anon key está en `.env` como `VITE_SUPABASE_PUBLISHABLE_KEY`):

```bash
URL=$(grep VITE_SUPABASE_URL .env | cut -d= -f2 | tr -d '"')
KEY=$(grep VITE_SUPABASE_PUBLISHABLE_KEY .env | cut -d= -f2 | tr -d '"')
curl -s "$URL/rest/v1/market_signals?limit=1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
curl -s "$URL/rest/v1/routine_logs?limit=1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"
```

Expected: `[]` en ambas (no un error de "relation does not exist").

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260612190000_strategy_engine.sql
git commit -m "feat: DB schema for strategy engine (signals, routine logs, rules)"
```

---

### Task 3: Motor — tipos + regla ladder (TDD)

**Files:**
- Create: `supabase/functions/_shared/strategy-engine.ts`
- Create: `src/lib/strategy-engine.ts`
- Modify: `src/lib/strategy-engine.test.ts` (reemplazar smoke)

- [ ] **Step 1: Test failing** — reemplazar `src/lib/strategy-engine.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { evaluateBase, type LadderRule, type SignalMap } from "./strategy-engine";

const sig = (value: number): SignalMap => ({
  msci_dd: { value, date: "2026-06-01", source: "auto" },
});

const rvLadder: LadderRule = {
  type: "ladder",
  cadence: "annual",
  signal: "msci_dd",
  steps: [
    { lte: -0.1, multi: 2 },
    { lte: -0.2, multi: 3 },
  ],
  default: 1,
};

describe("ladder rule", () => {
  it("no drawdown → default", () => expect(evaluateBase(rvLadder, sig(-0.05)).multi).toBe(1));
  it("boundary -10% → x2", () => expect(evaluateBase(rvLadder, sig(-0.1)).multi).toBe(2));
  it("-15% → x2", () => expect(evaluateBase(rvLadder, sig(-0.15)).multi).toBe(2));
  it("boundary -20% → x3", () => expect(evaluateBase(rvLadder, sig(-0.2)).multi).toBe(3));
  it("-35% → x3 (deepest)", () => expect(evaluateBase(rvLadder, sig(-0.35)).multi).toBe(3));
  it("señal ausente → default", () => expect(evaluateBase(rvLadder, {}).multi).toBe(1));
});
```

- [ ] **Step 2: Run** `npm test` → Expected: FAIL (módulo no existe).

- [ ] **Step 3: Implementar** — crear `supabase/functions/_shared/strategy-engine.ts`:

```typescript
// Motor de reglas de estrategias semipasivas. PURO: sin imports, sin I/O.
// Compartido entre Edge Functions (Deno) y frontend (re-export en src/lib).

export type SignalKey =
  | "vix" | "dxy" | "tips_10y_real" | "hy_spread"
  | "msci_dd" | "gold_dd" | "btc_dd" | "btc_p200w"
  | "btc_mvrv" | "btc_puell" | "insiders_ratio";

export type SignalValue = { value: number; date: string; source: "auto" | "manual" };
export type SignalMap = Partial<Record<SignalKey, SignalValue>>;

export type LadderRule = {
  type: "ladder";
  cadence: "annual" | "monthly";
  signal: SignalKey;
  steps: { lte: number; multi: number }[];
  default: number;
};

export type MatrixRule = {
  type: "matrix";
  cadence: "annual";
  row_signal: SignalKey;
  col_signal: SignalKey;
  row_breaks: number[]; // descendentes: fila = primer i con value >= breaks[i]; si ninguno, última fila
  col_breaks: number[]; // ascendentes: col = nº de breaks estrictamente menores que value
  values: number[][];
  bonus?: { signal: SignalKey; lte: number; add: number };
  max: number;
};

export type ComboRule = {
  type: "combo";
  conditions: { signal: SignalKey; op: "gt" | "gte" | "lt" | "lte"; value: number }[];
  multi: number;
  cooldown_months: number;
};

export type MultiplierRules = {
  base?: LadderRule | MatrixRule;
  trigger?: ComboRule;
};

export const MANUAL_STALE_DAYS = 35;

export function isStale(s: SignalValue, now: Date = new Date()): boolean {
  if (s.source !== "manual") return false;
  const age = (now.getTime() - new Date(s.date).getTime()) / 86400000;
  return age > MANUAL_STALE_DAYS;
}

export type BaseResult = { multi: number; detail: string };

export function evaluateBase(rule: LadderRule | MatrixRule | undefined, signals: SignalMap): BaseResult {
  if (!rule) return { multi: 1, detail: "sin regla" };
  if (rule.type === "ladder") {
    const s = signals[rule.signal];
    if (!s) return { multi: rule.default, detail: `${rule.signal}: sin dato` };
    const hit = rule.steps.filter((st) => s.value <= st.lte);
    const multi = hit.length ? Math.max(...hit.map((st) => st.multi)) : rule.default;
    return { multi, detail: `${rule.signal}=${s.value.toFixed(3)} → x${multi}` };
  }
  return { multi: 1, detail: "matrix: pendiente" }; // se completa en Task 4
}
```

Y crear `src/lib/strategy-engine.ts`:

```typescript
export * from "../../supabase/functions/_shared/strategy-engine";
```

- [ ] **Step 4: Run** `npm test` → Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/strategy-engine.ts src/lib/strategy-engine.ts src/lib/strategy-engine.test.ts
git commit -m "feat: strategy engine — ladder rule"
```

---

### Task 4: Motor — regla matrix (oro) (TDD)

**Files:**
- Modify: `supabase/functions/_shared/strategy-engine.ts`
- Modify: `src/lib/strategy-engine.test.ts`

- [ ] **Step 1: Test failing** — añadir al final del test:

```typescript
import { type MatrixRule } from "./strategy-engine";

const goldMatrix: MatrixRule = {
  type: "matrix",
  cadence: "annual",
  row_signal: "tips_10y_real",
  col_signal: "dxy",
  row_breaks: [1, 0.5, 0],
  col_breaks: [100, 110, 120],
  values: [
    [1, 1, 2, 2],
    [2, 2, 3, 3],
    [3, 3, 4, 5],
    [4, 4, 5, 6],
  ],
  bonus: { signal: "gold_dd", lte: -0.15, add: 1 },
  max: 6,
};

const goldSig = (tips: number, dxy: number, dd = 0): SignalMap => ({
  tips_10y_real: { value: tips, date: "2026-06-01", source: "auto" },
  dxy: { value: dxy, date: "2026-06-01", source: "auto" },
  gold_dd: { value: dd, date: "2026-06-01", source: "auto" },
});

describe("matrix rule (oro TIPS×DXY)", () => {
  it("tips 1.2, dxy 95 → 1", () => expect(evaluateBase(goldMatrix, goldSig(1.2, 95)).multi).toBe(1));
  it("tips 1.0 (≥1%), dxy 100 (≤100) → 1", () => expect(evaluateBase(goldMatrix, goldSig(1.0, 100)).multi).toBe(1));
  it("tips 0.7, dxy 105 → 2", () => expect(evaluateBase(goldMatrix, goldSig(0.7, 105)).multi).toBe(2));
  it("tips 0.3, dxy 115 → 4", () => expect(evaluateBase(goldMatrix, goldSig(0.3, 115)).multi).toBe(4));
  it("tips -0.2, dxy 125 → 6", () => expect(evaluateBase(goldMatrix, goldSig(-0.2, 125)).multi).toBe(6));
  it("bonus DD: tips 0.3, dxy 115, dd -16% → 5", () =>
    expect(evaluateBase(goldMatrix, goldSig(0.3, 115, -0.16)).multi).toBe(5));
  it("clamp max: tips -0.2, dxy 125, dd -16% → 6", () =>
    expect(evaluateBase(goldMatrix, goldSig(-0.2, 125, -0.16)).multi).toBe(6));
  it("señal ausente → 1", () => expect(evaluateBase(goldMatrix, {}).multi).toBe(1));
});
```

- [ ] **Step 2: Run** `npm test` → Expected: FAIL en los tests matrix.

- [ ] **Step 3: Implementar** — en `strategy-engine.ts`, reemplazar la línea `return { multi: 1, detail: "matrix: pendiente" };` por:

```typescript
  const row = signals[rule.row_signal];
  const col = signals[rule.col_signal];
  if (!row || !col) return { multi: 1, detail: "matrix: sin datos" };
  let r = rule.row_breaks.findIndex((b) => row.value >= b);
  if (r === -1) r = rule.row_breaks.length;
  const c = rule.col_breaks.filter((b) => col.value > b).length;
  let multi = rule.values[r][c];
  let detail = `${rule.row_signal}=${row.value} × ${rule.col_signal}=${col.value} → x${multi}`;
  if (rule.bonus) {
    const bs = signals[rule.bonus.signal];
    if (bs && bs.value <= rule.bonus.lte) {
      multi += rule.bonus.add;
      detail += ` +${rule.bonus.add} bonus`;
    }
  }
  multi = Math.min(multi, rule.max);
  return { multi, detail };
```

- [ ] **Step 4: Run** `npm test` → Expected: 14 passed.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/strategy-engine.ts src/lib/strategy-engine.test.ts
git commit -m "feat: strategy engine — matrix rule with bonus and clamp"
```

---

### Task 5: Motor — trigger combo con cooldown y caducidad (TDD)

**Files:**
- Modify: `supabase/functions/_shared/strategy-engine.ts`
- Modify: `src/lib/strategy-engine.test.ts`

- [ ] **Step 1: Test failing** — añadir:

```typescript
import { evaluateTrigger, type ComboRule } from "./strategy-engine";

const vixCombo: ComboRule = {
  type: "combo",
  conditions: [
    { signal: "vix", op: "gt", value: 50 },
    { signal: "insiders_ratio", op: "gte", value: 0.5 },
  ],
  multi: 4,
  cooldown_months: 3,
};

const NOW = new Date("2026-06-12");
const comboSig = (vix: number, ins: number, insDate = "2026-06-01"): SignalMap => ({
  vix: { value: vix, date: "2026-06-11", source: "auto" },
  insiders_ratio: { value: ins, date: insDate, source: "manual" },
});

describe("combo trigger", () => {
  it("dispara si todas se cumplen", () => {
    const r = evaluateTrigger(vixCombo, comboSig(55, 0.6), null, NOW);
    expect(r.fired).toBe(true);
    expect(r.blocked).toBeNull();
  });
  it("no dispara si falta una condición", () =>
    expect(evaluateTrigger(vixCombo, comboSig(49, 0.6), null, NOW).fired).toBe(false));
  it("cooldown bloquea (<3 meses)", () => {
    const r = evaluateTrigger(vixCombo, comboSig(55, 0.6), "2026-05-01", NOW);
    expect(r.fired).toBe(false);
    expect(r.blocked).toBe("cooldown");
  });
  it("cooldown expirado no bloquea", () =>
    expect(evaluateTrigger(vixCombo, comboSig(55, 0.6), "2026-02-12", NOW).fired).toBe(true));
  it("señal manual caducada (>35d) bloquea", () => {
    const r = evaluateTrigger(vixCombo, comboSig(55, 0.6, "2026-04-20"), null, NOW);
    expect(r.fired).toBe(false);
    expect(r.blocked).toBe("stale_signal");
  });
  it("señal ausente bloquea como stale", () => {
    const r = evaluateTrigger(vixCombo, { vix: { value: 55, date: "2026-06-11", source: "auto" } }, null, NOW);
    expect(r.fired).toBe(false);
    expect(r.blocked).toBe("stale_signal");
  });
});
```

- [ ] **Step 2: Run** `npm test` → Expected: FAIL (`evaluateTrigger` no existe).

- [ ] **Step 3: Implementar** — añadir al final de `strategy-engine.ts`:

```typescript
export type TriggerResult = {
  fired: boolean;
  blocked: "cooldown" | "stale_signal" | null;
  detail: string;
};

const OPS = {
  gt: (a: number, b: number) => a > b,
  gte: (a: number, b: number) => a >= b,
  lt: (a: number, b: number) => a < b,
  lte: (a: number, b: number) => a <= b,
};

export function evaluateTrigger(
  rule: ComboRule | undefined,
  signals: SignalMap,
  lastFiredAt: string | null,
  now: Date = new Date(),
): TriggerResult {
  if (!rule) return { fired: false, blocked: null, detail: "sin trigger" };

  for (const c of rule.conditions) {
    const s = signals[c.signal];
    if (!s) return { fired: false, blocked: "stale_signal", detail: `${c.signal}: sin dato` };
    if (isStale(s, now)) return { fired: false, blocked: "stale_signal", detail: `${c.signal}: caducada (${s.date})` };
  }

  const met = rule.conditions.every((c) => OPS[c.op](signals[c.signal]!.value, c.value));
  if (!met) {
    const detail = rule.conditions
      .map((c) => `${c.signal}=${signals[c.signal]!.value} ${OPS[c.op](signals[c.signal]!.value, c.value) ? "✓" : "✗"}`)
      .join(" · ");
    return { fired: false, blocked: null, detail };
  }

  if (lastFiredAt) {
    const last = new Date(lastFiredAt);
    const months = (now.getFullYear() - last.getFullYear()) * 12 + (now.getMonth() - last.getMonth());
    if (months < rule.cooldown_months) {
      return { fired: false, blocked: "cooldown", detail: `cooldown hasta ${rule.cooldown_months - months} meses más` };
    }
  }
  return { fired: true, blocked: null, detail: `disparo x${rule.multi}` };
}
```

- [ ] **Step 4: Run** `npm test` → Expected: 20 passed.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/strategy-engine.ts src/lib/strategy-engine.test.ts
git commit -m "feat: strategy engine — combo trigger with cooldown and stale guard"
```

---

### Task 6: Motor — multiplicador vigente y cuota efectiva (TDD)

**Files:**
- Modify: `supabase/functions/_shared/strategy-engine.ts`
- Modify: `src/lib/strategy-engine.test.ts`

`currentMultiplier` decide el multi VIGENTE: cadencia `annual` → usa el persistido (`annual_multiplier` del plan, fijado en el wizard de enero); cadencia `monthly` → evalúa on-the-fly; sin reglas → 1.

- [ ] **Step 1: Test failing** — añadir:

```typescript
import { currentMultiplier, effectiveQuota, type StrategyPlanLike } from "./strategy-engine";

const planLike = (over: Partial<StrategyPlanLike>): StrategyPlanLike => ({
  amount: 100,
  multiplier_rules: null,
  annual_multiplier: 1,
  annual_multiplier_year: null,
  ...over,
});

describe("currentMultiplier / effectiveQuota", () => {
  it("plan simple → 1 y cuota base", () => {
    expect(currentMultiplier(planLike({}), {})).toBe(1);
    expect(effectiveQuota(planLike({}), {})).toBe(100);
  });
  it("cadencia annual usa el multiplicador persistido, no la señal", () => {
    const p = planLike({
      multiplier_rules: { base: rvLadder },
      annual_multiplier: 2,
      annual_multiplier_year: 2026,
    });
    expect(currentMultiplier(p, sig(-0.35))).toBe(2); // señal diría 3; vigente es 2
    expect(effectiveQuota(p, sig(-0.35))).toBe(200);
  });
  it("cadencia monthly evalúa on-the-fly", () => {
    const monthlyLadder = { ...rvLadder, cadence: "monthly" as const };
    const p = planLike({ multiplier_rules: { base: monthlyLadder } });
    expect(currentMultiplier(p, sig(-0.25))).toBe(3);
    expect(effectiveQuota(p, sig(-0.25))).toBe(300);
  });
});
```

- [ ] **Step 2: Run** `npm test` → Expected: FAIL.

- [ ] **Step 3: Implementar** — añadir al final de `strategy-engine.ts`:

```typescript
// Subconjunto de InvestmentPlan que necesita el motor (evita acoplar al tipo completo del frontend)
export type StrategyPlanLike = {
  amount: number | null;
  multiplier_rules: MultiplierRules | null;
  annual_multiplier: number;
  annual_multiplier_year: number | null;
};

export function currentMultiplier(plan: StrategyPlanLike, signals: SignalMap): number {
  const base = plan.multiplier_rules?.base;
  if (!base) return 1;
  if (base.cadence === "annual") return plan.annual_multiplier;
  return evaluateBase(base, signals).multi;
}

export function effectiveQuota(plan: StrategyPlanLike, signals: SignalMap): number {
  return (plan.amount ?? 0) * currentMultiplier(plan, signals);
}
```

- [ ] **Step 4: Run** `npm test` → Expected: 23 passed.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/strategy-engine.ts src/lib/strategy-engine.test.ts
git commit -m "feat: strategy engine — current multiplier and effective quota"
```

---

### Task 7: API frontend — tipos extendidos, señales y rutinas

**Files:**
- Modify: `src/lib/planning-api.ts`
- Create: `src/lib/signals-api.ts`

- [ ] **Step 1: Extender tipos en `planning-api.ts`** — añadir import arriba y campos a los tipos existentes:

```typescript
import type { MultiplierRules } from "./strategy-engine";

export type AssetClass = "rv_core" | "rv_opp" | "gold" | "btc" | "rf";
export type DryPowder = {
  current_eur: number;
  monthly_feed_eur: number;
  last_fired_at: string | null;
};
```

En `InvestmentPlan`, añadir tras `notes`:

```typescript
  asset_class: AssetClass | null;
  multiplier_rules: MultiplierRules | null;
  dry_powder: DryPowder | null;
  annual_multiplier: number;
  annual_multiplier_year: number | null;
```

En `PlanContribution`, añadir tras `actual_amount`:

```typescript
  price: number | null;
  units: number | null;
  multiplier: number | null;
  signal_note: string | null;
```

En `useUpsertContribution`, ampliar el tipo del input:

```typescript
    mutationFn: async (input: {
      plan_id: string;
      date: string;
      planned_amount: number;
      actual_amount: number;
      price?: number | null;
      units?: number | null;
      multiplier?: number | null;
      signal_note?: string | null;
    }) => {
```

- [ ] **Step 2: Añadir hooks de rutina y pólvora al final de `planning-api.ts`:**

```typescript
// ── Routine logs ───────────────────────────────────────────────────────────

export type RoutineItem = { key: string; label: string; done: boolean; done_at: string | null };

export type RoutineLog = {
  id: string;
  user_id: string;
  period: string; // '2026-06' | '2026-annual'
  items: RoutineItem[];
  completed_at: string | null;
};

export function useRoutineLog(period: string) {
  const { user } = useAuth();
  return useQuery<RoutineLog | null>({
    queryKey: ["routine_logs", period, user?.id],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("routine_logs")
        .select("*")
        .eq("period", period)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
}

export function useUpsertRoutineLog() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { period: string; items: RoutineItem[]; completed_at?: string | null }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("routine_logs")
        .upsert({ ...input, user_id: user!.id }, { onConflict: "user_id,period" });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ["routine_logs", vars.period] }),
  });
}

// ── Dry powder ─────────────────────────────────────────────────────────────

/** Suelta la pólvora: registra aportación extraordinaria y resetea el pool. */
export function useFireDryPowder() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { plan: InvestmentPlan; multi: number; signalNote: string }) => {
      const { plan, multi, signalNote } = input;
      const powder = plan.dry_powder!;
      const today = new Date().toISOString().slice(0, 10);
      const month = today.slice(0, 7) + "-01";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: cErr } = await (supabase as any).from("plan_contributions").insert({
        user_id: user!.id,
        plan_id: plan.id,
        date: month,
        planned_amount: 0,
        actual_amount: powder.current_eur,
        multiplier: multi,
        signal_note: signalNote,
      });
      if (cErr) throw cErr;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: pErr } = await (supabase as any)
        .from("investment_plans")
        .update({ dry_powder: { ...powder, current_eur: 0, last_fired_at: today } })
        .eq("id", plan.id);
      if (pErr) throw pErr;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["investment_plans"] });
      qc.invalidateQueries({ queryKey: ["plan_contributions", vars.plan.id] });
    },
  });
}
```

Nota: la aportación de pólvora usa `insert` (no upsert) deliberadamente — no debe machacar la aportación regular del mes. Puede coexistir más de una fila por mes para un plan; la UI del LOG las muestra todas. **Importante:** el `onConflict: "plan_id,date"` del upsert regular implica que existe una unique constraint; verificar con `\d plan_contributions` si el insert de pólvora choca — si hay unique en (plan_id,date), usar `date` = día real del disparo (no primer día de mes) para no colisionar: cambiar `const month = ...` por `const month = today;`. Decisión: usar `today` directamente (día real), evita el conflicto siempre.

- [ ] **Step 3: Crear `src/lib/signals-api.ts`:**

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { SignalKey, SignalMap, SignalValue } from "./strategy-engine";

/** Claves visibles en el panel (excluye series internas *_ath, btc_close_w, *_price). */
export const PANEL_SIGNALS: { key: SignalKey; label: string; manual: boolean; hint: string }[] = [
  { key: "vix", label: "VIX", manual: false, hint: "Yahoo ^VIX" },
  { key: "dxy", label: "DXY (índice dólar)", manual: false, hint: "Yahoo DX-Y.NYB" },
  { key: "tips_10y_real", label: "TIPS 10Y real (%)", manual: false, hint: "FRED DFII10" },
  { key: "hy_spread", label: "Spread HY (pp)", manual: false, hint: "FRED BAMLH0A0HYM2" },
  { key: "msci_dd", label: "DD MSCI World", manual: false, hint: "vs ATH" },
  { key: "gold_dd", label: "DD Oro", manual: false, hint: "vs ATH" },
  { key: "btc_dd", label: "DD BTC", manual: false, hint: "vs ATH" },
  { key: "btc_p200w", label: "BTC / 200WMA", manual: false, hint: "calculado" },
  { key: "btc_mvrv", label: "MVRV Z-Score", manual: true, hint: "lookintobitcoin" },
  { key: "btc_puell", label: "Puell Multiple", manual: true, hint: "lookintobitcoin" },
  { key: "insiders_ratio", label: "Insiders ratio", manual: true, hint: "openinsider" },
];

/** Última observación por señal (busca hasta 400 días atrás para cubrir manuales viejas). */
export function useLatestSignals() {
  const { user } = useAuth();
  return useQuery<SignalMap>({
    queryKey: ["market_signals"],
    queryFn: async () => {
      const since = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("market_signals")
        .select("signal_key, date, value, source")
        .gte("date", since)
        .order("date", { ascending: false });
      if (error) throw error;
      const map: SignalMap = {};
      for (const row of data ?? []) {
        const k = row.signal_key as SignalKey;
        if (!map[k]) map[k] = { value: Number(row.value), date: row.date, source: row.source } as SignalValue;
      }
      return map;
    },
    enabled: !!user,
  });
}

export function useUpsertManualSignal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { signal_key: SignalKey; value: number }) => {
      const today = new Date().toISOString().slice(0, 10);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("market_signals")
        .upsert(
          { signal_key: input.signal_key, date: today, value: input.value, source: "manual" },
          { onConflict: "signal_key,date" },
        );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["market_signals"] }),
  });
}
```

- [ ] **Step 4: Verificar compilación** `npm run build 2>&1 | tail -3` → Expected: `✓ built`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/planning-api.ts src/lib/signals-api.ts
git commit -m "feat: extend planning API with strategies, routine logs and signals hooks"
```

---

### Task 8: Edge Function `signals-sync`

**Files:**
- Create: `supabase/functions/signals-sync/index.ts`

Series internas en `market_signals` (no aparecen en el panel): `msci_ath`, `gold_ath`, `btc_ath` (máximo histórico, una fila por actualización) y `btc_close_w` (cierre semanal BTC, date = lunes de la semana ISO).

- [ ] **Step 1: Implementar** — crear `supabase/functions/signals-sync/index.ts`:

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, corsResponse } from "../_shared/cors.ts";

const YH = "https://query1.finance.yahoo.com/v8/finance/chart";
const UA = { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64)" };

async function yahooLast(symbol: string): Promise<number> {
  const r = await fetch(`${YH}/${encodeURIComponent(symbol)}?range=5d&interval=1d`, { headers: UA });
  if (!r.ok) throw new Error(`yahoo ${symbol}: HTTP ${r.status}`);
  const j = await r.json();
  const closes = (j.chart.result[0].indicators.quote[0].close as (number | null)[]).filter((c) => c != null);
  return closes[closes.length - 1] as number;
}

async function fredLast(series: string, key: string): Promise<number> {
  const u = `https://api.stlouisfed.org/fred/series/observations?series_id=${series}&api_key=${key}&file_type=json&sort_order=desc&limit=10`;
  const r = await fetch(u);
  if (!r.ok) throw new Error(`fred ${series}: HTTP ${r.status}`);
  const j = await r.json();
  const obs = j.observations.find((o: { value: string }) => o.value !== ".");
  if (!obs) throw new Error(`fred ${series}: sin observaciones`);
  return parseFloat(obs.value);
}

function isoWeekMonday(d: Date): string {
  const day = d.getUTCDay() || 7;
  const m = new Date(d);
  m.setUTCDate(d.getUTCDate() - day + 1);
  return m.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const fredKey = Deno.env.get("FRED_API_KEY")!;
  const today = new Date().toISOString().slice(0, 10);
  const results: Record<string, number | string> = {};
  const errors: string[] = [];

  const upsert = (signal_key: string, value: number, date = today) =>
    db.from("market_signals").upsert({ signal_key, date, value, source: "auto" }, { onConflict: "signal_key,date" });

  // 1. Directas
  for (const [key, fn] of [
    ["vix", () => yahooLast("^VIX")],
    ["dxy", () => yahooLast("DX-Y.NYB")],
    ["tips_10y_real", () => fredLast("DFII10", fredKey)],
    ["hy_spread", () => fredLast("BAMLH0A0HYM2", fredKey)],
  ] as [string, () => Promise<number>][]) {
    try {
      const v = await fn();
      await upsert(key, v);
      results[key] = v;
    } catch (e) {
      errors.push(`${key}: ${(e as Error).message}`);
    }
  }

  // 2. Drawdowns con ATH incremental
  for (const [symbol, ddKey, athKey] of [
    ["IWDA.AS", "msci_dd", "msci_ath"],
    ["GC=F", "gold_dd", "gold_ath"],
    ["BTC-USD", "btc_dd", "btc_ath"],
  ] as [string, string, string][]) {
    try {
      const price = await yahooLast(symbol);
      const { data: athRow } = await db
        .from("market_signals")
        .select("value")
        .eq("signal_key", athKey)
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();
      const ath = Math.max(Number(athRow?.value ?? 0), price);
      await upsert(athKey, ath);
      await upsert(ddKey, price / ath - 1);
      results[ddKey] = price / ath - 1;

      if (symbol === "BTC-USD") {
        await upsert("btc_close_w", price, isoWeekMonday(new Date()));
        const { data: weeks } = await db
          .from("market_signals")
          .select("value")
          .eq("signal_key", "btc_close_w")
          .order("date", { ascending: false })
          .limit(200);
        if (weeks && weeks.length >= 100) {
          const avg = weeks.reduce((s, w) => s + Number(w.value), 0) / weeks.length;
          await upsert("btc_p200w", price / avg);
          results.btc_p200w = price / avg;
        } else {
          errors.push(`btc_p200w: solo ${weeks?.length ?? 0} cierres semanales (seed pendiente)`);
        }
      }
    } catch (e) {
      errors.push(`${ddKey}: ${(e as Error).message}`);
    }
  }

  return corsResponse({ ok: errors.length === 0, results, errors });
});
```

- [ ] **Step 2: Deploy**

```bash
npx supabase functions deploy signals-sync
```

- [ ] **Step 3: Invocar y verificar** (SERVICE_ROLE_KEY del dashboard → Settings → API):

```bash
URL=$(grep VITE_SUPABASE_URL .env | cut -d= -f2 | tr -d '"')
curl -s -X POST "$URL/functions/v1/signals-sync" -H "Authorization: Bearer $SERVICE_ROLE_KEY" | python3 -m json.tool
```

Expected: JSON con `results.vix`, `results.dxy`, `results.tips_10y_real`, `results.hy_spread`, `results.msci_dd`, `results.gold_dd`, `results.btc_dd` numéricos. `btc_p200w` aparecerá en `errors` hasta ejecutar el seed (Task 9) — es esperado.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/signals-sync/index.ts
git commit -m "feat: signals-sync edge function (Yahoo + FRED + incremental ATH)"
```

---

### Task 9: Seed — histórico y estrategias del Excel

**Files:**
- Create: `scripts/seed-strategies.ts`

El script usa la SERVICE_ROLE key (env) y el email del usuario para resolver `user_id`. Es idempotente: las estrategias se buscan por nombre antes de insertar; el histórico se upserta.

- [ ] **Step 1: Implementar** — crear `scripts/seed-strategies.ts`:

```typescript
/**
 * Seed de estrategias del Excel ESTATEGIA_PERSONAL.xlsx + histórico para ATH y 200WMA.
 * Uso: SUPABASE_URL=... SERVICE_ROLE_KEY=... USER_EMAIL=manidmt5@gmail.com npx tsx scripts/seed-strategies.ts
 */
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.SUPABASE_URL!, process.env.SERVICE_ROLE_KEY!);
const UA = { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64)" };

async function yahooHistory(symbol: string, interval: "1wk" | "1mo") {
  const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=max&interval=${interval}`;
  const r = await fetch(u, { headers: UA });
  if (!r.ok) throw new Error(`yahoo ${symbol}: HTTP ${r.status}`);
  const j = await r.json();
  const res = j.chart.result[0];
  const ts: number[] = res.timestamp;
  const closes: (number | null)[] = res.indicators.quote[0].close;
  return ts
    .map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: closes[i] }))
    .filter((x): x is { date: string; close: number } => x.close != null);
}

async function upsertSignals(rows: { signal_key: string; date: string; value: number }[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db
      .from("market_signals")
      .upsert(rows.slice(i, i + 500).map((r) => ({ ...r, source: "auto" })), { onConflict: "signal_key,date" });
    if (error) throw error;
  }
}

async function main() {
  // 1. Resolver usuario
  const { data: users, error: uErr } = await db.auth.admin.listUsers();
  if (uErr) throw uErr;
  const user = users.users.find((u) => u.email === process.env.USER_EMAIL);
  if (!user) throw new Error(`Usuario ${process.env.USER_EMAIL} no encontrado`);

  // 2. Histórico semanal BTC → btc_close_w + btc_ath
  const btc = await yahooHistory("BTC-USD", "1wk");
  await upsertSignals(btc.map((x) => ({ signal_key: "btc_close_w", date: x.date, value: x.close })));
  const btcAth = Math.max(...btc.map((x) => x.close));
  await upsertSignals([{ signal_key: "btc_ath", date: btc[btc.length - 1].date, value: btcAth }]);
  console.log(`btc: ${btc.length} semanas, ATH=${btcAth}`);

  // 3. ATH MSCI World (IWDA) y Oro (GC=F) desde histórico mensual
  for (const [symbol, athKey] of [["IWDA.AS", "msci_ath"], ["GC=F", "gold_ath"]] as const) {
    const hist = await yahooHistory(symbol, "1mo");
    const ath = Math.max(...hist.map((x) => x.close));
    await upsertSignals([{ signal_key: athKey, date: hist[hist.length - 1].date, value: ath }]);
    console.log(`${athKey}=${ath}`);
  }

  // 4. Estrategias del Excel (fuente de verdad: hoja CONTEXTO)
  const strategies = [
    {
      name: "RV Core (MSCI World)",
      asset_name: "MSCI World (IWDA)",
      asset_class: "rv_core",
      amount: 200,
      multiplier_rules: {
        base: {
          type: "ladder", cadence: "annual", signal: "msci_dd",
          steps: [{ lte: -0.1, multi: 2 }, { lte: -0.2, multi: 3 }], default: 1,
        },
      },
      dry_powder: null,
      return_pessimistic: 5, return_base: 10.9, return_optimistic: 14,
    },
    {
      name: "RV Oportunista (S&P 500)",
      asset_name: "S&P 500",
      asset_class: "rv_opp",
      amount: 100,
      multiplier_rules: {
        trigger: {
          type: "combo",
          conditions: [
            { signal: "vix", op: "gt", value: 50 },
            { signal: "insiders_ratio", op: "gte", value: 0.5 },
          ],
          multi: 4, cooldown_months: 3,
        },
      },
      dry_powder: { current_eur: 3000, monthly_feed_eur: 33, last_fired_at: null },
      return_pessimistic: 7, return_base: 16.2, return_optimistic: 20,
    },
    {
      name: "Oro (IGLN)",
      asset_name: "iShares Physical Gold",
      asset_class: "gold",
      amount: 100,
      multiplier_rules: {
        base: {
          type: "matrix", cadence: "annual",
          row_signal: "tips_10y_real", col_signal: "dxy",
          row_breaks: [1, 0.5, 0], col_breaks: [100, 110, 120],
          values: [[1, 1, 2, 2], [2, 2, 3, 3], [3, 3, 4, 5], [4, 4, 5, 6]],
          bonus: { signal: "gold_dd", lte: -0.15, add: 1 }, max: 6,
        },
        trigger: {
          type: "combo",
          conditions: [
            { signal: "tips_10y_real", op: "lt", value: 0.5 },
            { signal: "dxy", op: "gt", value: 110 },
            { signal: "gold_dd", op: "lte", value: -0.05 },
          ],
          multi: 6, cooldown_months: 6,
        },
      },
      dry_powder: { current_eur: 1000, monthly_feed_eur: 50, last_fired_at: null },
      return_pessimistic: 6, return_base: 13.7, return_optimistic: 17,
    },
    {
      name: "Bitcoin (Criptan)",
      asset_name: "BTC",
      asset_class: "btc",
      amount: 50,
      multiplier_rules: {
        base: {
          type: "ladder", cadence: "annual", signal: "btc_dd",
          steps: [{ lte: -0.3, multi: 2 }, { lte: -0.5, multi: 3 }, { lte: -0.7, multi: 4 }], default: 1,
        },
        trigger: {
          type: "combo",
          conditions: [
            { signal: "btc_dd", op: "lt", value: -0.5 },
            { signal: "btc_mvrv", op: "lt", value: 0 },
            { signal: "btc_p200w", op: "lt", value: 1.2 },
            { signal: "btc_puell", op: "lt", value: 0.5 },
          ],
          multi: 4, cooldown_months: 6,
        },
      },
      dry_powder: { current_eur: 1000, monthly_feed_eur: 0, last_fired_at: null },
      return_pessimistic: 8, return_base: 15, return_optimistic: 25,
    },
    {
      name: "Renta Fija (HY)",
      asset_name: "iShares HY USA EUR Hedged",
      asset_class: "rf",
      amount: 0,
      active: false, // inactiva hasta sep-2027
      multiplier_rules: {
        base: {
          type: "ladder", cadence: "monthly", signal: "hy_spread",
          steps: [{ lte: 999, multi: 1 }], default: 1, // placeholder ladder ascendente: ver nota
        },
      },
      dry_powder: null,
      return_pessimistic: 2, return_base: 6.4, return_optimistic: 8,
    },
  ];

  for (const s of strategies) {
    const { data: existing } = await db
      .from("investment_plans")
      .select("id")
      .eq("user_id", user.id)
      .eq("name", s.name)
      .maybeSingle();
    const row = {
      user_id: user.id,
      name: s.name,
      asset_name: s.asset_name,
      rule_type: "fixed",
      amount: s.amount,
      percentage: null,
      frequency: "monthly",
      return_pessimistic: s.return_pessimistic,
      return_base: s.return_base,
      return_optimistic: s.return_optimistic,
      start_date: "2026-06-01",
      active: s.active ?? true,
      notes: "Migrada del Excel ESTATEGIA_PERSONAL",
      asset_class: s.asset_class,
      multiplier_rules: s.multiplier_rules,
      dry_powder: s.dry_powder,
      annual_multiplier: 1,
      annual_multiplier_year: 2026,
    };
    const { error } = existing
      ? await db.from("investment_plans").update(row).eq("id", existing.id)
      : await db.from("investment_plans").insert(row);
    if (error) throw error;
    console.log(`${existing ? "updated" : "created"}: ${s.name}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

**Nota RF:** la escalera HY del Excel es ascendente (spread ALTO = multi alto: >5→2, >7→3, >10→4) y el tipo `ladder` compara con `lte` (pensado para drawdowns negativos). Como la estrategia RF está inactiva hasta sep-2027, se deja con ladder neutro (multi 1) y un TODO real NO se admite: en su lugar, al activarla en 2027 se añadirá un tipo `ladder_gte` al motor (tarea de fase 2, registrada en la sección "Fase 2" del spec). El seed la crea inactiva para que la tarjeta exista y documente la estrategia.

- [ ] **Step 2: Instalar tsx si falta y ejecutar:**

```bash
npm install -D tsx
URL=$(grep VITE_SUPABASE_URL .env | cut -d= -f2 | tr -d '"')
SUPABASE_URL=$URL SERVICE_ROLE_KEY=<key> USER_EMAIL=manidmt5@gmail.com npx tsx scripts/seed-strategies.ts
```

Expected: `btc: N semanas` (N > 500), `msci_ath=...`, `gold_ath=...`, 5 líneas `created: ...`.

- [ ] **Step 3: Re-invocar signals-sync y verificar btc_p200w:**

```bash
curl -s -X POST "$URL/functions/v1/signals-sync" -H "Authorization: Bearer $SERVICE_ROLE_KEY" | python3 -m json.tool
```

Expected: `results.btc_p200w` numérico, `errors: []`.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-strategies.ts package.json package-lock.json
git commit -m "feat: seed script for Excel strategies and price history"
```

---

### Task 10: Cron diario de señales (pg_cron)

**Files:** ninguno (SQL en dashboard)

- [ ] **Step 1: Ejecutar en el SQL Editor del dashboard** (sustituir `<SERVICE_ROLE_KEY>`):

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'signals-sync-daily',
  '0 7 * * *',
  $$
  select net.http_post(
    url := 'https://pqfixpcbupdslrdfealq.supabase.co/functions/v1/signals-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

- [ ] **Step 2: Verificar:** `select jobname, schedule from cron.job;` → Expected: fila `signals-sync-daily`.

---

### Task 11: UI — SignalsPanel

**Files:**
- Create: `src/components/planning/SignalsPanel.tsx`

- [ ] **Step 1: Implementar:**

```tsx
import { useState } from "react";
import { SectionCard } from "@/components/app/SectionCard";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Pencil } from "lucide-react";
import { PANEL_SIGNALS, useLatestSignals, useUpsertManualSignal } from "@/lib/signals-api";
import { isStale, type SignalKey } from "@/lib/strategy-engine";

export function SignalsPanel() {
  const { data: signals = {} } = useLatestSignals();
  const upsert = useUpsertManualSignal();
  const [editing, setEditing] = useState<SignalKey | null>(null);
  const [value, setValue] = useState("");

  const fmt = (k: SignalKey, v: number) =>
    k.endsWith("_dd") ? `${(v * 100).toFixed(1)} %` : v.toFixed(2);

  return (
    <SectionCard title="Señales de mercado">
      <div className="divide-y divide-border text-[13px]">
        {PANEL_SIGNALS.map(({ key, label, manual, hint }) => {
          const s = signals[key];
          const stale = s ? isStale(s) : false;
          return (
            <div key={key} className="flex items-center gap-3 py-2">
              <span className="w-44 font-medium">{label}</span>
              <span className="w-24 tabular-nums">{s ? fmt(key, s.value) : "—"}</span>
              <span className="flex-1 text-muted-foreground">
                {s ? s.date : "sin dato"} · {hint}
                {stale && <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-600">caducada</span>}
                {!s && manual && <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-600">pendiente</span>}
              </span>
              {manual && (
                <Button variant="ghost" size="icon" onClick={() => { setEditing(key); setValue(s ? String(s.value) : ""); }}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>{PANEL_SIGNALS.find((p) => p.key === editing)?.label}</DialogTitle>
          </DialogHeader>
          <Input type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} />
          <Button
            disabled={upsert.isPending || value === ""}
            onClick={() => {
              upsert.mutate({ signal_key: editing!, value: Number(value) }, { onSuccess: () => setEditing(null) });
            }}
          >
            Guardar
          </Button>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
```

- [ ] **Step 2: Build** `npm run build 2>&1 | tail -3` → `✓ built`.

- [ ] **Step 3: Commit**

```bash
git add src/components/planning/SignalsPanel.tsx
git commit -m "feat: signals panel with manual editing and staleness badges"
```

---

### Task 12: UI — StrategyCard

**Files:**
- Create: `src/components/planning/StrategyCard.tsx`

Tarjeta para planes con `asset_class`. Los planes simples siguen usando el `PlanCard` existente de `planning.tsx`.

- [ ] **Step 1: Implementar:**

```tsx
import { Button } from "@/components/ui/button";
import { Flame, Pencil } from "lucide-react";
import type { InvestmentPlan } from "@/lib/planning-api";
import { useFireDryPowder } from "@/lib/planning-api";
import {
  currentMultiplier, effectiveQuota, evaluateTrigger, type SignalMap,
} from "@/lib/strategy-engine";

const ASSET_ICON: Record<string, string> = {
  rv_core: "🚀", rv_opp: "🚀", gold: "🏆", btc: "₿", rf: "🏦",
};

export function StrategyCard({
  plan, signals, onEdit, onRegister,
}: {
  plan: InvestmentPlan;
  signals: SignalMap;
  onEdit: () => void;
  onRegister: () => void;
}) {
  const fire = useFireDryPowder();
  const multi = currentMultiplier(plan, signals);
  const quota = effectiveQuota(plan, signals);
  const trigger = plan.multiplier_rules?.trigger;
  const tr = evaluateTrigger(trigger, signals, plan.dry_powder?.last_fired_at ?? null);

  const light = tr.fired ? "bg-red-500" : tr.blocked ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span>{ASSET_ICON[plan.asset_class ?? ""] ?? "📈"}</span>
          <span className="text-[14px] font-semibold">{plan.name}</span>
          {!plan.active && <span className="rounded bg-muted px-1.5 py-0.5 text-[11px]">inactiva</span>}
        </div>
        <div className="flex items-center gap-1">
          <span className={`h-2.5 w-2.5 rounded-full ${light}`} title={tr.detail} />
          <Button variant="ghost" size="icon" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /></Button>
        </div>
      </div>

      <div className="mt-2 flex items-baseline gap-2 text-[13px]">
        <span className="text-muted-foreground">{plan.amount?.toFixed(0)} € base</span>
        <span className="text-muted-foreground">×{multi}</span>
        <span className="text-[16px] font-bold tabular-nums">{quota.toFixed(0)} €/mes</span>
      </div>

      {plan.dry_powder && (
        <div className="mt-2 flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-[12px]">
          <span>
            Pólvora: <b>{plan.dry_powder.current_eur.toFixed(0)} €</b>
            {plan.dry_powder.monthly_feed_eur > 0 && ` (+${plan.dry_powder.monthly_feed_eur} €/mes)`}
          </span>
          {tr.fired && plan.dry_powder.current_eur > 0 && (
            <Button
              size="sm" variant="destructive" disabled={fire.isPending}
              onClick={() => fire.mutate({ plan, multi: trigger!.multi, signalNote: tr.detail })}
            >
              <Flame className="mr-1 h-3.5 w-3.5" /> Soltar pólvora
            </Button>
          )}
        </div>
      )}

      <p className="mt-2 text-[11px] text-muted-foreground">{tr.detail}</p>

      <div className="mt-3">
        <Button size="sm" variant="outline" onClick={onRegister} disabled={!plan.active}>
          Registrar aportación
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Integrar en `src/routes/planning.tsx`** — en la sección "Mis planes" (dentro del `SectionCard` que mapea `activePlans`, línea ~157), separar estrategias de planes simples:

```tsx
{plans.filter((p) => p.asset_class).map((plan) => (
  <StrategyCard
    key={plan.id}
    plan={plan}
    signals={signals}
    onEdit={() => { setEditingPlan(plan); setPlanModalOpen(true); }}
    onRegister={() => setContributionPlan(plan)}
  />
))}
{activePlans.filter((p) => !p.asset_class).map((plan) => (
  <PlanCard key={plan.id} ... /* render existente sin cambios */ />
))}
```

con los imports y el hook arriba del componente `PlanningPage`:

```tsx
import { StrategyCard } from "@/components/planning/StrategyCard";
import { useLatestSignals } from "@/lib/signals-api";
// dentro de PlanningPage:
const { data: signals = {} } = useLatestSignals();
```

- [ ] **Step 3: Build + verificación visual** `npm run build && npm run dev` → abrir `/planning`: las 5 estrategias del seed aparecen como tarjetas con multi y cuota efectiva; semáforo verde (o ámbar si MVRV/Puell/insiders aún sin dato).

- [ ] **Step 4: Commit**

```bash
git add src/components/planning/StrategyCard.tsx src/routes/planning.tsx
git commit -m "feat: strategy cards with effective quota, dry powder and signal light"
```

---

### Task 13: UI — MonthlyRoutine

**Files:**
- Create: `src/components/planning/MonthlyRoutine.tsx`

Checklist del mes generado desde estrategias activas. Pasos: una aportación por estrategia (abre el registro), transferencia de feed de pólvora si procede, revisión de señales, y paso extraordinario si algún trigger dispara. Estado persistido en `routine_logs` con period `YYYY-MM`.

- [ ] **Step 1: Implementar:**

```tsx
import { useMemo } from "react";
import { SectionCard } from "@/components/app/SectionCard";
import { Checkbox } from "@/components/ui/checkbox";
import type { InvestmentPlan, RoutineItem } from "@/lib/planning-api";
import { useRoutineLog, useUpsertRoutineLog } from "@/lib/planning-api";
import { effectiveQuota, evaluateTrigger, type SignalMap } from "@/lib/strategy-engine";

function buildItems(strategies: InvestmentPlan[], signals: SignalMap): Omit<RoutineItem, "done" | "done_at">[] {
  const items: Omit<RoutineItem, "done" | "done_at">[] = [];
  for (const p of strategies) {
    items.push({ key: `buy-${p.id}`, label: `Aportar ${effectiveQuota(p, signals).toFixed(0)} € a ${p.name}` });
    if (p.dry_powder && p.dry_powder.monthly_feed_eur > 0) {
      items.push({ key: `feed-${p.id}`, label: `Transferir ${p.dry_powder.monthly_feed_eur} € a pólvora de ${p.name}` });
    }
  }
  items.push({ key: "signals", label: "Revisar señales (panel de abajo: manuales al día)" });
  for (const p of strategies) {
    const tr = evaluateTrigger(p.multiplier_rules?.trigger, signals, p.dry_powder?.last_fired_at ?? null);
    if (tr.fired && (p.dry_powder?.current_eur ?? 0) > 0) {
      items.push({ key: `fire-${p.id}`, label: `🚨 Soltar pólvora de ${p.name} (${p.dry_powder!.current_eur} €) — ${tr.detail}` });
    }
  }
  return items;
}

export function MonthlyRoutine({ strategies, signals }: { strategies: InvestmentPlan[]; signals: SignalMap }) {
  const period = new Date().toISOString().slice(0, 7); // YYYY-MM
  const { data: log } = useRoutineLog(period);
  const upsert = useUpsertRoutineLog();

  const items = useMemo(() => {
    const built = buildItems(strategies.filter((s) => s.active), signals);
    const saved = new Map((log?.items ?? []).map((i) => [i.key, i]));
    return built.map((b) => ({ ...b, done: saved.get(b.key)?.done ?? false, done_at: saved.get(b.key)?.done_at ?? null }));
  }, [strategies, signals, log]);

  const doneCount = items.filter((i) => i.done).length;

  const toggle = (key: string) => {
    const next = items.map((i) =>
      i.key === key ? { ...i, done: !i.done, done_at: !i.done ? new Date().toISOString() : null } : i,
    );
    const allDone = next.every((i) => i.done);
    upsert.mutate({ period, items: next, completed_at: allDone ? new Date().toISOString() : null });
  };

  return (
    <SectionCard title={`Rutina de ${period}`} subtitle={`${doneCount}/${items.length} pasos`}>
      <div className="space-y-2">
        {items.map((i) => (
          <label key={i.key} className="flex cursor-pointer items-center gap-3 text-[13px]">
            <Checkbox checked={i.done} onCheckedChange={() => toggle(i.key)} />
            <span className={i.done ? "text-muted-foreground line-through" : ""}>{i.label}</span>
          </label>
        ))}
      </div>
      {doneCount === items.length && (
        <p className="mt-3 text-[12px] text-emerald-600">✅ Rutina del mes completada</p>
      )}
    </SectionCard>
  );
}
```

Nota: si `SectionCard` no acepta `subtitle`, mover `${doneCount}/${items.length}` a un `<p>` dentro del cuerpo (comprobar la firma en `src/components/app/SectionCard.tsx` al implementar).

- [ ] **Step 2: Build** `npm run build 2>&1 | tail -3` → `✓ built`.

- [ ] **Step 3: Commit**

```bash
git add src/components/planning/MonthlyRoutine.tsx
git commit -m "feat: monthly routine checklist persisted in routine_logs"
```

---

### Task 14: UI — JanuaryWizard

**Files:**
- Create: `src/components/planning/JanuaryWizard.tsx`

Visible si alguna estrategia con regla `base` de cadencia `annual` tiene `annual_multiplier_year` < año actual. Muestra la propuesta del motor por estrategia y persiste al confirmar.

- [ ] **Step 1: Implementar:**

```tsx
import { SectionCard } from "@/components/app/SectionCard";
import { Button } from "@/components/ui/button";
import type { InvestmentPlan } from "@/lib/planning-api";
import { useUpdatePlan } from "@/lib/planning-api";
import { evaluateBase, type SignalMap } from "@/lib/strategy-engine";

export function JanuaryWizard({ strategies, signals }: { strategies: InvestmentPlan[]; signals: SignalMap }) {
  const update = useUpdatePlan();
  const year = new Date().getFullYear();

  const pending = strategies.filter(
    (p) =>
      p.active &&
      p.multiplier_rules?.base?.cadence === "annual" &&
      (p.annual_multiplier_year ?? 0) < year,
  );

  if (pending.length === 0) return null;

  return (
    <SectionCard title={`Calibración anual ${year}`}>
      <p className="mb-3 text-[12px] text-muted-foreground">
        Fija los multiplicadores del año según las señales a 31 de diciembre. Revisa y confirma cada uno.
      </p>
      <div className="space-y-3">
        {pending.map((p) => {
          const proposal = evaluateBase(p.multiplier_rules!.base, signals);
          return (
            <div key={p.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-[13px]">
              <div>
                <p className="font-medium">{p.name}</p>
                <p className="text-[11px] text-muted-foreground">{proposal.detail}</p>
                <p className="text-[11px]">
                  Propuesta: <b>×{proposal.multi}</b> → cuota {(p.amount ?? 0) * proposal.multi} €/mes
                  {p.asset_class === "btc" && ` (compra anual: ${(p.amount ?? 0) * proposal.multi * 12} € de golpe)`}
                </p>
              </div>
              <Button
                size="sm" disabled={update.isPending}
                onClick={() =>
                  update.mutate({ id: p.id, annual_multiplier: proposal.multi, annual_multiplier_year: year })
                }
              >
                Fijar ×{proposal.multi}
              </Button>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
```

Nota: `useUpdatePlan` acepta `Partial<CreatePlanInput>`; tras Task 7 `CreatePlanInput` ya incluye `annual_multiplier` y `annual_multiplier_year` (derivado de `InvestmentPlan`).

- [ ] **Step 2: Build** → `✓ built`.

- [ ] **Step 3: Commit**

```bash
git add src/components/planning/JanuaryWizard.tsx
git commit -m "feat: january wizard to set annual multipliers from signals"
```

---

### Task 15: UI — ContributionLog y composición final

**Files:**
- Create: `src/components/planning/ContributionLog.tsx`
- Modify: `src/routes/planning.tsx`

- [ ] **Step 1: Implementar `ContributionLog.tsx`:**

```tsx
import { useState } from "react";
import { SectionCard } from "@/components/app/SectionCard";
import { Input } from "@/components/ui/input";
import type { InvestmentPlan } from "@/lib/planning-api";
import { usePlanContributions } from "@/lib/planning-api";

export function ContributionLog({ plan }: { plan: InvestmentPlan }) {
  const { data: contributions = [] } = usePlanContributions(plan.id);
  const [currentPrice, setCurrentPrice] = useState("");

  const withUnits = contributions.filter((c) => c.units && c.actual_amount);
  const totalInvested = contributions.reduce((s, c) => s + (c.actual_amount ?? 0), 0);
  const totalUnits = withUnits.reduce((s, c) => s + (c.units ?? 0), 0);
  const wap = totalUnits > 0 ? withUnits.reduce((s, c) => s + (c.actual_amount ?? 0), 0) / totalUnits : null;
  const cp = Number(currentPrice);
  const ret = wap && cp > 0 ? (cp / wap - 1) * 100 : null;

  return (
    <SectionCard title={`LOG — ${plan.name}`}>
      <table className="w-full text-[12px]">
        <thead className="text-muted-foreground">
          <tr className="text-left">
            <th className="py-1">Fecha</th><th>Aportado</th><th>Precio</th><th>Unidades</th><th>Multi</th><th>Señal</th>
          </tr>
        </thead>
        <tbody>
          {contributions.map((c) => (
            <tr key={c.id} className="border-t border-border">
              <td className="py-1">{c.date}</td>
              <td className="tabular-nums">{c.actual_amount?.toFixed(0) ?? "—"} €</td>
              <td className="tabular-nums">{c.price?.toFixed(2) ?? "—"}</td>
              <td className="tabular-nums">{c.units?.toFixed(4) ?? "—"}</td>
              <td>{c.multiplier ? `×${c.multiplier}` : "—"}</td>
              <td className="text-muted-foreground">{c.signal_note ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-border pt-3 text-[12px]">
        <span>Total aportado: <b>{totalInvested.toFixed(0)} €</b></span>
        {wap && <span>Precio medio ponderado: <b>{wap.toFixed(2)}</b></span>}
        {wap && (
          <span className="flex items-center gap-1">
            Precio actual: <Input className="h-7 w-24" type="number" step="any" value={currentPrice} onChange={(e) => setCurrentPrice(e.target.value)} />
            {ret !== null && (
              <b className={ret >= 0 ? "text-emerald-600" : "text-red-600"}>{ret >= 0 ? "+" : ""}{ret.toFixed(1)} %</b>
            )}
          </span>
        )}
      </div>
    </SectionCard>
  );
}
```

(El precio actual es un input manual en fase 1: los vehículos cotizan en divisas distintas a las señales almacenadas. La rentabilidad se calcula al teclearlo.)

- [ ] **Step 2: Ampliar el modal de aportación en `planning.tsx`** — el modal existente (schema `contributionSchema`, línea ~88) gana dos campos opcionales `price` y `multiplier`; al guardar, calcular `units = actual_amount / price` si hay precio:

```typescript
const contributionSchema = z.object({
  date: z.string(),
  actual_amount: z.coerce.number().min(0),
  price: z.coerce.number().positive().optional(),
  multiplier: z.coerce.number().positive().optional(),
});
// en el submit:
upsertContribution.mutate({
  plan_id: plan.id,
  date: values.date,
  planned_amount: planned,
  actual_amount: values.actual_amount,
  price: values.price ?? null,
  units: values.price ? values.actual_amount / values.price : null,
  multiplier: values.multiplier ?? null,
});
```

Añadir los dos `<Input>` correspondientes en el JSX del modal junto al campo de importe existente (mismo patrón de FormField que los campos actuales). El importe por defecto del campo `actual_amount` para estrategias pasa a ser la cuota efectiva: `effectiveQuota(plan, signals)`.

- [ ] **Step 3: Composición final de `planning.tsx`** — orden de secciones en el JSX de `PlanningPage`:

```tsx
<JanuaryWizard strategies={strategyPlans} signals={signals} />
{/* SectionCard "Mis planes" existente, ahora con StrategyCard + PlanCard (Task 12) */}
<MonthlyRoutine strategies={strategyPlans} signals={signals} />
{/* SectionCard "Proyección" existente sin cambios */}
<ContributionLog plan={selectedStrategy} />  {/* para la estrategia seleccionada; reutilizar selectedPlanId */}
<SignalsPanel />
```

con `const strategyPlans = plans.filter((p) => p.asset_class);` y el `ContributionHistory` existente reservado para planes simples (sin `asset_class`).

- [ ] **Step 4: Build + verificación visual completa:**

```bash
npm run build 2>&1 | tail -3 && systemctl --user restart wealth-navigator
```

Abrir `https://wealthos.manidmt.es/planning` y comprobar: wizard de calibración NO visible (year 2026 ya fijado por el seed), 5 tarjetas, rutina del mes con pasos, LOG vacío, panel de señales con datos del sync y 3 manuales pendientes.

- [ ] **Step 5: Commit**

```bash
git add src/components/planning/ContributionLog.tsx src/routes/planning.tsx
git commit -m "feat: contribution log with WAP and final planning page composition"
```

---

### Task 16: Edge Function `routine-summary`

**Files:**
- Create: `supabase/functions/routine-summary/index.ts`

Devuelve el resumen para el aviso Telegram. Importa el motor desde `_shared` (misma fuente que el frontend).

- [ ] **Step 1: Implementar:**

```typescript
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, corsResponse } from "../_shared/cors.ts";
import {
  currentMultiplier, effectiveQuota, evaluateTrigger, isStale,
  type SignalMap, type SignalKey,
} from "../_shared/strategy-engine.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const email = new URL(req.url).searchParams.get("user_email");
  if (!email) return corsResponse({ error: "user_email requerido" }, 400);

  const { data: users } = await db.auth.admin.listUsers();
  const user = users?.users.find((u) => u.email === email);
  if (!user) return corsResponse({ error: "usuario no encontrado" }, 404);

  const since = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
  const { data: sigRows } = await db
    .from("market_signals")
    .select("signal_key, date, value, source")
    .gte("date", since)
    .order("date", { ascending: false });
  const signals: SignalMap = {};
  for (const r of sigRows ?? []) {
    const k = r.signal_key as SignalKey;
    if (!signals[k]) signals[k] = { value: Number(r.value), date: r.date, source: r.source };
  }

  const { data: plans } = await db
    .from("investment_plans")
    .select("*")
    .eq("user_id", user.id)
    .eq("active", true)
    .not("asset_class", "is", null);

  const staleSignals = Object.entries(signals)
    .filter(([, s]) => isStale(s!))
    .map(([k, s]) => ({ signal: k, date: s!.date }));

  const strategies = (plans ?? []).map((p) => {
    const tr = evaluateTrigger(p.multiplier_rules?.trigger, signals, p.dry_powder?.last_fired_at ?? null);
    return {
      name: p.name,
      base_eur: p.amount,
      multiplier: currentMultiplier(p, signals),
      effective_eur: effectiveQuota(p, signals),
      dry_powder_eur: p.dry_powder?.current_eur ?? null,
      trigger: { fired: tr.fired, blocked: tr.blocked, detail: tr.detail },
    };
  });

  return corsResponse({
    month: new Date().toISOString().slice(0, 7),
    strategies,
    stale_signals: staleSignals,
    fired: strategies.filter((s) => s.trigger.fired).map((s) => s.name),
  });
});
```

- [ ] **Step 2: Deploy + verificar:**

```bash
npx supabase functions deploy routine-summary
URL=$(grep VITE_SUPABASE_URL .env | cut -d= -f2 | tr -d '"')
curl -s "$URL/functions/v1/routine-summary?user_email=manidmt5@gmail.com" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" | python3 -m json.tool
```

Expected: JSON con 4-5 `strategies` (RF inactiva no aparece), multiplicadores y `stale_signals` con las 3 manuales si aún no se han introducido.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/routine-summary/index.ts
git commit -m "feat: routine-summary edge function for Telegram digest"
```

---

### Task 17: Cron de OpenClaw → Telegram

**Files:** ninguno en este repo (configuración OpenClaw)

- [ ] **Step 1: Crear dos crons en OpenClaw** (CLI `openclaw cron add` o equivalente de la versión instalada; el agente `main` ya tiene salida Telegram). Mensual — día 28 a las 9:00 (aprox. "fin de mes"; cron estándar no expresa "último viernes"):

```
Schedule: 0 9 28 * *
Prompt: Haz GET a https://pqfixpcbupdslrdfealq.supabase.co/functions/v1/routine-summary?user_email=manidmt5@gmail.com
con header "Authorization: Bearer $SERVICE_ROLE_KEY" (está en el entorno del gateway como WEALTHOS_SERVICE_KEY).
Formatea el JSON como resumen de la rutina mensual de inversión: por estrategia "nombre: base × multi = efectiva €",
pólvora disponible, señales caducadas que hay que actualizar a mano, y 🚨 si fired no está vacío.
Envíamelo por Telegram. Termina recordando: registrar las compras en wealthos.manidmt.es/planning.
```

Anual — 1 de enero a las 9:00 (`0 9 1 1 *`) con prompt análogo que además diga "toca calibración anual: abre el wizard en /planning".

- [ ] **Step 2: Guardar `SERVICE_ROLE_KEY` como `WEALTHOS_SERVICE_KEY`** en el entorno del gateway OpenClaw (donde la instalación cargue env, p. ej. el archivo de entorno del servicio) y reiniciar con `openclaw gateway restart`.

- [ ] **Step 3: Probar un cron manualmente** (run-now del cron o pidiéndole al agente el mismo prompt) y verificar que llega el Telegram con cifras correctas.

---

### Task 18: Verificación final

- [ ] **Step 1: Suite completa:** `npm test` → Expected: 23 passed, 0 failed.

- [ ] **Step 2: Build + deploy:** `npm run build 2>&1 | tail -3 && systemctl --user restart wealth-navigator && sleep 3 && curl -sI http://localhost:8090/ | head -1` → `HTTP/1.1 200`.

- [ ] **Step 3: Contraste con el Excel** — con las señales reales del día en la app, comparar el multiplicador de cada estrategia con el que dan las hojas del Excel introduciendo los mismos valores. Según la hoja RUTINA (datos de mayo): RV ×1, Oro ×2, BTC ×1. Si difieren, revisar primero los valores de señal (¿misma fecha?) y después la regla JSON sembrada.

- [ ] **Step 4: E2E manual de rutina completa:** marcar pasos del checklist → registrar una aportación con precio → verificar fila en LOG con unidades calculadas → precio medio ponderado actualizado → recargar página y comprobar que el estado del checklist persiste.

- [ ] **Step 5: Introducir las 3 señales manuales reales** (MVRV, Puell, insiders desde lookintobitcoin/openinsider) en el panel y comprobar que el semáforo de BTC/RV oportunista pasa de ámbar a verde.

- [ ] **Step 6: Commit final si quedó algo suelto** y actualizar el spec si hubo desviaciones.

---

## Self-review (hecho al escribir el plan)

- **Cobertura del spec:** §1 → Task 2; §2 → Tasks 3-6; §3 → Tasks 8, 16; §4.1 → Task 12; §4.2 → Task 13; §4.3 → Task 14; §4.4 → Task 15; §4.5 → Task 11; §4.6 (proyección sin cambios) → sin task, correcto; §5 seed → Task 9; cron señales → Task 10; Telegram → Task 17; §7 → Tasks 3-6 + 18.
- **Desviaciones conscientes del spec:** (1) rentabilidad del LOG con precio actual manual (divisas mixtas, documentado en Task 15); (2) pólvora registra con fecha del día real para no chocar con la unique de (plan_id, date) (Task 7); (3) escalera RF ascendente pospuesta a fase 2 — estrategia sembrada inactiva con multi neutro (Task 9); (4) "último viernes" → día 28 (limitación de cron estándar, Task 17).
- **Consistencia de tipos:** `StrategyPlanLike` es subconjunto estructural de `InvestmentPlan` extendido (Task 7) — compatible. `SignalMap`/`SignalKey` usados de forma uniforme en Tasks 3-16. `RoutineItem` definido en Task 7 y usado en Task 13.
