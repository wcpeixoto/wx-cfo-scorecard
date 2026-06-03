// Gym › Retention — the Gym section's first real subpage (routed at
// /gym/retention; reached via the expandable Gym group in AppSidebar).
// The Silent Churn hero is now a live (sample-data) card; the remaining six
// cards are still empty shells in the wireframe order. No internals are built
// for those yet. Overview / Membership / Classes are hidden for now.

import { useMemo } from 'react';
import { useRetentionSettings } from '../context/RetentionSettingsContext';
import { FIXTURE_TODAY, SAMPLE_GYM_MEMBERS } from '../lib/gym/memberFixture';
import { computeSilentChurn } from '../lib/gym/silentChurn';

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
              <GymCardShell
                modifier="gym-card--full"
                title="Attendance Health"
                subtitle="Early warning before silent churn."
              />
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
              <GymCardShell
                modifier="gym-card--full"
                title="Member Movement"
                subtitle="Is acquisition beating churn, or is churn eating growth?"
              />
              <GymCardShell
                modifier="gym-card--half"
                title="Churn by Tenure"
                subtitle="At what point in the membership do people leave?"
              />
              <GymCardShell
                modifier="gym-card--half"
                title="Churn by Age"
                subtitle="Do kids, teens, and adults retain differently?"
              />
              <GymCardShell
                modifier="gym-card--full"
                title="Segment Explorer"
                subtitle="For any slice of members, what is the churn?"
              />
              <GymCardShell
                modifier="gym-card--full gym-card--recessed"
                title="Churn by Belt"
                subtitle="Data not connected yet."
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

// Empty card shell — title + subtitle + a single placeholder. Deliberately
// has no internals (no charts, tables, filters, metrics, or state logic).
function GymCardShell({
  title,
  subtitle,
  modifier,
}: {
  title: string;
  subtitle: string;
  modifier?: string;
}) {
  return (
    <article className={`card gym-card${modifier ? ` ${modifier}` : ''}`}>
      <header className="gym-card-head">
        <h3 className="gym-card-title">{title}</h3>
        <p className="gym-card-subtitle">{subtitle}</p>
      </header>
      <div className="gym-card-body">
        <p className="gym-card-placeholder">Card content — not built yet</p>
      </div>
    </article>
  );
}
