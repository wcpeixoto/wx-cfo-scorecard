import { describe, it, expect } from 'vitest';
import type { MonthlyRollup } from '../data/contract';
import {
  computeTtmOperatingProfit,
  computeSde,
  allAddBacksBlank,
  computeOwnerOperatorValue,
  computeTransferableSde,
  computeTransferableValue,
  computeGap,
  computeBusinessValuation,
  gradeLeaseRunway,
  validateMultipleRange,
  validateReplacementCostRange,
  parseLocalDate,
  monthsBetween,
  buildDriverImpacts,
  deriveMultiple,
  bufferDisplayRange,
  resolveEffectiveReplacementCost,
  BASE_MULTIPLE,
  MULTIPLE_FLOOR,
  MULTIPLE_CEILING,
  DEFAULT_REPLACEMENT_COST,
  type BusinessValuationInputs,
  type DriverGrades,
} from './businessValuation';

// Local-time reference. monthKey() inside the selector uses local-time
// constructors (per AGENTS.md gotcha); tests must do the same.
const REF_DATE = new Date(2026, 4, 27); // 2026-05-27

function rollupsFor(months: string[], netCashPerMonth: number[]): MonthlyRollup[] {
  return months.map((month, i) => ({
    month,
    revenue: 0,
    expenses: 0,
    netCashFlow: netCashPerMonth[i] ?? 0,
    savingsRate: 0,
    transactionCount: 0,
  }));
}

function months(count: number, endExclusiveKey: string): string[] {
  // Returns `count` consecutive month keys ending the month BEFORE endExclusiveKey.
  // e.g., months(12, '2026-05') = ['2025-05', ..., '2026-04'].
  const [yStr, mStr] = endExclusiveKey.split('-');
  const endYear = Number(yStr);
  const endMonth = Number(mStr); // 1-indexed
  const result: string[] = [];
  for (let i = count; i >= 1; i -= 1) {
    const totalIndex = endYear * 12 + endMonth - 1 - i; // months since year 0
    const year = Math.floor(totalIndex / 12);
    const monthIdx = totalIndex % 12;
    result.push(`${year}-${String(monthIdx + 1).padStart(2, '0')}`);
  }
  return result;
}

const DEFAULT_DRIVER_GRADES: DriverGrades = {
  recurringRevenue: 'needs_input',
  financialClarity: 'needs_input',
  churnTracking: 'needs_input',
  coachDepth: 'needs_input',
  ownerIndependence: 'needs_input',
  brandStrength: 'needs_input',
};

// ── TTM operating profit ───────────────────────────────────────────────────

describe('computeTtmOperatingProfit', () => {
  it('returns null when fewer than 12 complete months exist', () => {
    const rollups = rollupsFor(months(11, '2026-05'), Array(11).fill(10_000));
    expect(computeTtmOperatingProfit(rollups, REF_DATE)).toBeNull();
  });

  it('sums (not averages) the last 12 complete months', () => {
    // 12 months of $10K each → $120K TTM. If it averaged, it would return $10K.
    const rollups = rollupsFor(months(12, '2026-05'), Array(12).fill(10_000));
    expect(computeTtmOperatingProfit(rollups, REF_DATE)).toBe(120_000);
  });

  it('excludes the current (incomplete) calendar month', () => {
    // 13 month keys: months(13, '2026-05') gives Apr 2025 … Apr 2026 (12 of these
    // are < '2026-05'). Then add a row keyed at '2026-05' itself (the current
    // month, incomplete) which must be filtered out. Expected: sum of the 13
    // sub-current rows' last 12 keys.
    const subCurrent = months(13, '2026-05'); // Apr 2025 … Apr 2026 (13 keys all < 2026-05)
    const subCurrentValues = subCurrent.map((_, i) => 1_000 + i * 100);
    const rollups: MonthlyRollup[] = [
      ...rollupsFor(subCurrent, subCurrentValues),
      ...rollupsFor(['2026-05'], [999_999]), // current incomplete month; must be excluded
    ];
    const lastTwelve = subCurrentValues.slice(-12);
    const expected = lastTwelve.reduce((s, v) => s + v, 0);
    expect(computeTtmOperatingProfit(rollups, REF_DATE)).toBe(expected);
  });

  it('returns null for an empty rollup array', () => {
    expect(computeTtmOperatingProfit([], REF_DATE)).toBeNull();
  });

  it('handles negative monthly net cash flow without crashing the sum', () => {
    const vals = [5000, -2000, 3000, -1000, 4000, 6000, -500, 2000, 1000, 8000, -300, 100];
    const rollups = rollupsFor(months(12, '2026-05'), vals);
    expect(computeTtmOperatingProfit(rollups, REF_DATE)).toBe(
      vals.reduce((s, v) => s + v, 0)
    );
  });
});

