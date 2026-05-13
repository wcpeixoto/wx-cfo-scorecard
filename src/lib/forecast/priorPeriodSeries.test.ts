import { describe, expect, it } from 'vitest';
import type { MonthlyRollup } from '../data/contract';
import { buildPriorPeriodSeries } from './priorPeriodSeries';

function makeRollups(start: string, count: number): MonthlyRollup[] {
  const [y, m] = start.split('-').map((s) => parseInt(s, 10));
  const out: MonthlyRollup[] = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    out.push({
      month,
      revenue: 1000 + i,
      expenses: 800 + i,
      netCashFlow: 200,
      savingsRate: 0.2,
      transactionCount: 10,
    });
  }
  return out;
}

function monthsFrom(start: string, count: number): string[] {
  const [y, m] = start.split('-').map((s) => parseInt(s, 10));
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

describe('buildPriorPeriodSeries — same-period-prior-year offset', () => {
  // 24 months of history ending May 2026, forecast starts Jun 2026.
  const history = makeRollups('2024-06', 24);

  it('1-month horizon (30 days) shifts back 12 months to same calendar month', () => {
    const result = buildPriorPeriodSeries(history, 10000, monthsFrom('2026-06', 1));
    expect(result?.priorMonths).toEqual(['2025-06']);
  });

  it('2-month horizon (60 days) shifts back 12 months, not 2', () => {
    const result = buildPriorPeriodSeries(history, 10000, monthsFrom('2026-06', 2));
    expect(result?.priorMonths).toEqual(['2025-06', '2025-07']);
  });

  it('3-month horizon (90 days) shifts back 12 months, not 3', () => {
    const result = buildPriorPeriodSeries(history, 10000, monthsFrom('2026-06', 3));
    expect(result?.priorMonths).toEqual(['2025-06', '2025-07', '2025-08']);
  });

  it('6-month horizon shifts back 12 months', () => {
    const result = buildPriorPeriodSeries(history, 10000, monthsFrom('2026-06', 6));
    expect(result?.priorMonths).toEqual([
      '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11',
    ]);
  });

  it('12-month horizon shifts back exactly 12 months (unchanged behavior)', () => {
    const result = buildPriorPeriodSeries(history, 10000, monthsFrom('2026-06', 12));
    expect(result?.priorMonths[0]).toBe('2025-06');
    expect(result?.priorMonths[11]).toBe('2026-05');
  });

  it('24-month horizon shifts back 24 months (unchanged behavior)', () => {
    const result = buildPriorPeriodSeries(history, 10000, monthsFrom('2026-06', 24));
    expect(result?.priorMonths[0]).toBe('2024-06');
    expect(result?.priorMonths[23]).toBe('2026-05');
  });

  it('36-month horizon shifts back 36 months (unchanged behavior)', () => {
    // Need 48 months of history for a 36-month forecast (36 prior + 12 buffer).
    const longHistory = makeRollups('2022-06', 48);
    const result = buildPriorPeriodSeries(longHistory, 10000, monthsFrom('2026-06', 36));
    expect(result?.priorMonths[0]).toBe('2023-06');
    expect(result?.priorMonths[35]).toBe('2026-05');
  });

  it('returns null when prior-year coverage is missing for a 30-day forecast', () => {
    const shortHistory = makeRollups('2026-04', 2); // Apr–May 2026 only
    const result = buildPriorPeriodSeries(shortHistory, 10000, monthsFrom('2026-06', 1));
    expect(result).toBeNull();
  });

  it('returns null when prior window would extend past the last actual month', () => {
    // History ends Dec 2025, forecast starts Jan 2026 (1 month).
    // Prior shift -12 → Jan 2025. That requires Jan 2025 in history.
    const partialHistory = makeRollups('2025-06', 7); // Jun–Dec 2025 only
    const result = buildPriorPeriodSeries(partialHistory, 10000, monthsFrom('2026-01', 1));
    expect(result).toBeNull();
  });

  it('starting balance reflects balance at end of month before priorMonths[0]', () => {
    // history Jun 2024 – May 2026, netCashFlow = 200/month, 24 months.
    // Current cash = 10000 at end of May 2026.
    // For forecast starting Jun 2026 (1mo), prior = Jun 2025.
    // Balance at end of May 2025 = 10000 - sum(Jun 2025..May 2026 net) = 10000 - 12*200 = 7600.
    const result = buildPriorPeriodSeries(history, 10000, monthsFrom('2026-06', 1));
    expect(result?.startingBalance).toBe(7600);
  });
});
