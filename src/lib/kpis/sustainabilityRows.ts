// Sustainability card rows — a SNAPSHOT of four existing business-health
// signals, not a new analysis engine. Every value reuses what the locked
// compute layer already exports, so the card can never disagree with the
// rest of the page:
//
//   - Revenue Momentum / Cost Discipline / Monthly Cash Result read the
//     SELECTED-PERIOD window of model.kpiYoYComparisonByTimeframe — .thisMonth
//     (month-to-date YoY, day-truncated by thisMonthPriorYearRollup so the
//     prior-year window covers the same number of days) by default, or
//     .lastMonth (the last closed month) when the toggle picks it — and .ttm
//     for long term.
//   - Cash Reserve reads the existing cashBalanceSeries (total bank cash,
//     built by buildCashBalanceSeries) and the exported computeRunwayMetric
//     for the canonical funded ratio. It does NOT re-import the raw
//     revenue/expense/rollup contribution functions and does NOT re-sum
//     account balances — a second source of truth would be a drift risk.
//
// Each row carries two year-over-year beats:
//   longTerm  — glyph, 12-month-vs-prior basis (ttm / funded-ratio YoY at
//               last completed month-end). Period-INDEPENDENT.
//   period    — the SELECTED period vs the same window a year prior. Flow rows
//               reuse the YoY pair from compute (thisMonth = day-truncated
//               month-to-date; lastMonth = full closed month); Cash Reserve
//               reads as-of-latest-update balance vs the same calendar date a
//               year ago (This Month) or the closed month-end balance vs the
//               same month-end a year ago (Last Month).
//
// ONE calibrated state per beat drives the glyph, the verdict word, the color,
// AND the two-beat evidence sentence — there is no separate path, so the four
// can never contradict (the bug this card had: a near-zero +0.04% TTM rendered
// a confident "up" glyph beside a "down 15%" month evidence string).
//
// Flat band, by metric kind (calibration surface — see PR / pre-commit gate):
//   - Percentage rows (Revenue, Cost) have a large, stable, positive base, so
//     a RELATIVE ±3% band is meaningful and safe.
//   - Dollar rows (Monthly Cash Result, Cash Reserve balance) cross zero and
//     sit near zero, where a relative % explodes (the bug 82c412f fixed for the
//     evidence). They use an ABSOLUTE dollar floor instead.
//   - The funded-ratio long-term reserve beat is a bounded 0–5 ratio, so it
//     uses a small ABSOLUTE ratio band.
//
// Both beats are polarity-normalized so 'up' always means "good" and 'down'
// always means "bad" — the renderer stays dumb and cannot reintroduce a
// polarity bug (Cost Discipline is good when costs fall).

import type { DashboardModel, KpiMetricComparison, KpiTimeframeComparison } from '../data/contract';
import type { BalancePoint } from '../data/balanceSeries';
import { computeRunwayMetric } from './compute';

// ── Calibration constants ─────────────────────────────────────────────────────
// A move within these bands reads "flat" — neither better nor worse.
const FLAT_BAND_PCT = 3; // % rows: |YoY %| ≤ 3 → flat
const FLAT_FLOOR_MONTH_USD = 2_000; // single-month dollar beats (net cash, reserve balance)
const FLAT_FLOOR_ANNUAL_USD = 6_000; // 12-month-sum dollar beat (TTM net cash)
const FLAT_BAND_FUNDED_RATIO = 0.1; // funded-ratio beat (0–5 scale; 0.1 ≈ a tenth of target coverage)

/** 'up' = better · 'down' = worse · 'flat' = no meaningful change · 'none' = no data. */
export type Verdict = 'up' | 'down' | 'flat' | 'none';

type MetricPair = { current: number; previous: number } | null | undefined;

/** Which period the right-hand column reports. Default (and the post-refresh
 *  reset state) is 'thisMonth'; the header dropdown can flip it to 'lastMonth'.
 *  The Long-Term column is unaffected — only the right column re-anchors. */
export type SustainTimeframe = 'thisMonth' | 'lastMonth';

/** Per-period copy. Kept explicit (not derived) so the two bases are visible in
 *  the source and pinned by tests — the comparison genuinely differs by period:
 *   • thisMonth — flows are month-to-date; Reserve is the as-of-latest-update
 *     balance vs the SAME CALENDAR DAY one year ago.
 *   • lastMonth — flows are the last closed month; Reserve is that month's
 *     CLOSING balance vs the same MONTH-END one year ago.
 *  Only phrasing lives here; the math branch lives in buildSustainabilityRows. */
