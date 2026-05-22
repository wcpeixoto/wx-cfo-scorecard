import { describe, it, expect } from 'vitest';
import { commitmentTemplate, executeLabelFor } from './templater';
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
    gap_amount: 3400, // full reserve gap (context / close consequence)
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

  it('after_deadline (unclear) asks how it went', () => {
    expect(commitmentTemplate(row(), beat('after_deadline'), model(6800)).summary).toBe(
      "Cash toward reserve: $200 of $500 · time's up — how did it go?"
    );
  });

  it('after_deadline (target hit) celebrates instead of asking', () => {
    expect(commitmentTemplate(row(), beat('after_deadline'), model(7100)).summary).toBe(
      'Cash toward reserve: $500 of $500 · you hit your target.'
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

describe('commitmentTemplate — check-in (after deadline)', () => {
  it('no check-in during the window', () => {
    expect(commitmentTemplate(row(), beat('day_one', 6), model(6800)).checkIn).toBeNull();
    expect(commitmentTemplate(row(), beat('midpoint', 3), model(6800)).checkIn).toBeNull();
    expect(commitmentTemplate(row(), beat('day_before', 1), model(6800)).checkIn).toBeNull();
  });

  it('achieved when progress reaches target — celebrate, no attribution', () => {
    const c = commitmentTemplate(row(), beat('after_deadline'), model(7100)).checkIn;
    expect(c?.state).toBe('achieved');
    expect(c?.attribution).toBeNull();
  });

  it('partial when there is some progress — asks for honest attribution', () => {
    const c = commitmentTemplate(row(), beat('after_deadline'), model(6800)).checkIn;
    expect(c?.state).toBe('partial');
    expect(c?.attribution?.prompt).toBe('Did your actions drive this?');
    expect(c?.attribution?.options).toEqual(['Yes, mostly', 'Partly', 'No', 'Not sure']);
  });

  it('missed when there is no progress', () => {
    expect(commitmentTemplate(row(), beat('after_deadline'), model(6600)).checkIn?.state).toBe(
      'missed'
    );
    expect(commitmentTemplate(row(), beat('after_deadline'), model(6000)).checkIn?.state).toBe(
      'missed'
    );
  });
});

describe('commitmentTemplate — close consequence (#6)', () => {
  it('states the real business consequence from the reserve gap', () => {
    expect(commitmentTemplate(row(), beat('midpoint', 3), model(6800)).closeConsequence).toBe(
      'Stopping leaves your reserve about $3,400 short of target. Stop anyway?'
    );
  });

  it('falls back when no gap is recorded', () => {
    expect(
      commitmentTemplate(row({ gap_amount: undefined }), beat('midpoint', 3), model(6800))
        .closeConsequence
    ).toBe("Stopping ends this week's reserve push. Stop anyway?");
  });
});

describe('executeLabelFor — beat-aware Execute offer (#8 / B-3)', () => {
  it('day_one opens with "Help me execute"', () => {
    expect(executeLabelFor('day_one')).toBe('Help me execute');
  });

  it('midpoint keeps the same offer (no differentiation — pace nudge deferred)', () => {
    expect(executeLabelFor('midpoint')).toBe('Help me execute');
  });

  it('day_before escalates to the final push', () => {
    expect(executeLabelFor('day_before')).toBe('Final push');
  });

  it('after_deadline offers nothing (Execute slot is hidden post-deadline)', () => {
    expect(executeLabelFor('after_deadline')).toBeNull();
  });
});
