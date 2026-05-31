import { describe, it, expect } from 'vitest';
import type { BalancePoint } from '../data/balanceSeries';
import type {
  DashboardModel,
  KpiMetricComparison,
  KpiTimeframeComparison,
  MonthlyRollup,
} from '../data/contract';
import { buildSustainabilityRows, sustainabilityState, monthEndBalance, thisMonthLabel } from './sustainabilityRows';

// ── Fixture builders ────────────────────────────────────────────────────────

function metric(current: number, previous: number): KpiMetricComparison {
  return {
    current,
    previous,
    delta: current - previous,
    percentChange: previous === 0 ? null : ((current - previous) / Math.abs(previous)) * 100,
  };
}

function comparison(
  currentEndMonth: string | null,
  previousEndMonth: string | null,
  metrics: Partial<
    Pick<
      KpiTimeframeComparison,
      'revenue' | 'expenses' | 'netCashFlow' | 'savingsRate' | 'currentMonthCount' | 'previousMonthCount'
    >
  >,
): KpiTimeframeComparison {
  return {
    timeframe: 'lastMonth',
    currentStartMonth: currentEndMonth,
    currentEndMonth,
    previousStartMonth: previousEndMonth,
    previousEndMonth,
    currentMonthCount: 1,
    previousMonthCount: 1,
    revenue: metric(0, 0),
    expenses: metric(0, 0),
    netCashFlow: metric(0, 0),
    savingsRate: metric(0, 0),
    ...metrics,
  };
}

function rollup(month: string, expenses: number): MonthlyRollup {
  return { month, revenue: expenses, expenses, netCashFlow: 0, savingsRate: 0, transactionCount: 10 };
}

// Build a monthly-rollup history covering 2025-01..2026-04 so a trailing-3
// reserve target exists for both the current (2026-04) and prior (2025-04)
// sample months.
function rollupHistory(expensesPerMonth = 10_000): MonthlyRollup[] {
  const months: string[] = [];
  for (let m = 1; m <= 12; m++) months.push(`2025-${String(m).padStart(2, '0')}`);
  for (let m = 1; m <= 4; m++) months.push(`2026-${String(m).padStart(2, '0')}`);
  return months.map((m) => rollup(m, expensesPerMonth));
}

// monthYoY populates BOTH thisMonth (drives the current-month column for the
// three flow rows + Cash Reserve as-of-latest-update beat) AND lastMonth
// (drives Cash Reserve's long-term funded-ratio anchors). Tests that don't
// care about the LT/MTD anchor distinction get the same fixture for both,
// which mirrors how the live model populates these two timeframes off the
// same month-to-date pair when no in-progress month exists yet.
function modelWith(
  monthYoY: KpiTimeframeComparison,
  ttm: KpiTimeframeComparison,
  monthlyRollups: MonthlyRollup[],
): DashboardModel {
  return {
    kpiYoYComparisonByTimeframe: { thisMonth: monthYoY, lastMonth: monthYoY, ttm },
    monthlyRollups,
  } as unknown as DashboardModel;
}

// A dense-ish daily series with explicit month-end balances for the two
// sample months. balanceAt maps 'YYYY-MM' -> month-end balance.
function seriesWith(balanceAt: Record<string, number>): BalancePoint[] {
  return Object.entries(balanceAt)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, balance]) => ({ dateISO: `${month}-28`, balance }));
}

const rowsFor = (monthYoY: KpiTimeframeComparison, ttm: KpiTimeframeComparison) =>
  buildSustainabilityRows(modelWith(monthYoY, ttm, []), []);

// ── sustainabilityState: flat bands per metric kind ───────────────────────────

