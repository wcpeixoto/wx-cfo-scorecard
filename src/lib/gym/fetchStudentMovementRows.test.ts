// Reader contract for fetchStudentMovementRows. The module reads VITE_SUPABASE_* at load, so each test
// stubs env + global fetch and imports the module FRESH (resetModules) to capture the stubbed config.

import { afterEach, describe, expect, it, vi } from 'vitest';

// Live-shaped rows (PostgREST returns numeric as a JSON number, timestamptz with a +00:00 offset).
const SEP_NEW = { period_month: '2026-09-01', metric_key: 'new_students', dimension: 'all', value: 24, as_of: '2026-10-19T15:07:40.74178+00:00', source_as_of: null };
const SEP_ACTIVE = { period_month: '2026-09-01', metric_key: 'active_students', dimension: 'all', value: 265, as_of: '2026-10-19T15:07:40.74178+00:00', source_as_of: '2026-09-28' };

function stubSupabase(response: () => Promise<Response> | Response) {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co/');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-test-key');
  const fn = vi.fn(async () => response());
  vi.stubGlobal('fetch', fn);
  return fn;
}

async function load() {
  vi.resetModules();
  return import('./fetchStudentMovementRows');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('fetchStudentMovementRows', () => {
  it('asks for exactly the four metrics, dimension all, no run_id, with the anon key', async () => {
    const fn = stubSupabase(() => new Response(JSON.stringify([SEP_NEW, SEP_ACTIVE]), { status: 200 }));
    const { fetchStudentMovementRows } = await load();
    await fetchStudentMovementRows();

    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('https://example.supabase.co/rest/v1/wodify_monthly_metrics?');
    expect(url).toContain('dimension=eq.all');
    expect(url).toContain('metric_key=in.(new_students,rejoins,cancellations,active_students)');
    expect(url).toContain('select=period_month,metric_key,dimension,value,as_of,source_as_of');
    expect(url).not.toContain('run_id');
    expect(url).not.toContain('cancellations_all_clients');
    expect((init.headers as Record<string, string>).apikey).toBe('anon-test-key');
  });

  it('maps rows to camelCase with YYYY-MM months and carries the census date', async () => {
    stubSupabase(() => new Response(JSON.stringify([SEP_NEW, SEP_ACTIVE]), { status: 200 }));
    const { fetchStudentMovementRows } = await load();
    expect(await fetchStudentMovementRows()).toEqual([
      { periodMonth: '2026-09', metricKey: 'new_students', value: 24, asOf: '2026-10-19T15:07:40.74178+00:00', sourceAsOf: null },
      { periodMonth: '2026-09', metricKey: 'active_students', value: 265, asOf: '2026-10-19T15:07:40.74178+00:00', sourceAsOf: '2026-09-28' },
    ]);
  });

  it('re-filters the response: other keys, other dimensions and malformed rows are dropped', async () => {
    stubSupabase(
      () =>
        new Response(
          JSON.stringify([
            SEP_NEW,
            { ...SEP_NEW, metric_key: 'cancellations_all_clients' },
            { ...SEP_NEW, dimension: 'program:Kids BJJ' },
            { ...SEP_NEW, period_month: '2026-09-15' }, // not first of month
            { ...SEP_NEW, value: 'abc' },
            { ...SEP_NEW, as_of: 'not a date' },
          ]),
          { status: 200 },
        ),
    );
    const { fetchStudentMovementRows } = await load();
    expect(await fetchStudentMovementRows()).toHaveLength(1);
  });

  it('accepts numeric values serialised as strings', async () => {
    stubSupabase(() => new Response(JSON.stringify([{ ...SEP_NEW, value: '24' }]), { status: 200 }));
    const { fetchStudentMovementRows } = await load();
    expect((await fetchStudentMovementRows())?.[0].value).toBe(24);
  });

  it('null when the read is refused (pre-migration: no anon grant), unreachable, garbled, or unconfigured', async () => {
    stubSupabase(() => new Response(JSON.stringify({ code: '42501', message: 'permission denied' }), { status: 401 }));
    expect(await (await load()).fetchStudentMovementRows()).toBeNull();

    stubSupabase(() => {
      throw new TypeError('network down');
    });
    expect(await (await load()).fetchStudentMovementRows()).toBeNull();

    stubSupabase(() => new Response('<html>', { status: 200 }));
    expect(await (await load()).fetchStudentMovementRows()).toBeNull();

    stubSupabase(() => new Response(JSON.stringify({ not: 'an array' }), { status: 200 }));
    expect(await (await load()).fetchStudentMovementRows()).toBeNull();

    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    const unconfigured = await load();
    expect(unconfigured.isStudentMovementConfigured()).toBe(false);
    expect(await unconfigured.fetchStudentMovementRows()).toBeNull();
  });

  it('[] (not null) when the read worked and there are no rows', async () => {
    stubSupabase(() => new Response('[]', { status: 200 }));
    expect(await (await load()).fetchStudentMovementRows()).toEqual([]);
  });
});
