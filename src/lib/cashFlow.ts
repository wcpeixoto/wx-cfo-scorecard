import type { CashFlowMode } from './data/contract';

function normalizeCategory(category: string): string {
  return category
    .toLowerCase()
    .replace(/[^a-z0-9: ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const CAPITAL_DISTRIBUTION_SEGMENTS = new Set([
  'capital distribution',
  'owner distributions',
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

export function includeExpenseCategoryForCashFlowMode(
  category: string,
  cashFlowMode: CashFlowMode
): boolean {
  return cashFlowMode === 'total' || !isCapitalDistributionCategory(category);
}
