import { describe, it, expect } from 'vitest';
import { hasExecuteHelp } from './execute';

describe('hasExecuteHelp — B-1 inert scaffold contract', () => {
  it('returns false: B-1 ships the Execute affordance with no content (B-2 fills it)', () => {
    expect(hasExecuteHelp()).toBe(false);
  });
});
