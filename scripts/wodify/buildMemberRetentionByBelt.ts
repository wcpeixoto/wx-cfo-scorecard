/**
 * Churn-by-Belt — Phase A BUILD (DRAFT + DRY-RUN). Produces the COUNTS-ONLY import payload for
 * member_retention_by_belt from the three LOCAL Wodify exports, reusing the VALIDATED probe parse
 * (scripts/wodify/beltProgressionJoinProbe.ts — no duplicated logic, no drift).
 *
 * ┌─────────────────────────────────────────────────────────────────────────────────────────────┐
 * │ READ-ONLY of local files. Emits a dry-run payload + conservation checks + a sha256. It does     │
 * │ NOT touch Supabase, NOT apply_migration, NOT execute_sql, NOT write any DB. The gated import     │
 * │ (Reviewer PASS + owner GO, manual permission mode) is a SEPARATE step. `--selftest` is always    │
 * │ network-free and file-free.                                                                      │
 * └─────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * INPUTS (local 0600, never committed — any order, classified by header inside the probe):
 *   ~/.config/wx-cfo/member_retention_client_grain_2026-06-24.csv  (#501 client-grain retention)
 *   ~/.config/wx-cfo/belt_current_levels_2026-06-29.csv            (Report 68 — Current Levels)
 *   ~/.config/wx-cfo/belt_previous_levels_2026-06-29.csv           (Report 69 — Previous Levels)
 *
 * LOCKED banding (feasibility gate CLOSED — not re-derived). UNKNOWN is its own segment/row, never a band.
 *
 * Output payload rows (the exact shape the gated import upserts): the FULL deterministic grid —
 * 7 bands × 13 months + 13 unknown rows = 104 rows; counts (incl. true 0) published as-is (no <5 masking).
 *
 * Run:
 *   npx tsx scripts/wodify/buildMemberRetentionByBelt.ts --selftest                                # no file/network
 *   npx tsx scripts/wodify/buildMemberRetentionByBelt.ts \
 *     ~/.config/wx-cfo/member_retention_client_grain_2026-06-24.csv \
 *     ~/.config/wx-cfo/belt_current_levels_2026-06-29.csv \
 *     ~/.config/wx-cfo/belt_previous_levels_2026-06-29.csv
 */

import { createHash } from 'node:crypto';

import {
  parseRetention,
  parseCurrent,
  parsePrevious,
  analyze,
  scanForLeak,
  type ProbeResult,
} from './beltProgressionJoinProbe.ts';

const WORKSPACE_ID = 'default';

// Locked segment → belt_band allowlist, in canonical emit order. MUST match the DDL
// member_retention_by_belt_band_chk constraint exactly (SQL ↔ build cannot drift).
const SCHEMA_SEGMENT_BAND_ALLOWLIST: { segment: string; bands: string[] }[] = [
  { segment: 'adults', bands: ['White', 'Blue', 'Purple', 'Brown+Black'] },
  { segment: 'kids', bands: ['White', 'Grey-family', 'Yellow+Orange'] },
  { segment: 'unknown', bands: ['unknown'] },
];

// (segment, belt_band) → the probe's Tier-2 active/churn matrix label.
function tier2Label(segment: string, band: string): string {
  if (segment === 'adults') return `Adults: ${band}`;
  if (segment === 'kids') return `Kids: ${band}`;
  return 'unknown'; // segment 'unknown' is sourced from the unknown lines, not the band matrices
}

interface PayloadRow {
  workspace_id: string;
  period_month: string;
  segment: string;
  belt_band: string;
  active_count: number;
  lost_count: number;
}
interface MonthConservation {
  month: string;
  activeSum: number;
  activeExpected: number;
  activeOk: boolean;
  lostSum: number;
  lostExpected: number;
  lostOk: boolean;
}
interface BuildOutput {
  table: 'member_retention_by_belt';
  workspace_id: string;
  months: string[];
  nameBridge69: ProbeResult['nameBridge69'] & { collisionFree: boolean };
  rowCount: number;
  rows: PayloadRow[];
  conservation: { perMonth: MonthConservation[]; allActiveOk: boolean; allLostOk: boolean };
  payloadSha256: string;
}

// Stable serialization for hashing: rows sorted + fixed key order.
function canonicalize(rows: PayloadRow[]): string {
  const sorted = [...rows].sort((a, b) =>
    a.segment !== b.segment
      ? a.segment.localeCompare(b.segment)
      : a.belt_band !== b.belt_band
        ? a.belt_band.localeCompare(b.belt_band)
        : a.period_month.localeCompare(b.period_month),
  );
  return JSON.stringify(
    sorted.map((r) => [r.workspace_id, r.period_month, r.segment, r.belt_band, r.active_count, r.lost_count]),
  );
}

