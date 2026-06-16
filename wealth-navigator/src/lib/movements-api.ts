import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type MovementType = "expense" | "income";

export type MovementRecord = {
  id: string;
  type: MovementType;
  date: string;
  month: string;
  category: string;
  description: string;
  amount: number;
  currency: string;
  excluded: boolean;
  duplicate_of: string | null;
};

export type CreateMovementInput = {
  type: MovementType;
  date: string;
  category: string;
  description?: string;
  amount: number;
  currency?: string;
  excluded?: boolean;
  duplicate_of?: string | null;
};

export const EXPENSE_CATEGORIES = [
  "Café",
  "Coche",
  "Comer fuera",
  "Comida",
  "Cuidado personal",
  "Deporte",
  "Educación",
  "Formación",
  "Gestiones",
  "Gimnasio",
  "Higiene",
  "Hogar",
  "Impuestos",
  "Ocio",
  "Otro",
  "Regalo",
  "Ropa",
  "Salud",
  "Suplementos",
  "Suscripciones",
  "Tecnología",
  "Transporte",
  "Viaje",
];

export const INCOME_CATEGORIES = [
  "Nómina",
  "Salario",
  "Extra",
  "Tarjeta Restaurante",
  "Ticket restaurante",
  "Comer fuera",
  "Otros ingresos",
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToRecord(row: any): MovementRecord {
  const date = row.date as string;
  return {
    id: row.id,
    type: row.type as MovementType,
    date,
    month: date.slice(0, 7),
    category: row.category,
    description: row.description ?? "",
    amount: Number(row.amount),
    currency: row.currency ?? "EUR",
    excluded: row.excluded ?? false,
    duplicate_of: row.duplicate_of ?? null,
  };
}

export function useMonthMovements(month: string | null) {
  const { user } = useAuth();
  return useQuery<MovementRecord[]>({
    queryKey: ["month-movements", month, user?.id],
    queryFn: async () => {
      if (!month) return [];
      const [y, mo] = month.split("-").map(Number);
      const nextMonth = mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, "0")}-01`;
      const { data, error } = await supabase
        .from("movements")
        .select("id, type, date, category, description, amount, currency, excluded, duplicate_of")
        .gte("date", `${month}-01`)
        .lt("date", nextMonth)
        .order("date", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(rowToRecord);
    },
    enabled: !!month && !!user,
    staleTime: 15_000,
  });
}

export function useCreateMovement() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: CreateMovementInput) => {
      if (!user) throw new Error("No autenticado");
      const { data, error } = await supabase
        .from("movements")
        .insert({
          user_id: user.id,
          type: input.type,
          date: input.date,
          category: input.category,
          description: input.description ?? null,
          amount: input.amount,
          currency: input.currency ?? "EUR",
          excluded: input.excluded ?? false,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, input) => {
      qc.invalidateQueries({ queryKey: ["month-movements", input.date.slice(0, 7)] });
      qc.invalidateQueries({ queryKey: ["dashboard-snapshot"] });
    },
  });
}

export function useUpdateMovement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      month: _month,
      ...patch
    }: { id: string; month: string } & Partial<CreateMovementInput>) => {
      const { data, error } = await supabase
        .from("movements")
        .update({
          ...(patch.type !== undefined && { type: patch.type }),
          ...(patch.date !== undefined && { date: patch.date }),
          ...(patch.category !== undefined && { category: patch.category }),
          ...(patch.description !== undefined && { description: patch.description ?? null }),
          ...(patch.amount !== undefined && { amount: patch.amount }),
          ...(patch.currency !== undefined && { currency: patch.currency }),
          ...(patch.excluded !== undefined && { excluded: patch.excluded }),
          ...(patch.duplicate_of !== undefined && { duplicate_of: patch.duplicate_of }),
        })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, { month }) => {
      qc.invalidateQueries({ queryKey: ["month-movements", month] });
      qc.invalidateQueries({ queryKey: ["dashboard-snapshot"] });
    },
  });
}

export type BulkImportResult = { inserted: number; skipped: number };

type BulkRow = {
  type: MovementType;
  date: string;
  description: string;
  amount: number;
  currency: string;
  external_id: string;
};

export function useBulkImportMovements() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (rows: BulkRow[]): Promise<BulkImportResult> => {
      if (!user) throw new Error("No autenticado");
      const records = rows.map((r) => ({
        user_id: user.id,
        type: r.type,
        date: r.date,
        category: "Sin categoría",
        description: r.description,
        amount: r.amount,
        currency: r.currency,
        external_id: r.external_id,
      }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("movements")
        .upsert(records, { onConflict: "external_id", ignoreDuplicates: true })
        .select("id");
      if (error) throw error;
      const inserted = (data ?? []).length;
      return { inserted, skipped: rows.length - inserted };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["month-movements"] });
      qc.invalidateQueries({ queryKey: ["dashboard-snapshot"] });
    },
  });
}

export function useDeleteMovement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; month: string }) => {
      const { error } = await supabase.from("movements").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, { month }) => {
      qc.invalidateQueries({ queryKey: ["month-movements", month] });
      qc.invalidateQueries({ queryKey: ["dashboard-snapshot"] });
    },
  });
}

export type ExclusionRule = { id: string; user_id: string; match_text: string; created_at: string };

export function useExclusionRules() {
  const { user } = useAuth();
  return useQuery<ExclusionRule[]>({
    queryKey: ["exclusion_rules", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("movement_exclusion_rules")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });
}

export function useCreateExclusionRule() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (match_text: string) => {
      if (!user) throw new Error("No autenticado");
      const { error } = await supabase
        .from("movement_exclusion_rules")
        .upsert(
          { user_id: user.id, match_text: match_text.trim() },
          { onConflict: "user_id,match_text" },
        );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exclusion_rules"] }),
  });
}

export function useDeleteExclusionRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("movement_exclusion_rules").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exclusion_rules"] }),
  });
}

export type CategoryRuleRecord = {
  id: string;
  user_id: string;
  match_text: string;
  category: string;
  created_at: string;
};

export function useCategoryRules() {
  const { user } = useAuth();
  return useQuery<CategoryRuleRecord[]>({
    queryKey: ["category_rules", user?.id],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("movement_category_rules")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });
}

export function useCreateCategoryRule() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { match_text: string; category: string }) => {
      if (!user) throw new Error("No autenticado");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("movement_category_rules")
        .upsert(
          { user_id: user.id, match_text: input.match_text.trim(), category: input.category },
          { onConflict: "user_id,match_text" },
        );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["category_rules"] }),
  });
}

export function useDeleteCategoryRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("movement_category_rules")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["category_rules"] }),
  });
}

/** Movimientos (expense, no excluido) con descripción de los últimos `months` meses. */
export function useRecentMovements(months: number) {
  const { user } = useAuth();
  return useQuery<{ date: string; description: string; amount: number; category: string }[]>({
    queryKey: ["recent_movements", months, user?.id],
    queryFn: async () => {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
      const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("movements")
        .select("date, description, amount, category")
        .eq("type", "expense")
        .eq("excluded", false)
        .gte("date", fmt(start));
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []).map((r: any) => ({
        date: r.date as string,
        description: (r.description as string) ?? "",
        amount: Number(r.amount) || 0,
        category: (r.category as string) ?? "Otro",
      }));
    },
    enabled: !!user,
  });
}
