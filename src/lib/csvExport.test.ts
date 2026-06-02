import { describe, it, expect } from 'vitest';
import { csvCell } from './csvExport';

describe('csvCell — formula-injection guard', () => {
  it('prefixes a leading = with an apostrophe', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
  });

  it('prefixes a leading + when not a pure number', () => {
    expect(csvCell('+SUM(A1)')).toBe("'+SUM(A1)");
  });

  it('prefixes a leading - when not a pure number', () => {
    expect(csvCell('-1-2-cmd')).toBe("'-1-2-cmd");
  });

  it('prefixes a leading @', () => {
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
  });

  it('treats leading whitespace + formula char as dangerous', () => {
    expect(csvCell(' =1+1')).toBe("' =1+1");
  });
});

describe('csvCell — numeric bypass', () => {
  it('leaves a negative integer untouched', () => {
    expect(csvCell('-100')).toBe('-100');
  });

  it('leaves a negative decimal untouched', () => {
    expect(csvCell('-100.50')).toBe('-100.50');
  });

  it('leaves a signed-positive integer untouched', () => {
    expect(csvCell('+25')).toBe('+25');
  });

  it('leaves a signed-positive decimal untouched', () => {
    expect(csvCell('+100.50')).toBe('+100.50');
  });

  it('leaves an unsigned decimal untouched', () => {
    expect(csvCell('0.75')).toBe('0.75');
  });
});

describe('csvCell — quoting and escaping preserved', () => {
  it('leaves plain text unchanged', () => {
    expect(csvCell('Bank of America')).toBe('Bank of America');
  });

  it('leaves the empty string unchanged', () => {
    expect(csvCell('')).toBe('');
  });

  it('quotes a value containing a comma', () => {
    expect(csvCell('Smith, John')).toBe('"Smith, John"');
  });

  it('doubles embedded quotes and wraps in quotes', () => {
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
  });

  it('quotes a value containing a newline', () => {
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });
});

describe('csvCell — combined formula + quote triggers', () => {
  it('prepends apostrophe then wraps in quotes when a comma is present', () => {
    expect(csvCell('=A1,B1')).toBe('"\'=A1,B1"');
  });
});
