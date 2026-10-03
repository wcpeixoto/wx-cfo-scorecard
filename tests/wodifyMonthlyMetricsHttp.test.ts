import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWodifyClient } from '../src/lib/gym/wodifyMonthlyMetrics';

// Synthetic fixtures only. Exercises the real handler + run loop against an
// in-memory fake of Supabase REST and the Wodify API — no network, no secrets.

const SUPA = 'https://storage.invalid';
const TOKEN = 'a'.repeat(64);

type Call = { url: string; method: string; body: unknown };
let calls: Call[];
let tokenOk: boolean;
let runs: Map<string, Record<string, unknown>>;
let taskRows: Map<string, Record<string, unknown>>;
let replaced: Record<string, unknown> | null;

const ok = (v: unknown, status = 200) => new Response(v === undefined ? null : JSON.stringify(v), { status });
const created = (s: string) => ({ created_on: { created_on_datetime: s }, created: { created_on_datetime: s } });
const PERSON = { first_name: 'Jane', last_name: 'Roe', email: 'jane@example.com', phone_number: '5555550100' };

const wodify: Record<string, unknown> = {
  '/clients/search': { clients: [
    { id: 5516931, client_status: 'Active', is_converted_from_lead: true, default_program: 'Kids BJJ', ...created('2026-09-01T22:05:00Z'), ...PERSON },
    { id: 5516932, client_status: 'Inactive', is_converted_from_lead: false, default_program: 'Adults BJJ', ...created('2025-06-01T12:00:00Z'), ...PERSON },
  ], pagination: { page: 1, has_more: false } },
  '/memberships/search': { memberships: [
    { id: 1, client_id: 5516931, membership_type: 'Class Plan', start_date: '2026-09-01', end_date: '2026-10-01', renewed_from_membership_id: 0, name: 'Kids Monthly Unlimited ' },
  ], pagination: { page: 1, has_more: false } },
  '/leads/search': { leads: [{ id: 5343719, tags: ['META ADS'], created_from_source: 'API', ...created('2026-08-27T14:59:39Z'), ...PERSON }], pagination: { page: 1, has_more: false } },
  '/classes/reservations/leads/search': { reservations: [{ lead_id: 5343719, reservation_status: 'Signed In', local_class_start_datetime: '2026-08-28T18:00:00' }], pagination: { has_more: false } },
  '/classes/sign-ins/leads/search': { signins: [{ lead_id: 5343719, local_class_start_datetime: '2026-08-28T18:00:00' }], pagination: { has_more: false } },
  '/classes/sign-ins/clients/search': { signins: [{ client_id: 5516931, class_id: 9, class: 'Kids BJJ', program: 'Kids', local_class_start_datetime: '2026-09-07T17:00:00' }], pagination: { has_more: false } },
  '/financials/invoices/search': { invoices: [{ id: 98848933 }], pagination: { has_more: false } },
  '/financials/invoices/98848933': { id: 98848933, invoice_header_status: 'Paid', payment_due: '2026-09-01', final_charge: 150, paid_amount: 150, unpaid_amount: 0, final_refunded_amount: 0, is_auto_bill: true, invoice_details: [{ revenue_category: 'Membership Sales', post_header_net_revenue: 150 }] },
  '/clients/5516931': { id: 5516931, lead_id: 5343719, status_history: [], group: { group_id: 1, group_role: 'Dependent' }, total_class_sign_ins: 4, ...PERSON },
  '/clients/5516932': { id: 5516932, status_history: [{ from_status: 'Active', to_status: 'Inactive', status_change_datetime: '2026-09-10T15:00:00Z' }], group: { group_id: 1, group_role: 'Member' }, total_class_sign_ins: 30, ...PERSON },
};

function route(url: string, init: RequestInit = {}): Response {
  const method = (init.method ?? 'GET').toUpperCase();
  const body = typeof init.body === 'string' && init.body ? JSON.parse(init.body) : undefined;
  calls.push({ url, method, body });
  const u = new URL(url);
  if (u.hostname === 'api.wodify.com') {
    const path = u.pathname.replace('/v1', '');
    if (path === '/financials/invoices/search' && u.searchParams.get('q')?.includes('2026-08-01')) return ok({ invoices: [], pagination: { has_more: false } });
    return wodify[path] ? ok(wodify[path]) : ok({}, 404);
  }
  const p = u.pathname.replace('/rest/v1/', '');
  if (p === 'rpc/wodify_metrics_check_token') return ok(tokenOk);
  if (p === 'rpc/wodify_metrics_replace_months') { replaced = body; return ok((body.p_rows as unknown[]).length); }
  if (p === 'wodify_metrics_runs') {
    const id = u.searchParams.get('run_id')?.replace('eq.', '');
    if (method === 'POST') { runs.set(body.run_id, { calls_made: 0, rate_limited: 0, links: 0, ...body }); return ok(undefined, 201); }
    if (method === 'PATCH') { Object.assign(runs.get(id!)!, body); return ok(undefined, 204); }
    if (u.searchParams.get('status') === 'eq.running') return ok([]);
    return ok(id && runs.has(id) ? [runs.get(id)] : []);
  }
  if (p === 'wodify_metrics_run_tasks') {
    if (method === 'POST') { taskRows.set(body.task_key, body); return ok(undefined, 201); }
    return ok([...taskRows.values()]);
  }
  if (p === 'wodify_retention_aggregate') return ok([]);
  return ok({}, 404);
}

