import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { aggregateLots } from "./position-lots-calc";

export type PositionLot = {
  id: string;
  user_id: string;
  position_id: string;
  plan_contribution_id: string | null;
  date: string;
  quantity: number;
  price: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export function usePositionLots(positionId: string | null) {
  const { user } = useAuth();
  return useQuery<PositionLot[]>({
    queryKey: ["position_lots", positionId],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("position_lots")
        .select("*")
        .eq("position_id", positionId)
        .order("date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user && !!positionId,
  });
}

async function fetchLots(positionId: string): Promise<{ id: string; quantity: number; price: number }[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("position_lots")
    .select("id, quantity, price")
    .eq("position_id", positionId);
  if (error) throw error;
  return data ?? [];
}

async function recomputePositionAggregate(positionId: string): Promise<void> {
  const lots = await fetchLots(positionId);
  const agg = aggregateLots(lots);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("portfolio_positions")
    .update({ quantity: agg.quantity, avg_cost: agg.avg_cost })
    .eq("id", positionId);
  if (error) throw error;
}

export type InsertLotInput = {
  user_id: string;
  position_id: string;
  plan_contribution_id?: string | null;
  date: string;
  quantity: number;
  price: number;
  notes?: string | null;
};

/** Inserta un lote y recalcula el agregado de la posición. Función plana (no hook): la usan tanto useCreateLot como portfolio-sync.ts. */
export async function insertPositionLot(input: InsertLotInput): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from("position_lots").insert({
    user_id: input.user_id,
    position_id: input.position_id,
    plan_contribution_id: input.plan_contribution_id ?? null,
    date: input.date,
    quantity: input.quantity,
    price: input.price,
    notes: input.notes ?? null,
  });
  if (error) throw error;
  await recomputePositionAggregate(input.position_id);
}

function invalidateAfterLotChange(
  qc: ReturnType<typeof useQueryClient>,
  positionId: string,
) {
  qc.invalidateQueries({ queryKey: ["position_lots", positionId] });
  qc.invalidateQueries({ queryKey: ["portfolio-positions"] });
  qc.invalidateQueries({ queryKey: ["dashboard-snapshot"] });
  qc.invalidateQueries({ queryKey: ["plan_contributions"] });
}

export function useCreateLot() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      position_id: string;
      date: string;
      quantity: number;
      price: number;
    }) => {
      await insertPositionLot({ ...input, user_id: user!.id });
    },
    onSuccess: (_d, vars) => invalidateAfterLotChange(qc, vars.position_id),
  });
}

export function useUpdateLot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      position_id: string;
      quantity: number;
      price: number;
    }) => {
      const others = (await fetchLots(input.position_id)).filter((l) => l.id !== input.id);
      const resultingQty = others.reduce((s, l) => s + l.quantity, 0) + input.quantity;
      if (resultingQty <= 0) {
        throw new Error("La cantidad total de la posición no puede quedar en 0 o negativa.");
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: lot, error: lotErr } = await (supabase as any)
        .from("position_lots")
        .select("plan_contribution_id")
        .eq("id", input.id)
        .single();
      if (lotErr) throw lotErr;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("position_lots")
        .update({ quantity: input.quantity, price: input.price })
        .eq("id", input.id);
      if (error) throw error;

      if (lot.plan_contribution_id) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: cErr } = await (supabase as any)
          .from("plan_contributions")
          .update({
            price: input.price,
            units: input.quantity,
            actual_amount: input.quantity * input.price,
          })
          .eq("id", lot.plan_contribution_id);
        if (cErr) throw cErr;
      }

      await recomputePositionAggregate(input.position_id);
    },
    onSuccess: (_d, vars) => invalidateAfterLotChange(qc, vars.position_id),
  });
}

export function useDeleteLot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; position_id: string }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: lot, error: lotErr } = await (supabase as any)
        .from("position_lots")
        .select("plan_contribution_id")
        .eq("id", input.id)
        .single();
      if (lotErr) throw lotErr;
      if (lot.plan_contribution_id) {
        throw new Error("Este lote viene de una aportación del plan — edítalo o bórralo desde Planning.");
      }

      const others = (await fetchLots(input.position_id)).filter((l) => l.id !== input.id);
      if (others.length === 0) {
        throw new Error("No puedes borrar el único lote de una posición.");
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).from("position_lots").delete().eq("id", input.id);
      if (error) throw error;
      await recomputePositionAggregate(input.position_id);
    },
    onSuccess: (_d, vars) => invalidateAfterLotChange(qc, vars.position_id),
  });
}
