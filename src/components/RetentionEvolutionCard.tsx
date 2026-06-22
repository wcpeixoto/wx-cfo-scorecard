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
  buildRetentionEvolutionView,
  formatMonthLong,
  formatMonthShort,
  realRetentionMonths,
  selectionFor,
  type RetentionMonth,
  type RetentionTimeframeId,
} from '../lib/gym/memberRetentionSeries';

const TIMEFRAME_DROPDOWN_OPTIONS = RETENTION_TIMEFRAME_OPTIONS.map((o) => ({
  value: o.value,
  label: o.label,
}));

export function RetentionEvolutionCard() {
  const [live, setLive] = useState<RetentionMonth[] | null>(null);
  const [timeframe, setTimeframe] = useState<RetentionTimeframeId>(DEFAULT_RETENTION_TIMEFRAME);
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

  return (
    <article className="card gym-card gym-card--full retention-evolution-card">
      <header className="gym-card-head">
        <div className="retention-evolution-titlerow">
          <h3 className="gym-card-title retention-evolution-title">
            Class Plan Member Retention
            <span className="cashflow-help">
              <button
                type="button"
                className="cashflow-tooltip"
                aria-label="Class Plan Member Retention explanation"
              >
                &#9432;
              </button>
              <div role="tooltip" className="cashflow-tooltip-panel retention-evolution-tooltip-panel">
                <ul className="cashflow-tooltip-list">
                  <li className="cashflow-tooltip-body">
                    Month-over-month <strong>membership / renewal</strong> retention from Wodify's
                    "Member Retention Rates" report: of the members active at the start of a month, the
                    share still active at month-end.
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
          Membership renewal retention over time — is churn improving or worsening?
        </p>
      </header>

      <div className="gym-card-body retention-evolution-body">
        <div className="retention-evolution-controls">
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

        {view.isEmpty || !view.dataBeginsMonth ? (
          <p className="retention-evolution-empty">No tracked retention history in this range yet.</p>
        ) : (
          <>
            <RetentionEvolutionChart points={view.points} />
            <p className="retention-evolution-caption">
              {view.windowExceedsData
                ? `Requested window exceeds tracked history — showing all available data. Membership tracking began ${formatMonthLong(view.dataBeginsMonth)}; earlier months aren't tracked and are never fabricated.`
                : `Membership tracking began ${formatMonthLong(view.dataBeginsMonth)}.`}
            </p>
          </>
        )}
      </div>
    </article>
  );
}
