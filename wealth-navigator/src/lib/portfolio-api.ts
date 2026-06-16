import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type PortfolioAssetType =
  | "stock"
  | "etf"
  | "fund"
  | "crypto"
  | "gold"
  | "bond"
  | "broker_cash"
  | "other";

export type PortfolioPosition = {
  id: string;
  assetId: string;
  assetName: string;
  ticker: string;
  isin: string;
  assetType: PortfolioAssetType;
  platform: string;
  quantity: number;
  avgCost: number;
  currentPrice: number;
  currency: string;
  notes: string;
  openedAt: string;
  updatedAt: string;
  priceUpdatedAt: string | null;
  priceSource: string;
  rateToEur: number;
  costBasis: number;
  marketValue: number;
  pnlValue: number;
  pnlPct: number | null;
  costBasisEur: number;
  marketValueEur: number;
  pnlValueEur: number;
  portfolioWeight: number;
};

export const ASSET_TYPE_LABELS: Record<PortfolioAssetType, string> = {
  stock: "Acciones",
  etf: "ETF",
  fund: "Fondo",
  crypto: "Crypto",
  gold: "Oro / Metales",
  bond: "Bonos",
  broker_cash: "Cash en broker",
  other: "Otro",
};

export const COMMON_PLATFORMS = [
  "Trade Republic",
  "MyInvestor",
  "IBRK",
  "Criptan",
  "Revolut",
  "BBVA",
  "N26",
  "Degiro",
  "Interactive Brokers",
];

export const COMMON_CURRENCIES = ["EUR", "USD", "GBP", "CAD", "CHF"];

// Supabase asset_type enum (lacks 'gold' — map it to 'other')
type SupabaseAssetType = "etf" | "stock" | "crypto" | "fund" | "bond" | "broker_cash" | "other";

function toSupabaseAssetType(t: PortfolioAssetType): SupabaseAssetType {
  if (t === "gold") return "other";
  return t as SupabaseAssetType;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToPosition(row: any, totalMarketValueEur: number): PortfolioPosition {
  const quantity = Number(row.quantity);
  const avgCost = Number(row.avg_cost);
  const currentPrice = Number(row.current_price);
  // Simplified: assume rateToEur = 1 (no FX service)
  const rateToEur = 1;
  const costBasis = quantity * avgCost;
  const marketValue = quantity * currentPrice;
  const pnlValue = marketValue - costBasis;
  const pnlPct = costBasis > 0 ? pnlValue / costBasis : null;
  const costBasisEur = costBasis * rateToEur;
  const marketValueEur = marketValue * rateToEur;
  const pnlValueEur = pnlValue * rateToEur;
  const portfolioWeight = totalMarketValueEur > 0 ? (marketValueEur / totalMarketValueEur) * 100 : 0;

  return {
    id: row.id,
    assetId: row.id,
    assetName: row.asset_name,
    ticker: row.ticker ?? "",
    isin: row.isin ?? "",
    assetType: (row.asset_type as PortfolioAssetType) ?? "other",
    platform: row.platform ?? "",
    quantity,
    avgCost,
    currentPrice,
    currency: row.currency ?? "EUR",
    notes: row.notes ?? "",
    openedAt: row.created_at,
    updatedAt: row.updated_at,
    priceUpdatedAt: row.updated_at,
    priceSource: "manual",
    rateToEur,
    costBasis,
    marketValue,
    pnlValue,
    pnlPct,
    costBasisEur,
    marketValueEur,
    pnlValueEur,
    portfolioWeight,
  };
}

export function usePortfolioPositions() {
  const { user } = useAuth();
  return useQuery<PortfolioPosition[]>({
    queryKey: ["portfolio-positions", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("portfolio_positions")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      const rows = data ?? [];
      // First pass: compute total to derive weights
      const rawTotals = rows.reduce((sum: number, r: Record<string, unknown>) => sum + Number(r.quantity) * Number(r.current_price), 0);
      return rows.map((row: Record<string, unknown>) => rowToPosition(row, rawTotals));
    },
    enabled: !!user,
    staleTime: 30_000,
  });
}

export type CreatePositionInput = {
  assetName: string;
  ticker?: string;
  isin?: string;
  assetType: PortfolioAssetType;
  platform: string;
  quantity: number;
  avgCost: number;
  currentPrice: number;
  currency?: string;
  notes?: string;
  date?: string;
};

export function useCreatePosition() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: CreatePositionInput) => {
      if (!user) throw new Error("No autenticado");
      const { data, error } = await supabase
        .from("portfolio_positions")
        .insert({
          user_id: user.id,
          asset_name: input.assetName,
          ticker: input.ticker ?? null,
          isin: input.isin ?? null,
          asset_type: toSupabaseAssetType(input.assetType),
          platform: input.platform,
          quantity: input.quantity,
          avg_cost: input.avgCost,
          current_price: input.currentPrice,
          currency: input.currency ?? "EUR",
          notes: input.notes ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolio-positions"] });
      qc.invalidateQueries({ queryKey: ["dashboard-snapshot"] });
    },
  });
}

export function useUpdatePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string } & Partial<CreatePositionInput>) => {
      const { data, error } = await supabase
        .from("portfolio_positions")
        .update({
          ...(patch.assetName !== undefined && { asset_name: patch.assetName }),
          ...(patch.ticker !== undefined && { ticker: patch.ticker ?? null }),
          ...(patch.isin !== undefined && { isin: patch.isin ?? null }),
          ...(patch.assetType !== undefined && {
            asset_type: toSupabaseAssetType(patch.assetType),
          }),
          ...(patch.platform !== undefined && { platform: patch.platform }),
          ...(patch.quantity !== undefined && { quantity: patch.quantity }),
          ...(patch.avgCost !== undefined && { avg_cost: patch.avgCost }),
          ...(patch.currentPrice !== undefined && { current_price: patch.currentPrice }),
          ...(patch.currency !== undefined && { currency: patch.currency }),
          ...(patch.notes !== undefined && { notes: patch.notes ?? null }),
        })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolio-positions"] });
      qc.invalidateQueries({ queryKey: ["dashboard-snapshot"] });
    },
  });
}

export function useDeletePosition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("portfolio_positions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portfolio-positions"] });
      qc.invalidateQueries({ queryKey: ["dashboard-snapshot"] });
    },
  });
}
