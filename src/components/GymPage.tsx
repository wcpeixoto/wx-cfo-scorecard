import { useState } from 'react';

// Single /gym route with an internal subnav, mirroring the Settings page
// pattern (one route, state-driven tabs — see Dashboard.tsx settings block).
// Phase one is structure only: Churn renders the real shell; the other three
// sections are "Coming soon" stubs so the nav never points at empty content.

type GymSection = 'overview' | 'churn' | 'membership' | 'classes';

const GYM_SECTIONS: { id: GymSection; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'churn', label: 'Churn' },
  { id: 'membership', label: 'Membership' },
  { id: 'classes', label: 'Classes' },
];

export function GymPage() {
  const [activeGymSection, setActiveGymSection] = useState<GymSection>('overview');

  return (
    <div className="stack-grid">
      <div className="ta-page">
        {/* Subnav reuses the Settings subnav classes (single canonical
            in-page tab strip) rather than a new expandable sidebar pattern. */}
        <div className="settings-subnav-wrap">
          <div className="settings-subnav" role="tablist" aria-label="Gym sections">
            {GYM_SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                role="tab"
                aria-selected={activeGymSection === section.id}
                className={`settings-subnav-btn${activeGymSection === section.id ? ' is-active' : ''}`}
                onClick={() => setActiveGymSection(section.id)}
              >
                {section.label}
              </button>
            ))}
          </div>
        </div>

        {activeGymSection === 'overview' && <GymStub title="Overview" />}
        {activeGymSection === 'churn' && <GymChurn />}
        {activeGymSection === 'membership' && <GymStub title="Membership" />}
        {activeGymSection === 'classes' && <GymStub title="Classes" />}
      </div>
    </div>
  );
}

// Overview / Membership / Classes — title + "Coming soon" only. No breadcrumb
// or section structure (phase one scaffolding).
function GymStub({ title }: { title: string }) {
  return (
    <div className="gym-stub">
      <div className="ta-page-header">
        <h1 className="ta-page-title">{title}</h1>
      </div>
      <article className="card gym-stub-card">
        <p className="gym-stub-copy">Coming soon</p>
      </article>
    </div>
  );
}

// Churn — the real shell page. Two sections (Watch, Patterns) of empty card
// shells in the wireframe's order. No card internals are built in phase one.
function GymChurn() {
  return (
    <div className="gym-churn">
      <nav className="gym-breadcrumb" aria-label="Breadcrumb">
        <span className="gym-breadcrumb-item">Gym</span>
        <span className="gym-breadcrumb-sep" aria-hidden="true">›</span>
        <span className="gym-breadcrumb-item is-current" aria-current="page">Churn</span>
      </nav>

      <div className="ta-page-header">
        <h1 className="ta-page-title">Churn</h1>
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
          <GymCardShell
            modifier="gym-card--hero"
            title="Silent Churn"
            subtitle="Still paying, not showing up."
          />
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
