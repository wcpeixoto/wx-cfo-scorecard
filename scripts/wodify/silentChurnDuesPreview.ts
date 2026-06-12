/**
 * Silent Churn $-AT-RISK LOCAL PREVIEW — /clients live classification × local dues CSV join.
 * LOCAL ONLY — NEVER RUN IN CI OR THE SPA. NO SYSTEM CHANGE (no schema / deploy / edge / SPA).
 *
 * Purpose (RETENTION_FINISH_PLAN.md §6.4 — the dues gap)
 *   The live Silent Churn card is count-only: `/clients` carries no dues, so the dollar shows
 *   "not available from this source yet" (never $0). Wesley exported the Wodify Admin
 *   "All Memberships" standard report as a raw CSV (PII: names + emails — the file lives at
 *   ~/.config/wx-cfo/dues/, 0700 dir, NEVER committed/uploaded). This script answers, as a
 *   one-shot LOCAL PREVIEW: if we joined that CSV to the live silent-member set, what monthly
 *   $ is at risk, and how complete would the dues coverage be? It prints AGGREGATES ONLY and
 *   changes nothing anywhere.
 *
 * Method
 *   1. Pull `/clients` live (key-from-env, the sibling probes' transport) and classify every
 *      ACTIVE member via the LOCKED shared classifier `classifyMember` (silentChurn.ts) at the
 *      Settings threshold (default DEFAULT_SILENT_CHURN_THRESHOLD_DAYS = 21, override
 *      --threshold N) — status via `normalizeStatus`, lastCheckIn via `pickLastCheckIn`
 *      (one definition, no fork; the faithful-predictor precedent).
 *   2. Parse the dues CSV (path = first non-flag argv). Cadence comes from the CLEAN
 *      `Payment Plan Type` column ('Monthly' | 'Pay in Full'); the free-text `Payment Plan`
 *      column (trailing-space variants, session-pack prose) is never read. The PII columns
 *      (`Client Name`, `Clients → Email`) are never read — parsing is index-based on the
 *      columns we need, so name/email bytes never enter the data path.
 *   3. Join on Wodify client id: `/clients` record field `id` (proven by #428) ↔ CSV `Client ID`.
 *   4. Derive a MONTHLY-EQUIVALENT per membership row: Commitment Total ÷ commitment months,
 *      months from Start/Expiration (expiration = last covered day, so period = days + 1;
 *      snapped to a whole month count when within MONTH_SNAP_TOLERANCE — a 30-day "Monthly"
 *      billing row derives exactly its CT; a 12-month Paid-in-Full prorates CT/12; awkward
 *      periods prorate fractionally). $0 commitment rows (comps / guest passes) derive an
 *      honest $0 — dues KNOWN, zero at risk. Rows with no derivable month count are surfaced,
 *      never guessed: open-ended (no expiration — session packs), future-start (queued
 *      renewals — excluded so a current+queued pair never double-counts), expired, degenerate
 *      (< MIN_MONTHS_DERIVABLE).
 *   5. Print aggregates per attendance bucket — silent (the deliverable) with watch / healthy /
 *      unknown as comparators: member count, CSV-matched count, dues-known coverage, total
 *      monthly $ at risk, and distribution stats (suppressed under
 *      MIN_KNOWN_FOR_DISTRIBUTION = 5 dues-known members — the year-range-guard precedent;
 *      count/sum/mean always emit, sum being the deliverable).
 *
 * Write-payload emit mode (SC $-at-risk slice PR-4 — the script still EXECUTES NOTHING):
 *   With `--emit-write-payload` (which REQUIRES `--csv-export-date YYYY-MM-DD`), a clean,
 *   coverage-complete run additionally carries, INSIDE the leak-gated result:
 *     - `writePayload`: the exact silent_dues_snapshot jsonb object — six camelCase keys,
 *       nothing else, matching the deployed SPA parse contract key-for-key:
 *       { duesAsOf, computedAsOf, thresholdDays, silentMembers, duesKnownCount, totalMonthly }
 *       (thresholdDays = the run's RESOLVED threshold; computedAsOf = the run-day asOf;
 *       duesAsOf = the --csv-export-date flag, cross-checked against the timestamp in the CSV
 *       filename when parseable — mismatch ABORTS before any network call).
 *     - `updateStatement`: the exact UPDATE to run later via Supabase MCP execute_sql under a
 *       native prompt in the gated run. Row targeting is DATE-LITERAL-FREE (subselect on
 *       max(as_of)); the ONLY dates anywhere in the emitted output sit inside the jsonb
 *       payload. The script itself makes NO Supabase call and writes NOTHING — it prints.
 *
 * Safety contract (same §4/§5 posture as the merged sibling probes):
 *   - Local / server-side ONLY. Never imported by the SPA, never bundled, never `VITE_*`.
 *   - Reads the rotated key ONLY from `process.env.WODIFY_API_KEY`; never hardcoded, logged,
 *     printed, or echoed. If unset/empty, exits WITHOUT any request — and NEVER sources the key
 *     from Supabase secrets or the edge function. `--selftest` returns BEFORE any env read and
 *     reads NO file.
 *   - ZERO member-level output. Stdout carries counts, booleans, status classes, dollar
 *     aggregates, and allowlisted snapshot-level dates ONLY. NEVER names, emails, member ids,
 *     raw rows, per-member dates or dollars, request headers/URLs, keys, or echoed bodies. A
 *     LEAK GATE scans the serialized result before printing (live AND selftest): any '@', any
 *     >= 7-digit run (ids are 7-8 digits; no emitted aggregate reaches 7 integer digits), or
 *     any YYYY-MM-DD outside the allowlist ⇒ the result is withheld and the run fails. The
 *     allowlist is EXACTLY {run-day asOf} — extended to EXACTLY {run-day asOf, duesAsOf} in
 *     emit mode (the ONE deliberate gate change of PR-4; any third date still trips it).
 *   - csv.membershipTypes is keyed by a CLOSED whitelist of category values profiled from the
 *     real export (PII columns never read); any other raw value folds under 'other' so no
 *     free-form export string can ride a record key into the gated output.
 *   - The dues CSV is read into memory, joined, and discarded. Nothing is written anywhere.
 *   - Detects the Wodify ERROR ENVELOPE at transport-2xx; in-body HTTPCode reduced to a class.
 *   - Paginates the FULL client set (edge-mirroring loop, MAX_PAGES bound); `coverageComplete`
 *     distinguishes a whole scan from a partial — a partial is never reported as a preview,
 *     and emit mode WITHHOLDS the write payload on a non-coverage-complete run.
 *
 * Run (LOCAL ONLY — key via gitignored env file; CSV by absolute path):
 *   Network-free self-test FIRST (no request, no key, no env, no file read):
 *     npx tsx scripts/wodify/silentChurnDuesPreview.ts --selftest
 *   Live run (gated: build + selftest -> Reviewer script review -> explicit Wesley GO):
 *     npx tsx --env-file=/Users/wesley/Code/wx-cfo-scorecard/.env.local \
 *       scripts/wodify/silentChurnDuesPreview.ts \
 *       ~/.config/wx-cfo/dues/all_memberships_2026-06-11T21_09_23.892773466Z.csv
 *   Gated-run emit mode (adds the leak-gated write payload + UPDATE statement):
 *     ... silentChurnDuesPreview.ts <csv path> --emit-write-payload --csv-export-date YYYY-MM-DD
 *
 * Call budget — GET `/clients` pages only (the same request the edge makes); no per-client
 * calls, no writes, no Supabase calls, no Wodify mutation of any kind.
 */

import { readFileSync } from 'node:fs';

import type { GymMember } from '../../src/lib/gym/memberFixture.ts';
import {
  DEFAULT_SILENT_CHURN_THRESHOLD_DAYS,
  WATCH_FLOOR_DAYS,
  classifyMember,
  parseYmdLocal,
  resolveSilentChurnThresholdDays,
  type AttendanceBucket,
} from '../../src/lib/gym/silentChurn.ts';
import { normalizeStatus, pickLastCheckIn } from '../../src/lib/gym/wodifyRetentionAggregate.ts';

// ─── CONFIG — transport mirrors supabase/functions/sync-wodify-retention/index.ts ─────────────────
const BASE_URL = 'https://api.wodify.com/v1';
const CLIENTS_PATH = '/clients';
const PAGE_SIZE = 100;
const MAX_PAGES = 50;
const REQUEST_TIMEOUT_MS = 15000;
const GYM_TZ = 'America/New_York'; // single gym — matches the shipped gymLocalDay decision (#445).

