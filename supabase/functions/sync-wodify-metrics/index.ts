// sync-wodify-metrics Edge Function (docs/wo-wodify-monthly-sync.md Phase B).
//
// THIN SHELL: gate + run state + Wodify fetches + persistence. Every metric
// formula, the New York month windows, the GET-only Wodify client and the
// aggregate-only row contract live in the typechecked, vitest-covered
// src/lib/gym/wodifyMonthlyMetrics.ts (explicit `.ts` import, same Option A as
// sync-wodify-retention). Raw Wodify rows are transient in memory inside one
// request; only aggregate rows (counts / sums / rates) are written. Zero
// `console.*`: diagnostics are fixed-vocabulary codes and counts in the run row.
//
// Gate: POST only → x-metrics-token checked by public.wodify_metrics_check_token
// (Vault-backed, service_role-only RPC) → FAIL CLOSED on any error. Callers are
// pg_cron / an operator via public.wodify_metrics_start(), which reads the token
// from Vault; the token never appears in the repo or a GitHub secret.
//
// Run model: `start` creates a wodify_metrics_runs row with an ordered task list
// and returns 202; the work runs in the background (EdgeRuntime.waitUntil). Each
// link executes tasks until ~100 s have elapsed, stores each task's aggregate
// rows in wodify_metrics_run_tasks, then POSTs `continue` to itself. When no task
// is pending, finalize merges task rows + v3 census rows and replaces the run's
// months in public.wodify_monthly_metrics atomically (RPC).

