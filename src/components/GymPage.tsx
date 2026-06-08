// Gym › Retention — the Gym section's first real subpage (routed at
// /gym/retention; reached via the expandable Gym group in AppSidebar).
// Watch (Silent Churn, Attendance Health) and the first Patterns cards
// (Member Movement, Churn Risk by Tenure) are live sample-data cards. The
// three remaining Patterns cards stay as shells with an honest parked/blocked
// gate note — not built, gated on a data policy or API access (see
// RETENTION_FINISH_PLAN.md). Overview / Membership / Classes are hidden for now.

import { useEffect, useMemo, useState } from 'react';
import { useRetentionSettings } from '../context/RetentionSettingsContext';
import { FIXTURE_TODAY, SAMPLE_GYM_MEMBERS } from '../lib/gym/memberFixture';
import {
  WATCH_FLOOR_DAYS,
  computeAttendanceHealth,
  computeSilentChurn,
} from '../lib/gym/silentChurn';
import { computeChurnRiskByTenure } from '../lib/gym/churnRiskByTenure';
import { computeMemberMovement } from '../lib/gym/memberMovement';
import { deriveBuckets } from '../lib/gym/retentionAggregateView';
import {
  fetchLatestRetentionAggregate,
  type RetentionAggregateSnapshot,
} from '../lib/gym/fetchRetentionAggregate';

