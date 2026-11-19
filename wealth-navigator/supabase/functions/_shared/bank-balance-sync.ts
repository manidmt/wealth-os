import { getBalances, getAccountDetails, getSession, sessionAccountUids } from "./enablebanking.ts";
import { pickBalance, findAdoptableAccount, type CashAccountRef } from "./bank-balances.ts";

type Conn = { id: string; user_id: string; institution_name: string; account_ids: string[] };

/**
 * Lee el saldo de cada cuenta de la conexión y lo vuelca en cash_accounts.
 * Una cuenta manual con el mismo nombre que el banco se adopta en vez de duplicarla.
 * Un fallo en una cuenta no impide sincronizar las demás.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function syncBalances(supabase: any, conn: Conn): Promise<{ updated: number; errors: string[] }> {
  const uids = conn.account_ids ?? [];
  const errors: string[] = [];
  let updated = 0;
  if (!uids.length) return { updated, errors };

  const { data: rows } = await supabase
    .from("cash_accounts").select("id, name, bank_account_uid").eq("user_id", conn.user_id);
  const accounts: CashAccountRef[] = rows ?? [];

  for (const [i, uid] of uids.entries()) {
    try {
      const picked = pickBalance(await getBalances(uid));
      if (!picked) { errors.push(`cuenta ${i + 1}: sin saldo`); continue; }
      if (picked.currency !== "EUR") { errors.push(`cuenta ${i + 1}: divisa ${picked.currency} no soportada`); continue; }

      const now = new Date().toISOString();
      const fields = {
        balance: picked.amount,
        updated_at: now,
        balance_synced_at: now,
        bank_connection_id: conn.id,
        bank_account_uid: uid,
      };

      const linked = accounts.find((a) => a.bank_account_uid === uid);
      const adoptId = linked ? null : findAdoptableAccount(accounts, conn.institution_name);
      const existingId = linked?.id ?? adoptId;

      if (existingId) {
        const { error } = await supabase.from("cash_accounts").update(fields).eq("id", existingId);
        if (error) { errors.push(`cuenta ${i + 1}: ${error.message}`); continue; }
        const ref = accounts.find((a) => a.id === existingId)!;
        ref.bank_account_uid = uid;
      } else {
        let name = conn.institution_name;
        if (uids.length > 1) {
          const details = await getAccountDetails(uid).catch(() => null);
          const iban = details?.account_id?.iban;
          name = `${conn.institution_name} ${iban ? `·${iban.slice(-4)}` : `#${i + 1}`}`;
        }
        const { data: created, error } = await supabase
          .from("cash_accounts").insert({ user_id: conn.user_id, name, ...fields }).select("id").single();
        if (error) { errors.push(`cuenta ${i + 1}: ${error.message}`); continue; }
        accounts.push({ id: created.id, name, bank_account_uid: uid });
      }
      updated++;
    } catch (e) {
      errors.push(`cuenta ${i + 1}: ${(e as Error).message}`);
    }
  }

  if (errors.length) {
    await supabase.from("bank_connections").update({ error_message: `saldo: ${errors.join("; ")}`.slice(0, 500) }).eq("id", conn.id);
  }
  return { updated, errors };
}

/**
 * Si la sesión se guardó sin cuentas (el banco no las devolvió al autorizar),
 * se vuelven a pedir a EnableBanking y se guardan.
 */
export async function ensureAccountIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  conn: { id: string; requisition_id: string | null; account_ids: string[] | null },
): Promise<string[]> {
  const current = conn.account_ids ?? [];
  if (current.length || !conn.requisition_id) return current;
  const session = await getSession(conn.requisition_id);
  const uids = sessionAccountUids(session);
  console.log("ensureAccountIds", conn.id, "status", session.status, "accounts", uids.length);
  if (uids.length) {
    await supabase.from("bank_connections").update({ account_ids: uids }).eq("id", conn.id);
    conn.account_ids = uids;
  }
  return uids;
}
