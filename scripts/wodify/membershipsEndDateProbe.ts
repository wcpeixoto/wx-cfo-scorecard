/**
 * Wodify "All Memberships" EXPORT — END / CANCELLATION-DATE FEASIBILITY probe.
 *
 * ┌─────────────────────────────────────────────────────────────────────────────────────────────┐
 * │ DRAFT — PENDING THE TWO-AI REVIEWER GATE. DO NOT RUN until the Reviewer validates the plan.   │
 * │ This session delivered the PLAN + this draft only (BACKLOG.md "Retention (priority)" item 1). │
 * └─────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * LOCAL ONLY — reads ONE local CSV file. NO network, NO API key, NO Supabase, NO SPA import,
 * NO Wodify pull of any kind. It opens a file the owner already exported, classifies, and discards.
 *
 * Question (the substrate probe gating the churn-evolution chart, BACKLOG.md @ main 7c5c1ad):
 *   Does the RAW All-Memberships export carry a per-membership END / cancellation DATE (beyond the
 *   known Start Date) good enough to reconstruct a historical churn curve from data we already pull?
 *   - End-signal present + well-populated for ended memberships  → reconstruct a real multi-year
 *     curve NOW (Option A).
 *   - Absent / sparse                                            → the chart falls back to forward
 *     Tenure-Snapshot accrual (~Dec 2026 for a full 6-month view).
 *   The script REPORTS which; the human / Reviewer make the real call.
 *
 * Known header (profiled 2026-06-12 via silentChurnDuesPreview.ts — reading ONLY the 'Membership
 * Type' column; captured verbatim in that script's selftest fixture):
 *   Client ID · Client Name · Membership ID · Membership · Membership Type · Payment Plan ·
 *   Programs · Location · Start Date · Expiration Date · Membership Autorenew · Commitment Total ·
 *   Autorenew Commitment Total · Payment Plan Type · Clients → Email ·
 *   Clients → Mass Email Subscribed · Clients → Default Payment Method
 *   → NO explicit cancellation / termination / status column in that profile. The only end-of-life
 *     temporal signal is `Expiration Date` (a scheduled term-end, NOT a churn event) + `Membership
 *     Autorenew`. Phase 1 re-confirms this against the on-disk raw export (column set can differ by
 *     report config / "Keep the data formatted" toggle).
 *
 * Two-phase, cheapest-first (mirrors the directive's "header-only first; a fresh pull only if the
 * schema check requires it"):
 *   PHASE 1 — HEADER ONLY (default). Inspect ONLY the CSV header line. Enumerate column NAMES;
 *     flag any NOVEL end/cancellation/termination column and any membership-STATUS column beyond the
 *     known {Start Date, Expiration Date}. No data row is parsed. If nothing novel appears, the
 *     header alone yields the verdict (expiration-proxy only) — zero rows read.
 *   PHASE 2 — ROW AGGREGATES (`--scan-rows`, SAME on-disk file; NOT a fresh pull). Only worth running
 *     if Phase 1 found a candidate column OR to measure the Expiration-Date proxy. For each candidate
 *     end column: fill-rate by parse class. For Expiration Date: past/today/future split crossed with
 *     Membership Autorenew (no-autorenew + past-expiration ≈ an ended membership — the proxy's
 *     reconstructable population). AGGREGATES ONLY.
 *
 * Reads: the RAW export ("Keep the data formatted" UNCHECKED → ISO YYYY-MM-DD) at
 *   ~/.config/wx-cfo/dues/ (0700 dir; PII: names + emails; NEVER committed — CFO repo is PUBLIC).
 *   Path = first non-flag argv.
 *
 * Safe-output contract (§4/§5 posture — the TIGHTEST sibling form, clientsDobFillProbe.ts):
 *   - Output is counts, percentages, booleans, column NAMES (ID-like redacted), parse-status classes,
 *     and a verdict enum — NEVER member names, ids, emails, raw rows, dollars, or ANY YYYY-MM-DD
 *     string. No year is emitted either (a year is a re-identification proxy).
 *   - LEAK GUARD (live AND selftest): the serialized result is re-scanned before printing and the run
 *     ABORTS WITHOUT printing if it contains any '@', any >= 7-digit run (Client IDs are 7-8 digits;
 *     no emitted aggregate reaches 7 integer digits), or any ISO date. Defense-in-depth behind the
 *     selftest's planted-PII assertions.
 *   - Strict CALENDAR round-trip for date validity (2026-02-30 → invalid, never rolled to March).
 *   - `--selftest` runs FIRST, makes NO network call and reads NO file (synthetic in-memory CSV).
 *
 * Gated-run discipline (sibling precedent — clientsDobFillProbe / silentChurnDuesPreview):
 *   build + `--selftest` → Reviewer PASS → explicit Wesley GO → header-only run → (if warranted)
 *   `--scan-rows`. Manual/default permission mode; native prompts = authorization; stop at any
 *   platform boundary; platform-denial-without-prompt → report + STOP. This DRAFT executes NOTHING.
 *
 * Run (ONLY AFTER the gate — never this session):
 *   npx tsx scripts/wodify/membershipsEndDateProbe.ts --selftest                 # no file, no network
 *   npx tsx scripts/wodify/membershipsEndDateProbe.ts ~/.config/wx-cfo/dues/all_memberships_*.csv
 *   npx tsx scripts/wodify/membershipsEndDateProbe.ts <path> --scan-rows
 */

