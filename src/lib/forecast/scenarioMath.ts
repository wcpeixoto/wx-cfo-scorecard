import type { ScenarioInput } from '../data/contract';

/**
 * Compounds a Settings-saved baseline pct with a temporary slider delta pct.
 * Both inputs and output are in percent units (e.g. 5 means +5%, -10 means -10%).
 * Result is the effective pct that compute.ts will apply once as × (1 + pct/100).
 */
export function compoundPct(settingsPct: number, sliderPct: number): number {
  return ((1 + settingsPct / 100) * (1 + sliderPct / 100) - 1) * 100;
}

/**
 * Returns an effective ScenarioInput by compounding the raw slider deltas
 * in `input` on top of the Settings-saved fine-tune pcts.
 * All non-pct fields pass through unchanged.
 */
export function applyForecastFineTune(
  input: ScenarioInput,
  settingsRevenueFineTunePct: number,
  settingsExpenseFineTunePct: number,
): ScenarioInput {
  return {
    ...input,
    revenueGrowthPct: compoundPct(settingsRevenueFineTunePct, input.revenueGrowthPct ?? 0),
    expenseChangePct: compoundPct(settingsExpenseFineTunePct, input.expenseChangePct ?? 0),
  };
}
