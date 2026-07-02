/**
 * Silent Churn by COMMITMENT BAND — SLICE 1 data-layer build (DRY-RUN by default; gated --commit SQL).
 *   LOCAL ONLY — NEVER imported by the SPA, never bundled, never run in CI.
 *
 * ┌──────────────────────────────────────────────────────────────────────────────────────────────┐
 * │ Pulls /clients + /memberships (live Wodify) and reshapes them into the NON-PII per-band         │
 * │ aggregate for the `silent_churn_by_commitment_band` table. It touches NO SPA code and NO card.  │
 * │                                                                                                 │
 * │  • DRY-RUN (default): prints the band aggregate JSON + review-only coverage/diagnostics. Writes  │
 * │    NOTHING anywhere.                                                                             │
 * │  • --commit: prints the idempotent UPSERT **SQL** for the GATED Supabase MCP apply (Reviewer     │
 * │    PASS + owner GO, manual permission mode). It does NOT open a DB connection and holds NO        │
 * │    Supabase credential — SAME gated posture as scripts/wodify/buildMemberRetentionByBelt.ts and   │
 * │    scripts/wodify/seedMemberRetentionRates.ts: the script emits, a human applies under the gate.  │
 * │  • --selftest: network-free; synthetic in-memory fixtures; asserts the reshape + rate gate + SQL  │
 * │    + leak guard.                                                                                 │
 * └──────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * REUSE (no duplicated logic, no drift — the beltProgressionJoinProbe → buildMemberRetentionByBelt pattern):
 * ALL classification comes from scripts/wodify/silentChurnByCommitmentBandProbe.ts (gated + live-validated,
 * #519): the LOCKED Silent-Churn classifier (via src/lib/gym/silentChurn.ts), the "Month(s)"/"Year(s)" unit
 * normalization, the structured `membership_type` pack detection, and the LOCKED band-assignment rule —
 * active-membership-only with a most-recent tiebreak (`bandStatsActiveOnlyMostRecent`). This build only
 * RESHAPES that map into the table rows + gates the indicative rate; it invents no new classification.
 *
 * LOCKED decisions baked in (Phase-0 cleared):
 *   1. Denominator = the ATTENDANCE-KNOWN base (healthy + watch + silent). Active clients with no usable
 *      attendance signal (unknown — parent/guardian, never-attended) are EXCLUDED from the rate denominator,
 *      exactly like the shipped Attendance Health card / the excludeUnknownRecency default. `total_active`
 *      still counts them (so the two numbers reconcile), but the rate is silent / attendance_known.
 *   2. Bands: month_to_month / three_month / six_month / twelve_month_annual / twenty_four_month, PLUS a
 *      separate `non_commitment` row (packs — EXCLUDED from any commitment-band denominator, shown on its
 *      own), PLUS `unclassified` carried as its own row (never folded in). Active clients with no current
 *      active-membership row are 'unassignable' — they are NOT an emitted band row; their count surfaces in
 *      the review-only `coverage` block (per the Phase-0 probe this is a large share of active clients).
 *   3. COUNTS publish for every band incl. true 0 and counts < 5 (owner-dashboard aggregate-count policy —
 *      non-identity aggregate, NO <5 masking; same policy as the cohort/belt tables).
 *   4. indicative_silent_rate = silent_count / attendance_known, SET NULL where attendance_known < 5
 *      (MIN_BAND_KNOWN_DENOMINATOR — the probe's rate-quality gate; counts still show). "Indicative" by name;
 *      the card will label it so.
 *
 * Safety (mirrors the probe): LOCAL / server-side ONLY, never a VITE_* value. The live pull reads the rotated
 * key ONLY from process.env.WODIFY_API_KEY (never hardcoded / logged / echoed); unset ⇒ exits WITHOUT a
 * request. PII is read in memory ONLY to derive counts, then discarded. The emitted payload is COUNTS + fixed
 * band LABELS + a coarse as-of DATE + a rate — no names, ids, emails, exact member dates, rows, URLs, or keys.
 * A field-agnostic leak guard (the probe's `leaks`) re-scans the serialized output (with the as-of date + the
 * sha256 scrubbed, both intended) and ABORTS WITHOUT printing on any '@', 7+ digit run, or stray ISO date.
 *
 * Run (LOCAL ONLY — provide the rotated key via a gitignored local env; never commit or paste it):
 *   npx tsx scripts/wodify/buildSilentChurnByCommitmentBand.ts --selftest                 # no file/network/key
 *   npx tsx --env-file=/Users/wesley/Code/wx-cfo-scorecard/.env.local \
 *     scripts/wodify/buildSilentChurnByCommitmentBand.ts                                   # DRY-RUN (JSON)
 *   npx tsx --env-file=/Users/wesley/Code/wx-cfo-scorecard/.env.local \
 *     scripts/wodify/buildSilentChurnByCommitmentBand.ts --commit                          # emits GATED SQL only
 * See scripts/wodify/README.md.
 */

