/**
 * Rubric-review artifact generator — read-only diagnostic, FACTS ONLY.
 *
 * Emits assistant-replay-results/rubric-review.md for a fixed set of review weeks,
 * with the full per-week facts a human needs to score the rubric. It does NOT
 * score, rank, or comment. It is ADDITIVE — it never touches replay.md / replay.json.
 *
 * Same total-cash basis + chain as scripts/assistant-replay/runReplay.ts; the small
 * loader/reconstruction/buildBasis helpers below MIRROR that file (kept inline so
 * this generator is self-contained and the landed replay artifacts are never
 * regenerated). The cash definition itself is shared via the anchor FILE, not code.
 *
 * Run: npx tsx scripts/assistant-replay/rubricReview.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadFixture, loadAnchors } from '../backtest/loadFixture';
import { reconstructStartingCash } from '../../src/lib/kpis/forecastShared';
import { computeDashboardModel, projectScenario } from '../../src/lib/kpis/compute';
import { detectSignals } from '../../src/lib/priorities/signals';
import { rankPriorities } from '../../src/lib/priorities/rank';
import { buildExecuteHelp } from '../../src/lib/commitments/execute';
import { reserveWarningCommitment } from '../../src/lib/commitments/reserveWarningCommitment';
import { groundingConsentMode } from '../../src/lib/commitments/targetGrounding';
import type { ScenarioInput, DashboardModel, Txn } from '../../src/lib/data/contract';
import type { PriorityHistoryRow, Signal } from '../../src/lib/priorities/types';

// The five approved review weeks (by hero state across the corrected distribution).
const REVIEW_WEEKS: string[] = [
  '2025-01-01', // reserve_warning, ~84% (top of warning band)
  '2025-04-01', // expense_surge (only non-reserve expense hero)
  '2025-07-01', // reserve_warning, ~55% (ordinary warning)
  '2025-12-01', // reserve_critical, ~43% (first critical crossing)
  '2026-03-01', // reserve_critical, ~19% (worst case)
];

// ── Mirror of runReplay.ts internals (self-contained) ───────────────────────
const TOTAL_CASH_ANCHORS_PATH = resolve('backtest-results/fixtures/total-cash-anchors.json');
const PRODUCTION_CASH_INCLUDED_ACCOUNTS = ['Bank of America', 'Card Amex'];
const CASH_DEFINITION_SOURCE = 'production shared_account_settings (read-only lookup 2026-05-23)';
const EXCLUDED_NOTABLE = [
  'Cash (petty)', 'Wodify', 'CC Corp 8839', 'CC Deborah', 'CC Marcio', 'S/T Loan SH', 'Merchant Fee',
];
const BASE_SCENARIO: ScenarioInput = {
  scenarioKey: 'base', revenueGrowthPct: 0, expenseChangePct: 0, receivableDays: 3, payableDays: 3, months: 12,
};
const HORIZON_MONTHS = 12;
const OUT_DIR = resolve('assistant-replay-results');

const monthOf = (d: string): string => d.slice(0, 7);
function fail(msg: string): never {
  console.error(`\n[rubric-review] FATAL: ${msg}\n`);
  process.exit(1);
}
const usd = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? 'n/a' : (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('en-US');
const pct = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? 'n/a' : `${(n * 100).toFixed(1)}%`;

interface TotalCashAnchor { asOfDate: string; totalCashBalance: number }
interface TotalCashConfig { cashIncludedAccounts: string[]; anchors: TotalCashAnchor[] }

function loadTotalCashAnchors(): TotalCashConfig {
  if (!existsSync(TOTAL_CASH_ANCHORS_PATH)) fail(`Total-cash anchor file missing: ${TOTAL_CASH_ANCHORS_PATH}`);
  let parsed: Partial<TotalCashConfig>;
  try {
    parsed = JSON.parse(readFileSync(TOTAL_CASH_ANCHORS_PATH, 'utf8')) as Partial<TotalCashConfig>;
  } catch (err) {
    return fail(`Total-cash anchor file is not valid JSON: ${err}`);
  }
  const cashIncludedAccounts =
    Array.isArray(parsed.cashIncludedAccounts) && parsed.cashIncludedAccounts.length > 0
      ? parsed.cashIncludedAccounts
      : PRODUCTION_CASH_INCLUDED_ACCOUNTS;
  const anchors = Array.isArray(parsed.anchors) ? parsed.anchors : [];
  if (anchors.length === 0) fail(`Total-cash anchor file has no anchors (${TOTAL_CASH_ANCHORS_PATH}).`);
  for (const a of anchors) {
    if (!a || typeof a.asOfDate !== 'string' || !Number.isFinite(a.totalCashBalance)) {
      fail(`Total-cash anchor not filled in: ${JSON.stringify(a)}`);
    }
  }
  anchors.sort((x, y) => x.asOfDate.localeCompare(y.asOfDate));
  if (anchors[0].asOfDate >= REVIEW_WEEKS[0]) {
    fail(`Earliest total-cash anchor (${anchors[0].asOfDate}) must precede the earliest review week (${REVIEW_WEEKS[0]}).`);
  }
  return { cashIncludedAccounts, anchors };
}

function reconstructTotalCash(asOfDate: string, txns: Txn[], config: TotalCashConfig): number {
  let anchor: TotalCashAnchor | null = null;
  for (const a of config.anchors) {
    if (a.asOfDate <= asOfDate && (!anchor || a.asOfDate > anchor.asOfDate)) anchor = a;
  }
  if (!anchor) fail(`No preceding total-cash anchor for ${asOfDate}.`);
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

function commitmentFromSignal(signal: Signal, model: DashboardModel) {
  return signal.type === 'reserve_warning' || signal.type === 'reserve_critical'
    ? reserveWarningCommitment(signal, model)
    : null;
}

function buildBasis(asOfDate: string, filtered: Txn[], cash: number): { model: DashboardModel; hero: Signal } {
  const model = computeDashboardModel(filtered, {
    cashFlowMode: 'operating',
    thisMonthAnchor: monthOf(asOfDate),
    currentCashBalance: cash,
  });
  const projection = projectScenario(model, { ...BASE_SCENARIO, months: HORIZON_MONTHS }, cash, []);
  const signals = detectSignals(model, filtered, projection.points);
  return { model, hero: rankPriorities(signals).hero };
}

// ── Per-week facts ──────────────────────────────────────────────────────────
function renderWeek(
  asOfDate: string,
  txns: Txn[],
  totalConfig: TotalCashConfig,
  operatingAnchors: ReturnType<typeof loadAnchors>['anchors'] | null,
): string {
  const L: string[] = [];
  const filtered = txns.filter((t) => t.date < asOfDate);

  const totalCash = reconstructTotalCash(asOfDate, txns, totalConfig);
  const { model, hero } = buildBasis(asOfDate, filtered, totalCash);
  const draft = commitmentFromSignal(hero, model);

  const executeRow = { signal_type: hero.type } as unknown as PriorityHistoryRow;
  const execute = buildExecuteHelp(model, executeRow);

  const latestRollup = model.monthlyRollups[model.monthlyRollups.length - 1] ?? null;
  const topDeltas = model.opportunities.slice(0, 3);

  let operating: { model: DashboardModel; hero: Signal; cash: number } | null = null;
  if (operatingAnchors) {
    const opCash = reconstructStartingCash(asOfDate, txns, operatingAnchors);
    operating = { ...buildBasis(asOfDate, filtered, opCash), cash: opCash };
  }

  L.push(`## ${asOfDate}`);
  L.push('');
  L.push(`- Hero signal: **${hero.type}**`);
  L.push(`- Severity: ${hero.severity}`);
  L.push(`- Reserve % funded (total cash): ${pct(model.runway.percentFunded)}`);
  L.push(`- recommendedAction: ${hero.recommendedAction ? `"${hero.recommendedAction}"` : '— (none)'}`);

  // Commitment draft
  if (draft) {
    const g = draft.grounding;
    const consent = groundingConsentMode(g);
    const draftAction =
      g.classification === 'grounded' && g.recommended != null ? draft.buildAction(g.recommended) : null;
    L.push(`- Commitment draft action (at grounded recommended target): ${draftAction ? `"${draftAction}"` : '— (no grounded target)'}`);
    L.push(`- Grounded target:`);
    L.push(`  - recommended: ${usd(g.recommended)}`);
    L.push(`  - floor: ${usd(g.floor)}`);
    L.push(`  - weeklyCapacity: ${usd(g.weeklyCapacity)}`);
    L.push(`  - ceiling (full reserve gap): ${usd(g.ceiling)}`);
    L.push(`  - grounding classification: ${g.classification}${g.unknownReason ? ` (reason: ${g.unknownReason})` : ''}`);
    L.push(`  - consent mode: ${consent.mode}`);
  } else {
    L.push(`- Commitment draft action: — (hero is not commitment-ready)`);
    L.push(`- Grounded target: — (no draft)`);
  }

  // Execute
  if (execute === null) {
    L.push(`- Execute output: n/a — hero is not reserve-funding (Execute is reserve-only)`);
  } else if (execute.kind === 'none') {
    L.push(`- Execute output (honest "nothing jumped"): "${execute.text}"`);
  } else {
    L.push(`- Execute output (levers):`);
    L.push(`  - lead: "${execute.lead}"`);
    L.push(`  - Start here: "${execute.recommended.text}"`);
    if (execute.alternates.length > 0) {
      for (const alt of execute.alternates) L.push(`  - alternate: "${alt.text}"`);
    } else {
      L.push(`  - alternates: none`);
    }
  }

  // Model context
  L.push(`- Model context:`);
  L.push(`  - currentCashBalance (total cash): ${usd(totalCash)}`);
  L.push(`  - reserveTarget: ${usd(model.runway.reserveTarget)}`);
  L.push(`  - latest complete month: ${latestRollup ? latestRollup.month : '—'} · net cash flow: ${latestRollup ? usd(latestRollup.netCashFlow) : 'n/a'}`);
  if (topDeltas.length > 0) {
    L.push(`  - top expense deltas vs trailing-3-month baseline (model.opportunities):`);
    for (const o of topDeltas) {
      L.push(`    - ${o.title}: ${usd(o.savings)} above baseline${o.hint ? ` — ${o.hint}` : ''}`);
    }
  } else {
    L.push(`  - top expense deltas vs trailing-3-month baseline: none (no category over baseline)`);
  }

  // Operating-vs-total comparison
  L.push(`- Operating-vs-total comparison:`);
  L.push(`  - total-cash % funded: ${pct(model.runway.percentFunded)} · hero (total): ${hero.type}`);
  if (operating) {
    L.push(`  - operating-cash % funded: ${pct(operating.model.runway.percentFunded)} · hero (operating): ${operating.hero.type}`);
  } else {
    L.push(`  - operating-cash comparison: unavailable`);
  }
  L.push('');

  return L.join('\n');
}

function main(): void {
  const txns = loadFixture();
  const totalConfig = loadTotalCashAnchors();
  const op = loadAnchors();
  const operatingAnchors = op.loaded && op.anchors.length > 0 ? op.anchors : null;

  const anchorSummary = totalConfig.anchors.map((a) => `${a.asOfDate}=${usd(a.totalCashBalance)}`).join(', ');

  const header: string[] = [];
  header.push('# CFO Assistant — rubric-review artifact (5 weeks, total-cash basis)');
  header.push('');
  header.push('> FACTS ONLY — evidence for human rubric review. Nothing here is scored, ranked, or commented.');
  header.push('');
  header.push('## Cash definition (matches production configuration)');
  header.push('');
  header.push(`- Reserve basis: TOTAL BANK CASH.`);
  header.push(`- Cash-included accounts: **${totalConfig.cashIncludedAccounts.join(', ')}**`);
  header.push(`- Excluded (notable): ${EXCLUDED_NOTABLE.join(', ')}`);
  header.push(`- Total-cash anchor: ${anchorSummary}`);
  header.push(`- Source: ${CASH_DEFINITION_SOURCE}`);
  header.push(`- Operating-cash shown for comparison only (excludes owner draws; not the reserve basis).`);
  header.push(`- Fixture: ${txns.length} txns. Review weeks: ${REVIEW_WEEKS.join(', ')}.`);
  header.push('');

  const sections = REVIEW_WEEKS.map((w) => renderWeek(w, txns, totalConfig, operatingAnchors));

  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = resolve(OUT_DIR, 'rubric-review.md');
  writeFileSync(outPath, header.join('\n') + '\n' + sections.join('\n'));

  console.log('\n=== rubric-review artifact generated ===');
  console.log(`Weeks: ${REVIEW_WEEKS.join(', ')}`);
  console.log(`Operating comparison: ${operatingAnchors ? 'included' : 'unavailable'}`);
  console.log(`Output: ${outPath}\n`);
}

main();
