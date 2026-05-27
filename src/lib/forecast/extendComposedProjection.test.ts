import { describe, expect, it } from 'vitest';
import { extendComposedProjection } from './extendComposedProjection';
import { computeForecastDecisionSignals } from '../kpis/compute';
import { detectSignals } from '../priorities/signals';
import type { DashboardModel, ScenarioPoint, ForecastSeasonalityMeta, Txn } from '../data/contract';

const SEASONALITY_STUB: ForecastSeasonalityMeta = {
  mode: 'fallback',
  confidence: 'none',
  completeYearsUsed: [],
  partialYearsExcluded: [],
  weighting: [],
  capMin: 0,
  capMax: 0,
  divergenceThresholdPct: 0,
  warning: null,
};

function makePoint(month: string, netCashFlow: number, endingCashBalance: number): ScenarioPoint {
  return {
    month,
    operatingCashIn: 0,
    operatingCashOut: 0,
    cashIn: Math.max(netCashFlow, 0),
    cashOut: Math.max(-netCashFlow, 0),
    netCashFlow,
    endingCashBalance,
  };
}

// 12-month composed Year-1 pattern. Each month nets -$2K (revenue minus
// expenses), so cash declines from $20K start → $18K, $16K, …, ending at
// $-4K by month 12. Realistic enough to drive both compose and extend.
const COMPOSED_12 = {
  points: Array.from({ length: 12 }, (_, i) => {
    const monthNumber = ((4 + i) % 12) + 1; // start May (05)
    const year = i < 8 ? 2026 : 2027;
    const monthToken = `${year}-${String(monthNumber).padStart(2, '0')}`;
    const endingCashBalance = 20000 - 2000 * (i + 1);
    return makePoint(monthToken, -2000, endingCashBalance);
  }),
  seasonality: SEASONALITY_STUB,
};

// 12-month composed pattern that stays positive throughout — runs out at
// month 13 only when extended. Each month nets -$1.5K, cash declines from
// $20K → $18.5K, $17K, …, $2K by month 12. Month 13 (extension) hits $500,
// month 14 hits -$1K (first negative).
const COMPOSED_12_LATE_RUNOUT = {
  points: Array.from({ length: 12 }, (_, i) => {
    const monthNumber = ((4 + i) % 12) + 1;
    const year = i < 8 ? 2026 : 2027;
    const monthToken = `${year}-${String(monthNumber).padStart(2, '0')}`;
    const endingCashBalance = 20000 - 1500 * (i + 1);
    return makePoint(monthToken, -1500, endingCashBalance);
  }),
  seasonality: SEASONALITY_STUB,
};

describe('extendComposedProjection', () => {
  it('returns the composed input unchanged when requestedMonths ≤ composed length and no events', () => {
    const result = extendComposedProjection(COMPOSED_12, 20000, 12, []);
    expect(result).toHaveLength(12);
    expect(result[0].month).toBe('2026-05');
    expect(result[11].month).toBe('2027-04');
    expect(result[11].endingCashBalance).toBe(-4000);
  });

  it('extends to a longer horizon by walking the Year-1 monthly pattern forward', () => {
    const result = extendComposedProjection(COMPOSED_12_LATE_RUNOUT, 20000, 24, []);
    expect(result).toHaveLength(24);
    // First 12 months are the composed input verbatim.
    expect(result[0].endingCashBalance).toBe(18500);
    expect(result[11].endingCashBalance).toBe(2000);
    // Month 13 (index 12, May 2027) walks: $2K + (-$1.5K) = $500.
    expect(result[12].month).toBe('2027-05');
    expect(result[12].endingCashBalance).toBeCloseTo(500);
    // Month 14 (index 13, June 2027) hits the first negative balance.
    expect(result[13].month).toBe('2027-06');
    expect(result[13].endingCashBalance).toBeCloseTo(-1000);
  });

  it('truncates extension when fewer source months exist than requested', () => {
    const shortComposed = { points: COMPOSED_12.points.slice(0, 6), seasonality: SEASONALITY_STUB };
    // 6 source months → only 6 month-of-year keys available; extension breaks
    // when the next required moy isn't in the source map.
    const result = extendComposedProjection(shortComposed, 20000, 24, []);
    expect(result.length).toBeLessThanOrEqual(24);
    expect(result.length).toBeGreaterThanOrEqual(6);
  });

  it('handles empty composed input safely', () => {
    const empty = { points: [], seasonality: SEASONALITY_STUB };
    expect(extendComposedProjection(empty, 20000, 24, [])).toEqual([]);
  });
});

describe('Today run-out signal: asymmetric 24m / 12m horizon', () => {
  // The Today Cash on Hand "projected to run out" row is sourced from a
  // dedicated 24-month projection (TODAY_RUN_OUT_HORIZON_MONTHS), while the
  // priority/badge pipeline (detectSignals → TODAY_FORWARD_CASH_WINDOW_MONTHS)
  // stays on a 12-month window. These tests pin that asymmetry: month-13
  // negative cash MUST be detected by the run-out signal AND MUST NOT fire
  // cash_flow_negative on the priority signal — both are intentional.

  const projection24m = extendComposedProjection(COMPOSED_12_LATE_RUNOUT, 20000, 24, []);
  const minimalModel = {
    runway: {
      currentCashBalance: 20000,
      reserveTarget: 30000,
      percentFunded: 0.67,
    },
    monthlyRollups: [],
  } as unknown as DashboardModel;
  const noTxns: Txn[] = [];

  it('computeForecastDecisionSignals detects the month-13 run-out on a 24m projection', () => {
    const signals = computeForecastDecisionSignals(projection24m, 30000);
    expect(signals.negativeCashMonth).toBe('2027-06');
  });

  it('detectSignals stays on 12-month window — month-13+ negatives DO NOT fire cash_flow_negative', () => {
    const signals = detectSignals(minimalModel, noTxns, projection24m);
    const cashFlowNegative = signals.find((s) => s.type === 'cash_flow_negative');
    expect(cashFlowNegative).toBeUndefined();
  });

  it('detectSignals would still detect cash_flow_negative when the trough is inside the 12-month window', () => {
    // Sanity check the inverse — if cash goes negative within months 0–11,
    // the 12-month priority window IS supposed to catch it.
    const projection12mNeg = extendComposedProjection(COMPOSED_12, 20000, 12, []);
    const signals = detectSignals(minimalModel, noTxns, projection12mNeg);
    const cashFlowNegative = signals.find((s) => s.type === 'cash_flow_negative');
    expect(cashFlowNegative).toBeDefined();
  });
});
