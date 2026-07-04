// Belt-retention aggregation core — the PURE pipeline that turns the three local Wodify exports
// (client-grain Member Retention ⋈ Progressions Current 68 / Previous 69) into the NON-PII
// member_retention_by_belt payload: CSV parse → belt-at-month reconstruction → Tier-2 band×month
// matrices → the 104-row upsert grid + conservation + name-bridge stats.
//
// SLICE 1 of the self-serve Churn-by-Belt importer: this logic was extracted VERBATIM from
// scripts/wodify/beltProgressionJoinProbe.ts (parse/analyze/bands/leak) + scripts/wodify/
// buildMemberRetentionByBelt.ts (the 104-row reshape + conservation), so the existing CLI, the probe,
// and the FUTURE upload edge function all import ONE validated module — no logic fork, no drift. It
// mirrors how src/lib/gym/wodifyRetentionAggregate.ts backs the sync-wodify-retention edge function.
//
// PURE by contract (so it typechecks + bundles on both the browser and the Deno edge runtime): NO node
// built-ins here — the sha256 integrity hash (node:crypto) and file I/O (node:fs) live in the CLI wrapper,
// exactly like wodifyRetentionAggregate.ts keeps persistence in its shell. `canonicalize` is exported so
// the wrapper can hash the rows.
//
// SAFE OUTPUT: emits COUNTS + taxonomy/band LABELS + booleans + YYYY-MM month labels only — never member
// names, Client IDs, emails, or day-level dates. `scanForLeak` re-scans any serialized output.

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

// ─── SOURCE CLASSIFICATION (by header signature — paths/uploads may arrive in any order) ───────────────
type Kind = 'retention' | 'current68' | 'previous69' | 'unknown';
function classify(text: string): Kind {
  const { keys } = headerIndex(parseCsv(text));
  if (keys.has('changetype') && keys.has('firstofmonth')) return 'retention';
  if (keys.has('clientid') && keys.has('progression') && keys.has('level')) return 'current68';
  if (keys.has('progression') && keys.has('level') && !keys.has('clientid')) return 'previous69';
  return 'unknown';
}

// ─── PAYLOAD RESHAPE — the member_retention_by_belt 104-row grid (pure; sha lives in the CLI wrapper) ───
const WORKSPACE_ID = 'default';

// Locked segment → belt_band allowlist, in canonical emit order. MUST match the DDL
// member_retention_by_belt_band_chk constraint exactly (SQL ↔ build cannot drift).
const SCHEMA_SEGMENT_BAND_ALLOWLIST: { segment: string; bands: string[] }[] = [
  { segment: 'adults', bands: ['White', 'Blue', 'Purple', 'Brown+Black'] },
  { segment: 'kids', bands: ['White', 'Grey-family', 'Yellow+Orange'] },
  { segment: 'unknown', bands: ['unknown'] },
];

// (segment, belt_band) → the probe's Tier-2 active/churn matrix label.
function tier2Label(segment: string, band: string): string {
  if (segment === 'adults') return `Adults: ${band}`;
  if (segment === 'kids') return `Kids: ${band}`;
  return 'unknown'; // segment 'unknown' is sourced from the unknown lines, not the band matrices
}

interface PayloadRow {
  workspace_id: string;
  period_month: string;
  segment: string;
  belt_band: string;
  active_count: number;
  lost_count: number;
}
interface MonthConservation {
  month: string;
  activeSum: number;
  activeExpected: number;
  activeOk: boolean;
  lostSum: number;
  lostExpected: number;
  lostOk: boolean;
}
// The persisted payload MINUS payloadSha256 — the sha (node:crypto) is added by the CLI wrapper.
interface BeltPayload {
  table: 'member_retention_by_belt';
  workspace_id: string;
  months: string[];
  nameBridge69: ProbeResult['nameBridge69'] & { collisionFree: boolean };
  rowCount: number;
  rows: PayloadRow[];
  conservation: { perMonth: MonthConservation[]; allActiveOk: boolean; allLostOk: boolean };
}