// ── SDE ────────────────────────────────────────────────────────────────────

describe('computeSde', () => {
  it('equals TTM operating profit when all add-backs are blank', () => {
    const sde = computeSde({
      ttmOperatingProfit: 100_000,
      ownerW2Compensation: null,
      personalExpensesThroughBusiness: null,
      oneTimeExpensesToAddBack: null,
      oneTimeGainsToSubtract: null,
    });
    expect(sde).toBe(100_000);
  });

  it('adds W-2 + personal + one-time expenses; subtracts one-time gains', () => {
    // 100 + 60 + 5 + 3 − 8 = 160 (in thousands)
    const sde = computeSde({
      ttmOperatingProfit: 100_000,
      ownerW2Compensation: 60_000,
      personalExpensesThroughBusiness: 5_000,
      oneTimeExpensesToAddBack: 3_000,
      oneTimeGainsToSubtract: 8_000,
    });
    expect(sde).toBe(160_000);
  });

  it('treats blank fields as $0 (e.g., only W-2 filled in)', () => {
    const sde = computeSde({
      ttmOperatingProfit: 100_000,
      ownerW2Compensation: 60_000,
      personalExpensesThroughBusiness: null,
      oneTimeExpensesToAddBack: null,
      oneTimeGainsToSubtract: null,
    });
    expect(sde).toBe(160_000);
  });

  it('returns null when TTM operating profit is null', () => {
    const sde = computeSde({
      ttmOperatingProfit: null,
      ownerW2Compensation: 60_000,
      personalExpensesThroughBusiness: 5_000,
      oneTimeExpensesToAddBack: 0,
      oneTimeGainsToSubtract: 0,
    });
    expect(sde).toBeNull();
  });
});

describe('allAddBacksBlank', () => {
  it('returns true only when all four are null', () => {
    expect(
      allAddBacksBlank({
        ownerW2Compensation: null,
        personalExpensesThroughBusiness: null,
        oneTimeExpensesToAddBack: null,
        oneTimeGainsToSubtract: null,
      })
    ).toBe(true);

    expect(
      allAddBacksBlank({
        ownerW2Compensation: 0,
        personalExpensesThroughBusiness: null,
        oneTimeExpensesToAddBack: null,
        oneTimeGainsToSubtract: null,
      })
    ).toBe(false);

    expect(
      allAddBacksBlank({
        ownerW2Compensation: null,
        personalExpensesThroughBusiness: null,
        oneTimeExpensesToAddBack: null,
        oneTimeGainsToSubtract: 5,
      })
    ).toBe(false);
  });
});

// ── Owner-Operator Value ────────────────────────────────────────────────────

describe('computeOwnerOperatorValue', () => {
  it('scales SDE by both multiple ends', () => {
    const result = computeOwnerOperatorValue(200_000, { lower: 2.0, upper: 2.5 });
    expect(result).toEqual({ lower: 400_000, upper: 500_000 });
  });

  it('returns null when SDE is null', () => {
    expect(computeOwnerOperatorValue(null, { lower: 2.0, upper: 2.5 })).toBeNull();
  });

  it('supports a point-range multiple (single-value entry)', () => {
    const result = computeOwnerOperatorValue(200_000, { lower: 2.0, upper: 2.0 });
    expect(result).toEqual({ lower: 400_000, upper: 400_000 });
  });
});

// ── Transferable SDE / Value ────────────────────────────────────────────────

describe('computeTransferableSde', () => {
  it('subtracts the replacement-cost range with lower=SDE-rcUpper, upper=SDE-rcLower', () => {
    const result = computeTransferableSde(200_000, { lower: 60_000, upper: 80_000 });
    expect(result).toEqual({ lower: 120_000, upper: 140_000 });
  });

  it('floors transferable SDE at $0 when replacement cost exceeds SDE', () => {
    const result = computeTransferableSde(50_000, { lower: 60_000, upper: 80_000 });
    // sde - rcUpper = -30K → floored to 0
    // sde - rcLower = -10K → floored to 0
    expect(result).toEqual({ lower: 0, upper: 0 });
  });

  it('returns null when replacement cost is null (Needs input)', () => {
    expect(computeTransferableSde(200_000, null)).toBeNull();
  });

  it('returns null when SDE is null', () => {
    expect(computeTransferableSde(null, { lower: 60_000, upper: 80_000 })).toBeNull();
  });
});

