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

// A valid tenure_band_histogram jsonb (§6 aggregate extension): the exact
// bandEdges contract this build's TENURE_BANDS defines, plus every band key.
const VALID_TENURE = {
  bandEdges: [
    { id: 'lt3m', minDays: 0 },
    { id: '3to6m', minDays: 90 },
    { id: '6to12m', minDays: 180 },
    { id: '1to2y', minDays: 365 },
    { id: '2yplus', minDays: 730 },
  ],
  bands: {
    lt3m: { countsByDaysAbsent: { '0': 1 }, overflow365Plus: 0, unknownRecency: 0 },
    '3to6m': { countsByDaysAbsent: {}, overflow365Plus: 0, unknownRecency: 0 },
    '6to12m': { countsByDaysAbsent: { '21': 1 }, overflow365Plus: 0, unknownRecency: 0 },
    '1to2y': { countsByDaysAbsent: { '8': 1 }, overflow365Plus: 1, unknownRecency: 0 },
    '2yplus': { countsByDaysAbsent: { '0': 2, '21': 4 }, overflow365Plus: 1, unknownRecency: 155 },
    unknownTenure: { countsByDaysAbsent: {}, overflow365Plus: 0, unknownRecency: 0 },
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
      tenureBands: null, // pre-tenure row (column absent) → null → sample Tenure card
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

  it('parses a valid tenure_band_histogram (coercing jsonb counts defensively)', async () => {
    stubConfiguredEnv();
    installFetch({ ok: true, body: [{ ...VALID_ROW, tenure_band_histogram: VALID_TENURE }] });
    const { fetchLatestRetentionAggregate } = await loadModule();
    const snap = await fetchLatestRetentionAggregate();
    expect(snap?.tenureBands).toEqual(VALID_TENURE);
  });

  it('maps a SQL-null / malformed tenure column to null (Tenure card → sample)', async () => {
    stubConfiguredEnv();
    installFetch({ ok: true, body: [{ ...VALID_ROW, tenure_band_histogram: null }] });
    const { fetchLatestRetentionAggregate } = await loadModule();
    expect((await fetchLatestRetentionAggregate())?.tenureBands).toBeNull();
  });

  it('rejects tenure data binned under DIFFERENT band edges (exact id/minDays/order match)', async () => {
    stubConfiguredEnv();
    const editedEdges = VALID_TENURE.bandEdges.map((e, i) => (i === 1 ? { ...e, minDays: 91 } : e));
    installFetch({
      ok: true,
      body: [{ ...VALID_ROW, tenure_band_histogram: { ...VALID_TENURE, bandEdges: editedEdges } }],
    });
    const { fetchLatestRetentionAggregate } = await loadModule();
    const snap = await fetchLatestRetentionAggregate();
    expect(snap?.tenureBands).toBeNull();
    // PER-FIELD degradation: the rest of the snapshot survives — the live
    // Attendance Health / Silent Churn / census cards must NOT fall back to
    // sample because the tenure payload alone is unusable.
    expect(snap?.asOf).toBe('2026-06-07');
    expect(snap?.activeTotal).toBe(412);
    expect(snap?.daysAbsentHistogram).toEqual({
      countsByDaysAbsent: { '0': 3, '8': 2, '21': 5 },
      overflow365Plus: 2,
    });
  });

  it('rejects tenure data with a wrong band-edge COUNT (extra or missing band)', async () => {
    stubConfiguredEnv();
    installFetch({
      ok: true,
      body: [{
        ...VALID_ROW,
        tenure_band_histogram: { ...VALID_TENURE, bandEdges: VALID_TENURE.bandEdges.slice(0, 4) },
      }],
    });
    const { fetchLatestRetentionAggregate } = await loadModule();
    expect((await fetchLatestRetentionAggregate())?.tenureBands).toBeNull();
  });

  it('rejects tenure data missing an expected band key (incl. the unknown-tenure bucket)', async () => {
    stubConfiguredEnv();
    const { unknownTenure: _dropped, ...bandsWithoutUnknown } = VALID_TENURE.bands;
    installFetch({
      ok: true,
      body: [{
        ...VALID_ROW,
        tenure_band_histogram: { ...VALID_TENURE, bands: bandsWithoutUnknown },
      }],
    });
    const { fetchLatestRetentionAggregate } = await loadModule();
    expect((await fetchLatestRetentionAggregate())?.tenureBands).toBeNull();
  });

  it('rejects a malformed band entry (no countsByDaysAbsent) and coerces non-numeric counts', async () => {
    stubConfiguredEnv();
    installFetch({
      ok: true,
      body: [{
        ...VALID_ROW,
        tenure_band_histogram: {
          ...VALID_TENURE,
          bands: { ...VALID_TENURE.bands, lt3m: { overflow365Plus: 1 } },
        },
      }],
    });
    const { fetchLatestRetentionAggregate } = await loadModule();
    expect((await fetchLatestRetentionAggregate())?.tenureBands).toBeNull();

    // Non-numeric jsonb values inside a structurally-valid band coerce to 0,
    // never NaN (same rule as the global histogram).
    installFetch({
      ok: true,
      body: [{
        ...VALID_ROW,
        tenure_band_histogram: {
          ...VALID_TENURE,
          bands: {
            ...VALID_TENURE.bands,
            lt3m: { countsByDaysAbsent: { '0': 'x' }, overflow365Plus: 'y', unknownRecency: 2 },
          },
        },
      }],
    });
    const { fetchLatestRetentionAggregate: fetchAgain } = await loadModule();
    const snap = await fetchAgain();
    expect(snap?.tenureBands?.bands.lt3m).toEqual({
      countsByDaysAbsent: { '0': 0 },
      overflow365Plus: 0,
      unknownRecency: 2,
    });
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