import {
  CANCEL_CHUNKS,
  WodifyHttpError,
  WodifyRateLimitError,
  assertAggregateRows,
  cancellationMetrics,
  conversionDate,
  conversionMetrics,
  createWodifyClient,
  derivedMetrics,
  fetchAll,
  funnelMetrics,
  invoiceMetrics,
  isMonthKey,
  leadsCreatedMetrics,
  membershipMetrics,
  mergeTaskRows,
  monthWindow,
  monthsForKind,
  nyDate,
  observeClientDetail,
  rejoinClientIds,
  signinMetrics,
  toDbRows,
  v3Metrics,
  validateMonths,
  type CancellationObservation,
  type MetricRow,
  type MonthKey,
  type RunKind,
  type WodifyClient,
} from '../../../src/lib/gym/wodifyMonthlyMetrics.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const FUNCTION_NAME = 'sync-wodify-metrics';
const LINK_TASK_START_BUDGET_MS = 100_000; // start another task only while the link is younger than this
const STALE_RUN_MS = 20 * 60_000; // a running run without progress for this long is abandoned
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Env = { url: string; serviceKey: string; wodifyKey: string };
type Rec = Record<string, unknown>;
type TaskState = { key: string; status: 'pending' | 'done'; calls: number; ms: number };
type RunRow = {
  run_id: string; kind: RunKind; months: MonthKey[]; status: string; calls_made: number;
  rate_limited: number; links: number; tasks: TaskState[];
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function readEnv(): Env | null {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const wodifyKey = Deno.env.get('WODIFY_API_KEY');
  return url && serviceKey && wodifyKey ? { url, serviceKey, wodifyKey } : null;
}

async function rest(env: Env, path: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<unknown> {
  const res = await fetch(`${env.url}/rest/v1/${path}`, {
    method: init.method ?? 'GET',
    headers: {
      apikey: env.serviceKey,
      Authorization: `Bearer ${env.serviceKey}`,
      'Content-Type': 'application/json',
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!res.ok) throw new Error(`persist_http_${res.status}`); // status only, never the body
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function checkToken(env: Env, token: string): Promise<boolean> {
  if (token.length < 32) return false;
  try {
    return (await rest(env, 'rpc/wodify_metrics_check_token', { method: 'POST', body: { t: token } })) === true;
  } catch {
    return false; // fail closed
  }
}

export function taskPlan(months: MonthKey[]): TaskState[] {
  const keys = ['core', 'funnel', ...Array.from({ length: CANCEL_CHUNKS }, (_, k) => `cancel:${k}`), ...months.map((m) => `inv:${m}`)];
  return keys.map((key) => ({ key, status: 'pending', calls: 0, ms: 0 }));
}

export function parseMetricsRequest(raw: unknown, now: Date):
  | { mode: 'start'; kind: RunKind; months: MonthKey[] }
  | { mode: 'continue'; runId: string }
  | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Rec;
  if (r.mode === 'continue') return typeof r.run_id === 'string' && UUID_RE.test(r.run_id) ? { mode: 'continue', runId: r.run_id } : null;
  if (r.mode !== 'start') return null;
  if (r.kind === 'weekly' || r.kind === 'close' || r.kind === 'backfill') {
    if (r.months !== undefined && r.months !== null) return null;
    return { mode: 'start', kind: r.kind, months: monthsForKind(r.kind, now) };
  }
  if (r.kind === 'manual') {
    const months = validateMonths(r.months, now);
    return months ? { mode: 'start', kind: 'manual', months } : null;
  }
  return null;
}

export function classifyMetricsError(err: unknown): string {
  if (err instanceof WodifyRateLimitError) return 'wodify_http_429';
  if (err instanceof WodifyHttpError) return err.code;
  const msg = err instanceof Error ? err.message : '';
  if (/^persist_http_\d{3}$/.test(msg)) return msg;
  if (['aggregate_contract_violation', 'duplicate_metric_row', 'chain_failed', 'run_not_found'].includes(msg)) return msg;
  return 'internal_error';
}

function background(work: Promise<unknown>): void {
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work);
  else void work;
}

async function getRun(env: Env, runId: string): Promise<RunRow | null> {
  const rows = await rest(env, `wodify_metrics_runs?run_id=eq.${runId}&select=run_id,kind,months,status,calls_made,rate_limited,links,tasks`);
  return Array.isArray(rows) && rows.length === 1 ? (rows[0] as RunRow) : null;
}

async function patchRun(env: Env, runId: string, patch: Rec): Promise<void> {
  await rest(env, `wodify_metrics_runs?run_id=eq.${runId}`, {
    method: 'PATCH', body: { ...patch, updated_at: new Date().toISOString() }, prefer: 'return=minimal',
  });
}

// ─── Tasks ──────────────────────────────────────────────────────────────────

type TaskResult = { rows: MetricRow[]; diagnostics: Record<string, number> };

async function clientDetail(client: WodifyClient, id: unknown): Promise<unknown> {
  return client.get(`/clients/${encodeURIComponent(String(id))}`);
}

async function runTask(key: string, months: MonthKey[], client: WodifyClient, todayNy: string): Promise<TaskResult> {
  if (key === 'core') {
    const clients = await fetchAll(client, '/clients/search', { q: 'id|gt|0' }, 100);
    const memberships = await fetchAll(client, '/memberships/search', { q: 'id|gt|0' }, 100);
    const leads = await fetchAll(client, '/leads/search', { q: 'id|gt|0' }, 100);
    const earliest = monthWindow(months[0]).startDate;
    const details = new Map<string, unknown>(); // transient, this request only
    const detail = async (id: string) => {
      if (!details.has(id)) details.set(id, await clientDetail(client, id));
      return details.get(id);
    };
    // Conversion → lead link (lead_id is only on the client detail).
    const leadIdByClient = new Map<string, string>();
    let missingLeadId = 0;
    for (const c of clients) {
      const conv = conversionDate(c);
      if (!conv || conv < earliest) continue;
      const d = await detail(String(c.id));
      const leadId = typeof d === 'object' && d !== null ? (d as Rec).lead_id : null;
      if ((typeof leadId === 'number' && leadId > 0) || (typeof leadId === 'string' && /^[1-9]\d*$/.test(leadId))) {
        leadIdByClient.set(String(c.id), String(leadId));
      } else missingLeadId += 1;
    }
    // Cancelled-then-returned clients are Active today; the non-active scan in the
    // cancel:* tasks misses them, so check Active clients with a rejoin since `earliest`.
    const rejoined = rejoinClientIds(memberships, earliest);
    const observations: CancellationObservation[] = [];
    for (const c of clients) {
      if (c.client_status !== 'Active' || !rejoined.has(String(c.id))) continue;
      observations.push(observeClientDetail(await detail(String(c.id))));
    }
    const rows = [
      ...leadsCreatedMetrics(leads, months),
      ...membershipMetrics(memberships, clients, months, todayNy),
      ...conversionMetrics({ clients, memberships, leads, leadIdByClient }, months),
      ...cancellationMetrics(observations, months),
    ];
    return {
      rows,
      diagnostics: {
        clients: clients.length, memberships: memberships.length, leads: leads.length,
        conversion_details: leadIdByClient.size + missingLeadId, conversions_missing_lead_id: missingLeadId,
        reactivation_details: observations.length,
      },
    };
  }
  if (key === 'funnel') {
    const q = `local_class_start_datetime|gte|${monthWindow(months[0]).startDate};local_class_start_datetime|lt|${monthWindow(months[months.length - 1]).endDate}`;
    const reservations = await fetchAll(client, '/classes/reservations/leads/search', { q }, 1000);
    const leadSignins = await fetchAll(client, '/classes/sign-ins/leads/search', { q }, 1000);
    const clientSignins = await fetchAll(client, '/classes/sign-ins/clients/search', { q }, 1000);
    return {
      rows: [...funnelMetrics(reservations, leadSignins, months), ...signinMetrics(clientSignins, months)],
      diagnostics: { lead_reservations: reservations.length, lead_signins: leadSignins.length, client_signins: clientSignins.length },
    };
  }
  const cancel = /^cancel:(\d+)$/.exec(key);
  if (cancel) {
    const chunk = Number(cancel[1]);
    const clients = await fetchAll(client, '/clients/search', { q: 'id|gt|0' }, 100);
    const observations: CancellationObservation[] = [];
    let unclassified = 0;
    let emptyHistory = 0;
    for (const c of clients) {
      const id = Number(c.id);
      if (c.client_status === 'Active' || !Number.isSafeInteger(id) || id % CANCEL_CHUNKS !== chunk) continue;
      const o = observeClientDetail(await clientDetail(client, id));
      if (o.classification.kind === 'unclassified') unclassified += 1;
      if (!Array.isArray(o.statusHistory) || o.statusHistory.length === 0) emptyHistory += 1;
      observations.push(o);
    }
    return {
      rows: cancellationMetrics(observations, months),
      diagnostics: { checked: observations.length, unclassified, empty_history: emptyHistory },
    };
  }
  const inv = /^inv:(\d{4}-\d{2})$/.exec(key);
  if (inv && isMonthKey(inv[1])) {
    const w = monthWindow(inv[1]);
    const list = await fetchAll(client, '/financials/invoices/search', { q: `payment_due|gte|${w.startDate};payment_due|lt|${w.endDate}` }, 100);
    const details: Rec[] = [];
    let lines = 0;
    let uncategorized = 0;
    for (const row of list) {
      const d = await client.get(`/financials/invoices/${encodeURIComponent(String(row.id))}`);
      if (typeof d !== 'object' || d === null || Array.isArray(d)) throw new WodifyHttpError('wodify_shape');
      const ls = Array.isArray((d as Rec).invoice_details) ? ((d as Rec).invoice_details as Rec[]) : [];
      lines += ls.length;
      uncategorized += ls.filter((l) => !l || !l.revenue_category).length;
      details.push(d as Rec);
    }
    return { rows: invoiceMetrics(details, inv[1], todayNy), diagnostics: { invoices: list.length, lines, lines_without_category: uncategorized } };
  }
  throw new Error('internal_error');
}

// ─── Finalize ───────────────────────────────────────────────────────────────

async function finalize(env: Env, run: RunRow): Promise<void> {
  const tasks = await rest(env, `wodify_metrics_run_tasks?run_id=eq.${run.run_id}&select=task_key,rows,diagnostics`);
  const lists = (Array.isArray(tasks) ? tasks : []).map((t) => (t as Rec).rows as MetricRow[]);
  const first = monthWindow(run.months[0]).startDate;
  const end = monthWindow(run.months[run.months.length - 1]).endDate;
  const v3Rows = await rest(env,
    'wodify_retention_aggregate?select=as_of,active_total,student_total,guardian_only_total,students_by_path,'
    + 'unclassified_total,detail_clients_failed,pages_expected,pages_completed,student_retention'
    + `&workspace_id=eq.default&as_of=gte.${first}&as_of=lt.${end}&order=as_of.desc`);
  for (const list of lists) assertAggregateRows(list);
  const merged = mergeTaskRows([...lists, v3Metrics(Array.isArray(v3Rows) ? (v3Rows as Rec[]) : [], run.months)]);
  const all = [...merged, ...derivedMetrics(merged)];
  assertAggregateRows(all);
  const written = await rest(env, 'rpc/wodify_metrics_replace_months', {
    method: 'POST',
    body: { p_run_id: run.run_id, p_months: run.months.map((m) => `${m}-01`), p_rows: toDbRows(all) },
  });
  const diagnostics: Record<string, number> = {};
  for (const t of Array.isArray(tasks) ? tasks : []) {
    for (const [k, v] of Object.entries(((t as Rec).diagnostics ?? {}) as Record<string, number>)) {
      if (typeof v === 'number') diagnostics[k] = (diagnostics[k] ?? 0) + v;
    }
  }
  diagnostics.rows_written = typeof written === 'number' ? written : all.length;
  await patchRun(env, run.run_id, { status: 'succeeded', finished_at: new Date().toISOString(), diagnostics });
}

// ─── Links ──────────────────────────────────────────────────────────────────

async function chainNext(env: Env, token: string, runId: string): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${env.url}/functions/v1/${FUNCTION_NAME}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-metrics-token': token },
        body: JSON.stringify({ mode: 'continue', run_id: runId }),
      });
      await res.body?.cancel();
      if (res.status === 202) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  throw new Error('chain_failed');
}

