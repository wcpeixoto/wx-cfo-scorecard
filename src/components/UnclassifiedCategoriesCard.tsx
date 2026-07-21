// Settings → Data: "Unclassified categories" — read-only indicator listing imported
// categories the shared resolver can't classify (not Tier-1 reserved, no registry
// entry). Slice-1 scope guard: list + transaction counts ONLY — no classify actions.
// The classification page (Slice 2) adds actions on top of the SAME resolver, so a
// zero here stays meaningful after overrides ship.

import { useMemo } from 'react';

import { summarizeUnclassifiedCategories } from '../lib/data/categoryResolution';
import type { Txn } from '../lib/data/contract';

export function UnclassifiedCategoriesCard({ txns }: { txns: readonly Txn[] }) {
  const summaries = useMemo(() => summarizeUnclassifiedCategories(txns), [txns]);

  return (
    <div className="ta-card">
      <div className="ta-card-header">
        <h3 className="ta-card-title">Unclassified categories</h3>
      </div>
      <div className="ta-card-body">
        {txns.length === 0 ? (
          <p className="subtle">No imported transactions yet — import a CSV to check category coverage.</p>
        ) : summaries.length === 0 ? (
          <p className="subtle">
            All imported categories are classified. Every transaction&rsquo;s category is covered by a
            classification rule.
          </p>
        ) : (
          <>
            <p className="subtle">
              These imported categories have no classification yet, so signal cards fall back to
              default rules for them. Classifying them keeps every dashboard number trustworthy.
            </p>
            <ul className="unclassified-category-list">
              {summaries.map((summary) => (
                <li key={summary.parent}>
                  <strong>{summary.parent}</strong> ·{' '}
                  {summary.txnCount === 1 ? '1 transaction' : `${summary.txnCount} transactions`}
                  {(summary.rawCategories.length > 1 ||
                    summary.rawCategories[0] !== summary.parent) && (
                    <span className="unclassified-category-raw">
                      {' '}
                      ({summary.rawCategories.join(', ')})
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
