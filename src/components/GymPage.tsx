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

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import ReactApexChart from 'react-apexcharts';
import { FiAlertTriangle, FiCheck, FiMoreVertical, FiPhone } from 'react-icons/fi';
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
import { TENURE_BANDS } from '../lib/gym/tenureBands';
import { COHORT_BANDS } from '../lib/gym/cohortBands';
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
              .retention-hero-split. The donut card carries a kebab (⋮) menu that
              filters the donut to a tenure/age cohort (All = whole gym). Silent
              Churn is HIDDEN — its card + helpers stay defined in this file (not
              rendered), so this is a reversible hide, not a delete. */}
          <section className="gym-section">
            <div className="gym-card-grid">
              <div className="retention-hero-split">
                <AttendanceHealthCard snapshot={snapshot} />
                <RetentionEvolutionCard />
              </div>
            </div>
          </section>

          {/* PATTERNS — the two 1/2 rate cards (Risk by Time as Member / by Age
              Group) side by side, then Churn by Belt full-width below (data not
              connected yet). */}
          <section className="gym-section">
            <div className="gym-card-grid">
              <ChurnRiskByTenureCard snapshot={snapshot} />
              <CohortRetentionCard snapshot={snapshot} />
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

// The kebab-menu drill-down selection: whole gym, or one tenure/age cohort.
type AttendanceSelection =
  | { kind: 'all' }
  | { kind: 'tenure'; bandId: string; label: string }
  | { kind: 'age'; bandId: string; label: string };

// One tenure/age band's slice of the Attendance-Health classification, in the same
// { healthy, watch, silent, unknown } shape deriveBuckets returns. Healthy is the
// sanctioned subtraction over values the per-band compute already returned; unknown
// is that band's recency-unknown count. No re-classification.
function bandBuckets(
  band: { knownActiveTotal: number; watch: number; silent: number; unknownRecency: number },
  thresholdDays: number,
): { thresholdDays: number; healthy: number; watch: number; silent: number; unknown: number } {
  return {
    thresholdDays,
    healthy: band.knownActiveTotal - band.watch - band.silent,
    watch: band.watch,
    silent: band.silent,
    unknown: band.unknownRecency,
  };
}

