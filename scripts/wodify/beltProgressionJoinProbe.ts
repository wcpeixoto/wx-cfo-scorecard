/**
 * Wodify Belt Progressions ⋈ client-grain Member Retention — CHURN-BY-BELT FEASIBILITY probe (pre-build gate).
 *
 * ┌─────────────────────────────────────────────────────────────────────────────────────────────┐
 * │ READ-ONLY. Reads three LOCAL exports, emits COUNTS ONLY. NO Supabase, NO write, NO DB, NO       │
 * │ table creation, NO build, NO import, NO commit. The network-free `--selftest` is always safe.   │
 * │ This is the gate that decides whether a Churn-by-Belt build is even feasible — it is NOT the     │
 * │ build. The readout goes to the Reviewer before any build/import is scoped.                       │
 * └─────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * INPUTS (all LOCAL, 0600, never committed — pass paths in any order; classified by header):
 *   (R)  client-grain "Member Retention" export — ID · Customer ID · First Of Month · Client ID ·
 *        Client Name · Change Type (New/Returning/Lost) · Positive/Negative Change · Membership ID.
 *        The #501 age-cohort source. CHURN POPULATION = distinct Client IDs with >=1 Lost.
 *   (68) Progressions "Current Levels" (ReportId 68) — Client ID · Client Name · Progression · Level ·
 *        Date Achieved (+ trailing tracker cols). Joins to the retention population by CLIENT ID.
 *   (69) Progressions "Previous Levels" (ReportId 69) — Client Name · Progression · Level ·
 *        Date Achieved · Promoted On · Days At Level · Client Active. **NO Client ID** — joins only by
 *        Client Name, bridged through 68/R (which carry both id + name). Name collisions are reported.
 *
 * The parse / belt-at-month reconstruction / Tier-2 banding / analysis / leak-scan / header-classify logic
 * now lives in the shared, typechecked, vitest-covered module src/lib/gym/beltRetentionAggregate.ts (SLICE 1
 * of the self-serve importer) — the SAME module the CLI build and the future upload edge function import, so
 * there is no logic fork and no drift. This probe is a thin LOCAL shell over it: file classification + the
 * network-free `--selftest` (which pins the join/bridge/reconstruction/sparsity behaviour) + the leak-guarded
 * live readout.
 *
 * SAFE-OUTPUT CONTRACT (mirrors retentionCohortJoinProbe / clientsDobFillProbe): local ONLY; never bundled /
 * VITE_*; Client IDs, names, dates read in memory, reduced to COUNTS + taxonomy LABELS + booleans + a verdict
 * enum; NEVER member names / Client IDs / emails / raw rows / YYYY-MM-DD day-level dates. The leak guard
 * (`scanForLeak`) re-scans the serialized output and ABORTS WITHOUT printing on any '@', >=7-digit run, or
 * day-level date. `--selftest` runs FIRST, makes NO network call and reads NO file.
 *
 * Run:
 *   npx tsx scripts/wodify/beltProgressionJoinProbe.ts --selftest                                  # no file/network
 *   npx tsx scripts/wodify/beltProgressionJoinProbe.ts <retention.csv> <current68.csv> <previous69.csv>
 */

import {
  parseRetention,
  parseCurrent,
  parsePrevious,
  analyze,
  classify,
  tier2Band,
  scanForLeak,
  type MatrixRow,
  type Kind,
} from '../../src/lib/gym/beltRetentionAggregate.ts';

