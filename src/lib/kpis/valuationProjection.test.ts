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
const DEFAULT_TTM_SDE = 40_000;

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

describe('computeValuationProjection — actual leg (delta-SDE model)', () => {
  // Builds a ValuationProjectionInputs from per-test overrides. Defaults
  // match a neutral-delta case (active === baseline, ttmSde anchor set).
  function inputs(opts: {
    forecast: ProjectionPoint[];
    baseline: ProjectionPoint[];
    ttmSde?: number | null;
    addBacks?: ProjectionAddBacks;
    derivedMultiple?: number;
    displayMultipleRange?: { lower: number; upper: number };
  }): ValuationProjectionInputs {
    return {
      forecastPoints: opts.forecast,
      baselineForecastPoints: opts.baseline,
      currentTtmSde: opts.ttmSde === undefined ? DEFAULT_TTM_SDE : opts.ttmSde,
      addBacks: opts.addBacks ?? ZERO_ADDBACKS,
      derivedMultiple: opts.derivedMultiple ?? DERIVED_MULTIPLE,
      displayMultipleRange: opts.displayMultipleRange ?? DISPLAY_RANGE,
      effectiveTargetNetMargin: 0.25,
    };
  }

  // ── Wesley's 5 required tests ────────────────────────────────────────────

  it('returns sde === currentTtmSde when active forecast equals baseline (neutral delta)', () => {
    // The load-bearing test: sliders neutral → delta = 0 → SDE anchored
    // exactly to TTM SDE → hero matches the TTM-based neutral hero. This
    // is the property that removes the level cliff at the neutral→active
    // boundary.
    const flat12 = flat(12, 1_000, 200);
    const { actual } = computeValuationProjection(inputs({
      forecast: flat12,
      baseline: flat12,
      ttmSde: 40_000,
    }));
    expect(actual).not.toBeNull();
    expect(actual!.sde).toBe(40_000);
    expect(actual!.annualNet).toBe(2_400);
    expect(actual!.annualRevenue).toBe(12_000);
    expect(actual!.margin).toBeCloseTo(0.20);
    // 20% margin sits in the no-adjustment band [10%, 25%); multiple stays at derived
    expect(actual!.marginQualityAdjustment).toBe(0);
    expect(actual!.adjustedMultiple).toBe(DERIVED_MULTIPLE);
    expect(actual!.displayedValuation).toBeCloseTo(40_000 * DERIVED_MULTIPLE);
    expect(actual!.isFloored).toBe(false);
  });

  it('small +revenue nudge moves valuation UPWARD from TTM, not down to absolute forecast SDE', () => {
    // Pre-fix bug: active leg displayed projected SDE directly (~$10K),
    // collapsing $117K hero to $30K on any nonzero slider. Post-fix: a
    // small positive delta lifts the TTM-anchored hero modestly.
    //
    // baseline net = $2,400; active net = $5,000 (revenue slider boost)
    // delta = +$2,600; scenarioSde = 40,000 + 2,600 = $42,600
    const { actual } = computeValuationProjection(inputs({
      forecast: flat(12, 1_100, 416.67),  // ~$5,000 annual net
      baseline: flat(12, 1_000, 200),      // $2,400 annual net
      ttmSde: 40_000,
    }));
    // Lift, not collapse:
    expect(actual!.sde).toBeGreaterThan(40_000);
    expect(actual!.sde).toBeCloseTo(40_000 + (416.67 * 12 - 2_400), 0);  // ~42,600
    // Crucially NOT the absolute forecast SDE (~$5,000) that caused the cliff:
    expect(actual!.sde).toBeGreaterThan(20_000);
    // Hero stays close to neutral $TTM × multiple, with a modest lift:
    expect(actual!.displayedValuation).toBeGreaterThan(40_000 * DERIVED_MULTIPLE);
  });

  it('expense reduction (active net higher than baseline) increases valuation', () => {
    // Expense slider -1% → forecast net higher than baseline → positive
    // delta → SDE lifts above TTM. Compare against the neutral case.
    const baselinePoints = flat(12, 1_000, 200);  // $2,400 baseline net
    const neutralCase = computeValuationProjection(inputs({
      forecast: baselinePoints,
      baseline: baselinePoints,
    }));
    const cheaperExpenseCase = computeValuationProjection(inputs({
      forecast: flat(12, 1_000, 250),  // net higher by $50/mo = +$600/yr
      baseline: baselinePoints,
    }));
    expect(cheaperExpenseCase.actual!.sde).toBeGreaterThan(neutralCase.actual!.sde);
    expect(cheaperExpenseCase.actual!.displayedValuation)
      .toBeGreaterThan(neutralCase.actual!.displayedValuation);
    // Direction sanity: lift matches the delta (within margin-quality bucket noise)
    expect(cheaperExpenseCase.actual!.sde).toBe(40_000 + 600);
  });

  it('large negative scenario floors valuation to 0 and sets isFloored', () => {
    // Catastrophic active forecast (e.g. +50% expense slider) drives
    // scenarioSde non-positive → "Not buyer-ready at this pace" copy fires.
    //
    // baseline net = $2,400; active net = -$50,000 → delta = -$52,400
    // scenarioSde = $40,000 - $52,400 = -$12,400 → display floored to 0
    const { actual } = computeValuationProjection(inputs({
      forecast: flat(12, 5_000, -4_166.67),  // ~-$50,000 annual net
      baseline: flat(12, 1_000, 200),        // $2,400 annual net
      ttmSde: 40_000,
    }));
    expect(actual!.sde).toBeLessThan(0);           // raw math NOT clamped
    expect(actual!.displayedValuation).toBe(0);    // display floored
    expect(actual!.isFloored).toBe(true);          // floor copy fires
  });

  it('goal leg remains stable across slider changes (independent of actual delta)', () => {
    // Two wildly different scenario forecasts, same baseline → goal hero
    // must NOT move. The actual hero IS allowed to differ (it tracks
    // the delta).
    const baselinePoints = flat(12, 10_000, 2_000);  // $120K baseline revenue
    const a = computeValuationProjection(inputs({
      forecast: flat(12, 1_000, 200),
      baseline: baselinePoints,
    }));
    const b = computeValuationProjection(inputs({
      forecast: flat(12, 20_000, 5_000),
      baseline: baselinePoints,
    }));
    expect(b.goal!.annualRevenue).toBe(a.goal!.annualRevenue);
    expect(b.goal!.annualNet).toBe(a.goal!.annualNet);
    expect(b.goal!.displayedValuation).toBe(a.goal!.displayedValuation);
    // Actual SHOULD differ — different deltas land on the same TTM anchor:
    expect(b.actual!.sde).not.toBe(a.actual!.sde);
  });

  // ── Supporting tests ─────────────────────────────────────────────────────

  it('does NOT re-apply add-backs to actual leg (currentTtmSde already contains them)', () => {
    // Regression guard against double-counting. Neutral delta + nonzero
    // add-backs → SDE must equal ttmSde, not ttmSde + add-backs.
    const flat12 = flat(12, 1_000, 200);
    const { actual } = computeValuationProjection(inputs({
      forecast: flat12,
      baseline: flat12,
      ttmSde: 40_000,
      addBacks: {
        ownerW2Compensation: 60_000,
        personalExpensesThroughBusiness: 5_000,
        oneTimeExpensesToAddBack: 2_000,
        oneTimeGainsToSubtract: 1_000,
      },
    }));
    expect(actual!.sde).toBe(40_000);  // NOT 40_000 + 66_000
  });

  it('applies margin-quality bonus based on active scenario margin', () => {
    // 30% active margin → +0.15× bonus. delta = 1,200 → SDE = 41,200.
    const { actual } = computeValuationProjection(inputs({
      forecast: flat(12, 1_000, 300),  // 30% margin, $3,600 annual net
      baseline: flat(12, 1_000, 200),  // $2,400 annual net
      ttmSde: 40_000,
    }));
    expect(actual!.marginQualityAdjustment).toBe(MARGIN_QUALITY_BONUS);
    expect(actual!.sde).toBe(41_200);
    expect(actual!.adjustedMultiple).toBe(2.40);  // 2.25 + 0.15, within band
  });

  it('clamps adjusted multiple to upper display band edge when bonus would exceed it', () => {
    // derived 2.40 + bonus 0.15 = 2.55 → clamped to 2.50
    const { actual } = computeValuationProjection({
      ...inputs({
        forecast: flat(12, 1_000, 300),
        baseline: flat(12, 1_000, 200),
      }),
      derivedMultiple: 2.40,
      displayMultipleRange: { lower: 2.15, upper: 2.50 },
    });
    expect(actual!.marginQualityAdjustment).toBe(MARGIN_QUALITY_BONUS);
    expect(actual!.adjustedMultiple).toBe(2.50);
  });

  it('clamps adjusted multiple to lower display band edge when penalty would fall below it', () => {
    // 5% margin → -0.10× penalty. derived 2.10 - 0.10 = 2.00, lower edge 2.05 → clamps
    const { actual } = computeValuationProjection({
      ...inputs({
        forecast: flat(12, 1_000, 50),
        baseline: flat(12, 1_000, 200),
      }),
      derivedMultiple: 2.10,
      displayMultipleRange: { lower: 2.05, upper: 2.35 },
    });
    expect(actual!.marginQualityAdjustment).toBe(MARGIN_QUALITY_PENALTY);
    expect(actual!.adjustedMultiple).toBe(2.05);
  });

  it('returns null actual when forecastPoints has < 12 months', () => {
    const { actual } = computeValuationProjection(inputs({
      forecast: flat(11, 1_000, 200),
      baseline: flat(12, 1_000, 200),
    }));
    expect(actual).toBeNull();
  });

  it('returns null actual when baselineForecastPoints has < 12 months', () => {
    // New delta-model requirement: both legs of the delta must exist.
    const { actual } = computeValuationProjection(inputs({
      forecast: flat(12, 1_000, 200),
      baseline: flat(11, 1_000, 200),
    }));
    expect(actual).toBeNull();
  });

  it('returns null actual when currentTtmSde is null (insufficient TTM data)', () => {
    // Card falls back to "Needs input" TTM hero — same surface that
    // already handles ownerOperatorValue === null.
    const { actual } = computeValuationProjection(inputs({
      forecast: flat(12, 1_000, 200),
      baseline: flat(12, 1_000, 200),
      ttmSde: null,
    }));
    expect(actual).toBeNull();
  });

  it('returns null actual when projected revenue is zero (no divide-by-zero)', () => {
    const { actual } = computeValuationProjection(inputs({
      forecast: flat(12, 0, 0),
      baseline: flat(12, 1_000, 200),
    }));
    expect(actual).toBeNull();
  });

  it('marks isFloored when scenarioSde is exactly 0 (sde <= 0)', () => {
    // ttmSde 0 + neutral delta = SDE 0 → floored (needs-input copy).
    const flat12 = flat(12, 5_000, 0);
    const { actual } = computeValuationProjection(inputs({
      forecast: flat12,
      baseline: flat12,
      ttmSde: 0,
    }));
    expect(actual!.sde).toBe(0);
    expect(actual!.isFloored).toBe(true);
  });
});

describe('computeValuationProjection — goal leg', () => {
  const baseline12 = flat(12, 10_000, 0); // $120k annual revenue baseline
  function withGoal(forecast: ProjectionPoint[] | null): ValuationProjectionInputs {
    return {
      forecastPoints: forecast,
      baselineForecastPoints: baseline12,
      // Goal leg doesn't read currentTtmSde, but the field is required
      // by the interface. Set to null — the actual leg becomes null too,
      // which these tests don't assert on.
      currentTtmSde: null,
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

  it('goal leg still applies add-backs to derive SDE (unchanged from pre-delta-model)', () => {
    // Goal net = baselineRevenue × targetMargin = 30,000 (pure projection,
    // no add-backs yet). SDE adds the operator-supplied add-backs on top.
    const { goal } = computeValuationProjection({
      ...withGoal(flat(12, 1_000, 200)),
      addBacks: {
        ownerW2Compensation: 60_000,
        personalExpensesThroughBusiness: 5_000,
        oneTimeExpensesToAddBack: 2_000,
        oneTimeGainsToSubtract: 1_000,
      },
    });
    expect(goal!.annualNet).toBe(30_000);
    expect(goal!.sde).toBe(30_000 + 60_000 + 5_000 + 2_000 - 1_000);
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