describe('computeTransferableValue', () => {
  it('scales transferable-SDE range by matching multiple ends', () => {
    const tvSde = { lower: 120_000, upper: 140_000 };
    const result = computeTransferableValue(tvSde, { lower: 2.0, upper: 2.5 });
    expect(result).toEqual({ lower: 240_000, upper: 350_000 });
  });

  it('returns null when transferable SDE is null', () => {
    expect(computeTransferableValue(null, { lower: 2.0, upper: 2.5 })).toBeNull();
  });
});

// ── Gap ─────────────────────────────────────────────────────────────────────

describe('computeGap', () => {
  it('returns midpoint(OOV) − midpoint(TV)', () => {
    const oov = { lower: 400_000, upper: 500_000 }; // midpoint 450K
    const tv = { lower: 240_000, upper: 350_000 }; // midpoint 295K
    expect(computeGap(oov, tv)).toBe(155_000);
  });

  it('returns null when OOV is null', () => {
    expect(computeGap(null, { lower: 100, upper: 200 })).toBeNull();
  });

  it('returns null when TV is null', () => {
    expect(computeGap({ lower: 100, upper: 200 }, null)).toBeNull();
  });
});

// ── Missing-replacement-cost end-to-end behavior ────────────────────────────

describe('computeBusinessValuation — missing Replacement Cost', () => {
  it('renders Owner-Operator Value; TV and Gap stay null (Owner Independence = Needs input)', () => {
    // All drivers Needs input → derived = 2.25 → display range 2.00–2.50.
    // Owner Independence = needs_input → effective replacement cost = null,
    // so transferable value and gap stay null.
    const inputs: BusinessValuationInputs = {
      ttmOperatingProfit: 100_000,
      ownerW2Compensation: 60_000,
      personalExpensesThroughBusiness: 5_000,
      oneTimeExpensesToAddBack: 3_000,
      oneTimeGainsToSubtract: 8_000,
      replacementCost: null,
      driverGrades: DEFAULT_DRIVER_GRADES,
      lease: { startDate: null, endDate: null, renewalOption: null, renewalYears: null },
    };
    const result = computeBusinessValuation(inputs, REF_DATE);
    expect(result.ttmSde).toBe(160_000);
    expect(result.derivedMultiple).toBeCloseTo(BASE_MULTIPLE);
    expect(result.displayMultipleRange).toEqual({ lower: 2.0, upper: 2.5 });
    expect(result.ownerOperatorValue).toEqual({ lower: 320_000, upper: 400_000 });
    expect(result.transferableValue).toBeNull();
    expect(result.gap).toBeNull();
    expect(result.effectiveReplacementCost).toBeNull();
    expect(result.replacementCostDefaultApplied).toBe(false);
  });
});

// ── Lease runway grading ────────────────────────────────────────────────────

describe('gradeLeaseRunway', () => {
  it('returns "not_tracked" when end date is missing', () => {
    expect(
      gradeLeaseRunway(REF_DATE, {
        startDate: null,
        endDate: null,
        renewalOption: null,
        renewalYears: null,
      })
    ).toBe('not_tracked');
  });

  it('returns "strong" for 60+ months base secured', () => {
    expect(
      gradeLeaseRunway(REF_DATE, {
        startDate: null,
        endDate: '2031-05-27', // exactly 60 months from REF_DATE
        renewalOption: null,
        renewalYears: null,
      })
    ).toBe('strong');
  });

  it('returns "strong" when base + renewal years ≥ 60', () => {
    // 36 base + 24 renewal months = 60 → Strong
    expect(
      gradeLeaseRunway(REF_DATE, {
        startDate: null,
        endDate: '2029-05-27', // 36 months from REF_DATE
        renewalOption: true,
        renewalYears: 2, // +24 months
      })
    ).toBe('strong');
  });

  it('returns "mixed" for 24–59 months secured', () => {
    expect(
      gradeLeaseRunway(REF_DATE, {
        startDate: null,
        endDate: '2028-05-27', // 24 months
        renewalOption: null,
        renewalYears: null,
      })
    ).toBe('mixed');
  });

  it('returns "weak" for under 24 months secured', () => {
    expect(
      gradeLeaseRunway(REF_DATE, {
        startDate: null,
        endDate: '2027-05-27', // 12 months
        renewalOption: null,
        renewalYears: null,
      })
    ).toBe('weak');
  });

  it('returns "weak" when end date is past and no renewal', () => {
    expect(
      gradeLeaseRunway(REF_DATE, {
        startDate: null,
        endDate: '2025-05-27', // 12 months in the past
        renewalOption: false,
        renewalYears: null,
      })
    ).toBe('weak');
  });

  it('renewalOption true but renewalYears null/0 does NOT extend runway', () => {
    expect(
      gradeLeaseRunway(REF_DATE, {
        startDate: null,
        endDate: '2027-05-27', // 12 months
        renewalOption: true,
        renewalYears: 0,
      })
    ).toBe('weak');
  });
});

