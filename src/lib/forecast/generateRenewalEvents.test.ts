import { describe, it, expect } from 'vitest';
import type { RenewalContract } from '../data/contract';
import { generateRenewalEvents } from './generateRenewalEvents';

// Minimal contract builder. Defaults give a valid, simple contract;
// individual tests override only the fields they care about.
function makeContract(overrides: Partial<RenewalContract> = {}): RenewalContract {
  return {
    id: 'c1',
    name: 'Test Contract',
    status: 'active',
    renewalDate: '2026-06-15',
    renewalCadence: 'monthly',
    cashInAmount: 1000,
    cashOutAmount: 0,
    enabled: true,
    ...overrides,
  };
}

// All test "today" values are constructed at UTC midnight so the date
// math is straightforward to reason about. Equivalent UTC-instant
// constructions are exercised in the UTC-stability tests.
const utcMidnight = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

describe('generateRenewalEvents — gating', () => {
  it('returns [] when contract is disabled', () => {
    const c = makeContract({ enabled: false });
    expect(generateRenewalEvents(c, 12, utcMidnight('2026-01-01'))).toEqual([]);
  });

  it("returns [] when contract status is 'paused'", () => {
    const c = makeContract({ status: 'paused' });
    expect(generateRenewalEvents(c, 12, utcMidnight('2026-01-01'))).toEqual([]);
  });

  it("returns [] when contract status is 'ended'", () => {
    const c = makeContract({ status: 'ended' });
    expect(generateRenewalEvents(c, 12, utcMidnight('2026-01-01'))).toEqual([]);
  });

  it('returns [] when horizonMonths is negative', () => {
    const c = makeContract();
    expect(generateRenewalEvents(c, -1, utcMidnight('2026-01-01'))).toEqual([]);
    expect(generateRenewalEvents(c, -100, utcMidnight('2026-01-01'))).toEqual([]);
  });
});

describe('generateRenewalEvents — horizon bounds', () => {
  it('horizonMonths = 0 includes occurrences in same month from today onward', () => {
    const c = makeContract({ renewalDate: '2026-01-20', renewalCadence: 'monthly' });
    const out = generateRenewalEvents(c, 0, utcMidnight('2026-01-15'));
    expect(out.map((e) => e.date)).toEqual(['2026-01-20']);
  });

  it('horizonMonths = 0 returns [] when no in-month occurrence falls on/after today', () => {
    const c = makeContract({ renewalDate: '2026-01-10', renewalCadence: 'monthly' });
    const out = generateRenewalEvents(c, 0, utcMidnight('2026-01-15'));
    expect(out).toEqual([]);
  });

  it('today itself is included when occurrence equals today', () => {
    const c = makeContract({ renewalDate: '2026-01-15', renewalCadence: 'monthly' });
    const out = generateRenewalEvents(c, 0, utcMidnight('2026-01-15'));
    expect(out.map((e) => e.date)).toEqual(['2026-01-15']);
  });

  it('horizon boundary: today=2026-01-15, h=12 includes 2027-01-31 but excludes 2027-02-01', () => {
    const cBoundary = makeContract({ renewalDate: '2027-01-31', renewalCadence: 'monthly' });
    const onBoundary = generateRenewalEvents(cBoundary, 12, utcMidnight('2026-01-15'));
    expect(onBoundary.map((e) => e.date)).toContain('2027-01-31');

    const cPastBoundary = makeContract({ renewalDate: '2027-02-01', renewalCadence: 'monthly' });
    const pastBoundary = generateRenewalEvents(cPastBoundary, 12, utcMidnight('2026-01-15'));
    expect(pastBoundary).toEqual([]);
  });
});

