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
} from '../lib/gym/churnRiskByTenure';
import { computeMemberMovement } from '../lib/gym/memberMovement';
import { deriveBuckets } from '../lib/gym/retentionAggregateView';
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
  const { silentChurnThresholdDays } = useRetentionSettings();
  const duesTooltipId = useId();

  // One render path for both sources (mirrors AttendanceHealthCard). Live: derive
  // the silent COUNT from the non-PII histogram, plus the dues view gated against
  // the RESOLVED threshold deriveBuckets cut at (never the raw setting). Sample:
  // the full classifier result (count + dollars + call-list). The discriminated
  // `live` flag keeps the sample-only fields (rows, monthlyDuesAtRisk) off the
  // live branch entirely.
  const view = useMemo(() => {
    if (snapshot) {
      const { thresholdDays, silent } = deriveBuckets(snapshot, silentChurnThresholdDays);
      const dues = deriveSilentChurnDuesView(snapshot.dues, snapshot.asOf, thresholdDays);
      return { live: true as const, thresholdDays, count: silent, asOf: snapshot.asOf, dues };
    }
    const { thresholdDays, count, monthlyDuesAtRisk, rows } = computeSilentChurn(
      SAMPLE_GYM_MEMBERS,
      silentChurnThresholdDays,
      FIXTURE_TODAY,
    );
    return { live: false as const, thresholdDays, count, monthlyDuesAtRisk, rows };
  }, [snapshot, silentChurnThresholdDays]);

  const { thresholdDays, count } = view;

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

        {view.live ? (
          <>
            {view.dues.kind === 'shown' ? (
              <p className="silent-churn-dues-meta">
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
              </p>
            ) : (
              <p className="silent-churn-dues-na">{duesHiddenLine(view.dues, thresholdDays)}</p>
            )}
            {count === 0 && (
              <p className="silent-churn-empty">
                No active members have been away for {thresholdDays}+ days right now.
              </p>
            )}
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
  const { silentChurnThresholdDays } = useRetentionSettings();

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
            Unknown = active accounts with no Wodify attendance or class sign-in
            on record — typically guardian/parent billing accounts (the child
            trains; the paying adult never signs in), staff accounts, or legacy
            members from before digital check-in. Structural blanks, not churn —
            held out of Healthy / Watch / Silent rather than mislabeled.
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
  const { silentChurnThresholdDays } = useRetentionSettings();

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

  const { thresholdDays, activeTotal, bands, unknownTenure, heroBandId } = result;
  const heroBand = bands.find((b) => b.id === heroBandId) ?? null;

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
          Current mix of a {census.total}-member base.
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
