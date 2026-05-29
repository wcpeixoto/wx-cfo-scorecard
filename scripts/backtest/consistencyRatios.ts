/**
 * consistencyRatios.ts — INFORMATIONAL footnote ONLY.
 *
 * Computes Range / trailing-6-Business-Income per window and groups by the
 * pre-committed Steady/Choppy labels. Reports distribution shape and any
 * gap or overlap between groups.
 *
 * DOES NOT propose, search for, or report a cutoff. The pre-committed
 * cluster gate failed (3 clusters, 4 required), so this output is outside
 * the validated calibration flow. Its only purpose is to tell a future
 * revisit whether the metric is sound (Steady/Choppy distributions cleanly
 * separated → metric ok, need more independent observations) or whether
 * the metric itself is wrong (distributions overlap → reach for a different
 * dispersion measure).
 *
 * Run: npx tsx scripts/backtest/consistencyRatios.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RAW_PATH = resolve('backtest-results/calibration/consistency-windows-raw-full.json');
const LABELS_PATH = resolve('backtest-results/calibration/consistency-labels-full.json');
const OUT_PATH = resolve('backtest-results/calibration/consistency-ratios-informational.json');

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
  windows: RawWindow[];
}
interface LabeledWindow {
  asOf: string;
  label: 'Steady' | 'Choppy' | 'Insufficient';
}
interface LabelsArtifact {
  windows: LabeledWindow[];
}

interface RatioRow {
  asOf: string;
  label: 'Steady' | 'Choppy';
  windowLabel: string;
  range: number;
  sumBI: number;
  ratio: number;
}

function computeRatio(window: RawWindow): { range: number; sumBI: number; ratio: number } {
  const netVals = window.months.map((m) => m.netCashFlow);
  const range = Math.max(...netVals) - Math.min(...netVals);
  const sumBI = window.months.reduce((acc, m) => acc + m.revenue, 0);
  const ratio = sumBI > 0 ? range / sumBI : Number.NaN;
  return { range, sumBI, ratio };
}

function summarize(rows: RatioRow[]): {
  count: number;
  min: number;
  max: number;
  median: number;
} {
  const sorted = rows.map((r) => r.ratio).sort((a, b) => a - b);
  const n = sorted.length;
  const median = n === 0 ? 0 : n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  return {
    count: n,
    min: n === 0 ? 0 : sorted[0],
    max: n === 0 ? 0 : sorted[n - 1],
    median,
  };
}

function main(): void {
  const raw = JSON.parse(readFileSync(RAW_PATH, 'utf8')) as RawArtifact;
  const labels = JSON.parse(readFileSync(LABELS_PATH, 'utf8')) as LabelsArtifact;

  const labelMap = new Map(labels.windows.map((w) => [w.asOf, w.label]));

  const rows: RatioRow[] = [];
  for (const w of raw.windows) {
    const label = labelMap.get(w.asOf);
    if (label !== 'Steady' && label !== 'Choppy') continue;
    const { range, sumBI, ratio } = computeRatio(w);
    rows.push({
      asOf: w.asOf,
      label,
      windowLabel: w.windowLabel,
      range,
      sumBI,
      ratio,
    });
  }

  const steadyRows = rows.filter((r) => r.label === 'Steady');
  const choppyRows = rows.filter((r) => r.label === 'Choppy');

  const steadyStats = summarize(steadyRows);
  const choppyStats = summarize(choppyRows);

  // Separation analysis — DO NOT name a cutoff
  const maxSteady = steadyStats.max;
  const minChoppy = choppyStats.min;
  const cleanlySeparated = maxSteady < minChoppy;
  const gap = cleanlySeparated ? minChoppy - maxSteady : 0;

  const choppyBelowMaxSteady = choppyRows.filter((r) => r.ratio <= maxSteady).length;
  const steadyAboveMinChoppy = steadyRows.filter((r) => r.ratio >= minChoppy).length;
  const overlapCount = choppyBelowMaxSteady + steadyAboveMinChoppy;

  const out = {
    discipline:
      'Informational footnote, OUTSIDE pre-committed calibration flow. Cluster gate failed (3 vs 4 required); no cutoff proposed or validated.',
    metric: 'Range / trailing-6 Business Income (same 6-month window for numerator and denominator)',
    counts: { Steady: steadyRows.length, Choppy: choppyRows.length },
    distributions: { Steady: steadyStats, Choppy: choppyStats },
    separation: {
      cleanlySeparated,
      gapBetweenMaxSteadyAndMinChoppy: cleanlySeparated ? gap : null,
      overlapCount,
      choppyBelowOrAtMaxSteady: choppyBelowMaxSteady,
      steadyAboveOrAtMinChoppy: steadyAboveMinChoppy,
    },
    rowsBySteadyAsc: [...steadyRows].sort((a, b) => a.ratio - b.ratio),
    rowsByChoppyAsc: [...choppyRows].sort((a, b) => a.ratio - b.ratio),
  };

  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`Wrote ${OUT_PATH}\n`);

  console.log('=== Distribution shape (informational only — no cutoff) ===');
  console.log(`Steady  (n=${steadyStats.count}):  min=${steadyStats.min.toFixed(4)}  median=${steadyStats.median.toFixed(4)}  max=${steadyStats.max.toFixed(4)}`);
  console.log(`Choppy  (n=${choppyStats.count}):  min=${choppyStats.min.toFixed(4)}  median=${choppyStats.median.toFixed(4)}  max=${choppyStats.max.toFixed(4)}`);
  console.log('');

  console.log('=== Separation ===');
  if (cleanlySeparated) {
    console.log(`Distributions CLEANLY SEPARATED.`);
    console.log(`Gap between max(Steady)=${maxSteady.toFixed(4)} and min(Choppy)=${minChoppy.toFixed(4)} = ${gap.toFixed(4)}`);
  } else {
    console.log(`Distributions OVERLAP.`);
    console.log(`max(Steady)=${maxSteady.toFixed(4)}, min(Choppy)=${minChoppy.toFixed(4)}`);
    console.log(`Overlap region holds ${overlapCount} windows (${choppyBelowMaxSteady} Choppy below maxSteady, ${steadyAboveMinChoppy} Steady above minChoppy).`);
  }
  console.log('');

  console.log('=== Sorted ratios — Steady (ascending) ===');
  out.rowsBySteadyAsc.forEach((r) => {
    console.log(`  ${r.asOf}  ratio=${r.ratio.toFixed(4)}  range=$${r.range.toFixed(0)}  BI=$${r.sumBI.toFixed(0)}  (${r.windowLabel})`);
  });
  console.log('');
  console.log('=== Sorted ratios — Choppy (ascending) ===');
  out.rowsByChoppyAsc.forEach((r) => {
    console.log(`  ${r.asOf}  ratio=${r.ratio.toFixed(4)}  range=$${r.range.toFixed(0)}  BI=$${r.sumBI.toFixed(0)}  (${r.windowLabel})`);
  });
}

main();
