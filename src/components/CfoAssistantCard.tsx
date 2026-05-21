/**
 * CFO Assistant card — Today page, top-right cell (Phase 1a: shell only).
 *
 * Deterministic copy and three inert question chips. No AI wiring, no
 * freeform input, no click handlers. Phase 1b will wire one chip to the
 * existing priority prose path.
 */
export function CfoAssistantCard() {
  return (
    <section className="card cfo-assistant-card" aria-labelledby="cfo-assistant-title">
      <header className="card-head">
        <h3 id="cfo-assistant-title">CFO Assistant</h3>
        <p className="subtle">Let's make the numbers useful.</p>
      </header>
      <div className="cfo-assistant-card__body">
        <p className="cfo-assistant-card__prompt">Choose a question below.</p>
        <div
          className="cfo-assistant-card__chips"
          role="group"
          aria-label="Suggested questions"
        >
          <button type="button" className="cfo-assistant-chip" disabled>
            Why is cash tight?
          </button>
          <button type="button" className="cfo-assistant-chip" disabled>
            Where is my cash going?
          </button>
          <button type="button" className="cfo-assistant-chip" disabled>
            What's the one step I should take?
          </button>
        </div>
      </div>
    </section>
  );
}
