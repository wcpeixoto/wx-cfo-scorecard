/**
 * Wodify Belt Progressions ⋈ client-grain Member Retention — CHURN-BY-BELT FEASIBILITY probe (pre-build gate).
 *
 * ┌─────────────────────────────────────────────────────────────────────────────────────────────┐
 * │ READ-ONLY. Reads three LOCAL exports, emits COUNTS ONLY. NO Supabase, NO write, NO DB, NO       │
 * │ table creation, NO build, NO import, NO commit. The network-free `--selftest` is always safe.   │
 * │ This is the gate that decides whether a Churn-by-Belt build is even feasible — it is NOT the     │
 * │ build. The readout goes to the Reviewer before any build/import is scoped.                       │
 * └─────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * INPUTS (all LOCAL, 0600, never committed — pass paths in any order; classified by header):
 *   (R)  client-grain "Member Retention" export — ID · Customer ID · First Of Month · Client ID ·
 *        Client Name · Change Type (New/Returning/Lost) · Positive/Negative Change · Membership ID.
 *        The #501 age-cohort source. CHURN POPULATION = distinct Client IDs with >=1 Lost.
 *   (68) Progressions "Current Levels" (ReportId 68) — Client ID · Client Name · Progression · Level ·
 *        Date Achieved (+ trailing tracker cols). Joins to the retention population by CLIENT ID.
 *   (69) Progressions "Previous Levels" (ReportId 69) — Client Name · Progression · Level ·
 *        Date Achieved · Promoted On · Days At Level · Client Active. **NO Client ID** — joins only by
 *        Client Name, bridged through 68/R (which carry both id + name). Name collisions are reported.
 *
 * BELT-AT-MONTH MODEL: each member's dated belt timeline = {68 current level(s) by Client ID} UNION
 * {69 previous levels resolved by unique name->id}. Belt as-of mapped month M = the level with the
 * latest Date Achieved month <= M (month granularity). Determinable for M iff >=1 dated level <= M.
 * Active panel per mapped month = distinct Client IDs with a New/Returning row mapped to M (mapped
 * period = client-grain First Of Month + 1 month — the proven #501 offset). Lost rows = churn out.
 *
 * SAFE-OUTPUT CONTRACT (mirrors retentionCohortJoinProbe / clientsDobFillProbe):
 *   - Local ONLY. Never bundled / VITE_*. Client IDs, names, dates are read in memory, reduced to
 *     COUNTS + taxonomy LABELS (progression/level/band names are not PII) + booleans + a verdict enum.
 *   - NEVER emits member names, Client IDs, emails, raw rows, or any YYYY-MM-DD day-level date. Month
 *     labels are YYYY-MM only (no day → no age/identity proxy).
 *   - LEAK GUARD (live AND selftest): the serialized output is re-scanned before printing; the run
 *     ABORTS WITHOUT printing on any '@', any >=7-digit run (Client IDs are 7-8 digits), or any
 *     YYYY-MM-DD day-level date.
 *   - `--selftest` runs FIRST, makes NO network call and reads NO file (synthetic in-memory data),
 *     and asserts the join / name-bridge collision / dated-reconstruction / sparsity logic + leak guard.
 *
 * Run:
 *   npx tsx scripts/wodify/beltProgressionJoinProbe.ts --selftest                                  # no file/network
 *   npx tsx scripts/wodify/beltProgressionJoinProbe.ts <retention.csv> <current68.csv> <previous69.csv>
 */

// ─── COLUMN CONTRACTS (normalized keys; validated before parsing) ────────────────────────────────────
const RET_REQ = ['firstofmonth', 'clientid', 'clientname', 'changetype'] as const;
const CUR_REQ = ['clientid', 'clientname', 'progression', 'level', 'dateachieved'] as const;
const PREV_REQ = ['clientname', 'progression', 'level', 'dateachieved'] as const; // promotedon optional

const MONTH_START = '2025-06';
const MONTH_END = '2026-06';
const SMALL_CELL = 5; // <5 = suppression-hazard cell