const CLIENT_ID_FIELD = 'id'; // /clients client-id field — proven by #428 (scripts/wodify/README.md).

// Monthly-equivalent derivation.
const MEAN_GREGORIAN_MONTH_DAYS = 30.4375; // 365.25 / 12 — the proration denominator.
const MONTH_SNAP_TOLERANCE = 0.2; // |exactMonths - round(exactMonths)| <= this ⇒ whole-month commitment.
const MIN_MONTHS_DERIVABLE = 0.25; // below this a division would explode — counted degenerate, never derived.
const MIN_KNOWN_FOR_DISTRIBUTION = 5; // year-range-guard precedent: tiny-N distribution ≈ a member's dollar.

// CSV columns this script READS (index-based; every other column — incl. the PII name/email
// columns — is never accessed). All must be present in the header or the parse fails loud.
const REQUIRED_COLUMNS = [
  'Client ID',
  'Membership Type',
  'Payment Plan Type',
  'Start Date',
  'Expiration Date',
  'Membership Autorenew',
  'Commitment Total',
] as const;

// §5 / #423: Wodify error-envelope markers (matched case-insensitively; values never emitted).
const ERROR_ENVELOPE_MARKER_KEYS = ['developermessage', 'errorcode', 'httpcode', 'usermessage'];

// Reviewer carry-in (dac13f6 script review): csv.membershipTypes is an OUTPUT record keyed by
// a raw CSV column value — an unbounded free-string key could smuggle arbitrary export text
// into the gated output. The key set is therefore CLOSED: the Membership Type category values
// actually present in the real All-Memberships export (profiled 2026-06-12 by reading ONLY the
// 'Membership Type' column — the PII columns are never read), pinned as constants the Reviewer
// verifies against their own profile of the file. Anything else folds under 'other'.
const MEMBERSHIP_TYPE_WHITELIST: ReadonlySet<string> = new Set([
  'Appointment Pack',
  'Class Pack',
  'Class Plan',
]);

function membershipTypeKey(raw: string): string {
  return MEMBERSHIP_TYPE_WHITELIST.has(raw) ? raw : 'other';
}

// ─── Safe output contract ──────────────────────────────────────────────────────────────────────────
type HttpStatusClass = '2xx' | '4xx' | '5xx' | 'network_error';

type RowKind = 'current_derived' | 'open_ended' | 'future_start' | 'expired' | 'degenerate';

interface DuesDistribution {
  duesKnownCount: number; // clients with >= 1 current derived row — the coverage numerator.
  totalMonthly: number; // Σ monthly-equivalent over dues-known clients — THE deliverable for silent.
  meanMonthly: number | null; // derivable from sum/count, so always emitted when count > 0.
  zeroDuesClients: number; // comps/guest passes — dues KNOWN, $0 at risk.
  // Suppressed (null + flag) under MIN_KNOWN_FOR_DISTRIBUTION dues-known clients.
  minMonthly: number | null;
  p25Monthly: number | null;
  medianMonthly: number | null;
  p75Monthly: number | null;
  maxMonthly: number | null;
  distributionSuppressed: boolean;
}

interface BucketDues extends DuesDistribution {
  members: number; // live actives classified into this bucket at T.
  csvMatched: number; // members with >= 1 CSV membership row (any kind).
  csvMatchedButDuesUnknown: number; // matched, but no current derived row (open-ended / future / expired / degenerate only).
  noCsvRow: number; // members - csvMatched — the structural coverage gap (~37% of actives expected).
  duesKnownCoveragePct: number; // duesKnownCount / members, 1 decimal.
}

interface CsvSummary {
  rowsTotal: number; // data rows parsed (excl. header).
  rowsInvalid: number; // failed strict validation — counted + reasoned, never silently dropped.
  invalidReasons: Record<string, number>; // reason enum -> count (no row content).
  distinctClients: number;
  rowKinds: Record<RowKind, number>;
  zeroCommitmentRows: number; // $0 comps / guest passes.
  cadence: { monthly: number; payInFull: number; other: number }; // from the CLEAN Payment Plan Type.
  membershipTypes: Record<string, number>; // product categories (Class Plan / Class Pack / …) — not PII.
  autorenew: { autoRenew: number; noAutoRenew: number; other: number };
  clientsNotInClientsApi: number; // CSV clients with no /clients record at all.
  clientsMatchedToNonActive: number; // CSV clients whose /clients record is not active.
}

interface TransportMeta {
  endpointReached: boolean;
  httpStatusClass: HttpStatusClass;
  errorEnvelopeDetected: boolean;
  embeddedHttpStatusClass: HttpStatusClass | null;
  jsonParseable: boolean | null;
  recordArrayKey: string | null;
  pagesFetched: number;
  reachedPageCap: boolean;
}

interface SilentChurnDuesPreviewResult {
  probe: 'silentChurnDuesPreview';
  path: string; // PATH only — never a query string / substituted URL.
  asOf: string; // gym-local run day — the ONLY date allowed in output (leak-gate-enforced).
  thresholdDays: number; // resolved Settings threshold (default 21).
  watchFloorDays: number;
  endpointReached: boolean;
  httpStatusClass: HttpStatusClass;
  errorEnvelopeDetected: boolean;
  embeddedHttpStatusClass: HttpStatusClass | null;
  jsonParseable: boolean | null;
  recordArrayKey: string | null;
  pagesFetched: number;
  reachedPageCap: boolean;
  coverageComplete: boolean;
  totalRecordsScanned: number;
  activeTotal: number;
  inactiveTotal: number;
  unknownStatusTotal: number;
  recordsMissingClientId: number; // active records whose `id` field was absent/non-canonical — join blind spots.
  bucketTotals: Record<AttendanceBucket, number>; // conservation: sums to activeTotal.
  csv: CsvSummary;
  buckets: Record<AttendanceBucket, BucketDues>; // silent = the deliverable; others = comparators.
  interpretationNotes: string[]; // self-describing caveats, restated in-band.
  // Emit mode ONLY (--emit-write-payload, coverage-complete run): the exact jsonb object +
  // UPDATE statement for the gated MCP write. INSIDE the result on purpose — the leak gate
  // scans the whole serialized result, so the payload and statement are gated too.
  writePayload?: SilentDuesWritePayload;
  updateStatement?: string;
}

// The silent_dues_snapshot inner contract — must match the deployed SPA parse
// (src/lib/gym/silentChurnDuesView.ts SilentDuesSnapshot) KEY-FOR-KEY: six camelCase
// keys, nothing else. The SPA's parse is fail-closed on missing keys and drops
// extras, so any drift here surfaces as the card degrading to count-only.
interface SilentDuesWritePayload {
  duesAsOf: string; // the CSV export day (--csv-export-date) — the figure's staleness anchor
  computedAsOf: string; // the run-day asOf this preview classified members on
  thresholdDays: number; // the run's RESOLVED threshold (the $ is threshold-coupled)
  silentMembers: number; // M — silent actives at thresholdDays
  duesKnownCount: number; // N — silent members with a derivable monthly-equivalent
  totalMonthly: number; // the floor $ (round2'd, same as buckets.silent.totalMonthly)
}

const INTERPRETATION_NOTES = [
  'LOCAL PREVIEW ONLY — nothing is persisted, deployed, or changed; the CSV stays local.',
  'duesKnown requires a CURRENT derivable membership row; open-ended packs, queued future rows, ' +
    'expired rows, and degenerate periods are counted but never guessed at — the silent total ' +
    'monthly $ is therefore a floor, not a ceiling.',
  '$0 comps/guest passes are dues-KNOWN at $0: a comp member churning risks no dues revenue.',
  'Only ~63% of actives are expected to hold a membership row in this export — noCsvRow is a ' +
    'structural export gap, not a join failure (cross-check clientsNotInClientsApi stays small).',
  'Distribution stats are suppressed under ' + String(MIN_KNOWN_FOR_DISTRIBUTION) +
    ' dues-known members (a tiny-N min/max approaches a single member’s dollar).',
];

// ─── Pure helpers (none emit, log, or retain member-level values) ──────────────────────────────────
function statusClassOf(status: number): HttpStatusClass {
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 500) return '5xx';
  return '4xx';
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

interface ErrorEnvelopeInfo {
  detected: boolean;
  embeddedStatusClass: HttpStatusClass | null;
}

