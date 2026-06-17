// Wodify Retention aggregate — the runtime-agnostic normalize + aggregate layer
// for the first bounded live Silent Churn + Attendance Health slice
// (RETENTION_FINISH_PLAN.md §6). This module holds ALL the testable business
// logic; the Supabase Edge Function `sync-wodify-retention` is a thin shell that
// only fetches `/clients`, calls `computeRetentionAggregate`, and persists the
// result. Keeping the logic here means `npm run build` (tsc) and `npm test`
// (vitest) cover it — the Deno function gets no untypechecked business logic.
//
// REUSE BOUNDARY (the load-bearing constraint, §6.1 as refined): this module
// imports the locked date/day-diff primitives `parseYmdLocal` and
// `wholeDaysBetween` from `./silentChurn` and never forks them. It deliberately
// does NOT import `classifyMember` / `computeAttendanceHealth`: those are
// threshold-coupled, and the server emits a THRESHOLD-FREE exact-day histogram
// so the SPA can re-derive Healthy / Watch / Silent at ANY owner-tuned threshold
// (WATCH_FLOOR_DAYS + threshold rule) without another Wodify fetch. Threshold
// application lives entirely in the SPA (PR2).
//
// PII (the member-PII anon-key blocker): raw `/clients` rows are read field-wise
// in memory and never logged, persisted, or emitted. The returned aggregate
// holds NO member-level data — no id, name, exact date, or dues. Only
// snapshot-level `asOf` / `fetchedAt` and pure counts cross the boundary, so the
// aggregate table is anon-readable by construction, not by trust.

// The explicit `.ts` extension is load-bearing for the Supabase Edge deploy: the
// eszip bundler requires explicit .ts resolution for this shared src/ import (the
// `sync-wodify-retention` Edge Function imports this module across the SPA/Deno
// boundary). It is paired with `allowImportingTsExtensions: true` in
// tsconfig.app.json so the SPA typecheck accepts it. Do NOT strip either half —
// dropping the extension reproduces the proven deploy failure
// (Module not found "./silentChurn").
import { parseYmdLocal, wholeDaysBetween } from './silentChurn.ts';
// Tenure band edges (§6 aggregate extension) — the same explicit-`.ts` rule
// applies to this second shared import. tenureBands.ts is dependency-free pure
// constants, so the Edge bundle gains band edges only — never the
// threshold-coupled classifiers (the §6.1 reuse boundary is unchanged).
import { TENURE_BANDS, UNKNOWN_TENURE_ID, bandForTenure } from './tenureBands.ts';
// Cohort (age-band) edges + age derivation (Cohort Retention Card — "Retention by
// Age Group"). Same explicit-`.ts` rule for the Edge deploy; cohortBands.ts is
// dependency-light (only the locked parseYmdLocal), so the bundle gains age-band
// constants + a pure age helper, never the threshold-coupled classifiers.
import {
  COHORT_BANDS,
  UNKNOWN_COHORT_ID,
  ageYearsAsOf,
  cohortForAge,
} from './cohortBands.ts';

// Highest exact day-count bin. Days absent 0..364 get an exact bin; >= 365 rolls
// into `overflow365Plus`. Bounding the histogram means it carries no exact dates
// and cannot re-identify a member.
export const MAX_EXACT_DAYS = 364;

// Wodify's null-date sentinel (#419/§6.2). A `1900-01-01` lastCheckIn means "no
// real check-in," NOT a member absent for ~46 years — it must become null BEFORE
// the day-diff math, never flow into a bin as a giant absence.
export const SENTINEL_NULL_DATE = '1900-01-01';

// Raw Wodify `/clients` row — only the fields this slice reads, all
// unknown-tolerant (the live payload is loosely typed and may omit fields). The
// `id` field exists on the real row but is intentionally absent here: we never
// read or emit it.
export type RawWodifyClient = {
  client_status?: unknown;
  last_attendance?: unknown;
  last_class_sign_in?: unknown;
  is_at_risk?: unknown;
  // Membership start (§6 aggregate extension). PROVEN SOURCEABLE by the
  // membershipStart field-discovery (2026-06-11): true membership start —
  // Wodify's UI "Client Since Date" — 408/408 active usable, semantically
  // confirmed by owner + Reviewer. Read for tenure BANDING only; the exact
  // date never leaves the normalize step.
  member_since?: unknown;
  // Date of birth (Cohort Retention Card). PROVEN ON THE WIRE by the 2026-06-16
  // read-only /clients probe (95% usable active / 100% inactive; 20 active
  // 1900-01-01 sentinels → Unknown cohort); the typed read deliberately under-read
  // it until this slice. Read for age-COHORT BANDING only — the exact date is
  // sliced/validated in normalizeClient and never leaves the normalize step.
  date_of_birth?: unknown;
};