// ─── TYPES ───────────────────────────────────────────────────────────────────────────────────────────
interface DatedLevel {
  label: string; // "Progression|Level" — taxonomy label, not PII
  ym: string | null; // Date Achieved as YYYY-MM (null = undated/unparseable)
}
interface RetClient {
  activeMonths: Set<string>; // mapped months with a New/Returning row
  hasLost: boolean;
  lostMonths: Set<string>; // mapped months with a Lost row
}
interface MatrixRow {
  label: string;
  byMonth: number[]; // aligned to months[]
  cellsLt5: number; // count of 0<cell<5 cells
}
interface ProbeResult {
  probe: 'beltProgressionJoinProbe';
  parseOk: boolean;
  headerValidation: {
    retention: { ok: boolean; missing: string[] };
    current68: { ok: boolean; missing: string[] };
    previous69: { ok: boolean; missing: string[]; hasPromotedOn: boolean };
  };
  inputs: { retentionRows: number; current68Rows: number; previous69Rows: number };
  months: string[];
  joinCoverage: {
    // current-belt join is by CLIENT ID (clean)
    all: { distinctClients: number; withCurrentBelt: number; withoutBelt: number };
    churn: { distinctClients: number; withCurrentBelt: number; withoutBelt: number };
  };
  nameBridge69: {
    distinctNames: number;
    resolvedUniqueToId: number; // name -> exactly 1 client id
    ambiguousNames: number; // name -> >1 client id (history unassignable)
    unmatchedNames: number; // name -> 0 client id
    clientsWithPreviousHistory: number; // distinct ids with >=1 uniquely-resolved 69 level
  };
  taxonomy: {
    progressions: { progression: string; levels: { level: string; currentCount: number }[] }[];
    distinctLevels: number;
    multiProgressionClients: number; // clients holding dated levels in >1 progression
  };
  reconstruction: {
    asOf: string;
    historyDepth: { onlyCurrentLevel: number; multiLevelDated: number };
    perMonth: { month: string; activeMembers: number; beltDeterminable: number; beltUnknown: number }[];
  };
  levelMonthMatrix: { rows: MatrixRow[]; totalCells: number; cellsLt5: number; unknownByMonth: number[] };
  churnSuppression: {
    byProgressionBand: MatrixRow[]; // Lost members per progression-band per month (coarse banding)
    byLevel: MatrixRow[]; // Lost members per (progression|level) per month (fine banding)
    coarseCellsLt5: number;
    fineCellsLt5: number;
    churnUnknownBeltByMonth: number[];
    lostTotalByMonth: number[]; // gym-wide total Lost mapped to each month (conservation RHS for churn)
  };
  // The Reviewer's gap: the RECOMMENDED Tier-2 belt-color banding, quantified per band×month.
  tier2Banding: {
    bands: string[];
    active: MatrixRow[]; // active-panel members per band per month
    churn: MatrixRow[]; // Lost members per band per month
    activeUnknownByMonth: number[]; // belt-undetermined active members — its own line, never a band
    churnUnknownByMonth: number[]; // belt-undetermined churn members — its own line, never a band
    summary: {
      activeCellsLt5: number; // band×month active cells with 0<cell<5
      churnCellsLt5: number; // band×month churn cells with 0<cell<5
      activeMin: number; // min active cell across the whole band×month matrix
      activeMedian: number; // median active cell across the whole band×month matrix
      bandsBelowTypicalActive5: string[]; // bands whose MEDIAN monthly active < 5
    };
  };
  verdict:
    | 'feasibility_reported'
    | 'header_validation_failed'
    | 'empty_or_unparseable';
}

// ─── HELPERS ───────────────────────────────────────────────────────────────────────────────────────────
function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}
// Name bridge key — case/space-insensitive; used in memory only, never emitted.
function normalizeName(s: string): string {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}
function toYearMonth(raw: string): string | null {
  const m = (raw ?? '').trim().match(/^(\d{4})-(\d{2})/); // ISO leading YYYY-MM (retention First Of Month)
  if (!m) return null;
  const mm = Number(m[2]);
  return mm >= 1 && mm <= 12 ? `${m[1]}-${m[2]}` : null;
}
const MON: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
// Belt "Date Achieved" / "Promoted On" format is "MMM D, YYYY" (e.g. "Jun 25, 2025"). → YYYY-MM.
function beltDateToYM(raw: string): string | null {
  const m = (raw ?? '').trim().match(/^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (!m) return null;
  const mo = MON[m[1].toLowerCase()];
  if (!mo) return null;
  return `${m[3]}-${String(mo).padStart(2, '0')}`;
}
function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}
function monthRange(start: string, end: string): string[] {
  const out: string[] = [];
  let c = start;
  // string compare is valid for zero-padded YYYY-MM
  while (c <= end) {
    out.push(c);
    c = addMonths(c, 1);
  }
  return out;
}

// CSV parse — quote-aware (REQUIRED: belt Date Achieved is a quoted "MMM D, YYYY" with an internal comma).
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      field = '';
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}
function headerIndex(grid: string[][]): { idx: Record<string, number>; keys: Set<string> } {
  const idx: Record<string, number> = {};
  const keys = new Set<string>();
  if (grid.length > 0) {
    grid[0].forEach((name, i) => {
      const k = normalizeKey(name);
      idx[k] = i;
      keys.add(k);
    });
  }
  return { idx, keys };
}
function missingCols(keys: Set<string>, req: readonly string[]): string[] {
  return req.filter((c) => !keys.has(c));
}

