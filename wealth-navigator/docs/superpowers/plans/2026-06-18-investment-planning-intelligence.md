# Investment Planning Intelligence + Compact List — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **All implementer/reviewer subagents must use the `sonnet` model — never opus or fable.**

**Goal:** Give the investment planning tab a monthly agent briefing + contextual chat (hybrid-front architecture), turn "Mis planes" cards into a compact expandable list, and fix the contribution modal "optional" fields.

**Architecture:** The deterministic engine stays in TypeScript (single source of truth). A pure module serializes planning state into a text block; the front sends it to the agent via a new `context` field on the WS protocol. The Python agent accepts and injects that context. Briefings are cached in a new Supabase table.

**Tech Stack:** Vite + React + TanStack Query/Router, Supabase (Postgres/RLS), Vitest, FastAPI (Python agent).

**Spec:** `docs/superpowers/specs/2026-06-18-investment-planning-intelligence-design.md`

**Working dir:** `/home/manidmt/Desktop/wealth-os/wealth-navigator` (frontend), `/home/manidmt/Desktop/wealth-os/wealth-agent` (Python agent). Branch: `feature/investment-planning-intelligence`.

---

## File Structure

**Frontend new files:**
- `src/lib/planning-context.ts` — pure: per-plan derivation + `buildPlanningContext` + `serializePlanningContext`.
- `src/lib/planning-context.test.ts` — Vitest.
- `src/lib/briefing-prompt.ts` — pure: `buildBriefingPrompt`.
- `src/lib/briefing-prompt.test.ts` — Vitest.
- `src/lib/agent-ws.test.ts` — Vitest for the `context` payload.
- `src/lib/briefing-api.ts` — `useBriefing`, `useSaveBriefing` hooks.
- `src/components/planning/PlanRow.tsx` — compact expandable row.
- `src/components/planning/InvestmentAssistant.tsx` — briefing + chat panel.
- `src/components/assistant/chat-bits.tsx` — extracted `Markdownish`, `Composer`, `ThinkingDots`.
- `supabase/migrations/20260618120000_investment_briefings.sql` — briefing cache table.

**Frontend modified files:**
- `src/lib/agent-ws.ts` — add optional `context` param.
- `src/lib/planning-api.ts` — add `useAllPlanContributions`.
- `src/components/planning/InvestmentPlanning.tsx` — fix schema, replace card grid with `PlanRow` list, mount `InvestmentAssistant`, remove inline `PlanCard`.
- `src/routes/assistant.tsx` — import the extracted chat bits.

**Frontend removed:**
- `src/components/planning/StrategyCard.tsx` — logic migrates to `PlanRow`.

**Agent modified files:**
- `wealth-agent/app/routers/chat.py` — read `context`.
- `wealth-agent/app/services/agent_service.py` — accept + inject `context`.

---

## Task 1: Fix contribution modal "optional" fields

**Files:**
- Modify: `src/components/planning/InvestmentPlanning.tsx` (the `contributionSchema`, around lines 75-82)

The bug: `z.coerce.number().positive().optional()` coerces empty string `""` to `0`, `.positive()` rejects `0`, and `.optional()` only accepts `undefined`. So leaving `price`/`multiplier` blank blocks submit despite the "opcional" label.

- [ ] **Step 1: Locate the schema**

Read `src/components/planning/InvestmentPlanning.tsx` lines 75-82. Current code:

```ts
const contributionSchema = z.object({
  date: z.string().min(1, "Requerido"),
  actual_amount: z.coerce.number().min(0),
  price: z.coerce.number().positive().optional(),
  multiplier: z.coerce.number().positive().optional(),
});
```

- [ ] **Step 2: Replace with preprocess-wrapped optionals**

```ts
const optionalPositive = z.preprocess(
  (v) => (v === "" || v == null ? undefined : v),
  z.coerce.number().positive().optional(),
);

const contributionSchema = z.object({
  date: z.string().min(1, "Requerido"),
  actual_amount: z.coerce.number().min(0),
  price: optionalPositive,
  multiplier: optionalPositive,
});
```

`onSubmit` already handles `undefined` (`values.price ?? null`, `values.multiplier ?? null`, and `values.price ? ... : null` for units), so no further change is needed.

- [ ] **Step 3: Typecheck**

Run: `cd /home/manidmt/Desktop/wealth-os/wealth-navigator && npx tsc --noEmit`
Expected: no new errors related to `contributionSchema`.

- [ ] **Step 4: Commit**

```bash
git add src/components/planning/InvestmentPlanning.tsx
git commit -m "fix: optional contribution fields no longer block submit when empty"
```

---

## Task 2: Planning context module (pure, TDD)

**Files:**
- Create: `src/lib/planning-context.ts`
- Test: `src/lib/planning-context.test.ts`

This module derives per-plan state with the TS engine and serializes the whole planning state to a text block. It imports only types + pure engine functions (no hooks, no I/O).

Types available to import:
- From `./planning-api`: `InvestmentPlan`, `PlanContribution`.
- From `./planning-calc`: `formatRule`, `computePlannedAmount`, `toEnginePlan`, `MonthlyFinancials`.
- From `./strategy-engine`: `SignalMap`, `effectiveQuota`, `currentMultiplier`, `evaluateTrigger`, `isStale`.
- From `./signals-api`: `PANEL_SIGNALS`.
- From `./portfolio-api`: `PortfolioPosition`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/planning-context.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildPlanContextEntry, buildPlanningContext, serializePlanningContext } from "./planning-context";
import type { InvestmentPlan, PlanContribution } from "./planning-api";

const now = new Date("2026-06-18T00:00:00Z");

function plan(overrides: Partial<InvestmentPlan> = {}): InvestmentPlan {
  return {
    id: "p1", user_id: "u1", name: "RV Core", asset_name: "MSCI World",
    rule_type: "fixed", amount: 300, percentage: null, frequency: "monthly",
    return_pessimistic: 3, return_base: 7, return_optimistic: 10,
    start_date: "2026-01-01", active: true, notes: null,
    asset_class: "rv_core", multiplier_rules: null, dry_powder: null,
    annual_multiplier: 1, annual_multiplier_year: 2026,
    portfolio_position_id: null, created_at: "2026-01-01", ...overrides,
  };
}