export type NormalizedStatus = 'active' | 'inactive';

// Internal, transient, non-PII normalized member. `status: null` means the raw
// status was missing OR present-but-unrecognized (either way unmappable —
// excluded from every census bucket, counted in `unknownStatus`).
// `lastCheckIn: ''` means active-but-no-usable-date (→ unknown bucket, never
// silently Healthy). `membershipStart: ''` means no usable member_since
// (missing/sentinel/invalid) — the member bins into the unknown-TENURE bucket,
// never silently into "< 3 mo".
export type NormalizedMember = {
  status: NormalizedStatus | null;
  lastCheckIn: string; // 'YYYY-MM-DD' or ''
  membershipStart: string; // 'YYYY-MM-DD' or ''
  // Date of birth for cohort banding (Cohort Retention Card). 'YYYY-MM-DD' or ''
  // (missing/sentinel/invalid → '' → unknown cohort). Transient like
  // membershipStart: the exact date lives only on this in-memory record and is
  // never emitted — only the derived cohort-id counts cross the boundary.
  dob: string;
  isAtRisk: boolean;
};

// Threshold-free exact-day histogram over ACTIVE members. `countsByDaysAbsent`
// is sparse (only non-zero day counts get a key); `overflow365Plus` holds
// everyone >= 365 days absent. The SPA reconstructs any threshold from this.
export type DaysAbsentHistogram = {
  maxExactDays: number; // always MAX_EXACT_DAYS (364)
  countsByDaysAbsent: Record<string, number>;
  overflow365Plus: number;
};

// One tenure band's recency counts (§6 aggregate extension): the same sparse
// exact-day bins + overflow as the global histogram, restricted to the active
// members whose tenure falls in this band, plus that band's unknown-RECENCY
// count (active in band, no usable lastCheckIn — in activeTotal, never at
// risk). Counts only — no member dates, names, or IDs.
export type TenureBandRecency = {
  countsByDaysAbsent: Record<string, number>;
  overflow365Plus: number;
  unknownRecency: number;
};

// The band-edge contract persisted alongside the per-band counts so the
// snapshot is self-describing: the SPA validates these edges EXACTLY (length,
// order, id, minDays) against its own TENURE_BANDS and falls back to Sample on
// any mismatch — a snapshot binned under different edges is never rendered
// under the SPA's labels. Labels are presentation-only and stay SPA-side.
export type TenureBandEdge = { id: string; minDays: number };

// Per-tenure-band partition of the active recency histogram, keyed by band id
// plus the synthetic unknown-tenure bucket (#439: active members whose
// member_since is missing/sentinel/invalid/future — surfaced, never dropped).
// Every TENURE_BANDS id and UNKNOWN_TENURE_ID is always present (empty bands
// carry zero counts), so the SPA contract is deterministic. The bands partition
// the global histogram: merging them bin-wise reproduces daysAbsentHistogram
// and Σ unknownRecency === unknown (proven by test), which is what makes
// Σ band silent === the live Silent Churn count at every threshold.
export type TenureBandHistogram = {
  bandEdges: TenureBandEdge[];
  bands: Record<string, TenureBandRecency>;
};

// One cohort's ACTIVE-side recency counts (Cohort Retention Card, Read 1): the
// same sparse exact-day bins + overflow + unknown-recency as a tenure band,
// restricted to the active members in this age cohort. Counts only.
export type CohortRecency = {
  countsByDaysAbsent: Record<string, number>;
  overflow365Plus: number;
  unknownRecency: number;
};

// One cohort's full entry: the active-side recency histogram (Read 1 — the SPA
// re-derives Healthy/Watch/Silent at any threshold) PLUS the lapsed head-count
// (Read 2 — inactive members in this cohort). Both reads share ONE column so
// Member Movement parity (Σ lapsed === inactiveTotal) is provable in-payload.
export type CohortEntry = {
  active: CohortRecency;
  lapsed: number;
};

