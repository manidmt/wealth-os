import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Download,
  FileJson,
  FileSpreadsheet,
  Globe,
  User2,
  Building2,
  RefreshCw,
  Unlink,
  Plus,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Trash2,
} from "lucide-react";
import {
  useAspsps,
  useBankConnections,
  useConnectBank,
  useSyncBank,
  useDisconnectBank,
  type BankConnection,
} from "@/lib/bank-api";
import {
  useExclusionRules,
  useCreateExclusionRule,
  useDeleteExclusionRule,
  useCategoryRules,
  useCreateCategoryRule,
  useDeleteCategoryRule,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
} from "@/lib/movements-api";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { AppShell } from "@/components/app/AppShell";
import { PageHeader, SectionCard, SectionLabel } from "@/components/app/SectionCard";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/app/ThemeToggle";
import { formatMonth } from "@/lib/dashboard-data";
import { useDashboard } from "@/hooks/use-dashboard";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Configuración — Wealth OS" },
      { name: "description", content: "Tipos de cambio, propietario y preferencias." },
    ],
  }),
  component: SettingsPage,
});

const fxRates = [
  { currency: "EUR", rate: 1, source: "base", updated: "—" },
  { currency: "USD", rate: 0.92, source: "manual", updated: "2026-04-30" },
  { currency: "CAD", rate: 0.68, source: "manual", updated: "2026-04-30" },
  { currency: "GBP", rate: 1.17, source: "manual", updated: "2026-04-30" },
];

function StatusBadge({ status }: { status: BankConnection["status"] }) {
  if (status === "active")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-positive/10 px-2 py-0.5 text-[11px] font-medium text-positive ring-1 ring-positive/30">
        <CheckCircle2 className="h-3 w-3" /> Activa
      </span>
    );
  if (status === "pending")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning ring-1 ring-warning/30">
        <Clock className="h-3 w-3" /> Pendiente
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive ring-1 ring-destructive/30">
      <AlertCircle className="h-3 w-3" /> {status === "expired" ? "Expirada" : "Error"}
    </span>
  );
}

/** true si session_expires_at existe y caduca dentro de 7 días (incluye ya caducadas). */
function expiresSoon(sessionExpiresAt: string | null): boolean {
  if (!sessionExpiresAt) return false;
  const diffMs = new Date(sessionExpiresAt).getTime() - Date.now();
  return diffMs <= 7 * 24 * 60 * 60 * 1000;
}

