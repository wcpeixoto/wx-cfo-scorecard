import { describe, expect, it } from 'vitest';

import {
  MISSING_BASE_REASON,
  STUDENT_MOVEMENT_METRIC_KEYS,
  baseLine,
  buildStudentMovement,
  formatCensusDate,
  formatEstimatedChurn,
  monthLabelLong,
  nyMonthStartMs,
  reportingMonthAt,
  unavailableMessage,
  type StudentMetricRow,
  type StudentMovementMetricKey,
} from './studentMovement';

function row(
  periodMonth: string,
  metricKey: StudentMovementMetricKey,
  value: number,
  asOf: string,
  sourceAsOf: string | null = null,
): StudentMetricRow {
  return { periodMonth, metricKey, value, asOf, sourceAsOf };
}

// The three always-written counts for one month, all from the same run.
function counts(month: string, asOf: string, n: number, r: number, c: number): StudentMetricRow[] {
  return [
    row(month, 'new_students', n, asOf),
    row(month, 'rejoins', r, asOf),
    row(month, 'cancellations', c, asOf),
  ];
}

// Production-shaped rows as of 2026-10-24 (read from public.wodify_monthly_metrics, dimension 'all').
// Aug and earlier came from the 2026-10-02 backfill; Sep and Oct from the 2026-10-19 weekly run.
const BACKFILL = '2026-10-02T22:43:57.434319+00:00';
const WEEKLY = '2026-10-19T15:07:40.74178+00:00';
const LIVE_ROWS: StudentMetricRow[] = [
  ...counts('2026-07', BACKFILL, 12, 5, 24),
  ...counts('2026-08', BACKFILL, 22, 4, 17),
  ...counts('2026-09', WEEKLY, 24, 6, 21),
  row('2026-09', 'active_students', 265, WEEKLY, '2026-09-28'),
  ...counts('2026-10', WEEKLY, 5, 0, 13),
  row('2026-10', 'active_students', 257, WEEKLY, '2026-10-12'),
];
const NOW_OCT_24 = '2026-10-24T16:00:00Z';

describe('New York month math', () => {
  it('starts months at 00:00 New York time, across DST', () => {
    expect(new Date(nyMonthStartMs('2026-09')).toISOString()).toBe('2026-09-01T04:00:00.000Z'); // EDT
    expect(new Date(nyMonthStartMs('2026-11')).toISOString()).toBe('2026-11-01T04:00:00.000Z'); // Nov 1 00:00 is still EDT
    expect(new Date(nyMonthStartMs('2026-12')).toISOString()).toBe('2026-12-01T05:00:00.000Z'); // EST
    expect(new Date(nyMonthStartMs('2027-03')).toISOString()).toBe('2027-03-01T05:00:00.000Z'); // EST
    expect(new Date(nyMonthStartMs('2027-04')).toISOString()).toBe('2027-04-01T04:00:00.000Z'); // EDT
  });

  it('reporting month is the previous New York calendar month', () => {
    expect(reportingMonthAt('2026-10-24T16:00:00Z')).toBe('2026-09');
    expect(reportingMonthAt('2027-01-05T12:00:00Z')).toBe('2026-12'); // year rollover
    // 03:59Z on Nov 1 is still Oct 31 in New York → still October is the CURRENT month.
    expect(reportingMonthAt('2026-11-01T03:59:00Z')).toBe('2026-09');
    expect(reportingMonthAt('2026-11-01T04:00:00Z')).toBe('2026-10');
  });

  it('rejects an invalid instant instead of guessing a month', () => {
    expect(() => reportingMonthAt('not a date')).toThrow(RangeError);
  });
});

describe('buildStudentMovement — as of 2026-10-24', () => {
  const view = buildStudentMovement(LIVE_ROWS, NOW_OCT_24);

  it('reporting month is September and it is refreshed', () => {
    expect(view.reportingMonth).toBe('2026-09');
    expect(view.reportingMonthAvailable).toBe(true);
    expect(view.current).toEqual({
      month: '2026-09',
      newStudents: 24,
      rejoins: 6,
      cancellations: 21,
      base: null,
      baseAsOf: null,
      estimatedChurn: null, // there is no August student count; the census began 2026-09-09
      refreshedAt: '2026-10-19T15:07:40.741Z',
    });
  });

  it('August is listed under its own label with churn unavailable', () => {
    const aug = view.months.find((m) => m.month === '2026-08');
    expect(aug).toMatchObject({ newStudents: 22, rejoins: 4, cancellations: 17, base: null, estimatedChurn: null });
  });

  it('never shows the current month (October) even though it has rows', () => {
    expect(view.months.map((m) => m.month)).toEqual(['2026-07', '2026-08', '2026-09']);
  });
});