function buildPayload(res: ProbeResult): BuildOutput {
  const months = res.months;
  const n = months.length;

  // Index the probe's Tier-2 matrices by label for O(1) lookup; absent label/month → 0.
  const activeByLabel = new Map<string, number[]>();
  for (const r of res.tier2Banding.active) activeByLabel.set(r.label, r.byMonth);
  const churnByLabel = new Map<string, number[]>();
  for (const r of res.tier2Banding.churn) churnByLabel.set(r.label, r.byMonth);
  const at = (m: Map<string, number[]>, label: string, mi: number): number => m.get(label)?.[mi] ?? 0;

  // Emit the full deterministic grid: every allowlisted (segment, band) × month, plus unknown × month.
  const rows: PayloadRow[] = [];
  for (const { segment, bands } of SCHEMA_SEGMENT_BAND_ALLOWLIST) {
    for (const band of bands) {
      for (let mi = 0; mi < n; mi++) {
        const active =
          segment === 'unknown' ? res.tier2Banding.activeUnknownByMonth[mi] : at(activeByLabel, tier2Label(segment, band), mi);
        const lost =
          segment === 'unknown' ? res.tier2Banding.churnUnknownByMonth[mi] : at(churnByLabel, tier2Label(segment, band), mi);
        rows.push({
          workspace_id: WORKSPACE_ID,
          period_month: months[mi],
          segment,
          belt_band: band,
          active_count: active,
          lost_count: lost,
        });
      }
    }
  }

  // Two CONSERVATION checks per month: Σ active (all bands + unknown) ties the active-panel total; Σ lost
  // (all bands + unknown) ties total retention Lost. These prove the reshape neither drops nor double-counts.
  const perMonth: MonthConservation[] = months.map((month, mi) => {
    const monthRows = rows.filter((r) => r.period_month === month);
    const activeSum = monthRows.reduce((s, r) => s + r.active_count, 0);
    const lostSum = monthRows.reduce((s, r) => s + r.lost_count, 0);
    const activeExpected = res.reconstruction.perMonth[mi].activeMembers;
    const lostExpected = res.churnSuppression.lostTotalByMonth[mi];
    return {
      month,
      activeSum,
      activeExpected,
      activeOk: activeSum === activeExpected,
      lostSum,
      lostExpected,
      lostOk: lostSum === lostExpected,
    };
  });

  const collisionFree = res.nameBridge69.ambiguousNames === 0 && res.nameBridge69.unmatchedNames === 0;

  return {
    table: 'member_retention_by_belt',
    workspace_id: WORKSPACE_ID,
    months,
    nameBridge69: { ...res.nameBridge69, collisionFree },
    rowCount: rows.length,
    rows,
    conservation: {
      perMonth,
      allActiveOk: perMonth.every((p) => p.activeOk),
      allLostOk: perMonth.every((p) => p.lostOk),
    },
    payloadSha256: createHash('sha256').update(canonicalize(rows)).digest('hex'),
  };
}

