import { describe, expect, it } from 'vitest';

import {
  buildRetentionImportPreview,
  parseFirstOfMonth,
  parseWodifyRetentionCsv,
} from './memberRetentionImport';

// The RAW Wodify "Member Retention Rates" export header — exactly as exported, never normalized.
const RAW_HEADER =
  'ID,Customer ID,First Of Month,Current Month Members,Last Month Members,Last Month Lost Members,Last Month New Members,Retention Rate';

// Synthetic rows — NOT real figures. Quoted "Jun 1, 2025" dates and a quoted thousands-comma count
// ("11,358") prove the raw export imports with no hand-editing. Each row satisfies the within-row
// identities: current = (prior − lost) + new, rate ≈ returning/prior.
function rawExport(): string {
  // Raw export = 8 columns; returning_members is DERIVED (prior − lost), never exported.
  return [
    RAW_HEADER,
    // boundary month (earliest): prior 90, lost 3 → returning 87; +113 new = 200 current; 87/90 ≈ 0.97
    '1,1001,"Jun 1, 2025",200,90,3,113,0.97',
    // prior 200, lost 18 → returning 182; +28 new = 210 current; 182/200 = 0.91
    '2,1002,"Jul 1, 2025",210,200,18,28,0.91',
    // a quoted thousands-comma count: prior "11,358", lost 358 → returning 11000; +258 new = 11258; 11000/11358 ≈ 0.97
    '3,1003,"Aug 1, 2025","11,258","11,358",358,258,0.97',
  ].join('\n');
}

describe('parseFirstOfMonth', () => {
  it('maps month names deterministically without Date()', () => {
    expect(parseFirstOfMonth('Jun 1, 2025')).toBe('2025-06');
    expect(parseFirstOfMonth('June 1, 2025')).toBe('2025-06');
    expect(parseFirstOfMonth('Jan 1, 2026')).toBe('2026-01');
    expect(parseFirstOfMonth('Dec 1, 2024')).toBe('2024-12');
  });
  it('rejects malformed dates', () => {
    expect(parseFirstOfMonth('2025-06')).toBeNull();
    expect(parseFirstOfMonth('Smarch 1, 2025')).toBeNull();
    expect(parseFirstOfMonth('')).toBeNull();
  });
});

describe('parseWodifyRetentionCsv — raw export, no manual editing', () => {
  it('imports the raw headers, quoted dates and quoted thousands-comma counts with no issues', () => {
    const parsed = parseWodifyRetentionCsv(rawExport());
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows).toHaveLength(3);

    // mapping + derived returning + boundary on the earliest month
    expect(parsed.rows[0]).toMatchObject({
      periodMonth: '2025-06',
      currentMembers: 200,
      priorMembers: 90,
      lostMembers: 3,
      newMembers: 113,
      returningMembers: 87, // prior − lost
      retentionRate: 0.97,
      isSeedBoundary: true,
    });
    // quoted "11,358" survived as 11358 (not split on the comma)
    expect(parsed.rows[2]).toMatchObject({
      periodMonth: '2025-08',
      priorMembers: 11358,
      currentMembers: 11258,
      returningMembers: 11000,
      isSeedBoundary: false,
    });
  });

  it('flags only the earliest month as the seed boundary, regardless of file order', () => {
    // deliberately out of order — earliest must still be the boundary after the internal sort
    const parsed = parseWodifyRetentionCsv(
      [
        RAW_HEADER,
        '2,1002,"Jul 1, 2025",210,200,18,28,0.91',
        '1,1001,"Jun 1, 2025",200,90,3,113,0.97',
      ].join('\n'),
    );
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows.map((r) => r.periodMonth)).toEqual(['2025-06', '2025-07']);
    expect(parsed.rows.map((r) => r.isSeedBoundary)).toEqual([true, false]);
  });

  it('keeps the original earliest as the boundary when a later month is added', () => {
    // The cumulative export grows by appending later months; the earliest never changes.
    const parsed = parseWodifyRetentionCsv(
      [
        RAW_HEADER,
        '1,1001,"Jun 1, 2025",200,90,3,113,0.97',
        '2,1002,"Jul 1, 2025",210,200,18,28,0.91',
        '3,1003,"Aug 1, 2025",218,210,20,28,0.9',
      ].join('\n'),
    );
    expect(parsed.issues).toEqual([]);
    const boundaries = parsed.rows.filter((r) => r.isSeedBoundary).map((r) => r.periodMonth);
    expect(boundaries).toEqual(['2025-06']); // exactly one, still the earliest
  });
});

