import type { AggregateMetrics, BaselineFile, RegressionBreach, RegressionCheckResult } from './types';

// ─── Locked thresholds (Phase 2) ────────────────────────────────────────────
// All four metrics fail loudly when they degrade beyond these bounds. Tune
// these values here — they are the only place thresholds live.
export const THRESHOLDS = {
  /** Fail if directional accuracy drops by more than 5 percentage points. */
  directionalAccuracyDropPct: 0.05,
  /** Fail if 90-day MAPE grows by more than 3 percentage points. */
  mape90GrowthPct: 0.03,
  /** Fail if worst single-month miss grows by more than 25%. */
  worstSingleMonthMissGrowthRatio: 0.25,
  /** Fail if safety-line hit rate drops by more than 5 percentage points. */
  safetyLineHitRateDropPct: 0.05,
} as const;
// ────────────────────────────────────────────────────────────────────────────

export function checkRegressions(
  current: AggregateMetrics,
  baseline: BaselineFile
): RegressionCheckResult {
  const b = baseline.aggregate;
  const breaches: RegressionBreach[] = [];

  // Directional accuracy: drop by more than threshold pct points.
  {
    const delta = current.directionalAccuracy - b.directionalAccuracy;
    if (delta < -THRESHOLDS.directionalAccuracyDropPct) {
      breaches.push({
        metric: 'directionalAccuracy',
        baseline: b.directionalAccuracy,
        current: current.directionalAccuracy,
        threshold: THRESHOLDS.directionalAccuracyDropPct,
        delta,
        description: `drops more than ${(THRESHOLDS.directionalAccuracyDropPct * 100).toFixed(0)}pp`,
      });
    }
  }

  // 90-day MAPE: grow by more than threshold pct points.
  {
    const delta = current.mape90 - b.mape90;
    if (delta > THRESHOLDS.mape90GrowthPct) {
      breaches.push({
        metric: 'mape90',
        baseline: b.mape90,
        current: current.mape90,
        threshold: THRESHOLDS.mape90GrowthPct,
        delta,
        description: `grows more than ${(THRESHOLDS.mape90GrowthPct * 100).toFixed(0)}pp`,
      });
    }
  }

  // Worst single-month miss: grow by more than threshold ratio.
  {
    const baseVal = b.worstSingleMonthMiss;
    const delta = current.worstSingleMonthMiss - baseVal;
    const limit = baseVal * (1 + THRESHOLDS.worstSingleMonthMissGrowthRatio);
    if (current.worstSingleMonthMiss > limit) {
      breaches.push({
        metric: 'worstSingleMonthMiss',
        baseline: baseVal,
        current: current.worstSingleMonthMiss,
        threshold: THRESHOLDS.worstSingleMonthMissGrowthRatio,
        delta,
        description: `grows more than ${(THRESHOLDS.worstSingleMonthMissGrowthRatio * 100).toFixed(0)}%`,
      });
    }
  }

  // Safety-line hit rate: drop by more than threshold pct points.
  {
    const delta = current.safetyLineHitRate - b.safetyLineHitRate;
    if (delta < -THRESHOLDS.safetyLineHitRateDropPct) {
      breaches.push({
        metric: 'safetyLineHitRate',
        baseline: b.safetyLineHitRate,
        current: current.safetyLineHitRate,
        threshold: THRESHOLDS.safetyLineHitRateDropPct,
        delta,
        description: `drops more than ${(THRESHOLDS.safetyLineHitRateDropPct * 100).toFixed(0)}pp`,
      });
    }
  }

  return { breaches, passed: breaches.length === 0 };
}
