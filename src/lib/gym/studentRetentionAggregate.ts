// Versioned, active-student-only counts. Shared by page collection, finalize and
// the browser so all three current views admit exactly the same contract.
import { computeRetentionAggregate, type RawWodifyClient, type DaysAbsentHistogram,
  type TenureBandHistogram, type TenureBandRecency, type CohortHistogram } from './wodifyRetentionAggregate.ts';
import { TENURE_BANDS, UNKNOWN_TENURE_ID } from './tenureBands.ts';
import { COHORT_BANDS, UNKNOWN_COHORT_ID } from './cohortBands.ts';
import { parseYmdLocal } from './silentChurn.ts';
import { gymLocalDay } from './wodifyRetentionSync.ts';

export type StudentCohorts = {
  cohortEdges: CohortHistogram['cohortEdges'];
  cohorts: Record<string, { active: TenureBandRecency }>;
};
export type StudentRetentionAggregate = {
  version: 1;
  asOf: string;
  studentTotal: number;
  unknown: number;
  daysAbsentHistogram: DaysAbsentHistogram;
  tenureBands: TenureBandHistogram;
  cohorts: StudentCohorts;
};

/** Weekly snapshots expire after two weeks; no fallback to an older non-null row. */
export function studentRetentionFromRow(row: unknown, now = new Date()): StudentRetentionAggregate | null {
  if (!record(row)) return null;
  const parsed = parseStudentRetentionAggregate(row.student_retention, row.as_of, row.student_total);
  if (!parsed || !count(row.active_total) || !count(row.guardian_only_total)
    || parsed.studentTotal + row.guardian_only_total !== row.active_total
    || row.unclassified_total !== 0 || row.detail_clients_failed !== 0
    || !count(row.pages_expected) || row.pages_expected < 1
    || row.pages_expected !== row.pages_completed) return null;
  const paths = row.students_by_path;
  if (!keys(paths, ['member', 'dependent', 'guardian_with_signin', 'no_group_with_signin'])
    || !Object.values(paths).every(count)
    || (Object.values(paths) as number[]).reduce((sum, n) => sum + n, 0) !== parsed.studentTotal) return null;
  const today = gymLocalDay(now, 'America/New_York');
  const daysOld = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${parsed.asOf}T00:00:00Z`)) / 86_400_000;
  return daysOld >= 0 && daysOld <= 14 ? parsed : null;
}

/** Input contains only clients classified as students in this page request. */
export function buildStudentRetentionAggregate(rows: RawWodifyClient[], asOf: string): StudentRetentionAggregate {
  const aggregate = computeRetentionAggregate(rows, {
    asOf, fetchedAt: `${asOf}T12:00:00Z`, pagesFetched: 1, reachedPageCap: false,
  });
  return {
    version: 1, asOf, studentTotal: aggregate.activeTotal, unknown: aggregate.unknown,
    daysAbsentHistogram: aggregate.daysAbsentHistogram,
    tenureBands: aggregate.tenureBandHistogram,
    cohorts: {
      cohortEdges: aggregate.cohortHistogram.cohortEdges,
      cohorts: Object.fromEntries(Object.entries(aggregate.cohortHistogram.cohorts)
        .map(([id, entry]) => [id, { active: entry.active }])),
    },
  };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function keys(value: unknown, expected: string[]): value is Record<string, unknown> {
  return record(value) && Object.keys(value).length === expected.length
    && expected.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function bins(value: unknown): value is Record<string, number> {
  return record(value) && Object.entries(value).every(([key, n]) =>
    /^(0|[1-9]\d*)$/.test(key) && Number(key) <= 364 && count(n));
}
function recency(value: unknown): value is TenureBandRecency {
  return keys(value, ['countsByDaysAbsent', 'overflow365Plus', 'unknownRecency'])
    && bins(value.countsByDaysAbsent) && count(value.overflow365Plus) && count(value.unknownRecency);
}
function add(target: TenureBandRecency, source: TenureBandRecency): void {
  target.overflow365Plus += source.overflow365Plus;
  target.unknownRecency += source.unknownRecency;
  for (const [day, n] of Object.entries(source.countsByDaysAbsent)) {
    target.countsByDaysAbsent[day] = (target.countsByDaysAbsent[day] ?? 0) + n;
  }
}
function partitionMatches(parts: TenureBandRecency[], total: TenureBandRecency): boolean {
  const sum: TenureBandRecency = { countsByDaysAbsent: {}, overflow365Plus: 0, unknownRecency: 0 };
  parts.forEach((part) => add(sum, part));
  return sum.overflow365Plus === total.overflow365Plus && sum.unknownRecency === total.unknownRecency
    && [...new Set([...Object.keys(sum.countsByDaysAbsent), ...Object.keys(total.countsByDaysAbsent)])]
      .every((day) => (sum.countsByDaysAbsent[day] ?? 0) === (total.countsByDaysAbsent[day] ?? 0));
}

/** No coercion, partial fallback or older-row lookup. Zero is a valid payload. */
export function parseStudentRetentionAggregate(
  value: unknown, asOf: unknown, studentTotal: unknown,
): StudentRetentionAggregate | null {
  if (typeof asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return null;
  const date = parseYmdLocal(asOf);
  if (!date || date.getFullYear() !== Number(asOf.slice(0, 4))
    || date.getMonth() + 1 !== Number(asOf.slice(5, 7)) || date.getDate() !== Number(asOf.slice(8))) return null;
  if (!keys(value, ['version', 'asOf', 'studentTotal', 'unknown', 'daysAbsentHistogram', 'tenureBands', 'cohorts'])
    || value.version !== 1 || value.asOf !== asOf || !count(studentTotal)
    || value.studentTotal !== studentTotal || !count(value.unknown)) return null;
  const hist = value.daysAbsentHistogram;
  if (!keys(hist, ['maxExactDays', 'countsByDaysAbsent', 'overflow365Plus'])
    || hist.maxExactDays !== 364 || !bins(hist.countsByDaysAbsent) || !count(hist.overflow365Plus)) return null;
  if (Object.values(hist.countsByDaysAbsent).reduce((sum, n) => sum + n, 0)
    + hist.overflow365Plus + value.unknown !== studentTotal) return null;
  const tenure = value.tenureBands;
  const expectedTenure = TENURE_BANDS.map(({ id, minDays }) => ({ id, minDays }));
  if (!keys(tenure, ['bandEdges', 'bands']) || !Array.isArray(tenure.bandEdges)
    || tenure.bandEdges.length !== expectedTenure.length
    || !tenure.bandEdges.every((edge, i) => keys(edge, ['id', 'minDays'])
      && edge.id === expectedTenure[i].id && edge.minDays === expectedTenure[i].minDays)
    || !keys(tenure.bands, [...TENURE_BANDS.map((b) => b.id), UNKNOWN_TENURE_ID])
    || !Object.values(tenure.bands).every(recency)) return null;
  const cohort = value.cohorts;
  const expectedCohort = COHORT_BANDS.map(({ id, minAge, maxAge }) => ({ id, minAge, maxAge }));
  if (!keys(cohort, ['cohortEdges', 'cohorts']) || !Array.isArray(cohort.cohortEdges)
    || cohort.cohortEdges.length !== expectedCohort.length
    || !cohort.cohortEdges.every((edge, i) => keys(edge, ['id', 'minAge', 'maxAge'])
      && edge.id === expectedCohort[i].id && edge.minAge === expectedCohort[i].minAge
      && edge.maxAge === expectedCohort[i].maxAge)
    || !keys(cohort.cohorts, [...COHORT_BANDS.map((b) => b.id), UNKNOWN_COHORT_ID])
    || !Object.values(cohort.cohorts).every((entry) => keys(entry, ['active']) && recency(entry.active))) return null;
  const total = { countsByDaysAbsent: hist.countsByDaysAbsent, overflow365Plus: hist.overflow365Plus, unknownRecency: value.unknown };
  if (!partitionMatches(Object.values(tenure.bands) as TenureBandRecency[], total)
    || !partitionMatches(Object.values(cohort.cohorts).map((entry) => (entry as { active: TenureBandRecency }).active), total)) return null;
  // All fields/keys are admitted above; no unvalidated properties cross this boundary.
  return structuredClone(value) as StudentRetentionAggregate;
}

/** Pages must be parsed and date/total-validated before merging. */
export function mergeStudentRetentionAggregates(pages: StudentRetentionAggregate[], asOf: string): StudentRetentionAggregate {
  const merged = buildStudentRetentionAggregate([], asOf);
  const global = { ...merged.daysAbsentHistogram, unknownRecency: 0 };
  for (const page of pages) {
    merged.studentTotal += page.studentTotal;
    add(global, { ...page.daysAbsentHistogram, unknownRecency: page.unknown });
    for (const [id, band] of Object.entries(page.tenureBands.bands)) add(merged.tenureBands.bands[id], band);
    for (const [id, cohort] of Object.entries(page.cohorts.cohorts)) add(merged.cohorts.cohorts[id].active, cohort.active);
  }
  merged.unknown = global.unknownRecency;
  merged.daysAbsentHistogram.overflow365Plus = global.overflow365Plus;
  return merged;
}
