// Retention "known-base rates" — the shared contract.
//
// Every Retention card expresses its rates over the ATTENDANCE-KNOWN base,
// ALWAYS. The attendance-recency "unknown" members are REAL (guardian/parent
// billing, staff, legacy) — not errors — but they have no readable check-in, so
// they are never part of a rate denominator: this is "rates among members we can
// track," headcount unchanged, the unknown always disclosed.
//
// There is NO LONGER a "fold the unknown into the denominator" (full-base) path —
// the "Exclude parent/guardian accounts" Settings toggle is DISPLAY-only and lives
// in the card layer; it never reaches this rate math. The numerator (`count`) and
// the denominator (`base`) are fixed here; the toggle only decides whether the
// unknown COUNT is shown alongside, never how a rate is computed.
//
// Forward-compat (NOT built here): `unknown` is one unresolved bucket today
// because we have no per-member role data to split it. A future "never-engaged →
// high-risk INCLUDED" treatment is a CLASSIFICATION change (it touches the locked
// silentChurn.ts and needs member-level role data the aggregate doesn't hold),
// explicitly OUT of scope here. Today: one bucket, view-layer only.

// One card's unknown bucket + how to name it. Disclosed (count) when the toggle is
// OFF; hidden behind the single audit line when ON — but never silently dropped.
export type UnknownDisclosure = {
  count: number; // size of this card's own unknown bucket (held out of the known base)
  label: string; // name of the KNOWN base, e.g. 'attendance-known actives'
};

// A rate over the attendance-known base. `count` is the numerator (e.g. at-risk
// or silent head-count); `base` is the known denominator.
export type RateFacet = {
  count: number;
  base: number;
  rate: number | null; // count / base; null when base === 0 (no denominator → render an em dash)
};

// The per-card view: the known-base facet and the always-tracked unknown
// disclosure (shown or hidden by the card's display toggle, never re-based).
export type RetentionRateView = {
  knownBase: RateFacet;
  unknown: UnknownDisclosure;
};

function rateOf(count: number, base: number): number | null {
  return base === 0 ? null : count / base;
}

// Build a card's rate view from its own counts. `knownBase` is the
// attendance-known denominator (e.g. healthy + watch + silent); `unknownCount` is
// the bucket held out of the denominator and disclosed separately.
export function buildRetentionRateView(
  count: number,
  knownBase: number,
  unknownCount: number,
  label: string,
): RetentionRateView {
  return {
    knownBase: { count, base: knownBase, rate: rateOf(count, knownBase) },
    unknown: { count: unknownCount, label },
  };
}
