import { type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { AssistantMark } from "@/components/assistant/AssistantMark";

type Props = {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Si se define, muestra un botón "Preguntar" que abre /assistant con este prompt. */
  askPrompt?: string;
};

export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  askPrompt,
}: Props) {
  const navigate = useNavigate();
  return (
    <section
      className={cn(
        "group/section relative overflow-hidden rounded-xl border border-border bg-card",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h3 className="font-display text-[15px] font-semibold tracking-tight text-foreground">
            {title}
          </h3>
          {description ? (
            <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {askPrompt ? (
            <button
              type="button"
              onClick={() => navigate({ to: "/assistant", search: { q: askPrompt } })}
              title="Preguntar al Asistente sobre esta tarjeta"
              className="inline-flex items-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-[11.5px] font-medium text-muted-foreground opacity-0 transition hover:border-border hover:bg-background hover:text-foreground focus:opacity-100 group-hover/section:opacity-100"
            >
              <AssistantMark className="h-3.5 w-3.5 text-primary" />
              <span className="hidden md:inline">Preguntar</span>
            </button>
          ) : null}
          {actions}
        </div>
      </header>
      <div className={cn("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border bg-background px-4 py-7 md:px-8">
      <div className="min-w-0">
        {eyebrow ? (
          <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="font-display text-[34px] font-semibold leading-none tracking-tight text-foreground md:text-[40px]">
          {title}
        </h1>
        {description ? (
          <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
      <span className="h-px w-6 bg-border" />
      {children}
    </div>
  );
}
