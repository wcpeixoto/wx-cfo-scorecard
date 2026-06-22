/**
 * Seed `public.member_retention_rates` from the local Wodify "Member Retention Rates" CSV —
 * emits idempotent UPSERT SQL for a GATED Supabase MCP `execute_sql` run.
 *
 * LOCAL ONLY. Reads a local NON-PII monthly-aggregate CSV. Writes NOTHING anywhere — it prints SQL
 * to stdout for a human to apply under an authorized Supabase MCP run (the silent_dues_snapshot
 * precedent). The real numbers appear ONLY in the emitted SQL — this script carries none, and the
 * CSV is gitignored (the repo is PUBLIC; member counts/churn are business-sensitive).
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

const TABLE = 'public.member_retention_rates';
const WORKSPACE_ID = 'default';
const REQUIRED = [
  'period_month',
  'current_members',
  'prior_members',
  'lost_members',
  'new_members',
  'returning_members',
  'retention_rate',
] as const;

type Row = {
  period_month: string;
  current_members: number;
  prior_members: number;
  lost_members: number;
  new_members: number;
  returning_members: number;
  retention_rate: number;
};

function parse(text: string): Row[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) throw new Error('CSV has no data rows');
  const header = lines[0].split(',').map((h) => h.trim());
  for (const col of REQUIRED) {
    if (!header.includes(col)) throw new Error(`CSV missing required column: ${col}`);
  }
  const at = (c: (typeof REQUIRED)[number]) => header.indexOf(c);
  const rows: Row[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const periodMonth = (cells[at('period_month')] ?? '').trim();
    if (!/^\d{4}-\d{2}$/.test(periodMonth)) throw new Error(`bad period_month on line ${i + 1}: "${periodMonth}"`);
    const num = (c: (typeof REQUIRED)[number]): number => {
      const v = Number((cells[at(c)] ?? '').trim());
      if (!Number.isFinite(v)) throw new Error(`non-numeric ${c} on line ${i + 1}`);
      return v;
    };
    rows.push({
      period_month: periodMonth,
      current_members: num('current_members'),
      prior_members: num('prior_members'),
      lost_members: num('lost_members'),
      new_members: num('new_members'),
      returning_members: num('returning_members'),
      retention_rate: num('retention_rate'),
    });
  }
  rows.sort((a, b) => a.period_month.localeCompare(b.period_month));
  return rows;
}

function buildSql(rows: Row[]): string {
  if (rows.length === 0) return '-- no rows parsed';
  const boundary = rows[0].period_month; // earliest tracked month = onboarding boundary
  const values = rows
    .map(
      (r) =>
        `  ('${WORKSPACE_ID}', '${r.period_month}', ${r.current_members}, ${r.prior_members}, ` +
        `${r.lost_members}, ${r.new_members}, ${r.returning_members}, ${r.retention_rate}, ` +
        `${r.period_month === boundary})`,
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
  // Synthetic rows — NOT real figures (kept out of this public repo).
  const csv = [
    'period_month,current_members,prior_members,lost_members,new_members,returning_members,retention_rate',
    '2025-07,210,200,18,28,182,0.91',
    '2025-06,200,90,3,113,87,0.97', // deliberately out of order — must sort earliest-first
  ].join('\n');
  const rows = parse(csv);
  const sql = buildSql(rows);
  const fails: string[] = [];
  if (rows.length !== 2) fails.push('row count');
  if (rows[0].period_month !== '2025-06') fails.push('earliest-first sort');
  if (!sql.includes("'2025-06', 200, 90, 3, 113, 87, 0.97, true")) fails.push('boundary flagged true');
  if (!sql.includes("'2025-07', 210, 200, 18, 28, 182, 0.91, false")) fails.push('non-boundary flagged false');
  if (!sql.includes('on conflict (workspace_id, period_month) do update set')) fails.push('idempotent upsert');
  if (fails.length > 0) {
    console.error(`SELFTEST FAIL: ${fails.join('; ')}`);
    process.exit(1);
    return;
  }
  console.log('SELFTEST PASS: parse + earliest-first sort + boundary flag + idempotent upsert SQL correct (no file read).');
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
  const rows = parse(readFileSync(path, 'utf8'));
  console.error(`-- ${rows.length} monthly rows parsed; earliest ${rows[0].period_month} flagged is_seed_boundary=true.`);
  console.log(buildSql(rows));
}

main();