describe('parseLocalDate / monthsBetween (date construction is local-time)', () => {
  it('parseLocalDate returns null for invalid strings', () => {
    expect(parseLocalDate(null)).toBeNull();
    expect(parseLocalDate('')).toBeNull();
    expect(parseLocalDate('2026/05/27')).toBeNull();
    expect(parseLocalDate('2026-13-01')).toBeNull();
  });

  it('parseLocalDate constructs a local-time Date (year/month/day correct in local TZ)', () => {
    const d = parseLocalDate('2026-05-27');
    expect(d).not.toBeNull();
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(4);
    expect(d?.getDate()).toBe(27);
  });

  it('monthsBetween counts full months only (floors partial)', () => {
    const a = new Date(2026, 4, 27);
    const b = new Date(2026, 6, 26); // one day shy of 2 full months
    expect(monthsBetween(a, b)).toBe(1);
    const c = new Date(2026, 6, 27);
    expect(monthsBetween(a, c)).toBe(2);
  });
});

// ── Validators ──────────────────────────────────────────────────────────────

describe('validateMultipleRange', () => {
  it('accepts a valid range', () => {
    const result = validateMultipleRange(2.0, 2.5);
    expect(result).toEqual({ ok: true, range: { lower: 2.0, upper: 2.5 } });
  });

  it('accepts a single value as a point range', () => {
    const result = validateMultipleRange(2.0, null);
    expect(result).toEqual({ ok: true, range: { lower: 2.0, upper: 2.0 } });
  });

  it('rejects empty input', () => {
    expect(validateMultipleRange(null, null)).toEqual({ ok: false, reason: 'empty' });
  });

  it('rejects negative values', () => {
    expect(validateMultipleRange(-1, 2)).toEqual({ ok: false, reason: 'negative' });
    expect(validateMultipleRange(2, -1)).toEqual({ ok: false, reason: 'negative' });
  });

  it('rejects min > max', () => {
    expect(validateMultipleRange(3, 2)).toEqual({ ok: false, reason: 'min_gt_max' });
  });
});

describe('validateReplacementCostRange', () => {
  it('accepts a valid range', () => {
    const result = validateReplacementCostRange(60_000, 80_000);
    expect(result).toEqual({ ok: true, range: { lower: 60_000, upper: 80_000 } });
  });

  it('accepts a single value as a point range (e.g., 75K → 75K–75K)', () => {
    const result = validateReplacementCostRange(75_000, null);
    expect(result).toEqual({ ok: true, range: { lower: 75_000, upper: 75_000 } });
  });

  it('reports empty input — caller treats as "revert to Needs input"', () => {
    expect(validateReplacementCostRange(null, null)).toEqual({
      ok: false,
      reason: 'empty',
    });
  });

  it('rejects negative values and min > max', () => {
    expect(validateReplacementCostRange(-1, 100)).toEqual({
      ok: false,
      reason: 'negative',
    });
    expect(validateReplacementCostRange(200, 100)).toEqual({
      ok: false,
      reason: 'min_gt_max',
    });
  });
});

// ── Derived multiple model (PR-A) ───────────────────────────────────────────

const ALL_STRONG_DRIVERS: DriverGrades = {
  recurringRevenue: 'strong',
  financialClarity: 'strong',
  churnTracking: 'strong',
  coachDepth: 'strong',
  ownerIndependence: 'strong',
  brandStrength: 'strong',
};

