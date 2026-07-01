// Retention — top-level nav item routed at /gym/retention (the path keeps its
// /gym prefix; a Gym sidebar group can return when sibling subpages are real).
// The Watch cards (Silent Churn, Attendance Health) read the live Wodify
// aggregate when a snapshot is available and fall back to the sample fixture
// otherwise; Member Movement's census (active/inactive — binary, §6 rescope)
// reads live the same way while its join-cohort intake stays sample. Churn Risk
// by Tenure reads the snapshot's per-band tenure histogram (§6 aggregate
// extension, sourced from Wodify member_since) and stays on sample until a
// gated re-pull populates that column. The three remaining
// Patterns cards stay as shells with an honest parked/blocked gate note — not
// built, gated on a data policy or API access (see RETENTION_FINISH_PLAN.md).
// Overview / Membership / Classes are hidden for now.

import { useEffect, useId, useMemo, useState } from 'react';
import ReactApexChart from 'react-apexcharts';
import { FiAlertTriangle, FiCheck, FiPhone } from 'react-icons/fi';
import { useRetentionSettings } from '../context/RetentionSettingsContext';
import { FIXTURE_TODAY, SAMPLE_GYM_MEMBERS } from '../lib/gym/memberFixture';
import {
  WATCH_FLOOR_DAYS,
  computeAttendanceHealth,
  computeSilentChurn,
} from '../lib/gym/silentChurn';
import {
  computeChurnRiskByTenure,
  computeChurnRiskByTenureFromAggregate,
  type TenureBandRisk,
} from '../lib/gym/churnRiskByTenure';
import {
  SAMPLE_COHORT_HISTOGRAM,
  computeChurnRiskByCohortFromAggregate,
  type CohortRisk,
} from '../lib/gym/churnRiskByCohort';
import {
  RECENCY_STAGES,
  buildSegmentExplorerView,
  type RecencyStageId,
} from '../lib/gym/segmentExplorer';
import { deriveBuckets } from '../lib/gym/retentionAggregateView';
import { buildRetentionRateView } from '../lib/gym/retentionRates';
import {
  DUES_STALE_AFTER_DAYS,
  deriveSilentChurnDuesView,
  type SilentChurnDuesView,
} from '../lib/gym/silentChurnDuesView';
import {
  fetchLatestRetentionAggregate,
  type RetentionAggregateSnapshot,
} from '../lib/gym/fetchRetentionAggregate';
import { RetentionEvolutionCard } from './RetentionEvolutionCard';
import { MemberRetentionByBeltCard } from './MemberRetentionByBeltCard';

