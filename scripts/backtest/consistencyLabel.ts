/**
 * consistencyLabel.ts — apply FROZEN labeling criteria to the 47-window
 * raw artifact and emit labels.
 *
 * Frozen criteria (set in consistency-labels.md before any ratios computed):
 *   Steady  iff  (no month worse than -$5K) AND (≤2 negative months out of 6)
 *   Choppy  otherwise
 *
 * This script encodes those exact rules. No per-window human judgment;
 * application is mechanical. Re-running with the same raw input must produce
 * identical labels.
 *
 * Cluster bar (also pre-committed):
 *   Pass iff  Steady cluster count ≥4  AND  total Steady count ≥4
 *   A cluster is a maximal run of consecutive Steady as-of dates where each
 *   pair is ≤6 months apart (i.e., trailing-6 windows would overlap).
 *
 * Run: npx tsx scripts/backtest/consistencyLabel.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Criteria — frozen, do not modify post-hoc
const SHOCK_LOSS_THRESHOLD = -5000;
const MAX_NEGATIVE_MONTHS = 2;
const CLUSTER_GAP_MONTHS = 6;
const PASS_BAR_MIN_STEADY = 4;
const PASS_BAR_MIN_CLUSTERS = 4;

const RAW_PATH = resolve('backtest-results/calibration/consistency-windows-raw-full.json');
const LABELS_PATH = resolve('backtest-results/calibration/consistency-labels-full.json');

interface MonthRow {
  month: string;
  netCashFlow: number;
  revenue: number;
}

interface RawWindow {
  asOf: string;
  isProdAnchor: boolean;
  windowLabel: string;
  months: MonthRow[];
  monthCount: number;
}

interface RawArtifact {
  generatedFromFixture: boolean;
  windowMonths: number;
  asOfDateCount: number;
  windows: RawWindow[];
}

type Verdict = 'Steady' | 'Choppy' | 'Insufficient';

interface LabeledWindow {
  asOf: string;
  isProdAnchor: boolean;
  windowLabel: string;
  label: Verdict;
  negativeCount: number;
  worstLoss: number;
  reason: string;
}

function labelWindow(window: RawWindow): LabeledWindow {
  if (window.monthCount < 6) {
    return {
      asOf: window.asOf,
      isProdAnchor: window.isProdAnchor,
      windowLabel: window.windowLabel,
      label: 'Insufficient',
      negativeCount: 0,
      worstLoss: 0,
      reason: `only ${window.monthCount} months of data`,
    };
  }

  const negatives = window.months.filter((m) => m.netCashFlow < 0);
  const worstLoss = window.months.reduce(
    (acc, m) => (m.netCashFlow < acc ? m.netCashFlow : acc),
    0
  );

  const hasShockLoss = worstLoss < SHOCK_LOSS_THRESHOLD;
  const tooManyNegatives = negatives.length > MAX_NEGATIVE_MONTHS;

  let label: Verdict;
  let reason: string;
  if (!hasShockLoss && !tooManyNegatives) {
    label = 'Steady';
    reason = `no shock (worst ${worstLoss.toFixed(0)}), ${negatives.length} neg`;
  } else if (hasShockLoss && tooManyNegatives) {
    label = 'Choppy';
    reason = `shock loss ${worstLoss.toFixed(0)} + ${negatives.length} neg`;
  } else if (hasShockLoss) {
    label = 'Choppy';
    reason = `shock loss ${worstLoss.toFixed(0)} (${negatives.length} neg only)`;
  } else {
    label = 'Choppy';
    reason = `${negatives.length} neg (worst ${worstLoss.toFixed(0)})`;
  }

  return {
    asOf: window.asOf,
    isProdAnchor: window.isProdAnchor,
    windowLabel: window.windowLabel,
    label,
    negativeCount: negatives.length,
    worstLoss,
    reason,
  };
}

function monthsBetweenAsOfs(a: string, b: string): number {
  const [ay, am] = a.split('-').slice(0, 2).map(Number);
  const [by, bm] = b.split('-').slice(0, 2).map(Number);
  return Math.abs((by - ay) * 12 + (bm - am));
}

function clusterSteadyWindows(labeled: LabeledWindow[]): string[][] {
  const steadyAsOfs = labeled.filter((w) => w.label === 'Steady').map((w) => w.asOf);
  if (steadyAsOfs.length === 0) return [];

  const sorted = [...steadyAsOfs].sort();
  const clusters: string[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = monthsBetweenAsOfs(sorted[i - 1], sorted[i]);
    if (gap <= CLUSTER_GAP_MONTHS) {
      clusters[clusters.length - 1].push(sorted[i]);
    } else {
      clusters.push([sorted[i]]);
    }
  }
  return clusters;
}

function main(): void {
  const rawData = JSON.parse(readFileSync(RAW_PATH, 'utf8')) as RawArtifact;
  console.log(`Loaded ${rawData.windows.length} windows from ${RAW_PATH}`);

  const labeled = rawData.windows.map(labelWindow);

  const steadyCount = labeled.filter((w) => w.label === 'Steady').length;
  const choppyCount = labeled.filter((w) => w.label === 'Choppy').length;
  const insufficientCount = labeled.filter((w) => w.label === 'Insufficient').length;

  const clusters = clusterSteadyWindows(labeled);
  const passBar =
    steadyCount >= PASS_BAR_MIN_STEADY && clusters.length >= PASS_BAR_MIN_CLUSTERS;

  // Sanity: prod anchor must be Choppy under any defensible criteria
  const prod = labeled.find((w) => w.isProdAnchor);
  const prodIsChoppy = prod?.label === 'Choppy';

  const out = {
    criteria: {
      shockLossThreshold: SHOCK_LOSS_THRESHOLD,
      maxNegativeMonths: MAX_NEGATIVE_MONTHS,
      clusterGapMonths: CLUSTER_GAP_MONTHS,
      passBarMinSteady: PASS_BAR_MIN_STEADY,
      passBarMinClusters: PASS_BAR_MIN_CLUSTERS,
    },
    tally: {
      total: labeled.length,
      Steady: steadyCount,
      Choppy: choppyCount,
      Insufficient: insufficientCount,
    },
    prodAnchorIsChoppy: prodIsChoppy,
    steadyClusters: clusters,
    passBar,
    windows: labeled,
  };

  writeFileSync(LABELS_PATH, JSON.stringify(out, null, 2));
  console.log(`Wrote ${LABELS_PATH}`);
  console.log('');

  // Console summary
  console.log('=== Tally ===');
  console.log(`  Total:        ${labeled.length}`);
  console.log(`  Steady:       ${steadyCount}`);
  console.log(`  Choppy:       ${choppyCount}`);
  console.log(`  Insufficient: ${insufficientCount}`);
  console.log('');

  console.log('=== Prod anchor (2026-05-01) ===');
  if (prod) {
    console.log(`  Label: ${prod.label}  (must be Choppy)`);
    console.log(`  Reason: ${prod.reason}`);
    console.log(`  ${prodIsChoppy ? 'PASS' : 'FAIL — calibration invalid'}`);
  }
  console.log('');

  console.log('=== Steady clusters ===');
  if (clusters.length === 0) {
    console.log('  (none)');
  } else {
    clusters.forEach((c, i) => {
      console.log(`  Cluster ${i + 1} (${c.length} window${c.length > 1 ? 's' : ''}): ${c.join(', ')}`);
    });
  }
  console.log('');

  console.log('=== Pass bar ===');
  console.log(`  Steady ≥${PASS_BAR_MIN_STEADY}: ${steadyCount >= PASS_BAR_MIN_STEADY ? 'YES' : 'NO'} (${steadyCount})`);
  console.log(`  Clusters ≥${PASS_BAR_MIN_CLUSTERS}: ${clusters.length >= PASS_BAR_MIN_CLUSTERS ? 'YES' : 'NO'} (${clusters.length})`);
  console.log(`  Overall: ${passBar ? 'PASS — proceed to ratio computation' : 'FAIL — D (range-only, no verdict)'}`);
  console.log('');

  console.log('=== Per-window labels ===');
  labeled.forEach((w) => {
    const tag = w.isProdAnchor ? ' [PROD]' : '';
    const labelPad = w.label.padEnd(13);
    console.log(`  ${w.asOf}${tag}  ${labelPad} ${w.windowLabel}  — ${w.reason}`);
  });
}

main();
