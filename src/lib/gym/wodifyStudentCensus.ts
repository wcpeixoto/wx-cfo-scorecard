// Pure, runtime-agnostic logic for the paged Wodify student census (WO-2 v3).
// The Edge Function owns HTTP and persistence; this module owns request
// validation, detail normalization, count aggregation, finalize gates, and the
// complete persistence-row merge. No person-level value is returned.

import type { RetentionAggregate } from './wodifyRetentionAggregate.ts';
import { gymLocalDay } from './wodifyRetentionSync.ts';
import { parseStudentRetentionAggregate, mergeStudentRetentionAggregates, type StudentRetentionAggregate } from './studentRetentionAggregate.ts';

export const CENSUS_PAGE_SIZE = 25;
export const CENSUS_MAX_PAGES = 200; // numeric bound; one-hour freshness limits achievable runtime capacity
export const CENSUS_MAX_AGE_MS = 60 * 60 * 1000;

// Aluno = group_role ∈ (Member, Dependent)
//         OU (Guardian OU sem grupo) com ≥1 sign-in registrado
// Somente responsável = (Guardian OU sem grupo) com 0 sign-ins registrados
// Sem grupo inclui group_role string vazia após trim + group_id numérico 0.
// Não classificado = role inesperado, OU grupo presente sem role,
//         exceto o sentinel acima, OU sign-in ausente/inválido, OU detalhe que falhou

export type StudentPath =
  | 'member'
  | 'dependent'
  | 'guardian_with_signin'
  | 'no_group_with_signin';

export type StudentsByPath = Record<StudentPath, number>;

export type CensusClassification =
  | { kind: 'student'; path: StudentPath }
  // Diagnostic is only no-group + zero sign-ins + has_membership=true, not Guardian-role clients.
  | { kind: 'guardian_only'; ambiguousNoSigninWithMembership: boolean }
  | { kind: 'unclassified' };

export type CensusObservation = {
  classification: CensusClassification;
  detailCallsMade: number;
  detailFailed: boolean;
};

export type CensusPageDraft = {
  studentAggregate: StudentRetentionAggregate | null;
  createdAt: string;
  page: number;
  pageSize: number;
  hasMore: boolean;
  rowsSeen: number;
  activeClientsSeen: number;
  studentTotal: number;
  studentsByPath: StudentsByPath;
  guardianOnly: number;
  unclassified: number;
  ambiguousNoSigninWithMembership: number;
  detailCallsMade: number;
  detailClientsFailed: number;
};

export type CensusTotals = {
  studentAggregate: StudentRetentionAggregate;
  studentTotal: number;
  guardianOnlyTotal: number;
  studentsByPath: StudentsByPath;
  unclassifiedTotal: number;
  ambiguousNoSigninWithMembership: number;
  detailCallsMade: number;
  detailClientsFailed: number;
  pagesExpected: number;
  pagesCompleted: number;
};

export type CensusPageRequest = {
  mode: 'page';
  runId: string;
  page: number;
};

export type CensusFinalizeRequest = {
  mode: 'finalize';
  runId: string;
};

export type CensusRequest = CensusPageRequest | CensusFinalizeRequest;

export type FinalizeValidationCode =
  | 'invalid_student_aggregate'
  | 'invalid_draft'
  | 'stale_run'
  | 'terminal_page_count'
  | 'duplicate_page'
  | 'page_above_terminal'
  | 'missing_page'
  | 'page_size_mismatch'
  | 'aggregate_page_cap_reached'
  | 'rows_seen_mismatch'
  | 'active_clients_seen_mismatch'
  | 'student_path_mismatch'
  | 'active_conservation_mismatch'
  | 'unclassified_not_zero'
  | 'detail_clients_failed_not_zero';

export type FinalizeConflict = {
  code: FinalizeValidationCode;
  left: { name: string; value: number };
  right: { name: string; value: number };
};

