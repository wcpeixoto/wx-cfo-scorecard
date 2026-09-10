import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildStudentRetentionAggregate, parseStudentRetentionAggregate } from '../src/lib/gym/studentRetentionAggregate';
import { observePagination } from '../src/lib/gym/wodifyParseDiagnostics';

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
const page = (clients: unknown[], n = 1, hasMore = false, pageSize = clients.length) => ({
  clients, pagination: { page: n, page_size: pageSize, has_more: hasMore },
});
const active = { id: 1, client_status: 'Active', last_attendance: '2026-09-08' };
const storedDraft = {
  student_retention: buildStudentRetentionAggregate([active], '2026-09-09'),
  created_at: now, page: 1, page_size: 1, has_more: false, rows_seen: 1,
  active_clients_seen: 1, student_total: 1, student_member: 1,
  student_dependent: 0, student_guardian_with_signin: 0, student_no_group_with_signin: 0,
  guardian_only: 0, unclassified: 0, ambiguous_no_signin_with_membership: 0,
  detail_calls_made: 1, detail_clients_failed: 0,
};
const request = (mode = 'page', requestedPage = 1) => new Request('https://example.invalid/sync', {
  method: 'POST', body: JSON.stringify({ mode, run_id: runId, page: requestedPage }),
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
  it.each([0, 21, 25])('persists a valid terminal page of %s rows', async (rows) => {
    const http = vi.fn().mockResolvedValueOnce(response(page(Array.from({ length: rows }, (_, id) => ({ id: id + 1, client_status: 'Inactive' })), 41)))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));
    vi.stubGlobal('fetch', http);
    const out = await handleRequest(request('page', 41));
    expect(out.status).toBe(200);
    expect(await out.json()).toMatchObject({ pageSize: rows, rowsSeen: rows, hasMore: false });
    expect(JSON.parse(http.mock.calls[1][1].body)).toMatchObject({ page_size: rows, rows_seen: rows, has_more: false });
  });
  it('enforces returned-size semantics across types, missing fields, row counts and the cap', async () => {
    const shapes: Record<string, unknown>[] = [
      {}, { page: 41, page_size: 25, has_more: false },
      ...[null, false, true, 0, 1.5, 42, '41', '25', 'false', 'true', 'private-secret', [], { private: 'secret' }]
        .flatMap((value) => ['page', 'page_size', 'has_more'].map((field) => ({ page: 41, page_size: 25, has_more: false, [field]: value }))),
      ...['page', 'page_size', 'has_more'].map((field) => Object.fromEntries(Object.entries({ page: 41, page_size: 25, has_more: false }).filter(([key]) => key !== field))),
      { page: 200, page_size: 25, has_more: true }, { page: 200, page_size: 25, has_more: false },
    ];
    for (const pagination of shapes) for (const rows of [0, 1, 25, 26]) {
      const requested = pagination.page === 200 ? 200 : 41;
      const rejected = pagination.page !== requested || pagination.page_size !== rows || (pagination.page_size as number) > 25 || typeof pagination.has_more !== 'boolean'
        || rows > 25 || Boolean(pagination.has_more && (pagination.page_size !== 25 || requested === 200));
      const http = vi.fn().mockResolvedValueOnce(response({ pagination,
        clients: Array.from({ length: rows }, (_, id) => ({ id: id + 1, client_status: 'Inactive' })) }))
        .mockResolvedValueOnce(new Response(null, { status: 201 }));
      vi.stubGlobal('fetch', http);
      const out = await handleRequest(request('page', requested));
      expect(out.status, JSON.stringify({ pagination, rows })).toBe(rejected ? 502 : 200);
      const result = await out.json();
      if (rejected) {
        expect(result.parse_stage).toBe('clients_pagination');
        expect(result.pagination).toEqual(observePagination(pagination, rows, requested, 25, 200));
        expect(JSON.stringify(result)).not.toMatch(/private|secret/);
        expect(http).toHaveBeenCalledTimes(1);
      } else {
        expect(result).not.toHaveProperty('pagination');
        expect(http).toHaveBeenCalledTimes(2);
      }
    }
  });
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
    expect(written).not.toHaveProperty('unclassified_reasons');
    expect(written).not.toHaveProperty('detail_http_status_counts');
  });

  it.each([
    ['clients_row', [null]],
    ['clients_row', [{ id: 1 }]],
    ['clients_identifier', [{ ...active, id: null }]],
    ['clients_row', [{ ...active, client_status: 'active' }]],
    ['clients_duplicate', [active, { ...active, id: '1' }]],
    ['clients_pagination', Array.from({ length: 101 }, (_, i) => ({ ...active, id: i + 1 }))],
  ])('rejects malformed/duplicate list rows before details or persistence (%#)', async (stage, clients) => {
    const http = vi.fn().mockResolvedValue(response(page(clients)));
    vi.stubGlobal('fetch', http);
    const out = await handleRequest(request());
    expect(out.status).toBe(502);
    expect(await out.json()).toEqual({ error: 'sync_failed', code: 'parse_error', parse_stage: stage,
      outer_json_valid: true, response_content_type: 'text/plain',
      response_body_bytes: new TextEncoder().encode(JSON.stringify(page(clients as unknown[]))).byteLength,
      response_body_bytes_overflow: false,
      ...(stage === 'clients_pagination' ? { pagination: observePagination(page(clients as unknown[]).pagination, (clients as unknown[]).length, 1, 25, 200) } : {}) });
    expect(http).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['clients_json_decode', '{"private":"é秘密"', false],
    ['clients_envelope', JSON.stringify({ private: 'é秘密' }), true],
    ['clients_pagination', JSON.stringify(page([], 2)), true],
  ])('reports %s without returning body or arbitrary content-type values', async (stage, raw, valid) => {
    const http = vi.fn().mockResolvedValue(new Response(raw, { headers: { 'Content-Type': 'private/secret; token=private' } }));
    vi.stubGlobal('fetch', http);
    const out = await handleRequest(request());
    expect(out.status).toBe(502);
    expect(await out.json()).toEqual({ error: 'sync_failed', code: 'parse_error', parse_stage: stage,
      outer_json_valid: valid, response_content_type: 'other', response_body_bytes: new TextEncoder().encode(raw).byteLength,
      response_body_bytes_overflow: false,
      ...(stage === 'clients_pagination' ? { pagination: observePagination(page([], 2).pagination, 0, 1, 25, 200) } : {}) });
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

  it('keeps three malformed detail JSON attempts on the existing 409 failure path', async () => {
    const http = vi.fn().mockResolvedValueOnce(response(page([active])))
      .mockImplementation(async () => new Response('private invalid JSON'));
    vi.stubGlobal('fetch', http);
    const pending = handleRequest(request());
    await vi.advanceTimersByTimeAsync(1_500);
    const out = await pending;
    expect(out.status).toBe(409);
    const body = await out.json();
    expect(body).toMatchObject({ error: 'page_classification_failed', unclassified_total: 1,
      detail_clients_failed: 1, unclassified_reasons: { detail_fetch_failed: 1 }, detail_http_status_counts: {} });
    expect(body).not.toHaveProperty('parse_stage');
    expect(JSON.stringify(body)).not.toContain('private');
    expect(http).toHaveBeenCalledTimes(4);
    expect(http.mock.calls.some(([, init]) => init.method === 'POST')).toBe(false);
  });

  it('reports only aggregate reasons and failed HTTP attempts on the existing page 409', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ ...active, id: i + 1 }));
    const http = vi.fn().mockResolvedValueOnce(response(page(rows)))
      .mockResolvedValueOnce(response(null))
      .mockResolvedValueOnce(response({ total_class_sign_ins: 'private-value' }))
      .mockResolvedValueOnce(response({ group: {}, email: 'private@example.invalid' }))
      .mockResolvedValueOnce(response({ group: { group_role: 'private-role' } }))
      .mockResolvedValueOnce(response({ group: { group_role: 'Guardian' }, total_class_sign_ins: null }))
      .mockResolvedValueOnce(response({ private: 'http-body' }, 404))
      .mockResolvedValueOnce(response({}, 503))
      .mockResolvedValueOnce(response({}, 503))
      .mockResolvedValueOnce(response({}, 503))
      .mockRejectedValueOnce(new TypeError('private network URL'))
      .mockRejectedValueOnce(new TypeError('private network URL'))
      .mockRejectedValueOnce(new TypeError('private network URL'))
      .mockResolvedValueOnce(new Response('invalid-json'))
      .mockResolvedValueOnce(new Response('invalid-json'))
      .mockResolvedValueOnce(new Response('invalid-json'))
      // A failed HTTP attempt still counts when that client's retry succeeds.
      .mockResolvedValueOnce(response({}, 503))
      .mockResolvedValueOnce(response({ group: { group_role: 'Member' } }));
    vi.stubGlobal('fetch', http);
    const pending = handleRequest(request());
    await vi.advanceTimersByTimeAsync(8_500);
    const out = await pending;
    expect(out.status).toBe(409);
    const diagnostic = await out.json();
    expect(diagnostic).toEqual({
      error: 'page_classification_failed',
      unclassified_total: 9,
      detail_clients_failed: 4,
      unclassified_reasons: {
        invalid_detail_record: 1,
        invalid_no_group_signins: 1,
        invalid_group_or_missing_role: 1,
        unrecognized_group_role: 1,
        invalid_guardian_signins: 1,
        invalid_client_id: 0,
        detail_fetch_failed: 4,
      },
      detail_http_status_counts: { '404': 1, '503': 4 },
    });
    expect(Object.values(diagnostic.unclassified_reasons).reduce((sum: number, n) => sum + Number(n), 0))
      .toBe(diagnostic.unclassified_total);
    expect(http).toHaveBeenCalledTimes(18);
    expect(http.mock.calls.some(([, init]) => init.method === 'POST')).toBe(false);
  });

  it('aborts a stalled response body at the whole-request deadline and never writes later', async () => {
    let resolveBody!: (value: unknown) => void;
    const body = new Promise((resolve) => { resolveBody = resolve; });
    const http = vi.fn().mockResolvedValueOnce(response(page([active])))
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), arrayBuffer: () => body });
    vi.stubGlobal('fetch', http);
    const pending = handleRequest(request());
    await vi.advanceTimersByTimeAsync(55_000);
    const out = await pending;
    expect(out.status).toBe(502);
    expect(await out.json()).toEqual({ error: 'sync_failed', code: 'timeout' });
    expect(http.mock.calls[1][1].signal.aborted).toBe(true);
    resolveBody(new TextEncoder().encode(JSON.stringify({ group: { group_role: 'Member' } })).buffer);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('rejects duplicate identities across pages during the independent final scan', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ ...active, id: i + 1 }));
    const http = vi.fn().mockResolvedValueOnce(response(page(full, 1, true)))
      .mockResolvedValueOnce(response(page([active], 2, false)));
    vi.stubGlobal('fetch', http);
    expect((await handleRequest(request('finalize'))).status).toBe(502);
    expect(http).toHaveBeenCalledTimes(2);
  });

  it.each(['2026-09-09T10:59:59Z', 'invalid'])('does not publish stale drafts (%s)', async (created_at) => {
    const http = vi.fn().mockResolvedValueOnce(response(page([active], 1, false)))
      .mockResolvedValueOnce(response([{ ...storedDraft, created_at }]));
    vi.stubGlobal('fetch', http);
    expect((await handleRequest(request('finalize'))).status).toBe(409);
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('publishes a fresh complete run, preserving legacy aggregates and the same-day dues payload', async () => {
    const http = vi.fn().mockResolvedValueOnce(response(page([active], 1, false)))
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