export function GymPage() {
  // RETENTION_FINISH_PLAN.md §6: fetch the live Wodify aggregate ONCE here at page
  // level and share the single snapshot with every card that reads it (Silent
  // Churn + Attendance Health, plus Member Movement's census), so they derive from
  // the SAME snapshot and their live badges render the SAME as-of. A failed / empty
  // / unconfigured read leaves `snapshot` null and every card falls back to its
  // sample fixture — the live snapshot is optional, never a render error.
  const [snapshot, setSnapshot] = useState<RetentionAggregateSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    fetchLatestRetentionAggregate(controller.signal)
      .then((snap) => {
        if (!cancelled && snap) setSnapshot(snap);
      })
      .catch(() => {
        // Unreachable / non-OK / malformed → stay on the sample fixture. A missing
        // live snapshot is an expected state, not a failure worth surfacing.
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  return (
    <div className="stack-grid">
      <div className="ta-page">
        <div className="gym-retention">
          {/* WATCH — live signals. Top row: Attendance Health (1/3, donut) in line
              with the Churn chart (RetentionEvolutionCard, 2/3) via
              .retention-hero-split. Silent Churn is HIDDEN — its card + helpers stay
              defined in this file (not rendered), so this is a reversible hide, not a
              delete. (Page + section headers removed per owner — only card-level
              titles remain.) */}
          <section className="gym-section">
            <div className="gym-card-grid">
              <div className="retention-hero-split">
                <AttendanceHealthCard snapshot={snapshot} />
                <RetentionEvolutionCard />
              </div>
            </div>
          </section>

          {/* PATTERNS — monthly trends. Churn Risk by Tenure / Retention by Age
              Group / Segment Explorer, Churn by Belt a recessed full-width card at
              the bottom (data not connected yet). */}
          <section className="gym-section">
            <div className="gym-card-grid">
              <ChurnRiskByTenureCard snapshot={snapshot} />
              <CohortRetentionCard snapshot={snapshot} />
              <SegmentExplorerCard snapshot={snapshot} />
              <MemberRetentionByBeltCard />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// Whole dollars, no cents — these are monthly-dues figures, not reconciled cash.
const usd = (amount: number) => `$${Math.round(amount).toLocaleString('en-US')}`;

// Whole-percent risk rate. A null rate means the band has no active members, so
// there is no denominator to take a rate over — render an em dash, never "0%"
// (which would imply low risk where there is simply no data).
const formatRate = (rate: number | null) => (rate === null ? '—' : `${Math.round(rate * 100)}%`);

// Copy for the live card's dues-hidden states — deterministic, only rephrasing
// the view's computed reason and the dues snapshot's OWN dates/threshold; the $
// itself is never fabricated in any hidden state. The stale line is
// direction-NEUTRAL on purpose ("more than N days apart"): the dues export can be
// older than the snapshot (no fresh export before a pull) or newer (export
// refreshed, snapshot pull pending), and copy like "predates this snapshot" would
// lie in the second case.
function duesHiddenLine(
  view: Extract<SilentChurnDuesView, { kind: 'hidden' }>,
  currentThresholdDays: number,
): string {
  const notAvailable = 'Monthly dues at risk is not available from this data source yet.';
  if (!view.dues) return notAvailable; // 'noDues' — the standing count-only line
  switch (view.reason) {
    case 'thresholdMismatch':
      return (
        `Monthly dues at risk was computed at the ${view.dues.thresholdDays}-day threshold — ` +
        `not shown at the current ${currentThresholdDays}-day setting.`
      );
    case 'stale':
      return (
        `The dues figure (from the ${view.dues.duesAsOf} export) and this snapshot are more ` +
        `than ${DUES_STALE_AFTER_DAYS} days apart — not shown until they're refreshed together.`
      );
    case 'noCoverage':
      return `No dues are known yet for the silent members in the ${view.dues.duesAsOf} export.`;
    default:
      return notAvailable;
  }
}

// Wodify "Most Recent Attendance" report — the member-level (PII) view of the
// silent rule lives there, in the system of record, never in this app. The URL
// is stable but carries no filter state; the setup tooltip tells the owner how
// to make the report match the card's rule (and save it as default).
const WODIFY_ATTENDANCE_REPORT_URL =
  'https://app.wodify.com/Admin/Main?q=ViewReport%7CIsFromScreen%3DAttendance%26ReportId%3D36';

// Silent Churn hero — the Retention page's dominant live signal. Reads the
// owner-tuned threshold from the local Retention settings store. Dual-source,
// mirroring Attendance Health: with a live aggregate snapshot it shows the real
// silent COUNT (deriveBuckets' silent bucket === computeSilentChurn count by
// construction, so it can never disagree with the live Attendance Health "Silent"
// tally on the same snapshot). The live DOLLAR
// (§6.4 SC dues slice) renders only when deriveSilentChurnDuesView says the
// locally-written dues aggregate still matches what the card shows (threshold
// exact-match, within the staleness window, with real coverage) — every other
// state degrades to a count-only line with an explicit reason, NEVER a fabricated
// $0, and the badge stays Live (dues is per-field additive, like tenureBands).
// The per-member call-list needs PII the non-PII aggregate can't carry, so it is
// never shown live. Without a snapshot the card falls back to the sample
// fixture's full count + $/mo + call-list and the "Sample data" badge.
// Deterministic: the copy only rephrases computed numbers; it never authors the
// at-risk call. Re-renders whenever the threshold or snapshot changes.
function SilentChurnCard({ snapshot }: { snapshot: RetentionAggregateSnapshot | null }) {
  const { silentChurnThresholdDays } = useRetentionSettings();
  const titleTooltipId = useId();

  // One render path for both sources (mirrors AttendanceHealthCard). Live: derive
  // the silent COUNT from the non-PII histogram, plus the dues view gated against
  // the RESOLVED threshold deriveBuckets cut at (never the raw setting). Sample:
  // the full classifier result (count + dollars + call-list). The discriminated
  // `live` flag keeps the sample-only fields (rows, monthlyDuesAtRisk) off the
  // live branch entirely.
  const view = useMemo(() => {
    if (snapshot) {
      const buckets = deriveBuckets(snapshot, silentChurnThresholdDays);
      const dues = deriveSilentChurnDuesView(snapshot.dues, snapshot.asOf, buckets.thresholdDays);
      return {
        live: true as const,
        thresholdDays: buckets.thresholdDays,
        count: buckets.silent,
        // Known base for the silent rate (Option B): healthy + watch + silent,
        // i.e. activeTotal − unknown. The COUNT is unchanged in both toggle states.
        knownActive: buckets.healthy + buckets.watch + buckets.silent,
        unknown: buckets.unknown,
        asOf: snapshot.asOf,
        dues,
      };
    }
    const { thresholdDays, count, monthlyDuesAtRisk, rows } = computeSilentChurn(
      SAMPLE_GYM_MEMBERS,
      silentChurnThresholdDays,
      FIXTURE_TODAY,
    );
    // Same fixture + threshold + classifyMember, so buckets.silent === count by
    // construction; computeAttendanceHealth supplies the healthy/watch base the
    // silent rate needs (the silent COUNT still comes from computeSilentChurn).
    const buckets = computeAttendanceHealth(SAMPLE_GYM_MEMBERS, silentChurnThresholdDays, FIXTURE_TODAY);
    return {
      live: false as const,
      thresholdDays,
      count,
      knownActive: buckets.healthy + buckets.watch + buckets.silent,
      unknown: buckets.unknown,
      monthlyDuesAtRisk,
      rows,
    };
  }, [snapshot, silentChurnThresholdDays]);

  const { thresholdDays, count } = view;
  // Silent as a share of the attendance-known base (recency-unknown always held out).
  const silentFacet = buildRetentionRateView(
    count,
    view.knownActive,
    view.unknown,
    'attendance-known actives',
  ).knownBase;

  return (
    <article className="card gym-card gym-card--hero silent-churn-card">
      <header className="gym-card-head">
        <div className="silent-churn-titlerow">
          <h3 className="gym-card-title">Silent Churn</h3>
          <div className="db-tooltip-wrap">
            <button
              type="button"
              className="db-tooltip-btn"
              aria-label="What counts as silent churn"
              aria-describedby={titleTooltipId}
            >
              &#9432;
            </button>
            <div
              id={titleTooltipId}
              role="tooltip"
              className="db-tooltip-panel is-left silent-churn-title-tooltip-panel"
            >
              <ul className="db-tooltip-list">
                <li>
                  <strong>What counts as silent</strong>
                </li>
                <li className="db-tooltip-body">
                  Active members with no check-ins for {thresholdDays}+ days.
                </li>
                <li>
                  <strong>Set up the Wodify report</strong>
                </li>
                <li className="db-tooltip-body">
                  One-time setup — set these in the report, then use Wodify&rsquo;s
                  &ldquo;Set As Default Filters&rdquo; so this link lands
                  pre-configured:
                </li>
                <li className="db-tooltip-body">
                  Membership Status: Free, Paid, and On Hold — on-hold members
                  still count as active.
                </li>
                <li className="db-tooltip-body">
                  Sort &ldquo;Days Since Last Class Sign In&rdquo; descending;
                  silent = {thresholdDays}+ days.
                </li>
                <li className="db-tooltip-body">
                  Ignore members with a blank Last Attendance — never-attended
                  isn&rsquo;t silent.
                </li>
                {view.unknown > 0 && (
                  <>
                    <li>
                      <strong>Excluded from these rates</strong>
                    </li>
                    <li className="db-tooltip-body">
                      Parent/guardian or other active accounts with no class
                      check-ins ({view.unknown}) are excluded from these rates.
                    </li>
                  </>
                )}
              </ul>
            </div>
          </div>
          {!view.live && (
            <span className="gym-sample-badge">Sample data</span>
          )}
        </div>
        <p className="gym-card-subtitle">Still paying, not showing up.</p>
      </header>

      <div className="silent-churn-body">
        <div className="silent-churn-metrics">
          <div className="silent-churn-metric">
            <span className="silent-churn-metric-value">{count}</span>
            <span className="silent-churn-metric-label">
              {count === 1 ? 'member at risk' : 'members at risk'}
            </span>
          </div>
          {!view.live && (
            <div className="silent-churn-metric">
              <span className="silent-churn-metric-value">{usd(view.monthlyDuesAtRisk)}</span>
              <span className="silent-churn-metric-label">/mo at risk</span>
            </div>
          )}
          {view.live && view.dues.kind === 'shown' && (
            <div className="silent-churn-metric">
              <span className="silent-churn-metric-value">{usd(view.dues.totalMonthly)}</span>
              <span className="silent-churn-metric-label">/mo at risk</span>
            </div>
          )}
        </div>

        {silentFacet.base > 0 && (
          <p className="silent-churn-rate">
            {formatRate(silentFacet.rate)} of {silentFacet.base} attendance-known actives
          </p>
        )}

        {view.live ? (
          <>
            {view.dues.kind !== 'shown' && (
              <p className="silent-churn-dues-na">{duesHiddenLine(view.dues, thresholdDays)}</p>
            )}
            {count === 0 && (
              <p className="silent-churn-empty">
                No active members have been away for {thresholdDays}+ days right now.
              </p>
            )}
            {/* Wodify bridge (live only): the per-member list the non-PII
                aggregate can't carry lives in Wodify, the system of record. The
                outbound link is shown in every live dues state and at count 0
                (the snapshot doesn't govern Wodify); the sample branch keeps its
                fixture call-list instead. Setup steps live in the title tooltip. */}
            <div className="silent-churn-action">
              <div className="silent-churn-action-row">
                <a
                  className="silent-churn-action-btn"
                  href={WODIFY_ATTENDANCE_REPORT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Open Wodify report (opens in new tab)"
                >
                  Open Wodify report
                </a>
              </div>
            </div>
          </>
        ) : count === 0 ? (
          <p className="silent-churn-empty">
            No active members have been away for {thresholdDays}+ days right now.
          </p>
        ) : (
          <div className="silent-churn-calllist">
            <div className="silent-churn-calllist-head">
              <span className="silent-churn-col silent-churn-col--name">Member</span>
              <span className="silent-churn-col silent-churn-col--days">Days absent</span>
              <span className="silent-churn-col silent-churn-col--dues">$/mo</span>
            </div>
            <ul className="silent-churn-rows">
              {view.rows.map((row) => (
                <li key={row.id} className="silent-churn-row">
                  <span className="silent-churn-col silent-churn-col--name">{row.displayName}</span>
                  <span className="silent-churn-col silent-churn-col--days">{row.daysAbsent} days</span>
                  <span className="silent-churn-col silent-churn-col--dues">{usd(row.monthlyDues)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </article>
  );
}

// Attendance Health — full-width secondary signal below the Silent Churn hero.
// Buckets ACTIVE members by recency at the LIVE resolved threshold (Healthy
// 0–7d · Watch 8…T−1d · Silent ≥T). The Watch count is the hero: members
// drifting but not yet churned. Deterministic — the copy only rephrases
// code-computed counts.
//
// RETENTION_FINISH_PLAN.md §6: derives its buckets from the non-PII
// daysAbsentHistogram via deriveBuckets (same WATCH_FLOOR_DAYS + threshold rule,
// precedence-correct at every threshold). The
// `snapshot` is fetched ONCE at page level (GymPage) and passed to both Watch
// cards, so this card's live "Silent" bucket and the live Silent Churn count read
// the SAME snapshot and agree by construction. Loading / error / empty /
// unconfigured all fall back to the SAMPLE fixture and the "Sample data" badge —
// the live snapshot is optional, never a render error. Churn Risk by Tenure now
// reads the same snapshot's per-band tenure histogram (§6 aggregate extension);
// Member Movement's census reads it too (its intake stays sample).
function AttendanceHealthCard({ snapshot }: { snapshot: RetentionAggregateSnapshot | null }) {
  const { silentChurnThresholdDays, excludeUnknownRecency } = useRetentionSettings();

  // One render path for both sources: deriveBuckets (live histogram) and
  // computeAttendanceHealth (sample fixture) return the SAME H/W/S/unknown shape,
  // re-cut at the owner's CURRENT threshold whenever it changes. UNCHANGED data path
  // — the donut layout is a pure presentation adapter over these code-computed counts.
  const result = useMemo(
    () =>
      snapshot
        ? deriveBuckets(snapshot, silentChurnThresholdDays)
        : computeAttendanceHealth(SAMPLE_GYM_MEMBERS, silentChurnThresholdDays, FIXTURE_TODAY),
    [snapshot, silentChurnThresholdDays],
  );

  const { thresholdDays, healthy, watch, silent, unknown } = result;

  // Known-active base excludes Unknown (structural blanks) — the same Option-B
  // denominator the card already used. Donut segments, center %, and every row %
  // read this base, so they always sum to 100%. Divide-by-zero guarded: an all-zero
  // known base yields a null center % (line omitted) and 0 row %s (never NaN).
  const knownActive = healthy + watch + silent;
  const highRiskPct = knownActive > 0 ? Math.round((silent / knownActive) * 100) : null;
  const rowPct = (n: number): number => (knownActive > 0 ? Math.round((n / knownActive) * 100) : 0);

  // Legend day-bands reuse the resolved-threshold logic that drove the old `helper`
  // line — NEVER hardcoded (the threshold is Settings-adjustable). Reconnect (watch)
  // = [WATCH_FLOOR_DAYS, thresholdDays − 1]; High Risk (silent) = [thresholdDays, ∞).
  // When the threshold is at/below the watch floor the Reconnect band is empty by
  // construction (watch === 0), so avoid an inverted "8–7".
  const watchUpper = thresholdDays - 1;
  const reconnectDesc =
    thresholdDays <= WATCH_FLOOR_DAYS
      ? `Nearing the ${thresholdDays}-day threshold`
      : watchUpper === WATCH_FLOOR_DAYS
        ? `${WATCH_FLOOR_DAYS} days since last check-in`
        : `${WATCH_FLOOR_DAYS}–${watchUpper} days since last check-in`;
  const highRiskDesc = `${thresholdDays}+ days since last check-in`;

  // Segment colors come from the CSS design tokens at RUNTIME — the tokens stay the
  // single source of truth and nothing here hardcodes a palette hex. ApexCharts needs
  // concrete color strings (it can't resolve var() inside its SVG fills), so we read
  // the resolved :root values once. The commented fallbacks are the DOCUMENTED token
  // values (not new hex) — a belt-and-braces guard so a missing var can't paint an
  // empty ring.
  const segmentColors = useMemo(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      healthy: root.getPropertyValue('--positive').trim() || '#12B76A', // var(--positive)
      reconnect: root.getPropertyValue('--warning').trim() || '#F79009', // var(--warning)
      highRisk: root.getPropertyValue('--negative').trim() || '#F04438', // var(--negative)
    };
  }, []);

  // Bottom insight (req 8): no prior-year attendance composition exists in the
  // snapshot (RetentionAggregateSnapshot carries no YoY field), so this is null and
  // the insight renders the honest "unavailable" branch. Wired through
  // attendanceYoYInsight so a real prior-year source would light the ↑/↓/→ branches
  // automatically — never fabricated.
  const priorYearHighRiskPct: number | null = null;
  const insight = attendanceYoYInsight(highRiskPct, priorYearHighRiskPct);

  // Mirrors the shipped ApexCharts donut in TopCategoriesCard (type:'donut', white
  // separator stroke, custom .ec-donut-tooltip, no built-in labels — center text is
  // an overlay below for exact "big number / sub-line" control).
  const donutOptions: ApexCharts.ApexOptions = {
    chart: {
      type: 'donut',
      fontFamily: 'Outfit, sans-serif',
      toolbar: { show: false },
      accessibility: { keyboard: { enabled: false, navigation: { enabled: false } } },
      animations: { enabled: false },
      background: 'transparent',
      sparkline: { enabled: false },
    },
    colors: [segmentColors.healthy, segmentColors.reconnect, segmentColors.highRisk],
    labels: ['Healthy', 'Reconnect', 'High Risk'],
    dataLabels: { enabled: false },
    legend: { show: false },
    stroke: { width: 2, colors: ['#FFFFFF'] },
    plotOptions: { pie: { donut: { size: '72%', labels: { show: false } } } },
    tooltip: {
      custom: ({ seriesIndex }: { seriesIndex: number }) => {
        const names = ['Healthy', 'Reconnect', 'High Risk'];
        const counts = [healthy, watch, silent];
        const name = names[seriesIndex];
        if (name === undefined) return '';
        const count = counts[seriesIndex];
        return `
          <div class="ec-donut-tooltip">
            <div class="ec-donut-tooltip__title">${name} · ${rowPct(count)}%</div>
            <div class="ec-donut-tooltip__value">${count}</div>
          </div>
        `;
      },
    },
    states: { hover: { filter: { type: 'lighten' } }, active: { filter: { type: 'none' } } },
  };

  return (
    <article className="card gym-card gym-card--full attendance-health-card">
      <header className="gym-card-head">
        <div className="attendance-health-titlerow">
          <h3 className="gym-card-title">Attendance Health</h3>
          {!snapshot && (
            <span className="gym-sample-badge">Sample data</span>
          )}
        </div>
      </header>

      <div className="attendance-health-body">
        {knownActive === 0 ? (
          <p className="attendance-health-empty">
            No attendance-known active members at the {thresholdDays}-day threshold right now.
          </p>
        ) : (
          <div className="attendance-donut-layout">
            <div className="attendance-donut-wrap">
              <ReactApexChart
                type="donut"
                series={[healthy, watch, silent]}
                options={donutOptions}
                height={200}
              />
              <div className="attendance-donut-center" aria-hidden="true">
                <span className="attendance-donut-center-value">{highRiskPct ?? 0}%</span>
                <span className="attendance-donut-center-label">
                  {silent} {silent === 1 ? 'client' : 'clients'}
                  <br />
                  at high risk
                </span>
              </div>
            </div>

            <ul className="attendance-donut-legend">
              <li className="attendance-donut-legend-row">
                <span
                  className="attendance-donut-legend-icon attendance-donut-legend-icon--healthy"
                  aria-hidden="true"
                >
                  <FiCheck />
                </span>
                <span className="attendance-donut-legend-text">
                  <span className="attendance-donut-legend-label">Healthy</span>
                  <span className="attendance-donut-legend-desc">Checked in recently</span>
                </span>
                <span className="attendance-donut-legend-metrics">
                  <span className="attendance-donut-legend-count">{healthy}</span>
                  <span className="attendance-donut-legend-pct">{rowPct(healthy)}%</span>
                </span>
              </li>
              <li className="attendance-donut-legend-row">
                <span
                  className="attendance-donut-legend-icon attendance-donut-legend-icon--reconnect"
                  aria-hidden="true"
                >
                  <FiPhone />
                </span>
                <span className="attendance-donut-legend-text">
                  <span className="attendance-donut-legend-label">Reconnect</span>
                  <span className="attendance-donut-legend-desc">{reconnectDesc}</span>
                </span>
                <span className="attendance-donut-legend-metrics">
                  <span className="attendance-donut-legend-count">{watch}</span>
                  <span className="attendance-donut-legend-pct">{rowPct(watch)}%</span>
                </span>
              </li>
              <li className="attendance-donut-legend-row">
                <span
                  className="attendance-donut-legend-icon attendance-donut-legend-icon--highrisk"
                  aria-hidden="true"
                >
                  <FiAlertTriangle />
                </span>
                <span className="attendance-donut-legend-text">
                  <span className="attendance-donut-legend-label">High Risk</span>
                  <span className="attendance-donut-legend-desc">{highRiskDesc}</span>
                </span>
                <span className="attendance-donut-legend-metrics">
                  <span className="attendance-donut-legend-count">{silent}</span>
                  <span className="attendance-donut-legend-pct">{rowPct(silent)}%</span>
                </span>
              </li>
            </ul>
          </div>
        )}

        <p className="attendance-health-insight">{insight}</p>

        {!excludeUnknownRecency && unknown > 0 && (
          <p className="attendance-health-dataquality">
            Unknown = active accounts with no Wodify attendance or class sign-in
            on record — typically guardian/parent billing accounts (the child
            trains; the paying adult never signs in), staff accounts, or legacy
            members from before digital check-in. Structural blanks, not churn —
            held out of Healthy / Reconnect / High Risk rather than mislabeled.
          </p>
        )}
      </div>
    </article>
  );
}

// Bottom insight (RETENTION_FINISH_PLAN req 8) — deterministic and prior-year-gated.
// The ↑/↓/→ branches light up ONLY from a REAL prior-year High-Risk % (`prior`);
// `prior === null` (the current reality — the snapshot has no prior-year attendance
// composition) yields the honest "unavailable" branch. High-Risk % is a BAD metric,
// so a LOWER current value is an improvement (↑ better). Never fabricates a YoY delta.
function attendanceYoYInsight(current: number | null, prior: number | null): string {
  if (current === null || prior === null) return 'Prior-year comparison unavailable';
  const deltaPct = Math.abs(current - prior);
  if (deltaPct === 0) return '→ About the same as this month last year';
  return current < prior
    ? `↑ ${deltaPct}% better than this month last year`
    : `↓ ${deltaPct}% worse than this month last year`;
}

// Churn Risk by Tenure — the first Patterns card to turn the member layer into a
// segment insight. Buckets ACTIVE members by tenure (days since membershipStart)
// and, within each band, shows what share are at risk (on watch OR silent) at the
// LIVE resolved threshold, using the same classifyMember the Watch cards use — so
// the silent slices here re-partition the Silent Churn set rather than redefining
// it. The hero is the band with the highest risk rate. Deterministic: the copy
// only rephrases code-computed counts and rates; it never authors the at-risk call.
//
// Dual-source (§6 aggregate extension): with a snapshot carrying the per-band
// tenure histogram (validated against this build's band edges — see
// fetchRetentionAggregate), the card derives the SAME result shape live via
// computeChurnRiskByTenureFromAggregate (deriveBuckets per band, one hero rule).
// Σ band silent here === the live Silent Churn
// count at the same threshold by construction. A snapshot without tenure data
// (pre-migration row, or a contract mismatch) falls back to the sample fixture —
// the tenure flip is data-gated, not deploy-gated. The live caveat note carries
// the two disclosed member_since caveats (records-era undercount; staff
// accounts) — honesty notes, not defects.
function ChurnRiskByTenureCard({ snapshot }: { snapshot: RetentionAggregateSnapshot | null }) {
  const { silentChurnThresholdDays, excludeUnknownRecency } = useRetentionSettings();

  const tenureBands = snapshot?.tenureBands ?? null;
  const result = useMemo(
    () =>
      tenureBands
        ? computeChurnRiskByTenureFromAggregate(tenureBands, silentChurnThresholdDays)
        : computeChurnRiskByTenure(SAMPLE_GYM_MEMBERS, silentChurnThresholdDays, FIXTURE_TODAY),
    [tenureBands, silentChurnThresholdDays],
  );
  // Live only when the snapshot actually carries a usable tenure histogram — the
  // other live cards may already be live off this snapshot while this card is
  // still honestly Sample (pre-tenure row → tenureBands null).
  const liveAsOf = tenureBands && snapshot ? snapshot.asOf : null;

  const { thresholdDays, activeTotal, bands, unknownTenure } = result;

  // Rates are ALWAYS over the attendance-known base (recency-unknown held out); the
  // displayed Tracked column is that same denominator so each row reconciles
  // (atRisk / Tracked === Risk rate). There is no full-base view any more.
  const heroBandId = result.heroBandIdKnown;
  const heroBand = bands.find((b) => b.id === heroBandId) ?? null;
  const bandActive = (b: TenureBandRisk) => b.knownActiveTotal;
  const bandRate = (b: TenureBandRisk) => b.riskRateKnown;
  // Recency-unknowns held out of the known base, summed across the REAL bands.
  // (The unknownTenure bucket is a SEPARATE population — bad membershipStart, not
  // bad attendance — and is never part of any band's rate denominator.)
  const unknownRecencyTotal = bands.reduce((sum, b) => sum + b.unknownRecency, 0);

  return (
    <article className="card gym-card gym-card--full churn-tenure-card">
      <header className="gym-card-head">
        <div className="churn-tenure-titlerow">
          <h3 className="gym-card-title">Churn Risk by Tenure</h3>
          {!liveAsOf && (
            <span className="gym-sample-badge">Sample data</span>
          )}
        </div>
        <p className="gym-card-subtitle">Which tenure cohort is drifting most.</p>
      </header>

      <div className="churn-tenure-body">
        {activeTotal === 0 || !heroBand ? (
          <p className="churn-tenure-empty">No active members to analyze right now.</p>
        ) : (
          <>
            <div className="churn-tenure-hero">
              <span className="churn-tenure-hero-value">{formatRate(bandRate(heroBand))}</span>
              <span className="churn-tenure-hero-label">
                at risk in the {heroBand.label} cohort — the highest by tenure
              </span>
            </div>
            <p className="churn-tenure-helper">
              At-risk = active members on watch or silent at the {thresholdDays}-day threshold
              ({heroBand.atRisk} of {bandActive(heroBand)} attendance-known in this band).
            </p>
          </>
        )}

        <div className="churn-tenure-table">
          <div className="churn-tenure-head">
            <span className="churn-tenure-col churn-tenure-col--band">Tenure</span>
            <span className="churn-tenure-col churn-tenure-col--num">Tracked</span>
            <span className="churn-tenure-col churn-tenure-col--num">At risk</span>
            <span className="churn-tenure-col churn-tenure-col--num">Risk rate</span>
          </div>
          <ul className="churn-tenure-rows">
            {bands.map((b) => (
              <li
                key={b.id}
                className={`churn-tenure-row${b.id === heroBandId ? ' churn-tenure-row--hero' : ''}`}
              >
                <span className="churn-tenure-col churn-tenure-col--band">{b.label}</span>
                <span className="churn-tenure-col churn-tenure-col--num">{bandActive(b)}</span>
                <span className="churn-tenure-col churn-tenure-col--num">{b.atRisk}</span>
                <span className="churn-tenure-col churn-tenure-col--num">{formatRate(bandRate(b))}</span>
              </li>
            ))}
            {/* Dirty-data members (missing/invalid or future membershipStart) are
                shown here rather than silently dropped — keeps this card honest
                against the Silent Churn count once live Wodify data lands. Hidden
                while the sample data is clean. */}
            {unknownTenure.activeTotal > 0 && (
              <li className="churn-tenure-row churn-tenure-row--unknown">
                <span className="churn-tenure-col churn-tenure-col--band">
                  {unknownTenure.label}
                </span>
                <span className="churn-tenure-col churn-tenure-col--num">
                  {unknownTenure.activeTotal}
                </span>
                <span className="churn-tenure-col churn-tenure-col--num">
                  {unknownTenure.atRisk}
                </span>
                <span className="churn-tenure-col churn-tenure-col--num">
                  {formatRate(unknownTenure.riskRate)}
                </span>
              </li>
            )}
          </ul>
        </div>

        {!excludeUnknownRecency && unknownRecencyTotal > 0 && (
          <p className="churn-tenure-base-note">
            Rates among attendance-known members in each cohort.
          </p>
        )}
        {liveAsOf && (
          <p className="churn-tenure-caveat">
            Tenure counts from each member&rsquo;s start date in our current records
            (Wodify&rsquo;s &ldquo;Client Since&rdquo;). Members whose history predates
            these records can show shorter tenure than their real one, and staff
            accounts carry account-setup dates rather than member tenure.
          </p>
        )}
      </div>
    </article>
  );
}

// Retention by Age Group (Cohort Retention Card — RETENTION_FINISH_PLAN.md §6–§9,
// rev.3 client_status basis). Two reads in one card: Read 1 — cohort health
// (Healthy/Watch/Silent + at-risk rate per age cohort, active members), re-derived
// at the owner threshold via computeChurnRiskByCohortFromAggregate (same
// deriveBuckets + known-base + hero rules as Churn-by-Tenure); Read 2 — lapsed
// (inactive) members per cohort. Deterministic: copy only rephrases code-computed
// counts/rates; it never authors the at-risk call.
//
// Dual-source: with a snapshot carrying cohort_histogram (validated against this
// build's COHORT_BANDS — see fetchRetentionAggregate) it reads the live
// snapshot; otherwise it renders the clearly-synthetic SAMPLE_COHORT_HISTOGRAM
// through the SAME adapter (the shared member fixture has no DOB, so the sample is
// a static histogram, not a fixture compute). The cohort flip is data-gated.
//
// §7 STRUCTURAL-HONESTY caveat (footer): client_status Inactive has no
// never-membered guard — the never-membered (guardian/staff/legacy) population
// skews into Adults 16+ — so cohort-lapsed must never be read as "memberships
// ended." Copy over the deterministic numbers; the card never authors the call.
function CohortRetentionCard({ snapshot }: { snapshot: RetentionAggregateSnapshot | null }) {
  const { silentChurnThresholdDays, excludeUnknownRecency } = useRetentionSettings();

  const cohorts = snapshot?.cohorts ?? null;
  const result = useMemo(
    () =>
      computeChurnRiskByCohortFromAggregate(
        cohorts ?? SAMPLE_COHORT_HISTOGRAM,
        silentChurnThresholdDays,
      ),
    [cohorts, silentChurnThresholdDays],
  );
  // Live only when the snapshot actually carries a usable cohort histogram — other
  // cards may already be live off this snapshot while this one is honestly Sample
  // (pre-cohort row → cohorts null).
  const liveAsOf = cohorts && snapshot ? snapshot.asOf : null;

  const { thresholdDays, activeTotal, bands, unknownCohort } = result;

  // Read 1, identical to Churn-by-Tenure: rates are always over the attendance-known
  // base (recency-unknown held out); atRisk is unchanged. No full-base view.
  const heroBandId = result.heroBandIdKnown;
  const heroBand = bands.find((b) => b.id === heroBandId) ?? null;
  const bandActive = (b: CohortRisk) => b.knownActiveTotal;
  const bandRate = (b: CohortRisk) => b.riskRateKnown;
  const unknownRecencyTotal = bands.reduce((sum, b) => sum + b.unknownRecency, 0);

  // Read 2 lapsed cells render the real aggregate count (owner-dashboard
  // aggregate-count policy — AGENTS.md "Retention page data policy"; no <5 mask).

  // The unknown-cohort row renders only when it carries members (active or lapsed),
  // matching the unknown-tenure row's "surface, don't fabricate" rule.
  const showUnknownRow = unknownCohort.activeTotal > 0 || unknownCohort.lapsed > 0;

  return (
    <article className="card gym-card gym-card--full cohort-age-card">
      <header className="gym-card-head">
        <div className="cohort-age-titlerow">
          <h3 className="gym-card-title">Retention by Age Group</h3>
          {!liveAsOf && (
            <span className="gym-sample-badge">Sample data</span>
          )}
        </div>
        <p className="gym-card-subtitle">Do kids, teens, and adults retain differently?</p>
      </header>

      <div className="cohort-age-body">
        {activeTotal === 0 || !heroBand ? (
          <p className="cohort-age-empty">No active members to analyze right now.</p>
        ) : (
          <>
            <div className="cohort-age-hero">
              <span className="cohort-age-hero-value">{formatRate(bandRate(heroBand))}</span>
              <span className="cohort-age-hero-label">
                at risk in {heroBand.label} — the highest by age group
              </span>
            </div>
            <p className="cohort-age-helper">
              At-risk = active members on watch or silent at the {thresholdDays}-day threshold
              ({heroBand.atRisk} of {bandActive(heroBand)} attendance-known in this group). Lapsed =
              members whose membership is inactive today.
            </p>
          </>
        )}

        <div className="cohort-age-table">
          <div className="cohort-age-head">
            <span className="cohort-age-col cohort-age-col--band">Age group</span>
            <span className="cohort-age-col cohort-age-col--num">Tracked</span>
            <span className="cohort-age-col cohort-age-col--num">At risk</span>
            <span className="cohort-age-col cohort-age-col--num">Risk rate</span>
            <span className="cohort-age-col cohort-age-col--num">Lapsed</span>
          </div>
          <ul className="cohort-age-rows">
            {bands.map((b) => (
              <li
                key={b.id}
                className={`cohort-age-row${b.id === heroBandId ? ' cohort-age-row--hero' : ''}`}
              >
                <span className="cohort-age-col cohort-age-col--band">{b.label}</span>
                <span className="cohort-age-col cohort-age-col--num">{bandActive(b)}</span>
                <span className="cohort-age-col cohort-age-col--num">{b.atRisk}</span>
                <span className="cohort-age-col cohort-age-col--num">{formatRate(bandRate(b))}</span>
                <span className="cohort-age-col cohort-age-col--num">{b.lapsed}</span>
              </li>
            ))}
            {/* Unknown-age members (missing/sentinel/invalid DOB) surfaced rather
                than dropped — keeps the card honest against the Member Movement
                census once live. Hidden while the sample data is clean. */}
            {showUnknownRow && (
              <li className="cohort-age-row cohort-age-row--unknown">
                <span className="cohort-age-col cohort-age-col--band">{unknownCohort.label}</span>
                <span className="cohort-age-col cohort-age-col--num">{bandActive(unknownCohort)}</span>
                <span className="cohort-age-col cohort-age-col--num">{unknownCohort.atRisk}</span>
                <span className="cohort-age-col cohort-age-col--num">
                  {formatRate(bandRate(unknownCohort))}
                </span>
                <span className="cohort-age-col cohort-age-col--num">{unknownCohort.lapsed}</span>
              </li>
            )}
          </ul>
        </div>

        {!excludeUnknownRecency && unknownRecencyTotal > 0 && (
          <p className="cohort-age-base-note">
            At-risk rates among attendance-known members in each group.
          </p>
        )}
        <p className="cohort-age-suppression-note">
          Counts are aggregate age-group totals. No member names, IDs, DOBs, exact ages, or
          individual records are stored or shown.
        </p>

        <p className="cohort-age-caveat">
          Age groups come from each member&rsquo;s date of birth (age ranges only — birthdates
          never leave our system). &ldquo;Lapsed&rdquo; counts everyone whose membership is
          inactive today; because inactive profiles can include never-enrolled accounts (a
          parent/guardian, staff, or a legacy profile) that skew into Adults 16+, read it as
          &ldquo;inactive in this age group,&rdquo; not &ldquo;memberships ended.&rdquo;
        </p>
      </div>
    </article>
  );
}

// Segment Explorer — Slice 1a (tenure × recency cross-section). A NEW presentation
// view over the EXISTING Churn-Risk-by-Tenure result: it renders the per-band
// aggregates as a grid of today's active members, tenure band (rows) × recency
// stage (columns), with the locked classifier vocabulary. It adds NO computation —
// the same dual-source gating as ChurnRiskByTenureCard (live aggregate when the
// snapshot carries the tenure histogram, sample fixture otherwise), the same
// threshold from RetentionSettings, fed through the pure buildSegmentExplorerView
// adapter (Healthy subtraction, per-row known-base rate; aggregate
// counts shown as real numbers). Honest labels: it is a cross-SECTION of today's
// actives — not a journey over time — and long-tenure rows show survivors only (footer).
function SegmentExplorerCard({ snapshot }: { snapshot: RetentionAggregateSnapshot | null }) {
  const { silentChurnThresholdDays, excludeUnknownRecency } = useRetentionSettings();

  const tenureBands = snapshot?.tenureBands ?? null;
  const result = useMemo(
    () =>
      tenureBands
        ? computeChurnRiskByTenureFromAggregate(tenureBands, silentChurnThresholdDays)
        : computeChurnRiskByTenure(SAMPLE_GYM_MEMBERS, silentChurnThresholdDays, FIXTURE_TODAY),
    [tenureBands, silentChurnThresholdDays],
  );
  // Live only when the snapshot actually carries a usable tenure histogram —
  // exactly the ChurnRiskByTenureCard gate, so the two cards badge identically.
  const liveAsOf = tenureBands && snapshot ? snapshot.asOf : null;

  const view = useMemo(() => buildSegmentExplorerView(result), [result]);
  const { thresholdDays, activeTotal, rows, unknownRecencyTotal } = view;

  // When parent/guardian accounts are excluded (toggle ON), drop the Unknown-recency
  // column entirely — the grid becomes a Healthy/Watch/Silent cross-section. When OFF,
  // all four recency stages show. The recency-unknown population is never in a rate
  // either way (the at-risk rate is always the known base).
  const visibleStages = excludeUnknownRecency
    ? RECENCY_STAGES.filter((s) => s.id !== 'unknownRecency')
    : RECENCY_STAGES;

  // Day ranges for the recency columns, composed from the resolved threshold and
  // the locked WATCH_FLOOR_DAYS — the same edges classifyMember cuts at.
  const stageRange = (stage: RecencyStageId): string => {
    switch (stage) {
      case 'healthy':
        return `0–${WATCH_FLOOR_DAYS - 1} days`;
      case 'watch':
        return `${WATCH_FLOOR_DAYS}–${thresholdDays - 1} days`;
      case 'silent':
        return `${thresholdDays}+ days`;
      case 'unknownRecency':
        return 'no check-in on file';
    }
  };

  // The survivorship footer is mandatory in BOTH states; sample mode has no live
  // as-of, so it names the fixture date and flags itself as sample.
  const asOfLabel = liveAsOf ?? '2026-06-02 (sample)';

  return (
    <article className="card gym-card gym-card--full segment-explorer-card">
      <header className="gym-card-head">
        <div className="segment-explorer-titlerow">
          <h3 className="gym-card-title">Today&rsquo;s members by tenure &amp; risk stage</h3>
          {!liveAsOf && (
            <span className="gym-sample-badge">Sample data</span>
          )}
        </div>
        <p className="gym-card-subtitle">
          A cross-section of active members — tenure today by recency stage.
        </p>
      </header>

      <div className="segment-explorer-body">
        {activeTotal === 0 ? (
          <p className="segment-explorer-empty">No active members to analyze right now.</p>
        ) : (
          <div
            className="segment-explorer-table"
            role="table"
            aria-label="Active members by tenure and recency stage"
          >
            <div className="segment-explorer-head" role="row">
              <span className="segment-explorer-col segment-explorer-col--band" role="columnheader">
                Current tenure today
              </span>
              {visibleStages.map((s) => (
                <span
                  key={s.id}
                  className="segment-explorer-col segment-explorer-col--num"
                  role="columnheader"
                >
                  <span className="segment-explorer-colhead">{s.label}</span>
                  <span className="segment-explorer-colsub">{stageRange(s.id)}</span>
                </span>
              ))}
              <span className="segment-explorer-col segment-explorer-col--num" role="columnheader">
                <span className="segment-explorer-colhead">At-risk rate</span>
                <span className="segment-explorer-colsub">known base</span>
              </span>
            </div>
            <ul className="segment-explorer-rows">
              {rows.map((row) => (
                <li
                  key={row.id}
                  role="row"
                  className={`segment-explorer-row${
                    row.isUnknownTenure ? ' segment-explorer-row--unknown' : ''
                  }`}
                >
                  <span className="segment-explorer-col segment-explorer-col--band" role="cell">
                    {row.isUnknownTenure ? 'Unknown tenure' : row.label}
                  </span>
                  {row.cells
                    .filter((cell) => visibleStages.some((s) => s.id === cell.stage))
                    .map((cell) => (
                      <span
                        key={cell.stage}
                        className="segment-explorer-col segment-explorer-col--num"
                        role="cell"
                      >
                        {cell.count}
                      </span>
                    ))}
                  <span className="segment-explorer-col segment-explorer-col--num" role="cell">
                    {formatRate(row.rate)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="segment-explorer-suppression-note">
          Cells are aggregate counts of active members by tenure and recency stage. No member
          identities or individual records are stored or shown.
        </p>

        <p className="segment-explorer-survivorship">
          Snapshot as of {asOfLabel}. This is a cross-section of today&rsquo;s active members —
          members who already left are not in this base, so long-tenure bands show survivors only
          and can look healthier than the real experience.
        </p>
      </div>
    </article>
  );
}