// Stable serialization for hashing: rows sorted + fixed key order. Exported so the CLI wrapper can
// createHash(canonicalize(rows)) — keeping node:crypto out of this pure module.
function canonicalize(rows: PayloadRow[]): string {
  const sorted = [...rows].sort((a, b) =>
    a.segment !== b.segment
      ? a.segment.localeCompare(b.segment)
      : a.belt_band !== b.belt_band
        ? a.belt_band.localeCompare(b.belt_band)
        : a.period_month.localeCompare(b.period_month),
  );
  return JSON.stringify(
    sorted.map((r) => [r.workspace_id, r.period_month, r.segment, r.belt_band, r.active_count, r.lost_count]),
  );
}

function buildBeltPayload(res: ProbeResult): BeltPayload {
  const months = res.months;
  const n = months.length;

  // Index the probe's Tier-2 matrices by label for O(1) lookup; absent label/month → 0.
  const activeByLabel = new Map<string, number[]>();
  for (const r of res.tier2Banding.active) activeByLabel.set(r.label, r.byMonth);
  const churnByLabel = new Map<string, number[]>();
  for (const r of res.tier2Banding.churn) churnByLabel.set(r.label, r.byMonth);
  const at = (m: Map<string, number[]>, label: string, mi: number): number => m.get(label)?.[mi] ?? 0;

  // Emit the full deterministic grid: every allowlisted (segment, band) × month, plus unknown × month.
  const rows: PayloadRow[] = [];
  for (const { segment, bands } of SCHEMA_SEGMENT_BAND_ALLOWLIST) {
    for (const band of bands) {
      for (let mi = 0; mi < n; mi++) {
        const active =
          segment === 'unknown' ? res.tier2Banding.activeUnknownByMonth[mi] : at(activeByLabel, tier2Label(segment, band), mi);
        const lost =
          segment === 'unknown' ? res.tier2Banding.churnUnknownByMonth[mi] : at(churnByLabel, tier2Label(segment, band), mi);
        rows.push({
          workspace_id: WORKSPACE_ID,
          period_month: months[mi],
          segment,
          belt_band: band,
          active_count: active,
          lost_count: lost,
        });
      }
    }
  }

  // Two CONSERVATION checks per month: Σ active (all bands + unknown) ties the active-panel total; Σ lost
  // (all bands + unknown) ties total retention Lost. These prove the reshape neither drops nor double-counts.
  const perMonth: MonthConservation[] = months.map((month, mi) => {
    const monthRows = rows.filter((r) => r.period_month === month);
    const activeSum = monthRows.reduce((s, r) => s + r.active_count, 0);
    const lostSum = monthRows.reduce((s, r) => s + r.lost_count, 0);
    const activeExpected = res.reconstruction.perMonth[mi].activeMembers;
    const lostExpected = res.churnSuppression.lostTotalByMonth[mi];
    return {
      month,
      activeSum,
      activeExpected,
      activeOk: activeSum === activeExpected,
      lostSum,
      lostExpected,
      lostOk: lostSum === lostExpected,
    };
  });

  const collisionFree = res.nameBridge69.ambiguousNames === 0 && res.nameBridge69.unmatchedNames === 0;

  return {
    table: 'member_retention_by_belt',
    workspace_id: WORKSPACE_ID,
    months,
    nameBridge69: { ...res.nameBridge69, collisionFree },
    rowCount: rows.length,
    rows,
    conservation: {
      perMonth,
      allActiveOk: perMonth.every((p) => p.activeOk),
      allLostOk: perMonth.every((p) => p.lostOk),
    },
  };
}

export {
  parseRetention,
  parseCurrent,
  parsePrevious,
  analyze,
  classify,
  tier2Band,
  scanForLeak,
  buildBeltPayload,
  canonicalize,
  MONTH_START,
  MONTH_END,
  TIER2_BANDS,
  SCHEMA_SEGMENT_BAND_ALLOWLIST,
  WORKSPACE_ID,
};
export type { ProbeResult, MatrixRow, PayloadRow, MonthConservation, BeltPayload, Kind };
