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

describe('validateGrounding — date grounding (Slice 1b)', () => {
  // `deadline` is the canonical formatDeadline display the caller passes in.
  const facts = { target: 100, deadline: 'May 29' };

  it('passes relative timing with no calendar date', () => {
    expect(
      validateGrounding('Move $100 this week — checking back in about a week.', facts)
    ).toEqual({ ok: true });
  });

  it('passes a correct date that matches the deadline (truth, not voice)', () => {
    // The prompt prefers relative timing, but a correct date is not a lie — the
    // deterministic fallback itself says "May 29" — so the validator must pass it.
    expect(validateGrounding('Move $100 this week. Checking back May 29.', facts)).toEqual({
      ok: true,
    });
  });

  it('passes a correct date in long-month and ordinal forms', () => {
    expect(validateGrounding('Move $100. I will check in on May 29th.', facts)).toEqual({
      ok: true,
    });
    expect(
      validateGrounding('Move $100. Back on June 5.', { target: 100, deadline: 'Jun 5' })
    ).toEqual({ ok: true });
  });

  it('rejects a wrong date even when the amount is correct (the gap Slice 1b closes)', () => {
    expect(validateGrounding('Move $100 this week. Checking back May 30.', facts)).toEqual({
      ok: false,
      reason: 'date_mismatch',
    });
  });

  it('rejects when only one of several stated dates matches (every token must match)', () => {
    // "by Jun 5, before June 12": Jun 5 matches the deadline, June 12 does not.
    expect(
      validateGrounding('Move $100 by Jun 5, before June 12.', { target: 100, deadline: 'Jun 5' })
    ).toEqual({ ok: false, reason: 'date_mismatch' });
    // ...and passes only when every stated date matches (locks both .every directions).
    expect(
      validateGrounding('Move $100 by Jun 5 — confirmed for June 5.', {
        target: 100,
        deadline: 'Jun 5',
      })
    ).toEqual({ ok: true });
  });

  it('rejects any stated calendar date when the deadline is unknown ("soon")', () => {
    expect(
      validateGrounding('Move $100. Checking back May 29.', { target: 100, deadline: 'soon' })
    ).toEqual({ ok: false, reason: 'date_mismatch' });
  });

  it('does not read a non-month word followed by a number as a date', () => {
    expect(validateGrounding('Set aside $100 over the next 7 days.', facts)).toEqual({ ok: true });
  });

  it('checks amount before date (a wrong amount reports amount_mismatch)', () => {
    expect(validateGrounding('Move $500 by May 30.', facts)).toEqual({
      ok: false,
      reason: 'amount_mismatch',
    });
  });

  it('does not enforce the date axis when no deadline fact is supplied', () => {
    // Amount-only callers opt out of date checking by omitting `deadline`.
    expect(validateGrounding('Move $100 by May 30.', { target: 100 })).toEqual({ ok: true });
  });
});
