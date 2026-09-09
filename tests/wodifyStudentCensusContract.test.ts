import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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

const steps = workflow.split(/^      - name: /m).slice(1);
const script = (step: string) => step.split('        run: |\n')[1].replace(/^          /gm, '').trim();

describe('manual single-page diagnostic isolation', () => {
  it('keeps the scheduled command paths byte-identical to the reviewed census baseline', () => {
    expect(workflow).toContain("- cron: '0 12 * * 1'");
    expect(workflow).toContain('type: number\n        required: false\n        default: 0');
    expect(steps).toHaveLength(4);
    expect(steps[0]).toContain("if: ${{ github.event_name == 'workflow_dispatch' && inputs.diagnostic_page != 0 }}");
    expect(steps[0]).toContain('DIAGNOSTIC_PAGE: ${{ inputs.diagnostic_page }}');
    const expectedHashes = [
      'deb92662c2b4d1c801d7d3a3d3fc8aa306e604afaee75f440e9786c097316205',
      '9a06d7e0a593c188ec101dd8031874679a83371e7d0eed340af3e6362115d9f9',
      '714923b4d4dde9cf7b2c97d42dc8c27c02b829d9ad0985852a5ca4a5369b0817',
    ]; // run blocks at c4a27b87e68e72ebba42da420eef7e424df2ca66
    steps.slice(1).forEach((step, i) => {
      expect(step).toContain("if: ${{ !(github.event_name == 'workflow_dispatch' && inputs.diagnostic_page != 0) }}");
      expect(createHash('sha256').update(script(step)).digest('hex')).toBe(expectedHashes[i]);
    });
  });

  const reasons = {
    invalid_detail_record: 1, invalid_no_group_signins: 0, invalid_group_or_missing_role: 0,
    unrecognized_group_role: 0, invalid_guardian_signins: 0, invalid_client_id: 0, detail_fetch_failed: 0,
  };
  const failure = {
    error: 'page_classification_failed', unclassified_total: 1, detail_clients_failed: 0,
    unclassified_reasons: reasons, detail_http_status_counts: { '503': 1 },
  };
  const summary = {
    page: 200, pageSize: 25, hasMore: true, rowsSeen: 1, activeClientsSeen: 1,
    studentTotal: 1, guardianOnly: 0, unclassified: 0, detailCallsMade: 1, detailClientsFailed: 0,
  };
  const invalidSummary = { origin: 'workflow_response_validation', error: 'invalid_page_summary', http_status: 200 };
  const invalidDiagnostic = { origin: 'workflow_response_validation', error: 'invalid_page_diagnostic', http_status: 409 };
  const unrecognized = { origin: 'gateway_or_unrecognized_response', error: 'unrecognized_http_response', http_status: 502 };

  it.each([
    ['200', { ok: true, mode: 'page', ...summary, private: 'private-secret' }, 0, summary, 0],
    ['200', { ok: true, mode: 'page', ...summary, page: 1 }, 0, { ...summary, page: 1 }, 0],
    ['200', { ok: true, mode: 'page', ...summary, page: 137 }, 0, { ...summary, page: 137 }, 0],
    ['200', { ok: true, mode: 'page', ...summary, page: 41 }, 0, { ...summary, page: 41 }, 0],
    ['200', { ok: true, mode: 'page', ...summary, page: 199 }, 1, invalidSummary, 0],
    ['409', { ...failure, private: 'private-secret', unclassified_reasons: { ...reasons, private: 'private-secret' },
      detail_http_status_counts: { '503': 1, private: 'private-secret' } }, 1, { ...failure, origin: 'edge_classification', http_status: 409 }, 0],
    ['409', { ...failure, unclassified_total: 'private-secret' }, 1, invalidDiagnostic, 0],
    ['409', { ...failure, unclassified_reasons: { ...reasons, invalid_detail_record: 'private-secret' } }, 1, invalidDiagnostic, 0],
    ['409', { ...failure, detail_http_status_counts: { '503': 'private-secret' } }, 1, invalidDiagnostic, 0],
    ['502', { error: 'private-secret' }, 1, unrecognized, 0],
    ['502', '<html>private gateway error</html>', 1, unrecognized, 0],
    ['400', { error: 'invalid_request', private: 'private-secret' }, 1,
      { origin: 'edge_request_validation', error: 'invalid_request', http_status: 400 }, 0],
    ['403', { error: 'forbidden', private: 'private-secret' }, 1,
      { origin: 'edge_function', error: 'forbidden', http_status: 403 }, 0],
    ['500', { error: 'internal_error' }, 1,
      { origin: 'edge_function', error: 'internal_error', http_status: 500 }, 0],
    ['502', { error: 'sync_failed', code: 'wodify_clients_http_503', private: 'private-secret' }, 1,
      { origin: 'upstream_wodify', error: 'sync_failed', code: 'wodify_clients_http_503', http_status: 502 }, 0],
    ['502', { error: 'sync_failed', code: 'parse_error' }, 1,
      { origin: 'edge_function', error: 'sync_failed', code: 'parse_error', http_status: 502 }, 0],
    ['502', { error: 'sync_failed', code: 'private-secret' }, 1, unrecognized, 0],
    ['502', { error: 'sync_failed', code: 'wodify_clients_http_503_private' }, 1, unrecognized, 0],
    ['401', { code: 401, message: 'private-secret' }, 1, { ...unrecognized, http_status: 401 }, 0],
    ['200', { ok: true, mode: 'page', ...summary, rowsSeen: 'private-secret' }, 1, invalidSummary, 0],
    ['000', {}, 1, { origin: 'workflow_transport', error: 'page_transport_failed' }, 28],
    ['private', {}, 1, { origin: 'workflow_response_validation', error: 'invalid_http_status' }, 0],
  ])('invokes only the requested page and stops safely for response %s (%#)', (status, body, exit, expected, curlExit) => {
    const dir = mkdtempSync(join(tmpdir(), 'cfo-single-page-test-'));
    const requested = (expected as { page?: number }).page ?? 41;
    try {
      // Run the actual workflow shell, replacing only transport and UUID source.
      // No network, credentials, or production invocation is involved.
      const result = spawnSync('bash', [], {
        cwd: dir, encoding: 'utf8',
        env: { ...process.env, DIAGNOSTIC_PAGE: String(requested), TEST_BODY: typeof body === 'string' ? body : JSON.stringify(body), TEST_STATUS: status,
          TEST_CURL_EXIT: String(curlExit), VITE_SUPABASE_URL: 'https://private.invalid',
          VITE_SUPABASE_ANON_KEY: 'private-secret', SYNC_TRIGGER_SECRET: 'private-secret' },
        input: `
          cat() {
            if [ "$1" = /proc/sys/kernel/random/uuid ]; then
              printf '%s' '11111111-1111-4111-8111-111111111111'
            else command cat "$@"; fi
          }
          curl() {
            printf 'call\\n' >> calls
            printf '%s' "$TEST_BODY" > page-response.json
            printf '%s' "$TEST_STATUS"
            printf 'private transport error' >&2
            return "$TEST_CURL_EXIT"
          }
          ${script(steps[0])}
        `,
      });
      expect(result.status).toBe(exit);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout)).toEqual(expected);
      expect(result.stdout).not.toContain('private');
      expect(result.stdout).not.toContain('11111111-1111-4111-8111-111111111111');
      expect(readFileSync(join(dir, 'calls'), 'utf8')).toBe('call\n');
      expect(JSON.parse(readFileSync(join(dir, 'request.json'), 'utf8'))).toEqual({
        mode: 'page', page: requested, run_id: '11111111-1111-4111-8111-111111111111',
      });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it.each(['-1', '201', '1.5', 'private', '', '0', '01', '1e2'])(
    'rejects invalid diagnostic input %s before requesting anything', (input) => {
      const result = spawnSync('bash', [], {
        encoding: 'utf8', env: { ...process.env, DIAGNOSTIC_PAGE: input },
        input: `curl() { echo unexpected-request; return 99; }\n${script(steps[0])}`,
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toBe('');
      expect(result.stdout.trim()).toBe('{"origin":"workflow_input","error":"invalid_diagnostic_page"}');
    },
  );
});

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
