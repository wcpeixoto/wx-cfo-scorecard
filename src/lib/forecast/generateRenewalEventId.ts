// Phase 5.1 — Deterministic ID for renewal-generated forecast events.
//
// Same (contractId, occurrenceDate) pair always returns the same string,
// which lets the generator do idempotent upserts: re-running the
// generator for an unchanged contract produces the same row IDs and
// therefore overwrites in place rather than duplicating.
//
// Format intentionally mirrors the existing manual-event ID convention
// (`<frequency>__<groupId>__<index>`): a leading source token, then
// stable identifying parts joined by `__`. Consumers can detect renewal
// rows by the `renewal__` prefix or — preferred — by reading the
// `source` column on forecast_events.
//
// Inputs are not validated here. The generator is responsible for
// ensuring `occurrenceDate` is a real `YYYY-MM-DD` value before calling.
// No consumers in this branch — shape only.

export function generateRenewalEventId(
  contractId: string,
  occurrenceDate: string, // YYYY-MM-DD
): string {
  return `renewal__${contractId}__${occurrenceDate}`;
}
