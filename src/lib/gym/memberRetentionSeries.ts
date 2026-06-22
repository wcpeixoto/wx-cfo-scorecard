// Class Plan Member Retention — monthly membership/renewal retention series.
//
// PURE transform layer (no React, no I/O): turns the Wodify "Member Retention Rates" monthly
// aggregate into an honest, windowed time-series for the evolution chart. This is the unit-tested
// core; the fetch module and the card are thin shells over it.
//
// HONEST HISTORY (AGENTS.md:299 — "No fake history"):
//   - The seed / tracking-onboarding boundary month (`isSeedBoundary` — e.g. the first row where
//     prior/new/rate reflect tracking turn-on, not a real month-over-month retention) is EXCLUDED
//     from the trend. The real series begins the month after.
//   - A requested timeframe deeper than the tracked history renders the AVAILABLE window only;
//     pre-history is NEVER interpolated or zero-padded. `dataBeginsMonth` + `windowExceedsData` let
//     the card say "data begins {month}" instead of fabricating earlier points.
//   - Rates come straight from the report's own returning/prior; no current↔prior re-chaining (a
//     1–6 member drift between a month's `current` and the next month's `prior` exists by design).

export type RetentionMonth = {
  periodMonth: string; // 'YYYY-MM'
  currentMembers: number;
  priorMembers: number;
  lostMembers: number;
  newMembers: number;
  returningMembers: number;
  retentionRate: number; // 0..1 — the report's own returning/prior
  isSeedBoundary: boolean; // tracking-onboarding boundary — excluded from the trend
};

export type RetentionTimeframeId = '6m' | '1y' | '2y' | 'all' | 'custom';

export type RetentionTimeframeOption = {
  value: RetentionTimeframeId;
  label: string;
  months: number; // window length; Number.POSITIVE_INFINITY for 'all'; 0 for 'custom' (uses range)
};

export const RETENTION_TIMEFRAME_OPTIONS: readonly RetentionTimeframeOption[] = [
  { value: '6m', label: 'Last 6 months', months: 6 },
  { value: '1y', label: 'Last 1 year', months: 12 },
  { value: '2y', label: 'Last 2 years', months: 24 },
  { value: 'all', label: 'All time', months: Number.POSITIVE_INFINITY },
  { value: 'custom', label: 'Custom range', months: 0 },
];

export const DEFAULT_RETENTION_TIMEFRAME: RetentionTimeframeId = '6m';

export type RetentionEvolutionPoint = {
  periodMonth: string;
  retentionPct: number; // retentionRate * 100, 1 decimal
  returningMembers: number;
  priorMembers: number;
  lostMembers: number;
  newMembers: number;
  currentMembers: number;
};

export type TimeframeSelection =
  | { kind: 'preset'; months: number }
  | { kind: 'custom'; startMonth: string; endMonth: string };

export type RetentionEvolutionView = {
  points: RetentionEvolutionPoint[];
  dataBeginsMonth: string | null; // earliest REAL (non-boundary) month available
  windowExceedsData: boolean; // requested window reaches before dataBeginsMonth
  isEmpty: boolean;
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatMonthShort(periodMonth: string): string {
  const [y, mm] = periodMonth.split('-');
  const idx = Number.parseInt(mm, 10) - 1;
  return `${MONTH_NAMES[idx] ?? mm} ${y.slice(2)}`;
}

export function formatMonthLong(periodMonth: string): string {
  const [y, mm] = periodMonth.split('-');
  const idx = Number.parseInt(mm, 10) - 1;
  return `${MONTH_NAMES[idx] ?? mm} ${y}`;
}

function toPoint(m: RetentionMonth): RetentionEvolutionPoint {
  return {
    periodMonth: m.periodMonth,
    retentionPct: Math.round(m.retentionRate * 1000) / 10,
    returningMembers: m.returningMembers,
    priorMembers: m.priorMembers,
    lostMembers: m.lostMembers,
    newMembers: m.newMembers,
    currentMembers: m.currentMembers,
  };
}

/** Real (non-boundary) months, sorted ascending by period. The seed/onboarding row is dropped. */
export function realRetentionMonths(months: RetentionMonth[]): RetentionMonth[] {
  return months
    .filter((m) => !m.isSeedBoundary)
    .slice()
    .sort((a, b) => a.periodMonth.localeCompare(b.periodMonth));
}

export function selectionFor(
  timeframe: RetentionTimeframeId,
  custom?: { startMonth: string; endMonth: string },
): TimeframeSelection {
  if (timeframe === 'custom') {
    // No range yet → fall back to the full available window (never a 1-month default).
    if (custom) return { kind: 'custom', startMonth: custom.startMonth, endMonth: custom.endMonth };
    return { kind: 'preset', months: Number.POSITIVE_INFINITY };
  }
  const opt = RETENTION_TIMEFRAME_OPTIONS.find((o) => o.value === timeframe);
  return { kind: 'preset', months: opt ? opt.months : 6 };
}

export function buildRetentionEvolutionView(
  months: RetentionMonth[],
  selection: TimeframeSelection,
): RetentionEvolutionView {
  const real = realRetentionMonths(months);
  if (real.length === 0) {
    return { points: [], dataBeginsMonth: null, windowExceedsData: false, isEmpty: true };
  }
  const dataBeginsMonth = real[0].periodMonth;

  let windowed: RetentionMonth[];
  let windowExceedsData = false;

  if (selection.kind === 'custom') {
    windowed = real.filter(
      (m) => m.periodMonth >= selection.startMonth && m.periodMonth <= selection.endMonth,
    );
    windowExceedsData = selection.startMonth < dataBeginsMonth;
  } else if (!Number.isFinite(selection.months)) {
    windowed = real; // 'all' — every tracked month
  } else {
    const n = Math.max(1, Math.floor(selection.months));
    windowed = real.slice(-n);
    windowExceedsData = n > real.length; // asked for more months than have ever been tracked
  }

  return {
    points: windowed.map(toPoint),
    dataBeginsMonth,
    windowExceedsData,
    isEmpty: windowed.length === 0,
  };
}
