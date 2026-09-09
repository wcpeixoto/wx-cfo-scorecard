import { describe, expect, it } from 'vitest';
import { computeRetentionAggregate, type RetentionAggregate } from './wodifyRetentionAggregate';
import { buildStudentRetentionAggregate, mergeStudentRetentionAggregates } from './studentRetentionAggregate';
import {
  CENSUS_PAGE_SIZE,
  buildRetentionPersistenceRow,
  classifyActiveClientDetail,
  isExactlyActiveClient,
  parseCensusRequest,
  summarizeCensusPage,
  validateAndMergeCensus,
  type CensusObservation,
  type CensusPageDraft,
} from './wodifyStudentCensus';

const RUN_ID = '8d4e4e10-9fa6-4bbf-b5e7-7d78a0c0e811';

function student(path: 'member' | 'dependent' | 'guardian_with_signin' | 'no_group_with_signin'): CensusObservation {
  return { classification: { kind: 'student', path }, detailCallsMade: 1, detailFailed: false };
}

function guardianOnly(ambiguousNoSigninWithMembership = false): CensusObservation {
  return {
    classification: { kind: 'guardian_only', ambiguousNoSigninWithMembership },
    detailCallsMade: 1,
    detailFailed: false,
  };
}

function unclassified(detailFailed = false, detailCallsMade = 1): CensusObservation {
  return { classification: { kind: 'unclassified' }, detailCallsMade, detailFailed };
}

function draft(
  page: number,
  hasMore: boolean,
  observations: CensusObservation[],
  rowsSeen = observations.length,
): CensusPageDraft {
  return summarizeCensusPage({
    studentAggregate: buildStudentRetentionAggregate(observations
      .filter((o) => o.classification.kind === 'student').map(() => ({ client_status: 'Active' })), '2026-09-09'),
    createdAt: '2026-09-09T11:59:00.000Z',
    page,
    pageSize: CENSUS_PAGE_SIZE,
    hasMore,
    rowsSeen,
    observations,
  });
}

function aggregate(clientsScanned: number, activeTotal: number): RetentionAggregate {
  const rows = [
    ...Array.from({ length: activeTotal }, () => ({
      client_status: 'Active',
      last_attendance: '2026-09-08',
      member_since: '2024-01-01',
      date_of_birth: '1990-01-01',
    })),
    ...Array.from({ length: clientsScanned - activeTotal }, () => ({
      client_status: 'Inactive',
      member_since: '2024-01-01',
      date_of_birth: '1990-01-01',
    })),
  ];
  return computeRetentionAggregate(rows, {
    asOf: '2026-09-09',
    fetchedAt: '2026-09-09T12:00:00.000Z',
    pagesFetched: 1,
    reachedPageCap: false,
  });
}

describe('classifyActiveClientDetail', () => {
  it('always counts Member and Dependent as students, independent of sign-ins', () => {
    expect(classifyActiveClientDetail({
      group: { group_role: 'Member' },
      total_class_sign_ins: 0,
    })).toEqual({ kind: 'student', path: 'member' });
    expect(classifyActiveClientDetail({
      client: { group: { group_role: 'Dependent' } },
    })).toEqual({ kind: 'student', path: 'dependent' });
  });

  it('makes Guardian and no-group clients depend on at least one recorded sign-in', () => {
    expect(classifyActiveClientDetail({
      group: { group_role: 'Guardian' },
      total_class_sign_ins: 1,
    })).toEqual({ kind: 'student', path: 'guardian_with_signin' });
    expect(classifyActiveClientDetail({ total_class_sign_ins: 3 })).toEqual({
      kind: 'student',
      path: 'no_group_with_signin',
    });
    expect(classifyActiveClientDetail({
      group: { group_role: 'Guardian' },
      total_class_sign_ins: 0,
      has_membership: true,
    })).toEqual({ kind: 'guardian_only', ambiguousNoSigninWithMembership: false });
  });

  it('fails closed on a present group without role, an unknown role, or an invalid sign-in', () => {
    expect(classifyActiveClientDetail({ group: {}, total_class_sign_ins: 0 })).toEqual({
      kind: 'unclassified',
    });
    expect(classifyActiveClientDetail({
      group: { group_role: 'Billing Contact' },
      total_class_sign_ins: 0,
    })).toEqual({ kind: 'unclassified' });
    expect(classifyActiveClientDetail({
      group: { group_role: 'Guardian' },
      total_class_sign_ins: '2',
    })).toEqual({ kind: 'unclassified' });
    expect(classifyActiveClientDetail({
      group: null,
      total_class_sign_ins: -1,
    })).toEqual({ kind: 'unclassified' });
  });

  it('marks only no-group + zero sign-ins + has_membership=true as ambiguous', () => {
    expect(classifyActiveClientDetail({
      group: null,
      total_class_sign_ins: 0,
      has_membership: true,
    })).toEqual({ kind: 'guardian_only', ambiguousNoSigninWithMembership: true });
    expect(classifyActiveClientDetail({
      group: null,
      total_class_sign_ins: 0,
      has_membership: false,
    })).toEqual({ kind: 'guardian_only', ambiguousNoSigninWithMembership: false });
    expect(classifyActiveClientDetail({
      group: { group_role: 'Guardian' },
      total_class_sign_ins: 0,
      has_membership: true,
    })).toEqual({ kind: 'guardian_only', ambiguousNoSigninWithMembership: false });
  });
});

