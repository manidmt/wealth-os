import { useState } from "react";
import { Landmark, Plus, Trash2 } from "lucide-react";
import { SectionCard } from "@/components/app/SectionCard";
import { Input } from "@/components/ui/input";
import { useMoney } from "@/components/app/CurrencyProvider";
import { useDashboard } from "@/hooks/use-dashboard";
import { useCashAccounts, useUpsertCashAccount, useDeleteCashAccount } from "@/lib/cash-api";
import { useMovementsSince } from "@/lib/movements-api";

function syncedAgo(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return "hace minutos";
  if (mins < 1440) return `hace ${Math.floor(mins / 60)} h`;
  return `hace ${Math.floor(mins / 1440)} d`;
}

export function CashAccountsCard() {
  const money = useMoney();
  const data = useDashboard();
  const { data: accounts = [] } = useCashAccounts();
  const upsert = useUpsertCashAccount();
  const del = useDeleteCashAccount();

  const [newName, setNewName] = useState("");
  const [newBalance, setNewBalance] = useState("");

  const cash = data.cash ?? {
    total: 0,
    derived: 0,
    accountsTotal: 0,
    source: "derived" as const,
    reconcileDelta: 0,
    hasAccounts: false,
  };

  function addAccount() {
    const name = newName.trim();
    const balance = parseFloat(newBalance.replace(",", "."));
    if (!name || !Number.isFinite(balance)) return;
    upsert.mutate(
      { name, balance },
      {
        onSuccess: () => {
          setNewName("");
          setNewBalance("");
        },
      },
    );
  }

  const threshold = Math.max(50, Math.abs(cash.derived) * 0.01);
  const drift = cash.hasAccounts && Math.abs(cash.reconcileDelta) > threshold;

  // Cuenta más desactualizada: el saldo manual no refleja los movimientos
  // registrados después de su última edición hasta que el usuario lo actualiza.
  const staleAccount = accounts
    .filter((a) => !a.bank_account_uid)
    .reduce<
      (typeof accounts)[number] | null
    >((oldest, a) => (!oldest || a.updated_at < oldest.updated_at ? a : oldest), null);
  const staleDays = staleAccount
    ? Math.floor((Date.now() - new Date(staleAccount.updated_at).getTime()) / 86_400_000)
    : 0;
  const { data: netSinceStale = 0 } = useMovementsSince(
    staleAccount && staleDays >= 3 ? staleAccount.updated_at : null,
  );

  return (
    <SectionCard
      title="Cuentas de efectivo"
      description="Liquidez por cuenta. Las cuentas con banco conectado se actualizan solas; las demás, a mano. Sin cuentas, se usa el efectivo derivado del último cierre."
    >
      <div className="space-y-2">
        {accounts.map((a) => (
          <div key={a.id} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
              {a.name}
              {a.bank_account_uid && (
                <span
                  className="ml-2 text-[11px] font-normal text-muted-foreground"
                  title="Saldo leído del banco en cada sincronización"
                >
                  <Landmark className="mr-0.5 inline h-3 w-3 align-[-1px]" />
                  {a.balance_synced_at ? syncedAgo(a.balance_synced_at) : "banco"}
                </span>
              )}
            </span>
            {a.bank_account_uid ? (
              <span className="w-32 pr-3 text-right text-[13px] tabular-nums">
                {money.format1(a.balance)}
              </span>
            ) : (
              <Input
                type="number"
                step="any"
                defaultValue={String(a.balance)}
                onBlur={(e) => {
                  const balance = parseFloat(e.target.value.replace(",", "."));
                  if (Number.isFinite(balance) && balance !== a.balance) {
                    upsert.mutate({ id: a.id, name: a.name, balance });
                  }
                }}
                className="h-8 w-32 text-right text-[13px] tabular-nums"
              />
            )}
            <button
              type="button"
              onClick={() => del.mutate(a.id)}
              className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              aria-label="Borrar cuenta"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}

        <div className="flex items-center gap-2 pt-1">
          <Input
            placeholder="Nombre (ej. BBVA)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="h-8 flex-1 text-[13px]"
          />
          <Input
            type="number"
            step="any"
            placeholder="Saldo €"
            value={newBalance}
            onChange={(e) => setNewBalance(e.target.value)}
            className="h-8 w-32 text-right text-[13px] tabular-nums"
          />
          <button
            type="button"
            onClick={addAccount}
            className="grid h-8 w-8 place-items-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Añadir cuenta"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-1 border-t border-border pt-3 text-[12.5px]">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Efectivo en cuentas</span>
          <span className="tabular-nums">{money.format1(cash.accountsTotal)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Derivado (patrimonio − cartera)</span>
          <span className="tabular-nums">{money.format1(cash.derived)}</span>
        </div>
        {cash.hasAccounts && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Diferencia</span>
            <span className={`tabular-nums ${drift ? "text-negative" : "text-muted-foreground"}`}>
              {cash.reconcileDelta >= 0 ? "+" : ""}
              {money.format1(cash.reconcileDelta)}
            </span>
          </div>
        )}
        {drift && (
          <p className="pt-1 text-[11.5px] text-negative">
            No cuadra con el snapshot. Revisa los saldos o el cierre del mes.
          </p>
        )}
        {staleAccount && staleDays >= 3 && Math.abs(netSinceStale) > 0.5 && (
          <p className="pt-1 text-[11.5px] text-amber-600 dark:text-amber-400">
            El saldo de «{staleAccount.name}» no se actualiza desde hace {staleDays} días. Desde
            entonces se {netSinceStale >= 0 ? "ingresaron" : "gastaron"}{" "}
            {money.format1(Math.abs(netSinceStale))} que aún no están reflejados en ese saldo.
          </p>
        )}
        {!cash.hasAccounts && (
          <p className="pt-1 text-[11.5px] text-muted-foreground">
            Sin cuentas: se usa el efectivo derivado del último cierre.
          </p>
        )}
      </div>
    </SectionCard>
  );
}