describe('buildStudentMovement — the reporting-month gate', () => {
  // On Nov 2, October is the reporting month. These October rows were all written in October
  // (the in-progress weekly refresh), i.e. before 00:00 New York on Nov 1.
  const OCT_ONLY_IN_PROGRESS: StudentMetricRow[] = [
    ...LIVE_ROWS.filter((r) => r.periodMonth !== '2026-10'),
    ...counts('2026-10', '2026-10-26T15:05:00Z', 7, 1, 15),
    row('2026-10', 'active_students', 255, '2026-10-26T15:05:00Z', '2026-10-26'),
  ];
  const NOW_NOV_2 = '2026-11-02T16:00:00Z';

  it('an October whose rows all predate Nov 1 renders "not available yet" and does NOT fall back to September', () => {
    const view = buildStudentMovement(OCT_ONLY_IN_PROGRESS, NOW_NOV_2);
    expect(view.reportingMonth).toBe('2026-10');
    expect(view.reportingMonthAvailable).toBe(false);
    expect(view.current).toBeNull();
    expect(unavailableMessage(view.reportingMonth)).toBe('October data not available yet.');
    // September is still listed — under its OWN label — but is never promoted to the reporting month.
    expect(view.months[view.months.length - 1]?.month).toBe('2026-09');
    expect(view.months.some((m) => m.month === '2026-10')).toBe(false);
  });

  it('the cutoff is strictly AFTER 00:00 New York on the 1st (04:00:00Z in November)', () => {
    const at = (asOf: string) =>
      buildStudentMovement([...counts('2026-10', asOf, 5, 1, 9), row('2026-09', 'active_students', 265, asOf, '2026-09-28')], NOW_NOV_2)
        .reportingMonthAvailable;
    expect(at('2026-11-01T03:59:59Z')).toBe(false); // Oct 31 23:59:59 in New York
    expect(at('2026-11-01T04:00:00Z')).toBe(false); // exactly midnight — not after
    expect(at('2026-11-01T04:00:00.001Z')).toBe(true);
  });

  it('one stale row does not matter — the month is judged by its newest row', () => {
    const mixed = [
      row('2026-10', 'new_students', 7, '2026-10-26T15:05:00Z'),
      row('2026-10', 'rejoins', 1, '2026-10-26T15:05:00Z'),
      row('2026-10', 'cancellations', 15, '2026-11-01T15:07:00Z'), // the close run landed
    ];
    expect(buildStudentMovement(mixed, NOW_NOV_2).reportingMonthAvailable).toBe(true);
  });

  it('after the Nov 1 close, October shows its first estimated churn: cancellations ÷ 265 (base as of Sep 28)', () => {
    const afterClose: StudentMetricRow[] = [
      ...LIVE_ROWS.filter((r) => r.periodMonth !== '2026-10'),
      ...counts('2026-10', '2026-11-01T15:07:00Z', 19, 3, 18),
      row('2026-10', 'active_students', 251, '2026-11-01T15:07:00Z', '2026-10-26'),
    ];
    const view = buildStudentMovement(afterClose, NOW_NOV_2);
    expect(view.reportingMonthAvailable).toBe(true);
    expect(view.current).toMatchObject({
      month: '2026-10',
      cancellations: 18,
      base: 265, // September's count — NOT October's own 251
      baseAsOf: '2026-09-28',
      estimatedChurn: 0.0679, // 18 / 265
    });
    expect(baseLine(view.current!)).toEqual({ text: 'Base: 265 students as of Sep 28', hasBase: true });
  });

  it('a month written only mid-month is not shown even when it is older than the reporting month', () => {
    const view = buildStudentMovement(
      [...counts('2026-08', '2026-08-20T15:00:00Z', 9, 1, 4), ...counts('2026-09', WEEKLY, 24, 6, 21)],
      NOW_OCT_24,
    );
    expect(view.months.map((m) => m.month)).toEqual(['2026-09']);
  });

  it('never shows the current or a future month, even if bad data stamps its rows with a future as_of', () => {
    const skewed = [
      ...counts('2026-09', WEEKLY, 24, 6, 21),
      ...counts('2026-10', '2026-11-05T00:00:00Z', 5, 0, 13), // current month, as_of from the future
      ...counts('2026-11', '2026-12-05T00:00:00Z', 1, 1, 1), // next month
    ];
    const view = buildStudentMovement(skewed, NOW_OCT_24);
    expect(view.months.map((m) => m.month)).toEqual(['2026-09']);
    expect(view.current?.month).toBe('2026-09');
  });

  it('no rows at all → reporting month unavailable, nothing listed', () => {
    const view = buildStudentMovement([], NOW_OCT_24);
    expect(view).toEqual({ reportingMonth: '2026-09', reportingMonthAvailable: false, current: null, months: [] });
  });
});

