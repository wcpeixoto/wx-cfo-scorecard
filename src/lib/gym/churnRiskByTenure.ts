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
import { TENURE_BANDS, UNKNOWN_TENURE_ID, bandForTenure } from './tenureBands';
import { deriveBuckets } from './retentionAggregateView';
import type { TenureBandHistogram, TenureBandRecency } from './wodifyRetentionAggregate';

// At-risk = the Attendance Health "watch" + "silent" buckets: a member who is
// drifting (watch) OR already past the Silent Churn threshold (silent). Healthy
// and unknown are active but not at risk. This is the one place the at-risk
// definition for this card is stated.
//
// The tenure band definition (band edges + the unknown-tenure bucket id) lives
// in ./tenureBands — extracted there because the §6 aggregate extension bins by
// the SAME bands server-side, and one definition keeps the live histogram and
// this card from ever disagreeing. Re-exported so existing consumers (tests,
// UI) keep importing from here.
export { TENURE_BANDS, UNKNOWN_TENURE_ID, type TenureBandDef } from './tenureBands';
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

// Hero = the band with the highest risk rate, considering only bands that have
// active members (an empty band has no rate). Ties break toward the larger
// at-risk count, then toward the earlier (shorter-tenure) band for stability.
// ONE rule for both sources — the sample compute and the live-aggregate adapter
// below both call this, so the hero can never differ by data source.
function selectHeroBandId(bands: TenureBandRisk[]): string | null {
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
  return heroBandId;
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

  return {
    thresholdDays: resolvedThreshold,
    activeTotal,
    bands,
    unknownTenure,
    heroBandId: selectHeroBandId(bands),
  };
}

// Churn Risk by Tenure from the LIVE non-PII aggregate (§6 aggregate extension):
// the server bins active members into per-tenure-band recency histograms
// (counts only — see wodifyRetentionAggregate.ts), and this adapter re-derives
// the SAME ChurnRiskByTenureResult shape at the owner's CURRENT threshold,
// entirely client-side, so the card renders sample and live through one code
// path — exactly the deriveBuckets pattern Attendance Health uses.
//
// Per band, deriveBuckets applies the locked WATCH_FLOOR_DAYS + threshold rule
// (precedence-correct at every threshold); watch + silent = at risk, and the
// band's unknown-RECENCY members (no usable check-in) count in activeTotal but
// are never at risk — byte-for-byte the sample path's semantics. Because the
// per-band histograms partition the global one (proven by test), Σ band silent
// here === the live Silent Churn count at the same threshold — the #411
// anti-drift invariant, now holding on live data by construction.
//
// The unknown-TENURE bucket (#439) arrives as a first-class entry from the
// server (active members whose member_since is missing/sentinel/invalid/future)
// — surfaced, never dropped, exactly like the sample path's dirty-data routing.
export function computeChurnRiskByTenureFromAggregate(
  tenure: TenureBandHistogram,
  thresholdDays: number,
): ChurnRiskByTenureResult {
  const resolvedThreshold = resolveSilentChurnThresholdDays(thresholdDays);

  const toBandRisk = (id: string, label: string, recency: TenureBandRecency | undefined): TenureBandRisk => {
    // The fetch layer validates every expected band key is present; an absent
    // entry here is defensively treated as an empty band, never a crash.
    const counts = recency ?? { countsByDaysAbsent: {}, overflow365Plus: 0, unknownRecency: 0 };
    const derived = deriveBuckets(
      {
        daysAbsentHistogram: {
          countsByDaysAbsent: counts.countsByDaysAbsent,
          overflow365Plus: counts.overflow365Plus,
        },
        unknown: counts.unknownRecency,
      },
      resolvedThreshold,
    );
    const atRisk = derived.watch + derived.silent;
    return {
      id,
      label,
      activeTotal: derived.activeTotal,
      watch: derived.watch,
      silent: derived.silent,
      atRisk,
      riskRate: derived.activeTotal === 0 ? null : atRisk / derived.activeTotal,
    };
  };

  const bands = TENURE_BANDS.map((band) => toBandRisk(band.id, band.label, tenure.bands[band.id]));
  const unknownTenure = toBandRisk(
    UNKNOWN_TENURE_ID,
    UNKNOWN_TENURE_LABEL,
    tenure.bands[UNKNOWN_TENURE_ID],
  );

  return {
    thresholdDays: resolvedThreshold,
    activeTotal:
      bands.reduce((sum, band) => sum + band.activeTotal, 0) + unknownTenure.activeTotal,
    bands,
    unknownTenure,
    heroBandId: selectHeroBandId(bands),
  };
}
