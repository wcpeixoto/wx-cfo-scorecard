import type { CashFlowMode, Txn, TxnType } from './data/contract';

// ─── Normalization helpers ──────────────────────────────────────────────────

function normalizeCategory(category: string): string {
  return category
    .toLowerCase()
    .replace(/[^a-z0-9: ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parentCategoryName(category: string): string {
  const separatorIndex = category.indexOf(':');
  if (separatorIndex === -1) return category.trim();
  const parent = category.slice(0, separatorIndex).trim();
  return parent || category.trim();
}

// ─── TxnType (sign-based, used at import time) ─────────────────────────────

export function classifyType(rawAmount: number): TxnType {
  return rawAmount >= 0 ? 'income' : 'expense';
}

// ─── Transaction classification ─────────────────────────────────────────────
//
// Every transaction falls into exactly one classification:
//   revenue            – real business income (positive Business Income, excluding refunds)
//   expense            – operating expense categories
//   transfer           – money movement between accounts (excluded from profitability)
//   loan               – financing / debt activity (excluded from profitability)
//   owner-distribution – equity draws (below-the-line in operating mode)
//   uncategorized      – unclassified transactions (excluded from profitability)

export type TxnClassification =
  | 'revenue'
  | 'expense'
  | 'transfer'
  | 'loan'
  | 'owner-distribution'
  | 'uncategorized';

// ─── Category-level classifiers ─────────────────────────────────────────────

const CAPITAL_DISTRIBUTION_SEGMENTS = new Set([
  'capital distribution',
  'owner distribution',
  'owner distributions',
  'owner s distribution',
  'owner s distributions',
]);

export function isCapitalDistributionCategory(category: string): boolean {
  const normalized = normalizeCategory(category);
  if (!normalized) return false;

  if (CAPITAL_DISTRIBUTION_SEGMENTS.has(normalized)) return true;

  return normalized
    .split(':')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .some((segment) => CAPITAL_DISTRIBUTION_SEGMENTS.has(segment));
}

export function isTransferCategory(category: string): boolean {
  return parentCategoryName(category).toLowerCase() === 'transfer';
}

export function isLoanCategory(category: string): boolean {
  return parentCategoryName(category).toLowerCase() === 'loan';
}

export function isBusinessIncomeCategory(category: string): boolean {
  return parentCategoryName(category).toLowerCase() === 'business income';
}

export function isUncategorizedCategory(category: string): boolean {
  const normalized = category.trim().toLowerCase();
  return normalized.length === 0 || normalized === 'uncategorized';
}

export function isRefundCategory(category: string): boolean {
  const normalized = category.trim().toLowerCase();
  return normalized.startsWith('refund') || normalized.includes('allowance');
}

// ─── Account-level classifiers ──────────────────────────────────────────────

export function accountLooksLikeLoan(account?: string): boolean {
  return /\bloan\b/i.test(account ?? '');
}

// ─── Transaction-level classifiers ──────────────────────────────────────────

export function isTransferTxn(txn: Txn): boolean {
  return Boolean(txn.transferAccount?.trim()) || isTransferCategory(txn.category);
}

export function isFinancingTxn(txn: Txn): boolean {
  return isLoanCategory(txn.category) || accountLooksLikeLoan(txn.account);
}

/** Returns true for transactions that should be excluded from profitability
 *  calculations: transfers, loans/financing, and uncategorized. */
export function shouldExcludeFromProfitability(txn: Txn): boolean {
  return isTransferTxn(txn) || isFinancingTxn(txn) || isUncategorizedCategory(txn.category);
}

// ─── Canonical classification ───────────────────────────────────────────────

/** Classify a transaction into exactly one bucket.
 *  Order matters — transfer/loan/uncategorized are checked first (excluded from P&L),
 *  then owner-distribution, then revenue vs expense. */
export function classifyTxn(txn: Txn): TxnClassification {
  if (isTransferTxn(txn)) return 'transfer';
  if (isFinancingTxn(txn)) return 'loan';
  if (isUncategorizedCategory(txn.category)) return 'uncategorized';
  if (isCapitalDistributionCategory(txn.category)) return 'owner-distribution';
  if (isBusinessIncomeCategory(txn.category) && !isRefundCategory(txn.category) && txn.rawAmount > 0) return 'revenue';
  return 'expense';
}

// ─── Cash flow mode filtering ───────────────────────────────────────────────

export function includeExpenseCategoryForCashFlowMode(
  category: string,
  cashFlowMode: CashFlowMode
): boolean {
  return cashFlowMode === 'total' || !isCapitalDistributionCategory(category);
}

// ─── Contribution helpers (used by rollup and slice calculations) ───────────

/** Revenue contribution for a transaction. Returns positive amount or 0. */
export function revenueContribution(txn: Txn): number {
  if (shouldExcludeFromProfitability(txn)) return 0;
  if (!isBusinessIncomeCategory(txn.category)) return 0;
  if (isRefundCategory(txn.category)) return 0;
  return txn.rawAmount > 0 ? txn.amount : 0;
}

/** Expense contribution for a transaction (positive = cost, negative = credit).
 *  Returns 0 for excluded transactions. */
export function expenseContribution(txn: Txn, cashFlowMode: CashFlowMode): number {
  if (shouldExcludeFromProfitability(txn)) return 0;
  if (!includeExpenseCategoryForCashFlowMode(txn.category, cashFlowMode)) return 0;
  if (isBusinessIncomeCategory(txn.category)) return 0;
  if (txn.rawAmount < 0) return txn.amount;
  if (txn.rawAmount > 0) return -txn.amount;
  return 0;
}

/** Returns true when an expense category should be included in Dig Here analysis.
 *  Always excludes owner distributions and transfers regardless of cash flow mode. */
export function includeExpenseForDigHere(category: string, cashFlowMode: CashFlowMode): boolean {
  if (!includeExpenseCategoryForCashFlowMode(category, cashFlowMode)) return false;
  if (isCapitalDistributionCategory(category)) return false;
  if (isTransferCategory(category)) return false;
  return true;
}
