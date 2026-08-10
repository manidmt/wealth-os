/**
 * Backfill one-shot: puebla position_lots para las posiciones ya existentes.
 * Uso: SUPABASE_URL=... SERVICE_ROLE_KEY=... npx tsx scripts/backfill-position-lots.ts
 */
import { createClient } from "@supabase/supabase-js";
import { computeBackfillLots, type BackfillContribution } from "../src/lib/position-lots-backfill";

const db = createClient(process.env.SUPABASE_URL!, process.env.SERVICE_ROLE_KEY!);

async function main() {
  const { data: positions, error: posErr } = await db
    .from("portfolio_positions")
    .select("id, user_id, quantity, avg_cost, created_at");
  if (posErr) throw posErr;

  const { data: plans, error: plansErr } = await db
    .from("investment_plans")
    .select("id, portfolio_position_id")
    .not("portfolio_position_id", "is", null);
  if (plansErr) throw plansErr;

  const { data: contributions, error: contribErr } = await db
    .from("plan_contributions")
    .select("id, plan_id, date, price, units");
  if (contribErr) throw contribErr;

  const positionIdByPlanId = new Map(
    (plans ?? []).map((p) => [p.id, p.portfolio_position_id as string]),
  );
  const contribsByPositionId = new Map<string, BackfillContribution[]>();
  for (const c of contributions ?? []) {
    const positionId = positionIdByPlanId.get(c.plan_id);
    if (!positionId) continue;
    const list = contribsByPositionId.get(positionId) ?? [];
    list.push({ id: c.id, date: c.date, price: c.price, units: c.units });
    contribsByPositionId.set(positionId, list);
  }

  let skipped = 0;
  let inserted = 0;

  for (const position of positions ?? []) {
    const { count, error: countErr } = await db
      .from("position_lots")
      .select("id", { count: "exact", head: true })
      .eq("position_id", position.id);
    if (countErr) throw countErr;
    if ((count ?? 0) > 0) {
      console.log(`skip ${position.id}: ya tiene ${count} lote(s)`);
      skipped++;
      continue;
    }

    const contribs = contribsByPositionId.get(position.id) ?? [];
    const lots = computeBackfillLots(position, contribs);
    const { error: insErr } = await db
      .from("position_lots")
      .insert(lots.map((l) => ({ ...l, user_id: position.user_id })));
    if (insErr) throw insErr;
    console.log(`${position.id}: ${lots.length} lote(s) insertados`);
    inserted += lots.length;
  }

  console.log(`\nHecho. ${inserted} lotes insertados, ${skipped} posiciones ya tenían lotes.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
