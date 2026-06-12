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

// A valid silent_dues_snapshot jsonb (§6.4 SC dues slice): the six-key camelCase
// contract the gated MCP write produces (values from the 2026-06-11 preview run).
const VALID_DUES = {
  duesAsOf: '2026-06-11',
  computedAsOf: '2026-06-11',
  thresholdDays: 21,
  silentMembers: 75,
  duesKnownCount: 63,
  totalMonthly: 6734.17,
};

function stubConfiguredEnv() {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-test-key');
}

// Routes by URL: the dues read (the only query filtering silent_dues_snapshot)
// gets `duesResponse`, everything else gets `response`. The dues default — an
// empty result — mirrors a live table where no dues write has happened yet, so
// pre-dues tests keep passing with dues:null. `'reject'` simulates a network-level
// failure of the dues read alone (the isolation contract).
function installFetch(
  response: { ok: boolean; status?: number; body: unknown },
  duesResponse: { ok: boolean; status?: number; body: unknown } | 'reject' = {
    ok: true,
    body: [],
  },
) {
  const fn = vi.fn((...args: unknown[]) => {
    const r = String(args[0]).includes('silent_dues_snapshot=not.is.null')
      ? duesResponse
      : response;
    if (r === 'reject') return Promise.reject(new Error('network down'));
    return Promise.resolve({
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 500),
      json: () => Promise.resolve(r.body),
    });
  });
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
      dues: null, // no dues write yet (the routed default) → count-only dues line
    });

    // Read path: the main latest-row anon GET, then the ISOLATED dues GET (latest
    // non-null silent_dues_snapshot) — two requests, same table, same anon headers.
    expect(fetchFn).toHaveBeenCalledTimes(2);
    const url = fetchFn.mock.calls[0][0] as string;
    expect(url).toContain('/rest/v1/wodify_retention_aggregate');
    expect(url).toContain('workspace_id=eq.default');
    expect(url).toContain('order=as_of.desc');
    expect(url).toContain('limit=1');
    const init = fetchFn.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.apikey).toBe('anon-test-key');
    expect(init.headers.Authorization).toBe('Bearer anon-test-key');
    const duesUrl = fetchFn.mock.calls[1][0] as string;
    expect(duesUrl).toContain('/rest/v1/wodify_retention_aggregate');
    expect(duesUrl).toContain('select=silent_dues_snapshot,as_of');
    expect(duesUrl).toContain('silent_dues_snapshot=not.is.null');
    expect(duesUrl).toContain('workspace_id=eq.default');
    expect(duesUrl).toContain('order=as_of.desc');
    expect(duesUrl).toContain('limit=1');
    const duesInit = fetchFn.mock.calls[1][1] as { headers: Record<string, string> };
    expect(duesInit.headers.apikey).toBe('anon-test-key');
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

  it('returns null when no row exists (empty array) — and skips the dues read', async () => {
    stubConfiguredEnv();
    const fetchFn = installFetch({ ok: true, body: [] });
    const { fetchLatestRetentionAggregate } = await loadModule();
    expect(await fetchLatestRetentionAggregate()).toBeNull();
    // No usable snapshot → every card is Sample and dues is moot; one GET only.
    expect(fetchFn).toHaveBeenCalledTimes(1);
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

describe('fetchLatestRetentionAggregate — silent_dues_snapshot (isolated dues read)', () => {
  // The dues row the routed read returns: the latest NON-NULL dues value, usually
  // on an OLDER row than the latest snapshot (the edge never writes the column).
  const duesRows = (dues: unknown) => [{ as_of: '2026-06-05', silent_dues_snapshot: dues }];

  it('parses a valid dues aggregate (incl. one riding an older row than the snapshot)', async () => {
    stubConfiguredEnv();
    installFetch({ ok: true, body: [VALID_ROW] }, { ok: true, body: duesRows(VALID_DUES) });
    const { fetchLatestRetentionAggregate } = await loadModule();
    const snap = await fetchLatestRetentionAggregate();
    expect(snap?.dues).toEqual(VALID_DUES);
    expect(snap?.asOf).toBe('2026-06-07'); // the snapshot keeps ITS OWN as-of
  });

  it('drops unexpected extra keys (the object is rebuilt field-by-field)', async () => {
    stubConfiguredEnv();
    installFetch(
      { ok: true, body: [VALID_ROW] },
      { ok: true, body: duesRows({ ...VALID_DUES, smuggled: 'x' }) },
    );
    const { fetchLatestRetentionAggregate } = await loadModule();
    expect((await fetchLatestRetentionAggregate())?.dues).toEqual(VALID_DUES);
  });

  it('keeps a real $0 floor (totalMonthly 0 is dues-KNOWN at zero, never nulled)', async () => {
    stubConfiguredEnv();
    installFetch(
      { ok: true, body: [VALID_ROW] },
      { ok: true, body: duesRows({ ...VALID_DUES, totalMonthly: 0 }) },
    );
    const { fetchLatestRetentionAggregate } = await loadModule();
    expect((await fetchLatestRetentionAggregate())?.dues?.totalMonthly).toBe(0);
  });

  it('maps an empty dues result (no write yet) to null', async () => {
    stubConfiguredEnv();
    installFetch({ ok: true, body: [VALID_ROW] }, { ok: true, body: [] });
    const { fetchLatestRetentionAggregate } = await loadModule();
    expect((await fetchLatestRetentionAggregate())?.dues).toBeNull();
  });

  it('rejects a payload missing ANY of the six required keys', async () => {
    stubConfiguredEnv();
    for (const key of Object.keys(VALID_DUES)) {
      const { [key as keyof typeof VALID_DUES]: _dropped, ...incomplete } = VALID_DUES;
      installFetch({ ok: true, body: [VALID_ROW] }, { ok: true, body: duesRows(incomplete) });
      const { fetchLatestRetentionAggregate } = await loadModule();
      expect((await fetchLatestRetentionAggregate())?.dues, `missing ${key}`).toBeNull();
    }
  });

  it('rejects non-integer / negative / non-numeric counts and thresholds', async () => {
    stubConfiguredEnv();
    const badCases: Array<Record<string, unknown>> = [
      { ...VALID_DUES, thresholdDays: 21.5 },
      { ...VALID_DUES, silentMembers: '75' },
      { ...VALID_DUES, duesKnownCount: -1 },
      { ...VALID_DUES, duesKnownCount: 63.4 },
    ];
    for (const bad of badCases) {
      installFetch({ ok: true, body: [VALID_ROW] }, { ok: true, body: duesRows(bad) });
      const { fetchLatestRetentionAggregate } = await loadModule();
      expect((await fetchLatestRetentionAggregate())?.dues).toBeNull();
    }
  });

  it('rejects a non-finite / negative / non-numeric totalMonthly', async () => {
    stubConfiguredEnv();
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, '6734.17']) {
      installFetch(
        { ok: true, body: [VALID_ROW] },
        { ok: true, body: duesRows({ ...VALID_DUES, totalMonthly: bad }) },
      );
      const { fetchLatestRetentionAggregate } = await loadModule();
      expect((await fetchLatestRetentionAggregate())?.dues).toBeNull();
    }
  });

  it('rejects malformed dates (format AND calendar validity)', async () => {
    stubConfiguredEnv();
    for (const bad of ['2026-6-11', '2026-13-11', '2026-06-99', 'not-a-date', 20260611]) {
      installFetch(
        { ok: true, body: [VALID_ROW] },
        { ok: true, body: duesRows({ ...VALID_DUES, duesAsOf: bad }) },
      );
      const { fetchLatestRetentionAggregate } = await loadModule();
      expect((await fetchLatestRetentionAggregate())?.dues).toBeNull();
    }
  });

  it('rejects duesKnownCount > silentMembers (impossible coverage)', async () => {
    stubConfiguredEnv();
    installFetch(
      { ok: true, body: [VALID_ROW] },
      { ok: true, body: duesRows({ ...VALID_DUES, duesKnownCount: 76 }) },
    );
    const { fetchLatestRetentionAggregate } = await loadModule();
    expect((await fetchLatestRetentionAggregate())?.dues).toBeNull();
  });

  it('ISOLATION: a 400 on the dues read (pre-migration column) leaves the snapshot intact', async () => {
    stubConfiguredEnv();
    // PostgREST 400s an explicit select naming a column that does not exist —
    // exactly the live state between this PR's merge and the gated migration.
    installFetch({ ok: true, body: [VALID_ROW] }, { ok: false, status: 400, body: {} });
    const { fetchLatestRetentionAggregate } = await loadModule();
    const snap = await fetchLatestRetentionAggregate();
    expect(snap?.dues).toBeNull();
    // The four live cards' data survives — the dues read can NEVER knock the
    // snapshot back to Sample.
    expect(snap?.asOf).toBe('2026-06-07');
    expect(snap?.activeTotal).toBe(412);
    expect(snap?.daysAbsentHistogram).toEqual({
      countsByDaysAbsent: { '0': 3, '8': 2, '21': 5 },
      overflow365Plus: 2,
    });
  });

  it('ISOLATION: a network-level dues failure also degrades to dues:null only', async () => {
    stubConfiguredEnv();
    installFetch({ ok: true, body: [VALID_ROW] }, 'reject');
    const { fetchLatestRetentionAggregate } = await loadModule();
    const snap = await fetchLatestRetentionAggregate();
    expect(snap?.dues).toBeNull();
    expect(snap?.asOf).toBe('2026-06-07');
  });

  it('ISOLATION: a malformed dues body (non-array) degrades to dues:null only', async () => {
    stubConfiguredEnv();
    installFetch({ ok: true, body: [VALID_ROW] }, { ok: true, body: { error: 'nope' } });
    const { fetchLatestRetentionAggregate } = await loadModule();
    const snap = await fetchLatestRetentionAggregate();
    expect(snap?.dues).toBeNull();
    expect(snap?.activeTotal).toBe(412);
  });
});
