import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import rawData from "@/data/dashboard-data.json";

export type Holding = {
  label: string;
  category?: string;
  platform: string;
  value: number;
};

export type SeriesPoint = {
  month: string;
  assets: number;
  liabilities: number;
  netWorth: number;
  savings: number;
};

export type ExpenseMonth = {
  month: string;
  value: number;
  expenseTotal: number;
  incomeTotal: number;
  net: number;
};

export type DashboardData = {
  owner: string;
  generatedAt: string;
  currentCalendarMonth: string;
  latestClosedMonth: string;
  latestMonth: string;
  summary: {
    totalAssets: number;
    totalLiabilities: number;
    netWorth: number;
    monthlyChange: number;
    latestSavings: number;
  };
  allocation: { label: string; value: number }[];
  platforms: { label: string; value: number }[];
  holdings: Holding[];
  portfolio: {
    holdings: Holding[];
    byPlatform: { label: string; value: number }[];
  };
  expenses: {
    currentMonth: string;
    currentMonthTotal: number;
    currentMonthIncome: number;
    currentMonthCategories: { label: string; value: number }[];
    byMonth: ExpenseMonth[];
  };
  series: SeriesPoint[];
};

export const data = rawData as DashboardData;

const ASSET_LABELS: Record<string, string> = {
  stock: "Acciones", etf: "ETF", fund: "Fondo", crypto: "Crypto",
  gold: "Oro / Metales", bond: "Bonos", broker_cash: "Cash en broker", other: "Otro",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function computeDashboard(movements: any[], positions: any[], snapshots: any[]): DashboardData {
  const now = new Date();
  const currentCalendarMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // Group movements by month
  type MonthEntry = { income: number; expense: number; categories: Map<string, number> };
  const byMonthMap = new Map<string, MonthEntry>();
  for (const m of movements) {
    if (m.excluded) continue;
    const month = (m.date as string).slice(0, 7);
    if (!byMonthMap.has(month)) byMonthMap.set(month, { income: 0, expense: 0, categories: new Map() });
    const entry = byMonthMap.get(month)!;
    const amount = Number(m.amount);
    if (m.type === "income") {
      entry.income += amount;
    } else {
      entry.expense += amount;
      entry.categories.set(m.category, (entry.categories.get(m.category) ?? 0) + amount);
    }
  }

  const months = [...byMonthMap.keys()].sort();
  const byMonth: ExpenseMonth[] = months.map((month) => {
    const { income, expense } = byMonthMap.get(month)!;
    return { month, value: expense, expenseTotal: expense, incomeTotal: income, net: income - expense };
  });


  // Portfolio
  const totalPortfolio = positions.reduce(
    (s: number, p: Record<string, unknown>) => s + Number(p.quantity) * Number(p.current_price),
    0,
  );

  const byPlatformMap = new Map<string, number>();
  const byCategoryMap = new Map<string, number>();
  for (const p of positions) {
    const val = Number((p as Record<string, unknown>).quantity) * Number((p as Record<string, unknown>).current_price);
    const platform = (p as Record<string, unknown>).platform as string || "Sin plataforma";
    byPlatformMap.set(platform, (byPlatformMap.get(platform) ?? 0) + val);
    const cat = (p as Record<string, unknown>).asset_type as string || "other";
    byCategoryMap.set(ASSET_LABELS[cat] ?? cat, (byCategoryMap.get(ASSET_LABELS[cat] ?? cat) ?? 0) + val);
  }

  const byPlatform = [...byPlatformMap.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  const holdings: Holding[] = positions
    .map((p: Record<string, unknown>) => ({
      label: p.asset_name as string,
      category: p.asset_type as string,
      platform: (p.platform as string) ?? "",
      value: Number(p.quantity) * Number(p.current_price),
    }))
    .sort((a, b) => b.value - a.value);

  const allocation = [...byCategoryMap.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  // Series from real snapshots (sorted by month)
  const snapshotMap = new Map<string, { netWorth: number; assets: number; liabilities: number }>();
  for (const s of snapshots) {
    snapshotMap.set(s.month as string, {
      netWorth: Number(s.net_worth),
      assets: Number(s.assets),
      liabilities: Number(s.liabilities),
    });
  }

  // Build series by walking months chronologically from the oldest snapshot (anchor).
  // Where a snapshot exists, use it verbatim (accurate). For months with only movements
  // (no snapshot), estimate: prev_net_worth + net_savings. This means no manual monthly
  // closing is required — the series auto-extends from movements alone.
  type SnapRecord = Record<string, unknown>;
  const snapMap = new Map<string, SnapRecord>();
  for (const s of snapshots) snapMap.set(s.month as string, s as SnapRecord);
  const latestSnap = snapshots.length > 0 ? snapshots[snapshots.length - 1] as SnapRecord : null;
  const oldestSnap = snapshots.length > 0 ? snapshots[0] as SnapRecord : null;

  let series: SeriesPoint[];

  if (!oldestSnap) {
    // No anchor at all — accumulate savings as a relative approximation.
    let prev = 0;
    series = months.map((month) => {
      const e = byMonthMap.get(month)!;
      const savings = e.income - e.expense;
      prev += savings;
      return { month, assets: Math.max(0, prev), liabilities: 0, netWorth: prev, savings };
    });
  } else {
    const oldestMonth = oldestSnap.month as string;

    // All months starting from the oldest anchor (union of snapshot months + movement months).
    const allMonths = [...new Set([
      ...[...snapMap.keys()],
      ...months.filter((m) => m >= oldestMonth),
    ])].sort();

    let prevNW = Number(oldestSnap.net_worth);
    let prevAssets = Number(oldestSnap.assets);
    let prevLiabilities = Number(oldestSnap.liabilities);
    series = [];

    for (const month of allMonths) {
      const movEntry = byMonthMap.get(month);
      const savings = movEntry ? movEntry.income - movEntry.expense : 0;

      if (snapMap.has(month)) {
        const snap = snapMap.get(month)!;
        prevNW = Number(snap.net_worth);
        prevAssets = Number(snap.assets);
        prevLiabilities = Number(snap.liabilities);
      } else {
        // Estimate: carry forward liabilities, apply net savings to assets and net worth.
        prevAssets += savings;
        prevNW += savings;
      }
      series.push({ month, assets: prevAssets, liabilities: prevLiabilities, netWorth: prevNW, savings });
    }
  }

  const latestClosedMonth = latestSnap
    ? (latestSnap.month as string)
    : (months[months.length - 1] ?? currentCalendarMonth);

  // Current month (always live, never requires a manual close).
  // Net worth = last closed month's NW + current savings + portfolio value delta.
  const currentMovEntry = byMonthMap.get(currentCalendarMonth);
  const currentSavings = currentMovEntry ? currentMovEntry.income - currentMovEntry.expense : 0;
  const snapPortfolioValue = latestSnap ? Number(latestSnap.portfolio_value ?? 0) : 0;
  // When no snapshot tracks portfolio_value, add the full portfolio (no prior baseline to delta against).
  const portfolioDelta = latestSnap && snapPortfolioValue > 0
    ? totalPortfolio - snapPortfolioValue
    : totalPortfolio;
  // Use the last *closed* month (before current calendar month) as the NW base.
  const prevClosedEntry = [...series].reverse().find((s) => s.month < currentCalendarMonth) ?? null;
  const baseNW = prevClosedEntry ? prevClosedEntry.netWorth : 0;
  const baseLiabilities = prevClosedEntry ? prevClosedEntry.liabilities : 0;
  const liveNW = baseNW + currentSavings + portfolioDelta;

  // Always write a live entry for the current month (overrides any estimate from the series loop).
  const liveEntryData = {
    month: currentCalendarMonth,
    assets: liveNW - baseLiabilities,
    liabilities: baseLiabilities,
    netWorth: liveNW,
    savings: currentSavings,
  };
  const existingIdx = series.findIndex((s) => s.month === currentCalendarMonth);
  if (existingIdx >= 0) {
    series[existingIdx] = liveEntryData;
  } else {
    series.push(liveEntryData);
  }

  const liveEntry = series.find((s) => s.month === currentCalendarMonth)!;
  const liveIdx = series.findIndex((s) => s.month === currentCalendarMonth);
  const prevEntry = liveIdx > 0 ? series[liveIdx - 1] : null;
  const monthlyChange = prevEntry ? liveEntry.netWorth - prevEntry.netWorth : currentSavings;

  const currentMonthCats = currentMovEntry
    ? [...currentMovEntry.categories.entries()]
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value)
    : [];

  return {
    owner: "me",
    generatedAt: new Date().toISOString(),
    currentCalendarMonth,
    latestClosedMonth,
    latestMonth: currentCalendarMonth,
    summary: {
      totalAssets: liveEntry.assets,
      totalLiabilities: liveEntry.liabilities,
      netWorth: liveEntry.netWorth,
      monthlyChange,
      latestSavings: currentSavings,
    },
    allocation,
    platforms: byPlatform,
    holdings,
    portfolio: { holdings, byPlatform },
    expenses: {
      currentMonth: currentCalendarMonth,
      currentMonthTotal: currentMovEntry?.expense ?? 0,
      currentMonthIncome: currentMovEntry?.income ?? 0,
      currentMonthCategories: currentMonthCats,
      byMonth,
    },
    series,
  };
}

export function useLiveDashboardData() {
  const { user } = useAuth();
  return useQuery<DashboardData>({
    queryKey: ["dashboard-snapshot", user?.id],
    queryFn: async () => {
      const [{ data: movements, error: movErr }, { data: positions, error: posErr }, { data: snapshots, error: snapErr }] =
        await Promise.all([
          supabase.from("movements").select("type, date, category, amount, currency, excluded").order("date"),
          supabase.from("portfolio_positions").select("*"),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (supabase as any).from("monthly_snapshots").select("month, assets, liabilities, net_worth, savings, portfolio_value").order("month"),
        ]);
      if (movErr) throw movErr;
      if (posErr) throw posErr;
      if (snapErr) throw snapErr;
      return computeDashboard(movements ?? [], positions ?? [], snapshots ?? []);
    },
    enabled: !!user,
    placeholderData: rawData as DashboardData,
    staleTime: 30_000,
  });
}

export const euro = new Intl.NumberFormat("es-ES", {
  style: "currency", currency: "EUR", maximumFractionDigits: 0,
});

export const euro1 = new Intl.NumberFormat("es-ES", {
  style: "currency", currency: "EUR", maximumFractionDigits: 1,
});

export const euro2 = new Intl.NumberFormat("es-ES", {
  style: "currency", currency: "EUR", maximumFractionDigits: 2,
});

export const pct = new Intl.NumberFormat("es-ES", {
  style: "percent", maximumFractionDigits: 1,
});

export function formatPercent(value: number) {
  return pct.format(value);
}

export function formatMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return new Date(y, m - 1, 1).toLocaleDateString("es-ES", { month: "short", year: "numeric" });
}

export function monthShort(month: string) {
  const [, m] = month.split("-").map(Number);
  return ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"][
    (m ?? 1) - 1
  ];
}