// Self-describing age-band edge contract persisted alongside the per-cohort
// counts: the SPA validates these EXACTLY (length, order, id, minAge, maxAge)
// against its own COHORT_BANDS and falls back to Sample on any mismatch — a
// snapshot binned under different age windows is never rendered under the SPA's
// labels. Labels are presentation-only and stay SPA-side.
export type CohortBandEdge = { id: string; minAge: number; maxAge: number };

// Per-cohort partition (Cohort Retention Card), keyed by COHORT_BANDS id plus the
// synthetic unknown-cohort bucket (members whose DOB is missing/sentinel/invalid
// or whose derived age is out of range — surfaced, never dropped). Every id is
// always present (empty cohorts carry zero counts), so the SPA contract is
// deterministic. Two invariants hold by construction (asserted in tests):
//   Σ cohort.active (bins + overflow + unknownRecency) === activeTotal, and
//   Σ cohort.lapsed === inactiveTotal (Member Movement parity).
export type CohortHistogram = {
  cohortEdges: CohortBandEdge[];
  cohorts: Record<string, CohortEntry>;
};

// The non-PII aggregate snapshot — exactly what the Edge Function persists and
// the SPA reads. No member rows, names, IDs, exact dates, or dues.
export type RetentionAggregate = {
  source: 'wodify';
  asOf: string; // YYYY-MM-DD — our day-diff anchor (server fetch date)
  fetchedAt: string; // ISO timestamp of the fetch
  activeTotal: number;
  // Member Movement census (§6, BINARY rescope 2026-06-10): the inactive
  // head-count alongside activeTotal. Non-PII raw status tally. Binary because
  // that is what Wodify /clients actually supports — the vocab gate proved
  // client_status is exactly Active/Inactive, and the field-discovery probe
  // (scripts/wodify/clientsMembershipStateDiscovery.ts) proved NO other /clients
  // field separates paused from ended, so a paused/ended census is unsourceable.
  // The three-way partition
  //   activeTotal + inactiveTotal + dataQuality.unknownStatus
  //     === dataQuality.clientsScanned
  // holds by construction — every scanned row increments exactly one of the three.
  inactiveTotal: number;
  daysAbsentHistogram: DaysAbsentHistogram;
  // Churn-by-Tenure (§6 aggregate extension): the per-band partition of
  // daysAbsentHistogram + unknown, over the SAME active members. ACTIVE-ONLY by
  // design — inactive members are the census, not a tenure cohort.
  tenureBandHistogram: TenureBandHistogram;
  // Cohort Retention (Read 1 + Read 2): the per-age-cohort partition — active-side
  // recency histogram + lapsed head-count, over all scanned members. Derived from
  // date_of_birth, which never leaves the normalize step. Counts only.
  cohortHistogram: CohortHistogram;
  unknown: number; // active, missing/sentinel/invalid lastCheckIn (NOT Healthy)
  silentChurn: { monthlyDuesAtRisk: null; missingMonthlyDues: true };
  diagnostics: { wodifyAtRiskCount: number };
  dataQuality: {
    unknownStatus: number;
    futureLastCheckIn: number;
    pagesFetched: number;
    reachedPageCap: boolean; // MAX_PAGES hit while Wodify still reported has_more (snapshot may be partial)
    clientsScanned: number;
  };
};

export type AggregateOptions = {
  asOf: string; // YYYY-MM-DD (server fetch date / today)
  fetchedAt: string; // ISO timestamp
  pagesFetched: number;
  // true when the fetcher stopped at the page cap with more pages still available
  // (no silent truncation — surfaced so a partial snapshot is never mistaken for complete).
  reachedPageCap: boolean;
};

