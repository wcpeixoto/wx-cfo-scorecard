// Year-over-year comparator for the age-cohort RATE series (member_retention_by_cohort).
//
// PURE (no React, no I/O). Compares one age band's rate for the currently displayed month
// against the SAME CALENDAR MONTH one year earlier (seasonality-neutral) — never
// month-over-month. Basis is ALWAYS YoY; there is no MoM fallback.
//
// It reuses cohortRowToPoint (the single source of the returning/(returning+lost) rate,
// which already returns null for suppressed rows and zero-denominator bands) and churnPctOf
// — the retention-rate formula is NOT re-implemented here. A null point on EITHER side, a
// missing month, or a seed/pre-tracking month on either side yields "hide".
//
// SEED / PRE-TRACKING EXCLUSION (sourced from the live view, not a hardcoded date): the
// caller passes `dataBeginsMonth`, the first NON-seed tracked month from the All view
// (buildRetentionEvolutionView). Any month earlier than it is the excluded seed (2025-06)
// or pre-history, so we reject the pair if EITHER the displayed month or its year-ago
// partner is < dataBeginsMonth. This is why Jun-2026 renders no pill (its partner Jun-2025
// is the seed) and the first pill is Jul-2026 vs Jul-2025 (== dataBeginsMonth, allowed).

import type { CohortRetentionRow } from './fetchMemberRetentionByCohort';
import { cohortRowToPoint, type PlottedCohortBand } from './memberRetentionCohortSeries';
import { churnPctOf, type RetentionEvolutionPoint, type RetentionMetric } from './memberRetentionSeries';

// Signed delta is in the DISPLAYED metric (current − year-ago), one decimal. `direction` is
// SEMANTIC good/bad: retention higher = better, churn lower = better; exactly-equal = neutral.
export type CohortYoYResult =
  | { status: 'hide' }
  | { status: 'show'; deltaPp: number; direction: 'better' | 'worse' | 'neutral' };

const MONTHS_PER_YEAR = 12;

// 'YYYY-MM' shifted by whole months. Pure integer month arithmetic — no Date, no timezone.
function shiftMonth(periodMonth: string, deltaMonths: number): string {
  const [y, m] = periodMonth.split('-').map(Number);
  const total = y * MONTHS_PER_YEAR + (m - 1) + deltaMonths; // m is 1-based → 0-based index
  const ny = Math.floor(total / MONTHS_PER_YEAR);
  const nm = ((total % MONTHS_PER_YEAR) + MONTHS_PER_YEAR) % MONTHS_PER_YEAR; // 0-based, non-negative
  return `${ny}-${String(nm + 1).padStart(2, '0')}`;
}

function metricPct(point: RetentionEvolutionPoint, metric: RetentionMetric): number {
  return metric === 'churn' ? churnPctOf(point) : point.retentionPct;
}

export function computeCohortYoY(args: {
  rows: CohortRetentionRow[]; // the FULL raw cohort series (still contains the seed month)
  band: PlottedCohortBand;
  displayedMonth: string; // the currently displayed window's LAST visible month
  dataBeginsMonth: string; // first non-seed tracked month (from the live All view)
  metric: RetentionMetric; // the metric the card is currently showing
}): CohortYoYResult {
  const { rows, band, displayedMonth, dataBeginsMonth, metric } = args;

  const yearAgoMonth = shiftMonth(displayedMonth, -MONTHS_PER_YEAR);
  // Reject the seed / pre-tracking on BOTH sides.
  if (displayedMonth < dataBeginsMonth || yearAgoMonth < dataBeginsMonth) return { status: 'hide' };

  const findRow = (month: string): CohortRetentionRow | null =>
    rows.find((r) => r.periodMonth === month && r.cohortBand === band) ?? null;
  const curRow = findRow(displayedMonth);
  const priorRow = findRow(yearAgoMonth);
  if (!curRow || !priorRow) return { status: 'hide' }; // missing month on either side

  const curPoint = cohortRowToPoint(curRow);
  const priorPoint = cohortRowToPoint(priorRow);
  // null ⇔ suppressed row or zero-denominator band — never coerced to 0.
  if (curPoint === null || priorPoint === null) return { status: 'hide' };

  const cur = metricPct(curPoint, metric);
  const prior = metricPct(priorPoint, metric);
  const deltaPp = Math.round((cur - prior) * 10) / 10;

  if (deltaPp === 0) return { status: 'show', deltaPp: 0, direction: 'neutral' };
  const higherIsBetter = metric === 'retention';
  const improved = higherIsBetter ? cur > prior : cur < prior;
  return { status: 'show', deltaPp, direction: improved ? 'better' : 'worse' };
}
