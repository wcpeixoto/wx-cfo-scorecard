// Live fetch for the Student movement card + export — mirrors fetchMemberRetentionRates' raw-REST
// transport (no SDK) against public.wodify_monthly_metrics, which the anon key may read only through
// the narrow RLS policy in supabase/migrations/20261024150000_wodify_monthly_metrics_anon_read.sql
// (four student-movement metrics, dimension 'all'). The request asks for exactly that slice and no
// run_id; the response is re-filtered here so a looser policy could never widen what the SPA uses.
//
// Three outcomes, kept distinct on purpose:
//   null  → could not read (unconfigured env, unreachable host, non-OK status — including the pre-migration
//           "permission denied" — or a garbled body). The card says it can't load; it never claims a month
//           is merely "not available yet" when the truth is "we couldn't ask".
//   []    → the read worked and there are no rows.
//   [...] → rows, ordered by month.
// Never throws.

import {
  STUDENT_MOVEMENT_METRIC_KEYS,
  type StudentMetricRow,
  type StudentMovementMetricKey,
} from './studentMovement';

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
const METRICS_TABLE = 'wodify_monthly_metrics';
const KEY_SET: ReadonlySet<string> = new Set(STUDENT_MOVEMENT_METRIC_KEYS);

export function isStudentMovementConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

type Row = Record<string, unknown>;

function asFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

// period_month arrives as a date ('2026-09-01') → 'YYYY-MM'. Only first-of-month dates are valid.
function toPeriodMonth(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4}-(0[1-9]|1[0-2]))-01$/.exec(v);
  return m ? m[1] : null;
}

// Pure row mapper — exported for tests. Drops anything that is not a gym-wide ('all') row of one of
// the four metrics, or that is missing a usable month / value / as_of.
export function parseStudentMetricRows(body: unknown): StudentMetricRow[] {
  if (!Array.isArray(body)) return [];
  const rows: StudentMetricRow[] = [];
  for (const raw of body as Row[]) {
    const periodMonth = toPeriodMonth(raw.period_month);
    const value = asFiniteNumber(raw.value);
    if (
      !periodMonth ||
      value === null ||
      raw.dimension !== 'all' ||
      typeof raw.metric_key !== 'string' ||
      !KEY_SET.has(raw.metric_key) ||
      typeof raw.as_of !== 'string' ||
      !Number.isFinite(Date.parse(raw.as_of))
    ) {
      continue;
    }
    rows.push({
      periodMonth,
      metricKey: raw.metric_key as StudentMovementMetricKey,
      value,
      asOf: raw.as_of,
      sourceAsOf: typeof raw.source_as_of === 'string' ? raw.source_as_of : null,
    });
  }
  return rows;
}

export async function fetchStudentMovementRows(signal?: AbortSignal): Promise<StudentMetricRow[] | null> {
  if (!isStudentMovementConfigured()) return null;

  const path =
    `${METRICS_TABLE}` +
    `?select=period_month,metric_key,dimension,value,as_of,source_as_of` +
    `&dimension=eq.all` +
    `&metric_key=in.(${STUDENT_MOVEMENT_METRIC_KEYS.join(',')})` +
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
    return null; // unreachable / aborted
  }

  if (!response.ok) return null; // no grant yet (pre-migration), table absent, or server error

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  if (!Array.isArray(body)) return null;

  return parseStudentMetricRows(body);
}
