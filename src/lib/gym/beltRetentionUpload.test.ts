import { describe, it, expect } from 'vitest';
import {
  aggregateUpload,
  classifyUploads,
  contentLengthExceeds,
  exceedsSizeCap,
  verifyImportSecret,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
} from './beltRetentionUpload';

// ─── SYNTHETIC 3-SOURCE FIXTURE ──────────────────────────────────────────────
// Same shape as scripts/wodify/buildMemberRetentionByBelt.ts --selftest (the
// validated happy path): C1 Alice Adults Blue (active 2025-06/07, Lost mapped
// 2025-08), C2 Bob Kids Grey-family (active 2025-06), C3 Carol Adults Purple
// (Lost mapped 2025-06), C4 Ghost (Lost 2025-07, no belt → unknown). This set
// conserves per month and has a collision-free name bridge.
const RET_CSV = [
  'ID,Customer ID,First Of Month,Client ID,Client Name,Change Type,Positive Change,Negative Change,Membership ID',
  '1,X,2025-05-01,C1,Alice,New,1,0,2000001',
  '2,X,2025-06-01,C1,Alice,Returning,1,0,2000001',
  '3,X,2025-07-01,C1,Alice,Lost,0,1,2000001',
  '4,X,2025-05-01,C2,Bob,Returning,1,0,2000002',
  '5,X,2025-05-01,C3,Carol,Lost,0,1,2000003',
  '6,X,2025-06-01,C4,GhostMember,Lost,0,1,2000004',
].join('\n');
const CUR_CSV = [
  'Client ID,Client Name,Progression,Level,Date Achieved,Classes At Level,Clients → Client Active',
  'C1,Alice,Adults BJJ,Blue Belt,"Mar 1, 2025",10,Yes',
  'C2,Bob,Kids BJJ,Grey/White Belt,"Feb 1, 2025",3,Yes',
  'C3,Carol,Adults BJJ,Purple Belt,"Jun 1, 2024",20,No',
].join('\n');
const PREV_CSV = [
  'Client Name,Progression,Level,Date Achieved,Promoted On,Days At Level,Client Active',
  'Alice,Adults BJJ,White Belt,"Jan 1, 2024","Mar 1, 2025",425,Yes',
].join('\n');

// ─── verifyImportSecret ──────────────────────────────────────────────────────
describe('verifyImportSecret (request gate)', () => {
  it('returns true for an exact match', async () => {
    expect(await verifyImportSecret('belt-trigger-abc123', 'belt-trigger-abc123')).toBe(true);
  });

  it('returns false for a wrong secret (mismatch → reject)', async () => {
    expect(await verifyImportSecret('belt-trigger-abc123', 'wrong-secret')).toBe(false);
  });

  it('returns false for a missing (empty) provided header', async () => {
    expect(await verifyImportSecret('belt-trigger-abc123', '')).toBe(false);
  });

  it('fails closed when the configured secret is empty (even if provided is too)', async () => {
    expect(await verifyImportSecret('', '')).toBe(false);
    expect(await verifyImportSecret('', 'anything')).toBe(false);
  });

  it('is case- and whitespace-sensitive', async () => {
    expect(await verifyImportSecret('Secret', 'secret')).toBe(false);
    expect(await verifyImportSecret('secret', 'secret ')).toBe(false);
  });

  it('catches a difference anywhere in the value (full-digest compare, no prefix shortcut)', async () => {
    expect(await verifyImportSecret('abcdefghijklmnop', 'abcdefghijklmnoq')).toBe(false);
    const long = 'z'.repeat(4096);
    expect(await verifyImportSecret(long, long)).toBe(true);
    expect(await verifyImportSecret(long, long + '!')).toBe(false);
  });
});

// ─── exceedsSizeCap ──────────────────────────────────────────────────────────
describe('exceedsSizeCap', () => {
  it('accepts realistic file sizes', () => {
    expect(exceedsSizeCap([100_000, 50_000, 30_000])).toBe(false);
  });

  it('rejects when a single file exceeds the per-file cap', () => {
    expect(exceedsSizeCap([MAX_FILE_BYTES + 1, 10, 10])).toBe(true);
  });

  it('accepts a file exactly at the per-file cap', () => {
    expect(exceedsSizeCap([MAX_FILE_BYTES, 10, 10])).toBe(false);
  });

  it('rejects when the running total exceeds the total cap even if each file is under', () => {
    // Three files each just under the per-file cap sum past the total cap.
    const each = MAX_FILE_BYTES; // 3 × per-file = total cap exactly → not over
    expect(exceedsSizeCap([each, each, each])).toBe(false); // == MAX_TOTAL_BYTES
    expect(exceedsSizeCap([each, each, each + 1])).toBe(true); // one byte over total
  });

  it('total cap is three times the per-file cap', () => {
    expect(MAX_TOTAL_BYTES).toBe(3 * MAX_FILE_BYTES);
  });
});

