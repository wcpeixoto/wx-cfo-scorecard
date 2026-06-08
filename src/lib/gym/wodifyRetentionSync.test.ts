import { describe, it, expect } from 'vitest';
import { classifySyncError, verifyTriggerSecret, gymLocalDay } from './wodifyRetentionSync';

describe('classifySyncError', () => {
  it('passes through the status-suffixed Wodify HTTP code', () => {
    expect(classifySyncError(new Error('wodify_clients_http_401'))).toBe('wodify_clients_http_401');
    expect(classifySyncError(new Error('wodify_clients_http_429'))).toBe('wodify_clients_http_429');
    expect(classifySyncError(new Error('wodify_clients_http_500'))).toBe('wodify_clients_http_500');
  });

  it('passes through the status-suffixed persist HTTP code', () => {
    expect(classifySyncError(new Error('persist_http_404'))).toBe('persist_http_404');
    expect(classifySyncError(new Error('persist_http_401'))).toBe('persist_http_401');
  });

  it('maps the aggregate asOf guard to bad_asof', () => {
    expect(
      classifySyncError(new Error('computeRetentionAggregate: asOf must be YYYY-MM-DD')),
    ).toBe('bad_asof');
  });

  it('maps a timeout (DOMException name TimeoutError) to timeout', () => {
    expect(classifySyncError(new DOMException('timed out', 'TimeoutError'))).toBe('timeout');
  });

  it('maps a manual abort (AbortError) to timeout', () => {
    expect(classifySyncError(new DOMException('aborted', 'AbortError'))).toBe('timeout');
  });

  it('maps a JSON parse failure (SyntaxError) to parse_error', () => {
    let caught: unknown;
    try {
      JSON.parse('{not valid json');
    } catch (e) {
      caught = e;
    }
    expect(classifySyncError(caught)).toBe('parse_error');
  });

  it('maps a fetch network failure (TypeError) to network_error', () => {
    expect(classifySyncError(new TypeError('Failed to fetch'))).toBe('network_error');
  });

  it('falls back to unknown for anything unrecognized', () => {
    expect(classifySyncError(new Error('something unexpected'))).toBe('unknown');
    expect(classifySyncError('a bare string')).toBe('unknown');
    expect(classifySyncError(null)).toBe('unknown');
    expect(classifySyncError(undefined)).toBe('unknown');
    expect(classifySyncError(42)).toBe('unknown');
    expect(classifySyncError({ name: 'SomeOtherError' })).toBe('unknown');
  });

  it('never passes through a message that only resembles a code', () => {
    // Non-anchored or non-digit content must NOT leak through as a code.
    expect(classifySyncError(new Error('wodify_clients_http_'))).toBe('unknown');
    expect(classifySyncError(new Error('wodify_clients_http_abc'))).toBe('unknown');
    expect(classifySyncError(new Error('persist_http_500 https://secret.example/x'))).toBe('unknown');
    expect(classifySyncError(new Error('prefix wodify_clients_http_500'))).toBe('unknown');
  });
});

describe('verifyTriggerSecret', () => {
  it('returns true for an exact match', async () => {
    expect(await verifyTriggerSecret('s3cr3t-trigger-value', 's3cr3t-trigger-value')).toBe(true);
  });

  it('returns false for a mismatch', async () => {
    expect(await verifyTriggerSecret('s3cr3t-trigger-value', 'wrong-value')).toBe(false);
  });

  it('returns false when the provided header is empty', async () => {
    expect(await verifyTriggerSecret('s3cr3t-trigger-value', '')).toBe(false);
  });

  it('fails closed when the configured secret is empty (even if provided is too)', async () => {
    expect(await verifyTriggerSecret('', '')).toBe(false);
    expect(await verifyTriggerSecret('', 'anything')).toBe(false);
  });

  it('is case- and whitespace-sensitive', async () => {
    expect(await verifyTriggerSecret('Secret', 'secret')).toBe(false);
    expect(await verifyTriggerSecret('secret', 'secret ')).toBe(false);
    expect(await verifyTriggerSecret('secret', ' secret')).toBe(false);
  });

  it('handles long and unicode secrets', async () => {
    const long = 'x'.repeat(4096);
    expect(await verifyTriggerSecret(long, long)).toBe(true);
    expect(await verifyTriggerSecret(long, long + 'y')).toBe(false);
    expect(await verifyTriggerSecret('🔐-café', '🔐-café')).toBe(true);
    expect(await verifyTriggerSecret('🔐-café', '🔐-cafe')).toBe(false);
  });

  it('does not match on a SHA-256 prefix collision shortcut (full-digest compare)', async () => {
    // Two different values; ensure a difference anywhere in the value is caught.
    expect(await verifyTriggerSecret('abcdefghijklmnop', 'abcdefghijklmnoq')).toBe(false);
  });
});

