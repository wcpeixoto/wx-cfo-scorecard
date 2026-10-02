import { describe, expect, it, vi } from 'vitest';
import {
  WodifyMethodNotAllowedError,
  WodifyRateLimitError,
  assertAggregateRows,
  cancellationMetrics,
  conversionMetrics,
  createWodifyClient,
  derivedMetrics,
  funnelMetrics,
  invoiceMetrics,
  leadsCreatedMetrics,
  membershipMetrics,
  mergeTaskRows,
  monthWindow,
  monthsForKind,
  nyMonthOfInstant,
  observeClientDetail,
  signinMetrics,
  silentCount,
  tagGroup,
  toDbRows,
  v3Metrics,
  validateMonths,
  type MetricRow,
} from './wodifyMonthlyMetrics';
import { buildStudentRetentionAggregate } from './studentRetentionAggregate';
import { DEFAULT_SILENT_CHURN_THRESHOLD_DAYS } from './silentChurn';

const pick = (rows: MetricRow[], key: string, dim = 'all', month?: string) =>
  rows.find((r) => r.key === key && r.dim === dim && (!month || r.month === month))?.value;

// ─── GET-only guard ─────────────────────────────────────────────────────────

describe('GET-only Wodify client', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'get'])('throws on %s before any network call', async (method) => {
    const fetchImpl = vi.fn();
    const client = createWodifyClient({ apiKey: 'k', fetchImpl, cadenceMs: 0 });
    await expect(client.request(method, '/clients')).rejects.toBeInstanceOf(WodifyMethodNotAllowedError);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(client.stats.calls).toBe(0);
  });

  it('sends GET with the key header and returns the body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ clients: [] }), { status: 200 }));
    const client = createWodifyClient({ apiKey: 'k', fetchImpl, cadenceMs: 0 });
    await expect(client.get('/clients/search', { q: 'id|gt|0' })).resolves.toEqual({ clients: [] });
    expect(fetchImpl.mock.calls[0][1].method).toBe('GET');
    expect(fetchImpl.mock.calls[0][1].headers['x-api-key']).toBe('k');
  });

  it('aborts on 429 without retrying and counts it', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 429 }));
    const client = createWodifyClient({ apiKey: 'k', fetchImpl, cadenceMs: 0 });
    await expect(client.get('/x')).rejects.toBeInstanceOf(WodifyRateLimitError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(client.stats.rateLimited).toBe(1);
  });

  it('treats a 2xx Wodify error envelope as a failure without reading its text', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ErrorCode: 422, MoreInfo: 'jane@example.com' }), { status: 200 }));
    const client = createWodifyClient({ apiKey: 'k', fetchImpl, cadenceMs: 0 });
    await expect(client.get('/x')).rejects.toThrow('wodify_api_error');
  });
});

// ─── New York month boundaries ──────────────────────────────────────────────

describe('New York month windows', () => {
  it('uses EDT / EST offsets at each edge', () => {
    expect(monthWindow('2026-09')).toEqual({
      month: '2026-09', startDate: '2026-09-01', endDate: '2026-10-01',
      startUtc: '2026-09-01T04:00:00.000Z', endUtc: '2026-10-01T04:00:00.000Z',
    });
    // DST ends 2026-11-01 02:00 — midnight Nov 1 is still EDT; Dec 1 is EST.
    expect(monthWindow('2026-11').startUtc).toBe('2026-11-01T04:00:00.000Z');
    expect(monthWindow('2026-11').endUtc).toBe('2026-12-01T05:00:00.000Z');
    // DST starts 2026-03-08 — Mar 1 is EST, Apr 1 is EDT.
    expect(monthWindow('2026-03').startUtc).toBe('2026-03-01T05:00:00.000Z');
    expect(monthWindow('2026-03').endUtc).toBe('2026-04-01T04:00:00.000Z');
  });

  it('assigns UTC instants to the New York month', () => {
    expect(nyMonthOfInstant('2026-09-01T03:59:59Z')).toBe('2026-08');
    expect(nyMonthOfInstant('2026-09-01T04:00:00Z')).toBe('2026-09');
    expect(nyMonthOfInstant('2026-09-15T00:21:33Z')).toBe('2026-09'); // Sep 14 20:21 NY
    expect(nyMonthOfInstant('2026-10-01T03:30:00Z')).toBe('2026-09');
    expect(nyMonthOfInstant('2026-12-01T04:30:00Z')).toBe('2026-11'); // EST: 23:30 Nov 30
    expect(nyMonthOfInstant('2026-09-15T12:00:00')).toBe('2026-09'); // bare = UTC, not local
    expect(nyMonthOfInstant('garbage')).toBeNull();
  });

  it('picks run months per kind', () => {
    const mon = new Date('2026-10-05T15:00:00Z');
    expect(monthsForKind('weekly', mon)).toEqual(['2026-09', '2026-10']);
    expect(monthsForKind('close', new Date('2026-11-01T11:00:00Z'))).toEqual(['2026-09', '2026-10']);
    expect(monthsForKind('backfill', mon)[0]).toBe('2025-05');
    expect(monthsForKind('backfill', mon).slice(-1)[0]).toBe('2026-10');
    expect(validateMonths(['2026-09', '2026-08', '2026-09'], mon)).toEqual(['2026-08', '2026-09']);
    expect(validateMonths(['2025-04'], mon)).toBeNull();
    expect(validateMonths(['2026-11'], mon)).toBeNull();
  });
});

