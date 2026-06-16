# Planificación de Inversión (DCA) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir la ruta `/planning` con gestión de planes DCA, seguimiento real vs planificado y proyecciones a 5/10/20 años con escenarios pesimista/base/optimista.

**Architecture:** Supabase para persistencia (dos tablas nuevas con RLS), toda la lógica de cálculo en TypeScript cliente. Nueva ruta TanStack Router `/planning` con modales inline para crear/editar planes y registrar aportaciones.

**Tech Stack:** TanStack Router, React Query, Supabase JS client, Recharts, Radix UI Dialog, react-hook-form, Zod, Lucide icons.

---

## File Map

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `src/lib/planning-api.ts` | Crear | Tipos TS + hooks React Query para investment_plans y plan_contributions |
| `src/lib/planning-calc.ts` | Crear | Funciones puras: importe planificado, proyección compound interest |
| `src/routes/planning.tsx` | Crear | Página completa: PlanCards, modales, ProjectionChart, HistoryTable |
| `src/components/app/AppSidebar.tsx` | Modificar | Añadir `/planning` al array de navItems |

**Supabase:** El usuario debe ejecutar el SQL de la Tarea 1 via Lovable o Supabase dashboard.

---

### Task 1: Supabase — Crear tablas y RLS

**Files:**
- No code file — SQL script para ejecutar manualmente

- [ ] **Step 1: Ejecutar este SQL en Supabase (via Lovable SQL editor o dashboard)**

```sql
-- Tabla de planes de inversión
create table if not exists investment_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  asset_name text not null,
  rule_type text not null check (rule_type in ('fixed', 'pct_income', 'pct_savings', 'event')),
  amount numeric,
  percentage numeric,
  frequency text not null default 'monthly' check (frequency in ('monthly', 'quarterly')),
  return_pessimistic numeric not null default 3,
  return_base numeric not null default 7,
  return_optimistic numeric not null default 10,
  start_date date not null,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

alter table investment_plans enable row level security;

create policy "Users see own plans"
  on investment_plans for select using (auth.uid() = user_id);
create policy "Users insert own plans"
  on investment_plans for insert with check (auth.uid() = user_id);
create policy "Users update own plans"
  on investment_plans for update using (auth.uid() = user_id);
create policy "Users delete own plans"
  on investment_plans for delete using (auth.uid() = user_id);

-- Tabla de aportaciones reales por mes
create table if not exists plan_contributions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references investment_plans(id) on delete cascade,
  date date not null,
  planned_amount numeric not null,
  actual_amount numeric,
  created_at timestamptz not null default now(),
  unique(plan_id, date)
);

alter table plan_contributions enable row level security;

create policy "Users see own contributions"
  on plan_contributions for select using (auth.uid() = user_id);
create policy "Users insert own contributions"
  on plan_contributions for insert with check (auth.uid() = user_id);
create policy "Users update own contributions"
  on plan_contributions for update using (auth.uid() = user_id);
create policy "Users delete own contributions"
  on plan_contributions for delete using (auth.uid() = user_id);
```

- [ ] **Step 2: Verificar que las tablas existen**

En Supabase Table Editor, comprobar que aparecen `investment_plans` y `plan_contributions`.

---

### Task 2: `src/lib/planning-api.ts` — Tipos y hooks Supabase

**Files:**
- Create: `src/lib/planning-api.ts`

- [ ] **Step 1: Crear el archivo con tipos y hooks**

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type RuleType = "fixed" | "pct_income" | "pct_savings" | "event";
export type Frequency = "monthly" | "quarterly";

export type InvestmentPlan = {
  id: string;
  user_id: string;
  name: string;
  asset_name: string;
  rule_type: RuleType;
  amount: number | null;
  percentage: number | null;
  frequency: Frequency;
  return_pessimistic: number;
  return_base: number;
  return_optimistic: number;
  start_date: string;
  active: boolean;
  notes: string | null;
  created_at: string;
};

export type PlanContribution = {
  id: string;
  user_id: string;
  plan_id: string;
  date: string;
  planned_amount: number;
  actual_amount: number | null;
  created_at: string;
};

