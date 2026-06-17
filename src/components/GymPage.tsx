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
import { computeMemberMovement } from '../lib/gym/memberMovement';
import { deriveBuckets } from '../lib/gym/retentionAggregateView';
import { buildRetentionRateView, pickRateFacet } from '../lib/gym/retentionRates';
import {
  DUES_STALE_AFTER_DAYS,
  deriveSilentChurnDuesView,
  type SilentChurnDuesView,
} from '../lib/gym/silentChurnDuesView';
import {
  fetchLatestRetentionAggregate,
  type RetentionAggregateSnapshot,
} from '../lib/gym/fetchRetentionAggregate';

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
          <div className="ta-page-header">
            <h1 className="ta-page-title">Retention</h1>
            <p className="ta-page-subtitle">
              Where are we losing members, how much money is at risk, and what patterns explain the loss?
            </p>
          </div>

          {/* WATCH — live signals; Silent Churn is the dominant hero, Attendance
              Health a full-width secondary below it. */}
          <section className="gym-section">
            <div className="gym-section-header">
              <h2 className="gym-section-title">Watch</h2>
              <p className="gym-section-helper">Live signals to act on this week.</p>
            </div>
            <div className="gym-card-grid">
              <SilentChurnCard snapshot={snapshot} />
              <AttendanceHealthCard snapshot={snapshot} />
            </div>
          </section>

          {/* PATTERNS — monthly trends. Member Movement full width, Tenure + Age
              paired on desktop, Segment Explorer full width, Churn by Belt a
              recessed full-width card at the bottom (data not connected yet). */}
          <section className="gym-section">
            <div className="gym-section-header">
              <h2 className="gym-section-title">Patterns</h2>
              <p className="gym-section-helper">Monthly trends that explain where churn is happening.</p>
            </div>
            <div className="gym-card-grid">
              <MemberMovementCard snapshot={snapshot} />
              <ChurnRiskByTenureCard snapshot={snapshot} />
              <CohortRetentionCard snapshot={snapshot} />
              <SegmentExplorerCard snapshot={snapshot} />
              <GymCardShell
                modifier="gym-card--full gym-card--recessed"
                title="Churn by Belt"
                subtitle="Data not connected yet."
                gate={{
                  status: 'blocked',
                  reason:
                    'Belt/rank data is API-gated at the current Wodify tier (403) — not a sample-data gap.',
                }}
              />
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

