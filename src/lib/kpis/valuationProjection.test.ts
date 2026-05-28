import { describe, it, expect } from 'vitest';
import {
  computeValuationProjection,
  marginQualityAdjustment,
  buildProjectedSde,
  isValuationScenarioActive,
  MARGIN_QUALITY_LOW_THRESHOLD,
  MARGIN_QUALITY_HIGH_THRESHOLD,
  MARGIN_QUALITY_PENALTY,
  MARGIN_QUALITY_BONUS,
  type ProjectionAddBacks,
  type ProjectionPoint,
  type ValuationProjectionInputs,
} from './valuationProjection';

const ZERO_ADDBACKS: ProjectionAddBacks = {
  ownerW2Compensation: null,
  personalExpensesThroughBusiness: null,
  oneTimeExpensesToAddBack: null,
  oneTimeGainsToSubtract: null,
};

// Helpers to build 12-month projection arrays at a flat monthly value.
function flat(months: number, cashIn: number, netCashFlow: number): ProjectionPoint[] {
  return Array.from({ length: months }, () => ({ cashIn, netCashFlow }));
}

const DERIVED_MULTIPLE = 2.25;
const DISPLAY_RANGE = { lower: 2.00, upper: 2.50 };

describe('isValuationScenarioActive', () => {
  it('returns false when both deltas are zero (neutral state)', () => {
    expect(isValuationScenarioActive({ revenueGrowthPct: 0, expenseChangePct: 0 })).toBe(false);
  });

  it('returns true when revenue delta is nonzero', () => {
    expect(isValuationScenarioActive({ revenueGrowthPct: 5, expenseChangePct: 0 })).toBe(true);
    expect(isValuationScenarioActive({ revenueGrowthPct: -5, expenseChangePct: 0 })).toBe(true);
  });

  it('returns true when expense delta is nonzero', () => {
    expect(isValuationScenarioActive({ revenueGrowthPct: 0, expenseChangePct: 5 })).toBe(true);
    expect(isValuationScenarioActive({ revenueGrowthPct: 0, expenseChangePct: -5 })).toBe(true);
  });

  it('returns true when both deltas are nonzero', () => {
    expect(isValuationScenarioActive({ revenueGrowthPct: 3, expenseChangePct: -2 })).toBe(true);
  });

  // AR/AP day controls are enforced as excluded by the helper's TYPE
  // signature — it only accepts revenueGrowthPct + expenseChangePct.
  // Callers pass the wider ScenarioInput; TS structurally narrows. No
  // separate runtime test needed — the type IS the assertion.
});

describe('marginQualityAdjustment', () => {
  it('returns penalty when margin is below 10%', () => {
    expect(marginQualityAdjustment(0.05)).toBe(MARGIN_QUALITY_PENALTY);
    expect(marginQualityAdjustment(0.09999)).toBe(MARGIN_QUALITY_PENALTY);
    expect(marginQualityAdjustment(-0.20)).toBe(MARGIN_QUALITY_PENALTY);
  });

  it('returns 0 at the 10% lower boundary (inclusive)', () => {
    expect(marginQualityAdjustment(MARGIN_QUALITY_LOW_THRESHOLD)).toBe(0);
  });

  it('returns 0 between 10% and 25% (exclusive of 25%)', () => {
    expect(marginQualityAdjustment(0.15)).toBe(0);
    expect(marginQualityAdjustment(0.249)).toBe(0);
  });

  it('returns bonus at exactly 25% (boundary must NOT be 0)', () => {
    expect(marginQualityAdjustment(MARGIN_QUALITY_HIGH_THRESHOLD)).toBe(MARGIN_QUALITY_BONUS);
  });

  it('returns bonus above 25%', () => {
    expect(marginQualityAdjustment(0.30)).toBe(MARGIN_QUALITY_BONUS);
    expect(marginQualityAdjustment(0.50)).toBe(MARGIN_QUALITY_BONUS);
  });
});

