import { describe, it, expect } from 'vitest';
import { commitmentTemplate } from './templater';
import type { PriorityHistoryRow } from '../priorities/types';
import type { DashboardModel } from '../data/contract';

function model(cash: number): DashboardModel {
  return { runway: { currentCashBalance: cash } } as unknown as DashboardModel;
}

function row(overrides: Partial<PriorityHistoryRow> = {}): PriorityHistoryRow {
  return {
    workspace_id: 'default',
    fired_at: '2026-05-22T12:00:00.000Z',
    signal_type: 'reserve_warning',
    severity: 'warning',
    committed_action: 'Move $500 into your operating reserve this week.',
    metric_value: 6600, // baseline cash at commit
    target_value: 3400, // owner-entered weekly target
    deadline_date: '2026-05-29T12:00:00.000Z', // noon UTC — date is TZ-stable in UTC + US
    status: 'open',
    committed_at: '2026-05-22T12:00:00.000Z',
    ...overrides,
  };
}

describe('commitmentTemplate — committed-state copy', () => {
  it('summary carries the committed action verbatim', () => {
    // Faithful relocation of the pre-2c card line. The double period after
    // "week." is a pre-existing copy nit (committed_action already ends with a
    // period); it is fixed in PR-B when the summary becomes beat-aware.
    expect(commitmentTemplate(row(), model(6600)).summary).toBe(
      'Committed: Move $500 into your operating reserve this week.. Checking back ~May 29.'
    );
  });

  it('summary falls back to "soon" when no deadline is set', () => {
    expect(commitmentTemplate(row({ deadline_date: undefined }), model(6600)).summary).toContain(
      'Checking back ~soon.'
    );
  });

  it('watch reads progress "$Y of $X" from the commit baseline (positive)', () => {
    const w = commitmentTemplate(row(), model(7100)).watch;
    expect(w.label).toBe('Cash toward reserve');
    expect(w.value).toBe('$500 of $3,400');
  });

  it('watch reads honestly when cash fell since commit (negative)', () => {
    expect(commitmentTemplate(row(), model(6000)).watch.value).toBe('-$600 of $3,400');
  });
});