type PeriodCopy = {
  /** Inline flow-beat suffix: "month to date" | "last month". */
  flowSuffix: string;
  /** Inline reserve-beat comparison basis. */
  reserveBasis: string;
  /** Tooltip flow clause (the "and …" half of the basis sentence). */
  tooltipFlowClause: string;
  /** Tooltip reserve sentence (full sentence — the bases read differently). */
  tooltipReserveClause: string;
  /** Cash proof-line label for the current value. */
  cashProofLabel: string;
  /** Reserve proof-line label for the current value. */
  reserveProofLabel: string;
  /** Empty-state text for the right-column (period) beat. Period-specific so it
   *  reads "this month" / "last month"; the long-term beat and the both-empty
   *  collapse keep the generic NOT_ENOUGH. */
  notEnoughPeriod: string;
};

const PERIOD_COPY: Record<SustainTimeframe, PeriodCopy> = {
  thisMonth: {
    flowSuffix: 'month to date',
    reserveBasis: 'vs same point last year',
    tooltipFlowClause: 'month to date vs the same period one year ago',
    tooltipReserveClause:
      'Current reserve compares cash after the latest transaction update to the same point one year ago.',
    cashProofLabel: 'Month to date',
    reserveProofLabel: 'Current reserve',
    notEnoughPeriod: 'Not enough history this month yet.',
  },
  lastMonth: {
    flowSuffix: 'last month',
    reserveBasis: 'vs the same month last year',
    tooltipFlowClause: 'last month vs the same month one year ago',
    tooltipReserveClause:
      'Last month compares the closing reserve to the same month-end one year ago.',
    cashProofLabel: 'Last month',
    reserveProofLabel: 'Last month reserve',
    notEnoughPeriod: 'Not enough history last month yet.',
  },
};

/**
 * How "flat" is decided for a beat:
 *  - 'pct'   relative band on a large, stable, positive base; prior 0 → 'none'
 *            (can't divide), matching the percentage-row unavailable rule.
 *  - 'usd'   absolute dollar floor; a 0 or negative prior is a VALID state
 *            (breakeven / a money-losing month are real), so only a missing
 *            pair is 'none'.
 *  - 'ratio' absolute band on a bounded ratio; same prior-0-is-valid rule.
 */
type FlatRule =
  | { kind: 'pct'; band: number }
  | { kind: 'usd'; floor: number }
  | { kind: 'ratio'; band: number };

// Raw direction with the kind-appropriate flat band. No polarity here.
function rawState(metric: MetricPair, flat: FlatRule): Verdict {
  if (!metric) return 'none';
  const delta = metric.current - metric.previous;
  if (flat.kind === 'pct') {
    if (metric.previous === 0) return 'none'; // divide-by-zero → unavailable
    const pct = (delta / Math.abs(metric.previous)) * 100;
    if (Math.abs(pct) <= flat.band) return 'flat';
    return pct > 0 ? 'up' : 'down';
  }
  // 'usd' | 'ratio' — absolute band; prior 0/negative is a valid comparison.
  const tol = flat.kind === 'usd' ? flat.floor : flat.band;
  if (Math.abs(delta) <= tol) return 'flat';
  return delta > 0 ? 'up' : 'down';
}

/**
 * Polarity-normalized state. `goodWhen` names the RAW direction that is GOOD
 * for this metric — 'down' for costs (a fall is good), 'up' for everything else.
 * Exported so card + tests share one rule.
 */
export function sustainabilityState(metric: MetricPair, goodWhen: 'up' | 'down', flat: FlatRule): Verdict {
  const t = rawState(metric, flat);
  if (t === 'none' || t === 'flat') return t;
  return t === goodWhen ? 'up' : 'down';
}