export type CreatePlanInput = Omit<InvestmentPlan, "id" | "user_id" | "created_at">;
export type UpdatePlanInput = Partial<CreatePlanInput> & { id: string };

// ── Plans ──────────────────────────────────────────────────────────────────

export function useInvestmentPlans() {
  const { user } = useAuth();
  return useQuery<InvestmentPlan[]>({
    queryKey: ["investment_plans", user?.id],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("investment_plans")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });
}

export function useCreatePlan() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreatePlanInput) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("investment_plans")
        .insert({ ...input, user_id: user!.id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["investment_plans"] }),
  });
}

export function useUpdatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...rest }: UpdatePlanInput) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("investment_plans")
        .update(rest)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["investment_plans"] }),
  });
}

export function useDeletePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("investment_plans")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["investment_plans"] }),
  });
}

// ── Contributions ──────────────────────────────────────────────────────────

export function usePlanContributions(planId: string | null) {
  const { user } = useAuth();
  return useQuery<PlanContribution[]>({
    queryKey: ["plan_contributions", planId],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("plan_contributions")
        .select("*")
        .eq("plan_id", planId)
        .order("date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user && !!planId,
  });
}

export function useUpsertContribution() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      plan_id: string;
      date: string;
      planned_amount: number;
      actual_amount: number;
    }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("plan_contributions")
        .upsert({ ...input, user_id: user!.id }, { onConflict: "plan_id,date" });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["plan_contributions", vars.plan_id] });
    },
  });
}
```

- [ ] **Step 2: Verificar que el archivo no tiene errores de TypeScript**

```bash
cd /home/manidmt/.openclaw/workspace/projects/wealth-os/wealth-navigator
npx tsc --noEmit 2>&1 | grep planning-api
```

Esperado: sin output (sin errores).

- [ ] **Step 3: Commit**

```bash
git add src/lib/planning-api.ts
git commit -m "feat: add planning-api hooks for investment_plans and plan_contributions"
```

---

### Task 3: `src/lib/planning-calc.ts` — Lógica de cálculo pura

**Files:**
- Create: `src/lib/planning-calc.ts`

- [ ] **Step 1: Crear el archivo**

```typescript
import type { InvestmentPlan } from "./planning-api";

export type MonthlyFinancials = {
  month: string; // "YYYY-MM"
  income: number;
  expense: number;
};

/**
 * Calcula el importe planificado para un mes dado según la regla del plan.
 * Para pct_income / pct_savings usa los financials del mismo mes si existen,
 * si no, usa la media de los disponibles (estimación para proyección).
 */
export function computePlannedAmount(
  plan: InvestmentPlan,
  monthlyFinancials: MonthlyFinancials[],
  targetMonth?: string,
): number {
  if (plan.rule_type === "fixed") {
    return plan.amount ?? 0;
  }

  if (plan.rule_type === "event") {
    return 0; // el usuario introduce el importe al registrar manualmente
  }

  const relevant = targetMonth
    ? monthlyFinancials.filter((m) => m.month === targetMonth)
    : monthlyFinancials.slice(-6);

  const avg =
    relevant.length === 0
      ? { income: 0, savings: 0 }
      : {
          income: relevant.reduce((s, m) => s + m.income, 0) / relevant.length,
          savings:
            relevant.reduce((s, m) => s + (m.income - m.expense), 0) /
            relevant.length,
        };

  const pct = (plan.percentage ?? 0) / 100;

  if (plan.rule_type === "pct_income") {
    const base = targetMonth
      ? (relevant[0]?.income ?? avg.income)
      : avg.income;
    return base * pct;
  }

  // pct_savings
  const base = targetMonth
    ? (relevant[0]
        ? relevant[0].income - relevant[0].expense
        : avg.savings)
    : avg.savings;
  return Math.max(0, base * pct);
}

export type ProjectionPoint = {
  month: string; // "YYYY-MM"
  pessimistic: number;
  base: number;
  optimistic: number;
};

/**
 * Proyecta el crecimiento del portfolio durante `horizonYears` años
 * a partir de hoy, asumiendo aportación mensual constante (estimada).
 */