// ─── SELF-TEST (network-free; synthetic 3-source; reshape + conservation + sha stability + leak) ─────
function runSelfTest(): void {
  const fail = (m: string): void => {
    console.error(`SELFTEST FAIL: ${m}`);
    process.exit(1);
  };

  // C1 Alice: Adults Blue, active 2025-06 & 2025-07, then Lost 2025-08. C2 Bob: Kids Grey/White, active
  // 2025-06. C3 Carol: Adults Purple, Lost 2025-06. C4 Ghost: Lost 2025-07, NO belt → UNKNOWN.
  const ret = [
    'ID,Customer ID,First Of Month,Client ID,Client Name,Change Type,Positive Change,Negative Change,Membership ID',
    '1,X,2025-05-01,C1,Alice,New,1,0,2000001',
    '2,X,2025-06-01,C1,Alice,Returning,1,0,2000001',
    '3,X,2025-07-01,C1,Alice,Lost,0,1,2000001',
    '4,X,2025-05-01,C2,Bob,Returning,1,0,2000002',
    '5,X,2025-05-01,C3,Carol,Lost,0,1,2000003',
    '6,X,2025-06-01,C4,GhostMember,Lost,0,1,2000004',
  ].join('\n');
  const cur = [
    'Client ID,Client Name,Progression,Level,Date Achieved,Classes At Level,Clients → Client Active',
    'C1,Alice,Adults BJJ,Blue Belt,"Mar 1, 2025",10,Yes',
    'C2,Bob,Kids BJJ,Grey/White Belt,"Feb 1, 2025",3,Yes',
    'C3,Carol,Adults BJJ,Purple Belt,"Jun 1, 2024",20,No',
    // C4 absent → no current belt → UNKNOWN when lost.
  ].join('\n');
  const prev = [
    'Client Name,Progression,Level,Date Achieved,Promoted On,Days At Level,Client Active',
    'Alice,Adults BJJ,White Belt,"Jan 1, 2024","Mar 1, 2025",425,Yes',
  ].join('\n');

  const res = analyze(parseRetention(ret), parseCurrent(cur), parsePrevious(prev));
  const out = buildPayload(res);
  const ser = JSON.stringify(out, null, 2);

  // The sha256 digest is intended output and can contain a 7+ digit run by chance — exclude it from the
  // ID-shaped leak scan (the data rows are still scanned).
  const leaks = scanForLeak(ser.replaceAll(out.payloadSha256, 'SHA256'));
  if (leaks.length) fail(`leak: ${leaks.join(', ')}`);

  const find = (seg: string, band: string, month: string): PayloadRow | undefined =>
    out.rows.find((r) => r.segment === seg && r.belt_band === band && r.period_month === month);

  const checks: Array<[string, boolean]> = [
    ['row count = 104 (7 bands×13 + 13 unknown)', out.rowCount === 104],
    ['name bridge collisionFree', out.nameBridge69.collisionFree],
    ['conservation: all active months tie', out.conservation.allActiveOk],
    ['conservation: all lost months tie', out.conservation.allLostOk],
    // active 2025-06: Alice(Adults Blue), Bob(Kids Grey-family). mi=0
    ['adults Blue active 2025-06 = 1', find('adults', 'Blue', '2025-06')?.active_count === 1],
    ['kids Grey-family active 2025-06 = 1', find('kids', 'Grey-family', '2025-06')?.active_count === 1],
    ['adults White active 2025-06 = 0 (emitted zero)', find('adults', 'White', '2025-06')?.active_count === 0],
    // lost: Carol(Adults Purple) 2025-06; Alice(Adults Blue) 2025-07; Ghost UNKNOWN 2025-07
    ['adults Purple lost 2025-06 = 1 (Carol, FoM 2025-05→06)', find('adults', 'Purple', '2025-06')?.lost_count === 1],
    ['adults Blue lost 2025-08 = 1 (Alice, FoM 2025-07→08)', find('adults', 'Blue', '2025-08')?.lost_count === 1],
    ['unknown lost 2025-07 = 1 (Ghost)', find('unknown', 'unknown', '2025-07')?.lost_count === 1],
    ['unknown is its own segment row', !!find('unknown', 'unknown', '2025-06')],
    ['sha256 is 64-hex', /^[0-9a-f]{64}$/.test(out.payloadSha256)],
    ['sha256 stable across rebuild', buildPayload(res).payloadSha256 === out.payloadSha256],
  ];
  const failed = checks.filter(([, ok]) => !ok).map(([nm]) => nm);
  if (failed.length) fail(`assertions: ${failed.join('; ')}`);

  console.log(`payloadSha256=${out.payloadSha256}`);
  console.log(
    'SELFTEST PASS: reshape to 104-row grid; UNKNOWN as its own segment row; conservation (active + lost) ' +
      'ties per month; name-bridge collision flag; sha256 stable; no leak; no file/network touched.',
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  if (process.argv.includes('--selftest')) {
    runSelfTest();
    return;
  }
  const paths = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (paths.length !== 3) {
    console.error(
      'Usage: buildMemberRetentionByBelt.ts <retention.csv> <current68.csv> <previous69.csv>  (any order)\n' +
        '   or: buildMemberRetentionByBelt.ts --selftest',
    );
    process.exit(1);
    return;
  }
  const { readFileSync } = await import('node:fs');
  const texts = paths.map((p) => readFileSync(p, 'utf8'));
  // Classify the three by header — try each text against each parser's required-column validation.
  // Check order matters: current68 (has Client ID) is tested before previous69 (no Client ID) so the
  // two progression files, which share progression/level/dateAchieved, route correctly.
  let retText: string | null = null;
  let curText: string | null = null;
  let prevText: string | null = null;
  for (const t of texts) {
    if (parseRetention(t).ok && /change\s*type/i.test(t.split('\n')[0])) retText = t;
    else if (parseCurrent(t).ok) curText = t;
    else if (parsePrevious(t).ok) prevText = t;
  }
  if (!retText || !curText || !prevText) {
    console.error('Could not identify all three sources by header (need retention + current68 + previous69).');
    process.exit(1);
    return;
  }
  const res = analyze(parseRetention(retText), parseCurrent(curText), parsePrevious(prevText));
  const out = buildPayload(res);
  const serialized = JSON.stringify(out, null, 2);
  // Exclude the intended sha256 digest from the ID-shaped leak scan (see selftest note).
  const leaks = scanForLeak(serialized.replaceAll(out.payloadSha256, 'SHA256'));
  if (leaks.length > 0) {
    console.error(`LIVE LEAK GUARD TRIPPED: ${leaks.join(', ')} — aborting WITHOUT printing.`);
    process.exit(1);
    return;
  }
  console.log(serialized);
}

void main();
