// Class Plan Member Retention — gym-wide churn-evolution chart (Retention page, Patterns section).
// Reads the live "Member Retention Rates" monthly aggregate from Supabase; falls back to a synthetic
// sample fixture (with a "Sample data" badge) until the table is seeded. GYM-WIDE only — the
// kids/teens/adults segment toggle is a separate gated Phase 2 slice (needs client-grain + DOB join).

import { useEffect, useMemo, useState } from 'react';

import PeriodDropdown from './PeriodDropdown';
import RetentionEvolutionChart from './RetentionEvolutionChart';
import { fetchMemberRetentionRates } from '../lib/gym/fetchMemberRetentionRates';
import { SAMPLE_MEMBER_RETENTION_MONTHS } from '../lib/gym/memberRetentionFixture';
import {
  DEFAULT_RETENTION_TIMEFRAME,
  RETENTION_TIMEFRAME_OPTIONS,
  averageMetricPct,
  buildRetentionEvolutionView,
  formatMonthLong,
  formatMonthShort,
  realRetentionMonths,
  selectionFor,
  type RetentionMetric,
  type RetentionMonth,
  type RetentionTimeframeId,
} from '../lib/gym/memberRetentionSeries';
import { chartTokens } from '../lib/ui/chartTokens';
import { cohortActiveTotals } from '../lib/gym/wodifyRetentionAggregate';
import { COHORT_BANDS, UNKNOWN_COHORT_ID } from '../lib/gym/cohortBands';
import { SAMPLE_COHORT_HISTOGRAM } from '../lib/gym/churnRiskByCohort';
import type { RetentionAggregateSnapshot } from '../lib/gym/fetchRetentionAggregate';

const TIMEFRAME_DROPDOWN_OPTIONS = RETENTION_TIMEFRAME_OPTIONS.map((o) => ({
  value: o.value,
  label: o.label,
}));

