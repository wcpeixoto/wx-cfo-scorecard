/**
 * Assistant-replay harness — read-only diagnostic.
 *
 * Replays the live CFO Assistant decision chain at each historical as-of date
 * and emits an evaluation artifact (markdown + JSON) for HUMAN rubric scoring.
 * It deliberately does NOT score anything — rubric application is a separate step.
 *
 * Chain per as-of date (all imported live, never copied):
 *   computeDashboardModel -> detectSignals -> rankPriorities
 *                         -> commitmentFromSignal -> buildExecuteHelp
 *
 * CASH BASIS (decided 2026-05-23): the reserve signal must reflect TOTAL BANK CASH
 * (what's actually in the bank to absorb shocks / fund reserve), matching live
 * production (Dashboard currentCashBalance = startingBalance + Σ raw amount over
 * cash-included accounts). So the PRIMARY run reconstructs total cash from a
 * required total-cash anchor + raw transaction amounts. The operating-cash basis
 * (the forecast backtest's basis, which excludes owner draws) is kept ONLY as a
 * side-by-side comparison — it overstates available cash and is not the reserve
 * basis for this replay.
 *
 * The as-of model + projection use the same recipe as
 * scripts/backtest/walkForward.forecastAsOf (txn filter `date < asOf`,
 * thisMonthAnchor), but feed the chosen cash basis as currentCashBalance and keep
 * the full projectScenario points (forecastAsOf discards netCashFlow, which
 * detectSignals needs).
 *
 * Fidelity: detectSignals reads model.runway (data-derived reserveTarget, and
 * percentFunded = cash / reserveTarget) — exactly what the live card consumes.
 *
 * Run: npx tsx scripts/assistant-replay/runReplay.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadFixture, loadAnchors, getFixturePath } from '../backtest/loadFixture';
import { reconstructStartingCash } from '../../src/lib/kpis/forecastShared';
import { computeDashboardModel, projectScenario } from '../../src/lib/kpis/compute';
import { detectSignals } from '../../src/lib/priorities/signals';
import { rankPriorities } from '../../src/lib/priorities/rank';
import { buildExecuteHelp } from '../../src/lib/commitments/execute';
import { reserveWarningCommitment } from '../../src/lib/commitments/reserveWarningCommitment';
import type { ScenarioInput, DashboardModel, Txn } from '../../src/lib/data/contract';
import type { PriorityHistoryRow, SignalType, Signal } from '../../src/lib/priorities/types';

// Faithful mirror of commitmentFromSignal in src/lib/commitments/index.ts (which
// can't be imported here without dragging in the Node-unsafe barrel — it re-exports
// groundedSummary, which reads import.meta.env at load). Tracks that switch: only
// the reserve-funding signals are commitment-ready today.
function commitmentFromSignal(signal: Signal, model: DashboardModel) {
  return signal.type === 'reserve_warning' || signal.type === 'reserve_critical'
    ? reserveWarningCommitment(signal, model)
    : null;
}

// Mirror of the 15 as-of dates in scripts/backtest/runBacktest.ts (that list is a
// local const there, not exported — kept in sync manually).
const AS_OF_DATES: string[] = [
  '2025-01-01', '2025-02-01', '2025-03-01', '2025-04-01', '2025-05-01',
  '2025-06-01', '2025-07-01', '2025-08-01', '2025-09-01', '2025-10-01',
  '2025-11-01', '2025-12-01', '2026-01-01', '2026-02-01', '2026-03-01',
];

// Same neutral base scenario the backtest engine uses. The reserve signals (the
// commitment-ready core) ignore the projection; only awareness-only cash_flow
// signals read it — flagged as a fidelity caveat in the artifact.
const BASE_SCENARIO: ScenarioInput = {
  scenarioKey: 'base',
  revenueGrowthPct: 0,
  expenseChangePct: 0,
  receivableDays: 3,
  payableDays: 3,
  months: 12,
};
const HORIZON_MONTHS = 12;
const OUT_DIR = resolve('assistant-replay-results');
const TOTAL_CASH_ANCHORS_PATH = resolve('backtest-results/fixtures/total-cash-anchors.json');

// Production cash definition — from the authoritative shared_account_settings
// (Supabase workspace_id='default'), read-only lookup 2026-05-23. The reserve
// signal counts ONLY these accounts as cash; used as the default cash-included set
// when the anchor file doesn't override it. Not to be relitigated here — matches
// production fidelity by decision.
const PRODUCTION_CASH_INCLUDED_ACCOUNTS = ['Bank of America', 'Card Amex'];
const CASH_DEFINITION_SOURCE = 'production shared_account_settings (read-only lookup 2026-05-23)';
// Notable accounts production EXCLUDES from cash (artifact-header documentation).
const EXCLUDED_NOTABLE = [
  'Cash (petty)', 'Wodify', 'CC Corp 8839', 'CC Deborah', 'CC Marcio', 'S/T Loan SH', 'Merchant Fee',
];

function monthOf(asOfDate: string): string {
  return asOfDate.slice(0, 7);
}

function fail(msg: string): never {
  console.error(`\n[assistant-replay] FATAL: ${msg}\n`);
  process.exit(1);
}

const usd = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n)
    ? 'n/a'
    : (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');

const pct = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? 'n/a' : `${(n * 100).toFixed(1)}%`;

// ── Total-cash basis (PRIMARY) ──────────────────────────────────────────────
// A total-cash anchor is the real bank balance (summed across cash-included
// accounts) on a known date. Reconstruction walks RAW transaction amounts forward
// from the closest preceding anchor — matching the live app's
// startingBalance + Σ rawAmount recipe — restricted to cash-included accounts.
interface TotalCashAnchor {
  asOfDate: string;
  totalCashBalance: number;
}
interface TotalCashConfig {
  cashIncludedAccounts: string[];
  anchors: TotalCashAnchor[];
}

function loadTotalCashAnchors(): TotalCashConfig {
  if (!existsSync(TOTAL_CASH_ANCHORS_PATH)) {
    fail(
      `Total-cash anchor file missing: ${TOTAL_CASH_ANCHORS_PATH}\n` +
        `Provide the real bank balance (cash-included accounts) on a date that\n` +
        `precedes the earliest as-of date (${AS_OF_DATES[0]}). Refusing to guess.`,
    );
  }
  let parsed: Partial<TotalCashConfig>;
  try {
    parsed = JSON.parse(readFileSync(TOTAL_CASH_ANCHORS_PATH, 'utf8')) as Partial<TotalCashConfig>;
  } catch (err) {
    return fail(`Total-cash anchor file is not valid JSON (${TOTAL_CASH_ANCHORS_PATH}): ${err}`);
  }
  // Cash-included set: the file overrides, else fall back to the production default.
  const cashIncludedAccounts =
    Array.isArray(parsed.cashIncludedAccounts) && parsed.cashIncludedAccounts.length > 0
      ? parsed.cashIncludedAccounts
      : PRODUCTION_CASH_INCLUDED_ACCOUNTS;
  const anchors = Array.isArray(parsed.anchors) ? parsed.anchors : [];
  if (anchors.length === 0) {
    fail(`Total-cash anchor file has no anchors (${TOTAL_CASH_ANCHORS_PATH}).`);
  }
  for (const a of anchors) {
    if (!a || typeof a.asOfDate !== 'string' || !Number.isFinite(a.totalCashBalance)) {
      fail(
        `Total-cash anchor not filled in (${TOTAL_CASH_ANCHORS_PATH}): every anchor needs a\n` +
          `string asOfDate and a numeric totalCashBalance. Found: ${JSON.stringify(a)}`,
      );
    }
  }
  anchors.sort((x, y) => x.asOfDate.localeCompare(y.asOfDate));
  if (anchors[0].asOfDate >= AS_OF_DATES[0]) {
    fail(
      `Earliest total-cash anchor (${anchors[0].asOfDate}) must PRECEDE the earliest as-of ` +
        `date (${AS_OF_DATES[0]}). Add an earlier anchor.`,
    );
  }
  return { cashIncludedAccounts, anchors };
}

function reconstructTotalCash(asOfDate: string, txns: Txn[], config: TotalCashConfig): number {
  let anchor: TotalCashAnchor | null = null;
  for (const a of config.anchors) {
    if (a.asOfDate <= asOfDate && (!anchor || a.asOfDate > anchor.asOfDate)) anchor = a;
  }
  // Guaranteed by the load guard (earliest anchor precedes earliest as-of date).
  if (!anchor) fail(`No preceding total-cash anchor for ${asOfDate} (should be unreachable).`);
  const cash = new Set(config.cashIncludedAccounts);
  let net = 0;
  for (const t of txns) {
    if (t.date >= asOfDate) continue;
    if (t.date < anchor.asOfDate) continue;
    if (!cash.has(t.account ?? '')) continue;
    net += t.rawAmount;
  }
  return anchor.totalCashBalance + net;
}

// ── Replay ──────────────────────────────────────────────────────────────────
type ExecuteOut =
  | { kind: 'n/a'; detail: string }
  | { kind: 'none'; detail: string }
  | { kind: 'levers'; lead: string; recommended: string; alternates: string[] };

interface BasisRun {
  model: DashboardModel;
  hero: Signal;
}

function buildBasis(asOfDate: string, filtered: Txn[], cash: number): BasisRun {
  const thisMonthAnchor = monthOf(asOfDate);
  const model = computeDashboardModel(filtered, {
    cashFlowMode: 'operating',
    thisMonthAnchor,
    currentCashBalance: cash,
  });
  const projection = projectScenario(model, { ...BASE_SCENARIO, months: HORIZON_MONTHS }, cash, []);
  const signals = detectSignals(model, filtered, projection.points);
  const { hero } = rankPriorities(signals);
  return { model, hero };
}

interface ReplayRecord {
  asOfDate: string;
  txnCount: number;
  // PRIMARY basis = total bank cash.
  totalCash: number;
  reserveTarget: number;
  percentFundedTotal: number | null;
  runwayStatus: string;
  latestDataMonth: string;
  hero: {
    type: SignalType;
    severity: string;
    recommendedAction: string | null;
    gapAmount: number | null;
    metricValue: number | null;
    targetValue: number | null;
  };
  commitmentDraft: {
    illustrativeActionAtRecommended: string | null;
    grounding: {
      classification: string;
      recommended: number | null;
      floor: number;
      ceiling: number;
      weeklyCapacity: number | null;
      unknownReason: string | null;
    };
  } | null;
  execute: ExecuteOut;
  // COMPARISON basis = operating cash (excludes owner draws; overstates cash).
  operatingComparison: {
    operatingCash: number;
    percentFundedOperating: number | null;
    heroType: SignalType;
    heroSeverity: string;
  } | null;
}

function replayOne(
  asOfDate: string,
  txns: Txn[],
  totalConfig: TotalCashConfig,
  operatingAnchors: ReturnType<typeof loadAnchors>['anchors'] | null,
): ReplayRecord {
  const filtered = txns.filter((t) => t.date < asOfDate);

  // PRIMARY: total bank cash.
  const totalCash = reconstructTotalCash(asOfDate, txns, totalConfig);
  const total = buildBasis(asOfDate, filtered, totalCash);

  const draft = commitmentFromSignal(total.hero, total.model);
  // buildExecuteHelp reads only `signal_type`; a minimal stub is faithful.
  const executeRow = { signal_type: total.hero.type } as unknown as PriorityHistoryRow;
  const execute = buildExecuteHelp(total.model, executeRow);
  let executeOut: ExecuteOut;
  if (execute === null) {
    executeOut = { kind: 'n/a', detail: 'hero is not reserve-funding (Execute is reserve-only)' };
  } else if (execute.kind === 'none') {
    executeOut = { kind: 'none', detail: execute.text };
  } else {
    executeOut = {
      kind: 'levers',
      lead: execute.lead,
      recommended: execute.recommended.text,
      alternates: execute.alternates.map((a) => a.text),
    };
  }

  // COMPARISON: operating cash (best-effort; null if operating anchors absent).
  let operatingComparison: ReplayRecord['operatingComparison'] = null;
  if (operatingAnchors) {
    const operatingCash = reconstructStartingCash(asOfDate, txns, operatingAnchors);
    const operating = buildBasis(asOfDate, filtered, operatingCash);
    operatingComparison = {
      operatingCash,
      percentFundedOperating: operating.model.runway.percentFunded,
      heroType: operating.hero.type,
      heroSeverity: operating.hero.severity,
    };
  }

  return {
    asOfDate,
    txnCount: filtered.length,
    totalCash,
    reserveTarget: total.model.runway.reserveTarget,
    percentFundedTotal: total.model.runway.percentFunded,
    runwayStatus: total.model.runway.status,
    latestDataMonth: total.model.latestMonth,
    hero: {
      type: total.hero.type,
      severity: total.hero.severity,
      recommendedAction: total.hero.recommendedAction ?? null,
      gapAmount: total.hero.gapAmount ?? null,
      metricValue: total.hero.metricValue ?? null,
      targetValue: total.hero.targetValue ?? null,
    },
    commitmentDraft: draft
      ? {
          illustrativeActionAtRecommended:
            draft.grounding.classification === 'grounded' && draft.grounding.recommended != null
              ? draft.buildAction(draft.grounding.recommended)
              : null,
          grounding: {
            classification: draft.grounding.classification,
            recommended: draft.grounding.recommended,
            floor: draft.grounding.floor,
            ceiling: draft.grounding.ceiling,
            weeklyCapacity: draft.grounding.weeklyCapacity,
            unknownReason: draft.grounding.unknownReason,
          },
        }
      : null,
    execute: executeOut,
    operatingComparison,
  };
}

function renderMarkdown(
  records: ReplayRecord[],
  meta: {
    generatedAt: string;
    fixturePath: string;
    fixtureRows: number;
    cashIncludedAccounts: string[];
    excludedNotable: string[];
    cashDefinitionSource: string;
    totalAnchorSummary: string;
    operatingAvailable: boolean;
  },
): string {
  const L: string[] = [];
  L.push('# CFO Assistant — replay evaluation artifact (total-cash basis)');
  L.push('');
  L.push('> Read-only diagnostic. Rubric scoring is a SEPARATE human step — nothing here is auto-scored.');
  L.push('');
  L.push(`- Generated: ${meta.generatedAt}`);
  L.push(`- Fixture: \`${meta.fixturePath}\` (${meta.fixtureRows} txns)`);
  L.push('## Cash definition (matches production configuration)');
  L.push('');
  L.push(`- **Reserve basis: TOTAL BANK CASH.**`);
  L.push(`- Cash-included accounts: **${meta.cashIncludedAccounts.join(', ')}**`);
  L.push(`- Excluded (notable): ${meta.excludedNotable.join(', ')}`);
  L.push(`- Total-cash anchor: ${meta.totalAnchorSummary}`);
  L.push(`- Source: ${meta.cashDefinitionSource}`);
  L.push(`- This cash definition matches production \`shared_account_settings\` — not a replay-only assumption.`);
  L.push(`- Operating-cash comparison: ${meta.operatingAvailable ? 'included below (excludes owner draws; overstates available cash; NOT the reserve basis)' : 'unavailable'}`);
  L.push(`- As-of dates: ${records.length}`);
  L.push('');
  L.push('**Fidelity caveats:** (1) cash_flow signals use the engine base projection, NOT the production composed Conservative Floor; reserve heroes are unaffected (they ignore the projection). (2) Account config / categories are current-state (travel with the fixture).');
  L.push('');

  const buckets = new Map<string, string[]>();
  for (const r of records) {
    const arr = buckets.get(r.hero.type) ?? [];
    arr.push(r.asOfDate);
    buckets.set(r.hero.type, arr);
  }
  L.push('## Hero-bucket distribution (TOTAL-cash basis — use this for week selection)');
  L.push('');
  L.push('| Hero type | Count | Dates |');
  L.push('|---|---:|---|');
  for (const [type, dates] of [...buckets.entries()].sort((a, b) => b[1].length - a[1].length)) {
    L.push(`| ${type} | ${dates.length} | ${dates.join(', ')} |`);
  }
  L.push('');

  L.push('## Summary table');
  L.push('');
  L.push('| As-of | Hero (total) | Sev | % funded (total) | Total cash | Reserve target | Grounded target | Execute | [cmp] Hero (op) | [cmp] % funded (op) |');
  L.push('|---|---|---|---:|---:|---:|---|---|---|---:|');
  for (const r of records) {
    const grounded = r.commitmentDraft
      ? `${r.commitmentDraft.grounding.classification}` +
        (r.commitmentDraft.grounding.recommended != null
          ? ` (${usd(r.commitmentDraft.grounding.recommended)}/wk)`
          : ` (${r.commitmentDraft.grounding.unknownReason ?? '—'})`)
      : '—';
    const opHero = r.operatingComparison?.heroType ?? '—';
    const opPct = pct(r.operatingComparison?.percentFundedOperating);
    L.push(
      `| ${r.asOfDate} | ${r.hero.type} | ${r.hero.severity} | ${pct(r.percentFundedTotal)} | ${usd(
        r.totalCash,
      )} | ${usd(r.reserveTarget)} | ${grounded} | ${r.execute.kind} | ${opHero} | ${opPct} |`,
    );
  }
  L.push('');

  L.push('## Per-date detail (total-cash basis)');
  L.push('');
  for (const r of records) {
    L.push(`### ${r.asOfDate}`);
    L.push('');
    L.push(`- Data through: ${r.latestDataMonth} · txns: ${r.txnCount} · runway status: ${r.runwayStatus}`);
    L.push(`- Total cash: ${usd(r.totalCash)} · reserve target: ${usd(r.reserveTarget)} · % funded: ${pct(r.percentFundedTotal)}`);
    if (r.operatingComparison) {
      L.push(`- [comparison] operating cash: ${usd(r.operatingComparison.operatingCash)} · % funded (op): ${pct(r.operatingComparison.percentFundedOperating)} · hero (op): ${r.operatingComparison.heroType}`);
    }
    L.push(`- **Hero:** ${r.hero.type} (${r.hero.severity})`);
    L.push(`- Recommended action: ${r.hero.recommendedAction ?? '—'}`);
    if (r.hero.gapAmount != null) L.push(`- Gap amount: ${usd(r.hero.gapAmount)}`);
    if (r.commitmentDraft) {
      const g = r.commitmentDraft.grounding;
      L.push(`- Commitment draft (illustrative @ recommended): ${r.commitmentDraft.illustrativeActionAtRecommended ?? '— (no grounded target)'}`);
      L.push(`- Grounded target: classification=${g.classification} · recommended=${usd(g.recommended)} · floor=${usd(g.floor)} · weeklyCapacity=${usd(g.weeklyCapacity)} · ceiling=${usd(g.ceiling)}${g.unknownReason ? ` · unknownReason=${g.unknownReason}` : ''}`);
    } else {
      L.push('- Commitment draft: none (hero is not commitment-ready)');
    }
    if (r.execute.kind === 'levers') {
      L.push(`- Execute (levers): ${r.execute.lead}`);
      L.push(`  - Start here: ${r.execute.recommended}`);
      for (const alt of r.execute.alternates) L.push(`  - alt: ${alt}`);
    } else {
      L.push(`- Execute (${r.execute.kind}): ${r.execute.detail}`);
    }
    L.push('');
  }

  return L.join('\n');
}

function main(): void {
  const txns = loadFixture();

  // PRIMARY basis requires a real total-cash anchor — fail loud if absent/placeholder.
  const totalConfig = loadTotalCashAnchors();

  // COMPARISON basis: operating-cash anchors are best-effort (not required).
  const op = loadAnchors();
  const operatingAnchors = op.loaded && op.anchors.length > 0 ? op.anchors : null;

  const records: ReplayRecord[] = [];
  for (const asOfDate of AS_OF_DATES) {
    records.push(replayOne(asOfDate, txns, totalConfig, operatingAnchors));
  }

  const totalAnchorSummary = totalConfig.anchors
    .map((a) => `${a.asOfDate}=${usd(a.totalCashBalance)}`)
    .join(', ');

  const generatedAt = new Date().toISOString();
  const meta = {
    generatedAt,
    fixturePath: getFixturePath(),
    fixtureRows: txns.length,
    cashIncludedAccounts: totalConfig.cashIncludedAccounts,
    excludedNotable: EXCLUDED_NOTABLE,
    cashDefinitionSource: CASH_DEFINITION_SOURCE,
    totalAnchorSummary,
    operatingAvailable: operatingAnchors !== null,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const mdPath = resolve(OUT_DIR, 'replay.md');
  const jsonPath = resolve(OUT_DIR, 'replay.json');
  writeFileSync(mdPath, renderMarkdown(records, meta));
  writeFileSync(jsonPath, JSON.stringify({ meta, records }, null, 2));

  const buckets = new Map<string, number>();
  for (const r of records) buckets.set(r.hero.type, (buckets.get(r.hero.type) ?? 0) + 1);

  console.log('\n=== Assistant replay complete (TOTAL-cash basis) ===');
  console.log(`Cash-included accounts: ${totalConfig.cashIncludedAccounts.join(', ')}`);
  console.log(`Total-cash anchor(s): ${totalAnchorSummary}`);
  console.log(`Operating-cash comparison: ${operatingAnchors ? 'included' : 'unavailable'}`);
  console.log('\nHero-bucket distribution (total-cash):');
  for (const [type, n] of [...buckets.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type.padEnd(24)} ${n}`);
  }
  const critical = buckets.get('reserve_critical') ?? 0;
  console.log(`\nreserve_critical present: ${critical > 0 ? `YES (${critical})` : 'no'}`);
  console.log(`\nArtifacts:\n  ${mdPath}\n  ${jsonPath}\n`);
}

main();