// Map raw `client_status` to our status (§6.2, fail-closed taxonomy; BINARY
// rescope 2026-06-10). Matching is the PROVEN vocabulary only — the 2026-06-09
// vocab gate found `client_status` is exactly Active/Inactive across the full
// 957-record set, and the 2026-06-10 field-discovery probe confirmed no other
// /clients field subdivides Inactive:
//   - exact `active` (case-insensitive)   → active
//   - exact `inactive` (case-insensitive) → inactive
// Everything else is null: a PRESENT-but-unrecognized status (e.g. Trial,
// Prospect, "Active - Comp", and the formerly-mapped Paused/Frozen/On Hold/
// Ended/Cancelled words — none of which Wodify actually returns) and a MISSING /
// non-string / empty value BOTH map to null (excluded from every bucket, counted
// in unknownStatus). Never bucket unproven statuses. Only active-ness is
// load-bearing for the Attendance Health / Silent Churn slice, and `^active$` is
// deliberately NOT broadened: an active variant fails closed to unknown rather
// than being guessed active. `^inactive$` is anchored the same way so a variant
// like "Inactive - Archived" surfaces in unknownStatus instead of being guessed.
export function normalizeStatus(raw: unknown): NormalizedStatus | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (s === '') return null;
  if (/^active$/i.test(s)) return 'active';
  if (/^inactive$/i.test(s)) return 'inactive';
  return null;
}

// Reduce one raw date field to a usable 'YYYY-MM-DD' or null, in the locked
// order (§6.2): (a) slice the leading YYYY-MM-DD off the ISO timestamp; (b) the
// 1900-01-01 sentinel → null; (c) anything parseYmdLocal rejects → null. Using
// parseYmdLocal as the validator (not a stricter regex) keeps the server's
// notion of "valid date" byte-identical to the SPA classifier's — one
// definition, no drift.
export function sliceUsableDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  if (!match) return null;
  const ymd = match[1];
  if (ymd === SENTINEL_NULL_DATE) return null;
  if (parseYmdLocal(ymd) === null) return null;
  return ymd;
}

// lastCheckIn = the most-recent usable of `last_attendance` and
// `last_class_sign_in` (both primary, §6.2), or '' when neither is usable. For
// 'YYYY-MM-DD' strings lexical order IS chronological order, so a string max is
// the latest date.
export function pickLastCheckIn(
  lastAttendance: unknown,
  lastClassSignIn: unknown,
): string {
  const usable = [
    sliceUsableDate(lastAttendance),
    sliceUsableDate(lastClassSignIn),
  ].filter((d): d is string => d !== null);
  if (usable.length === 0) return '';
  return usable.reduce((max, d) => (d > max ? d : max));
}

// Normalize one raw `/clients` row to the transient non-PII shape. `is_at_risk`
// is captured as a diagnostic only (Wodify's own flag), never used to classify.
// `member_since` goes through the SAME sliceUsableDate rule as the recency
// dates (ISO slice → 1900-01-01 sentinel → parseYmdLocal), so the wire-level
// sentinel can never reach the tenure math as a real ~46-year tenure.
export function normalizeClient(raw: RawWodifyClient): NormalizedMember {
  return {
    status: normalizeStatus(raw.client_status),
    lastCheckIn: pickLastCheckIn(raw.last_attendance, raw.last_class_sign_in),
    membershipStart: sliceUsableDate(raw.member_since) ?? '',
    // Same sliceUsableDate rule as the recency/tenure dates (ISO slice →
    // 1900-01-01 sentinel → parseYmdLocal), so a wire sentinel can never reach the
    // age math as a real ~126-year-old.
    dob: sliceUsableDate(raw.date_of_birth) ?? '',
    isAtRisk: raw.is_at_risk === true,
  };
}

