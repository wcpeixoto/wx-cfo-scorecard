import { describe, expect, it } from 'vitest';

import type { CohortRetentionRow } from './fetchMemberRetentionByCohort';
import { computeCohortYoY } from './cohortRetentionYoY';

// Same idiom as memberRetentionCohortSeries.test.ts.
function pub(
  periodMonth: string,
  cohortBand: string,
  returning: number,
  lost: number,
  gained = 0,
): CohortRetentionRow {
  return { periodMonth, cohortBand, newMembers: gained, returningMembers: returning, lostMembers: lost, suppressed: false };
}
function suppressed(periodMonth: string, cohortBand: string): CohortRetentionRow {
  return { periodMonth, cohortBand, newMembers: null, returningMembers: null, lostMembers: null, suppressed: true };
}

// The seed month (2025-06) stays in the raw series; the live All view reports the first
// NON-seed month as dataBeginsMonth. Everything earlier is seed/pre-history.
const DATA_BEGINS = '2025-07';
const BAND = 'youth3to15' as const;

describe('computeCohortYoY — same-calendar-month, one year earlier', () => {
  it('valid YoY, retention improved → show / positive delta / better', () => {
    const rows = [pub('2025-07', BAND, 40, 10), pub('2026-07', BAND, 45, 5)]; // 80.0 → 90.0
    expect(
      computeCohortYoY({ rows, band: BAND, displayedMonth: '2026-07', dataBeginsMonth: DATA_BEGINS, metric: 'retention' }),
    ).toEqual({ status: 'show', deltaPp: 10, direction: 'better' });
  });

  it('valid YoY, retention declined → show / negative delta / worse', () => {
    const rows = [pub('2025-07', BAND, 40, 10), pub('2026-07', BAND, 35, 15)]; // 80.0 → 70.0
    expect(
      computeCohortYoY({ rows, band: BAND, displayedMonth: '2026-07', dataBeginsMonth: DATA_BEGINS, metric: 'retention' }),
    ).toEqual({ status: 'show', deltaPp: -10, direction: 'worse' });
  });

  it('exactly-equal YoY → show / zero delta / NEUTRAL (not hidden)', () => {
    const rows = [pub('2025-07', BAND, 40, 10), pub('2026-07', BAND, 40, 10)]; // 80.0 → 80.0
    expect(
      computeCohortYoY({ rows, band: BAND, displayedMonth: '2026-07', dataBeginsMonth: DATA_BEGINS, metric: 'retention' }),
    ).toEqual({ status: 'show', deltaPp: 0, direction: 'neutral' });
  });

  it('no year-ago history yet (partner month is pre-tracking) → hide', () => {
    // displayed 2025-08 → year-ago 2024-08, before dataBeginsMonth.
    const rows = [pub('2025-08', BAND, 40, 10)];
    expect(
      computeCohortYoY({ rows, band: BAND, displayedMonth: '2025-08', dataBeginsMonth: DATA_BEGINS, metric: 'retention' }),
    ).toEqual({ status: 'hide' });
  });

  it('suppressed CURRENT month → hide (never coerce to 0)', () => {
    const rows = [pub('2025-07', BAND, 40, 10), suppressed('2026-07', BAND)];
    expect(
      computeCohortYoY({ rows, band: BAND, displayedMonth: '2026-07', dataBeginsMonth: DATA_BEGINS, metric: 'retention' }),
    ).toEqual({ status: 'hide' });
  });

  it('suppressed YEAR-AGO month → hide (never coerce to 0)', () => {
    const rows = [suppressed('2025-07', BAND), pub('2026-07', BAND, 45, 5)];
    expect(
      computeCohortYoY({ rows, band: BAND, displayedMonth: '2026-07', dataBeginsMonth: DATA_BEGINS, metric: 'retention' }),
    ).toEqual({ status: 'hide' });
  });

  it('seed month AS TARGET → hide', () => {
    const rows = [pub('2024-06', BAND, 40, 10), pub('2025-06', BAND, 45, 5)];
    expect(
      computeCohortYoY({ rows, band: BAND, displayedMonth: '2025-06', dataBeginsMonth: DATA_BEGINS, metric: 'retention' }),
    ).toEqual({ status: 'hide' });
  });

  it('seed month AS YEAR-AGO → hide (this is why Jun-2026 shows no pill)', () => {
    // displayed 2026-06 → year-ago 2025-06 (the excluded seed).
    const rows = [pub('2025-06', BAND, 40, 10), pub('2026-06', BAND, 45, 5)];
    expect(
      computeCohortYoY({ rows, band: BAND, displayedMonth: '2026-06', dataBeginsMonth: DATA_BEGINS, metric: 'retention' }),
    ).toEqual({ status: 'hide' });
  });

  it('missing month (partner row absent from the series) → hide', () => {
    const rows = [pub('2026-07', BAND, 45, 5)]; // no 2025-07 row at all
    expect(
      computeCohortYoY({ rows, band: BAND, displayedMonth: '2026-07', dataBeginsMonth: DATA_BEGINS, metric: 'retention' }),
    ).toEqual({ status: 'hide' });
  });

  it('churn metric flips the delta sign but keeps the semantic direction', () => {
    // Same rows as the "retention improved" case: retention 80→90 ⇔ churn 20→10.
    const rows = [pub('2025-07', BAND, 40, 10), pub('2026-07', BAND, 45, 5)];
    const asRetention = computeCohortYoY({ rows, band: BAND, displayedMonth: '2026-07', dataBeginsMonth: DATA_BEGINS, metric: 'retention' });
    const asChurn = computeCohortYoY({ rows, band: BAND, displayedMonth: '2026-07', dataBeginsMonth: DATA_BEGINS, metric: 'churn' });
    expect(asRetention).toEqual({ status: 'show', deltaPp: 10, direction: 'better' });
    // churn fell 20→10: signed delta is negative, but a lower churn is still "better".
    expect(asChurn).toEqual({ status: 'show', deltaPp: -10, direction: 'better' });
  });

  it('custom window ending mid-series: reads the FULL raw series for the year-ago partner', () => {
    // Full series spans well past the displayed month; a short custom window ends at 2026-07
    // so displayedMonth = 2026-07 and year-ago 2025-07 lies OUTSIDE that window but is present
    // in the full rows — the comparator must still find it.
    const rows = [
      pub('2025-07', BAND, 40, 10), // year-ago partner, outside the display window
      pub('2025-08', BAND, 41, 9),
      pub('2026-06', BAND, 44, 6),
      pub('2026-07', BAND, 45, 5), // window's last visible month
      pub('2026-08', BAND, 46, 4), // later data exists but isn't the displayed month
    ];
    expect(
      computeCohortYoY({ rows, band: BAND, displayedMonth: '2026-07', dataBeginsMonth: DATA_BEGINS, metric: 'retention' }),
    ).toEqual({ status: 'show', deltaPp: 10, direction: 'better' });
  });
});
