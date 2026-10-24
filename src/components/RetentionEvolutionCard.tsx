// Membership continuity — gym-wide continuity-of-paying-memberships chart (Retention page, Watch hero
// row). Reads the live "Member Retention Rates" monthly aggregate from Supabase; falls back to a
// synthetic sample fixture until the table is seeded. GYM-WIDE only — a segmented trend is still the
// gated client-grain + DOB-join slice. Renders beside Attendance Health (2/3 column) via .retention-hero-split.
//
// NOT CHURN. member_retention_rates follows the continuity of paying memberships in a smaller base than
// all students, so it is shown as "Membership continuity" and never as churn or retention. Student churn
// is the Student movement card (Wodify monthly metrics). The old Churn/Retention toggle was removed with
// that reframing; the table and its data are untouched.

import { useEffect, useId, useMemo, useState } from 'react';

import PeriodDropdown from './PeriodDropdown';
import RetentionEvolutionChart from './RetentionEvolutionChart';
import { fetchMemberRetentionRates } from '../lib/gym/fetchMemberRetentionRates';
import {
  fetchMemberRetentionByCohort,
  type CohortRetentionRow,
} from '../lib/gym/fetchMemberRetentionByCohort';
import { buildCohortOverlay, type PlottedCohortBand } from '../lib/gym/memberRetentionCohortSeries';
import { computeCohortYoY, type CohortYoYResult } from '../lib/gym/cohortRetentionYoY';
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
  const titleTooltipId = useId();
  const [live, setLive] = useState<RetentionMonth[] | null>(null);
  const [cohortRows, setCohortRows] = useState<CohortRetentionRow[] | null>(null);
  const [timeframe, setTimeframe] = useState<RetentionTimeframeId>(DEFAULT_RETENTION_TIMEFRAME);
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

  // YoY pills (By-age view only): per plotted band, the displayed window's LAST month vs the SAME
  // calendar month one year earlier, computed off the FULL cohort series (the year-ago partner may
  // fall outside the visible window). A band with no computable pair renders no pill — never a
  // placeholder/dash.
  const yoyPills = useMemo(() => {
    if (!byAge || !cohortRows || view.points.length === 0 || !view.dataBeginsMonth) return null;
    const displayedMonth = view.points[view.points.length - 1].periodMonth;
    const dataBeginsMonth = view.dataBeginsMonth;
    const bands: { band: PlottedCohortBand; label: string }[] = [
      { band: 'youth3to15', label: 'Youth 3–15' },
      { band: 'adults16plus', label: 'Adults 16+' },
    ];
    const shown = bands
      .map(({ band, label }) => ({
        label,
        yoy: computeCohortYoY({ rows: cohortRows, band, displayedMonth, dataBeginsMonth, metric: 'retention' }),
      }))
      .filter(
        (p): p is { label: string; yoy: Extract<CohortYoYResult, { status: 'show' }> } =>
          p.yoy.status === 'show',
      );
    return shown.length > 0 ? shown : null;
  }, [byAge, cohortRows, view.points, view.dataBeginsMonth]);

  // Headline stat: the mean continuity across the selected timeframe — so the subtitle reads e.g.
  // "Average continuity 92%" and tracks the timeframe. Stays the gym-wide All average even under By
  // age (never recomputed per segment).
  const avgPct = useMemo(() => averageMetricPct(view.points, 'retention'), [view.points]);
  const avgLabel = avgPct != null ? `${Math.round(avgPct)}%` : '—';

  return (
    <article className="card gym-card gym-card--full retention-evolution-card">
      <header className="gym-card-head retention-evolution-head">
        <div className="retention-evolution-heading">
          <div className="retention-evolution-titlerow">
            <h3 className="gym-card-title retention-evolution-title">
              Membership continuity
              <span className="db-tooltip-wrap">
                <button
                  type="button"
                  className="db-tooltip-btn"
                  aria-label="Membership continuity explanation"
                  aria-describedby={titleTooltipId}
                >
                  &#9432;
                </button>
                <div
                  id={titleTooltipId}
                  role="tooltip"
                  className="db-tooltip-panel is-left is-wide"
                >
                  <ul className="db-tooltip-list">
                    <li className="db-tooltip-body">
                      Month-over-month <strong>continuity of paying memberships</strong> from Wodify's
                      "Member Retention Rates" report: of the memberships active at the start of a
                      month, the share still active at month-end. It follows a smaller group than all
                      students.
                    </li>
                    <li className="db-tooltip-body">
                      This is <strong>not student churn</strong>. See Student movement for new,
                      returned and cancelled students and estimated churn. It is also different from
                      Attendance Health, which measures who has stopped showing up — not whether a
                      membership continued.
                    </li>
                    {view.dataBeginsMonth && (
                      <li className="db-tooltip-body">
                        Membership tracking began {formatMonthLong(view.dataBeginsMonth)}.
                      </li>
                    )}
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
            Average continuity {avgLabel}
          </p>
        </div>
        <div className="retention-evolution-controls">
          {/* YoY pills — By-age view only, one per band with a computable same-month-last-year pair.
              Mirrors attendanceYoYInsight's ↑/↓/→ idiom; sits on its own line at the top-right. */}
          {yoyPills && (
            <div
              className="retention-evolution-yoy"
              aria-label="Year-over-year change versus the same month last year"
            >
              {yoyPills.map(({ label, yoy }) => {
                const arrow =
                  yoy.direction === 'better' ? '↑' : yoy.direction === 'worse' ? '↓' : '→';
                // Face shows ABSOLUTE magnitude — arrow + color carry direction, so a signed
                // delta would read as "↑ -10.0pp" if the metric ever flipped sign (semantic arrow vs
                // metric-relative sign). The tooltip keeps the "X points better/worse" wording.
                const magnitude = `${Math.abs(yoy.deltaPp).toFixed(1)}pp`;
                const words =
                  yoy.direction === 'neutral'
                    ? 'about the same as'
                    : `${Math.abs(yoy.deltaPp).toFixed(1)} points ${yoy.direction} than`;
                return (
                  <span
                    key={label}
                    className={`retention-evolution-yoy-pill retention-evolution-yoy-pill--${yoy.direction}`}
                    title={`${label}: continuity ${words} the same month last year`}
                  >
                    <span className="retention-evolution-yoy-pill-band">{label}</span>
                    <span className="retention-evolution-yoy-pill-delta">
                      {arrow} {magnitude}
                    </span>
                  </span>
                );
              })}
            </div>
          )}
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
              youth={overlay?.youth}
              adults={overlay?.adults}
            />
            {view.windowExceedsData && (
              <p className="retention-evolution-caption">
                {`Requested window exceeds tracked history — showing all available data. Membership tracking began ${formatMonthLong(view.dataBeginsMonth)}; earlier months aren't tracked and are never fabricated.`}
              </p>
            )}
            {byAge && (
              <ul className="retention-evolution-footnote">
                <li>Unknown-age members are excluded from Youth and Adults, but counted in All.</li>
              </ul>
            )}
          </>
        )}
      </div>
    </article>
  );
}