function AttendanceHealthCard({ snapshot }: { snapshot: RetentionAggregateSnapshot | null }) {
  const { silentChurnThresholdDays, excludeUnknownRecency } = useRetentionSettings();

  // Drill-down selection — the kebab (⋮) menu filters the donut to a single
  // tenure/age cohort. Default 'all' = whole gym (the original card behavior).
  const [selection, setSelection] = useState<AttendanceSelection>({ kind: 'all' });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the menu on outside-click / Escape (mirrors PeriodDropdown).
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [menuOpen]);

  // Donut buckets for the current selection. 'all' = whole-gym via deriveBuckets /
  // computeAttendanceHealth (the UNCHANGED original path). A tenure/age cohort reads
  // that one band's slice of the SAME classification from the existing per-band
  // computes — healthy = known − watch − silent, unknown = the band's recency-unknowns
  // — so a filtered donut can never disagree with the rate cards. `live` tracks the
  // selected dimension's data (tenure/age can be live or sample independently).
  const { result, live } = useMemo(() => {
    if (selection.kind === 'all') {
      return {
        result: snapshot
          ? deriveBuckets(snapshot, silentChurnThresholdDays)
          : computeAttendanceHealth(SAMPLE_GYM_MEMBERS, silentChurnThresholdDays, FIXTURE_TODAY),
        live: !!snapshot,
      };
    }
    if (selection.kind === 'tenure') {
      const tenureLive = !!snapshot?.tenureBands;
      const t = snapshot?.tenureBands
        ? computeChurnRiskByTenureFromAggregate(snapshot.tenureBands, silentChurnThresholdDays)
        : computeChurnRiskByTenure(SAMPLE_GYM_MEMBERS, silentChurnThresholdDays, FIXTURE_TODAY);
      const band = t.bands.find((b) => b.id === selection.bandId) ?? t.unknownTenure;
      return { result: bandBuckets(band, t.thresholdDays), live: tenureLive };
    }
    const cohortLive = !!snapshot?.cohorts;
    const c = computeChurnRiskByCohortFromAggregate(
      snapshot?.cohorts ?? SAMPLE_COHORT_HISTOGRAM,
      silentChurnThresholdDays,
    );
    const band = c.bands.find((b) => b.id === selection.bandId) ?? c.unknownCohort;
    return { result: bandBuckets(band, c.thresholdDays), live: cohortLive };
  }, [selection, snapshot, silentChurnThresholdDays]);

  const { thresholdDays, healthy, watch, silent, unknown } = result;

  // Known-active base excludes Unknown (structural blanks) — the same Option-B
  // denominator the card already used. Donut segments, center %, and every row %
  // read this base, so they always sum to 100%. Divide-by-zero guarded: an all-zero
  // known base yields a null center % (line omitted) and 0 row %s (never NaN).
  const knownActive = healthy + watch + silent;
  // Center headline = HIGH-RISK share (silent only) — the conservative signal the
  // owner acts on. The "Risk by Time as Member" / "by Age Group" cards headline the
  // SAME high-risk rate (silent / known), so a filtered donut reads the same % as
  // those cards for that cohort. The three-way legend keeps its own per-slice %.
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
          <div className="attendance-health-titlewrap">
            <h3 className="gym-card-title">Attendance Health</h3>
            {!live && <span className="gym-sample-badge">Sample data</span>}
          </div>
          <div className="action-dropdown attendance-health-menu" ref={menuRef}>
            <button
              type="button"
              className="attendance-health-kebab"
              onClick={() => setMenuOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Break attendance health down by tenure or age"
            >
              <FiMoreVertical aria-hidden="true" />
            </button>
            {menuOpen && (
              <ul className="action-dropdown-menu attendance-health-menu-panel" role="menu">
                <li>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={selection.kind === 'all'}
                    className={selection.kind === 'all' ? 'is-active' : ''}
                    onClick={() => {
                      setSelection({ kind: 'all' });
                      setMenuOpen(false);
                    }}
                  >
                    All members
                  </button>
                </li>
                <li className="action-dropdown-group" role="presentation">
                  By tenure
                </li>
                {TENURE_BANDS.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={selection.kind === 'tenure' && selection.bandId === b.id}
                      className={
                        selection.kind === 'tenure' && selection.bandId === b.id ? 'is-active' : ''
                      }
                      onClick={() => {
                        setSelection({ kind: 'tenure', bandId: b.id, label: b.label });
                        setMenuOpen(false);
                      }}
                    >
                      {b.label}
                    </button>
                  </li>
                ))}
                <li className="action-dropdown-group" role="presentation">
                  By age
                </li>
                {COHORT_BANDS.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={selection.kind === 'age' && selection.bandId === b.id}
                      className={
                        selection.kind === 'age' && selection.bandId === b.id ? 'is-active' : ''
                      }
                      onClick={() => {
                        setSelection({ kind: 'age', bandId: b.id, label: b.label });
                        setMenuOpen(false);
                      }}
                    >
                      {b.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        {selection.kind !== 'all' && (
          <p className="attendance-health-subtitle">
            {selection.kind === 'tenure' ? 'Tenure' : 'Age'}: {selection.label}
          </p>
        )}
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
// and, within each band, shows the HIGH-RISK share (silent only) at the LIVE
// resolved threshold, using the same classifyMember the Watch cards use — so the
// silent slices here re-partition the Silent Churn set rather than redefining it.
// This matches the Attendance Health donut's high-risk headline. Deterministic: the
// copy only rephrases code-computed counts and rates; it never authors the call.
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
  const titleTooltipId = useId();

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

  const { activeTotal, bands, unknownTenure } = result;

  // High-risk rate is ALWAYS over the attendance-known base (recency-unknown held
  // out): silent / knownActiveTotal. There is no full-base view.
  const heroBandId = result.heroBandIdKnown;
  const heroBand = bands.find((b) => b.id === heroBandId) ?? null;
  // High-risk rate (silent only), matching the Attendance Health donut headline —
  // NOT the at-risk (watch + silent) rate. null when the band has no known base.
  const bandRate = (b: TenureBandRisk) =>
    b.knownActiveTotal > 0 ? b.silent / b.knownActiveTotal : null;
  // Recency-unknowns held out of the known base, summed across the REAL bands.
  // (The unknownTenure bucket is a SEPARATE population — bad membershipStart, not
  // bad attendance — and is never part of any band's rate denominator.)
  const unknownRecencyTotal = bands.reduce((sum, b) => sum + b.unknownRecency, 0);

  // Bars scale to a ceiling of (max rate rounded to the nearest 10%) + 10% — not a
  // flat 100% — so the differences between cohorts read more clearly (e.g. a 57%
  // max rounds to 60%, +10% → a 70% ceiling). Value labels still show the true
  // rate; only the bar width is rescaled.
  const barRates = [
    ...bands.map(bandRate),
    unknownTenure.activeTotal > 0 ? unknownTenure.riskRate : null,
  ].filter((r): r is number => r !== null);
  const barCeiling =
    barRates.length > 0
      ? (Math.round((Math.max(...barRates) * 100) / 10) * 10 + 10) / 100
      : 1;

  // High-risk rate rendered as a Top-Traffic-Source-style bar + value: track fills
  // left-to-right to the rate (scaled to barCeiling), value right of the bar. A
  // null rate has no denominator, so there is no bar to draw — an em dash.
  const rateCell = (rate: number | null) =>
    rate === null ? (
      <span className="churn-tenure-rate-empty">—</span>
    ) : (
      <>
        <span className="churn-tenure-bar" aria-hidden="true">
          <span
            className="churn-tenure-bar-fill"
            style={{ width: `${Math.min(100, Math.round((rate / barCeiling) * 100))}%` }}
          />
        </span>
        <span className="churn-tenure-rate-val">{formatRate(rate)}</span>
      </>
    );

  return (
    <article className="card gym-card gym-card--half churn-tenure-card">
      <header className="gym-card-head">
        <div className="churn-tenure-titlerow">
          <h3 className="gym-card-title">Risk by Time as Member</h3>
          <div className="db-tooltip-wrap">
            <button
              type="button"
              className="db-tooltip-btn"
              aria-label="How tenure is measured"
              aria-describedby={titleTooltipId}
            >
              &#9432;
            </button>
            <div
              id={titleTooltipId}
              role="tooltip"
              className="db-tooltip-panel is-left is-wide churn-tenure-title-tooltip-panel"
            >
              <ul className="db-tooltip-list">
                <li className="db-tooltip-body">
                  Tenure counts from each member&rsquo;s start date in our current
                  records (Wodify&rsquo;s &ldquo;Client Since&rdquo;). Members whose
                  history predates these records can show shorter tenure than their
                  real one, and staff accounts carry account-setup dates rather than
                  member tenure.
                </li>
              </ul>
            </div>
          </div>
          {!liveAsOf && (
            <span className="gym-sample-badge">Sample data</span>
          )}
        </div>
        <p className="gym-card-subtitle">Which member stages are most at risk?</p>
      </header>

      <div className="churn-tenure-body">
        {activeTotal === 0 || !heroBand ? (
          <p className="churn-tenure-empty">No active members to analyze right now.</p>
        ) : null}

        <div className="churn-tenure-table">
          <div className="churn-tenure-head">
            <span className="churn-tenure-col churn-tenure-col--band">Tenure</span>
            <span className="churn-tenure-col churn-tenure-col--rate-head">High risk</span>
          </div>
          <ul className="churn-tenure-rows">
            {bands.map((b) => (
              <li key={b.id} className="churn-tenure-row">
                <span className="churn-tenure-col churn-tenure-col--band">{b.label}</span>
                <span className="churn-tenure-col churn-tenure-col--rate">{rateCell(bandRate(b))}</span>
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
                <span className="churn-tenure-col churn-tenure-col--rate">
                  {rateCell(unknownTenure.riskRate)}
                </span>
              </li>
            )}
          </ul>
        </div>

        {!excludeUnknownRecency && unknownRecencyTotal > 0 && (
          <p className="churn-tenure-base-note">
            High-risk rates among attendance-known members in each cohort.
          </p>
        )}
      </div>
    </article>
  );
}

// Retention by Age Group (Cohort Retention Card — RETENTION_FINISH_PLAN.md §6–§9,
// rev.3 client_status basis). Two reads in one card: Read 1 — cohort health
// (Healthy/Watch/Silent + high-risk rate per age cohort, active members), re-derived
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
  const titleTooltipId = useId();

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

  const { activeTotal, bands } = result;

  // Read 1, identical to Churn-by-Tenure: rates are always over the attendance-known
  // base (recency-unknown held out); atRisk is unchanged. No full-base view.
  const heroBandId = result.heroBandIdKnown;
  const heroBand = bands.find((b) => b.id === heroBandId) ?? null;
  // High-risk rate (silent only), matching the Attendance Health donut headline —
  // NOT the at-risk (watch + silent) rate. null when the band has no known base.
  const bandRate = (b: CohortRisk) =>
    b.knownActiveTotal > 0 ? b.silent / b.knownActiveTotal : null;
  const unknownRecencyTotal = bands.reduce((sum, b) => sum + b.unknownRecency, 0);

  // High-risk rate as a scaled bar + value, identical to Churn-by-Tenure: bars scale to
  // a ceiling of (max rate rounded to nearest 10%) + 10% so cohort differences read
  // clearly; value labels show the true rate; a null rate has no bar (em dash).
  const barRates = bands.map(bandRate).filter((r): r is number => r !== null);
  const barCeiling =
    barRates.length > 0
      ? (Math.round((Math.max(...barRates) * 100) / 10) * 10 + 10) / 100
      : 1;
  const rateCell = (rate: number | null) =>
    rate === null ? (
      <span className="cohort-age-rate-empty">—</span>
    ) : (
      <>
        <span className="cohort-age-bar" aria-hidden="true">
          <span
            className="cohort-age-bar-fill"
            style={{ width: `${Math.min(100, Math.round((rate / barCeiling) * 100))}%` }}
          />
        </span>
        <span className="cohort-age-rate-val">{formatRate(rate)}</span>
      </>
    );

  return (
    <article className="card gym-card gym-card--half cohort-age-card">
      <header className="gym-card-head">
        <div className="cohort-age-titlerow">
          <h3 className="gym-card-title">by Age Group</h3>
          <div className="db-tooltip-wrap">
            <button
              type="button"
              className="db-tooltip-btn"
              aria-label="How age groups are measured"
              aria-describedby={titleTooltipId}
            >
              &#9432;
            </button>
            <div
              id={titleTooltipId}
              role="tooltip"
              className="db-tooltip-panel is-left is-wide cohort-age-title-tooltip-panel"
            >
              <ul className="db-tooltip-list">
                <li className="db-tooltip-body">
                  Counts are aggregate age-group totals. No member names, IDs, DOBs,
                  exact ages, or individual records are stored or shown.
                </li>
                <li className="db-tooltip-body">
                  Age groups come from each member&rsquo;s date of birth (age ranges
                  only — birthdates never leave our system). &ldquo;Lapsed&rdquo;
                  counts everyone whose membership is inactive today; because inactive
                  profiles can include never-enrolled accounts (a parent/guardian,
                  staff, or a legacy profile) that skew into Adults 16+, read it as
                  &ldquo;inactive in this age group,&rdquo; not &ldquo;memberships
                  ended.&rdquo;
                </li>
              </ul>
            </div>
          </div>
          {!liveAsOf && (
            <span className="gym-sample-badge">Sample data</span>
          )}
        </div>
        <p className="gym-card-subtitle">Do kids, teens, and adults retain differently?</p>
      </header>

      <div className="cohort-age-body">
        {activeTotal === 0 || !heroBand ? (
          <p className="cohort-age-empty">No active members to analyze right now.</p>
        ) : null}

        <div className="cohort-age-table">
          <div className="cohort-age-head">
            <span className="cohort-age-col cohort-age-col--band">Age group</span>
            <span className="cohort-age-col cohort-age-col--rate-head">High risk</span>
          </div>
          <ul className="cohort-age-rows">
            {bands.map((b) => (
              <li key={b.id} className="cohort-age-row">
                <span className="cohort-age-col cohort-age-col--band">{b.label}</span>
                <span className="cohort-age-col cohort-age-col--rate">{rateCell(bandRate(b))}</span>
              </li>
            ))}
          </ul>
        </div>

        {!excludeUnknownRecency && unknownRecencyTotal > 0 && (
          <p className="cohort-age-base-note">
            High-risk rates among attendance-known members in each group.
          </p>
        )}
      </div>
    </article>
  );
}
