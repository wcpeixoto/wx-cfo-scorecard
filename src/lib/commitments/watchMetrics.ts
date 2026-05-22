import type { WatchMetricId, WatchMetricSpec } from './types';
import type { SignalType } from '../priorities/types';

// Registry of action-tied watch metrics, keyed by id. captureBaseline and
// computeCurrent both read model.runway.currentCashBalance, so the watch always
// measures the same quantity at commit and at follow-up — the honest "did the
// cash buffer actually grow toward target" result (Phase 2.5 decision a).
//
// It measures buffer movement from ALL causes, not a tagged reserve
// contribution (the app has no such transaction). Copy must therefore say
// "$Y of $X", never "you contributed $Y".
export const WATCH_METRICS: Record<WatchMetricId, WatchMetricSpec> = {
  reserve_cash_delta: {
    id: 'reserve_cash_delta',
    label: 'Cash toward reserve',
    captureBaseline: (model) => model.runway.currentCashBalance,
    computeCurrent: (model) => model.runway.currentCashBalance,
  },
};

// Which watch metric a commitment-ready signal type uses. Derived, not stored,
// so persisting the id needs no column. reserve_warning is the only
// commitment-ready type this slice; every other type is awareness-only and
// maps to no watch metric.
const WATCH_METRIC_BY_SIGNAL: Partial<Record<SignalType, WatchMetricId>> = {
  reserve_warning: 'reserve_cash_delta',
};

export function watchMetricForSignal(type: SignalType): WatchMetricSpec | null {
  const id = WATCH_METRIC_BY_SIGNAL[type];
  return id ? WATCH_METRICS[id] : null;
}