describe('sustainabilityState', () => {
  it('returns none for a missing pair', () => {
    expect(sustainabilityState(undefined, 'up', { kind: 'pct', band: 3 })).toBe('none');
    expect(sustainabilityState(null, 'up', { kind: 'usd', floor: 2_000 })).toBe('none');
  });

  it('pct: ±3% reads flat; beyond reads directional (polarity-normalized)', () => {
    const band = { kind: 'pct', band: 3 } as const;
    expect(sustainabilityState({ current: 489_807, previous: 489_630 }, 'up', band)).toBe('flat'); // +0.04%
    expect(sustainabilityState({ current: 103, previous: 100 }, 'up', band)).toBe('flat'); // +3% edge
    expect(sustainabilityState({ current: 110, previous: 100 }, 'up', band)).toBe('up'); // +10%
    expect(sustainabilityState({ current: 85, previous: 100 }, 'up', band)).toBe('down'); // -15%
    // inverted (costs): a fall is good
    expect(sustainabilityState({ current: 90, previous: 100 }, 'down', band)).toBe('up');
    expect(sustainabilityState({ current: 110, previous: 100 }, 'down', band)).toBe('down');
  });

  it('pct: a zero prior is unavailable (cannot divide)', () => {
    expect(sustainabilityState({ current: 500, previous: 0 }, 'up', { kind: 'pct', band: 3 })).toBe('none');
  });

  it('usd: absolute floor; a zero or negative prior is a VALID comparison', () => {
    const floor = { kind: 'usd', floor: 2_000 } as const;
    expect(sustainabilityState({ current: -3_802, previous: -6_519 }, 'up', floor)).toBe('up'); // +2,717 > 2,000
    expect(sustainabilityState({ current: 1_500, previous: 0 }, 'up', floor)).toBe('flat'); // |1,500| ≤ 2,000, prior 0 valid
    expect(sustainabilityState({ current: 9_000, previous: 0 }, 'up', floor)).toBe('up'); // prior 0 valid, big move
    expect(sustainabilityState({ current: -5_000, previous: 1_000 }, 'up', floor)).toBe('down');
  });

  it('ratio: small absolute band on the 0–5 funded ratio', () => {
    const band = { kind: 'ratio', band: 0.1 } as const;
    expect(sustainabilityState({ current: 2.55, previous: 2.5 }, 'up', band)).toBe('flat'); // +0.05
    expect(sustainabilityState({ current: 3.0, previous: 2.5 }, 'up', band)).toBe('up'); // +0.5
    expect(sustainabilityState({ current: 2.0, previous: 2.5 }, 'up', band)).toBe('down'); // -0.5
  });
});

// ── monthEndBalance ───────────────────────────────────────────────────────────

describe('monthEndBalance', () => {
  const series = seriesWith({ '2025-04': 30_000, '2026-04': 50_000 });
  it('returns the in-month balance, or null when the month is absent', () => {
    expect(monthEndBalance(series, '2026-04')).toBe(50_000);
    expect(monthEndBalance(series, '2025-04')).toBe(30_000);
    expect(monthEndBalance(series, '2024-04')).toBeNull();
    expect(monthEndBalance(series, null)).toBeNull();
  });
});

// ── Headline: the live full-April Revenue case (the bug this card fixes) ───────
// Live anchors (Wesley-confirmed, full April): TTM 489,807 vs 489,630 (+0.04%);
// April 39,329 vs 46,233 (-15%). Under EPSILON the long-term glyph read a
// confident "up" next to "down 15%"; under the ±3% band it must read FLAT.

describe('Revenue — live full-April anchor', () => {
  it('flat long-term glyph + "Revenue steady over the last 12 months. Revenue down 15% month to date."', () => {
    const lastMonth = comparison('2026-04', '2025-04', { revenue: metric(39_329, 46_233) });
    const ttm = comparison('2026-04', '2025-04', { revenue: metric(489_807, 489_630) });
    const revenue = rowsFor(lastMonth, ttm).find((r) => r.label === 'Revenue Momentum')!;
    expect(revenue.longTerm).toBe('flat'); // NOT 'up' — the intended correction
    expect(revenue.thisMonth).toBe('down');
    expect(revenue.evidence).toBe('Revenue steady over the last 12 months. Revenue down 15% month to date.');
  });
});

