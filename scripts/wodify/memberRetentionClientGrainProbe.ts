/**
 * Wodify "Member Retention" (CLIENT-GRAIN) EXPORT — COMPLETENESS + SHAPE feasibility probe.
 *
 * ┌─────────────────────────────────────────────────────────────────────────────────────────────┐
 * │ DRAFT — PENDING THE TWO-AI REVIEWER GATE. DO NOT RUN ON THE LIVE EXPORT until the Reviewer     │
 * │ reads this script and PASSes, then Wesley GOes — same gate as clientsDobFillProbe (Probe #2).  │
 * │ The network-free `--selftest` is always safe and is the documented pre-gate step.             │
 * └─────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * LOCAL ONLY — reads ONE local file the owner already exported. NO network, NO API key, NO Supabase,
 * NO SPA import, NO Wodify pull. It opens the file, classifies into aggregates, and discards.
 *
 * Question (the DEEP-MANUAL gate for the Phase-2 age-segment churn toggle):
 *   Is Wodify's CLIENT-GRAIN "Member Retention" dataset export COMPLETE and well-shaped enough to be
 *   the deep history substrate? It is the only client-grain monthly-change source — joinable to
 *   /clients date_of_birth (95% active / 100% inactive coverage per Probe #2) for an age-resolved,
 *   multi-month series. The #1 risk is SILENT TRUNCATION at Wodify's 2,000-row display cap: a capped
 *   export looks fine but corrupts the whole reconstructed history. This probe REPORTS; the human /
 *   Reviewer make the real call.
 *
 * SOURCE (NOT "Member Retention Rates" — that is the gym-wide aggregate, #495; NOT All-Memberships):
 *   The manual export (CSV or JSON) of Wodify's "Member Retention" dataset, saved under
 *   ~/.config/wx-cfo/ (0600 file, 0700 dir; PII: Client Name + IDs; NEVER committed — repo is PUBLIC).
 *   Use the RAW export ("Keep the data formatted" UNCHECKED → ISO dates). Path = first non-flag argv.
 *   Expected columns: First Of Month · Client ID · Change Type · Positive Change · Negative Change ·
 *   Membership ID · Client Name.
 *
 * VERIFY + EMIT (§5-safe — counts, category LABELS, gym-wide month-span, value-shape, booleans ONLY;
 *   NEVER Client Name / Client ID / Membership ID values, never an exact day-level date, never a
 *   per-member row):
 *   1. COMPLETENESS vs the 2,000-row display cap (#1 check): rowsParsed + capSuspicion boolean
 *      (rowsParsed === 2000 → FAIL "likely_truncated"; a capped export silently corrupts history).
 *   2. HISTORY DEPTH: distinctMonths + monthSpan {min,max} as "YYYY-MM" (gym-wide range — non-identifying).
 *   3. CHANGE-TYPE VOCABULARY: distinct Change Type LABELS + count per label (categories, not PII).
 *   4. DUPLICATE CLIENT-MONTH: distinctClientMonthPairs vs totalRows + duplicatePairCount (never the IDs).
 *   Plus: distinctClientIdCount (a number only); value-shape of Positive/Negative Change (flag01 vs integer).
 *
 * Safe-output contract (§4/§5 — the tightest sibling form, clientsDobFillProbe.ts):
 *   - Local ONLY. Never imported by the SPA, never bundled, never `VITE_*`. No network, no key, no Supabase.
 *   - Reads Client Name / Client ID / Membership ID / dates IN MEMORY only, reduces to counts, discards.
 *     Output is counts, percentages, booleans, category LABELS, value-shape enums, and "YYYY-MM" months.
 *     NEVER member names, ids, raw rows, emails, or any exact YYYY-MM-DD day-level date.
 *   - LEAK GUARD (live AND selftest): the serialized output is re-scanned before printing and the run
 *     ABORTS WITHOUT printing if it contains an '@', any >= 7-digit run (Client/Membership IDs are 7-8
 *     digits; no legitimate aggregate for a ~1k-client gym reaches 7 integer digits), or any YYYY-MM-DD
 *     full date (months emit as the coarser "YYYY-MM"). Defense-in-depth behind the selftest assertions.
 *   - `--selftest` runs FIRST, makes NO network call and reads NO file (synthetic in-memory data).
 *
 * Gated-run discipline (sibling precedent — clientsDobFillProbe / membershipsEndDateProbe):
 *   build + `--selftest` → Reviewer reads this script + PASS → explicit Wesley GO → live run.
 *   Manual/default permission mode. This DRAFT executes NOTHING on the live export.
 *
 * Run:
 *   Network-free self-test FIRST (no file, no network):
 *     npx tsx scripts/wodify/memberRetentionClientGrainProbe.ts --selftest
 *   Live run (ONLY AFTER the gate):
 *     npx tsx scripts/wodify/memberRetentionClientGrainProbe.ts ~/.config/wx-cfo/<member_retention_export>.csv
 */