// Build the non-PII aggregate from raw `/clients` rows (§6.6). Normalizes each
// row in memory, then bins ACTIVE members by exact days absent against `asOf`.
// Conservation holds by construction:
//   activeTotal === sum(countsByDaysAbsent) + overflow365Plus + unknown
// `futureLastCheckIn` (lastCheckIn after asOf → negative daysAbsent) is binned at
// day 0 to preserve classifyMember's "negative → Healthy by fallthrough"
// behavior, AND counted as a diagnostic; it is NOT a separate bucket, so it does
// not affect the conservation sum.
export function computeRetentionAggregate(
  rawRows: RawWodifyClient[],
  opts: AggregateOptions,
): RetentionAggregate {
  const asOfDate = parseYmdLocal(opts.asOf);
  if (asOfDate === null) {
    // asOf is server-controlled (today). A bad value is a programming error, not
    // member data — throw without echoing any row.
    throw new Error('computeRetentionAggregate: asOf must be YYYY-MM-DD');
  }

  const countsByDaysAbsent: Record<string, number> = {};
  let overflow365Plus = 0;
  let activeTotal = 0;
  let inactiveTotal = 0;
  let unknown = 0;
  let unknownStatus = 0;
  let futureLastCheckIn = 0;
  let wodifyAtRiskCount = 0;

  // Per-tenure-band recency accumulators (§6 aggregate extension). Every band id
  // plus the unknown-tenure bucket is present from the start, so empty bands emit
  // zero counts rather than vanishing from the payload.
  const tenureBands: Record<string, TenureBandRecency> = {};
  for (const band of TENURE_BANDS) {
    tenureBands[band.id] = { countsByDaysAbsent: {}, overflow365Plus: 0, unknownRecency: 0 };
  }
  tenureBands[UNKNOWN_TENURE_ID] = { countsByDaysAbsent: {}, overflow365Plus: 0, unknownRecency: 0 };

  // Per-cohort accumulators (Cohort Retention Card). Every cohort id plus the
  // unknown-cohort bucket is present from the start, so empty cohorts emit zero
  // counts. `active` mirrors the recency split (Read 1); `lapsed` tallies inactive
  // members (Read 2). Both derive from date_of_birth in the SAME pass, so the
  // active partition (Σ active === activeTotal) and Member Movement parity
  // (Σ lapsed === inactiveTotal) hold by construction.
  const cohorts: Record<string, CohortEntry> = {};
  for (const band of COHORT_BANDS) {
    cohorts[band.id] = {
      active: { countsByDaysAbsent: {}, overflow365Plus: 0, unknownRecency: 0 },
      lapsed: 0,
    };
  }
  cohorts[UNKNOWN_COHORT_ID] = {
    active: { countsByDaysAbsent: {}, overflow365Plus: 0, unknownRecency: 0 },
    lapsed: 0,
  };

  for (const raw of rawRows) {
    const member = normalizeClient(raw);

    if (member.isAtRisk) wodifyAtRiskCount += 1;

    if (member.status === null) {
      unknownStatus += 1;
      continue; // unmappable status — excluded from every bucket
    }

    // Resolve the age cohort ONCE, used by both the lapsed tally (inactive) and
    // the active recency mirror below. A missing/sentinel/invalid dob, or a
    // derived age outside every band window (<= 0 or > 120), routes to the
    // unknown-cohort bucket — counted, never dropped (mirrors the unknown-tenure
    // routing). Exact age is a loop local; only cohort-id counts are emitted.
    const age = member.dob === '' ? null : ageYearsAsOf(member.dob, opts.asOf);
    const cohortBand = age === null ? null : cohortForAge(age);
    const cohortEntry = cohorts[cohortBand ? cohortBand.id : UNKNOWN_COHORT_ID];

    // Inactive is not the active recency signal, but it IS the Member Movement
    // census AND the cohort lapsed count (Read 2) — count both, then skip the
    // active-only binning below. Σ cohort lapsed === inactiveTotal by construction.
    if (member.status === 'inactive') {
      inactiveTotal += 1;
      cohortEntry.lapsed += 1;
      continue;
    }
    // member.status === 'active' from here.
    activeTotal += 1;

    // Resolve the tenure band before the recency split, so EVERY recency
    // increment below mirrors into exactly one band — the per-band histograms
    // partition the global one by construction. No usable member_since, or a
    // start after asOf (negative tenure, bandForTenure → null), routes to the
    // unknown-tenure bucket (#439) — counted, never dropped.
    const startDate = member.membershipStart === '' ? null : parseYmdLocal(member.membershipStart);
    const tenureBand = startDate === null ? null : bandForTenure(wholeDaysBetween(startDate, asOfDate));
    const bandRecency = tenureBands[tenureBand ? tenureBand.id : UNKNOWN_TENURE_ID];

    // Every active recency increment mirrors into exactly one tenure band AND one
    // cohort, so both per-band and per-cohort active histograms partition the
    // global one by construction.
    const cohortRecency = cohortEntry.active;

    if (member.lastCheckIn === '') {
      unknown += 1; // active but no usable date — NEVER folded into Healthy
      bandRecency.unknownRecency += 1;
      cohortRecency.unknownRecency += 1;
      continue;
    }
    const lastCheckInDate = parseYmdLocal(member.lastCheckIn);
    if (lastCheckInDate === null) {
      unknown += 1; // defensive: sliceUsableDate already validated, but never drop a member
      bandRecency.unknownRecency += 1;
      cohortRecency.unknownRecency += 1;
      continue;
    }

    const daysAbsent = wholeDaysBetween(lastCheckInDate, asOfDate);
    if (daysAbsent < 0) {
      futureLastCheckIn += 1;
      countsByDaysAbsent['0'] = (countsByDaysAbsent['0'] ?? 0) + 1; // day-0 = Healthy-compatible
      bandRecency.countsByDaysAbsent['0'] = (bandRecency.countsByDaysAbsent['0'] ?? 0) + 1;
      cohortRecency.countsByDaysAbsent['0'] = (cohortRecency.countsByDaysAbsent['0'] ?? 0) + 1;
    } else if (daysAbsent <= MAX_EXACT_DAYS) {
      const key = String(daysAbsent);
      countsByDaysAbsent[key] = (countsByDaysAbsent[key] ?? 0) + 1;
      bandRecency.countsByDaysAbsent[key] = (bandRecency.countsByDaysAbsent[key] ?? 0) + 1;
      cohortRecency.countsByDaysAbsent[key] = (cohortRecency.countsByDaysAbsent[key] ?? 0) + 1;
    } else {
      overflow365Plus += 1;
      bandRecency.overflow365Plus += 1;
      cohortRecency.overflow365Plus += 1;
    }
  }

  return {
    source: 'wodify',
    asOf: opts.asOf,
    fetchedAt: opts.fetchedAt,
    activeTotal,
    inactiveTotal,
    daysAbsentHistogram: {
      maxExactDays: MAX_EXACT_DAYS,
      countsByDaysAbsent,
      overflow365Plus,
    },
    tenureBandHistogram: {
      bandEdges: TENURE_BANDS.map(({ id, minDays }) => ({ id, minDays })),
      bands: tenureBands,
    },
    cohortHistogram: {
      cohortEdges: COHORT_BANDS.map(({ id, minAge, maxAge }) => ({ id, minAge, maxAge })),
      cohorts,
    },
    unknown,
    silentChurn: { monthlyDuesAtRisk: null, missingMonthlyDues: true },
    diagnostics: { wodifyAtRiskCount },
    dataQuality: {
      unknownStatus,
      futureLastCheckIn,
      pagesFetched: opts.pagesFetched,
      reachedPageCap: opts.reachedPageCap,
      clientsScanned: rawRows.length,
    },
  };
}

