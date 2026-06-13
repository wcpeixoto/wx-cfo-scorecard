import { describe, expect, it } from 'vitest';
import { parseIncludeUnknown } from './RetentionSettingsContext';

// Option B default-OFF semantics: the toggle is OFF unless an explicit `true` is
// stored. Absence (new browser), a threshold-only blob (migration), a non-boolean
// value, or malformed JSON all resolve to false.

describe('parseIncludeUnknown — default-OFF via absence (strict === true)', () => {
  it('absent blob → false', () => {
    expect(parseIncludeUnknown(null)).toBe(false);
  });

  it('empty string → false', () => {
    expect(parseIncludeUnknown('')).toBe(false);
  });

  it('blob missing the field (threshold-only era) → false', () => {
    expect(parseIncludeUnknown(JSON.stringify({ silentChurnThresholdDays: 21 }))).toBe(false);
  });

  it('explicit true → true', () => {
    expect(parseIncludeUnknown(JSON.stringify({ includeUnknownInRetention: true }))).toBe(true);
  });

  it('explicit false → false', () => {
    expect(parseIncludeUnknown(JSON.stringify({ includeUnknownInRetention: false }))).toBe(false);
  });

  it('truthy non-boolean ("true", 1) → false (strict comparison)', () => {
    expect(parseIncludeUnknown(JSON.stringify({ includeUnknownInRetention: 'true' }))).toBe(false);
    expect(parseIncludeUnknown(JSON.stringify({ includeUnknownInRetention: 1 }))).toBe(false);
  });

  it('malformed JSON → false', () => {
    expect(parseIncludeUnknown('{ not json')).toBe(false);
  });

  it('preserves a stored true alongside the threshold field', () => {
    expect(
      parseIncludeUnknown(
        JSON.stringify({ silentChurnThresholdDays: 30, includeUnknownInRetention: true }),
      ),
    ).toBe(true);
  });
});
