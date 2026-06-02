// Gym › Retention — the Gym section's first real subpage (routed at
// /gym/retention; reached via the expandable Gym group in AppSidebar).
// Phase-one structure only: two sections of empty card shells in the
// wireframe order. No card internals (charts, tables, filters, metrics,
// data) are built yet. Overview / Membership / Classes are hidden for now.

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
      </div>
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