// ─── contentLengthExceeds (best-effort memory early-out) ─────────────────────
describe('contentLengthExceeds', () => {
  it('absent header (null / undefined) → false (defer to the post-parse cap)', () => {
    expect(contentLengthExceeds(null, MAX_TOTAL_BYTES)).toBe(false);
    expect(contentLengthExceeds(undefined, MAX_TOTAL_BYTES)).toBe(false);
  });

  it('non-numeric / garbage / empty → false (defer, never throw)', () => {
    expect(contentLengthExceeds('', MAX_TOTAL_BYTES)).toBe(false);
    expect(contentLengthExceeds('   ', MAX_TOTAL_BYTES)).toBe(false);
    expect(contentLengthExceeds('not-a-number', MAX_TOTAL_BYTES)).toBe(false);
    expect(contentLengthExceeds('12abc', MAX_TOTAL_BYTES)).toBe(false);
    expect(contentLengthExceeds('-5', MAX_TOTAL_BYTES)).toBe(false); // negative → not \d+
    expect(contentLengthExceeds('1e9', MAX_TOTAL_BYTES)).toBe(false); // scientific → not \d+
  });

  it('exactly maxBytes → false (boundary is not "exceeds")', () => {
    expect(contentLengthExceeds(String(MAX_TOTAL_BYTES), MAX_TOTAL_BYTES)).toBe(false);
  });

  it('> maxBytes → true (early-out fires)', () => {
    expect(contentLengthExceeds(String(MAX_TOTAL_BYTES + 1), MAX_TOTAL_BYTES)).toBe(true);
    expect(contentLengthExceeds('99999999999', MAX_TOTAL_BYTES)).toBe(true);
  });

  it('a legit small upload → false', () => {
    expect(contentLengthExceeds('200000', MAX_TOTAL_BYTES)).toBe(false); // ~200 KB
  });
});

// ─── classifyUploads ─────────────────────────────────────────────────────────
describe('classifyUploads (header-line routing)', () => {
  it('classifies the three sources in any order', () => {
    const r = classifyUploads([CUR_CSV, PREV_CSV, RET_CSV]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.retention).toBe(RET_CSV);
      expect(r.current68).toBe(CUR_CSV);
      expect(r.previous69).toBe(PREV_CSV);
    }
  });

  it('rejects a missing source (only two classify)', () => {
    const r = classifyUploads([RET_CSV, CUR_CSV]);
    expect(r).toEqual({ ok: false, code: 'missing_source' });
  });

  it('rejects a duplicate source (two files classify to the same kind)', () => {
    const r = classifyUploads([RET_CSV, CUR_CSV, CUR_CSV]);
    expect(r).toEqual({ ok: false, code: 'duplicate_source' });
  });

  it('rejects an unclassified (misclassified) source with an unknown header', () => {
    const junk = 'Some,Unrelated,Header,Columns\n1,2,3,4';
    const r = classifyUploads([RET_CSV, CUR_CSV, junk]);
    expect(r).toEqual({ ok: false, code: 'unclassified_source' });
  });

  it('rejects when all three are the same file (duplicate before missing)', () => {
    const r = classifyUploads([RET_CSV, RET_CSV, RET_CSV]);
    expect(r).toEqual({ ok: false, code: 'duplicate_source' });
  });
});