describe("buildPlanContextEntry", () => {
  it("derives quota, multiplier and planned/actual for a fixed DCA plan", () => {
    const contribs: PlanContribution[] = [{
      id: "c1", user_id: "u1", plan_id: "p1", date: "2026-06-01",
      planned_amount: 300, actual_amount: 280, price: null, units: null,
      multiplier: null, signal_note: null, created_at: "2026-06-01",
    }];
    const e = buildPlanContextEntry({
      plan: plan(), signals: {}, positions: [], contributions: contribs,
      monthlyFinancials: [], month: "2026-06", now,
    });
    expect(e.name).toBe("RV Core");
    expect(e.assetClass).toBe("rv_core");
    expect(e.effectiveQuota).toBe(300);
    expect(e.multiplier).toBe(1);
    expect(e.plannedThisMonth).toBe(300);
    expect(e.actualThisMonth).toBe(280);
    expect(e.trigger.fired).toBe(false);
    expect(e.dryPowder).toBeNull();
  });

  it("computes pnl from a linked position", () => {
    const e = buildPlanContextEntry({
      plan: plan({ portfolio_position_id: "pos1" }),
      signals: {},
      positions: [{ id: "pos1", assetName: "X", quantity: 10, avgCost: 100, currentPrice: 110 }],
      contributions: [], monthlyFinancials: [], month: "2026-06", now,
    });
    expect(e.positionValueEur).toBe(1100);
    expect(e.pnlPct).toBeCloseTo(10, 5);
  });
});

