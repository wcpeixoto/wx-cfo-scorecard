// Active members by age group — the cohort-composition card (Retention page, Patterns section).
// Reads the live per-cohort ACTIVE counts from the retention aggregate's cohort_histogram
// (counts only — non-PII) and shows each age band's share of active members in the TailAdmin
// "Traffic Source" style. Falls back to the synthetic sample histogram (the same source the
// Retention-by-Age-Group card uses) until the snapshot carries cohorts. This is the current
// cohort MAKEUP today — NOT per-cohort retention over time (that needs the gated client-grain
// DOB-join slice). Paired beside the Churn chart card via .retention-split.

import { useMemo } from 'react';

import { chartTokens } from '../lib/ui/chartTokens';
import { COHORT_BANDS, UNKNOWN_COHORT_ID } from '../lib/gym/cohortBands';
import { SAMPLE_COHORT_HISTOGRAM } from '../lib/gym/churnRiskByCohort';
import { cohortActiveTotals } from '../lib/gym/wodifyRetentionAggregate';
import type { RetentionAggregateSnapshot } from '../lib/gym/fetchRetentionAggregate';

export function MembersByAgeGroupCard({ snapshot }: { snapshot: RetentionAggregateSnapshot | null }) {
  const cohortHistogram = snapshot?.cohorts ?? SAMPLE_COHORT_HISTOGRAM;
  const hasLiveCohorts = Boolean(snapshot?.cohorts);

  const segments = useMemo(() => {
    const active = cohortActiveTotals(cohortHistogram);
    const rows = COHORT_BANDS.map((band) => ({
      id: band.id,
      label: band.label,
      count: active[band.id] ?? 0,
    }));
    const unknownCount = active[UNKNOWN_COHORT_ID] ?? 0;
    if (unknownCount > 0) {
      rows.push({ id: UNKNOWN_COHORT_ID, label: 'Unknown age', count: unknownCount });
    }
    const total = rows.reduce((sum, row) => sum + row.count, 0);
    return rows.map((row) => ({ ...row, pct: total > 0 ? (row.count / total) * 100 : 0 }));
  }, [cohortHistogram]);
  const segmentsTotal = segments.reduce((sum, row) => sum + row.count, 0);

  return (
    <article className="card gym-card members-by-age-card">
      <header className="gym-card-head">
        <h3 className="gym-card-title">Active members by age group</h3>
        <p className="gym-card-subtitle">
          {hasLiveCohorts ? 'Share of active members today.' : 'Sample distribution.'}
        </p>
      </header>

      <div className="members-by-age-body">
        {segmentsTotal === 0 ? (
          <p className="members-by-age-empty">No active members to break down.</p>
        ) : (
          <ul className="members-by-age-list">
            {segments.map((segment) => (
              <li key={segment.id} className="members-by-age-row">
                <div className="members-by-age-meta">
                  <span className="members-by-age-label">{segment.label}</span>
                  <span className="members-by-age-value">
                    {segment.count.toLocaleString('en-US')} · {Math.round(segment.pct)}%
                  </span>
                </div>
                <div className="members-by-age-bar">
                  <div
                    className="members-by-age-bar-fill"
                    style={{ width: `${segment.pct}%`, background: chartTokens.brand }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}
