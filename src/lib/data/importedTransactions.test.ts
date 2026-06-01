import { describe, it, expect, vi } from 'vitest';
import {
  computeImportOutcome,
  CsvImportValidationError,
  evaluateImportValidation,
  importQuickenReportCsv,
  parseQuickenReportCsv,
} from './importedTransactions';

vi.mock('./sharedPersistence', () => ({
  isSharedPersistenceConfigured: vi.fn(() => true),
  replaceSharedImportedStore: vi.fn(async () => {}),
  clearSharedImportedStore: vi.fn(async () => {}),
  getSharedImportedStoreSnapshot: vi.fn(async () => null),
}));

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

describe('evaluateImportValidation — pre-write gate', () => {
  function parse(text: string) {
    return parseQuickenReportCsv(text, 'test.csv', 'import-gate-1', '2026-06-01T00:00:00.000Z');
  }

  it('flags malformed header (missing Date column) as malformed-header', () => {
    const csv = 'Account,Payee,Category,Amount\nBofA,Acme,Office,-50.00\n';
    const { candidates, parseErrors } = parse(csv);
    const result = evaluateImportValidation(candidates, parseErrors);

    expect(result).toBeInstanceOf(CsvImportValidationError);
    expect(result?.reason).toBe('malformed-header');
    expect(result?.candidateCount).toBe(0);
    expect(result?.message).toMatch(/Import stopped — no data was changed/);
    expect(result?.message).toMatch(/missing required columns: Date, Amount/);
  });

  it('flags header-OK-but-only-structural-rows as no-transactions', () => {
    const csv =
      'Account,Date,Payee,Category,Amount\n' +
      ',"Total Bank of America",,,,"212,317.81"\n' +
      '"5/1/2026 - 5/31/2026"\n';
    const { candidates, parseErrors } = parse(csv);
    const result = evaluateImportValidation(candidates, parseErrors);

    expect(result).toBeInstanceOf(CsvImportValidationError);
    expect(result?.reason).toBe('no-transactions');
    expect(result?.candidateCount).toBe(0);
    expect(parseErrors.length).toBe(0); // structural rows did not raise parse errors
    expect(result?.message).toMatch(/No transaction rows were found/);
  });

  it('blocks import when any transaction-like row fails to parse (strict mode)', () => {
    const csv =
      'Account,Date,Payee,Category,Amount\n' +
      'BofA,5/28/2026,Acme,Office,not-a-number\n' +
      'BofA,5/28/2026,Acme,Office,-50.00\n';
    const { candidates, parseErrors } = parse(csv);
    const result = evaluateImportValidation(candidates, parseErrors);

    expect(candidates.length).toBe(1); // one good row parsed
    expect(parseErrors.length).toBe(1);
    expect(result).toBeInstanceOf(CsvImportValidationError);
    expect(result?.reason).toBe('parse-errors');
    expect(result?.parseErrorCount).toBe(1);
    expect(result?.candidateCount).toBe(1);
    expect(result?.issues).toHaveLength(1);
    expect(result?.issues[0].lineNumber).toBe(2);
    expect(result?.message).toMatch(/1 row failed to parse/);
    expect(result?.message).toMatch(/Line 2:/);
  });

  it('caps the error message to the first 3 bad rows and reports the rest', () => {
    const csv =
      'Account,Date,Payee,Category,Amount\n' +
      'BofA,5/1/2026,Acme,Office,bad1\n' +
      'BofA,5/2/2026,Acme,Office,bad2\n' +
      'BofA,5/3/2026,Acme,Office,bad3\n' +
      'BofA,5/4/2026,Acme,Office,bad4\n' +
      'BofA,5/5/2026,Acme,Office,bad5\n';
    const { candidates, parseErrors } = parse(csv);
    const result = evaluateImportValidation(candidates, parseErrors);

    expect(result?.reason).toBe('no-transactions'); // all rows failed → 0 candidates
    // The cap behavior is exercised by parse-errors; rerun with one valid tail row.
    const csvMixed = csv + 'BofA,5/6/2026,Acme,Office,-10.00\n';
    const mixed = parse(csvMixed);
    const mixedResult = evaluateImportValidation(mixed.candidates, mixed.parseErrors);
    expect(mixedResult?.reason).toBe('parse-errors');
    expect(mixedResult?.parseErrorCount).toBe(5);
    expect(mixedResult?.issues).toHaveLength(3);
    expect(mixedResult?.message).toMatch(/\+ 2 more/);
  });

  it('allows a Quicken section-style file (blank Account on transaction rows, inferred from section header) to pass the gate', () => {
    const csv =
      'Account,Date,Payee,Category,Amount\n' +
      '"BofA Checking",,,,\n' +
      ',5/28/2026,Acme,Office,-50.00\n' +
      ',5/29/2026,Other,Office,-25.00\n';
    const { candidates, parseErrors } = parse(csv);
    const result = evaluateImportValidation(candidates, parseErrors);

    expect(parseErrors).toHaveLength(0);
    expect(result).toBeNull();
    expect(candidates.length).toBe(2);
    candidates.forEach(({ record }) => {
      expect(record.txn.account).toBe('BofA Checking');
    });

    // Sanity: outcome stage accepts these records cleanly.
    const outcome = computeImportOutcome(
      candidates,
      parseErrors,
      [],
      'import-gate-section',
      'sectioned.csv',
      '2026-06-01T00:00:00.000Z',
      'local',
      'append'
    );
    expect(outcome.acceptedRecords.length).toBe(2);
  });
});

describe('importQuickenReportCsv — rejected imports do not persist', () => {
  function fakeFile(name: string, contents: string): File {
    return {
      name,
      text: async () => contents,
    } as unknown as File;
  }

  it('throws CsvImportValidationError and does not call the shared writer on malformed header', async () => {
    const { replaceSharedImportedStore } = await import('./sharedPersistence');
    const writerSpy = vi.mocked(replaceSharedImportedStore);
    writerSpy.mockClear();

    const file = fakeFile('bad.csv', 'Account,Payee,Category,Amount\nBofA,Acme,Office,-50.00\n');

    await expect(importQuickenReportCsv(file)).rejects.toBeInstanceOf(CsvImportValidationError);
    expect(writerSpy).not.toHaveBeenCalled();
  });

  it('throws CsvImportValidationError and does not call the shared writer when any row fails to parse', async () => {
    const { replaceSharedImportedStore } = await import('./sharedPersistence');
    const writerSpy = vi.mocked(replaceSharedImportedStore);
    writerSpy.mockClear();

    const file = fakeFile(
      'mixed.csv',
      'Account,Date,Payee,Category,Amount\n' +
        'BofA,5/28/2026,Acme,Office,not-a-number\n' +
        'BofA,5/28/2026,Acme,Office,-50.00\n'
    );

    await expect(importQuickenReportCsv(file)).rejects.toBeInstanceOf(CsvImportValidationError);
    expect(writerSpy).not.toHaveBeenCalled();
  });
});