import { readFileSync } from 'node:fs';

// ─── Known schema anchors (confirmed against the on-disk export at run, never assumed) ─────────────
const KNOWN_START_COL = 'Start Date';
const KNOWN_EXPIRATION_COL = 'Expiration Date';
const KNOWN_AUTORENEW_COL = 'Membership Autorenew';
const KNOWN_CLIENT_ID_COL = 'Client ID';
const SENTINEL_NULL_DATE = '1900-01-01'; // Wodify's null sentinel — counted separately, never "real".

// A NOVEL end/cancellation column = a date-bearing lifecycle-end field beyond Start/Expiration.
const END_DATE_NAME_PATTERN = /\bcancel|\bcancell|\bended?\b|\bend date\b|\bterminat|\bdeactiv|\blapse|\bdropped?\b|\bclosed?\b|\bwithdraw|\bfreeze\b|\bfrozen\b/i;
// A membership STATUS/state column (lets us mark "ended" even without a date).
const STATUS_NAME_PATTERN = /\bstatus\b|\bstate\b|\bactive\b|\binactive\b|\bcancel|\bsuspend|\bhold\b|\bpaused?\b|\bfroz/i;

// ─── Safe output contract ──────────────────────────────────────────────────────────────────────────
type Phase = 'header_only' | 'rows_scanned';
type DateCategory =
  | 'keyAbsent'
  | 'nullOrEmpty'
  | 'nonDateShaped'
  | 'sentinel1900'
  | 'invalidCalendar'
  | 'past'
  | 'today'
  | 'future';

type Verdict =
  | 'explicit_end_date_column_present' // a novel cancellation/end DATE column exists — real-history reconstruction viable (Phase 2 measures fill).
  | 'status_column_no_end_date' // a status column can mark "ended" but no end DATE — partial; the curve still needs a date.
  | 'expiration_proxy_only' // no novel column — only Expiration Date + Autorenew; lapse can be PROXIED (non-autorenew past-expiration), with caveats.
  | 'no_end_signal' // nothing usable — fall back to forward Tenure-Snapshot accrual.
  | 'scan_incomplete'; // parse/coverage failure — not trustworthy evidence.

// One date column's population quality (Phase 2). Counts are EXCLUSIVE and conserve to total.
interface DateFieldStats {
  total: number;
  keyAbsent: number;
  nullOrEmpty: number;
  nonDateShaped: number;
  sentinel1900: number;
  invalidCalendar: number;
  past: number; // a real calendar date strictly before the run day — an "already-ended" candidate.
  today: number;
  future: number; // strictly after the run day — a still-scheduled term-end.
  fillRatePct: number; // 100 * (past + today + future) / total, 1 decimal — share carrying a usable date.
}