function BankSection() {
  const { data: connections = [], isLoading } = useBankConnections();
  const { data: aspsps = [], isLoading: isLoadingAspsps } = useAspsps();
  const connectBank = useConnectBank();
  const syncBank = useSyncBank();
  const disconnectBank = useDisconnectBank();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filteredAspsps = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return aspsps;
    return aspsps.filter((a) => a.name.toLowerCase().includes(q));
  }, [aspsps, search]);

  async function handleConnect(aspsp: (typeof aspsps)[number]) {
    const result = await connectBank.mutateAsync(aspsp);
    setDialogOpen(false);
    window.location.href = result.url;
  }

  return (
    <SectionCard
      title="Cuentas bancarias"
      description="Conecta tus bancos vía Open Banking para importar transacciones automáticamente."
    >
      <div className="space-y-3">
        {isLoading && <p className="text-[13px] text-muted-foreground">Cargando…</p>}

        {connections.map((conn) => {
          const expiring = expiresSoon(conn.session_expires_at);
          return (
            <div
              key={conn.id}
              className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="text-[13px] font-medium">{conn.institution_name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {conn.last_synced_at
                      ? `Sincronizado ${new Date(conn.last_synced_at).toLocaleDateString("es-ES")}`
                      : "Sin sincronizar"}
                  </div>
                  {expiring && (
                    <div className="mt-1 flex items-center gap-1 text-[11px] text-warning">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      La sesión caduca pronto, reconecta
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <StatusBadge status={conn.status} />
                {conn.status === "active" && (
                  <button
                    type="button"
                    title="Sincronizar"
                    onClick={() => syncBank.mutate(conn.id)}
                    disabled={syncBank.isPending}
                    className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition hover:bg-background hover:text-foreground disabled:opacity-40"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${syncBank.isPending ? "animate-spin" : ""}`}
                    />
                  </button>
                )}
                <button
                  type="button"
                  title="Desconectar"
                  onClick={() => disconnectBank.mutate(conn.id)}
                  className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition hover:bg-background hover:text-destructive"
                >
                  <Unlink className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}

        {connections.length === 0 && !isLoading && (
          <p className="text-[13px] text-muted-foreground">
            Ningún banco conectado. Conecta tu primer banco para importar transacciones
            automáticamente.
          </p>
        )}

        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) setSearch("");
          }}
        >
          <DialogTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 rounded-md border border-dashed border-border px-4 py-2.5 text-[13px] text-muted-foreground transition hover:border-border-strong hover:text-foreground"
            >
              <Plus className="h-4 w-4" /> Conectar banco
            </button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Selecciona tu banco</DialogTitle>
            </DialogHeader>
            <div className="space-y-2 pt-2">
              <Input
                placeholder="Buscar banco…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />
              <div className="grid max-h-72 gap-2 overflow-y-auto pr-1">
                {isLoadingAspsps && (
                  <p className="px-1 text-[13px] text-muted-foreground">Cargando bancos…</p>
                )}
                {!isLoadingAspsps && filteredAspsps.length === 0 && (
                  <p className="px-1 text-[13px] text-muted-foreground">Sin resultados.</p>
                )}
                {filteredAspsps.map((aspsp) => (
                  <button
                    key={`${aspsp.name}-${aspsp.country}`}
                    type="button"
                    onClick={() => handleConnect(aspsp)}
                    disabled={connectBank.isPending}
                    className="flex items-center gap-3 rounded-lg border border-border px-4 py-3 text-left text-[13px] font-medium transition hover:bg-muted disabled:opacity-40"
                  >
                    <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                    {aspsp.name}
                  </button>
                ))}
              </div>
            </div>
            {connectBank.isError && (
              <p className="text-[12px] text-destructive">{(connectBank.error as Error).message}</p>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </SectionCard>
  );
}

function ExclusionRulesSection() {
  const { data: rules = [], isLoading } = useExclusionRules();
  const createRule = useCreateExclusionRule();
  const deleteRule = useDeleteExclusionRule();
  const [matchText, setMatchText] = useState("");

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const value = matchText.trim();
    if (!value) return;
    createRule.mutate(value, {
      onSuccess: () => setMatchText(""),
    });
  }

  return (
    <SectionCard
      title="Reglas de exclusión"
      description="Movimientos cuyo concepto contenga alguno de estos textos se excluyen automáticamente al importar."
    >
      <div className="space-y-3">
        {isLoading && <p className="text-[13px] text-muted-foreground">Cargando…</p>}

        {rules.map((rule) => (
          <div
            key={rule.id}
            className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3"
          >
            <span className="text-[13px] font-medium">{rule.match_text}</span>
            <button
              type="button"
              title="Borrar regla"
              onClick={() => deleteRule.mutate(rule.id)}
              disabled={deleteRule.isPending}
              className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition hover:bg-background hover:text-destructive disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}

        {rules.length === 0 && !isLoading && (
          <p className="text-[13px] text-muted-foreground">
            Sin reglas todavía. Añade un texto (p.ej. INDEXA) para excluir automáticamente los
            movimientos que lo contengan.
          </p>
        )}

        <form onSubmit={handleAdd} className="flex items-center gap-2">
          <Input
            placeholder="Texto a excluir, p.ej. INDEXA"
            value={matchText}
            onChange={(e) => setMatchText(e.target.value)}
            className="text-[13px]"
          />
          <Button type="submit" size="sm" disabled={createRule.isPending || !matchText.trim()}>
            <Plus className="h-4 w-4" /> Añadir
          </Button>
        </form>

        {createRule.isError && (
          <p className="text-[12px] text-destructive">
            Error al crear la regla. Inténtalo de nuevo.
          </p>
        )}
      </div>
    </SectionCard>
  );
}

function CategoryRulesSection() {
  const { data: rules = [], isLoading } = useCategoryRules();
  const createRule = useCreateCategoryRule();
  const deleteRule = useDeleteCategoryRule();
  const [matchText, setMatchText] = useState("");
  const allCats = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES];
  const [category, setCategory] = useState(allCats[0]);

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const value = matchText.trim();
    if (!value) return;
    createRule.mutate({ match_text: value, category }, { onSuccess: () => setMatchText("") });
  }

  return (
    <SectionCard
      title="Reglas de categoría"
      description="Al importar, los movimientos cuyo concepto contenga este texto se asignan a la categoría elegida (tiene prioridad sobre la detección automática)."
    >
      <div className="space-y-3">
        {isLoading && <p className="text-[13px] text-muted-foreground">Cargando…</p>}
        {rules.map((rule) => (
          <div
            key={rule.id}
            className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3"
          >
            <span className="text-[13px]">
              <span className="font-medium">{rule.match_text}</span>
              <span className="text-muted-foreground"> → {rule.category}</span>
            </span>
            <button
              type="button"
              title="Borrar regla"
              onClick={() => deleteRule.mutate(rule.id)}
              disabled={deleteRule.isPending}
              className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition hover:bg-background hover:text-destructive disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {rules.length === 0 && !isLoading && (
          <p className="text-[13px] text-muted-foreground">
            Sin reglas todavía. Ej: concepto "NETFLIX" → categoría "Suscripciones".
          </p>
        )}
        <form onSubmit={handleAdd} className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Concepto, p.ej. NETFLIX"
            value={matchText}
            onChange={(e) => setMatchText(e.target.value)}
            className="min-w-[160px] flex-1 text-[13px]"
          />
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-[180px] text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {allCats.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" size="sm" disabled={createRule.isPending || !matchText.trim()}>
            <Plus className="h-4 w-4" /> Añadir
          </Button>
        </form>
      </div>
    </SectionCard>
  );
}

function SettingsPage() {
  const data = useDashboard();

  function downloadJSON() {
    if (typeof window === "undefined") return;
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wealth-os-${data.latestMonth}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadCSV() {
    if (typeof window === "undefined") return;
    const rows = [
      ["month", "assets", "liabilities", "netWorth", "savings"],
      ...data.series.map((p) => [p.month, p.assets, p.liabilities, p.netWorth, p.savings]),
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wealth-os-series-${data.latestMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AppShell pageEyebrow="Preferencias">
      <PageHeader
        eyebrow="Configuración"
        title="Configuración"
        description="Tipos de cambio manuales, datos del propietario, apariencia y exportación."
      />

      <div className="space-y-10 px-4 py-8 md:px-8">
        {/* Two-column intro: owner + apariencia */}
        <section className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
          <SectionCard title="Propietario" description="Identidad mostrada en cabecera y reportes.">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5 text-[12px]">
                  <User2 className="h-3.5 w-3.5 text-muted-foreground" /> Nombre
                </Label>
                <Input value={data.owner} readOnly />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5 text-[12px]">
                  <Globe className="h-3.5 w-3.5 text-muted-foreground" /> Moneda base
                </Label>
                <Input value="EUR" readOnly />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label className="text-[12px]">Último cierre disponible</Label>
                <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2 text-[13px]">
                  <span>{formatMonth(data.latestMonth)}</span>
                  <span className="text-[11.5px] text-muted-foreground">
                    Generado {new Date(data.generatedAt).toLocaleDateString("es-ES")}
                  </span>
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Apariencia" description="Tema y densidad visual del dashboard.">
            <div className="space-y-5">
              <div>
                <div className="mb-2 text-[12px] font-medium text-foreground">Tema</div>
                <ThemeToggle />
                <p className="mt-2 text-[11.5px] text-muted-foreground">
                  Se guarda en este dispositivo. Por defecto sigue al sistema.
                </p>
              </div>
              <div className="rounded-md border border-dashed border-border px-3 py-2.5 text-[11.5px] text-muted-foreground">
                Próximamente: densidad compacta, fuente alternativa y tamaño base.
              </div>
            </div>
          </SectionCard>
        </section>

        <SectionCard
          title="Tipos de cambio"
          description="Base manual a EUR usada para traducir posiciones en otras divisas al valor consolidado del dashboard."
        >
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-[13px]">
              <thead className="bg-muted/40">
                <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Divisa</th>
                  <th className="px-4 py-3 font-medium text-right">1 unidad = EUR</th>
                  <th className="px-4 py-3 font-medium">Origen</th>
                  <th className="px-4 py-3 font-medium">Actualizado</th>
                  <th className="px-4 py-3 font-medium text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {fxRates.map((r) => (
                  <tr key={r.currency} className="hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{r.currency}</td>
                    <td className="px-4 py-3 text-right">
                      <Input
                        readOnly
                        defaultValue={r.rate.toString()}
                        className="ml-auto h-8 w-32 text-right tabular-nums"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        variant={r.source === "base" ? "default" : "secondary"}
                        className="font-normal"
                      >
                        {r.source}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{r.updated}</td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="outline" disabled>
                        Guardar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <section className="grid gap-5 lg:grid-cols-[1fr_1fr]">
          <SectionCard
            title="Exportar datos"
            description="Descarga del dataset semilla en este dispositivo."
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={downloadJSON}
                className="flex items-start gap-3 rounded-lg border border-border bg-card p-4 text-left transition hover:border-border-strong"
              >
                <FileJson className="h-5 w-5 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="text-[13px] font-medium">Snapshot completo (JSON)</div>
                  <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                    Patrimonio, allocation, gastos y series.
                  </div>
                </div>
                <Download className="ml-auto h-4 w-4 self-center text-muted-foreground" />
              </button>

              <button
                type="button"
                onClick={downloadCSV}
                className="flex items-start gap-3 rounded-lg border border-border bg-card p-4 text-left transition hover:border-border-strong"
              >
                <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="text-[13px] font-medium">Serie mensual (CSV)</div>
                  <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                    Activos, pasivos, neto y ahorro por mes.
                  </div>
                </div>
                <Download className="ml-auto h-4 w-4 self-center text-muted-foreground" />
              </button>
            </div>
          </SectionCard>

          <SectionCard
            title="Lectura FX"
            description="Cómo se interpretan las divisas en el portfolio."
          >
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-[13px]">
                <thead className="bg-muted/40">
                  <tr className="text-left text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Concepto</th>
                    <th className="px-4 py-3 font-medium">Interpretación</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {[
                    ["EUR", "1 EUR = 1 EUR"],
                    ["USD", "Se convierte con el tipo manual actual a EUR"],
                    ["CAD", "Se convierte con el tipo manual actual a EUR"],
                    ["P/L %", "Sigue siendo válido en la divisa original"],
                  ].map(([k, v]) => (
                    <tr key={k}>
                      <td className="px-4 py-3 font-medium">{k}</td>
                      <td className="px-4 py-3 text-muted-foreground">{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </section>

        <BankSection />

        <ExclusionRulesSection />

        <CategoryRulesSection />

        <section>
          <SectionLabel>Estado del proyecto</SectionLabel>
          <div className="rounded-xl border border-warning/40 bg-warning/10 p-5 text-[13px] text-foreground">
            <div className="font-display text-base font-semibold">Modo demostración</div>
            <p className="mt-1.5 text-muted-foreground">
              Esta versión visual lee el archivo de datos semilla del proyecto. La edición de
              gastos, movimientos, portfolio y FX está deshabilitada. Para reactivar la
              persistencia, conecta el backend equivalente (Lovable Cloud o tu API original).
            </p>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
