import { Link } from "@tanstack/react-router";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useBankConnections, useReconnectBank } from "@/lib/bank-api";
import { bankAlerts, type BankAlert } from "@/lib/bank-health";

function message(a: BankAlert): string {
  const date = a.expiresAt
    ? new Date(a.expiresAt).toLocaleDateString("es-ES", { day: "numeric", month: "short" })
    : "";
  if (a.kind === "expired")
    return `El acceso a ${a.institution} ha caducado. Reconecta para que vuelva a sincronizar.`;
  if (a.kind === "expiring")
    return `El acceso a ${a.institution} caduca el ${date}. Reconecta para que siga sincronizando.`;
  return `${a.institution} no se sincroniza desde hace ${a.staleDays} días.`;
}

export function BankHealthBanner() {
  const { data: connections = [] } = useBankConnections();
  const { reconnect, isPending, error } = useReconnectBank();
  const alerts = bankAlerts(connections);
  if (!alerts.length) return null;

  return (
    <div className="space-y-2">
      {alerts.map((a) => (
        <div
          key={a.connection.id}
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-[13px]"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
          <span className="min-w-0 flex-1">{message(a)}</span>
          {a.kind === "stale" ? (
            <Link
              to="/settings"
              className="shrink-0 font-medium text-foreground underline-offset-2 hover:underline"
            >
              Ver en Configuración
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => reconnect(a.connection)}
              disabled={isPending}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1 font-medium transition hover:bg-muted disabled:opacity-40"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} />
              Reconectar
            </button>
          )}
        </div>
      ))}
      {error && <p className="text-[12px] text-destructive">{error.message}</p>}
    </div>
  );
}