// Expiration-Date-as-lapse proxy, crossed with autorenew (Phase 2). Counts only.
interface ExpirationProxy {
  pastNoAutorenew: number; // term ended AND not renewing → the strongest "ended membership" proxy.
  pastAutorenew: number; // past expiration but auto-renewing → ambiguous (likely renewed, not ended).
  futureNoAutorenew: number;
  futureAutorenew: number;
  blankOrSentinel: number; // open-ended (session packs) / sentinel — no scheduled end.
  invalidOrNonDate: number;
}

interface ProbeResult {
  probe: 'membershipsEndDateProbe';
  phase: Phase;
  fileReadable: boolean;
  headerParsed: boolean;
  anchorsPresent: boolean; // Client ID AND Start Date both in the parsed header — the cell-echo gate.
  columnCount: number;
  columnNames: string[]; // header leaf NAMES, ID-like redacted, sorted.
  redactedColumnNameCount: number;
  startDateColumnPresent: boolean;
  expirationDateColumnPresent: boolean;
  autorenewColumnPresent: boolean;
  novelEndDateColumns: string[]; // NAMES matching the end/cancellation pattern (excl. Start/Expiration).
  statusColumns: string[]; // NAMES matching the status/state pattern (excl. the knowns + novel-end).
  // Phase 2 only (null in header_only):
  rowsTotal: number | null;
  distinctClients: number | null;
  coverageComplete: boolean | null;
  novelEndColumnStats: Record<string, DateFieldStats> | null; // by column NAME.
  expirationProxy: ExpirationProxy | null;
  verdict: Verdict;
  verdictProvisional: boolean; // true in header_only (fill unmeasured) — a real call needs --scan-rows.
}

// ─── Pure helpers (copied from clientsDobFillProbe.ts — none emit, log, or retain values) ───────────
function normalizeForName(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/[._\d]+/g, ' ');
}

// ID-like field-NAME guard: a key that looks like an ID/token VALUE is never emitted as a "name".
function isIdLikeKey(key: string): boolean {
  if (key.length > 60) return true; // header cells can be long ("Clients → Default Payment Method"); generous bound.
  if (/^\d{3,}$/.test(key)) return true;
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(key)) return true;
  if (/^[0-9a-fA-F]{16,}$/.test(key)) return true;
  return false;
}

// Strict calendar round-trip: parse YMD, rebuild via Date.UTC, require identical components.
function strictYmd(ymd10: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd10);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

// Classify a raw cell into a date category vs the run day. Reads the value in memory; returns a category.
function classifyDateValue(raw: string | undefined, todayYmd: string): DateCategory {
  if (raw === undefined) return 'keyAbsent';
  const s = raw.trim();
  if (s === '') return 'nullOrEmpty';
  const ymd10 = s.slice(0, 10); // tolerate a datetime suffix.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd10)) return 'nonDateShaped';
  if (ymd10 === SENTINEL_NULL_DATE) return 'sentinel1900';
  const canonical = strictYmd(ymd10);
  if (canonical === null) return 'invalidCalendar';
  if (canonical < todayYmd) return 'past'; // lexical compare is valid for zero-padded ISO dates.
  if (canonical > todayYmd) return 'future';
  return 'today';
}

// Field-agnostic leak scan — ISO date, '@', or a 7+ digit run (member id) must never reach stdout.
function leaks(serialized: string): boolean {
  if (/\d{4}-\d{2}-\d{2}/.test(serialized)) return true;
  if (serialized.includes('@')) return true;
  if (/\d{7,}/.test(serialized)) return true;
  return false;
}

// Minimal RFC-ish CSV parser: quoted fields (with commas + doubled quotes), CRLF tolerant.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// ─── Header classification (Phase 1 — names only) ──────────────────────────────────────────────────
interface HeaderClassification {
  columnNames: string[];
  redactedColumnNameCount: number;
  startDateColumnPresent: boolean;
  expirationDateColumnPresent: boolean;
  autorenewColumnPresent: boolean;
  novelEndDateColumns: string[];
  statusColumns: string[];
}