// ── Polarity (verification #3) ────────────────────────────────────────────────

describe('polarity', () => {
  it('revenue ↑10% YoY → up; expenses ↑10% YoY → down (inverted)', () => {
    const lastMonth = comparison('2026-04', '2025-04', {
      revenue: metric(110, 100),
      expenses: metric(110, 100),
      netCashFlow: metric(5_000, 1_000), // +$4K > $2K floor → up
    });
    const ttm = comparison('2026-04', '2025-04', {
      revenue: metric(1200, 1000),
      expenses: metric(1200, 1000),
      netCashFlow: metric(30_000, 10_000),
    });
    const rows = rowsFor(lastMonth, ttm);
    const revenue = rows.find((r) => r.label === 'Revenue Momentum')!;
    const cost = rows.find((r) => r.label === 'Cost Discipline')!;
    const cash = rows.find((r) => r.label === 'Monthly Cash Result')!;

    expect(revenue.thisMonth).toBe('up');
    expect(revenue.longTerm).toBe('up');
    expect(cost.thisMonth).toBe('down'); // costs up = bad
    expect(cost.longTerm).toBe('down');
    expect(cash.thisMonth).toBe('up');
    expect(cash.longTerm).toBe('up');
  });

  it('falling costs read as good (up)', () => {
    const lastMonth = comparison('2026-04', '2025-04', { expenses: metric(90, 100) });
    const ttm = comparison('2026-04', '2025-04', { expenses: metric(900, 1000) });
    const cost = rowsFor(lastMonth, ttm).find((r) => r.label === 'Cost Discipline')!;
    expect(cost.thisMonth).toBe('up');
    expect(cost.longTerm).toBe('up');
  });
});

// ── Two-beat evidence copy ────────────────────────────────────────────────────

describe('two-beat evidence', () => {
  it('Revenue: growing year + up month', () => {
    const lastMonth = comparison('2026-04', '2025-04', { revenue: metric(120, 100) });
    const ttm = comparison('2026-04', '2025-04', { revenue: metric(1200, 1000) });
    const revenue = rowsFor(lastMonth, ttm).find((r) => r.label === 'Revenue Momentum')!;
    expect(revenue.evidence).toBe('Revenue up over the last 12 months. Revenue up 20% month to date.');
  });

  it('Cost: inverted phrasing on both beats', () => {
    // expenses fell 10% MoY and 8% TTM → both "improved"
    const lastMonth = comparison('2026-04', '2025-04', { expenses: metric(90, 100) });
    const ttm = comparison('2026-04', '2025-04', { expenses: metric(920, 1000) });
    const cost = rowsFor(lastMonth, ttm).find((r) => r.label === 'Cost Discipline')!;
    expect(cost.evidence).toBe('Costs down over the last 12 months. Spending down 10% month to date.');
  });

  it('Cost: rising costs read as worse', () => {
    const lastMonth = comparison('2026-04', '2025-04', { expenses: metric(115, 100) });
    const ttm = comparison('2026-04', '2025-04', { expenses: metric(1100, 1000) });
    const cost = rowsFor(lastMonth, ttm).find((r) => r.label === 'Cost Discipline')!;
    expect(cost.evidence).toBe('Costs up over the last 12 months. Spending up 15% month to date.');
  });

  it('Revenue/Cost: ±3% reads "about even / steady"', () => {
    const lastMonth = comparison('2026-04', '2025-04', { revenue: metric(101, 100), expenses: metric(101, 100) });
    const ttm = comparison('2026-04', '2025-04', { revenue: metric(1010, 1000), expenses: metric(1010, 1000) });
    const rows = rowsFor(lastMonth, ttm);
    expect(rows.find((r) => r.label === 'Revenue Momentum')!.evidence).toBe(
      'Revenue steady over the last 12 months. Revenue about even month to date.',
    );
    expect(rows.find((r) => r.label === 'Cost Discipline')!.evidence).toBe(
      'Costs steady over the last 12 months. Spending about even month to date.',
    );
  });
});

