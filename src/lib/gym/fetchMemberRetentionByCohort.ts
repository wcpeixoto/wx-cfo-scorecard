// Live fetch for the "Member Retention by Cohort" monthly aggregate — the age-segment partition of
// Class Plan Member Retention (Youth / Adults 16+ / Unknown). Mirrors fetchMemberRetentionRates'
// raw-REST transport (no SDK), reading the anon-readable, non-PII `member_retention_by_cohort`
// table. Returns the FULL series across periods and bands, ordered by period.
//
// This is a DIFFERENT table from member_retention_rates (#495): that one holds the gym-wide All
// line; this one holds the per-cohort counts. The card keeps the All line sourced from #495 and
// only OVERLAYS the cohort lines from here — the cohort rows are never summed to derive All
// (suppression would break the sum).
//
// Suppression is preserved, never coerced to 0: a suppressed row carries all three counts as null
// (the table CHECK guarantees suppressed ⇔ all-3-null). The overlay renders those as line GAPS.
//
// Graceful degradation: unconfigured env, an unreachable host, a non-OK response (table not yet
// created/seeded), or an empty/garbled body all resolve to `null` so the card simply omits the
// overlay. Like fetchMemberRetentionRates this never throws.

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
const RETENTION_BY_COHORT_TABLE = 'member_retention_by_cohort';
const WORKSPACE_ID = 'default'; // single gym → one workspace; matches the anon RLS read policy.

export type CohortRetentionRow = {
  periodMonth: string; // 'YYYY-MM'
  cohortBand: string; // 'youth3to15' | 'adults16plus' | 'unknownCohort'
  newMembers: number | null; // null ⇔ suppressed
  returningMembers: number | null; // null ⇔ suppressed
  lostMembers: number | null; // null ⇔ suppressed
  suppressed: boolean;
};

export function isMemberRetentionByCohortConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

type Row = Record<string, unknown>;

function asIntOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function toCohortRow(row: Row): CohortRetentionRow | null {
  const periodMonth = typeof row.period_month === 'string' ? row.period_month : null;
  if (!periodMonth || !/^\d{4}-\d{2}$/.test(periodMonth)) return null;
  const cohortBand = typeof row.cohort_band === 'string' ? row.cohort_band : null;
  if (!cohortBand) return null;
  // Suppressed rows arrive with null counts; never coerce a suppressed measure to 0.
  const suppressed = row.suppressed === true;
  return {
    periodMonth,
    cohortBand,
    newMembers: asIntOrNull(row.new_members),
    returningMembers: asIntOrNull(row.returning_members),
    lostMembers: asIntOrNull(row.lost_members),
    suppressed,
  };
}

export async function fetchMemberRetentionByCohort(
  signal?: AbortSignal,
): Promise<CohortRetentionRow[] | null> {
  if (!isMemberRetentionByCohortConfigured()) return null;

  const path =
    `${RETENTION_BY_COHORT_TABLE}` +
    `?select=*` +
    `&workspace_id=eq.${WORKSPACE_ID}` +
    `&order=period_month.asc`;

  let response: Response;
  try {
    response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Accept: 'application/json',
      },
      signal,
    });
  } catch {
    return null; // unreachable / aborted → no overlay
  }

  if (!response.ok) return null; // table absent or not yet seeded → no overlay (no throw)

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  if (!Array.isArray(body) || body.length === 0) return null;

  const rows = body
    .map((r) => toCohortRow(r as Row))
    .filter((r): r is CohortRetentionRow => r !== null);
  return rows.length > 0 ? rows : null;
}
