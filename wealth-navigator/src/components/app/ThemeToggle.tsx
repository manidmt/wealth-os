import { Moon, Sun } from "lucide-react";
import { useTheme } from "./ThemeProvider";

type Props = {
  /** Compact: icon-only square. Default false renders a labelled pill. */
  compact?: boolean;
  className?: string;
};

export function ThemeToggle({ compact = false, className }: Props) {
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => setTheme(isDark ? "light" : "dark")}
        title={isDark ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
        aria-label="Cambiar tema"
        className={
          "inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition hover:border-border-strong hover:text-foreground " +
          (className ?? "")
        }
      >
        {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Tema"
      className={
        "inline-flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5 " +
        (className ?? "")
      }
    >
      {(
        [
          { v: "light", icon: Sun, label: "Claro" },
          { v: "dark", icon: Moon, label: "Oscuro" },
        ] as const
      ).map(({ v, icon: Icon, label }) => {
        const active = theme === v;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(v)}
            className={
              "inline-flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-[12px] font-medium transition " +
              (active
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
