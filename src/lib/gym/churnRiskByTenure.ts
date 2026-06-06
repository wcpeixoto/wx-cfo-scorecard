// Churn Risk by Tenure — deterministic rule layer for the Retention page.
//
// Code decides what is true (AGENTS.md "deterministic + AI layers"): this module
// owns the tenure-band segmentation and the per-band risk rate. It does NOT
// re-implement the active-filter / >= threshold predicate — that lives once in
// classifyMember (silentChurn.ts), so this card can never disagree with the
// Silent Churn and Attendance Health cards about who is active or at risk.
//
// Where Silent Churn says WHO crossed the line and Attendance Health says HOW
// MANY are drifting, this says WHICH tenure cohort the risk concentrates in.

import type { GymMember } from './memberFixture';
import {
  classifyMember,
  parseYmdLocal,
  resolveSilentChurnThresholdDays,
  wholeDaysBetween,
} from './silentChurn';

// At-risk = the Attendance Health "watch" + "silent" buckets: a member who is
// drifting (watch) OR already past the Silent Churn threshold (silent). Healthy
// and unknown are active but not at risk. This is the one place the at-risk
// definition for this card is stated.
//
// Tenure band definition (tunable — this constant is the single source of
// truth). Bands are LABELLED in months/years but CUT on whole days, so the
// boundaries are deterministic and timezone-safe. Each entry's `minDays` is the
// inclusive lower edge; a member lands in the band with the greatest `minDays`
// that is <= their tenure in days. The list must stay sorted ascending by
// minDays and start at 0 so every non-negative tenure resolves to exactly one
// band.
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

// Stable id/label for the synthetic "unknown tenure" bucket: ACTIVE members whose
// tenure band can't be determined — a missing/invalid membershipStart, or a start
// AFTER asOf (negative tenure). It is deliberately NOT a TENURE_BANDS entry, so
// `bands` stays one row per real cohort and the hero is always a real cohort; but
// it IS surfaced in the result and counted in activeTotal, so a dirty-data member
// is shown rather than silently dropped. Matters once live Wodify data lands.
export const UNKNOWN_TENURE_ID = 'unknownTenure';
const UNKNOWN_TENURE_LABEL = 'Unknown';

export type TenureBandRisk = {
  id: string;
  label: string;
  activeTotal: number; // active members whose tenure falls in this band
  watch: number; // active + on watch (drifting, below threshold)
  silent: number; // active + silent (>= threshold) — equals this band's Silent Churn slice
  atRisk: number; // watch + silent
  riskRate: number | null; // atRisk / activeTotal; null when the band has no active members
};

export type ChurnRiskByTenureResult = {
  thresholdDays: number; // resolved threshold the risk buckets were cut at
  activeTotal: number; // total active members placed (== Σ band activeTotal + unknownTenure.activeTotal)
  bands: TenureBandRisk[]; // one per TENURE_BANDS entry, in band order
  unknownTenure: TenureBandRisk; // active members with no determinable tenure band (dirty data) — never dropped
  heroBandId: string | null; // band with the highest risk rate (null when no active members)
};

// The band whose minDays is the greatest value <= tenureDays. Returns null for a
// negative tenure (membershipStart after asOf — bad data), so the caller routes
// such a member into the "unknown tenure" bucket rather than silently forcing
// them into "< 3 mo".
function bandForTenure(tenureDays: number): TenureBandDef | null {
  if (tenureDays < 0) return null;
  let match: TenureBandDef | null = null;
  for (const band of TENURE_BANDS) {
    if (tenureDays >= band.minDays) match = band;
  }
  return match;
}

