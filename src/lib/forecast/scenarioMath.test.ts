import { describe, expect, it } from 'vitest';
import { applyForecastFineTune, compoundPct } from './scenarioMath';
import type { ScenarioInput } from '../data/contract';

const baseInput: ScenarioInput = {
  scenarioKey: 'base',
  revenueGrowthPct: 0,
  expenseChangePct: 0,
  receivableDays: 3,
  payableDays: 3,
  months: 12,
};

describe('compoundPct', () => {
  it('returns the slider pct when settings is zero', () => {
    expect(compoundPct(0, 10)).toBeCloseTo(10);
    expect(compoundPct(0, -25)).toBeCloseTo(-25);
  });

  it('returns the settings pct when slider is zero', () => {
    expect(compoundPct(5, 0)).toBeCloseTo(5);
    expect(compoundPct(-3, 0)).toBeCloseTo(-3);
  });

  it('compounds multiplicatively (Case C: 5% × 10% → 15.5%)', () => {
    expect(compoundPct(5, 10)).toBeCloseTo(15.5);
  });

  it('compounds multiplicatively with negative components (Case C expense: -3% × +5% → 1.85%)', () => {
    expect(compoundPct(-3, 5)).toBeCloseTo(1.85);
  });

  it('returns 0 when both inputs are 0 (Case A)', () => {
    expect(compoundPct(0, 0)).toBe(0);
  });
});

describe('applyForecastFineTune', () => {
  it('passes non-pct fields through unchanged', () => {
    const result = applyForecastFineTune(baseInput, 5, -3);
    expect(result.scenarioKey).toBe('base');
    expect(result.receivableDays).toBe(3);
    expect(result.payableDays).toBe(3);
    expect(result.months).toBe(12);
  });

  it('compounds revenueGrowthPct with settingsRevenueFineTunePct', () => {
    const result = applyForecastFineTune({ ...baseInput, revenueGrowthPct: 10 }, 5, 0);
    expect(result.revenueGrowthPct).toBeCloseTo(15.5);
  });

  it('compounds expenseChangePct with settingsExpenseFineTunePct', () => {
    const result = applyForecastFineTune({ ...baseInput, expenseChangePct: 5 }, 0, -3);
    expect(result.expenseChangePct).toBeCloseTo(1.85);
  });

  it('Case A — Settings 0/0, slider 0/0 → effective 0/0', () => {
    const result = applyForecastFineTune(baseInput, 0, 0);
    expect(result.revenueGrowthPct).toBe(0);
    expect(result.expenseChangePct).toBe(0);
  });

  it('Case B — Settings +5/-3, slider 0/0 → effective 5/-3', () => {
    const result = applyForecastFineTune(baseInput, 5, -3);
    expect(result.revenueGrowthPct).toBeCloseTo(5);
    expect(result.expenseChangePct).toBeCloseTo(-3);
  });

  it('Case C — Settings +5/-3, slider +10/+5 → effective 15.5/1.85', () => {
    const input = { ...baseInput, revenueGrowthPct: 10, expenseChangePct: 5 };
    const result = applyForecastFineTune(input, 5, -3);
    expect(result.revenueGrowthPct).toBeCloseTo(15.5);
    expect(result.expenseChangePct).toBeCloseTo(1.85);
  });

  it('Case D — Settings 0/0, slider -25/+25 → effective -25/+25', () => {
    const input = { ...baseInput, revenueGrowthPct: -25, expenseChangePct: 25 };
    const result = applyForecastFineTune(input, 0, 0);
    expect(result.revenueGrowthPct).toBeCloseTo(-25);
    expect(result.expenseChangePct).toBeCloseTo(25);
  });

  it('treats undefined revenueGrowthPct as 0', () => {
    const input = { ...baseInput, revenueGrowthPct: undefined as unknown as number };
    const result = applyForecastFineTune(input, 5, 0);
    expect(result.revenueGrowthPct).toBeCloseTo(5);
  });
});
