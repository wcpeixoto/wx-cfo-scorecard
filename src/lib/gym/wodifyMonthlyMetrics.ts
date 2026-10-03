// Wodify monthly metrics (docs/wo-wodify-monthly-sync.md; every formula is
// written out in docs/wodify-metrics.md and this module must match it).
//
// Pure, runtime-agnostic logic. The sync-wodify-metrics Edge Function owns HTTP
// and persistence; this module owns New York month windows, the GET-only Wodify
// client, every metric formula, and the aggregate-only row contract. Person-level
// Wodify rows enter as transient input and never leave: every builder returns
// MetricRow[] (counts, sums, rates). No name, email, phone or person id is ever
// returned, persisted or logged.

import { classifyActiveClientDetail, type CensusClassification } from './wodifyStudentCensus.ts';
import { studentRetentionFromRow, type StudentRetentionAggregate } from './studentRetentionAggregate.ts';
import { resolveSilentChurnThresholdDays } from './silentChurn.ts';

export const GYM_TZ = 'America/New_York';
// Wodify activity starts here (Phase A: leads, sign-ins and conversions are ~0
// before May 2025). Earlier months are out of range.
export const FIRST_MONTH = '2025-05';
export const MAX_RUN_MONTHS = 24;
export const ENROLL_WINDOW_DAYS = 30;
export const CANCEL_CHUNKS = 3;

// ─── Months (New York) ──────────────────────────────────────────────────────

export type MonthKey = string; // 'YYYY-MM'

export type MonthWindow = {
  month: MonthKey;
  startDate: string; // local calendar date 'YYYY-MM-01' (for local / date-only fields)
  endDate: string; // next month's 'YYYY-MM-01' (exclusive)
  startUtc: string; // NY midnight as a UTC instant (for UTC-instant fields)
  endUtc: string;
};

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})/;

export function isMonthKey(value: unknown): value is MonthKey {
  return typeof value === 'string' && MONTH_RE.test(value);
}

