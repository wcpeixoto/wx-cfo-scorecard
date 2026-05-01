import { loadFixture, loadAnchors, getFixturePath } from './loadFixture';
import { readBaseline, BASELINE_PATH } from './baselineFile';
import { runHarness } from './runner';
import type { EngineParameterOverrides } from '../../src/lib/kpis/compute';
import type { AggregateMetrics, EngineOverrideTierMismatch } from './types';

const AS_OF_DATES: string[] = [
  '2025-01-01', '2025-02-01', '2025-03-01', '2025-04-01', '2025-05-01',
  '2025-06-01', '2025-07-01', '2025-08-01', '2025-09-01', '2025-10-01',
  '2025-11-01', '2025-12-01', '2026-01-01', '2026-02-01', '2026-03-01',
];
const HORIZON_MONTHS = 12;
const CONTROL_TOLERANCE = 1e-4;

type Variant = {
  label: string;
  overrides?: EngineParameterOverrides;
};

// When trailing weight is overridden, historical is set to (1 - trailing) so
// the cash-in / cash-out blend remains a weighted average summing to 1. The
// engine's underlying math only happens to sum to 1 with the locked defaults
// (0.3+0.7, 0.6+0.4); it does not normalize internally.
const VARIANTS: Variant[] = [
  { label: '[control] no overrides' },

  { label: 'yearWeights=[1.0, 0, 0, 0]', overrides: { yearWeights: [1.0, 0, 0, 0] } },
  { label: 'yearWeights=[0.25,0.25,0.25,0.25]', overrides: { yearWeights: [0.25, 0.25, 0.25, 0.25] } },
  { label: 'yearWeights=[0.60,0.30,0.10, 0]', overrides: { yearWeights: [0.60, 0.30, 0.10, 0] } },

  { label: 'cashInTrailing=0.0', overrides: { cashInTrailingWeight: 0.0, cashInHistoricalWeight: 1.0 } },
  { label: 'cashInTrailing=0.5', overrides: { cashInTrailingWeight: 0.5, cashInHistoricalWeight: 0.5 } },
  { label: 'cashInTrailing=0.7', overrides: { cashInTrailingWeight: 0.7, cashInHistoricalWeight: 0.3 } },
  { label: 'cashInTrailing=1.0', overrides: { cashInTrailingWeight: 1.0, cashInHistoricalWeight: 0.0 } },

  { label: 'cashOutTrailing=0.0', overrides: { cashOutTrailingWeight: 0.0, cashOutHistoricalWeight: 1.0 } },
  { label: 'cashOutTrailing=0.3', overrides: { cashOutTrailingWeight: 0.3, cashOutHistoricalWeight: 0.7 } },
  { label: 'cashOutTrailing=0.5', overrides: { cashOutTrailingWeight: 0.5, cashOutHistoricalWeight: 0.5 } },
  { label: 'cashOutTrailing=0.8', overrides: { cashOutTrailingWeight: 0.8, cashOutHistoricalWeight: 0.2 } },
  { label: 'cashOutTrailing=1.0', overrides: { cashOutTrailingWeight: 1.0, cashOutHistoricalWeight: 0.0 } },

  { label: 'winsorThreshold=0.10', overrides: { winsorizationThreshold: 0.10 } },
  { label: 'winsorThreshold=0.20', overrides: { winsorizationThreshold: 0.20 } },
  { label: 'winsorThreshold=0.50', overrides: { winsorizationThreshold: 0.50 } },
  { label: 'winsorThreshold=1.00 (off)', overrides: { winsorizationThreshold: 1.00 } },

  { label: 'indexCaps=[0.75, 1.50]', overrides: { indexCapMin: 0.75, indexCapMax: 1.50 } },
  { label: 'indexCaps=[0.25, 4.00]', overrides: { indexCapMin: 0.25, indexCapMax: 4.00 } },
  { label: 'indexCaps=[0, 999] (off)', overrides: { indexCapMin: 0, indexCapMax: 999 } },

  { label: 'outlierTrimFloor=0.40', overrides: { outlierTrimFloor: 0.40 } },
  { label: 'outlierTrimFloor=0.80', overrides: { outlierTrimFloor: 0.80 } },
  { label: 'outlierTrimFloor=0 (off)', overrides: { outlierTrimFloor: 0 } },
];

function fmtCurrency(n: number): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return 'n/a';
  return `${(n * 100).toFixed(1)}%`;
}

function fmtPctDelta(n: number): string {
  if (!Number.isFinite(n)) return 'n/a';
  const sign = n > 0 ? '+' : '';
  return `${sign}${(n * 100).toFixed(1)}pp`;
}

function fmtCurrencyDelta(n: number): string {
  if (!Number.isFinite(n)) return 'n/a';
  const sign = n > 0 ? '+' : '';
  return `${sign}${fmtCurrency(n)}`;
}

function fmtRatioDelta(curr: number, ctrl: number): string {
  if (!Number.isFinite(curr) || !Number.isFinite(ctrl) || Math.abs(ctrl) < 1e-9) return 'n/a';
  const ratio = (curr - ctrl) / ctrl;
  const sign = ratio > 0 ? '+' : '';
  return `${sign}${(ratio * 100).toFixed(0)}%`;
}

function pad(s: string, w: number): string { return s.length >= w ? s : s + ' '.repeat(w - s.length); }
function padLeft(s: string, w: number): string { return s.length >= w ? s : ' '.repeat(w - s.length) + s; }

