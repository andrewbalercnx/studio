/**
 * Pure word-error-rate + name-error-rate. No deps. Unit-testable.
 *
 * WER = (substitutions + deletions + insertions) / reference-word-count, via token-level
 * Levenshtein. Name-error-rate = fraction of expected cast names not present in the hypothesis
 * (case/punct-insensitive) — the metric that actually matters for character resolution.
 */
export function normalize(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')   // drop punctuation, keep apostrophes
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(s) {
  const n = normalize(s);
  return n ? n.split(' ') : [];
}

/** Token-level Levenshtein distance with op counts. */
export function editOps(refTokens, hypTokens) {
  const m = refTokens.length, n = hypTokens.length;
  const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = refTokens[i - 1] === hypTokens[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[m][n];
}

export function wer(reference, hypothesis) {
  const ref = tokenize(reference);
  const hyp = tokenize(hypothesis);
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
  return editOps(ref, hyp) / ref.length;
}

/** @returns {{ rate:number, missed:string[] }} fraction of expected names absent from hypothesis. */
export function nameErrorRate(expectedNames, hypothesis) {
  const hypTokens = new Set(tokenize(hypothesis));
  const names = (expectedNames || []).map(normalize).filter(Boolean);
  if (names.length === 0) return { rate: 0, missed: [] };
  const missed = names.filter(name => {
    // a name may be multi-word; require all its tokens present
    return !tokenize(name).every(t => hypTokens.has(t));
  });
  return { rate: missed.length / names.length, missed };
}