// ── Monthly Cash Result (signed dollars, never %, dollar-safe flat) ────────────

describe('Monthly Cash Result', () => {
  it('shows signed dollar magnitudes, never an exploding percentage', () => {
    const lastMonth = comparison('2026-04', '2025-04', { netCashFlow: metric(3_344, 50) });
    const ttm = comparison('2026-04', '2025-04', { netCashFlow: metric(40_000, 10_000) });
    const cash = rowsFor(lastMonth, ttm).find((r) => r.label === 'Monthly Cash Result')!;
    expect(cash.thisMonth).toBe('up');
    expect(cash.evidence).toBe('Cash result better over the last 12 months. Monthly result improved $3.3K month to date.');
    expect(cash.evidence).not.toMatch(/%/);
  });

  it('negative current flow renders signed', () => {
    const lastMonth = comparison('2026-04', '2025-04', { netCashFlow: metric(-3_394, 1_200) });
    const ttm = comparison('2026-04', '2025-04', { netCashFlow: metric(0, 0) });
    const cash = rowsFor(lastMonth, ttm).find((r) => r.label === 'Monthly Cash Result')!;
    expect(cash.thisMonth).toBe('down');
    // Inline now shows the absolute DELTA (a +1,200 → −3,394 swing is −$4,594);
    // the raw levels move to the tooltip. Magnitude is always shown unsigned.
    expect(cash.evidence).toBe('Cash result steady over the last 12 months. Monthly result down $4.6K month to date.');
    expect(cash.evidence).not.toMatch(/-\$/);
  });

  it('dollar-safe flat: a within-floor YoY move reads steady, not directional', () => {
    // +$900 month-over-year is below the $2,000 floor → about the same.
    const lastMonth = comparison('2026-04', '2025-04', { netCashFlow: metric(1_900, 1_000) });
    const ttm = comparison('2026-04', '2025-04', { netCashFlow: metric(40_000, 38_000) }); // +$2K ≤ $6K annual floor
    const cash = rowsFor(lastMonth, ttm).find((r) => r.label === 'Monthly Cash Result')!;
    expect(cash.thisMonth).toBe('flat');
    expect(cash.evidence).toBe('Cash result steady over the last 12 months. Monthly result about the same month to date.');
  });

  it('near-zero prior does not explode (the 82c412f hazard, now in state too)', () => {
    const lastMonth = comparison('2026-04', '2025-04', { netCashFlow: metric(5_000, 1) });
    const ttm = comparison('2026-04', '2025-04', { netCashFlow: metric(40_000, 10_000) });
    const cash = rowsFor(lastMonth, ttm).find((r) => r.label === 'Monthly Cash Result')!;
    expect(cash.thisMonth).toBe('up'); // +$4,999 > $2,000, no Infinity/NaN
    expect(cash.evidence).not.toMatch(/Infinity|NaN|%/);
  });

  it('missing PRIOR history is unavailable, NOT a comparison against a fabricated $0', () => {
    // computeKpiYoYComparisons fabricates previous:0 when the prior window has no
    // months, but flags it with previousMonthCount:0. The dollar rule treats a real
    // $0 prior as valid, so without the window-presence guard this would render a
    // phantom "Monthly result improved $5.0K month to date." instead of empty.
    const lastMonth = comparison('2026-04', '2025-04', {
      netCashFlow: metric(5_000, 0),
      previousMonthCount: 0,
    });
    const ttm = comparison('2026-04', '2025-04', {
      netCashFlow: metric(48_000, 0),
      previousMonthCount: 0,
    });
    const cash = rowsFor(lastMonth, ttm).find((r) => r.label === 'Monthly Cash Result')!;
    expect(cash.longTerm).toBe('none');
    expect(cash.thisMonth).toBe('none');
    expect(cash.thisMonthTone).toBe('none');
    expect(cash.evidence).toBe('Not enough history yet.');
    expect(cash.evidence).not.toMatch(/\$0/);
  });

  it('missing CURRENT history is unavailable, NOT a fabricated $0 current (the symmetric P1)', () => {
    // resolveAnchorMonth pins the current window to the literal calendar month, so a
    // lagging-data workspace lands currentMonthCount:0 with a real prior. Without the
    // current-side guard this renders a phantom "Monthly result down $11.0K month to date.".
    const lastMonth = comparison('2026-04', '2025-04', {
      netCashFlow: metric(0, 11_000),
      currentMonthCount: 0,
    });
    const ttm = comparison('2026-04', '2025-04', {
      netCashFlow: metric(0, 44_000),
      currentMonthCount: 0,
    });
    const cash = rowsFor(lastMonth, ttm).find((r) => r.label === 'Monthly Cash Result')!;
    expect(cash.longTerm).toBe('none');
    expect(cash.thisMonth).toBe('none');
    expect(cash.thisMonthTone).toBe('none');
    expect(cash.evidence).toBe('Not enough history yet.');
    expect(cash.evidence).not.toMatch(/\$0/);
  });

  it('a REAL $0 prior (history present) stays a valid breakeven comparison', () => {
    // Same fabricated-looking previous:0, but previousMonthCount>0 means the prior
    // month genuinely netted $0 — that is a real breakeven and must compare, not drop.
    const lastMonth = comparison('2026-04', '2025-04', {
      netCashFlow: metric(5_000, 0),
      previousMonthCount: 1,
    });
    const ttm = comparison('2026-04', '2025-04', { netCashFlow: metric(40_000, 10_000) });
    const cash = rowsFor(lastMonth, ttm).find((r) => r.label === 'Monthly Cash Result')!;
    expect(cash.thisMonth).toBe('up'); // +$5,000 > $2,000 floor
    expect(cash.evidence).toBe('Cash result better over the last 12 months. Monthly result improved $5.0K month to date.');
  });
});