type SweepRow = {
  label: string;
  agg: AggregateMetrics;
  tierMismatches: EngineOverrideTierMismatch[];
  isControl: boolean;
};

function sanityCheckControl(controlAgg: AggregateMetrics): void {
  const baseline = readBaseline(BASELINE_PATH);
  if (!baseline) {
    throw new Error(
      `Baseline missing at ${BASELINE_PATH}. The sweep needs a canonical baseline to sanity-check the control run. Run` +
        ' `npx tsx scripts/backtest/runBacktest.ts --update-baseline` first.'
    );
  }
  const checks: Array<[string, number, number]> = [
    ['directionalAccuracy', controlAgg.directionalAccuracy, baseline.aggregate.directionalAccuracy],
    ['mape90', controlAgg.mape90, baseline.aggregate.mape90],
    ['safetyLineHitRate', controlAgg.safetyLineHitRate, baseline.aggregate.safetyLineHitRate],
    ['worstSingleMonthMiss', controlAgg.worstSingleMonthMiss, baseline.aggregate.worstSingleMonthMiss],
  ];
  for (const [name, current, expected] of checks) {
    const tol = name === 'worstSingleMonthMiss' ? 0.01 : CONTROL_TOLERANCE;
    if (Math.abs(current - expected) > tol) {
      throw new Error(
        `Control run drifted from baseline.json at ${name}: current=${current}, expected=${expected} (tolerance ${tol}). ` +
          'This indicates the runner or the engine seam is broken. Aborting sweep.'
      );
    }
  }
}

function main(): void {
  const txns = loadFixture();
  const { anchors } = loadAnchors();

  console.log(`Fixture: ${getFixturePath()} (${txns.length} transactions)`);
  console.log(`As-of dates: ${AS_OF_DATES.length}, horizon: ${HORIZON_MONTHS} months, variants: ${VARIANTS.length}`);
  console.log('');

  const rows: SweepRow[] = [];
  for (const v of VARIANTS) {
    const result = runHarness({
      transactions: txns,
      anchors,
      asOfDates: AS_OF_DATES,
      horizonMonths: HORIZON_MONTHS,
      engineOverrides: v.overrides,
    });
    rows.push({
      label: v.label,
      agg: result.aggregate,
      tierMismatches: result.engineOverrideTierMismatches,
      isControl: !v.overrides,
    });
  }

  const control = rows.find((r) => r.isControl);
  if (!control) throw new Error('Control row missing — sweep variant list is malformed.');
  sanityCheckControl(control.agg);

  // Sort non-control rows by absolute delta on worstSingleMonthMiss, descending.
  const nonControl = rows.filter((r) => !r.isControl);
  nonControl.sort(
    (a, b) =>
      Math.abs(b.agg.worstSingleMonthMiss - control.agg.worstSingleMonthMiss) -
      Math.abs(a.agg.worstSingleMonthMiss - control.agg.worstSingleMonthMiss)
  );
  const ordered: SweepRow[] = [control, ...nonControl];

  // Render table.
  const headers = [
    pad('variant', 38),
    padLeft('dirAcc', 7),
    padLeft('Δ', 8),
    padLeft('mape90', 7),
    padLeft('Δ', 8),
    padLeft('worstMiss', 12),
    padLeft('Δ', 10),
    padLeft('Δ%', 7),
    padLeft('hitRate', 8),
    padLeft('tierMiss', 9),
  ];
  console.log(headers.join('  '));
  console.log('-'.repeat(headers.join('  ').length));

  const footnotes: string[] = [];
  for (const r of ordered) {
    const tierCount = r.tierMismatches.length;
    const star = tierCount > 0 ? '*' : '';
    const labelCol = `${r.label}${star}`;
    if (tierCount > 0) {
      footnotes.push(
        `* ${r.label}: override dropped at ${tierCount} of ${AS_OF_DATES.length} as-of dates due to tier mismatch`
      );
    }
    const dDir = r.agg.directionalAccuracy - control.agg.directionalAccuracy;
    const dMape = r.agg.mape90 - control.agg.mape90;
    const dMiss = r.agg.worstSingleMonthMiss - control.agg.worstSingleMonthMiss;
    console.log(
      [
        pad(labelCol, 38),
        padLeft(fmtPct(r.agg.directionalAccuracy), 7),
        padLeft(r.isControl ? '—' : fmtPctDelta(dDir), 8),
        padLeft(fmtPct(r.agg.mape90), 7),
        padLeft(r.isControl ? '—' : fmtPctDelta(dMape), 8),
        padLeft(fmtCurrency(r.agg.worstSingleMonthMiss), 12),
        padLeft(r.isControl ? '—' : fmtCurrencyDelta(dMiss), 10),
        padLeft(r.isControl ? '—' : fmtRatioDelta(r.agg.worstSingleMonthMiss, control.agg.worstSingleMonthMiss), 7),
        padLeft(fmtPct(r.agg.safetyLineHitRate), 8),
        padLeft(String(tierCount), 9),
      ].join('  ')
    );
  }

  if (footnotes.length > 0) {
    console.log('');
    for (const fn of footnotes) console.log(fn);
  }
  console.log('');
  console.log('Sorted by |Δ worstSingleMonthMiss| descending. Control pinned at top.');
}

main();