// The universal Unknown disclosure (Option B). Always renders when the card has an
// unknown bucket, in BOTH toggle states — never silently drop the unknown. The
// inline affordance flips the shared `includeUnknown` view toggle (the same state
// the Settings switch drives). Rendered nothing when the card has no unknowns
// (e.g. the clean sample fixture), where known base === full base.
function UnknownToggleNote({
  count,
  includeUnknown,
  setIncludeUnknown,
  className = 'gym-unknown-note',
  descriptor = 'unknown',
  target = 'these rates',
}: {
  count: number;
  includeUnknown: boolean;
  setIncludeUnknown: (value: boolean) => void;
  className?: string;
  descriptor?: string; // how to name the bucket, e.g. 'unknown' / 'unrecognized-status'
  target?: string; // what they are held out of, e.g. 'these rates' / 'the member base'
}) {
  if (count <= 0) return null;
  const noun = count === 1 ? 'member' : 'members';
  return (
    <p className={className}>
      {includeUnknown
        ? `Including ${count} ${descriptor} ${noun} in ${target}.`
        : `${count} ${descriptor} ${noun} held out of ${target}.`}{' '}
      <button
        type="button"
        className="gym-unknown-toggle"
        onClick={() => setIncludeUnknown(!includeUnknown)}
      >
        {includeUnknown ? 'show known-only' : 'include'}
      </button>
    </p>
  );
}

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
// tally on the same snapshot) and badges "Live · as of {asOf}". The live DOLLAR
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
  const { silentChurnThresholdDays, includeUnknown, setIncludeUnknown } = useRetentionSettings();
  const duesTooltipId = useId();
  const setupTooltipId = useId();

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
  // Silent as a share of the chosen base (default OFF = attendance-known actives).
  const silentRateView = buildRetentionRateView(
    count,
    view.knownActive,
    view.unknown,
    'attendance-known actives',
  );
  const silentFacet = pickRateFacet(silentRateView, includeUnknown);

  return (
    <article className="card gym-card gym-card--hero silent-churn-card">
      <header className="gym-card-head">
        <div className="silent-churn-titlerow">
          <h3 className="gym-card-title">Silent Churn</h3>
          {view.live ? (
            <span className="gym-sample-badge gym-live-badge">Live · as of {view.asOf}</span>
          ) : (
            <span className="gym-sample-badge">Sample data</span>
          )}
        </div>
        <p className="gym-card-subtitle">Still paying, not showing up.</p>
      </header>

      <div className="silent-churn-body">
        <p className="silent-churn-helper">
          Active members with no check-ins for {thresholdDays}+ days.
        </p>

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
            {formatRate(silentFacet.rate)} of{' '}
            {includeUnknown
              ? `all ${silentFacet.base} actives`
              : `${silentFacet.base} attendance-known actives`}
          </p>
        )}
        <UnknownToggleNote
          count={view.unknown}
          includeUnknown={includeUnknown}
          setIncludeUnknown={setIncludeUnknown}
          className="silent-churn-unknown-note"
        />

        {view.live ? (
          <>
            {view.dues.kind === 'shown' ? (
              // A <div>, not <p>: the tooltip panel inside is a <div> with a <ul>,
              // which is invalid HTML inside a paragraph (PR-3b nesting fix; the
              // CSS targets the class, tag-agnostic).
              <div className="silent-churn-dues-meta">
                Dues known for {view.dues.duesKnownCount} of {view.dues.silentMembers} silent
                members · dues from {view.dues.duesAsOf} export
                <span className="db-tooltip-wrap silent-churn-dues-tipwrap">
                  <button
                    type="button"
                    className="db-tooltip-btn"
                    aria-label="How monthly dues at risk is computed"
                    aria-describedby={duesTooltipId}
                  >
                    &#9432;
                  </button>
                  <div
                    id={duesTooltipId}
                    role="tooltip"
                    className="db-tooltip-panel is-left silent-churn-dues-tooltip-panel"
                  >
                    <ul className="db-tooltip-list">
                      <li className="db-tooltip-body">
                        A floor, not a ceiling — memberships whose monthly value can&rsquo;t be
                        derived are excluded.
                      </li>
                      <li className="db-tooltip-body">
                        Computed at the {view.dues.thresholdDays}-day threshold against the{' '}
                        {view.dues.duesAsOf} dues export.
                      </li>
                    </ul>
                  </div>
                </span>
              </div>
            ) : (
              <p className="silent-churn-dues-na">{duesHiddenLine(view.dues, thresholdDays)}</p>
            )}
            {count === 0 && (
              <p className="silent-churn-empty">
                No active members have been away for {thresholdDays}+ days right now.
              </p>
            )}
            {/* Wodify bridge (live only): the per-member list the non-PII aggregate
                can't carry lives in Wodify, the system of record. Copy frames the
                report as LIVE vs this card's dated snapshot — never a count-equality
                promise. Rendered in every live dues state and at count 0: the
                snapshot doesn't govern Wodify. The sample branch keeps its fixture
                call-list instead. */}
            <div className="silent-churn-action">
              <p className="silent-churn-action-line">
                See the current silent-member list in Wodify — it&rsquo;s live, so it can
                differ from this card&rsquo;s {view.asOf} snapshot.
              </p>
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
                <span className="db-tooltip-wrap silent-churn-setup-tipwrap">
                  <button
                    type="button"
                    className="db-tooltip-btn"
                    aria-label="How to set up the Wodify report"
                    aria-describedby={setupTooltipId}
                  >
                    &#9432;
                  </button>
                  <div
                    id={setupTooltipId}
                    role="tooltip"
                    className="db-tooltip-panel is-left silent-churn-setup-tooltip-panel"
                  >
                    <ul className="db-tooltip-list">
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
                    </ul>
                  </div>
                </span>
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
// precedence-correct at every threshold) and badges "Live · as of {asOf}". The
// `snapshot` is fetched ONCE at page level (GymPage) and passed to both Watch
// cards, so this card's live "Silent" bucket and the live Silent Churn count read
// the SAME snapshot and agree by construction. Loading / error / empty /
// unconfigured all fall back to the SAMPLE fixture and the "Sample data" badge —
// the live snapshot is optional, never a render error. Churn Risk by Tenure now
// reads the same snapshot's per-band tenure histogram (§6 aggregate extension);
// Member Movement's census reads it too (its intake stays sample).
function AttendanceHealthCard({ snapshot }: { snapshot: RetentionAggregateSnapshot | null }) {
  const { silentChurnThresholdDays, includeUnknown, setIncludeUnknown } = useRetentionSettings();

  // One render path for both sources: deriveBuckets (live histogram) and
  // computeAttendanceHealth (sample fixture) return the SAME H/W/S/unknown shape,
  // re-cut at the owner's CURRENT threshold whenever it changes.
  const result = useMemo(
    () =>
      snapshot
        ? deriveBuckets(snapshot, silentChurnThresholdDays)
        : computeAttendanceHealth(SAMPLE_GYM_MEMBERS, silentChurnThresholdDays, FIXTURE_TODAY),
    [snapshot, silentChurnThresholdDays],
  );

  const { thresholdDays, healthy, watch, silent, unknown } = result;

  // Option B rates — known base = healthy + watch + silent (activeTotal − unknown).
  // Counts above are unchanged; these only add a denominator/rate view.
  const knownActive = healthy + watch + silent;
  const atRiskFacet = pickRateFacet(
    buildRetentionRateView(watch + silent, knownActive, unknown, 'attendance-known actives'),
    includeUnknown,
  );
  const silentFacet = pickRateFacet(
    buildRetentionRateView(silent, knownActive, unknown, 'attendance-known actives'),
    includeUnknown,
  );

  // Copy reads the RESOLVED threshold (result.thresholdDays), never the raw
  // setting. The Watch band is [WATCH_FLOOR_DAYS, thresholdDays − 1]. When the
  // threshold is at/below the watch floor the band is empty by construction
  // (watch is always 0), so guard the helper to never render an inverted "8–7".
  const watchUpper = thresholdDays - 1;
  const helper =
    thresholdDays <= WATCH_FLOOR_DAYS
      ? `Active members nearing the ${thresholdDays}-day Silent Churn threshold.`
      : watchUpper === WATCH_FLOOR_DAYS
        ? `Active members at ${WATCH_FLOOR_DAYS} days since last check-in.`
        : `Active members ${WATCH_FLOOR_DAYS}–${watchUpper} days since last check-in.`;

  return (
    <article className="card gym-card gym-card--full attendance-health-card">
      <header className="gym-card-head">
        <div className="attendance-health-titlerow">
          <h3 className="gym-card-title">Attendance Health</h3>
          {snapshot ? (
            <span className="gym-sample-badge gym-live-badge">Live · as of {snapshot.asOf}</span>
          ) : (
            <span className="gym-sample-badge">Sample data</span>
          )}
        </div>
        <p className="gym-card-subtitle">Early warning before silent churn.</p>
      </header>

      <div className="attendance-health-body">
        {watch === 0 ? (
          <p className="attendance-health-empty">
            No active members are drifting toward the {thresholdDays}-day threshold right now.
          </p>
        ) : (
          <>
            <div className="attendance-health-hero">
              <span className="attendance-health-hero-value">{watch}</span>
              <span className="attendance-health-hero-label">
                {watch === 1 ? 'member on watch' : 'members on watch'}
              </span>
            </div>
            <p className="attendance-health-helper">{helper}</p>
          </>
        )}

        {atRiskFacet.base > 0 && (
          <p className="attendance-health-rate">
            {formatRate(atRiskFacet.rate)} of{' '}
            {includeUnknown
              ? `all ${atRiskFacet.base} actives`
              : `${atRiskFacet.base} attendance-known actives`}{' '}
            are drifting or silent.
          </p>
        )}

        <dl className="attendance-health-breakdown">
          <div className="attendance-health-stat attendance-health-stat--healthy">
            <dt className="attendance-health-stat-label">Healthy</dt>
            <dd className="attendance-health-stat-value">{healthy}</dd>
          </div>
          <div className="attendance-health-stat attendance-health-stat--watch">
            <dt className="attendance-health-stat-label">Watch</dt>
            <dd className="attendance-health-stat-value">{watch}</dd>
          </div>
          <div className="attendance-health-stat attendance-health-stat--silent">
            <dt className="attendance-health-stat-label">Silent</dt>
            <dd className="attendance-health-stat-value">
              {silent}
              <span className="attendance-health-stat-rate"> · {formatRate(silentFacet.rate)}</span>
            </dd>
          </div>
          {unknown > 0 && (
            <div className="attendance-health-stat attendance-health-stat--unknown">
              <dt className="attendance-health-stat-label">Unknown</dt>
              <dd className="attendance-health-stat-value">{unknown}</dd>
            </div>
          )}
        </dl>

        {unknown > 0 && (
          <p className="attendance-health-dataquality">
            Unknown = active accounts with no Wodify attendance or class sign-in
            on record — typically guardian/parent billing accounts (the child
            trains; the paying adult never signs in), staff accounts, or legacy
            members from before digital check-in. Structural blanks, not churn —
            held out of Healthy / Watch / Silent rather than mislabeled.
          </p>
        )}

        <UnknownToggleNote
          count={unknown}
          includeUnknown={includeUnknown}
          setIncludeUnknown={setIncludeUnknown}
          className="attendance-health-unknown-note"
        />

        {watch > 0 && (
          <p className="attendance-health-takeaway">
            Drifting, but haven&rsquo;t crossed the Silent Churn threshold yet.
          </p>
        )}
      </div>
    </article>
  );
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
// computeChurnRiskByTenureFromAggregate (deriveBuckets per band, one hero rule)
// and badges "Live · as of {asOf}". Σ band silent here === the live Silent Churn
// count at the same threshold by construction. A snapshot without tenure data
// (pre-migration row, or a contract mismatch) falls back to the sample fixture —
// the tenure flip is data-gated, not deploy-gated. The live caveat note carries
// the two disclosed member_since caveats (records-era undercount; staff
// accounts) — honesty notes, not defects.
function ChurnRiskByTenureCard({ snapshot }: { snapshot: RetentionAggregateSnapshot | null }) {
  const { silentChurnThresholdDays, includeUnknown, setIncludeUnknown } = useRetentionSettings();

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

  // Option B: default to the attendance-known base (de-diluted per-band rates);
  // the toggle restores the full base. The hero re-selects per base and can
  // legitimately differ (de-diluting promotes the cohort with the most
  // recency-unknowns). atRisk is unchanged in both states — only the denominator
  // and rate move. The displayed Active column tracks the chosen denominator so
  // the row reconciles (atRisk / Active === Risk rate).
  const heroBandId = includeUnknown ? result.heroBandId : result.heroBandIdKnown;
  const heroBand = bands.find((b) => b.id === heroBandId) ?? null;
  const bandActive = (b: TenureBandRisk) => (includeUnknown ? b.activeTotal : b.knownActiveTotal);
  const bandRate = (b: TenureBandRisk) => (includeUnknown ? b.riskRate : b.riskRateKnown);
  // Recency-unknowns held out of the known base, summed across the REAL bands.
  // (The unknownTenure bucket is a SEPARATE population — bad membershipStart, not
  // bad attendance — and is never part of any band's rate denominator.)
  const unknownRecencyTotal = bands.reduce((sum, b) => sum + b.unknownRecency, 0);

  return (
    <article className="card gym-card gym-card--full churn-tenure-card">
      <header className="gym-card-head">
        <div className="churn-tenure-titlerow">
          <h3 className="gym-card-title">Churn Risk by Tenure</h3>
          {liveAsOf ? (
            <span className="gym-sample-badge gym-live-badge">Live · as of {liveAsOf}</span>
          ) : (
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
              ({heroBand.atRisk} of {bandActive(heroBand)}{' '}
              {includeUnknown ? 'active' : 'attendance-known'} in this band).
            </p>
          </>
        )}

        <div className="churn-tenure-table">
          <div className="churn-tenure-head">
            <span className="churn-tenure-col churn-tenure-col--band">Tenure</span>
            <span className="churn-tenure-col churn-tenure-col--num">
              {includeUnknown ? 'Active' : 'Tracked'}
            </span>
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

        {unknownRecencyTotal > 0 && (
          <p className="churn-tenure-base-note">
            {includeUnknown
              ? 'Rates over each cohort’s full active base.'
              : 'Rates among attendance-known members in each cohort.'}
          </p>
        )}
        <UnknownToggleNote
          count={unknownRecencyTotal}
          includeUnknown={includeUnknown}
          setIncludeUnknown={setIncludeUnknown}
          className="churn-tenure-unknown-note"
        />

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

// k→1 suppression for the Read-2 lapsed cells, with COMPLEMENTARY suppression: a
// lone masked cell is recoverable as (the published Member Movement inactive total
// − the visible cohort cells), so whenever ANY lapsed cell is masked, at least two
// are — the lone small cell can't be backed out by subtraction. Returns the set of
// cohort ids whose lapsed count must render as "<5". (Run-time ≈1 verification +
// any further remedy is a WO-2 run concern.)
const LAPSED_SUPPRESS_BELOW = 5;
function maskedLapsedIds(cells: { id: string; lapsed: number }[]): Set<string> {
  const masked = new Set<string>();
  for (const c of cells) {
    if (c.lapsed > 0 && c.lapsed < LAPSED_SUPPRESS_BELOW) masked.add(c.id);
  }
  if (masked.size === 1) {
    const next = cells
      .filter((c) => !masked.has(c.id) && c.lapsed > 0)
      .sort((a, b) => a.lapsed - b.lapsed)[0];
    if (next) masked.add(next.id);
  }
  return masked;
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
// build's COHORT_BANDS — see fetchRetentionAggregate) it badges "Live · as of
// {asOf}"; otherwise it renders the clearly-synthetic SAMPLE_COHORT_HISTOGRAM
// through the SAME adapter (the shared member fixture has no DOB, so the sample is
// a static histogram, not a fixture compute). The cohort flip is data-gated.
//
// §7 STRUCTURAL-HONESTY caveat (footer): client_status Inactive has no
// never-membered guard — the never-membered (guardian/staff/legacy) population
// skews into Adults 16+ — so cohort-lapsed must never be read as "memberships
// ended." Copy over the deterministic numbers; the card never authors the call.
function CohortRetentionCard({ snapshot }: { snapshot: RetentionAggregateSnapshot | null }) {
  const { silentChurnThresholdDays, includeUnknown, setIncludeUnknown } = useRetentionSettings();

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

  // Read 1 known-base toggle, identical to Churn-by-Tenure: the hero re-selects per
  // base, atRisk is unchanged, only the denominator + rate move.
  const heroBandId = includeUnknown ? result.heroBandId : result.heroBandIdKnown;
  const heroBand = bands.find((b) => b.id === heroBandId) ?? null;
  const bandActive = (b: CohortRisk) => (includeUnknown ? b.activeTotal : b.knownActiveTotal);
  const bandRate = (b: CohortRisk) => (includeUnknown ? b.riskRate : b.riskRateKnown);
  const unknownRecencyTotal = bands.reduce((sum, b) => sum + b.unknownRecency, 0);

  // Read 2 lapsed cells with complementary k→1 suppression (see maskedLapsedIds).
  const lapsedMasked = useMemo(
    () => maskedLapsedIds([...bands, unknownCohort]),
    [bands, unknownCohort],
  );
  const lapsedCell = (b: CohortRisk) => (lapsedMasked.has(b.id) ? '<5' : String(b.lapsed));

  // The unknown-cohort row renders only when it carries members (active or lapsed),
  // matching the unknown-tenure row's "surface, don't fabricate" rule.
  const showUnknownRow = unknownCohort.activeTotal > 0 || unknownCohort.lapsed > 0;

  return (
    <article className="card gym-card gym-card--full cohort-age-card">
      <header className="gym-card-head">
        <div className="cohort-age-titlerow">
          <h3 className="gym-card-title">Retention by Age Group</h3>
          {liveAsOf ? (
            <span className="gym-sample-badge gym-live-badge">Live · as of {liveAsOf}</span>
          ) : (
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
              ({heroBand.atRisk} of {bandActive(heroBand)}{' '}
              {includeUnknown ? 'active' : 'attendance-known'} in this group). Lapsed = members
              whose membership is inactive today.
            </p>
          </>
        )}

        <div className="cohort-age-table">
          <div className="cohort-age-head">
            <span className="cohort-age-col cohort-age-col--band">Age group</span>
            <span className="cohort-age-col cohort-age-col--num">
              {includeUnknown ? 'Active' : 'Tracked'}
            </span>
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
                <span className="cohort-age-col cohort-age-col--num">{lapsedCell(b)}</span>
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
                <span className="cohort-age-col cohort-age-col--num">{lapsedCell(unknownCohort)}</span>
              </li>
            )}
          </ul>
        </div>

        {unknownRecencyTotal > 0 && (
          <p className="cohort-age-base-note">
            {includeUnknown
              ? 'At-risk rates over each group’s full active base.'
              : 'At-risk rates among attendance-known members in each group.'}
          </p>
        )}
        <UnknownToggleNote
          count={unknownRecencyTotal}
          includeUnknown={includeUnknown}
          setIncludeUnknown={setIncludeUnknown}
          className="cohort-age-unknown-note"
        />

        <p className="cohort-age-suppression-note">
          A &ldquo;Lapsed&rdquo; count under 5 is hidden (shown as &ldquo;&lt;5&rdquo;) to protect
          individuals. Whenever one is hidden, at least one other cell is hidden too so the small
          count can&rsquo;t be backed out, which means a &ldquo;&lt;5&rdquo; may stand for a larger
          real value — not a near-zero.
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
// threshold + includeUnknown from RetentionSettings, fed through the pure
// buildSegmentExplorerView adapter (Healthy subtraction, per-row rate, <5 cell
// suppression). Honest labels: it is a cross-SECTION of today's actives — not a
// journey over time — and long-tenure rows show survivors only (footer).
function SegmentExplorerCard({ snapshot }: { snapshot: RetentionAggregateSnapshot | null }) {
  const { silentChurnThresholdDays, includeUnknown, setIncludeUnknown } = useRetentionSettings();

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

  const view = useMemo(() => buildSegmentExplorerView(result, includeUnknown), [result, includeUnknown]);
  const { thresholdDays, activeTotal, rows, unknownRecencyTotal } = view;

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
          {liveAsOf ? (
            <span className="gym-sample-badge gym-live-badge">Live · as of {liveAsOf}</span>
          ) : (
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
              {RECENCY_STAGES.map((s) => (
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
                <span className="segment-explorer-colsub">
                  {includeUnknown ? 'full base' : 'known base'}
                </span>
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
                  {row.cells.map((cell) => (
                    <span
                      key={cell.stage}
                      className="segment-explorer-col segment-explorer-col--num"
                      role="cell"
                    >
                      {cell.masked ? (
                        <span
                          className="segment-explorer-masked"
                          title="Hidden to protect small groups (fewer than 5 members)"
                        >
                          &lt;5
                        </span>
                      ) : (
                        cell.count
                      )}
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

        <UnknownToggleNote
          count={unknownRecencyTotal}
          includeUnknown={includeUnknown}
          setIncludeUnknown={setIncludeUnknown}
          className="segment-explorer-unknown-note"
          descriptor="unknown-recency"
          target="the at-risk rates"
        />

        <p className="segment-explorer-suppression-note">
          Cells with fewer than 5 members are hidden (shown as &ldquo;&lt;5&rdquo;) to protect
          individuals.
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

// Member Movement — the Patterns card that turns the member layer into a
// snapshot of the base: a current status CENSUS (active / inactive) and INTAKE
// by join half-year. The census is BINARY (§6 rescope 2026-06-10): the vocab
// gate proved Wodify's client_status is exactly Active/Inactive, and the
// field-discovery probe proved no other /clients field separates paused from
// ended — so a 3-way active/paused/ended census is unsourceable and was RETIRED,
// not deferred. Deliberately NOT a movement-over-time card — the fixture carries
// only a current status and a membershipStart, with no dated status changes, so
// any net-flow / cancellation trend would be invented history
// (RETENTION_FINISH_PLAN items 5–6). This card classifies no risk: it uses no
// threshold and no classifyMember, so it has no asOf and no anti-drift check.
// Deterministic — the copy only rephrases code-computed counts.
//
// §6 live wiring: the CENSUS reads the live aggregate's active/inactive counts
// when the snapshot carries them (badging "Live · as of {asOf}"); the INTAKE stays
// sample (membershipStart isn't on /clients). A pre-census live row (inactive_total
// null/absent) falls back to the sample census — never a fabricated zero census.
// A nonzero unknown-status count is surfaced (honesty parity with Attendance
// Health's Unknown) rather than silently folded into either census bucket.
function MemberMovementCard({ snapshot }: { snapshot: RetentionAggregateSnapshot | null }) {
  const { includeUnknown, setIncludeUnknown } = useRetentionSettings();

  // Intake (joins-by-cohort) is ALWAYS sample: membershipStart isn't on /clients, so
  // the non-PII live aggregate can't carry a join timeline. The census
  // (active/inactive) DOES go live when the snapshot carries the §6 census column.
  const sample = useMemo(() => computeMemberMovement(SAMPLE_GYM_MEMBERS), []);

  // Live census only when the census column is present (not null) on the snapshot.
  // A pre-census live row (inactive_total absent → null) falls back to the sample
  // census, so we never render a fabricated zero census off a live-but-pre-census row.
  // `unknown` joins the total so the rendered mix always sums to the scanned base.
  const view = useMemo(() => {
    if (snapshot && snapshot.inactiveTotal !== null) {
      const { activeTotal, inactiveTotal, unknownStatus, asOf } = snapshot;
      return {
        live: true as const,
        asOf,
        census: {
          active: activeTotal,
          inactive: inactiveTotal,
          unknown: unknownStatus,
          total: activeTotal + inactiveTotal + unknownStatus,
        },
      };
    }
    // Sample fixture statuses are all recognized, so its census has no unknown.
    return { live: false as const, census: { ...sample.census, unknown: 0 } };
  }, [snapshot, sample]);

  const { census } = view;
  const { cohorts, unknownJoin } = sample; // intake stays sample in both modes

  // Option B: MM's unknown is unrecognized client_status (census.unknown). Default
  // OFF drops it from the displayed base (active + inactive). Inert while it is 0
  // live, but correct once a snapshot carries unmappable statuses. The active/
  // inactive/unknown COUNTS are unchanged — only the base denominator moves.
  const displayBase = includeUnknown ? census.total : census.active + census.inactive;

  return (
    <article className="card gym-card gym-card--full member-movement-card">
      <header className="gym-card-head">
        <div className="member-movement-titlerow">
          <h3 className="gym-card-title">Member Movement</h3>
          {view.live ? (
            <span className="gym-sample-badge gym-live-badge">Live · as of {view.asOf}</span>
          ) : (
            <span className="gym-sample-badge">Sample data</span>
          )}
        </div>
        <p className="gym-card-subtitle">Current member mix and when they joined.</p>
      </header>

      <div className="member-movement-body">
        {/* Census — raw current status tally (active / inactive, §6 binary rescope). */}
        <div className="member-movement-hero">
          <span className="member-movement-hero-value">{census.active}</span>
          <span className="member-movement-hero-label">
            {census.active === 1 ? 'active member today' : 'active members today'}
          </span>
        </div>
        <p className="member-movement-helper">
          Current mix of a {displayBase}-member base
          {includeUnknown && census.unknown > 0 ? ' (incl. unrecognized status)' : ''}.
        </p>

        <dl className="member-movement-census">
          <div className="member-movement-stat member-movement-stat--active">
            <dt className="member-movement-stat-label">Active</dt>
            <dd className="member-movement-stat-value">{census.active}</dd>
          </div>
          <div className="member-movement-stat member-movement-stat--inactive">
            <dt className="member-movement-stat-label">Inactive</dt>
            <dd className="member-movement-stat-value">{census.inactive}</dd>
          </div>
          {census.unknown > 0 && (
            <div className="member-movement-stat member-movement-stat--unknown">
              <dt className="member-movement-stat-label">Unknown</dt>
              <dd className="member-movement-stat-value">{census.unknown}</dd>
            </div>
          )}
        </dl>

        <UnknownToggleNote
          count={census.unknown}
          includeUnknown={includeUnknown}
          setIncludeUnknown={setIncludeUnknown}
          className="member-movement-unknown-note"
          descriptor="unrecognized-status"
          target="the member base"
        />

        {/* Verified 2026-06-10 (Wodify admin UI): members with a running membership
            hold keep client status Active — they never appear under Inactive. The
            "On hold" badge is Wodify-UI-only (no /clients field carries it, per the
            field-discovery probe), so the binary census can assert this safely. */}
        <p className="member-movement-census-note">
          Counts reflect Wodify&rsquo;s client status: members with a membership on
          hold stay Active in Wodify, so Active includes them — Inactive is members
          whose membership has ended or lapsed.
        </p>

        {census.unknown > 0 && (
          <p className="member-movement-dataquality">
            Unknown = members whose Wodify status isn&rsquo;t a recognized Active /
            Inactive value — a data-quality gap, held out of the census rather than
            guessed into a bucket.
          </p>
        )}

        {/* Intake by join half-year — ALL members by membershipStart. A join
            timeline (honestly computable from one field), not a status-movement
            series. */}
        <div className="member-movement-intake">
          <p className="member-movement-intake-title">Joins by cohort</p>
          {view.live && (
            <p className="member-movement-helper">
              Join history isn&rsquo;t in the live data source yet — sample shown.
            </p>
          )}
          {cohorts.length === 0 ? (
            <p className="member-movement-empty">No recorded join dates to chart right now.</p>
          ) : (
            <div className="member-movement-table">
              <div className="member-movement-head">
                <span className="member-movement-col member-movement-col--cohort">Joined</span>
                <span className="member-movement-col member-movement-col--num">Joins</span>
              </div>
              <ul className="member-movement-rows">
                {cohorts.map((cohort) => (
                  <li key={cohort.id} className="member-movement-row">
                    <span className="member-movement-col member-movement-col--cohort">{cohort.label}</span>
                    <span className="member-movement-col member-movement-col--num">{cohort.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {unknownJoin > 0 && (
            <p className="member-movement-helper">
              {unknownJoin === 1
                ? '1 member with no recorded join date.'
                : `${unknownJoin} members with no recorded join date.`}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

// Empty card shell — title + subtitle + a single placeholder body. Deliberately
// has no internals (no charts, tables, filters, metrics, or state logic).
// An optional `gate` swaps the generic "not built yet" placeholder for an honest
// parked/blocked note naming why the card isn't built. It stays a shell — still
// no internals — and the muted note is deliberately NOT the amber "Sample data"
// badge, because these cards have no fixture data behind them.
function GymCardShell({
  title,
  subtitle,
  modifier,
  gate,
}: {
  title: string;
  subtitle: string;
  modifier?: string;
  gate?: { status: 'parked' | 'blocked'; reason: string };
}) {
  return (
    <article className={`card gym-card${modifier ? ` ${modifier}` : ''}`}>
      <header className="gym-card-head">
        <h3 className="gym-card-title">{title}</h3>
        <p className="gym-card-subtitle">{subtitle}</p>
      </header>
      <div className="gym-card-body">
        {gate ? (
          <div className="gym-card-gate">
            <span className={`gym-card-gate-badge gym-card-gate-badge--${gate.status}`}>
              {gate.status === 'parked' ? 'Parked' : 'Blocked'}
            </span>
            <p className="gym-card-gate-reason">{gate.reason}</p>
          </div>
        ) : (
          <p className="gym-card-placeholder">Card content — not built yet</p>
        )}
      </div>
    </article>
  );
}
