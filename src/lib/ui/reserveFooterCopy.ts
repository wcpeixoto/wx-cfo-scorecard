// Operating Reserve footer copy — plain-English status, no ratio math.
//
// Owner-facing rule: never surface coverage-percentage deltas
// ("17% → 66%", "+287%", "+34 pts"). State the direction in words, then
// the remaining gap. Direction is taken from the already-computed
// ReserveCoverageDelta (which bakes in the 0.5pp "no change" threshold);
// this module only assembles the sentence.

const PRIOR_SUFFIX = 'since last month'; // prior-period source = previous completed month

export type ReserveFooterInput = {
  // reserveTarget > EPSILON — a usable reserve goal exists.
  reserveGoalValid: boolean;
  // currentCash / reserveTarget (only meaningful when reserveGoalValid).
  fundedNow: number;
  // currentCash − reserveTarget > $0.50 — strictly above goal (not just at it).
  overfunded: boolean;
  // A prior period exists to compare against (false = no prior anchor).
  hasPrior: boolean;
  // Coverage direction vs prior (only consulted when hasPrior).
  direction: 'up' | 'down' | 'flat';
  // Pre-formatted "$12.4K to goal", or null when there is no positive gap.
  amountToGoalLabel: string | null;
};

export function formatReserveFooter(i: ReserveFooterInput): string {
  if (!i.reserveGoalValid) return 'Set a reserve goal in Settings';

  const atOrAboveGoal = i.fundedNow >= 1;
  const goalPart = atOrAboveGoal ? 'Fully funded' : i.amountToGoalLabel ?? 'Fully funded';

  // No prior period: no trend claim — just the gap (or funded state).
  if (!i.hasPrior) return goalPart;

  // Strictly above goal: stable status, delta intentionally ignored so it
  // doesn't flip to "Improved/Worse" sync-to-sync once past 100%.
  if (i.overfunded) return `Above goal · ${goalPart}`;

  // Exactly at goal (>=100% but not overfunded): delta-driven —
  // "Improved" only if it just rose, otherwise the stable "At goal".
  if (atOrAboveGoal) {
    return i.direction === 'up'
      ? `Improved ${PRIOR_SUFFIX} · ${goalPart}`
      : `At goal · ${goalPart}`;
  }

  // Below goal: plain-English trend + remaining gap.
  const trend =
    i.direction === 'up' ? 'Improved' : i.direction === 'down' ? 'Worse' : 'No change';
  return `${trend} ${PRIOR_SUFFIX} · ${goalPart}`;
}
