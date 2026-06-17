// Cohort Retention — deterministic rule layer for the "Retention by Age Group"
// card (RETENTION_FINISH_PLAN.md §6–§9, rev.3 client_status basis).
//
// Code decides what is true (AGENTS.md "deterministic + AI layers"): this module
// owns the per-cohort risk derivation. Like churnRiskByTenure's aggregate adapter,
// it does NOT re-implement the active-filter / >= threshold predicate — that lives
// once in classifyMember (silentChurn.ts) and is mirrored by deriveBuckets, so this
// card can never disagree with Silent Churn / Attendance Health / Churn-by-Tenure
// about who is at risk.
//
// Two reads in one card:
//   Read 1 — cohort health: Healthy / Watch / Silent + at-risk rate per cohort,
//            re-derived from the per-cohort ACTIVE recency histogram at the owner's
//            current threshold (deriveBuckets), exactly the Churn-by-Tenure pattern.
//   Read 2 — lapsed per cohort: the inactive head-count carried straight from the
//            aggregate. Σ lapsed (incl. unknownCohort) === inactiveTotal by
//            construction (Member Movement parity).
//
// silentChurn.ts is imported READ-ONLY (resolveSilentChurnThresholdDays, the one
// threshold resolver — same as the Churn-by-Tenure adapter); it is never modified.

import { resolveSilentChurnThresholdDays } from './silentChurn';
import { deriveBuckets } from './retentionAggregateView';
import { COHORT_BANDS, UNKNOWN_COHORT_ID } from './cohortBands';
import type { CohortEntry, CohortHistogram } from './wodifyRetentionAggregate';

const UNKNOWN_COHORT_LABEL = 'Unknown age';

// One cohort's risk row. The active-side fields mirror TenureBandRisk exactly (so
// the known-base toggle and hero rule behave identically); `lapsed` is Read 2.
export type CohortRisk = {
  id: string;
  label: string;
  activeTotal: number; // active members in this cohort (FULL base, incl. unknownRecency)
  unknownRecency: number; // active-in-cohort with no usable check-in — held out of the known base
  knownActiveTotal: number; // activeTotal − unknownRecency: the attendance-known denominator (default)
  watch: number; // active + on watch (drifting, below threshold)
  silent: number; // active + silent (>= threshold)
  atRisk: number; // watch + silent — identical in both bases; the toggle only re-bases the rate
  riskRate: number | null; // FULL base: atRisk / activeTotal; null when no active members
  riskRateKnown: number | null; // KNOWN base: atRisk / knownActiveTotal; null when no known actives
  lapsed: number; // Read 2 — inactive (lapsed) members in this cohort
};

export type ChurnRiskByCohortResult = {
  thresholdDays: number; // resolved threshold the active buckets were cut at
  activeTotal: number; // Σ cohort.activeTotal incl. unknownCohort
  lapsedTotal: number; // Σ cohort.lapsed incl. unknownCohort === inactiveTotal (MM parity)
  bands: CohortRisk[]; // one per COHORT_BANDS entry, in band order
  unknownCohort: CohortRisk; // members with no derivable cohort (bad/sentinel DOB) — never dropped
  heroBandId: string | null; // FULL-base hero: cohort with the highest full-base at-risk rate
  heroBandIdKnown: string | null; // KNOWN-base hero: re-selects under the default known base
};

// Hero = the cohort with the highest at-risk rate among cohorts that have active
// members. Ties break toward the larger at-risk count, then the earlier (younger)
// cohort for stability. One rule for both bases; the hero can legitimately differ
// (de-diluting promotes the cohort with the most recency-unknowns). Mirrors
// selectHeroBandId in churnRiskByTenure.ts.
function selectHeroCohortId(bands: CohortRisk[], useKnownBase: boolean): string | null {
  let heroBandId: string | null = null;
  let bestRate = -1;
  let bestAtRisk = -1;
  for (const band of bands) {
    const denom = useKnownBase ? band.knownActiveTotal : band.activeTotal;
    const rate = useKnownBase ? band.riskRateKnown : band.riskRate;
    if (denom === 0 || rate === null) continue;
    if (rate > bestRate || (rate === bestRate && band.atRisk > bestAtRisk)) {
      bestRate = rate;
      bestAtRisk = band.atRisk;
      heroBandId = band.id;
    }
  }
  return heroBandId;
}

