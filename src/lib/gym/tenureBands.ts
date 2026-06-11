// Tenure band edges — the single source of truth for Churn Risk by Tenure,
// shared by the SPA card (churnRiskByTenure.ts) and the server-side aggregate
// (wodifyRetentionAggregate.ts → the sync-wodify-retention Edge Function).
//
// Extracted from churnRiskByTenure.ts (which re-exports it, so existing
// consumers are unchanged) the moment a second consumer appeared: the §6
// aggregate extension bins active members by tenure band server-side, and the
// band edges must be ONE definition so the live histogram and the sample card
// can never disagree about where a band starts.
//
// DELIBERATELY DEPENDENCY-FREE (no imports): this module sits inside the Edge
// Function's deploy/eszip graph, and keeping it pure keeps the server bundle
// minimal and the §6.1 reuse boundary intact — the server imports band edges
// and the locked date primitives only, never the threshold-coupled classifiers.

// Bands are LABELLED in months/years but CUT on whole days, so the boundaries
// are deterministic and timezone-safe. Each entry's `minDays` is the inclusive
// lower edge; a member lands in the band with the greatest `minDays` that is
// <= their tenure in days. The list must stay sorted ascending by minDays and
// start at 0 so every non-negative tenure resolves to exactly one band.
export type TenureBandDef = {
  id: string;
  label: string;
  minDays: number;
};

export const TENURE_BANDS: readonly TenureBandDef[] = [
  { id: 'lt3m', label: '< 3 mo', minDays: 0 },
  { id: '3to6m', label: '3–6 mo', minDays: 90 },
  { id: '6to12m', label: '6–12 mo', minDays: 180 },
  { id: '1to2y', label: '1–2 yr', minDays: 365 },
  { id: '2yplus', label: '2 yr+', minDays: 730 },
];

// Stable id for the synthetic "unknown tenure" bucket: ACTIVE members whose
// tenure band can't be determined — a missing/invalid membership start, or a
// start AFTER asOf (negative tenure). Deliberately NOT a TENURE_BANDS entry
// (the hero is always a real cohort), but always surfaced, never dropped (#439).
export const UNKNOWN_TENURE_ID = 'unknownTenure';

// The band whose minDays is the greatest value <= tenureDays. Returns null for
// a negative tenure (membership start after asOf — bad data), so the caller
// routes such a member into the "unknown tenure" bucket rather than silently
// forcing them into "< 3 mo".
export function bandForTenure(tenureDays: number): TenureBandDef | null {
  if (tenureDays < 0) return null;
  let match: TenureBandDef | null = null;
  for (const band of TENURE_BANDS) {
    if (tenureDays >= band.minDays) match = band;
  }
  return match;
}