describe('generateRenewalEvents — cadence math', () => {
  it('monthly cadence with renewalDate on today produces 13 events over 12-month horizon', () => {
    // today = 2026-01-15, horizon 12 → window [2026-01-15, 2027-01-31].
    // Monthly events at days that match the renewal day fall on Jan 2026
    // through Jan 2027 inclusive — 13 occurrences.
    const c = makeContract({ renewalDate: '2026-01-15', renewalCadence: 'monthly' });
    const out = generateRenewalEvents(c, 12, utcMidnight('2026-01-15'));
    expect(out.length).toBe(13);
    expect(out[0].date).toBe('2026-01-15');
    expect(out[out.length - 1].date).toBe('2027-01-15');
  });

  it('monthly cadence with renewalDate after today still includes Jan 2027', () => {
    // today = 2026-01-15, renewalDate 2026-01-20 → first occurrence Jan 20.
    // Last in-window occurrence is 2027-01-20 (within [2026-01-15, 2027-01-31]).
    const c = makeContract({ renewalDate: '2026-01-20', renewalCadence: 'monthly' });
    const out = generateRenewalEvents(c, 12, utcMidnight('2026-01-15'));
    expect(out.length).toBe(13);
  });

  it('annual cadence with renewalDate mid-first-year produces 3 events over 36-month horizon', () => {
    // today = 2026-01-01, horizon 36 → window [2026-01-01, 2029-01-31].
    // 2026-06-15, 2027-06-15, 2028-06-15 in window; 2029-06-15 outside.
    const c = makeContract({ renewalDate: '2026-06-15', renewalCadence: 'annual' });
    const out = generateRenewalEvents(c, 36, utcMidnight('2026-01-01'));
    expect(out.map((e) => e.date)).toEqual(['2026-06-15', '2027-06-15', '2028-06-15']);
  });

  it('annual cadence with renewalDate in the past walks forward and skips past occurrences', () => {
    // renewalDate 2020-03-01, today 2026-01-01, h=12 → window [2026-01-01, 2027-01-31].
    // The generator iterates 2020-03 → 2021-03 → ... → 2026-03 (in window)
    // → 2027-03 (out of window, break). Only 2026-03-01 should appear.
    const c = makeContract({ renewalDate: '2020-03-01', renewalCadence: 'annual' });
    const out = generateRenewalEvents(c, 12, utcMidnight('2026-01-01'));
    expect(out.map((e) => e.date)).toEqual(['2026-03-01']);
  });

  it('renewalDate strictly in the future before horizon end is included', () => {
    // today = 2026-01-01, renewalDate 2026-06-15 monthly, h=12.
    // First occurrence Jun 2026; last in window Jan 2027.
    const c = makeContract({ renewalDate: '2026-06-15', renewalCadence: 'monthly' });
    const out = generateRenewalEvents(c, 12, utcMidnight('2026-01-01'));
    // Jun, Jul, Aug, Sep, Oct, Nov, Dec 2026, Jan 2027 = 8 events
    expect(out.length).toBe(8);
    expect(out[0].date).toBe('2026-06-15');
    expect(out[out.length - 1].date).toBe('2027-01-15');
  });

  it('renewalDate past horizon end produces []', () => {
    const c = makeContract({ renewalDate: '2050-01-01', renewalCadence: 'monthly' });
    const out = generateRenewalEvents(c, 12, utcMidnight('2026-01-01'));
    expect(out).toEqual([]);
  });
});