function detectErrorEnvelope(parsed: unknown): ErrorEnvelopeInfo {
  if (!isPlainObject(parsed)) return { detected: false, embeddedStatusClass: null };
  const actualByLower = new Map<string, string>();
  for (const k of Object.keys(parsed)) actualByLower.set(k.toLowerCase(), k);
  const markerHits = ERROR_ENVELOPE_MARKER_KEYS.filter((m) => actualByLower.has(m));
  const httpCodeKey = actualByLower.get('httpcode');
  const detected = httpCodeKey !== undefined || markerHits.length >= 2;
  if (!detected) return { detected: false, embeddedStatusClass: null };
  let embeddedStatusClass: HttpStatusClass | null = null;
  if (httpCodeKey !== undefined) {
    const code = Number(parsed[httpCodeKey]);
    if (Number.isFinite(code) && code >= 100 && code < 600) embeddedStatusClass = statusClassOf(code);
  }
  return { detected, embeddedStatusClass };
}

// Strict calendar round-trip (the membership-start probe's fold-in #2 precedent): 2026-02-30
// parses but rebuilds as March 2 → rejected. CSV dates must be REAL calendar days.
function strictYmdToUtcMs(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  const dt = new Date(ms);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return ms;
}

// Gym-local run day (en-CA yields ISO order); classification functions take asOf as a PARAMETER
// so the selftest is deterministic.
function gymLocalTodayYmd(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: GYM_TZ }).format(new Date());
}

// Canonical client id for the join: digit string, leading zeros stripped. Anything else → null
// (counted, never guessed). Accepts number or string — #428 proved the field, not its JSON type.
function canonicalClientId(v: unknown): string | null {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return String(v);
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!/^\d+$/.test(s)) return null;
  return s.replace(/^0+(?=\d)/, '');
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

// ─── CSV layer (RFC-4180-ish: quoted fields, "" escapes, CRLF; no dependencies) ───────────────────
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  // Strip a UTF-8 BOM so the first header cell matches exactly.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row); // skip blank lines
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  return rows;
}

type Cadence = 'monthly' | 'payInFull' | 'other';

interface MembershipRow {
  clientId: string;
  membershipType: string;
  cadence: Cadence;
  autorenew: 'autoRenew' | 'noAutoRenew' | 'other';
  startUtcMs: number;
  expirationUtcMs: number | null; // null = open-ended (no expiration).
  commitmentTotal: number;
}

type InvalidReason =
  | 'bad_client_id'
  | 'bad_start_date'
  | 'bad_expiration_date'
  | 'bad_commitment_total'
  | 'short_row';

interface ParsedCsv {
  rows: MembershipRow[];
  rowsTotal: number;
  rowsInvalid: number;
  invalidReasons: Record<string, number>;
}

// Parse the dues CSV from raw text. Throws (loudly, with COLUMN NAMES only — never row content)
// when a required column is missing; per-row problems are counted, not thrown.
function parseMembershipCsv(text: string): ParsedCsv {
  const table = parseCsv(text);
  if (table.length === 0) throw new Error('dues CSV is empty');
  const header = table[0].map((h) => h.trim());
  const idx = new Map<string, number>();
  for (const col of REQUIRED_COLUMNS) {
    const i = header.indexOf(col);
    if (i === -1) throw new Error(`dues CSV is missing required column(s): ${col}`);
    idx.set(col, i);
  }
  const col = (row: string[], name: (typeof REQUIRED_COLUMNS)[number]): string =>
    (row[idx.get(name) as number] ?? '').trim();

  const rows: MembershipRow[] = [];
  const invalidReasons: Record<string, number> = {};
  let rowsInvalid = 0;
  const invalid = (reason: InvalidReason): void => {
    rowsInvalid += 1;
    invalidReasons[reason] = (invalidReasons[reason] ?? 0) + 1;
  };

  const minRowLen = Math.max(...REQUIRED_COLUMNS.map((c) => idx.get(c) as number)) + 1;
  for (let r = 1; r < table.length; r++) {
    const raw = table[r];
    if (raw.length < minRowLen) {
      invalid('short_row');
      continue;
    }
    const clientId = canonicalClientId(col(raw, 'Client ID'));
    if (clientId === null) {
      invalid('bad_client_id');
      continue;
    }
    const startUtcMs = strictYmdToUtcMs(col(raw, 'Start Date'));
    if (startUtcMs === null) {
      invalid('bad_start_date');
      continue;
    }
    const expirationRaw = col(raw, 'Expiration Date');
    let expirationUtcMs: number | null = null;
    if (expirationRaw !== '') {
      expirationUtcMs = strictYmdToUtcMs(expirationRaw);
      if (expirationUtcMs === null) {
        invalid('bad_expiration_date');
        continue;
      }
    }
    // parseFloat handles both '179.00000000' and the export's scientific-notation zero '0E-8'.
    const commitmentTotal = Number.parseFloat(col(raw, 'Commitment Total'));
    if (!Number.isFinite(commitmentTotal) || commitmentTotal < 0) {
      invalid('bad_commitment_total');
      continue;
    }
    const cadenceRaw = col(raw, 'Payment Plan Type').toLowerCase();
    const cadence: Cadence =
      cadenceRaw === 'monthly' ? 'monthly' : cadenceRaw === 'pay in full' ? 'payInFull' : 'other';
    const autorenewRaw = col(raw, 'Membership Autorenew').toLowerCase();
    const autorenew =
      autorenewRaw === 'auto renew' ? 'autoRenew' : autorenewRaw === 'no auto renew' ? 'noAutoRenew' : 'other';
    rows.push({
      clientId,
      membershipType: col(raw, 'Membership Type'),
      cadence,
      autorenew,
      startUtcMs,
      expirationUtcMs,
      commitmentTotal,
    });
  }
  return { rows, rowsTotal: table.length - 1, rowsInvalid, invalidReasons };
}

// ─── Monthly-equivalent derivation ─────────────────────────────────────────────────────────────────
const DAY_MS = 86_400_000;

interface RowDerivation {
  kind: RowKind;
  monthlyEquivalent: number | null; // set ONLY for kind 'current_derived'.
}

// Derive one row against the run day. Expiration is the LAST COVERED day (inclusive), so the
// commitment period is (expiration - start) + 1 days. A whole-month period within
// MONTH_SNAP_TOLERANCE snaps to its integer month count (a 30-day Monthly row derives exactly
// CT; a 365-day Paid-in-Full derives CT/12); anything else prorates fractionally. The
// derivation is cadence-independent — Payment Plan Type is reported as a diagnostic only.
function deriveRow(row: MembershipRow, asOfUtcMs: number): RowDerivation {
  if (row.startUtcMs > asOfUtcMs) return { kind: 'future_start', monthlyEquivalent: null };
  if (row.expirationUtcMs === null) return { kind: 'open_ended', monthlyEquivalent: null };
  if (row.expirationUtcMs < asOfUtcMs) return { kind: 'expired', monthlyEquivalent: null };
  const periodDays = (row.expirationUtcMs - row.startUtcMs) / DAY_MS + 1;
  const exactMonths = periodDays / MEAN_GREGORIAN_MONTH_DAYS;
  if (exactMonths < MIN_MONTHS_DERIVABLE) return { kind: 'degenerate', monthlyEquivalent: null };
  const snapped = Math.round(exactMonths);
  const months =
    snapped >= 1 && Math.abs(exactMonths - snapped) <= MONTH_SNAP_TOLERANCE ? snapped : exactMonths;
  return { kind: 'current_derived', monthlyEquivalent: row.commitmentTotal / months };
}

interface ClientDues {
  monthlyTotal: number; // Σ current_derived monthly equivalents (raw float; rounded at output).
  derivedRows: number;
  rowKinds: Partial<Record<RowKind, number>>;
}

// Collapse membership rows per client. Multi-membership clients SUM their current derived rows
// (a real concurrent add-on adds dues); non-derivable rows are counted per kind.
function collapseByClient(rows: MembershipRow[], asOfUtcMs: number): Map<string, ClientDues> {
  const byClient = new Map<string, ClientDues>();
  for (const row of rows) {
    const d = deriveRow(row, asOfUtcMs);
    let acc = byClient.get(row.clientId);
    if (!acc) {
      acc = { monthlyTotal: 0, derivedRows: 0, rowKinds: {} };
      byClient.set(row.clientId, acc);
    }
    acc.rowKinds[d.kind] = (acc.rowKinds[d.kind] ?? 0) + 1;
    if (d.kind === 'current_derived' && d.monthlyEquivalent !== null) {
      acc.monthlyTotal += d.monthlyEquivalent;
      acc.derivedRows += 1;
    }
  }
  return byClient;
}

