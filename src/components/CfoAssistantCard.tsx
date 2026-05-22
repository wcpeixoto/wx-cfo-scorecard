/**
 * CFO Assistant card — Today page, top-right cell.
 *
 * Phase 2.5: the structured-commitment consent surface. commitmentFromSignal
 * turns the hero into a CommitmentDraft, or null when the signal isn't
 * commitment-ready (the STOP rule — only reserve_warning this slice). When a
 * draft exists and nothing is open, the consent slot shows the action plus the
 * one required field — an owner-entered weekly target — and a "Not this week"
 * session dismissal. Committing builds a Commitment (action denominated in the
 * target, +7d deadline, watch baseline = cash now) and writes it via
 * commitToPriority. The open commitment is read once on mount (global, not
 * per-signal) and renders the committed state until resolved (principle #5),
 * regardless of the current hero.
 *
 * The three structural chips below — "What should I do next?" / "Why this
 * step?" / "What should I watch?" — answer inline from getFallbackCopy(hero) and
 * getWatchMetric (the watch routes reserve_warning through the registry; other
 * types keep their current metric). No fetch, no AI proxy call.
 */
import { useEffect, useMemo, useState } from 'react';
import type { DashboardModel, ScenarioPoint, Txn } from '../lib/data/contract';
import type { PriorityHistoryRow } from '../lib/priorities/types';
import { detectSignals } from '../lib/priorities/signals';
import { rankPriorities } from '../lib/priorities/rank';
import { getFallbackCopy, getWatchMetric } from '../lib/priorities/copy';
import { getOpenCommitment, commitToPriority, readCommitmentWatch } from '../lib/data/sharedPersistence';
import { commitmentFromSignal, type Commitment } from '../lib/commitments';

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
// stored deadline_date timestamp.
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

  // A commitment-ready draft for the hero, or null (the STOP rule — only
  // reserve_warning is commitment-ready this slice). Drives the consent slot.
  const draft = useMemo(() => commitmentFromSignal(hero, model), [hero, model]);

  // Commitment loop. The single open commitment is global (not per-signal), read
  // once on mount: while null the consent affordance shows; once set, the slot
  // renders the committed state instead and stays until resolved (principle #5).
  const [openCommitment, setOpenCommitment] = useState<PriorityHistoryRow | null>(null);
  const [committing, setCommitting] = useState(false);
  // Session-only "Not this week" dismissal — stores nothing; the recommendation
  // returns on the next load.
  const [dismissed, setDismissed] = useState(false);
  // Owner-entered weekly target $ — the one required consent field. Blank by
  // default; a pre-filled value would become the answer (re-inventing the
  // auto-slice we rejected).
  const [targetInput, setTargetInput] = useState('');
  const target = Number.parseFloat(targetInput);
  const validTarget = Number.isFinite(target) && target > 0;

  const watch = useMemo(
    () =>
      getWatchMetric(
        hero,
        model,
        openCommitment ? readCommitmentWatch(openCommitment) : null
      ),
    [hero, model, openCommitment]
  );

  // value per chip — also gates the defensive disabled state below.
  const content: Record<ChipId, string> = {
    'do-next': copy.action,
    why: copy.why,
    watch: watch.value,
  };

  const [activeChipId, setActiveChipId] = useState<ChipId | null>(null);

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
    if (committing || !draft || !validTarget) return;
    setCommitting(true);
    const commitment: Commitment = {
      signalType: draft.signalType,
      severity: hero.severity,
      action: draft.buildAction(target),
      recommendedAction: hero.recommendedAction,
      target,
      baseline: draft.baseline,
      gapContext: draft.gapContext,
      deadlineISO: draft.deadlineISO,
      watchMetricId: draft.watchMetricId,
    };
    const row = await commitToPriority(commitment);
    setCommitting(false);
    // Non-silent: null means nothing was persisted — stay in the fresh state
    // rather than render an unbacked committed state.
    if (row) setOpenCommitment(row);
  };

  return (
    <section className="card cfo-assistant-card" aria-labelledby="cfo-assistant-title">
      <header className="card-head">
        <h3 id="cfo-assistant-title">CFO Assistant</h3>
        <p className="subtle">Let's make the numbers useful.</p>
      </header>
      <div className="cfo-assistant-card__body">
        {openCommitment && (
          <div className="cfo-assistant-card__commitment">
            <p className="cfo-assistant-card__commitment-text">
              Committed: {openCommitment.committed_action}. Checking back ~
              {formatCheckIn(openCommitment.deadline_date)}.
            </p>
          </div>
        )}
        {!openCommitment && draft && !dismissed && (
          <div className="cfo-assistant-card__consent">
            <p className="cfo-assistant-card__recommendation">
              {validTarget
                ? draft.buildAction(target)
                : 'Move money into your operating reserve this week.'}
            </p>
            <label className="cfo-assistant-card__target">
              <span className="cfo-assistant-card__target-label">Amount this week</span>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                step="50"
                className="cfo-assistant-card__target-input"
                placeholder="e.g. $500"
                value={targetInput}
                onChange={(e) => setTargetInput(e.target.value)}
              />
            </label>
            <div className="cfo-assistant-card__commit-row">
              <button
                type="button"
                className="cfo-assistant-card__commit"
                onClick={handleCommit}
                disabled={committing || !validTarget}
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