describe('generateRenewalEvents — day-of-month clamping', () => {
  it('Jan 31 monthly: Feb clamps to 28 in non-leap year, Mar restores to 31', () => {
    const c = makeContract({ renewalDate: '2026-01-31', renewalCadence: 'monthly' });
    const out = generateRenewalEvents(c, 2, utcMidnight('2026-01-01'));
    expect(out.map((e) => e.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });

  it('Jan 31 monthly: Feb clamps to 29 in a leap year', () => {
    const c = makeContract({ renewalDate: '2024-01-31', renewalCadence: 'monthly' });
    const out = generateRenewalEvents(c, 2, utcMidnight('2024-01-01'));
    expect(out.map((e) => e.date)).toEqual(['2024-01-31', '2024-02-29', '2024-03-31']);
  });

  it('Apr 30 monthly: May 30, Jun 30 (no clamp; 30 fits in both)', () => {
    const c = makeContract({ renewalDate: '2026-04-30', renewalCadence: 'monthly' });
    const out = generateRenewalEvents(c, 2, utcMidnight('2026-04-01'));
    expect(out.map((e) => e.date)).toEqual(['2026-04-30', '2026-05-30', '2026-06-30']);
  });

  it('Feb 29 annual: leap → non-leap years clamp to 28, next leap restores 29', () => {
    const c = makeContract({ renewalDate: '2024-02-29', renewalCadence: 'annual' });
    // today = 2024-02-01, horizon 60 → window end = end of 2029-02 = 2029-02-28.
    // 2029-02-28 IS in the window (date == horizon end is included).
    const out = generateRenewalEvents(c, 60, utcMidnight('2024-02-01'));
    expect(out.map((e) => e.date)).toEqual([
      '2024-02-29', // leap
      '2025-02-28',
      '2026-02-28',
      '2027-02-28',
      '2028-02-29', // leap restores
      '2029-02-28', // non-leap, clamped again; equals horizon end, included
    ]);
  });

  it('clamping uses the original day, not the previous month\'s clamped day', () => {
    // Jan 31 → Feb 28. If the next iteration carried 28 forward, March
    // would be 28. Spec says March must be 31.
    const c = makeContract({ renewalDate: '2026-01-31', renewalCadence: 'monthly' });
    const out = generateRenewalEvents(c, 4, utcMidnight('2026-01-01'));
    const marDate = out.find((e) => e.date!.startsWith('2026-03'))?.date;
    expect(marDate).toBe('2026-03-31');
  });

  it('century rule: 2100 is NOT a leap year (century without 400-divisibility)', () => {
    // Use a Feb 29 starter to actually exercise the leap rule. 2096 IS
    // leap (div by 4, not by 100), 2100 is NOT leap (century without
    // 400 rule), 2104 IS leap again.
    const c = makeContract({ renewalDate: '2096-02-29', renewalCadence: 'annual' });
    const out = generateRenewalEvents(c, 100, utcMidnight('2096-01-01'));
    expect(out.map((e) => e.date)).toEqual([
      '2096-02-29', // leap (div by 4, not by 100)
      '2097-02-28',
      '2098-02-28',
      '2099-02-28',
      '2100-02-28', // NOT leap (century without 400)
      '2101-02-28',
      '2102-02-28',
      '2103-02-28',
      '2104-02-29', // leap (div by 4, not by 100) — confirms rule still works post-2100
    ]);
  });

  it('century rule: 2000 IS a leap year (century divisible by 400)', () => {
    // Feb 29 starter on the year-2000 boundary. 2000 IS leap (div by 400),
    // 2001/2002/2003 are not, 2004 IS.
    const c = makeContract({ renewalDate: '2000-02-29', renewalCadence: 'annual' });
    const out = generateRenewalEvents(c, 60, utcMidnight('2000-01-01'));
    expect(out.map((e) => e.date)).toEqual([
      '2000-02-29', // leap (400-rule)
      '2001-02-28',
      '2002-02-28',
      '2003-02-28',
      '2004-02-29', // leap
    ]);
  });
});

describe('generateRenewalEvents — output shape', () => {
  it('every field on each event matches the spec', () => {
    const c = makeContract({
      id: 'contract-xyz',
      name: 'Big Renewal',
      renewalDate: '2026-01-15',
      renewalCadence: 'monthly',
      cashInAmount: 1500,
      cashOutAmount: 50,
    });
    const out = generateRenewalEvents(c, 0, utcMidnight('2026-01-15'));
    expect(out.length).toBe(1);
    const ev = out[0];
    expect(ev.id).toBe('renewal__contract-xyz__2026-01-15');
    expect(ev.month).toBe('2026-01');
    expect(ev.date).toBe('2026-01-15');
    expect(ev.type).toBe('renewal');
    expect(ev.title).toBe('Big Renewal');
    expect(ev.status).toBe('planned');
    expect(ev.impactMode).toBe('fixed_amount');
    expect(ev.cashInImpact).toBe(1500);
    expect(ev.cashOutImpact).toBe(50);
    expect(ev.enabled).toBe(true);
    expect(ev.source).toBe('renewal');
    expect(ev.contractId).toBe('contract-xyz');
    expect(ev.generatedDate).toBe('2026-01-15');
    expect(ev.generatedCashIn).toBe(1500);
    expect(ev.generatedCashOut).toBe(50);
    expect(ev.isOverride).toBe(false);
  });

  it('generatedDate equals date for every event', () => {
    const c = makeContract({ renewalDate: '2026-01-15', renewalCadence: 'monthly' });
    const out = generateRenewalEvents(c, 12, utcMidnight('2026-01-01'));
    for (const ev of out) expect(ev.generatedDate).toBe(ev.date);
  });

  it('generatedCashIn/Out equal cashInImpact/cashOutImpact for every event', () => {
    const c = makeContract({ cashInAmount: 200, cashOutAmount: 75 });
    const out = generateRenewalEvents(c, 12, utcMidnight('2026-01-01'));
    expect(out.length).toBeGreaterThan(0);
    for (const ev of out) {
      expect(ev.generatedCashIn).toBe(ev.cashInImpact);
      expect(ev.generatedCashOut).toBe(ev.cashOutImpact);
    }
  });

  it('zero cash amounts still produce events (overlay layer handles skipping)', () => {
    const c = makeContract({ cashInAmount: 0, cashOutAmount: 0 });
    const out = generateRenewalEvents(c, 12, utcMidnight('2026-01-01'));
    expect(out.length).toBeGreaterThan(0);
    for (const ev of out) {
      expect(ev.cashInImpact).toBe(0);
      expect(ev.cashOutImpact).toBe(0);
    }
  });

  it('month field is derived from date as YYYY-MM', () => {
    const c = makeContract({ renewalDate: '2026-04-30', renewalCadence: 'monthly' });
    const out = generateRenewalEvents(c, 3, utcMidnight('2026-04-01'));
    for (const ev of out) {
      expect(ev.month).toBe(ev.date!.slice(0, 7));
    }
  });

  it('output is sorted ascending by date', () => {
    const c = makeContract({ renewalDate: '2026-01-15', renewalCadence: 'monthly' });
    const out = generateRenewalEvents(c, 12, utcMidnight('2026-01-01'));
    for (let i = 1; i < out.length; i++) {
      expect(out[i].date! >= out[i - 1].date!).toBe(true);
    }
  });
});

describe('generateRenewalEvents — determinism and immutability', () => {
  it('same inputs produce deeply equal output (called twice)', () => {
    const c = makeContract();
    const t = utcMidnight('2026-01-15');
    const out1 = generateRenewalEvents(c, 12, t);
    const out2 = generateRenewalEvents(c, 12, t);
    expect(out1).toEqual(out2);
  });

  it('does not mutate the input contract', () => {
    const c = makeContract({ renewalDate: '2026-01-31', renewalCadence: 'monthly' });
    const snapshot = JSON.parse(JSON.stringify(c));
    generateRenewalEvents(c, 12, utcMidnight('2026-01-15'));
    expect(c).toEqual(snapshot);
  });

  it('UTC stability: different times within the same UTC date produce identical output', () => {
    const c = makeContract({ renewalDate: '2026-01-15', renewalCadence: 'monthly' });
    const t1 = new Date('2026-01-15T00:00:00Z');
    const t2 = new Date('2026-01-15T23:59:59.999Z');
    const out1 = generateRenewalEvents(c, 12, t1);
    const out2 = generateRenewalEvents(c, 12, t2);
    expect(out1).toEqual(out2);
  });

  it('UTC stability: equivalent UTC instants in different timezone offsets produce identical output', () => {
    const c = makeContract({ renewalDate: '2026-01-15', renewalCadence: 'monthly' });
    // Same UTC instant, expressed two ways: literal Z, and +08:00 offset.
    // Both resolve to 2026-01-15T10:00:00Z.
    const t1 = new Date('2026-01-15T10:00:00Z');
    const t2 = new Date('2026-01-15T18:00:00+08:00');
    expect(t1.getTime()).toBe(t2.getTime()); // sanity
    const out1 = generateRenewalEvents(c, 12, t1);
    const out2 = generateRenewalEvents(c, 12, t2);
    expect(out1).toEqual(out2);
  });
});

describe('generateRenewalEvents — malformed input', () => {
  it("returns [] for renewalDate 'not-a-date'", () => {
    const c = makeContract({ renewalDate: 'not-a-date' });
    expect(generateRenewalEvents(c, 12, utcMidnight('2026-01-01'))).toEqual([]);
  });

  it("returns [] for renewalDate '2026-13-01' (month out of range)", () => {
    const c = makeContract({ renewalDate: '2026-13-01' });
    expect(generateRenewalEvents(c, 12, utcMidnight('2026-01-01'))).toEqual([]);
  });

  it("returns [] for renewalDate '2025-02-30' (impossible day)", () => {
    const c = makeContract({ renewalDate: '2025-02-30' });
    expect(generateRenewalEvents(c, 12, utcMidnight('2026-01-01'))).toEqual([]);
  });

  it('returns [] for empty renewalDate', () => {
    const c = makeContract({ renewalDate: '' });
    expect(generateRenewalEvents(c, 12, utcMidnight('2026-01-01'))).toEqual([]);
  });

  it('returns [] for renewalDate without zero-padding (defensive)', () => {
    // The strict YYYY-MM-DD format is the contract; relaxing it here would
    // open the door to ambiguity. Confirm the parser rejects loose forms.
    const c = makeContract({ renewalDate: '2026-1-5' });
    expect(generateRenewalEvents(c, 12, utcMidnight('2026-01-01'))).toEqual([]);
  });

  it('returns [] for unknown cadence string (defensive type-cast)', () => {
    const c = makeContract({
      renewalCadence: 'weekly' as RenewalContract['renewalCadence'],
    });
    expect(generateRenewalEvents(c, 12, utcMidnight('2026-01-01'))).toEqual([]);
  });

  it('returns [] for unknown status string (defensive type-cast)', () => {
    const c = makeContract({
      status: 'archived' as RenewalContract['status'],
    });
    expect(generateRenewalEvents(c, 12, utcMidnight('2026-01-01'))).toEqual([]);
  });
});