// ── Percentage rows: window-presence guard (the symmetric P1, % side) ──────────
// An empty current window fabricates current:0 against a real prior, which the
// percentage path would otherwise render as "down 100%" — a no-data month looking
// like a total collapse. Gate on window presence, same as the cash row.

describe('percentage rows — window-presence guard', () => {
  it('Revenue/Cost render unavailable (not "down 100%") when the current window is empty', () => {
    const lastMonth = comparison('2026-04', '2025-04', {
      revenue: metric(0, 46_000),
      expenses: metric(0, 52_000),
      currentMonthCount: 0,
    });
    const ttm = comparison('2026-04', '2025-04', {
      revenue: metric(0, 489_000),
      expenses: metric(0, 460_000),
      currentMonthCount: 0,
    });
    const rows = rowsFor(lastMonth, ttm);
    for (const label of ['Revenue Momentum', 'Cost Discipline']) {
      const row = rows.find((r) => r.label === label)!;
      expect(row.longTerm).toBe('none');
      expect(row.thisMonth).toBe('none');
      expect(row.evidence).toBe('Not enough history yet.');
      expect(row.evidence).not.toMatch(/100%|%/);
    }
  });

  it('Revenue/Cost render unavailable when the prior window is empty', () => {
    const lastMonth = comparison('2026-04', '2025-04', {
      revenue: metric(46_000, 0),
      expenses: metric(52_000, 0),
      previousMonthCount: 0,
    });
    const ttm = comparison('2026-04', '2025-04', {
      revenue: metric(489_000, 0),
      expenses: metric(460_000, 0),
      previousMonthCount: 0,
    });
    const rows = rowsFor(lastMonth, ttm);
    for (const label of ['Revenue Momentum', 'Cost Discipline']) {
      const row = rows.find((r) => r.label === label)!;
      expect(row.longTerm).toBe('none');
      expect(row.thisMonth).toBe('none');
      expect(row.evidence).toBe('Not enough history yet.');
    }
  });
});

