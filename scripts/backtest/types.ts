export type SeriesPoint = {
  month: string; // YYYY-MM
  endingCashBalance: number;
};

export type ForecastSeries = {
  asOfDate: string; // YYYY-MM-DD
  startingCash: number;
  points: SeriesPoint[];
  /** Length of the active seasonal weighting in the engine at this as-of
   *  date. Set by walkForward.forecastAsOf; absent on naive-baseline
   *  series. 0 means the engine used its momentum fallback (no
   *  seasonality). Used by the runner to detect tier mismatches when an
   *  EngineParameterOverrides.yearWeights override is in play. */
  seasonalityWeightingLength?: number;
};

export type TruthSeries = {
  asOfDate: string; // YYYY-MM-DD
  startingCash: number;
  points: SeriesPoint[];
};

export type Anchor = {
  asOfDate: string; // YYYY-MM-DD
  operatingCashBalance: number;
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
