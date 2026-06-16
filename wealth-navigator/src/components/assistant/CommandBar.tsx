import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, Search } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { AssistantMark } from "./AssistantMark";
import { SUGGESTIONS } from "@/lib/assistant-mock";

const NAV_SHORTCUTS: {
  label: string;
  to: "/" | "/expenses" | "/portfolio" | "/net-worth" | "/settings";
}[] = [
  { label: "Ir a Resumen", to: "/" },
  { label: "Ir a Gastos mensuales", to: "/expenses" },
  { label: "Ir a Portfolio", to: "/portfolio" },
  { label: "Ir a Patrimonio", to: "/net-worth" },
];

export function CommandBar({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  function ask(prompt: string) {
    onOpenChange(false);
    navigate({ to: "/assistant", search: { q: prompt } });
  }

  function go(to: "/" | "/expenses" | "/portfolio" | "/net-worth" | "/settings") {
    onOpenChange(false);
    navigate({ to });
  }

  const q = query.trim().toLowerCase();
  const filteredSugs = q
    ? SUGGESTIONS.filter(
        (s) => s.label.toLowerCase().includes(q) || s.prompt.toLowerCase().includes(q),
      )
    : SUGGESTIONS;
  const filteredNav = q
    ? NAV_SHORTCUTS.filter((n) => n.label.toLowerCase().includes(q))
    : NAV_SHORTCUTS;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-[640px]">
        <DialogTitle className="sr-only">Asistente de Wealth OS</DialogTitle>

        <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
          <AssistantMark className="h-5 w-5 text-primary" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && query.trim()) {
                e.preventDefault();
                ask(query.trim());
              }
            }}
            placeholder="Pregúntale al Asistente…"
            className="flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden rounded border border-border px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground sm:inline">
            ⏎
          </kbd>
        </div>

        <div className="max-h-[420px] overflow-y-auto px-2 py-2">
          {q && (
            <button
              type="button"
              onClick={() => ask(query.trim())}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left hover:bg-accent"
            >
              <Search className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1 text-[13.5px]">
                Preguntar: <span className="font-medium text-foreground">{query.trim()}</span>
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          )}

          {filteredSugs.length > 0 && (
            <div className="mb-1 mt-1">
              <div className="px-3 pb-1 pt-2 text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground">
                Sugerencias
              </div>
              {filteredSugs.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => ask(s.prompt)}
                  className="flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left hover:bg-accent"
                >
                  <AssistantMark className="mt-0.5 h-4 w-4 text-primary/80" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-medium">{s.label}</div>
                    <div className="truncate text-[11.5px] text-muted-foreground">{s.prompt}</div>
                  </div>
                  <span className="self-center text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground/70">
                    {s.scope}
                  </span>
                </button>
              ))}
            </div>
          )}

          {filteredNav.length > 0 && (
            <div className="mb-1 mt-1">
              <div className="px-3 pb-1 pt-2 text-[10.5px] uppercase tracking-[0.16em] text-muted-foreground">
                Navegar
              </div>
              {filteredNav.map((n) => (
                <button
                  key={n.to}
                  type="button"
                  onClick={() => go(n.to)}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left hover:bg-accent"
                >
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[13.5px]">{n.label}</span>
                </button>
              ))}
            </div>
          )}

          {!filteredSugs.length && !filteredNav.length && !q && (
            <div className="px-4 py-8 text-center text-[12.5px] text-muted-foreground">
              Sin resultados.
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border bg-muted/30 px-4 py-2 text-[10.5px] text-muted-foreground">
          <span>Asistente · respuestas simuladas</span>
          <span className="hidden sm:inline">
            <kbd className="rounded border border-border px-1.5 py-0.5 font-mono">⌘K</kbd> para
            abrir
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