// Churn Risk by Tenure (deterministic): bucket ACTIVE members by tenure and,
// within each band, count how many are at risk (watch + silent) at the resolved
// threshold. Reuses classifyMember for the active/at-risk call and parseYmdLocal
// + wholeDaysBetween for tenure, so there is exactly one definition of each rule.
//
// Invariants that hold by construction (and are asserted in the tests):
//   - Σ band.activeTotal + unknownTenure.activeTotal === result.activeTotal: every
//     ACTIVE member lands in exactly one bucket — a real tenure band, or the
//     "unknown tenure" bucket when membershipStart is missing/invalid or after
//     asOf. No active member is dropped or double-counted (holds for any data, not
//     just the clean fixture).
//   - Σ band.silent + unknownTenure.silent === computeSilentChurn(...).count at the
//     same threshold (this card's silent slices re-partition the Silent Churn set;
//     the anti-drift cross-check — which holds even on dirty start dates because a
//     bad-tenure silent member is counted in unknownTenure rather than dropped).
export function computeChurnRiskByTenure(
  members: GymMember[],
  thresholdDays: number,
  asOf: Date,
): ChurnRiskByTenureResult {
  const resolvedThreshold = resolveSilentChurnThresholdDays(thresholdDays);

  // Mutable accumulators per band, in TENURE_BANDS order, plus one for the
  // "unknown tenure" bucket (active members whose tenure band can't be resolved).
  const acc = TENURE_BANDS.map((band) => ({
    id: band.id,
    label: band.label,
    activeTotal: 0,
    watch: 0,
    silent: 0,
  }));
  const indexById = new Map(acc.map((row, i) => [row.id, i]));
  const unknownAcc = {
    id: UNKNOWN_TENURE_ID,
    label: UNKNOWN_TENURE_LABEL,
    activeTotal: 0,
    watch: 0,
    silent: 0,
  };

  for (const member of members) {
    // classifyMember owns the active filter and the >= threshold predicate;
    // null means not active, so it is excluded from every bucket.
    const classification = classifyMember(member, resolvedThreshold, asOf);
    if (!classification) continue;

    // Resolve the tenure band. A missing/invalid membershipStart (start === null)
    // or a start AFTER asOf (bandForTenure returns null for negative tenure) is
    // dirty data with no real band, so the member is routed into the "unknown
    // tenure" bucket instead of being silently dropped — keeping every active
    // member counted and the Silent Churn cross-check intact on dirty data.
    const start = parseYmdLocal(member.membershipStart);
    const band = start ? bandForTenure(wholeDaysBetween(start, asOf)) : null;
    const row = band ? acc[indexById.get(band.id)!] : unknownAcc;

    row.activeTotal += 1;
    if (classification.bucket === 'watch') row.watch += 1;
    else if (classification.bucket === 'silent') row.silent += 1;
    // 'healthy' and 'unknown' (recency) are active but not at risk — counted in activeTotal only.
  }

  const toBandRisk = (row: {
    id: string;
    label: string;
    activeTotal: number;
    watch: number;
    silent: number;
  }): TenureBandRisk => {
    const atRisk = row.watch + row.silent;
    return {
      id: row.id,
      label: row.label,
      activeTotal: row.activeTotal,
      watch: row.watch,
      silent: row.silent,
      atRisk,
      riskRate: row.activeTotal === 0 ? null : atRisk / row.activeTotal,
    };
  };

  const bands: TenureBandRisk[] = acc.map(toBandRisk);
  const unknownTenure: TenureBandRisk = toBandRisk(unknownAcc);

  const activeTotal =
    bands.reduce((sum, band) => sum + band.activeTotal, 0) + unknownTenure.activeTotal;

  // Hero = the band with the highest risk rate, considering only bands that have
  // active members (an empty band has no rate). Ties break toward the larger
  // at-risk count, then toward the earlier (shorter-tenure) band for stability.
  let heroBandId: string | null = null;
  let bestRate = -1;
  let bestAtRisk = -1;
  for (const band of bands) {
    if (band.activeTotal === 0 || band.riskRate === null) continue;
    if (
      band.riskRate > bestRate ||
      (band.riskRate === bestRate && band.atRisk > bestAtRisk)
    ) {
      bestRate = band.riskRate;
      bestAtRisk = band.atRisk;
      heroBandId = band.id;
    }
  }

  return {
    thresholdDays: resolvedThreshold,
    activeTotal,
    bands,
    unknownTenure,
    heroBandId,
  };
}