const ALL_WEAK_DRIVERS: DriverGrades = {
  recurringRevenue: 'weak',
  financialClarity: 'weak',
  churnTracking: 'weak',
  coachDepth: 'weak',
  ownerIndependence: 'weak',
  brandStrength: 'weak',
};

const ALL_MIXED_DRIVERS: DriverGrades = {
  recurringRevenue: 'mixed',
  financialClarity: 'mixed',
  churnTracking: 'mixed',
  coachDepth: 'mixed',
  ownerIndependence: 'mixed',
  brandStrength: 'mixed',
};

describe('buildDriverImpacts', () => {
  it('returns 7 entries in canonical render order', () => {
    const impacts = buildDriverImpacts(DEFAULT_DRIVER_GRADES, 'not_tracked');
    expect(impacts).toHaveLength(7);
    expect(impacts.map((i) => i.key)).toEqual([
      'recurringRevenue',
      'leaseRunway',
      'coachDepth',
      'ownerIndependence',
      'financialClarity',
      'churnTracking',
      'brandStrength',
    ]);
  });

  it('marks leaseRunway as isAuto and other drivers as not auto', () => {
    const impacts = buildDriverImpacts(ALL_STRONG_DRIVERS, 'strong');
    const autoEntries = impacts.filter((i) => i.isAuto);
    expect(autoEntries.map((i) => i.key)).toEqual(['leaseRunway']);
  });

  it('contributes 0 for needs_input and not_tracked', () => {
    const impacts = buildDriverImpacts(DEFAULT_DRIVER_GRADES, 'not_tracked');
    for (const impact of impacts) {
      expect(impact.contribution).toBe(0);
    }
  });

  it('contributes 0 for mixed (math-equivalent to needs_input)', () => {
    const impacts = buildDriverImpacts(ALL_MIXED_DRIVERS, 'mixed');
    for (const impact of impacts) {
      expect(impact.contribution).toBe(0);
    }
  });

  it('preserves the lease not_tracked grade on the impact entry (renderer dispatches on key)', () => {
    const impacts = buildDriverImpacts(DEFAULT_DRIVER_GRADES, 'not_tracked');
    const lease = impacts.find((i) => i.key === 'leaseRunway');
    expect(lease?.grade).toBe('not_tracked');
    expect(lease?.contribution).toBe(0);
  });
});

describe('deriveMultiple', () => {
  it('returns BASE_MULTIPLE (2.25) when all drivers contribute 0', () => {
    const impacts = buildDriverImpacts(DEFAULT_DRIVER_GRADES, 'not_tracked');
    expect(deriveMultiple(impacts)).toBeCloseTo(BASE_MULTIPLE);
  });

  it('returns BASE_MULTIPLE when all drivers are Mixed', () => {
    const impacts = buildDriverImpacts(ALL_MIXED_DRIVERS, 'mixed');
    expect(deriveMultiple(impacts)).toBeCloseTo(BASE_MULTIPLE);
  });

  it('caps at MULTIPLE_CEILING (3.0) when all drivers are Strong', () => {
    // raw sum = 4 × 0.15 + 2 × 0.05 + 1 × 0.10 = 0.80 → 2.25 + 0.80 = 3.05 → clip to 3.00
    const impacts = buildDriverImpacts(ALL_STRONG_DRIVERS, 'strong');
    expect(deriveMultiple(impacts)).toBe(MULTIPLE_CEILING);
  });

  it('caps at MULTIPLE_FLOOR (1.5) when all drivers are Weak', () => {
    // raw sum = 4 × (−0.20) + 2 × (−0.10) + 1 × (−0.15) = −1.15 → 2.25 − 1.15 = 1.10 → clip to 1.50
    const impacts = buildDriverImpacts(ALL_WEAK_DRIVERS, 'weak');
    expect(deriveMultiple(impacts)).toBe(MULTIPLE_FLOOR);
  });

  it('combines mixed grades correctly (representative real-world case)', () => {
    // Recurring strong (+0.15) + Lease strong (+0.15) + Coach mixed (0) +
    // Owner needs_input (0) + Financial strong (+0.05) + Churn strong (+0.10)
    // + Brand mixed (0) = +0.45 → 2.25 + 0.45 = 2.70 (in cap range)
    const impacts = buildDriverImpacts(
      {
        recurringRevenue: 'strong',
        financialClarity: 'strong',
        churnTracking: 'strong',
        coachDepth: 'mixed',
        ownerIndependence: 'needs_input',
        brandStrength: 'mixed',
      },
      'strong'
    );
    expect(deriveMultiple(impacts)).toBeCloseTo(2.70);
  });
});

