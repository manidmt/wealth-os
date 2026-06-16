import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app/AppShell";
import { PageHeader, SectionCard } from "@/components/app/SectionCard";
import { KpiCard } from "@/components/app/KpiCard";
import { PlatformBadge } from "@/components/app/PlatformBadge";
import { PositionDrawer } from "@/components/app/PositionDrawer";
import { PositionSheet } from "@/components/app/PositionSheet";
import { BarList, DonutChart } from "@/components/charts/charts";
import { useMoney } from "@/components/app/CurrencyProvider";
import { useDashboard } from "@/hooks/use-dashboard";
import { usePortfolioPositions, ASSET_TYPE_LABELS, type PortfolioPosition } from "@/lib/portfolio-api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X } from "lucide-react";

export const Route = createFileRoute("/portfolio")({
  head: () => ({
    meta: [
      { title: "Portfolio — Wealth OS" },
      {
        name: "description",
        content: "Posiciones invertidas, exposición por plataforma y por categoría.",
      },
    ],
  }),
  component: PortfolioPage,
});

function PortfolioPage() {
  const data = useDashboard();
  const { data: positions = [], isLoading } = usePortfolioPositions();
  const money = useMoney();
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState<PortfolioPosition | null>(null);

  const total = positions.reduce((s, p) => s + p.marketValueEur, 0);

  const byCategoryMap = new Map<string, number>();
  for (const p of positions) {
    const k = ASSET_TYPE_LABELS[p.assetType] ?? "Otros";
    byCategoryMap.set(k, (byCategoryMap.get(k) ?? 0) + p.marketValueEur);
  }
  const byCategory = [...byCategoryMap.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  const byPlatformMap = new Map<string, number>();
  for (const p of positions) {
    byPlatformMap.set(p.platform, (byPlatformMap.get(p.platform) ?? 0) + p.marketValueEur);
  }
  const byPlatform = [...byPlatformMap.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  const categories = useMemo(
    () => Array.from(new Set(positions.map((p) => ASSET_TYPE_LABELS[p.assetType] ?? "Otros"))).sort(),
    [positions],
  );
  const platforms = useMemo(
    () => Array.from(new Set(positions.map((p) => p.platform))).sort(),
    [positions],
  );

  const [categoryFilter, setCategoryFilter] = useState("all");
  const [platformFilter, setPlatformFilter] = useState("all");

  const filtered = positions.filter(
    (p) =>
      (categoryFilter === "all" || (ASSET_TYPE_LABELS[p.assetType] ?? "Otros") === categoryFilter) &&
      (platformFilter === "all" || p.platform === platformFilter),
  );
  const filteredTotal = filtered.reduce((s, p) => s + p.marketValueEur, 0);
  const hasFilter = categoryFilter !== "all" || platformFilter !== "all";

  // Freshness from dashboard data
  const generatedAt = data.generatedAt;
  const freshness = generatedAt
    ? (() => {
        const diff = Date.now() - new Date(generatedAt).getTime();
        const mins = Math.floor(diff / 60_000);
        if (mins < 1) return "Ahora";
        if (mins < 60) return `Hace ${mins} min`;
        return `Hace ${Math.floor(mins / 60)} h`;
      })()
    : "—";

  return (
    <AppShell pageEyebrow="Cartera invertida">
      <PageHeader
        eyebrow="Live"
        title="Portfolio"
        description="Exposición consolidada por activo, plataforma y categoría. Valoración en EUR sobre el último precio disponible."
        actions={
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-[13px] font-medium text-foreground/80 transition hover:border-border-strong hover:text-foreground"
          >
            <span className="text-[16px] leading-none">+</span>
            Añadir posición
          </button>
        }
      />

      <div className="space-y-10 px-4 py-8 md:px-8">
        <section>
          <KpiCard
            accent="primary"
            label="Valor de mercado"
            value={money.format(total)}
            hint={
              <span className="inline-flex items-center gap-2">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inset-0 animate-ping rounded-full bg-primary-foreground/40" />
                  <span className="relative h-1.5 w-1.5 rounded-full bg-primary-foreground/80" />
                </span>
                {freshness} · {positions.length} posiciones · {platforms.length} plataformas
              </span>
            }
          />
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <SectionCard
            title="Por categoría"
            description="Peso de cada tipo de activo."
            askPrompt="¿Cómo está repartido mi portfolio por tipo de activo y dónde hay sobreexposición?"
          >
            <DonutChart data={byCategory} total={total} />
          </SectionCard>
          <SectionCard
            title="Por plataforma"
            description="Distribución entre brokers y custodios."
            askPrompt="¿En qué plataformas tengo más concentración y cuál es el riesgo asociado?"
          >
            <BarList items={byPlatform} total={total} />
          </SectionCard>
        </section>

        <SectionCard
          title="Posiciones"
          description="Pulsa una fila para ver el detalle, editar o registrar una compra."
          askPrompt="Revisa mis posiciones: cuáles destacan, cuáles deberían reducirse y propuestas de rebalance."
        >
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                Tipo
              </span>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="h-8 w-[160px] text-[12.5px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                Plataforma
              </span>
              <Select value={platformFilter} onValueChange={setPlatformFilter}>
                <SelectTrigger className="h-8 w-[180px] text-[12.5px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {platforms.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {hasFilter && (
              <button
                type="button"
                onClick={() => {
                  setCategoryFilter("all");
                  setPlatformFilter("all");
                }}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11.5px] text-muted-foreground transition hover:text-foreground"
              >
                <X className="h-3 w-3" /> Limpiar
              </button>
            )}
            <div className="ml-auto text-[12px] tabular-nums text-muted-foreground">
              {filtered.length} de {positions.length} ·{" "}
              <span className="text-foreground">{money.format(filteredTotal)}</span>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-[13px]">
              <thead className="bg-muted/40">
                <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Activo</th>
                  <th className="px-4 py-3 font-medium">Plataforma</th>
                  <th className="hidden px-4 py-3 font-medium text-right sm:table-cell">Cantidad</th>
                  <th className="hidden px-4 py-3 font-medium text-right md:table-cell">P/L</th>
                  <th className="px-4 py-3 font-medium text-right">Valor</th>
                  <th className="px-4 py-3 font-medium text-right">Peso</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={6} className="px-4 py-3">
                        <div className="h-4 animate-pulse rounded bg-muted/40" />
                      </td>
                    </tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-10 text-center text-[12.5px] text-muted-foreground"
                    >
                      {positions.length === 0
                        ? "Sin posiciones. Añade tu primera posición con el botón de arriba."
                        : "No hay posiciones con esos filtros."}
                    </td>
                  </tr>
                ) : (
                  filtered.map((p) => {
                    const w = total > 0 ? (p.marketValueEur / total) * 100 : 0;
                    const pnlPositive = p.pnlPct != null && p.pnlPct > 0;
                    const pnlNegative = p.pnlPct != null && p.pnlPct < 0;
                    return (
                      <tr
                        key={p.id}
                        onClick={() => setSelected(p)}
                        className="cursor-pointer transition hover:bg-muted/40"
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium">{p.assetName}</div>
                          {p.ticker && (
                            <div className="font-mono text-[10.5px] text-muted-foreground">
                              {p.ticker}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          <PlatformBadge name={p.platform} />
                        </td>
                        <td className="hidden px-4 py-3 text-right tabular-nums text-muted-foreground sm:table-cell">
                          {p.assetType === "broker_cash"
                            ? "—"
                            : p.quantity >= 1
                              ? p.quantity.toLocaleString("es-ES")
                              : p.quantity.toFixed(6).replace(/\.?0+$/, "")}
                        </td>
                        <td className="hidden px-4 py-3 text-right tabular-nums md:table-cell">
                          {p.pnlPct != null && !p.assetType.includes("cash") ? (
                            <span
                              className={
                                pnlPositive
                                  ? "text-positive"
                                  : pnlNegative
                                    ? "text-negative"
                                    : "text-muted-foreground"
                              }
                            >
                              {pnlPositive ? "+" : ""}
                              {(p.pnlPct * 100).toFixed(2)}%
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-medium">
                          {money.format1(p.marketValueEur)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                          {w.toFixed(1)}%
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>

      <PositionDrawer
        position={selected}
        totalValue={total}
        open={!!selected}
        onOpenChange={(o) => { if (!o) setSelected(null); }}
      />

      <PositionSheet
        mode="create"
        open={addOpen}
        onOpenChange={setAddOpen}
      />
    </AppShell>
  );
}