// ─── Distribution stats (pure; suppression mirrors the year-range guard) ──────────────────────────
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 1) return sortedAsc[0];
  const rank = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (rank - lo);
}

function buildDistribution(duesKnownMonthly: number[], zeroDuesClients: number): DuesDistribution {
  const n = duesKnownMonthly.length;
  const total = duesKnownMonthly.reduce((a, b) => a + b, 0);
  const sorted = [...duesKnownMonthly].sort((a, b) => a - b);
  const emit = n >= MIN_KNOWN_FOR_DISTRIBUTION;
  return {
    duesKnownCount: n,
    totalMonthly: round2(total),
    meanMonthly: n > 0 ? round2(total / n) : null,
    zeroDuesClients,
    minMonthly: emit ? round2(sorted[0]) : null,
    p25Monthly: emit ? round2(percentile(sorted, 25)) : null,
    medianMonthly: emit ? round2(percentile(sorted, 50)) : null,
    p75Monthly: emit ? round2(percentile(sorted, 75)) : null,
    maxMonthly: emit ? round2(percentile(sorted, 100)) : null,
    distributionSuppressed: !emit,
  };
}

// ─── Classification + join (pure; ids stay in memory, never in output) ────────────────────────────
interface ClassifiedClients {
  bucketsById: Map<string, AttendanceBucket>; // canonical id -> bucket (ACTIVE members only).
  nonActiveIds: Set<string>; // inactive/unknown-status ids — in memory ONLY, for the join split.
  bucketTotals: Record<AttendanceBucket, number>;
  activeTotal: number;
  inactiveTotal: number;
  unknownStatusTotal: number;
  recordsMissingClientId: number;
  totalRecordsScanned: number;
}

function freshClassified(): ClassifiedClients {
  return {
    bucketsById: new Map(),
    nonActiveIds: new Set(),
    bucketTotals: { healthy: 0, watch: 0, silent: 0, unknown: 0 },
    activeTotal: 0,
    inactiveTotal: 0,
    unknownStatusTotal: 0,
    recordsMissingClientId: 0,
    totalRecordsScanned: 0,
  };
}

// Adapter into the LOCKED classifier: classifyMember reads only `status` and `lastCheckIn`; the
// other GymMember fields are inert placeholders (no member data enters them). Non-active and
// unknown-status members map to a non-'active' status, which classifyMember excludes (null) —
// byte-identical exclusion semantics to the live aggregate's census.
function classifyRecord(
  rec: Record<string, unknown>,
  thresholdDays: number,
  asOf: Date,
): AttendanceBucket | null {
  const status = normalizeStatus(rec['client_status']);
  const member: GymMember = {
    id: '',
    displayName: '',
    status: status === 'active' ? 'active' : 'ended',
    monthlyDues: 0,
    membershipStart: '',
    lastCheckIn: pickLastCheckIn(rec['last_attendance'], rec['last_class_sign_in']),
  };
  const c = classifyMember(member, thresholdDays, asOf);
  return c === null ? null : c.bucket;
}

function tallyRecords(
  records: readonly unknown[],
  acc: ClassifiedClients,
  thresholdDays: number,
  asOf: Date,
): void {
  for (const rec of records) {
    acc.totalRecordsScanned += 1;
    const obj = isPlainObject(rec) ? rec : null;
    if (!obj) {
      acc.unknownStatusTotal += 1;
      continue;
    }
    const status = normalizeStatus(obj['client_status']);
    if (status !== 'active') {
      if (status === 'inactive') acc.inactiveTotal += 1;
      else acc.unknownStatusTotal += 1;
      const nonActiveId = canonicalClientId(obj[CLIENT_ID_FIELD]);
      if (nonActiveId !== null) acc.nonActiveIds.add(nonActiveId);
      continue;
    }
    acc.activeTotal += 1;
    const bucket = classifyRecord(obj, thresholdDays, asOf) ?? 'unknown';
    acc.bucketTotals[bucket] += 1;
    const id = canonicalClientId(obj[CLIENT_ID_FIELD]);
    if (id === null) {
      acc.recordsMissingClientId += 1;
      continue; // counted as a join blind spot; still in bucketTotals.
    }
    acc.bucketsById.set(id, bucket);
  }
}

const BUCKETS: AttendanceBucket[] = ['silent', 'watch', 'healthy', 'unknown'];

function buildResult(
  classified: ClassifiedClients,
  parsed: ParsedCsv,
  byClient: Map<string, ClientDues>,
  rowsForCounts: MembershipRow[],
  meta: TransportMeta,
  asOfYmd: string,
  asOfUtcMs: number,
  thresholdDays: number,
): SilentChurnDuesPreviewResult {
  // CSV-level row-kind + diagnostic counts.
  const rowKinds: Record<RowKind, number> = {
    current_derived: 0,
    open_ended: 0,
    future_start: 0,
    expired: 0,
    degenerate: 0,
  };
  let zeroCommitmentRows = 0;
  const cadence = { monthly: 0, payInFull: 0, other: 0 };
  const membershipTypes: Record<string, number> = {};
  const autorenew = { autoRenew: 0, noAutoRenew: 0, other: 0 };
  for (const row of rowsForCounts) {
    rowKinds[deriveRow(row, asOfUtcMs).kind] += 1;
    if (row.commitmentTotal === 0) zeroCommitmentRows += 1;
    cadence[row.cadence] += 1;
    // Whitelist-or-'other': only pinned category values may key the gated output.
    const typeKey = membershipTypeKey(row.membershipType);
    membershipTypes[typeKey] = (membershipTypes[typeKey] ?? 0) + 1;
    autorenew[row.autorenew] += 1;
  }

  // Join split for interpretation: a CSV client absent from the ACTIVE set is either a known
  // non-active /clients record (export lag / recent end) or absent from /clients entirely.
  let clientsNotInClientsApi = 0;
  let clientsMatchedToNonActive = 0;
  for (const clientId of byClient.keys()) {
    if (classified.bucketsById.has(clientId)) continue;
    if (classified.nonActiveIds.has(clientId)) clientsMatchedToNonActive += 1;
    else clientsNotInClientsApi += 1;
  }

  // Per-bucket join + dues aggregates.
  const buckets = {} as Record<AttendanceBucket, BucketDues>;
  const knownByBucket: Record<AttendanceBucket, number[]> = { healthy: [], watch: [], silent: [], unknown: [] };
  const matchedByBucket: Record<AttendanceBucket, number> = { healthy: 0, watch: 0, silent: 0, unknown: 0 };
  const zeroByBucket: Record<AttendanceBucket, number> = { healthy: 0, watch: 0, silent: 0, unknown: 0 };
  for (const [clientId, bucket] of classified.bucketsById) {
    const dues = byClient.get(clientId);
    if (!dues) continue;
    matchedByBucket[bucket] += 1;
    if (dues.derivedRows > 0) {
      knownByBucket[bucket].push(dues.monthlyTotal);
      if (dues.monthlyTotal === 0) zeroByBucket[bucket] += 1;
    }
  }
  for (const b of BUCKETS) {
    const dist = buildDistribution(knownByBucket[b], zeroByBucket[b]);
    const members = classified.bucketTotals[b];
    buckets[b] = {
      members,
      csvMatched: matchedByBucket[b],
      csvMatchedButDuesUnknown: matchedByBucket[b] - dist.duesKnownCount,
      noCsvRow: members - matchedByBucket[b],
      duesKnownCoveragePct: members > 0 ? round1((100 * dist.duesKnownCount) / members) : 0,
      ...dist,
    };
  }

  const coverageComplete =
    meta.endpointReached &&
    meta.httpStatusClass === '2xx' &&
    !meta.errorEnvelopeDetected &&
    meta.jsonParseable !== false &&
    !meta.reachedPageCap &&
    meta.pagesFetched > 0 &&
    meta.recordArrayKey !== null &&
    classified.totalRecordsScanned > 0;

  return {
    probe: 'silentChurnDuesPreview',
    path: CLIENTS_PATH,
    asOf: asOfYmd,
    thresholdDays,
    watchFloorDays: WATCH_FLOOR_DAYS,
    endpointReached: meta.endpointReached,
    httpStatusClass: meta.httpStatusClass,
    errorEnvelopeDetected: meta.errorEnvelopeDetected,
    embeddedHttpStatusClass: meta.embeddedHttpStatusClass,
    jsonParseable: meta.jsonParseable,
    recordArrayKey: meta.recordArrayKey,
    pagesFetched: meta.pagesFetched,
    reachedPageCap: meta.reachedPageCap,
    coverageComplete,
    totalRecordsScanned: classified.totalRecordsScanned,
    activeTotal: classified.activeTotal,
    inactiveTotal: classified.inactiveTotal,
    unknownStatusTotal: classified.unknownStatusTotal,
    recordsMissingClientId: classified.recordsMissingClientId,
    bucketTotals: { ...classified.bucketTotals },
    csv: {
      rowsTotal: parsed.rowsTotal,
      rowsInvalid: parsed.rowsInvalid,
      invalidReasons: parsed.invalidReasons,
      distinctClients: byClient.size,
      rowKinds,
      zeroCommitmentRows,
      cadence,
      membershipTypes,
      autorenew,
      clientsNotInClientsApi,
      clientsMatchedToNonActive,
    },
    buckets,
    interpretationNotes: INTERPRETATION_NOTES,
  };
}