import { readFileSync } from 'node:fs';

// ─── CONFIG ────────────────────────────────────────────────────────────────────────────────────────
const DISPLAY_CAP = 2000; // Wodify's on-screen dataset display cap; an export of EXACTLY this size is suspect.

// Known columns → normalized lookup key (lowercase, alphanumerics only). JSON keys normalize the same way.
const COLUMN_KEYS = {
  firstOfMonth: 'firstofmonth',
  clientId: 'clientid',
  changeType: 'changetype',
  positiveChange: 'positivechange',
  negativeChange: 'negativechange',
  membershipId: 'membershipid',
  clientName: 'clientname',
} as const;
const REQUIRED_COLUMNS: Array<keyof typeof COLUMN_KEYS> = ['firstOfMonth', 'clientId', 'changeType'];

// ─── TYPES ─────────────────────────────────────────────────────────────────────────────────────────
type ValueShape = 'flag01' | 'integer' | 'nonNumeric' | 'empty' | 'mixed';
type Verdict =
  | 'client_grain_export_usable'
  | 'likely_truncated'
  | 'missing_required_columns'
  | 'empty_or_unparseable';

interface ColumnsPresent {
  firstOfMonth: boolean;
  clientId: boolean;
  changeType: boolean;
  positiveChange: boolean;
  negativeChange: boolean;
  membershipId: boolean;
  clientName: boolean;
}

interface MemberRetentionClientGrainResult {
  probe: 'memberRetentionClientGrainProbe';
  source: 'csv' | 'json';
  parseOk: boolean;
  columnsPresent: ColumnsPresent;
  unexpectedColumns: string[];
  // (1) completeness vs display cap
  rowsParsed: number;
  displayCap: number;
  capSuspicion: boolean;
  // (2) history depth
  distinctMonths: number;
  monthSpan: { min: string | null; max: string | null };
  monthsUnparseable: number;
  // (3) change-type vocabulary
  distinctChangeTypeCount: number;
  changeTypeVocab: Array<{ label: string; count: number }>;
  // (4) duplicate client-month
  totalRows: number;
  distinctClientMonthPairs: number;
  duplicatePairCount: number;
  // plus
  distinctClientIdCount: number;
  changeValueShape: { positiveChange: ValueShape; negativeChange: ValueShape };
  // verdict
  verdict: Verdict;
  verdictProvisional: boolean;
}

// A parsed row holds PII IN MEMORY ONLY (never serialized into the result).
interface ParsedRow {
  month: string | null; // "YYYY-MM" or null if unparseable
  clientId: string;
  changeType: string;
  positiveChangeRaw: string;
  negativeChangeRaw: string;
}

// ─── HELPERS ───────────────────────────────────────────────────────────────────────────────────────
function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Extract a coarse "YYYY-MM" from a First-Of-Month value; never emit the day. RAW export is ISO; we also
// accept an ISO datetime. Returns null if no YYYY-MM can be recovered (counted as monthsUnparseable).
function toYearMonth(raw: string): string | null {
  const v = (raw ?? '').trim();
  const iso = v.match(/^(\d{4})-(\d{2})/);
  if (iso) {
    const mm = Number(iso[2]);
    if (mm >= 1 && mm <= 12) return `${iso[1]}-${iso[2]}`;
  }
  return null;
}