export type LinkDeps = { now?: () => number; makeClient?: (apiKey: string) => WodifyClient };

export async function runLink(env: Env, token: string, runId: string, deps: LinkDeps = {}): Promise<void> {
  const now = deps.now ?? (() => Date.now());
  const started = now();
  const run = await getRun(env, runId);
  if (!run || run.status !== 'running') return;
  const client = (deps.makeClient ?? ((apiKey: string) => createWodifyClient({ apiKey })))(env.wodifyKey);
  let committed = 0; // Wodify calls already recorded on the run row
  await patchRun(env, runId, { links: run.links + 1 });
  try {
    for (;;) {
      const next = run.tasks.find((t) => t.status === 'pending');
      if (!next) { await finalize(env, run); return; }
      if (now() - started > LINK_TASK_START_BUDGET_MS) { await chainNext(env, token, runId); return; }
      const t0 = now();
      const before = client.stats.calls;
      const todayNy = nyDate(new Date())!;
      const result = await runTask(next.key, run.months, client, todayNy);
      assertAggregateRows(result.rows);
      const calls = client.stats.calls - before;
      await rest(env, 'wodify_metrics_run_tasks?on_conflict=run_id,task_key', {
        method: 'POST',
        body: { run_id: runId, task_key: next.key, calls, rows: result.rows, diagnostics: result.diagnostics, finished_at: new Date().toISOString() },
        prefer: 'return=minimal,resolution=merge-duplicates',
      });
      next.status = 'done';
      next.calls = calls;
      next.ms = now() - t0;
      run.calls_made += calls;
      committed = client.stats.calls;
      await patchRun(env, runId, { tasks: run.tasks, calls_made: run.calls_made, rate_limited: run.rate_limited + client.stats.rateLimited });
    }
  } catch (err) {
    await patchRun(env, runId, {
      status: 'failed', error: classifyMetricsError(err), finished_at: new Date().toISOString(),
      calls_made: run.calls_made + (client.stats.calls - committed), rate_limited: run.rate_limited + client.stats.rateLimited,
    }).catch(() => undefined);
  }
}

