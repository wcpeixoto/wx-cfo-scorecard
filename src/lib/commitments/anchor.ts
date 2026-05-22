// The commitment deadline anchor. Phase 2.5 uses a rolling +7d window
// (principle #9: a commitment is one week or less). Kept here, out of the
// locked sharedPersistence.ts, so the time model can evolve later (e.g. a
// Friday calendar anchor) by swapping this one helper with no ripple.
// commitToPriority takes the resulting ISO date as a parameter rather than
// computing a day count itself.
const COMMITMENT_WINDOW_DAYS = 7;

export function commitmentDeadline(from: Date = new Date()): string {
  return new Date(
    from.getTime() + COMMITMENT_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
}
