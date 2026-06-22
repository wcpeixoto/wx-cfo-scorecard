// Live fetch for the "Member Retention Rates" monthly aggregate — mirrors fetchRetentionAggregate's
// raw-REST transport (no SDK), reading the anon-readable, non-PII Supabase table. Returns the FULL
// monthly series (the chart is a time-series, not a latest-snapshot), ordered by period.
//
// Graceful degradation: unconfigured env, an unreachable host, a non-OK response (the table not yet
// created/seeded), or an empty/garbled body all resolve to `null` so the card falls back to the
// sample fixture. Unlike fetchRetentionAggregate this never throws — a not-yet-seeded table is an
// expected pre-migration state, not an error.

import type { RetentionMonth } from './memberRetentionSeries';

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
const RETENTION_RATES_TABLE = 'member_retention_rates';
const WORKSPACE_ID = 'default'; // single gym → one workspace; matches the anon RLS read policy.

export function isMemberRetentionRatesConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

type Row = Record<string, unknown>;

function asFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function toRetentionMonth(row: Row): RetentionMonth | null {
  const periodMonth = typeof row.period_month === 'string' ? row.period_month : null;
  if (!periodMonth || !/^\d{4}-\d{2}$/.test(periodMonth)) return null;
  const current = asFiniteNumber(row.current_members);
  const prior = asFiniteNumber(row.prior_members);
  const lost = asFiniteNumber(row.lost_members);
  const gained = asFiniteNumber(row.new_members);
  const returning = asFiniteNumber(row.returning_members);
  const rate = asFiniteNumber(row.retention_rate);
  if (current === null || prior === null || lost === null || gained === null || returning === null || rate === null) {
    return null;
  }
  return {
    periodMonth,
    currentMembers: current,
    priorMembers: prior,
    lostMembers: lost,
    newMembers: gained,
    returningMembers: returning,
    retentionRate: rate,
    isSeedBoundary: row.is_seed_boundary === true,
  };
}

export async function fetchMemberRetentionRates(signal?: AbortSignal): Promise<RetentionMonth[] | null> {
  if (!isMemberRetentionRatesConfigured()) return null;

  const path =
    `${RETENTION_RATES_TABLE}` +
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
    return null; // unreachable / aborted → sample
  }

  if (!response.ok) return null; // table absent or not yet seeded → sample (no throw)

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return null;
  }
  if (!Array.isArray(body) || body.length === 0) return null;

  const months = body
    .map((r) => toRetentionMonth(r as Row))
    .filter((r): r is RetentionMonth => r !== null);
  return months.length > 0 ? months : null;
}
