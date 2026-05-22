import { describe, it, expect } from 'vitest';
import { commitmentBeat } from './cadence';
import type { PriorityHistoryRow } from '../priorities/types';

const DAY_MS = 86_400_000;
const COMMIT = '2026-05-22T12:00:00.000Z';

// A 7-day window by default; pure ms math, so these assertions are TZ-independent.
function row(deadlineDaysAfterCommit = 7): PriorityHistoryRow {
  return {
    workspace_id: 'default',
    fired_at: COMMIT,
    signal_type: 'reserve_warning',
    severity: 'warning',
    committed_at: COMMIT,
    deadline_date: new Date(Date.parse(COMMIT) + deadlineDaysAfterCommit * DAY_MS).toISOString(),
    status: 'open',
  };
}

// `now`, expressed as days after commit.
function at(daysAfterCommit: number): Date {
  return new Date(Date.parse(COMMIT) + daysAfterCommit * DAY_MS);
}

describe('commitmentBeat — during-window cadence', () => {
  it('day_one in the first 24h after commit', () => {
    expect(commitmentBeat(row(), at(0.5)).phase).toBe('day_one');
  });

  it('midpoint mid-window, with ceil days remaining', () => {
    const b = commitmentBeat(row(), at(3)); // 4 days remain exactly
    expect(b.phase).toBe('midpoint');
    expect(b.daysRemaining).toBe(4);
  });

  it('day_before within the last 24h', () => {
    expect(commitmentBeat(row(), at(6.5)).phase).toBe('day_before');
  });

  it('after_deadline once due', () => {
    expect(commitmentBeat(row(), at(7.5)).phase).toBe('after_deadline');
  });

  it('day_one → midpoint boundary is exclusive at exactly 1 day elapsed', () => {
    expect(commitmentBeat(row(), at(1)).phase).toBe('midpoint');
  });

  it('day_before boundary is inclusive at exactly 1 day remaining', () => {
    expect(commitmentBeat(row(), at(6)).phase).toBe('day_before');
  });

  it('at the deadline instant it is after_deadline (not day_before)', () => {
    expect(commitmentBeat(row(), at(7)).phase).toBe('after_deadline');
  });

  it('missing deadline → day_one (never claims the window is up)', () => {
    const r = row();
    r.deadline_date = undefined;
    expect(commitmentBeat(r, at(3)).phase).toBe('day_one');
  });

  it('missing committed_at still resolves the deadline-based phases', () => {
    const r = row();
    r.committed_at = undefined;
    expect(commitmentBeat(r, at(0.5)).phase).toBe('midpoint');
  });
});
