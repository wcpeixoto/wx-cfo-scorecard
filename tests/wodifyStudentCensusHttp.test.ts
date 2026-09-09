import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildStudentRetentionAggregate, parseStudentRetentionAggregate } from '../src/lib/gym/studentRetentionAggregate';

// Synthetic fixtures only. Exercise the actual handler and its persistence
// boundary without invoking Deno.serve or any network/service credentials.
vi.mock('../src/lib/gym/wodifyRetentionSync.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/gym/wodifyRetentionSync.ts')>(),
  verifyTriggerSecret: async () => true,
}));

let handleRequest: (req: Request) => Promise<Response>;
const runId = '8d4e4e10-9fa6-4bbf-b5e7-7d78a0c0e811';
const now = '2026-09-09T12:00:00.000Z';
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const page = (clients: unknown[], n = 1, hasMore = false, pageSize = 25) => ({
  clients, pagination: { page: n, page_size: pageSize, has_more: hasMore },
});
const active = { id: 1, client_status: 'Active', last_attendance: '2026-09-08' };
const storedDraft = {
  student_retention: buildStudentRetentionAggregate([active], '2026-09-09'),
  created_at: now, page: 1, page_size: 25, has_more: false, rows_seen: 1,
  active_clients_seen: 1, student_total: 1, student_member: 1,
  student_dependent: 0, student_guardian_with_signin: 0, student_no_group_with_signin: 0,
  guardian_only: 0, unclassified: 0, ambiguous_no_signin_with_membership: 0,
  detail_calls_made: 1, detail_clients_failed: 0,
};
const request = (mode = 'page') => new Request('https://example.invalid/sync', {
  method: 'POST', body: JSON.stringify({ mode, run_id: runId, page: 1 }),
});

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  vi.stubGlobal('Deno', {
    env: { get: (key: string) => key === 'SUPABASE_URL' ? 'https://storage.invalid' : 'synthetic-test-value' },
    serve: vi.fn(),
  });
  ({ handleRequest } = await import('../supabase/functions/sync-wodify-retention/index.ts'));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('census HTTP failure and publication boundary', () => {
  it('collects a full 25-Active page sequentially with practical deadline headroom', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const start = Date.now();
    const http = vi.fn().mockImplementation(async (url: URL | string, init: RequestInit) => {
      if (String(url).includes('/clients?')) {
        return response(page(Array.from({ length: 25 }, (_, i) => ({ ...active, id: i + 1 }))));
      }
      if (init.method === 'POST') return new Response(null, { status: 201 });
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      inFlight -= 1;
      return response({ group: { group_role: 'Member' } });
    });
    vi.stubGlobal('fetch', http);
    const pending = handleRequest(request());
    await vi.advanceTimersByTimeAsync(37_500);
    expect((await pending).status).toBe(200);
    expect(Date.now() - start).toBe(37_500); // 12.5s cadence + 25s synthetic HTTP
    expect(maxInFlight).toBe(1);
    expect(http).toHaveBeenCalledTimes(27);
    expect(JSON.parse(http.mock.calls[26][1].body).student_total).toBe(25);
  });

  it('excludes guardians consistently from every student histogram', async () => {
    const rows = Array.from({ length: 4 }, (_, i) => ({ ...active, id: i + 1,
      date_of_birth: '1990-01-01', member_since: '2020-01-01' }));
    const http = vi.fn().mockResolvedValueOnce(response(page(rows)))
      .mockResolvedValueOnce(response({ group: { group_role: 'Member' } }))
      .mockResolvedValueOnce(response({ group: { group_role: 'Guardian' }, total_class_sign_ins: 0 }))
      .mockResolvedValueOnce(response({ group: { group_role: 'Dependent' } }))
      .mockResolvedValueOnce(response({ group: null, total_class_sign_ins: 0 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));
    vi.stubGlobal('fetch', http);
    const pending = handleRequest(request());
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await pending).status).toBe(200);
    const written = JSON.parse(http.mock.calls[5][1].body);
    expect(written.student_total).toBe(2);
    expect(written.guardian_only).toBe(2);
    expect(parseStudentRetentionAggregate(written.student_retention, '2026-09-09', 2)).not.toBeNull();
    expect(written.student_retention.daysAbsentHistogram.countsByDaysAbsent).toEqual({ '1': 2 });
    expect(written.student_retention.cohorts.cohorts.adults16plus).not.toHaveProperty('lapsed');
  });

  it.each([
    [null],
    [{ id: 1 }],
    [{ ...active, id: null }],
    [{ ...active, client_status: 'active' }],
    [active, { ...active, id: '1' }],
    Array.from({ length: 101 }, (_, i) => ({ ...active, id: i + 1 })),
  ])('rejects malformed/duplicate list rows before details or persistence (%#)', async (...clients) => {
    const http = vi.fn().mockResolvedValue(response(page(clients)));
    vi.stubGlobal('fetch', http);
    const out = await handleRequest(request());
    expect(out.status).toBe(502);
    expect(await out.json()).toEqual({ error: 'sync_failed', code: 'parse_error' });
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('never fetches detail for inactive rows and writes only counts', async () => {
    const http = vi.fn()
      .mockResolvedValueOnce(response(page([{ id: 2, client_status: 'Inactive' }])))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));
    vi.stubGlobal('fetch', http);
    const out = await handleRequest(request());
    expect(out.status).toBe(200);
    expect(http).toHaveBeenCalledTimes(2);
    const written = JSON.parse(http.mock.calls[1][1].body);
    expect(written.active_clients_seen).toBe(0);
    expect(written.rows_seen).toBe(1);
    expect(written).not.toHaveProperty('id');
    expect(written).not.toHaveProperty('clients');
  });

  it.each([429, 503, 404])('bounds detail failures (%s) without persisting a draft', async (status) => {
    const http = vi.fn().mockImplementation(async (url: URL | string) =>
      String(url).includes('/clients?') ? response(page([active])) : response({}, status));
    vi.stubGlobal('fetch', http);
    const pending = handleRequest(request());
    await vi.advanceTimersByTimeAsync(2_000);
    const out = await pending;
    expect(out.status).toBe(status === 429 ? 502 : 409);
    expect(http).toHaveBeenCalledTimes(status === 503 ? 4 : 2);
    expect(http.mock.calls.some(([, init]) => init.method === 'POST')).toBe(false);
  });

  it('rejects malformed detail instead of silently counting a guardian', async () => {
    const http = vi.fn().mockResolvedValueOnce(response(page([active])))
      .mockResolvedValueOnce(response({ group: {}, total_class_sign_ins: 0 }));
    vi.stubGlobal('fetch', http);
    const pending = handleRequest(request());
    await vi.advanceTimersByTimeAsync(500);
    expect((await pending).status).toBe(409);
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('aborts a stalled response body at the whole-request deadline and never writes later', async () => {
    let resolveBody!: (value: unknown) => void;
    const body = new Promise((resolve) => { resolveBody = resolve; });
    const http = vi.fn().mockResolvedValueOnce(response(page([active])))
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => body });
    vi.stubGlobal('fetch', http);
    const pending = handleRequest(request());
    await vi.advanceTimersByTimeAsync(55_000);
    const out = await pending;
    expect(out.status).toBe(502);
    expect(await out.json()).toEqual({ error: 'sync_failed', code: 'timeout' });
    expect(http.mock.calls[1][1].signal.aborted).toBe(true);
    resolveBody({ group: { group_role: 'Member' } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('rejects duplicate identities across pages during the independent final scan', async () => {
    const http = vi.fn().mockResolvedValueOnce(response(page([active], 1, true, 100)))
      .mockResolvedValueOnce(response(page([active], 2, false, 100)));
    vi.stubGlobal('fetch', http);
    expect((await handleRequest(request('finalize'))).status).toBe(502);
    expect(http).toHaveBeenCalledTimes(2);
  });

  it.each(['2026-09-09T10:59:59Z', 'invalid'])('does not publish stale drafts (%s)', async (created_at) => {
    const http = vi.fn().mockResolvedValueOnce(response(page([active], 1, false, 100)))
      .mockResolvedValueOnce(response([{ ...storedDraft, created_at }]));
    vi.stubGlobal('fetch', http);
    expect((await handleRequest(request('finalize'))).status).toBe(409);
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('publishes a fresh complete run, preserving legacy aggregates and the same-day dues payload', async () => {
    const http = vi.fn().mockResolvedValueOnce(response(page([active], 1, false, 100)))
      .mockResolvedValueOnce(response([storedDraft]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));
    vi.stubGlobal('fetch', http);
    const out = await handleRequest(request('finalize'));
    expect(out.status).toBe(200);
    const payload = JSON.parse(http.mock.calls[3][1].body);
    expect(payload).toMatchObject({ active_total: 1, student_total: 1, guardian_only_total: 0 });
    expect(payload.days_absent_histogram).toBeDefined();
    expect(payload.tenure_band_histogram).toBeDefined();
    expect(payload.cohort_histogram).toBeDefined();
    expect(payload).not.toHaveProperty('silent_dues_snapshot');
    expect(http.mock.calls[3][1].headers.Prefer).toBe('return=minimal,resolution=merge-duplicates');
    // Models PostgREST's payload-column merge; database execution remains a separate gate.
    const previous = { silent_dues_snapshot: { totalMonthly: 100 }, active_total: 2 };
    expect({ ...previous, ...payload }.silent_dues_snapshot).toEqual(previous.silent_dues_snapshot);
  });
});
