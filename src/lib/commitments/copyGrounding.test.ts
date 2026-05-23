import { describe, it, expect } from 'vitest';
import { validateGrounding } from './copyGrounding';

describe('validateGrounding — amount grounding (Slice 1)', () => {
  it('passes when the only amount matches the target', () => {
    expect(validateGrounding('Move $100 into your reserve this week.', { target: 100 })).toEqual({
      ok: true,
    });
  });

  it('rejects a wrong amount (the trust-killing $100→$500 contradiction)', () => {
    expect(validateGrounding('Move $500 into your reserve this week.', { target: 100 })).toEqual({
      ok: false,
      reason: 'amount_mismatch',
    });
  });

  it('rejects a competing second amount even when the target is also stated', () => {
    expect(
      validateGrounding('Move $100 now, then aim for $500 next month.', { target: 100 })
    ).toEqual({ ok: false, reason: 'foreign_amount' });
  });

  it('passes generic language with no dollar figure at all', () => {
    expect(
      validateGrounding('Move money into your operating reserve this week.', { target: 100 })
    ).toEqual({ ok: true });
  });

  it('passes a comma-grouped amount that matches', () => {
    expect(validateGrounding('Set aside $1,200 this week.', { target: 1200 })).toEqual({ ok: true });
  });

  it('rejects a rounded "$1K" against an exact $1,200 target (the rounding trap)', () => {
    // The prompt pins the exact amount; "$1K" (= $1,000) is a $200 lie, not a
    // rounding. No tolerance — this must reject.
    expect(validateGrounding('Set aside about $1K this week.', { target: 1200 })).toEqual({
      ok: false,
      reason: 'amount_mismatch',
    });
  });

  it('expands a K/M/B suffix so "$100K" does not falsely pass a $100 target', () => {
    expect(validateGrounding('Move $100K into your reserve.', { target: 100 })).toEqual({
      ok: false,
      reason: 'amount_mismatch',
    });
  });

  it('does not read a following word as a magnitude suffix ("$500 monthly" = 500)', () => {
    expect(validateGrounding('Put $500 monthly toward it.', { target: 500 })).toEqual({ ok: true });
  });

  it('treats cents exactly, no rounding tolerance', () => {
    expect(validateGrounding('Move $100.50 this week.', { target: 100.5 })).toEqual({ ok: true });
    expect(validateGrounding('Move $100 this week.', { target: 100.5 })).toEqual({
      ok: false,
      reason: 'amount_mismatch',
    });
  });

  it('passes when the target is repeated', () => {
    expect(
      validateGrounding('Move $100 this week — yes, $100 into the reserve.', { target: 100 })
    ).toEqual({ ok: true });
  });

  it('ignores percentages (not currency, not a contradiction)', () => {
    expect(
      validateGrounding("You're at 59% funded — move $100 this week.", { target: 100 })
    ).toEqual({ ok: true });
  });
});
