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
  it('renders Owner-Operator Value; TV and Gap stay null', () => {
    const inputs: BusinessValuationInputs = {
      ttmOperatingProfit: 100_000,
      ownerW2Compensation: 60_000,
      personalExpensesThroughBusiness: 5_000,
      oneTimeExpensesToAddBack: 3_000,
      oneTimeGainsToSubtract: 8_000,
      multipleRange: { lower: 2.0, upper: 2.5 },
      replacementCost: null,
      driverGrades: DEFAULT_DRIVER_GRADES,
      lease: { startDate: null, endDate: null, renewalOption: null, renewalYears: null },
    };
    const result = computeBusinessValuation(inputs, REF_DATE);
    expect(result.ttmSde).toBe(160_000);
    expect(result.ownerOperatorValue).toEqual({ lower: 320_000, upper: 400_000 });
    expect(result.transferableValue).toBeNull();
    expect(result.gap).toBeNull();
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
