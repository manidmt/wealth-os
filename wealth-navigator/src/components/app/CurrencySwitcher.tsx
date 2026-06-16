import { Check, ChevronDown } from "lucide-react";
import { CURRENCIES, useMoney, type CurrencyCode } from "./CurrencyProvider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Link } from "@tanstack/react-router";

export function CurrencySwitcher() {
  const { code, setCode } = useMoney();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 font-mono text-[11px] font-medium text-foreground/80 transition hover:border-border-strong hover:text-foreground"
        aria-label="Cambiar divisa"
        title="Cambiar divisa"
      >
        {code}
        <ChevronDown className="h-3 w-3 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel className="text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground">
          Divisa de visualización
        </DropdownMenuLabel>
        {CURRENCIES.map((c: CurrencyCode) => (
          <DropdownMenuItem
            key={c}
            onClick={() => setCode(c)}
            className="flex items-center justify-between gap-2 font-mono text-[12px]"
          >
            <span>{c}</span>
            {c === code ? <Check className="h-3.5 w-3.5 text-primary" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="text-[11.5px] text-muted-foreground">
          <Link to="/settings">Editar tipos de cambio →</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
