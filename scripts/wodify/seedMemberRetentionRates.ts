/**
 * Seed `public.member_retention_rates` from the local Wodify "Member Retention Rates" CSV —
 * emits idempotent UPSERT SQL for a GATED Supabase MCP `execute_sql` run.
 *
 * LOCAL ONLY. Reads a local NON-PII monthly-aggregate CSV. Writes NOTHING anywhere — it prints SQL
 * to stdout for a human to apply under an authorized Supabase MCP run (the silent_dues_snapshot
 * precedent). The real numbers appear ONLY in the emitted SQL — this script carries none, and the
 * CSV is gitignored (the repo is PUBLIC; member counts/churn are business-sensitive).
 *
 * Parsing/validation/boundary now come from the SHARED core in
 * src/lib/gym/memberRetentionImport.ts — the SAME module the click-only Settings → Data import UI
 * uses, so the two paths can't drift. That core reads the RAW Wodify export AS-IS (no hand-normalized
 * CSV needed): headers `ID, Customer ID, First Of Month, Current Month Members, Last Month Members,
 * Last Month Lost Members, Last Month New Members, Retention Rate`, dates like "Jun 1, 2025", and
 * quoted thousands-comma counts ("11,358").
 *
 * The earliest period_month is flagged `is_seed_boundary = true`: there is no real prior-period
 * retention before member tracking began, so that row is the tracking-onboarding boundary and is
 * excluded from the trend (AGENTS.md:299 — "No fake history").
 *
 * Run:
 *   npx tsx scripts/wodify/seedMemberRetentionRates.ts --selftest          # synthetic, reads no file
 *   npx tsx scripts/wodify/seedMemberRetentionRates.ts /path/to/member_retention.csv
 */

import { readFileSync } from 'node:fs';

import { parseWodifyRetentionCsv } from '../../src/lib/gym/memberRetentionImport.ts';
import type { RetentionMonth } from '../../src/lib/gym/memberRetentionSeries.ts';

const TABLE = 'public.member_retention_rates';
const WORKSPACE_ID = 'default';

function buildSql(rows: RetentionMonth[]): string {
  if (rows.length === 0) return '-- no rows parsed';
  const values = rows
    .map(
      (r) =>
        `  ('${WORKSPACE_ID}', '${r.periodMonth}', ${r.currentMembers}, ${r.priorMembers}, ` +
        `${r.lostMembers}, ${r.newMembers}, ${r.returningMembers}, ${r.retentionRate}, ` +
        `${r.isSeedBoundary})`,
    )
    .join(',\n');
  return [
    `insert into ${TABLE}`,
    '  (workspace_id, period_month, current_members, prior_members, lost_members, new_members,',
    '   returning_members, retention_rate, is_seed_boundary)',
    'values',
    values,
    'on conflict (workspace_id, period_month) do update set',
    '  current_members   = excluded.current_members,',
    '  prior_members     = excluded.prior_members,',
    '  lost_members      = excluded.lost_members,',
    '  new_members       = excluded.new_members,',
    '  returning_members = excluded.returning_members,',
    '  retention_rate    = excluded.retention_rate,',
    '  is_seed_boundary  = excluded.is_seed_boundary,',
    '  fetched_at        = now();',
  ].join('\n');
}

function runSelfTest(): void {
  // Synthetic RAW Wodify export — NOT real figures (kept out of this public repo). Includes the
  // required-but-ignored ID / Customer ID columns, a quoted date, and an out-of-order row.
  const csv = [
    'ID,Customer ID,First Of Month,Current Month Members,Last Month Members,Last Month Lost Members,Last Month New Members,Retention Rate',
    '2,1002,"Jul 1, 2025",210,200,18,28,0.91',
    '1,1001,"Jun 1, 2025",200,90,3,113,0.97', // deliberately out of order — must sort earliest-first
  ].join('\n');
  const parsed = parseWodifyRetentionCsv(csv);
  const sql = buildSql(parsed.rows);
  const fails: string[] = [];
  if (parsed.issues.length !== 0) fails.push(`unexpected validation issues: ${parsed.issues.map((i) => i.message).join(' | ')}`);
  if (parsed.rows.length !== 2) fails.push('row count');
  if (parsed.rows[0]?.periodMonth !== '2025-06') fails.push('earliest-first sort');
  if (parsed.rows[0]?.returningMembers !== 87) fails.push('returning derived (prior − lost)');
  if (!sql.includes("'2025-06', 200, 90, 3, 113, 87, 0.97, true")) fails.push('boundary flagged true');
  if (!sql.includes("'2025-07', 210, 200, 18, 28, 182, 0.91, false")) fails.push('non-boundary flagged false');
  if (!sql.includes('on conflict (workspace_id, period_month) do update set')) fails.push('idempotent upsert');
  if (fails.length > 0) {
    console.error(`SELFTEST FAIL: ${fails.join('; ')}`);
    process.exit(1);
    return;
  }
  console.log('SELFTEST PASS: shared raw-export parse + earliest-first sort + derived returning + boundary flag + idempotent upsert SQL correct (no file read).');
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes('--selftest')) {
    runSelfTest();
    return;
  }
  const path = args.find((a) => !a.startsWith('--'));
  if (!path) {
    console.error('Usage: npx tsx scripts/wodify/seedMemberRetentionRates.ts <member_retention.csv> [--selftest]');
    process.exit(1);
    return;
  }
  const parsed = parseWodifyRetentionCsv(readFileSync(path, 'utf8'));
  if (parsed.issues.length > 0) {
    console.error('-- import rejected; no SQL emitted:');
    for (const issue of parsed.issues) console.error(`--   ${issue.message}`);
    process.exit(1);
    return;
  }
  console.error(`-- ${parsed.rows.length} monthly rows parsed; earliest ${parsed.rows[0].periodMonth} flagged is_seed_boundary=true.`);
  console.log(buildSql(parsed.rows));
}

main();
