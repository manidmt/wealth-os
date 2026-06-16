import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { AppShell } from "@/components/app/AppShell";
import { PageHeader } from "@/components/app/SectionCard";
import { PlanningTabs, type PlanningTab } from "@/components/planning/PlanningTabs";

const searchSchema = z.object({
  tab: z.enum(["inversion", "gastos"]).optional(),
});

export const Route = createFileRoute("/planning")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Planificación — Wealth OS" },
      {
        name: "description",
        content:
          "Planifica tus inversiones (DCA, estructuras) y tus gastos mensuales (presupuesto, ahorro).",
      },
    ],
  }),
  component: PlanningPage,
});

function PlanningPage() {
  const navigate = useNavigate();
  const { tab } = Route.useSearch();
  const active: PlanningTab = tab ?? "inversion";

  return (
    <AppShell pageEyebrow="Planificación">
      <PageHeader
        eyebrow="Planificación"
        title="Planificación"
        description="Organiza tus inversiones y tus gastos mensuales."
      />
      <PlanningTabs
        tab={active}
        onTabChange={(t) => navigate({ to: "/planning", search: { tab: t }, replace: true })}
      />
    </AppShell>
  );
}
