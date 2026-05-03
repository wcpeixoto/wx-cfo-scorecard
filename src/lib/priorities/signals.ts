import type { DashboardModel, ScenarioPoint, Txn } from '../data/contract';
import { classifyTxn } from '../cashFlow';
import type { Signal } from './types';

// ─── Thresholds ───────────────────────────────────────────────────────────────

const RESERVE_CRITICAL_THRESHOLD = 0.50;
const RESERVE_FUNDED_TARGET = 1.0;
const RESERVE_CRITICAL_WEIGHT = 1.0;
const RESERVE_WARNING_WEIGHT = 0.7;

const CASH_FLOW_NEGATIVE_WEIGHT = 0.9;
const CASH_FLOW_TIGHT_WEIGHT = 0.6;

const EXPENSE_SURGE_WARNING_THRESHOLD = 0.25;
const EXPENSE_SURGE_CRITICAL_THRESHOLD = 0.50;
const EXPENSE_SURGE_ABSOLUTE_DELTA_MIN = 500;
const EXPENSE_SURGE_WEIGHT = 0.7;
const EXPENSE_SURGE_MIN_HISTORY_MONTHS = 4;

const REVENUE_DECLINE_CRITICAL_THRESHOLD = 0.15;
const REVENUE_DECLINE_WARNING_THRESHOLD = 0.05;
const REVENUE_DECLINE_CRITICAL_WEIGHT = 0.7;
const REVENUE_DECLINE_WARNING_WEIGHT = 0.4;
const REVENUE_DECLINE_MIN_HISTORY_MONTHS = 6;

const OWNER_DIST_PACE_THRESHOLD = 1.20;
const OWNER_DIST_WEIGHT = 0.5;
const OWNER_DIST_MIN_HISTORY_MONTHS = 15;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// ─── Signal detection ─────────────────────────────────────────────────────────

