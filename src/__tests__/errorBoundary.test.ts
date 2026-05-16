import { describe, it, expect } from 'vitest';
import { deriveErrorState } from '../components/ErrorBoundary';

describe('ErrorBoundary', () => {
  it('derives an errored state when a child throws', () => {
    expect(deriveErrorState()).toEqual({ hasError: true });
  });
});
