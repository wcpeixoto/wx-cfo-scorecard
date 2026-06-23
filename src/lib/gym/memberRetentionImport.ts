// Wodify "Member Retention Rates" RAW export → validated monthly rows → anon Supabase upsert.
//
// This is the SINGLE shared core for two consumers: the click-only Settings → Data import UI and the
// CLI seed script (scripts/wodify/seedMemberRetentionRates.ts). Keeping parse + validate + boundary
// here means the two paths can never drift. PURE except for `upsertMemberRetentionRates`, which is the
// only browser-only function (lazy `import.meta.env` + fetch); the CLI imports this module for the
// parser and never calls the writer, so importing it under Node is safe.
//
// Source format is the RAW Wodify export, accepted AS-IS (Wes never edits the CSV):
//   ID, Customer ID, First Of Month, Current Month Members, Last Month Members,
//   Last Month Lost Members, Last Month New Members, Retention Rate
// Dates look like "Jun 1, 2025"; counts may be quoted with thousands commas ("11,358").
//
// HONEST HISTORY (AGENTS.md:299 — "No fake history"): the EARLIEST period_month is flagged
// is_seed_boundary=true (the tracking-onboarding month, excluded from the trend), exactly as
// seedMemberRetentionRates.ts + memberRetentionSeries.ts do. The Wodify report is cumulative (always
// the full history from the start), so the file's earliest is the true global earliest; after a later
// re-import the earliest stays the boundary.

import type { RetentionMonth } from './memberRetentionSeries';

const RETENTION_RATES_TABLE = 'member_retention_rates';
const WORKSPACE_ID = 'default'; // single gym → one workspace; matches the anon RLS policy.

// The 8 columns that signature a real "Member Retention Rates" export. All must be present or we
// reject. We only USE six of them — ID and Customer ID are required-but-ignored (they prove the file
// is the right report without contributing data).
const REQUIRED_HEADERS = [
  'ID',
  'Customer ID',
  'First Of Month',
  'Current Month Members',
  'Last Month Members',
  'Last Month Lost Members',
  'Last Month New Members',
  'Retention Rate',
] as const;

// Columns whose VALUES we read (the other two required headers are ignored).
const COL_FIRST_OF_MONTH = 'First Of Month';
const COL_CURRENT = 'Current Month Members';
const COL_PRIOR = 'Last Month Members';
const COL_LOST = 'Last Month Lost Members';
const COL_NEW = 'Last Month New Members';
const COL_RATE = 'Retention Rate';

const RATE_TOLERANCE = 0.01; // the export rounds the rate to 2 decimals — never require exact equality.

export type RetentionImportIssue = {
  line: number | null; // 1-based source line (null for file-level issues)
  message: string;
};

export type RetentionParseResult = {
  rows: RetentionMonth[]; // valid rows, sorted ascending, boundary-assigned. Write ONLY when issues is empty.
  issues: RetentionImportIssue[]; // any blocking validation error — non-empty ⇒ nothing should be written.
  duplicateMonths: string[]; // period_months appearing more than once in the file (also surfaced as an issue)
};

export type RetentionImportPreview = {
  fileName: string;
  rowCount: number;
  firstMonth: string | null;
  lastMonth: string | null;
  boundaryMonth: string | null;
  toInsert: number; // months not already present in the table
  toUpdate: number; // months already present (upsert overwrites them)
  duplicateMonths: string[];
  issues: RetentionImportIssue[];
  rows: RetentionMonth[]; // staged rows, only meaningful when issues is empty
};

// ── CSV parsing (RFC-4180-ish: quoted fields, embedded commas, "" escapes) ──────────────────────────
// Hand-rolled so a quoted "Jun 1, 2025" or "11,358" survives — never split(',').
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') {
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
      if (char === '\r' && text[i + 1] === '\n') i += 1;
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

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

// "Jun 1, 2025" / "June 1, 2025" → "2025-06". Deterministic month-name map — never new Date(...),
// which shifts months across timezones (AGENTS.md date rule).
const MONTH_INDEX: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

export function parseFirstOfMonth(raw: string): string | null {
  const match = raw.trim().match(/^([A-Za-z]{3,9})\.?\s+\d{1,2},\s*(\d{4})$/);
  if (!match) return null;
  const month = MONTH_INDEX[match[1].slice(0, 3).toLowerCase()];
  if (!month) return null;
  return `${match[2]}-${month}`;
}