let handleRequest: typeof import('../supabase/functions/sync-wodify-metrics/index.ts').handleRequest;
let pending: Promise<unknown>[];
const deps = { now: () => 0, makeClient: (k: string) => createWodifyClient({ apiKey: k, cadenceMs: 0 }) };
const drain = async () => { while (pending.length) await pending.shift(); };
const post = (body: unknown, token = TOKEN) => new Request('https://example.invalid/sync', {
  method: 'POST', headers: { 'x-metrics-token': token }, body: JSON.stringify(body),
});

beforeEach(async () => {
  calls = []; tokenOk = true; runs = new Map(); taskRows = new Map(); replaced = null; pending = [];
  vi.stubGlobal('EdgeRuntime', { waitUntil: (p: Promise<unknown>) => { pending.push(p); } });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-05T15:00:00Z'));
  vi.stubGlobal('Deno', { env: { get: (k: string) => (k === 'SUPABASE_URL' ? SUPA : `synthetic-${k}`) }, serve: vi.fn() });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => route(String(url), init)));
  ({ handleRequest } = await import('../supabase/functions/sync-wodify-metrics/index.ts'));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('sync-wodify-metrics gate', () => {
  it('rejects non-POST before any work', async () => {
    expect((await handleRequest(new Request('https://x.invalid', { method: 'GET' }))).status).toBe(405);
    expect(calls).toHaveLength(0);
  });
  it.each([['short token', 'abc', true], ['RPC says no', TOKEN, false]])('fails closed: %s', async (_l, token, rpc) => {
    tokenOk = rpc;
    const res = await handleRequest(post({ mode: 'start', kind: 'weekly' }, token));
    expect(res.status).toBe(403);
    expect(calls.some((c) => c.url.includes('api.wodify.com'))).toBe(false);
  });
  it('rejects malformed requests', async () => {
    expect((await handleRequest(post({ mode: 'start', kind: 'manual', months: ['2025-04'] }))).status).toBe(400);
    expect((await handleRequest(post({ mode: 'start', kind: 'weekly', months: ['2026-09'] }))).status).toBe(400);
  });
});

describe('sync-wodify-metrics run', () => {
  it('starts a weekly run for the previous + current NY month and completes it with GET-only Wodify calls', async () => {
    const res = await handleRequest(post({ mode: 'start', kind: 'manual', months: ['2026-08', '2026-09'] }), deps);
    expect(res.status).toBe(202);
    const { run_id: runId } = await res.json();
    await drain(); // the background link (EdgeRuntime.waitUntil)

    const run = runs.get(runId)!;
    expect(run.status).toBe('succeeded');
    const wodifyCalls = calls.filter((c) => c.url.includes('api.wodify.com'));
    expect(wodifyCalls.length).toBeGreaterThan(0);
    expect(wodifyCalls.every((c) => c.method === 'GET')).toBe(true);
    expect(run.calls_made).toBe(wodifyCalls.length);

    const rows = (replaced!.p_rows as Record<string, unknown>[]);
    const get = (k: string, m: string, d = 'all') => rows.find((r) => r.metric_key === k && r.period_month === m && r.dimension === d)?.value;
    expect(replaced!.p_months).toEqual(['2026-08-01', '2026-09-01']);
    expect(get('leads_created', '2026-08-01')).toBe(1);
    expect(get('leads_converted_raw', '2026-09-01')).toBe(1);
    expect(get('leads_enrolled', '2026-09-01')).toBe(1);
    expect(get('new_students', '2026-09-01')).toBe(1);
    expect(get('cancellations', '2026-09-01')).toBe(1);
    expect(get('trial_unique_leads_showed', '2026-08-01')).toBe(1);
    expect(get('revenue_by_category', '2026-09-01', 'category:Membership Sales')).toBe(150);

    const stored = JSON.stringify([replaced, [...taskRows.values()], run]);
    for (const s of ['Jane', 'jane@example.com', '5555550100', '5516931', '5516932', '5343719', '98848933']) expect(stored).not.toContain(s);
  });

  it('marks the run failed with a fixed code on a Wodify 429 and writes no metrics', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) =>
      String(url).includes('api.wodify.com') ? new Response('', { status: 429 }) : route(String(url), init)));
    const res = await handleRequest(post({ mode: 'start', kind: 'manual', months: ['2026-09'] }), deps);
    const { run_id: runId } = await res.json();
    await drain();
    expect(runs.get(runId)).toMatchObject({ status: 'failed', error: 'wodify_http_429', calls_made: 1, rate_limited: 1 });
    expect(replaced).toBeNull();
  });
});
