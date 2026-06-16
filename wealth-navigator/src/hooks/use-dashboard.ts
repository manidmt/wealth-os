import { createContext, useContext } from "react";
import type { DashboardData } from "@/lib/dashboard-data";

export const DashboardContext = createContext<DashboardData | null>(null);

export function useDashboard(): DashboardData {
  const ctx = useContext(DashboardContext);
  if (!ctx) throw new Error("useDashboard must be used inside DashboardContext.Provider");
  return ctx;
}