export function detectSignals(
  model: DashboardModel,
  txns: Txn[],
  forecastProjection: ScenarioPoint[]
): Signal[] {
  const signals: Signal[] = [];

  // ── 1. Operating reserve ────────────────────────────────────────────────────
  const { percentFunded, reserveTarget, currentCashBalance } = model.runway;

  if (percentFunded !== null) {
    if (percentFunded < RESERVE_CRITICAL_THRESHOLD) {
      signals.push({
        type: 'reserve_critical',
        severity: 'critical',
        weight: RESERVE_CRITICAL_WEIGHT,
        metricValue: percentFunded,
        targetValue: RESERVE_FUNDED_TARGET,
        gapAmount: (RESERVE_FUNDED_TARGET - percentFunded) * reserveTarget,
        recommendedAction: 'Build your operating reserve — current level is below the minimum safe floor.',
      });
    } else if (percentFunded < RESERVE_FUNDED_TARGET) {
      signals.push({
        type: 'reserve_warning',
        severity: 'warning',
        weight: RESERVE_WARNING_WEIGHT,
        metricValue: percentFunded,
        targetValue: RESERVE_FUNDED_TARGET,
        gapAmount: (RESERVE_FUNDED_TARGET - percentFunded) * reserveTarget,
        recommendedAction: 'Keep building your reserve — you\'re funded but below the full target.',
      });
    }
  }

  // ── 2. Forward cash flow ─────────────────────────────────────────────────────
  const projected = forecastProjection;

  if (projected.length > 0) {
    let runningBalance = currentCashBalance;
    let lowestProjectedBalance = runningBalance;

    for (const entry of projected) {
      runningBalance += entry.netCashFlow;
      if (runningBalance < lowestProjectedBalance) {
        lowestProjectedBalance = runningBalance;
      }
    }

    if (lowestProjectedBalance < 0) {
      signals.push({
        type: 'cash_flow_negative',
        severity: 'critical',
        weight: CASH_FLOW_NEGATIVE_WEIGHT,
        metricValue: lowestProjectedBalance,
        targetValue: 0,
        gapAmount: Math.abs(lowestProjectedBalance),
        recommendedAction: 'Cash is projected to go negative — close the gap by pulling in revenue or deferring expenses.',
      });
    } else if (lowestProjectedBalance < reserveTarget) {
      signals.push({
        type: 'cash_flow_tight',
        severity: 'warning',
        weight: CASH_FLOW_TIGHT_WEIGHT,
        metricValue: lowestProjectedBalance,
        targetValue: reserveTarget,
        gapAmount: reserveTarget - lowestProjectedBalance,
        recommendedAction: 'Cash stays positive but dips below your safety target — watch for timing gaps.',
      });
    }
  }

  // ── 3. Expense surge ─────────────────────────────────────────────────────────
  // Uses complete months from monthlyRollups to avoid partial-month contamination.
  const completeMonths = [...model.monthlyRollups]
    .map(r => r.month)
    .sort();

  if (completeMonths.length >= EXPENSE_SURGE_MIN_HISTORY_MONTHS) {
    const surgeMonth = completeMonths[completeMonths.length - 1];
    const baselineMonths = completeMonths.slice(-4, -1); // 3 months immediately before surge month

    // Aggregate expense transactions by category → month → total
    const categoryMonthTotals = new Map<string, Map<string, number>>();

    for (const txn of txns) {
      if (classifyTxn(txn) !== 'expense') continue;
      if (!categoryMonthTotals.has(txn.category)) {
        categoryMonthTotals.set(txn.category, new Map());
      }
      const monthMap = categoryMonthTotals.get(txn.category)!;
      monthMap.set(txn.month, (monthMap.get(txn.month) ?? 0) + txn.amount);
    }

    let bestCategory: string | null = null;
    let bestAbsDelta = 0;
    let bestSurgeMonthTotal = 0;
    let bestBaselineAverage = 0;

    for (const [category, monthMap] of categoryMonthTotals) {
      // Require at least EXPENSE_SURGE_MIN_HISTORY_MONTHS months of data for this category
      if (monthMap.size < EXPENSE_SURGE_MIN_HISTORY_MONTHS) continue;

      const surgeMonthTotal = monthMap.get(surgeMonth) ?? 0;
      if (surgeMonthTotal === 0) continue;

      const baselineValues = baselineMonths.map(m => monthMap.get(m) ?? 0);
      const baselineAverage = average(baselineValues);
      if (baselineAverage === 0) continue;

      const relDelta = (surgeMonthTotal - baselineAverage) / baselineAverage;
      const absDelta = surgeMonthTotal - baselineAverage;

      if (
        relDelta > EXPENSE_SURGE_WARNING_THRESHOLD &&
        absDelta > EXPENSE_SURGE_ABSOLUTE_DELTA_MIN &&
        absDelta > bestAbsDelta
      ) {
        bestAbsDelta = absDelta;
        bestCategory = category;
        bestSurgeMonthTotal = surgeMonthTotal;
        bestBaselineAverage = baselineAverage;
      }
    }

    if (bestCategory !== null) {
      const relDelta = (bestSurgeMonthTotal - bestBaselineAverage) / bestBaselineAverage;
      const severity = relDelta > EXPENSE_SURGE_CRITICAL_THRESHOLD ? 'critical' : 'warning';
      signals.push({
        type: 'expense_surge',
        severity,
        weight: EXPENSE_SURGE_WEIGHT,
        metricValue: bestSurgeMonthTotal,
        targetValue: bestBaselineAverage,
        gapAmount: bestAbsDelta,
        categoryFlagged: bestCategory,
        recommendedAction: `Review "${bestCategory}" — spending spiked above your normal range last month.`,
      });
    }
  }

  // ── 4. Revenue decline ───────────────────────────────────────────────────────
  if (model.monthlyRollups.length >= REVENUE_DECLINE_MIN_HISTORY_MONTHS) {
    const sorted = [...model.monthlyRollups].sort((a, b) => a.month.localeCompare(b.month));
    const trailing = sorted.slice(-3);
    const prior = sorted.slice(-6, -3);

    const trailingAvg = average(trailing.map(r => r.revenue));
    const priorAvg = average(prior.map(r => r.revenue));

    if (priorAvg > 0 && trailingAvg < priorAvg) {
      const declineRate = (priorAvg - trailingAvg) / priorAvg;

      if (declineRate > REVENUE_DECLINE_CRITICAL_THRESHOLD) {
        signals.push({
          type: 'revenue_decline',
          severity: 'critical',
          weight: REVENUE_DECLINE_CRITICAL_WEIGHT,
          metricValue: trailingAvg,
          targetValue: priorAvg,
          recommendedAction: 'Revenue has dropped significantly — identify which income streams declined most.',
        });
      } else if (declineRate > REVENUE_DECLINE_WARNING_THRESHOLD) {
        signals.push({
          type: 'revenue_decline',
          severity: 'warning',
          weight: REVENUE_DECLINE_WARNING_WEIGHT,
          metricValue: trailingAvg,
          targetValue: priorAvg,
          recommendedAction: 'Revenue is softening — review membership count and renewal rate.',
        });
      }
    }
  }

  // ── 5. Owner distributions above pace ────────────────────────────────────────
  // completeMonths is already computed above; reuse it.
  if (completeMonths.length >= OWNER_DIST_MIN_HISTORY_MONTHS) {
    const currentWindow = completeMonths.slice(-3);          // most recent 3 complete months
    const priorWindow = completeMonths.slice(-15, -3);       // 12 months immediately before

    const distByMonth = new Map<string, number>();
    for (const txn of txns) {
      if (classifyTxn(txn) !== 'owner-distribution') continue;
      distByMonth.set(txn.month, (distByMonth.get(txn.month) ?? 0) + txn.amount);
    }

    const currentTotal = currentWindow.reduce((sum, m) => sum + (distByMonth.get(m) ?? 0), 0);
    const currentAnnualizedPace = (currentTotal / 3) * 12;

    const priorBaseline = priorWindow.reduce((sum, m) => sum + (distByMonth.get(m) ?? 0), 0);

    if (priorBaseline > 0 && currentAnnualizedPace > OWNER_DIST_PACE_THRESHOLD * priorBaseline) {
      signals.push({
        type: 'owner_distributions_high',
        severity: 'warning',
        weight: OWNER_DIST_WEIGHT,
        metricValue: currentAnnualizedPace,
        targetValue: priorBaseline,
        recommendedAction: 'Your draw pace is running ahead of last year — confirm cash reserves can support it.',
      });
    }
  }

  // ── 6. Steady state ──────────────────────────────────────────────────────────
  if (signals.length === 0) {
    signals.push({
      type: 'steady_state',
      severity: 'healthy',
      weight: 0,
    });
  }

  return signals;
}