// A flow beat (Revenue / Cost / Monthly Cash Result) is a real YoY comparison
// only when BOTH of its windows actually have history. computeKpiYoYComparisons
// fabricates a zero for an empty window — current AND previous — while recording
// the truth in current/previousMonthCount. resolveAnchorMonth pins the current
// window to the literal calendar month without clamping to available data, so a
// thin- or lagging-history workspace can land currentMonthCount: 0 with a real
// prior (or vice-versa). Without a window-presence gate those render a phantom
// verdict — "$0 vs $11K a year ago" (no current data), or "down 100%" for the
// percentage rows — instead of "Not enough history yet."
//
// Gate on window PRESENCE, not value: a genuine $0 month (count > 0) still
// compares as a real breakeven, and the percentage rows keep their own
// divide-by-zero guard for a real zero prior. The same gated value feeds both
// state and evidence, so the verdict and the sentence can never disagree.
function metricIfBothWindows(
  comparison: KpiTimeframeComparison | null | undefined,
  pick: (c: KpiTimeframeComparison) => KpiMetricComparison,
): MetricPair {
  if (!comparison || comparison.currentMonthCount <= 0 || comparison.previousMonthCount <= 0) return null;
  return pick(comparison);
}

// Whole-number absolute YoY percentage for the "{x}%" copy. Only called for
// up/down beats, where the prior is non-zero (a zero prior is 'none').
function absYoyPctText(metric: MetricPair): string {
  if (!metric || metric.previous === 0) return '0';
  return String(Math.abs(Math.round(((metric.current - metric.previous) / Math.abs(metric.previous)) * 100)));
}

