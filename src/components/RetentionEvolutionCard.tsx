// Class Plan Member Churn/Retention — gym-wide churn-evolution chart (Retention page, Patterns
// section). Reads the live "Member Retention Rates" monthly aggregate from Supabase; falls back to a
// synthetic sample fixture until the table is seeded. GYM-WIDE only — the per-cohort split lives in
// the sibling MembersByAgeGroupCard (composition only; a segmented retention TREND is still the
// gated client-grain + DOB-join slice). The two render side by side via .retention-split.

import { useEffect, useMemo, useState } from 'react';

import PeriodDropdown from './PeriodDropdown';
import RetentionEvolutionChart from './RetentionEvolutionChart';
import { fetchMemberRetentionRates } from '../lib/gym/fetchMemberRetentionRates';
import {
  fetchMemberRetentionByCohort,
  type CohortRetentionRow,
} from '../lib/gym/fetchMemberRetentionByCohort';
import { buildCohortOverlay } from '../lib/gym/memberRetentionCohortSeries';
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

// Segment view — All (gym-wide line only, default) vs By age (All + Youth + Adults overlay).
type RetentionSegment = 'all' | 'byAge';

const TIMEFRAME_DROPDOWN_OPTIONS = RETENTION_TIMEFRAME_OPTIONS.map((o) => ({
  value: o.value,
  label: o.label,
}));

export function RetentionEvolutionCard() {
  const [live, setLive] = useState<RetentionMonth[] | null>(null);
  const [cohortRows, setCohortRows] = useState<CohortRetentionRow[] | null>(null);
  const [timeframe, setTimeframe] = useState<RetentionTimeframeId>(DEFAULT_RETENTION_TIMEFRAME);
  // Churn is the default view; the toggle flips to retention (its complement).
  const [metric, setMetric] = useState<RetentionMetric>('churn');
  // Segment view defaults to All (gym-wide line only) — current behavior.
  const [segment, setSegment] = useState<RetentionSegment>('all');
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

  // Age-cohort overlay source — a SEPARATE anon table. Only ever used to overlay onto a LIVE All
  // axis (see the guard below); never summed to derive All, never mixed with the sample fixture.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    fetchMemberRetentionByCohort(controller.signal)
      .then((rows) => {
        if (!cancelled && rows && rows.length > 0) setCohortRows(rows);
      })
      .catch(() => {
        // unconfigured / unreachable / empty → no overlay; the All line is unaffected.
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

  // LIVE-DATA GUARD: the By-age overlay may render ONLY when the All axis is live #495 data AND the
  // cohort fetch succeeded. Never project live cohort rows onto the sample fixture's axis.
  const cohortAvailable = isLive && cohortRows !== null;
  const byAge = cohortAvailable && segment === 'byAge';

  // Project the cohort points onto the live All axis (view.points carries the seed-exclusion +
  // timeframe window). null slots are gaps; the chart breaks the line at them.
  const overlay = useMemo(() => {
    if (!byAge || !cohortRows) return null;
    return buildCohortOverlay(
      view.points.map((p) => p.periodMonth),
      cohortRows,
    );
  }, [byAge, cohortRows, view.points]);

  // Headline stat: the mean of the visible metric across the selected timeframe — so the subtitle
  // reads e.g. "Average Churn 8%" and tracks both the toggle and the timeframe. Stays the gym-wide
  // All average even under By age (never recomputed per segment).
  const metricLabel = metric === 'churn' ? 'Churn' : 'Retention';
  const avgPct = useMemo(() => averageMetricPct(view.points, metric), [view.points, metric]);
  const avgLabel = avgPct != null ? `${Math.round(avgPct)}%` : '—';

  return (
    <article className="card gym-card gym-card--full retention-evolution-card">
      <header className="gym-card-head retention-evolution-head">
        <div className="retention-evolution-heading">
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
            {/* No "Live" pill — owner asked to drop it. The "Sample data" flag stays so
                fixture/unseeded states are never mistaken for real numbers (dev-only;
                never shows in the live view). */}
            {!isLive && <span className="gym-sample-badge">Sample data</span>}
          </div>
          <p className="gym-card-subtitle">
            Average {metricLabel} {avgLabel}
          </p>
        </div>
        <div className="retention-evolution-controls">
          {/* Segment toggle shows only when an overlay is possible (live All axis + cohort data);
              when on the sample fixture it stays hidden so the card is unchanged. */}
          {cohortAvailable && (
            <div className="segmented-toggle" role="group" aria-label="Gym-wide or by age">
              <button
                type="button"
                className={`segmented-toggle-btn${segment === 'all' ? ' is-active' : ''}`}
                onClick={() => setSegment('all')}
              >
                All
              </button>
              <button
                type="button"
                className={`segmented-toggle-btn${segment === 'byAge' ? ' is-active' : ''}`}
                onClick={() => setSegment('byAge')}
              >
                By age
              </button>
            </div>
          )}
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
      </header>

      <div className="retention-evolution-body">
        {view.isEmpty || !view.dataBeginsMonth ? (
          <p className="retention-evolution-empty">No tracked retention history in this range yet.</p>
        ) : (
          <>
            <RetentionEvolutionChart
              points={view.points}
              metric={metric}
              youth={overlay?.youth}
              adults={overlay?.adults}
            />
            <p className="retention-evolution-caption">
              {view.windowExceedsData
                ? `Requested window exceeds tracked history — showing all available data. Membership tracking began ${formatMonthLong(view.dataBeginsMonth)}; earlier months aren't tracked and are never fabricated.`
                : `Membership tracking began ${formatMonthLong(view.dataBeginsMonth)}.`}
            </p>
            {byAge && (
              <ul className="retention-evolution-footnote">
                <li>Unknown-age members are excluded from Youth and Adults, but counted in All.</li>
                <li>
                  Aggregate monthly cohort counts only. No member names, IDs, DOBs, exact ages, or
                  individual records are stored or shown.
                </li>
              </ul>
            )}
          </>
        )}
      </div>
    </article>
  );
}
