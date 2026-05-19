import { describe, it, expect } from 'vitest';
import { formatReserveFooter, type ReserveFooterInput } from './reserveFooterCopy';

const base: ReserveFooterInput = {
  reserveGoalValid: true,
  fundedNow: 0.66,
  overfunded: false,
  hasPrior: true,
  direction: 'up',
  amountToGoalLabel: '$12.4K to goal',
};

describe('formatReserveFooter', () => {
  it('A — improved, below goal', () => {
    expect(formatReserveFooter(base)).toBe('Improved since last month · $12.4K to goal');
  });

  it('B — worse, below goal', () => {
    expect(
      formatReserveFooter({ ...base, fundedNow: 0.46, direction: 'down', amountToGoalLabel: '$21.3K to goal' })
    ).toBe('Worse since last month · $21.3K to goal');
  });

  it('C — no meaningful change, below goal', () => {
    expect(
      formatReserveFooter({ ...base, direction: 'flat', amountToGoalLabel: '$21.3K to goal' })
    ).toBe('No change since last month · $21.3K to goal');
  });

  it('D — improved and exactly at goal', () => {
    expect(
      formatReserveFooter({ ...base, fundedNow: 1.0, direction: 'up', amountToGoalLabel: null })
    ).toBe('Improved since last month · Fully funded');
  });

  it('E — at goal, no meaningful change', () => {
    expect(
      formatReserveFooter({ ...base, fundedNow: 1.0, direction: 'flat', amountToGoalLabel: null })
    ).toBe('At goal · Fully funded');
  });

  it('F — above goal: tiebreaker wins, improved delta does NOT override', () => {
    expect(
      formatReserveFooter({ ...base, fundedNow: 1.25, overfunded: true, direction: 'up', amountToGoalLabel: null })
    ).toBe('Above goal · Fully funded');
  });

  it('F2 — above goal stays stable even when delta is down', () => {
    expect(
      formatReserveFooter({ ...base, fundedNow: 1.25, overfunded: true, direction: 'down', amountToGoalLabel: null })
    ).toBe('Above goal · Fully funded');
  });

  it('G — missing prior: no trend claim, just the gap', () => {
    expect(formatReserveFooter({ ...base, hasPrior: false })).toBe('$12.4K to goal');
  });

  it('G2 — missing prior and fully funded', () => {
    expect(
      formatReserveFooter({ ...base, hasPrior: false, fundedNow: 1.0, amountToGoalLabel: null })
    ).toBe('Fully funded');
  });

  it('H — invalid reserve goal: safe fallback, no divide-by-zero', () => {
    expect(
      formatReserveFooter({ ...base, reserveGoalValid: false, fundedNow: 0, amountToGoalLabel: null })
    ).toBe('Set a reserve goal in Settings');
  });

  it('I — negative cash available: worse + full amount to goal', () => {
    expect(
      formatReserveFooter({ ...base, fundedNow: -0.3, direction: 'down', amountToGoalLabel: '$48.2K to goal' })
    ).toBe('Worse since last month · $48.2K to goal');
  });

  it('I2 — negative cash, no prior: just the gap', () => {
    expect(
      formatReserveFooter({ ...base, hasPrior: false, fundedNow: -0.3, amountToGoalLabel: '$48.2K to goal' })
    ).toBe('$48.2K to goal');
  });

  it('never emits coverage-percentage math', () => {
    const samples = [
      base,
      { ...base, direction: 'down' as const },
      { ...base, direction: 'flat' as const },
      { ...base, hasPrior: false },
      { ...base, fundedNow: 1.25, overfunded: true },
      { ...base, reserveGoalValid: false },
    ];
    for (const s of samples) {
      const out = formatReserveFooter(s);
      expect(out).not.toMatch(/%/);
      expect(out).not.toMatch(/→/);
      expect(out).not.toMatch(/\bpts?\b/);
      expect(out).not.toMatch(/coverage points/i);
      expect(out).not.toMatch(/287/);
    }
  });
});