// ── Monthly Cash Result: Smaller Loss pill ─────────────────────────────────────
// A month that improved YoY but is STILL negative is surfaced as a GREEN
// "Smaller Loss" pill: the label carries the truth, so the color honors the
// genuine improvement. This reverses the prior gray-pill guard — the gate is
// the CURRENT value (< 0), not the diff. thisMonth = trend; thisMonthTone = color.

describe('Monthly Cash Result — Smaller Loss', () => {
  it('improving-but-still-negative: green "Smaller Loss" pill + smaller-loss copy', () => {
    // The live April case: -$3,394 this year, up from -$6,519 last year.
    const lastMonth = comparison('2026-04', '2025-04', { netCashFlow: metric(-3_394, -6_519) });
    const ttm = comparison('2026-04', '2025-04', { netCashFlow: metric(16_397, 28_968) });
    const cash = rowsFor(lastMonth, ttm).find((r) => r.label === 'Monthly Cash Result')!;
    expect(cash.thisMonth).toBe('up'); // +$3,125 > $2,000 floor → improving trend
    expect(cash.thisMonthTone).toBe('up'); // GREEN now — label carries the "still losing money" truth
    expect(cash.thisMonthLabel).toBe('Smaller Loss'); // per-row pill override
    expect(cash.evidence).toBe('Cash result weaker over the last 12 months. Smaller loss: $3.1K better month to date.');
  });

  it('gate is the CURRENT value, not the diff: improving AND positive is normal "Improving"', () => {
    const lastMonth = comparison('2026-04', '2025-04', { netCashFlow: metric(5_000, 1_000) });
    const ttm = comparison('2026-04', '2025-04', { netCashFlow: metric(0, 0) });
    const cash = rowsFor(lastMonth, ttm).find((r) => r.label === 'Monthly Cash Result')!;
    expect(cash.thisMonth).toBe('up');
    expect(cash.thisMonthTone).toBe('up'); // green
    expect(cash.thisMonthLabel).toBeUndefined(); // NOT Smaller Loss — current ≥ 0
  });

  it('worsening (still negative): down/red, NOT Smaller Loss (requires verdict up)', () => {
    const lastMonth = comparison('2026-04', '2025-04', { netCashFlow: metric(-3_394, 1_200) });
    const ttm = comparison('2026-04', '2025-04', { netCashFlow: metric(0, 0) });
    const cash = rowsFor(lastMonth, ttm).find((r) => r.label === 'Monthly Cash Result')!;
    expect(cash.thisMonth).toBe('down');
    expect(cash.thisMonthTone).toBe('down');
    expect(cash.thisMonthLabel).toBeUndefined();
  });

  it('other rows: tone always equals verdict, no label override', () => {
    const lastMonth = comparison('2026-04', '2025-04', {
      revenue: metric(110, 100),
      expenses: metric(110, 100),
    });
    const ttm = comparison('2026-04', '2025-04', { revenue: metric(1100, 1000), expenses: metric(1100, 1000) });
    const rows = rowsFor(lastMonth, ttm);
    for (const label of ['Revenue Momentum', 'Cost Discipline', 'Cash Reserve']) {
      const row = rows.find((r) => r.label === label)!;
      expect(row.thisMonthTone).toBe(row.thisMonth);
      expect(row.thisMonthLabel).toBeUndefined(); // shared mapping only
    }
  });
});

// ── Shared pill-label mapping + per-row override fallback ──────────────────────

