// categoryResolution.ts
//
// Single shared answer to "what is the effective bucket for category X?".
//
// Slice 1 (this module): Tier-1 reserved → categoryRegistry → unclassified.
// Slice 2 (future): a persisted override layer slots between Tier-1 and the
// registry, and bucket consumers (efficiencyOpportunities, digHere) migrate
// onto this resolver so overrides apply everywhere at once. The unclassified
// detector consumes ONLY this module — its zero-count guarantee stays
// meaningful after overrides ship.
//
// Scope: CATEGORY-level classification only. Txn-level concerns (transfer
// accounts, refund netting against Business Income, amount sign) stay in
// cashFlow.ts classifyTxn — this module never overrides those.

import type { Txn } from './contract';
import {
  isBusinessIncomeCategory,
  isCapitalDistributionCategory,
  isLoanCategory,
  isTransferCategory,
  parentCategoryName,
} from '../cashFlow';
import { getCategoryMeta, type CategoryBucket } from './categoryRegistry';

export type EffectiveBucket = CategoryBucket | 'unclassified';

// Slice 2 adds 'override'.
export type CategoryResolutionSource = 'tier1' | 'registry' | 'none';

export interface CategoryResolution {
  /** parentCategoryName() of the raw category — the registry's granularity. */
  parent: string;
  effective: EffectiveBucket;
  source: CategoryResolutionSource;
  /**
   * Tier-1 reserved (Transfer / Loan / Owner Distributions / Business Income,
   * including subtrees and normalized variants). Classification for these is
   * owned by locked cashFlow.ts code; Slice 2 must never let an override
   * apply to them.
   */
  reserved: boolean;
}

/**
 * Resolve one raw category string to its effective bucket.
 *
 * Tier-1 checks run against the RAW string (capital-distribution matching is
 * segment-based; the rest are parent-based) and mirror classifyTxn's
 * precedence order — transfer, loan, capital, income — so a pathological name
 * matching several reserved families resolves the same way the canonical
 * transaction classifier would treat it.
 */
export function resolveCategory(rawCategory: string): CategoryResolution {
  const parent = parentCategoryName(rawCategory);

  if (isTransferCategory(rawCategory)) {
    return { parent, effective: 'suppressed', source: 'tier1', reserved: true };
  }
  if (isLoanCategory(rawCategory)) {
    return { parent, effective: 'suppressed', source: 'tier1', reserved: true };
  }
  if (isCapitalDistributionCategory(rawCategory)) {
    return { parent, effective: 'capital', source: 'tier1', reserved: true };
  }
  if (isBusinessIncomeCategory(rawCategory)) {
    return { parent, effective: 'income', source: 'tier1', reserved: true };
  }

  const meta = getCategoryMeta(parent);
  if (meta) {
    return { parent, effective: meta.bucket, source: 'registry', reserved: false };
  }

  return { parent, effective: 'unclassified', source: 'none', reserved: false };
}

export interface UnclassifiedCategorySummary {
  /** Group key — parentCategoryName of the raw categories (blank → 'Uncategorized'). */
  parent: string;
  txnCount: number;
  /** Distinct raw category strings under this parent, sorted, for recognizability. */
  rawCategories: string[];
}

/**
 * Group a transaction set's unclassified categories at registry granularity
 * (parent) with transaction counts. Sorted by txnCount desc, then parent asc.
 * 'Uncategorized' (the blank-category import default) resolves unclassified on
 * purpose — blank categories in Quicken are owner-actionable.
 */
export function summarizeUnclassifiedCategories(
  txns: readonly Txn[]
): UnclassifiedCategorySummary[] {
  const countByRawCategory = new Map<string, number>();
  for (const txn of txns) {
    countByRawCategory.set(txn.category, (countByRawCategory.get(txn.category) ?? 0) + 1);
  }

  const groups = new Map<string, { txnCount: number; rawCategories: Set<string> }>();
  for (const [raw, count] of countByRawCategory) {
    const resolution = resolveCategory(raw);
    if (resolution.effective !== 'unclassified') continue;
    const key = resolution.parent || 'Uncategorized';
    let group = groups.get(key);
    if (!group) {
      group = { txnCount: 0, rawCategories: new Set() };
      groups.set(key, group);
    }
    group.txnCount += count;
    group.rawCategories.add(raw.trim() || 'Uncategorized');
  }

  return [...groups.entries()]
    .map(([parent, group]) => ({
      parent,
      txnCount: group.txnCount,
      rawCategories: [...group.rawCategories].sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => b.txnCount - a.txnCount || a.parent.localeCompare(b.parent));
}
