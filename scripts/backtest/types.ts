// Shared forecast types and the starting-cash anchor helper now live in
// src/lib/kpis/forecastShared so production code can depend on them without
// reaching into scripts/. We re-export the harness-facing names here so
// existing imports (`from './types'`) keep working unchanged.
export type { SeriesPoint, ForecastSeries, Anchor } from '../../src/lib/kpis/forecastShared';
import type { SeriesPoint } from '../../src/lib/kpis/forecastShared';

export type TruthSeries = {
  asOfDate: string; // YYYY-MM-DD
  startingCash: number;
  points: SeriesPoint[];
};

export type AnchorsFile = {
  anchors: Anchor[];
};

export type BacktestMetrics = {
  asOfDate: string;
  directionalAccuracy: number; // 0..1, share of months where forecast and truth agree on sign of monthly net change
  lowestBalanceError: number; // forecast trough minus actual trough, $
  mape30: number; // mean absolute % error at month 1
  mape60: number; // mean absolute % error at month 2
  mape90: number; // mean absolute % error at month 3
  endpointError: number; // forecast month 12 minus actual month 12, $
  safetyLineHit: boolean; // true when forecast breach matches actual breach over horizon
  worstSingleMonthMiss: number; // max absolute $ error across the 12-month horizon
};

export type AsOfRun = {
  asOfDate: string;
  forecast: ForecastSeries;
  truth: TruthSeries;
  metrics: BacktestMetrics;
  naiveYoY: ForecastSeries;
  naiveYoYMetrics: BacktestMetrics;
  t12mAvg: ForecastSeries;
  t12mAvgMetrics: BacktestMetrics;
};

export type BaselineComparison = {
  wins: number; // engine's worstSingleMonthMiss strictly smaller than baseline's
  losses: number; // engine strictly larger
  tied: number;
};

export type AggregateMetrics = {
  directionalAccuracy: number;
  mape30: number;
  mape60: number;
  mape90: number;
  safetyLineHitRate: number;
  worstSingleMonthMiss: number; // average across runs
  engineVsNaiveYoY: BaselineComparison;
  engineVsT12M: BaselineComparison;
  /** Per-as-of wins/losses on worstSingleMonthMiss vs the category-cadence
   *  comparator. Optional so baseline.json's existing schema is unchanged
   *  (baselineFile.ts does not serialize this field). */
  engineVsCategoryCadence?: BaselineComparison;
};

export type BaselineFile = {
  writtenAt: string; // ISO timestamp
  fixturePath: string;
  fixtureRowCount: number;
  anchorsLoaded: number;
  asOfDateCount: number;
  harnessVersion: string;
  aggregate: AggregateMetrics;
};

export type RegressionBreach = {
  metric: string;
  baseline: number;
  current: number;
  threshold: number; // numeric threshold (delta or ratio)
  delta: number; // current - baseline (signed)
  description: string; // human-readable rule
};

export type RegressionCheckResult = {
  breaches: RegressionBreach[];
  passed: boolean;
};

export type RunnerAsOfRun = {
  asOfDate: string;
  engineForecast: ForecastSeries;
  naiveYoYForecast: ForecastSeries;
  t12mAverageForecast: ForecastSeries;
  categoryCadenceForecast: ForecastSeries;
  truth: TruthSeries;
  engineMetrics: BacktestMetrics;
  naiveYoYMetrics: BacktestMetrics;
  t12mMetrics: BacktestMetrics;
  categoryCadenceMetrics: BacktestMetrics;
};

export type EngineOverrideTierMismatch = {
  parameter: string; // override field name (e.g. 'yearWeights')
  asOfDate: string;
};

export type RunnerResult = {
  perAsOf: RunnerAsOfRun[];
  aggregate: AggregateMetrics;
  engineOverrideTierMismatches: EngineOverrideTierMismatch[];
};