function classifyValueShape(values: string[]): ValueShape {
  let empty = 0;
  let zeroOne = 0;
  let intOther = 0;
  let nonNumeric = 0;
  for (const raw of values) {
    const v = (raw ?? '').trim();
    if (v === '') {
      empty++;
      continue;
    }
    if (/^-?\d+$/.test(v)) {
      const n = Number(v);
      if (n === 0 || n === 1) zeroOne++;
      else intOther++; // >1 or negative
    } else {
      nonNumeric++;
    }
  }
  const numericSeen = zeroOne + intOther;
  if (nonNumeric > 0 && numericSeen > 0) return 'mixed';
  if (nonNumeric > 0) return 'nonNumeric';
  if (intOther > 0) return 'integer';
  if (zeroOne > 0) return 'flag01';
  return 'empty';
}

// ─── PARSING (self-contained; RFC4180-ish CSV with quoted fields, escaped quotes, CRLF) ──────────────
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      field = '';
      row = [];
    } else {
      field += c;
    }
  }
  // trailing field/row (no terminating newline)
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // drop fully-empty trailing rows
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

interface ColumnMap {
  index: Partial<Record<keyof typeof COLUMN_KEYS, number>>;
  unexpected: string[];
}

function mapHeader(header: string[]): ColumnMap {
  const wanted = new Map<string, keyof typeof COLUMN_KEYS>();
  (Object.keys(COLUMN_KEYS) as Array<keyof typeof COLUMN_KEYS>).forEach((k) => wanted.set(COLUMN_KEYS[k], k));
  const index: Partial<Record<keyof typeof COLUMN_KEYS, number>> = {};
  const unexpected: string[] = [];
  header.forEach((name, i) => {
    const nk = normalizeKey(name);
    const known = wanted.get(nk);
    if (known) index[known] = i;
    else unexpected.push(name.replace(/\d{4,}/g, '#')); // redact long digit-runs in stray column NAMES
  });
  return { index, unexpected };
}

function rowsFromCsv(text: string): { rows: ParsedRow[]; present: ColumnsPresent; unexpected: string[] } {
  const grid = parseCsv(text);
  if (grid.length === 0) return { rows: [], present: emptyPresent(), unexpected: [] };
  const { index, unexpected } = mapHeader(grid[0]);
  const present = presentFromIndex(index);
  const rows: ParsedRow[] = [];
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    const get = (k: keyof typeof COLUMN_KEYS): string =>
      index[k] === undefined ? '' : (cells[index[k] as number] ?? '');
    rows.push({
      month: toYearMonth(get('firstOfMonth')),
      clientId: get('clientId'),
      changeType: get('changeType'),
      positiveChangeRaw: get('positiveChange'),
      negativeChangeRaw: get('negativeChange'),
    });
  }
  return { rows, present, unexpected };
}

