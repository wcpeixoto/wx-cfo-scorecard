import { describe, it, expect } from 'vitest';
import type { Signal } from './types';
import { getFallbackCopy } from './copy';

// The new 4-field AIProse shape: two identity fields injected by the producer
// plus the four prose fields. alternative / followupNote were dropped as dead
// (generated + required + cached but never rendered) — this pins that contract.
const EXPECTED_KEYS = ['action', 'currentState', 'headline', 'severity', 'signalType', 'why'];
const PROSE_FIELDS = ['headline', 'why', 'currentState', 'action'] as const;

// One representative signal per fallback branch. expense_surge and
// revenue_decline branch on severity (critical vs warning), so both variants are
// exercised; every other type produces one shape regardless of severity.
const cases: { name: string; signal: Signal }[] = [
  { name: 'reserve_critical', signal: { type: 'reserve_critical', severity: 'critical', weight: 1, metricValue: 4000, targetValue: 10000, gapAmount: 6000 } },
  { name: 'reserve_warning', signal: { type: 'reserve_warning', severity: 'warning', weight: 1, metricValue: 5500, targetValue: 10000, gapAmount: 4500 } },
  { name: 'cash_flow_negative', signal: { type: 'cash_flow_negative', severity: 'critical', weight: 1, metricValue: -14091, gapAmount: 14091, troughMonth: '2026-06' } },
  { name: 'cash_flow_tight', signal: { type: 'cash_flow_tight', severity: 'warning', weight: 1, metricValue: 7200, gapAmount: 2000, troughMonth: '2026-07' } },
  { name: 'expense_surge (critical)', signal: { type: 'expense_surge', severity: 'critical', weight: 1, metricValue: 6400, targetValue: 3000, gapAmount: 3400, categoryFlagged: 'Marketing' } },
  { name: 'expense_surge (warning)', signal: { type: 'expense_surge', severity: 'warning', weight: 1, metricValue: 3600, targetValue: 3000, gapAmount: 600, categoryFlagged: 'Marketing' } },
  { name: 'revenue_decline (critical)', signal: { type: 'revenue_decline', severity: 'critical', weight: 1, metricValue: 8000, targetValue: 10000 } },
  { name: 'revenue_decline (warning)', signal: { type: 'revenue_decline', severity: 'warning', weight: 1, metricValue: 9000, targetValue: 10000 } },
  { name: 'owner_distributions_high', signal: { type: 'owner_distributions_high', severity: 'warning', weight: 1, metricValue: 60000, targetValue: 50000, gapAmount: 10000 } },
  { name: 'steady_state', signal: { type: 'steady_state', severity: 'healthy', weight: 1 } },
];

describe('getFallbackCopy — new 4-field AIProse shape', () => {
  for (const { name, signal } of cases) {
    describe(name, () => {
      const copy = getFallbackCopy(signal);

      it('returns exactly the 6 contract keys', () => {
        expect(Object.keys(copy).sort()).toEqual(EXPECTED_KEYS);
      });

      it('omits the retired alternative and followupNote fields', () => {
        expect(copy).not.toHaveProperty('alternative');
        expect(copy).not.toHaveProperty('followupNote');
      });

      it('carries identity fields from the signal', () => {
        expect(copy.signalType).toBe(signal.type);
        expect(copy.severity).toBe(signal.severity);
      });

      it('has non-empty prose fields', () => {
        for (const field of PROSE_FIELDS) {
          expect(typeof copy[field]).toBe('string');
          expect(copy[field].trim().length).toBeGreaterThan(0);
        }
      });
    });
  }
});
