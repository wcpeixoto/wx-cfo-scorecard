// Sustainability card rows — a SNAPSHOT of four existing business-health
// signals, not a new analysis engine. Every value reuses what the locked
// compute layer already exports, so the card can never disagree with the
// rest of the page:
//
//   - Revenue Momentum / Cost Discipline / Monthly Cash Result read
//     model.kpiYoYComparisonByTimeframe (lastMonth = this-month YoY,
//     ttm = long term). No new windows, no re-summing.
//   - Cash Reserve reads the existing cashBalanceSeries (total bank cash,
//     built by buildCashBalanceSeries) and the exported computeRunwayMetric
//     for the canonical funded ratio. It does NOT re-import the raw
//     revenue/expense/rollup contribution functions and does NOT re-sum
//     account balances — a second source of truth would be a drift risk.
//
// Each row carries two year-over-year beats:
//   longTerm  — glyph, 12-month-vs-prior basis (ttm / funded-ratio YoY)
//   thisMonth — last completed month vs the same month one year ago
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

const NOT_ENOUGH = 'Not enough history yet.';

// Join a row's two beats. When BOTH are unavailable, collapse to a single
// "Not enough history yet." rather than repeating it.
function twoBeat(longTermPhrase: string, monthPhrase: string, ltNone: boolean, moNone: boolean): string {
  if (ltNone && moNone) return NOT_ENOUGH;
  return `${longTermPhrase} ${monthPhrase}`;
}

// ── Per-row evidence (copy is locked; verbatim except interpolation) ───────────

function revenueEvidence(lt: Verdict, mo: Verdict, moMetric: MetricPair): string {
  const longTerm =
    lt === 'up' ? 'Growing over the year.' : lt === 'flat' ? 'Flat over the year.' : lt === 'down' ? 'Down over the year.' : NOT_ENOUGH;
  const x = absYoyPctText(moMetric);
  const month =
    mo === 'up' ? `Last month up ${x}%.` : mo === 'flat' ? 'Last month about even.' : mo === 'down' ? `Last month down ${x}%.` : NOT_ENOUGH;
  return twoBeat(longTerm, month, lt === 'none', mo === 'none');
}

function costEvidence(lt: Verdict, mo: Verdict, moMetric: MetricPair): string {
  const longTerm =
    lt === 'up'
      ? 'Costs improved over the year.'
      : lt === 'flat'
        ? 'Costs steady over the year.'
        : lt === 'down'
          ? 'Costs up over the year.'
          : NOT_ENOUGH;
  const x = absYoyPctText(moMetric);
  const month =
    mo === 'up'
      ? `Last month spending improved ${x}%.`
      : mo === 'flat'
        ? 'Last month spending about even.'
        : mo === 'down'
          ? `Last month spending rose ${x}%.`
          : NOT_ENOUGH;
  return twoBeat(longTerm, month, lt === 'none', mo === 'none');
}

function cashResultEvidence(lt: Verdict, mo: Verdict, moMetric: MetricPair): string {
  const longTerm =
    lt === 'up'
      ? 'Cash flow strengthening.'
      : lt === 'flat'
        ? 'Cash flow steady.'
        : lt === 'down'
          ? 'Cash flow getting tighter.'
          : NOT_ENOUGH;
  const pair = moMetric
    ? `${formatCompactUsd(moMetric.current)} vs ${formatCompactUsd(moMetric.previous)} a year ago`
    : '';
  const month =
    mo === 'up'
      ? `Last month improved — ${pair}.`
      : mo === 'flat'
        ? 'Last month about the same.'
        : mo === 'down'
          ? `Last month weaker — ${pair}.`
          : NOT_ENOUGH;
  return twoBeat(longTerm, month, lt === 'none', mo === 'none');
}

