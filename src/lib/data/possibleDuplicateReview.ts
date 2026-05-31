/**
 * Per-import acknowledgement that the owner reconciled the possible-duplicate
 * warnings (typically against the source-of-truth balance in Quicken) and the
 * imported rows are valid.
 *
 * Acknowledgement is scoped to a single importId. A new import (replace-all
 * shared mode, or appended local mode that updates lastImportSummary) issues
 * a new importId, so newly-flagged duplicates re-surface automatically.
 *
 * Acknowledgement never touches the underlying transactions or summary
 * counts — it is a UI-only "I have reviewed this" flag.
 */

export type PossibleDuplicateReview = {
  importId: string;
  reviewedAtIso: string;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function readPossibleDuplicateReview(
  storage: StorageLike | null | undefined,
  key: string
): PossibleDuplicateReview | null {
  if (!storage) return null;
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as PossibleDuplicateReview).importId === 'string' &&
      typeof (parsed as PossibleDuplicateReview).reviewedAtIso === 'string' &&
      (parsed as PossibleDuplicateReview).importId.length > 0
    ) {
      return parsed as PossibleDuplicateReview;
    }
    return null;
  } catch {
    return null;
  }
}

export function writePossibleDuplicateReview(
  storage: StorageLike | null | undefined,
  key: string,
  review: PossibleDuplicateReview
): void {
  if (!storage) return;
  storage.setItem(key, JSON.stringify(review));
}

export function clearPossibleDuplicateReview(
  storage: StorageLike | null | undefined,
  key: string
): void {
  if (!storage) return;
  storage.removeItem(key);
}

export function isPossibleDuplicateReviewed(
  review: PossibleDuplicateReview | null,
  importId: string | null | undefined
): boolean {
  if (!review || !importId) return false;
  return review.importId === importId;
}
