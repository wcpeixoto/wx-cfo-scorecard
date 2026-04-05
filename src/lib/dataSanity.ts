import type { CashFlowMode, MonthlyRollup, Txn } from './data/contract';
import {
  classifyTxn,
  expenseContribution,
  isTransferTxn,
  isFinancingTxn,
  revenueContribution,
  shouldExcludeFromProfitability,
} from './cashFlow';

// ─── Types ──────────────────────────────────────────────────────────────────

export type SanityCheckSeverity = 'error' | 'warning';

export type SanityCheck = {
  id: string;
  label: string;
  severity: SanityCheckSeverity;
  passed: boolean;
  message: string;
  detail?: string;
};

export type SanityReport = {
  checks: SanityCheck[];
  passCount: number;
  failCount: number;
  verdict: 'OK' | 'FAIL';
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const EPSILON = 0.005;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ─── Tier 1 checks ─────────────────────────────────────────────────────────

/** Verify no transfer or loan transactions leak into profitability rollups. */
function checkTransferLeakage(txns: Txn[], cashFlowMode: CashFlowMode): SanityCheck {
  const leaks: string[] = [];
  for (const txn of txns) {
    if (!isTransferTxn(txn) && !isFinancingTxn(txn)) continue;
    const rev = revenueContribution(txn);
    const exp = expenseContribution(txn, cashFlowMode);
    if (Math.abs(rev) > EPSILON || Math.abs(exp) > EPSILON) {
      leaks.push(`${txn.date} ${txn.category} (${txn.payee ?? 'no payee'}): rev=${rev}, exp=${exp}`);
    }
  }
  return {
    id: 'transfer-leakage',
    label: 'No transfers/loans in profitability',
    severity: 'error',
    passed: leaks.length === 0,
    message: leaks.length === 0
      ? 'No transfer or loan transactions leak into revenue/expense calculations.'
      : `${leaks.length} transfer/loan txn(s) are leaking into profitability.`,
    detail: leaks.length > 0 ? leaks.slice(0, 10).join('\n') : undefined,
  };
}

/** Verify classifyTxn() agrees with revenueContribution/expenseContribution. */
function checkClassificationConsistency(txns: Txn[], cashFlowMode: CashFlowMode): SanityCheck {
  const mismatches: string[] = [];
  for (const txn of txns) {
    const classification = classifyTxn(txn);
    const rev = revenueContribution(txn);
    const exp = expenseContribution(txn, cashFlowMode);
    const excluded = shouldExcludeFromProfitability(txn);

    if (classification === 'revenue' && Math.abs(rev) <= EPSILON) {
      mismatches.push(`${txn.date} ${txn.category}: classifyTxn=revenue but revenueContribution=0`);
    }
    if ((classification === 'transfer' || classification === 'loan' || classification === 'uncategorized') && !excluded) {
      mismatches.push(`${txn.date} ${txn.category}: classifyTxn=${classification} but shouldExcludeFromProfitability=false`);
    }
    if (excluded && (Math.abs(rev) > EPSILON || Math.abs(exp) > EPSILON)) {
      mismatches.push(`${txn.date} ${txn.category}: excluded from profitability but has contribution rev=${rev} exp=${exp}`);
    }
  }
  return {
    id: 'classification-consistency',
    label: 'classifyTxn agrees with contribution helpers',
    severity: 'error',
    passed: mismatches.length === 0,
    message: mismatches.length === 0
      ? 'classifyTxn() and contribution helpers are fully consistent.'
      : `${mismatches.length} inconsistency(ies) between classifyTxn and contribution helpers.`,
    detail: mismatches.length > 0 ? mismatches.slice(0, 10).join('\n') : undefined,
  };
}

/** Verify revenue − expenses ≈ netCashFlow for each monthly rollup. */
function checkAccountingIdentity(rollups: MonthlyRollup[]): SanityCheck {
  const violations: string[] = [];
  for (const rollup of rollups) {
    const expected = round2(rollup.revenue - rollup.expenses);
    const actual = rollup.netCashFlow;
    if (Math.abs(expected - actual) > EPSILON) {
      violations.push(`${rollup.month}: revenue(${rollup.revenue}) - expenses(${rollup.expenses}) = ${expected}, but netCashFlow = ${actual}`);
    }
  }
  return {
    id: 'accounting-identity',
    label: 'Revenue − Expenses = Net Cash Flow',
    severity: 'error',
    passed: violations.length === 0,
    message: violations.length === 0
      ? `All ${rollups.length} months pass the accounting identity.`
      : `${violations.length} month(s) violate revenue − expenses = net.`,
    detail: violations.length > 0 ? violations.join('\n') : undefined,
  };
}

// ─── Main entry point ───────────────────────────────────────────────────────

export function runDataSanityChecks(
  txns: Txn[],
  rollups: MonthlyRollup[],
  cashFlowMode: CashFlowMode = 'operating'
): SanityReport {
  const checks: SanityCheck[] = [
    checkTransferLeakage(txns, cashFlowMode),
    checkClassificationConsistency(txns, cashFlowMode),
    checkAccountingIdentity(rollups),
  ];

  const passCount = checks.filter((c) => c.passed).length;
  const failCount = checks.filter((c) => !c.passed).length;

  return {
    checks,
    passCount,
    failCount,
    verdict: failCount > 0 ? 'FAIL' : 'OK',
  };
}
