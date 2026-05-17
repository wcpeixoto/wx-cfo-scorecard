// Visual mock only — values are hardcoded, modeled on the UI Lab Total
// Revenue card. Real forecast/Settings wiring comes in a later task.
export default function NextOwnerDistributionCard() {
  return (
    <article className="card next-owner-dist-card" aria-label="Next Owner Distribution">
      <header className="next-owner-dist-header">
        <div className="next-owner-dist-title-block">
          <h3 className="next-owner-dist-title">Next Owner Distribution</h3>
          <div className="next-owner-dist-delta-row">
            <p className="next-owner-dist-delta next-owner-dist-delta--up">
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M7.9974 2.66602L7.9974 13.3336M4 6.66334L7.99987 2.66602L12 6.66334" stroke="currentColor" />
              </svg>
              3.2%
            </p>
            <p className="next-owner-dist-delta-context">than last month</p>
          </div>
        </div>
      </header>
      <div className="next-owner-dist-hero-row">
        <h2 className="next-owner-dist-value">19,857.00</h2>
      </div>
    </article>
  );
}
