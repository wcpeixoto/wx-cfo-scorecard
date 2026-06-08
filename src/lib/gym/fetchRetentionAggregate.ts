// Live retention aggregate reader (RETENTION_FINISH_PLAN.md §6, PR2 / SPA wiring).
//
// A thin, self-contained anon-key REST read of the latest `wodify_retention_aggregate`
// snapshot. Deliberately NOT routed through sharedPersistence.ts (locked) — it only
// mirrors that module's env + header conventions. The row is non-PII by construction
// (counts + a snapshot date only; the member-PII anon-key blocker is satisfied by the
// table's shape, see supabase/wodify_retention_schema.sql), so reading it with the
// public anon key is safe.
//
// Row contract (supabase/wodify_retention_schema.sql + the Edge Function writer):
//   - columns are snake_case: as_of, active_total, unknown_count, days_absent_histogram
//   - days_absent_histogram is jsonb whose INNER keys are camelCase
//     ({ countsByDaysAbsent, overflow365Plus, maxExactDays }) — it persists the
//     server's daysAbsentHistogram object verbatim.
//   - anon SELECT is granted and the RLS read policy is scoped to workspace_id='default',
//     so we filter to the same workspace and never need the authenticated role.

import type { DerivableAggregate } from './retentionAggregateView';

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
const RETENTION_TABLE = 'wodify_retention_aggregate';
// Hard-coded to match the anon RLS read policy (using workspace_id = 'default'); the
// anon key can only read this workspace, so there is nothing else to read.
const WORKSPACE_ID = 'default';

// The non-PII slice of the snapshot the Attendance Health live path needs: the
// derivable counts plus the snapshot date for the "Live · as of {asOf}" badge.
export type RetentionAggregateSnapshot = DerivableAggregate & {
  asOf: string; // YYYY-MM-DD — the snapshot's gym-local day
  activeTotal: number; // active members scanned this snapshot (server's own total)
};

// Loosely-typed shape of the REST row — every field is validated before use, since
// the histogram is jsonb and could in principle be malformed.
type AggregateRow = {
  as_of?: unknown;
  active_total?: unknown;
  unknown_count?: unknown;
  days_absent_histogram?: unknown;
};

// True only when the SPA build carries Supabase env. When false (e.g. local dev with
// no .env), the caller falls back to the sample fixture — not an error.
export function isRetentionAggregateConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// Fetch the latest snapshot (highest as_of) for the default workspace, or null when
// unconfigured / no row / malformed. Throws only on a non-OK HTTP status, so the
// caller can distinguish "no data yet" (null → sample) from "read failed" (throw →
// sample). Read-only: a single GET against the Data API, anon role, no writes.
export async function fetchLatestRetentionAggregate(
  signal?: AbortSignal,
): Promise<RetentionAggregateSnapshot | null> {
  if (!isRetentionAggregateConfigured()) return null;

  const path =
    `${RETENTION_TABLE}` +
    `?select=as_of,active_total,unknown_count,days_absent_histogram` +
    `&workspace_id=eq.${WORKSPACE_ID}` +
    `&order=as_of.desc&limit=1`;

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Accept: 'application/json',
    },
    signal,
  });
  if (!response.ok) throw new Error(`retention_aggregate_http_${response.status}`);

  const rows = (await response.json()) as unknown;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const row = rows[0] as AggregateRow;

  // The badge reads "Live · as of {asOf}", so a snapshot with no real date is not a
  // usable live snapshot (→ null → sample fallback). as_of is `date NOT NULL`, so this
  // only guards a malformed payload.
  const asOf = typeof row.as_of === 'string' ? row.as_of : '';
  if (!asOf) return null;

  // Validate the jsonb histogram before trusting it; a malformed/absent histogram is
  // "no usable snapshot" (→ null → sample fallback), never a render crash.
  const hist = row.days_absent_histogram;
  if (
    !hist ||
    typeof hist !== 'object' ||
    typeof (hist as { countsByDaysAbsent?: unknown }).countsByDaysAbsent !== 'object' ||
    (hist as { countsByDaysAbsent?: unknown }).countsByDaysAbsent === null
  ) {
    return null;
  }
  const histogram = hist as {
    countsByDaysAbsent: Record<string, unknown>;
    overflow365Plus?: unknown;
  };

  // Coerce the sparse bin counts defensively (jsonb values are untyped here).
  const countsByDaysAbsent: Record<string, number> = {};
  for (const [k, v] of Object.entries(histogram.countsByDaysAbsent)) {
    countsByDaysAbsent[k] = asCount(v);
  }

  return {
    asOf,
    activeTotal: asCount(row.active_total),
    unknown: asCount(row.unknown_count),
    daysAbsentHistogram: {
      countsByDaysAbsent,
      overflow365Plus: asCount(histogram.overflow365Plus),
    },
  };
}