import { createHash } from 'node:crypto';

import {
  analyze,
  buildResult,
  fetchAll,
  gymLocalAsOf,
  leaks,
  freshMeta,
  CLIENTS_PATH,
  MEMBERSHIPS_PATH,
  CLIENTS_RECORD_ARRAY_KEYS,
  MEMBERSHIPS_RECORD_ARRAY_KEYS,
  MIN_BAND_KNOWN_DENOMINATOR,
  type AnalysisCounts,
  type BandCounts,
  type CommitmentBand,
  type ProbeResult,
  type TransportMeta,
} from './silentChurnByCommitmentBandProbe.ts';
import {
  resolveSilentChurnThresholdDays,
  DEFAULT_SILENT_CHURN_THRESHOLD_DAYS,
} from '../../src/lib/gym/silentChurn.ts';

const TABLE = 'public.silent_churn_by_commitment_band';
const WORKSPACE_ID = 'default';
const ASSIGNMENT_RULE = 'active_membership_only_most_recent_tiebreak';

// The emitted table rows, in canonical order. MUST match the DDL band allowlist (SQL ↔ build cannot drift).
// The five commitment bands, then non_commitment (its own row, excluded from commitment denominators), then
// unclassified (its own row). 'conflicting' never occurs under the card rule; 'unassignable' is NOT emitted.
const CARD_BANDS: CommitmentBand[] = [
  'month_to_month',
  'three_month',
  'six_month',
  'twelve_month_annual',
  'twenty_four_month',
  'non_commitment',
  'unclassified',
];

const DENOMINATOR_NOTE =
  'indicative_silent_rate = silent_count / attendance_known. attendance_known = healthy + watch + silent; ' +
  'active clients with no usable attendance signal (unknown — parent/guardian or never-attended) are EXCLUDED ' +
  'from the denominator (matching the shipped Attendance Health card / excludeUnknownRecency), but still ' +
  `counted in total_active. The rate is NULL where attendance_known < ${MIN_BAND_KNOWN_DENOMINATOR} ` +
  '(rate-quality gate) — counts always emit (owner-dashboard aggregate-count policy, no <5 masking). ' +
  'non_commitment is a SEPARATE row excluded from any commitment-band denominator; unclassified is carried ' +
  'separately and never folded into a band.';

const COVERAGE_NOTE =
  'Assignment rule: active-membership-only with a most-recent tiebreak. Active clients with no current ' +
  'active-membership row are "unassignable" and are NOT in any emitted band row (see unassignableShare). ' +
  'The emitted band rows therefore cover only the active-membership population; Σ total_active over the ' +
  'emitted rows equals activeClientsInEmittedBands, not activeClientsTotal.';

interface CardRow {
  workspace_id: string;
  band: string;
  total_active: number;
  attendance_known: number;
  silent_count: number;
  indicative_silent_rate: number | null;
  as_of: string; // 'YYYY-MM-DD' gym-local snapshot day.
}

interface CoverageBlock {
  activeClientsTotal: number;
  activeClientsInEmittedBands: number; // Σ total_active over the 7 emitted rows.
  unassignableActiveClients: number; // active clients with no current active-membership row.
  unassignableShare: number;
  conflictingActiveClients: number; // guard — must be 0 under the most-recent tiebreak rule.
  note: string;
}

interface BuildOutput {
  table: 'silent_churn_by_commitment_band';
  workspace_id: string;
  asOf: string;
  assignmentRule: string;
  rateQualityGateKnownMin: number;
  denominatorNote: string;
  coverageComplete: boolean; // false ⇒ partial/failed scan; --commit refuses to emit SQL.
  rows: CardRow[];
  coverage: CoverageBlock;
  diagnostics: ProbeResult; // full probe diagnostics, review-only — NOT persisted. Already leak-safe.
  payloadSha256: string; // over the persisted rows only.
}

