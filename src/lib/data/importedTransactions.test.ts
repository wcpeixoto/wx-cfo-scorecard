import { describe, it, expect } from 'vitest';
import { computeImportOutcome, parseQuickenReportCsv } from './importedTransactions';

const CSV_HEADER = 'Account,Date,Payee,Category,Amount\n';

function makeCsv(rows: string[]): string {
  return CSV_HEADER + rows.join('\n') + '\n';
}

function importBatch(
  text: string,
  options: {
    importId?: string;
    sourceFileName?: string;
    importedAtIso?: string;
  } = {}
) {
  const importId = options.importId ?? 'import-test-1';
  const sourceFileName = options.sourceFileName ?? 'test.csv';
  const importedAtIso = options.importedAtIso ?? '2026-05-31T00:00:00.000Z';
  const { candidates, parseErrors } = parseQuickenReportCsv(text, sourceFileName, importId, importedAtIso);
  return computeImportOutcome(
    candidates,
    parseErrors,
    [],
    importId,
    sourceFileName,
    importedAtIso,
    'local',
    'append'
  );
}

describe('computeImportOutcome — duplicate handling', () => {
  it('skips exact duplicates against existing records and counts them', () => {
    // First batch — load the initial rows.
    const first = importBatch(
      makeCsv([
        'BofA,5/28/2026,Acme Co,Office Supplies,-50.00',
        'BofA,5/28/2026,Acme Co,Office Supplies,-50.00,with memo',
      ])
    );
    expect(first.acceptedRecords.length).toBeGreaterThan(0);

    // Second batch — identical first row. Fingerprint match → skip.
    // (We parse a fresh CSV through the same path to mirror real-world flow.)
    const { candidates, parseErrors } = parseQuickenReportCsv(
      makeCsv(['BofA,5/28/2026,Acme Co,Office Supplies,-50.00']),
      'second.csv',
      'import-test-2',
      '2026-05-31T12:00:00.000Z'
    );
    const second = computeImportOutcome(
      candidates,
      parseErrors,
      first.acceptedRecords,
      'import-test-2',
      'second.csv',
      '2026-05-31T12:00:00.000Z',
      'local',
      'append'
    );

    expect(second.summary.exactDuplicatesSkipped).toBe(1);
    expect(second.summary.newImported).toBe(0);
    expect(second.acceptedRecords.length).toBe(0);
  });

  it('flags possible duplicates (date+account+payee+amount match) but still imports them', () => {
    // First batch establishes the base row.
    const first = importBatch(
      makeCsv(['BofA,5/28/2026,Acme Co,Office Supplies,-50.00'])
    );

    // Second batch has a row that shares date+account+payee+amount but a
    // different category — fingerprint differs (so not an exact dup) but the
    // possibleDuplicateKey matches → flagged AND imported.
    const { candidates, parseErrors } = parseQuickenReportCsv(
      makeCsv(['BofA,5/28/2026,Acme Co,Different Category,-50.00']),
      'second.csv',
      'import-test-2',
      '2026-05-31T12:00:00.000Z'
    );
    const second = computeImportOutcome(
      candidates,
      parseErrors,
      first.acceptedRecords,
      'import-test-2',
      'second.csv',
      '2026-05-31T12:00:00.000Z',
      'local',
      'append'
    );

    expect(second.summary.possibleDuplicatesFlagged).toBe(1);
    expect(second.summary.newImported).toBe(1);
    expect(second.summary.exactDuplicatesSkipped).toBe(0);
    expect(second.acceptedRecords.length).toBe(1);
    expect(second.acceptedRecords[0].possibleDuplicate).toBe(true);
    expect(second.summary.possibleDuplicateExamples.length).toBe(1);
  });

  it('a brand-new import (different importId) surfaces fresh possible-duplicate flags', () => {
    const first = importBatch(
      makeCsv(['BofA,5/28/2026,Acme Co,Office Supplies,-50.00']),
      { importId: 'import-001' }
    );

    // A later import — different importId — repeats the row with a different
    // category. Possible-duplicate detection runs against the union of stored
    // records, not against acknowledgement state, so the flag re-surfaces.
    const { candidates, parseErrors } = parseQuickenReportCsv(
      makeCsv(['BofA,5/28/2026,Acme Co,Other,-50.00']),
      'later.csv',
      'import-002',
      '2026-06-15T00:00:00.000Z'
    );
    const later = computeImportOutcome(
      candidates,
      parseErrors,
      first.acceptedRecords,
      'import-002',
      'later.csv',
      '2026-06-15T00:00:00.000Z',
      'local',
      'append'
    );

    expect(later.summary.importId).toBe('import-002');
    expect(later.summary.possibleDuplicatesFlagged).toBe(1);
  });

  it('computes latestTxnMonth from accepted records', () => {
    const outcome = importBatch(
      makeCsv([
        'BofA,3/15/2026,Acme Co,Office,-10.00',
        'BofA,5/28/2026,Acme Co,Office,-20.00',
        'BofA,4/01/2026,Acme Co,Office,-30.00',
      ])
    );
    expect(outcome.summary.latestTxnMonth).toBe('2026-05');
    expect(outcome.summary.newImported).toBe(3);
  });
});
