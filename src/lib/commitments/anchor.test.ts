import { describe, it, expect } from 'vitest';
import { commitmentDeadline } from './anchor';

describe('commitmentDeadline — +7d rolling anchor', () => {
  it('returns exactly 7 days after the given instant', () => {
    const from = new Date('2026-05-22T12:00:00.000Z');
    expect(commitmentDeadline(from)).toBe('2026-05-29T12:00:00.000Z');
  });

  it('is exactly 7×24h later in milliseconds', () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    const out = new Date(commitmentDeadline(from));
    expect(out.getTime() - from.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('defaults to now when no argument is given', () => {
    const before = Date.now();
    const out = new Date(commitmentDeadline()).getTime();
    const after = Date.now();
    const week = 7 * 24 * 60 * 60 * 1000;
    expect(out).toBeGreaterThanOrEqual(before + week);
    expect(out).toBeLessThanOrEqual(after + week);
  });
});