// JSON: array of objects, or an object wrapping a single array property.
function rowsFromJson(text: string): { rows: ParsedRow[]; present: ColumnsPresent; unexpected: string[] } {
  const parsed: unknown = JSON.parse(text);
  let arr: unknown[] = [];
  if (Array.isArray(parsed)) arr = parsed;
  else if (parsed && typeof parsed === 'object') {
    const firstArray = Object.values(parsed as Record<string, unknown>).find((v) => Array.isArray(v));
    if (Array.isArray(firstArray)) arr = firstArray;
  }
  const seenKeys = new Map<string, string>(); // normalizedKey -> original name (for unexpected reporting)
  const known = new Set<string>(Object.values(COLUMN_KEYS));
  const rows: ParsedRow[] = [];
  const present: ColumnsPresent = emptyPresent();
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const norm = new Map<string, string>();
    for (const [name, val] of Object.entries(obj)) {
      const nk = normalizeKey(name);
      norm.set(nk, val == null ? '' : String(val));
      if (!known.has(nk)) seenKeys.set(nk, name.replace(/\d{4,}/g, '#'));
    }
    const get = (nk: string): string => norm.get(nk) ?? '';
    if (norm.has(COLUMN_KEYS.firstOfMonth)) present.firstOfMonth = true;
    if (norm.has(COLUMN_KEYS.clientId)) present.clientId = true;
    if (norm.has(COLUMN_KEYS.changeType)) present.changeType = true;
    if (norm.has(COLUMN_KEYS.positiveChange)) present.positiveChange = true;
    if (norm.has(COLUMN_KEYS.negativeChange)) present.negativeChange = true;
    if (norm.has(COLUMN_KEYS.membershipId)) present.membershipId = true;
    if (norm.has(COLUMN_KEYS.clientName)) present.clientName = true;
    rows.push({
      month: toYearMonth(get(COLUMN_KEYS.firstOfMonth)),
      clientId: get(COLUMN_KEYS.clientId),
      changeType: get(COLUMN_KEYS.changeType),
      positiveChangeRaw: get(COLUMN_KEYS.positiveChange),
      negativeChangeRaw: get(COLUMN_KEYS.negativeChange),
    });
  }
  return { rows, present, unexpected: [...seenKeys.values()] };
}

function emptyPresent(): ColumnsPresent {
  return {
    firstOfMonth: false,
    clientId: false,
    changeType: false,
    positiveChange: false,
    negativeChange: false,
    membershipId: false,
    clientName: false,
  };
}

function presentFromIndex(index: Partial<Record<keyof typeof COLUMN_KEYS, number>>): ColumnsPresent {
  return {
    firstOfMonth: index.firstOfMonth !== undefined,
    clientId: index.clientId !== undefined,
    changeType: index.changeType !== undefined,
    positiveChange: index.positiveChange !== undefined,
    negativeChange: index.negativeChange !== undefined,
    membershipId: index.membershipId !== undefined,
    clientName: index.clientName !== undefined,
  };
}