// Echo gate (Reviewer Should-consider): only trust parsed cells as a HEADER when the known anchors are
// BOTH present. A misaligned / headerless file (row 1 = data) lacks them — and a bare member name has
// no '@' / id / date for leaks() to catch, so it would slip through. Absent anchors ⇒ the caller emits
// scan_incomplete with columnNames:[] and never echoes a single parsed cell.
function hasRequiredAnchors(header: string[]): boolean {
  const names = new Set(header.map((c) => c.trim()));
  return names.has(KNOWN_CLIENT_ID_COL) && names.has(KNOWN_START_COL);
}

function classifyHeader(header: string[]): HeaderClassification {
  const safeNames: string[] = [];
  let redacted = 0;
  const novelEnd: string[] = [];
  const status: string[] = [];
  const known = new Set([KNOWN_START_COL, KNOWN_EXPIRATION_COL]);

  for (const rawName of header) {
    const name = rawName.trim();
    if (name === '') continue;
    if (isIdLikeKey(name)) { redacted += 1; continue; }
    safeNames.push(name);
    if (known.has(name)) continue; // Start/Expiration tracked via their own booleans, not as "novel".
    const norm = normalizeForName(name);
    if (END_DATE_NAME_PATTERN.test(norm)) novelEnd.push(name);
    else if (STATUS_NAME_PATTERN.test(norm)) status.push(name);
  }

  return {
    columnNames: [...safeNames].sort(),
    redactedColumnNameCount: redacted,
    startDateColumnPresent: header.some((h) => h.trim() === KNOWN_START_COL),
    expirationDateColumnPresent: header.some((h) => h.trim() === KNOWN_EXPIRATION_COL),
    autorenewColumnPresent: header.some((h) => h.trim() === KNOWN_AUTORENEW_COL),
    novelEndDateColumns: [...new Set(novelEnd)].sort(),
    statusColumns: [...new Set(status)].sort(),
  };
}

function headerOnlyVerdict(h: HeaderClassification): Verdict {
  if (h.novelEndDateColumns.length > 0) return 'explicit_end_date_column_present';
  if (h.statusColumns.length > 0) return 'status_column_no_end_date';
  if (h.expirationDateColumnPresent) return 'expiration_proxy_only';
  return 'no_end_signal';
}

// ─── Row aggregation (Phase 2 — counts only) ───────────────────────────────────────────────────────
function freshStats(): DateFieldStats {
  return { total: 0, keyAbsent: 0, nullOrEmpty: 0, nonDateShaped: 0, sentinel1900: 0, invalidCalendar: 0, past: 0, today: 0, future: 0, fillRatePct: 0 };
}

function applyDate(b: DateFieldStats, cat: DateCategory): void {
  b.total += 1;
  b[cat] += 1;
}

function finishStats(b: DateFieldStats): DateFieldStats {
  const usable = b.past + b.today + b.future;
  b.fillRatePct = b.total > 0 ? Math.round((1000 * usable) / b.total) / 10 : 0;
  return b;
}

function normalizeAutorenew(raw: string): 'auto' | 'no_auto' | 'other' {
  const s = raw.trim().toLowerCase();
  if (s === 'auto renew' || s === 'autorenew' || s === 'yes' || s === 'true') return 'auto';
  if (s === 'no auto renew' || s === 'no autorenew' || s === 'no' || s === 'false') return 'no_auto';
  return 'other';
}

interface RowScan {
  rowsTotal: number;
  distinctClients: number;
  novelEndColumnStats: Record<string, DateFieldStats>;
  expirationProxy: ExpirationProxy;
}

