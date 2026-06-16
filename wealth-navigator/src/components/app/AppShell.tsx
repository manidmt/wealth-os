import { type ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { formatMonth } from "@/lib/dashboard-data";
import { useDashboard } from "@/hooks/use-dashboard";
import { useAssistant } from "@/components/assistant/AssistantProvider";
import { AssistantMark } from "@/components/assistant/AssistantMark";
import { ThemeToggle } from "@/components/app/ThemeToggle";
import { CurrencySwitcher } from "@/components/app/CurrencySwitcher";

type Props = {
  children: ReactNode;
  /** Page title shown next to sidebar trigger in the topbar (optional). */
  pageEyebrow?: string;
};

export function AppShell({ children, pageEyebrow }: Props) {
  const data = useDashboard();
  const assistant = useAssistant();
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-background/85 px-4 backdrop-blur md:px-6">
            <div className="flex items-center gap-3 min-w-0">
              <SidebarTrigger className="-ml-1" />
              <div className="hidden h-5 w-px bg-border sm:block" />
              <div className="flex min-w-0 items-baseline gap-2">
                {pageEyebrow ? (
                  <span className="truncate text-[12px] uppercase tracking-[0.16em] text-muted-foreground">
                    {pageEyebrow}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
              <button
                type="button"
                onClick={assistant.open}
                title="Asistente (⌘K)"
                className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-[11.5px] font-medium text-foreground/80 transition hover:border-border-strong hover:text-foreground"
              >
                <AssistantMark className="h-3.5 w-3.5 text-primary" />
                <span className="hidden sm:inline">Preguntar</span>
                <kbd className="hidden rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">
                  ⌘K
                </kbd>
              </button>
              <span className="hidden text-border md:inline">·</span>
              <div className="hidden items-center gap-1.5 sm:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-positive" />
                <span>
                {data.currentCalendarMonth > data.latestClosedMonth
                  ? `En curso · ${formatMonth(data.currentCalendarMonth)}`
                  : `Cierre ${formatMonth(data.latestClosedMonth)}`}
              </span>
              </div>
              <span className="hidden text-border md:inline">·</span>
              <CurrencySwitcher />
              <ThemeToggle compact className="ml-1" />
            </div>
          </header>

          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