// ─── New student vs renewal ─────────────────────────────────────────────────

const plan = (id: number, client: number, start: string, end: string, rf = 0, extra: Record<string, unknown> = {}) => ({
  id, client_id: client, membership_type: 'Class Plan', is_deleted: false, start_date: start, end_date: end,
  renewed_from_membership_id: rf, name: 'Kids Monthly Unlimited ',
  payment_plan: {
    initial_commitment_length: 1, initial_commitment_time_unit: 'Month(s)',
    initial_payment_option: { initial_payment_option_type: 'Monthly', initial_cost: 150 },
    renewal_payment_option: { renewal_payment_option_type: 'Monthly', renewal_cost: 150 },
  },
  ...extra,
});

describe('new students, renewals, rejoins and switches', () => {
  const memberships = [
    // client 1: first plan in Sep 2026, then a renewal in Oct
    plan(10, 1, '2026-09-05', '2026-10-05'), plan(11, 1, '2026-10-05', '2026-11-05', 10),
    // client 2: older chain, gap, new chain in Sep 2026 → rejoin
    plan(20, 2, '2025-05-01', '2025-06-01'), plan(21, 2, '2025-06-01', '2025-07-01', 20), plan(22, 2, '2026-09-14', '2026-10-14'),
    // client 3: new chain while the old one still runs → plan switch
    plan(30, 3, '2026-08-28', '2026-09-28'), plan(31, 3, '2026-09-16', '2026-10-16'),
    // client 4: new chain starts exactly on the old end_date → contiguous → switch
    plan(40, 4, '2026-08-10', '2026-09-10'), plan(41, 4, '2026-09-10', '2026-10-10'),
    // client 5: a pack first, then first Class Plan in Sep → still a new student
    { id: 50, client_id: 5, membership_type: 'Class Pack', start_date: '2026-01-01', end_date: '2026-02-01', renewed_from_membership_id: 0 },
    plan(51, 5, '2026-09-20', '2026-10-20'),
    // deleted first plan is ignored
    plan(60, 6, '2026-08-01', '2026-09-01', 0, { is_deleted: true }), plan(61, 6, '2026-09-02', '2026-10-02'),
  ];
  const clients = [1, 2, 3, 4, 5, 6].map((id) => ({ id, default_program: id % 2 ? 'Kids BJJ' : 'Adults BJJ' }));
  const rows = membershipMetrics(memberships, clients, ['2026-09', '2026-10'], '2026-10-02');

  it('counts first-ever Class Plans only', () => {
    expect(pick(rows, 'new_students', 'all', '2026-09')).toBe(3); // clients 1, 5, 6
    expect(pick(rows, 'new_students', 'program:Kids BJJ', '2026-09')).toBe(2);
    expect(pick(rows, 'new_students', 'template:Kids Monthly Unlimited', '2026-09')).toBe(3);
    expect(pick(rows, 'new_students', 'all', '2026-10')).toBe(0); // client 1's renewal is not new
  });
  it('separates rejoins (gap) from plan switches (overlap or contiguous)', () => {
    expect(pick(rows, 'rejoins', 'all', '2026-09')).toBe(1);
    expect(pick(rows, 'plan_switches', 'all', '2026-09')).toBe(2);
  });
  it('plan_mix counts plans active on the last day (or today), end exclusive', () => {
    // 2026-09-30: client1 #10, client2 #22, client3 #31, client4 #41, client5 #51, client6 #61 → 6
    expect(pick(rows, 'plan_mix', 'all', '2026-09')).toBe(6);
    expect(pick(rows, 'avg_monthly_price', 'all', '2026-09')).toBe(150);
  });
});