export function addMonths(month: MonthKey, n: number): MonthKey {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthRange(from: MonthKey, to: MonthKey): MonthKey[] {
  const out: MonthKey[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

const nyParts = new Intl.DateTimeFormat('en-US', {
  timeZone: GYM_TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

// Minutes NY wall time is ahead of UTC at this instant (-240 in EDT, -300 in EST).
function nyOffsetMinutes(utcMs: number): number {
  const p = Object.fromEntries(nyParts.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((wall - Math.floor(utcMs / 1000) * 1000) / 60000);
}

/** UTC instant of 00:00 New York time on a local calendar date. */
export function nyMidnightUtc(ymd: string): string {
  const m = YMD_RE.exec(ymd);
  if (!m) throw new Error('invalid_date');
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  let utc = guess - nyOffsetMinutes(guess) * 60000;
  utc = guess - nyOffsetMinutes(utc) * 60000; // re-check across a DST edge
  return new Date(utc).toISOString();
}

export function monthWindow(month: MonthKey): MonthWindow {
  if (!isMonthKey(month)) throw new Error('invalid_month');
  const next = addMonths(month, 1);
  const startDate = `${month}-01`;
  const endDate = `${next}-01`;
  return { month, startDate, endDate, startUtc: nyMidnightUtc(startDate), endUtc: nyMidnightUtc(endDate) };
}

function parseInstant(value: unknown): number | null {
  if (typeof value !== 'string' || !YMD_RE.test(value)) return null;
  // Wodify instants carry 'Z'; a bare datetime is treated as UTC, never local.
  const iso = /[zZ]$|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

const nyDateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: GYM_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** New York calendar date of a UTC instant (string or Date). */
export function nyDate(value: unknown): string | null {
  const ms = value instanceof Date ? value.getTime() : parseInstant(value);
  return ms === null || !Number.isFinite(ms) ? null : nyDateFmt.format(new Date(ms));
}

/** Month of a UTC-instant field, in New York time. */
export function nyMonthOfInstant(value: unknown): MonthKey | null {
  return nyDate(value)?.slice(0, 7) ?? null;
}

/** Month of a local-time or date-only field (already New York wall time). */
export function localMonth(value: unknown): MonthKey | null {
  return typeof value === 'string' && YMD_RE.test(value) ? value.slice(0, 7) : null;
}

function localDate(value: unknown): string | null {
  return typeof value === 'string' && YMD_RE.test(value) ? value.slice(0, 10) : null;
}

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${a.slice(0, 10)}T00:00:00Z`) - Date.parse(`${b.slice(0, 10)}T00:00:00Z`)) / 86_400_000);
}

export type RunKind = 'weekly' | 'close' | 'backfill' | 'manual';

/** weekly = previous + current month; close = the two months before the current one
 *  (the 30-day enrollment window of the older one has then closed); backfill = all. */
export function monthsForKind(kind: Exclude<RunKind, 'manual'>, now: Date): MonthKey[] {
  const current = nyDate(now)!.slice(0, 7);
  if (kind === 'weekly') return [addMonths(current, -1), current];
  if (kind === 'close') return [addMonths(current, -2), addMonths(current, -1)];
  return monthRange(FIRST_MONTH, current);
}

/** Explicit months: unique, sorted, inside [FIRST_MONTH, current], at most MAX_RUN_MONTHS. */
export function validateMonths(raw: unknown, now: Date): MonthKey[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_RUN_MONTHS) return null;
  const current = nyDate(now)!.slice(0, 7);
  if (!raw.every((m) => isMonthKey(m) && m >= FIRST_MONTH && m <= current)) return null;
  return [...new Set(raw as MonthKey[])].sort();
}

// ─── GET-only Wodify client ─────────────────────────────────────────────────

export const WODIFY_BASE_URL = 'https://api.wodify.com/v1';
// The API key can write to Wodify. Only GET may ever leave this client.
export const ALLOWED_WODIFY_METHODS: ReadonlySet<string> = new Set(['GET']);

export class WodifyMethodNotAllowedError extends Error {}
export class WodifyRateLimitError extends Error {}
export class WodifyHttpError extends Error {
  constructor(readonly code: string) { super(code); }
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;

export type WodifyClientOptions = {
  apiKey: string;
  fetchImpl?: FetchLike;
  cadenceMs?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
};

export type WodifyClient = {
  get: (path: string, params?: Record<string, string | number>) => Promise<unknown>;
  request: (method: string, path: string, params?: Record<string, string | number>) => Promise<unknown>;
  stats: { calls: number; rateLimited: number };
};

export function createWodifyClient(options: WodifyClientOptions): WodifyClient {
  const fetchImpl: FetchLike = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const cadenceMs = options.cadenceMs ?? 350;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const maxAttempts = options.maxAttempts ?? 3;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const stats = { calls: 0, rateLimited: 0 };
  let last = 0;

  async function request(method: string, path: string, params: Record<string, string | number> = {}): Promise<unknown> {
    // Method allowlist first — before any URL, key or network work.
    if (!ALLOWED_WODIFY_METHODS.has(method)) throw new WodifyMethodNotAllowedError(`wodify_method_not_allowed:${method}`);
    if (!path.startsWith('/') || path.includes('..') || path.includes('?')) throw new WodifyHttpError('wodify_bad_path');
    const url = new URL(WODIFY_BASE_URL + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

    for (let attempt = 1; ; attempt++) {
      const wait = last + cadenceMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      let res: Response;
      try {
        res = await fetchImpl(url.toString(), {
          method: 'GET',
          headers: { 'x-api-key': options.apiKey, accept: 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        stats.calls += 1;
        if (attempt < maxAttempts) continue;
        throw new WodifyHttpError('wodify_network');
      }
      stats.calls += 1;
      // 429 is a stop condition (WO): abort immediately, never retry.
      if (res.status === 429) { stats.rateLimited += 1; throw new WodifyRateLimitError('wodify_http_429'); }
      if (res.status >= 500 && attempt < maxAttempts) continue;
      if (!res.ok) throw new WodifyHttpError(`wodify_http_${res.status >= 500 ? '5xx' : '4xx'}`);
      let body: unknown;
      try { body = await res.json(); } catch {
        if (attempt < maxAttempts) continue;
        throw new WodifyHttpError('wodify_json');
      }
      // Wodify returns some errors as a 2xx envelope; never read its message text.
      if (isRecord(body) && 'ErrorCode' in body) throw new WodifyHttpError('wodify_api_error');
      return body;
    }
  }

  return { get: (path, params) => request('GET', path, params), request, stats };
}

/** Paginate a list/search endpoint; rows come from the first array-valued key. */
export async function fetchAll(
  client: WodifyClient, path: string, params: Record<string, string | number>, pageSize: number, maxPages = 400,
): Promise<Rec[]> {
  const rows: Rec[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const body = await client.get(path, { ...params, page, page_size: pageSize });
    if (!isRecord(body)) throw new WodifyHttpError('wodify_shape');
    const key = Object.keys(body).find((k) => Array.isArray(body[k]));
    const arr = key ? (body[key] as unknown[]) : [];
    for (const r of arr) if (isRecord(r)) rows.push(r);
    const pagination = isRecord(body.pagination) ? body.pagination : null;
    if (pagination?.has_more !== true || arr.length === 0) return rows;
  }
  throw new WodifyHttpError('wodify_page_cap');
}

// ─── Row contract ───────────────────────────────────────────────────────────

export const METRIC_KEYS = [
  'leads_created', 'trial_bookings', 'trial_unique_leads_booked', 'trial_unique_leads_showed',
  'leads_converted_raw', 'leads_enrolled', 'cohort_leads_enrolled', 'cohort_conversion_rate',
  'lead_to_enroll_days_median', 'active_students', 'silent_students', 'students_unknown_recency',
  'new_students', 'rejoins', 'plan_switches', 'cancellations', 'cancellations_all_clients',
  'signins_total', 'signins_unique_clients', 'visits_per_active_student', 'class_slot_avg_attendance',
  'invoices_due_count', 'invoices_due_amount', 'billed_paid', 'billed_unpaid', 'autopay_failed',
  'refunds', 'revenue_by_category', 'plan_mix', 'avg_monthly_price',
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export type MetricRow = {
  month: MonthKey;
  key: MetricKey;
  dim: string; // 'all' or '<family>:<catalog value>'
  value: number;
  sourceAsOf: string | null; // v3 snapshot date for v3-derived rows, else null
};

const ROW_KEYS = ['month', 'key', 'dim', 'value', 'sourceAsOf'];
const SUMMABLE: ReadonlySet<MetricKey> = new Set(['cancellations', 'cancellations_all_clients']);
const DIM_RE = /^(all|[a-z_]+:.{1,90})$/;

/** Throws unless every row is an aggregate row: exact keys, known metric, a catalog
 *  dimension that cannot carry an email or a Wodify id, and a finite value. */
export function assertAggregateRows(rows: unknown[]): asserts rows is MetricRow[] {
  for (const row of rows) {
    if (!isRecord(row)) throw new Error('aggregate_contract_violation');
    const keys = Object.keys(row).sort();
    if (keys.length !== ROW_KEYS.length || !ROW_KEYS.every((k) => keys.includes(k))) throw new Error('aggregate_contract_violation');
    if (!isMonthKey(row.month) || !(METRIC_KEYS as readonly string[]).includes(row.key as string)) throw new Error('aggregate_contract_violation');
    if (typeof row.dim !== 'string' || !DIM_RE.test(row.dim) || /@|\d{6,}/.test(row.dim)) throw new Error('aggregate_contract_violation');
    if (typeof row.value !== 'number' || !Number.isFinite(row.value)) throw new Error('aggregate_contract_violation');
    if (row.sourceAsOf !== null && (typeof row.sourceAsOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.sourceAsOf))) {
      throw new Error('aggregate_contract_violation');
    }
  }
}

/** Merge task outputs. Cancellation keys are summed across chunks; any other key
 *  must come from exactly one task (a duplicate is a bug, never silently merged). */
export function mergeTaskRows(lists: MetricRow[][]): MetricRow[] {
  const merged = new Map<string, MetricRow>();
  for (const list of lists) {
    for (const row of list) {
      const id = `${row.month}|${row.key}|${row.dim}`;
      const prev = merged.get(id);
      if (!prev) { merged.set(id, { ...row }); continue; }
      if (!SUMMABLE.has(row.key)) throw new Error('duplicate_metric_row');
      prev.value += row.value;
    }
  }
  return [...merged.values()].sort((a, b) =>
    a.month.localeCompare(b.month) || a.key.localeCompare(b.key) || a.dim.localeCompare(b.dim));
}

/** Persistence shape for public.wodify_monthly_metrics (PK period_month, metric_key, dimension). */
export function toDbRows(rows: MetricRow[]): { period_month: string; metric_key: string; dimension: string; value: number; source_as_of: string | null }[] {
  return rows.map((r) => ({ period_month: `${r.month}-01`, metric_key: r.key, dimension: r.dim, value: r.value, source_as_of: r.sourceAsOf }));
}

// ─── Builders ───────────────────────────────────────────────────────────────

type Rec = Record<string, unknown>;

function isRecord(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Catalog label for a dimension: trimmed, single-spaced, bounded; blank → '(blank)'. */
export function dimLabel(family: string, raw: unknown): string {
  const s = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
  return `${family}:${s || '(blank)'}`;
}

function idOf(v: unknown): string | null {
  if (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) return String(v);
  if (typeof v === 'string' && /^[1-9]\d*$/.test(v)) return v;
  return null;
}

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

class Acc {
  private map = new Map<string, MetricRow>();
  constructor(private months: MonthKey[]) {}
  zero(key: MetricKey): this {
    for (const m of this.months) this.add(m, key, 'all', 0);
    return this;
  }
  add(month: MonthKey, key: MetricKey, dim: string, n: number, sourceAsOf: string | null = null): void {
    const id = `${month}|${key}|${dim}`;
    const row = this.map.get(id);
    if (row) row.value += n;
    else this.map.set(id, { month, key, dim, value: n, sourceAsOf });
  }
  set(month: MonthKey, key: MetricKey, dim: string, value: number, sourceAsOf: string | null = null): void {
    this.map.set(`${month}|${key}|${dim}`, { month, key, dim, value, sourceAsOf });
  }
  rows(): MetricRow[] { return [...this.map.values()]; }
}

const leadCreated = (lead: Rec) => (isRecord(lead.created) ? lead.created.created_on_datetime : undefined);
const clientCreated = (c: Rec) =>
  (isRecord(c.created_on) ? c.created_on.created_on_datetime : isRecord(c.created) ? c.created.created_on_datetime : undefined);

export function tagGroup(tags: unknown): 'META ADS' | 'Organic' | 'other' {
  const list = Array.isArray(tags) ? tags.filter((t): t is string => typeof t === 'string').map((t) => t.trim()) : [];
  if (list.some((t) => t.toUpperCase() === 'META ADS')) return 'META ADS';
  if (list.some((t) => /^organic\b/i.test(t))) return 'Organic';
  return 'other';
}

/** leads_created: leads with created_on_datetime in the NY month; by source and tag group. */
export function leadsCreatedMetrics(leads: Rec[], months: MonthKey[]): MetricRow[] {
  const acc = new Acc(months).zero('leads_created');
  const inRun = new Set(months);
  for (const lead of leads) {
    const m = nyMonthOfInstant(leadCreated(lead));
    if (!m || !inRun.has(m)) continue;
    acc.add(m, 'leads_created', 'all', 1);
    acc.add(m, 'leads_created', dimLabel('source', lead.created_from_source), 1);
    acc.add(m, 'leads_created', `tag_group:${tagGroup(lead.tags)}`, 1);
  }
  return acc.rows();
}

/** Trial funnel from lead reservations + lead sign-ins (class start in local NY time). */
export function funnelMetrics(reservations: Rec[], leadSignins: Rec[], months: MonthKey[]): MetricRow[] {
  const acc = new Acc(months).zero('trial_bookings');
  const inRun = new Set(months);
  const booked = new Map<MonthKey, Set<string>>(months.map((m) => [m, new Set()]));
  const showed = new Map<MonthKey, Set<string>>(months.map((m) => [m, new Set()]));
  for (const r of reservations) {
    const m = localMonth(r.local_class_start_datetime);
    if (!m || !inRun.has(m)) continue;
    acc.add(m, 'trial_bookings', 'all', 1);
    acc.add(m, 'trial_bookings', dimLabel('status', r.reservation_status), 1);
    const id = idOf(r.lead_id);
    if (id) booked.get(m)!.add(id);
  }
  for (const s of leadSignins) {
    const m = localMonth(s.local_class_start_datetime);
    const id = idOf(s.lead_id);
    if (m && inRun.has(m) && id) showed.get(m)!.add(id);
  }
  for (const m of months) {
    acc.set(m, 'trial_unique_leads_booked', 'all', booked.get(m)!.size);
    acc.set(m, 'trial_unique_leads_showed', 'all', showed.get(m)!.size);
  }
  return acc.rows();
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Slot = class name + weekday + local start time, e.g. "Kids BJJ · Mon 17:00". */
export function classSlot(signin: Rec): string | null {
  const start = str(signin.local_class_start_datetime);
  const m = start ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(start) : null;
  if (!m) return null;
  const weekday = WEEKDAYS[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()];
  const name = (str(signin.class) ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || '(blank)';
  return `slot:${name} · ${weekday} ${m[4]}:${m[5]}`;
}

/** Client sign-ins: totals, unique clients, per-slot average attendance. */
export function signinMetrics(signins: Rec[], months: MonthKey[]): MetricRow[] {
  const acc = new Acc(months).zero('signins_total').zero('signins_unique_clients');
  const inRun = new Set(months);
  const unique = new Map<string, Set<string>>(); // `${month}|${dim}` → client ids (transient)
  const slots = new Map<string, { n: number; classes: Set<string> }>();
  for (const s of signins) {
    const m = localMonth(s.local_class_start_datetime);
    if (!m || !inRun.has(m)) continue;
    const program = dimLabel('program', s.program);
    acc.add(m, 'signins_total', 'all', 1);
    acc.add(m, 'signins_total', program, 1);
    const client = idOf(s.client_id);
    if (client) {
      for (const dim of ['all', program]) {
        const k = `${m}|${dim}`;
        if (!unique.has(k)) unique.set(k, new Set());
        unique.get(k)!.add(client);
      }
    }
    const slot = classSlot(s);
    const classId = idOf(s.class_id);
    if (slot && classId) {
      const k = `${m}|${slot}`;
      if (!slots.has(k)) slots.set(k, { n: 0, classes: new Set() });
      const e = slots.get(k)!;
      e.n += 1;
      e.classes.add(classId);
    }
  }
  for (const [k, set] of unique) {
    const [m, dim] = [k.slice(0, 7), k.slice(8)];
    acc.set(m, 'signins_unique_clients', dim, set.size);
  }
  for (const [k, e] of slots) {
    acc.set(k.slice(0, 7), 'class_slot_avg_attendance', k.slice(8), round(e.n / e.classes.size, 2));
  }
  return acc.rows();
}

// Memberships ---------------------------------------------------------------

type Plan = { id: string; client: string; start: string; end: string | null; renewedFrom: string | null; raw: Rec };

function classPlans(memberships: Rec[]): Map<string, Plan[]> {
  const byClient = new Map<string, Plan[]>();
  for (const m of memberships) {
    if (m.is_deleted === true || m.membership_type !== 'Class Plan') continue;
    const id = idOf(m.id);
    const client = idOf(m.client_id);
    const start = localDate(m.start_date);
    if (!id || !client || !start) continue;
    const plan: Plan = { id, client, start, end: localDate(m.end_date), renewedFrom: idOf(m.renewed_from_membership_id), raw: m };
    if (!byClient.has(client)) byClient.set(client, []);
    byClient.get(client)!.push(plan);
  }
  for (const list of byClient.values()) list.sort((a, b) => a.start.localeCompare(b.start) || Number(a.id) - Number(b.id));
  return byClient;
}

function commitmentMonths(length: unknown, unit: unknown): number | null {
  const len = num(length);
  const u = str(unit) ?? '';
  if (!len || len <= 0) return null;
  if (/^year/i.test(u)) return len * 12;
  if (/^month/i.test(u)) return len;
  if (/^week/i.test(u)) return (len * 12) / 52;
  if (/^day/i.test(u)) return len / 30.4375;
  return null;
}

/** Normalized monthly price of a Class Plan billing row, or null when unpriced.
 *  Within the chain's initial commitment the initial payment option applies,
 *  after it the renewal option. Monthly → cost; Pay in Full → cost ÷ commitment
 *  months; Weekly or anything else → unpriced. $0 → unpriced. */
export function monthlyPrice(plan: Plan, byId: Map<string, Plan>): number | null {
  let head = plan;
  for (let i = 0; i < 400 && head.renewedFrom && byId.has(head.renewedFrom); i++) head = byId.get(head.renewedFrom)!;
  const pp = isRecord(head.raw.payment_plan) ? head.raw.payment_plan : null;
  if (!pp) return null;
  const initialMonths = commitmentMonths(pp.initial_commitment_length, pp.initial_commitment_time_unit);
  const inInitial = initialMonths === null || dayDiff(plan.start, head.start) < initialMonths * 30.4375;
  const opt = inInitial
    ? (isRecord(pp.initial_payment_option) ? { type: pp.initial_payment_option.initial_payment_option_type, cost: pp.initial_payment_option.initial_cost, months: initialMonths } : null)
    : (isRecord(pp.renewal_payment_option) ? { type: pp.renewal_payment_option.renewal_payment_option_type, cost: pp.renewal_payment_option.renewal_cost, months: commitmentMonths(pp.renewal_commitment_length, pp.renewal_commitment_time_unit) } : null);
  const cost = num(opt?.cost);
  if (!opt || !cost || cost <= 0) return null;
  if (opt.type === 'Monthly') return cost;
  if (opt.type === 'Pay in Full' && opt.months) return cost / opt.months;
  return null;
}

/** new_students, rejoins, plan_switches, plan_mix, avg_monthly_price. */
export function membershipMetrics(memberships: Rec[], clients: Rec[], months: MonthKey[], todayNy: string): MetricRow[] {
  const acc = new Acc(months).zero('new_students').zero('rejoins').zero('plan_switches').zero('plan_mix');
  const inRun = new Set(months);
  const byClient = classPlans(memberships);
  const byId = new Map<string, Plan>();
  for (const list of byClient.values()) for (const p of list) byId.set(p.id, p);
  const program = new Map<string, unknown>();
  for (const c of clients) { const id = idOf(c.id); if (id) program.set(id, c.default_program); }

  for (const [client, plans] of byClient) {
    const first = plans[0];
    const fm = localMonth(first.start);
    if (fm && inRun.has(fm)) {
      acc.add(fm, 'new_students', 'all', 1);
      acc.add(fm, 'new_students', dimLabel('program', program.get(client)), 1);
      acc.add(fm, 'new_students', dimLabel('template', first.raw.name), 1);
    }
    for (let i = 1; i < plans.length; i++) {
      const p = plans[i];
      if (p.renewedFrom) continue; // a renewal row of an existing chain
      const m = localMonth(p.start);
      if (!m || !inRun.has(m)) continue;
      // Another Class Plan covering the start day (end is exclusive: a renewal
      // starts on its predecessor's end_date) → switch; otherwise a gap → rejoin.
      const covered = plans.slice(0, i).some((q) => q.end === null || q.end >= p.start);
      acc.add(m, covered ? 'plan_switches' : 'rejoins', 'all', 1);
    }
  }

  // plan_mix / avg_monthly_price: Class Plan rows active on the month's last day
  // (today for the current month): start <= D < end.
  for (const m of months) {
    const lastDay = dayBefore(monthWindow(m).endDate);
    const d = lastDay < todayNy ? lastDay : todayNy;
    const priced = new Map<string, number[]>();
    for (const plans of byClient.values()) {
      for (const p of plans) {
        if (!(p.start <= d && (p.end === null || p.end > d))) continue;
        const tmpl = dimLabel('template', p.raw.name);
        acc.add(m, 'plan_mix', 'all', 1);
        acc.add(m, 'plan_mix', tmpl, 1);
        const price = monthlyPrice(p, byId);
        if (price !== null) {
          for (const dim of ['all', tmpl]) {
            if (!priced.has(dim)) priced.set(dim, []);
            priced.get(dim)!.push(price);
          }
        }
      }
    }
    for (const [dim, prices] of priced) acc.set(m, 'avg_monthly_price', dim, round(prices.reduce((s, x) => s + x, 0) / prices.length, 2));
  }
  return acc.rows();
}

function dayBefore(ymd: string): string {
  const d = new Date(Date.parse(`${ymd}T00:00:00Z`) - 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Class Plan chain starts (renewed_from empty) after the client's first plan,
 *  starting on/after `fromDate` with a gap — candidates for a reactivation. */
export function rejoinClientIds(memberships: Rec[], fromDate: string): Set<string> {
  const out = new Set<string>();
  for (const [client, plans] of classPlans(memberships)) {
    for (let i = 1; i < plans.length; i++) {
      const p = plans[i];
      if (p.renewedFrom || p.start < fromDate) continue;
      if (!plans.slice(0, i).some((q) => q.end === null || q.end >= p.start)) out.add(client);
    }
  }
  return out;
}

// Conversions ---------------------------------------------------------------

export type ConversionInput = {
  clients: Rec[];
  memberships: Rec[];
  leads: Rec[];
  /** client id → lead id, from /clients/{id}.lead_id (transient, this request only). */
  leadIdByClient: Map<string, string>;
};

/** Conversion date of a converted client (NY calendar date of the client record's creation). */
export function conversionDate(client: Rec): string | null {
  return client.is_converted_from_lead === true ? nyDate(clientCreated(client)) : null;
}

/** leads_converted_raw, leads_enrolled, cohort_leads_enrolled, cohort_conversion_rate,
 *  lead_to_enroll_days_median. Enrolled = first Class Plan starts within 30 days on/after conversion. */
export function conversionMetrics(input: ConversionInput, months: MonthKey[]): MetricRow[] {
  const acc = new Acc(months).zero('leads_converted_raw').zero('leads_enrolled').zero('cohort_leads_enrolled');
  const inRun = new Set(months);
  const plans = classPlans(input.memberships);
  const leadCreatedById = new Map<string, string>();
  const leadsByMonth = new Map<MonthKey, string[]>(months.map((m) => [m, []]));
  for (const lead of input.leads) {
    const id = idOf(lead.id);
    const created = nyDate(leadCreated(lead));
    if (!id || !created) continue;
    leadCreatedById.set(id, created);
    const m = created.slice(0, 7);
    if (inRun.has(m)) leadsByMonth.get(m)!.push(id);
  }
  const enrolledLeads = new Set<string>();
  const days = new Map<MonthKey, number[]>(months.map((m) => [m, []]));
  for (const c of input.clients) {
    const conv = conversionDate(c);
    const id = idOf(c.id);
    if (!conv || !id) continue;
    const first = plans.get(id)?.[0];
    const enrolled = !!first && first.start >= conv && dayDiff(first.start, conv) <= ENROLL_WINDOW_DAYS;
    const leadId = input.leadIdByClient.get(id);
    if (enrolled && leadId) enrolledLeads.add(leadId);
    const m = conv.slice(0, 7);
    if (!inRun.has(m)) continue;
    acc.add(m, 'leads_converted_raw', 'all', 1);
    if (!enrolled) continue;
    acc.add(m, 'leads_enrolled', 'all', 1);
    const leadDay = leadId ? leadCreatedById.get(leadId) : undefined;
    if (leadDay && conv >= leadDay) days.get(m)!.push(dayDiff(conv, leadDay));
  }
  for (const m of months) {
    const cohort = leadsByMonth.get(m)!;
    const n = cohort.filter((id) => enrolledLeads.has(id)).length;
    acc.set(m, 'cohort_leads_enrolled', 'all', n);
    if (cohort.length > 0) acc.set(m, 'cohort_conversion_rate', 'all', round(n / cohort.length, 4));
    const d = days.get(m)!.sort((a, b) => a - b);
    if (d.length > 0) {
      const mid = Math.floor(d.length / 2);
      acc.set(m, 'lead_to_enroll_days_median', 'all', d.length % 2 ? d[mid] : (d[mid - 1] + d[mid]) / 2);
    }
  }
  return acc.rows();
}

// Cancellations -------------------------------------------------------------

export type CancellationObservation = { statusHistory: unknown; classification: CensusClassification };

/** Classify a client detail with the v3 census student rule (reused, not re-implemented). */
export function observeClientDetail(detail: unknown): CancellationObservation {
  const record = isRecord(detail) && isRecord(detail.client) ? detail.client : detail;
  return {
    statusHistory: isRecord(record) ? record.status_history : undefined,
    classification: classifyActiveClientDetail(detail),
  };
}

/** cancellations (students, v3 rule) + cancellations_all_clients: clients with a
 *  status_history change Active → Inactive dated in the NY month; once per client per month. */
export function cancellationMetrics(observations: CancellationObservation[], months: MonthKey[]): MetricRow[] {
  const acc = new Acc(months).zero('cancellations').zero('cancellations_all_clients');
  const inRun = new Set(months);
  for (const o of observations) {
    const hit = new Set<MonthKey>();
    for (const h of Array.isArray(o.statusHistory) ? o.statusHistory : []) {
      if (!isRecord(h) || h.from_status !== 'Active' || h.to_status !== 'Inactive') continue;
      const m = nyMonthOfInstant(h.status_change_datetime);
      if (m && inRun.has(m)) hit.add(m);
    }
    for (const m of hit) {
      acc.add(m, 'cancellations_all_clients', 'all', 1);
      if (o.classification.kind === 'student') acc.add(m, 'cancellations', 'all', 1);
    }
  }
  return acc.rows();
}

// Invoices ------------------------------------------------------------------

const NO_MONEY_STATUSES = new Set(['Voided', 'Deleted']);

/** Invoice metrics for invoices with payment_due in the month. `details` = /financials/invoices/{id} bodies. */
export function invoiceMetrics(details: Rec[], month: MonthKey, todayNy: string): MetricRow[] {
  const acc = new Acc([month]).zero('invoices_due_count').zero('invoices_due_amount')
    .zero('billed_paid').zero('billed_unpaid').zero('autopay_failed').zero('refunds').zero('revenue_by_category');
  for (const inv of details) {
    const due = localDate(inv.payment_due);
    if (!due || due.slice(0, 7) !== month) continue;
    const status = dimLabel('status', inv.invoice_header_status);
    const charge = num(inv.final_charge) ?? 0;
    acc.add(month, 'invoices_due_count', 'all', 1);
    acc.add(month, 'invoices_due_count', status, 1);
    acc.add(month, 'invoices_due_amount', 'all', charge);
    acc.add(month, 'invoices_due_amount', status, charge);
    if (NO_MONEY_STATUSES.has(str(inv.invoice_header_status) ?? '')) continue;
    const unpaid = num(inv.unpaid_amount) ?? 0;
    acc.add(month, 'billed_paid', 'all', num(inv.paid_amount) ?? 0);
    acc.add(month, 'billed_unpaid', 'all', unpaid);
    // Wodify stores refunds as negative amounts; stored as positive dollars refunded.
    acc.add(month, 'refunds', 'all', Math.abs(num(inv.final_refunded_amount) ?? 0));
    if (inv.is_auto_bill === true && unpaid > 0 && due < todayNy) acc.add(month, 'autopay_failed', 'all', 1);
    for (const line of Array.isArray(inv.invoice_details) ? inv.invoice_details : []) {
      if (!isRecord(line)) continue;
      const net = num(line.post_header_net_revenue) ?? 0;
      acc.add(month, 'revenue_by_category', 'all', net);
      acc.add(month, 'revenue_by_category', dimLabel('category', line.revenue_category), net);
    }
  }
  return acc.rows().map((r) => (r.key === 'invoices_due_count' || r.key === 'autopay_failed' ? r : { ...r, value: round(r.value, 2) }));
}

// v3 student census ---------------------------------------------------------

function recencyTotal(r: { countsByDaysAbsent: Record<string, number>; overflow365Plus: number; unknownRecency: number }): number {
  return Object.values(r.countsByDaysAbsent).reduce((s, n) => s + n, 0) + r.overflow365Plus + r.unknownRecency;
}

/** Silent students with the locked silentChurn.ts rule: days absent >= threshold
 *  (the default threshold; the server has no per-browser setting). */
export function silentCount(agg: StudentRetentionAggregate, threshold = resolveSilentChurnThresholdDays(undefined)): number {
  const h = agg.daysAbsentHistogram;
  return Object.entries(h.countsByDaysAbsent).reduce((s, [d, n]) => s + (Number(d) >= threshold ? n : 0), 0) + h.overflow365Plus;
}

/** active_students (all / kids / adults / unknown_age), silent_students, students_unknown_recency
 *  from the last valid v3 row whose as_of falls in the month. Rows are wodify_retention_aggregate rows. */
export function v3Metrics(rows: Rec[], months: MonthKey[]): MetricRow[] {
  const acc = new Acc(months);
  for (const m of months) {
    const candidates = rows
      .filter((r) => typeof r.as_of === 'string' && r.as_of.slice(0, 7) === m)
      .sort((a, b) => String(b.as_of).localeCompare(String(a.as_of)));
    for (const row of candidates) {
      // studentRetentionFromRow applies every v3 contract gate; its freshness
      // gate is evaluated at the snapshot's own day, so a historical row passes.
      const agg = studentRetentionFromRow(row, new Date(`${row.as_of}T16:00:00Z`));
      if (!agg) continue;
      const asOf = agg.asOf;
      const c = agg.cohorts.cohorts;
      const kids = ['kids3to6', 'kids7to9', 'teens10to15'].reduce((s, id) => s + (c[id] ? recencyTotal(c[id].active) : 0), 0);
      acc.set(m, 'active_students', 'all', agg.studentTotal, asOf);
      acc.set(m, 'active_students', 'age:kids', kids, asOf);
      acc.set(m, 'active_students', 'age:adults', c.adults16plus ? recencyTotal(c.adults16plus.active) : 0, asOf);
      acc.set(m, 'active_students', 'age:unknown', c.unknownCohort ? recencyTotal(c.unknownCohort.active) : 0, asOf);
      acc.set(m, 'silent_students', 'all', silentCount(agg), asOf);
      acc.set(m, 'students_unknown_recency', 'all', agg.unknown, asOf);
      break;
    }
  }
  return acc.rows();
}

/** visits_per_active_student = signins_total ÷ active_students (same month, 'all'). */
export function derivedMetrics(merged: MetricRow[]): MetricRow[] {
  const get = (m: MonthKey, k: MetricKey) => merged.find((r) => r.month === m && r.key === k && r.dim === 'all');
  const out: MetricRow[] = [];
  for (const m of [...new Set(merged.map((r) => r.month))]) {
    const s = get(m, 'signins_total');
    const a = get(m, 'active_students');
    if (s && a && a.value > 0) out.push({ month: m, key: 'visits_per_active_student', dim: 'all', value: round(s.value / a.value, 2), sourceAsOf: a.sourceAsOf });
  }
  return out;
}