function scanRows(table: string[][], header: string[], h: HeaderClassification, todayYmd: string): RowScan {
  const idxOf = (name: string): number => header.findIndex((c) => c.trim() === name);
  const expIdx = idxOf(KNOWN_EXPIRATION_COL);
  const autoIdx = idxOf(KNOWN_AUTORENEW_COL);
  const clientIdx = idxOf(KNOWN_CLIENT_ID_COL);
  const novelIdx = h.novelEndDateColumns.map((n) => [n, idxOf(n)] as const);

  const stats: Record<string, DateFieldStats> = {};
  for (const [n] of novelIdx) stats[n] = freshStats();
  const proxy: ExpirationProxy = { pastNoAutorenew: 0, pastAutorenew: 0, futureNoAutorenew: 0, futureAutorenew: 0, blankOrSentinel: 0, invalidOrNonDate: 0 };
  const clientIds = new Set<string>(); // ids held for a COUNT only — never emitted (>=7-digit leak guard backs this).
  let rowsTotal = 0;

  for (let r = 1; r < table.length; r++) {
    const row = table[r];
    if (row.length === 1 && row[0].trim() === '') continue; // blank trailing line.
    rowsTotal += 1;
    if (clientIdx >= 0) {
      const id = (row[clientIdx] ?? '').trim();
      if (id !== '') clientIds.add(id);
    }
    for (const [n, i] of novelIdx) applyDate(stats[n], classifyDateValue(i >= 0 ? row[i] : undefined, todayYmd));
    if (expIdx >= 0) {
      const cat = classifyDateValue(row[expIdx], todayYmd);
      const ar = autoIdx >= 0 ? normalizeAutorenew(row[autoIdx] ?? '') : 'other';
      if (cat === 'past' || cat === 'today') {
        // not-renewing (or unknown) on a past term → the strongest "ended membership" proxy;
        // auto-renew past term → ambiguous (likely silently renewed, not a churn event).
        if (ar === 'auto') proxy.pastAutorenew += 1;
        else proxy.pastNoAutorenew += 1;
      } else if (cat === 'future') {
        if (ar === 'no_auto') proxy.futureNoAutorenew += 1;
        else proxy.futureAutorenew += 1;
      } else if (cat === 'nullOrEmpty' || cat === 'sentinel1900' || cat === 'keyAbsent') {
        proxy.blankOrSentinel += 1;
      } else {
        proxy.invalidOrNonDate += 1;
      }
    }
  }

  for (const [n] of novelIdx) finishStats(stats[n]);
  return { rowsTotal, distinctClients: clientIds.size, novelEndColumnStats: stats, expirationProxy: proxy };
}

// ─── Result assembly ───────────────────────────────────────────────────────────────────────────────
function buildHeaderOnlyResult(fileReadable: boolean, headerParsed: boolean, h: HeaderClassification | null): ProbeResult {
  if (!fileReadable || !headerParsed || h === null) {
    return emptyResult('header_only', fileReadable, headerParsed, false);
  }
  return {
    probe: 'membershipsEndDateProbe',
    phase: 'header_only',
    fileReadable,
    headerParsed,
    anchorsPresent: true,
    columnCount: h.columnNames.length + h.redactedColumnNameCount,
    columnNames: h.columnNames,
    redactedColumnNameCount: h.redactedColumnNameCount,
    startDateColumnPresent: h.startDateColumnPresent,
    expirationDateColumnPresent: h.expirationDateColumnPresent,
    autorenewColumnPresent: h.autorenewColumnPresent,
    novelEndDateColumns: h.novelEndDateColumns,
    statusColumns: h.statusColumns,
    rowsTotal: null,
    distinctClients: null,
    coverageComplete: null,
    novelEndColumnStats: null,
    expirationProxy: null,
    verdict: headerOnlyVerdict(h),
    verdictProvisional: true,
  };
}

function buildRowsResult(h: HeaderClassification, scan: RowScan): ProbeResult {
  const coverageComplete = scan.rowsTotal > 0;
  let verdict: Verdict;
  if (!coverageComplete) verdict = 'scan_incomplete';
  else if (h.novelEndDateColumns.some((n) => (scan.novelEndColumnStats[n]?.fillRatePct ?? 0) > 0)) verdict = 'explicit_end_date_column_present';
  else if (h.novelEndDateColumns.length > 0) verdict = 'explicit_end_date_column_present'; // present but empty — still "present", quality is the fill.
  else if (h.statusColumns.length > 0) verdict = 'status_column_no_end_date';
  else if (scan.expirationProxy.pastNoAutorenew > 0) verdict = 'expiration_proxy_only';
  else if (h.expirationDateColumnPresent) verdict = 'expiration_proxy_only';
  else verdict = 'no_end_signal';

  return {
    probe: 'membershipsEndDateProbe',
    phase: 'rows_scanned',
    fileReadable: true,
    headerParsed: true,
    anchorsPresent: true,
    columnCount: h.columnNames.length + h.redactedColumnNameCount,
    columnNames: h.columnNames,
    redactedColumnNameCount: h.redactedColumnNameCount,
    startDateColumnPresent: h.startDateColumnPresent,
    expirationDateColumnPresent: h.expirationDateColumnPresent,
    autorenewColumnPresent: h.autorenewColumnPresent,
    novelEndDateColumns: h.novelEndDateColumns,
    statusColumns: h.statusColumns,
    rowsTotal: scan.rowsTotal,
    distinctClients: scan.distinctClients,
    coverageComplete,
    novelEndColumnStats: scan.novelEndColumnStats,
    expirationProxy: scan.expirationProxy,
    verdict,
    verdictProvisional: false,
  };
}

