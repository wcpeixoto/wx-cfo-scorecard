// Student movement — monthly new / returned / cancelled students and an estimated churn rate, from
// Wodify's automatic monthly metrics (public.wodify_monthly_metrics, written by sync-wodify-metrics).
//
// PURE transform layer (no React, no I/O, no clock — "now" is injected as an ISO instant): the
// Student movement card and the monthly source export both call buildStudentMovement, so the
// dashboard and the JSON can never describe different months or different numbers.
//
// PROVISIONAL: these numbers are being compared with ADHARPY through the November close.
//
// RULES (docs/wodify-metrics.md has the metric formulas; this file owns only what is SHOWN):
//   - Reporting month = the previous calendar month in New York time. The current month is never shown.
//   - A month is REFRESHED when its newest row's as_of is after 00:00 New York time on the 1st of the
//     FOLLOWING month, i.e. some run finished after the month had ended. Rows written during the
//     month (the weekly runs refresh the in-progress month) describe a partial month and are not shown.
//   - If the reporting month is not refreshed, the reporting month is simply unavailable. An older
//     month is NEVER substituted for it. Older refreshed months may still be listed, each under its
//     own month label.
//   - Estimated churn (M) = cancellations(M) ÷ active_students(M−1). The base is the PREVIOUS
//     month's student count, with its census date (source_as_of). With no base the churn is null —
//     never 0, never guessed from a nearby month.

export const STUDENT_MOVEMENT_METRIC_KEYS = [
  'new_students',
  'rejoins',
  'cancellations', // students only — NOT cancellations_all_clients (includes guardian-only parents)
  'active_students',
] as const;

export type StudentMovementMetricKey = (typeof STUDENT_MOVEMENT_METRIC_KEYS)[number];

// One wodify_monthly_metrics row, dimension 'all'.
export type StudentMetricRow = {
  periodMonth: string; // 'YYYY-MM'
  metricKey: StudentMovementMetricKey;
  value: number;
  asOf: string; // ISO instant — when the run that wrote the row finished
  sourceAsOf: string | null; // 'YYYY-MM-DD' census date; set on active_students rows only
};

export type StudentMovementMonth = {
  month: string; // 'YYYY-MM'
  newStudents: number | null; // null = no row (never coalesced to 0)
  rejoins: number | null;
  cancellations: number | null;
  base: number | null; // active_students of the PREVIOUS month; null when absent
  baseAsOf: string | null; // 'YYYY-MM-DD' — that count's census date
  estimatedChurn: number | null; // cancellations ÷ base, fraction rounded to 4 dp; null without a base
  refreshedAt: string; // ISO instant — max(as_of) over this month's rows
};

export type StudentMovementView = {
  reportingMonth: string; // 'YYYY-MM' — previous calendar month, New York time
  reportingMonthAvailable: boolean;
  current: StudentMovementMonth | null; // the reporting month, when refreshed; else null
  months: StudentMovementMonth[]; // refreshed months ≤ reportingMonth, ascending (includes current)
};

const GYM_TIME_ZONE = 'America/New_York';
// Reporting month + the 12 before it, so the latest month always has a same-month-last-year partner.
const DEFAULT_MAX_MONTHS = 13;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const KEY_SET: ReadonlySet<string> = new Set(STUDENT_MOVEMENT_METRIC_KEYS);

// ── New York calendar math (Intl only; no hard-coded UTC offsets, so DST is handled) ──────────

const NY_WALL_CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: GYM_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function nyWallClock(instantMs: number) {
  const parts: Record<string, number> = {};
  for (const p of NY_WALL_CLOCK.formatToParts(new Date(instantMs))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return parts as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

// New York's UTC offset (ms, negative west of UTC) at an instant.
function nyOffsetMs(instantMs: number): number {
  const w = nyWallClock(instantMs);
  const wallAsUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return wallAsUtc - Math.floor(instantMs / 1000) * 1000;
}

// The UTC instant of 00:00 New York time on the 1st of 'YYYY-MM'. Midnight on the 1st never falls in a
// DST gap/overlap (transitions happen at 02:00), and the second pass re-reads the offset at the
// first estimate so the answer is right on either side of a transition.
export function nyMonthStartMs(month: string): number {
  const [y, m] = month.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, 1);
  const estimate = wall - nyOffsetMs(wall);
  return wall - nyOffsetMs(estimate);
}

// 'YYYY-MM' shifted by whole months — pure integer arithmetic.
export function shiftMonth(month: string, deltaMonths: number): string {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + deltaMonths;
  const ny = Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12;
  return `${ny}-${String(nm + 1).padStart(2, '0')}`;
}

// The previous calendar month in New York time, for an instant.
export function reportingMonthAt(nowIso: string): string {
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(nowMs)) throw new RangeError(`reportingMonthAt: invalid instant "${nowIso}"`);
  const w = nyWallClock(nowMs);
  return shiftMonth(`${w.year}-${String(w.month).padStart(2, '0')}`, -1);
}

