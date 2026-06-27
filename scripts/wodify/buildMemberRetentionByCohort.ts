/**
 * BUILD member_retention_by_cohort — the DEEP-MANUAL age-segment retention pipeline (WO-1, phase 1).
 *
 * ┌─────────────────────────────────────────────────────────────────────────────────────────────┐
 * │ DRAFT — PENDING THE TWO-AI REVIEWER GATE. The network-free `--selftest` is always safe and is  │
 * │ the documented pre-gate step. The LIVE build (real export ⋈ a live /clients pull + the #495    │
 * │ fixture) runs ONLY after Reviewer reads this script + the schema .sql + PASS, then Wesley GO.   │
 * │ This script NEVER writes to the DB and NEVER applies the migration — it emits a local upsert    │
 * │ payload for a SEPARATE gated apply (Supabase MCP), exactly like seedMemberRetentionRates.ts.    │
 * └─────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * WHAT IT BUILDS — one row per (workspace_id, period_month, cohort_band) of Class-Plan MEMBERSHIP
 *   retention (New / Returning / Lost), partitioned by age cohort, for member_retention_by_cohort
 *   (supabase/member_retention_by_cohort_schema.sql). Feasibility is CLOSED (both gate probes passed):
 *   - MAPPING: aggregate period_month = client-grain "First Of Month" + 1 month (proven UNIQUE offset).
 *   - COUNT BASIS: the Change Type LABEL — new=#New rows, returning=#Returning rows, lost=#Lost rows;
 *     a Lost ROW = exactly one member (proven: rows tie, Σ|negativeChange| does not). Returning carries
 *     (0,0) flags — we key off the LABEL, never the flag values.
 *   - AGE: each EVENT ROW is aged as-of ITS OWN mapped period (First-Of-Month + 1 month, first-of-month)
 *     via cohortBands.ageYearsAsOf → the build-LOCAL bandForAge (Youth = ages 1–15 / Adults 16+), so a
 *     member crossing the 15→16 boundary is counted in the right band each month. The banding is
 *     DELIBERATELY decoupled from cohortBands.COHORT_BANDS (which stays 4-band for the live SPA surfaces);
 *     youth=1–15 is the EXACT union of the prior kids/teens windows (floor 1, under-3s folded in), so the
 *     member partition and the unknownCohort=0 invariant are unchanged. DOB join: export "Client ID" →
 *     /clients "id". Missing/sentinel/invalid/out-of-range DOB → unknownCohort (KEPT, future-proof; 0 today).
 *   - CLOSED PERIODS: a source month is built iff its mapped period has a member_retention_rates (#495)
 *     reference row. The trailing source month maps to a period with NO #495 row → EXCLUDED (the
 *     incomplete pending intake). Exclusion keys off ABSENCE OF THE MAPPED CLOSED REFERENCE, never off
 *     Returning/Lost happening to be 0.
 *
 * THIS IS CLASS-PLAN MEMBERSHIP RETENTION — explicitly NOT attendance-based classifyMember / Silent-
 *   Churn churn (that is wodify_retention_aggregate.cohort_histogram, a recency/lapsed STOCK; different
 *   metric, table, path). No SPA fetcher / UI is built here — the SPA toggle is a separate later WO.
 *
 * THREE LOCAL INPUTS (live run):
 *   1. client-grain "Member Retention" export CSV (PII: names + ids) — ~/.config/wx-cfo/, 0600. argv[0].
 *      Columns: First Of Month · Client ID · Change Type · Positive Change · Negative Change ·
 *      Membership ID · Client Name. RAW export ("Keep the data formatted" UNCHECKED → ISO dates).
 *   2. member_retention_rates (#495) fixture JSON (NON-PII: 13 monthly aggregate rows) — argv[1]. The
 *      gym-wide New/Lost/Returning margins per mapped period; REQUIRED for the conservation assertion
 *      AND for the suppression solver's reconstruction model. Same fixture retentionReconcileProbe reads.
 *   3. live /clients pull for DOB (GATED) — mirrors retentionCohortJoinProbe / the edge fetch; x-api-key
 *      from process.env.WODIFY_API_KEY; exits WITHOUT a request if the key is unset.
 *
 * JOIN-COVERAGE GUARD (Reviewer-required — conservation alone cannot catch a bad /clients pull):
 *   - HARD-ABORTS (no payload) if the distinct-export-Client-ID match rate against the /clients pull is
 *     below COVERAGE_FLOOR. Conservation is invariant to cohort misclassification (it sums across all 5
 *     cohorts incl. unknownCohort), so a truncated pull would silently age-corrupt the table while still
 *     reconciling — the match-rate guard is the only thing that catches it.
 *   - SURFACES match-rate, unmatched-distinct, and the unknownCohort event-count DECOMPOSED into
 *     fromUnmatched (the corruption signal — an event whose client id is missing from the pull) vs
 *     fromMatchedUnusableDob (a matched client with sentinel/missing DOB — legitimately unknown, KEPT by
 *     design). A DOB-blanking regression inflates the latter without lowering match-rate, so it is made
 *     visible at review even though it does not auto-abort.
 *
 * OWNER-DASHBOARD OUTPUT (Slice 2, 2026-06-27 — AGENTS.md "Retention page data policy"): the live path
 *   publishes EVERY aggregate cell as a real count, including small counts and counts of 1, with
 *   suppressed=false and no null cells (ownerDashboardSuppression()). Wesley accepted the public
 *   aggregate-count risk; identity-level data stays forbidden, enforced by the local DOB→age reduction and
 *   the leak guards (UNCHANGED). The seed-boundary month is emitted as real rows too (the SPA chart excludes
 *   it via the #495 All-axis; the table need not imply it is displayed). The SUPPRESSION CONTRACT below is
 *   RETAINED but UNUSED on this path — it runs only under PUBLIC_EXPORT_MODE, a possible future
 *   wider-distribution surface.
 *
 * SUPPRESSION CONTRACT — RETAINED for PUBLIC_EXPORT_MODE only (NOT applied to the owner-dashboard payload):
 *   - A cell measure that is a SENSITIVE small count (nonzero, < 5) makes its WHOLE (period × cohort)
 *     row suppressed (new/returning/lost all → null, suppressed=true).
 *   - COMPLEMENTARY suppression: additional complete cohort rows are suppressed until NO suppressed row
 *     is uniquely reconstructable from (a) the other cohort rows, (b) #495's published New/Lost/
 *     Returning/prior/current/retention margins, (c) the identities prior=returning+lost /
 *     current=returning+new, (d) wodify_retention_aggregate.cohort_histogram (the other anon-readable
 *     age-banded surface — enumerated even though its stock-vs-flow linkage is weak).
 *   - The suppressor does NOT assume "next-smallest row suffices" — it MECHANICALLY TESTS recoverability
 *     via sole-unknown constraint propagation over ALL those margins (isRecoverable below), and grows the
 *     suppressed set until the test is clean. Provably complete for SENSITIVE (nonzero) cells: a nonzero
 *     value is point-determined only by being the sole unknown of an equation (never by nonnegativity,
 *     which can only force a 0), so propagation that flags every sole-unknown catches every recoverable
 *     sensitive cell. The --selftest reconstruction-attack suite drives each margin, zero-valued bands,
 *     and multiple independently-sensitive measures in one month, and asserts non-recoverability.
 *   - EXTERNALLY-PINNED bands are NOT protective complements (Reviewer Must-fix): a band the attacker can
 *     determine WITHOUT solving — canonically unknownCohort = 0 under 100% DOB, inferable from its
 *     published 0s — is never chosen as a complement and is published as a transparency 0; the
 *     recoverability test substitutes such pins with their known value BEFORE solving. A 0-valued
 *     sibling-pinned complement would otherwise leave the sensitive cell sole-unknown (the demonstrated
 *     2025-06 teens.lost leak).
 *   - SEED-BOUNDARY MONTHS are FULLY SUPPRESSED (Reviewer decision 2026-06-26): all 5 cohorts of any
 *     is_seed_boundary month publish null. The seed month is chart-excluded anyway (no visible value
 *     lost), and full suppression removes even the residual k=2 narrowing of a seed-month lost=1 cell
 *     (inherently only 2-protectable when the gym lost-total is 1 with 4 bands at 0). The complement
 *     logic above governs every NON-seed month, where unknownCohort=0 stays published as a transparency 0.
 *
 * AGGREGATE COMPLETENESS — every built (closed) period emits exactly one row for EACH of the 3 bands
 *   (youth3to15, adults16plus, unknownCohort) with explicit safe zeroes; a cohort key is NEVER omitted
 *   (the preserve-history upsert would otherwise keep a stale prior value when a previously-populated band
 *   later has zero events).
 *
 * §5-safe output (tightest sibling form, clientsDobFillProbe.ts):
 *   - Local ONLY. Never bundled / VITE_*. No Supabase read/write from this script. Names / ids / DOB are
 *     read in memory only, reduced to per-(period × cohort) COUNTS, discarded.
 *   - STDOUT carries ONLY the suppressed, leak-gated SUMMARY: per-band ROW counts, #cells/#rows
 *     suppressed, mapped month span, excluded periods, conservation booleans, and a sample of the
 *     NON-suppressed STRUCTURE as category enums ('suppressed' | 'zero' | 'ge5') — NEVER a raw count
 *     value, least of all a small unsuppressed one (which suppression guarantees cannot exist).
 *   - The upsert PAYLOAD (owner-dashboard: real aggregate counts incl. small ones; or, under
 *     PUBLIC_EXPORT_MODE, post-suppression null / 0 / ≥5 only) is written to a LOCAL 0600 file OUTSIDE
 *     the repo (~/.config/wx-cfo/), never to stdout and never committed. It is leak-scanned before write.
 *   - LEAK GUARD (live AND selftest): the serialized summary is re-scanned before printing; the run
 *     ABORTS WITHOUT printing on any '@', ≥7-digit run (Client/Membership IDs are 7-8 digits), or any
 *     YYYY-MM-DD date. Defense-in-depth behind the selftest assertions.
 *   - `--selftest` runs FIRST, makes NO network call and reads NO file (synthetic in-memory data).
 *
 * Gated-run discipline: build + `--selftest` → Reviewer reads THIS script + the schema .sql + PASS →
 *   Wesley GO → live build (emits the local payload) → the gated migration apply + gated import (MCP).
 *   This DRAFT executes nothing live and writes nothing to the DB.
 *
 * Run:
 *   npx tsx scripts/wodify/buildMemberRetentionByCohort.ts --selftest                       # no file/network
 *   npx tsx --env-file=/Users/wesley/Code/wx-cfo-scorecard/.env.local \                      # GATED
 *     scripts/wodify/buildMemberRetentionByCohort.ts \
 *     ~/.config/wx-cfo/<member_retention_export>.csv ~/.config/wx-cfo/<member_retention_rates_fixture>.json
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Banding is implemented LOCAL to this build (Youth / Adults 16+) and DELIBERATELY decoupled from
// cohortBands.COHORT_BANDS, which stays 4-band for the live SPA surfaces (MembersByAgeGroupCard /
// churnRiskByCohort / wodifyRetentionAggregate → the sync-wodify-retention Edge Function). Only two
// banding-AGNOSTIC primitives are reused: ageYearsAsOf (pure DOB→whole-year age math) and the
// UNKNOWN_COHORT_ID sentinel (the stable 'unknownCohort' id — NOT a band window — kept shared so the
// build and the SPA can never disagree on the unknown-bucket id).
import { ageYearsAsOf, UNKNOWN_COHORT_ID } from '../../src/lib/gym/cohortBands.ts';

// ─── CONFIG ────────────────────────────────────────────────────────────────────────────────────────
const SENSITIVE_MAX = 4; // a count in 1..4 (nonzero AND < 5) is a sensitive small cell.
const MEASURES = ['new', 'returning', 'lost'] as const;
type Measure = (typeof MEASURES)[number];

// JOIN-COVERAGE FLOOR (Reviewer-required guard). Conservation (per-measure Σ over cohorts = #495 gym
// margin) sums across ALL 5 cohorts INCLUDING unknownCohort, so it is INVARIANT to cohort
// misclassification: a truncated/regressed /clients pull would dump unmatched clients' events into
// unknownCohort and STILL pass conservation — silent age-corruption on a public table. The match-rate
// guard catches that BEFORE any payload. Floor 0.95: Gate 1 measured 465/465 = 100%, so a healthy pull
// is ~1.0; 0.95 tolerates a handful of future new/purged clients while a truncated pull (which drops
// many ids at once) trips it. Confirm/adjust at the Reviewer re-check.
const COVERAGE_FLOOR = 0.95;

// The 3 cohort ids — the build-LOCAL Youth/Adults banding (decoupled from cohortBands.COHORT_BANDS, which
// stays 4-band for the live SPA surfaces). Order is load-bearing: the suppression complement tie-break is
// "smallest-flow nonzero band, deterministic by COHORT_IDS order", and unknownCohort stays LAST (the
// always-published transparency 0). MUST stay byte-identical to the schema's cohort_band allowlist
// (asserted in --selftest).
const YOUTH_COHORT_ID = 'youth3to15';
const ADULTS_COHORT_ID = 'adults16plus';
const COHORT_IDS: string[] = [YOUTH_COHORT_ID, ADULTS_COHORT_ID, UNKNOWN_COHORT_ID];
const SCHEMA_BAND_ALLOWLIST = ['youth3to15', 'adults16plus', 'unknownCohort'];

const TABLE = 'public.member_retention_by_cohort';
const WORKSPACE_ID = 'default';
const PAYLOAD_PATH = join(homedir(), '.config', 'wx-cfo', 'member_retention_by_cohort_upsert.sql');

// /clients fetch — mirrors retentionCohortJoinProbe / clientsDobFillProbe / the edge fetch.
const BASE_URL = 'https://api.wodify.com/v1';
const CLIENTS_PATH = '/clients';
const PAGE_SIZE = 100;
const MAX_PAGES = 50;
const REQUEST_TIMEOUT_MS = 15000;
const SENTINEL_NULL_DATE = '1900-01-01';
const DOB_FIELD_CANDIDATES = ['date_of_birth', 'dateofbirth', 'dob', 'birthday', 'birth_date', 'birthdate'];

const COL = {
  firstOfMonth: 'firstofmonth',
  clientId: 'clientid',
  changeType: 'changetype',
} as const;

// ─── TYPES ─────────────────────────────────────────────────────────────────────────────────────────
interface CohortCell {
  new: number;
  returning: number;
  lost: number;
}
// agg: mapped period 'YYYY-MM' → cohort id → true (pre-suppression) counts.
type Aggregate = Map<string, Map<string, CohortCell>>;

interface RatesRow {
  period_month: string; // mapped 'YYYY-MM'
  new_members: number;
  returning_members: number;
  lost_members: number;
  is_seed_boundary: boolean;
}

interface ClientRecord {
  clientId: string;
  dobRaw: string;
}

interface JoinCoverage {
  totalDistinctExportIds: number;
  matchedDistinct: number;
  unmatchedDistinct: number;
  matchRate: number; // matchedDistinct / totalDistinctExportIds (1.0 when there are no ids), 4dp
  coverageFloor: number;
  belowFloor: boolean; // matchRate < COVERAGE_FLOOR ⇒ HARD-ABORT (no payload)
}

// unknownCohort events split by CAUSE — the corruption signal vs the legitimately-unknown bucket.
interface UnknownEvents {
  total: number;
  fromUnmatched: number; // event whose client id is ABSENT from the /clients pull (the corruption signal)
  fromMatchedUnusableDob: number; // matched client, but sentinel/missing/invalid DOB (kept by design)
}

// 'lt5' = a small aggregate count 1..4. Under the owner-dashboard policy this is a NORMAL published
// value (AGENTS.md "Retention page data policy" — aggregate counts incl. 1 are allowed). Only the
// RETAINED public-export suppressor (PUBLIC_EXPORT_MODE) masks such cells; there it never reaches output.
type CellCategory = 'suppressed' | 'zero' | 'ge5' | 'lt5';

interface BuildSummary {
  build: 'buildMemberRetentionByCohort';
  table: string;
  parseOk: boolean;
  builtPeriods: number;
  monthSpan: { min: string | null; max: string | null };
  excludedPeriods: Array<{ sourceMonth: string; mappedPeriod: string; reason: string }>;
  perBand: Array<{ cohort: string; rows: number; suppressedRows: number }>;
  totalRows: number;
  totalRowsSuppressed: number;
  totalCellsSensitive: number; // sensitive cells (1..4) found pre-suppression
  suppressionGrowthRounds: number;
  conservation: {
    closedPeriodsChecked: number;
    allNonSeedTie: boolean;
    seedPeriod: string | null;
    seedTies: boolean | null;
  };
  joinCoverage: {
    matchRate: number;
    totalDistinctExportIds: number;
    unmatchedDistinct: number;
    coverageFloor: number;
    belowFloor: boolean;
    unknownCohortEvents: number;
    unknownFromUnmatched: number;
    unknownFromMatchedUnusableDob: number;
  };
  recoverableSensitiveCells: number; // MUST be 0 on a clean build
  youthFloorUnder3DistinctClients: number; // under-3s folded into Youth by the floor-1 union (floor-decision evidence)
  sampleStructure: { period: string | null; cells: Array<{ cohort: string; new: CellCategory; returning: CellCategory; lost: CellCategory }> };
  verdict: 'built_ok' | 'conservation_failed' | 'suppression_incomplete' | 'join_coverage_below_floor' | 'empty_or_unparseable';
  verdictProvisional: boolean; // seed-boundary conservation delta observed (human judgment)
}

// ─── HELPERS ───────────────────────────────────────────────────────────────────────────────────────
function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}
function toYearMonth(raw: string): string | null {
  const m = (raw ?? '').trim().match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  const mm = Number(m[2]);
  return mm >= 1 && mm <= 12 ? `${m[1]}-${m[2]}` : null;
}
function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}
function strictYmd(ymd10: string): boolean {
  const m = ymd10.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

// Validated whole-year age as-of the mapped day, or null when the DOB is missing/sentinel/invalid/
// out-of-range. Never echoes the DOB or age. Mirrors retentionCohortJoinProbe's validation ladder.
function ageForEvent(dobRaw: string | undefined, asOfDay: string): number | null {
  if (dobRaw === undefined) return null; // unmatched client id
  const v = dobRaw.trim();
  if (v === '') return null;
  const ymd = v.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  if (ymd === SENTINEL_NULL_DATE) return null;
  if (!strictYmd(ymd)) return null;
  return ageYearsAsOf(ymd, asOfDay);
}

// LOCAL age→band (decoupled from cohortBands.COHORT_BANDS — see the import note). Youth = ages 1–15, the
// EXACT union of the prior kids3to6 ∪ kids7to9 ∪ teens10to15 windows: cohortForAge's floor is 1, not 3 —
// under-3s are deliberately folded into the youngest band (cohortBands.ts:23-25), and age 0 / ≤0 routes to
// Unknown. Preserving that floor keeps the member partition IDENTICAL to the prior 5-band grain and the
// unknownCohort=0 invariant intact (load-bearing for the suppression solver's externally-pinned-complement
// logic). Adults = 16+ (≤120 data-sanity ceiling). The display label may read "Youth 3–15"; the WINDOW is
// 1–15. A null/out-of-range age → unknownCohort.
function bandForAge(age: number | null): string {
  if (age === null) return UNKNOWN_COHORT_ID;
  if (age >= 1 && age <= 15) return YOUTH_COHORT_ID;
  if (age >= 16 && age <= 120) return ADULTS_COHORT_ID;
  return UNKNOWN_COHORT_ID; // age <= 0 or > 120 — sentinel/garbage
}

// DOB + as-of mapped day → cohort id. Never echoes the DOB or age.
function cohortFor(dobRaw: string | undefined, asOfDay: string): string {
  return bandForAge(ageForEvent(dobRaw, asOfDay));
}

function emptyCell(): CohortCell {
  return { new: 0, returning: 0, lost: 0 };
}
function freshPeriodCohorts(): Map<string, CohortCell> {
  const m = new Map<string, CohortCell>();
  for (const id of COHORT_IDS) m.set(id, emptyCell());
  return m;
}

// ─── CSV PARSE (self-contained; mirrors the sibling probes) ───────────────────────────────────────────
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      field = '';
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

interface ClientGrainRow {
  sourceMonth: string | null;
  clientId: string;
  changeType: string;
}

function parseClientGrain(text: string): ClientGrainRow[] {
  const grid = parseCsv(text);
  if (grid.length === 0) return [];
  const idx: Record<string, number> = {};
  grid[0].forEach((name, i) => {
    idx[normalizeKey(name)] = i;
  });
  const get = (cells: string[], key: string): string => (idx[key] === undefined ? '' : (cells[idx[key]] ?? ''));
  const out: ClientGrainRow[] = [];
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    out.push({
      sourceMonth: toYearMonth(get(cells, COL.firstOfMonth)),
      clientId: get(cells, COL.clientId).trim(),
      changeType: get(cells, COL.changeType).trim(),
    });
  }
  return out;
}

// ─── AGGREGATE (join + per-event age + label tally) ────────────────────────────────────────────────────
// Builds the TRUE per-(mapped period × cohort) New/Returning/Lost over CLOSED periods only (mapped period
// present in the #495 fixture). Excluded source months (no mapped reference) are reported, never tallied.
function buildAggregate(
  rows: ClientGrainRow[],
  dobById: Map<string, string>,
  ratesByPeriod: Map<string, RatesRow>,
): {
  agg: Aggregate;
  excluded: Array<{ sourceMonth: string; mappedPeriod: string; reason: string }>;
  unknownEvents: UnknownEvents;
  youthUnder3DistinctClients: number;
} {
  const agg: Aggregate = new Map();
  const unknownEvents: UnknownEvents = { total: 0, fromUnmatched: 0, fromMatchedUnusableDob: 0 };
  // FLOOR DIAGNOSTIC (Reviewer-required): distinct clients whose as-of age lands at 1–2 in ANY mapped
  // period — i.e. the under-3s currently FOLDED INTO Youth by the floor-1 union. A gym-wide population
  // count (not a per-band flow cell), so it is leak-safe to surface; it lets the 1-vs-3 youth floor be
  // revisited with evidence rather than guessed. Expected ~0 for this gym.
  const youthUnder3Clients = new Set<string>();
  const sourceMonths = new Set<string>();
  for (const r of rows) if (r.sourceMonth) sourceMonths.add(r.sourceMonth);

  // Decide closed vs excluded per source month.
  const excluded: Array<{ sourceMonth: string; mappedPeriod: string; reason: string }> = [];
  const closedMappedBySource = new Map<string, string>(); // sourceMonth → mappedPeriod (closed only)
  for (const sm of [...sourceMonths].sort()) {
    const mapped = addMonths(sm, 1);
    if (ratesByPeriod.has(mapped)) closedMappedBySource.set(sm, mapped);
    else excluded.push({ sourceMonth: sm, mappedPeriod: mapped, reason: 'no_member_retention_rates_reference (incomplete trailing intake)' });
  }
  // Materialize all 5 cohorts (explicit zeroes) for every closed mapped period.
  for (const mapped of closedMappedBySource.values()) agg.set(mapped, freshPeriodCohorts());

  // Tally each event row into its mapped period × cohort, aged as-of THAT period.
  for (const r of rows) {
    if (!r.sourceMonth) continue;
    const mapped = closedMappedBySource.get(r.sourceMonth);
    if (!mapped) continue; // excluded source month
    const ct = r.changeType.toLowerCase();
    if (ct !== 'new' && ct !== 'returning' && ct !== 'lost') continue; // ignore any other label
    const asOfDay = `${mapped}-01`;
    const age = ageForEvent(dobById.get(r.clientId), asOfDay);
    const cohort = bandForAge(age);
    if (cohort === UNKNOWN_COHORT_ID) {
      unknownEvents.total += 1;
      if (dobById.has(r.clientId)) unknownEvents.fromMatchedUnusableDob += 1;
      else unknownEvents.fromUnmatched += 1;
    }
    if (age !== null && age >= 1 && age <= 2) youthUnder3Clients.add(r.clientId);
    const cell = agg.get(mapped)!.get(cohort)!;
    cell[ct as Measure] += 1;
  }
  return { agg, excluded, unknownEvents, youthUnder3DistinctClients: youthUnder3Clients.size };
}

// JOIN COVERAGE — distinct-export-Client-ID match rate against the /clients pull. The HARD-ABORT signal
// (see COVERAGE_FLOOR). Pure; emits no value, only counts/rate.
function computeJoinCoverage(rows: ClientGrainRow[], dobById: Map<string, string>): JoinCoverage {
  const ids = new Set<string>();
  for (const r of rows) if (r.clientId !== '') ids.add(r.clientId);
  let matched = 0;
  for (const id of ids) if (dobById.has(id)) matched++;
  const total = ids.size;
  const matchRate = total === 0 ? 1 : matched / total;
  return {
    totalDistinctExportIds: total,
    matchedDistinct: matched,
    unmatchedDistinct: total - matched,
    matchRate: Math.round(matchRate * 10000) / 10000,
    coverageFloor: COVERAGE_FLOOR,
    belowFloor: matchRate < COVERAGE_FLOOR,
  };
}

// ─── CONSERVATION (pre-suppression, LOCAL): per-month band sums tie to the #495 margins ─────────────────
interface Conservation {
  closedPeriodsChecked: number;
  allNonSeedTie: boolean;
  seedPeriod: string | null;
  seedTies: boolean | null;
  nonSeedFailures: string[]; // mapped periods that failed (non-seed) — a hard build error
}
function checkConservation(agg: Aggregate, ratesByPeriod: Map<string, RatesRow>): Conservation {
  let allNonSeedTie = true;
  let seedPeriod: string | null = null;
  let seedTies: boolean | null = null;
  const nonSeedFailures: string[] = [];
  let checked = 0;
  for (const [period, cohorts] of agg) {
    const fx = ratesByPeriod.get(period);
    if (!fx) continue; // built periods are all closed, but guard anyway
    checked++;
    let sNew = 0;
    let sRet = 0;
    let sLost = 0;
    for (const cell of cohorts.values()) {
      sNew += cell.new;
      sRet += cell.returning;
      sLost += cell.lost;
    }
    const ties = sNew === fx.new_members && sRet === fx.returning_members && sLost === fx.lost_members;
    if (fx.is_seed_boundary) {
      seedPeriod = period;
      seedTies = ties; // a seed delta is onboarding semantics, not drift — provisional, never a hard fail
    } else if (!ties) {
      allNonSeedTie = false;
      nonSeedFailures.push(period);
    }
  }
  return { closedPeriodsChecked: checked, allNonSeedTie, seedPeriod, seedTies, nonSeedFailures };
}

// ─── SUPPRESSION ───────────────────────────────────────────────────────────────────────────────────────
function cellKey(period: string, cohort: string, m: Measure): string {
  return `${period}|${cohort}|${m}`;
}
function isSensitiveValue(v: number): boolean {
  return v >= 1 && v <= SENSITIVE_MAX;
}

interface Equation {
  vars: string[]; // UNKNOWN (suppressed) cell keys
  rhs: number;
}

// Build the attacker's known linear system over the SUPPRESSED (unknown) flow cells:
//   for each period p, measure m:  Σ_{suppressed cohorts} m(c,p) = gym_m(p) − Σ_{published cohorts} m(c,p)
// The RHS is fully known (gym from #495, published cells from the table). `extraEquations` lets the
// selftest enumerate auxiliary margins (e.g. cohort_histogram stock totals over DISJOINT variables, or a
// hypothetical external leak) and prove how the solver responds.
function flowEquations(
  agg: Aggregate,
  ratesByPeriod: Map<string, RatesRow>,
  suppressed: Set<string>,
  extraEquations: Equation[] = [],
): Equation[] {
  const eqs: Equation[] = [];
  for (const [period, cohorts] of agg) {
    const fx = ratesByPeriod.get(period);
    if (!fx) continue;
    const gym: Record<Measure, number> = { new: fx.new_members, returning: fx.returning_members, lost: fx.lost_members };
    for (const m of MEASURES) {
      const vars: string[] = [];
      let publishedSum = 0;
      for (const [cohort, cell] of cohorts) {
        if (suppressed.has(`${period}|${cohort}`)) vars.push(cellKey(period, cohort, m));
        else publishedSum += cell[m];
      }
      if (vars.length === 0) continue; // nothing hidden for this measure-period
      eqs.push({ vars, rhs: gym[m] - publishedSum });
    }
  }
  return [...eqs, ...extraEquations];
}

// COMPLETENESS SCOPE (Reviewer note — re-verify whenever a new anon-readable surface is added): this
// sole-unknown propagation is a COMPLETE recoverability test ONLY because every published margin is a
// single linear equation over its OWN disjoint set of suppressed flow variables — each suppressed cell
// appears in exactly one (period, measure) sum equation; the #495 gym totals fold into the RHS;
// cohort_histogram is a STOCK margin over disjoint active-count variables; per-cohort prior/current are
// not published. Under that structure a sensitive (nonzero) cell is point-determined iff it is the sole
// unknown of some equation, which propagation detects. IF a future anon-readable surface ever publishes a
// margin that SHARES flow variables (e.g. a per-cohort prior, or a cross-period identity over the same
// cells), this propagation is NO LONGER SUFFICIENT — a unique nonneg-integer solution can exist even with
// ≥2 unknowns, so the solver must be upgraded to integer-feasibility / linear-Diophantine analysis.
// It is also complete only because EXTERNALLY-PINNED vars are substituted first (externallyKnownCells):
// a suppressed band the attacker already knows (globally-0 unknownCohort) is not a free unknown, so it is
// seeded before propagation — otherwise a sensitive cell paired only with a pinned band reads as 2-unknown
// but is actually sole-unknown (the 2025-06 leak).
//
// Sole-unknown constraint propagation: determine every cell that is forced to a unique value by the
// system. A SENSITIVE cell that gets determined is RECOVERABLE → the suppression is insufficient.
// `seedKnown` lets the selftest inject an external leak (a value the attacker already knows) to prove the
// propagation cascades (it is not the |K| count rule in disguise).
function propagateDetermined(equations: Equation[], seedKnown: Map<string, number> = new Map()): Map<string, number> {
  const determined = new Map<string, number>(seedKnown);
  let progress = true;
  while (progress) {
    progress = false;
    for (const eq of equations) {
      const unknown = eq.vars.filter((v) => !determined.has(v));
      if (unknown.length === 1) {
        let knownSum = 0;
        for (const v of eq.vars) if (determined.has(v)) knownSum += determined.get(v)!;
        determined.set(unknown[0], eq.rhs - knownSum);
        progress = true;
      }
    }
  }
  return determined;
}

// EXTERNALLY-PINNED cells (Reviewer Must-fix): a band that is 0 in EVERY period is inferable as 0 even
// where it is suppressed — the attacker reads its published 0s and pins the suppressed instance too. The
// canonical case is unknownCohort under 100% DOB (globally 0). A pinned cell is NOT a protective unknown:
// the recoverability test must substitute it with its known value BEFORE solving, else a sensitive cell
// sharing an equation with only a pinned band collapses to sole-unknown and is recovered (the demonstrated
// 2025-06 teens.lost leak). Pins ONLY cells the attacker can CORRECTLY infer — a band nonzero anywhere is
// not globally 0, and a wrong pin would yield a wrong "recovery", not a disclosure.
function externallyKnownCells(agg: Aggregate): Map<string, number> {
  const known = new Map<string, number>();
  for (const cohort of COHORT_IDS) {
    let globallyZero = true;
    for (const cohorts of agg.values()) {
      const cell = cohorts.get(cohort);
      if (cell && (cell.new !== 0 || cell.returning !== 0 || cell.lost !== 0)) {
        globallyZero = false;
        break;
      }
    }
    if (!globallyZero) continue;
    for (const [period, cohorts] of agg) {
      const cell = cohorts.get(cohort)!;
      for (const m of MEASURES) known.set(cellKey(period, cohort, m), cell[m]); // = 0
    }
  }
  return known;
}

// The mechanical recoverability test: which SENSITIVE suppressed cells can an attacker uniquely recover?
// Models the STRONGEST attacker: every externally-pinned cell (externallyKnownCells) is substituted with
// its known value BEFORE propagation, so a band the attacker can pin (unknownCohort=0) cannot masquerade
// as a protective unknown.
function recoverableSensitiveCells(
  agg: Aggregate,
  ratesByPeriod: Map<string, RatesRow>,
  suppressed: Set<string>,
  extraEquations: Equation[] = [],
  seedKnown: Map<string, number> = new Map(),
): string[] {
  const eqs = flowEquations(agg, ratesByPeriod, suppressed, extraEquations);
  const seed = new Map(externallyKnownCells(agg)); // attacker substitutes pinned (globally-0) cells first
  for (const [k, v] of seedKnown) seed.set(k, v); // caller-injected leaks (selftest cascade) layer on top
  const determined = propagateDetermined(eqs, seed);
  const out: string[] = [];
  for (const key of determined.keys()) {
    const [period, cohort, m] = key.split('|') as [string, string, Measure];
    const cell = agg.get(period)?.get(cohort);
    if (cell && isSensitiveValue(cell[m])) out.push(key);
  }
  return out;
}

interface SuppressionResult {
  suppressed: Set<string>; // `${period}|${cohort}`
  sensitiveCells: number;
  growthRounds: number;
  recoverable: string[]; // MUST be empty on success
}

// OUTPUT MODE. The owner-dashboard table (the ONLY surface this build feeds today) publishes every
// aggregate cell as a real count — no <5 / complementary / seed suppression — per AGENTS.md "Retention
// page data policy" (aggregate counts incl. 1 are allowed; identity-level data stays forbidden, enforced
// by the local DOB→age reduction + the leak guards, which are UNCHANGED). `computeSuppression` and its
// reconstruction solver are RETAINED below, unused on this path, for a possible future PUBLIC_EXPORT mode
// (a hypothetical wider-distribution surface) — the only context that would set this true.
const PUBLIC_EXPORT_MODE = false;

// Owner-dashboard suppression = NONE: every cell published with its real count, suppressed=false.
function ownerDashboardSuppression(): SuppressionResult {
  return { suppressed: new Set<string>(), sensitiveCells: 0, growthRounds: 0, recoverable: [] };
}

// Suppress every row holding a sensitive cell, FULLY suppress every seed-boundary month, then grow the
// rest COMPLEMENTARILY until the mechanical test is clean. Complement pick = the SMALLEST-flow NONZERO
// not-yet-suppressed cohort (a 0-total / externally-pinned band adds no genuine 2nd unknown, so it is
// never a complement). Terminates: ≤5 cohorts/period.
function computeSuppression(agg: Aggregate, ratesByPeriod: Map<string, RatesRow>): SuppressionResult {
  const suppressed = new Set<string>();
  let sensitiveCells = 0;
  for (const [period, cohorts] of agg) {
    for (const [cohort, cell] of cohorts) {
      let rowSensitive = false;
      for (const m of MEASURES) if (isSensitiveValue(cell[m])) { sensitiveCells++; rowSensitive = true; }
      if (rowSensitive) suppressed.add(`${period}|${cohort}`);
    }
  }

  // SEED-BOUNDARY MONTHS are FULLY SUPPRESSED (Reviewer decision 2026-06-26): a seed month is excluded
  // from the chart anyway, so suppressing all 5 cohorts costs no visible value and removes the residual
  // k=2 narrowing of the seed-month lost cell (gym lost-total can be 1 with 4 bands at 0 → only
  // 2-protectable otherwise). The Must-fix complement logic below still governs every NON-seed month.
  for (const [period, cohorts] of agg) {
    if (ratesByPeriod.get(period)?.is_seed_boundary) for (const cohort of cohorts.keys()) suppressed.add(`${period}|${cohort}`);
  }

  let growthRounds = 0;
  for (let guard = 0; guard < COHORT_IDS.length + 1; guard++) {
    const recoverable = recoverableSensitiveCells(agg, ratesByPeriod, suppressed);
    if (recoverable.length === 0) break;
    growthRounds++;
    const offendingPeriods = new Set(recoverable.map((k) => k.split('|')[0]));
    for (const period of offendingPeriods) {
      const cohorts = agg.get(period)!;
      // COMPLEMENT = the SMALLEST-flow NONZERO not-yet-suppressed cohort (Reviewer Must-fix). A 2nd
      // suppressed band makes the binding equation 2-unknown ONLY if that band is a GENUINE unknown — a
      // 0-total band is externally pinnable (unknownCohort=0 is inferable from its published 0s; see
      // externallyKnownCells), adds no uncertainty, and would leave the sensitive cell sole-unknown once
      // the attacker substitutes the pin (the demonstrated 2025-06 teens.lost leak). So a known-0 band is
      // NEVER a complement (it stays PUBLISHED as a transparency 0); only NONZERO real bands are eligible.
      // Pick the smallest to preserve the most published data; deterministic tie-break by COHORT_IDS order.
      // (If no nonzero band remains, no complement can be added — the recoverability test then flags the
      // period and the build aborts rather than ship a recoverable cell.)
      let pick: string | null = null;
      let pickTotal = Infinity;
      for (const cohort of COHORT_IDS) {
        if (suppressed.has(`${period}|${cohort}`)) continue;
        const cell = cohorts.get(cohort)!;
        const total = cell.new + cell.returning + cell.lost;
        if (total === 0) continue; // pinnable / no-uncertainty band — never a protective complement
        if (total < pickTotal) {
          pickTotal = total;
          pick = cohort;
        }
      }
      if (pick) suppressed.add(`${period}|${pick}`);
    }
  }

  return { suppressed, sensitiveCells, growthRounds, recoverable: recoverableSensitiveCells(agg, ratesByPeriod, suppressed) };
}

// ─── SUMMARY (§5-safe) + PAYLOAD ───────────────────────────────────────────────────────────────────────
function categorize(value: number | null): CellCategory {
  if (value === null) return 'suppressed';
  if (value === 0) return 'zero';
  if (value >= 5) return 'ge5';
  return 'lt5'; // small aggregate count 1..4 — a normal owner-dashboard value (the raw value is still
  //              not printed; the §5-safe summary emits the category enum only).
}

function buildSummary(
  agg: Aggregate,
  excluded: Array<{ sourceMonth: string; mappedPeriod: string; reason: string }>,
  cons: Conservation,
  supp: SuppressionResult,
  coverage: JoinCoverage,
  unknownEvents: UnknownEvents,
  parseOk: boolean,
  youthUnder3DistinctClients: number,
): BuildSummary {
  const periods = [...agg.keys()].sort();
  const isSuppressed = (period: string, cohort: string): boolean => supp.suppressed.has(`${period}|${cohort}`);

  const perBand = COHORT_IDS.map((cohort) => {
    let rows = 0;
    let suppressedRows = 0;
    for (const period of periods) {
      rows++;
      if (isSuppressed(period, cohort)) suppressedRows++;
    }
    return { cohort, rows, suppressedRows };
  });

  const totalRows = periods.length * COHORT_IDS.length;
  let totalRowsSuppressed = 0;
  for (const period of periods) for (const cohort of COHORT_IDS) if (isSuppressed(period, cohort)) totalRowsSuppressed++;

  // sample structure: the first built period, cells as category enums only (never a raw value).
  const samplePeriod = periods[0] ?? null;
  const sampleCells = samplePeriod
    ? COHORT_IDS.map((cohort) => {
        const cell = agg.get(samplePeriod)!.get(cohort)!;
        const supd = isSuppressed(samplePeriod, cohort);
        return {
          cohort,
          new: supd ? ('suppressed' as CellCategory) : categorize(cell.new),
          returning: supd ? ('suppressed' as CellCategory) : categorize(cell.returning),
          lost: supd ? ('suppressed' as CellCategory) : categorize(cell.lost),
        };
      })
    : [];

  let verdict: BuildSummary['verdict'] = 'built_ok';
  if (!parseOk || periods.length === 0) verdict = 'empty_or_unparseable';
  else if (coverage.belowFloor) verdict = 'join_coverage_below_floor';
  else if (!cons.allNonSeedTie) verdict = 'conservation_failed';
  else if (supp.recoverable.length > 0) verdict = 'suppression_incomplete';

  return {
    build: 'buildMemberRetentionByCohort',
    table: TABLE,
    parseOk,
    builtPeriods: periods.length,
    monthSpan: { min: periods[0] ?? null, max: periods[periods.length - 1] ?? null },
    excludedPeriods: excluded,
    perBand,
    totalRows,
    totalRowsSuppressed,
    totalCellsSensitive: supp.sensitiveCells,
    suppressionGrowthRounds: supp.growthRounds,
    conservation: {
      closedPeriodsChecked: cons.closedPeriodsChecked,
      allNonSeedTie: cons.allNonSeedTie,
      seedPeriod: cons.seedPeriod,
      seedTies: cons.seedTies,
    },
    joinCoverage: {
      matchRate: coverage.matchRate,
      totalDistinctExportIds: coverage.totalDistinctExportIds,
      unmatchedDistinct: coverage.unmatchedDistinct,
      coverageFloor: coverage.coverageFloor,
      belowFloor: coverage.belowFloor,
      unknownCohortEvents: unknownEvents.total,
      unknownFromUnmatched: unknownEvents.fromUnmatched,
      unknownFromMatchedUnusableDob: unknownEvents.fromMatchedUnusableDob,
    },
    recoverableSensitiveCells: supp.recoverable.length,
    youthFloorUnder3DistinctClients: youthUnder3DistinctClients,
    sampleStructure: { period: samplePeriod, cells: sampleCells },
    verdict,
    verdictProvisional: cons.seedTies === false,
  };
}

// Idempotent UPSERT payload for the GATED apply. Post-suppression values only (null / 0 / ≥5). Preserves
// older months (ON CONFLICT DO UPDATE; never DELETE/TRUNCATE). Written to a LOCAL file, never stdout.
function buildUpsertSql(agg: Aggregate, suppressed: Set<string>): string {
  const periods = [...agg.keys()].sort();
  const tuples: string[] = [];
  for (const period of periods) {
    for (const cohort of COHORT_IDS) {
      const cell = agg.get(period)!.get(cohort)!;
      const supd = suppressed.has(`${period}|${cohort}`);
      const v = (n: number): string => (supd ? 'null' : String(n));
      tuples.push(`  ('${WORKSPACE_ID}', '${period}', '${cohort}', ${v(cell.new)}, ${v(cell.returning)}, ${v(cell.lost)}, ${supd ? 'true' : 'false'})`);
    }
  }
  return [
    `insert into ${TABLE}`,
    '  (workspace_id, period_month, cohort_band, new_members, returning_members, lost_members, suppressed)',
    'values',
    tuples.join(',\n'),
    'on conflict (workspace_id, period_month, cohort_band) do update set',
    '  new_members       = excluded.new_members,',
    '  returning_members = excluded.returning_members,',
    '  lost_members      = excluded.lost_members,',
    '  suppressed        = excluded.suppressed,',
    '  fetched_at        = now();',
    '',
  ].join('\n');
}

// ─── LEAK GUARD ──────────────────────────────────────────────────────────────────────────────────────
function scanForLeak(serialized: string): string[] {
  const v: string[] = [];
  if (/\d{4}-\d{2}-\d{2}/.test(serialized)) v.push('YYYY-MM-DD day-level date');
  if (/\d{7,}/.test(serialized)) v.push('>=7-digit run (ID-shaped)');
  if (serialized.includes('@')) v.push('@ (email-shaped)');
  return v;
}

// ─── LIVE /clients FETCH (GATED — mirrors retentionCohortJoinProbe; NOT exercised by --selftest) ─────────
function pickField(rec: Record<string, unknown>, candidates: string[]): string {
  for (const k of Object.keys(rec)) {
    if (candidates.includes(normalizeKey(k))) {
      const val = rec[k];
      return val == null ? '' : String(val);
    }
  }
  return '';
}
async function fetchAllClients(apiKey: string): Promise<ClientRecord[]> {
  const out: ClientRecord[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${BASE_URL}${CLIENTS_PATH}?page=${page}&pageSize=${PAGE_SIZE}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    let body: unknown;
    try {
      const res = await fetch(url, { headers: { 'x-api-key': apiKey, accept: 'application/json' }, signal: ctrl.signal });
      body = await res.json();
    } finally {
      clearTimeout(t);
    }
    const arr = Array.isArray(body)
      ? body
      : body && typeof body === 'object'
        ? ((Object.values(body as Record<string, unknown>).find((x) => Array.isArray(x)) as unknown[] | undefined) ?? [])
        : [];
    for (const item of arr) {
      if (item && typeof item === 'object') {
        const rec = item as Record<string, unknown>;
        out.push({ clientId: pickField(rec, ['id', 'clientid']), dobRaw: pickField(rec, DOB_FIELD_CANDIDATES) });
      }
    }
    const pagination = body && typeof body === 'object' ? (body as Record<string, unknown>).pagination : undefined;
    const hasMore = pagination && typeof pagination === 'object' ? Boolean((pagination as Record<string, unknown>).has_more) : arr.length === PAGE_SIZE;
    if (!hasMore || arr.length === 0) break;
  }
  return out;
}

// ─── SELF-TEST (network-free; synthetic export + /clients + #495 fixture; reconstruction-attack suite) ──
function runSelfTest(): void {
  const NAME = 'ZZ_LEAK_NAME_SENTINEL';
  const ID = '98765432'; // 8-digit fake Client ID VALUE
  const PII = [NAME, ID, 'leak@member.example'];
  const fail = (m: string): void => {
    console.error(`SELFTEST FAIL: ${m}`);
    process.exit(1);
  };

  // (0) cohort-id parity with the schema allowlist — guards against cohortBands.ts drifting from the .sql.
  if (JSON.stringify(COHORT_IDS) !== JSON.stringify(SCHEMA_BAND_ALLOWLIST)) {
    fail(`COHORT_IDS ${JSON.stringify(COHORT_IDS)} != schema allowlist ${JSON.stringify(SCHEMA_BAND_ALLOWLIST)} — update the .sql`);
  }

  // (A) Age-as-of-mapped-period derivation (the cohortBands integration). Source 2025-05 → mapped 2025-06,
  // as-of 2025-06-01. Reuses the join-probe boundary cases.
  const asOf = '2025-06-01';
  const ageChecks: Array<[string, boolean]> = [
    // FLOOR LOCK: youth window is 1–15 (the union of the prior kids/teens bands). Under-3s fold INTO youth
    // (floor 1), age 0 / ≤0 routes to Unknown — preserving the prior partition + the unknownCohort=0 invariant.
    ['age 1 (youth floor) → youth3to15', cohortFor('2024-06-01', asOf) === 'youth3to15'],
    ['age 2 (under-3 folded into youth) → youth3to15', cohortFor('2023-06-01', asOf) === 'youth3to15'],
    ['age 0 (below floor) → unknownCohort', cohortFor('2025-06-01', asOf) === UNKNOWN_COHORT_ID],
    ['age 6 on birthday → youth3to15', cohortFor('2019-06-01', asOf) === 'youth3to15'],
    ['age 9 → youth3to15', cohortFor('2016-06-01', asOf) === 'youth3to15'],
    ['age 10 → youth3to15', cohortFor('2015-06-01', asOf) === 'youth3to15'],
    ['age 15 (youth ceiling) → youth3to15', cohortFor('2010-06-01', asOf) === 'youth3to15'],
    ['age 16 (adults floor) → adults16plus', cohortFor('2009-06-01', asOf) === 'adults16plus'],
    ['sentinel 1900 → unknownCohort', cohortFor('1900-01-01', asOf) === UNKNOWN_COHORT_ID],
    ['future DOB → unknownCohort', cohortFor('2030-01-01', asOf) === UNKNOWN_COHORT_ID],
    ['invalid calendar → unknownCohort', cohortFor('2010-02-30', asOf) === UNKNOWN_COHORT_ID],
    ['empty/unmatched → unknownCohort', cohortFor(undefined, asOf) === UNKNOWN_COHORT_ID],
    ['datetime suffix tolerated → adults16plus', cohortFor('1990-06-01T00:00:00Z', asOf) === 'adults16plus'],
  ];
  const ageFailed = ageChecks.filter(([, ok]) => !ok).map(([n]) => n);
  if (ageFailed.length) fail(`age/cohort derivation: ${ageFailed.join('; ')}`);

  // (B) Synthetic build. We hand-build the aggregate directly (the CSV/join paths are covered by the
  // sibling probes + the parse test in (G)) so the suppression scenarios are precise. With only TWO real
  // bands (youth + adults) and a pinned unknownCohort=0, EITHER real band being sensitive forces BOTH
  // suppressed (the other is its sole complement) — the 2-band dynamic this re-band must hold:
  //   2025-06 (SEED): youth + adults nonzero, no sensitive cell → FULLY suppressed by the seed rule.
  //   2025-07 (CLOSED): ONE sensitive cell (youth new=2) in a large month → must grow to ≥2 suppressed
  //                     (suppressing youth alone leaves it recoverable as gym−adults−unknown).
  //   2025-08 (CLOSED): the sensitive cell is in ADULTS (lost=3) instead → complement is youth; proves
  //                     either band can be the offender. unknownCohort stays published (transparency 0) in both.
  const mk = (n: number, r: number, l: number): CohortCell => ({ new: n, returning: r, lost: l });
  const agg: Aggregate = new Map();
  // period → cohort → cell (all 3 cohorts present, explicit zeroes)
  const setPeriod = (period: string, vals: Partial<Record<string, CohortCell>>): void => {
    const m = freshPeriodCohorts();
    for (const [c, cell] of Object.entries(vals)) m.set(c, cell!);
    agg.set(period, m);
  };
  setPeriod('2025-06', { adults16plus: mk(20, 100, 5), youth3to15: mk(6, 10, 0) });
  setPeriod('2025-07', { adults16plus: mk(15, 90, 7), youth3to15: mk(2, 12, 0) });
  setPeriod('2025-08', { adults16plus: mk(10, 80, 3), youth3to15: mk(9, 11, 8) });

  // #495 fixture = the gym-wide margins (Σ over the 5 cohorts, by construction).
  const sumMeasure = (period: string, m: Measure): number => {
    let s = 0;
    for (const cell of agg.get(period)!.values()) s += cell[m];
    return s;
  };
  const ratesByPeriod = new Map<string, RatesRow>();
  for (const [period, seed] of [['2025-06', true], ['2025-07', false], ['2025-08', false]] as const) {
    ratesByPeriod.set(period, {
      period_month: period,
      new_members: sumMeasure(period, 'new'),
      returning_members: sumMeasure(period, 'returning'),
      lost_members: sumMeasure(period, 'lost'),
      is_seed_boundary: seed,
    });
  }

  // Conservation must tie (we built the fixture from the sums).
  const cons = checkConservation(agg, ratesByPeriod);
  if (!cons.allNonSeedTie) fail(`conservation should tie for non-seed periods (failures: ${cons.nonSeedFailures.join(', ')})`);
  if (cons.seedTies !== true) fail('seed-boundary conservation should tie in the synthetic fixture');

  // Suppression.
  const supp = computeSuppression(agg, ratesByPeriod);
  const isSupp = (p: string, c: string): boolean => supp.suppressed.has(`${p}|${c}`);

  const suppChecks: Array<[string, boolean]> = [
    // 2025-06 seed boundary: fully suppressed regardless of sensitivity.
    ['2025-06 (seed boundary) FULLY suppressed — all 3 cohorts', COHORT_IDS.every((c) => isSupp('2025-06', c))],
    // 2025-07: the sensitive youth cell IS suppressed AND grew to ≥2 (complement adults).
    ['2025-07 youth3to15 suppressed', isSupp('2025-07', 'youth3to15')],
    ['2025-07 grew to >=2 suppressed rows (complement adults)', COHORT_IDS.filter((c) => isSupp('2025-07', c)).length >= 2],
    ['2025-07 unknownCohort published (transparency 0)', !isSupp('2025-07', 'unknownCohort')],
    // 2025-08: the sensitive cell is in ADULTS → adults suppressed AND grew to ≥2 (complement youth).
    ['2025-08 adults16plus suppressed', isSupp('2025-08', 'adults16plus')],
    ['2025-08 grew to >=2 suppressed rows (complement youth)', COHORT_IDS.filter((c) => isSupp('2025-08', c)).length >= 2],
    ['2025-08 unknownCohort published (transparency 0)', !isSupp('2025-08', 'unknownCohort')],
    // the mechanical test reports NO recoverable sensitive cell on the final set.
    ['no recoverable sensitive cell', supp.recoverable.length === 0],
    // sensitive cell count: youth new=2 (1) + adults lost=3 (1) = 2.
    ['sensitive cells = 2', supp.sensitiveCells === 2],
    ['grew at least one round', supp.growthRounds >= 1],
  ];
  const suppFailed = suppChecks.filter(([, ok]) => !ok).map(([n]) => n);
  if (suppFailed.length) fail(`suppression: ${suppFailed.join('; ')}`);

  // (C) RECONSTRUCTION ATTACK — fail-detection of the suppressor's OWN guard. A DELIBERATELY under-
  // suppressed set (suppress ONLY the single sensitive row in 2025-07, skip the complement) MUST be
  // flagged recoverable by the mechanical test through the cohort-sum + #495 margins (else the test is
  // vacuous). This is the "next-smallest row is not enough" proof.
  const underSuppressed = new Set<string>(['2025-07|youth3to15']);
  const underRecoverable = recoverableSensitiveCells(agg, ratesByPeriod, underSuppressed);
  if (!underRecoverable.includes('2025-07|youth3to15|new')) {
    fail('mechanical test FAILED to flag a single-suppressed sensitive cell as recoverable (guard is vacuous)');
  }

  // (D) CASCADE proof (non-tautology): with the FINAL safe set, inject an EXTERNAL LEAK — the attacker
  // learns the complement cohort's `new` for 2025-07 — and assert the previously-safe sensitive cell now
  // becomes recoverable. Proves the propagation genuinely solves a system, not just counts |K|.
  const complement = COHORT_IDS.find((c) => c !== 'youth3to15' && isSupp('2025-07', c))!;
  const seedKnown = new Map<string, number>([[`2025-07|${complement}|new`, agg.get('2025-07')!.get(complement)!.new]]);
  const cascade = recoverableSensitiveCells(agg, ratesByPeriod, supp.suppressed, [], seedKnown);
  if (!cascade.includes('2025-07|youth3to15|new')) {
    fail('cascade attack did not recover the sensitive cell after an external leak — propagation is not solving the system');
  }
  // …and WITHOUT the injected leak, the same set is clean (already asserted via supp.recoverable, re-confirm).
  if (recoverableSensitiveCells(agg, ratesByPeriod, supp.suppressed).length !== 0) fail('final set not clean without the injected leak');

  // (E) AUXILIARY-MARGIN non-interference: enumerate cohort_histogram as stock equations over DISJOINT
  // variables (active-count vars never shared with flow cells). Adding them must NOT change the clean
  // verdict (their stock-vs-flow linkage is weak / non-binding) — enumerated, proven inert.
  const histogramEqs: Equation[] = COHORT_IDS.map((c) => ({ vars: [`2025-07|${c}|activeStock`], rhs: 999 }));
  const withHistogram = recoverableSensitiveCells(agg, ratesByPeriod, supp.suppressed, histogramEqs);
  if (withHistogram.length !== 0) fail('cohort_histogram stock margin spuriously changed the recoverable set');

  // (F) §5-safe SUMMARY — no planted PII, no raw small value, no structural leak signature.
  const excluded = [{ sourceMonth: '2025-09', mappedPeriod: '2025-10', reason: 'no_member_retention_rates_reference (incomplete trailing intake)' }];
  const synthCoverage: JoinCoverage = { totalDistinctExportIds: 200, matchedDistinct: 200, unmatchedDistinct: 0, matchRate: 1, coverageFloor: COVERAGE_FLOOR, belowFloor: false };
  const synthUnknown: UnknownEvents = { total: 0, fromUnmatched: 0, fromMatchedUnusableDob: 0 };
  const summary = buildSummary(agg, excluded, cons, supp, synthCoverage, synthUnknown, true, 0);
  const ser = JSON.stringify(summary, null, 2);
  console.log(ser);
  if (PII.some((t) => ser.includes(t))) fail('summary leaked planted PII');
  const structLeaks = scanForLeak(ser);
  if (structLeaks.length) fail(`summary tripped leak guard: ${structLeaks.join(', ')}`);
  // RETAINED public-export suppressor: with suppression ON, no small cell reaches output, so the sample
  // structure carries no 'lt5' category (the sample period 2025-06 is fully suppressed here).
  if (ser.includes('"lt5"')) fail('public-export suppression left a 1..4 cell published as lt5');
  const summaryChecks: Array<[string, boolean]> = [
    ['builtPeriods = 3', summary.builtPeriods === 3],
    ['monthSpan 2025-06..2025-08', summary.monthSpan.min === '2025-06' && summary.monthSpan.max === '2025-08'],
    ['totalRows = 9 (3 periods × 3 bands)', summary.totalRows === 9],
    ['verdict built_ok', summary.verdict === 'built_ok'],
    ['recoverableSensitiveCells = 0', summary.recoverableSensitiveCells === 0],
    ['perBand covers all 3 cohorts', summary.perBand.length === 3],
    ['youthFloorUnder3 surfaced (0 in synthetic)', summary.youthFloorUnder3DistinctClients === 0],
    ['excluded period reported', summary.excludedPeriods.length === 1],
    ['sample period present', summary.sampleStructure.period === '2025-06'],
    ['joinCoverage surfaced (matchRate 1, not below floor)', summary.joinCoverage.matchRate === 1 && summary.joinCoverage.belowFloor === false],
  ];
  const summaryFailed = summaryChecks.filter(([, ok]) => !ok).map(([n]) => n);
  if (summaryFailed.length) fail(`summary: ${summaryFailed.join('; ')}`);

  // (G) PARSE path — the self-contained CSV parser + label tally + per-event aging on a small synthetic
  // export joined to a synthetic /clients map. Confirms the end-to-end build matches the hand-built agg
  // for one period, with PLANTED PII in the rows that must never reach output.
  const header = 'First Of Month,Client ID,Change Type,Positive Change,Negative Change,Membership ID,Client Name';
  const exportCsv = [
    header,
    `2025-06-01,C_AD,New,1,0,2000001,${NAME}`, // adult new (mapped 2025-07)
    `2025-06-01,${ID},Returning,1,0,2000002,leak@member.example`, // adult returning, planted 8-digit id
    `2025-06-01,C_KID,New,1,0,2000003,k`, // youth new (mapped 2025-07)
    `2025-05-01,C_AD,Lost,0,1,2000004,x`, // adult lost (mapped 2025-06)
  ].join('\n');
  const rows = parseClientGrain(exportCsv);
  const dobById = new Map<string, string>([
    ['C_AD', '1985-06-01'],
    [ID, '1990-06-01'],
    ['C_KID', '2017-06-01'], // age 8 as-of 2025-07-01 → youth3to15
  ]);
  const ratesForParse = new Map<string, RatesRow>([
    ['2025-06', { period_month: '2025-06', new_members: 0, returning_members: 0, lost_members: 1, is_seed_boundary: true }],
    ['2025-07', { period_month: '2025-07', new_members: 2, returning_members: 1, lost_members: 0, is_seed_boundary: false }],
  ]);
  const built = buildAggregate(rows, dobById, ratesForParse);
  const p07 = built.agg.get('2025-07')!;
  const parseChecks: Array<[string, boolean]> = [
    ['2025-07 adults new = 1', p07.get('adults16plus')!.new === 1],
    ['2025-07 adults returning = 1', p07.get('adults16plus')!.returning === 1],
    ['2025-07 youth3to15 new = 1', p07.get('youth3to15')!.new === 1],
    ['2025-06 adults lost = 1 (source 2025-05 mapped)', built.agg.get('2025-06')!.get('adults16plus')!.lost === 1],
    ['all 3 cohorts present in 2025-07', COHORT_IDS.every((c) => p07.has(c))],
    ['G: join coverage 100% (all ids matched)', computeJoinCoverage(rows, dobById).matchRate === 1],
    ['G: no under-3 client (youthFloorUnder3 = 0)', built.youthUnder3DistinctClients === 0],
  ];
  const parseFailed = parseChecks.filter(([, ok]) => !ok).map(([n]) => n);
  if (parseFailed.length) fail(`parse/join/age: ${parseFailed.join('; ')}`);

  // (G2) YOUTH-FLOOR diagnostic (positive case). An under-3 client (age 2 as-of 2025-07-01) is FOLDED INTO
  // youth (floor 1) AND counted in youthFloorUnder3DistinctClients — proves the union floor and the
  // floor-decision counter together. An adult in the same build is NOT counted.
  const floorRows = parseClientGrain(
    [header, '2025-06-01,TODDLER,New,1,0,2000010,t', '2025-06-01,GROWN,New,1,0,2000011,g'].join('\n'),
  );
  const floorDob = new Map<string, string>([['TODDLER', '2023-06-01'], ['GROWN', '1990-06-01']]);
  const floorRates = new Map<string, RatesRow>([
    ['2025-07', { period_month: '2025-07', new_members: 2, returning_members: 0, lost_members: 0, is_seed_boundary: false }],
  ]);
  const floorBuilt = buildAggregate(floorRows, floorDob, floorRates);
  const floorChecks: Array<[string, boolean]> = [
    ['G2: under-3 toddler folded into youth3to15', floorBuilt.agg.get('2025-07')!.get('youth3to15')!.new === 1],
    ['G2: adult lands in adults16plus', floorBuilt.agg.get('2025-07')!.get('adults16plus')!.new === 1],
    ['G2: youthFloorUnder3 counts the toddler (=1)', floorBuilt.youthUnder3DistinctClients === 1],
  ];
  const floorFailed = floorChecks.filter(([, ok]) => !ok).map(([n]) => n);
  if (floorFailed.length) fail(`youth-floor diagnostic: ${floorFailed.join('; ')}`);

  // (H) UPSERT PAYLOAD — leak-safe (no 1..4 literal for an unsuppressed cell; suppressed → null), all 5
  // cohorts × built periods, ON CONFLICT DO UPDATE, NO delete/truncate.
  const sql = buildUpsertSql(agg, supp.suppressed);
  const payloadChecks: Array<[string, boolean]> = [
    ['upsert targets the table', sql.includes(TABLE)],
    ['on conflict do update', sql.includes('on conflict (workspace_id, period_month, cohort_band) do update set')],
    ['no delete', !/\bdelete\b/i.test(sql)],
    ['no truncate', !/\btruncate\b/i.test(sql)],
    ['suppressed rows carry null', sql.includes("'2025-07', 'youth3to15', null, null, null, true")],
    ['row count = 9 tuples', (sql.match(/\(\s*'default',/g) ?? []).length === 9],
  ];
  const payloadFailed = payloadChecks.filter(([, ok]) => !ok).map(([n]) => n);
  if (payloadFailed.length) fail(`payload: ${payloadFailed.join('; ')}`);
  // the payload must NOT print to stdout in a real run; here we only scan it for an accidental leak.
  if (PII.some((t) => sql.includes(t))) fail('payload leaked planted PII');

  // (I) LEAK-GUARD unit tests (sibling parity).
  if (scanForLeak(`{"x":"${ID}"}`).length === 0) fail('guard missed 7+ digit run');
  if (scanForLeak('{"x":"a@b"}').length === 0) fail('guard missed @');
  if (scanForLeak('{"x":"2020-01-01"}').length === 0) fail('guard missed YYYY-MM-DD');
  if (scanForLeak('{"min":"2025-06","max":"2025-08","n":15}').length !== 0) fail('guard false-positived on YYYY-MM + small ints');

  // (J) JOIN-COVERAGE GUARD (Reviewer-required) — match-rate abort + the unknownCohort decomposition.
  const covRows = parseClientGrain(
    [
      header,
      '2025-06-01,J1,New,1,0,2000001,a',
      '2025-06-01,J2,New,1,0,2000002,b',
      '2025-06-01,J3,Returning,1,0,2000003,c',
      '2025-06-01,J4,Returning,1,0,2000004,d',
      '2025-06-01,J5,Lost,0,1,2000005,e',
    ].join('\n'),
  );
  // under-coverage: only J1,J2 are in the /clients pull → match-rate 2/5 = 0.4 < floor → would HARD-ABORT.
  const covLow = computeJoinCoverage(covRows, new Map([['J1', '1985-06-01'], ['J2', '1990-06-01']]));
  // healthy: all 5 present → 1.0, no abort.
  const covOk = computeJoinCoverage(
    covRows,
    new Map([['J1', '1985-06-01'], ['J2', '1990-06-01'], ['J3', '2000-06-01'], ['J4', '2005-06-01'], ['J5', '2010-06-01']]),
  );
  // decomposition via buildAggregate (source 2025-06 → mapped 2025-07): J3 matched-but-sentinel (unusable
  // DOB) → fromMatchedUnusableDob; J4/J5 absent from the pull → fromUnmatched.
  const covRates = new Map<string, RatesRow>([['2025-07', { period_month: '2025-07', new_members: 2, returning_members: 2, lost_members: 1, is_seed_boundary: false }]]);
  const covBuilt = buildAggregate(covRows, new Map([['J1', '1985-06-01'], ['J2', '1990-06-01'], ['J3', '1900-01-01']]), covRates);
  const covChecks: Array<[string, boolean]> = [
    ['under-coverage match-rate 0.4', covLow.matchRate === 0.4],
    ['under-coverage belowFloor true (HARD-ABORT)', covLow.belowFloor === true],
    ['under-coverage unmatched = 3', covLow.unmatchedDistinct === 3],
    ['healthy match-rate 1.0', covOk.matchRate === 1],
    ['healthy belowFloor false', covOk.belowFloor === false],
    ['empty ids → match-rate 1 (no div-by-zero)', computeJoinCoverage([], new Map()).matchRate === 1],
    ['unknownCohort total = 3', covBuilt.unknownEvents.total === 3],
    ['unknown fromUnmatched = 2 (J4,J5 absent)', covBuilt.unknownEvents.fromUnmatched === 2],
    ['unknown fromMatchedUnusableDob = 1 (J3 sentinel)', covBuilt.unknownEvents.fromMatchedUnusableDob === 1],
  ];
  const covFailed = covChecks.filter(([, ok]) => !ok).map(([n]) => n);
  if (covFailed.length) fail(`join-coverage guard: ${covFailed.join('; ')}`);

  // (K) EXTERNALLY-PINNED COMPLEMENT (Reviewer Must-fix) — a NON-seed period (the complement logic governs
  // non-seed months only; seed months are fully suppressed) with ONE sensitive band (youth.lost=1) whose
  // only other sibling besides the NONZERO adults band is a globally-0 unknownCohort. The fix must (a) NOT
  // pick unknownCohort as the complement, (b) leave it PUBLISHED (transparency 0), (c) pick the NONZERO real
  // band (adults) so youth is no longer sole-unknown, and (d) the recoverability test must FLAG the OLD buggy
  // {youth, unknownCohort} pairing as recoverable once the pin is substituted. With only 2 real bands the
  // complement is uniquely adults — this is the canonical 2-band shape this re-band introduces.
  const kAgg: Aggregate = new Map();
  const kCohorts = freshPeriodCohorts();
  kCohorts.set('youth3to15', mk(14, 23, 1)); // lost=1 is the ONLY sensitive cell
  kCohorts.set('adults16plus', mk(60, 70, 0)); // the only NONZERO real band → the forced complement
  // unknownCohort stays (0,0,0) from freshPeriodCohorts → globally 0 → externally pinned.
  kAgg.set('2025-07', kCohorts);
  const kRates = new Map<string, RatesRow>([
    ['2025-07', { period_month: '2025-07', new_members: 74, returning_members: 93, lost_members: 1, is_seed_boundary: false }],
  ]);
  const kSupp = computeSuppression(kAgg, kRates);
  const kIs = (c: string): boolean => kSupp.suppressed.has(`2025-07|${c}`);
  const kChecks: Array<[string, boolean]> = [
    ['youth suppressed (sensitive lost=1)', kIs('youth3to15')],
    ['unknownCohort NOT suppressed (published transparency 0)', !kIs('unknownCohort')],
    ['complement is the NONZERO real band (adults16plus)', kIs('adults16plus')],
    ['exactly 2 bands suppressed', COHORT_IDS.filter(kIs).length === 2],
    ['recoverable 0 under the pinned-attacker model', kSupp.recoverable.length === 0],
    // CONTROL — the OLD buggy {youth, unknownCohort} pairing IS flagged recoverable (pin substituted first).
    [
      'old {youth,unknownCohort} pairing flagged recoverable',
      recoverableSensitiveCells(kAgg, kRates, new Set(['2025-07|youth3to15', '2025-07|unknownCohort'])).includes('2025-07|youth3to15|lost'),
    ],
  ];
  const kFailed = kChecks.filter(([, ok]) => !ok).map(([n]) => n);
  if (kFailed.length) fail(`externally-pinned complement: ${kFailed.join('; ')}`);

  // (L) OWNER-DASHBOARD OUTPUT MODE (Slice 2 — AGENTS.md "Retention page data policy"). The live path uses
  // ownerDashboardSuppression() (no suppression): every cell publishes its REAL count incl. 1,
  // suppressed=false, no nulls; the seed month is published as real rows too; conservation still holds; all
  // 3 bands × periods are emitted; and the payload carries NO identity-shaped value. Built with a count of 1.
  const odSupp = ownerDashboardSuppression();
  const odAgg: Aggregate = new Map();
  const odSet = (period: string, vals: Partial<Record<string, CohortCell>>): void => {
    const m = freshPeriodCohorts();
    for (const [c, cell] of Object.entries(vals)) m.set(c, cell!);
    odAgg.set(period, m);
  };
  odSet('2025-06', { youth3to15: mk(6, 10, 1), adults16plus: mk(20, 100, 3) }); // seed, small counts incl lost=1
  odSet('2025-07', { youth3to15: mk(2, 12, 1), adults16plus: mk(15, 90, 3) }); // closed, small counts incl lost=1
  const odRates = new Map<string, RatesRow>();
  for (const [period, seed] of [['2025-06', true], ['2025-07', false]] as const) {
    let n = 0, r = 0, l = 0;
    for (const cell of odAgg.get(period)!.values()) { n += cell.new; r += cell.returning; l += cell.lost; }
    odRates.set(period, { period_month: period, new_members: n, returning_members: r, lost_members: l, is_seed_boundary: seed });
  }
  const odCons = checkConservation(odAgg, odRates);
  const odSql = buildUpsertSql(odAgg, odSupp.suppressed);
  const odSummary = buildSummary(odAgg, [], odCons, odSupp, synthCoverage, synthUnknown, true, 0);
  const odSer = JSON.stringify(odSummary, null, 2);
  const odChecks: Array<[string, boolean]> = [
    ['owner-dashboard: zero suppressed rows', odSummary.totalRowsSuppressed === 0],
    ['owner-dashboard: conservation holds (non-seed)', odCons.allNonSeedTie === true],
    ['owner-dashboard: every payload row suppressed=false', !/,\s*true\)/.test(odSql) && (odSql.match(/,\s*false\)/g) ?? []).length === 6],
    ['owner-dashboard: payload has NO null cell', !/\bnull\b/.test(odSql)],
    ['owner-dashboard: small count 1 preserved (youth 2025-07 lost=1)', odSql.includes("'2025-07', 'youth3to15', 2, 12, 1, false")],
    ['owner-dashboard: seed month published as real rows (not suppressed)', odSql.includes("'2025-06', 'youth3to15', 6, 10, 1, false")],
    ['owner-dashboard: all 3 bands × 2 periods = 6 tuples', (odSql.match(/\(\s*'default',/g) ?? []).length === 6],
    ['owner-dashboard: payload carries no identity-shaped value', scanForLeak(odSql).length === 0],
    ['owner-dashboard: summary leak-clean', scanForLeak(odSer).length === 0],
    ['owner-dashboard: summary carries no planted PII', !PII.some((t) => odSer.includes(t) || odSql.includes(t))],
    ['owner-dashboard: small-count category lt5 surfaced in the sample', odSer.includes('"lt5"')],
  ];
  const odFailed = odChecks.filter(([, ok]) => !ok).map(([n]) => n);
  if (odFailed.length) fail(`owner-dashboard output: ${odFailed.join('; ')}`);

  console.log(
    'SELFTEST PASS: cohort-id↔schema parity; per-event age-as-of-mapped-period derivation; exact conservation ' +
      '(seed captured separately); complementary suppression with a MECHANICAL reconstruction test that (a) flags a ' +
      'single-suppressed sensitive cell as recoverable, (b) cascades under an injected external leak, (c) is inert to ' +
      'the cohort_histogram stock margin, (d) substitutes the externally-pinned unknownCohort=0 before solving so a ' +
      'known-0 band is never a protective complement (Reviewer Must-fix) — all RETAINED for a future PUBLIC_EXPORT ' +
      'mode; OWNER-DASHBOARD OUTPUT MODE (Slice 2 — the live path) publishes every cell as a real count incl. 1, ' +
      'suppressed=false, no nulls, seed month published, conservation + leak-clean payload; ' +
      'Youth/Adults RE-BAND (youth=ages 1–15 union floor; under-3 floor diagnostic); ' +
      'JOIN-COVERAGE GUARD (match-rate abort below ' +
      'floor + unknownCohort unmatched/unusable-DOB decomposition); §5-safe summary (no PII/date/id, no raw value); ' +
      'CSV parse + join + label tally; leak-safe ON-CONFLICT upsert payload (no delete/truncate); leak-guard all correct; no file/network touched.',
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  if (process.argv.includes('--selftest')) {
    runSelfTest();
    return;
  }
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const [exportPath, fixturePath] = args;
  if (!exportPath || !fixturePath) {
    console.error('Usage: buildMemberRetentionByCohort.ts <export.csv> <member_retention_rates_fixture.json>  (or --selftest). Live run is GATED.');
    process.exit(1);
    return;
  }
  const apiKey = process.env.WODIFY_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    console.error('WODIFY_API_KEY is unset — exiting WITHOUT any request (no key, no /clients call, no build).');
    process.exit(1);
    return;
  }

  let summary: BuildSummary;
  let sql = '';
  try {
    const rows = parseClientGrain(readFileSync(exportPath, 'utf8'));
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as RatesRow[];
    const ratesByPeriod = new Map<string, RatesRow>();
    for (const f of fixture) ratesByPeriod.set(f.period_month, f);
    const clients = await fetchAllClients(apiKey);
    const dobById = new Map<string, string>();
    for (const c of clients) dobById.set(c.clientId, c.dobRaw);

    // JOIN-COVERAGE GUARD — abort BEFORE building if the /clients match rate is below the floor. A
    // truncated/regressed pull would dump unmatched clients into unknownCohort and STILL pass conservation
    // (which sums across all cohorts), silently age-corrupting the public table. §5-safe abort line.
    const coverage = computeJoinCoverage(rows, dobById);
    if (coverage.belowFloor) {
      console.error(
        `JOIN COVERAGE BELOW FLOOR: match-rate ${coverage.matchRate} < ${coverage.coverageFloor} ` +
          `(${coverage.unmatchedDistinct} of ${coverage.totalDistinctExportIds} distinct export ids unmatched) — ` +
          'aborting (no payload written). The /clients pull looks truncated/regressed.',
      );
      process.exit(1);
      return;
    }

    const { agg, excluded, unknownEvents, youthUnder3DistinctClients } = buildAggregate(rows, dobById, ratesByPeriod);
    const cons = checkConservation(agg, ratesByPeriod);
    if (!cons.allNonSeedTie) {
      // a non-seed conservation failure is a HARD stop — the reconcile probe proved these tie, so a delta
      // means a build bug or a stale fixture. Do NOT emit a payload from non-conserving aggregates.
      console.error(`CONSERVATION FAILED for non-seed period(s): ${cons.nonSeedFailures.join(', ')} — aborting (no payload written).`);
      process.exit(1);
      return;
    }
    // Owner-dashboard: publish every aggregate cell as a real count (no suppression). The
    // computeSuppression solver is retained for a future PUBLIC_EXPORT mode only; the recoverability
    // abort stays meaningful there and is a no-op here (owner-dashboard recoverable[] is empty).
    const supp = PUBLIC_EXPORT_MODE ? computeSuppression(agg, ratesByPeriod) : ownerDashboardSuppression();
    if (supp.recoverable.length > 0) {
      console.error(`SUPPRESSION INCOMPLETE: ${supp.recoverable.length} sensitive cell(s) still recoverable — aborting (no payload written).`);
      process.exit(1);
      return;
    }
    summary = buildSummary(agg, excluded, cons, supp, coverage, unknownEvents, true, youthUnder3DistinctClients);
    sql = buildUpsertSql(agg, supp.suppressed);
  } catch (err) {
    console.error(`build error: ${(err as Error).message}`);
    process.exit(1);
    return;
  }

  const serialized = JSON.stringify(summary, null, 2);
  // Leak guard runs over BOTH the summary AND the payload (the payload is identity-free by construction —
  // only period 'YYYY-MM', cohort ids, workspace, and counts — but scan it too, defense in depth).
  const leaks = [...scanForLeak(serialized), ...scanForLeak(sql)];
  if (leaks.length > 0) {
    console.error(`LIVE LEAK GUARD TRIPPED: ${leaks.join(', ')} — aborting WITHOUT printing or writing.`);
    process.exit(1);
    return;
  }

  // Write the gated-apply payload to a LOCAL 0600 file OUTSIDE the repo (never stdout, never committed).
  writeFileSync(PAYLOAD_PATH, sql, { mode: 0o600 });
  console.log(serialized);
  console.log(`\nUpsert payload (post-suppression, gated apply) written to ${PAYLOAD_PATH} (0600). NOT applied — awaiting the gated MCP run.`);
}

void main();