function round3(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : 0;
}

// The LOCKED rate + gate. NULL below the known-denominator minimum; NULL when the known base is 0.
function indicativeRate(silent: number, known: number): number | null {
  if (known < MIN_BAND_KNOWN_DENOMINATOR) return null;
  return round3(silent / known);
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Stable serialization of the PERSISTED rows for hashing: sorted by band, fixed key order.
function canonicalize(rows: CardRow[]): string {
  const sorted = [...rows].sort((a, b) => a.band.localeCompare(b.band));
  return JSON.stringify(
    sorted.map((r) => [
      r.workspace_id,
      r.band,
      r.total_active,
      r.attendance_known,
      r.silent_count,
      r.indicative_silent_rate,
      r.as_of,
    ]),
  );
}

function buildOutput(counts: AnalysisCounts, probe: ProbeResult, asOf: string): BuildOutput {
  const stats = counts.bandStatsActiveOnlyMostRecent; // the LOCKED card rule map.
  const rows: CardRow[] = CARD_BANDS.map((band) => {
    const c: BandCounts = stats[band];
    return {
      workspace_id: WORKSPACE_ID,
      band,
      total_active: c.totalActive,
      attendance_known: c.attendanceKnown,
      silent_count: c.silentCount,
      indicative_silent_rate: indicativeRate(c.silentCount, c.attendanceKnown),
      as_of: asOf,
    };
  });

  const activeClientsInEmittedBands = rows.reduce((s, r) => s + r.total_active, 0);
  const unassignableActiveClients = stats.unassignable.totalActive;
  const coverage: CoverageBlock = {
    activeClientsTotal: counts.activeClientsTotal,
    activeClientsInEmittedBands,
    unassignableActiveClients,
    unassignableShare:
      counts.activeClientsTotal > 0 ? round3(unassignableActiveClients / counts.activeClientsTotal) : 0,
    conflictingActiveClients: stats.conflicting.totalActive,
    note: COVERAGE_NOTE,
  };

  return {
    table: 'silent_churn_by_commitment_band',
    workspace_id: WORKSPACE_ID,
    asOf,
    assignmentRule: ASSIGNMENT_RULE,
    rateQualityGateKnownMin: MIN_BAND_KNOWN_DENOMINATOR,
    denominatorNote: DENOMINATOR_NOTE,
    coverageComplete: probe.coverageComplete,
    rows,
    coverage,
    diagnostics: probe,
    payloadSha256: createHash('sha256').update(canonicalize(rows)).digest('hex'),
  };
}

// Idempotent UPSERT SQL for the GATED Supabase MCP apply — mirrors seedMemberRetentionRates.ts. One row per
// (workspace_id, band); ON CONFLICT DO UPDATE (never delete/truncate). band is a fixed enum label and as_of is
// our own YMD (no injection surface); every other value is a number or the null literal.
function sqlNum(n: number | null): string {
  return n === null ? 'null' : String(n);
}
function buildUpsertSql(rows: CardRow[], asOf: string): string {
  const values = rows
    .map(
      (r) =>
        `  ('${r.workspace_id}', '${r.band}', ${r.total_active}, ${r.attendance_known}, ` +
        `${r.silent_count}, ${sqlNum(r.indicative_silent_rate)}, '${r.as_of}')`,
    )
    .join(',\n');
  return [
    `-- GATED apply only (Reviewer PASS + owner GO). as_of=${asOf}. Emitted by ` +
      'buildSilentChurnByCommitmentBand.ts --commit; NOT self-applied.',
    `insert into ${TABLE}`,
    '  (workspace_id, band, total_active, attendance_known, silent_count, indicative_silent_rate, as_of)',
    'values',
    values,
    'on conflict (workspace_id, band) do update set',
    '  total_active           = excluded.total_active,',
    '  attendance_known       = excluded.attendance_known,',
    '  silent_count           = excluded.silent_count,',
    '  indicative_silent_rate = excluded.indicative_silent_rate,',
    '  as_of                  = excluded.as_of,',
    '  refreshed_at           = now();',
  ].join('\n');
}

// Re-scan the serialized output before printing. The as-of DATE and the sha256 (long digit runs) are INTENDED
// output — scrub both, then the field-agnostic guard proves no member date / id / email survived the reshape.
function leakScanClean(serialized: string, asOf: string, sha: string): boolean {
  const scrubbed = serialized.split(asOf).join('ASOF').split(sha).join('SHA256');
  return !leaks(scrubbed);
}

// ─── SELF-TEST (network-free; synthetic fixtures; reshape + rate gate + coverage + SQL + leak + sha) ─────
function runSelfTest(): void {
  const fail = (m: string): void => {
    console.error(`SELFTEST FAIL: ${m}`);
    process.exit(1);
  };

  const TODAY = new Date(2026, 5, 15); // June 15, 2026 — deterministic.
  const THRESHOLD = DEFAULT_SILENT_CHURN_THRESHOLD_DAYS; // 21.
  const ASOF = ymd(TODAY);

  // Planted PII sentinels on the fixtures — NONE may survive into the serialized output.
  const PLANTED = ['SECRET_MEMBER', 'secret@member.example', '9000001', '80000001', '2025-01-01'];

  const client = (id: string, lastAttendance: string): Record<string, unknown> => ({
    id,
    FirstName: 'SECRET_MEMBER',
    Email: 'secret@member.example',
    client_status: 'Active',
    last_attendance: lastAttendance,
  });
  const membership = (
    mid: string,
    cid: string,
    opts: { initLen?: number; initUnit?: string; membershipType?: string },
  ): Record<string, unknown> => ({
    id: mid,
    client_id: cid,
    FirstName: 'SECRET_MEMBER',
    membership_type: opts.membershipType ?? 'Class Plan',
    is_active: true,
    is_deleted: false,
    start_date: '2025-01-01',
    payment_plan: {
      initial_commitment_length: opts.initLen,
      initial_commitment_time_unit: opts.initUnit ?? 'Month(s)',
    },
  });

  // m2m: 5 healthy (1d) + 1 silent (45d) → known 6, silent 1, rate 1/6 = 0.167 (>= gate).
  // three_month: 1 healthy → known 1 → rate NULL (below gate); count still emits.
  // non_commitment: 1 healthy via membership_type 'Class Pack'.
  // unclassified: 1 healthy, empty unit → unresolvable.
  // unassignable: 1 healthy, NO membership row → coverage only, not a table row.
  const clients: Record<string, unknown>[] = [
    client('9000001', '2026-06-14'),
    client('9000002', '2026-06-14'),
    client('9000003', '2026-06-14'),
    client('9000004', '2026-06-14'),
    client('9000005', '2026-06-14'),
    client('9000006', '2026-05-01'), // 45d → silent
    client('9000007', '2026-06-14'), // three_month
    client('9000008', '2026-06-14'), // non_commitment (pack)
    client('9000009', '2026-06-14'), // unclassified (empty unit)
    client('9000010', '2026-06-14'), // unassignable (no membership)
  ];
  const memberships: Record<string, unknown>[] = [
    membership('80000001', '9000001', { initLen: 1 }),
    membership('80000002', '9000002', { initLen: 1 }),
    membership('80000003', '9000003', { initLen: 1 }),
    membership('80000004', '9000004', { initLen: 1 }),
    membership('80000005', '9000005', { initLen: 1 }),
    membership('80000006', '9000006', { initLen: 1 }),
    membership('80000007', '9000007', { initLen: 3 }),
    membership('80000008', '9000008', { membershipType: 'Class Pack', initLen: 12 }),
    membership('80000009', '9000009', { initLen: 6, initUnit: '' }), // empty unit → unclassified
    // 9000010 intentionally has NO membership row → unassignable.
  ];

  const counts = analyze(clients, memberships, TODAY, THRESHOLD);
  const meta: TransportMeta = {
    ...freshMeta(),
    clientsJsonParseable: true,
    membershipsJsonParseable: true,
    clientsRecordKeySeen: true,
    membershipsRecordKeySeen: true,
    clientsPagesFetched: 1,
    membershipsPagesFetched: 1,
  };
  const probe = buildResult(counts, meta, resolveSilentChurnThresholdDays(THRESHOLD), true);
  const out = buildOutput(counts, probe, ASOF);
  const serialized = JSON.stringify(out, null, 2);
  const sql = buildUpsertSql(out.rows, ASOF);

  const row = (band: string): CardRow | undefined => out.rows.find((r) => r.band === band);
  const checks: Array<[string, boolean]> = [
    ['emits exactly 7 rows', out.rows.length === 7],
    ['rows are in canonical CARD_BANDS order', out.rows.map((r) => r.band).join(',') === CARD_BANDS.join(',')],
    // m2m — the rate-ready band. known base 6 (>= gate); 1/6 rounds to 0.167.
    ['m2m {total 6, known 6, silent 1}', row('month_to_month')?.total_active === 6 && row('month_to_month')?.attendance_known === 6 && row('month_to_month')?.silent_count === 1],
    ['m2m indicative_silent_rate == 0.167 (1/6)', row('month_to_month')?.indicative_silent_rate === 0.167],
    // three_month — count emits, rate gated to null (known 1 < 5).
    ['three_month {total 1, known 1, silent 0}', row('three_month')?.total_active === 1 && row('three_month')?.attendance_known === 1],
    ['three_month rate NULL (known below gate) but count present', row('three_month')?.indicative_silent_rate === null],
    // zero bands still emit rows with null rate.
    ['twenty_four_month zero row emits (0/0/0, rate null)', row('twenty_four_month')?.total_active === 0 && row('twenty_four_month')?.indicative_silent_rate === null],
    ['six_month + twelve zero rows present', !!row('six_month') && !!row('twelve_month_annual')],
    // non_commitment + unclassified carried as their own rows.
    ['non_commitment own row, total 1 (from membership_type Class Pack)', row('non_commitment')?.total_active === 1],
    ['unclassified own row, total 1 (empty unit)', row('unclassified')?.total_active === 1],
    // Coverage: unassignable is NOT a row; it surfaces here. 10 active = 9 in bands + 1 unassignable.
    ['coverage.activeClientsTotal == 10', out.coverage.activeClientsTotal === 10],
    ['coverage.activeClientsInEmittedBands == 9', out.coverage.activeClientsInEmittedBands === 9],
    ['coverage.unassignableActiveClients == 1 (9000010, no membership)', out.coverage.unassignableActiveClients === 1],
    ['coverage.conflictingActiveClients == 0 (tiebreak resolves conflicts)', out.coverage.conflictingActiveClients === 0],
    ['unassignable is NOT an emitted band row', !out.rows.some((r) => r.band === 'unassignable')],
    ['Σ emitted total_active + unassignable == activeClientsTotal', out.coverage.activeClientsInEmittedBands + out.coverage.unassignableActiveClients === out.coverage.activeClientsTotal],
    ['coverageComplete true (clean synthetic scan)', out.coverageComplete === true],
    // SQL — idempotent upsert; null literal for gated bands; the m2m rate; correct conflict key + table.
    ['SQL targets the table', sql.includes(`insert into ${TABLE}`)],
    ['SQL idempotent on (workspace_id, band)', sql.includes('on conflict (workspace_id, band) do update set')],
    ['SQL emits a null literal for a below-gate band', /'three_month', 1, 1, 0, null,/.test(sql)],
    ['SQL emits the m2m rate 0.167', sql.includes("'month_to_month', 6, 6, 1, 0.167,")],
    ['SQL sets refreshed_at = now()', sql.includes('refreshed_at           = now();')],
    // sha stability.
    ['payloadSha256 is 64-hex', /^[0-9a-f]{64}$/.test(out.payloadSha256)],
    ['payloadSha256 stable across rebuild', buildOutput(counts, probe, ASOF).payloadSha256 === out.payloadSha256],
  ];
  const failed = checks.filter(([, ok]) => !ok).map(([n]) => n);
  if (failed.length > 0) return fail(`assertions: ${failed.join(' | ')}`);

  // LEAK — no planted PII token survives; the scrubbed output clears the field-agnostic guard.
  const planted = PLANTED.filter((tok) => serialized.includes(tok) || sql.includes(tok));
  if (planted.length > 0) return fail(`output leaked planted token(s): ${[...new Set(planted)].join(', ')}`);
  if (!leakScanClean(serialized, ASOF, out.payloadSha256)) return fail('serialized output tripped the leak guard');
  if (!leakScanClean(sql, ASOF, out.payloadSha256)) return fail('SQL output tripped the leak guard');
  // Gap proof — the fixtures DID carry the sentinels, so the clean scan is a real suppression, not empty input.
  const rawFixtures = JSON.stringify({ clients, memberships });
  const notInFixtures = PLANTED.filter((tok) => !rawFixtures.includes(tok));
  if (notInFixtures.length > 0) return fail(`fixtures missing planted token(s) — leak scan vacuous: ${notInFixtures.join(', ')}`);

  console.log(serialized);
  console.log('\n--- DRY-RUN --commit SQL preview (gated apply only) ---\n');
  console.log(sql);
  console.log(
    '\nSELFTEST PASS: reshape to 7 band rows in canonical order (5 commitment + non_commitment + ' +
      'unclassified, each own row); attendance-known denominator; indicative rate NULL below the known-min ' +
      'gate while counts still emit; unassignable held OUT of the rows and surfaced in coverage; idempotent ' +
      'UPSERT SQL on (workspace_id, band); sha256 stable; no planted PII/date/id leaked; no file or network ' +
      'touched.',
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const argv = process.argv;
  if (argv.includes('--selftest')) {
    runSelfTest();
    return;
  }
  const commit = argv.includes('--commit');

  const apiKey = process.env.WODIFY_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    console.error(
      'WODIFY_API_KEY is not set. Provide it via a gitignored env file (never commit or paste it), e.g. ' +
        'npx tsx --env-file=/Users/wesley/Code/wx-cfo-scorecard/.env.local ' +
        'scripts/wodify/buildSilentChurnByCommitmentBand.ts. No request was made.',
    );
    process.exit(1);
    return;
  }

  const asOfDate = gymLocalAsOf();
  const asOf = ymd(asOfDate);
  const threshold = resolveSilentChurnThresholdDays(DEFAULT_SILENT_CHURN_THRESHOLD_DAYS);

  const clientsPull = await fetchAll(apiKey, CLIENTS_PATH, CLIENTS_RECORD_ARRAY_KEYS);
  const membershipsPull = await fetchAll(apiKey, MEMBERSHIPS_PATH, MEMBERSHIPS_RECORD_ARRAY_KEYS);

  const counts = analyze(clientsPull.records, membershipsPull.records, asOfDate, threshold);
  const meta: TransportMeta = {
    clientsHttpStatusClass: clientsPull.httpStatusClass,
    membershipsHttpStatusClass: membershipsPull.httpStatusClass,
    errorEnvelopeDetected: clientsPull.errorEnvelopeDetected || membershipsPull.errorEnvelopeDetected,
    clientsJsonParseable: clientsPull.jsonParseable,
    membershipsJsonParseable: membershipsPull.jsonParseable,
    clientsRecordKeySeen: clientsPull.recordKeySeen,
    membershipsRecordKeySeen: membershipsPull.recordKeySeen,
    clientsPagesFetched: clientsPull.pagesFetched,
    membershipsPagesFetched: membershipsPull.pagesFetched,
    reachedPageCap: clientsPull.reachedPageCap || membershipsPull.reachedPageCap,
  };
  const probe = buildResult(counts, meta, threshold, true);
  const out = buildOutput(counts, probe, asOf);

  const serialized = JSON.stringify(out, null, 2);
  if (!leakScanClean(serialized, asOf, out.payloadSha256)) {
    console.error('LEAK GUARD TRIPPED (dry-run): ISO date / "@" / 7+ digit run in output — aborting WITHOUT printing.');
    process.exit(1);
    return;
  }

  if (!commit) {
    console.log(serialized); // DRY-RUN: the aggregate + review-only coverage/diagnostics. Writes nothing.
    return;
  }

  // --commit: emit the GATED UPSERT SQL for a human to apply under the Supabase MCP two-AI gate. The script
  // NEVER opens a DB connection and holds no Supabase credential. Refuse to emit for an incomplete scan.
  if (!out.coverageComplete) {
    console.error(
      'Refusing to emit --commit SQL: the scan is not coverage-complete (a page cap, non-2xx, error envelope, ' +
        'or unseen record key). Re-run and confirm coverageComplete before any gated apply. No SQL emitted.',
    );
    process.exit(1);
    return;
  }
  const sql = buildUpsertSql(out.rows, asOf);
  if (!leakScanClean(sql, asOf, out.payloadSha256)) {
    console.error('LEAK GUARD TRIPPED (--commit SQL) — aborting WITHOUT printing.');
    process.exit(1);
    return;
  }
  console.error(
    `-- ${out.rows.length} band rows for as_of ${asOf}. Apply ONLY via the gated Supabase MCP run ` +
      '(Reviewer PASS + owner GO). This script did NOT write to any database.',
  );
  console.log(sql);
}

main().catch(() => {
  // Never surface raw error detail (it can echo URL / headers). Emit a generic, safe line only.
  console.error('silent-churn-by-commitment-band build failed before producing a result (no data emitted).');
  process.exit(1);
});