describe('parseWodifyRetentionCsv — validation rejects before any write', () => {
  it('rejects a file missing a required column', () => {
    const header = 'ID,Customer ID,First Of Month,Current Month Members,Last Month Members,Last Month Lost Members,Last Month New Members';
    const parsed = parseWodifyRetentionCsv([header, '1,1001,"Jun 1, 2025",200,90,3,113'].join('\n'));
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.issues).toHaveLength(1);
    expect(parsed.issues[0].message).toMatch(/Not a Member Retention Rates export/);
    expect(parsed.issues[0].message).toMatch(/Retention Rate/);
  });

  it('rejects a duplicate month within the file', () => {
    const parsed = parseWodifyRetentionCsv(
      [
        RAW_HEADER,
        '1,1001,"Jun 1, 2025",200,90,3,113,0.97',
        '9,1009,"Jun 1, 2025",200,90,3,113,0.97',
      ].join('\n'),
    );
    expect(parsed.duplicateMonths).toEqual(['2025-06']);
    expect(parsed.issues.some((i) => /duplicate month 2025-06/.test(i.message))).toBe(true);
  });

  it('rejects a within-row identity violation (current ≠ prior − lost + new)', () => {
    const parsed = parseWodifyRetentionCsv(
      [RAW_HEADER, '1,1001,"Jun 1, 2025",999,90,3,113,0.97'].join('\n'),
    );
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.issues.some((i) => /don.t reconcile/.test(i.message))).toBe(true);
  });

  it('rejects a retention rate that is off by more than ±0.01, accepts within tolerance', () => {
    const bad = parseWodifyRetentionCsv(
      [RAW_HEADER, '1,1001,"Jun 1, 2025",200,90,3,113,0.50'].join('\n'),
    );
    expect(bad.issues.some((i) => /doesn.t match returning\/prior/.test(i.message))).toBe(true);

    // 87/90 = 0.9667; the export rounds to 0.97 — within ±0.01, must be accepted.
    const good = parseWodifyRetentionCsv(
      [RAW_HEADER, '1,1001,"Jun 1, 2025",200,90,3,113,0.97'].join('\n'),
    );
    expect(good.issues).toEqual([]);
  });

  it('does NOT enforce cross-row chaining (current of one month may differ from next month prior)', () => {
    // Jun current = 200, Jul prior = 197 (a real 3-member drift) — must NOT be rejected.
    const parsed = parseWodifyRetentionCsv(
      [
        RAW_HEADER,
        '1,1001,"Jun 1, 2025",200,90,3,113,0.97',
        '2,1002,"Jul 1, 2025",207,197,18,28,0.91',
      ].join('\n'),
    );
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows).toHaveLength(2);
  });
});

describe('buildRetentionImportPreview — insert vs update', () => {
  it('counts insert vs update against the months already in the table', () => {
    const parsed = parseWodifyRetentionCsv(rawExport());
    // 2025-06 already exists in the table → 1 update, 2 inserts.
    const preview = buildRetentionImportPreview('member_retention.csv', parsed, ['2025-06']);
    expect(preview).toMatchObject({
      rowCount: 3,
      firstMonth: '2025-06',
      lastMonth: '2025-08',
      boundaryMonth: '2025-06',
      toUpdate: 1,
      toInsert: 2,
      issues: [],
    });
  });

  it('treats an empty table as all inserts', () => {
    const parsed = parseWodifyRetentionCsv(rawExport());
    const preview = buildRetentionImportPreview('member_retention.csv', parsed, []);
    expect(preview.toInsert).toBe(3);
    expect(preview.toUpdate).toBe(0);
  });
});
