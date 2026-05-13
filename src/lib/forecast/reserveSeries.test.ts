import { describe, expect, it } from 'vitest';
import type { ScenarioPoint, TrendPoint } from '../data/contract';
import { buildReserveSeries } from './reserveSeries';

function makeFullForecast(start: string, count: number, monthlyCashOut: number): ScenarioPoint[] {
  const [y, m] = start.split('-').map((s) => parseInt(s, 10));
  const out: ScenarioPoint[] = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    out.push({
      month,
      operatingCashIn: 0,
      operatingCashOut: monthlyCashOut,
      cashIn: 0,
      cashOut: monthlyCashOut,
      netCashFlow: -monthlyCashOut,
      endingCashBalance: 0,
    });
  }
  return out;
}

function makeMonthlyDisplay(start: string, count: number): TrendPoint[] {
  const [y, m] = start.split('-').map((s) => parseInt(s, 10));
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    return { month, income: 0, expense: 0, net: 0 };
  });
}

describe('buildReserveSeries', () => {
  it('returns sum of next 30 days of daily expense rates, anchored at end-of-month', () => {
    // 31-day months, $3100/month → daily rate = $100. Reserve = 30 * $100 = $3000.
    const fullForecast = makeFullForecast('2026-01', 12, 3100);
    const display = makeMonthlyDisplay('2026-01', 3);
    const result = buildReserveSeries(fullForecast, display, 'month');
    // Anchor for Jan = Jan 31. Window = Feb 1 – Mar 2 (30 days).
    // Feb 2026 has 28 days, so daily = 3100/28; Mar has 31 days, daily = 3100/31.
    // Window: Feb 1–28 (28 days @ 3100/28) + Mar 1–2 (2 days @ 3100/31) = 3100 + 200 ≈ 3300.
    expect(result?.[0]).toBe(Math.round(3100 + (2 * 3100) / 31));
  });

  it('reserve values are stable across same-length-window anchors when underlying daily rate is uniform', () => {
    // Scale monthly cashOut by month length so daily rate = $100 everywhere.
    const months = ['2026-03', '2026-04', '2026-05', '2026-06'];
    const fullForecast: ScenarioPoint[] = months.map((m) => {
      const [y, mm] = m.split('-').map(Number);
      const dim = new Date(Date.UTC(y, mm, 0)).getUTCDate();
      return {
        month: m,
        operatingCashIn: 0,
        operatingCashOut: 100 * dim,
        cashIn: 0,
        cashOut: 100 * dim,
        netCashFlow: -100 * dim,
        endingCashBalance: 0,
      };
    });
    const display = makeMonthlyDisplay('2026-03', 2); // Mar & Apr anchors → reserve = 30 * $100 = $3000
    const result = buildReserveSeries(fullForecast, display, 'month');
    expect(result?.[0]).toBe(3000);
    expect(result?.[1]).toBe(3000);
  });

  it('reserve rises when future projected expenses rise', () => {
    const fullForecast: ScenarioPoint[] = [
      ...makeFullForecast('2026-01', 6, 3000),
      ...makeFullForecast('2026-07', 6, 9000), // tripled
    ];
    const display = makeMonthlyDisplay('2026-04', 3); // Apr/May/Jun anchors, windows reach Jul+
    const result = buildReserveSeries(fullForecast, display, 'month');
    expect(result?.[0]).toBeLessThan(result?.[1] ?? 0);
    expect(result?.[1]).toBeLessThan(result?.[2] ?? 0);
  });

  it('truncates the tail when fullForecast does not extend 30 days past the anchor', () => {
    // 12 months of forecast; display = same 12 months.
    // Anchor of last point = Dec 31. Window = Jan 1 – Jan 30 of next year, which is past fullForecast.
    const fullForecast = makeFullForecast('2026-01', 12, 3000);
    const display = makeMonthlyDisplay('2026-01', 12);
    const result = buildReserveSeries(fullForecast, display, 'month');
    expect(result?.[11]).toBeNull();
    expect(result?.[10]).not.toBeNull(); // Nov anchor → Dec window, within bounds
  });

  it('returns null when no point has a full 30-day forward window', () => {
    // Only 1 month of fullForecast; anchor of that month would need next 30 days that do not exist.
    const fullForecast = makeFullForecast('2026-01', 1, 3000);
    const display = makeMonthlyDisplay('2026-01', 1);
    const result = buildReserveSeries(fullForecast, display, 'month');
    expect(result).toBeNull();
  });

  it('returns null on empty inputs', () => {
    expect(buildReserveSeries([], makeMonthlyDisplay('2026-01', 1), 'month')).toBeNull();
    expect(buildReserveSeries(makeFullForecast('2026-01', 6, 1000), [], 'month')).toBeNull();
  });

  it('weekly granularity anchors at periodEnd, not month end', () => {
    const fullForecast = makeFullForecast('2026-01', 12, 3100);
    const weekly: TrendPoint[] = [
      {
        month: '2026-01-12',
        income: 0,
        expense: 0,
        net: 0,
        granularity: 'week',
        periodStart: '2026-01-12',
        periodEnd: '2026-01-18',
      },
    ];
    const result = buildReserveSeries(fullForecast, weekly, 'week');
    // Anchor = Jan 18; window = Jan 19 – Feb 17 (30 days).
    // Jan 19–31 = 13 days @ 3100/31; Feb 1–17 = 17 days @ 3100/28.
    const expected = Math.round((13 * 3100) / 31 + (17 * 3100) / 28);
    expect(result?.[0]).toBe(expected);
  });
});
