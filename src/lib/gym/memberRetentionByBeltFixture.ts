// SAMPLE (synthetic) Churn-by-Belt rows — renders the card with a "Sample data" badge until the live
// `member_retention_by_belt` table is reachable. These counts are FABRICATED and internally plausible
// (larger panels at the lower belts, small monthly losses); they are NOT the real gym figures. The
// real per-band aggregate is business-sensitive and lives only in Supabase (anon-readable, never
// committed) — see scripts/wodify/buildMemberRetentionByBelt.ts.
//
// Shape matches the live fetch (BeltRetentionRow) so the card's transform is identical on sample and
// live. Covers all 4 adults + 3 kids bands across 13 months so every line paints and the legend fills.

import type { BeltRetentionRow } from './fetchMemberRetentionByBelt';
import { ADULTS_BANDS, KIDS_BANDS } from './memberRetentionByBeltSeries';

const SAMPLE_MONTHS = [
  '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12',
  '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06',
] as const;

// Per-band [active[], lost[]] across SAMPLE_MONTHS (length 13 each).
const ADULTS_PANELS: Record<(typeof ADULTS_BANDS)[number], [number[], number[]]> = {
  White: [
    [42, 44, 41, 45, 43, 46, 44, 45, 47, 44, 46, 45, 48],
    [4, 5, 3, 6, 4, 5, 3, 4, 5, 4, 6, 3, 4],
  ],
  Blue: [
    [28, 30, 29, 31, 30, 32, 31, 30, 32, 33, 31, 32, 34],
    [2, 3, 2, 3, 2, 2, 3, 2, 1, 2, 3, 2, 2],
  ],
  Purple: [
    [14, 15, 15, 16, 16, 15, 17, 16, 17, 18, 17, 18, 18],
    [1, 1, 2, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1],
  ],
  'Brown+Black': [
    [8, 8, 9, 9, 10, 9, 10, 11, 10, 11, 11, 10, 11],
    [0, 1, 1, 0, 1, 0, 1, 0, 1, 1, 0, 1, 0],
  ],
};

const KIDS_PANELS: Record<(typeof KIDS_BANDS)[number], [number[], number[]]> = {
  White: [
    [30, 32, 31, 33, 32, 34, 33, 32, 34, 35, 33, 34, 36],
    [3, 4, 3, 4, 3, 3, 4, 3, 2, 3, 4, 3, 3],
  ],
  'Grey-family': [
    [18, 19, 19, 20, 20, 21, 20, 21, 22, 21, 22, 21, 22],
    [2, 2, 1, 2, 2, 1, 2, 1, 2, 2, 1, 2, 1],
  ],
  'Yellow+Orange': [
    [12, 13, 13, 14, 14, 15, 14, 15, 16, 15, 16, 15, 16],
    [1, 1, 2, 1, 1, 1, 2, 1, 1, 2, 1, 1, 1],
  ],
};

function expand(
  segment: 'adults' | 'kids',
  panels: Record<string, [number[], number[]]>,
): BeltRetentionRow[] {
  const rows: BeltRetentionRow[] = [];
  for (const [beltBand, [active, lost]] of Object.entries(panels)) {
    SAMPLE_MONTHS.forEach((periodMonth, i) => {
      rows.push({ periodMonth, segment, beltBand, activeCount: active[i], lostCount: lost[i] });
    });
  }
  return rows;
}

export const SAMPLE_BELT_ROWS: BeltRetentionRow[] = [
  ...expand('adults', ADULTS_PANELS),
  ...expand('kids', KIDS_PANELS),
];
