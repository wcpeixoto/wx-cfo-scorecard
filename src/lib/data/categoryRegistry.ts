/**
 * categoryRegistry.ts
 *
 * Single source of truth for expense category classification.
 *
 * Every category name is an exact match against parentCategoryName() output
 * from cashFlow.ts — case-sensitive, no normalization applied here.
 *
 * Buckets:
 *   fixed      — dollar comparison: spend vs 6-month avg spend
 *   variable   — ratio comparison: spend/revenue vs 6-month avg ratio
 *   suppressed — excluded from all operating compute
 *   income     — revenue categories
 *   capital    — owner distributions and equity movements
 *
 * ⚠️  Discrepancy note (April 2026):
 *   'Rent or Lease' is currently in SUPPRESSED_CATEGORIES inside
 *   efficiencyOpportunities.ts. This registry classifies it as 'fixed'
 *   per the V1 signal design spec. Resolve by migrating
 *   efficiencyOpportunities.ts to read from this registry (future phase).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CategoryBucket =
  | 'fixed'       // dollar comparison — spend vs 6-month avg spend
  | 'variable'    // ratio comparison — spend/revenue vs 6-month avg ratio
  | 'suppressed'  // excluded from all operating compute
  | 'income'      // revenue categories
  | 'capital';    // owner distributions and equity movements

export interface CategoryMeta {
  bucket: CategoryBucket;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const CATEGORY_REGISTRY: Record<string, CategoryMeta> = {

  // ── Income ────────────────────────────────────────────────────────────────

  'Business Income': {
    bucket: 'income',
  },

  // ── Capital ───────────────────────────────────────────────────────────────

  'Owner Distributions': {
    bucket: 'capital',
  },

  // ── Suppressed ────────────────────────────────────────────────────────────

  'Taxes and Licenses': {
    bucket: 'suppressed',
    notes: 'regulatory, not operational',
  },
  'Depreciation': {
    bucket: 'suppressed',
    notes: 'non-cash',
  },
  'Amortization': {
    bucket: 'suppressed',
    notes: 'non-cash, future-proof',
  },
  'Interest Paid': {
    bucket: 'suppressed',
    notes: 'debt service',
  },
  'Loan': {
    bucket: 'suppressed',
    notes: 'debt service',
  },
  'Transfer': {
    bucket: 'suppressed',
    notes: 'net to zero, double-count risk',
  },
  'Misc. Expense': {
    bucket: 'suppressed',
    notes: 'too noisy for V1 signals',
  },

  // ── Fixed ─────────────────────────────────────────────────────────────────

  'Payroll': {
    bucket: 'fixed',
    notes: 'staffing cost, does not scale with revenue',
  },
  'Rent or Lease': {
    bucket: 'fixed',
    notes: 'fixed commitment',
  },
  'Utilities': {
    bucket: 'fixed',
    notes: 'semi-fixed, minor seasonal variation',
  },
  'Bank Service Charges': {
    bucket: 'fixed',
    notes: 'recurring fees, not revenue-linked',
  },
  'Software Subscriptions': {
    bucket: 'fixed',
    notes: 'recurring SaaS, not revenue-linked',
  },
  'Legal, Accounting & Prof. Services': {
    bucket: 'fixed',
    notes: 'recurring advisory fees; watch for one-time spikes',
  },
  'Cleaning': {
    bucket: 'fixed',
    notes: 'recurring service contract',
  },
  'Repairs and Maintenance': {
    bucket: 'fixed',
    notes: 'irregular but not revenue-linked',
  },
  'Office Expenses': {
    bucket: 'fixed',
    notes: 'semi-fixed overhead',
  },
  'Insurance': {
    bucket: 'fixed',
    notes: 'monthly premium, does not scale with revenue',
  },
  'Training & Education': {
    bucket: 'fixed',
    notes: 'irregular but not revenue-linked — certifications and instructor courses',
  },
  'Events & Community': {
    bucket: 'fixed',
    notes: 'episodic community spend — not revenue-driven',
  },

  // ── Variable ──────────────────────────────────────────────────────────────

  'Marketing': {
    bucket: 'variable',
    notes: 'should scale with revenue',
  },
  'COGS': {
    bucket: 'variable',
    notes: 'directly revenue-linked',
  },
  'Refunds & Allowances': {
    bucket: 'variable',
    notes: 'signal for lead quality and billing clarity',
  },
  'Merchant Fees': {
    bucket: 'variable',
    notes: 'scales directly with revenue',
  },
};

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Returns all category names assigned to a given bucket.
 */
export function getCategoriesByBucket(bucket: CategoryBucket): string[] {
  return Object.entries(CATEGORY_REGISTRY)
    .filter(([, meta]) => meta.bucket === bucket)
    .map(([name]) => name);
}

/**
 * Returns the bucket for a category name.
 * Returns 'unclassified' if not found and logs a warning.
 * The calling compute function decides its own fallback policy.
 */
export function getCategoryBucket(
  categoryName: string
): CategoryBucket | 'unclassified' {
  const meta = CATEGORY_REGISTRY[categoryName];
  if (!meta) {
    console.warn(
      `[categoryRegistry] Unclassified category: "${categoryName}". ` +
      `Add it to categoryRegistry.ts and choose a bucket.`
    );
    return 'unclassified';
  }
  return meta.bucket;
}

/**
 * Returns true if a category should be excluded from operating compute
 * (suppressed, income, or capital).
 */
export function isExcludedFromOperating(categoryName: string): boolean {
  const bucket = getCategoryBucket(categoryName);
  return bucket === 'suppressed'
    || bucket === 'income'
    || bucket === 'capital';
}

/**
 * Returns the full metadata for a category, or undefined if not found.
 * Caller decides how to handle missing entries.
 */
export function getCategoryMeta(categoryName: string): CategoryMeta | undefined {
  return CATEGORY_REGISTRY[categoryName];
}
