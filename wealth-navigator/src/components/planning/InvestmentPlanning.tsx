import { useState, useMemo } from "react";
import { Plus, Pencil, CalendarCheck } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, Legend } from "recharts";
import { SectionCard } from "@/components/app/SectionCard";
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
  toEnginePlan,
  type MonthlyFinancials,
} from "@/lib/planning-calc";
import { useDashboard } from "@/hooks/use-dashboard";
import { formatMonth, euro } from "@/lib/dashboard-data";
import { StrategyCard } from "@/components/planning/StrategyCard";
import { JanuaryWizard } from "@/components/planning/JanuaryWizard";
import { MonthlyRoutine } from "@/components/planning/MonthlyRoutine";
import { ContributionLog } from "@/components/planning/ContributionLog";
import { SignalsPanel } from "@/components/planning/SignalsPanel";
import { useLatestSignals } from "@/lib/signals-api";
import { effectiveQuota, type SignalMap } from "@/lib/strategy-engine";
import { useSyncContributionToPosition } from "@/lib/portfolio-sync";
import { usePortfolioPositions } from "@/lib/portfolio-api";
import { rankPositions, suggestPosition } from "@/lib/position-match";

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
  price: z.coerce.number().positive().optional(),
  multiplier: z.coerce.number().positive().optional(),
});

type ContributionForm = z.infer<typeof contributionSchema>;

const AUTO_POSITION = "__auto__";

// ── Page ───────────────────────────────────────────────────────────────────