// ─── aggregateUpload — happy path (counts-only) ──────────────────────────────
describe('aggregateUpload (happy path → counts-only summary)', () => {
  it('aggregates the classified sources into a conserving, collision-free 104-row payload', () => {
    const r = aggregateUpload({ retention: RET_CSV, current68: CUR_CSV, previous69: PREV_CSV });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Counts-only summary — integers, booleans, YYYY-MM labels; no rows/names/IDs.
    expect(r.summary.rowCount).toBe(104); // 7 bands × 13 months + 13 unknown
    expect(r.summary.months).toBe(13);
    expect(r.summary.monthLabels[0]).toBe('2025-06');
    expect(r.summary.monthLabels).toHaveLength(13);
    expect(r.summary.conservationOk).toBe(true);
    expect(r.summary.bridgeCollisionFree).toBe(true);
    expect(r.summary.ambiguousNames).toBe(0);
    expect(r.summary.unmatchedNames).toBe(0);
  });

  it('the returned summary carries no PII-shaped tokens (counts + month labels only)', () => {
    const r = aggregateUpload({ retention: RET_CSV, current68: CUR_CSV, previous69: PREV_CSV });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ser = JSON.stringify(r.summary);
    expect(ser).not.toMatch(/\d{4}-\d{2}-\d{2}/); // no day-level date
    expect(ser).not.toMatch(/\d{7,}/); // no ID-shaped run
    expect(ser).not.toContain('@');
    expect(ser).not.toContain('Alice');
    expect(ser).not.toContain('C1');
  });

  it('the writer payload has the exact upsert-key columns and no extra PII columns', () => {
    const r = aggregateUpload({ retention: RET_CSV, current68: CUR_CSV, previous69: PREV_CSV });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const row = r.payload.rows[0];
    expect(Object.keys(row).sort()).toEqual(
      ['active_count', 'belt_band', 'lost_count', 'period_month', 'segment', 'workspace_id'].sort(),
    );
  });
});

// ─── aggregateUpload — fail-closed gates ─────────────────────────────────────
describe('aggregateUpload (fail-closed before any write)', () => {
  it('rejects when a classified source fails its required-column parse', () => {
    // Header routes as retention (has changetype+firstofmonth) but is missing the
    // required clientid column → strict parse fails.
    const badRet = ['First Of Month,Client Name,Change Type', '2025-06-01,Alice,New'].join('\n');
    const r = aggregateUpload({ retention: badRet, current68: CUR_CSV, previous69: PREV_CSV });
    expect(r).toEqual({ ok: false, code: 'header_validation_failed' });
  });

  it('rejects on a name-bridge collision (ambiguous 69 name → >1 client id)', () => {
    // Two distinct client ids share the name "Alice" in the current(68)/retention
    // name maps; the previous(69) "Alice" row can't resolve to a unique id →
    // ambiguousNames > 0 → collisionFree false. (Conservation still ties, so this
    // isolates the bridge gate.)
    const retDup = [
      'ID,Customer ID,First Of Month,Client ID,Client Name,Change Type,Positive Change,Negative Change,Membership ID',
      '1,X,2025-05-01,C1,Alice,New,1,0,2000001',
      '2,X,2025-05-01,C9,Alice,New,1,0,2000009', // second id, same name → ambiguous
    ].join('\n');
    const curDup = [
      'Client ID,Client Name,Progression,Level,Date Achieved,Classes At Level,Clients → Client Active',
      'C1,Alice,Adults BJJ,Blue Belt,"Mar 1, 2025",10,Yes',
      'C9,Alice,Adults BJJ,Blue Belt,"Mar 1, 2025",10,Yes',
    ].join('\n');
    const prevAlice = [
      'Client Name,Progression,Level,Date Achieved,Promoted On,Days At Level,Client Active',
      'Alice,Adults BJJ,White Belt,"Jan 1, 2024","Mar 1, 2025",425,Yes',
    ].join('\n');
    const r = aggregateUpload({ retention: retDup, current68: curDup, previous69: prevAlice });
    expect(r).toEqual({ ok: false, code: 'name_bridge_collision' });
  });

  it('rejects on an unmatched 69 name (name → 0 client ids)', () => {
    const prevOrphan = [
      'Client Name,Progression,Level,Date Achieved,Promoted On,Days At Level,Client Active',
      'Nobody Here,Adults BJJ,White Belt,"Jan 1, 2024","Mar 1, 2025",425,Yes',
    ].join('\n');
    const r = aggregateUpload({ retention: RET_CSV, current68: CUR_CSV, previous69: prevOrphan });
    expect(r).toEqual({ ok: false, code: 'name_bridge_collision' });
  });
});

// ─── size-cap boundary is enforced BEFORE aggregation (documented ordering) ──
describe('size-cap ordering contract', () => {
  it('exceedsSizeCap is a pure pre-aggregation check (no parse needed)', () => {
    // Sanity: the cap function does not depend on file content, only byte length,
    // so the shell can reject an oversize upload without ever parsing it.
    expect(exceedsSizeCap([MAX_FILE_BYTES + 1])).toBe(true);
    expect(exceedsSizeCap([])).toBe(false);
  });
});
