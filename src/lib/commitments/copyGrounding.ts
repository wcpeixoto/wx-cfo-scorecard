// Constrained-generator validator, Slice 1: AMOUNT grounding. AI-generated
// tone-layer copy must not contradict the code-owned commitment target. The
// deterministic layer decides what is true (the exact weekly target); the AI
// only decides how to say it. This guard rejects any AI output whose dollar
// figures don't match that target, so the caller can fall back to deterministic
// copy — the owner never sees an AI-invented number (the trust-killing
// "$100 committed, AI says $500" failure).
//
// Amount-only by design. Date grounding (Slice 1b) and structural "one action"
// validation are deliberately deferred — the $-contradiction is the highest-
// leverage principle-#2 protection and ships alone for a sharp learning signal.
//
// Distinct from targetGrounding.ts: that DERIVES the target number; this
// VALIDATES copy against it.

export type GroundingReason = 'amount_mismatch' | 'foreign_amount';

export type GroundingVerdict = { ok: true } | { ok: false; reason: GroundingReason };

// Match $-prefixed currency tokens, including an immediately-trailing K/M/B
// magnitude suffix. The suffix is essential for safety: without it "$100K"
// (= $100,000) for a $100 target would read as "$100" and falsely pass, and a
// rounded "$1K" — the prompt failure we guard against — would read as "$1". No
// space is allowed before the suffix, so "$500 monthly" reads as 500, not 500M.
// Bare numbers without a $ are NOT currency (the "7" in "7 days" is no
// contradiction) — that's the deferred quantity axis.
const CURRENCY_RE = /\$\s?(\d[\d,]*(?:\.\d+)?)([KkMmBb])?/g;

const MAGNITUDE: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };

function extractCurrencyValues(text: string): number[] {
  const values: number[] = [];
  for (const match of text.matchAll(CURRENCY_RE)) {
    const base = Number.parseFloat(match[1].replace(/,/g, ''));
    if (!Number.isFinite(base)) continue;
    const factor = match[2] ? MAGNITUDE[match[2].toLowerCase()] ?? 1 : 1;
    values.push(base * factor);
  }
  return values;
}

// Cent-exact equality: money compared in integer cents to dodge float artifacts,
// but with NO dollar-rounding tolerance. "$1K" for a $1,200 target is a
// contradiction, not a rounding (locked decision — the commitment prompt pins the
// exact amount; rounding it would itself be the lie).
function sameAmount(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

export function validateGrounding(
  text: string,
  facts: { target: number }
): GroundingVerdict {
  const values = extractCurrencyValues(text);
  if (values.length === 0) return { ok: true }; // generic language — no number to contradict
  const hasForeign = values.some((v) => !sameAmount(v, facts.target));
  if (!hasForeign) return { ok: true };
  // foreign_amount: the target is stated correctly but an extra figure competes
  // with it; amount_mismatch: the amount is simply wrong (target never appears).
  // Two reasons so prompt-tuning can tell "AI restated the target wrong" from
  // "AI introduced a second number".
  const hasTarget = values.some((v) => sameAmount(v, facts.target));
  return { ok: false, reason: hasTarget ? 'foreign_amount' : 'amount_mismatch' };
}