describe('thisMonthLabel mapping', () => {
  it('maps each verdict to the shared owner-friendly pill label', () => {
    expect(thisMonthLabel('up')).toBe('Improving');
    expect(thisMonthLabel('down')).toBe('Getting Worse');
    expect(thisMonthLabel('flat')).toBe('About the Same');
    expect(thisMonthLabel('none')).toBe('—');
  });

  it('rows without a thisMonthLabel override fall back to the shared mapping', () => {
    // Renderer does `row.thisMonthLabel ?? thisMonthLabel(row.thisMonth)`.
    const lastMonth = comparison('2026-04', '2025-04', { revenue: metric(110, 100) });
    const ttm = comparison('2026-04', '2025-04', { revenue: metric(1100, 1000) });
    const revenue = rowsFor(lastMonth, ttm).find((r) => r.label === 'Revenue Momentum')!;
    expect(revenue.thisMonthLabel).toBeUndefined();
    expect(revenue.thisMonthLabel ?? thisMonthLabel(revenue.thisMonth)).toBe('Improving');
  });
});

// ── Cash Reserve: two-beat, position basis (funded ratio LT + balance month) ───

describe('Cash Reserve', () => {
  it('funded ratio ↑ YoY → long-term up; balance ↑ YoY → this-month up; two-beat copy', () => {
    const lm = comparison('2026-04', '2025-04', {});
    const series = seriesWith({ '2025-04': 20_000, '2026-04': 60_000 });
    const rows = buildSustainabilityRows(modelWith(lm, comparison('2026-04', '2025-04', {}), rollupHistory()), series);
    const reserve = rows.find((r) => r.label === 'Cash Reserve')!;
    // equal target both years; balance 60k vs 20k → funded ratio clearly up (> 0.1 band)
    expect(reserve.thisMonth).toBe('up');
    expect(reserve.longTerm).toBe('up');
    expect(reserve.sublabel).toBeUndefined(); // inline sublabel removed; basis moved to tooltip
    expect(reserve.evidence).toBe(
      'Cash reserve stronger over the last 12 months. Reserve is $40.0K higher vs same point last year.',
    );
  });

  it('tracks total bank cash (balance), not operating netCashFlow — owner-draw divergence', () => {
    const lm = comparison('2026-04', '2025-04', {
      netCashFlow: metric(40_000, 10_000), // operating flow up → cash result good
    });
    const series = seriesWith({ '2025-04': 60_000, '2026-04': 20_000 }); // balance DOWN (big draw)
    const rows = buildSustainabilityRows(modelWith(lm, comparison('2026-04', '2025-04', {}), rollupHistory()), series);
    const reserve = rows.find((r) => r.label === 'Cash Reserve')!;
    const cash = rows.find((r) => r.label === 'Monthly Cash Result')!;
    expect(cash.thisMonth).toBe('up'); // flow ignores the draw
    expect(reserve.thisMonth).toBe('down'); // balance reflects the draw
    expect(reserve.evidence).toContain('Reserve is $40.0K lower vs same point last year.');
  });

  it('renders an honest empty state when the prior-year sample is missing', () => {
    const lm = comparison('2026-04', '2025-04', {});
    const series = seriesWith({ '2026-04': 50_000 }); // prior-year point absent
    const rows = buildSustainabilityRows(modelWith(lm, comparison('2026-04', '2025-04', {}), rollupHistory()), series);
    const reserve = rows.find((r) => r.label === 'Cash Reserve')!;
    expect(reserve.thisMonth).toBe('none');
    expect(reserve.longTerm).toBe('none');
    expect(reserve.evidence).toBe('Not enough history yet.'); // both beats none → collapsed
  });

  it('drops only the long-term reserve beat when the prior-year target window is missing', () => {
    const series = seriesWith({ '2025-04': 30_000, '2026-04': 50_000 });
    // Only 2026-xx rollups exist → no 3-month window before 2025-04 → prior target null.
    const sparseRollups = [rollup('2026-01', 10_000), rollup('2026-02', 10_000), rollup('2026-03', 10_000)];
    const lm = comparison('2026-04', '2025-04', {});
    const rows = buildSustainabilityRows(modelWith(lm, comparison('2026-04', '2025-04', {}), sparseRollups), series);
    const reserve = rows.find((r) => r.label === 'Cash Reserve')!;
    expect(reserve.longTerm).toBe('none'); // prior funded ratio uncomputable
    expect(reserve.thisMonth).toBe('up'); // balance comparison still valid
    // LT beat unavailable, month beat present — NOT collapsed.
    expect(reserve.evidence).toBe('Not enough history yet. Reserve is $20.0K higher vs same point last year.');
  });
});