// Per-band active totals (counts only) — each band's bin sum + overflow +
// unknownRecency. Used by the Edge Function's counts-only 200 summary so a
// post-pull verify can eyeball the band split without reading the table; also
// the per-band denominator the SPA's risk rate divides by.
export function tenureBandActiveTotals(
  tenure: TenureBandHistogram,
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const [id, band] of Object.entries(tenure.bands)) {
    const binSum = Object.values(band.countsByDaysAbsent).reduce((a, b) => a + b, 0);
    totals[id] = binSum + band.overflow365Plus + band.unknownRecency;
  }
  return totals;
}

// Per-cohort ACTIVE totals (counts only) — each cohort's active bin sum +
// overflow + unknownRecency. Used by the Edge Function's 200 summary so a
// post-pull verify can eyeball the cohort split without reading the table; Σ over
// all cohorts === activeTotal.
export function cohortActiveTotals(cohort: CohortHistogram): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const [id, entry] of Object.entries(cohort.cohorts)) {
    const binSum = Object.values(entry.active.countsByDaysAbsent).reduce((a, b) => a + b, 0);
    totals[id] = binSum + entry.active.overflow365Plus + entry.active.unknownRecency;
  }
  return totals;
}

// Per-cohort LAPSED totals (Read 2) — the inactive head-count per cohort. Σ over
// all cohorts (incl. unknownCohort) === inactiveTotal by construction (Member
// Movement parity), so the 200 summary lets a post-pull verify confirm parity
// without reading the table.
export function cohortLapsedTotals(cohort: CohortHistogram): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const [id, entry] of Object.entries(cohort.cohorts)) {
    totals[id] = entry.lapsed;
  }
  return totals;
}