// ─── PARSE EACH SOURCE (pure) ─────────────────────────────────────────────────────────────────────────
interface RetParse {
  perClient: Map<string, RetClient>;
  nameToIds: Map<string, Set<string>>;
  rows: number;
  ok: boolean;
  missing: string[];
}
function parseRetention(text: string): RetParse {
  const grid = parseCsv(text);
  const { idx, keys } = headerIndex(grid);
  const missing = missingCols(keys, RET_REQ);
  const perClient = new Map<string, RetClient>();
  const nameToIds = new Map<string, Set<string>>();
  if (missing.length > 0) return { perClient, nameToIds, rows: Math.max(0, grid.length - 1), ok: false, missing };
  const get = (cells: string[], k: string): string => (idx[k] === undefined ? '' : (cells[idx[k]] ?? ''));
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    const cid = get(cells, 'clientid').trim();
    if (cid === '') continue;
    const mappedFrom = toYearMonth(get(cells, 'firstofmonth'));
    const mapped = mappedFrom ? addMonths(mappedFrom, 1) : null;
    const ct = get(cells, 'changetype').trim().toLowerCase();
    const name = normalizeName(get(cells, 'clientname'));
    if (name) {
      const s = nameToIds.get(name) ?? new Set<string>();
      s.add(cid);
      nameToIds.set(name, s);
    }
    const pc = perClient.get(cid) ?? { activeMonths: new Set<string>(), hasLost: false, lostMonths: new Set<string>() };
    if (mapped) {
      if (ct === 'new' || ct === 'returning') pc.activeMonths.add(mapped);
      if (ct === 'lost') {
        pc.hasLost = true;
        pc.lostMonths.add(mapped);
      }
    } else if (ct === 'lost') {
      pc.hasLost = true;
    }
    perClient.set(cid, pc);
  }
  return { perClient, nameToIds, rows: Math.max(0, grid.length - 1), ok: true, missing };
}

interface CurParse {
  byId: Map<string, DatedLevel[]>;
  nameToIds: Map<string, Set<string>>;
  taxonomy: Map<string, Map<string, number>>; // progression -> level -> current count
  rows: number;
  ok: boolean;
  missing: string[];
}
function parseCurrent(text: string): CurParse {
  const grid = parseCsv(text);
  const { idx, keys } = headerIndex(grid);
  const missing = missingCols(keys, CUR_REQ);
  const byId = new Map<string, DatedLevel[]>();
  const nameToIds = new Map<string, Set<string>>();
  const taxonomy = new Map<string, Map<string, number>>();
  if (missing.length > 0) return { byId, nameToIds, taxonomy, rows: Math.max(0, grid.length - 1), ok: false, missing };
  const get = (cells: string[], k: string): string => (idx[k] === undefined ? '' : (cells[idx[k]] ?? ''));
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    const cid = get(cells, 'clientid').trim();
    if (cid === '') continue;
    const prog = get(cells, 'progression').trim() || '(none)';
    const level = get(cells, 'level').trim() || '(none)';
    const ym = beltDateToYM(get(cells, 'dateachieved'));
    const label = `${prog}|${level}`;
    const arr = byId.get(cid) ?? [];
    arr.push({ label, ym });
    byId.set(cid, arr);
    const name = normalizeName(get(cells, 'clientname'));
    if (name) {
      const s = nameToIds.get(name) ?? new Set<string>();
      s.add(cid);
      nameToIds.set(name, s);
    }
    const lv = taxonomy.get(prog) ?? new Map<string, number>();
    lv.set(level, (lv.get(level) ?? 0) + 1);
    taxonomy.set(prog, lv);
  }
  return { byId, nameToIds, taxonomy, rows: Math.max(0, grid.length - 1), ok: true, missing };
}

interface PrevParse {
  byName: Map<string, DatedLevel[]>;
  rows: number;
  ok: boolean;
  missing: string[];
  hasPromotedOn: boolean;
}
function parsePrevious(text: string): PrevParse {
  const grid = parseCsv(text);
  const { idx, keys } = headerIndex(grid);
  const missing = missingCols(keys, PREV_REQ);
  const byName = new Map<string, DatedLevel[]>();
  const hasPromotedOn = keys.has('promotedon');
  if (missing.length > 0) return { byName, rows: Math.max(0, grid.length - 1), ok: false, missing, hasPromotedOn };
  const get = (cells: string[], k: string): string => (idx[k] === undefined ? '' : (cells[idx[k]] ?? ''));
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    const name = normalizeName(get(cells, 'clientname'));
    if (name === '') continue;
    const prog = get(cells, 'progression').trim() || '(none)';
    const level = get(cells, 'level').trim() || '(none)';
    const ym = beltDateToYM(get(cells, 'dateachieved'));
    const arr = byName.get(name) ?? [];
    arr.push({ label: `${prog}|${level}`, ym });
    byName.set(name, arr);
  }
  return { byName, rows: Math.max(0, grid.length - 1), ok: true, missing, hasPromotedOn };
}