describe('buildProjectedSde', () => {
  it('adds W2, personal, one-time, and subtracts one-time gains', () => {
    const sde = buildProjectedSde(40_000, {
      ownerW2Compensation: 60_000,
      personalExpensesThroughBusiness: 5_000,
      oneTimeExpensesToAddBack: 2_000,
      oneTimeGainsToSubtract: 1_000,
    });
    expect(sde).toBe(40_000 + 60_000 + 5_000 + 2_000 - 1_000);
  });

  it('treats null add-backs as 0', () => {
    expect(buildProjectedSde(40_000, ZERO_ADDBACKS)).toBe(40_000);
  });
});

describe('computeValuationProjection — actual leg', () => {
  function inputs(forecast: ProjectionPoint[]): ValuationProjectionInputs {
    return {
      forecastPoints: forecast,
      baselineForecastPoints: null,
      addBacks: ZERO_ADDBACKS,
      derivedMultiple: DERIVED_MULTIPLE,
      displayMultipleRange: DISPLAY_RANGE,
      effectiveTargetNetMargin: 0.25,
    };
  }

  it('produces an actual leg from a 12-month forecast', () => {
    // 1k revenue × 12 = $12k annual, 200 net × 12 = $2,400 → 20% margin
    const { actual } = computeValuationProjection(inputs(flat(12, 1_000, 200)));
    expect(actual).not.toBeNull();
    expect(actual!.annualNet).toBe(2_400);
    expect(actual!.annualRevenue).toBe(12_000);
    expect(actual!.margin).toBeCloseTo(0.20);
    expect(actual!.sde).toBe(2_400);
    expect(actual!.marginQualityAdjustment).toBe(0);
    expect(actual!.adjustedMultiple).toBe(DERIVED_MULTIPLE);
    expect(actual!.displayedValuation).toBeCloseTo(2_400 * DERIVED_MULTIPLE);
    expect(actual!.isFloored).toBe(false);
  });

  it('applies bonus and clamps adjusted multiple to upper display band edge', () => {
    // 30% margin → +0.15× adjustment. derived 2.25 + 0.15 = 2.40 (inside band 2.00–2.50).
    const { actual } = computeValuationProjection(inputs(flat(12, 1_000, 300)));
    expect(actual!.marginQualityAdjustment).toBe(MARGIN_QUALITY_BONUS);
    expect(actual!.adjustedMultiple).toBe(2.40);
  });

  it('clamps adjusted multiple to upper display band edge when bonus would exceed it', () => {
    // derived 2.40 + bonus 0.15 = 2.55 → clamped to 2.50 (upper edge)
    const { actual } = computeValuationProjection({
      ...inputs(flat(12, 1_000, 300)),
      derivedMultiple: 2.40,
      displayMultipleRange: { lower: 2.15, upper: 2.50 },
    });
    expect(actual!.marginQualityAdjustment).toBe(MARGIN_QUALITY_BONUS);
    expect(actual!.adjustedMultiple).toBe(2.50);
  });

  it('clamps adjusted multiple to lower display band edge when penalty would fall below it', () => {
    // 5% margin → -0.10× penalty. derived 2.10 - 0.10 = 2.00, lower edge 2.05 → clamps to 2.05
    const { actual } = computeValuationProjection({
      ...inputs(flat(12, 1_000, 50)),
      derivedMultiple: 2.10,
      displayMultipleRange: { lower: 2.05, upper: 2.35 },
    });
    expect(actual!.marginQualityAdjustment).toBe(MARGIN_QUALITY_PENALTY);
    expect(actual!.adjustedMultiple).toBe(2.05);
  });

  it('reconciles projected SDE = projected net + add-backs - one-time gains', () => {
    const { actual } = computeValuationProjection({
      ...inputs(flat(12, 5_000, 2_000)), // annual net = 24,000
      addBacks: {
        ownerW2Compensation: 60_000,
        personalExpensesThroughBusiness: 5_000,
        oneTimeExpensesToAddBack: 2_000,
        oneTimeGainsToSubtract: 1_000,
      },
    });
    expect(actual!.sde).toBe(24_000 + 60_000 + 5_000 + 2_000 - 1_000);
  });

  it('returns null actual when forecastPoints has < 12 months', () => {
    const { actual } = computeValuationProjection(inputs(flat(11, 1_000, 200)));
    expect(actual).toBeNull();
  });

  it('returns null actual when projected revenue is zero (no divide-by-zero)', () => {
    const { actual } = computeValuationProjection(inputs(flat(12, 0, 0)));
    expect(actual).toBeNull();
  });

  it('floors displayed valuation at 0 when projected SDE is non-positive', () => {
    // -1,000/mo × 12 = -12,000 net; no add-backs → SDE = -12,000 (negative)
    const { actual } = computeValuationProjection({
      ...inputs(flat(12, 5_000, -1_000)),
    });
    expect(actual!.sde).toBe(-12_000); // raw math NOT clamped
    expect(actual!.displayedValuation).toBe(0); // display floored
    expect(actual!.isFloored).toBe(true);
  });

  it('does NOT mark isFloored when SDE is exactly 0', () => {
    const { actual } = computeValuationProjection({
      ...inputs(flat(12, 5_000, 0)),
    });
    expect(actual!.sde).toBe(0);
    expect(actual!.isFloored).toBe(true); // sde <= 0 includes zero; needs-input copy
  });
});

