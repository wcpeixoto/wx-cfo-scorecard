import { describe, it, expect } from 'vitest';
import type { Signal } from './types';
import { validateProseResponse } from './ai';

const signal: Signal = {
  type: 'reserve_warning',
  severity: 'warning',
  weight: 1,
  metricValue: 5500,
  targetValue: 10000,
};

// A valid response under the new 4-field contract.
const valid = {
  headline: 'Reserve is short of target',
  why: 'You are below the level that keeps you safe.',
  currentState: 'You need more to be fully funded.',
  action: 'Move money into your reserve this week.',
};

describe('validateProseResponse — 4-field contract', () => {
  it('accepts a valid 4-field response and injects identity from the signal', () => {
    const result = validateProseResponse({ ...valid }, signal);
    expect(result).toEqual({ signalType: 'reserve_warning', severity: 'warning', ...valid });
  });

  it('throws when a required field is missing', () => {
    const missing = { headline: valid.headline, why: valid.why, currentState: valid.currentState };
    expect(() => validateProseResponse(missing, signal)).toThrow();
  });

  it('throws when a required field is empty/whitespace', () => {
    expect(() => validateProseResponse({ ...valid, why: '   ' }, signal)).toThrow();
  });

  it('throws when the response is not an object', () => {
    expect(() => validateProseResponse(null, signal)).toThrow();
  });

  // Transition-window tolerance: an old-shape response that still carries the
  // retired fields must validate, but those keys must NOT survive into the output.
  it('accepts old-shape extras but drops them from the returned output', () => {
    const result = validateProseResponse(
      { ...valid, alternative: 'old backup move', followupNote: 'old note' },
      signal,
    );
    expect(result).not.toHaveProperty('alternative');
    expect(result).not.toHaveProperty('followupNote');
    expect(Object.keys(result).sort()).toEqual([
      'action',
      'currentState',
      'headline',
      'severity',
      'signalType',
      'why',
    ]);
  });
});