// ─── Handler ────────────────────────────────────────────────────────────────

export async function handleRequest(req: Request, deps: LinkDeps = {}): Promise<Response> {
  try {
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    const env = readEnv();
    if (!env) return json(500, { error: 'internal_error' });
    const token = req.headers.get('x-metrics-token') ?? '';
    if (!(await checkToken(env, token))) return json(403, { error: 'forbidden' });

    let body: unknown;
    try { body = await req.json(); } catch { return json(400, { error: 'invalid_request' }); }
    const parsed = parseMetricsRequest(body, new Date());
    if (!parsed) return json(400, { error: 'invalid_request' });

    if (parsed.mode === 'continue') {
      background(runLink(env, token, parsed.runId, deps));
      return json(202, { ok: true, run_id: parsed.runId });
    }

    // One run at a time; a run with no progress for STALE_RUN_MS is abandoned.
    const running = await rest(env, 'wodify_metrics_runs?status=eq.running&select=run_id,updated_at');
    for (const r of Array.isArray(running) ? (running as Rec[]) : []) {
      if (Date.now() - Date.parse(String(r.updated_at)) < STALE_RUN_MS) return json(409, { error: 'run_in_progress' });
      await patchRun(env, String(r.run_id), { status: 'abandoned', finished_at: new Date().toISOString(), error: 'stale_run' });
    }
    const runId = crypto.randomUUID();
    const tasks = taskPlan(parsed.months);
    await rest(env, 'wodify_metrics_runs', {
      method: 'POST', prefer: 'return=minimal',
      body: { run_id: runId, kind: parsed.kind, months: parsed.months, status: 'running', tasks },
    });
    background(runLink(env, token, runId, deps));
    return json(202, { ok: true, run_id: runId, kind: parsed.kind, months: parsed.months, tasks: tasks.length });
  } catch (err) {
    return json(502, { error: 'sync_failed', code: classifyMetricsError(err) });
  }
}

Deno.serve((req) => handleRequest(req));
