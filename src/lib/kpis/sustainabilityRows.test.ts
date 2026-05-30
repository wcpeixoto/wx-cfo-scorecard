import { describe, it, expect } from 'vitest';
import type { BalancePoint } from '../data/balanceSeries';
import type {
  DashboardModel,
  KpiMetricComparison,
  KpiTimeframeComparison,
  MonthlyRollup,
} from '../data/contract';
import { buildSustainabilityRows, trendOf, monthEndBalance } from './sustainabilityRows';

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
  metrics: Partial<Pick<KpiTimeframeComparison, 'revenue' | 'expenses' | 'netCashFlow' | 'savingsRate'>>,
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

function modelWith(
  lastMonth: KpiTimeframeComparison,
  ttm: KpiTimeframeComparison,
  monthlyRollups: MonthlyRollup[],
): DashboardModel {
  return {
    kpiYoYComparisonByTimeframe: { lastMonth, ttm },
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

const flat = (m: string | null) => comparison(m, m, {});

// ── trendOf ─────────────────────────────────────────────────────────────────

describe('trendOf', () => {
  it('returns none for missing metric, flat within EPSILON, up/down otherwise', () => {
    expect(trendOf(undefined)).toBe('none');
    expect(trendOf({ current: 100, previous: 100 })).toBe('flat');
    expect(trendOf({ current: 110, previous: 100 })).toBe('up');
    expect(trendOf({ current: 90, previous: 100 })).toBe('down');
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

// ── Polarity (verification #3) ────────────────────────────────────────────────

describe('polarity', () => {
  it('revenue ↑10% YoY → thumbs up; expenses ↑10% YoY → thumbs down', () => {
    const lastMonth = comparison('2026-04', '2025-04', {
      revenue: metric(110, 100), // +10% → good
      expenses: metric(110, 100), // +10% → BAD (inverted)
      netCashFlow: metric(50, 10), // up → good
    });
    const ttm = comparison('2026-04', '2025-04', {
      revenue: metric(1200, 1000),
      expenses: metric(1200, 1000),
      netCashFlow: metric(300, 100),
    });
    const rows = buildSustainabilityRows(modelWith(lastMonth, ttm, []), []);

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

  it('falling costs read as good (thumbs up)', () => {
    const lastMonth = comparison('2026-04', '2025-04', { expenses: metric(90, 100) });
    const ttm = comparison('2026-04', '2025-04', { expenses: metric(900, 1000) });
    const rows = buildSustainabilityRows(modelWith(lastMonth, ttm, []), []);
    const cost = rows.find((r) => r.label === 'Cost Discipline')!;
    expect(cost.thisMonth).toBe('up');
    expect(cost.longTerm).toBe('up');
  });
});

// ── Cash Reserve YoY + basis (verification #3, #4) ────────────────────────────

describe('Cash Reserve', () => {
  it('funded ratio ↑ YoY → thumbs up; balance ↑ YoY → this-month up', () => {
    const lastMonth = flat('2026-04'); // currentEndMonth 2026-04, previousEndMonth 2026-04? no — use real prior
    const lm = comparison('2026-04', '2025-04', {});
    const series = seriesWith({ '2025-04': 30_000, '2026-04': 50_000 });
    const rows = buildSustainabilityRows(
      modelWith(lm, comparison('2026-04', '2025-04', {}), rollupHistory()),
      series,
    );
    const reserve = rows.find((r) => r.label === 'Cash Reserve')!;
    // target equal both years (10k), balance 50k vs 30k → funded 5.0 vs 3.0 → up
    expect(reserve.thisMonth).toBe('up');
    expect(reserve.longTerm).toBe('up');
    expect(reserve.sublabel).toMatch(/same month last year/i);
    void lastMonth;
  });

  it('tracks total bank cash (balance), not operating netCashFlow — owner-draw divergence', () => {
    // Operating cash flow is strongly POSITIVE YoY (draws are excluded from it),
    // but a big owner draw pulled the month-end BALANCE down YoY. The reserve
    // row must follow the balance (down); Monthly Cash Result follows the flow (up).
    const lm = comparison('2026-04', '2025-04', {
      netCashFlow: metric(40_000, 10_000), // operating flow up → cash result good
    });
    const series = seriesWith({ '2025-04': 60_000, '2026-04': 20_000 }); // balance DOWN (big draw)
    const rows = buildSustainabilityRows(modelWith(lm, comparison('2026-04', '2025-04', {}), rollupHistory()), series);

    const reserve = rows.find((r) => r.label === 'Cash Reserve')!;
    const cash = rows.find((r) => r.label === 'Monthly Cash Result')!;
    expect(cash.thisMonth).toBe('up'); // flow ignores the draw
    expect(reserve.thisMonth).toBe('down'); // balance reflects the draw
  });

  // ── Sample validity (verification #5) ──────────────────────────────────────
  it('renders an honest empty state when the prior-year sample is missing', () => {
    const lm = comparison('2026-04', '2025-04', {});
    const series = seriesWith({ '2026-04': 50_000 }); // prior-year point absent
    const rows = buildSustainabilityRows(modelWith(lm, comparison('2026-04', '2025-04', {}), rollupHistory()), series);
    const reserve = rows.find((r) => r.label === 'Cash Reserve')!;
    expect(reserve.thisMonth).toBe('none');
    expect(reserve.longTerm).toBe('none');
    expect(reserve.evidence).toMatch(/not enough history/i);
  });

  it('drops the long-term reserve verdict when the prior-year target window is missing', () => {
    const lm = comparison('2026-04', '2025-04', {});
    const series = seriesWith({ '2025-04': 30_000, '2026-04': 50_000 });
    // Only 2026-xx rollups exist → no 3-month window before 2025-04 → prior target null.
    const sparseRollups = [rollup('2026-01', 10_000), rollup('2026-02', 10_000), rollup('2026-03', 10_000)];
    const rows = buildSustainabilityRows(modelWith(lm, comparison('2026-04', '2025-04', {}), sparseRollups), series);
    const reserve = rows.find((r) => r.label === 'Cash Reserve')!;
    expect(reserve.longTerm).toBe('none'); // prior funded ratio uncomputable
    expect(reserve.thisMonth).toBe('up'); // balance comparison still valid
  });
});

// ── Monthly Cash Result evidence (verification: no exploding %) ────────────────

describe('Monthly Cash Result evidence', () => {
  it('shows signed dollar magnitudes, not an exploding percentage off a near-zero prior', () => {
    // netCashFlow crosses zero, so a tiny prior month would yield "+6588% YoY".
    const lastMonth = comparison('2026-04', '2025-04', { netCashFlow: metric(3_344, 50) });
    const ttm = comparison('2026-04', '2025-04', { netCashFlow: metric(40_000, 10_000) });
    const rows = buildSustainabilityRows(modelWith(lastMonth, ttm, []), []);
    const cash = rows.find((r) => r.label === 'Monthly Cash Result')!;
    expect(cash.thisMonth).toBe('up');
    expect(cash.evidence).toBe('$3.3K vs $50 a year ago');
    expect(cash.evidence).not.toMatch(/%/);
  });

  it('handles a negative current flow', () => {
    const lastMonth = comparison('2026-04', '2025-04', { netCashFlow: metric(-3_394, 1_200) });
    const ttm = comparison('2026-04', '2025-04', { netCashFlow: metric(0, 0) });
    const rows = buildSustainabilityRows(modelWith(lastMonth, ttm, []), []);
    const cash = rows.find((r) => r.label === 'Monthly Cash Result')!;
    expect(cash.evidence).toBe('-$3.4K vs $1.2K a year ago');
    expect(cash.thisMonth).toBe('down');
  });
});

// ── Monthly Cash Result color guard ───────────────────────────────────────────
// Label tracks the YoY trend; color must never say "fine" (green) on a month
// that still lost money. thisMonth = the trend; thisMonthTone = the color.

describe('Monthly Cash Result color guard', () => {
  it('improving-but-still-negative: label "Getting Better", color neutral (not green)', () => {
    // The live April case: -$3,802 this year, up from -$6,519 last year.
    const lastMonth = comparison('2026-04', '2025-04', { netCashFlow: metric(-3_802, -6_519) });
    const ttm = comparison('2026-04', '2025-04', { netCashFlow: metric(0, 12_979) });
    const rows = buildSustainabilityRows(modelWith(lastMonth, ttm, []), []);
    const cash = rows.find((r) => r.label === 'Monthly Cash Result')!;
    expect(cash.thisMonth).toBe('up'); // trend label: Getting Better
    expect(cash.thisMonthTone).toBe('flat'); // color: neutral, NOT green
  });

  it('improving and positive: both label and color are up (green)', () => {
    const lastMonth = comparison('2026-04', '2025-04', { netCashFlow: metric(5_000, 1_000) });
    const ttm = comparison('2026-04', '2025-04', { netCashFlow: metric(0, 0) });
    const rows = buildSustainabilityRows(modelWith(lastMonth, ttm, []), []);
    const cash = rows.find((r) => r.label === 'Monthly Cash Result')!;
    expect(cash.thisMonth).toBe('up');
    expect(cash.thisMonthTone).toBe('up'); // genuinely fine → green is allowed
  });

  it('worsening: label and color both down (guard does not touch the down case)', () => {
    const lastMonth = comparison('2026-04', '2025-04', { netCashFlow: metric(-3_394, 1_200) });
    const ttm = comparison('2026-04', '2025-04', { netCashFlow: metric(0, 0) });
    const rows = buildSustainabilityRows(modelWith(lastMonth, ttm, []), []);
    const cash = rows.find((r) => r.label === 'Monthly Cash Result')!;
    expect(cash.thisMonth).toBe('down');
    expect(cash.thisMonthTone).toBe('down');
  });

  it('other rows: tone always equals verdict (guard is Cash-Result-only)', () => {
    const lastMonth = comparison('2026-04', '2025-04', {
      revenue: metric(110, 100),
      expenses: metric(110, 100),
    });
    const ttm = comparison('2026-04', '2025-04', { revenue: metric(1, 1), expenses: metric(1, 1) });
    const rows = buildSustainabilityRows(modelWith(lastMonth, ttm, []), []);
    for (const label of ['Revenue Momentum', 'Cost Discipline']) {
      const row = rows.find((r) => r.label === label)!;
      expect(row.thisMonthTone).toBe(row.thisMonth);
    }
  });
});
