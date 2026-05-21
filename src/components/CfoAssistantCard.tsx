/**
 * CFO Assistant card — Today page, top-right cell.
 *
 * Phase 1c: three structural follow-up chips, all wired to deterministic copy.
 * The card recomputes the hero signal locally (mirroring CashOnHandCard) and
 * answers each chip inline on click. "What should I do next?" and "Why this
 * step?" render prose from getFallbackCopy(hero); "What should I watch?" renders
 * the structured {label, value} from getWatchMetric. No fetch, no AI proxy call.
 * The chip array is a literal here by design — structure lives in the component,
 * content lives on the hero signal. The disabled branch is defensive only: in
 * live data every answer is non-empty, so the chips are always enabled.
 */
import { useMemo, useState } from 'react';
import type { DashboardModel, ScenarioPoint, Txn } from '../lib/data/contract';
import { detectSignals } from '../lib/priorities/signals';
import { rankPriorities } from '../lib/priorities/rank';
import { getFallbackCopy, getWatchMetric } from '../lib/priorities/copy';

interface CfoAssistantCardProps {
  model: DashboardModel;
  txns: Txn[];
  forecastProjection: ScenarioPoint[];
}

const CHIPS = [
  { id: 'do-next', label: 'What should I do next?' },
  { id: 'why', label: 'Why this step?' },
  { id: 'watch', label: 'What should I watch?' },
] as const;

type ChipId = (typeof CHIPS)[number]['id'];

export function CfoAssistantCard({ model, txns, forecastProjection }: CfoAssistantCardProps) {
  const hero = useMemo(
    () => rankPriorities(detectSignals(model, txns, forecastProjection)).hero,
    [model, txns, forecastProjection]
  );

  const copy = useMemo(() => getFallbackCopy(hero), [hero]);
  const watch = useMemo(
    () => getWatchMetric(hero, model.runway.currentCashBalance),
    [hero, model.runway.currentCashBalance]
  );

  // value per chip — also gates the defensive disabled state below.
  const content: Record<ChipId, string> = {
    'do-next': copy.action,
    why: copy.why,
    watch: watch.value,
  };

  const [activeChipId, setActiveChipId] = useState<ChipId | null>(null);

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
          {CHIPS.map((chip) => {
            const isActive = activeChipId === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                className={
                  isActive
                    ? 'cfo-assistant-chip cfo-assistant-chip--is-active'
                    : 'cfo-assistant-chip'
                }
                aria-pressed={isActive}
                disabled={!content[chip.id].trim()}
                onClick={() =>
                  setActiveChipId((prev) => (prev === chip.id ? null : chip.id))
                }
              >
                {chip.label}
              </button>
            );
          })}
        </div>
        {activeChipId && (
          <div className="cfo-assistant-card__answer">
            {activeChipId === 'watch' ? (
              <div className="cfo-assistant-card__watch">
                <span className="cfo-assistant-card__watch-label">{watch.label}</span>
                <span className="cfo-assistant-card__watch-value">{watch.value}</span>
              </div>
            ) : (
              <p className="cfo-assistant-card__answer-text">
                {activeChipId === 'do-next' ? copy.action : copy.why}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
