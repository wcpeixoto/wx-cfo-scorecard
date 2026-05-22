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
 * Committed-state copy (summary, watch progress, check-in) comes from
 * commitmentTemplate — the single source of commitment-state language; the card
 * never reads raw commitment columns (only the row id, for the resolve/extend
 * mutations).
 *
 * The committed card is time-aware (commitmentBeat, #8): during the window it
 * carries a quiet "Not doing this" escape hatch (#6 — consequence shown, not
 * shame); after the deadline it becomes the check-in (#7) — honest attribution
 * when the outcome is unclear, then Mark it done (kept) / Keep going (extend) /
 * Let it go (lapsed). Help-execute is hidden and Update plan deferred until
 * Phase 3; "Ask about this" is served by the chips.
 *
 * Two structural chips below — "Why this step?" / "What should I watch?" — answer
 * inline. "Why" is getFallbackCopy(hero).why; "Watch" is the templater's progress
 * when committed, else getWatchMetric (the signal-derived awareness watch). The
 * old "What should I do next?" chip was dropped: the action already leads the
 * consent slot (fresh) or the committed summary, so the chip only echoed it. No
 * fetch, no AI proxy call.
 */
import { useEffect, useMemo, useState } from 'react';
import type { DashboardModel, ScenarioPoint, Txn } from '../lib/data/contract';
import type { PriorityHistoryRow } from '../lib/priorities/types';
import { detectSignals } from '../lib/priorities/signals';
import { rankPriorities } from '../lib/priorities/rank';
import { getFallbackCopy, getWatchMetric } from '../lib/priorities/copy';
import {
  getOpenCommitment,
  commitToPriority,
  resolveCommitment,
  extendCommitment,
} from '../lib/data/sharedPersistence';
import {
  commitmentFromSignal,
  commitmentTemplate,
  commitmentBeat,
  groundingConsentMode,
  buildExecuteHelp,
  type Commitment,
} from '../lib/commitments';
import { devCommitment, devGroundingOverride, devExecuteOverride } from '../lib/commitments/devSeam';

interface CfoAssistantCardProps {
  model: DashboardModel;
  txns: Txn[];
  forecastProjection: ScenarioPoint[];
}

const CHIPS = [
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

  // A commitment-ready draft for the hero, or null (the STOP rule — only
  // reserve_warning is commitment-ready this slice). Drives the consent slot.
  // The DEV-only override (?devGrounding=unknown) forces the grounding to unknown
  // so the STOP surface is browser-verifiable; the `import.meta.env.DEV ? … : d`
  // site lets the minifier drop it from prod (proven by the dist grep).
  const draft = useMemo(() => {
    const d = commitmentFromSignal(hero, model);
    return import.meta.env.DEV ? devGroundingOverride(d) : d;
  }, [hero, model]);

  // Commitment loop. The single open commitment is global (not per-signal), read
  // once on mount: while null the consent affordance shows; once set, the slot
  // renders the committed state instead and stays until resolved (principle #5).
  const [openCommitment, setOpenCommitment] = useState<PriorityHistoryRow | null>(null);
  // DEV-only preview seam (PR-D): ?devCommitment=<phase> injects a fake open
  // commitment so the committed/check-in states render without Supabase. null in
  // prod (import.meta.env.DEV-gated), so activeCommitment is just openCommitment.
  const [devCommit, setDevCommit] = useState<PriorityHistoryRow | null>(() =>
    import.meta.env.DEV ? devCommitment(model.runway.currentCashBalance) : null
  );
  const activeCommitment = devCommit ?? openCommitment;
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

  // TG-3: exhaustive consent routing off the draft's grounding. `commit` → the
  // consent slot (carrying the TG-2 grounded hint); `stop` → the awareness/STOP
  // surface. The card switches on `mode` and never reads `grounding.classification`
  // itself, so it can't define the unknown branch by negation (the #195 trap);
  // adding a classification value is a compile error in the helper, not here.
  const consent = useMemo(
    () => (draft ? groundingConsentMode(draft.grounding) : null),
    [draft]
  );
  const hint = consent && consent.mode === 'commit' ? consent.hint : null;
  const stopMessage = consent && consent.mode === 'stop' ? consent.message : null;
  // Soft-warn only (not a hard gate, per TG-0): commit stays enabled below floor.
  const belowFloor = hint !== null && validTarget && target < hint.floor;

  // Committed-state copy bundle (Commitment Mode, #5), or null when fresh. The
  // follow-up beat is computed on open (#8) from the commitment's timestamps.
  const template = useMemo(
    () =>
      activeCommitment
        ? commitmentTemplate(activeCommitment, commitmentBeat(activeCommitment), model)
        : null,
    [activeCommitment, model]
  );

  // Committed → progress from the templater; fresh → the signal-derived
  // awareness watch.
  const freshWatch = useMemo(() => getWatchMetric(hero, model), [hero, model]);
  const watch = template ? template.watch : freshWatch;

  // B-2 Execute (#6.1 / #10): the reserve_warning money-finding aid. buildExecuteHelp
  // curates the app's own expense overruns into a guided pick-one-lever (or an honest
  // "nothing jumped" message); it returns null only when the open commitment isn't a
  // reserve_warning. Content is informational only — the owner acts outside the app.
  const executeHelp = useMemo(
    () => (activeCommitment ? buildExecuteHelp(model, activeCommitment) : null),
    [activeCommitment, model]
  );
  // Visibility stays DEV-gated through B-4 (B stays "Next" until B-4): production
  // hides the affordance even though content now exists; ?devExecute= reveals it in
  // dev for browser verification. The prod branch is a literal `false`, so
  // devExecuteOverride (and the `devExecute` string) tree-shake from prod — B-4
  // flips this to `executeHelp !== null` to launch.
  const executeAvailable =
    executeHelp !== null && (import.meta.env.DEV ? devExecuteOverride(false) : false);
  const [executeOpen, setExecuteOpen] = useState(false);

  // value per chip — also gates the defensive disabled state below.
  const content: Record<ChipId, string> = {
    why: copy.why,
    watch: watch.value,
  };

  const [activeChipId, setActiveChipId] = useState<ChipId | null>(null);

  // Resolution flow (after the deadline) + the during-window "Not doing this"
  // escape hatch. selectedAttribution is presentation-only (#7 / Gate 2) — not
  // persisted in 2c (Phase 3 decides whether to persist it).
  const [resolving, setResolving] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [selectedAttribution, setSelectedAttribution] = useState<string | null>(null);

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

  // Terminal resolution (#7): kept (target hit, owner closes) or lapsed (owner
  // lets it go, or stops early via "Not doing this"). outcome_metric = final cash
  // at resolve. On success the commitment is done — drop back to the fresh state.
  const handleResolve = async (outcome: 'kept' | 'lapsed') => {
    if (import.meta.env.DEV && devCommit) {
      // Dev seam: simulate the terminal transition back to the fresh state.
      setDevCommit(null);
      setShowCloseConfirm(false);
      setSelectedAttribution(null);
      return;
    }
    if (resolving || !openCommitment?.id) return;
    setResolving(true);
    const ok = await resolveCommitment(openCommitment.id, outcome, model.runway.currentCashBalance);
    setResolving(false);
    if (ok) {
      setOpenCommitment(null);
      setShowCloseConfirm(false);
      setSelectedAttribution(null);
    }
  };

  // "Keep going" pushes the deadline a fresh +7d; re-read so the new window (and
  // recomputed beat) take effect.
  const handleExtend = async () => {
    if (import.meta.env.DEV && devCommit) {
      // Dev seam: a fresh +7d window restarts the loop at day-one.
      setDevCommit(devCommitment(model.runway.currentCashBalance, 'day_one'));
      setSelectedAttribution(null);
      return;
    }
    if (resolving || !openCommitment?.id) return;
    setResolving(true);
    const ok = await extendCommitment(openCommitment.id);
    if (ok) {
      const row = await getOpenCommitment();
      setOpenCommitment(row);
      setSelectedAttribution(null);
    }
    setResolving(false);
  };

  return (
    <section className="card cfo-assistant-card" aria-labelledby="cfo-assistant-title">
      <header className="card-head">
        <h3 id="cfo-assistant-title">CFO Assistant</h3>
        <p className="subtle">Let's make the numbers useful.</p>
      </header>
      <div className="cfo-assistant-card__body">
        {template && (
          <div className="cfo-assistant-card__commitment">
            <p className="cfo-assistant-card__commitment-text">{template.summary}</p>

            {template.checkIn ? (
              <div className="cfo-assistant-card__checkin">
                {template.checkIn.attribution && (
                  <div className="cfo-assistant-card__attribution">
                    <span className="cfo-assistant-card__attribution-prompt">
                      {template.checkIn.attribution.prompt}
                    </span>
                    <div
                      className="cfo-assistant-card__attribution-options"
                      role="group"
                      aria-label="How did it go?"
                    >
                      {template.checkIn.attribution.options.map((opt) => {
                        const isActive = selectedAttribution === opt;
                        return (
                          <button
                            key={opt}
                            type="button"
                            className={
                              isActive
                                ? 'cfo-assistant-chip cfo-assistant-chip--is-active'
                                : 'cfo-assistant-chip'
                            }
                            aria-pressed={isActive}
                            onClick={() => setSelectedAttribution(opt)}
                          >
                            {opt}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="cfo-assistant-card__resolve-row">
                  {template.checkIn.state === 'achieved' ? (
                    <>
                      <button
                        type="button"
                        className="cfo-assistant-card__commit"
                        onClick={() => handleResolve('kept')}
                        disabled={resolving}
                      >
                        Mark it done
                      </button>
                      <button
                        type="button"
                        className="cfo-assistant-card__dismiss"
                        onClick={handleExtend}
                        disabled={resolving}
                      >
                        Keep going another week
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="cfo-assistant-card__commit"
                        onClick={handleExtend}
                        disabled={resolving}
                      >
                        Keep going another week
                      </button>
                      <button
                        type="button"
                        className="cfo-assistant-card__dismiss"
                        onClick={() => handleResolve('lapsed')}
                        disabled={resolving}
                      >
                        Let it go
                      </button>
                    </>
                  )}
                </div>
              </div>
            ) : (
              // #6 escape hatches, during-window committed state. "Help me execute"
              // (#6.1) is the B-2 money-finding aid below — DEV-gated through B-4
              // (?devExecute= reveals it; hidden in prod). "Not doing this" (#6.3)
              // shows the consequence before closing. "Update plan" (#6.2) stays
              // deferred (needs a PATCH helper in the locked sharedPersistence.ts).
              <div className="cfo-assistant-card__escape">
                {executeAvailable && !showCloseConfirm && (
                  <div className="cfo-assistant-card__execute">
                    <button
                      type="button"
                      className={
                        executeOpen
                          ? 'cfo-assistant-chip cfo-assistant-chip--is-active'
                          : 'cfo-assistant-chip'
                      }
                      aria-expanded={executeOpen}
                      onClick={() => setExecuteOpen((open) => !open)}
                    >
                      Help me execute
                    </button>
                    {executeOpen && executeHelp && (
                      <div className="cfo-assistant-card__answer" data-testid="execute-slot">
                        {/* Shape C: a guided pick-one-lever over the app's own expense
                            overruns, or an honest "nothing jumped" line. Informational
                            only — no action button, no selected-lever state. */}
                        {executeHelp.kind === 'none' ? (
                          <p className="cfo-assistant-card__answer-text">{executeHelp.text}</p>
                        ) : (
                          <>
                            <p className="cfo-assistant-card__answer-text">{executeHelp.lead}</p>
                            <p className="cfo-assistant-card__execute-pick">
                              <span className="cfo-assistant-card__execute-pick-label">
                                Start here:
                              </span>{' '}
                              {executeHelp.recommended.text}
                            </p>
                            {executeHelp.alternates.length > 0 && (
                              <ul className="cfo-assistant-card__execute-alts">
                                {executeHelp.alternates.map((alt) => (
                                  <li
                                    key={alt.category}
                                    className="cfo-assistant-card__execute-alt"
                                  >
                                    {alt.text}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {showCloseConfirm ? (
                  <div className="cfo-assistant-card__close-confirm">
                    <p className="cfo-assistant-card__close-consequence">
                      {template.closeConsequence}
                    </p>
                    <div className="cfo-assistant-card__close-actions">
                      <button
                        type="button"
                        className="cfo-assistant-card__dismiss"
                        onClick={() => handleResolve('lapsed')}
                        disabled={resolving}
                      >
                        Stop anyway
                      </button>
                      <button
                        type="button"
                        className="cfo-assistant-card__dismiss"
                        onClick={() => setShowCloseConfirm(false)}
                        disabled={resolving}
                      >
                        Keep it
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="cfo-assistant-card__dismiss"
                    onClick={() => setShowCloseConfirm(true)}
                  >
                    Not doing this
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {!activeCommitment && draft && consent?.mode === 'commit' && !dismissed && (
          <div className="cfo-assistant-card__consent">
            <p className="cfo-assistant-card__recommendation">
              {validTarget
                ? draft.buildAction(target)
                : 'Move money into your operating reserve this week.'}
            </p>
            {hint && (
              <p className="cfo-assistant-card__grounding">{hint.text}</p>
            )}
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
            {belowFloor && hint && (
              <p className="cfo-assistant-card__floor-warning" role="status">
                {`Below $${hint.floor}/week may be too small to move your reserve — commit anyway?`}
              </p>
            )}
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
        {!activeCommitment && stopMessage && (
          // TG-3: a reserve_warning whose weekly target can't be honestly grounded
          // (#3 STOP). No consent ask and no committed summary — a calm awareness
          // paragraph is its only recommendation surface (#11). Reuses the
          // recommendation paragraph shape; copy is the single generic STOP message
          // (same for every unknownReason).
          <p className="cfo-assistant-card__recommendation">{stopMessage}</p>
        )}
        {!activeCommitment && !draft && (
          // Awareness-only signals (e.g. reserve_critical) are not commitment-ready
          // (#3 STOP rule), so they have no consent slot or committed summary — this
          // is their only home for the recommended action. Without it the card shows
          // "Understand this recommendation" with nothing to understand.
          <p className="cfo-assistant-card__recommendation">{copy.action}</p>
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
              <p className="cfo-assistant-card__answer-text">{copy.why}</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
