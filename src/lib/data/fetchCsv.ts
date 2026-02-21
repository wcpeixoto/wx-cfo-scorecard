import type { CsvRecord } from './contract';

type FetchCsvResult = {
  records: CsvRecord[];
  sourceUrl: string;
};

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (char === '"') {
      const nextChar = text[i + 1];
      if (inQuotes && nextChar === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[i + 1] === '\n') {
        i += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function rowsToRecords(rows: string[][]): CsvRecord[] {
  const cleanedRows = rows.filter((row) => row.some((cell) => cell.trim().length > 0));
  if (cleanedRows.length === 0) {
    return [];
  }

  const headerIndex = cleanedRows.findIndex((row) => {
    const normalizedCells = row.map((cell) => normalizeHeader(cell));
    return normalizedCells.includes('date') && normalizedCells.includes('amount');
  });

  const index = headerIndex >= 0 ? headerIndex : 0;
  const headers = cleanedRows[index].map((header) => header.trim());

  const records: CsvRecord[] = [];
  for (let i = index + 1; i < cleanedRows.length; i += 1) {
    const row = cleanedRows[i];
    const record: CsvRecord = {};

    headers.forEach((header, headerIndexPosition) => {
      if (!header) return;
      record[header] = (row[headerIndexPosition] ?? '').trim();
    });

    if (Object.values(record).some((value) => value.length > 0)) {
      records.push(record);
    }
  }

  return records;
}

async function fetchCsvText(url: string): Promise<string> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`CSV fetch failed (${response.status}) from ${url}`);
  }
  return response.text();
}

export async function fetchSheetCsv(primaryUrl: string, fallbackUrl?: string): Promise<FetchCsvResult> {
  const urls = [primaryUrl, fallbackUrl].filter((value): value is string => Boolean(value));
  let lastError: Error | null = null;

  for (const url of urls) {
    try {
      const text = await fetchCsvText(url);
      const rows = parseCsvRows(text);
      const records = rowsToRecords(rows);

      if (records.length === 0) {
        throw new Error(`CSV parsed but no data rows were found in ${url}`);
      }

      return { records, sourceUrl: url };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown CSV fetch error');
    }
  }

  throw lastError ?? new Error('Failed to fetch CSV data');
}
