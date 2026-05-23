import { describe, it, expect } from 'vitest';
import { buildCommitmentSummaryCacheKey } from './summaryCache';
import type { PriorityHistoryRow } from '../priorities/types';

function row(overrides: Partial<PriorityHistoryRow> = {}): PriorityHistoryRow {
  return {
    id: 'commit-1',
    workspace_id: 'default',
    fired_at: '2026-05-22T12:00:00.000Z',
    signal_type: 'reserve_warning',
    severity: 'warning',
    committed_action: 'Move $100 into your operating reserve this week.',
    metric_value: 6600,
    target_value: 100,
    gap_amount: 3400,
    deadline_date: '2026-05-29T12:00:00.000Z',
    status: 'open',
    committed_at: '2026-05-22T12:00:00.000Z',
    ...overrides,
  };
}

describe('buildCommitmentSummaryCacheKey — facts hash', () => {
  it('is byte-identical for equivalent inputs', () => {
    expect(buildCommitmentSummaryCacheKey(row())).toBe(buildCommitmentSummaryCacheKey(row()));
  });

  it('treats the same deadline instant in different ISO forms as equal', () => {
    const a = buildCommitmentSummaryCacheKey(row({ deadline_date: '2026-05-29T12:00:00.000Z' }));
    const b = buildCommitmentSummaryCacheKey(row({ deadline_date: '2026-05-29T12:00:00Z' }));
    expect(a).toBe(b);
  });

  it('ignores surrounding whitespace in the committed action', () => {
    const a = buildCommitmentSummaryCacheKey(row({ committed_action: 'Move $100 this week.' }));
    const b = buildCommitmentSummaryCacheKey(row({ committed_action: '  Move $100 this week.  ' }));
    expect(a).toBe(b);
  });

  it('changes when the target value changes', () => {
    expect(buildCommitmentSummaryCacheKey(row({ target_value: 100 }))).not.toBe(
      buildCommitmentSummaryCacheKey(row({ target_value: 200 }))
    );
  });

  it('changes when the deadline changes', () => {
    expect(
      buildCommitmentSummaryCacheKey(row({ deadline_date: '2026-05-29T12:00:00.000Z' }))
    ).not.toBe(buildCommitmentSummaryCacheKey(row({ deadline_date: '2026-06-05T12:00:00.000Z' })));
  });

  it('changes when the committed action changes', () => {
    expect(
      buildCommitmentSummaryCacheKey(row({ committed_action: 'Move $100 this week.' }))
    ).not.toBe(buildCommitmentSummaryCacheKey(row({ committed_action: 'Set aside $100 this week.' })));
  });

  it('distinguishes different commitments by id', () => {
    expect(buildCommitmentSummaryCacheKey(row({ id: 'commit-1' }))).not.toBe(
      buildCommitmentSummaryCacheKey(row({ id: 'commit-2' }))
    );
  });
});