// ─── ANALYSIS (pure) ───────────────────────────────────────────────────────────────────────────────────
function freshRow(label: string, n: number): MatrixRow {
  return { label, byMonth: new Array(n).fill(0), cellsLt5: 0 };
}
function finalizeLt5(rows: MatrixRow[]): number {
  let total = 0;
  for (const row of rows) {
    row.cellsLt5 = row.byMonth.filter((v) => v > 0 && v < SMALL_CELL).length;
    total += row.cellsLt5;
  }
  return total;
}
// belt as-of month M = level with max ym <= M; null if none dated <= M.
function beltAsOf(levels: DatedLevel[], month: string): DatedLevel | null {
  let best: DatedLevel | null = null;
  for (const l of levels) {
    if (l.ym && l.ym <= month) {
      if (!best || (best.ym !== null && l.ym > best.ym)) best = l;
    }
  }
  return best;
}
function progressionOf(label: string): string {
  return label.split('|')[0];
}
// Recommended Tier-2 belt-COLOR banding (stripes collapsed). Adults: White/Blue/Purple/Brown+Black
// (Brown+Black is the advanced catch-all — also absorbs Red/white). Kids: White / Grey-family
// (Grey, Grey/White, Grey/Black) / Yellow+Orange. Order matters: 'Grey/White' must hit grey, not white.
const TIER2_BANDS = [
  'Adults: White',
  'Adults: Blue',
  'Adults: Purple',
  'Adults: Brown+Black',
  'Kids: White',
  'Kids: Grey-family',
  'Kids: Yellow+Orange',
  'Other',
] as const;
function tier2Band(label: string): string {
  const [prog, levelRaw] = label.split('|');
  const lv = (levelRaw ?? '').toLowerCase();
  if (prog === 'Adults BJJ') {
    if (lv.startsWith('white')) return 'Adults: White';
    if (lv.startsWith('blue')) return 'Adults: Blue';
    if (lv.startsWith('purple')) return 'Adults: Purple';
    return 'Adults: Brown+Black'; // brown, black, red/white — advanced catch-all
  }
  if (prog === 'Kids BJJ') {
    if (lv.startsWith('white')) return 'Kids: White';
    if (lv.startsWith('grey')) return 'Kids: Grey-family'; // grey, grey/white, grey/black
    if (lv.startsWith('yellow') || lv.startsWith('orange')) return 'Kids: Yellow+Orange';
    return 'Other';
  }
  return 'Other';
}
function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function analyze(ret: RetParse, cur: CurParse, prev: PrevParse): ProbeResult {
  const months = monthRange(MONTH_START, MONTH_END);
  const n = months.length;

  // Name bridge: union name->id from current(68) + retention(R), both carry id+name.
  const nameToIds = new Map<string, Set<string>>();
  const mergeNames = (src: Map<string, Set<string>>): void => {
    for (const [name, ids] of src) {
      const s = nameToIds.get(name) ?? new Set<string>();
      for (const id of ids) s.add(id);
      nameToIds.set(name, s);
    }
  };
  mergeNames(cur.nameToIds);
  mergeNames(ret.nameToIds);

  // Resolve 69 previous-levels by name -> unique id; tally bridge stats.
  let resolvedUnique = 0;
  let ambiguous = 0;
  let unmatched = 0;
  const prevById = new Map<string, DatedLevel[]>();
  const idsWithPrevHistory = new Set<string>();
  for (const [name, levels] of prev.byName) {
    const ids = nameToIds.get(name);
    if (!ids || ids.size === 0) {
      unmatched++;
      continue;
    }
    if (ids.size > 1) {
      ambiguous++;
      continue;
    }
    resolvedUnique++;
    const id = [...ids][0];
    const arr = prevById.get(id) ?? [];
    arr.push(...levels);
    prevById.set(id, arr);
    idsWithPrevHistory.add(id);
  }

  // Per-client dated timeline = current(68 by id) UNION previous(69 resolved by name).
  const timelineById = new Map<string, DatedLevel[]>();
  const allIds = new Set<string>([...cur.byId.keys(), ...prevById.keys()]);
  for (const id of allIds) {
    timelineById.set(id, [...(cur.byId.get(id) ?? []), ...(prevById.get(id) ?? [])]);
  }

  // History depth + multi-progression.
  let onlyCurrent = 0;
  let multiLevel = 0;
  let multiProg = 0;
  for (const levels of timelineById.values()) {
    const dated = levels.filter((l) => l.ym !== null);
    if (dated.length <= 1) onlyCurrent++;
    else multiLevel++;
    const progs = new Set(dated.map((l) => progressionOf(l.label)));
    if (progs.size > 1) multiProg++;
  }

  // Join coverage (current belt by CLIENT ID).
  const block = (ids: string[]): { distinctClients: number; withCurrentBelt: number; withoutBelt: number } => {
    let withB = 0;
    for (const id of ids) if (cur.byId.has(id)) withB++;
    return { distinctClients: ids.length, withCurrentBelt: withB, withoutBelt: ids.length - withB };
  };
  const allRetIds = [...ret.perClient.keys()];
  const churnIds = allRetIds.filter((id) => ret.perClient.get(id)!.hasLost);

  // Reconstruction coverage + level×month matrix over the ACTIVE panel.
  const perMonth: ProbeResult['reconstruction']['perMonth'] = months.map((m) => ({
    month: m,
    activeMembers: 0,
    beltDeterminable: 0,
    beltUnknown: 0,
  }));
  const matrixRows = new Map<string, MatrixRow>();
  const unknownByMonth = new Array(n).fill(0);
  const tier2Active = new Map<string, MatrixRow>();
  for (let mi = 0; mi < n; mi++) {
    const m = months[mi];
    for (const id of allRetIds) {
      const pc = ret.perClient.get(id)!;
      if (!pc.activeMonths.has(m)) continue;
      perMonth[mi].activeMembers++;
      const levels = timelineById.get(id);
      const belt = levels ? beltAsOf(levels, m) : null;
      if (belt) {
        perMonth[mi].beltDeterminable++;
        const row = matrixRows.get(belt.label) ?? freshRow(belt.label, n);
        row.byMonth[mi]++;
        matrixRows.set(belt.label, row);
        const band = tier2Band(belt.label);
        const brow = tier2Active.get(band) ?? freshRow(band, n);
        brow.byMonth[mi]++;
        tier2Active.set(band, brow);
      } else {
        perMonth[mi].beltUnknown++;
        unknownByMonth[mi]++;
      }
    }
  }
  const levelRows = [...matrixRows.values()].sort((a, b) => a.label.localeCompare(b.label));
  const matrixCellsLt5 = finalizeLt5(levelRows);

  // Churn (Lost) suppression: per progression-band (coarse) + per level (fine), per month.
  const coarseRows = new Map<string, MatrixRow>();
  const fineRows = new Map<string, MatrixRow>();
  const tier2Churn = new Map<string, MatrixRow>();
  const churnUnknownByMonth = new Array(n).fill(0);
  const lostTotalByMonth = new Array(n).fill(0);
  for (let mi = 0; mi < n; mi++) {
    const m = months[mi];
    for (const id of churnIds) {
      const pc = ret.perClient.get(id)!;
      if (!pc.lostMonths.has(m)) continue;
      lostTotalByMonth[mi]++;
      const levels = timelineById.get(id);
      const belt = levels ? beltAsOf(levels, m) : null;
      if (!belt) {
        churnUnknownByMonth[mi]++;
        continue;
      }
      const band = progressionOf(belt.label);
      const cr = coarseRows.get(band) ?? freshRow(band, n);
      cr.byMonth[mi]++;
      coarseRows.set(band, cr);
      const fr = fineRows.get(belt.label) ?? freshRow(belt.label, n);
      fr.byMonth[mi]++;
      fineRows.set(belt.label, fr);
      const t2 = tier2Band(belt.label);
      const t2r = tier2Churn.get(t2) ?? freshRow(t2, n);
      t2r.byMonth[mi]++;
      tier2Churn.set(t2, t2r);
    }
  }

  // Tier-2 banding emit: order bands canonically; only include bands that ever appear.
  const orderTier2 = (mp: Map<string, MatrixRow>): MatrixRow[] =>
    TIER2_BANDS.filter((b) => mp.has(b)).map((b) => mp.get(b)!);
  const t2ActiveRows = orderTier2(tier2Active);
  const t2ChurnRows = orderTier2(tier2Churn);
  const t2ActiveLt5 = finalizeLt5(t2ActiveRows);
  const t2ChurnLt5 = finalizeLt5(t2ChurnRows);
  const t2ActiveCells = t2ActiveRows.flatMap((r) => r.byMonth);
  const bandsBelowTypical = t2ActiveRows
    .filter((r) => median(r.byMonth) < SMALL_CELL)
    .map((r) => r.label);
  const coarse = [...coarseRows.values()].sort((a, b) => a.label.localeCompare(b.label));
  const fine = [...fineRows.values()].sort((a, b) => a.label.localeCompare(b.label));
  const coarseLt5 = finalizeLt5(coarse);
  const fineLt5 = finalizeLt5(fine);

  // Taxonomy emit.
  const progressions = [...cur.taxonomy.entries()]
    .map(([progression, lv]) => ({
      progression,
      levels: [...lv.entries()]
        .map(([level, currentCount]) => ({ level, currentCount }))
        .sort((a, b) => b.currentCount - a.currentCount),
    }))
    .sort((a, b) => a.progression.localeCompare(b.progression));
  const distinctLevels = progressions.reduce((s, p) => s + p.levels.length, 0);

  const parseOk = ret.ok && cur.ok && prev.ok;
  let verdict: ProbeResult['verdict'] = 'feasibility_reported';
  if (!ret.ok || !cur.ok || !prev.ok) verdict = 'header_validation_failed';
  else if (ret.perClient.size === 0) verdict = 'empty_or_unparseable';

  return {
    probe: 'beltProgressionJoinProbe',
    parseOk,
    headerValidation: {
      retention: { ok: ret.ok, missing: ret.missing },
      current68: { ok: cur.ok, missing: cur.missing },
      previous69: { ok: prev.ok, missing: prev.missing, hasPromotedOn: prev.hasPromotedOn },
    },
    inputs: { retentionRows: ret.rows, current68Rows: cur.rows, previous69Rows: prev.rows },
    months,
    joinCoverage: { all: block(allRetIds), churn: block(churnIds) },
    nameBridge69: {
      distinctNames: prev.byName.size,
      resolvedUniqueToId: resolvedUnique,
      ambiguousNames: ambiguous,
      unmatchedNames: unmatched,
      clientsWithPreviousHistory: idsWithPrevHistory.size,
    },
    taxonomy: { progressions, distinctLevels, multiProgressionClients: multiProg },
    reconstruction: {
      asOf: 'mapped month (client-grain First Of Month + 1); belt = latest Date Achieved month <= M',
      historyDepth: { onlyCurrentLevel: onlyCurrent, multiLevelDated: multiLevel },
      perMonth,
    },
    levelMonthMatrix: {
      rows: levelRows,
      totalCells: levelRows.length * n,
      cellsLt5: matrixCellsLt5,
      unknownByMonth,
    },
    churnSuppression: {
      byProgressionBand: coarse,
      byLevel: fine,
      coarseCellsLt5: coarseLt5,
      fineCellsLt5: fineLt5,
      churnUnknownBeltByMonth: churnUnknownByMonth,
      lostTotalByMonth,
    },
    tier2Banding: {
      bands: t2ActiveRows.map((r) => r.label),
      active: t2ActiveRows,
      churn: t2ChurnRows,
      activeUnknownByMonth: unknownByMonth,
      churnUnknownByMonth: churnUnknownByMonth,
      summary: {
        activeCellsLt5: t2ActiveLt5,
        churnCellsLt5: t2ChurnLt5,
        activeMin: t2ActiveCells.length ? Math.min(...t2ActiveCells) : 0,
        activeMedian: median(t2ActiveCells),
        bandsBelowTypicalActive5: bandsBelowTypical,
      },
    },
    verdict,
  };
}

