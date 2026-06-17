// Dues display-gate contract (SC $-at-risk slice PR-3, RETENTION_FINISH_PLAN.md §6.4).
//
// Pins the honesty rules that make the live dues dollar safe to show: it renders
// ONLY when the locally-written aggregate still matches what the card displays —
// threshold exact-match on the RESOLVED value, within roughly one billing cycle of
// the snapshot (in EITHER direction), with real coverage. Everything else hides
// the dollar with an explicit reason; a hidden state never fabricates $0 and a
// real $0 floor with coverage is shown honestly (dues KNOWN at zero ≠ missing).

import { describe, it, expect } from 'vitest';
import {
  DUES_STALE_AFTER_DAYS,
  deriveSilentChurnDuesView,
  type SilentDuesSnapshot,
} from './silentChurnDuesView';

const DUES: SilentDuesSnapshot = {
  duesAsOf: '2026-06-11',
  computedAsOf: '2026-06-11',
  thresholdDays: 21,
  silentMembers: 75,
  duesKnownCount: 63,
  totalMonthly: 6734.17,
};

describe('deriveSilentChurnDuesView', () => {
  it('shows a fresh, threshold-matched figure with its own N / M / as-of', () => {
    expect(deriveSilentChurnDuesView(DUES, '2026-06-11', 21)).toEqual({
      kind: 'shown',
      totalMonthly: 6734.17,
      duesKnownCount: 63,
      silentMembers: 75,
      duesAsOf: '2026-06-11',
      thresholdDays: 21,
    });
  });

  it('hides with noDues when the snapshot carries no dues aggregate', () => {
    expect(deriveSilentChurnDuesView(null, '2026-06-11', 21)).toEqual({
      kind: 'hidden',
      reason: 'noDues',
      dues: null,
    });
  });

  it('hides on a resolved-threshold mismatch (the $ is threshold-coupled)', () => {
    const view = deriveSilentChurnDuesView(DUES, '2026-06-11', 30);
    expect(view).toEqual({ kind: 'hidden', reason: 'thresholdMismatch', dues: DUES });
  });

  it('hides when the dues export is OLDER than the snapshot by more than the window', () => {
    // duesAsOf 2026-06-11 vs snapshot 2026-07-21 → 40 days, dues older.
    const view = deriveSilentChurnDuesView(DUES, '2026-07-21', 21);
    expect(view).toEqual({ kind: 'hidden', reason: 'stale', dues: DUES });
  });

  it('hides when the dues export is NEWER than the snapshot by more than the window', () => {
    // duesAsOf 2026-06-11 vs snapshot 2026-05-02 → 40 days, dues newer. The gap is
    // absolute — copy for this state must stay direction-neutral, since "predates
    // this snapshot" would lie here.
    const view = deriveSilentChurnDuesView(DUES, '2026-05-02', 21);
    expect(view).toEqual({ kind: 'hidden', reason: 'stale', dues: DUES });
  });

  it('shows at EXACTLY the window boundary and hides one day past it (stale is > , not >=)', () => {
    // 30 days either side of 2026-06-11 → shown; 31 days → stale.
    expect(deriveSilentChurnDuesView(DUES, '2026-07-11', 21).kind).toBe('shown'); // +30
    expect(deriveSilentChurnDuesView(DUES, '2026-05-12', 21).kind).toBe('shown'); // −30
    expect(deriveSilentChurnDuesView(DUES, '2026-07-12', 21).kind).toBe('hidden'); // +31
    expect(deriveSilentChurnDuesView(DUES, '2026-05-11', 21).kind).toBe('hidden'); // −31
    expect(DUES_STALE_AFTER_DAYS).toBe(30); // ~one billing cycle — copy cites it
  });

  it('crosses a month boundary correctly (whole-day diff, not date arithmetic)', () => {
    const juneDues = { ...DUES, duesAsOf: '2026-06-28' };
    expect(deriveSilentChurnDuesView(juneDues, '2026-07-28', 21).kind).toBe('shown'); // 30 days
    expect(deriveSilentChurnDuesView(juneDues, '2026-07-29', 21)).toEqual({
      kind: 'hidden',
      reason: 'stale',
      dues: juneDues,
    }); // 31 days
  });

  it('fails closed to stale when either date is unparseable (freshness unprovable)', () => {
    expect(deriveSilentChurnDuesView(DUES, 'not-a-date', 21)).toEqual({
      kind: 'hidden',
      reason: 'stale',
      dues: DUES,
    });
    const badDues = { ...DUES, duesAsOf: '2026-13-11' };
    expect(deriveSilentChurnDuesView(badDues, '2026-06-11', 21)).toEqual({
      kind: 'hidden',
      reason: 'stale',
      dues: badDues,
    });
  });

  it('hides with noCoverage when zero silent members are dues-known', () => {
    const noneKnown = { ...DUES, duesKnownCount: 0, totalMonthly: 0 };
    expect(deriveSilentChurnDuesView(noneKnown, '2026-06-11', 21)).toEqual({
      kind: 'hidden',
      reason: 'noCoverage',
      dues: noneKnown,
    });
  });

  it('shows a REAL $0 floor when members are dues-known at $0 (comps churn no dues)', () => {
    const allComped = { ...DUES, duesKnownCount: 5, totalMonthly: 0 };
    const view = deriveSilentChurnDuesView(allComped, '2026-06-11', 21);
    expect(view.kind).toBe('shown');
    expect(view.kind === 'shown' && view.totalMonthly).toBe(0);
  });

  it('reports thresholdMismatch before staleness (most actionable reason first)', () => {
    // Both wrong: T mismatched AND 40 days apart (clearly stale under the 30-day
    // rule) — the threshold reason wins because the owner fixes it instantly from
    // Settings.
    const view = deriveSilentChurnDuesView(DUES, '2026-07-21', 30);
    expect(view).toEqual({ kind: 'hidden', reason: 'thresholdMismatch', dues: DUES });
  });
});