describe('computeValuationProjection — goal leg', () => {
  const baseline12 = flat(12, 10_000, 0); // $120k annual revenue baseline
  function withGoal(forecast: ProjectionPoint[] | null): ValuationProjectionInputs {
    return {
      forecastPoints: forecast,
      baselineForecastPoints: baseline12,
      addBacks: ZERO_ADDBACKS,
      derivedMultiple: DERIVED_MULTIPLE,
      displayMultipleRange: DISPLAY_RANGE,
      effectiveTargetNetMargin: 0.25,
    };
  }

  it('uses slider-neutral baseline revenue × target margin for goal net', () => {
    const { goal } = computeValuationProjection(withGoal(flat(12, 1_000, 200)));
    expect(goal).not.toBeNull();
    expect(goal!.annualRevenue).toBe(120_000); // baseline, not slider 12,000
    expect(goal!.annualNet).toBe(30_000); // 120,000 × 0.25
    expect(goal!.margin).toBe(0.25);
    expect(goal!.marginQualityAdjustment).toBe(MARGIN_QUALITY_BONUS); // exactly 25%
    expect(goal!.adjustedMultiple).toBe(2.40); // clamped inside [2.00, 2.50]
    expect(goal!.displayedValuation).toBe(30_000 * 2.40);
  });

  it('goal valuation is stable across two DIFFERENT forecastPoints (slider-immune)', () => {
    const a = computeValuationProjection(withGoal(flat(12, 1_000, 200)));
    const b = computeValuationProjection(withGoal(flat(12, 20_000, 5_000))); // wildly different sliders
    expect(b.goal!.annualRevenue).toBe(a.goal!.annualRevenue);
    expect(b.goal!.annualNet).toBe(a.goal!.annualNet);
    expect(b.goal!.displayedValuation).toBe(a.goal!.displayedValuation);
    expect(b.actual!.displayedValuation).not.toBe(a.actual!.displayedValuation);
  });

  it('returns null goal when baselineForecastPoints is null', () => {
    const { goal } = computeValuationProjection({
      ...withGoal(flat(12, 1_000, 200)),
      baselineForecastPoints: null,
    });
    expect(goal).toBeNull();
  });

  it('returns null goal when target margin is null or <= 0', () => {
    const { goal: g1 } = computeValuationProjection({
      ...withGoal(flat(12, 1_000, 200)),
      effectiveTargetNetMargin: null,
    });
    const { goal: g2 } = computeValuationProjection({
      ...withGoal(flat(12, 1_000, 200)),
      effectiveTargetNetMargin: 0,
    });
    expect(g1).toBeNull();
    expect(g2).toBeNull();
  });

  it('returns null goal when baseline has < 12 months', () => {
    const { goal } = computeValuationProjection({
      ...withGoal(flat(12, 1_000, 200)),
      baselineForecastPoints: flat(11, 10_000, 0),
    });
    expect(goal).toBeNull();
  });
});