// ─── Conversions ────────────────────────────────────────────────────────────

describe('conversions and enrollment', () => {
  const lead = (id: number, created: string) => ({ id, created: { created_on_datetime: created } });
  const conv = (id: number, created: string) => ({ id, is_converted_from_lead: true, created_on: { created_on_datetime: created } });
  const input = {
    leads: [lead(100, '2026-08-27T14:59:39Z'), lead(101, '2026-09-08T17:35:16Z'), lead(102, '2026-09-10T12:00:00Z'), lead(103, '2026-09-20T12:00:00Z')],
    clients: [conv(1, '2026-09-01T22:05:00Z'), conv(2, '2026-09-09T19:07:04Z'), conv(3, '2026-09-15T00:21:33Z'), { id: 4, is_converted_from_lead: false, created_on: { created_on_datetime: '2026-09-02T12:00:00Z' } }],
    memberships: [plan(1, 1, '2026-09-01', '2026-10-01'), plan(2, 2, '2026-10-20', '2026-11-20'), plan(3, 4, '2026-09-02', '2026-10-02')],
    leadIdByClient: new Map([['1', '100'], ['2', '101'], ['3', '102']]),
  };
  const rows = conversionMetrics(input, ['2026-08', '2026-09']);

  it('raw = all converted clients; enrolled = first Class Plan within 30 days', () => {
    expect(pick(rows, 'leads_converted_raw', 'all', '2026-09')).toBe(3);
    // client 1 same day; client 2 starts 41 days later; client 3 has no plan (parent)
    expect(pick(rows, 'leads_enrolled', 'all', '2026-09')).toBe(1);
  });
  it('median lead → conversion days over enrolled conversions only', () => {
    expect(pick(rows, 'lead_to_enroll_days_median', 'all', '2026-09')).toBe(5); // Aug 27 → Sep 1
  });
  it('cohort rate uses enrolled leads over leads created in the month', () => {
    expect(pick(rows, 'cohort_leads_enrolled', 'all', '2026-08')).toBe(1);
    expect(pick(rows, 'cohort_conversion_rate', 'all', '2026-08')).toBe(1);
    expect(pick(rows, 'cohort_conversion_rate', 'all', '2026-09')).toBe(0); // 3 leads, none enrolled
  });
});

// ─── Cancellations ──────────────────────────────────────────────────────────

describe('cancellations', () => {
  const detail = (history: unknown[], group: unknown, signIns: number) => ({
    id: 9, first_name: 'Jane', email: 'jane@example.com', status_history: history, group, total_class_sign_ins: signIns, has_membership: false,
  });
  const toInactive = (at: string) => ({ from_status: 'Active', to_status: 'Inactive', status_change_datetime: at });
  const obs = [
    observeClientDetail(detail([toInactive('2026-09-10T15:00:00Z')], { group_id: 7, group_role: 'Dependent' }, 0)),
    observeClientDetail(detail([toInactive('2026-09-10T15:00:00Z')], { group_id: 7, group_role: 'Guardian' }, 0)), // parent
    observeClientDetail(detail([toInactive('2026-10-01T03:30:00Z'), toInactive('2026-09-02T12:00:00Z')], { group_id: 0, group_role: '' }, 12)),
    observeClientDetail(detail([{ from_status: 'Inactive', to_status: 'Active', status_change_datetime: '2026-09-05T12:00:00Z' }], null, 3)),
  ];
  const rows = cancellationMetrics(obs, ['2026-09']);
  it('counts students with the v3 rule and all clients separately, once per client per month', () => {
    expect(pick(rows, 'cancellations')).toBe(2);
    expect(pick(rows, 'cancellations_all_clients')).toBe(3);
  });
  it('chunks merge by summing', () => {
    const merged = mergeTaskRows([rows, rows]);
    expect(pick(merged, 'cancellations')).toBe(4);
  });
});

// ─── Funnel, sign-ins, invoices ─────────────────────────────────────────────

