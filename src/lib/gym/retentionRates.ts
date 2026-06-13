// Retention "known-base rates" — the shared contract (Option B).
//
// Every Retention card expresses its rates over the ATTENDANCE-KNOWN base by
// default; one universal Settings toggle (`includeUnknown` on
// RetentionSettingsContext) flips all cards back to full-base. The unknown
// members are REAL (guardian/parent billing, staff, legacy) — not errors — so
// this is "rates among members we can track," headcount unchanged, the unknown
// always disclosed.
//
// This module is the BACKBONE: each card declares the same pure view object
// `{ knownBase, fullBase, unknown }` and selects a facet from `includeUnknown`.
// The numerator (`count`) is IDENTICAL across both facets — the toggle changes
// only the DENOMINATOR and the derived rate, never classification. So the
// absolute counts the cards display (Healthy/Watch/Silent/active/census) cannot
// move when the toggle flips: this layer never reclassifies anyone, it only
// re-bases a rate.
//
// Forward-compat (NOT built here): `unknown` is one unresolved bucket today
// because we have no per-member role data to split it. `UnknownDisclosure` is
// shaped so a future slice can carry sub-categories (non-attendance roles vs.
// never-engaged members vs. data-quality) — but that future "never-engaged →
// high-risk INCLUDED" treatment is a CLASSIFICATION change (it touches the
// locked silentChurn.ts and needs member-level role data the aggregate doesn't
// hold), explicitly OUT of scope here. Today: one bucket, view-layer only.

// One card's unknown bucket + how to name/disclose it. Always rendered, both
// states (constraint: never silently drop the unknown).
export type UnknownDisclosure = {
  count: number; // size of this card's own unknown bucket (held out of the known base)
  label: string; // name of the KNOWN base, e.g. 'attendance-known actives'
  affordance: string; // default-state CTA verb that flips to full-base, e.g. 'include'
};

// A rate over a chosen base. `count` is the numerator (e.g. at-risk or silent
// head-count) and is the SAME in both facets; `base` and `rate` differ.
export type RateFacet = {
  count: number;
  base: number;
  rate: number | null; // count / base; null when base === 0 (no denominator → render an em dash)
};

// The per-card view: the default (known-base) facet, the full-base facet the
// toggle flips to, and the always-rendered unknown disclosure.
export type RetentionRateView = {
  knownBase: RateFacet;
  fullBase: RateFacet;
  unknown: UnknownDisclosure;
};

function rateOf(count: number, base: number): number | null {
  return base === 0 ? null : count / base;
}

// Build a card's rate view from its own counts. `knownBase` is the
// attendance-known denominator (e.g. healthy + watch + silent); `unknownCount`
// is the bucket held out by default; the full base is knownBase + unknownCount.
export function buildRetentionRateView(
  count: number,
  knownBase: number,
  unknownCount: number,
  label: string,
  affordance = 'include',
): RetentionRateView {
  const fullBase = knownBase + unknownCount;
  return {
    knownBase: { count, base: knownBase, rate: rateOf(count, knownBase) },
    fullBase: { count, base: fullBase, rate: rateOf(count, fullBase) },
    unknown: { count: unknownCount, label, affordance },
  };
}

// Select the facet for the current toggle state. Default OFF → known base.
export function pickRateFacet(view: RetentionRateView, includeUnknown: boolean): RateFacet {
  return includeUnknown ? view.fullBase : view.knownBase;
}
