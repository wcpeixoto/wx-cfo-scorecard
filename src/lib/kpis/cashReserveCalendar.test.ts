import { describe, it, expect } from 'vitest';
import type { MonthlyRollup } from '../data/contract';
import { computeCashReserveCalendar } from './cashReserveCalendar';

// ── Test scaffold ───────────────────────────────────────────────────────────
//
// `referenceDate` is pinned to 2026-06-15 (= "today"), so the current
// incomplete month is June 2026 and the latest completed month is May
// 2026. The trailing-24-month window therefore covers Jun 2024 … May 2026.

const REF_DATE = new Date(2026, 5, 15); // 2026-06-15 (month index 5 = June)

function monthToken(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function rollup(year: number, month: number, netCashFlow: number): MonthlyRollup {
  // revenue/expenses are not consumed by the selector — set placeholder
  // values that satisfy `MonthlyRollup` and pin `netCashFlow` directly.
  return {
    month: monthToken(year, month),
    revenue: 0,
    expenses: 0,
    netCashFlow,
    savingsRate: 0,
    transactionCount: 1,
  };
}

/**
 * Build `count` consecutive completed monthly rollups ending in
 * `(endYear, endMonth)` inclusive. `netCashByCalMonth` maps calendar-month
 * number (1..12) to the netCashFlow value used for each instance of that
 * month in the series.
 */
function buildSeries(
  endYear: number,
  endMonth: number,
  count: number,
  netCashByCalMonth: Record<number, number>,
): MonthlyRollup[] {
  const rollups: MonthlyRollup[] = [];
  let year = endYear;
  let month = endMonth;
  for (let i = 0; i < count; i++) {
    rollups.unshift(rollup(year, month, netCashByCalMonth[month] ?? 0));
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return rollups;
}

describe('computeCashReserveCalendar — low-data state', () => {
  it('returns low-data state when fewer than 24 complete months exist', () => {
    const rollups = buildSeries(
      2026, 5, 23,
      Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 1000])),
    );
    const result = computeCashReserveCalendar(rollups, REF_DATE);
    expect(result.state).toBe('low-data');
    expect(result.windowMonthCount).toBe(23);
    expect(result.byMonth).toHaveLength(12);
    expect(result.constrainMonths).toEqual([]);
    expect(result.watchMonths).toEqual([]);
    expect(result.topPositiveMonths).toEqual([]);
    expect(result.advice).toBe('');
  });

  it('returns low-data state for an empty dataset', () => {
    const result = computeCashReserveCalendar([], REF_DATE);
    expect(result.state).toBe('low-data');
    expect(result.windowMonthCount).toBe(0);
    expect(result.byMonth[0].shortLabel).toBe('Jan');
    expect(result.byMonth[0].fullLabel).toBe('January');
    expect(result.byMonth[11].fullLabel).toBe('December');
  });
});

describe('computeCashReserveCalendar — current/incomplete month exclusion', () => {
  it('excludes the current calendar month even when its rollup is present', () => {
    // 24 completed months ending May 2026 + a partial June 2026 with an
    // anomalous value — the partial month must not show up in the June
    // aggregation, nor in the window count.
    const flat = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 1000]));
    const completed = buildSeries(2026, 5, 24, flat);
    const partialJune = rollup(2026, 6, -999999);
    const result = computeCashReserveCalendar([...completed, partialJune], REF_DATE);

    expect(result.state).toBe('normal');
    expect(result.windowMonthCount).toBe(24);
    // June (index 5) has 2 observations from Jun 2024 + Jun 2025 — both
    // $1,000 — and zero contribution from the excluded Jun 2026 row.
    expect(result.byMonth[5].observationCount).toBe(2);
    expect(result.byMonth[5].avgNetCash).toBe(1000);
    expect(result.byMonth[5].tier).toBe('healthy');
  });

  it('uses only the trailing 24 from the latest completed month', () => {
    // 36 months ending May 2026. The 12 oldest months (Jun 2023 …
    // May 2024) must not influence the result.
    // Inside the trailing window: net=+$1,000 every month → healthy.
    // Outside the window (older 12 months): net=-$50,000 every month →
    // would be constrain if counted. They must NOT be counted.
    const flat = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 1000]));
    const inside = buildSeries(2026, 5, 24, flat);
    const flatOld = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, -50000]));
    const outside = buildSeries(2024, 5, 12, flatOld);
    const result = computeCashReserveCalendar([...outside, ...inside], REF_DATE);

    expect(result.windowMonthCount).toBe(24);
    expect(result.constrainMonths).toHaveLength(0);
    expect(result.byMonth.every((m) => m.tier === 'healthy')).toBe(true);
  });
});

