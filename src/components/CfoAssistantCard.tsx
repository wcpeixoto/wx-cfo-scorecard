/**
 * CFO Assistant card — Today page, top-right cell.
 *
 * Phase 2b: the commitment loop's consent surface. Above the context chips the
 * card surfaces the hero's recommended action (copy.action, rendered as-is) with
 * a bare "I'll do this" primary and a "Not this week" text link. Tapping the
 * primary writes a commitment via commitToPriority and the same slot re-renders
 * the open commitment ("Committed: … Checking back ~<date>."); the link
 * is a session-only dismissal that stores nothing. The open commitment is read
 * once on mount (getOpenCommitment) — it's global, not per-signal. steady_state
 * surfaces no consent (nothing to commit to), so the whole slot is gated on it.
 *
 * Phase 1c (unchanged): the three structural chips below — "What should I do
 * next?" / "Why this step?" / "What should I watch?" — answer inline from
 * getFallbackCopy(hero) and getWatchMetric. No fetch, no AI proxy call.
 */
import { useEffect, useMemo, useState } from 'react';
import type { DashboardModel, ScenarioPoint, Txn } from '../lib/data/contract';
import type { PriorityHistoryRow } from '../lib/priorities/types';
import { detectSignals } from '../lib/priorities/signals';
import { rankPriorities } from '../lib/priorities/rank';
import { getFallbackCopy, getWatchMetric } from '../lib/priorities/copy';
import { getOpenCommitment, commitToPriority } from '../lib/data/sharedPersistence';

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

// "2026-05-05T…" -> "May 5". Short month + day, en-US — the friendly form of the
// stored check_in_at timestamp.
function formatCheckIn(iso: string | undefined): string {
  if (!iso) return 'soon';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'soon';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

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

  // Commitment loop (Phase 2b). The single open commitment is global (not
  // per-signal), read once on mount: while null the consent affordance shows;
  // once set, the slot renders the committed state instead.
  const [openCommitment, setOpenCommitment] = useState<PriorityHistoryRow | null>(null);
  const [committing, setCommitting] = useState(false);
  // Session-only "Not this week" dismissal — stores nothing; the recommendation
  // returns on the next load.
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getOpenCommitment().then((row) => {
      if (!cancelled) setOpenCommitment(row);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCommit = async () => {
    if (committing) return;
    setCommitting(true);
    const row = await commitToPriority(hero, copy.action);
    setCommitting(false);
    // Non-silent: null means nothing was persisted — stay in the fresh state
    // rather than render an unbacked committed state.
    if (row) setOpenCommitment(row);
  };

  // steady_state surfaces nothing to commit to, so the consent slot is gated out
  // entirely (no empty-gap placeholder).
  const showConsentSlot = hero.type !== 'steady_state';

  return (
    <section className="card cfo-assistant-card" aria-labelledby="cfo-assistant-title">
      <header className="card-head">
        <h3 id="cfo-assistant-title">CFO Assistant</h3>
        <p className="subtle">Let's make the numbers useful.</p>
      </header>
      <div className="cfo-assistant-card__body">
        {showConsentSlot && openCommitment && (
          <div className="cfo-assistant-card__commitment">
            <p className="cfo-assistant-card__commitment-text">
              Committed: {openCommitment.committed_action}. Checking back ~
              {formatCheckIn(openCommitment.check_in_at)}.
            </p>
          </div>
        )}
        {showConsentSlot && !openCommitment && !dismissed && (
          <div className="cfo-assistant-card__consent">
            <p className="cfo-assistant-card__recommendation">{copy.action}</p>
            <div className="cfo-assistant-card__commit-row">
              <button
                type="button"
                className="cfo-assistant-card__commit"
                onClick={handleCommit}
                disabled={committing}
              >
                I'll do this
              </button>
              <button
                type="button"
                className="cfo-assistant-card__dismiss"
                onClick={() => setDismissed(true)}
              >
                Not this week
              </button>
            </div>
          </div>
        )}
        <p className="cfo-assistant-card__prompt">Understand this recommendation</p>
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
