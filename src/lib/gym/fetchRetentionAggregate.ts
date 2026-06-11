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
//   - inactive_total (Member Movement census, §6 — BINARY rescope: Wodify /clients
//     supports Active/Inactive only) is NULLABLE and may be absent entirely on a table
//     where the census migration hasn't been applied yet — handled as null → the SPA
//     renders the sample census (see the select=* note below). unknown_status is a
//     NOT NULL data-quality counter present since the original table.
//   - anon SELECT is granted and the RLS read policy is scoped to workspace_id='default',
//     so we filter to the same workspace and never need the authenticated role.

import type { DerivableAggregate } from './retentionAggregateView';
import { TENURE_BANDS, UNKNOWN_TENURE_ID } from './tenureBands';
import type {
  TenureBandHistogram,
  TenureBandRecency,
} from './wodifyRetentionAggregate';

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
  // Member Movement census (binary — Active/Inactive is all /clients supports).
  // `number | null`: null when the column is absent (a snapshot from before the §6
  // census slice) or unwritten, so the SPA falls back to the sample census. A real 0
  // is a live zero, NOT null.
  inactiveTotal: number | null;
  // Rows whose client_status was present-but-unrecognized or missing — excluded from
  // both census buckets by the fail-closed normalizeStatus. Surfaced on the card when
  // nonzero (honesty parity with Attendance Health's Unknown). NOT NULL default 0 on
  // the live table, so a missing/malformed value coerces to 0, never to a gate.
  unknownStatus: number;
  // Churn-by-Tenure (§6 aggregate extension): the per-tenure-band partition of the
  // recency histogram. `null` when the column is absent (pre-tenure snapshot), SQL
  // null, malformed, or binned under DIFFERENT band edges than this build's
  // TENURE_BANDS (exact id/minDays/order match required) — the Tenure card then
  // falls back to its sample fixture. PER-FIELD degradation on purpose: a bad
  // tenure payload never nulls the whole snapshot (AH / SC / MM keep their live
  // data), mirroring the inactiveTotal rule.
  tenureBands: TenureBandHistogram | null;
};

// Loosely-typed shape of the REST row — every field is validated before use, since
// the histogram is jsonb and could in principle be malformed.
type AggregateRow = {
  as_of?: unknown;
  active_total?: unknown;
  inactive_total?: unknown;
  unknown_status?: unknown;
  unknown_count?: unknown;
  days_absent_histogram?: unknown;
  tenure_band_histogram?: unknown;
};

// True only when the SPA build carries Supabase env. When false (e.g. local dev with
// no .env), the caller falls back to the sample fixture — not an error.
export function isRetentionAggregateConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// Census counts are `number | null`: a finite number passes through (a real 0 is a
// live zero), while anything else — an absent column, null, or a malformed value —
// becomes null so the SPA falls back to the sample census instead of rendering a
// fabricated 0 off a pre-census row.
function asCountOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// Coerce one tenure band's jsonb entry, or null when structurally unusable.
function parseTenureBandRecency(value: unknown): TenureBandRecency | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as {
    countsByDaysAbsent?: unknown;
    overflow365Plus?: unknown;
    unknownRecency?: unknown;
  };
  if (!entry.countsByDaysAbsent || typeof entry.countsByDaysAbsent !== 'object') return null;
  const countsByDaysAbsent: Record<string, number> = {};
  for (const [k, v] of Object.entries(entry.countsByDaysAbsent as Record<string, unknown>)) {
    countsByDaysAbsent[k] = asCount(v);
  }
  return {
    countsByDaysAbsent,
    overflow365Plus: asCount(entry.overflow365Plus),
    unknownRecency: asCount(entry.unknownRecency),
  };
}

// Validate the Churn-by-Tenure jsonb into the typed histogram, or null → the
// Tenure card falls back to sample. Two contract checks, both fail-closed:
//
// 1. bandEdges must EXACTLY equal this build's TENURE_BANDS — same length, same
//    order, same id, same minDays. A snapshot binned under different edges must
//    never render under this build's band labels (mislabeled cohorts are worse
//    than the sample badge).
// 2. Every expected band key (each TENURE_BANDS id + the unknown-tenure bucket)
//    must be present and well-formed. Unexpected EXTRA keys are ignored — any
//    semantic band change would also change bandEdges and fail check 1.
function parseTenureBandHistogram(value: unknown): TenureBandHistogram | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as { bandEdges?: unknown; bands?: unknown };

  if (!Array.isArray(v.bandEdges) || v.bandEdges.length !== TENURE_BANDS.length) return null;
  for (let i = 0; i < TENURE_BANDS.length; i++) {
    const edge = v.bandEdges[i] as { id?: unknown; minDays?: unknown } | null;
    if (!edge || typeof edge !== 'object') return null;
    if (edge.id !== TENURE_BANDS[i].id || edge.minDays !== TENURE_BANDS[i].minDays) return null;
  }

  if (!v.bands || typeof v.bands !== 'object') return null;
  const rawBands = v.bands as Record<string, unknown>;
  const bands: Record<string, TenureBandRecency> = {};
  for (const id of [...TENURE_BANDS.map((b) => b.id), UNKNOWN_TENURE_ID]) {
    const band = parseTenureBandRecency(rawBands[id]);
    if (band === null) return null;
    bands[id] = band;
  }

  // Rebuild bandEdges from this build's TENURE_BANDS (proven equal above) so no
  // unvalidated extra properties ride through from the wire.
  return {
    bandEdges: TENURE_BANDS.map(({ id, minDays }) => ({ id, minDays })),
    bands,
  };
}

// Fetch the latest snapshot (highest as_of) for the default workspace, or null when
// unconfigured / no row / malformed. Throws only on a non-OK HTTP status, so the
// caller can distinguish "no data yet" (null → sample) from "read failed" (throw →
// sample). Read-only: a single GET against the Data API, anon role, no writes.
export async function fetchLatestRetentionAggregate(
  signal?: AbortSignal,
): Promise<RetentionAggregateSnapshot | null> {
  if (!isRetentionAggregateConfigured()) return null;

  // select=* (not an explicit column list) on purpose: the Member Movement census
  // column (inactive_total) ships with the §6 census slice but its migration is
  // applied separately, so it may not exist on the live table yet.
  // PostgREST 400s the ENTIRE read when an explicit select names a column that does
  // not exist — which would knock the already-live Attendance Health + Silent Churn
  // cards back to Sample. `*` returns whatever columns exist (an absent census column
  // is simply undefined → null → sample), and is safe here because the table is
  // non-PII by construction: every column is a snapshot-level count or date (see
  // wodify_retention_schema.sql). Do NOT narrow this back to an explicit list while a
  // shipped-but-unapplied column exists.
  const path =
    `${RETENTION_TABLE}` +
    `?select=*` +
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
    inactiveTotal: asCountOrNull(row.inactive_total),
    unknownStatus: asCount(row.unknown_status),
    unknown: asCount(row.unknown_count),
    daysAbsentHistogram: {
      countsByDaysAbsent,
      overflow365Plus: asCount(histogram.overflow365Plus),
    },
    tenureBands: parseTenureBandHistogram(row.tenure_band_histogram),
  };
}