// ─── Write payload + UPDATE statement (emit mode; built, never executed) ──────────────────────────
// The jsonb object for the gated MCP write — silent-bucket aggregates only, six keys,
// key order matching the documented contract for byte-stable review diffs.
function buildWritePayload(
  result: SilentChurnDuesPreviewResult,
  duesAsOf: string,
): SilentDuesWritePayload {
  const s = result.buckets.silent;
  return {
    duesAsOf,
    computedAsOf: result.asOf,
    thresholdDays: result.thresholdDays,
    silentMembers: s.members,
    duesKnownCount: s.duesKnownCount,
    totalMonthly: s.totalMonthly,
  };
}

// The exact statement the gated run executes via Supabase MCP execute_sql. Row targeting is
// DATE-LITERAL-FREE by Reviewer pin: the latest row is selected via a max(as_of) subselect, so
// the ONLY dates in the whole emitted output live inside the jsonb payload (allowlisted by the
// leak gate). Single-quote escaping is defensive — no payload field can legally contain one.
function buildUpdateStatement(payload: SilentDuesWritePayload): string {
  const json = JSON.stringify(payload).replace(/'/g, "''");
  return [
    'update public.wodify_retention_aggregate',
    `  set silent_dues_snapshot = '${json}'::jsonb`,
    "  where workspace_id = 'default'",
    '    and as_of = (select max(as_of) from public.wodify_retention_aggregate',
    "                 where workspace_id = 'default');",
  ].join('\n');
}

// ─── Leak gate (live AND selftest; the result is withheld on any hit) ─────────────────────────────
// The date allowlist is EXACTLY {run-day asOf} — in emit mode EXACTLY {run-day asOf, duesAsOf}
// (PR-4's one deliberate gate change). Any other YYYY-MM-DD still withholds the result.
function leakGateViolations(serialized: string, asOfYmd: string, duesAsOfYmd?: string): string[] {
  const violations: string[] = [];
  if (serialized.includes('@')) violations.push('an @ (email-like) character reached the output');
  if (/\d{7,}/.test(serialized)) violations.push('a 7+ digit run (id-like) reached the output');
  const allowed = new Set(duesAsOfYmd ? [asOfYmd, duesAsOfYmd] : [asOfYmd]);
  const dates = serialized.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
  if (dates.some((d) => !allowed.has(d))) {
    violations.push('a date outside the allowlist (run-day asOf + duesAsOf) reached the output');
  }
  return violations;
}

// ─── Live network layer (body read for tally only; never logged / returned as text) ───────────────
async function scanAllClients(
  apiKey: string,
  thresholdDays: number,
  asOf: Date,
): Promise<{ classified: ClassifiedClients; meta: TransportMeta }> {
  const classified = freshClassified();
  const meta: TransportMeta = {
    endpointReached: true,
    httpStatusClass: '2xx',
    errorEnvelopeDetected: false,
    embeddedHttpStatusClass: null,
    jsonParseable: null,
    recordArrayKey: null,
    pagesFetched: 0,
    reachedPageCap: false,
  };

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = new URL(BASE_URL + CLIENTS_PATH);
    url.searchParams.set('page', String(page));
    url.searchParams.set('pageSize', String(PAGE_SIZE));

    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'x-api-key': apiKey, accept: 'application/json' }, // key never logged
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      if (page === 1) meta.endpointReached = false;
      meta.httpStatusClass = 'network_error';
      return { classified, meta };
    }

    meta.httpStatusClass = statusClassOf(res.status);
    if (!res.ok) return { classified, meta };

    let bodyText = '';
    try {
      bodyText = await res.text();
    } catch {
      bodyText = '';
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      meta.jsonParseable = false;
      return { classified, meta };
    }
    meta.jsonParseable = true;

    const envelope = detectErrorEnvelope(parsed);
    if (envelope.detected) {
      meta.errorEnvelopeDetected = true;
      meta.embeddedHttpStatusClass = envelope.embeddedStatusClass;
      return { classified, meta };
    }

    const clients = isPlainObject(parsed) ? parsed['clients'] : undefined;
    const records: unknown[] = Array.isArray(clients) ? clients : [];
    if (meta.recordArrayKey === null && Array.isArray(clients)) meta.recordArrayKey = 'clients';
    tallyRecords(records, classified, thresholdDays, asOf);
    meta.pagesFetched += 1;

    const pagination = isPlainObject(parsed) ? parsed['pagination'] : undefined;
    const hasMore = isPlainObject(pagination) && pagination['has_more'] === true;
    if (!hasMore || records.length === 0) break;
    if (page === MAX_PAGES) meta.reachedPageCap = true;
  }

  return { classified, meta };
}