describe('buildStudentMovement — base and estimated churn', () => {
  it('uses the PREVIOUS month\'s student count as the base', () => {
    const view = buildStudentMovement(
      [
        row('2026-09', 'active_students', 265, WEEKLY, '2026-09-28'),
        ...counts('2026-10', '2026-11-01T15:07:00Z', 19, 3, 53),
      ],
      '2026-11-02T16:00:00Z',
    );
    expect(view.current?.estimatedChurn).toBe(0.2); // 53 / 265
  });

  it('missing base → churn is null (never 0) and the reason line is shown', () => {
    const month = buildStudentMovement(LIVE_ROWS, NOW_OCT_24).current!;
    expect(month.estimatedChurn).toBeNull();
    expect(baseLine(month)).toEqual({ text: MISSING_BASE_REASON, hasBase: false });
    expect(formatEstimatedChurn(month.estimatedChurn)).toBe('—');
  });

  it('a zero or negative base is not a base', () => {
    const view = buildStudentMovement(
      [row('2026-08', 'active_students', 0, BACKFILL, '2026-08-30'), ...counts('2026-09', WEEKLY, 24, 6, 21)],
      NOW_OCT_24,
    );
    expect(view.current).toMatchObject({ base: null, estimatedChurn: null });
  });

  it('a missing count stays null — never coalesced to 0 — and blocks churn', () => {
    const view = buildStudentMovement(
      [
        row('2026-08', 'active_students', 270, BACKFILL, '2026-08-30'),
        row('2026-09', 'new_students', 24, WEEKLY),
        row('2026-09', 'rejoins', 6, WEEKLY),
      ],
      NOW_OCT_24,
    );
    expect(view.current).toMatchObject({ newStudents: 24, rejoins: 6, cancellations: null, base: 270, estimatedChurn: null });
  });

  it('ignores any key outside the four student-movement metrics', () => {
    const rows = [
      ...counts('2026-09', WEEKLY, 24, 6, 21),
      { ...row('2026-09', 'cancellations', 38, WEEKLY), metricKey: 'cancellations_all_clients' as StudentMovementMetricKey },
    ];
    expect(buildStudentMovement(rows, NOW_OCT_24).current?.cancellations).toBe(21);
    expect(STUDENT_MOVEMENT_METRIC_KEYS).not.toContain('cancellations_all_clients');
  });

  it('keeps only the latest maxMonths months', () => {
    const rows = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09'].flatMap((m) => counts(m, WEEKLY, 1, 1, 1));
    const view = buildStudentMovement(rows, NOW_OCT_24, 3);
    expect(view.months.map((m) => m.month)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(view.reportingMonthAvailable).toBe(true);
  });
});

describe('copy helpers', () => {
  it('formats labels the card renders', () => {
    expect(monthLabelLong('2026-09')).toBe('September 2026');
    expect(formatCensusDate('2026-09-28')).toBe('Sep 28');
    expect(formatCensusDate('2026-10-02')).toBe('Oct 2');
    expect(formatEstimatedChurn(0.0679)).toBe('6.8%');
    expect(formatEstimatedChurn(0)).toBe('0.0%');
    expect(unavailableMessage('2026-10')).toBe('October data not available yet.');
  });

  it('names the base month when the census date is missing', () => {
    const m = { ...buildStudentMovement(LIVE_ROWS, NOW_OCT_24).current!, base: 265, baseAsOf: null };
    expect(baseLine(m).text).toBe('Base: 265 students (August count)');
  });
});
