// Tiny CSV export helper, shared by the transaction drawers.
//
// Two drawers (Top Expenses, Income & Expense) need to download the currently
// visible rows as CSV. Both used the same shape: build a list of pre-stringified
// cells per row, escape any cell that contains commas/quotes/newlines, prepend
// a header line, then trigger a download via an in-memory blob URL.
//
// This util captures the second half (escape + assemble + download). Each drawer
// still builds its own row arrays (their column shapes overlap but their
// formatting is the drawer's call — e.g. CSV "Vendor / Memo" joins payee+memo
// while the table renders them on two lines).
//
// `csvCell` is exported separately for callers that want to format a single
// cell ahead of time. `exportCsv` is the typical path.

// Cells that begin with one of these chars are evaluated as a formula by Excel,
// Numbers, and Sheets — even when the row arrived via CSV. A vendor name like
// `=cmd|'/c calc'!A1` is the canonical exploit; OWASP's mitigation is to prepend
// an apostrophe so the spreadsheet treats the cell as text.
const FORMULA_TRIGGER = /^[=+\-@]/;
// Pure signed/unsigned decimals are not exploitable on their own. We bypass the
// guard for them so the Amount column (exported as `String(rawAmount)`, often
// negative) still parses as a number in Excel and SUM/pivot keep working.
const NUMERIC_LITERAL = /^[+-]?\d+(\.\d+)?$/;

/** Escape a single CSV cell: prepend an apostrophe if it would be parsed as a
 *  spreadsheet formula, then quote if it contains a comma, quote, or newline
 *  (embedded quotes are doubled). The formula check ignores surrounding
 *  whitespace because spreadsheet parsers do too. */
export function csvCell(value: string): string {
  const trimmed = value.trim();
  const isDangerous = FORMULA_TRIGGER.test(trimmed) && !NUMERIC_LITERAL.test(trimmed);
  const safe = isDangerous ? `'${value}` : value;
  if (/[",\n]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}

interface ExportCsvOptions {
  /** Filename used for the download (e.g. `top-expenses-payroll.csv`). */
  filename: string;
  /** Column headers, written as the first line. */
  headers: string[];
  /** One array per row, in the same order as `headers`. */
  rows: string[][];
}

/** Assemble headers + rows into a CSV blob and trigger a download.
 *  Each cell runs through `csvCell`, so callers pass plain strings. */
export function exportCsv({ filename, headers, rows }: ExportCsvOptions): void {
  const lines = [headers.map(csvCell).join(',')];
  rows.forEach((cells) => {
    lines.push(cells.map(csvCell).join(','));
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
