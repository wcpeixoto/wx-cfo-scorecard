// Renders the presentational card to static markup (the suite is node-only, no DOM) so the gate copy and
// the numbers are asserted as the owner would read them.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { buildStudentMovement, type StudentMetricRow, type StudentMovementMetricKey } from '../lib/gym/studentMovement';
import { StudentMovementCardView, type StudentMovementCardState } from './StudentMovementCard';

const BACKFILL = '2026-10-02T22:43:57.434319+00:00';
const WEEKLY = '2026-10-19T15:07:40.74178+00:00';

function row(periodMonth: string, metricKey: StudentMovementMetricKey, value: number, asOf: string, sourceAsOf: string | null = null): StudentMetricRow {
  return { periodMonth, metricKey, value, asOf, sourceAsOf };
}
function counts(month: string, asOf: string, n: number, r: number, c: number): StudentMetricRow[] {
  return [row(month, 'new_students', n, asOf), row(month, 'rejoins', r, asOf), row(month, 'cancellations', c, asOf)];
}

const LIVE_ROWS: StudentMetricRow[] = [
  ...counts('2026-08', BACKFILL, 22, 4, 17),
  ...counts('2026-09', WEEKLY, 24, 6, 21),
  row('2026-09', 'active_students', 265, WEEKLY, '2026-09-28'),
  ...counts('2026-10', WEEKLY, 5, 0, 13), // the current month — must never render
  row('2026-10', 'active_students', 257, WEEKLY, '2026-10-12'),
];

function render(state: StudentMovementCardState): string {
  return renderToStaticMarkup(<StudentMovementCardView state={state} />);
}
const ready = (rows: StudentMetricRow[], now: string): StudentMovementCardState => ({
  kind: 'ready',
  view: buildStudentMovement(rows, now),
});
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('StudentMovementCardView', () => {
  it('as of 2026-10-24: September headline (24 / 6 / 21, churn —), August below, October nowhere', () => {
    const html = render(ready(LIVE_ROWS, '2026-10-24T16:00:00Z'));
    const t = text(html);
    expect(t).toContain('Student movement');
    expect(t).toContain('September 2026'); // the reporting-month label
    expect(t).toContain('Provisional');
    expect(t).toContain('ADHARPY');

    // Headline tiles, in order.
    expect(t).toMatch(/New students 24 .*Returned 6 .*Cancelled 21 .*Estimated churn — .*No student count before this month/);

    // Earlier months: August on its own labelled row, with its own numbers.
    expect(html).toContain('<th scope="row">August 2026</th>');
    expect(t).toMatch(/August 2026 22 4 17 —/);

    // The current month is never shown.
    expect(t).not.toContain('October');
    expect(html).not.toContain('2026-10');
  });

  it('an October that is not refreshed says so and does NOT show September as the headline', () => {
    const rows = [
      ...LIVE_ROWS.filter((r) => r.periodMonth !== '2026-10'),
      ...counts('2026-10', '2026-10-26T15:05:00Z', 7, 1, 15),
      row('2026-10', 'active_students', 255, '2026-10-26T15:05:00Z', '2026-10-26'),
    ];
    const html = render(ready(rows, '2026-11-02T16:00:00Z'));
    const t = text(html);
    expect(t).toContain('October 2026'); // the reporting month is still displayed
    expect(t).toContain('October data not available yet.');
    expect(html).not.toContain('student-movement-tiles'); // no headline numbers at all
    expect(t).not.toContain('Estimated churn 6'); // no churn figure stands in for October
    // September survives only as a labelled row in Earlier months — after that heading, never before it.
    expect(html.indexOf('September 2026')).toBeGreaterThan(html.indexOf('Earlier months'));
    expect(html.match(/September 2026/g)).toHaveLength(1);
  });

  it('after the Nov 1 close, October shows its first estimated churn with the dated base', () => {
    const rows = [
      ...LIVE_ROWS.filter((r) => r.periodMonth !== '2026-10'),
      ...counts('2026-10', '2026-11-01T15:07:00Z', 19, 3, 18),
    ];
    const t = text(render(ready(rows, '2026-11-02T16:00:00Z')));
    expect(t).toMatch(/New students 19 .*Returned 3 .*Cancelled 18 .*Estimated churn 6\.8% .*Base: 265 students as of Sep 28/);
    expect(t).not.toContain('data not available yet');
  });

  it('read failure and loading keep the reporting-month label and invent no numbers', () => {
    const failed = text(render({ kind: 'error', reportingMonth: '2026-09' }));
    expect(failed).toContain('September 2026');
    expect(failed).toMatch(/Student movement couldn.t be loaded right now\./);
    expect(failed).not.toContain('data not available yet');
    expect(failed).not.toContain('Earlier months');

    const loading = text(render({ kind: 'loading', reportingMonth: '2026-09' }));
    expect(loading).toContain('September 2026');
    expect(loading).toContain('Loading student movement');
  });

  it('caps Earlier months at six, newest first', () => {
    const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
    const rows = months.flatMap((m) => counts(m, WEEKLY, 1, 1, 1));
    const html = render(ready(rows, '2026-10-24T16:00:00Z'));
    const shown = [...html.matchAll(/<th scope="row">([A-Za-z]+ 2026)<\/th>/g)].map((m) => m[1]);
    expect(shown).toEqual(['August 2026', 'July 2026', 'June 2026', 'May 2026', 'April 2026', 'March 2026']);
  });
});