describe('computeCashReserveCalendar — tier logic', () => {
  it('classifies a uniformly-negative month as constrain', () => {
    // Apr is -$5,000 every observation (both Apr 2025 and Apr 2026 are
    // in the trailing 24 because window covers Jun 2024 → May 2026).
    const netCash: Record<number, number> = {
      1: 1000, 2: 1000, 3: 1000, 4: -5000, 5: 1000, 6: 1000,
      7: 1000, 8: 1000, 9: 1000, 10: 1000, 11: 1000, 12: 1000,
    };
    const rollups = buildSeries(2026, 5, 24, netCash);
    const result = computeCashReserveCalendar(rollups, REF_DATE);
    const apr = result.byMonth[3];
    expect(apr.observationCount).toBe(2);
    expect(apr.negativeCount).toBe(2);
    expect(apr.avgNetCash).toBe(-5000);
    expect(apr.tier).toBe('constrain');
  });

  it('classifies a mixed-history negative-average month as watch', () => {
    // We need a month with >=2 observations where avgNetCash < 0 but
    // negativeCount < observationCount. Each calendar month gets exactly
    // 2 observations in the 24-month window, so vary one of them.
    //
    // Trick: vary Aug 2025 vs Aug 2024 individually by post-processing
    // the buildSeries output.
    const flat = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 1000]));
    const rollups = buildSeries(2026, 5, 24, flat);
    // Locate Aug 2025 (index where month=2025-08) and Aug 2024.
    const aug2024 = rollups.find((r) => r.month === '2024-08');
    const aug2025 = rollups.find((r) => r.month === '2025-08');
    if (!aug2024 || !aug2025) throw new Error('fixture sanity check');
    aug2024.netCashFlow = -8000; // negative
    aug2025.netCashFlow = 2000;  // positive — drags avg above the uniform-negative line
    // avg = (-8000 + 2000) / 2 = -3000 < 0, but only 1 of 2 obs negative.

    const result = computeCashReserveCalendar(rollups, REF_DATE);
    const aug = result.byMonth[7];
    expect(aug.observationCount).toBe(2);
    expect(aug.negativeCount).toBe(1);
    expect(aug.avgNetCash).toBe(-3000);
    expect(aug.tier).toBe('watch');
  });

  it('classifies a non-negative average as healthy regardless of mix', () => {
    // Sep: one positive, one negative, but average is positive → healthy.
    const flat = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 1000]));
    const rollups = buildSeries(2026, 5, 24, flat);
    const sep2024 = rollups.find((r) => r.month === '2024-09');
    const sep2025 = rollups.find((r) => r.month === '2025-09');
    if (!sep2024 || !sep2025) throw new Error('fixture sanity check');
    sep2024.netCashFlow = -1000;
    sep2025.netCashFlow = 5000;
    const result = computeCashReserveCalendar(rollups, REF_DATE);
    const sep = result.byMonth[8];
    expect(sep.avgNetCash).toBe(2000);
    expect(sep.negativeCount).toBe(1);
    expect(sep.tier).toBe('healthy');
  });

  it('treats a month with zero observations as healthy', () => {
    // Construct a sparse history: 24 rollups all in months 1..6 (i.e.
    // no observations for Jul..Dec). The empty calendar months should
    // fall to healthy because we have no signal to flag drain.
    const series: MonthlyRollup[] = [];
    let year = 2024;
    let month = 6;
    for (let i = 0; i < 24; i++) {
      series.unshift(rollup(year, month, -100));
      month -= 1;
      if (month === 0) {
        month = 6;
        year -= 1;
      }
    }
    const result = computeCashReserveCalendar(series, REF_DATE);
    // Jul..Dec have no observations → healthy with avgNetCash=0.
    for (const idx of [6, 7, 8, 9, 10, 11]) {
      expect(result.byMonth[idx].observationCount).toBe(0);
      expect(result.byMonth[idx].tier).toBe('healthy');
    }
  });
});

describe('computeCashReserveCalendar — topPositiveMonths', () => {
  it('returns up to two healthy months with the highest positive avgNetCash', () => {
    // Mar = +$15k, Jul = +$25k, Nov = +$10k → topPositive = [Jul, Mar].
    const netCash: Record<number, number> = {
      1: 0, 2: 0, 3: 15000, 4: 0, 5: 0, 6: 0,
      7: 25000, 8: 0, 9: 0, 10: 0, 11: 10000, 12: 0,
    };
    const rollups = buildSeries(2026, 5, 24, netCash);
    const result = computeCashReserveCalendar(rollups, REF_DATE);
    expect(result.topPositiveMonths.map((m) => m.shortLabel)).toEqual(['Jul', 'Mar']);
    expect(result.topPositiveMonths[0].avgNetCash).toBe(25000);
  });

  it('returns an empty list when no months have a positive avgNetCash', () => {
    // Every month at exactly zero — no positive months.
    const flat = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 0]));
    const rollups = buildSeries(2026, 5, 24, flat);
    const result = computeCashReserveCalendar(rollups, REF_DATE);
    expect(result.topPositiveMonths).toEqual([]);
  });
});

