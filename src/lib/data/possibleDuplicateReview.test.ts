import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearPossibleDuplicateReview,
  isPossibleDuplicateReviewed,
  readPossibleDuplicateReview,
  writePossibleDuplicateReview,
  type PossibleDuplicateReview,
} from './possibleDuplicateReview';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

const KEY = 'test_possible_duplicate_review';

describe('possibleDuplicateReview helpers', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('returns null when no acknowledgement is stored', () => {
    expect(readPossibleDuplicateReview(storage, KEY)).toBeNull();
  });

  it('round-trips a written acknowledgement', () => {
    const review: PossibleDuplicateReview = {
      importId: 'import-abc',
      reviewedAtIso: '2026-05-31T12:00:00.000Z',
    };
    writePossibleDuplicateReview(storage, KEY, review);
    expect(readPossibleDuplicateReview(storage, KEY)).toEqual(review);
  });

  it('clear removes the stored acknowledgement', () => {
    writePossibleDuplicateReview(storage, KEY, {
      importId: 'import-abc',
      reviewedAtIso: '2026-05-31T12:00:00.000Z',
    });
    clearPossibleDuplicateReview(storage, KEY);
    expect(readPossibleDuplicateReview(storage, KEY)).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    storage.setItem(KEY, '{not valid json');
    expect(readPossibleDuplicateReview(storage, KEY)).toBeNull();
  });

  it('returns null for the wrong shape', () => {
    storage.setItem(KEY, JSON.stringify({ foo: 'bar' }));
    expect(readPossibleDuplicateReview(storage, KEY)).toBeNull();
  });

  it('returns null when storage is null (SSR-safe)', () => {
    expect(readPossibleDuplicateReview(null, KEY)).toBeNull();
  });

  it('treats acknowledgement as reviewed only for the matching importId', () => {
    const review: PossibleDuplicateReview = {
      importId: 'import-abc',
      reviewedAtIso: '2026-05-31T12:00:00.000Z',
    };
    expect(isPossibleDuplicateReviewed(review, 'import-abc')).toBe(true);
    expect(isPossibleDuplicateReviewed(review, 'import-xyz')).toBe(false);
    expect(isPossibleDuplicateReviewed(review, null)).toBe(false);
    expect(isPossibleDuplicateReviewed(null, 'import-abc')).toBe(false);
  });

  it('a new import (different importId) defaults to NOT reviewed', () => {
    // Owner reviewed import #1
    writePossibleDuplicateReview(storage, KEY, {
      importId: 'import-001',
      reviewedAtIso: '2026-05-31T12:00:00.000Z',
    });
    const stored = readPossibleDuplicateReview(storage, KEY);

    // A subsequent import gets a fresh importId — review state must not carry over
    expect(isPossibleDuplicateReviewed(stored, 'import-002')).toBe(false);
  });
});