// ─── SELF-TEST (network-free; synthetic 3-source data; join/bridge/reconstruction/sparsity + leak) ─────
function runSelfTest(): void {
  const NAME = 'ZZ_LEAK_NAME_SENTINEL';
  const ID = '98765432';
  const PII = [NAME, ID, 'leak@member.example'];
  const fail = (m: string): void => {
    console.error(`SELFTEST FAIL: ${m}`);
    process.exit(1);
  };

  // Retention: 6 clients. Active months 2025-06 & 2025-07 (mapped from First Of Month 2025-05 & 2025-06).
  // Churn (Lost): C1 (lost 2025-07), C5 (lost 2025-06), C6 (lost 2025-07, UNMATCHED to any belt).
  // DUP_NAME shared by C2 and C3 → ambiguous name bridge.
  const retHeader = 'ID,Customer ID,First Of Month,Client ID,Client Name,Change Type,Positive Change,Negative Change,Membership ID';
  const ret = [
    retHeader,
    `1,X,2025-05-01,C1,Alice,New,1,0,2000001`,
    `2,X,2025-06-01,C1,Alice,Lost,0,1,2000001`,
    `3,X,2025-05-01,C2,DUP_NAME,Returning,1,0,2000002`,
    `4,X,2025-06-01,C2,DUP_NAME,Returning,1,0,2000002`,
    `5,X,2025-05-01,C3,DUP_NAME,Returning,1,0,2000003`,
    `6,X,2025-05-01,C4,Bob,Returning,1,0,2000004`,
    `7,X,2025-06-01,C4,Bob,Returning,1,0,2000004`,
    `8,X,2025-05-01,C5,Carol,Lost,0,1,2000005`,
    `9,X,2025-06-01,C6,${NAME},Lost,0,1,${ID}`,
  ].join('\n');

  // Current 68: C1..C5 have a current belt (C6 absent → unmatched). Dates "MMM D, YYYY".
  const curHeader = 'Client ID,Client Name,Progression,Level,Date Achieved,Classes At Level,Clients → Client Active';
  const cur = [
    curHeader,
    `C1,Alice,Adults BJJ,Blue Belt,"Mar 1, 2025",10,Yes`,
    `C2,DUP_NAME,Adults BJJ,White Belt,"Jan 1, 2025",5,Yes`,
    `C3,DUP_NAME,Adults BJJ,White Belt,"Jan 1, 2025",5,Yes`,
    `C4,Bob,Kids BJJ,Grey White,"Feb 1, 2025",3,Yes`,
    `C5,Carol,Adults BJJ,Purple Belt,"Jun 1, 2024",20,No`,
  ].join('\n');

  // Previous 69: NO Client ID. Alice has a dated prior White Belt (Jan 2024) → multi-level history.
  // DUP_NAME row is AMBIGUOUS (maps to C2 & C3) → dropped from bridge. Ghost name → unmatched.
  const prevHeader = 'Client Name,Progression,Level,Date Achieved,Promoted On,Days At Level,Client Active';
  const prev = [
    prevHeader,
    `Alice,Adults BJJ,White Belt,"Jan 1, 2024","Mar 1, 2025",425,Yes`,
    `DUP_NAME,Adults BJJ,(none),"Jan 1, 2023","Jan 1, 2025",365,Yes`,
    `GhostMember,Adults BJJ,Blue Belt,"Jan 1, 2024","Jan 1, 2025",365,Yes`,
  ].join('\n');

  // Classification.
  if (classify(ret) !== 'retention') fail('classify retention');
  if (classify(cur) !== 'current68') fail('classify current68');
  if (classify(prev) !== 'previous69') fail('classify previous69');

  const res = analyze(parseRetention(ret), parseCurrent(cur), parsePrevious(prev));
  const ser = JSON.stringify(res, null, 2);
  console.log(ser);

  // Leak scans.
  const tokenLeaks = PII.filter((t) => ser.includes(t));
  if (tokenLeaks.length) fail(`planted PII leaked: ${tokenLeaks.join(', ')}`);
  const structLeaks = scanForLeak(ser);
  if (structLeaks.length) fail(`structural leak: ${structLeaks.join(', ')}`);

  // Assertions.
  const t2a = (lbl: string): MatrixRow | undefined => res.tier2Banding.active.find((r) => r.label === lbl);
  const t2c = (lbl: string): MatrixRow | undefined => res.tier2Banding.churn.find((r) => r.label === lbl);
  const checks: Array<[string, boolean]> = [
    ['header retention ok', res.headerValidation.retention.ok],
    ['header current68 ok', res.headerValidation.current68.ok],
    ['header previous69 ok', res.headerValidation.previous69.ok],
    ['previous69 hasPromotedOn', res.headerValidation.previous69.hasPromotedOn],
    ['all distinct = 6', res.joinCoverage.all.distinctClients === 6],
    ['all withCurrentBelt = 5 (C6 unmatched)', res.joinCoverage.all.withCurrentBelt === 5],
    ['churn distinct = 3 (C1,C5,C6)', res.joinCoverage.churn.distinctClients === 3],
    ['churn withCurrentBelt = 2 (C1,C5)', res.joinCoverage.churn.withCurrentBelt === 2],
    ['churn withoutBelt = 1 (C6)', res.joinCoverage.churn.withoutBelt === 1],
    // name bridge: Alice→unique, GhostMember→unmatched, DUP_NAME→ambiguous(C2,C3)
    ['bridge distinctNames = 3', res.nameBridge69.distinctNames === 3],
    ['bridge resolvedUnique = 1 (Alice)', res.nameBridge69.resolvedUniqueToId === 1],
    ['bridge ambiguous = 1 (DUP_NAME)', res.nameBridge69.ambiguousNames === 1],
    ['bridge unmatched = 1 (GhostMember)', res.nameBridge69.unmatchedNames === 1],
    ['bridge clientsWithPrevHistory = 1 (Alice/C1)', res.nameBridge69.clientsWithPreviousHistory === 1],
    // history depth: Alice has 2 dated levels (current Blue + prev White) → multiLevel=1; others onlyCurrent
    ['multiLevelDated = 1 (Alice)', res.reconstruction.historyDepth.multiLevelDated === 1],
    ['onlyCurrentLevel = 4 (C2,C3,C4,C5)', res.reconstruction.historyDepth.onlyCurrentLevel === 4],
    // taxonomy: Adults BJJ {Blue,White,Purple} + Kids BJJ {Grey White}
    ['taxonomy distinctLevels = 4', res.taxonomy.distinctLevels === 4],
    ['two progressions', res.taxonomy.progressions.length === 2],
    // reconstruction month 2025-06: active = C1,C2,C3,C4 (Returning/New mapped to 06). All have belt <= 06.
    ['2025-06 active = 4', res.reconstruction.perMonth[0].month === '2025-06' && res.reconstruction.perMonth[0].activeMembers === 4],
    ['2025-06 determinable = 4', res.reconstruction.perMonth[0].beltDeterminable === 4],
    // 2025-07: active = C2,C4 (mapped from First Of Month 2025-06 Returning).
    ['2025-07 active = 2', res.reconstruction.perMonth[1].month === '2025-07' && res.reconstruction.perMonth[1].activeMembers === 2],
    // churn suppression: C1 lost 2025-07 (Adults), C5 lost 2025-06 (Adults), C6 lost 2025-07 (unknown belt)
    ['coarse band has Adults BJJ', res.churnSuppression.byProgressionBand.some((r) => r.label === 'Adults BJJ')],
    ['churn unknown belt 2025-07 >= 1 (C6)', res.churnSuppression.churnUnknownBeltByMonth[1] >= 1],
    // Tier-2 banding function (stripe collapse + ordering edges)
    ['t2 fn: White N stripes → Adults: White', tier2Band('Adults BJJ|White Belt 2 stripes') === 'Adults: White'],
    ['t2 fn: Red/white → Adults: Brown+Black', tier2Band('Adults BJJ|Red/white belt') === 'Adults: Brown+Black'],
    ['t2 fn: Black → Adults: Brown+Black', tier2Band('Adults BJJ|Black Belt 1 stripe') === 'Adults: Brown+Black'],
    ['t2 fn: Grey/White → Kids: Grey-family (not White)', tier2Band('Kids BJJ|Grey/White Belt 1 Stripe') === 'Kids: Grey-family'],
    ['t2 fn: Orange/white → Kids: Yellow+Orange', tier2Band('Kids BJJ|Orange/white belt') === 'Kids: Yellow+Orange'],
    // Tier-2 matrices on synthetic data
    ['t2 active Adults: White 2025-06 = 2 (C2,C3)', t2a('Adults: White')?.byMonth[0] === 2],
    ['t2 active Adults: Blue 2025-06 = 1 (C1)', t2a('Adults: Blue')?.byMonth[0] === 1],
    ['t2 active Kids: Grey-family 2025-06 = 1 (C4)', t2a('Kids: Grey-family')?.byMonth[0] === 1],
    ['t2 churn Adults: Purple 2025-06 = 1 (C5)', t2c('Adults: Purple')?.byMonth[0] === 1],
    ['t2 churn Adults: Blue 2025-07 = 1 (C1)', t2c('Adults: Blue')?.byMonth[1] === 1],
    ['t2 activeUnknown 2025-06 = 0', res.tier2Banding.activeUnknownByMonth[0] === 0],
    ['t2 churnUnknown 2025-07 = 1 (C6)', res.tier2Banding.churnUnknownByMonth[1] === 1],
    ['t2 no Other band (all synthetic classified)', !res.tier2Banding.bands.includes('Other')],
    ['verdict feasibility_reported', res.verdict === 'feasibility_reported'],
  ];
  const failed = checks.filter(([, ok]) => !ok).map(([nm]) => nm);
  if (failed.length) fail(`assertions: ${failed.join('; ')}`);

  // Header-validation failure path.
  const badCur = analyze(parseRetention(ret), parseCurrent('Client ID,Client Name\nC1,Alice'), parsePrevious(prev));
  if (badCur.verdict !== 'header_validation_failed') fail('missing-column verdict');
  if (!badCur.headerValidation.current68.missing.includes('progression')) fail('missing-column list');

  // Leak-guard unit tests.
  if (scanForLeak(`{"x":"${ID}"}`).length === 0) fail('guard missed 7+ digit run');
  if (scanForLeak('{"x":"a@b"}').length === 0) fail('guard missed @');
  if (scanForLeak('{"x":"2020-01-01"}').length === 0) fail('guard missed YYYY-MM-DD');
  if (scanForLeak('{"month":"2025-06","Adults BJJ|Blue Belt":4}').length !== 0) fail('guard false-positived on month/label/counts');

  console.log(
    'SELFTEST PASS: header validation (incl missing-column verdict); Client-ID join coverage (all + churn); ' +
      'name-bridge 69 (unique/ambiguous/unmatched) — the no-Client-ID-in-69 hazard; dated multi-level ' +
      'reconstruction + active-panel coverage; level×month + churn suppression <5 flags; no planted ' +
      'PII/date leaked; leak-guard correct; no file or network touched.',
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
      'Usage: beltProgressionJoinProbe.ts <retention.csv> <current68.csv> <previous69.csv>  (any order; classified by header)\n' +
        '   or: beltProgressionJoinProbe.ts --selftest',
    );
    process.exit(1);
    return;
  }
  const { readFileSync } = await import('node:fs');
  const texts = paths.map((p) => readFileSync(p, 'utf8'));
  const bucket: Record<Kind, string | null> = { retention: null, current68: null, previous69: null, unknown: null };
  for (const t of texts) bucket[classify(t)] = t;
  if (!bucket.retention || !bucket.current68 || !bucket.previous69) {
    const seen = texts.map(classify);
    console.error(`Could not identify all three sources by header. Detected: ${seen.join(', ')}. Need retention + current68 + previous69.`);
    process.exit(1);
    return;
  }
  const res = analyze(parseRetention(bucket.retention), parseCurrent(bucket.current68), parsePrevious(bucket.previous69));
  const serialized = JSON.stringify(res, null, 2);
  const leaks = scanForLeak(serialized);
  if (leaks.length > 0) {
    console.error(`LIVE LEAK GUARD TRIPPED: ${leaks.join(', ')} — aborting WITHOUT printing.`);
    process.exit(1);
    return;
  }
  console.log(serialized);
}

const invokedDirectly = !!process.argv[1] && process.argv[1].endsWith('beltProgressionJoinProbe.ts');
if (invokedDirectly) void main();
