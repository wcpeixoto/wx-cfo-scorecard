import { describe, it, expect } from 'vitest';
import { commitmentTemplate } from './templater';
import type { CommitmentBeat, CommitmentPhase } from './cadence';
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
    target_value: 500, // owner-entered weekly target
    deadline_date: '2026-05-29T12:00:00.000Z', // noon UTC — date is TZ-stable in UTC + US
    status: 'open',
    committed_at: '2026-05-22T12:00:00.000Z',
    ...overrides,
  };
}

const beat = (phase: CommitmentPhase, daysRemaining = 0): CommitmentBeat => ({ phase, daysRemaining });

describe('commitmentTemplate — beat-aware summary', () => {
  it('day_one states the commitment (single period — PR-A double period fixed)', () => {
    expect(commitmentTemplate(row(), beat('day_one', 6), model(6600)).summary).toBe(
      'Committed: Move $500 into your operating reserve this week. Checking back ~May 29.'
    );
  });

  it('day_one falls back to "soon" when no deadline is set', () => {
    expect(
      commitmentTemplate(row({ deadline_date: undefined }), beat('day_one'), model(6600)).summary
    ).toContain('Checking back ~soon.');
  });

  it('midpoint shows progress + days remaining (no pace judgment)', () => {
    expect(commitmentTemplate(row(), beat('midpoint', 3), model(6800)).summary).toBe(
      'Cash toward reserve: $200 of $500 · 3 days left.'
    );
  });

  it('day_before shows the final-push framing', () => {
    expect(commitmentTemplate(row(), beat('day_before', 1), model(6800)).summary).toBe(
      'Cash toward reserve: $200 of $500 · last day.'
    );
  });

  it('after_deadline states the outcome and hands off to check-in', () => {
    expect(commitmentTemplate(row(), beat('after_deadline'), model(6800)).summary).toBe(
      "Cash toward reserve: $200 of $500 · your week's up."
    );
  });
});

describe('commitmentTemplate — watch progress', () => {
  it('reads progress "$Y of $X" from the commit baseline (positive)', () => {
    const w = commitmentTemplate(row(), beat('midpoint', 3), model(6800)).watch;
    expect(w.label).toBe('Cash toward reserve');
    expect(w.value).toBe('$200 of $500');
  });

  it('reads honestly when cash fell since commit (negative)', () => {
    expect(commitmentTemplate(row(), beat('midpoint', 3), model(6000)).watch.value).toBe(
      '-$600 of $500'
    );
  });
});