describe('computeCashReserveCalendar — advice templating', () => {
  it('renders all three clauses when constrain, watch, and topPositive all populate', () => {
    // Apr constrain (always negative), Aug watch (mixed but negative avg),
    // Jul = sole positive month. Baseline at $0 so only the explicitly
    // positive months can enter topPositiveMonths.
    const flat = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 0]));
    const rollups = buildSeries(2026, 5, 24, flat);
    // The window covers Jun 2024 → May 2026 inclusive, so each calendar
    // month other than Jun has exactly 2 observations. Apr observations
    // are Apr 2025 and Apr 2026 (NOT 2024-04, which sits outside the
    // window's June-2024 lower bound).
    // Apr → constrain
    rollups.find((r) => r.month === '2025-04')!.netCashFlow = -3000;
    rollups.find((r) => r.month === '2026-04')!.netCashFlow = -7000;
    // Aug → watch (mixed)
    rollups.find((r) => r.month === '2024-08')!.netCashFlow = 1500;
    rollups.find((r) => r.month === '2025-08')!.netCashFlow = -9000;
    // Jul → best positive
    rollups.find((r) => r.month === '2024-07')!.netCashFlow = 30000;
    rollups.find((r) => r.month === '2025-07')!.netCashFlow = 30000;

    const result = computeCashReserveCalendar(rollups, REF_DATE);
    expect(result.advice).toBe(
      'Protect cash in April. Move optional spending to stronger months like July. Be careful with big one-time purchases before August.',
    );
  });

  it('joins two constrain months with "and"', () => {
    const flat = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 1000]));
    const rollups = buildSeries(2026, 5, 24, flat);
    rollups.filter((r) => r.month.endsWith('-04')).forEach((r) => { r.netCashFlow = -5000; });
    rollups.filter((r) => r.month.endsWith('-08')).forEach((r) => { r.netCashFlow = -5000; });
    const result = computeCashReserveCalendar(rollups, REF_DATE);
    expect(result.constrainMonths.map((m) => m.shortLabel)).toEqual(['Apr', 'Aug']);
    expect(result.advice).toMatch(/^Protect cash in April and August\./);
  });

  it('joins three+ constrain months with commas and "and"', () => {
    const flat = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 1000]));
    const rollups = buildSeries(2026, 5, 24, flat);
    for (const m of ['02', '06', '10']) {
      rollups.filter((r) => r.month.endsWith(`-${m}`)).forEach((r) => { r.netCashFlow = -5000; });
    }
    const result = computeCashReserveCalendar(rollups, REF_DATE);
    expect(result.advice).toMatch(/^Protect cash in February, June, and October\./);
  });

  it('joins topPositiveMonths with "or"', () => {
    const netCash: Record<number, number> = {
      1: 0, 2: 0, 3: 10000, 4: 0, 5: 0, 6: 0,
      7: 20000, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0,
    };
    const rollups = buildSeries(2026, 5, 24, netCash);
    const result = computeCashReserveCalendar(rollups, REF_DATE);
    expect(result.advice).toBe('Move optional spending to stronger months like July or March.');
  });

  it('omits the constrain sentence when there are no constrain months', () => {
    // Only a watch month (Aug) and a positive month (Jul).
    const flat = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 1000]));
    const rollups = buildSeries(2026, 5, 24, flat);
    rollups.find((r) => r.month === '2024-08')!.netCashFlow = 2000;
    rollups.find((r) => r.month === '2025-08')!.netCashFlow = -6000;
    rollups.find((r) => r.month === '2024-07')!.netCashFlow = 20000;
    rollups.find((r) => r.month === '2025-07')!.netCashFlow = 20000;
    const result = computeCashReserveCalendar(rollups, REF_DATE);
    expect(result.advice).not.toMatch(/Protect cash/);
    expect(result.advice).toMatch(/Move optional spending/);
    expect(result.advice).toMatch(/Be careful with big one-time purchases before August/);
  });

  it('renders the healthy fallback when every month is healthy and none is positive', () => {
    // Every month exactly zero — healthy everywhere, no positive months,
    // no constrain, no watch. Must render the locked fallback copy.
    const flat = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 0]));
    const rollups = buildSeries(2026, 5, 24, flat);
    const result = computeCashReserveCalendar(rollups, REF_DATE);
    expect(result.advice).toBe(
      'Your reserve is in good shape across the year. No structural drain months in the last 24 months.',
    );
  });
});
