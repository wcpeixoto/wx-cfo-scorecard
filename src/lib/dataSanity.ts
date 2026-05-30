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

// ─── Wodify (Stripe gross-up) reconciliation ────────────────────────────────

const WODIFY_TOLERANCE = 0.01;

function normalizeAccountName(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Lower-case + replace Unicode dash variants (en-dash U+2013, em-dash U+2014,
// minus sign U+2212) with ASCII hyphen so the canonical Wodify payees
// "Processor Gross-Up – Fees" / "Processor Gross-Up – Refunds" (which use
// U+2013) match the classifier substrings.
function normalizeWodifyText(value: string | undefined): string {
  return (value ?? '').toLowerCase().replace(/[–—−]/g, '-');
}

function isoMonthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  // Day 0 of next month = last day of this month (UTC-stable).
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Verify Wodify (Stripe gross-up) revenue and outflow sides reconcile per
 *  closed month. Two-sided check — abs'ing each outflow component separately
 *  exposes a sign error inside one category that |sum| would mask. */
function checkWodifyGrossUpReconciliation(txns: Txn[]): SanityCheck {
  const wodifyTxns = txns.filter((t) => normalizeAccountName(t.account) === 'wodify');

  // Closed-month detection is Wodify-independent: derived from the latest
  // date across all accounts. A month is closed iff maxDate > monthEnd(M).
  let maxDate = '';
  for (const t of txns) {
    if (t.date && t.date > maxDate) maxDate = t.date;
  }

  // First Wodify activity month gates the "missing gross-up" warning so
  // historical pre-Wodify months never warn.
  let firstWodifyMonth = '';
  for (const t of wodifyTxns) {
    if (t.month && (firstWodifyMonth === '' || t.month < firstWodifyMonth)) {
      firstWodifyMonth = t.month;
    }
  }

  type Bucket = {
    grossUpFees: number;
    grossUpRefunds: number;
    merchantFees: number;
    customerRefunds: number;
    grossUpFeesCount: number;
    grossUpRefundsCount: number;
  };
  const buckets = new Map<string, Bucket>();
  for (const t of wodifyTxns) {
    if (!t.month) continue;
    let b = buckets.get(t.month);
    if (!b) {
      b = {
        grossUpFees: 0,
        grossUpRefunds: 0,
        merchantFees: 0,
        customerRefunds: 0,
        grossUpFeesCount: 0,
        grossUpRefundsCount: 0,
      };
      buckets.set(t.month, b);
    }
    if (t.category === 'Business Income:Sales') {
      const blob = `${normalizeWodifyText(t.payee)} ${normalizeWodifyText(t.memo)}`;
      const hasGU = blob.includes('gross-up');
      if (hasGU && blob.includes('fee')) {
        b.grossUpFees += t.rawAmount;
        b.grossUpFeesCount += 1;
      } else if (hasGU && blob.includes('refund')) {
        b.grossUpRefunds += t.rawAmount;
        b.grossUpRefundsCount += 1;
      }
    } else if (t.category === 'Merchant Fees') {
      b.merchantFees += t.rawAmount;
    } else if (t.category === 'Customer Refunds') {
      b.customerRefunds += t.rawAmount;
    }
  }

  const monthSet = new Set<string>();
  for (const t of txns) if (t.month) monthSet.add(t.month);
  const months = [...monthSet].sort();

  const warnings: string[] = [];
  for (const month of months) {
    const isClosed = maxDate > isoMonthEnd(month);
    if (!isClosed) continue; // Open month never warns solely for missing rows.

    const b = buckets.get(month);
    const hasGrossUpRows = !!b && (b.grossUpFeesCount > 0 || b.grossUpRefundsCount > 0);

    if (hasGrossUpRows && b) {
      const revenueSide = b.grossUpFees + b.grossUpRefunds;
      // Abs each outflow component separately — combining first would hide a
      // sign error inside one category by letting it cancel against the other.
      const outflowSide = Math.abs(b.merchantFees) + Math.abs(b.customerRefunds);
      const diff = revenueSide - outflowSide;
      const balanced = Math.abs(diff) <= WODIFY_TOLERANCE;
      const revPositive = revenueSide > WODIFY_TOLERANCE;
      const outPositive = outflowSide > WODIFY_TOLERANCE;
      if (!balanced || !revPositive || !outPositive) {
        warnings.push(
          `${month}: Wodify sides do not reconcile. ` +
          `grossUpFees=${b.grossUpFees.toFixed(2)}, ` +
          `grossUpRefunds=${b.grossUpRefunds.toFixed(2)}, ` +
          `merchantFees=${b.merchantFees.toFixed(2)}, ` +
          `customerRefunds=${b.customerRefunds.toFixed(2)}, ` +
          `revenueSide=${revenueSide.toFixed(2)}, ` +
          `outflowSide=${outflowSide.toFixed(2)}, ` +
          `diff=${diff.toFixed(2)}`
        );
      }
    } else if (firstWodifyMonth !== '' && month >= firstWodifyMonth) {
      warnings.push(`${month}: closed month missing month-end Wodify gross-up.`);
    }
    // else: closed month strictly before first Wodify activity → silent.
  }

  // TODO(double-counting): no concrete invariant has been defined for
  // comparing direct Stripe/Wodify bank-deposit rows against gross-up
  // revenue, so leave this off. Parked until the relationship is specified;
  // a vague heuristic does not belong in a precision guardrail.

  return {
    id: 'wodify-gross-up-reconciliation',
    label: 'Wodify Stripe gross-up reconciles per closed month',
    severity: 'warning',
    passed: warnings.length === 0,
    message: warnings.length === 0
      ? 'All closed months with Wodify activity reconcile within $0.01.'
      : `${warnings.length} Wodify gross-up issue(s) in closed months.`,
    detail: warnings.length > 0 ? warnings.slice(0, 10).join('\n') : undefined,
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
    checkWodifyGrossUpReconciliation(txns),
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
