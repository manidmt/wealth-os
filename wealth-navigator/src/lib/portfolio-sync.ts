import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { InvestmentPlan } from "./planning-api";
import { suggestPosition } from "./position-match";

/** Recalcula cantidad y precio medio ponderado al añadir una aportación. */
export function applyContribution(
  pos: { quantity: number; avg_cost: number },
  amount: number,
  units: number,
): { quantity: number; avg_cost: number } {
  const newQty = pos.quantity + units;
  if (newQty <= 0) return { quantity: pos.quantity, avg_cost: pos.avg_cost };
  const newAvg = (pos.quantity * pos.avg_cost + amount) / newQty;
  return { quantity: newQty, avg_cost: newAvg };
}

const ASSET_TYPE_BY_CLASS: Record<string, string> = {
  rv_core: "fund",
  rv_opp: "etf",
  gold: "other",
  btc: "crypto",
  rf: "bond",
};

/**
 * Vuelca una aportación (con precio) a la posición de portfolio vinculada:
 * actualiza si existe, la resuelve por matcher difuso o la crea si no hay.
 */
export function useSyncContributionToPosition() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { plan: InvestmentPlan; amount: number; units: number }) => {
      const { plan, amount, units } = input;
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

      if (targetId) {
        const pos = all.find((p) => p.id === targetId);
        if (pos) {
          const newQty = Number(pos.quantity) + units;
          const newAvg =
            newQty > 0 ? (Number(pos.quantity) * Number(pos.avg_cost) + amount) / newQty : 0;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error } = await (supabase as any)
            .from("portfolio_positions")
            .update({ quantity: newQty, avg_cost: newAvg })
            .eq("id", targetId);
          if (error) throw error;
        }
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: created, error: cErr } = await (supabase as any)
          .from("portfolio_positions")
          .insert({
            user_id: user!.id,
            asset_name: plan.asset_name,
            asset_type: ASSET_TYPE_BY_CLASS[plan.asset_class ?? ""] ?? "other",
            platform: "",
            quantity: units,
            avg_cost: price,
            current_price: price,
            currency: "EUR",
          })
          .select("id")
          .single();
        if (cErr) throw cErr;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any)
          .from("investment_plans")
          .update({ portfolio_position_id: created.id })
          .eq("id", plan.id);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolio-positions"] });
      qc.invalidateQueries({ queryKey: ["investment_plans"] });
      qc.invalidateQueries({ queryKey: ["dashboard-snapshot"] });
    },
  });
}
