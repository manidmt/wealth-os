import type { EbTransaction } from "./bank-mapping.ts";
import type { EbBalance } from "./bank-balances.ts";

const BASE = "https://api.enablebanking.com";

function b64urlFromBytes(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64url(str: string): string {
  return b64urlFromBytes(new TextEncoder().encode(str));
}

async function importKey(): Promise<CryptoKey> {
  // ENABLE_BANKING_PRIVATE_KEY_B64 = base64 del PEM PKCS#8 completo
  const pem = atob(Deno.env.get("ENABLE_BANKING_PRIVATE_KEY_B64")!);
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function makeJwt(): Promise<string> {
  const appId = Deno.env.get("ENABLE_BANKING_APP_ID")!;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "RS256", kid: appId }));
  const payload = b64url(JSON.stringify({
    iss: "enablebanking.com",
    aud: "api.enablebanking.com",
    iat: now,
    exp: now + 3600,
  }));
  const signingInput = `${header}.${payload}`;
  const key = await importKey();
  const sig = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${b64urlFromBytes(new Uint8Array(sig))}`;
}

async function ebFetch(path: string, init?: RequestInit) {
  const jwt = await makeJwt();
  const resp = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
  });
  if (!resp.ok) throw new Error(`EnableBanking ${path}: HTTP ${resp.status} ${await resp.text()}`);
  return resp.json();
}

export type AspspInfo = { name: string; country: string; maximum_consent_validity?: number };

export async function listAspsps(country = "ES"): Promise<AspspInfo[]> {
  const j = await ebFetch(`/aspsps?country=${country}`);
  return (j.aspsps ?? []) as AspspInfo[];
}

export async function startAuth(p: {
  aspspName: string; aspspCountry: string; state: string; redirectUrl: string; validUntil: string;
}): Promise<{ url: string }> {
  return ebFetch(`/auth`, {
    method: "POST",
    body: JSON.stringify({
      access: { valid_until: p.validUntil },
      aspsp: { name: p.aspspName, country: p.aspspCountry },
      state: p.state,
      redirect_url: p.redirectUrl,
      psu_type: "personal",
    }),
  }) as Promise<{ url: string }>;
}

export async function createSession(code: string): Promise<
  SessionAccounts & { session_id: string; access?: { valid_until?: string } }
> {
  return ebFetch(`/sessions`, { method: "POST", body: JSON.stringify({ code }) });
}

type SessionAccounts = { accounts?: (string | { uid?: string })[]; accounts_data?: { uid?: string }[] };

/** POST /sessions devuelve objetos con uid; GET /sessions/{id} puede devolver uids sueltos o accounts_data. */
export function sessionAccountUids(s: SessionAccounts): string[] {
  const fromAccounts = (s.accounts ?? []).map((a) => (typeof a === "string" ? a : a?.uid));
  const fromData = (s.accounts_data ?? []).map((a) => a?.uid);
  return [...new Set([...fromAccounts, ...fromData].filter((u): u is string => !!u))];
}

export async function getSession(sessionId: string): Promise<SessionAccounts & { status?: string }> {
  return ebFetch(`/sessions/${sessionId}`);
}

export async function getTransactions(
  accountUid: string, dateFrom: string, continuationKey?: string,
): Promise<{ transactions: EbTransaction[]; continuation_key?: string }> {
  const u = new URL(`${BASE}/accounts/${accountUid}/transactions`);
  u.searchParams.set("date_from", dateFrom);
  if (continuationKey) u.searchParams.set("continuation_key", continuationKey);
  const jwt = await makeJwt();
  const resp = await fetch(u.toString(), { headers: { Authorization: `Bearer ${jwt}` } });
  if (!resp.ok) throw new Error(`EnableBanking transactions: HTTP ${resp.status} ${await resp.text()}`);
  return resp.json();
}

export async function getBalances(accountUid: string): Promise<EbBalance[]> {
  const j = await ebFetch(`/accounts/${accountUid}/balances`);
  return (j.balances ?? []) as EbBalance[];
}

export async function getAccountDetails(
  accountUid: string,
): Promise<{ name?: string; account_id?: { iban?: string } }> {
  return ebFetch(`/accounts/${accountUid}/details`);
}

/** Todas las transacciones BOOKED de una cuenta desde dateFrom, siguiendo paginación. */
export async function getAllTransactions(accountUid: string, dateFrom: string): Promise<EbTransaction[]> {
  const out: EbTransaction[] = [];
  let key: string | undefined;
  do {
    const page = await getTransactions(accountUid, dateFrom, key);
    out.push(...(page.transactions ?? []));
    console.log("tx page", accountUid.slice(0, 8), "n", (page.transactions ?? []).length, "next", !!page.continuation_key, "pageKeys", Object.keys(page).join(","));
    key = page.continuation_key;
  } while (key);
  return out;
}
