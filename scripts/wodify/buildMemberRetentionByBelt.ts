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
  buildBeltPayload,
  canonicalize,
  type ProbeResult,
  type PayloadRow,
  type BeltPayload,
} from '../../src/lib/gym/beltRetentionAggregate.ts';

// The persisted payload = the pure BeltPayload (rows + conservation + name-bridge, from the shared src
// module) PLUS the sha256 integrity hash. node:crypto stays HERE in the CLI wrapper, out of the pure module;
// BuildOutput's shape is UNCHANGED from before the Slice-1 extraction (byte-identical stdout).
type BuildOutput = BeltPayload & { payloadSha256: string };

function buildPayload(res: ProbeResult): BuildOutput {
  const payload = buildBeltPayload(res);
  return { ...payload, payloadSha256: createHash('sha256').update(canonicalize(payload.rows)).digest('hex') };
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
