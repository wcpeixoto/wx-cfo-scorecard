import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../supabase/wodify_retention_schema.sql', import.meta.url),
  'utf8',
).split('-- BEGIN STUDENT CENSUS DELTA')[1];
const edgeFunction = readFileSync(
  new URL('../supabase/functions/sync-wodify-retention/index.ts', import.meta.url),
  'utf8',
);
const workflow = readFileSync(
  new URL('../.github/workflows/tenure-snapshot.yml', import.meta.url),
  'utf8',
);

describe('paged census persistence contract', () => {
  it('repeating the same run_id/page replaces the draft instead of duplicating it', () => {
    expect(migration).toMatch(/primary key \(run_id, page\)/i);
    expect(edgeFunction).toContain('?on_conflict=run_id,page');
    expect(edgeFunction).toContain("Prefer: 'return=minimal,resolution=merge-duplicates'");
  });

  it('keeps page drafts aggregate-only and inaccessible to browser roles', () => {
    expect(migration).toMatch(/alter table public\.wodify_census_runs enable row level security/i);
    expect(migration).toMatch(/revoke all on table public\.wodify_census_runs from anon, authenticated/i);
    expect(migration).toMatch(/grant select, insert, update, delete[\s\S]*to service_role/i);
    expect(migration).not.toMatch(/create policy[\s\S]*wodify_census_runs/i);
    expect(migration).not.toMatch(/\b(name|email|phone|dob|client_id|membership_id)\b/i);
  });

  it('adds every final census field as a nullable aggregate extension', () => {
    for (const column of [
      'student_total',
      'student_retention',
      'guardian_only_total',
      'students_by_path',
      'unclassified_total',
      'ambiguous_no_signin_with_membership',
      'detail_calls_made',
      'detail_clients_failed',
      'pages_expected',
      'pages_completed',
    ]) {
      expect(migration).toMatch(new RegExp(`add column if not exists ${column} [^,;]+ null`, 'i'));
    }
  });

  it('orchestrates page then finalize without moving data credentials into Actions', () => {
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('timeout-minutes: 60');
    expect(workflow).toContain('and .pageSize == 25');
    expect(workflow).toContain('"$PAGE" -gt 200');
    expect(migration).toContain('page between 1 and 200');
    expect(migration).toContain('page_size in (25, 100)');
    expect(workflow.match(/curl --fail-with-body --connect-timeout 10 --max-time /g)).toHaveLength(3);
    expect(workflow).toContain("'{mode:\"page\", run_id:$run_id, page:$page}'");
    expect(workflow).toContain("'{mode:\"finalize\", run_id:$run_id}'");
    expect(workflow).toContain('if [ "$HAS_MORE" = "false" ]');
    expect(workflow).not.toContain('secrets.WODIFY_API_KEY');
    expect(workflow).not.toContain('secrets.SUPABASE_SERVICE_ROLE_KEY');
  });
});