describe('bufferDisplayRange', () => {
  // Phase 2 dropped the display clip. Math and display share the same
  // derived ± DISPLAY_BUFFER range so midpoint(display) = derived and the
  // hero number reconciles with the displayed multiple on screen
  // (SDE × midpoint(display) = hero). The industry-range guarantee on
  // derivedMultiple itself still lives in deriveMultiple's
  // [MULTIPLE_FLOOR, MULTIPLE_CEILING] clamp — only the displayed buffer
  // is unclipped.
  it('returns derived ± 0.25 (interior case unchanged)', () => {
    expect(bufferDisplayRange(2.55)).toEqual({ lower: 2.30, upper: 2.80 });
  });

  it('extends past the ceiling when derived + 0.25 > MULTIPLE_CEILING (no clip)', () => {
    const result = bufferDisplayRange(2.90);
    expect(result.lower).toBeCloseTo(2.65);
    expect(result.upper).toBeCloseTo(3.15);
  });

  it('extends below the floor when derived − 0.25 < MULTIPLE_FLOOR (no clip)', () => {
    const result = bufferDisplayRange(1.60);
    expect(result.lower).toBeCloseTo(1.35);
    expect(result.upper).toBeCloseTo(1.85);
  });

  it('at MULTIPLE_CEILING (3.00) → symmetric buffer 2.75–3.25', () => {
    const result = bufferDisplayRange(MULTIPLE_CEILING);
    expect(result.lower).toBeCloseTo(2.75);
    expect(result.upper).toBeCloseTo(3.25);
  });

  it('at MULTIPLE_FLOOR (1.50) → symmetric buffer 1.25–1.75', () => {
    const result = bufferDisplayRange(MULTIPLE_FLOOR);
    expect(result.lower).toBeCloseTo(1.25);
    expect(result.upper).toBeCloseTo(1.75);
  });

  it('midpoint of display always equals derived (midpoint-preservation, on-screen reconciliation)', () => {
    for (const derived of [1.50, 1.85, 2.25, 2.90, 3.00]) {
      const { lower, upper } = bufferDisplayRange(derived);
      expect((lower + upper) / 2).toBeCloseTo(derived);
    }
  });
});

// ── Owner Independence → effective replacement cost (PR-A) ─────────────────

describe('resolveEffectiveReplacementCost', () => {
  it('Strong → effective = $0 regardless of persisted value, defaultApplied = false', () => {
    const stronge = resolveEffectiveReplacementCost(null, 'strong');
    expect(stronge.effective).toEqual({ lower: 0, upper: 0 });
    expect(stronge.defaultApplied).toBe(false);

    // Persisted nonzero value should be IGNORED while Strong is active
    // (the persisted value is preserved on the result for switch-back).
    const strongWithPersisted = resolveEffectiveReplacementCost(
      { lower: 50_000, upper: 50_000 },
      'strong'
    );
    expect(strongWithPersisted.effective).toEqual({ lower: 0, upper: 0 });
    expect(strongWithPersisted.defaultApplied).toBe(false);
  });

  it('Mixed + null → effective = $60K default, defaultApplied = true', () => {
    const r = resolveEffectiveReplacementCost(null, 'mixed');
    expect(r.effective).toEqual({
      lower: DEFAULT_REPLACEMENT_COST,
      upper: DEFAULT_REPLACEMENT_COST,
    });
    expect(r.defaultApplied).toBe(true);
  });

  it('Weak + null → effective = $60K default, defaultApplied = true', () => {
    const r = resolveEffectiveReplacementCost(null, 'weak');
    expect(r.effective).toEqual({
      lower: DEFAULT_REPLACEMENT_COST,
      upper: DEFAULT_REPLACEMENT_COST,
    });
    expect(r.defaultApplied).toBe(true);
  });

  it('Mixed + zero range → effective = $60K default, defaultApplied = true', () => {
    const r = resolveEffectiveReplacementCost(
      { lower: 0, upper: 0 },
      'mixed'
    );
    expect(r.effective).toEqual({
      lower: DEFAULT_REPLACEMENT_COST,
      upper: DEFAULT_REPLACEMENT_COST,
    });
    expect(r.defaultApplied).toBe(true);
  });

  it('Mixed + nonzero persisted → effective = persisted, defaultApplied = false', () => {
    const persisted = { lower: 30_000, upper: 30_000 };
    const r = resolveEffectiveReplacementCost(persisted, 'mixed');
    expect(r.effective).toEqual(persisted);
    expect(r.defaultApplied).toBe(false);
  });

  it('Needs input → effective = null, defaultApplied = false', () => {
    const r = resolveEffectiveReplacementCost(
      { lower: 50_000, upper: 50_000 },
      'needs_input'
    );
    expect(r.effective).toBeNull();
    expect(r.defaultApplied).toBe(false);
  });
});

