// Retention aggregate → bucket view (RETENTION_FINISH_PLAN.md §6, PR2 / SPA wiring).
//
// The SPA side of the threshold-free histogram contract: given the non-PII
// `daysAbsentHistogram` the Edge Function persisted (counts by exact whole-day
// absence over ACTIVE members), re-derive the Healthy / Watch / Silent / unknown
// tally at the owner's CURRENT threshold — entirely client-side, with no extra
// Wodify fetch and zero PII.
//
// This is the parity-proven `deriveBuckets` lifted verbatim out of
// `wodifyRetentionAggregate.test.ts` so the shipped function IS the function the
// parity tests cover (that test now imports this module rather than re-declaring
// the rule). Do NOT reimplement the band math from prose: the rule MUST mirror
// `classifyMember`'s PRECEDENCE exactly —
//   if d >= T            → silent
//   else if d >= FLOOR   → watch
//   else                 → healthy
// A naive set of independent range predicates (silent = d>=T, healthy = d<FLOOR)
// DOUBLE-COUNTS when T <= FLOOR: a member at d=6, T=5 is both `>=T` (silent) and
// `<FLOOR` (healthy). Precedence — silent checked first, each bin counted once —
// is what makes `healthy + watch + silent + unknown === activeTotal` hold at every
// threshold, including 1..7.
//
// Consumes (never modifies) silentChurn.ts: WATCH_FLOOR_DAYS is the one Watch
// floor, resolveSilentChurnThresholdDays is the one threshold resolver.

import { WATCH_FLOOR_DAYS, resolveSilentChurnThresholdDays } from './silentChurn';

// The minimal slice of a retention aggregate the bucket derivation needs: the
// threshold-free histogram (sparse exact-day bins + the >= 365 overflow) plus the
// `unknown` count (active members with no usable check-in date). The full server
// `RetentionAggregate` is structurally assignable to this, so the parity test can
// keep passing whole aggregates while the live fetch path passes just these fields.
export type DerivableAggregate = {
  daysAbsentHistogram: {
    countsByDaysAbsent: Record<string, number>;
    overflow365Plus: number;
  };
  unknown: number;
};

// Same field set computeAttendanceHealth returns, so a card can render either the
// live-derived view or the sample classifier result through one code path.
export type DerivedBuckets = {
  thresholdDays: number; // resolved threshold the buckets were cut at
  healthy: number;
  watch: number;
  silent: number;
  unknown: number;
  activeTotal: number; // healthy + watch + silent + unknown (integrity sum)
};

// Re-derive Healthy / Watch / Silent / unknown from the histogram at a threshold.
// `rawThreshold` is resolved here (the same resolver the store + classifier use),
// so callers may pass the stored owner value directly. Precedence per bin mirrors
// classifyMember exactly; the >= 365 overflow is Silent for any T in [1, 365].
export function deriveBuckets(agg: DerivableAggregate, rawThreshold: number): DerivedBuckets {
  const T = resolveSilentChurnThresholdDays(rawThreshold);
  const { countsByDaysAbsent, overflow365Plus } = agg.daysAbsentHistogram;
  let healthy = 0;
  let watch = 0;
  let silent = 0;
  for (const [k, count] of Object.entries(countsByDaysAbsent)) {
    const d = Number(k);
    if (d >= T) silent += count;
    else if (d >= WATCH_FLOOR_DAYS) watch += count;
    else healthy += count;
  }
  silent += overflow365Plus;
  return {
    thresholdDays: T,
    healthy,
    watch,
    silent,
    unknown: agg.unknown,
    activeTotal: healthy + watch + silent + agg.unknown,
  };
}