// ── Build ──────────────────────────────────────────────────────────────────────────────────

type Cell = Partial<Record<StudentMovementMetricKey, StudentMetricRow>>;

export function buildStudentMovement(
  rows: StudentMetricRow[],
  nowIso: string,
  maxMonths: number = DEFAULT_MAX_MONTHS,
): StudentMovementView {
  const reportingMonth = reportingMonthAt(nowIso);

  const byMonth = new Map<string, Cell>();
  const newestAsOfMs = new Map<string, number>();
  for (const row of rows) {
    if (!MONTH_RE.test(row.periodMonth) || !KEY_SET.has(row.metricKey)) continue;
    const asOfMs = Date.parse(row.asOf);
    if (!Number.isFinite(row.value) || !Number.isFinite(asOfMs)) continue;
    const cell = byMonth.get(row.periodMonth) ?? {};
    const existing = cell[row.metricKey];
    // The table's key is unique per (month, metric, dimension); if a feed ever repeats one, the
    // newer write wins.
    if (!existing || asOfMs >= Date.parse(existing.asOf)) cell[row.metricKey] = row;
    byMonth.set(row.periodMonth, cell);
    newestAsOfMs.set(row.periodMonth, Math.max(newestAsOfMs.get(row.periodMonth) ?? 0, asOfMs));
  }

  const months: StudentMovementMonth[] = [...byMonth.keys()]
    .sort()
    .filter((month) => month <= reportingMonth) // never the current month, never the future
    .filter((month) => (newestAsOfMs.get(month) ?? 0) > nyMonthStartMs(shiftMonth(month, 1))) // refreshed
    .map((month) => {
      const cell = byMonth.get(month) as Cell;
      const baseRow = byMonth.get(shiftMonth(month, -1))?.active_students;
      const base = baseRow && baseRow.value > 0 ? baseRow.value : null;
      const baseAsOf = base !== null && baseRow?.sourceAsOf && DATE_RE.test(baseRow.sourceAsOf) ? baseRow.sourceAsOf : null;
      const cancellations = cell.cancellations?.value ?? null;
      return {
        month,
        newStudents: cell.new_students?.value ?? null,
        rejoins: cell.rejoins?.value ?? null,
        cancellations,
        base,
        baseAsOf,
        estimatedChurn:
          cancellations !== null && base !== null ? Math.round((cancellations / base) * 10000) / 10000 : null,
        refreshedAt: new Date(newestAsOfMs.get(month) as number).toISOString(),
      };
    })
    .slice(-Math.max(1, Math.floor(maxMonths)));

  const current = months.find((m) => m.month === reportingMonth) ?? null;
  return { reportingMonth, reportingMonthAvailable: current !== null, current, months };
}

// ── Copy helpers (deterministic strings the card renders) ──────────────────────────────────

const MONTH_NAMES_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function monthNameLong(month: string): string {
  return MONTH_NAMES_LONG[Number(month.slice(5, 7)) - 1] ?? month;
}

// 'September 2026' — the label every block carries, so months are never ambiguous.
export function monthLabelLong(month: string): string {
  return `${monthNameLong(month)} ${month.slice(0, 4)}`;
}

// 'YYYY-MM-DD' → 'Sep 28' (string math, no Date parsing).
export function formatCensusDate(date: string): string {
  return `${MONTH_NAMES_SHORT[Number(date.slice(5, 7)) - 1] ?? date.slice(5, 7)} ${Number(date.slice(8, 10))}`;
}

// 0.0791 → '7.9%'. null → '—'.
export function formatEstimatedChurn(churn: number | null): string {
  return churn === null ? '—' : `${(Math.round(churn * 1000) / 10).toFixed(1)}%`;
}

export function formatCount(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('en-US');
}

// 'Base: 265 students as of Sep 28', or the short reason there is none.
export function baseLine(m: StudentMovementMonth): { text: string; hasBase: boolean } {
  if (m.base === null) return { text: `No student count for ${monthNameLong(shiftMonth(m.month, -1))}`, hasBase: false };
  const when = m.baseAsOf ? `as of ${formatCensusDate(m.baseAsOf)}` : `(${monthNameLong(shiftMonth(m.month, -1))} count)`;
  return { text: `Base: ${m.base.toLocaleString('en-US')} students ${when}`, hasBase: true };
}

export function unavailableMessage(reportingMonth: string): string {
  return `${monthNameLong(reportingMonth)} data not available yet.`;
}