// ── Composer end-to-end with PR-A semantics ────────────────────────────────

describe('computeBusinessValuation — PR-A derived multiple end-to-end', () => {
  const baseInputs = (
    driverGrades: DriverGrades,
    replacementCost: BusinessValuationInputs['replacementCost'],
    lease: BusinessValuationInputs['lease']
  ): BusinessValuationInputs => ({
    ttmOperatingProfit: 100_000,
    ownerW2Compensation: 60_000,
    personalExpensesThroughBusiness: null,
    oneTimeExpensesToAddBack: null,
    oneTimeGainsToSubtract: null,
    replacementCost,
    driverGrades,
    lease,
  });

  it('all-Strong + Strong lease + null replacement cost → derived clamped to 3.00, transferable = OOV (Strong OI forces effective $0)', () => {
    const inputs = baseInputs(
      ALL_STRONG_DRIVERS,
      null,
      { startDate: null, endDate: '2031-05-27', renewalOption: null, renewalYears: null }
    );
    const result = computeBusinessValuation(inputs, REF_DATE);
    expect(result.ttmSde).toBe(160_000);
    expect(result.derivedMultiple).toBe(MULTIPLE_CEILING);
    // Phase 2: display range is UNCLIPPED. At derived=3.00, display extends
    // to 2.75–3.25 (past the ceiling) as honest uncertainty around the
    // midpoint. The MULTIPLE_CEILING clamp lives upstream in deriveMultiple
    // (on the derived value itself), not on the display buffer.
    expect(result.displayMultipleRange.lower).toBeCloseTo(2.75);
    expect(result.displayMultipleRange.upper).toBeCloseTo(3.25);
    // OI = strong → effective cost = $0 → transferable = OOV → gap = 0
    expect(result.effectiveReplacementCost).toEqual({ lower: 0, upper: 0 });
    expect(result.transferableValue).toEqual(result.ownerOperatorValue);
    expect(result.gap).toBe(0);
  });

  it('all-Weak + Weak lease + null replacement cost → derived clamped to 1.50, $60K default applied, midpoint-preservation holds', () => {
    const inputs = baseInputs(
      ALL_WEAK_DRIVERS,
      null,
      { startDate: null, endDate: '2027-05-27', renewalOption: null, renewalYears: null }
    );
    const result = computeBusinessValuation(inputs, REF_DATE);
    expect(result.derivedMultiple).toBe(MULTIPLE_FLOOR);
    expect(result.effectiveReplacementCost).toEqual({
      lower: DEFAULT_REPLACEMENT_COST,
      upper: DEFAULT_REPLACEMENT_COST,
    });
    expect(result.replacementCostDefaultApplied).toBe(true);
    // Phase 2: display range = derived ± 0.25, unclipped. At derived=1.50,
    // display = 1.25–1.75 (extends below the floor). Math and display use
    // the SAME range now, so midpoint(display) = derived = 1.50.
    expect(result.displayMultipleRange).toEqual({ lower: 1.25, upper: 1.75 });
    // SDE = 160K. OOV = 160K × {1.25, 1.75} = {200K, 280K} → midpoint 240K
    // = SDE × derived (160K × 1.50). Midpoint-preservation invariant.
    expect(result.ownerOperatorValue).toEqual({ lower: 200_000, upper: 280_000 });
    // Transferable SDE = 160K − 60K = 100K (point). TV = 100K × {1.25, 1.75}
    // = {125K, 175K} → midpoint 150K.
    expect(result.transferableValue).toEqual({ lower: 125_000, upper: 175_000 });
    // Gap = midpoint(OOV) − midpoint(TV) = 240K − 150K = 90K
    //     = derived × effectiveCost.midpoint = 1.50 × 60K = 90K.
    expect(result.gap).toBeCloseTo(90_000);
  });

  it('Gap math anchors on derived (midpoint-preservation invariant) at the floor edge', () => {
    // Midpoint-preservation: Gap = derived × cost.midpoint when cost is a
    // point range. Phase 2 made this true on screen as well (midpoint of
    // displayed multiple = derived), not just internally. With derived = 1.50
    // and cost = $50K, Gap = 1.50 × $50K = $75K.
    const inputs = baseInputs(
      ALL_WEAK_DRIVERS,
      { lower: 50_000, upper: 50_000 },
      { startDate: null, endDate: null, renewalOption: null, renewalYears: null }
    );
    const result = computeBusinessValuation(inputs, REF_DATE);
    expect(result.derivedMultiple).toBe(MULTIPLE_FLOOR); // clamped to 1.50
    expect(result.effectiveReplacementCost).toEqual({ lower: 50_000, upper: 50_000 });
    expect(result.gap).toBeCloseTo(75_000);
  });

  it('Needs input Owner Independence + persisted $50K → effective stays null; persisted preserved (card layer hides display)', () => {
    // The selector's contract: OI=needs_input always yields effective null,
    // regardless of persisted value. The persisted value rides through on
    // result.replacementCost so the card layer can preserve the value for
    // switch-back without surfacing it as the cost the math is using. (The
    // card display logic suppresses the persisted value to "Needs input"
    // when OI = needs_input.)
    const persisted = { lower: 50_000, upper: 50_000 };
    const inputs = baseInputs(
      DEFAULT_DRIVER_GRADES, // all needs_input
      persisted,
      { startDate: null, endDate: null, renewalOption: null, renewalYears: null }
    );
    const result = computeBusinessValuation(inputs, REF_DATE);
    expect(result.replacementCost).toEqual(persisted);
    expect(result.effectiveReplacementCost).toBeNull();
    expect(result.replacementCostDefaultApplied).toBe(false);
    expect(result.transferableValue).toBeNull();
    expect(result.gap).toBeNull();
  });

  it('Mixed Owner Independence + persisted $30K → math uses $30K, no default', () => {
    const grades: DriverGrades = {
      ...DEFAULT_DRIVER_GRADES,
      ownerIndependence: 'mixed',
    };
    const inputs = baseInputs(
      grades,
      { lower: 30_000, upper: 30_000 },
      { startDate: null, endDate: null, renewalOption: null, renewalYears: null }
    );
    const result = computeBusinessValuation(inputs, REF_DATE);
    expect(result.effectiveReplacementCost).toEqual({ lower: 30_000, upper: 30_000 });
    expect(result.replacementCostDefaultApplied).toBe(false);
    expect(result.transferableValue).not.toBeNull();
  });

  it('Strong Owner Independence + persisted $50K → effective $0, persisted preserved on result', () => {
    const grades: DriverGrades = {
      ...DEFAULT_DRIVER_GRADES,
      ownerIndependence: 'strong',
    };
    const persisted = { lower: 50_000, upper: 50_000 };
    const inputs = baseInputs(grades, persisted, {
      startDate: null, endDate: null, renewalOption: null, renewalYears: null,
    });
    const result = computeBusinessValuation(inputs, REF_DATE);
    // Persisted value preserved untouched on the result so the renderer
    // can switch back without re-entering it.
    expect(result.replacementCost).toEqual(persisted);
    expect(result.effectiveReplacementCost).toEqual({ lower: 0, upper: 0 });
    expect(result.transferableValue).toEqual(result.ownerOperatorValue);
    expect(result.gap).toBe(0);
  });

  it('returns 7 driver impacts on the result in canonical order', () => {
    const inputs = baseInputs(
      DEFAULT_DRIVER_GRADES,
      null,
      { startDate: null, endDate: null, renewalOption: null, renewalYears: null }
    );
    const result = computeBusinessValuation(inputs, REF_DATE);
    expect(result.driverImpacts).toHaveLength(7);
    expect(result.driverImpacts.map((i) => i.key)).toEqual([
      'recurringRevenue',
      'leaseRunway',
      'coachDepth',
      'ownerIndependence',
      'financialClarity',
      'churnTracking',
      'brandStrength',
    ]);
  });
});
