import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateGroundedDayOneSummary } from './groundedSummary';
import { dayOneSummary, formatDeadline } from './templater';
import type { PriorityHistoryRow } from '../priorities/types';
import { readCachedCommitmentSummary, writeCachedCommitmentSummary } from './summaryCache';

// The cache wrapper is mocked so these tests control hit/miss and assert writes
// with no network. (The real wrapper degrades to a miss when Supabase is
// unconfigured, but mocking lets us force a hit and inspect the write path.)
vi.mock('./summaryCache', () => ({
  readCachedCommitmentSummary: vi.fn(),
  writeCachedCommitmentSummary: vi.fn(),
}));

function row(overrides: Partial<PriorityHistoryRow> = {}): PriorityHistoryRow {
  return {
    workspace_id: 'default',
    fired_at: '2026-05-22T12:00:00.000Z',
    signal_type: 'reserve_warning',
    severity: 'warning',
    committed_action: 'Move $100 into your operating reserve this week.',
    metric_value: 6600,
    target_value: 100, // owner-entered weekly target
    gap_amount: 3400,
    deadline_date: '2026-05-29T12:00:00.000Z',
    status: 'open',
    committed_at: '2026-05-22T12:00:00.000Z',
    ...overrides,
  };
}

// Shape the AI proxy returns (see ai.ts callAIProvider): { content: [{ type, text }] }.
function proxyOk(summaryJson: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ content: [{ type: 'text', text: summaryJson }] }),
  } as unknown as Response;
}

describe('generateGroundedDayOneSummary — fail-closed wiring', () => {
  beforeEach(() => {
    // Silence the DEV fallback warnings; restored after each test.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Default every test to a cache MISS so the existing fail-closed cases behave
    // exactly as before (read → null → proceed to the proxy). The cache tests
    // below override per-case.
    vi.mocked(readCachedCommitmentSummary).mockResolvedValue(null);
    vi.mocked(writeCachedCommitmentSummary).mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders the deterministic fallback on proxy timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))
    );
    const r = row();
    expect(await generateGroundedDayOneSummary(r)).toBe(dayOneSummary(r));
  });

  it('renders the deterministic fallback on a 5xx proxy response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503 } as unknown as Response)
    );
    const r = row();
    expect(await generateGroundedDayOneSummary(r)).toBe(dayOneSummary(r));
  });

  it('returns the AI sentence when it is grounded in the target', async () => {
    const summary = "Locked in — $100 into your operating reserve this week. I'll check back in about a week.";
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(proxyOk(JSON.stringify({ summary }))));
    expect(await generateGroundedDayOneSummary(row())).toBe(summary);
  });

  it('falls back when the AI states a contradicting amount ($500 vs $100 target)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        proxyOk(JSON.stringify({ summary: 'Move $500 into your operating reserve this week.' }))
      )
    );
    const r = row();
    expect(await generateGroundedDayOneSummary(r)).toBe(dayOneSummary(r));
  });

  it('falls back when the AI invents a wrong date despite a correct amount (Slice 1b)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        proxyOk(
          JSON.stringify({
            summary: "You're moving $100 into your reserve — I'll check back December 15.",
          })
        )
      )
    );
    const r = row();
    expect(await generateGroundedDayOneSummary(r)).toBe(dayOneSummary(r));
  });

  it('returns the AI sentence when it states the correct deadline date', async () => {
    const r = row();
    // Build the correct date from the same formatter the generator grounds against
    // (timezone-robust — no hardcoded "May 29").
    const summary = `You're moving $100 into your reserve. I'll check back ${formatDeadline(r.deadline_date)}.`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(proxyOk(JSON.stringify({ summary }))));
    expect(await generateGroundedDayOneSummary(r)).toBe(summary);
  });

  it('falls back when the proxy returns a non-JSON / malformed body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(proxyOk('not json at all')));
    const r = row();
    expect(await generateGroundedDayOneSummary(r)).toBe(dayOneSummary(r));
  });

  it('falls back without calling the proxy when no target is recorded', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const r = row({ target_value: undefined });
    expect(await generateGroundedDayOneSummary(r)).toBe(dayOneSummary(r));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // ── Stable-per-commitment cache ──────────────────────────────────────────

  it('caches the AI summary on a cache miss + grounding success (write-through)', async () => {
    vi.mocked(readCachedCommitmentSummary).mockResolvedValue(null);
    const summary = "You're moving $100 into your reserve. I'll check back in about a week.";
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(proxyOk(JSON.stringify({ summary }))));
    const r = row();
    expect(await generateGroundedDayOneSummary(r)).toBe(summary);
    expect(writeCachedCommitmentSummary).toHaveBeenCalledWith(r, summary);
  });

  it('serves the cached summary on a hit without calling the proxy or re-writing', async () => {
    const cached = 'Cached — you’re moving $100 into your reserve this week.';
    vi.mocked(readCachedCommitmentSummary).mockResolvedValue(cached);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await generateGroundedDayOneSummary(row())).toBe(cached);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(writeCachedCommitmentSummary).not.toHaveBeenCalled();
  });

  it('does NOT cache when grounding fails — fallback returned, cache untouched (P0)', async () => {
    vi.mocked(readCachedCommitmentSummary).mockResolvedValue(null);
    // $500 contradicts the $100 target → grounding rejects.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        proxyOk(JSON.stringify({ summary: 'Move $500 into your operating reserve this week.' }))
      )
    );
    const r = row();
    expect(await generateGroundedDayOneSummary(r)).toBe(dayOneSummary(r));
    expect(writeCachedCommitmentSummary).not.toHaveBeenCalled();
  });

  it('does NOT cache on a proxy failure / timeout — fallback returned, cache untouched (P0)', async () => {
    vi.mocked(readCachedCommitmentSummary).mockResolvedValue(null);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))
    );
    const r = row();
    expect(await generateGroundedDayOneSummary(r)).toBe(dayOneSummary(r));
    expect(writeCachedCommitmentSummary).not.toHaveBeenCalled();
  });
});