// ─── Network-free self-test (REQUIRED before any live run; no request, no key, no env, no file) ────
function runSelfTest(): void {
  const ASOF = '2026-06-15'; // injected — deterministic, independent of machine clock/timezone.
  const asOfUtcMs = strictYmdToUtcMs(ASOF) as number;
  const asOfDate = parseYmdLocal(ASOF) as Date;
  const T = DEFAULT_SILENT_CHURN_THRESHOLD_DAYS;

  // PII / secrets planted across BOTH fixtures. NONE may appear in output — including the
  // member ids and every member-level date and dollar.
  const PII = [
    'SECRET_FIRST',
    'SECRET_LAST',
    'Quoted, Name',
    'secret@member.example',
    'leak@example.com',
    '9000001',
    '9000002',
    '9000003',
    '9000004',
    '9000005',
    '9000006',
    '9000007',
    '9000008',
    '9000009',
    '9000010',
    '9000011',
    '9000012',
    '9000013',
    '2026-05-01', // member lastCheckIn dates — must never echo
    '2026-06-01',
    '2026-06-14',
    '2025-09-15', // membership start/expiration dates — must never echo
    '2026-12-31',
  ];

  // Synthetic dues CSV — REAL export header (incl. the PII columns this script never reads),
  // quoted names with commas (column-alignment hazard), trailing-space cadence variant,
  // scientific-notation zero, multi-membership client, open-ended pack, future-start queued
  // renewal, expired row, degenerate period, invalid calendar date, unmatched + inactive clients.
  const csvText = [
    'Client ID,Client Name,Membership ID,Membership,Membership Type,Payment Plan,Programs,Location,Start Date,Expiration Date,Membership Autorenew,Commitment Total,Autorenew Commitment Total,Payment Plan Type,Clients → Email,Clients → Mass Email Subscribed,Clients → Default Payment Method',
    // C1 silent — TWO current rows (multi-membership: 179 + 1200/12 = 279/mo).
    '9000001,"SECRET_LAST, SECRET_FIRST",80000001,BJJ Unlimited,Class Plan,Monthly ,BJJ,Gym,2026-06-01,2026-06-30,Auto Renew,179.00000000,179.00000000,Monthly,secret@member.example,Yes,Card',
    '9000001,"SECRET_LAST, SECRET_FIRST",80000002,Annual Add-on,Class Plan,Paid in Full,BJJ,Gym,2026-01-01,2026-12-31,No Auto Renew,1200.00000000,1200.00000000,Pay in Full,secret@member.example,Yes,Card',
    // C2 watch — 12-month PiF proration (1799/12 = 149.92) + an awkward fractional period (550 / 5.454mo = 100.84).
    '9000002,"Quoted, Name",80000003,Annual,Class Plan,Paid in Full,BJJ,Gym,2025-09-15,2026-09-14,No Auto Renew,1799.00000000,1799.00000000,Pay in Full,leak@example.com,Yes,Card',
    '9000002,"Quoted, Name",80000004,Partial Term,Class Plan,Paid in Full,BJJ,Gym,2026-01-01,2026-06-15,No Auto Renew,550.00000000,550.00000000,Pay in Full,leak@example.com,Yes,Card',
    // C3 healthy — $0 comp (scientific-notation zero): dues KNOWN at $0.
    '9000003,"SECRET_LAST, SECRET_FIRST",80000005,Staff Comp,Class Plan,Paid in Full,BJJ,Gym,2026-01-01,2026-12-31,No Auto Renew,0E-8,0E-8,Pay in Full,secret@member.example,No,None',
    // C4 silent — open-ended session pack: matched but dues-UNKNOWN.
    '9000004,"SECRET_LAST, SECRET_FIRST",80000006,10 Session Pack,Appointment Pack,10 session pack,BJJ,Gym,2026-03-01,,No Auto Renew,400.00000000,400.00000000,Pay in Full,secret@member.example,No,Card',
    // C5 silent — future-start queued renewal ONLY: matched but dues-UNKNOWN (never double-counted).
    '9000005,"SECRET_LAST, SECRET_FIRST",80000007,BJJ Unlimited,Class Plan,Monthly,BJJ,Gym,2026-07-01,2026-07-31,Auto Renew,200.00000000,200.00000000,Monthly,secret@member.example,Yes,Card',
    // C6 healthy — trailing-space cadence variant in Payment Plan Type itself.
    '9000006,"SECRET_LAST, SECRET_FIRST",80000008,BJJ Basic,Class Plan,Monthly,BJJ,Gym,2026-06-01,2026-06-30,Auto Renew,150.00000000,150.00000000,Monthly ,secret@member.example,Yes,Card',
    // C7 watch — EXPIRED row only: matched but dues-UNKNOWN.
    '9000007,"SECRET_LAST, SECRET_FIRST",80000009,BJJ Unlimited,Class Plan,Monthly,BJJ,Gym,2026-04-01,2026-04-30,No Auto Renew,179.00000000,179.00000000,Monthly,secret@member.example,Yes,Card',
    // C8 healthy — degenerate period (start == expiration == asOf, still current): counted, never derived.
    '9000008,"SECRET_LAST, SECRET_FIRST",80000010,Day Pass,Class Pack,Day,BJJ,Gym,2026-06-15,2026-06-15,No Auto Renew,100.00000000,100.00000000,Pay in Full,secret@member.example,No,Cash',
    // C9 — CSV client with NO /clients record (export/orphan): clientsNotInClientsApi.
    '9000009,"SECRET_LAST, SECRET_FIRST",80000011,BJJ Unlimited,Class Plan,Monthly,BJJ,Gym,2026-06-01,2026-06-30,Auto Renew,179.00000000,179.00000000,Monthly,secret@member.example,Yes,Card',
    // C10 — CSV client who is INACTIVE in /clients: clientsMatchedToNonActive.
    '9000010,"SECRET_LAST, SECRET_FIRST",80000012,BJJ Unlimited,Class Plan,Monthly,BJJ,Gym,2026-06-01,2026-06-30,Auto Renew,179.00000000,179.00000000,Monthly,secret@member.example,Yes,Card',
    // Invalid calendar date (2026-02-30 — strict round-trip rejects): counted, skipped.
    '9000001,"SECRET_LAST, SECRET_FIRST",80000013,BJJ Unlimited,Class Plan,Monthly,BJJ,Gym,2026-02-30,2026-03-29,Auto Renew,179.00000000,179.00000000,Monthly,secret@member.example,Yes,Card',
  ].join('\r\n');

  // Synthetic /clients records (live shape: client_status / last_attendance / last_class_sign_in / id).
  const records: unknown[] = [
    { id: 9000001, first_name: 'SECRET_FIRST', email: 'secret@member.example', client_status: 'Active', last_attendance: '2026-05-01T07:00:00Z' }, // 45d → silent
    { id: '9000002', client_status: 'Active', last_attendance: '2026-06-01' }, // 14d → watch
    { id: 9000003, client_status: 'Active', last_class_sign_in: '2026-06-14' }, // 1d → healthy
    { id: 9000004, client_status: 'Active', last_attendance: '2026-04-01' }, // 75d → silent
    { id: 9000005, client_status: 'Active', last_attendance: '2026-05-20' }, // 26d → silent
    { id: 9000006, client_status: 'Active', last_attendance: '2026-06-15' }, // 0d → healthy
    { id: 9000007, client_status: 'Active', last_attendance: '2026-06-04' }, // 11d → watch
    { id: 9000008, client_status: 'Active', last_attendance: '2026-06-10' }, // 5d → healthy
    { id: 9000010, client_status: 'Inactive', last_attendance: '2026-06-01' }, // inactive — excluded
    { id: 9000011, client_status: 'Active', last_attendance: '2026-05-10' }, // 36d → silent, NO CSV row
    { id: 9000012, client_status: 'Active' }, // no recency fields → unknown bucket
    { id: 9000013, client_status: 'Active', last_attendance: '1900-01-01' }, // sentinel → unknown bucket
    { id: 9000014, client_status: 'Trial', last_attendance: '2026-06-01' }, // unrecognized → unknownStatus
  ];

  const classified = freshClassified();
  tallyRecords(records, classified, T, asOfDate);
  const parsed = parseMembershipCsv(csvText);
  const byClient = collapseByClient(parsed.rows, asOfUtcMs);
  const result = buildResult(classified, parsed, byClient, parsed.rows, {
    endpointReached: true,
    httpStatusClass: '2xx',
    errorEnvelopeDetected: false,
    embeddedHttpStatusClass: null,
    jsonParseable: true,
    recordArrayKey: 'clients',
    pagesFetched: 1,
    reachedPageCap: false,
  }, ASOF, asOfUtcMs, T);
  const serialized = JSON.stringify(result, null, 2);
  console.log(serialized);

  // (1) LEAK SCAN — planted PII tokens AND the structural gate (the same gate the live run uses).
  const leaks = PII.filter((tok) => serialized.includes(tok));
  leaks.push(...leakGateViolations(serialized, ASOF));
  if (leaks.length > 0) {
    console.error(`SELFTEST FAIL: output contained disallowed token(s): ${leaks.join(', ')}`);
    process.exit(1);
    return;
  }

  const s = result.buckets.silent;
  const w = result.buckets.watch;
  const h = result.buckets.healthy;
  const u = result.buckets.unknown;
  const expectations: Array<[string, boolean]> = [
    // Census + classifier (LOCKED classifyMember at T=21 via the adapter).
    ['activeTotal == 11', result.activeTotal === 11],
    ['inactive == 1, unknownStatus == 1 (Trial fails closed)', result.inactiveTotal === 1 && result.unknownStatusTotal === 1],
    ['bucketTotals: silent 4 / watch 2 / healthy 3 / unknown 2', result.bucketTotals.silent === 4 && result.bucketTotals.watch === 2 && result.bucketTotals.healthy === 3 && result.bucketTotals.unknown === 2],
    ['conservation: buckets sum to activeTotal', result.bucketTotals.silent + result.bucketTotals.watch + result.bucketTotals.healthy + result.bucketTotals.unknown === result.activeTotal],
    // CSV parse: 13 data rows, 1 invalid (2026-02-30), quoted commas never misalign columns.
    ['csv rowsTotal == 13, rowsInvalid == 1 (bad_start_date)', result.csv.rowsTotal === 13 && result.csv.rowsInvalid === 1 && result.csv.invalidReasons['bad_start_date'] === 1],
    ['csv distinctClients == 10', result.csv.distinctClients === 10],
    // Row kinds: derived 7 (C1×2, C2×2, C3, C6, C9-row... see fixture) — count precisely:
    // current_derived: C1a, C1b, C2a, C2b, C3, C6, C9, C10 = 8; open_ended: C4; future: C5; expired: C7; degenerate: C8.
    ['rowKinds: 8 derived / 1 open-ended / 1 future / 1 expired / 1 degenerate', result.csv.rowKinds.current_derived === 8 && result.csv.rowKinds.open_ended === 1 && result.csv.rowKinds.future_start === 1 && result.csv.rowKinds.expired === 1 && result.csv.rowKinds.degenerate === 1],
    ['zeroCommitmentRows == 1 (0E-8 parsed as 0)', result.csv.zeroCommitmentRows === 1],
    ['cadence: trailing-space "Monthly " trimmed into monthly', result.csv.cadence.monthly === 6 && result.csv.cadence.payInFull === 6 && result.csv.cadence.other === 0],
    ['join split: 1 not-in-API (C9), 1 matched-to-inactive (C10)', result.csv.clientsNotInClientsApi === 1 && result.csv.clientsMatchedToNonActive === 1],
    // SILENT — the deliverable: C1 dues-known 279; C4 open-ended + C5 future-only matched-unknown; C11 no row.
    ['silent: members 4, matched 3, duesKnown 1, noCsvRow 1', s.members === 4 && s.csvMatched === 3 && s.duesKnownCount === 1 && s.noCsvRow === 1 && s.csvMatchedButDuesUnknown === 2],
    ['silent: totalMonthly == 279.00 (multi-membership sums: 179 + 1200/12)', s.totalMonthly === 279],
    ['silent: distribution suppressed (1 < 5 known)', s.distributionSuppressed === true && s.minMonthly === null && s.medianMonthly === null && s.maxMonthly === null],
    ['silent: coverage 25.0% (1 of 4)', s.duesKnownCoveragePct === 25],
    // WATCH comparator: C2 known (149.917 + 100.848 → 250.76 — snap-12 proration + fractional proration); C7 expired-only.
    ['watch: members 2, duesKnown 1, totalMonthly 250.76', w.members === 2 && w.duesKnownCount === 1 && w.totalMonthly === 250.76],
    // HEALTHY comparator: C3 $0 comp KNOWN, C6 150 KNOWN, C8 degenerate-only unknown.
    ['healthy: duesKnown 2, totalMonthly 150, zeroDues 1', h.duesKnownCount === 2 && h.totalMonthly === 150 && h.zeroDuesClients === 1],
    ['healthy: 1-month Monthly row derives exactly its CT (150, not 152.19)', h.totalMonthly === 150],
    // UNKNOWN comparator: sentinel + missing recency members, no CSV rows.
    ['unknown: members 2, matched 0', u.members === 2 && u.csvMatched === 0],
    // Distribution math on a known >= 5 set (pure fn, direct).
    ['distribution stats: [10,20,30,40,50] → min/p25/med/p75/max = 10/20/30/40/50, mean 30', (() => {
      const d = buildDistribution([10, 20, 30, 40, 50], 0);
      return d.minMonthly === 10 && d.p25Monthly === 20 && d.medianMonthly === 30 && d.p75Monthly === 40 && d.maxMonthly === 50 && d.meanMonthly === 30 && d.distributionSuppressed === false;
    })()],
    // Derivation unit pins.
    ['deriveRow: 30-day Monthly snaps to 1 month (CT/1)', (() => {
      const d = deriveRow({ clientId: '1', membershipType: '', cadence: 'monthly', autorenew: 'autoRenew', startUtcMs: strictYmdToUtcMs('2026-06-01') as number, expirationUtcMs: strictYmdToUtcMs('2026-06-30') as number, commitmentTotal: 179 }, asOfUtcMs);
      return d.kind === 'current_derived' && d.monthlyEquivalent === 179;
    })()],
    ['deriveRow: 365-day PiF snaps to 12 months (CT/12)', (() => {
      const d = deriveRow({ clientId: '1', membershipType: '', cadence: 'payInFull', autorenew: 'noAutoRenew', startUtcMs: strictYmdToUtcMs('2025-09-15') as number, expirationUtcMs: strictYmdToUtcMs('2026-09-14') as number, commitmentTotal: 1799 }, asOfUtcMs);
      return d.kind === 'current_derived' && round2(d.monthlyEquivalent as number) === 149.92;
    })()],
    ['deriveRow: awkward period prorates fractionally (no snap)', (() => {
      const d = deriveRow({ clientId: '1', membershipType: '', cadence: 'payInFull', autorenew: 'noAutoRenew', startUtcMs: strictYmdToUtcMs('2026-01-01') as number, expirationUtcMs: strictYmdToUtcMs('2026-06-15') as number, commitmentTotal: 550 }, asOfUtcMs);
      return d.kind === 'current_derived' && round2(d.monthlyEquivalent as number) === 100.85;
    })()],
    ['strict calendar: 2026-02-30 rejected, 2024-02-29 accepted, 2023-02-29 rejected', strictYmdToUtcMs('2026-02-30') === null && strictYmdToUtcMs('2024-02-29') !== null && strictYmdToUtcMs('2023-02-29') === null],
    ['canonical id: number/string/zero-padded converge; non-digits rejected', canonicalClientId(9000001) === '9000001' && canonicalClientId(' 9000001 ') === '9000001' && canonicalClientId('09000001') === '9000001' && canonicalClientId('abc') === null && canonicalClientId(null) === null],
    ['coverageComplete == true (all OK)', result.coverageComplete === true],
    ['threshold defaults to the shipped 21', result.thresholdDays === 21 && DEFAULT_SILENT_CHURN_THRESHOLD_DAYS === 21],
    // ── PR-4 emit-mode pins (no network/env/file — pure functions on the fixture result) ──
    // Leak-gate allowlist: duesAsOf joins the allowlist in emit mode; a THIRD date still trips;
    // and WITHOUT the emit-mode arg the old single-date gate is unchanged (regression pin).
    ['gate: emit allowlist passes {asOf, duesAsOf}', leakGateViolations(`{"a":"${ASOF}","b":"2026-06-12"}`, ASOF, '2026-06-12').length === 0],
    ['gate: a third date trips the emit allowlist', leakGateViolations(`{"a":"${ASOF}","b":"2026-06-12","c":"2026-06-13"}`, ASOF, '2026-06-12').length === 1],
    ['gate: without emit mode a second date still trips', leakGateViolations(`{"a":"${ASOF}","b":"2026-06-12"}`, ASOF).length === 1],
    // Payload shape: EXACTLY the six camelCase keys of the deployed SPA parse contract,
    // key-for-key and in contract order; values come from the silent bucket + run meta.
    ['payload: six keys, key-for-key against the SPA contract', (() => {
      const p = buildWritePayload(result, '2026-06-12');
      const keys = Object.keys(p);
      const contract = ['duesAsOf', 'computedAsOf', 'thresholdDays', 'silentMembers', 'duesKnownCount', 'totalMonthly'];
      return keys.length === contract.length && keys.every((k, i) => k === contract[i]);
    })()],
    ['payload: values = silent-bucket aggregates + run meta (279 floor, 1 of 4, T, asOf)', (() => {
      const p = buildWritePayload(result, '2026-06-12');
      return p.duesAsOf === '2026-06-12' && p.computedAsOf === ASOF && p.thresholdDays === T &&
        p.silentMembers === 4 && p.duesKnownCount === 1 && p.totalMonthly === 279;
    })()],
    // UPDATE statement: subselect row targeting, workspace-scoped, and NO date literal outside
    // the jsonb payload (strip the payload substring → zero YYYY-MM-DD remain).
    ['update: date-literal-free outside the jsonb; subselect targeting present', (() => {
      const p = buildWritePayload(result, '2026-06-12');
      const stmt = buildUpdateStatement(p);
      const jsonInStmt = JSON.stringify(p).replace(/'/g, "''");
      const outsideJson = stmt.replace(jsonInStmt, '');
      return stmt.includes(jsonInStmt) &&
        !/\d{4}-\d{2}-\d{2}/.test(outsideJson) &&
        stmt.includes('select max(as_of) from public.wodify_retention_aggregate') &&
        stmt.includes("where workspace_id = 'default'") &&
        stmt.includes("set silent_dues_snapshot = '");
    })()],
    // Full emit-mode output passes the gate WITH the allowlist — and would trip WITHOUT it
    // (the duesAsOf inside the payload is exactly what the extension allowlists, nothing more).
    ['gate: full emit-mode result passes with allowlist, trips without', (() => {
      const emitResult = { ...result, writePayload: buildWritePayload(result, '2026-06-12') } as SilentChurnDuesPreviewResult;
      emitResult.updateStatement = buildUpdateStatement(emitResult.writePayload as SilentDuesWritePayload);
      const s2 = JSON.stringify(emitResult, null, 2);
      return leakGateViolations(s2, ASOF, '2026-06-12').length === 0 &&
        leakGateViolations(s2, ASOF).length === 1;
    })()],
    // membershipTypes whitelist: pinned categories pass through, a stray value folds to
    // 'other', and the fixture result's key set stays inside the closed set.
    ['whitelist: known categories pass, stray folds to other', membershipTypeKey('Class Plan') === 'Class Plan' && membershipTypeKey('Class Pack') === 'Class Pack' && membershipTypeKey('Appointment Pack') === 'Appointment Pack' && membershipTypeKey('Mystery Plan') === 'other' && membershipTypeKey('') === 'other'],
    ['whitelist: result membershipTypes keys ⊆ whitelist ∪ {other}', Object.keys(result.csv.membershipTypes).every((k) => k === 'other' || MEMBERSHIP_TYPE_WHITELIST.has(k))],
  ];
  const failed = expectations.filter(([, ok]) => !ok).map(([name]) => name);
  if (failed.length > 0) {
    console.error(`SELFTEST FAIL: behavioral expectation(s) not met: ${failed.join(' | ')}`);
    process.exit(1);
    return;
  }

  // Missing-column failure is loud and names ONLY the column.
  let missingColumnOk = false;
  try {
    parseMembershipCsv('Client ID,Client Name\n1,x');
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    missingColumnOk = msg.includes('Membership Type') && !msg.includes('x');
  }
  if (!missingColumnOk) {
    console.error('SELFTEST FAIL: missing-column error not raised or leaked row content.');
    process.exit(1);
    return;
  }

  console.error(
    'SELFTEST PASS: locked-classifier buckets + conservation, multi-membership sum, $0 comp known-at-zero, ' +
      'PiF 12-month and fractional proration, 30-day Monthly snap, open-ended/future/expired/degenerate ' +
      'never guessed, trailing-space cadence trimmed, quoted-comma CSV alignment, 0E-8 zero, unmatched + ' +
      'inactive join splits, distribution suppression under 5, leak gate clean (no name/email/id/date/dollar ' +
      'at member level); PR-4 emit-mode pins: gate allowlist exactly {asOf, duesAsOf} (third date trips; ' +
      'non-emit gate unchanged), write payload six-keys key-for-key vs the SPA contract, UPDATE date-literal-' +
      'free outside the jsonb with max(as_of) subselect targeting, membershipTypes whitelist-or-other; ' +
      'no network call, no env read, no file read.',
  );
}

// ─── main ──────────────────────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  if (process.argv.includes('--selftest')) {
    runSelfTest();
    return;
  }

  const args = process.argv.slice(2);
  let thresholdRaw: unknown;
  const tIdx = args.indexOf('--threshold');
  if (tIdx !== -1) thresholdRaw = args[tIdx + 1];
  const emitWritePayload = args.includes('--emit-write-payload');
  const dIdx = args.indexOf('--csv-export-date');
  const csvExportDate = dIdx !== -1 ? (args[dIdx + 1] ?? '') : null;
  // Value-flag positions are excluded from positionals (the CSV path is the one positional).
  const valueIdx = new Set<number>([tIdx, dIdx].filter((i) => i !== -1).map((i) => i + 1));
  const positional = args.filter((a: string, i: number) => !a.startsWith('--') && !valueIdx.has(i));
  const csvPath = positional[0];
  if (!csvPath) {
    console.error(
      'Usage: npx tsx --env-file=<abs path to .env.local> scripts/wodify/silentChurnDuesPreview.ts ' +
        '<path to All Memberships CSV> [--threshold N] ' +
        '[--emit-write-payload --csv-export-date YYYY-MM-DD]   (or --selftest). No request was made.',
    );
    process.exit(1);
    return;
  }
  const thresholdDays = resolveSilentChurnThresholdDays(thresholdRaw);

  // Emit-mode flag validation — ALL failures here abort BEFORE any env read or network call.
  // The two flags are strictly paired: --csv-export-date is required by emit mode (explicit
  // beats inference) and meaningless without it (fail closed on operator confusion).
  if (emitWritePayload && (csvExportDate === null || csvExportDate === '')) {
    console.error('--emit-write-payload requires --csv-export-date YYYY-MM-DD. No request was made.');
    process.exit(1);
    return;
  }
  if (!emitWritePayload && csvExportDate !== null) {
    console.error('--csv-export-date has no effect without --emit-write-payload. No request was made.');
    process.exit(1);
    return;
  }
  if (csvExportDate !== null && strictYmdToUtcMs(csvExportDate) === null) {
    console.error('--csv-export-date must be a real calendar date in YYYY-MM-DD form. No request was made.');
    process.exit(1);
    return;
  }
  // Cross-check the explicit export date against the timestamp in the CSV filename when one is
  // parseable (the subscription names files like all_memberships_YYYY-MM-DDTHH_MM_….csv).
  // A mismatch means the operator is pointing at a different export than they think — ABORT.
  if (csvExportDate !== null) {
    const base = csvPath.split('/').pop() ?? '';
    const fnMatch = /(\d{4}-\d{2}-\d{2})T\d{2}[_:]\d{2}/.exec(base);
    if (fnMatch && fnMatch[1] !== csvExportDate) {
      console.error(
        `--csv-export-date ${csvExportDate} does not match the date in the CSV filename ` +
          `(${fnMatch[1]}). Pass the export's own date. No request was made.`,
      );
      process.exit(1);
      return;
    }
  }

  const apiKey = process.env.WODIFY_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    console.error(
      'WODIFY_API_KEY is not set. Provide it via a gitignored env file (never commit or paste it; never ' +
        'source it from Supabase secrets or the edge function). No request was made.',
    );
    process.exit(1);
    return;
  }

  let csvText: string;
  try {
    csvText = readFileSync(csvPath, 'utf8');
  } catch {
    console.error('Could not read the dues CSV at the given path. No request was made.');
    process.exit(1);
    return;
  }
  const parsed = parseMembershipCsv(csvText);

  const asOfYmd = gymLocalTodayYmd();
  const asOfUtcMs = strictYmdToUtcMs(asOfYmd);
  const asOfDate = parseYmdLocal(asOfYmd);
  if (asOfUtcMs === null || asOfDate === null) {
    console.error('Could not derive the gym-local run day. No request was made.');
    process.exit(1);
    return;
  }

  const byClient = collapseByClient(parsed.rows, asOfUtcMs);
  const { classified, meta } = await scanAllClients(apiKey, thresholdDays, asOfDate);
  const result = buildResult(classified, parsed, byClient, parsed.rows, meta, asOfYmd, asOfUtcMs, thresholdDays);

  // Emit mode: attach the write payload + UPDATE statement INSIDE the result so the leak gate
  // scans them with everything else. WITHHELD on a non-coverage-complete run — a partial scan
  // must never produce a writable dollar (fail closed, exit non-zero so the gated run stops).
  if (emitWritePayload && csvExportDate !== null) {
    if (!result.coverageComplete) {
      const serialized = JSON.stringify(result, null, 2);
      const violations = leakGateViolations(serialized, asOfYmd, csvExportDate);
      if (violations.length === 0) console.log(serialized);
      console.error(
        'WRITE PAYLOAD WITHHELD: the run is not coverage-complete — no payload or UPDATE was emitted.',
      );
      process.exit(1);
      return;
    }
    result.writePayload = buildWritePayload(result, csvExportDate);
    result.updateStatement = buildUpdateStatement(result.writePayload);
  }

  // LEAK GATE — on any violation the result is withheld entirely (counts of violations only).
  // In emit mode the allowlist is EXACTLY {run-day asOf, duesAsOf}; otherwise {run-day asOf}.
  const serialized = JSON.stringify(result, null, 2);
  const violations = leakGateViolations(serialized, asOfYmd, csvExportDate ?? undefined);
  if (violations.length > 0) {
    console.error(
      `LEAK GATE FAILED — result withheld (${violations.length} violation(s)): ${violations.join('; ')}`,
    );
    process.exit(1);
    return;
  }
  console.log(serialized);
}

main().catch(() => {
  // Never surface raw error detail (it can echo URL / headers / row content). Generic line only.
  console.error('silent-churn dues preview failed before producing a result (no data emitted).');
  process.exit(1);
});
