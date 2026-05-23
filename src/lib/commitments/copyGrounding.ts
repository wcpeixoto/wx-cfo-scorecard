// Constrained-generator validator. AI-generated tone-layer copy must not
// contradict the code-owned commitment facts. The deterministic layer decides
// what is true (the exact weekly target, the check-back deadline); the AI only
// decides how to say it. This guard rejects AI output that contradicts those
// facts so the caller can fall back to deterministic copy — the owner never sees
// an AI-invented number or date.
//
// Two axes:
//   - Amount (Slice 1): every $-figure must equal the target. Guards the
//     trust-killing "$100 committed, AI says $500" failure.
//   - Date (Slice 1b): any explicit month-name calendar date must equal the
//     deadline. This closes a validate-don't-trust gap — the day_one prompt asks
//     for relative timing ("this week") and forbids invented dates, but nothing
//     ENFORCED it, so a disobedient model emitting a WRONG date used to pass the
//     amount-only check. A *correct* date still passes: the validator gates
//     truth, not voice (the deterministic fallback itself states the real
//     deadline date), so it rejects only a date that contradicts the deadline,
//     never a truthful one. Don't tighten this to reject all dates — that would
//     be the validator enforcing voice, which is the prompt's job.
//
// Deliberately NOT validated (conservative scope; every miss fails safe toward
// the deterministic fallback, never toward a shown lie):
//   - Bare numbers without "$" (the "7" in "7 days") — the deferred quantity axis.
//   - Numeric / ISO dates ("5/29", "2026-05-29") — the prose register doesn't
//     produce them and they collide with rates/ratios ("$100/week").
//   - Natural-language dates ("next Thursday", "end of the month") — verifying
//     these needs date parsing against a reference "today"; explicitly out of
//     scope, and the prompt permits relative timing, so they're voice not a lie.
//   - Structural "one action" validation — investigated 2026-05-23 and
//     deliberately NOT built (a verified no-op, NOT a pending slice). The
//     committed action is code-owned: buildAction (reserveWarningCommitment.ts)
//     returns ONE string, and the AI day_one summary only CONFIRMS that
//     already-selected action — it never authors a recommendation, so there is
//     no second action for it to bundle. A syntactic guard would also misfire:
//     it would false-reject legitimate connectives ("moving $X and I'll check in
//     this week" — that "and" is the check-in, not a second action), suppressing
//     valid output for zero benefit. If a future session proposes a third
//     grounding axis here, STOP: the real bundled-action risk lives on the
//     free-form hero card (priorities/ai.ts getAIProse, with its free `action`
//     plus `alternative` fields), and the fix there is structural (typed slot),
//     not a validator — a separate hero-card initiative, not a constrained-
//     generator slice.
//
// Distinct from targetGrounding.ts: that DERIVES the target number; this
// VALIDATES copy against the code-owned facts.

export type GroundingReason = 'amount_mismatch' | 'foreign_amount' | 'date_mismatch';

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

function validateAmount(text: string, target: number): GroundingVerdict {
  const values = extractCurrencyValues(text);
  if (values.length === 0) return { ok: true }; // generic language — no number to contradict
  const hasForeign = values.some((v) => !sameAmount(v, target));
  if (!hasForeign) return { ok: true };
  // foreign_amount: the target is stated correctly but an extra figure competes
  // with it; amount_mismatch: the amount is simply wrong (target never appears).
  // Two reasons so prompt-tuning can tell "AI restated the target wrong" from
  // "AI introduced a second number".
  const hasTarget = values.some((v) => sameAmount(v, target));
  return { ok: false, reason: hasTarget ? 'foreign_amount' : 'amount_mismatch' };
}

// Month name (3–9 letters, optional trailing period) + day number, with an
// optional ordinal suffix: "May 29", "May 29th", "June 5", "Sep. 3". The day is
// a coarse 1–2 digit grab; it's compared numerically to the deadline, so a stray
// "May 2026" (year's "20" read as a day) simply mismatches and falls back — safe.
// The [A-Za-z] run also matches non-months ("about 100"); the MONTHS lookup is
// the real filter, so "about"/"next"/"over" + number are ignored.
const DATE_RE = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/g;

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
  dec: 11, december: 11,
};

type MonthDay = { month: number; day: number };

function extractMonthDays(text: string): MonthDay[] {
  const out: MonthDay[] = [];
  for (const m of text.matchAll(DATE_RE)) {
    const month = MONTHS[m[1].toLowerCase()];
    if (month === undefined) continue; // the letter run wasn't a month name
    out.push({ month, day: Number.parseInt(m[2], 10) });
  }
  return out;
}

// `deadline` is the canonical display string the owner would see — the caller
// passes formatDeadline(...) output (e.g. "May 29") so the validator's notion of
// "the date" is exactly the deterministic fallback's, with no timezone drift.
// Unparseable forms ("soon", "") yield no expected day, so any stated calendar
// date is unverifiable and rejected (fail closed).
function validateDate(text: string, deadline: string): GroundingVerdict {
  const stated = extractMonthDays(text);
  if (stated.length === 0) return { ok: true }; // relative timing — nothing to contradict
  const [expected] = extractMonthDays(deadline);
  if (!expected) return { ok: false, reason: 'date_mismatch' }; // can't verify a stated date
  const grounded = stated.every((d) => d.month === expected.month && d.day === expected.day);
  return grounded ? { ok: true } : { ok: false, reason: 'date_mismatch' };
}

export function validateGrounding(
  text: string,
  facts: { target: number; deadline?: string }
): GroundingVerdict {
  const amount = validateAmount(text, facts.target);
  if (!amount.ok) return amount;
  // deadline omitted → the caller opted out of the date axis (amount-only
  // callers / tests). Supply the canonical formatDeadline string to enforce it.
  if (facts.deadline !== undefined) {
    const date = validateDate(text, facts.deadline);
    if (!date.ok) return date;
  }
  return { ok: true };
}