describe('page scope and request parsing', () => {
  it('calls detail only for the exact Active status', () => {
    expect(isExactlyActiveClient('Active')).toBe(true);
    expect(isExactlyActiveClient('active')).toBe(false);
    expect(isExactlyActiveClient(' Active ')).toBe(false);
    expect(isExactlyActiveClient('Inactive')).toBe(false);
    expect(isExactlyActiveClient(undefined)).toBe(false);
  });

  it('accepts only a UUID run_id and a positive integer page', () => {
    expect(parseCensusRequest({ mode: 'page', run_id: RUN_ID, page: 1 })).toEqual({
      mode: 'page', runId: RUN_ID, page: 1,
    });
    expect(parseCensusRequest({ mode: 'finalize', run_id: RUN_ID, page: 99 })).toEqual({
      mode: 'finalize', runId: RUN_ID,
    });
    expect(parseCensusRequest({ mode: 'page', run_id: 'not-a-uuid', page: 1 })).toBeNull();
    expect(parseCensusRequest({ mode: 'page', run_id: RUN_ID, page: 0 })).toBeNull();
    expect(parseCensusRequest({ mode: 'page', run_id: RUN_ID, page: 201 })).toBeNull();
    expect(parseCensusRequest({ mode: 'page', run_id: RUN_ID, page: 1.5 })).toBeNull();
  });
});

describe('summarizeCensusPage', () => {
  it('conserves active clients and derives student_total from the four paths', () => {
    const out = draft(1, false, [
      student('member'),
      student('dependent'),
      student('guardian_with_signin'),
      student('no_group_with_signin'),
      guardianOnly(true),
      unclassified(true, 3),
    ], 10);

    expect(out.studentsByPath).toEqual({
      member: 1,
      dependent: 1,
      guardian_with_signin: 1,
      no_group_with_signin: 1,
    });
    expect(out.studentTotal).toBe(4);
    expect(out.guardianOnly).toBe(1);
    expect(out.unclassified).toBe(1);
    expect(out.ambiguousNoSigninWithMembership).toBe(1);
    expect(out.activeClientsSeen).toBe(6);
    expect(out.studentTotal + out.guardianOnly + out.unclassified).toBe(out.activeClientsSeen);
    expect(out.detailCallsMade).toBe(8); // retries count as HTTP calls; clients do not
    expect(out.detailClientsFailed).toBe(1);
  });
});

