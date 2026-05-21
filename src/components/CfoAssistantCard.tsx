/**
 * CFO Assistant card — Today page, top-right cell.
 *
 * Phase 1b: the "What's the one step I should take?" chip is wired to the
 * deterministic priority prose. The card recomputes the hero signal locally
 * (mirroring CashOnHandCard) and renders getFallbackCopy(hero).action inline
 * on click. No fetch, no AI proxy call, no new architecture. The other two
 * chips stay inert. The action === null branch is defensive only — in live
 * data rankPriorities always returns a hero and getFallbackCopy always yields
 * a non-empty action, so the chip is always enabled.
 */
import { useMemo, useState } from 'react';
import type { DashboardModel, ScenarioPoint, Txn } from '../lib/data/contract';
import { detectSignals } from '../lib/priorities/signals';
import { rankPriorities } from '../lib/priorities/rank';
import { getFallbackCopy } from '../lib/priorities/copy';

interface CfoAssistantCardProps {
  model: DashboardModel;
  txns: Txn[];
  forecastProjection: ScenarioPoint[];
}

export function CfoAssistantCard({ model, txns, forecastProjection }: CfoAssistantCardProps) {
  const hero = useMemo(
    () => rankPriorities(detectSignals(model, txns, forecastProjection)).hero,
    [model, txns, forecastProjection]
  );

  const action = useMemo<string | null>(() => {
    const copy = getFallbackCopy(hero);
    return copy.action.trim() ? copy.action : null;
  }, [hero]);

  const [activeChipId, setActiveChipId] = useState<'next-step' | null>(null);
  const isAnswered = activeChipId === 'next-step' && action !== null;

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
          <button
            type="button"
            className={
              isAnswered
                ? 'cfo-assistant-chip cfo-assistant-chip--is-active'
                : 'cfo-assistant-chip'
            }
            aria-pressed={isAnswered}
            disabled={action === null}
            onClick={() =>
              setActiveChipId((prev) => (prev === 'next-step' ? null : 'next-step'))
            }
          >
            What's the one step I should take?
          </button>
        </div>
        {isAnswered && (
          <div className="cfo-assistant-card__answer">
            <p className="cfo-assistant-card__answer-text">{action}</p>
          </div>
        )}
      </div>
    </section>
  );
}
