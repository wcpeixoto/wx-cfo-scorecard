// Shared payload-building orchestration for the monthly source export.
//
// ONE path builds the payload; two callers use it:
//   - the manual "Export source JSON" button (ExportSourceJsonCard), which then Blobs the result
//   - automatic snapshot persistence (useScorecardSnapshotPersistence), which then upserts it
//
// Both therefore fetch the SAME four live retention sources and call the SAME pure builder, so the
// downloaded file and the stored row can never describe different data. The Blob/download side
// effect stays in the UI component — this module does network reads and nothing else.
//
// The four fetches are always re-run (never cached across calls) for the reason the manual path
// already documented: a mount-time probe goes stale after an in-session retention import, and a
// stale probe would silently ship yesterday's numbers. Each fetch fails soft to null, which the
// builder records as a missing domain rather than fabricating a value.

import { fetchMemberRetentionRates } from '../gym/fetchMemberRetentionRates';
import { fetchLatestRetentionAggregate } from '../gym/fetchRetentionAggregate';
import { fetchMemberRetentionByBelt, type BeltRetentionRow } from '../gym/fetchMemberRetentionByBelt';
import { fetchMemberRetentionByCohort, type CohortRetentionRow } from '../gym/fetchMemberRetentionByCohort';
import type { RetentionMonth } from '../gym/memberRetentionSeries';
import type { RetentionAggregateSnapshot } from '../gym/fetchRetentionAggregate';
import { buildMonthlySourceExport, type MonthlySourceExportInputs } from './buildMonthlySourceExport';

// Everything the payload needs that does NOT come from a live fetch or the clock: the 13
// Dashboard-supplied values plus the retention threshold from RetentionSettingsContext.
export type MonthlySourceExportSources = Omit<
  MonthlySourceExportInputs,
  'retentionRates' | 'snapshot' | 'beltRetention' | 'cohortRetention' | 'generatedAt'
>;

export type RetentionFetchResult = {
  rates: RetentionMonth[] | null;
  snapshot: RetentionAggregateSnapshot | null;
  belt: BeltRetentionRow[] | null;
  cohortRates: CohortRetentionRow[] | null;
};

// Injectable for tests; production passes nothing.
export type CollectDeps = {
  fetchRetention?: () => Promise<RetentionFetchResult>;
  now?: () => Date;
};

export async function fetchRetentionSources(): Promise<RetentionFetchResult> {
  const [rates, snapshot, belt, cohortRates] = await Promise.all([
    fetchMemberRetentionRates().catch(() => null),
    fetchLatestRetentionAggregate().catch(() => null),
    fetchMemberRetentionByBelt().catch(() => null),
    fetchMemberRetentionByCohort().catch(() => null),
  ]);
  return { rates, snapshot, belt, cohortRates };
}

export async function collectMonthlySourceExportPayload(
  sources: MonthlySourceExportSources,
  deps: CollectDeps = {},
): Promise<{ payload: Record<string, unknown>; retention: RetentionFetchResult }> {
  const retention = await (deps.fetchRetention ?? fetchRetentionSources)();
  const now = (deps.now ?? (() => new Date()))();
  const payload = buildMonthlySourceExport({
    ...sources,
    retentionRates: retention.rates,
    snapshot: retention.snapshot,
    beltRetention: retention.belt,
    cohortRetention: retention.cohortRates,
    generatedAt: now.toISOString(),
  });
  return { payload, retention };
}
