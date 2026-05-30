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
// Each row carries two year-over-year verdicts:
//   longTerm  — thumb, 12-month-vs-prior basis (ttm / funded-ratio YoY)
//   thisMonth — last completed month vs the same month one year ago
//
// Both verdicts are polarity-normalized so 'up' always means "good" and
// 'down' always means "bad" — the renderer stays dumb and cannot reintroduce
// a polarity bug (Cost Discipline is good when costs fall).

import type { DashboardModel } from '../data/contract';
import type { BalancePoint } from '../data/balanceSeries';
import { computeRunwayMetric } from './compute';

const EPSILON = 0.00001;

/** 'up' = good · 'down' = bad · 'flat' = no meaningful change · 'none' = no data. */
export type Verdict = 'up' | 'down' | 'flat' | 'none';

type MetricPair = { current: number; previous: number } | null | undefined;

// Raw trend rule, identical to the prior Sustainability block: a single
// {current, previous} carries no streak, so direction is just the sign of the
// delta measured against EPSILON. Exported so card + tests share one rule.
export function trendOf(metric: MetricPair): Verdict {
  if (!metric) return 'none';
  const delta = metric.current - metric.previous;
  return Math.abs(delta) <= EPSILON ? 'flat' : delta > 0 ? 'up' : 'down';
}

// Normalize a raw trend into good/bad space. `goodWhen` names the raw
// direction that is GOOD for this metric — 'down' for costs (a fall is good),
// 'up' for everything else here.
function verdictFor(metric: MetricPair, goodWhen: 'up' | 'down'): Verdict {
  const t = trendOf(metric);
  if (t === 'none' || t === 'flat') return t;
  return t === goodWhen ? 'up' : 'down';
}

// "Up 8% YoY" / "Down 5% YoY" / "Flat YoY" — describes the RAW metric move
// (the verdict, not the evidence, carries good/bad). For metrics with a large,
// stable positive base (revenue, expenses) the percentage is meaningful.
function yoyPercentEvidence(metric: MetricPair): string | undefined {
  if (!metric) return undefined;
  const t = trendOf(metric);
  if (t === 'none') return undefined;
  if (t === 'flat') return 'Flat YoY';
  const pct =
    Math.abs(metric.previous) <= EPSILON
      ? null
      : Math.round((Math.abs(metric.current - metric.previous) / Math.abs(metric.previous)) * 100);
  return `${t === 'up' ? 'Up' : 'Down'}${pct === null ? '' : ` ${pct}%`} YoY`;
}

function formatCompactUsd(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${Math.round(abs)}`;
}

// Monthly Cash Result is a FLOW that crosses zero, so a YoY *percentage*
// explodes off a near-zero prior month (e.g. a $50 prior April reads as
// "+6624%") — the same owner-facing nonsense the reserve-coverage delta
// avoided by switching from relative to absolute. Show signed dollar
// magnitudes instead, with the same "vs a year ago" phrasing as Cash Reserve.
function dollarYoYEvidence(metric: MetricPair): string | undefined {
  if (!metric) return undefined;
  return `${formatCompactUsd(metric.current)} vs ${formatCompactUsd(metric.previous)} a year ago`;
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

  const reserveEvidence = reserveThisMonth
    ? `${formatCompactUsd(currentBalance as number)} vs ${formatCompactUsd(priorBalance as number)} a year ago`
    : 'Not enough history';

  // Monthly Cash Result this-month verdict + the color guard. The label tracks
  // the YoY direction (improving = "Getting Better"), but a month that improved
  // YoY while STILL losing money must not render green — green reads as "fine,"
  // and a money-losing month is not fine. So when the current month's net is
  // negative, force the COLOR to neutral while leaving the LABEL as the honest
  // trend. The dollar evidence ("-$3.8K vs -$6.5K a year ago") carries the level.
  const cashThisMonth = verdictFor(lastMonth?.netCashFlow, 'up');
  const cashIsNegative = (lastMonth?.netCashFlow?.current ?? 0) < 0;
  const cashThisMonthTone: Verdict =
    cashThisMonth === 'up' && cashIsNegative ? 'flat' : cashThisMonth;

  return [
    {
      label: 'Revenue Momentum',
      longTerm: verdictFor(ttm?.revenue, 'up'),
      thisMonth: verdictFor(lastMonth?.revenue, 'up'),
      thisMonthTone: verdictFor(lastMonth?.revenue, 'up'),
      evidence: yoyPercentEvidence(lastMonth?.revenue),
    },
    {
      label: 'Cost Discipline',
      longTerm: verdictFor(ttm?.expenses, 'down'),
      thisMonth: verdictFor(lastMonth?.expenses, 'down'),
      thisMonthTone: verdictFor(lastMonth?.expenses, 'down'),
      evidence: yoyPercentEvidence(lastMonth?.expenses),
    },
    {
      label: 'Monthly Cash Result',
      longTerm: verdictFor(ttm?.netCashFlow, 'up'),
      thisMonth: cashThisMonth,
      thisMonthTone: cashThisMonthTone,
      evidence: dollarYoYEvidence(lastMonth?.netCashFlow),
    },
    {
      label: 'Cash Reserve',
      sublabel: 'Month-end reserve vs same month last year',
      longTerm: verdictFor(reserveLongTerm, 'up'),
      thisMonth: verdictFor(reserveThisMonth, 'up'),
      thisMonthTone: verdictFor(reserveThisMonth, 'up'),
      evidence: reserveEvidence,
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