describe('funnel, sign-ins and invoices', () => {
  it('counts bookings by status and distinct leads', () => {
    const res = [
      { lead_id: 1, reservation_status: 'Signed In', local_class_start_datetime: '2026-09-02T18:00:00' },
      { lead_id: 1, reservation_status: 'No Show', local_class_start_datetime: '2026-09-09T18:00:00' },
      { lead_id: 2, reservation_status: 'Cancelled', local_class_start_datetime: '2026-09-30T23:30:00' },
      { lead_id: 3, reservation_status: 'No Show', local_class_start_datetime: '2026-10-01T00:30:00' },
    ];
    const rows = funnelMetrics(res, [{ lead_id: 1, local_class_start_datetime: '2026-09-02T18:00:00' }], ['2026-09']);
    expect(pick(rows, 'trial_bookings')).toBe(3);
    expect(pick(rows, 'trial_bookings', 'status:No Show')).toBe(1);
    expect(pick(rows, 'trial_unique_leads_booked')).toBe(2);
    expect(pick(rows, 'trial_unique_leads_showed')).toBe(1);
  });
  it('averages attendance per recurring slot', () => {
    const s = (client: number, cls: number, start: string) => ({ client_id: client, class_id: cls, class: 'Kids BJJ', program: 'Kids', local_class_start_datetime: start });
    const rows = signinMetrics([s(1, 10, '2026-09-07T17:00:00'), s(2, 10, '2026-09-07T17:00:00'), s(1, 11, '2026-09-14T17:00:00')], ['2026-09']);
    expect(pick(rows, 'signins_total')).toBe(3);
    expect(pick(rows, 'signins_unique_clients')).toBe(2);
    expect(pick(rows, 'class_slot_avg_attendance', 'slot:Kids BJJ · Mon 17:00')).toBe(1.5);
  });
  it('excludes voided/deleted invoices from money and only counts past-due autopay failures', () => {
    const inv = (status: string, due: string, extra: Record<string, unknown>) => ({
      invoice_header_status: status, payment_due: due, final_charge: 100, paid_amount: 0, unpaid_amount: 0, final_refunded_amount: 0,
      is_auto_bill: true, invoice_details: [{ revenue_category: 'Membership Sales', post_header_net_revenue: 100 }], ...extra,
    });
    const rows = invoiceMetrics([
      inv('Paid', '2026-09-01', { paid_amount: 100 }),
      inv('Unpaid', '2026-09-03', { unpaid_amount: 100 }),
      inv('Unpaid', '2026-09-29', { unpaid_amount: 100 }), // not yet attempted on "today"
      inv('Voided', '2026-09-04', { unpaid_amount: 100 }),
      inv('Refunded', '2026-09-05', { final_charge: 0, final_refunded_amount: -364 }),
    ], '2026-09', '2026-09-20');
    expect(pick(rows, 'refunds')).toBe(364);
    expect(pick(rows, 'invoices_due_count')).toBe(5);
    expect(pick(rows, 'invoices_due_count', 'status:Voided')).toBe(1);
    expect(pick(rows, 'billed_paid')).toBe(100);
    expect(pick(rows, 'billed_unpaid')).toBe(200);
    expect(pick(rows, 'autopay_failed')).toBe(1);
    expect(pick(rows, 'revenue_by_category', 'category:Membership Sales')).toBe(400);
  });
  it('groups lead tags', () => {
    expect(tagGroup(['Lead', 'META ADS'])).toBe('META ADS');
    expect(tagGroup(['Organic - Adults'])).toBe('Organic');
    expect(tagGroup(['Lead'])).toBe('other');
  });
});

// ─── v3 census + silent ─────────────────────────────────────────────────────