function reserveEvidence(lt: Verdict, mo: Verdict, moPair: MetricPair): string {
  const longTerm =
    lt === 'up'
      ? 'Cash cushion stronger over the year.'
      : lt === 'flat'
        ? 'Cash cushion steady over the year.'
        : lt === 'down'
          ? 'Cash cushion weaker over the year.'
          : NOT_ENOUGH;
  const pair = moPair ? `${formatCompactUsd(moPair.current)} vs ${formatCompactUsd(moPair.previous)}` : '';
  const month =
    mo === 'up'
      ? `Cash cushion stronger than last year — ${pair}.`
      : mo === 'flat'
        ? `Cash cushion about the same as last year — ${pair}.`
        : mo === 'down'
          ? `Cash cushion lower than last year — ${pair}.`
          : NOT_ENOUGH;
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

export type SustainabilityRow = {
  label: string;
  /** Optional clarifier — used to distinguish the reserve (a balance) from the
   *  flow rows that share the same two columns. */
  sublabel?: string;
  longTerm: Verdict;
  /** Drives the this-month LABEL ("Getting Better" / "Getting Worse"). */
  thisMonth: Verdict;
  /** Drives the this-month COLOR. Equal to `thisMonth` for every row except
   *  the guarded case where an improving-but-still-negative Monthly Cash Result
   *  is neutralized — green must never signal "fine" on a month that lost
   *  money, even though the trend genuinely improved. */
  thisMonthTone: Verdict;
  /** Two-beat sentence: "[long-term phrase] [latest-month phrase]". */
  evidence?: string;
};

export function buildSustainabilityRows(
  model: DashboardModel,
  cashBalanceSeries: BalancePoint[],
): SustainabilityRow[] {
  const lastMonth = model.kpiYoYComparisonByTimeframe.lastMonth;
  const ttm = model.kpiYoYComparisonByTimeframe.ttm;

  // Cash Reserve shares the OTHER three rows' exact basis: last completed month
  // (lastMonth.currentEndMonth) vs the same month one year earlier
  // (lastMonth.previousEndMonth). Reading those month identifiers off the same
  // comparison the flow rows use guarantees all four answer one question —
  // "stronger or weaker than a year ago" — with zero window drift.
  const currentMonth = lastMonth?.currentEndMonth ?? null;
  const priorMonth = lastMonth?.previousEndMonth ?? null;
  const currentBalance = monthEndBalance(cashBalanceSeries, currentMonth);
  const priorBalance = monthEndBalance(cashBalanceSeries, priorMonth);

  // This-month reserve: month-end total bank cash, this year vs last year.
  const reserveThisMonth: MetricPair =
    currentBalance !== null && priorBalance !== null
      ? { current: currentBalance, previous: priorBalance }
      : null;

  // Long-term reserve: funded ratio (cash ÷ trailing-3-month expense target)
  // now vs one year ago, both via the canonical exported computeRunwayMetric so
  // the target formula is never reimplemented. percentFunded is null when the
  // prior-year 3-month target window is missing — that drops the row to 'none'.
  const fundedNow =
    currentBalance !== null && currentMonth
      ? computeRunwayMetric(model.monthlyRollups, currentBalance, currentMonth, currentMonth).percentFunded
      : null;
  const fundedPrior =
    priorBalance !== null && priorMonth
      ? computeRunwayMetric(model.monthlyRollups, priorBalance, priorMonth, priorMonth).percentFunded
      : null;
  const reserveLongTerm: MetricPair =
    fundedNow !== null && fundedPrior !== null
      ? { current: fundedNow, previous: fundedPrior }
      : null;

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
  const revThisMonthMetric = metricIfBothWindows(lastMonth, (c) => c.revenue);
  const revLongTerm = sustainabilityState(revLongTermMetric, 'up', PCT);
  const revThisMonth = sustainabilityState(revThisMonthMetric, 'up', PCT);

  // Cost Discipline — down = good (inverted), percentage basis.
  const costLongTermMetric = metricIfBothWindows(ttm, (c) => c.expenses);
  const costThisMonthMetric = metricIfBothWindows(lastMonth, (c) => c.expenses);
  const costLongTerm = sustainabilityState(costLongTermMetric, 'down', PCT);
  const costThisMonth = sustainabilityState(costThisMonthMetric, 'down', PCT);

  // Monthly Cash Result — up = good, signed dollars (annual sum long-term,
  // single month this-month). The label tracks the YoY direction, but a month
  // that improved YoY while STILL losing money must not render green — green
  // reads as "fine," and a money-losing month is not fine. So when the current
  // month's net is negative, force the COLOR to neutral while leaving the LABEL
  // as the honest trend. The dollar evidence carries the level.
  const cashLongTermMetric = metricIfBothWindows(ttm, (c) => c.netCashFlow);
  const cashThisMonthMetric = metricIfBothWindows(lastMonth, (c) => c.netCashFlow);
  const cashLongTerm = sustainabilityState(cashLongTermMetric, 'up', USD_ANNUAL);
  const cashThisMonth = sustainabilityState(cashThisMonthMetric, 'up', USD_MONTH);
  const cashIsNegative = (cashThisMonthMetric?.current ?? 0) < 0;
  const cashThisMonthTone: Verdict = cashThisMonth === 'up' && cashIsNegative ? 'flat' : cashThisMonth;

  // Cash Reserve — up = good. Long-term = funded-ratio YoY (a position, matching
  // the shipped glyph); this-month = month-end dollar balance YoY.
  const reserveLong = sustainabilityState(reserveLongTerm, 'up', RATIO);
  const reserveMonth = sustainabilityState(reserveThisMonth, 'up', USD_MONTH);

  return [
    {
      label: 'Revenue Momentum',
      longTerm: revLongTerm,
      thisMonth: revThisMonth,
      thisMonthTone: revThisMonth,
      evidence: revenueEvidence(revLongTerm, revThisMonth, revThisMonthMetric),
    },
    {
      label: 'Cost Discipline',
      longTerm: costLongTerm,
      thisMonth: costThisMonth,
      thisMonthTone: costThisMonth,
      evidence: costEvidence(costLongTerm, costThisMonth, costThisMonthMetric),
    },
    {
      label: 'Monthly Cash Result',
      longTerm: cashLongTerm,
      thisMonth: cashThisMonth,
      thisMonthTone: cashThisMonthTone,
      evidence: cashResultEvidence(cashLongTerm, cashThisMonth, cashThisMonthMetric),
    },
    {
      label: 'Cash Reserve',
      sublabel: 'Month-end reserve vs same month last year',
      longTerm: reserveLong,
      thisMonth: reserveMonth,
      thisMonthTone: reserveMonth,
      evidence: reserveEvidence(reserveLong, reserveMonth, reserveThisMonth),
    },
  ];
}

// ── Display mapping (single source so card + tests can't drift) ───────────────
// Long-term column renders a directional glyph in the existing card vocabulary
// (↑ / ↓ / → / —, matching the Operating Reserve + Cash on Hand cards); the
// this-month column renders descriptive words. Both are colored by the same
// 'up'=good / 'down'=bad verdict.

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

export function thisMonthLabel(v: Verdict): string {
  switch (v) {
    case 'up':
      return 'Getting Better';
    case 'down':
      return 'Getting Worse';
    case 'flat':
      return 'About the Same';
    default:
      return '—';
  }
}