export type FinalizeValidationResult =
  | { ok: true; totals: CensusTotals }
  | { ok: false; conflict: FinalizeConflict };

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(record: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function emptyStudentsByPath(): StudentsByPath {
  return {
    member: 0,
    dependent: 0,
    guardian_with_signin: 0,
    no_group_with_signin: 0,
  };
}

function studentPathTotal(paths: StudentsByPath): number {
  return paths.member
    + paths.dependent
    + paths.guardian_with_signin
    + paths.no_group_with_signin;
}

function normalizeDetailRecord(raw: unknown): UnknownRecord | null {
  if (!isRecord(raw)) return null;
  if (hasOwn(raw, 'client')) return isRecord(raw.client) ? raw.client : null;
  return raw;
}

function normalizeGroupRole(raw: unknown): 'member' | 'dependent' | 'guardian' | null {
  if (typeof raw !== 'string') return null;
  const role = raw.trim().toLowerCase();
  if (role === 'member' || role === 'dependent' || role === 'guardian') return role;
  return null;
}

export type UnclassifiedDetailReason =
  | 'invalid_detail_record'
  | 'invalid_no_group_signins'
  | 'invalid_group_or_missing_role'
  | 'unrecognized_group_role'
  | 'invalid_guardian_signins';

/** The optional observer counts failure branches; classification is unchanged. */
export function classifyActiveClientDetail(
  raw: unknown,
  onUnclassified?: (reason: UnclassifiedDetailReason) => void,
): CensusClassification {
  const detail = normalizeDetailRecord(raw);
  if (detail === null) {
    onUnclassified?.('invalid_detail_record');
    return { kind: 'unclassified' };
  }

  const groupRaw = detail.group;
  const isNoGroupSentinel = isRecord(groupRaw)
    && typeof groupRaw.group_role === 'string'
    && groupRaw.group_role.trim() === ''
    && groupRaw.group_id === 0;
  const hasNoGroup = !hasOwn(detail, 'group') || groupRaw === null || groupRaw === undefined || isNoGroupSentinel;
  if (hasNoGroup) {
    const signIns = detail.total_class_sign_ins;
    if (typeof signIns !== 'number' || !Number.isInteger(signIns) || signIns < 0) {
      onUnclassified?.('invalid_no_group_signins');
      return { kind: 'unclassified' };
    }
    if (signIns >= 1) return { kind: 'student', path: 'no_group_with_signin' };
    return {
      kind: 'guardian_only',
      ambiguousNoSigninWithMembership: detail.has_membership === true,
    };
  }

  // Outside the exact sentinel above, present groups require a recognized role;
  // other empty/malformed groups remain unclassified rather than hiding drift.
  if (!isRecord(groupRaw) || !hasOwn(groupRaw, 'group_role')) {
    onUnclassified?.('invalid_group_or_missing_role');
    return { kind: 'unclassified' };
  }
  const role = normalizeGroupRole(groupRaw.group_role);
  if (role === null) {
    onUnclassified?.('unrecognized_group_role');
    return { kind: 'unclassified' };
  }
  if (role === 'member' || role === 'dependent') {
    // These two roles are independently sufficient under the literal
    // definition; their classification never depends on the sign-in value.
    return { kind: 'student', path: role };
  }
  const signIns = detail.total_class_sign_ins;
  if (typeof signIns !== 'number' || !Number.isInteger(signIns) || signIns < 0) {
    onUnclassified?.('invalid_guardian_signins');
    return { kind: 'unclassified' };
  }
  if (signIns >= 1) return { kind: 'student', path: 'guardian_with_signin' };
  return { kind: 'guardian_only', ambiguousNoSigninWithMembership: false };
}

/** Only the exact wire value Active is eligible for a detail request. */
export function isExactlyActiveClient(rawStatus: unknown): boolean {
  return rawStatus === 'Active';
}

/** Normalize a transient Wodify client id for URL use; never persist or emit it. */
export function normalizeClientId(raw: unknown): string | null {
  if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0) return String(raw);
  if (typeof raw === 'string' && /^[1-9]\d*$/.test(raw)) return raw;
  return null;
}

export function parseCensusRequest(raw: unknown): CensusRequest | null {
  if (!isRecord(raw) || (raw.mode !== 'page' && raw.mode !== 'finalize')) return null;
  if (
    typeof raw.run_id !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw.run_id)
  ) {
    return null;
  }
  if (raw.mode === 'page') {
    if (!Number.isSafeInteger(raw.page) || (raw.page as number) <= 0
      || (raw.page as number) > CENSUS_MAX_PAGES) return null;
    return { mode: 'page', runId: raw.run_id, page: raw.page as number };
  }
  return { mode: 'finalize', runId: raw.run_id };
}

export function summarizeCensusPage(input: {
  studentAggregate: StudentRetentionAggregate;
  createdAt: string;
  page: number;
  pageSize: number;
  hasMore: boolean;
  rowsSeen: number;
  observations: CensusObservation[];
}): CensusPageDraft {
  const studentsByPath = emptyStudentsByPath();
  let guardianOnly = 0;
  let unclassified = 0;
  let ambiguousNoSigninWithMembership = 0;
  let detailCallsMade = 0;
  let detailClientsFailed = 0;

  for (const observation of input.observations) {
    detailCallsMade += observation.detailCallsMade;
    if (observation.detailFailed) detailClientsFailed += 1;

    if (observation.classification.kind === 'student') {
      studentsByPath[observation.classification.path] += 1;
    } else if (observation.classification.kind === 'guardian_only') {
      guardianOnly += 1;
      if (observation.classification.ambiguousNoSigninWithMembership) {
        ambiguousNoSigninWithMembership += 1;
      }
    } else {
      unclassified += 1;
    }
  }

  return {
    studentAggregate: input.studentAggregate,
    createdAt: input.createdAt,
    page: input.page,
    pageSize: input.pageSize,
    hasMore: input.hasMore,
    rowsSeen: input.rowsSeen,
    activeClientsSeen: input.observations.length,
    studentTotal: studentPathTotal(studentsByPath),
    studentsByPath,
    guardianOnly,
    unclassified,
    ambiguousNoSigninWithMembership,
    detailCallsMade,
    detailClientsFailed,
  };
}