function emptyResult(phase: Phase, fileReadable: boolean, headerParsed: boolean, anchorsPresent: boolean): ProbeResult {
  return {
    probe: 'membershipsEndDateProbe',
    phase,
    fileReadable,
    headerParsed,
    anchorsPresent,
    columnCount: 0,
    columnNames: [],
    redactedColumnNameCount: 0,
    startDateColumnPresent: false,
    expirationDateColumnPresent: false,
    autorenewColumnPresent: false,
    novelEndDateColumns: [],
    statusColumns: [],
    rowsTotal: null,
    distinctClients: null,
    coverageComplete: null,
    novelEndColumnStats: null,
    expirationProxy: null,
    verdict: 'scan_incomplete',
    verdictProvisional: phase === 'header_only',
  };
}

// Gym-local run day (YYYY-MM-DD), en-CA → ISO order; TZ matches the shipped #445 decision.
function gymLocalTodayYmd(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

// ─── Network/file-free self-test (REQUIRED before any live run) ────────────────────────────────────
function runSelfTest(): void {
  const TODAY = '2026-06-15'; // injected — deterministic.
  const fail = (msg: string): void => { console.error(`SELFTEST FAIL: ${msg}`); process.exit(1); };

  // PII / leak payload — none may appear in output (names, email, member id, EXACT dates, dollars).
  const PII = ['SECRET_FIRST', 'SECRET_LAST', 'secret@member.example', '9000001', '2026-06-30', '179.00000000'];

  // (A) REAL-export header (no novel end column, no status column) → expiration_proxy_only.
  const realHeaderCsv = [
    'Client ID,Client Name,Membership ID,Membership,Membership Type,Payment Plan,Programs,Location,Start Date,Expiration Date,Membership Autorenew,Commitment Total,Autorenew Commitment Total,Payment Plan Type,Clients → Email,Clients → Mass Email Subscribed,Clients → Default Payment Method',
    // past term, NOT renewing → ended-candidate (pastNoAutorenew).
    '9000001,"SECRET_LAST, SECRET_FIRST",80000001,BJJ,Class Plan,Monthly,BJJ,Gym,2026-04-01,2026-04-30,No Auto Renew,179.00000000,179.00000000,Monthly,secret@member.example,Yes,Card',
    // past term, auto-renewing → ambiguous (pastAutorenew).
    '9000002,"SECRET_LAST, SECRET_FIRST",80000002,BJJ,Class Plan,Monthly,BJJ,Gym,2026-05-01,2026-05-31,Auto Renew,179.00000000,179.00000000,Monthly,secret@member.example,Yes,Card',
    // future term, auto → still active (futureAutorenew).
    '9000003,"SECRET_LAST, SECRET_FIRST",80000003,BJJ,Class Plan,Monthly,BJJ,Gym,2026-06-01,2026-06-30,Auto Renew,179.00000000,179.00000000,Monthly,secret@member.example,Yes,Card',
    // open-ended pack (blank expiration) → blankOrSentinel.
    '9000004,"SECRET_LAST, SECRET_FIRST",80000004,Pack,Appointment Pack,Pack,BJJ,Gym,2026-03-01,,No Auto Renew,400.00000000,400.00000000,Pay in Full,secret@member.example,No,Card',
  ].join('\r\n');
  const tableA = parseCsv(realHeaderCsv);
  const hA = classifyHeader(tableA[0]);
  const headerA = buildHeaderOnlyResult(true, true, hA);
  const rowsA = buildRowsResult(hA, scanRows(tableA, tableA[0], hA, TODAY));

  // (B) Header WITH a novel cancellation date column AND a status column → explicit_end_date_column_present.
  const endColCsv = [
    'Client ID,Client Name,Start Date,Expiration Date,Membership Autorenew,Cancellation Date,Membership Status',
    '9000005,"SECRET_LAST, SECRET_FIRST",2025-01-01,2025-12-31,No Auto Renew,2025-08-15,Cancelled',
    '9000006,"SECRET_LAST, SECRET_FIRST",2026-01-01,2026-12-31,Auto Renew,,Active',
    '9000007,"SECRET_LAST, SECRET_FIRST",2025-01-01,2025-06-30,No Auto Renew,2025-02-30,Cancelled', // invalid calendar cancel date.
  ].join('\r\n');
  const tableB = parseCsv(endColCsv);
  const hB = classifyHeader(tableB[0]);
  const rowsB = buildRowsResult(hB, scanRows(tableB, tableB[0], hB, TODAY));

  // (C) Misaligned / headerless input — row 1 is DATA: a bare member NAME with no id/'@'/date for
  // leaks() to catch. The anchor gate (Client ID AND Start Date) must force columnNames:[] +
  // scan_incomplete so no parsed cell — least of all the name — is ever echoed.
  const misalignedCsv = [
    '"SECRET_LAST, SECRET_FIRST",BJJ Unlimited,Monthly,Active',
    '"SECRET_LAST, SECRET_FIRST",BJJ Unlimited,Monthly,Cancelled',
  ].join('\r\n');
  const tableC = parseCsv(misalignedCsv);
  const anchorsC = hasRequiredAnchors(tableC[0]);
  const resultC = anchorsC
    ? buildRowsResult(classifyHeader(tableC[0]), scanRows(tableC, tableC[0], classifyHeader(tableC[0]), TODAY))
    : emptyResult('header_only', true, true, false);

  const checks: Array<[string, boolean]> = [
    // (A) header classification
    ['A: 17 columns', headerA.columnCount === 17],
    ['A: Start Date present', headerA.startDateColumnPresent === true],
    ['A: Expiration Date present', headerA.expirationDateColumnPresent === true],
    ['A: Autorenew present', headerA.autorenewColumnPresent === true],
    ['A: no novel end column', headerA.novelEndDateColumns.length === 0],
    ['A: no status column', headerA.statusColumns.length === 0],
    ['A: header-only verdict = expiration_proxy_only', headerA.verdict === 'expiration_proxy_only'],
    ['A: header-only is provisional', headerA.verdictProvisional === true],
    // (A) row proxy
    ['A: rowsTotal 4', rowsA.rowsTotal === 4],
    ['A: distinctClients 4', rowsA.distinctClients === 4],
    ['A: proxy pastNoAutorenew 1', rowsA.expirationProxy?.pastNoAutorenew === 1],
    ['A: proxy pastAutorenew 1', rowsA.expirationProxy?.pastAutorenew === 1],
    ['A: proxy futureAutorenew 1', rowsA.expirationProxy?.futureAutorenew === 1],
    ['A: proxy blankOrSentinel 1', rowsA.expirationProxy?.blankOrSentinel === 1],
    ['A: rows verdict = expiration_proxy_only', rowsA.verdict === 'expiration_proxy_only'],
    ['A: rows verdict final (not provisional)', rowsA.verdictProvisional === false],
    // (B) novel end + status detection
    ['B: novel end column found', hB.novelEndDateColumns.includes('Cancellation Date')],
    ['B: status column found', hB.statusColumns.includes('Membership Status')],
    ['B: verdict = explicit_end_date_column_present', rowsB.verdict === 'explicit_end_date_column_present'],
    ['B: cancel-date stats present', !!rowsB.novelEndColumnStats?.['Cancellation Date']],
    ['B: cancel-date past = 1', rowsB.novelEndColumnStats?.['Cancellation Date'].past === 1],
    ['B: cancel-date invalidCalendar = 1', rowsB.novelEndColumnStats?.['Cancellation Date'].invalidCalendar === 1],
    ['B: cancel-date nullOrEmpty = 1', rowsB.novelEndColumnStats?.['Cancellation Date'].nullOrEmpty === 1],
    ['B: cancel-date fillRate = 33.3', rowsB.novelEndColumnStats?.['Cancellation Date'].fillRatePct === 33.3],
    // (C) misaligned / headerless — the cell-echo gate
    ['C: anchors absent', anchorsC === false],
    ['C: columnNames empty (no parsed cell echoed)', resultC.columnNames.length === 0],
    ['C: verdict scan_incomplete', resultC.verdict === 'scan_incomplete'],
    ['C: anchorsPresent false', resultC.anchorsPresent === false],
    ['C: gap proof — classifyHeader WOULD echo the bare name', classifyHeader(tableC[0]).columnNames.includes('SECRET_LAST, SECRET_FIRST')],
    ['C: gap proof — leaks() alone misses a bare name', leaks(JSON.stringify(['SECRET_LAST, SECRET_FIRST'])) === false],
  ];
  const failed = checks.filter(([, ok]) => !ok).map(([n]) => n);
  if (failed.length > 0) return fail(`behavioral check(s): ${failed.join('; ')}`);

  // LEAK SCAN — no planted PII / date / id may appear in EITHER serialized result.
  for (const [label, res] of [['A-header', headerA], ['A-rows', rowsA], ['B-rows', rowsB], ['C-misaligned', resultC]] as const) {
    const serialized = JSON.stringify(res, null, 2);
    const planted = PII.filter((tok) => serialized.includes(tok));
    if (planted.length > 0) return fail(`${label} leaked planted token(s): ${planted.join(', ')}`);
    if (leaks(serialized)) return fail(`${label} tripped the field-agnostic leak guard (ISO date / '@' / 7+ digit run)`);
  }

  console.log(JSON.stringify(rowsA, null, 2));
  console.log('SELFTEST PASS: header + proxy + novel-column tallies correct; no planted PII/date/id leaked; no file or network touched.');
}

// ─── Entry ─────────────────────────────────────────────────────────────────────────────────────────
function readHeaderLine(path: string): string {
  const text = readFileSync(path, 'utf8');
  const nl = text.indexOf('\n');
  return (nl === -1 ? text : text.slice(0, nl)).replace(/\r$/, ''); // header only — no data row touched.
}

function emit(result: ProbeResult): void {
  const serialized = JSON.stringify(result, null, 2);
  if (leaks(serialized)) {
    console.error('LEAK GUARD TRIPPED: ISO date / "@" / 7+ digit run in output — aborting WITHOUT printing.');
    process.exit(1);
    return;
  }
  console.log(serialized);
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes('--selftest')) { runSelfTest(); return; }

  const path = args.find((a) => !a.startsWith('--'));
  if (!path) { console.error('Usage: membershipsEndDateProbe.ts <all-memberships.csv> [--scan-rows]'); process.exit(1); return; }
  const scanRowsFlag = args.includes('--scan-rows');
  const today = gymLocalTodayYmd();

  let header: string[];
  try {
    header = parseCsv(readHeaderLine(path))[0] ?? [];
  } catch {
    emit(emptyResult(scanRowsFlag ? 'rows_scanned' : 'header_only', false, false, false));
    return;
  }
  if (header.length === 0) { emit(emptyResult(scanRowsFlag ? 'rows_scanned' : 'header_only', true, false, false)); return; }
  // Echo gate: require the known anchors before trusting/echoing any parsed cell as a column name.
  if (!hasRequiredAnchors(header)) { emit(emptyResult(scanRowsFlag ? 'rows_scanned' : 'header_only', true, true, false)); return; }
  const h = classifyHeader(header);

  if (!scanRowsFlag) { emit(buildHeaderOnlyResult(true, true, h)); return; }

  // Phase 2 — re-read the full file (same on-disk export; NOT a fresh pull) and aggregate.
  const table = parseCsv(readFileSync(path, 'utf8'));
  emit(buildRowsResult(h, scanRows(table, table[0], h, today)));
}

main();
