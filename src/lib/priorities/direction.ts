import type { Signal, SignalType, PriorityHistoryRow } from './types';

/**
 * Raw direction returned by computeMetricDirection. Reflects the result
 * of comparing a signal's current metric against its prior occurrence.
 *
 * Note: copy.ts has a private metricWorsened helper for fallback prose
 * tone selection. Its boolean contract is intentionally narrower than
 * MetricDirection; unifying them is out of scope here.
 */
export type MetricDirection = 'worsened' | 'improved' | 'unchanged' | 'unknown';

/**
 * Cache-key bucket for the prior-history dimension. Splits "no prior on
 * record" (p_none) from "prior exists but direction can't be computed"
 * (p_unknown) — that distinction matters for cache determinism because
 * the prompt path treats those two states differently.
 */
export type PriorDirectionBucket =
  | 'p_none'
  | 'p_improved'
  | 'p_worsened'
  | 'p_unchanged'
  | 'p_unknown';

// Signals where a higher metric is worse (expense overruns, draws above plan).
const WORSE_WHEN_HIGHER: ReadonlySet<SignalType> = new Set<SignalType>([
  'expense_surge',
  'owner_distributions_high',
]);

// Signals where a lower metric is worse (reserve shortfalls, cash dips, revenue drops).
const WORSE_WHEN_LOWER: ReadonlySet<SignalType> = new Set<SignalType>([
  'reserve_critical',
  'reserve_warning',
  'cash_flow_negative',
  'cash_flow_tight',
  'revenue_decline',
]);

/**
 * Compare a signal's current metric to its prior-occurrence metric and
 * classify the change as improved, worsened, unchanged, or unknown.
 *
 * Special cases:
 *   - steady_state always returns 'unchanged' regardless of priorHistory
 *   - missing priorHistory or missing metric values return 'unknown'
 *   - business normalization is encoded in WORSE_WHEN_HIGHER /
 *     WORSE_WHEN_LOWER per signal type
 */
export function computeMetricDirection(
  signal: Signal,
  priorHistory?: PriorityHistoryRow,
): MetricDirection {
  if (signal.type === 'steady_state') return 'unchanged';
  if (!priorHistory) return 'unknown';
  if (
    signal.metricValue === undefined ||
    priorHistory.metric_value === undefined
  ) {
    return 'unknown';
  }

  const now = signal.metricValue;
  const prior = priorHistory.metric_value;

  if (now === prior) return 'unchanged';

  if (WORSE_WHEN_HIGHER.has(signal.type)) {
    return now > prior ? 'worsened' : 'improved';
  }
  if (WORSE_WHEN_LOWER.has(signal.type)) {
    return now < prior ? 'worsened' : 'improved';
  }
  return 'unknown';
}

/**
 * Cache-key-facing classifier. Owns nullish handling for priorHistory so
 * callers don't need to coerce. Runs the null check before any
 * signal-type-specific logic, so e.g. steady_state with no prior history
 * lands in p_none rather than p_unchanged.
 */
export function classifyPriorDirection(
  signal: Signal,
  priorHistory?: PriorityHistoryRow | null,
): PriorDirectionBucket {
  if (priorHistory == null) return 'p_none';
  const dir = computeMetricDirection(signal, priorHistory);
  switch (dir) {
    case 'improved':
      return 'p_improved';
    case 'worsened':
      return 'p_worsened';
    case 'unchanged':
      return 'p_unchanged';
    case 'unknown':
      return 'p_unknown';
  }
}
