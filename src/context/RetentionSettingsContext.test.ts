import { describe, expect, it } from 'vitest';
import { parseExcludeUnknownRecency } from './RetentionSettingsContext';

// "Exclude parent/guardian accounts" default-ON semantics: the toggle is ON unless
// an explicit boolean `false` is stored. Absence (new browser), a threshold-only or
// legacy blob (migration), a non-boolean value, or malformed JSON all resolve to
// true. A NEW key (`excludeUnknownRecency`) — the legacy `includeUnknownInRetention`
// is deliberately ignored so an old saved value can't flip this new toggle.

describe('parseExcludeUnknownRecency — default-ON via absence (only explicit false opts out)', () => {
  it('absent blob → true', () => {
    expect(parseExcludeUnknownRecency(null)).toBe(true);
  });

  it('empty string → true', () => {
    expect(parseExcludeUnknownRecency('')).toBe(true);
  });

  it('blob missing the field (threshold-only era) → true', () => {
    expect(parseExcludeUnknownRecency(JSON.stringify({ silentChurnThresholdDays: 21 }))).toBe(true);
  });

  it('explicit false → false', () => {
    expect(parseExcludeUnknownRecency(JSON.stringify({ excludeUnknownRecency: false }))).toBe(false);
  });

  it('explicit true → true', () => {
    expect(parseExcludeUnknownRecency(JSON.stringify({ excludeUnknownRecency: true }))).toBe(true);
  });

  it('a non-boolean value ("false", 0) → true (default ON; only a real boolean false opts out)', () => {
    expect(parseExcludeUnknownRecency(JSON.stringify({ excludeUnknownRecency: 'false' }))).toBe(true);
    expect(parseExcludeUnknownRecency(JSON.stringify({ excludeUnknownRecency: 0 }))).toBe(true);
  });

  it('malformed JSON → true', () => {
    expect(parseExcludeUnknownRecency('{ not json')).toBe(true);
  });

  it('does NOT read the legacy includeUnknownInRetention key (migration is a clean default)', () => {
    // An old blob whose only signal is the legacy key must still default ON — the new
    // toggle never inherits the old (oppositely-meaning) value.
    expect(
      parseExcludeUnknownRecency(JSON.stringify({ includeUnknownInRetention: true })),
    ).toBe(true);
    expect(
      parseExcludeUnknownRecency(JSON.stringify({ includeUnknownInRetention: false })),
    ).toBe(true);
  });

  it('preserves an explicit false alongside the threshold field', () => {
    expect(
      parseExcludeUnknownRecency(
        JSON.stringify({ silentChurnThresholdDays: 30, excludeUnknownRecency: false }),
      ),
    ).toBe(false);
  });
});
