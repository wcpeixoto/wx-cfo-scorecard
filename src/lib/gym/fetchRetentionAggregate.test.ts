// Reader contract tests for fetchRetentionAggregate (PR2, RETENTION_FINISH_PLAN §6).
// The mapping (snake_case row columns → snapshot; camelCase histogram inner keys) is
// the only piece cross-checked against the live schema by hand, so pin it here. The
// module reads VITE_SUPABASE_* at load, so each test stubs env + global fetch, then
// imports the module FRESH (resetModules) to capture the stubbed config.

import { describe, it, expect, vi, afterEach } from 'vitest';

// Mirrors a live wodify_retention_aggregate row: snake_case columns, a jsonb
// histogram whose INNER keys are camelCase. active_total 412 = 255 healthy-ish + …
// (the exact split is the SPA's job; the reader only carries counts through).
const VALID_ROW = {
  as_of: '2026-06-07',
  active_total: 412,
  unknown_count: 155,
  days_absent_histogram: {
    maxExactDays: 364,
    countsByDaysAbsent: { '0': 3, '8': 2, '21': 5 },
    overflow365Plus: 2,
  },
};

function stubConfiguredEnv() {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-test-key');
}

function installFetch(response: { ok: boolean; status?: number; body: unknown }) {
  const fn = vi.fn((..._args: unknown[]) =>
    Promise.resolve({
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: () => Promise.resolve(response.body),
    }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

async function loadModule() {
  vi.resetModules();
  return import('./fetchRetentionAggregate');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchLatestRetentionAggregate — mapping + failure modes', () => {
  it('maps a valid snake_case row (camelCase histogram) → snapshot', async () => {
    stubConfiguredEnv();
    const fetchFn = installFetch({ ok: true, body: [VALID_ROW] });
    const { fetchLatestRetentionAggregate } = await loadModule();

    const snap = await fetchLatestRetentionAggregate();
    expect(snap).toEqual({
      asOf: '2026-06-07',
      activeTotal: 412,
      inactiveTotal: null, // VALID_ROW predates the §6 census column → null → sample census
      unknownStatus: 0, // absent on the row → coerced to 0 (NOT NULL default 0 live)
      unknown: 155,
      daysAbsentHistogram: {
        countsByDaysAbsent: { '0': 3, '8': 2, '21': 5 },
        overflow365Plus: 2,
      },
    });

    // Read path: a single anon GET against the right table with the latest-row query.
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const url = fetchFn.mock.calls[0][0] as string;
    expect(url).toContain('/rest/v1/wodify_retention_aggregate');
    expect(url).toContain('workspace_id=eq.default');
    expect(url).toContain('order=as_of.desc');
    expect(url).toContain('limit=1');
    const init = fetchFn.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.apikey).toBe('anon-test-key');
    expect(init.headers.Authorization).toBe('Bearer anon-test-key');
  });

  it('maps a present census (inactive_total, incl. a real 0) to live numbers', async () => {
    stubConfiguredEnv();
    installFetch({ ok: true, body: [{ ...VALID_ROW, inactive_total: 548, unknown_status: 2 }] });
    const { fetchLatestRetentionAggregate } = await loadModule();
    const snap = await fetchLatestRetentionAggregate();
    expect(snap?.inactiveTotal).toBe(548);
    expect(snap?.unknownStatus).toBe(2);
  });

  it('maps a real census 0 to 0 (a live zero, never coerced to null)', async () => {
    stubConfiguredEnv();
    installFetch({ ok: true, body: [{ ...VALID_ROW, inactive_total: 0 }] });
    const { fetchLatestRetentionAggregate } = await loadModule();
    const snap = await fetchLatestRetentionAggregate();
    expect(snap?.inactiveTotal).toBe(0);
  });

  it('maps an absent census (pre-migration row, no census column) to null → sample fallback', async () => {
    stubConfiguredEnv();
    installFetch({ ok: true, body: [VALID_ROW] }); // VALID_ROW carries no inactive_total
    const { fetchLatestRetentionAggregate } = await loadModule();
    const snap = await fetchLatestRetentionAggregate();
    expect(snap?.inactiveTotal).toBeNull();
  });

  it('maps null / malformed census values to null (never a fabricated 0)', async () => {
    stubConfiguredEnv();
    installFetch({ ok: true, body: [{ ...VALID_ROW, inactive_total: 'x' }] });
    const { fetchLatestRetentionAggregate } = await loadModule();
    const snap = await fetchLatestRetentionAggregate();
    expect(snap?.inactiveTotal).toBeNull();
  });

  it('returns null when no row exists (empty array)', async () => {
    stubConfiguredEnv();
    installFetch({ ok: true, body: [] });
    const { fetchLatestRetentionAggregate } = await loadModule();
    expect(await fetchLatestRetentionAggregate()).toBeNull();
  });

  it('returns null when the histogram is malformed (no countsByDaysAbsent)', async () => {
    stubConfiguredEnv();
    installFetch({ ok: true, body: [{ ...VALID_ROW, days_absent_histogram: { overflow365Plus: 1 } }] });
    const { fetchLatestRetentionAggregate } = await loadModule();
    expect(await fetchLatestRetentionAggregate()).toBeNull();
  });

  it('returns null when as_of is missing (no usable live snapshot)', async () => {
    stubConfiguredEnv();
    installFetch({ ok: true, body: [{ ...VALID_ROW, as_of: null }] });
    const { fetchLatestRetentionAggregate } = await loadModule();
    expect(await fetchLatestRetentionAggregate()).toBeNull();
  });

  it('throws on a non-OK HTTP status (status only, no body echo)', async () => {
    stubConfiguredEnv();
    installFetch({ ok: false, status: 500, body: {} });
    const { fetchLatestRetentionAggregate } = await loadModule();
    await expect(fetchLatestRetentionAggregate()).rejects.toThrow(/retention_aggregate_http_500/);
  });

  it('coerces non-numeric jsonb counts defensively (never NaN into the buckets)', async () => {
    stubConfiguredEnv();
    installFetch({
      ok: true,
      body: [{ ...VALID_ROW, days_absent_histogram: { countsByDaysAbsent: { '0': 'x', '8': 2 }, overflow365Plus: 'y' } }],
    });
    const { fetchLatestRetentionAggregate } = await loadModule();
    const snap = await fetchLatestRetentionAggregate();
    expect(snap?.daysAbsentHistogram).toEqual({ countsByDaysAbsent: { '0': 0, '8': 2 }, overflow365Plus: 0 });
  });

  it('does not call fetch and returns null when Supabase env is unconfigured', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    const fetchFn = installFetch({ ok: true, body: [VALID_ROW] });
    const { fetchLatestRetentionAggregate, isRetentionAggregateConfigured } = await loadModule();
    expect(isRetentionAggregateConfigured()).toBe(false);
    expect(await fetchLatestRetentionAggregate()).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