// Cohort Retention from the LIVE non-PII aggregate (or the sample histogram): the
// server bins active members into per-cohort recency histograms + a per-cohort
// lapsed count (counts only — see wodifyRetentionAggregate.ts), and this adapter
// re-derives Healthy/Watch/Silent + the at-risk rate per cohort at the owner's
// CURRENT threshold, client-side, so sample and live render through one code path
// (the deriveBuckets pattern Churn-by-Tenure uses). The unknown-cohort bucket
// arrives as a first-class entry — surfaced, never dropped.
export function computeChurnRiskByCohortFromAggregate(
  cohort: CohortHistogram,
  thresholdDays: number,
): ChurnRiskByCohortResult {
  const resolvedThreshold = resolveSilentChurnThresholdDays(thresholdDays);

  const toCohortRisk = (id: string, label: string, entry: CohortEntry | undefined): CohortRisk => {
    // The fetch layer validates every expected cohort key is present; an absent
    // entry here is defensively treated as an empty cohort, never a crash.
    const e = entry ?? {
      active: { countsByDaysAbsent: {}, overflow365Plus: 0, unknownRecency: 0 },
      lapsed: 0,
    };
    const derived = deriveBuckets(
      {
        daysAbsentHistogram: {
          countsByDaysAbsent: e.active.countsByDaysAbsent,
          overflow365Plus: e.active.overflow365Plus,
        },
        unknown: e.active.unknownRecency,
      },
      resolvedThreshold,
    );
    const atRisk = derived.watch + derived.silent;
    const knownActiveTotal = derived.activeTotal - derived.unknown;
    return {
      id,
      label,
      activeTotal: derived.activeTotal,
      unknownRecency: derived.unknown,
      knownActiveTotal,
      watch: derived.watch,
      silent: derived.silent,
      atRisk,
      riskRate: derived.activeTotal === 0 ? null : atRisk / derived.activeTotal,
      riskRateKnown: knownActiveTotal === 0 ? null : atRisk / knownActiveTotal,
      lapsed: e.lapsed,
    };
  };

  const bands = COHORT_BANDS.map((b) => toCohortRisk(b.id, b.label, cohort.cohorts[b.id]));
  const unknownCohort = toCohortRisk(
    UNKNOWN_COHORT_ID,
    UNKNOWN_COHORT_LABEL,
    cohort.cohorts[UNKNOWN_COHORT_ID],
  );

  const activeTotal =
    bands.reduce((sum, b) => sum + b.activeTotal, 0) + unknownCohort.activeTotal;
  const lapsedTotal = bands.reduce((sum, b) => sum + b.lapsed, 0) + unknownCohort.lapsed;

  return {
    thresholdDays: resolvedThreshold,
    activeTotal,
    lapsedTotal,
    bands,
    unknownCohort,
    heroBandId: selectHeroCohortId(bands, false),
    heroBandIdKnown: selectHeroCohortId(bands, true),
  };
}

// Static SAMPLE histogram for the card's "Sample data" state. The shared member
// fixture (memberFixture.ts) carries no date_of_birth, so — unlike the tenure
// card, which computes its sample from members — the Cohort card renders this
// clearly-synthetic histogram through the SAME adapter as live data. Numbers are
// illustrative only (NOT the real §3 reconciliation counts) and are replaced the
// moment a gated pull populates cohort_histogram. cohortEdges mirror COHORT_BANDS.
export const SAMPLE_COHORT_HISTOGRAM: CohortHistogram = {
  cohortEdges: COHORT_BANDS.map(({ id, minAge, maxAge }) => ({ id, minAge, maxAge })),
  cohorts: {
    kids3to6: {
      active: { countsByDaysAbsent: { '2': 20, '5': 12, '12': 6, '30': 4 }, overflow365Plus: 1, unknownRecency: 2 },
      lapsed: 34,
    },
    kids7to9: {
      active: { countsByDaysAbsent: { '3': 14, '6': 8, '15': 4, '40': 2 }, overflow365Plus: 0, unknownRecency: 1 },
      lapsed: 21,
    },
    teens10to15: {
      active: { countsByDaysAbsent: { '1': 10, '9': 6, '25': 3 }, overflow365Plus: 1, unknownRecency: 1 },
      lapsed: 18,
    },
    adults16plus: {
      active: { countsByDaysAbsent: { '2': 80, '6': 50, '10': 30, '22': 20, '60': 14 }, overflow365Plus: 6, unknownRecency: 10 },
      lapsed: 240,
    },
    unknownCohort: {
      active: { countsByDaysAbsent: {}, overflow365Plus: 0, unknownRecency: 0 },
      lapsed: 5,
    },
  },
};
