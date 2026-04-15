import type { Txn } from '../data/contract';
import {
  forecastCashInContribution,
  forecastCashOutContribution,
} from '../cashFlow';

// ─── Prior-year actuals aggregation ─────────────────────────────────────────
//
// Aggregates historical transactions by year and calendar month using the
// same operating-cash classification rules as the forecast engine.
//
// Classification reuse: forecastCashInContribution and forecastCashOutContribution
// from cashFlow.ts are used directly — they are pure, side-effect-free functions
// that accept a Txn and return a dollar amount. This guarantees actuals and
// forecast use identical inclusion/exclusion logic.

export type MonthActuals = {
  cashIn: number;
  cashOut: number;
  net: number;
};

export type YearActuals = {
  year: number;
  months: Record<number, MonthActuals>; // key = month number 1–12
};

export type PriorYearActualsResult = {
  years: YearActuals[];       // sorted ascending by year
  detectedYears: number[];    // sorted ascending, excludes current forecast year
};

const EPSILON = 1e-6;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Aggregate transactions into prior-year actuals by year and calendar month.
 *
 * @param txns - Full transactions array
 * @param currentForecastYear - The year to exclude from detectedYears
 *   (typically the current calendar year whose months are being forecast)
 */
export function computePriorYearActuals(
  txns: Txn[],
  currentForecastYear: number,
): PriorYearActualsResult {
  const yearMap = new Map<number, Map<number, { cashIn: number; cashOut: number }>>();

  for (const txn of txns) {
    const monthToken = txn.month; // "YYYY-MM"
    if (!monthToken || !/^\d{4}-\d{2}$/.test(monthToken)) continue;

    const year = Number.parseInt(monthToken.slice(0, 4), 10);
    const month = Number.parseInt(monthToken.slice(5, 7), 10);

    const cashIn = forecastCashInContribution(txn);
    const cashOut = forecastCashOutContribution(txn);

    if (Math.abs(cashIn) < EPSILON && Math.abs(cashOut) < EPSILON) continue;

    if (!yearMap.has(year)) yearMap.set(year, new Map());
    const monthMap = yearMap.get(year)!;

    if (!monthMap.has(month)) monthMap.set(month, { cashIn: 0, cashOut: 0 });
    const bucket = monthMap.get(month)!;

    bucket.cashIn += cashIn;
    bucket.cashOut += cashOut;
  }

  const allYears = [...yearMap.keys()].sort((a, b) => a - b);

  const years: YearActuals[] = allYears.map((year) => {
    const monthMap = yearMap.get(year)!;
    const months: Record<number, MonthActuals> = {};

    for (let m = 1; m <= 12; m++) {
      const bucket = monthMap.get(m);
      if (bucket) {
        const cashIn = round2(bucket.cashIn);
        const cashOut = round2(bucket.cashOut);
        months[m] = { cashIn, cashOut, net: round2(cashIn - cashOut) };
      } else {
        months[m] = { cashIn: 0, cashOut: 0, net: 0 };
      }
    }

    return { year, months };
  });

  const detectedYears = allYears.filter((y) => y !== currentForecastYear).slice(-3);

  return { years, detectedYears };
}