function formatCompactUsd(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${Math.round(abs)}`;
}

// Display-only absolute YoY dollar delta for the "{diff}" copy slots. Pure
// subtraction over the SAME gated MetricPair the verdict already uses — no new
// math, no new threshold. The direction-bearing verb in the sentence
// ("improved" / "down" / "higher" / "lower") carries the sign, so the magnitude
// is always shown absolute.
function formatAbsDiff(metric: MetricPair): string {
  if (!metric) return '';
  return formatCompactUsd(Math.abs(metric.current - metric.previous));
}

const NOT_ENOUGH = 'Not enough history yet.';

// Join a row's two beats. When BOTH are unavailable, collapse to a single
// "Not enough history yet." rather than repeating it.
function twoBeat(longTermPhrase: string, monthPhrase: string, ltNone: boolean, moNone: boolean): string {
  if (ltNone && moNone) return NOT_ENOUGH;
  return `${longTermPhrase} ${monthPhrase}`;
}

// ── Per-row evidence (copy is locked; verbatim except interpolation) ───────────

function revenueEvidence(lt: Verdict, mo: Verdict, moMetric: MetricPair, p: PeriodCopy): string {
  const longTerm =
    lt === 'up'
      ? 'Revenue up over the last 12 months.'
      : lt === 'flat'
        ? 'Revenue steady over the last 12 months.'
        : lt === 'down'
          ? 'Revenue down over the last 12 months.'
          : NOT_ENOUGH;
  const x = absYoyPctText(moMetric);
  const month =
    mo === 'up'
      ? `Revenue up ${x}% ${p.flowSuffix}.`
      : mo === 'flat'
        ? `Revenue about even ${p.flowSuffix}.`
        : mo === 'down'
          ? `Revenue down ${x}% ${p.flowSuffix}.`
          : p.notEnoughPeriod;
  return twoBeat(longTerm, month, lt === 'none', mo === 'none');
}

function costEvidence(lt: Verdict, mo: Verdict, moMetric: MetricPair, p: PeriodCopy): string {
  const longTerm =
    lt === 'up'
      ? 'Costs down over the last 12 months.'
      : lt === 'flat'
        ? 'Costs steady over the last 12 months.'
        : lt === 'down'
          ? 'Costs up over the last 12 months.'
          : NOT_ENOUGH;
  const x = absYoyPctText(moMetric);
  const month =
    mo === 'up'
      ? `Spending down ${x}% ${p.flowSuffix}.`
      : mo === 'flat'
        ? `Spending about even ${p.flowSuffix}.`
        : mo === 'down'
          ? `Spending up ${x}% ${p.flowSuffix}.`
          : p.notEnoughPeriod;
  return twoBeat(longTerm, month, lt === 'none', mo === 'none');
}

function cashResultEvidence(lt: Verdict, mo: Verdict, moMetric: MetricPair, smallerLoss: boolean, p: PeriodCopy): string {
  const longTerm =
    lt === 'up'
      ? 'Cash result better over the last 12 months.'
      : lt === 'flat'
        ? 'Cash result steady over the last 12 months.'
        : lt === 'down'
          ? 'Cash result weaker over the last 12 months.'
          : NOT_ENOUGH;
  const diff = formatAbsDiff(moMetric);
  const month =
    mo === 'up'
      ? smallerLoss
        ? `Smaller loss: ${diff} better ${p.flowSuffix}.`
        : `Monthly result improved ${diff} ${p.flowSuffix}.`
      : mo === 'flat'
        ? `Monthly result about the same ${p.flowSuffix}.`
        : mo === 'down'
          ? `Monthly result down ${diff} ${p.flowSuffix}.`
          : p.notEnoughPeriod;
  return twoBeat(longTerm, month, lt === 'none', mo === 'none');
}

function reserveEvidence(lt: Verdict, mo: Verdict, moPair: MetricPair, p: PeriodCopy): string {
  const longTerm =
    lt === 'up'
      ? 'Cash reserve stronger over the last 12 months.'
      : lt === 'flat'
        ? 'Cash reserve steady over the last 12 months.'
        : lt === 'down'
          ? 'Cash reserve weaker over the last 12 months.'
          : NOT_ENOUGH;
  const diff = formatAbsDiff(moPair);
  const month =
    mo === 'up'
      ? `Reserve is ${diff} higher ${p.reserveBasis}.`
      : mo === 'flat'
        ? `Reserve is about the same ${p.reserveBasis}.`
        : mo === 'down'
          ? `Reserve is ${diff} lower ${p.reserveBasis}.`
          : p.notEnoughPeriod;
  return twoBeat(longTerm, month, lt === 'none', mo === 'none');
}

// Last point of the (dense, daily, ascending) cashBalanceSeries that falls in
// the given 'YYYY-MM' month = that month's month-end balance. Returns null when
// the month is absent — the caller renders an honest "no comparison" state
// rather than a wrong number.
export function monthEndBalance(series: BalancePoint[], month: string | null): number | null {
  if (!month) return null;
  let found: number | null = null;
  for (const point of series) {
    const pointMonth = point.dateISO.slice(0, 7);
    if (pointMonth === month) found = point.balance;
    else if (pointMonth > month) break;
  }
  return found;
}

// Latest balance point that falls in the given 'YYYY-MM' month. For the
// CURRENT month (partial), that's the as-of-latest-update balance anchored
// to the latest imported transaction date. Returns null when the month has
// no points. Caller uses .dateISO to derive the prior-year comparison date,
// so the basis is transaction-date anchored, not wall-clock.
export function lastBalancePointInMonth(series: BalancePoint[], month: string | null): BalancePoint | null {
  if (!month) return null;
  let found: BalancePoint | null = null;
  for (const point of series) {
    const pointMonth = point.dateISO.slice(0, 7);
    if (pointMonth === month) found = point;
    else if (pointMonth > month) break;
  }
  return found;
}

// Latest balance point on or before a target ISO date. Robust to gaps (the
// series only emits points within [minTxnDate..maxTxnDate], so dates outside
// that window fall back to the nearest prior point — or null if before the
// series starts). String comparison is correct on ISO YYYY-MM-DD strings.
export function balanceAtOrBefore(series: BalancePoint[], targetDate: string | null): number | null {
  if (!targetDate) return null;
  let found: number | null = null;
  for (const point of series) {
    if (point.dateISO <= targetDate) found = point.balance;
    else break;
  }
  return found;
}

// Same calendar month/day in the prior year. For 2024-02-29 this produces
// '2023-02-29' (an invalid calendar date but a valid string). The caller
// passes the result to balanceAtOrBefore, which string-compares against
// the actual series dates and naturally falls back to '2023-02-28'. This
// is preferred over -365d which drifts by a day in leap years. The user-
// facing copy says "same POINT last year" (not "same date") so the rare
// Feb-29 → Feb-28 falloff isn't a copy lie.
export function sameCalendarDayPriorYear(dateISO: string): string {
  const year = Number(dateISO.slice(0, 4));
  const monthDay = dateISO.slice(5); // "MM-DD"
  return `${year - 1}-${monthDay}`;
}

export type SustainabilityRow = {
  label: string;
  /** Optional clarifier — used to distinguish the reserve (a balance) from the
   *  flow rows that share the same two columns. */
  sublabel?: string;
  longTerm: Verdict;
  /** Right-column verdict for the selected period (This Month / Last Month) —
   *  drives the pill color and the shared pill label. */
  period: Verdict;
  /** Right-column COLOR for the selected period. Equal to `period` for every
   *  row; retained as a per-row color extension point. (Previously neutralized
   *  an improving-but-still-negative Monthly Cash Result to gray; that case is
   *  now a green "Smaller Loss" pill via periodLabel.) */
  periodTone: Verdict;
  /** Optional per-row pill-label override. When set, the renderer uses this
   *  instead of the shared periodVerdictLabel(verdict) mapping. Used by Monthly
   *  Cash Result to show "Smaller Loss" on an improved-but-still-negative month. */
  periodLabel?: string;
  /** Two-beat sentence: "[long-term phrase] [latest-month phrase]". */
  evidence?: string;
  /** Per-row tooltip body lines (comparison-basis explanation + optional proof
   *  values), rendered one <li> each. Built in the data layer so proof values
   *  reuse the same MetricPair as the inline evidence — no new selector. */
  tooltip?: string[];
};

export function buildSustainabilityRows(
  model: DashboardModel,
  cashBalanceSeries: BalancePoint[],
  timeframe: SustainTimeframe = 'thisMonth',
): SustainabilityRow[] {
  const thisMonth = model.kpiYoYComparisonByTimeframe.thisMonth;
  const lastMonth = model.kpiYoYComparisonByTimeframe.lastMonth;
  const ttm = model.kpiYoYComparisonByTimeframe.ttm;

  const p = PERIOD_COPY[timeframe];
  // The right column reports the SELECTED period; the flow rows read their YoY
  // pair straight off the matching comparison window. (Long Term is unaffected.)
  const periodComparison = timeframe === 'lastMonth' ? lastMonth : thisMonth;

  // ── Cash Reserve — split anchoring for label-truthfulness ──────────────────
  // The Long-Term funded ratio (the THUMB glyph) reads more honestly off a
  // CLOSED month than a partial one: a trailing-3-month expense target divided
  // into a still-moving balance jitters around mid-month. So Reserve's two
  // beats anchor independently, and the right-column beat ALSO depends on the
  // selected period:
  //   - Long-term (thumb glyph): funded ratio at LAST COMPLETED month-end
  //     (lastMonth.currentEndMonth) vs same month one year prior. Same anchors
  //     the compute layer has always used; same as #324. Period-INDEPENDENT.
  //   - This Month (right column): AS-OF-LATEST-UPDATE balance in the current
  //     month vs balance on the same CALENDAR DAY a year ago.
  //   - Last Month (right column): the last completed month's CLOSING balance
  //     vs the same MONTH-END a year ago (the same month-end anchors the
  //     funded ratio uses, but as raw dollars — not a ratio).
  // All transaction-date anchored — no wall-clock "today" anywhere.

  // Long-term reserve anchors (closed-month basis, unchanged).
  const ltCurrentMonth = lastMonth?.currentEndMonth ?? null;
  const ltPriorMonth = lastMonth?.previousEndMonth ?? null;
  const ltCurrentBalance = monthEndBalance(cashBalanceSeries, ltCurrentMonth);
  const ltPriorBalance = monthEndBalance(cashBalanceSeries, ltPriorMonth);

  // Long-term reserve: funded ratio (cash ÷ trailing-3-month expense target)
  // now vs one year ago, both via the canonical exported computeRunwayMetric so
  // the target formula is never reimplemented. percentFunded is null when the
  // prior-year 3-month target window is missing — that drops the row to 'none'.
  const fundedNow =
    ltCurrentBalance !== null && ltCurrentMonth
      ? computeRunwayMetric(model.monthlyRollups, ltCurrentBalance, ltCurrentMonth, ltCurrentMonth).percentFunded
      : null;
  const fundedPrior =
    ltPriorBalance !== null && ltPriorMonth
      ? computeRunwayMetric(model.monthlyRollups, ltPriorBalance, ltPriorMonth, ltPriorMonth).percentFunded
      : null;
  const reserveLongTerm: MetricPair =
    fundedNow !== null && fundedPrior !== null
      ? { current: fundedNow, previous: fundedPrior }
      : null;

  // This-month reserve: as-of-latest-update vs same-calendar-day prior year.
  // The "current" anchor month is the in-progress month (thisMonth.currentEndMonth);
  // the latest balance point IN that month is the as-of-latest-update balance,
  // and its dateISO is the latest-current-month-txn-date that the data was
  // imported through. The prior-year comparison uses the same calendar day,
  // string-compared against the series — leap-year invariant.
  const mtdCurrentMonth = thisMonth?.currentEndMonth ?? null;
  const lastPointInCurrent = lastBalancePointInMonth(cashBalanceSeries, mtdCurrentMonth);
  const mtdCurrentBalance = lastPointInCurrent?.balance ?? null;
  const mtdPriorDate = lastPointInCurrent ? sameCalendarDayPriorYear(lastPointInCurrent.dateISO) : null;
  const mtdPriorBalance = balanceAtOrBefore(cashBalanceSeries, mtdPriorDate);
  const reserveThisMonth: MetricPair =
    mtdCurrentBalance !== null && mtdPriorBalance !== null
      ? { current: mtdCurrentBalance, previous: mtdPriorBalance }
      : null;

  // Last-month reserve: the last closed month's month-END balance vs the same
  // month-end one year ago — the SAME anchors the funded ratio uses, as raw
  // dollars. Reuses the already-computed month-end balances (no new lookup).
  const reserveLastMonth: MetricPair =
    ltCurrentBalance !== null && ltPriorBalance !== null
      ? { current: ltCurrentBalance, previous: ltPriorBalance }
      : null;

  // The right-column reserve pair follows the selected period.
  const reservePeriodPair: MetricPair = timeframe === 'lastMonth' ? reserveLastMonth : reserveThisMonth;

  const PCT: FlatRule = { kind: 'pct', band: FLAT_BAND_PCT };
  const USD_MONTH: FlatRule = { kind: 'usd', floor: FLAT_FLOOR_MONTH_USD };
  const USD_ANNUAL: FlatRule = { kind: 'usd', floor: FLAT_FLOOR_ANNUAL_USD };
  const RATIO: FlatRule = { kind: 'ratio', band: FLAT_BAND_FUNDED_RATIO };

  // Each flow beat is gated on BOTH its windows having real history (see
  // metricIfBothWindows), so a thin/lagging-history workspace renders "Not
  // enough history yet." instead of a phantom verdict against a fabricated zero
  // ("$0 vs $11K a year ago", or "down 100%" for the percentage rows). The SAME
  // gated value feeds both the state and the evidence string, so the verdict and
  // the sentence can never disagree.

  // Revenue Momentum — up = good, percentage basis.
  const revLongTermMetric = metricIfBothWindows(ttm, (c) => c.revenue);
  const revPeriodMetric = metricIfBothWindows(periodComparison, (c) => c.revenue);
  const revLongTerm = sustainabilityState(revLongTermMetric, 'up', PCT);
  const revPeriod = sustainabilityState(revPeriodMetric, 'up', PCT);

  // Cost Discipline — down = good (inverted), percentage basis.
  const costLongTermMetric = metricIfBothWindows(ttm, (c) => c.expenses);
  const costPeriodMetric = metricIfBothWindows(periodComparison, (c) => c.expenses);
  const costLongTerm = sustainabilityState(costLongTermMetric, 'down', PCT);
  const costPeriod = sustainabilityState(costPeriodMetric, 'down', PCT);

  // Monthly Cash Result — up = good, signed dollars (annual sum long-term,
  // single-month for the selected period). A month that improved YoY while
  // STILL losing money is surfaced as a GREEN "Smaller Loss" pill: the label
  // carries the truth that the month lost money, so the color can honor the
  // genuine improvement. (Reverses the prior gray-pill guard — the label, not
  // the color, now does the truth-telling.) periodTone tracks the verdict
  // for every row now and is retained only as a per-row color extension point.
  const cashLongTermMetric = metricIfBothWindows(ttm, (c) => c.netCashFlow);
  const cashPeriodMetric = metricIfBothWindows(periodComparison, (c) => c.netCashFlow);
  const cashLongTerm = sustainabilityState(cashLongTermMetric, 'up', USD_ANNUAL);
  const cashPeriod = sustainabilityState(cashPeriodMetric, 'up', USD_MONTH);
  // Smaller-loss case: improved YoY (verdict 'up') but the period is still in the
  // red. Gate on the CURRENT value (< 0), not the diff.
  const cashSmallerLoss = cashPeriod === 'up' && (cashPeriodMetric?.current ?? 0) < 0;
  const cashPeriodTone: Verdict = cashPeriod;
  const cashPeriodPillLabel: string | undefined = cashSmallerLoss ? 'Smaller Loss' : undefined;

  // Cash Reserve — up = good. Long-term = funded-ratio YoY at last completed
  // month-end (a stable position matching the shipped glyph); right column =
  // the selected-period balance pair (see reservePeriodPair above).
  const reserveLong = sustainabilityState(reserveLongTerm, 'up', RATIO);
  const reservePeriod = sustainabilityState(reservePeriodPair, 'up', USD_MONTH);

  // ── Per-row tooltips ───────────────────────────────────────────────────────
  // Comparison-basis explanation + (where available) proof values. Proof values
  // reuse the SAME gated MetricPair the inline evidence uses — no new selector,
  // no new data path. A proof line is omitted when the pair is unavailable.
  const revenueTooltip = [
    `Compares revenue over two periods: the last 12 months vs the prior 12 months, and ${p.tooltipFlowClause}.`,
  ];
  const costTooltip = [
    `Compares spending over two periods: the last 12 months vs the prior 12 months, and ${p.tooltipFlowClause}. Lower spending is better.`,
  ];
  const cashTooltip = [
    `Compares net cash result over two periods: the last 12 months vs the prior 12 months, and ${p.tooltipFlowClause}.`,
  ];
  if (cashPeriodMetric) {
    cashTooltip.push(
      `${p.cashProofLabel}: ${formatCompactUsd(cashPeriodMetric.current)}. Last year: ${formatCompactUsd(cashPeriodMetric.previous)}.`,
    );
  }
  const reserveTooltip = [
    `Long-term compares reserve strength over the last 12 months, using the latest closed month. ${p.tooltipReserveClause}`,
  ];
  if (reservePeriodPair) {
    reserveTooltip.push(
      `${p.reserveProofLabel}: ${formatCompactUsd(reservePeriodPair.current)}. Last year: ${formatCompactUsd(reservePeriodPair.previous)}.`,
    );
  }

  return [
    {
      label: 'Revenue Momentum',
      longTerm: revLongTerm,
      period: revPeriod,
      periodTone: revPeriod,
      evidence: revenueEvidence(revLongTerm, revPeriod, revPeriodMetric, p),
      tooltip: revenueTooltip,
    },
    {
      label: 'Cost Discipline',
      longTerm: costLongTerm,
      period: costPeriod,
      periodTone: costPeriod,
      evidence: costEvidence(costLongTerm, costPeriod, costPeriodMetric, p),
      tooltip: costTooltip,
    },
    {
      label: 'Monthly Cash Result',
      longTerm: cashLongTerm,
      period: cashPeriod,
      periodTone: cashPeriodTone,
      periodLabel: cashPeriodPillLabel,
      evidence: cashResultEvidence(cashLongTerm, cashPeriod, cashPeriodMetric, cashSmallerLoss, p),
      tooltip: cashTooltip,
    },
    {
      label: 'Cash Reserve',
      longTerm: reserveLong,
      period: reservePeriod,
      periodTone: reservePeriod,
      evidence: reserveEvidence(reserveLong, reservePeriod, reservePeriodPair, p),
      tooltip: reserveTooltip,
    },
  ];
}

// ── Display mapping (single source so card + tests can't drift) ───────────────
// Long-term column renders a directional glyph in the existing card vocabulary
// (↑ / ↓ / → / —, matching the Operating Reserve + Cash on Hand cards); the
// selected-period column renders descriptive words. Both are colored by the
// same 'up'=good / 'down'=bad verdict.

export function longTermGlyph(v: Verdict): string {
  switch (v) {
    case 'up':
      return '↑';
    case 'down':
      return '↓';
    case 'flat':
      return '→';
    default:
      return '—';
  }
}

export function longTermLabel(v: Verdict): string {
  switch (v) {
    case 'up':
      return 'Stronger than a year ago';
    case 'down':
      return 'Weaker than a year ago';
    case 'flat':
      return 'About the same as a year ago';
    default:
      return 'Not enough history';
  }
}

export function periodVerdictLabel(v: Verdict): string {
  switch (v) {
    case 'up':
      return 'Improving';
    case 'down':
      return 'Getting Worse';
    case 'flat':
      return 'About the Same';
    default:
      return '—';
  }
}
