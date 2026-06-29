// Live fetch for the "Churn by Belt" monthly aggregate — Class-Plan MEMBERSHIP retention partitioned
// by BELT BAND within an age segment (Adults / Kids), plus an Unknown segment for members whose belt
// could not be determined. Mirrors fetchMemberRetentionByCohort's raw-REST transport (no SDK), reading
// the anon-readable, non-PII `member_retention_by_belt` table (Phase A data layer). Returns the FULL
// series across periods, segments and bands, ordered by period.
//
// Aggregate-only: every column is a period label, a segment/belt-band LABEL, a count, or a timestamp.
// There are NO member names / Client IDs / DOBs / individual records here — the PII join (names + the
// Report-69 name bridge + dated belt history) happens build-side and never leaves the local step.
//
// Unlike member_retention_by_cohort there is NO suppression column: the owner-dashboard policy
// (#500/#501) publishes the small band counts as-is; churn's monthly noisiness is smoothed at the SPA
// layer (trailing-3-month rate), never by masking. An ABSENT (period, segment, band) cell is still a
// line GAP — never coerced to 0.
//
// Graceful degradation: unconfigured env, an unreachable host, a non-OK response (table not yet
// created/seeded), or an empty/garbled body all resolve to `null` so the card falls back to its sample
// fixture. Like the sibling fetchers this never throws.

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
const RETENTION_BY_BELT_TABLE = 'member_retention_by_belt';
const WORKSPACE_ID = 'default'; // single gym → one workspace; matches the anon RLS read policy.

export type BeltRetentionRow = {
  periodMonth: string; // 'YYYY-MM'
  segment: string; // 'adults' | 'kids' | 'unknown'
  beltBand: string; // belt-color band within the segment (e.g. 'White', 'Brown+Black')
  activeCount: number; // active-panel members for this (period, segment, band); always a real, non-null count
  lostCount: number; // members lost for this (period, segment, band); always a real, non-null count
};

export function isMemberRetentionByBeltConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

type Row = Record<string, unknown>;

function asIntOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function toBeltRow(row: Row): BeltRetentionRow | null {
  const periodMonth = typeof row.period_month === 'string' ? row.period_month : null;
  if (!periodMonth || !/^\d{4}-\d{2}$/.test(periodMonth)) return null;
  const segment = typeof row.segment === 'string' ? row.segment : null;
  if (!segment) return null;
  const beltBand = typeof row.belt_band === 'string' ? row.belt_band : null;
  if (!beltBand) return null;
  // Counts are non-null by the table CHECK; a garbled cell drops the row rather than guessing a 0.
  const activeCount = asIntOrNull(row.active_count);
  const lostCount = asIntOrNull(row.lost_count);
  if (activeCount === null || lostCount === null) return null;
  return { periodMonth, segment, beltBand, activeCount, lostCount };
}

export async function fetchMemberRetentionByBelt(
  signal?: AbortSignal,
): Promise<BeltRetentionRow[] | null> {
  if (!isMemberRetentionByBeltConfigured()) return null;

  const path =
    `${RETENTION_BY_BELT_TABLE}` +
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
    return null; // unreachable / aborted → sample fixture
  }

  if (!response.ok) return null; // table absent or not yet seeded → sample fixture (no throw)

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  if (!Array.isArray(body) || body.length === 0) return null;

  const rows = body
    .map((r) => toBeltRow(r as Row))
    .filter((r): r is BeltRetentionRow => r !== null);
  return rows.length > 0 ? rows : null;
}
