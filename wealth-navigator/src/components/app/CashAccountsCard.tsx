import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { SectionCard } from "@/components/app/SectionCard";
import { Input } from "@/components/ui/input";
import { useMoney } from "@/components/app/CurrencyProvider";
import { useDashboard } from "@/hooks/use-dashboard";
import { useCashAccounts, useUpsertCashAccount, useDeleteCashAccount } from "@/lib/cash-api";

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

  return (
    <SectionCard
      title="Cuentas de efectivo"
      description="Liquidez por cuenta. Si no añades cuentas, se usa el efectivo derivado del último cierre."
    >
      <div className="space-y-2">
        {accounts.map((a) => (
          <div key={a.id} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{a.name}</span>
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
        {!cash.hasAccounts && (
          <p className="pt-1 text-[11.5px] text-muted-foreground">
            Sin cuentas: se usa el efectivo derivado del último cierre.
          </p>
        )}
      </div>
    </SectionCard>
  );
}