// ─── CLASSIFY (pure: ParsedRow[] → §5-safe result) ───────────────────────────────────────────────────
function classify(
  rows: ParsedRow[],
  present: ColumnsPresent,
  unexpected: string[],
  source: 'csv' | 'json',
  parseOk: boolean,
): MemberRetentionClientGrainResult {
  const rowsParsed = rows.length;

  // history depth
  const months = new Set<string>();
  let monthsUnparseable = 0;
  for (const r of rows) {
    if (r.month) months.add(r.month);
    else monthsUnparseable++;
  }
  const sortedMonths = [...months].sort();
  const monthSpan = {
    min: sortedMonths.length ? sortedMonths[0] : null,
    max: sortedMonths.length ? sortedMonths[sortedMonths.length - 1] : null,
  };

  // change-type vocabulary
  const vocab = new Map<string, number>();
  for (const r of rows) {
    const label = r.changeType.trim() === '' ? '(blank)' : r.changeType.trim();
    vocab.set(label, (vocab.get(label) ?? 0) + 1);
  }
  const changeTypeVocab = [...vocab.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  // duplicate (clientId, month) pairs + distinct client ids
  const pairCounts = new Map<string, number>();
  const clientIds = new Set<string>();
  for (const r of rows) {
    clientIds.add(r.clientId);
    const key = `${r.clientId} ${r.month ?? ''}`;
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }
  let duplicatePairCount = 0;
  for (const c of pairCounts.values()) if (c > 1) duplicatePairCount++;

  // value shapes
  const changeValueShape = {
    positiveChange: classifyValueShape(rows.map((r) => r.positiveChangeRaw)),
    negativeChange: classifyValueShape(rows.map((r) => r.negativeChangeRaw)),
  };

  const capSuspicion = rowsParsed === DISPLAY_CAP;
  const missingRequired = REQUIRED_COLUMNS.some((c) => !present[c]);

  let verdict: Verdict;
  if (!parseOk || rowsParsed === 0) verdict = 'empty_or_unparseable';
  else if (missingRequired) verdict = 'missing_required_columns';
  else if (capSuspicion) verdict = 'likely_truncated';
  else verdict = 'client_grain_export_usable';

  const verdictProvisional =
    verdict === 'client_grain_export_usable' && (unexpected.length > 0 || monthsUnparseable > 0);

  return {
    probe: 'memberRetentionClientGrainProbe',
    source,
    parseOk,
    columnsPresent: present,
    unexpectedColumns: unexpected,
    rowsParsed,
    displayCap: DISPLAY_CAP,
    capSuspicion,
    distinctMonths: months.size,
    monthSpan,
    monthsUnparseable,
    distinctChangeTypeCount: changeTypeVocab.length,
    changeTypeVocab,
    totalRows: rowsParsed,
    distinctClientMonthPairs: pairCounts.size,
    duplicatePairCount,
    distinctClientIdCount: clientIds.size,
    changeValueShape,
    verdict,
    verdictProvisional,
  };
}

// ─── LEAK GUARD (field-agnostic; used by BOTH the selftest and the live path) ────────────────────────
function scanForLeak(serialized: string): string[] {
  const v: string[] = [];
  if (/\d{4}-\d{2}-\d{2}/.test(serialized)) v.push('YYYY-MM-DD day-level date');
  if (/\d{7,}/.test(serialized)) v.push('>=7-digit run (ID-shaped)');
  if (serialized.includes('@')) v.push('@ (email-shaped)');
  return v;
}

// ─── SELF-TEST (network-free, no file; synthetic in-memory data with planted PII) ────────────────────
function runSelfTest(): void {
  const NAME_SENTINEL = 'ZZ_LEAK_NAME_SENTINEL';
  const ID_SENTINEL = '98765432'; // 8-digit fake Client ID VALUE
  const MID_SENTINEL = '1234567'; // 7-digit fake Membership ID VALUE
  const PII = [NAME_SENTINEL, ID_SENTINEL, MID_SENTINEL, 'leak@member.example'];

  // Case A — small valid CSV. clientId 11/11/22 with a planted DUP (client 11 in 2024-01 twice).
  // Change types: New x3, Returning x2, Lost x1. Positive/Negative as 0/1 flags. Months span 2024-01..2024-03.
  const csvA = [
    'First Of Month,Client ID,Change Type,Positive Change,Negative Change,Membership ID,Client Name',
    `2024-01-01,11,New,1,0,${MID_SENTINEL},${NAME_SENTINEL}`,
    `2024-01-01,11,Returning,1,0,2222223,"Doe, Jane"`, // DUP (11, 2024-01) + quoted comma name
    `2024-01-01,22,New,1,0,2222224,Smith`,
    `2024-02-01,${ID_SENTINEL},New,1,0,2222225,Roe`,
    `2024-02-01,33,Returning,0,1,2222226,Lee`,
    `2024-03-01,44,Lost,0,1,2222227,leak@member.example`,
  ].join('\n');
  const a = rowsFromCsv(csvA);
  const resA = classify(a.rows, a.present, a.unexpected, 'csv', true);
  const serA = JSON.stringify(resA, null, 2);

  const fail = (msg: string): void => {
    console.error(`SELFTEST FAIL: ${msg}`);
    process.exit(1);
  };

  // (1) LEAK SCAN — no planted PII token, and no structural leak signature, may appear in output.
  const tokenLeaks = PII.filter((t) => serA.includes(t));
  if (tokenLeaks.length) fail(`planted PII leaked into output: ${tokenLeaks.join(', ')}`);
  const structLeaks = scanForLeak(serA);
  if (structLeaks.length) fail(`structural leak signature in output: ${structLeaks.join(', ')}`);

  // (2) STRUCTURAL TALLIES
  const checksA: Array<[string, boolean]> = [
    ['rowsParsed = 6', resA.rowsParsed === 6],
    ['capSuspicion false', resA.capSuspicion === false],
    ['distinctMonths = 3', resA.distinctMonths === 3],
    ['monthSpan min 2024-01', resA.monthSpan.min === '2024-01'],
    ['monthSpan max 2024-03', resA.monthSpan.max === '2024-03'],
    ['distinctChangeTypeCount = 3', resA.distinctChangeTypeCount === 3],
    ['New count = 3', resA.changeTypeVocab.find((x) => x.label === 'New')?.count === 3],
    ['Returning count = 2', resA.changeTypeVocab.find((x) => x.label === 'Returning')?.count === 2],
    ['Lost count = 1', resA.changeTypeVocab.find((x) => x.label === 'Lost')?.count === 1],
    ['vocab sorted desc (New first)', resA.changeTypeVocab[0].label === 'New'],
    ['distinctClientIdCount = 5', resA.distinctClientIdCount === 5], // 11,22,98765432,33,44
    ['distinctClientMonthPairs = 5', resA.distinctClientMonthPairs === 5], // (11,01) dup collapses 6→5
    ['duplicatePairCount = 1', resA.duplicatePairCount === 1],
    ['positiveChange flag01', resA.changeValueShape.positiveChange === 'flag01'],
    ['negativeChange flag01', resA.changeValueShape.negativeChange === 'flag01'],
    ['all required columns present', resA.columnsPresent.firstOfMonth && resA.columnsPresent.clientId && resA.columnsPresent.changeType],
    ['clientName + membershipId present', resA.columnsPresent.clientName && resA.columnsPresent.membershipId],
    ['no unexpected columns', resA.unexpectedColumns.length === 0],
    ['monthsUnparseable = 0', resA.monthsUnparseable === 0],
    ['verdict usable', resA.verdict === 'client_grain_export_usable'],
  ];
  const failedA = checksA.filter(([, ok]) => !ok).map(([n]) => n);
  if (failedA.length) fail(`Case A check(s): ${failedA.join('; ')}`);

  // (3) CAP SUSPICION — exactly DISPLAY_CAP rows ⇒ capSuspicion true, verdict likely_truncated.
  const capLines = ['First Of Month,Client ID,Change Type,Positive Change,Negative Change,Membership ID,Client Name'];
  for (let i = 0; i < DISPLAY_CAP; i++) capLines.push(`2024-01-01,${1000 + i},New,1,0,200${i},N${i}`);
  const capParsed = rowsFromCsv(capLines.join('\n'));
  const resCap = classify(capParsed.rows, capParsed.present, capParsed.unexpected, 'csv', true);
  if (!(resCap.rowsParsed === DISPLAY_CAP && resCap.capSuspicion === true && resCap.verdict === 'likely_truncated')) {
    fail(`cap-suspicion not detected (rows=${resCap.rowsParsed}, susp=${resCap.capSuspicion}, verdict=${resCap.verdict})`);
  }
  if (scanForLeak(JSON.stringify(resCap)).length) fail('cap-case output tripped leak guard');

  // (4) INTEGER value-shape — a Positive Change > 1 ⇒ 'integer'.
  const intCsv = [
    'First Of Month,Client ID,Change Type,Positive Change,Negative Change,Membership ID,Client Name',
    '2024-01-01,11,New,3,0,2222228,A',
    '2024-01-01,12,New,1,0,2222229,B',
  ].join('\n');
  const intParsed = rowsFromCsv(intCsv);
  const resInt = classify(intParsed.rows, intParsed.present, intParsed.unexpected, 'csv', true);
  if (resInt.changeValueShape.positiveChange !== 'integer') fail(`integer value-shape not detected (${resInt.changeValueShape.positiveChange})`);

  // (5) JSON variant — same tallies as Case A, no leak.
  const jsonRows = [
    { 'First Of Month': '2024-01-01', 'Client ID': '11', 'Change Type': 'New', 'Positive Change': '1', 'Negative Change': '0', 'Membership ID': MID_SENTINEL, 'Client Name': NAME_SENTINEL },
    { 'First Of Month': '2024-01-01', 'Client ID': '11', 'Change Type': 'Returning', 'Positive Change': '1', 'Negative Change': '0', 'Membership ID': '2222223', 'Client Name': 'Doe, Jane' },
    { 'First Of Month': '2024-02-01', 'Client ID': '22', 'Change Type': 'New', 'Positive Change': '1', 'Negative Change': '0', 'Membership ID': '2222224', 'Client Name': 'Smith' },
  ];
  const j = rowsFromJson(JSON.stringify(jsonRows));
  const resJ = classify(j.rows, j.present, j.unexpected, 'json', true);
  const serJ = JSON.stringify(resJ, null, 2);
  if (PII.filter((t) => serJ.includes(t)).length) fail('JSON path leaked planted PII');
  if (scanForLeak(serJ).length) fail('JSON path output tripped leak guard');
  if (!(resJ.rowsParsed === 3 && resJ.duplicatePairCount === 1 && resJ.distinctClientIdCount === 2)) {
    fail(`JSON tallies wrong (rows=${resJ.rowsParsed}, dup=${resJ.duplicatePairCount}, clients=${resJ.distinctClientIdCount})`);
  }

  // (6) MISSING REQUIRED COLUMN — no "Change Type" ⇒ missing_required_columns.
  const missCsv = ['First Of Month,Client ID,Positive Change', '2024-01-01,11,1'].join('\n');
  const missParsed = rowsFromCsv(missCsv);
  const resMiss = classify(missParsed.rows, missParsed.present, missParsed.unexpected, 'csv', true);
  if (resMiss.verdict !== 'missing_required_columns') fail(`missing-column verdict wrong (${resMiss.verdict})`);

  // (7) LEAK-GUARD UNIT TEST — the guard itself must flag each structural signature.
  if (scanForLeak(`{"x":"${ID_SENTINEL}"}`).length === 0) fail('guard missed a 7+ digit run');
  if (scanForLeak('{"x":"a@b"}').length === 0) fail('guard missed an @');
  if (scanForLeak('{"x":"2020-01-01"}').length === 0) fail('guard missed a YYYY-MM-DD date');
  if (scanForLeak('{"min":"2024-01","max":"2024-03","n":2000}').length !== 0) fail('guard false-positived on YYYY-MM month + 4-digit count');

  console.log(serA);
  console.log(
    'SELFTEST PASS: no planted PII/ID/date leaked (and no per-member row emitted); row-count, cap-suspicion (=2000), ' +
      'dup (client,month) detection, change-type vocab, value-shape (flag01/integer), JSON path, missing-column verdict, ' +
      'and the live leak-guard all correct; no file or network touched.',
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────────────────────────
function main(): void {
  if (process.argv.includes('--selftest')) {
    runSelfTest();
    return;
  }
  const path = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!path) {
    console.error('Usage: memberRetentionClientGrainProbe.ts <path-to-export.(csv|json)>  (or --selftest)');
    process.exit(1);
    return;
  }
  const text = readFileSync(path, 'utf8');
  const isJson = path.toLowerCase().endsWith('.json') || /^\s*[[{]/.test(text);
  let result: MemberRetentionClientGrainResult;
  try {
    const parsed = isJson ? rowsFromJson(text) : rowsFromCsv(text);
    result = classify(parsed.rows, parsed.present, parsed.unexpected, isJson ? 'json' : 'csv', true);
  } catch {
    result = classify([], emptyPresent(), [], isJson ? 'json' : 'csv', false);
  }
  const serialized = JSON.stringify(result, null, 2);

  // LIVE LEAK GUARD (defense-in-depth behind the selftest): abort WITHOUT printing if any PII signature slipped in.
  const leaks = scanForLeak(serialized);
  if (leaks.length > 0) {
    console.error(`LIVE LEAK GUARD TRIPPED: ${leaks.join(', ')} — aborting WITHOUT printing.`);
    process.exit(1);
    return;
  }
  console.log(serialized);
}

main();