export function InvestmentPlanning() {
  const { data: plans = [], isLoading } = useInvestmentPlans();
  const { data: signals = {} } = useLatestSignals();
  const { data: positions = [] } = usePortfolioPositions();
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
  const strategyPlans = plans.filter((p) => p.asset_class);
  const projectionPlan = plans.find((p) => p.id === selectedPlanId) ?? activePlans[0] ?? null;

  const projectionData = useMemo(() => {
    if (!projectionPlan) return [];
    const points = computeProjection(projectionPlan, monthlyFinancials, horizon);
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
    <>
      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 md:px-8">
        <div className="flex justify-end">
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-[13px] font-medium text-foreground/80 transition hover:border-border-strong hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            Nuevo plan
          </button>
        </div>

        {/* Calibración anual (solo si hay estrategias pendientes) */}
        <JanuaryWizard strategies={strategyPlans} signals={signals} />

        {/* Mis planes */}
        <SectionCard
          title="Mis planes"
          description={
            isLoading
              ? "Cargando…"
              : activePlans.length === 0
                ? "No tienes planes activos aún. Crea tu primer plan DCA."
                : undefined
          }
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {strategyPlans.map((plan) => (
              <StrategyCard
                key={plan.id}
                plan={plan}
                signals={signals}
                positions={positions}
                onEdit={() => openEdit(plan)}
                onRegister={() => setContributionPlan(plan)}
              />
            ))}
            {activePlans
              .filter((p) => !p.asset_class)
              .map((plan) => (
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

        {/* Rutina mensual */}
        <MonthlyRoutine strategies={strategyPlans} signals={signals} />

        {/* Proyección */}
        {projectionPlan && (
          <SectionCard title="Proyección">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              {activePlans.length > 1 && (
                <Select value={projectionPlan.id} onValueChange={setSelectedPlanId}>
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
            <p className="mb-3 text-[11px] text-muted-foreground">
              {projectionPlan.name} · {formatRule(projectionPlan)} · Rentabilidades:{" "}
              {projectionPlan.return_pessimistic}% / {projectionPlan.return_base}% /{" "}
              {projectionPlan.return_optimistic}%
            </p>
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

        {/* Historial / Log de aportaciones */}
        {projectionPlan &&
          (projectionPlan.asset_class ? (
            <ContributionLog plan={projectionPlan} />
          ) : (
            <ContributionHistory plan={projectionPlan} monthlyFinancials={monthlyFinancials} />
          ))}

        {/* Señales de mercado */}
        <SignalsPanel />
      </div>

      <PlanModal
        key={editingPlan?.id ?? "new"}
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
          signals={signals}
        />
      )}
    </>
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

  const currentContrib = contributions.find((c) => c.date.slice(0, 7) === currentMonth);

  const planned = computePlannedAmount(plan, monthlyFinancials, currentMonth);
  const actual = currentContrib?.actual_amount ?? null;
  const deviation = actual !== null ? actual - planned : null;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-semibold tracking-tight">{plan.name}</div>
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
          <span className="font-medium">
            {plan.rule_type === "event" ? "—" : euro.format(planned)}
          </span>
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
  monthlyFinancials: _monthlyFinancials,
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
                <th className="pb-2 pr-4 text-right font-medium">Planificado</th>
                <th className="pb-2 pr-4 text-right font-medium">Real</th>
                <th className="pb-2 text-right font-medium">Desviación</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {contributions.map((c) => {
                const dev = c.actual_amount !== null ? c.actual_amount - c.planned_amount : null;
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
                          className={
                            dev >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"
                          }
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
  const { data: positions = [] } = usePortfolioPositions();

  const isStrategy = !!editing?.asset_class;

  const defaultValues: PlanForm = editing
    ? {
        name: editing.name,
        asset_name: editing.asset_name,
        rule_type: editing.rule_type,
        amount: editing.amount,
        percentage: editing.percentage,
        frequency: editing.frequency,
        return_pessimistic: editing.return_pessimistic,
        return_base: editing.return_base,
        return_optimistic: editing.return_optimistic,
        start_date: editing.start_date,
        active: editing.active,
        notes: editing.notes,
      }
    : {
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
      };

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<PlanForm>({
    resolver: zodResolver(planSchema),
    defaultValues,
  });

  const ruleType = watch("rule_type");
  const frequencyValue = watch("frequency");
  const nameValue = watch("name");
  const assetNameValue = watch("asset_name");

  const rankedPositions = useMemo(
    () =>
      rankPositions(
        nameValue ?? "",
        assetNameValue ?? "",
        positions.map((p) => ({ id: p.id, assetName: p.assetName })),
      ),
    [nameValue, assetNameValue, positions],
  );

  const [positionId, setPositionId] = useState<string>(() => {
    if (editing?.portfolio_position_id) return editing.portfolio_position_id;
    if (!nameValue && !assetNameValue) return AUTO_POSITION;
    const suggestion = suggestPosition(
      nameValue ?? "",
      assetNameValue ?? "",
      positions.map((p) => ({ id: p.id, assetName: p.assetName })),
    );
    return suggestion?.id ?? AUTO_POSITION;
  });

  async function onSubmit(values: PlanForm) {
    const payload = {
      ...values,
      portfolio_position_id: positionId === AUTO_POSITION ? null : positionId,
    };
    if (editing) {
      await updatePlan.mutateAsync({ id: editing.id, ...payload });
    } else {
      await createPlan.mutateAsync(payload);
    }
    onClose();
  }

  async function handleDelete() {
    if (!editing) return;
    await deletePlan.mutateAsync(editing.id);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
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
              <Input
                {...register("asset_name")}
                placeholder="Amundi MSCI World ETF"
                className="text-[13px]"
              />
              {errors.asset_name && (
                <p className="text-[11px] text-red-500">{errors.asset_name.message}</p>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-[12px]">Tipo de regla</Label>
              <Select value={ruleType} onValueChange={(v) => setValue("rule_type", v as RuleType)}>
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
                value={frequencyValue}
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

          {ruleType === "fixed" && (
            <div className="space-y-1">
              <Label className="text-[12px]">Importe (€)</Label>
              <Input type="number" step="1" {...register("amount")} className="text-[13px]" />
            </div>
          )}

          {(ruleType === "pct_income" || ruleType === "pct_savings") && (
            <div className="space-y-1">
              <Label className="text-[12px]">Porcentaje (%)</Label>
              <Input type="number" step="0.1" {...register("percentage")} className="text-[13px]" />
            </div>
          )}

          <div>
            <Label className="mb-2 block text-[12px]">Rentabilidad anual esperada (%)</Label>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Pesimista</Label>
                <Input
                  type="number"
                  step="0.5"
                  {...register("return_pessimistic")}
                  className="text-[13px]"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Base</Label>
                <Input
                  type="number"
                  step="0.5"
                  {...register("return_base")}
                  className="text-[13px]"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px] text-muted-foreground">Optimista</Label>
                <Input
                  type="number"
                  step="0.5"
                  {...register("return_optimistic")}
                  className="text-[13px]"
                />
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-[12px]">Fecha de inicio</Label>
            <Input type="date" {...register("start_date")} className="text-[13px]" />
          </div>

          <div className="space-y-1">
            <Label className="text-[12px]">Notas (opcional)</Label>
            <Textarea {...register("notes")} rows={2} className="resize-none text-[13px]" />
          </div>

          {isStrategy && (
            <div className="space-y-1">
              <Label className="text-[12px]">Posición vinculada</Label>
              <Select value={positionId} onValueChange={setPositionId}>
                <SelectTrigger className="text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={AUTO_POSITION}>Crear automáticamente al aportar</SelectItem>
                  {rankedPositions.map(({ id }) => {
                    const pos = positions.find((p) => p.id === id);
                    if (!pos) return null;
                    return (
                      <SelectItem key={id} value={id}>
                        {pos.assetName}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          )}

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
  signals,
}: {
  open: boolean;
  onClose: () => void;
  plan: InvestmentPlan;
  monthlyFinancials: MonthlyFinancials[];
  signals: SignalMap;
}) {
  const upsert = useUpsertContribution();
  const syncPosition = useSyncContributionToPosition();

  const isStrategy = !!plan.asset_class;

  const strategyQuota = useMemo(() => {
    if (!isStrategy) return 0;
    const enginePlan = toEnginePlan(plan);
    return effectiveQuota(enginePlan, signals);
  }, [isStrategy, plan, signals]);

  const {
    register,
    handleSubmit,
    watch,
    formState: { isSubmitting },
  } = useForm<ContributionForm>({
    resolver: zodResolver(contributionSchema),
    defaultValues: {
      date: new Date().toISOString().slice(0, 7),
      actual_amount: isStrategy ? strategyQuota : 0,
    },
  });

  const dateValue = watch("date");
  const priceValue = watch("price");
  const month = dateValue?.slice(0, 7) ?? "";
  const planned = isStrategy ? strategyQuota : computePlannedAmount(plan, monthlyFinancials, month);

  async function onSubmit(values: ContributionForm) {
    await upsert.mutateAsync({
      plan_id: plan.id,
      date: values.date + "-01",
      planned_amount: planned,
      actual_amount: values.actual_amount,
      price: values.price ?? null,
      units: values.price ? values.actual_amount / values.price : null,
      multiplier: values.multiplier ?? null,
    });
    if (values.price && values.price > 0) {
      syncPosition.mutate({
        plan,
        amount: values.actual_amount,
        units: values.actual_amount / values.price,
      });
    }
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
            <div className="text-[13px] font-medium">
              {plan.name} · {plan.asset_name}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-[12px]">Mes</Label>
            <Input type="month" {...register("date")} className="text-[13px]" />
          </div>

          {(isStrategy || (plan.rule_type !== "event" && month)) && (
            <div className="rounded-md bg-muted/40 px-3 py-2 text-[12px]">
              <span className="text-muted-foreground">
                {isStrategy ? "Cuota efectiva: " : "Planificado: "}
              </span>
              <span className="font-medium">{euro.format(planned)}</span>
            </div>
          )}

          <div className="space-y-1">
            <Label className="text-[12px]">Importe real aportado (€)</Label>
            <Input
              type="number"
              step="0.01"
              {...register("actual_amount")}
              className="text-[13px]"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-[12px]">Precio de compra (opcional)</Label>
            <Input type="number" step="any" {...register("price")} className="text-[13px]" />
            {!priceValue && (
              <p className="text-[11px] text-muted-foreground">
                Indica el precio para sincronizar con tu portfolio.
              </p>
            )}
          </div>

          <div className="space-y-1">
            <Label className="text-[12px]">Multiplicador aplicado (opcional)</Label>
            <Input type="number" step="any" {...register("multiplier")} className="text-[13px]" />
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
