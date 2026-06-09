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
};

export type NormalizedStatus = 'active' | 'paused' | 'ended';

// Internal, transient, non-PII normalized member. `status: null` means the raw
// status was missing OR present-but-unrecognized (either way unmappable —
// excluded from every census bucket, counted in `unknownStatus`).
// `lastCheckIn: ''` means active-but-no-usable-date (→ unknown bucket, never
// silently Healthy).
export type NormalizedMember = {
  status: NormalizedStatus | null;
  lastCheckIn: string; // 'YYYY-MM-DD' or ''
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

// The non-PII aggregate snapshot — exactly what the Edge Function persists and
// the SPA reads. No member rows, names, IDs, exact dates, or dues.
export type RetentionAggregate = {
  source: 'wodify';
  asOf: string; // YYYY-MM-DD — our day-diff anchor (server fetch date)
  fetchedAt: string; // ISO timestamp of the fetch
  activeTotal: number;
  // Member Movement census (§6): paused/ended head-counts alongside activeTotal.
  // Non-PII raw status tallies. The four-way partition
  //   activeTotal + pausedTotal + endedTotal + dataQuality.unknownStatus
  //     === dataQuality.clientsScanned
  // holds by construction — every scanned row increments exactly one of the four.
  pausedTotal: number;
  endedTotal: number;
  daysAbsentHistogram: DaysAbsentHistogram;
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

// Map raw `client_status` to our status (§6.2, fail-closed taxonomy). Matching is
// CONSERVATIVE — only recognized values map into a census bucket:
//   - exact `active` (case-insensitive)             → active
//   - known paused-like (paus / frozen / hold)      → paused
//   - explicit, ANCHORED ended values (Ended /      → ended
//     Cancelled) — anchored so a substring like
//     "Susp-ended" can never match as ended
// Everything else is null: a PRESENT-but-unrecognized status (e.g. Trial,
// Prospect, "Active - Comp") and a MISSING / non-string / empty value BOTH map to
// null (excluded from every bucket, counted in unknownStatus). The earlier
// catch-all routed the unrecognized tail to 'ended', silently inflating the ended
// census with members we simply don't map yet — unknown now stays unknown. Only
// active-ness is load-bearing for the Attendance Health / Silent Churn slice, and
// `^active$` is deliberately NOT broadened: an active variant fails closed to
// unknown rather than being guessed active.
export function normalizeStatus(raw: unknown): NormalizedStatus | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (s === '') return null;
  if (/^active$/i.test(s)) return 'active';
  if (/paus|frozen|hold/i.test(s)) return 'paused';
  if (/^(ended|cancelled)$/i.test(s)) return 'ended';
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
export function normalizeClient(raw: RawWodifyClient): NormalizedMember {
  return {
    status: normalizeStatus(raw.client_status),
    lastCheckIn: pickLastCheckIn(raw.last_attendance, raw.last_class_sign_in),
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
  let pausedTotal = 0;
  let endedTotal = 0;
  let unknown = 0;
  let unknownStatus = 0;
  let futureLastCheckIn = 0;
  let wodifyAtRiskCount = 0;

  for (const raw of rawRows) {
    const member = normalizeClient(raw);

    if (member.isAtRisk) wodifyAtRiskCount += 1;

    if (member.status === null) {
      unknownStatus += 1;
      continue; // unmappable status — excluded from every bucket
    }
    // Paused / ended are not the active recency signal, but they ARE the Member
    // Movement census — count each, then skip the active-only binning below.
    if (member.status === 'paused') {
      pausedTotal += 1;
      continue;
    }
    if (member.status === 'ended') {
      endedTotal += 1;
      continue;
    }
    // member.status === 'active' from here.
    activeTotal += 1;

    if (member.lastCheckIn === '') {
      unknown += 1; // active but no usable date — NEVER folded into Healthy
      continue;
    }
    const lastCheckInDate = parseYmdLocal(member.lastCheckIn);
    if (lastCheckInDate === null) {
      unknown += 1; // defensive: sliceUsableDate already validated, but never drop a member
      continue;
    }

    const daysAbsent = wholeDaysBetween(lastCheckInDate, asOfDate);
    if (daysAbsent < 0) {
      futureLastCheckIn += 1;
      countsByDaysAbsent['0'] = (countsByDaysAbsent['0'] ?? 0) + 1; // day-0 = Healthy-compatible
    } else if (daysAbsent <= MAX_EXACT_DAYS) {
      const key = String(daysAbsent);
      countsByDaysAbsent[key] = (countsByDaysAbsent[key] ?? 0) + 1;
    } else {
      overflow365Plus += 1;
    }
  }

  return {
    source: 'wodify',
    asOf: opts.asOf,
    fetchedAt: opts.fetchedAt,
    activeTotal,
    pausedTotal,
    endedTotal,
    daysAbsentHistogram: {
      maxExactDays: MAX_EXACT_DAYS,
      countsByDaysAbsent,
      overflow365Plus,
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