function sumDrafts(drafts: CensusPageDraft[]): Omit<CensusTotals, 'pagesExpected' | 'pagesCompleted' | 'studentAggregate'> {
  const studentsByPath = emptyStudentsByPath();
  let studentTotal = 0;
  let guardianOnlyTotal = 0;
  let unclassifiedTotal = 0;
  let ambiguousNoSigninWithMembership = 0;
  let detailCallsMade = 0;
  let detailClientsFailed = 0;

  for (const draft of drafts) {
    studentTotal += draft.studentTotal;
    guardianOnlyTotal += draft.guardianOnly;
    unclassifiedTotal += draft.unclassified;
    ambiguousNoSigninWithMembership += draft.ambiguousNoSigninWithMembership;
    detailCallsMade += draft.detailCallsMade;
    detailClientsFailed += draft.detailClientsFailed;
    for (const path of Object.keys(studentsByPath) as StudentPath[]) {
      studentsByPath[path] += draft.studentsByPath[path];
    }
  }

  return {
    studentTotal,
    guardianOnlyTotal,
    studentsByPath,
    unclassifiedTotal,
    ambiguousNoSigninWithMembership,
    detailCallsMade,
    detailClientsFailed,
  };
}

function reject(
  code: FinalizeValidationCode,
  leftName: string,
  leftValue: number,
  rightName: string,
  rightValue: number,
): FinalizeValidationResult {
  return {
    ok: false,
    conflict: {
      code,
      left: { name: leftName, value: leftValue },
      right: { name: rightName, value: rightValue },
    },
  };
}