export function computeProjection(
  plan: InvestmentPlan,
  monthlyFinancials: MonthlyFinancials[],
  horizonYears: number,
): ProjectionPoint[] {
  const monthlyContribution =
    plan.rule_type === "fixed"
      ? (plan.frequency === "quarterly" ? (plan.amount ?? 0) / 3 : (plan.amount ?? 0))
      : computePlannedAmount(plan, monthlyFinancials);

  const rates = {
    pessimistic: plan.return_pessimistic / 100 / 12,
    base: plan.return_base / 100 / 12,
    optimistic: plan.return_optimistic / 100 / 12,
  };

  const totalMonths = horizonYears * 12;
  const points: ProjectionPoint[] = [];

  let vPess = 0;
  let vBase = 0;
  let vOpt = 0;

  const now = new Date();

  for (let i = 0; i <= totalMonths; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

    points.push({
      month,
      pessimistic: Math.round(vPess),
      base: Math.round(vBase),
      optimistic: Math.round(vOpt),
    });

    vPess = vPess * (1 + rates.pessimistic) + monthlyContribution;
    vBase = vBase * (1 + rates.base) + monthlyContribution;
    vOpt = vOpt * (1 + rates.optimistic) + monthlyContribution;
  }

  return points;
}

/** Formatea una regla de plan para mostrar en la UI */
export function formatRule(plan: InvestmentPlan): string {
  const freq = plan.frequency === "quarterly" ? "/trimestre" : "/mes";
  if (plan.rule_type === "fixed") return `${plan.amount?.toFixed(0)} €${freq}`;
  if (plan.rule_type === "pct_income") return `${plan.percentage}% ingresos${freq}`;
  if (plan.rule_type === "pct_savings") return `${plan.percentage}% ahorro${freq}`;
  return "A demanda (evento)";
}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
cd /home/manidmt/.openclaw/workspace/projects/wealth-os/wealth-navigator
npx tsc --noEmit 2>&1 | grep planning-calc
```

Esperado: sin output.

- [ ] **Step 3: Commit**

```bash
git add src/lib/planning-calc.ts
git commit -m "feat: add planning calculation functions (planned amount + projection)"
```

---

### Task 4: `src/routes/planning.tsx` — Página completa

**Files:**
- Create: `src/routes/planning.tsx`

- [ ] **Step 1: Crear la ruta con toda la UI**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { Plus, Pencil, TrendingUp, CalendarCheck } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";
import { AppShell } from "@/components/app/AppShell";
import { PageHeader, SectionCard } from "@/components/app/SectionCard";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  useInvestmentPlans,
  useCreatePlan,
  useUpdatePlan,
  useDeletePlan,
  usePlanContributions,
  useUpsertContribution,
  type InvestmentPlan,
  type RuleType,
  type Frequency,
} from "@/lib/planning-api";
import {
  computePlannedAmount,
  computeProjection,
  formatRule,
  type MonthlyFinancials,
} from "@/lib/planning-calc";
import { useDashboard } from "@/hooks/use-dashboard";
import { formatMonth, euro } from "@/lib/dashboard-data";

export const Route = createFileRoute("/planning")({
  head: () => ({
    meta: [
      { title: "Planificación — Wealth Studio" },
      {
        name: "description",
        content: "Planes de inversión DCA, seguimiento de aportaciones y proyecciones a largo plazo.",
      },
    ],
  }),
  component: PlanningPage,
});

// ── Schemas ────────────────────────────────────────────────────────────────

const planSchema = z.object({
  name: z.string().min(1, "Requerido"),
  asset_name: z.string().min(1, "Requerido"),
  rule_type: z.enum(["fixed", "pct_income", "pct_savings", "event"]),
  amount: z.coerce.number().nullable(),
  percentage: z.coerce.number().nullable(),
  frequency: z.enum(["monthly", "quarterly"]),
  return_pessimistic: z.coerce.number().min(0).max(50),
  return_base: z.coerce.number().min(0).max(50),
  return_optimistic: z.coerce.number().min(0).max(50),
  start_date: z.string().min(1, "Requerido"),
  active: z.boolean(),
  notes: z.string().nullable(),
});

type PlanForm = z.infer<typeof planSchema>;

const contributionSchema = z.object({
  date: z.string().min(1, "Requerido"),
  actual_amount: z.coerce.number().min(0),
});

type ContributionForm = z.infer<typeof contributionSchema>;

// ── Page ───────────────────────────────────────────────────────────────────

function PlanningPage() {
  const { data: plans = [], isLoading } = useInvestmentPlans();
  const dashboard = useDashboard();

  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<InvestmentPlan | null>(null);
  const [contributionPlan, setContributionPlan] = useState<InvestmentPlan | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [horizon, setHorizon] = useState<5 | 10 | 20>(10);

  const monthlyFinancials: MonthlyFinancials[] = useMemo(
    () =>
      dashboard.expenses.byMonth.map((m) => ({
        month: m.month,
        income: m.incomeTotal,
        expense: m.expenseTotal,
      })),
    [dashboard.expenses.byMonth],
  );

  const activePlans = plans.filter((p) => p.active);
  const projectionPlan =
    plans.find((p) => p.id === selectedPlanId) ?? activePlans[0] ?? null;

  const projectionData = useMemo(() => {
    if (!projectionPlan) return [];
    const points = computeProjection(projectionPlan, monthlyFinancials, horizon);
    // Sample every 6 months for readability
    return points.filter((_, i) => i % 6 === 0);
  }, [projectionPlan, monthlyFinancials, horizon]);

  function openCreate() {
    setEditingPlan(null);
    setPlanModalOpen(true);
  }

  function openEdit(plan: InvestmentPlan) {
    setEditingPlan(plan);
    setPlanModalOpen(true);
  }

  return (
    <AppShell pageEyebrow="Planificación">
      <PageHeader
        eyebrow="Inversión"
        title="Planificación"
        description="Define tus estrategias DCA, registra aportaciones y proyecta el crecimiento de tu cartera."
        actions={
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-[13px] font-medium text-foreground/80 transition hover:border-border-strong hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            Nuevo plan
          </button>
        }
      />

      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 md:px-8">
        {/* Mis planes */}
        <SectionCard
          title="Mis planes"
          description={isLoading ? "Cargando…" : activePlans.length === 0 ? "No tienes planes activos aún." : undefined}
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {activePlans.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                monthlyFinancials={monthlyFinancials}
                onEdit={() => openEdit(plan)}
                onContribute={() => setContributionPlan(plan)}
              />
            ))}
          </div>
        </SectionCard>

        {/* Proyección */}
        {projectionPlan && (
          <SectionCard title="Proyección">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              {activePlans.length > 1 && (
                <Select
                  value={projectionPlan.id}
                  onValueChange={setSelectedPlanId}
                >
                  <SelectTrigger className="w-[200px] text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {activePlans.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <div className="flex rounded-md border border-border text-[12px]">
                {([5, 10, 20] as const).map((y) => (
                  <button
                    key={y}
                    type="button"
                    onClick={() => setHorizon(y)}
                    className={`px-3 py-1.5 transition first:rounded-l-md last:rounded-r-md ${
                      horizon === y
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {y} años
                  </button>
                ))}
              </div>
            </div>
            <div className="text-[11px] text-muted-foreground mb-2">
              {projectionPlan.name} · {formatRule(projectionPlan)} ·
              Rentabilidades: {projectionPlan.return_pessimistic}% / {projectionPlan.return_base}% / {projectionPlan.return_optimistic}%
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={projectionData}>
                <XAxis
                  dataKey="month"
                  tickFormatter={(v: string) => v.slice(0, 4)}
                  tick={{ fontSize: 11 }}
                  interval={Math.floor(projectionData.length / 5)}
                />
                <YAxis
                  tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k€`}
                  tick={{ fontSize: 11 }}
                  width={55}
                />
                <Tooltip
                  formatter={(v: number) => euro.format(v)}
                  labelFormatter={(l: string) => formatMonth(l)}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line
                  type="monotone"
                  dataKey="pessimistic"
                  name="Pesimista"
                  stroke="#94a3b8"
                  dot={false}
                  strokeWidth={1.5}
                />
                <Line
                  type="monotone"
                  dataKey="base"
                  name="Base"
                  stroke="#3b82f6"
                  dot={false}
                  strokeWidth={2}
                />
                <Line
                  type="monotone"
                  dataKey="optimistic"
                  name="Optimista"
                  stroke="#10b981"
                  dot={false}
                  strokeWidth={1.5}
                />
              </LineChart>
            </ResponsiveContainer>
          </SectionCard>
        )}

        {/* Historial — primer plan activo si no hay selección */}
        {projectionPlan && (
          <ContributionHistory plan={projectionPlan} monthlyFinancials={monthlyFinancials} />
        )}
      </div>

      {/* Modales */}
      <PlanModal
        open={planModalOpen}
        onClose={() => setPlanModalOpen(false)}
        editing={editingPlan}
      />
      {contributionPlan && (
        <ContributionModal
          open={!!contributionPlan}
          onClose={() => setContributionPlan(null)}
          plan={contributionPlan}
          monthlyFinancials={monthlyFinancials}
        />
      )}
    </AppShell>
  );
}

// ── PlanCard ───────────────────────────────────────────────────────────────

function PlanCard({
  plan,
  monthlyFinancials,
  onEdit,
  onContribute,
}: {
  plan: InvestmentPlan;
  monthlyFinancials: MonthlyFinancials[];
  onEdit: () => void;
  onContribute: () => void;
}) {
  const { data: contributions = [] } = usePlanContributions(plan.id);

  const currentMonth = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();

  const currentContrib = contributions.find(
    (c) => c.date.slice(0, 7) === currentMonth,
  );

  const planned = computePlannedAmount(plan, monthlyFinancials, currentMonth);
  const actual = currentContrib?.actual_amount ?? null;
  const deviation = actual !== null ? actual - planned : null;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-semibold tracking-tight">
            {plan.name}
          </div>
          <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
            {plan.asset_name}
          </div>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-3 rounded-md bg-muted/40 px-3 py-2 text-[12px]">
        <div className="text-muted-foreground">Regla</div>
        <div className="font-medium text-foreground">{formatRule(plan)}</div>
      </div>

      <div className="mt-3 space-y-1 text-[12px]">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Planificado este mes</span>
          <span className="font-medium">{plan.rule_type === "event" ? "—" : euro.format(planned)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Aportado</span>
          <span className={`font-medium ${actual === null ? "text-muted-foreground" : ""}`}>
            {actual !== null ? euro.format(actual) : "Sin registrar"}
          </span>
        </div>
        {deviation !== null && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Desviación</span>
            <span
              className={`font-medium ${deviation >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}
            >
              {deviation >= 0 ? "+" : ""}
              {euro.format(deviation)}
            </span>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onContribute}
        className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 py-2 text-[12px] font-medium text-foreground/80 transition hover:border-border-strong hover:text-foreground"
      >
        <CalendarCheck className="h-3.5 w-3.5" />
        Registrar aportación
      </button>
    </div>
  );
}