export function GymPage() {
  return (
    <div className="stack-grid">
      <div className="ta-page">
        <div className="gym-retention">
          <nav className="gym-breadcrumb" aria-label="Breadcrumb">
            <span className="gym-breadcrumb-item">Gym</span>
            <span className="gym-breadcrumb-sep" aria-hidden="true">›</span>
            <span className="gym-breadcrumb-item is-current" aria-current="page">Retention</span>
          </nav>

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
              <SilentChurnCard />
              <AttendanceHealthCard />
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
              <MemberMovementCard />
              <ChurnRiskByTenureCard />
              <GymCardShell
                modifier="gym-card--half"
                title="Churn by Age"
                subtitle="Do kids, teens, and adults retain differently?"
                gate={{
                  status: 'parked',
                  reason:
                    'Needs an age-bucket data policy (age ranges only, never birthdates) before build.',
                }}
              />
              <GymCardShell
                modifier="gym-card--full"
                title="Segment Explorer"
                subtitle="For any slice of members, what is the churn?"
                gate={{
                  status: 'parked',
                  reason:
                    'Highest-PII surface on the page — needs a data-minimization policy before build.',
                }}
              />
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

// Silent Churn hero — the Retention page's dominant live signal. Reads the
// owner-tuned threshold from the local Retention settings store and renders a
// code-computed at-risk call-list from the sample member fixture. Deterministic:
// the copy only rephrases computed numbers (count, $/mo, days absent); it never
// authors the at-risk call. Re-renders whenever the threshold changes.
function SilentChurnCard() {
  const { silentChurnThresholdDays } = useRetentionSettings();

  const result = useMemo(
    () => computeSilentChurn(SAMPLE_GYM_MEMBERS, silentChurnThresholdDays, FIXTURE_TODAY),
    [silentChurnThresholdDays],
  );

  const { thresholdDays, count, monthlyDuesAtRisk, rows } = result;

  return (
    <article className="card gym-card gym-card--hero silent-churn-card">
      <header className="gym-card-head">
        <div className="silent-churn-titlerow">
          <h3 className="gym-card-title">Silent Churn</h3>
          <span className="gym-sample-badge">Sample data</span>
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
          <div className="silent-churn-metric">
            <span className="silent-churn-metric-value">{usd(monthlyDuesAtRisk)}</span>
            <span className="silent-churn-metric-label">/mo at risk</span>
          </div>
        </div>

        {count === 0 ? (
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
              {rows.map((row) => (
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
// PR2 (RETENTION_FINISH_PLAN.md §6): this is the FIRST card wired to the live
// Wodify aggregate. On a successful read it derives the buckets from the non-PII
// daysAbsentHistogram via deriveBuckets (same WATCH_FLOOR_DAYS + threshold rule,
// precedence-correct at every threshold) and badges "Live · as of {asOf}".
// Loading / error / empty / unconfigured all fall back to the SAMPLE fixture and
// the "Sample data" badge — the live snapshot is optional, never a render error.
// Only this card goes live: Silent Churn (needs dues + a call-list the aggregate
// can't carry), Churn Risk by Tenure (needs per-member tenure) and Member Movement
// (needs a census) stay on sample, so the live Attendance Health count is NOT
// forced to agree with the sample Silent Churn hero.
function AttendanceHealthCard() {
  const { silentChurnThresholdDays } = useRetentionSettings();

  // Fetch the latest live snapshot once on mount. A successful read flips this card
  // to live; anything else (loading, no row, HTTP/parse failure, no Supabase env)
  // leaves `snapshot` null and the card stays on the sample fixture.
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
            <dd className="attendance-health-stat-value">{silent}</dd>
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
            Unknown = active members with no usable Wodify check-in date yet — a
            data-quality gap, not churn. They&rsquo;re held out of Healthy / Watch /
            Silent rather than mislabeled.
          </p>
        )}

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
function ChurnRiskByTenureCard() {
  const { silentChurnThresholdDays } = useRetentionSettings();

  const result = useMemo(
    () => computeChurnRiskByTenure(SAMPLE_GYM_MEMBERS, silentChurnThresholdDays, FIXTURE_TODAY),
    [silentChurnThresholdDays],
  );

  const { thresholdDays, activeTotal, bands, unknownTenure, heroBandId } = result;
  const heroBand = bands.find((b) => b.id === heroBandId) ?? null;

  return (
    <article className="card gym-card gym-card--full churn-tenure-card">
      <header className="gym-card-head">
        <div className="churn-tenure-titlerow">
          <h3 className="gym-card-title">Churn Risk by Tenure</h3>
          <span className="gym-sample-badge">Sample data</span>
        </div>
        <p className="gym-card-subtitle">Which tenure cohort is drifting most.</p>
      </header>

      <div className="churn-tenure-body">
        {activeTotal === 0 || !heroBand ? (
          <p className="churn-tenure-empty">No active members to analyze right now.</p>
        ) : (
          <>
            <div className="churn-tenure-hero">
              <span className="churn-tenure-hero-value">{formatRate(heroBand.riskRate)}</span>
              <span className="churn-tenure-hero-label">
                at risk in the {heroBand.label} cohort — the highest by tenure
              </span>
            </div>
            <p className="churn-tenure-helper">
              At-risk = active members on watch or silent at the {thresholdDays}-day threshold
              ({heroBand.atRisk} of {heroBand.activeTotal} active in this band).
            </p>
          </>
        )}

        <div className="churn-tenure-table">
          <div className="churn-tenure-head">
            <span className="churn-tenure-col churn-tenure-col--band">Tenure</span>
            <span className="churn-tenure-col churn-tenure-col--num">Active</span>
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
                <span className="churn-tenure-col churn-tenure-col--num">{b.activeTotal}</span>
                <span className="churn-tenure-col churn-tenure-col--num">{b.atRisk}</span>
                <span className="churn-tenure-col churn-tenure-col--num">{formatRate(b.riskRate)}</span>
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
      </div>
    </article>
  );
}

// Member Movement — the Patterns card that turns the member layer into a
// snapshot of the base: a current status CENSUS (active / paused / ended) and
// INTAKE by join half-year. Deliberately NOT a movement-over-time card — the
// fixture carries only a current status and a membershipStart, with no dated
// status changes, so any net-flow / cancellation trend would be invented history
// (RETENTION_FINISH_PLAN items 5–6). This card classifies no risk: it uses no
// threshold and no classifyMember, so it has no asOf and no anti-drift check.
// Deterministic — the copy only rephrases code-computed counts.
function MemberMovementCard() {
  const { census, cohorts, unknownJoin } = useMemo(
    () => computeMemberMovement(SAMPLE_GYM_MEMBERS),
    [],
  );

  return (
    <article className="card gym-card gym-card--full member-movement-card">
      <header className="gym-card-head">
        <div className="member-movement-titlerow">
          <h3 className="gym-card-title">Member Movement</h3>
          <span className="gym-sample-badge">Sample data</span>
        </div>
        <p className="gym-card-subtitle">Current member mix and when they joined.</p>
      </header>

      <div className="member-movement-body">
        {/* Census — raw current status tally (active / paused / ended). */}
        <div className="member-movement-hero">
          <span className="member-movement-hero-value">{census.active}</span>
          <span className="member-movement-hero-label">
            {census.active === 1 ? 'active member today' : 'active members today'}
          </span>
        </div>
        <p className="member-movement-helper">
          Current mix of a {census.total}-member base.
        </p>

        <dl className="member-movement-census">
          <div className="member-movement-stat member-movement-stat--active">
            <dt className="member-movement-stat-label">Active</dt>
            <dd className="member-movement-stat-value">{census.active}</dd>
          </div>
          <div className="member-movement-stat member-movement-stat--paused">
            <dt className="member-movement-stat-label">Paused</dt>
            <dd className="member-movement-stat-value">{census.paused}</dd>
          </div>
          <div className="member-movement-stat member-movement-stat--ended">
            <dt className="member-movement-stat-label">Ended</dt>
            <dd className="member-movement-stat-value">{census.ended}</dd>
          </div>
        </dl>

        {/* Intake by join half-year — ALL members by membershipStart. A join
            timeline (honestly computable from one field), not a status-movement
            series. */}
        <div className="member-movement-intake">
          <p className="member-movement-intake-title">Joins by cohort</p>
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