// ── Per-row tooltips (data layer) ──────────────────────────────────────────────
// Built in buildSustainabilityRows so proof values reuse the SAME MetricPair as
// the inline evidence. Line 1 is the comparison-basis explanation; an optional
// proof line is appended only when the pair is available.

describe('per-row tooltips', () => {
  it('every row carries a comparison-basis explanation line', () => {
    const lastMonth = comparison('2026-04', '2025-04', { revenue: metric(110, 100), expenses: metric(90, 100) });
    const ttm = comparison('2026-04', '2025-04', { revenue: metric(1100, 1000), expenses: metric(900, 1000) });
    const rows = rowsFor(lastMonth, ttm);
    expect(rows.find((r) => r.label === 'Revenue Momentum')!.tooltip?.[0]).toBe(
      'Compares revenue over two periods: the last 12 months vs the prior 12 months, and month to date vs the same period one year ago.',
    );
    expect(rows.find((r) => r.label === 'Cost Discipline')!.tooltip?.[0]).toBe(
      'Compares spending over two periods: the last 12 months vs the prior 12 months, and month to date vs the same period one year ago. Lower spending is better.',
    );
  });

  it('Monthly Cash Result appends a proof line with the raw month-to-date levels', () => {
    const lastMonth = comparison('2026-04', '2025-04', { netCashFlow: metric(-3_394, -6_519) });
    const ttm = comparison('2026-04', '2025-04', { netCashFlow: metric(16_397, 28_968) });
    const cash = rowsFor(lastMonth, ttm).find((r) => r.label === 'Monthly Cash Result')!;
    expect(cash.tooltip).toEqual([
      'Compares net cash result over two periods: the last 12 months vs the prior 12 months, and month to date vs the same period one year ago.',
      'Month to date: -$3.4K. Last year: -$6.5K.',
    ]);
  });

  it('Cash Reserve appends a proof line with the raw reserve levels', () => {
    const lm = comparison('2026-04', '2025-04', {});
    const series = seriesWith({ '2025-04': 20_000, '2026-04': 60_000 });
    const rows = buildSustainabilityRows(modelWith(lm, comparison('2026-04', '2025-04', {}), rollupHistory()), series);
    const reserve = rows.find((r) => r.label === 'Cash Reserve')!;
    expect(reserve.tooltip).toEqual([
      'Long-term compares reserve strength over the last 12 months, using the latest closed month. Current reserve compares cash after the latest transaction update to the same point one year ago.',
      'Current reserve: $60.0K. Last year: $20.0K.',
    ]);
  });

  it('omits the proof line (no fabricated values) when the month pair is unavailable', () => {
    const lastMonth = comparison('2026-04', '2025-04', { netCashFlow: metric(0, 11_000), currentMonthCount: 0 });
    const ttm = comparison('2026-04', '2025-04', { netCashFlow: metric(0, 44_000), currentMonthCount: 0 });
    const cash = rowsFor(lastMonth, ttm).find((r) => r.label === 'Monthly Cash Result')!;
    expect(cash.tooltip).toHaveLength(1); // basis line only — no "$0" proof
    expect(cash.tooltip?.[0]).not.toMatch(/\$/);
  });
});