// ── ContributionHistory ────────────────────────────────────────────────────

function ContributionHistory({
  plan,
  monthlyFinancials,
}: {
  plan: InvestmentPlan;
  monthlyFinancials: MonthlyFinancials[];
}) {
  const { data: contributions = [] } = usePlanContributions(plan.id);

  return (
    <SectionCard
      title={`Historial — ${plan.name}`}
      description="Aportaciones planificadas vs reales por mes."
    >
      {contributions.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Sin aportaciones registradas aún.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">Mes</th>
                <th className="pb-2 pr-4 font-medium text-right">Planificado</th>
                <th className="pb-2 pr-4 font-medium text-right">Real</th>
                <th className="pb-2 font-medium text-right">Desviación</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {contributions.map((c) => {
                const dev =
                  c.actual_amount !== null ? c.actual_amount - c.planned_amount : null;
                return (
                  <tr key={c.id}>
                    <td className="py-2 pr-4">{formatMonth(c.date.slice(0, 7))}</td>
                    <td className="py-2 pr-4 text-right">{euro.format(c.planned_amount)}</td>
                    <td className="py-2 pr-4 text-right">
                      {c.actual_amount !== null ? euro.format(c.actual_amount) : "—"}
                    </td>
                    <td className="py-2 text-right">
                      {dev !== null ? (
                        <span
                          className={dev >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}
                        >
                          {dev >= 0 ? "+" : ""}
                          {euro.format(dev)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

// ── PlanModal ──────────────────────────────────────────────────────────────

function PlanModal({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing: InvestmentPlan | null;
}) {
  const createPlan = useCreatePlan();
  const updatePlan = useUpdatePlan();
  const deletePlan = useDeletePlan();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PlanForm>({
    resolver: zodResolver(planSchema),
    defaultValues: editing ?? {
      name: "",
      asset_name: "",
      rule_type: "fixed",
      amount: 300,
      percentage: null,
      frequency: "monthly",
      return_pessimistic: 3,
      return_base: 7,
      return_optimistic: 10,
      start_date: new Date().toISOString().slice(0, 10),
      active: true,
      notes: null,
    },
  });

  const ruleType = watch("rule_type");

  async function onSubmit(values: PlanForm) {
    if (editing) {
      await updatePlan.mutateAsync({ id: editing.id, ...values });
    } else {
      await createPlan.mutateAsync(values);
    }
    reset();
    onClose();
  }

  async function handleDelete() {
    if (!editing) return;
    await deletePlan.mutateAsync(editing.id);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-[15px]">
            {editing ? "Editar plan" : "Nuevo plan de inversión"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-[12px]">Nombre del plan</Label>
              <Input {...register("name")} placeholder="DCA MSCI World" className="text-[13px]" />
              {errors.name && <p className="text-[11px] text-red-500">{errors.name.message}</p>}
            </div>
            <div className="space-y-1">
              <Label className="text-[12px]">Activo destino</Label>
              <Input {...register("asset_name")} placeholder="Amundi MSCI World ETF" className="text-[13px]" />
              {errors.asset_name && <p className="text-[11px] text-red-500">{errors.asset_name.message}</p>}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-[12px]">Tipo de regla</Label>
              <Select
                value={ruleType}
                onValueChange={(v) => setValue("rule_type", v as RuleType)}
              >
                <SelectTrigger className="text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">Importe fijo</SelectItem>
                  <SelectItem value="pct_income">% de ingresos</SelectItem>
                  <SelectItem value="pct_savings">% del ahorro</SelectItem>
                  <SelectItem value="event">A demanda (evento)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[12px]">Frecuencia</Label>
              <Select
                defaultValue={editing?.frequency ?? "monthly"}
                onValueChange={(v) => setValue("frequency", v as Frequency)}
              >
                <SelectTrigger className="text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Mensual</SelectItem>
                  <SelectItem value="quarterly">Trimestral</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {(ruleType === "fixed") && (
            <div className="space-y-1">
              <Label className="text-[12px]">Importe (€)</Label>
              <Input type="number" {...register("amount")} className="text-[13px]" />
            </div>
          )}

          {(ruleType === "pct_income" || ruleType === "pct_savings") && (
            <div className="space-y-1">
              <Label className="text-[12px]">Porcentaje (%)</Label>
              <Input type="number" step="0.1" {...register("percentage")} className="text-[13px]" />
            </div>
          )}

          <div>
            <Label className="text-[12px] mb-2 block">Rentabilidad anual esperada (%)</Label>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Pesimista</Label>
                <Input type="number" step="0.5" {...register("return_pessimistic")} className="text-[13px]" />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Base</Label>
                <Input type="number" step="0.5" {...register("return_base")} className="text-[13px]" />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Optimista</Label>
                <Input type="number" step="0.5" {...register("return_optimistic")} className="text-[13px]" />
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-[12px]">Fecha de inicio</Label>
            <Input type="date" {...register("start_date")} className="text-[13px]" />
          </div>

          <div className="space-y-1">
            <Label className="text-[12px]">Notas (opcional)</Label>
            <Textarea {...register("notes")} rows={2} className="text-[13px] resize-none" />
          </div>

          <DialogFooter className="gap-2 pt-2">
            {editing && (
              <button
                type="button"
                onClick={handleDelete}
                className="mr-auto text-[12px] text-red-500 hover:text-red-600"
              >
                Eliminar plan
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-[12.5px] hover:bg-muted"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-primary px-4 py-2 text-[12.5px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {editing ? "Guardar cambios" : "Crear plan"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── ContributionModal ──────────────────────────────────────────────────────

function ContributionModal({
  open,
  onClose,
  plan,
  monthlyFinancials,
}: {
  open: boolean;
  onClose: () => void;
  plan: InvestmentPlan;
  monthlyFinancials: MonthlyFinancials[];
}) {
  const upsert = useUpsertContribution();

  const {
    register,
    handleSubmit,
    watch,
    formState: { isSubmitting },
  } = useForm<ContributionForm>({
    resolver: zodResolver(contributionSchema),
    defaultValues: {
      date: new Date().toISOString().slice(0, 7) + "-01",
      actual_amount: 0,
    },
  });

  const dateValue = watch("date");
  const month = dateValue?.slice(0, 7) ?? "";
  const planned = computePlannedAmount(plan, monthlyFinancials, month);

  async function onSubmit(values: ContributionForm) {
    await upsert.mutateAsync({
      plan_id: plan.id,
      date: values.date.slice(0, 7) + "-01",
      planned_amount: planned,
      actual_amount: values.actual_amount,
    });
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-[15px]">Registrar aportación</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2">
          <div className="space-y-1">
            <Label className="text-[12px]">Plan</Label>
            <div className="text-[13px] font-medium">{plan.name} · {plan.asset_name}</div>
          </div>

          <div className="space-y-1">
            <Label className="text-[12px]">Mes</Label>
            <Input type="month" {...register("date")} className="text-[13px]" />
          </div>

          {plan.rule_type !== "event" && month && (
            <div className="rounded-md bg-muted/40 px-3 py-2 text-[12px]">
              <span className="text-muted-foreground">Planificado: </span>
              <span className="font-medium">{euro.format(planned)}</span>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-[12px]">Importe real aportado (€)</Label>
            <Input type="number" step="0.01" {...register("actual_amount")} className="text-[13px]" />
          </div>

          <DialogFooter className="gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border px-4 py-2 text-[12.5px] hover:bg-muted"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-primary px-4 py-2 text-[12.5px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              Guardar
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
cd /home/manidmt/.openclaw/workspace/projects/wealth-os/wealth-navigator
npx tsc --noEmit 2>&1 | grep planning
```

Esperado: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/routes/planning.tsx
git commit -m "feat: add /planning route with DCA plan cards, projection chart and contribution history"
```

---

### Task 5: `AppSidebar.tsx` — Añadir nav item

**Files:**
- Modify: `src/components/app/AppSidebar.tsx`

- [ ] **Step 1: Añadir import de icono y actualizar tipos y array**

En `src/components/app/AppSidebar.tsx`:

1. Añadir `CalendarRange` al import de lucide-react (junto al resto de iconos).

2. Cambiar el tipo `NavItem.url`:
```typescript
url: "/" | "/expenses" | "/portfolio" | "/net-worth" | "/balances" | "/settings" | "/assistant" | "/planning";
```

3. Añadir el item al array `items` entre Portfolio y Patrimonio:
```typescript
{ title: "Planificación", url: "/planning", icon: CalendarRange },
```

- [ ] **Step 2: Verificar TypeScript y build**

```bash
cd /home/manidmt/.openclaw/workspace/projects/wealth-os/wealth-navigator
npx tsc --noEmit 2>&1 | head -20
```

Esperado: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/components/app/AppSidebar.tsx
git commit -m "feat: add Planificación to sidebar nav"
```

---

### Task 6: Build final y verificación

- [ ] **Step 1: Build de producción**

```bash
cd /home/manidmt/.openclaw/workspace/projects/wealth-os/wealth-navigator
npm run build 2>&1 | tail -20
```

Esperado: `✓ built in XX.XXs` sin errores.

- [ ] **Step 2: Reiniciar wealth-navigator**

```bash
systemctl --user restart wealth-navigator
sleep 3
curl -s -o /dev/null -w "%{http_code}" https://wealthos.manidmt.es/planning
```

Esperado: `200`.

- [ ] **Step 3: Recordatorio Supabase**

Verificar que el SQL de la Task 1 fue ejecutado en Supabase. Sin las tablas, los hooks fallarán silenciosamente devolviendo arrays vacíos.