describe('validateAndMergeCensus', () => {
  const goodDrafts = [
    draft(1, true, [student('member'), guardianOnly()], 3),
    draft(2, false, [student('dependent')], 2),
  ];
  const goodAggregate = aggregate(5, 3);

  it('merges all pages and passes every conservation gate', () => {
    const result = validateAndMergeCensus(goodDrafts, goodAggregate);
    expect(result).toEqual({
      ok: true,
      totals: {
        studentAggregate: mergeStudentRetentionAggregates(goodDrafts.map((d) => d.studentAggregate!), '2026-09-09'),
        studentTotal: 2,
        guardianOnlyTotal: 1,
        studentsByPath: {
          member: 1,
          dependent: 1,
          guardian_with_signin: 0,
          no_group_with_signin: 0,
        },
        unclassifiedTotal: 0,
        ambiguousNoSigninWithMembership: 0,
        detailCallsMade: 3,
        detailClientsFailed: 0,
        pagesExpected: 2,
        pagesCompleted: 2,
      },
    });
  });

  it.each(['invalid', '2026-09-09T10:59:59Z', '2026-09-09T12:00:01Z'])('rejects stale or invalid run time %s', (createdAt) => {
    const result = validateAndMergeCensus([{ ...goodDrafts[0], createdAt }, goodDrafts[1]], goodAggregate);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.conflict.code).toBe('stale_run');
  });

  it('rejects a run crossing the gym-local date even within one hour', () => {
    const current = { ...goodAggregate, asOf: '2026-09-09', fetchedAt: '2026-09-09T04:05:00Z' };
    const result = validateAndMergeCensus(goodDrafts.map((d) => ({ ...d, createdAt: '2026-09-09T03:55:00Z' })), current);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.conflict.code).toBe('stale_run');
  });

  it.each([0, 201, -1, 1.5])('rejects invalid stored page %s', (page) => {
    expect(validateAndMergeCensus([{ ...goodDrafts[0], page }, goodDrafts[1]], goodAggregate).ok).toBe(false);
  });

  it.each([
    ['missing page', [goodDrafts[1]], 'missing_page'],
    ['two terminals', [draft(1, false, [student('member')], 3), goodDrafts[1]], 'terminal_page_count'],
    ['page above terminal', [draft(1, false, [student('member')], 3), draft(2, true, [student('dependent')], 2)], 'page_above_terminal'],
    ['rows_seen mismatch', [goodDrafts[0], { ...goodDrafts[1], rowsSeen: 1 }], 'rows_seen_mismatch'],
    ['active_clients_seen mismatch', [goodDrafts[0], { ...goodDrafts[1], activeClientsSeen: 0 }], 'active_clients_seen_mismatch'],
    ['unclassified', [goodDrafts[0], draft(2, false, [unclassified()], 2)], 'unclassified_not_zero'],
    ['detail failure', [goodDrafts[0], { ...goodDrafts[1], detailClientsFailed: 1 }], 'detail_clients_failed_not_zero'],
  ])('blocks finalize for %s', (_label, drafts, code) => {
    const result = validateAndMergeCensus(drafts as CensusPageDraft[], goodAggregate);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.conflict.code).toBe(code);
  });

  it('blocks an aggregate fetch that reached its safety page cap', () => {
    const capped = {
      ...goodAggregate,
      dataQuality: { ...goodAggregate.dataQuality, reachedPageCap: true },
    };
    const result = validateAndMergeCensus(goodDrafts, capped);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.conflict.code).toBe('aggregate_page_cap_reached');
  });

  it('rejects preserved legacy drafts and incomplete student aggregates', () => {
    const legacy = validateAndMergeCensus(goodDrafts.map((d) => ({ ...d, pageSize: 100 })), goodAggregate);
    expect(legacy.ok).toBe(false);
    if (!legacy.ok) expect(legacy.conflict.code).toBe('page_size_mismatch');
    const missing = validateAndMergeCensus([{ ...goodDrafts[0], studentAggregate: null }, goodDrafts[1]], goodAggregate);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.conflict.code).toBe('invalid_student_aggregate');
  });

  it('blocks a stored student_total that differs from the path sum', () => {
    const bad = [{ ...goodDrafts[0], studentTotal: 2 }, goodDrafts[1]];
    const result = validateAndMergeCensus(bad, goodAggregate);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.conflict.code).toBe('student_path_mismatch');
  });

  it('blocks a classified-total mismatch', () => {
    const bad = [{ ...goodDrafts[0], guardianOnly: 0 }, goodDrafts[1]];
    const result = validateAndMergeCensus(bad, goodAggregate);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.conflict.code).toBe('active_conservation_mismatch');
  });
});

describe('buildRetentionPersistenceRow', () => {
  it('preserves every current aggregate field and appends the census contract', () => {
    const current = aggregate(2, 1);
    const merged = validateAndMergeCensus(
      [draft(1, false, [student('member')], 2)],
      current,
    );
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;

    const row = buildRetentionPersistenceRow(current, merged.totals);
    expect(Object.keys(row).sort()).toEqual([
      'active_total',
      'ambiguous_no_signin_with_membership',
      'as_of',
      'clients_scanned',
      'cohort_histogram',
      'days_absent_histogram',
      'detail_calls_made',
      'detail_clients_failed',
      'fetched_at',
      'future_last_check_in',
      'guardian_only_total',
      'inactive_total',
      'missing_monthly_dues',
      'monthly_dues_at_risk',
      'pages_completed',
      'pages_expected',
      'pages_fetched',
      'reached_page_cap',
      'source',
      'student_total',
      'student_retention',
      'students_by_path',
      'tenure_band_histogram',
      'unclassified_total',
      'unknown_count',
      'unknown_status',
      'wodify_at_risk_count',
      'workspace_id',
    ].sort());
    expect(row.active_total).toBe(current.activeTotal);
    expect(row.days_absent_histogram).toBe(current.daysAbsentHistogram);
    expect(row.tenure_band_histogram).toBe(current.tenureBandHistogram);
    expect(row.cohort_histogram).toBe(current.cohortHistogram);
    expect(row.student_total).toBe(1);
    expect(row.guardian_only_total).toBe(0);
    expect(row).not.toHaveProperty('silent_dues_snapshot');
  });
});
