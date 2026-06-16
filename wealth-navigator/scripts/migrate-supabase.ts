// One-shot migration: Lovable Supabase → propio Supabase
// Usage:
//   OLD_URL=... OLD_KEY=... NEW_URL=... NEW_KEY=... EMAIL=... PASS=... npx tsx scripts/migrate-supabase.ts

import { createClient } from "@supabase/supabase-js";

const OLD_URL = process.env.OLD_URL!;
const OLD_KEY = process.env.OLD_KEY!;
const NEW_URL = process.env.NEW_URL!;
const NEW_KEY = process.env.NEW_KEY!;
const EMAIL = process.env.EMAIL!;
const PASS = process.env.PASS!;

if (!OLD_URL || !OLD_KEY || !NEW_URL || !NEW_KEY || !EMAIL || !PASS) {
  console.error("Missing env vars: OLD_URL OLD_KEY NEW_URL NEW_KEY EMAIL PASS");
  process.exit(1);
}

const oldClient = createClient(OLD_URL, OLD_KEY);
const newClient = createClient(NEW_URL, NEW_KEY);

async function signIn(client: ReturnType<typeof createClient>, email: string, password: string, label: string) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Auth failed on ${label}: ${error.message}`);
  console.log(`   ${label} user_id: ${data.user!.id}`);
  return data.user!.id;
}

async function signUp(client: ReturnType<typeof createClient>, email: string, password: string) {
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) throw new Error(`Signup failed: ${error.message}`);
  if (!data.user) throw new Error("Signup returned no user — check email confirmation is disabled in Auth settings");
  return data.user.id;
}

async function fetchTable(client: ReturnType<typeof createClient>, table: string, userId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any).from(table).select("*").eq("user_id", userId);
  if (error) throw new Error(`Fetch ${table} failed: ${error.message}`);
  return (data ?? []) as Record<string, unknown>[];
}

async function fetchProfiles(client: ReturnType<typeof createClient>, userId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any).from("profiles").select("*").eq("id", userId);
  if (error) throw new Error(`Fetch profiles failed: ${error.message}`);
  return (data ?? []) as Record<string, unknown>[];
}

function substituteUserId(rows: Record<string, unknown>[], oldId: string, newId: string) {
  return rows.map((row) => {
    const updated: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      updated[k] = v === oldId ? newId : v;
    }
    return updated;
  });
}

async function upsert(client: ReturnType<typeof createClient>, table: string, rows: Record<string, unknown>[], conflictCol = "id") {
  if (rows.length === 0) { console.log(`  ${table}: 0 rows (skip)`); return; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (client as any).from(table).upsert(rows, { onConflict: conflictCol });
  if (error) throw new Error(`Upsert ${table} failed: ${error.message}`);
  console.log(`  ${table}: ${rows.length} rows ✓`);
}

async function main() {
  console.log("=== Wealth OS Supabase Migration ===\n");

  console.log("1. Authenticating in old project...");
  const oldUserId = await signIn(oldClient, EMAIL, PASS, "old");

  console.log("\n2. Exporting data from old project...");
  const [profiles, roles, movements, positions, snapshots] = await Promise.all([
    fetchProfiles(oldClient, oldUserId),
    fetchTable(oldClient, "user_roles", oldUserId),
    fetchTable(oldClient, "movements", oldUserId),
    fetchTable(oldClient, "portfolio_positions", oldUserId),
    fetchTable(oldClient, "monthly_snapshots", oldUserId),
  ]);
  console.log(`   profiles: ${profiles.length}, roles: ${roles.length}, movements: ${movements.length}, positions: ${positions.length}, snapshots: ${snapshots.length}`);

  console.log("\n3. Authenticating in new project...");
  let newUserId: string;
  const { data: loginData, error: loginError } = await newClient.auth.signInWithPassword({ email: EMAIL, password: PASS });
  if (!loginError && loginData.user) {
    newUserId = loginData.user.id;
    console.log(`   new user_id: ${newUserId}`);
  } else {
    console.log("   User not found, signing up...");
    const { data: signupData, error: signupError } = await newClient.auth.signUp({ email: EMAIL, password: PASS });
    if (signupError) throw new Error(`Signup failed: ${signupError.message}`);
    if (!signupData.user) throw new Error("Signup returned no user — disable 'Confirm email' in Auth → Providers → Email");
    await new Promise(r => setTimeout(r, 1500)); // wait for trigger
    // Sign in explicitly to get an active session (signup session may be null if confirmation is pending)
    const { data: reloginData, error: reloginError } = await newClient.auth.signInWithPassword({ email: EMAIL, password: PASS });
    if (reloginError) throw new Error(`Login after signup failed: ${reloginError.message}\nEnsure 'Confirm email' is DISABLED in Authentication → Providers → Email`);
    newUserId = reloginData.user!.id;
    console.log(`   new user_id: ${newUserId}`);
  }

  console.log("\n4. Migrating data...");

  // profiles: PK is id (= user_id), fix both id and any user_id field
  const newProfiles = profiles.map(p => ({ ...p, id: newUserId }));
  await upsert(newClient, "profiles", newProfiles, "id");

  // user_roles: skipped — trigger on_auth_user_created already inserted 'user' role on signup
  console.log(`  user_roles: skipped (trigger handles it) — exported ${roles.length} rows`);

  await upsert(newClient, "movements", substituteUserId(movements, oldUserId, newUserId));
  await upsert(newClient, "portfolio_positions", substituteUserId(positions, oldUserId, newUserId));
  await upsert(newClient, "monthly_snapshots", substituteUserId(snapshots, oldUserId, newUserId));

  console.log("\n=== Migration complete ===");
  console.log(`  movements: ${movements.length}`);
  console.log(`  portfolio_positions: ${positions.length}`);
  console.log(`  monthly_snapshots: ${snapshots.length}`);
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