// "11,358" → 11358, "210" → 210, "0.92" → 0.92. Strips thousands commas and surrounding whitespace.
function parseCount(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '').trim();
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Retention rate as a 0..1 fraction. Accepts "0.9" / "0.92"; tolerates a trailing "%" (→ /100).
function parseRate(raw: string): number | null {
  const trimmed = raw.replace(/,/g, '').trim();
  if (trimmed === '') return null;
  if (trimmed.endsWith('%')) {
    const pct = Number(trimmed.slice(0, -1).trim());
    return Number.isFinite(pct) ? pct / 100 : null;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse the RAW Wodify "Member Retention Rates" export into validated monthly rows.
 *
 * Validation (all blocking — any issue ⇒ caller must not write):
 *  - all 8 required headers present, else "Not a Member Retention Rates export"
 *  - First Of Month parses to YYYY-MM and is unique within the file
 *  - WITHIN-ROW identity: current = (prior − lost) + new   (returning = prior − lost is derived)
 *  - retention_rate numeric AND ≈ returning/prior within ±0.01
 *  - cross-row chaining is NOT enforced (a 1–6 member drift between a month's current and the next
 *    month's prior is real and expected).
 */
export function parseWodifyRetentionCsv(text: string): RetentionParseResult {
  const grid = parseCsvRows(text).filter((r) => r.some((c) => c.trim().length > 0));
  if (grid.length === 0) {
    return { rows: [], issues: [{ line: null, message: 'Not a Member Retention Rates export — the file is empty.' }], duplicateMonths: [] };
  }

  // First non-empty row is the header (the Wodify export has no preamble).
  const headerCells = grid[0].map((c) => c.trim());
  const headerNorm = headerCells.map(normalizeHeader);
  const missing = REQUIRED_HEADERS.filter((h) => !headerNorm.includes(normalizeHeader(h)));
  if (missing.length > 0) {
    const label = missing.length === 1 ? 'column' : 'columns';
    return {
      rows: [],
      issues: [{ line: 1, message: `Not a Member Retention Rates export — missing ${label}: ${missing.join(', ')}.` }],
      duplicateMonths: [],
    };
  }

  const indexOf = (header: string): number => headerNorm.indexOf(normalizeHeader(header));
  const idxMonth = indexOf(COL_FIRST_OF_MONTH);
  const idxCurrent = indexOf(COL_CURRENT);
  const idxPrior = indexOf(COL_PRIOR);
  const idxLost = indexOf(COL_LOST);
  const idxNew = indexOf(COL_NEW);
  const idxRate = indexOf(COL_RATE);

  const issues: RetentionImportIssue[] = [];
  const rows: RetentionMonth[] = [];
  const seenMonths = new Map<string, number>(); // period_month → source line of first occurrence
  const duplicateMonths = new Set<string>();

  for (let i = 1; i < grid.length; i += 1) {
    const line = i + 1; // 1-based source line, header is line 1
    const cells = grid[i];
    const cell = (idx: number) => (cells[idx] ?? '').trim();

    const periodMonth = parseFirstOfMonth(cell(idxMonth));
    if (!periodMonth) {
      issues.push({ line, message: `Row ${line}: couldn't read "First Of Month" value "${cell(idxMonth)}" — expected a date like "Jun 1, 2025".` });
      continue;
    }
    if (seenMonths.has(periodMonth)) {
      duplicateMonths.add(periodMonth);
      issues.push({ line, message: `Row ${line}: duplicate month ${periodMonth} (also on line ${seenMonths.get(periodMonth)}). Each month must appear once.` });
      continue;
    }
    seenMonths.set(periodMonth, line);

    const currentMembers = parseCount(cell(idxCurrent));
    const priorMembers = parseCount(cell(idxPrior));
    const lostMembers = parseCount(cell(idxLost));
    const newMembers = parseCount(cell(idxNew));
    const retentionRate = parseRate(cell(idxRate));

    if (currentMembers === null || priorMembers === null || lostMembers === null || newMembers === null) {
      issues.push({ line, message: `Row ${line} (${periodMonth}): a member-count column is missing or non-numeric.` });
      continue;
    }
    if (retentionRate === null) {
      issues.push({ line, message: `Row ${line} (${periodMonth}): retention rate is missing or non-numeric.` });
      continue;
    }

    // returning is DERIVED (prior − lost), then the within-row accounting identity must close.
    const returningMembers = priorMembers - lostMembers;
    const expectedCurrent = returningMembers + newMembers;
    if (currentMembers !== expectedCurrent) {
      issues.push({
        line,
        message: `Row ${line} (${periodMonth}): members don't reconcile — current ${currentMembers} ≠ prior ${priorMembers} − lost ${lostMembers} + new ${newMembers} = ${expectedCurrent}.`,
      });
      continue;
    }

    if (priorMembers > 0) {
      const expectedRate = returningMembers / priorMembers;
      if (Math.abs(retentionRate - expectedRate) > RATE_TOLERANCE) {
        issues.push({
          line,
          message: `Row ${line} (${periodMonth}): retention rate ${retentionRate} doesn't match returning/prior (${returningMembers}/${priorMembers} = ${expectedRate.toFixed(4)}).`,
        });
        continue;
      }
    }

    rows.push({
      periodMonth,
      currentMembers,
      priorMembers,
      lostMembers,
      newMembers,
      returningMembers,
      retentionRate,
      isSeedBoundary: false, // assigned below once the full set is known
    });
  }

  rows.sort((a, b) => a.periodMonth.localeCompare(b.periodMonth));
  // Earliest tracked month = onboarding boundary (No fake history). Re-stamp every row so a re-parse
  // is deterministic; the cumulative export always includes the true earliest, so it stays the boundary.
  rows.forEach((row, idx) => {
    row.isSeedBoundary = idx === 0;
  });

  if (rows.length === 0 && issues.length === 0) {
    issues.push({ line: null, message: 'No data rows found below the header.' });
  }

  return { rows, issues, duplicateMonths: [...duplicateMonths] };
}

/** Build the click-import preview: counts + insert-vs-update against the months already in the table. */
export function buildRetentionImportPreview(
  fileName: string,
  parsed: RetentionParseResult,
  existingMonths: string[],
): RetentionImportPreview {
  const existing = new Set(existingMonths);
  let toUpdate = 0;
  for (const row of parsed.rows) {
    if (existing.has(row.periodMonth)) toUpdate += 1;
  }
  const boundary = parsed.rows.find((r) => r.isSeedBoundary) ?? null;
  return {
    fileName,
    rowCount: parsed.rows.length,
    firstMonth: parsed.rows[0]?.periodMonth ?? null,
    lastMonth: parsed.rows[parsed.rows.length - 1]?.periodMonth ?? null,
    boundaryMonth: boundary?.periodMonth ?? null,
    toInsert: parsed.rows.length - toUpdate,
    toUpdate,
    duplicateMonths: parsed.duplicateMonths,
    issues: parsed.issues,
    rows: parsed.rows,
  };
}

// ── Anon write path (browser only) ──────────────────────────────────────────────────────────────────
// Mirrors fetchMemberRetentionRates.ts's raw-REST transport and the financial-transactions upsert in
// sharedPersistence.ts (POST + Prefer: resolution=merge-duplicates). Env is read lazily so the CLI can
// import this module for the parser without `import.meta.env` evaluating under Node.
function getSupabaseConfig(): { url: string; anonKey: string } | null {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const url = (env?.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const anonKey = (env?.VITE_SUPABASE_ANON_KEY ?? '').trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function isMemberRetentionImportConfigured(): boolean {
  return getSupabaseConfig() !== null;
}

/**
 * Upsert validated rows into public.member_retention_rates via the anon PostgREST endpoint.
 * On-conflict (workspace_id, period_month) merges duplicates, so a re-import of the same months
 * overwrites them in place (only fetched_at changes when the data is identical).
 *
 * REQUIRES the gated anon INSERT/UPDATE grant + write RLS policy to be applied first
 * (supabase/member_retention_rates_schema.sql); until then PostgREST returns 401/403.
 */
export async function upsertMemberRetentionRates(rows: RetentionMonth[]): Promise<void> {
  const cfg = getSupabaseConfig();
  if (!cfg) {
    throw new Error('Supabase isn’t configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).');
  }
  if (rows.length === 0) throw new Error('No rows to import.');

  const fetchedAt = new Date().toISOString(); // write-time freshness stamp (matches the seed script's fetched_at = now()).
  const body = rows.map((r) => ({
    workspace_id: WORKSPACE_ID,
    period_month: r.periodMonth,
    current_members: r.currentMembers,
    prior_members: r.priorMembers,
    lost_members: r.lostMembers,
    new_members: r.newMembers,
    returning_members: r.returningMembers,
    retention_rate: r.retentionRate,
    is_seed_boundary: r.isSeedBoundary,
    fetched_at: fetchedAt,
  }));

  let response: Response;
  try {
    response = await fetch(
      `${cfg.url}/rest/v1/${RETENTION_RATES_TABLE}?on_conflict=workspace_id,period_month`,
      {
        method: 'POST',
        headers: {
          apikey: cfg.anonKey,
          Authorization: `Bearer ${cfg.anonKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal,resolution=merge-duplicates',
        },
        body: JSON.stringify(body),
      },
    );
  } catch {
    throw new Error('Couldn’t reach Supabase to save the import. Check your connection and try again.');
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).trim();
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Saving was blocked (HTTP ${response.status}). The one-time database access change for retention imports hasn’t been applied yet.${detail ? ` ${detail}` : ''}`,
      );
    }
    throw new Error(`Retention import failed (HTTP ${response.status}).${detail ? ` ${detail}` : ''}`);
  }
}
