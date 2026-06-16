export type MatchCandidate = { id: string; assetName: string };
export type MatchResult = { id: string; score: number };

export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokens(s: string): string[] {
  return normalize(s).split(" ").filter(Boolean);
}

function levenshtein(a: string, b: string): number {
  const m = a.length,
    n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[n];
}

/** strategyText = name + " " + assetName (crudo); positionName crudo. */
export function matchScore(strategyText: string, positionName: string): number {
  const st = normalize(strategyText);
  const pos = normalize(positionName);
  if (!pos || !st) return 0;
  if (st.includes(pos) || pos.includes(st)) return 1;
  const stTok = new Set(tokens(st));
  const posTok = tokens(pos);
  const overlap = posTok.length ? posTok.filter((t) => stTok.has(t)).length / posTok.length : 0;
  const dist = levenshtein(pos, st);
  const lev = 1 - dist / Math.max(pos.length, st.length);
  return Math.max(overlap, lev);
}

export function rankPositions(
  strategyName: string,
  strategyAssetName: string,
  positions: MatchCandidate[],
): MatchResult[] {
  const text = `${strategyName} ${strategyAssetName}`;
  return positions
    .map((p) => ({ id: p.id, score: matchScore(text, p.assetName) }))
    .sort((a, b) => b.score - a.score);
}

export function suggestPosition(
  strategyName: string,
  strategyAssetName: string,
  positions: MatchCandidate[],
  threshold = 0.6,
): MatchResult | null {
  const ranked = rankPositions(strategyName, strategyAssetName, positions);
  return ranked.length && ranked[0].score >= threshold ? ranked[0] : null;
}
