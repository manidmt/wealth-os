import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { InvestmentPlan } from "./planning-api";
import { suggestPosition } from "./position-match";
import { insertPositionLot } from "./position-lots-api";

const ASSET_TYPE_BY_CLASS: Record<string, string> = {
  rv_core: "fund",
  rv_opp: "etf",
  gold: "other",
  btc: "crypto",
  rf: "bond",
};

/**
 * Vuelca una aportación (con precio) a la posición de portfolio vinculada como
 * un lote de compra: la resuelve por matcher difuso o la crea si no hay.
 */
export function useSyncContributionToPosition() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      plan: InvestmentPlan;
      amount: number;
      units: number;
      date: string;
      contributionId: string;
    }) => {
      const { plan, amount, units, date, contributionId } = input;
      if (units <= 0) return;
      const price = amount / units;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: positions, error: pErr } = await (supabase as any)
        .from("portfolio_positions")
        .select("id, asset_name, quantity, avg_cost");
      if (pErr) throw pErr;
      const all = (positions ?? []) as {
        id: string;
        asset_name: string;
        quantity: number;
        avg_cost: number;
      }[];

      let targetId = plan.portfolio_position_id;
      if (!targetId) {
        const match = suggestPosition(
          plan.name,
          plan.asset_name,
          all.map((p) => ({ id: p.id, assetName: p.asset_name })),
        );
        targetId = match?.id ?? null;
        if (targetId) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (supabase as any)
            .from("investment_plans")
            .update({ portfolio_position_id: targetId })
            .eq("id", plan.id);
        }
      }

      if (!targetId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: created, error: cErr } = await (supabase as any)
          .from("portfolio_positions")
          .insert({
            user_id: user!.id,
            asset_name: plan.asset_name,
            asset_type: ASSET_TYPE_BY_CLASS[plan.asset_class ?? ""] ?? "other",
            platform: "",
            quantity: 0,
            avg_cost: 0,
            current_price: price,
            currency: "EUR",
          })
          .select("id")
          .single();
        if (cErr) throw cErr;
        targetId = created.id;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any)
          .from("investment_plans")
          .update({ portfolio_position_id: targetId })
          .eq("id", plan.id);
      }

      await insertPositionLot({
        user_id: user!.id,
        position_id: targetId!,
        plan_contribution_id: contributionId,
        date,
        quantity: units,
        price,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolio-positions"] });
      qc.invalidateQueries({ queryKey: ["investment_plans"] });
      qc.invalidateQueries({ queryKey: ["dashboard-snapshot"] });
      qc.invalidateQueries({ queryKey: ["position_lots"] });
    },
  });
}