describe('gymLocalDay', () => {
  // THE load-bearing case (RETENTION_FINISH_PLAN.md §6 permanent fix): an instant
  // that is still local day X but already UTC day X+1 must resolve to X — both
  // the (workspace_id, as_of) bucket and the recency anchor follow the gym, not
  // server UTC. 03:30Z on 2026-06-07 is 23:30 EDT on 2026-06-06.
  it('uses the gym-local day, not UTC, when the instant has already crossed UTC midnight', () => {
    const lateLocalNight = new Date('2026-06-07T03:30:00Z');
    expect(gymLocalDay(lateLocalNight, 'America/New_York')).toBe('2026-06-06');
  });

  it('resolves the SAME instant to different days in different zones (zone-relative, not UTC)', () => {
    const instant = new Date('2026-06-07T03:30:00Z');
    expect(gymLocalDay(instant, 'America/New_York')).toBe('2026-06-06'); // UTC-4
    expect(gymLocalDay(instant, 'Pacific/Kiritimati')).toBe('2026-06-07'); // UTC+14
  });

  it('handles the positive-offset boundary too (local already on the next day)', () => {
    // 22:00Z on 2026-06-06 is 12:00 on 2026-06-07 in Kiritimati (+14).
    const instant = new Date('2026-06-06T22:00:00Z');
    expect(gymLocalDay(instant, 'Pacific/Kiritimati')).toBe('2026-06-07');
  });

  it('matches the UTC calendar day for a midday-local pull (the existing 2026-06-07 row is not orphaned)', () => {
    // Noon EDT on 2026-06-06 is 16:00Z the same day — no boundary crossing.
    const middayLocal = new Date('2026-06-06T16:00:00Z');
    expect(gymLocalDay(middayLocal, 'America/New_York')).toBe('2026-06-06');
  });

  it('tracks DST — the offset is not hardcoded', () => {
    // Same 03:30Z wall-clock instant, winter vs summer: EST (-5) vs EDT (-4).
    expect(gymLocalDay(new Date('2026-01-15T04:30:00Z'), 'America/New_York')).toBe('2026-01-14');
    expect(gymLocalDay(new Date('2026-07-15T03:30:00Z'), 'America/New_York')).toBe('2026-07-14');
  });

  it('always emits strict zero-padded YYYY-MM-DD', () => {
    const out = gymLocalDay(new Date('2026-03-05T15:00:00Z'), 'America/New_York');
    expect(out).toBe('2026-03-05');
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('is deterministic for a fixed (instant, tz)', () => {
    const instant = new Date('2026-06-07T03:30:00Z');
    expect(gymLocalDay(instant, 'America/New_York')).toBe(gymLocalDay(instant, 'America/New_York'));
  });

  it('throws (never silently falls back to UTC) on an invalid or empty zone', () => {
    const instant = new Date('2026-06-07T03:30:00Z');
    expect(() => gymLocalDay(instant, 'Not/AZone')).toThrow(RangeError);
    expect(() => gymLocalDay(instant, '')).toThrow(RangeError);
    expect(() => gymLocalDay(instant, ' ')).toThrow(RangeError);
  });
});