describe('v3-derived metrics', () => {
  const student = (lastCheckIn: string, dob = '2015-01-01') => ({
    id: 1, client_status: 'Active', last_attendance: lastCheckIn, last_class_sign_in: lastCheckIn, member_since: '2025-01-01', date_of_birth: dob,
  });
  const agg = buildStudentRetentionAggregate([student('2026-09-27'), student('2026-09-07', '1990-01-01'), student('2026-09-08')], '2026-09-28');
  const row = (asOf: string, ok = true) => ({
    as_of: asOf, active_total: agg.studentTotal + 1, student_total: agg.studentTotal, guardian_only_total: 1,
    students_by_path: { member: 0, dependent: agg.studentTotal, guardian_with_signin: 0, no_group_with_signin: 0 },
    unclassified_total: ok ? 0 : 2, detail_clients_failed: 0, pages_expected: 1, pages_completed: 1,
    student_retention: { ...agg, asOf },
  });

  it('uses the locked silent rule (>= default threshold)', () => {
    expect(DEFAULT_SILENT_CHURN_THRESHOLD_DAYS).toBe(21);
    expect(silentCount(agg)).toBe(1); // 21 days absent counts; 20 does not
  });
  it('takes the last valid row in the month and records its date', () => {
    const rows = v3Metrics([row('2026-09-21'), row('2026-09-28', false), row('2026-08-31')], ['2026-09']);
    const active = rows.find((r) => r.key === 'active_students' && r.dim === 'all');
    expect(active?.sourceAsOf).toBe('2026-09-21'); // 09-28 fails the v3 gates
    expect(active?.value).toBe(3);
    expect(pick(rows, 'active_students', 'age:adults')).toBe(1);
    expect(pick(rows, 'active_students', 'age:kids')).toBe(2);
  });
  it('writes nothing for months without a v3 row', () => {
    expect(v3Metrics([row('2026-09-21')], ['2025-05'])).toEqual([]);
  });
  it('derives visits per active student', () => {
    const merged: MetricRow[] = [
      { month: '2026-09', key: 'signins_total', dim: 'all', value: 1323, sourceAsOf: null },
      { month: '2026-09', key: 'active_students', dim: 'all', value: 265, sourceAsOf: '2026-09-28' },
    ];
    expect(derivedMetrics(merged)[0]).toMatchObject({ key: 'visits_per_active_student', value: 4.99, sourceAsOf: '2026-09-28' });
  });
});

// ─── Idempotent upsert + no PII ─────────────────────────────────────────────

describe('idempotent rows and the aggregate-only contract', () => {
  const pii = {
    id: 5516931, first_name: 'Jane', last_name: 'Roe', email: 'jane@example.com', phone_number: '5555550100',
    tags: ['META ADS'], created_from_source: 'API', created: { created_on_datetime: '2026-09-03T12:00:00Z' },
  };
  const rows = [
    ...leadsCreatedMetrics([pii, { ...pii, id: 5516932 }], ['2026-09']),
    ...cancellationMetrics([observeClientDetail({ ...pii, status_history: [], group: null, total_class_sign_ins: 0 })], ['2026-09']),
  ];

  it('same input → identical keyed rows (re-running replaces, never duplicates)', () => {
    const a = toDbRows(mergeTaskRows([rows]));
    const b = toDbRows(mergeTaskRows([rows]));
    expect(a).toEqual(b);
    const keys = a.map((r) => `${r.period_month}|${r.metric_key}|${r.dimension}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(a[0].period_month).toBe('2026-09-01');
  });
  it('rejects a non-summable duplicate instead of merging it', () => {
    const lead = rows.filter((r) => r.key === 'leads_created');
    expect(() => mergeTaskRows([lead, lead])).toThrow('duplicate_metric_row');
  });
  it('stored rows carry no PII keys or values', () => {
    const stored = JSON.stringify(toDbRows(mergeTaskRows([rows])));
    for (const s of ['Jane', 'Roe', 'jane@example.com', '5555550100', '5516931', 'first_name', 'email', 'client_id', 'lead_id']) {
      expect(stored).not.toContain(s);
    }
    expect(Object.keys(toDbRows(rows)[0]).sort()).toEqual(['dimension', 'metric_key', 'period_month', 'source_as_of', 'value']);
  });
  it('assertAggregateRows rejects extra keys, ids and emails', () => {
    const ok: MetricRow = { month: '2026-09', key: 'leads_created', dim: 'all', value: 1, sourceAsOf: null };
    expect(() => assertAggregateRows([ok])).not.toThrow();
    expect(() => assertAggregateRows([{ ...ok, client_id: 5516931 }])).toThrow('aggregate_contract_violation');
    expect(() => assertAggregateRows([{ ...ok, dim: 'source:5516931' }])).toThrow('aggregate_contract_violation');
    expect(() => assertAggregateRows([{ ...ok, dim: 'source:jane@example.com' }])).toThrow('aggregate_contract_violation');
    expect(() => assertAggregateRows([{ ...ok, key: 'client_names' }])).toThrow('aggregate_contract_violation');
  });
});