export function RetentionEvolutionCard({ snapshot }: { snapshot: RetentionAggregateSnapshot | null }) {
  const [live, setLive] = useState<RetentionMonth[] | null>(null);
  const [timeframe, setTimeframe] = useState<RetentionTimeframeId>(DEFAULT_RETENTION_TIMEFRAME);
  // Churn is the default view; the toggle flips to retention (its complement).
  const [metric, setMetric] = useState<RetentionMetric>('churn');
  const [customStart, setCustomStart] = useState<string | null>(null);
  const [customEnd, setCustomEnd] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    fetchMemberRetentionRates(controller.signal)
      .then((rows) => {
        if (!cancelled && rows && rows.length > 0) setLive(rows);
      })
      .catch(() => {
        // unconfigured / unreachable / not-yet-seeded → stay on the sample fixture.
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  const months = live ?? SAMPLE_MEMBER_RETENTION_MONTHS;
  const isLive = live !== null;

  const realMonths = useMemo(() => realRetentionMonths(months), [months]);
  const monthOptions = useMemo(
    () => realMonths.map((m) => ({ value: m.periodMonth, label: formatMonthShort(m.periodMonth) })),
    [realMonths],
  );

  // Effective custom range — default to the full tracked span; always pass start ≤ end to the view.
  const firstMonth = realMonths[0]?.periodMonth ?? null;
  const lastMonth = realMonths[realMonths.length - 1]?.periodMonth ?? null;
  const startSel = customStart ?? firstMonth;
  const endSel = customEnd ?? lastMonth;

  const view = useMemo(() => {
    if (timeframe === 'custom' && startSel && endSel) {
      const lo = startSel <= endSel ? startSel : endSel;
      const hi = startSel <= endSel ? endSel : startSel;
      return buildRetentionEvolutionView(months, selectionFor('custom', { startMonth: lo, endMonth: hi }));
    }
    return buildRetentionEvolutionView(months, selectionFor(timeframe));
  }, [months, timeframe, startSel, endSel]);

  const asOf = isLive && view.points.length > 0 ? view.points[view.points.length - 1].periodMonth : null;

  // Headline stat: the mean of the visible metric across the selected timeframe — so the subtitle
  // reads e.g. "Average Churn 8%" and tracks both the toggle and the timeframe.
  const metricLabel = metric === 'churn' ? 'Churn' : 'Retention';
  const avgPct = useMemo(() => averageMetricPct(view.points, metric), [view.points, metric]);
  const avgLabel = avgPct != null ? `${Math.round(avgPct)}%` : '—';

  // Cohort composition rail (right 1/3): the per-age-group ACTIVE split from the
  // retention aggregate's cohort_histogram (counts only — non-PII), shown as a
  // share-of-active breakdown in the TailAdmin "Traffic Source" style. Falls back to
  // the synthetic sample histogram (the same source the Retention-by-Age-Group card
  // uses) until the snapshot carries cohorts. NOTE: this is the current cohort
  // MAKEUP today, not per-cohort retention over time — a segmented retention TREND
  // remains the gated client-grain DOB-join slice flagged in this file's header.
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
    <article className="card gym-card gym-card--full retention-evolution-card">
      <header className="gym-card-head">
        <div className="retention-evolution-titlerow">
          <h3 className="gym-card-title retention-evolution-title">
            {metricLabel}
            <span className="cashflow-help">
              <button
                type="button"
                className="cashflow-tooltip"
                aria-label={`${metricLabel} explanation`}
              >
                &#9432;
              </button>
              <div role="tooltip" className="cashflow-tooltip-panel retention-evolution-tooltip-panel">
                <ul className="cashflow-tooltip-list">
                  <li className="cashflow-tooltip-body">
                    Month-over-month <strong>membership / renewal</strong>{' '}
                    {metric === 'churn' ? 'churn' : 'retention'} from Wodify's "Member Retention Rates"
                    report: of the members active at the start of a month, the share{' '}
                    {metric === 'churn'
                      ? 'whose membership lapsed by month-end (the complement of retention).'
                      : 'still active at month-end.'}
                  </li>
                  <li className="cashflow-tooltip-body">
                    This is a different metric from the attendance-based Silent Churn and Attendance
                    Health cards, which measure who has stopped showing up — not whether their
                    membership renewed.
                  </li>
                </ul>
              </div>
            </span>
          </h3>
          {isLive && asOf ? (
            <span className="gym-sample-badge gym-live-badge">Live · through {formatMonthLong(asOf)}</span>
          ) : (
            <span className="gym-sample-badge">Sample data</span>
          )}
        </div>
        <p className="gym-card-subtitle">
          Average {metricLabel} {avgLabel}
        </p>
      </header>

      <div className="retention-evolution-body">
        <div className="retention-evolution-main">
          <div className="retention-evolution-controls">
            <div className="segmented-toggle" role="group" aria-label="Churn or retention">
              <button
                type="button"
                className={`segmented-toggle-btn${metric === 'churn' ? ' is-active' : ''}`}
                onClick={() => setMetric('churn')}
              >
                Churn
              </button>
              <button
                type="button"
                className={`segmented-toggle-btn${metric === 'retention' ? ' is-active' : ''}`}
                onClick={() => setMetric('retention')}
              >
                Retention
              </button>
            </div>
            <div className="retention-evolution-timeframe">
              <PeriodDropdown
                value={timeframe}
                options={TIMEFRAME_DROPDOWN_OPTIONS}
                onChange={(v) => setTimeframe(v as RetentionTimeframeId)}
              />
              {timeframe === 'custom' && monthOptions.length > 0 ? (
                <div className="retention-evolution-custom-range">
                  <PeriodDropdown
                    value={startSel ?? ''}
                    options={monthOptions}
                    onChange={(v) => setCustomStart(v)}
                  />
                  <span className="retention-evolution-range-sep">to</span>
                  <PeriodDropdown
                    value={endSel ?? ''}
                    options={monthOptions}
                    onChange={(v) => setCustomEnd(v)}
                  />
                </div>
              ) : null}
            </div>
          </div>

          {view.isEmpty || !view.dataBeginsMonth ? (
            <p className="retention-evolution-empty">No tracked retention history in this range yet.</p>
          ) : (
            <>
              <RetentionEvolutionChart points={view.points} metric={metric} />
              <p className="retention-evolution-caption">
                {view.windowExceedsData
                  ? `Requested window exceeds tracked history — showing all available data. Membership tracking began ${formatMonthLong(view.dataBeginsMonth)}; earlier months aren't tracked and are never fabricated.`
                  : `Membership tracking began ${formatMonthLong(view.dataBeginsMonth)}.`}
              </p>
            </>
          )}
        </div>

        <aside className="retention-evolution-segments" aria-label="Active members by age group">
          <div className="retention-evolution-segments-head">
            <h4 className="retention-evolution-segments-title">Active members by age group</h4>
            <p className="retention-evolution-segments-sub">
              {hasLiveCohorts ? 'Share of active members today.' : 'Sample distribution.'}
            </p>
          </div>
          {segmentsTotal === 0 ? (
            <p className="retention-evolution-segments-empty">No active members to break down.</p>
          ) : (
            <ul className="retention-evolution-segment-list">
              {segments.map((segment) => (
                <li key={segment.id} className="retention-evolution-segment">
                  <div className="retention-evolution-segment-meta">
                    <span className="retention-evolution-segment-label">{segment.label}</span>
                    <span className="retention-evolution-segment-value">
                      {segment.count.toLocaleString('en-US')} · {Math.round(segment.pct)}%
                    </span>
                  </div>
                  <div className="retention-evolution-segment-bar">
                    <div
                      className="retention-evolution-segment-bar-fill"
                      style={{ width: `${segment.pct}%`, background: chartTokens.brand }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </article>
  );
}