/** Fail-closed validation and deterministic page merge for mode=finalize. */
export function validateAndMergeCensus(
  drafts: CensusPageDraft[],
  aggregate: RetentionAggregate,
  now: Date = new Date(aggregate.fetchedAt),
): FinalizeValidationResult {
  for (const draft of drafts) {
    const counters = [draft.page, draft.pageSize, draft.rowsSeen, draft.activeClientsSeen,
      draft.studentTotal, ...Object.values(draft.studentsByPath), draft.guardianOnly,
      draft.unclassified, draft.ambiguousNoSigninWithMembership,
      draft.detailCallsMade, draft.detailClientsFailed];
    if (counters.some((n) => !Number.isSafeInteger(n) || n < 0)
      || draft.page < 1 || draft.page > CENSUS_MAX_PAGES
      || draft.pageSize > CENSUS_PAGE_SIZE || draft.pageSize !== draft.rowsSeen
      || (draft.hasMore && (draft.pageSize !== CENSUS_PAGE_SIZE || draft.page === CENSUS_MAX_PAGES))
      || typeof draft.hasMore !== 'boolean') {
      return reject('invalid_draft', 'valid', 0, 'expected', 1);
    }
    const collected = new Date(draft.createdAt);
    const age = now.getTime() - collected.getTime();
    if (!Number.isFinite(age) || age < 0 || age > CENSUS_MAX_AGE_MS
      || gymLocalDay(collected, 'America/New_York') !== aggregate.asOf
      || gymLocalDay(now, 'America/New_York') !== aggregate.asOf) {
      return reject('stale_run', 'fresh', 0, 'expected', 1);
    }
  }
  const terminalPages = drafts.filter((draft) => !draft.hasMore);
  if (terminalPages.length !== 1) {
    return reject('terminal_page_count', 'terminalPages', terminalPages.length, 'expected', 1);
  }

  const uniquePages = new Set(drafts.map((draft) => draft.page));
  if (uniquePages.size !== drafts.length) {
    return reject('duplicate_page', 'pageRows', drafts.length, 'uniquePages', uniquePages.size);
  }

  const terminalPage = terminalPages[0].page;
  const pagesAboveTerminal = drafts.filter((draft) => draft.page > terminalPage).length;
  if (pagesAboveTerminal > 0) {
    return reject('page_above_terminal', 'pagesAboveTerminal', pagesAboveTerminal, 'expected', 0);
  }

  for (let page = 1; page <= terminalPage; page += 1) {
    if (!uniquePages.has(page)) {
      return reject('missing_page', 'pagesPresent', uniquePages.size, 'pagesExpected', terminalPage);
    }
  }

  if (aggregate.dataQuality.reachedPageCap) {
    return reject('aggregate_page_cap_reached', 'reachedPageCap', 1, 'expected', 0);
  }

  const rowsSeen = drafts.reduce((sum, draft) => sum + draft.rowsSeen, 0);
  if (rowsSeen !== aggregate.dataQuality.clientsScanned) {
    return reject(
      'rows_seen_mismatch',
      'rowsSeen',
      rowsSeen,
      'clientsScanned',
      aggregate.dataQuality.clientsScanned,
    );
  }

  const activeClientsSeen = drafts.reduce((sum, draft) => sum + draft.activeClientsSeen, 0);
  if (activeClientsSeen !== aggregate.activeTotal) {
    return reject(
      'active_clients_seen_mismatch',
      'activeClientsSeen',
      activeClientsSeen,
      'activeTotal',
      aggregate.activeTotal,
    );
  }

  const merged = sumDrafts(drafts);
  const pathTotal = studentPathTotal(merged.studentsByPath);
  if (merged.studentTotal !== pathTotal) {
    return reject(
      'student_path_mismatch',
      'studentTotal',
      merged.studentTotal,
      'studentsByPathTotal',
      pathTotal,
    );
  }

  const classifiedTotal = merged.studentTotal + merged.guardianOnlyTotal + merged.unclassifiedTotal;
  if (classifiedTotal !== activeClientsSeen) {
    return reject(
      'active_conservation_mismatch',
      'classifiedTotal',
      classifiedTotal,
      'activeClientsSeen',
      activeClientsSeen,
    );
  }

  if (merged.unclassifiedTotal !== 0) {
    return reject('unclassified_not_zero', 'unclassifiedTotal', merged.unclassifiedTotal, 'expected', 0);
  }
  if (merged.detailClientsFailed !== 0) {
    return reject(
      'detail_clients_failed_not_zero',
      'detailClientsFailed',
      merged.detailClientsFailed,
      'expected',
      0,
    );
  }

  const studentPages = drafts.map((draft) => parseStudentRetentionAggregate(
    draft.studentAggregate, aggregate.asOf, draft.studentTotal,
  ));
  if (studentPages.some((page) => page === null)) {
    return reject('invalid_student_aggregate', 'valid', 0, 'expected', 1);
  }
  const studentAggregate = mergeStudentRetentionAggregates(studentPages as StudentRetentionAggregate[], aggregate.asOf);
  if (!parseStudentRetentionAggregate(studentAggregate, aggregate.asOf, merged.studentTotal)) {
    return reject('invalid_student_aggregate', 'valid', 0, 'expected', 1);
  }

  return {
    ok: true,
    totals: {
      studentAggregate,
      ...merged,
      pagesExpected: terminalPage,
      pagesCompleted: drafts.length,
    },
  };
}

/** Preserve the complete existing snapshot payload and append the census fields. */
export function buildRetentionPersistenceRow(
  aggregate: RetentionAggregate,
  census: CensusTotals,
): Record<string, unknown> {
  return {
    workspace_id: 'default',
    source: aggregate.source,
    as_of: aggregate.asOf,
    fetched_at: aggregate.fetchedAt,
    active_total: aggregate.activeTotal,
    inactive_total: aggregate.inactiveTotal,
    days_absent_histogram: aggregate.daysAbsentHistogram,
    tenure_band_histogram: aggregate.tenureBandHistogram,
    cohort_histogram: aggregate.cohortHistogram,
    unknown_count: aggregate.unknown,
    monthly_dues_at_risk: aggregate.silentChurn.monthlyDuesAtRisk,
    missing_monthly_dues: aggregate.silentChurn.missingMonthlyDues,
    wodify_at_risk_count: aggregate.diagnostics.wodifyAtRiskCount,
    unknown_status: aggregate.dataQuality.unknownStatus,
    future_last_check_in: aggregate.dataQuality.futureLastCheckIn,
    pages_fetched: aggregate.dataQuality.pagesFetched,
    reached_page_cap: aggregate.dataQuality.reachedPageCap,
    clients_scanned: aggregate.dataQuality.clientsScanned,
    student_total: census.studentTotal,
    student_retention: census.studentAggregate,
    guardian_only_total: census.guardianOnlyTotal,
    students_by_path: { ...census.studentsByPath },
    unclassified_total: census.unclassifiedTotal,
    // No-group clients only; this diagnostic does not count Guardian-role clients.
    ambiguous_no_signin_with_membership: census.ambiguousNoSigninWithMembership,
    detail_calls_made: census.detailCallsMade,
    detail_clients_failed: census.detailClientsFailed,
    pages_expected: census.pagesExpected,
    pages_completed: census.pagesCompleted,
  };
}
