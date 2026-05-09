import type { Signal } from './types';

/**
 * Prompt version. Bumping this string invalidates all cached prose for
 * the new version. Single grep target — search for AI_PROSE_PROMPT_VERSION
 * to find every place that participates in cache invalidation.
 */
export const AI_PROSE_PROMPT_VERSION = 'v1';

// ASCII Unit Separator (0x1F). Chosen as the cache-key field separator
// because it is a non-printable control character that does not appear
// in any user-supplied component value (categoryFlagged, troughMonth)
// reaching this helper from the import pipeline.
const SEP = '';

const DOLLAR_BAND = 1000;
const RESERVE_RATIO_PCT_BAND = 5;

function floorDollars(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.floor(Math.abs(value) / DOLLAR_BAND) * DOLLAR_BAND;
}

// Compute ratio first, then floor to a 5-percent band. Returns an
// integer percent (e.g. 55 for the 55–59.999% band). Integer-percent
// math sidesteps floating-point traps that bite when flooring fractions
// like 0.6 directly.
function floorReserveRatioPct(metric: number, target: number): number {
  if (!Number.isFinite(metric) || !Number.isFinite(target) || target === 0) {
    return 0;
  }
  const pct = (metric / target) * 100;
  return Math.floor(pct / RESERVE_RATIO_PCT_BAND) * RESERVE_RATIO_PCT_BAND;
}

/**
 * Pure, deterministic cache-key builder for AI prose lookups.
 *
 * Same signal in → byte-identical key out. Suitable for use as the
 * `cache_key` value in the `unique (workspace_id, cache_key, prompt_version)`
 * constraint on `priority_prose_cache`.
 *
 * Composition follows G3/G4 of the cache read path spec:
 * `<type><SEP><severity><SEP><metric_components...>`
 *
 * No I/O. No imports from persistence, network, or storage layers.
 */
export function buildPriorityProseCacheKey(signal: Signal): string {
  const parts: (string | number)[] = [signal.type, signal.severity];

  switch (signal.type) {
    case 'reserve_critical':
    case 'reserve_warning': {
      const m = signal.metricValue ?? 0;
      const t = signal.targetValue ?? 0;
      parts.push(`r${floorReserveRatioPct(m, t)}`);
      break;
    }
    case 'cash_flow_negative':
    case 'cash_flow_tight': {
      parts.push(`m${floorDollars(signal.metricValue ?? 0)}`);
      parts.push(`t${signal.troughMonth ?? ''}`);
      break;
    }
    case 'expense_surge': {
      parts.push(`m${floorDollars(signal.metricValue ?? 0)}`);
      parts.push(`c${signal.categoryFlagged ?? ''}`);
      break;
    }
    case 'revenue_decline': {
      parts.push(`m${floorDollars(signal.metricValue ?? 0)}`);
      break;
    }
    case 'owner_distributions_high': {
      parts.push(`g${floorDollars(signal.gapAmount ?? 0)}`);
      break;
    }
    case 'steady_state':
      // No metric component. Severity alone differentiates.
      break;
    default: {
      // Exhaustiveness guard. If a new SignalType lands without a case,
      // TypeScript will fail compilation here.
      const _exhaust: never = signal.type;
      return _exhaust;
    }
  }

  return parts.map(String).join(SEP);
}