describe("buildPlanningContext + serialize", () => {
  it("includes signals freshness and savings", () => {
    const ctx = buildPlanningContext({
      month: "2026-06",
      plans: [plan()],
      signals: { vix: { value: 18.2, date: "2026-06-10", source: "auto" } },
      positions: [],
      contributions: [],
      monthlyFinancials: [],
      routine: [{ label: "Aportar 300 € a RV Core", done: false }],
      savingsAvailableEur: 540,
      portfolioTotalEur: 16000,
      now,
    });
    expect(ctx.plans).toHaveLength(1);
    const vix = ctx.signals.find((s) => s.key === "vix")!;
    expect(vix.value).toBe(18.2);
    expect(vix.stale).toBe(false);
    expect(ctx.savingsAvailableEur).toBe(540);

    const text = serializePlanningContext(ctx);
    expect(text).toContain("2026-06");
    expect(text).toContain("RV Core");
    expect(text).toContain("VIX");
    expect(text).toContain("540");
  });

  it("marks a missing manual signal as no-data and a stale one as stale", () => {
    const ctx = buildPlanningContext({
      month: "2026-06", plans: [], positions: [], contributions: [],
      monthlyFinancials: [], routine: [], savingsAvailableEur: null, portfolioTotalEur: null,
      signals: { btc_mvrv: { value: 2, date: "2026-01-01", source: "manual" } },
      now,
    });
    const mvrv = ctx.signals.find((s) => s.key === "btc_mvrv")!;
    expect(mvrv.stale).toBe(true);
    const insiders = ctx.signals.find((s) => s.key === "insiders_ratio")!;
    expect(insiders.value).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/manidmt/Desktop/wealth-os/wealth-navigator && npx vitest run src/lib/planning-context.test.ts`
Expected: FAIL — module `./planning-context` not found.

- [ ] **Step 3: Implement the module**

Create `src/lib/planning-context.ts`:

```ts
import type { InvestmentPlan, PlanContribution } from "./planning-api";
import type { PortfolioPosition } from "./portfolio-api";
import { formatRule, computePlannedAmount, toEnginePlan, type MonthlyFinancials } from "./planning-calc";
import {
  effectiveQuota,
  currentMultiplier,
  evaluateTrigger,
  isStale,
  type SignalMap,
} from "./strategy-engine";
import { PANEL_SIGNALS } from "./signals-api";

export type PlanContextEntry = {
  name: string;
  assetName: string;
  assetClass: string | null;
  rule: string;
  baseAmount: number;
  multiplier: number;
  effectiveQuota: number;
  trigger: { fired: boolean; blocked: string | null; detail: string };
  dryPowder: { currentEur: number; monthlyFeedEur: number } | null;
  positionValueEur: number | null;
  pnlPct: number | null;
  plannedThisMonth: number;
  actualThisMonth: number | null;
};

export type SignalContextEntry = {
  key: string;
  label: string;
  value: number | null;
  date: string | null;
  stale: boolean;
};

export type PlanningContext = {
  month: string;
  plans: PlanContextEntry[];
  signals: SignalContextEntry[];
  routine: { label: string; done: boolean }[];
  savingsAvailableEur: number | null;
  portfolioTotalEur: number | null;
};

type PositionLike = Pick<PortfolioPosition, "id" | "quantity" | "avgCost" | "currentPrice">;

export function buildPlanContextEntry(input: {
  plan: InvestmentPlan;
  signals: SignalMap;
  positions: PositionLike[];
  contributions: PlanContribution[];
  monthlyFinancials: MonthlyFinancials[];
  month: string;
  now?: Date;
}): PlanContextEntry {
  const { plan, signals, positions, contributions, monthlyFinancials, month, now = new Date() } = input;
  const enginePlan = toEnginePlan(plan);
  const isStrategy = !!plan.asset_class;

  const multiplier = isStrategy ? currentMultiplier(enginePlan, signals) : 1;
  const quota = isStrategy
    ? effectiveQuota(enginePlan, signals)
    : computePlannedAmount(plan, monthlyFinancials, month);

  const tr = evaluateTrigger(plan.multiplier_rules?.trigger, signals, plan.dry_powder?.last_fired_at ?? null, now);

  const linked = plan.portfolio_position_id
    ? positions.find((p) => p.id === plan.portfolio_position_id)
    : undefined;
  let positionValueEur: number | null = null;
  let pnlPct: number | null = null;
  if (linked) {
    const qty = Number(linked.quantity);
    positionValueEur = qty * Number(linked.currentPrice);
    const cost = qty * Number(linked.avgCost);
    pnlPct = cost > 0 ? (positionValueEur / cost - 1) * 100 : 0;
  }

  const monthContrib = contributions.find((c) => c.plan_id === plan.id && c.date.slice(0, 7) === month);

  return {
    name: plan.name,
    assetName: plan.asset_name,
    assetClass: plan.asset_class,
    rule: formatRule(plan),
    baseAmount: Number(plan.amount ?? 0),
    multiplier,
    effectiveQuota: quota,
    trigger: { fired: tr.fired, blocked: tr.blocked, detail: tr.detail },
    dryPowder: plan.dry_powder
      ? { currentEur: Number(plan.dry_powder.current_eur), monthlyFeedEur: Number(plan.dry_powder.monthly_feed_eur) }
      : null,
    positionValueEur,
    pnlPct,
    plannedThisMonth: isStrategy ? quota : computePlannedAmount(plan, monthlyFinancials, month),
    actualThisMonth: monthContrib?.actual_amount ?? null,
  };
}

export function buildPlanningContext(input: {
  month: string;
  plans: InvestmentPlan[];
  signals: SignalMap;
  positions: PositionLike[];
  contributions: PlanContribution[];
  monthlyFinancials: MonthlyFinancials[];
  routine: { label: string; done: boolean }[];
  savingsAvailableEur: number | null;
  portfolioTotalEur: number | null;
  now?: Date;
}): PlanningContext {
  const { plans, signals, positions, contributions, monthlyFinancials, month, now = new Date() } = input;

  const planEntries = plans.map((plan) =>
    buildPlanContextEntry({ plan, signals, positions, contributions, monthlyFinancials, month, now }),
  );

  const signalEntries: SignalContextEntry[] = PANEL_SIGNALS.map(({ key, label }) => {
    const s = signals[key];
    return {
      key,
      label,
      value: s ? s.value : null,
      date: s ? s.date : null,
      stale: s ? isStale(s, now) : false,
    };
  });

  return {
    month,
    plans: planEntries,
    signals: signalEntries,
    routine: input.routine,
    savingsAvailableEur: input.savingsAvailableEur,
    portfolioTotalEur: input.portfolioTotalEur,
  };
}

export function serializePlanningContext(ctx: PlanningContext): string {
  const lines: string[] = [];
  lines.push(`MES: ${ctx.month}`);

  lines.push("", "PLANES:");
  if (ctx.plans.length === 0) {
    lines.push("- (sin planes activos)");
  } else {
    for (const p of ctx.plans) {
      const parts = [
        `${p.name} (${p.assetName})`,
        `regla ${p.rule}`,
        `cuota ${p.effectiveQuota.toFixed(0)} €`,
      ];
      if (p.multiplier !== 1) parts.push(`×${p.multiplier}`);
      if (p.trigger.fired) parts.push(`TRIGGER DISPARADO: ${p.trigger.detail}`);
      else if (p.trigger.blocked) parts.push(`trigger bloqueado (${p.trigger.blocked})`);
      if (p.dryPowder) parts.push(`pólvora ${p.dryPowder.currentEur.toFixed(0)} €`);
      if (p.positionValueEur != null) parts.push(`posición ${p.positionValueEur.toFixed(0)} € (P&L ${p.pnlPct!.toFixed(1)}%)`);
      parts.push(`planificado ${p.plannedThisMonth.toFixed(0)} €`);
      parts.push(`aportado ${p.actualThisMonth != null ? p.actualThisMonth.toFixed(0) + " €" : "sin registrar"}`);
      lines.push(`- ${parts.join(" · ")}`);
    }
  }

  lines.push("", "SEÑALES:");
  for (const s of ctx.signals) {
    const val = s.value != null ? s.value.toString() : "sin dato";
    const flag = s.stale ? " [CADUCADA]" : "";
    lines.push(`- ${s.label}: ${val}${s.date ? ` (${s.date})` : ""}${flag}`);
  }

  lines.push("", "RUTINA DEL MES:");
  if (ctx.routine.length === 0) lines.push("- (sin pasos)");
  else for (const r of ctx.routine) lines.push(`- [${r.done ? "x" : " "}] ${r.label}`);

  lines.push("", `AHORRO DISPONIBLE ESTE MES: ${ctx.savingsAvailableEur != null ? ctx.savingsAvailableEur.toFixed(0) + " €" : "desconocido"}`);
  lines.push(`PATRIMONIO TOTAL: ${ctx.portfolioTotalEur != null ? ctx.portfolioTotalEur.toFixed(0) + " €" : "desconocido"}`);

  return lines.join("\n");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /home/manidmt/Desktop/wealth-os/wealth-navigator && npx vitest run src/lib/planning-context.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/planning-context.ts src/lib/planning-context.test.ts
git commit -m "feat: planning-context module (derive + serialize planning state)"
```

---

## Task 3: Briefing prompt module (pure, TDD)

**Files:**
- Create: `src/lib/briefing-prompt.ts`
- Test: `src/lib/briefing-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/briefing-prompt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildBriefingPrompt } from "./briefing-prompt";

describe("buildBriefingPrompt", () => {
  it("embeds the month and the serialized context", () => {
    const prompt = buildBriefingPrompt("MES: 2026-06\nPLANES:\n- RV Core", "2026-06");
    expect(prompt).toContain("2026-06");
    expect(prompt).toContain("RV Core");
  });

  it("asks for the agreed briefing sections and forbids inventing figures", () => {
    const prompt = buildBriefingPrompt("MES: 2026-06", "2026-06");
    expect(prompt.toLowerCase()).toContain("aportar");
    expect(prompt.toLowerCase()).toContain("señal");
    expect(prompt.toLowerCase()).toContain("desviac");
    expect(prompt.toLowerCase()).toContain("vigilar");
    expect(prompt.toLowerCase()).toContain("no inventes");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/manidmt/Desktop/wealth-os/wealth-navigator && npx vitest run src/lib/briefing-prompt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

Create `src/lib/briefing-prompt.ts`:

```ts
/**
 * Compone el mensaje que se envía al Wealth Agent para generar el briefing
 * mensual de inversión. El contexto serializado se incrusta literalmente; el
 * `context` estructurado se envía aparte por el WS (campo context).
 */
export function buildBriefingPrompt(serializedContext: string, month: string): string {
  return `Genera el briefing mensual de inversión para el mes ${month}.

Estado actual de la planificación (úsalo como única fuente de cifras, junto con tus tools de movimientos y cartera):

${serializedContext}

Devuelve un resumen accionable y conciso en español, con estas secciones (usa encabezados en negrita):
1. **Qué aportar este mes**: cuánto y a qué plan/estrategia, según las cuotas efectivas.
2. **Señales**: si hay algún trigger disparado, indícalo y la acción (p.ej. soltar pólvora); menciona señales caducadas o sin dato relevantes.
3. **Desviaciones**: dónde lo aportado se aleja de lo planificado.
4. **Qué vigilar**: 1-2 cosas a revisar este mes.

Reglas: máximo ~150 palabras, formatea cantidades con € y 0-2 decimales, no inventes cifras que no estén en el contexto o en tus datos.`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /home/manidmt/Desktop/wealth-os/wealth-navigator && npx vitest run src/lib/briefing-prompt.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/briefing-prompt.ts src/lib/briefing-prompt.test.ts
git commit -m "feat: briefing prompt builder"
```

---

## Task 4: WS `context` field (TDD)

**Files:**
- Modify: `src/lib/agent-ws.ts`
- Test: `src/lib/agent-ws.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/agent-ws.test.ts` (mocks a minimal WebSocket to capture the sent payload):

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { openAgentStream } from "./agent-ws";

class FakeWS {
  static last: FakeWS | null = null;
  url: string;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];
  constructor(url: string) { this.url = url; FakeWS.last = this; }
  send(data: string) { this.sent.push(data); }
  close() {}
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeWS as unknown as typeof WebSocket);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const noop = { onToken: () => {}, onDone: () => {}, onError: () => {} };

describe("openAgentStream payload", () => {
  it("includes context when provided", () => {
    openAgentStream("u1", "hola", [], noop, "CTX-BLOCK");
    FakeWS.last!.onopen!();
    const payload = JSON.parse(FakeWS.last!.sent[0]);
    expect(payload.message).toBe("hola");
    expect(payload.context).toBe("CTX-BLOCK");
  });

  it("omits context when not provided", () => {
    openAgentStream("u1", "hola", [], noop);
    FakeWS.last!.onopen!();
    const payload = JSON.parse(FakeWS.last!.sent[0]);
    expect(payload.message).toBe("hola");
    expect("context" in payload).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /home/manidmt/Desktop/wealth-os/wealth-navigator && npx vitest run src/lib/agent-ws.test.ts`
Expected: FAIL — `context` present even when not provided / signature mismatch.

- [ ] **Step 3: Implement**

In `src/lib/agent-ws.ts`, change the `openAgentStream` signature and the `onopen` send. Replace the signature line and the `ws.onopen` block:

```ts
export function openAgentStream(
  userId: string,
  message: string,
  history: AgentMessage[],
  handlers: AgentHandlers,
  context?: string,
): () => void {
```

and

```ts
  ws.onopen = () => {
    const payload: Record<string, unknown> = { message, history };
    if (context !== undefined) payload.context = context;
    ws.send(JSON.stringify(payload));
  };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /home/manidmt/Desktop/wealth-os/wealth-navigator && npx vitest run src/lib/agent-ws.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-ws.ts src/lib/agent-ws.test.ts
git commit -m "feat: optional context field in agent WS stream"
```

---

## Task 5: Briefing table + hooks

**Files:**
- Create: `supabase/migrations/20260618120000_investment_briefings.sql`
- Create: `src/lib/briefing-api.ts`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260618120000_investment_briefings.sql`:

```sql
create table public.investment_briefings (
  user_id uuid not null references auth.users(id) on delete cascade,
  period text not null,                 -- YYYY-MM
  content text not null,
  generated_at timestamptz not null default now(),
  primary key (user_id, period)
);
alter table public.investment_briefings enable row level security;
create policy "own investment briefings" on public.investment_briefings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

- [ ] **Step 2: Apply the migration**

Run: `cd /home/manidmt/Desktop/wealth-os/wealth-navigator && npx supabase db push`
Expected: migration `20260618120000_investment_briefings` applied. If it prompts, confirm. If `supabase` CLI is unavailable, note it and continue (the SQL is committed for later apply).

- [ ] **Step 3: Write the hooks**

Create `src/lib/briefing-api.ts` (mirror the `(supabase as any)` + `useAuth` pattern used in `planning-api.ts`):

```ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type InvestmentBriefing = {
  user_id: string;
  period: string;
  content: string;
  generated_at: string;
};

export function useBriefing(period: string) {
  const { user } = useAuth();
  return useQuery<InvestmentBriefing | null>({
    queryKey: ["investment_briefing", period],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("investment_briefings")
        .select("*")
        .eq("period", period)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    enabled: !!user,
  });
}

export function useSaveBriefing() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { period: string; content: string }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("investment_briefings")
        .upsert(
          { user_id: user!.id, period: input.period, content: input.content, generated_at: new Date().toISOString() },
          { onConflict: "user_id,period" },
        );
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["investment_briefing", vars.period] });
    },
  });
}
```

**Note:** the supabase client import path is `@/integrations/supabase/client` (as in `planning-api.ts`). `useAuth` is `@/hooks/use-auth`.

- [ ] **Step 4: Typecheck**

Run: `cd /home/manidmt/Desktop/wealth-os/wealth-navigator && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260618120000_investment_briefings.sql src/lib/briefing-api.ts
git commit -m "feat: investment_briefings table and hooks"
```

---

## Task 6: Extract shared chat bits

**Files:**
- Create: `src/components/assistant/chat-bits.tsx`
- Modify: `src/routes/assistant.tsx`

Goal: move `Markdownish`, `inline`, `ThinkingDots`, and `Composer` out of `assistant.tsx` into a shared module so the planning chat reuses them. No behavior change.

- [ ] **Step 1: Create the shared module**

Create `src/components/assistant/chat-bits.tsx` and move these four definitions verbatim from `src/routes/assistant.tsx`: `ThinkingDots`, `Markdownish`, `inline`, `Composer`. Export `ThinkingDots`, `Markdownish`, and `Composer` (keep `inline` private to the module). Preserve the imports they need at the top:

```tsx
import { type ReactNode, type RefObject } from "react";
import { ArrowUp, Square } from "lucide-react";
```

(`Composer` uses `ArrowUp`/`Square`; `Markdownish`/`inline` use `ReactNode`; `Composer` uses `RefObject`.)

- [ ] **Step 2: Update `assistant.tsx` to import them**

In `src/routes/assistant.tsx`:
- Remove the local `ThinkingDots`, `Markdownish`, `inline`, `Composer` definitions.
- Add: `import { Markdownish, ThinkingDots, Composer } from "@/components/assistant/chat-bits";`
- Remove now-unused imports from `assistant.tsx` (`ArrowUp`, `Square` if no longer referenced there; keep `Plus` which is still used by the header button). Keep `type ReactNode`/`type RefObject` only if still referenced (they will not be — remove them).

- [ ] **Step 3: Typecheck + build**

Run: `cd /home/manidmt/Desktop/wealth-os/wealth-navigator && npx tsc --noEmit && npx eslint src/routes/assistant.tsx src/components/assistant/chat-bits.tsx`
Expected: no errors, no unused-import warnings.

- [ ] **Step 4: Commit**

```bash
git add src/routes/assistant.tsx src/components/assistant/chat-bits.tsx
git commit -m "refactor: extract shared chat bits from assistant route"
```

---

## Task 7: Compact list — PlanRow + wire into InvestmentPlanning

**Files:**
- Create: `src/components/planning/PlanRow.tsx`
- Modify: `src/components/planning/InvestmentPlanning.tsx`
- Delete: `src/components/planning/StrategyCard.tsx`

`PlanRow` derives display state via `buildPlanContextEntry` (Task 2) for consistency, and reads raw `plan` fields for actions (edit, contribute, fire dry powder).

- [ ] **Step 1: Create `PlanRow.tsx`**

```tsx
import { useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Flame, CalendarCheck } from "lucide-react";
import type { InvestmentPlan } from "@/lib/planning-api";
import { usePlanContributions, useFireDryPowder } from "@/lib/planning-api";
import type { SignalMap } from "@/lib/strategy-engine";
import type { PortfolioPosition } from "@/lib/portfolio-api";
import type { MonthlyFinancials } from "@/lib/planning-calc";
import { buildPlanContextEntry } from "@/lib/planning-context";
import { euro } from "@/lib/dashboard-data";

type PositionLike = Pick<PortfolioPosition, "id" | "quantity" | "avgCost" | "currentPrice">;

export function PlanRow({
  plan,
  signals,
  positions,
  monthlyFinancials,
  month,
  onEdit,
  onContribute,
}: {
  plan: InvestmentPlan;
  signals: SignalMap;
  positions: PositionLike[];
  monthlyFinancials: MonthlyFinancials[];
  month: string;
  onEdit: () => void;
  onContribute: () => void;
}) {
  const [open, setOpen] = useState(false);
  const fire = useFireDryPowder();
  const { data: contributions = [] } = usePlanContributions(plan.id);

  const e = buildPlanContextEntry({ plan, signals, positions, contributions, monthlyFinancials, month });

  const light = e.trigger.fired ? "bg-red-500" : e.trigger.blocked ? "bg-amber-500" : "bg-emerald-500";
  const isStrategy = !!plan.asset_class;
  const canFire = e.trigger.fired && (e.dryPowder?.currentEur ?? 0) > 0;
  const triggerMulti = plan.multiplier_rules?.trigger?.multi;

  return (
    <div className="border-b border-border last:border-0">
      <div className="flex items-center gap-3 py-2.5">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex flex-1 items-center gap-3 text-left">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${light}`} title={e.trigger.detail} />
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{plan.name}</span>
          <span className="hidden shrink-0 text-[12px] text-muted-foreground sm:inline">
            {isStrategy && e.multiplier !== 1
              ? `${e.baseAmount.toFixed(0)}€ ×${e.multiplier}`
              : e.rule}
          </span>
          <span className="shrink-0 tabular-nums text-[13px] font-semibold">
            {plan.rule_type === "event" ? "—" : `${e.effectiveQuota.toFixed(0)} €/mes`}
          </span>
          {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
        </button>
        <button
          type="button"
          onClick={canFire && triggerMulti != null ? () => fire.mutate({ plan, multi: triggerMulti, signalNote: e.trigger.detail }) : onContribute}
          disabled={!plan.active || (canFire && fire.isPending)}
          className={`shrink-0 rounded-md border px-2.5 py-1.5 text-[12px] font-medium transition disabled:opacity-50 ${
            canFire
              ? "border-red-500/40 bg-red-500/10 text-red-600 hover:bg-red-500/20"
              : "border-border bg-background text-foreground/80 hover:border-border-strong"
          }`}
        >
          {canFire ? (<><Flame className="mr-1 inline h-3.5 w-3.5" />Soltar</>) : (<><CalendarCheck className="mr-1 inline h-3.5 w-3.5" />Aportar</>)}
        </button>
      </div>

      {open && (
        <div className="space-y-1.5 pb-3 pl-5.5 pr-2 text-[12px] text-muted-foreground">
          <div className="flex justify-between"><span>Activo</span><span className="text-foreground">{plan.asset_name}</span></div>
          {e.positionValueEur != null && (
            <div className="flex justify-between">
              <span>Posición · P&L</span>
              <span className="text-foreground">
                {euro.format(e.positionValueEur)}{" · "}
                <span className={e.pnlPct! >= 0 ? "text-emerald-600" : "text-red-500"}>{e.pnlPct! >= 0 ? "+" : ""}{e.pnlPct!.toFixed(1)}%</span>
              </span>
            </div>
          )}
          {e.dryPowder && (
            <div className="flex justify-between">
              <span>Pólvora seca</span>
              <span className="text-foreground">{euro.format(e.dryPowder.currentEur)}{e.dryPowder.monthlyFeedEur > 0 ? ` (+${e.dryPowder.monthlyFeedEur.toFixed(0)} €/mes)` : ""}</span>
            </div>
          )}
          <div className="flex justify-between"><span>Planificado · aportado</span><span className="text-foreground">{euro.format(e.plannedThisMonth)}{" · "}{e.actualThisMonth != null ? euro.format(e.actualThisMonth) : "sin registrar"}</span></div>
          <div className="pt-0.5 text-[11px]">{e.trigger.detail}</div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onEdit} className="inline-flex items-center gap-1 text-[12px] text-foreground/70 hover:text-foreground"><Pencil className="h-3.5 w-3.5" />Editar</button>
            <button type="button" onClick={onContribute} className="inline-flex items-center gap-1 text-[12px] text-foreground/70 hover:text-foreground"><CalendarCheck className="h-3.5 w-3.5" />Registrar aportación</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

(`euro` is exported from `src/lib/dashboard-data.ts` — confirm; `useFireDryPowder` signature is `mutate({ plan, multi, signalNote })` per `StrategyCard.tsx`.)

- [ ] **Step 2: Wire into `InvestmentPlanning.tsx`**

In `src/components/planning/InvestmentPlanning.tsx`:
- Add import: `import { PlanRow } from "@/components/planning/PlanRow";`
- Remove import of `StrategyCard`.
- Compute the current month near the top of the `InvestmentPlanning` component:
  ```ts
  const month = new Date().toISOString().slice(0, 7);
  ```
- Replace the `<div className="grid gap-4 ...">…</div>` block inside the "Mis planes" `SectionCard` (the one rendering `strategyPlans.map(StrategyCard)` + `activePlans.filter(!asset_class).map(PlanCard)`) with a single list over active plans:
  ```tsx
  <div className="divide-y-0">
    {activePlans.map((plan) => (
      <PlanRow
        key={plan.id}
        plan={plan}
        signals={signals}
        positions={positions}
        monthlyFinancials={monthlyFinancials}
        month={month}
        onEdit={() => openEdit(plan)}
        onContribute={() => setContributionPlan(plan)}
      />
    ))}
  </div>
  ```
- Delete the now-unused `PlanCard` function definition (lines ~304-389) and the `ContributionHistory` import usage stays (still used below). Remove any now-unused imports (`Pencil`, `CalendarCheck` if only used by `PlanCard`; check — `CalendarCheck` was imported at top and used by `PlanCard`; remove if unused after deletion). Run eslint to catch unused.

- [ ] **Step 3: Delete `StrategyCard.tsx`**

```bash
git rm src/components/planning/StrategyCard.tsx
```

- [ ] **Step 4: Typecheck, lint, build**

Run: `cd /home/manidmt/Desktop/wealth-os/wealth-navigator && npx tsc --noEmit && npx eslint src/components/planning/PlanRow.tsx src/components/planning/InvestmentPlanning.tsx && npm run build`
Expected: builds clean, no unused-import errors.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: compact expandable PlanRow list replaces plan/strategy cards"
```

---

## Task 8: InvestmentAssistant panel (briefing + chat)

**Files:**
- Create: `src/components/planning/InvestmentAssistant.tsx`
- Modify: `src/lib/planning-api.ts` (add `useAllPlanContributions`)
- Modify: `src/components/planning/InvestmentPlanning.tsx` (mount the panel + assemble context inputs)

- [ ] **Step 1: Add `useAllPlanContributions` to `planning-api.ts`**

After `usePlanContributions`, add:

```ts
export function useAllPlanContributions() {
  const { user } = useAuth();
  return useQuery<PlanContribution[]>({
    queryKey: ["plan_contributions", "all"],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("plan_contributions")
        .select("*")
        .order("date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });
}
```

- [ ] **Step 2: Create `InvestmentAssistant.tsx`**

```tsx
import { useState, useRef } from "react";
import { Sparkles, RotateCw, MessageSquare } from "lucide-react";
import { SectionCard } from "@/components/app/SectionCard";
import { Markdownish, ThinkingDots, Composer } from "@/components/assistant/chat-bits";
import { useAuth } from "@/hooks/use-auth";
import { openAgentStream } from "@/lib/agent-ws";
import { buildBriefingPrompt } from "@/lib/briefing-prompt";
import { serializePlanningContext, type PlanningContext } from "@/lib/planning-context";
import { useBriefing, useSaveBriefing } from "@/lib/briefing-api";
import { formatMonth } from "@/lib/dashboard-data";

type Msg = { id: string; role: "user" | "assistant"; content: string; pending?: boolean };

export function InvestmentAssistant({ context, hasPlans }: { context: PlanningContext; hasPlans: boolean }) {
  const { user } = useAuth();
  const month = context.month;
  const serialized = serializePlanningContext(context);

  const { data: briefing } = useBriefing(month);
  const saveBriefing = useSaveBriefing();

  const [streaming, setStreaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const closeRef = useRef<(() => void) | null>(null);

  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const streamIdRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  function generate() {
    if (!user?.id) return;
    setError("");
    setDraft("");
    setStreaming(true);
    let acc = "";
    closeRef.current = openAgentStream(
      user.id,
      buildBriefingPrompt(serialized, month),
      [],
      {
        onToken: (t) => { acc += t; setDraft(acc); },
        onDone: () => { setStreaming(false); if (acc.trim()) saveBriefing.mutate({ period: month, content: acc }); },
        onError: (e) => { setStreaming(false); setError(e); },
      },
      serialized,
    );
  }

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy || !user?.id) return;
    const userMsg: Msg = { id: crypto.randomUUID(), role: "user", content: trimmed };
    const pendingId = crypto.randomUUID();
    setMessages((m) => [...m, userMsg, { id: pendingId, role: "assistant", content: "", pending: true }]);
    setInput("");
    setBusy(true);
    streamIdRef.current = pendingId;
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    let acc = "";
    openAgentStream(
      user.id, trimmed, history,
      {
        onToken: (t) => {
          acc += t;
          setMessages((m) => m.map((msg) => (msg.id === pendingId ? { ...msg, content: acc, pending: false } : msg)));
        },
        onDone: () => setBusy(false),
        onError: (e) => {
          setMessages((m) => m.map((msg) => (msg.id === pendingId ? { ...msg, content: e, pending: false } : msg)));
          setBusy(false);
        },
      },
      serialized,
    );
  }

  const briefingText = streaming || draft ? draft : (briefing?.content ?? "");

  return (
    <SectionCard
      title="Asistente de inversión"
      description={`Briefing y consultas con contexto de tu planificación · ${formatMonth(month)}`}
    >
      <div className="space-y-4">
        <div>
          {briefingText ? (
            <div className="space-y-1.5 text-[13.5px] leading-relaxed">
              <Markdownish text={briefingText} />
            </div>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              {hasPlans ? "Genera el briefing del mes para ver qué toca." : "Crea un plan para generar el briefing."}
            </p>
          )}
          {error && <p className="mt-2 text-[12px] text-red-500">{error}</p>}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={generate}
              disabled={streaming || !hasPlans}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-[12.5px] font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              {briefing || draft ? <RotateCw className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
              {streaming ? "Generando…" : briefing || draft ? "Regenerar" : `Generar briefing de ${formatMonth(month)}`}
            </button>
            {briefing && !streaming && (
              <span className="text-[11px] text-muted-foreground">
                Actualizado {new Date(briefing.generated_at).toLocaleDateString("es-ES")}
              </span>
            )}
          </div>
        </div>

        <div className="border-t border-border pt-3">
          <button
            type="button"
            onClick={() => setChatOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-foreground/80 hover:text-foreground"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            {chatOpen ? "Ocultar chat" : "Preguntar al agente"}
          </button>
          {chatOpen && (
            <div className="mt-3 rounded-lg border border-border">
              <div className="max-h-72 space-y-4 overflow-y-auto px-4 py-3">
                {messages.length === 0 ? (
                  <p className="text-[12.5px] text-muted-foreground">Pregunta sobre tus planes, señales o cuánto aportar.</p>
                ) : (
                  messages.map((m) =>
                    m.role === "user" ? (
                      <div key={m.id} className="flex justify-end">
                        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-[13px] text-primary-foreground">{m.content}</div>
                      </div>
                    ) : (
                      <div key={m.id} className="text-[13px] leading-relaxed">
                        {m.pending ? <ThinkingDots /> : <Markdownish text={m.content} />}
                      </div>
                    ),
                  )
                )}
              </div>
              <Composer value={input} onChange={setInput} onSubmit={() => send(input)} busy={busy} connected={!!user?.id} inputRef={inputRef} />
            </div>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
```

(`SectionCard` props `title`/`description` match its existing usage; `Composer` prop shape matches `chat-bits.tsx` from Task 6.)

- [ ] **Step 3: Assemble context + mount in `InvestmentPlanning.tsx`**

In `src/components/planning/InvestmentPlanning.tsx`:
- Imports:
  ```ts
  import { InvestmentAssistant } from "@/components/planning/InvestmentAssistant";
  import { buildPlanningContext } from "@/lib/planning-context";
  import { useAllPlanContributions, useRoutineLog } from "@/lib/planning-api";
  import { effectiveQuota } from "@/lib/strategy-engine";
  ```
  (Some may already be imported — merge, don't duplicate. `effectiveQuota` is used for routine labels below.)
- Inside the component (after existing hooks), add:
  ```ts
  const { data: allContributions = [] } = useAllPlanContributions();
  const period = new Date().toISOString().slice(0, 7);
  const { data: routineLog } = useRoutineLog(period);

  const currentMonthFin = monthlyFinancials.find((m) => m.month === month);
  const savingsAvailableEur = currentMonthFin ? currentMonthFin.income - currentMonthFin.expense : null;
  const portfolioTotalEur = positions.reduce((s, p) => s + Number(p.quantity) * Number(p.currentPrice), 0) || null;

  const routine = strategyPlans
    .filter((p) => p.active)
    .map((p) => {
      const label = `Aportar ${effectiveQuota({ amount: p.amount == null ? null : Number(p.amount), multiplier_rules: p.multiplier_rules, annual_multiplier: Number(p.annual_multiplier ?? 1), annual_multiplier_year: p.annual_multiplier_year == null ? null : Number(p.annual_multiplier_year) }, signals).toFixed(0)} € a ${p.name}`;
      const saved = (routineLog?.items ?? []).find((i) => i.key === `buy-${p.id}`);
      return { label, done: saved?.done ?? false };
    });

  const planningContext = buildPlanningContext({
    month,
    plans: activePlans,
    signals,
    positions,
    contributions: allContributions,
    monthlyFinancials,
    routine,
    savingsAvailableEur,
    portfolioTotalEur,
  });
  ```
  (Reuse `toEnginePlan` instead of the inline object if it's already imported — prefer `toEnginePlan(p)`. If not imported, `import { toEnginePlan } from "@/lib/planning-calc";` and use `effectiveQuota(toEnginePlan(p), signals)`.)
- Mount the panel as the first child inside the top `<div className="mx-auto w-full max-w-6xl space-y-6 ...">`, before the "Nuevo plan" button row (or right after it):
  ```tsx
  <InvestmentAssistant context={planningContext} hasPlans={activePlans.length > 0} />
  ```

- [ ] **Step 4: Typecheck, lint, build**

Run: `cd /home/manidmt/Desktop/wealth-os/wealth-navigator && npx tsc --noEmit && npx eslint src/components/planning/InvestmentAssistant.tsx src/components/planning/InvestmentPlanning.tsx src/lib/planning-api.ts && npm run build`
Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: investment assistant panel with monthly briefing and contextual chat"
```

---

## Task 9: Python agent — accept and inject context

**Files:**
- Modify: `wealth-agent/app/routers/chat.py`
- Modify: `wealth-agent/app/services/agent_service.py`

- [ ] **Step 1: Read `context` in the WS handler**

In `wealth-agent/app/routers/chat.py`, inside the `while True` loop after parsing `history`, add `context` and pass it through:

```python
            message = data.get("message", "")
            history = [ChatMessage(**m) for m in data.get("history", [])]
            context = data.get("context")

            if not message:
                await websocket.send_text(json.dumps({"error": "Mensaje vacío"}))
                continue

            async for token in run_agent_stream(user_id, message, history, context):
                await websocket.send_text(json.dumps({"token": token}))
```

- [ ] **Step 2: Accept and inject `context` in `agent_service.py`**

In `wealth-agent/app/services/agent_service.py`, change the signature and inject a planning-context system block when present:

```python
async def run_agent_stream(user_id, message, history, context=None):
    _, df_movements_recent, df_portfolio = load_user_data(user_id)
    system_prompt = build_system_prompt(df_movements_recent)

    system_messages = [{"role": "system", "content": system_prompt}]
    if context:
        system_messages.append({
            "role": "system",
            "content": (
                "ESTADO DE PLANIFICACIÓN DE INVERSIÓN DEL USUARIO (fuente fiable, "
                "ya calculada por la app). Úsalo junto con tus tools. Sobre este "
                "estado SÍ puedes razonar de forma accionable (qué aportar este mes, "
                "qué señal se ha disparado, desviaciones), pero no inventes cifras "
                "que no estén aquí ni en tus datos:\n\n" + context
            ),
        })

    messages = [{"role": m.role, "content": m.content} for m in history]
    messages.append({"role": "user", "content": message})

    for _ in range(5):
        response = await client.chat.completions.create(
            model=MODEL,
            messages=system_messages + messages,
            tools=TOOLS_SCHEMA,
            tool_choice="auto",
            temperature=0.1,
            max_completion_tokens=1024,
        )

        msg = response.choices[0].message

        if not msg.tool_calls:
            stream = await client.chat.completions.create(
                model=MODEL,
                messages=system_messages + messages,
                temperature=0.1,
                max_completion_tokens=1024,
                stream=True,
            )
            async for chunk in stream:
                token = chunk.choices[0].delta.content
                if token:
                    yield token
            return

        messages.append(msg)
        for tool_call in msg.tool_calls:
            tool_name = tool_call.function.name
            tool_args = json.loads(tool_call.function.arguments)
            result = dispatch_tool(tool_name, tool_args, df_movements_recent, df_portfolio)
            messages.append({"role": "tool", "tool_call_id": tool_call.id, "content": result})

    yield "No se pudo resolver la consulta en el número máximo de iteraciones."
```

The only changes vs the original are: the `context=None` parameter, the `system_messages` list (built once, with the optional planning block), and replacing the two `[{"role": "system", "content": system_prompt}] + messages` occurrences with `system_messages + messages`.

- [ ] **Step 3: Restart the agent and smoke-test**

```bash
systemctl --user restart wealth-agent
sleep 2
systemctl --user status wealth-agent --no-pager | head -5
```
Expected: `active (running)`. Then manually verify in the app: open the investment tab, click "Generar briefing", confirm a contextual response streams in and references your plans.

- [ ] **Step 4: Commit**

The whole monorepo (`wealth-navigator/` + `wealth-agent/`) is a **single git repo** rooted at `/home/manidmt/Desktop/wealth-os` (the agent is NOT a nested repo; it was vendored via subtree). All work is on branch `feature/investment-planning-intelligence`. Commit the agent files by their monorepo-relative paths:

```bash
cd /home/manidmt/Desktop/wealth-os
git add wealth-agent/app/routers/chat.py wealth-agent/app/services/agent_service.py
git commit -m "feat: accept planning context over WS and inject into prompt"
```

---

## Final verification

- [ ] `cd /home/manidmt/Desktop/wealth-os/wealth-navigator && npm run test` — all Vitest suites pass (planning-context, briefing-prompt, agent-ws + existing).
- [ ] `npx tsc --noEmit` — no type errors.
- [ ] `npm run build` — clean production build.
- [ ] Manual: investment tab shows the assistant panel on top, "Mis planes" as a compact expandable list, briefing generates and caches (reload → still there), follow-up chat answers with planning context, and the contribution modal saves with empty price/multiplier.
- [ ] Deploy: `npm run build && systemctl --user restart wealth-navigator`.

---

## Self-Review notes

- **Spec coverage:** §1 list → Task 7; §2 planning-context → Task 2; §3 WS context → Task 4 (+9); §4 briefing panel → Task 8; §5 chat reuse → Task 6 (+8); §6 fix → Task 1; persistence → Task 5; Python → Task 9. All covered.
- **Type consistency:** `buildPlanContextEntry`/`buildPlanningContext`/`serializePlanningContext` signatures and `PlanContextEntry`/`PlanningContext`/`SignalContextEntry` fields are identical between Task 2 (definition) and Tasks 7/8 (consumers). `openAgentStream(userId, message, history, handlers, context?)` is consistent in Tasks 4 and 8. `useSaveBriefing` takes `{ period, content }` in Tasks 5 and 8.