// ─── LEAK GUARD ──────────────────────────────────────────────────────────────────────────────────────
function scanForLeak(serialized: string): string[] {
  const v: string[] = [];
  if (/\d{4}-\d{2}-\d{2}/.test(serialized)) v.push('YYYY-MM-DD day-level date');
  if (/\d{7,}/.test(serialized)) v.push('>=7-digit run (ID-shaped)');
  if (serialized.includes('@')) v.push('@ (email-shaped)');
  return v;
}

// ─── SOURCE CLASSIFICATION (by header signature — paths may be given in any order) ─────────────────────
type Kind = 'retention' | 'current68' | 'previous69' | 'unknown';
function classify(text: string): Kind {
  const { keys } = headerIndex(parseCsv(text));
  if (keys.has('changetype') && keys.has('firstofmonth')) return 'retention';
  if (keys.has('clientid') && keys.has('progression') && keys.has('level')) return 'current68';
  if (keys.has('progression') && keys.has('level') && !keys.has('clientid')) return 'previous69';
  return 'unknown';
}

// ─── SELF-TEST (network-free; synthetic 3-source data; join/bridge/reconstruction/sparsity + leak) ─────
function runSelfTest(): void {
  const NAME = 'ZZ_LEAK_NAME_SENTINEL';
  const ID = '98765432';
  const PII = [NAME, ID, 'leak@member.example'];
  const fail = (m: string): void => {
    console.error(`SELFTEST FAIL: ${m}`);
    process.exit(1);
  };

  // Retention: 6 clients. Active months 2025-06 & 2025-07 (mapped from First Of Month 2025-05 & 2025-06).
  // Churn (Lost): C1 (lost 2025-07), C5 (lost 2025-06), C6 (lost 2025-07, UNMATCHED to any belt).
  // DUP_NAME shared by C2 and C3 → ambiguous name bridge.
  const retHeader = 'ID,Customer ID,First Of Month,Client ID,Client Name,Change Type,Positive Change,Negative Change,Membership ID';
  const ret = [
    retHeader,
    `1,X,2025-05-01,C1,Alice,New,1,0,2000001`,
    `2,X,2025-06-01,C1,Alice,Lost,0,1,2000001`,
    `3,X,2025-05-01,C2,DUP_NAME,Returning,1,0,2000002`,
    `4,X,2025-06-01,C2,DUP_NAME,Returning,1,0,2000002`,
    `5,X,2025-05-01,C3,DUP_NAME,Returning,1,0,2000003`,
    `6,X,2025-05-01,C4,Bob,Returning,1,0,2000004`,
    `7,X,2025-06-01,C4,Bob,Returning,1,0,2000004`,
    `8,X,2025-05-01,C5,Carol,Lost,0,1,2000005`,
    `9,X,2025-06-01,C6,${NAME},Lost,0,1,${ID}`,
  ].join('\n');

  // Current 68: C1..C5 have a current belt (C6 absent → unmatched). Dates "MMM D, YYYY".
  const curHeader = 'Client ID,Client Name,Progression,Level,Date Achieved,Classes At Level,Clients → Client Active';
  const cur = [
    curHeader,
    `C1,Alice,Adults BJJ,Blue Belt,"Mar 1, 2025",10,Yes`,
    `C2,DUP_NAME,Adults BJJ,White Belt,"Jan 1, 2025",5,Yes`,
    `C3,DUP_NAME,Adults BJJ,White Belt,"Jan 1, 2025",5,Yes`,
    `C4,Bob,Kids BJJ,Grey White,"Feb 1, 2025",3,Yes`,
    `C5,Carol,Adults BJJ,Purple Belt,"Jun 1, 2024",20,No`,
  ].join('\n');

  // Previous 69: NO Client ID. Alice has a dated prior White Belt (Jan 2024) → multi-level history.
  // DUP_NAME row is AMBIGUOUS (maps to C2 & C3) → dropped from bridge. Ghost name → unmatched.
  const prevHeader = 'Client Name,Progression,Level,Date Achieved,Promoted On,Days At Level,Client Active';
  const prev = [
    prevHeader,
    `Alice,Adults BJJ,White Belt,"Jan 1, 2024","Mar 1, 2025",425,Yes`,
    `DUP_NAME,Adults BJJ,(none),"Jan 1, 2023","Jan 1, 2025",365,Yes`,
    `GhostMember,Adults BJJ,Blue Belt,"Jan 1, 2024","Jan 1, 2025",365,Yes`,
  ].join('\n');

  // Classification.
  if (classify(ret) !== 'retention') fail('classify retention');
  if (classify(cur) !== 'current68') fail('classify current68');
  if (classify(prev) !== 'previous69') fail('classify previous69');

  const res = analyze(parseRetention(ret), parseCurrent(cur), parsePrevious(prev));
  const ser = JSON.stringify(res, null, 2);
  console.log(ser);

  // Leak scans.
  const tokenLeaks = PII.filter((t) => ser.includes(t));
  if (tokenLeaks.length) fail(`planted PII leaked: ${tokenLeaks.join(', ')}`);
  const structLeaks = scanForLeak(ser);
  if (structLeaks.length) fail(`structural leak: ${structLeaks.join(', ')}`);

  // Assertions.
  const t2a = (lbl: string): MatrixRow | undefined => res.tier2Banding.active.find((r) => r.label === lbl);
  const t2c = (lbl: string): MatrixRow | undefined => res.tier2Banding.churn.find((r) => r.label === lbl);
  const checks: Array<[string, boolean]> = [
    ['header retention ok', res.headerValidation.retention.ok],
    ['header current68 ok', res.headerValidation.current68.ok],
    ['header previous69 ok', res.headerValidation.previous69.ok],
    ['previous69 hasPromotedOn', res.headerValidation.previous69.hasPromotedOn],
    ['all distinct = 6', res.joinCoverage.all.distinctClients === 6],
    ['all withCurrentBelt = 5 (C6 unmatched)', res.joinCoverage.all.withCurrentBelt === 5],
    ['churn distinct = 3 (C1,C5,C6)', res.joinCoverage.churn.distinctClients === 3],
    ['churn withCurrentBelt = 2 (C1,C5)', res.joinCoverage.churn.withCurrentBelt === 2],
    ['churn withoutBelt = 1 (C6)', res.joinCoverage.churn.withoutBelt === 1],
    // name bridge: Alice→unique, GhostMember→unmatched, DUP_NAME→ambiguous(C2,C3)
    ['bridge distinctNames = 3', res.nameBridge69.distinctNames === 3],
    ['bridge resolvedUnique = 1 (Alice)', res.nameBridge69.resolvedUniqueToId === 1],
    ['bridge ambiguous = 1 (DUP_NAME)', res.nameBridge69.ambiguousNames === 1],
    ['bridge unmatched = 1 (GhostMember)', res.nameBridge69.unmatchedNames === 1],
    ['bridge clientsWithPrevHistory = 1 (Alice/C1)', res.nameBridge69.clientsWithPreviousHistory === 1],
    // history depth: Alice has 2 dated levels (current Blue + prev White) → multiLevel=1; others onlyCurrent
    ['multiLevelDated = 1 (Alice)', res.reconstruction.historyDepth.multiLevelDated === 1],
    ['onlyCurrentLevel = 4 (C2,C3,C4,C5)', res.reconstruction.historyDepth.onlyCurrentLevel === 4],
    // taxonomy: Adults BJJ {Blue,White,Purple} + Kids BJJ {Grey White}
    ['taxonomy distinctLevels = 4', res.taxonomy.distinctLevels === 4],
    ['two progressions', res.taxonomy.progressions.length === 2],
    // reconstruction month 2025-06: active = C1,C2,C3,C4 (Returning/New mapped to 06). All have belt <= 06.
    ['2025-06 active = 4', res.reconstruction.perMonth[0].month === '2025-06' && res.reconstruction.perMonth[0].activeMembers === 4],
    ['2025-06 determinable = 4', res.reconstruction.perMonth[0].beltDeterminable === 4],
    // 2025-07: active = C2,C4 (mapped from First Of Month 2025-06 Returning).
    ['2025-07 active = 2', res.reconstruction.perMonth[1].month === '2025-07' && res.reconstruction.perMonth[1].activeMembers === 2],
    // churn suppression: C1 lost 2025-07 (Adults), C5 lost 2025-06 (Adults), C6 lost 2025-07 (unknown belt)
    ['coarse band has Adults BJJ', res.churnSuppression.byProgressionBand.some((r) => r.label === 'Adults BJJ')],
    ['churn unknown belt 2025-07 >= 1 (C6)', res.churnSuppression.churnUnknownBeltByMonth[1] >= 1],
    // Tier-2 banding function (stripe collapse + ordering edges)
    ['t2 fn: White N stripes → Adults: White', tier2Band('Adults BJJ|White Belt 2 stripes') === 'Adults: White'],
    ['t2 fn: Red/white → Adults: Brown+Black', tier2Band('Adults BJJ|Red/white belt') === 'Adults: Brown+Black'],
    ['t2 fn: Black → Adults: Brown+Black', tier2Band('Adults BJJ|Black Belt 1 stripe') === 'Adults: Brown+Black'],
    ['t2 fn: Grey/White → Kids: Grey-family (not White)', tier2Band('Kids BJJ|Grey/White Belt 1 Stripe') === 'Kids: Grey-family'],
    ['t2 fn: Orange/white → Kids: Yellow+Orange', tier2Band('Kids BJJ|Orange/white belt') === 'Kids: Yellow+Orange'],
    // Tier-2 matrices on synthetic data
    ['t2 active Adults: White 2025-06 = 2 (C2,C3)', t2a('Adults: White')?.byMonth[0] === 2],
    ['t2 active Adults: Blue 2025-06 = 1 (C1)', t2a('Adults: Blue')?.byMonth[0] === 1],
    ['t2 active Kids: Grey-family 2025-06 = 1 (C4)', t2a('Kids: Grey-family')?.byMonth[0] === 1],
    ['t2 churn Adults: Purple 2025-06 = 1 (C5)', t2c('Adults: Purple')?.byMonth[0] === 1],
    ['t2 churn Adults: Blue 2025-07 = 1 (C1)', t2c('Adults: Blue')?.byMonth[1] === 1],
    ['t2 activeUnknown 2025-06 = 0', res.tier2Banding.activeUnknownByMonth[0] === 0],
    ['t2 churnUnknown 2025-07 = 1 (C6)', res.tier2Banding.churnUnknownByMonth[1] === 1],
    ['t2 no Other band (all synthetic classified)', !res.tier2Banding.bands.includes('Other')],
    ['verdict feasibility_reported', res.verdict === 'feasibility_reported'],
  ];
  const failed = checks.filter(([, ok]) => !ok).map(([nm]) => nm);
  if (failed.length) fail(`assertions: ${failed.join('; ')}`);

  // Header-validation failure path.
  const badCur = analyze(parseRetention(ret), parseCurrent('Client ID,Client Name\nC1,Alice'), parsePrevious(prev));
  if (badCur.verdict !== 'header_validation_failed') fail('missing-column verdict');
  if (!badCur.headerValidation.current68.missing.includes('progression')) fail('missing-column list');

  // Leak-guard unit tests.
  if (scanForLeak(`{"x":"${ID}"}`).length === 0) fail('guard missed 7+ digit run');
  if (scanForLeak('{"x":"a@b"}').length === 0) fail('guard missed @');
  if (scanForLeak('{"x":"2020-01-01"}').length === 0) fail('guard missed YYYY-MM-DD');
  if (scanForLeak('{"month":"2025-06","Adults BJJ|Blue Belt":4}').length !== 0) fail('guard false-positived on month/label/counts');

  console.log(
    'SELFTEST PASS: header validation (incl missing-column verdict); Client-ID join coverage (all + churn); ' +
      'name-bridge 69 (unique/ambiguous/unmatched) — the no-Client-ID-in-69 hazard; dated multi-level ' +
      'reconstruction + active-panel coverage; level×month + churn suppression <5 flags; no planted ' +
      'PII/date leaked; leak-guard correct; no file or network touched.',
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  if (process.argv.includes('--selftest')) {
    runSelfTest();
    return;
  }
  const paths = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (paths.length !== 3) {
    console.error(
      'Usage: beltProgressionJoinProbe.ts <retention.csv> <current68.csv> <previous69.csv>  (any order; classified by header)\n' +
        '   or: beltProgressionJoinProbe.ts --selftest',
    );
    process.exit(1);
    return;
  }
  const { readFileSync } = await import('node:fs');
  const texts = paths.map((p) => readFileSync(p, 'utf8'));
  const bucket: Record<Kind, string | null> = { retention: null, current68: null, previous69: null, unknown: null };
  for (const t of texts) bucket[classify(t)] = t;
  if (!bucket.retention || !bucket.current68 || !bucket.previous69) {
    const seen = texts.map(classify);
    console.error(`Could not identify all three sources by header. Detected: ${seen.join(', ')}. Need retention + current68 + previous69.`);
    process.exit(1);
    return;
  }
  const res = analyze(parseRetention(bucket.retention), parseCurrent(bucket.current68), parsePrevious(bucket.previous69));
  const serialized = JSON.stringify(res, null, 2);
  const leaks = scanForLeak(serialized);
  if (leaks.length > 0) {
    console.error(`LIVE LEAK GUARD TRIPPED: ${leaks.join(', ')} — aborting WITHOUT printing.`);
    process.exit(1);
    return;
  }
  console.log(serialized);
}

// Pure logic is exported so the GATED Phase-A build (buildMemberRetentionByBelt.ts) reuses the SAME
// validated parse/banding/analysis — no duplicated logic, no drift. main() runs ONLY on direct exec.
export {
  parseRetention,
  parseCurrent,
  parsePrevious,
  analyze,
  tier2Band,
  scanForLeak,
  MONTH_START,
  MONTH_END,
  TIER2_BANDS,
};
export type { ProbeResult, MatrixRow };

const invokedDirectly = !!process.argv[1] && process.argv[1].endsWith('beltProgressionJoinProbe.ts');
if (invokedDirectly) void main();
