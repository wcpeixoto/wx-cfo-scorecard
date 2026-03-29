import type { CashFlowMode } from './data/contract';

export function normalizeCategory(category: string): string {
  return category
    .toLowerCase()
    .replace(/[^a-z0-9: ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isCapitalDistributionCategory(category: string): boolean {
  const normalized = normalizeCategory(category);
  if (!normalized) return false;
  if (normalized === 'capital distribution') return true;

  const segments = normalized.split(':').map((segment) => segment.trim()).filter(Boolean);
  return segments.some((segment) => segment === 'capital distribution');
}

export function includeExpenseCategoryForCashFlowMode(category: string, cashFlowMode: CashFlowMode): boolean {
  return cashFlowMode === 'total' || !isCapitalDistributionCategory(category);
}
