import { describe, expect, it } from 'vitest';
import { buildStudentRetentionAggregate, mergeStudentRetentionAggregates, parseStudentRetentionAggregate, studentRetentionFromRow } from './studentRetentionAggregate';

const asOf = '2026-09-09';
const first = buildStudentRetentionAggregate([
  { client_status: 'Active', last_attendance: '2026-09-08', member_since: '2026-08-01', date_of_birth: '2020-01-01' },
  { client_status: 'Active', last_attendance: '2026-08-01', member_since: '2020-01-01', date_of_birth: '1990-01-01' },
], asOf);
const second = buildStudentRetentionAggregate([{ client_status: 'Active' }], asOf);
const merged = mergeStudentRetentionAggregates([first, second], asOf);

describe('student retention contract', () => {
  const row = { as_of: asOf, student_total: 3, student_retention: merged,
    active_total: 4, guardian_only_total: 1, unclassified_total: 0, detail_clients_failed: 0,
    pages_expected: 2, pages_completed: 2,
    students_by_path: { member: 3, dependent: 0, guardian_with_signin: 0, no_group_with_signin: 0 } };
  it('admits only a complete same-row census within the weekly freshness window', () => {
    const today = new Date('2026-09-23T12:00:00Z');
    expect(studentRetentionFromRow(row, today)).toEqual(merged);
    expect(studentRetentionFromRow(row, new Date('2026-09-24T12:00:00Z'))).toBeNull();
    expect(studentRetentionFromRow(row, new Date('2026-09-08T12:00:00Z'))).toBeNull();
    expect(studentRetentionFromRow({ ...row, pages_completed: 1 }, today)).toBeNull();
    expect(studentRetentionFromRow({ ...row, active_total: 5 }, today)).toBeNull();
    expect(studentRetentionFromRow({ ...row, as_of: '2026-09-10' }, today)).toBeNull();
  });
  it('merges exact recency partitions and keeps unknown counts', () => {
    expect(parseStudentRetentionAggregate(merged, asOf, 3)).toEqual(merged);
    expect(merged.studentTotal).toBe(3);
    expect(merged.unknown).toBe(1);
    expect(merged.daysAbsentHistogram.countsByDaysAbsent).toEqual({ '1': 1, '39': 1 });
    expect(merged.cohorts.cohorts.unknownCohort.active.unknownRecency).toBe(1);
    expect(merged.tenureBands.bands.unknownTenure.unknownRecency).toBe(1);
  });

  it('preserves a real zero instead of converting it to unavailable', () => {
    const zero = buildStudentRetentionAggregate([], asOf);
    expect(parseStudentRetentionAggregate(zero, asOf, 0)).toEqual(zero);
    expect(zero.studentTotal).toBe(0);
  });

  it.each([undefined, null, {}, { ...merged, version: 0 }, { ...merged, version: 2 }])('rejects missing or old payloads (%#)', (value) => {
    expect(parseStudentRetentionAggregate(value, asOf, 3)).toBeNull();
  });

  it('requires census total and date from the same row', () => {
    expect(parseStudentRetentionAggregate(merged, '2026-09-10', 3)).toBeNull();
    expect(parseStudentRetentionAggregate(merged, asOf, 4)).toBeNull();
    expect(parseStudentRetentionAggregate(merged, asOf, null)).toBeNull();
  });

  it.each([-1, 0.5, '1', null, Number.MAX_SAFE_INTEGER + 1])('rejects malformed histogram counts (%s)', (bad) => {
    const value = structuredClone(merged);
    (value.daysAbsentHistogram.countsByDaysAbsent as Record<string, unknown>)['1'] = bad;
    expect(parseStudentRetentionAggregate(value, asOf, 3)).toBeNull();
  });

  it('rejects a wrong-day partition even when grand totals still match', () => {
    const value = structuredClone(merged);
    value.tenureBands.bands.lt3m.countsByDaysAbsent = { '2': 1 };
    expect(parseStudentRetentionAggregate(value, asOf, 3)).toBeNull();
  });

  it('rejects an age partition mismatch or extra/unvalidated fields', () => {
    const value = structuredClone(merged);
    value.cohorts.cohorts.adults16plus.active.unknownRecency += 1;
    expect(parseStudentRetentionAggregate(value, asOf, 3)).toBeNull();
    expect(parseStudentRetentionAggregate({ ...merged, extra: 1 }, asOf, 3)).toBeNull();
    const edge = structuredClone(merged);
    edge.tenureBands.bandEdges[0].minDays += 1;
    expect(parseStudentRetentionAggregate(edge, asOf, 3)).toBeNull();
  });
});
