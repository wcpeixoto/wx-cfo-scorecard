import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  postBeltImport,
  beltRejectMessage,
  detectBeltSourceKind,
  isBeltImportConfigured,
  BeltImportError,
  type BeltImportSummary,
} from './beltRetentionImportClient';
import { corsHeadersFor, CORS_ALLOWED_ORIGINS } from './beltRetentionUpload';

// ─── FIXTURES ────────────────────────────────────────────────────────────────
const SECRET = 'belt-trigger-abc123';

// Header lines matching the Slice-1 `classify` signatures (header-only detection).
const RET_HEADER = 'ID,Customer ID,First Of Month,Client ID,Client Name,Change Type,Positive Change';
const CUR_HEADER = 'Client ID,Client Name,Progression,Level,Date Achieved,Classes At Level';
const PREV_HEADER = 'Client Name,Progression,Level,Date Achieved,Promoted On,Days At Level';

function makeFiles() {
  return {
    retention: new File([`${RET_HEADER}\n`], 'retention.csv', { type: 'text/csv' }),
    current68: new File([`${CUR_HEADER}\n`], 'current68.csv', { type: 'text/csv' }),
    previous69: new File([`${PREV_HEADER}\n`], 'previous69.csv', { type: 'text/csv' }),
  };
}

const OK_SUMMARY: BeltImportSummary = {
  rowCount: 104,
  months: 13,
  monthLabels: ['2025-06', '2025-07'],
  conservationOk: true,
  bridgeCollisionFree: true,
  resolvedUniqueToId: 3,
  ambiguousNames: 0,
  unmatchedNames: 0,
};

// All 14 reject codes the Edge Function can return (mirrors the UploadRejectCode union).
const ALL_REJECT_CODES = [
  'method_not_allowed',
  'internal_error',
  'forbidden',
  'payload_too_large',
  'bad_multipart',
  'missing_source',
  'duplicate_source',
  'unclassified_source',
  'header_validation_failed',
  'conservation_failed',
  'name_bridge_collision',
  'leak_guard_tripped',
  'persist_failed',
  'aggregate_error',
] as const;

function stubConfiguredEnv() {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-test-key');
}

// The real .env.local is populated, so "unconfigured" must be stubbed explicitly.
function stubUnconfiguredEnv() {
  vi.stubEnv('VITE_SUPABASE_URL', '');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
}

function installFetch(response: { ok: boolean; status?: number; body: unknown }) {
  const fn = vi.fn((..._args: unknown[]) =>
    Promise.resolve({
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: () => Promise.resolve(response.body),
    }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─── postBeltImport — request shape ──────────────────────────────────────────
describe('postBeltImport — request shape', () => {
  it('POSTs exactly 3 file parts to the sync-belt-retention endpoint', async () => {
    stubConfiguredEnv();
    const fetchFn = installFetch({ ok: true, body: { ok: true, ...OK_SUMMARY } });

    await postBeltImport(makeFiles(), SECRET);

    const url = fetchFn.mock.calls[0][0] as string;
    expect(url).toBe('https://example.supabase.co/functions/v1/sync-belt-retention');

    const init = fetchFn.mock.calls[0][1] as { method: string; body: FormData };
    expect(init.method).toBe('POST');
    const parts = [...init.body.entries()];
    expect(parts).toHaveLength(3);
    expect(parts.every(([, v]) => v instanceof File)).toBe(true);
  });

  it('sends apikey + Authorization + the trigger-secret header and NO Content-Type', async () => {
    stubConfiguredEnv();
    const fetchFn = installFetch({ ok: true, body: { ok: true, ...OK_SUMMARY } });

    await postBeltImport(makeFiles(), SECRET);

    const init = fetchFn.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers.apikey).toBe('anon-test-key');
    expect(init.headers.Authorization).toBe('Bearer anon-test-key');
    expect(init.headers['x-belt-import-trigger-secret']).toBe(SECRET);
    // The browser must set the multipart boundary — we must not override Content-Type.
    const headerKeys = Object.keys(init.headers).map((k) => k.toLowerCase());
    expect(headerKeys).not.toContain('content-type');
  });

  it('carries the secret ONLY as a header, never as a FormData field', async () => {
    stubConfiguredEnv();
    const fetchFn = installFetch({ ok: true, body: { ok: true, ...OK_SUMMARY } });

    await postBeltImport(makeFiles(), SECRET);

    const init = fetchFn.mock.calls[0][1] as { body: FormData };
    for (const [key, value] of init.body.entries()) {
      expect(key).not.toBe(SECRET);
      // File values stringify to "[object File]"; a leaked secret would be a string field.
      if (typeof value === 'string') expect(value).not.toBe(SECRET);
    }
  });

  it('parses the counts-only summary on success', async () => {
    stubConfiguredEnv();
    installFetch({ ok: true, body: { ok: true, ...OK_SUMMARY } });

    const summary = await postBeltImport(makeFiles(), SECRET);
    expect(summary).toEqual(OK_SUMMARY);
  });

  it('throws (no request) when Supabase is not configured', async () => {
    stubUnconfiguredEnv();
    const fetchFn = installFetch({ ok: true, body: { ok: true, ...OK_SUMMARY } });
    await expect(postBeltImport(makeFiles(), SECRET)).rejects.toThrow(/not.*configured|configured/i);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

// ─── postBeltImport — reject codes ───────────────────────────────────────────
describe('postBeltImport — reject handling', () => {
  it.each(ALL_REJECT_CODES)('throws BeltImportError carrying the %s code', async (code) => {
    stubConfiguredEnv();
    installFetch({ ok: false, status: 422, body: { error: code } });

    await expect(postBeltImport(makeFiles(), SECRET)).rejects.toMatchObject({
      name: 'BeltImportError',
      code,
    });
  });

  it('falls back to a typed error when the reject body is unshaped', async () => {
    stubConfiguredEnv();
    installFetch({ ok: false, status: 500, body: 'not json shaped' });

    const err = await postBeltImport(makeFiles(), SECRET).catch((e) => e);
    expect(err).toBeInstanceOf(BeltImportError);
    expect(err.code).toBe('internal_error');
  });
});

// ─── beltRejectMessage — exhaustive, safe copy ───────────────────────────────
describe('beltRejectMessage', () => {
  it.each(ALL_REJECT_CODES)('maps %s to a non-empty owner-facing message', (code) => {
    const msg = beltRejectMessage(code);
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
  });

  it('never leaks the raw code back as the message', () => {
    for (const code of ALL_REJECT_CODES) {
      expect(beltRejectMessage(code)).not.toBe(code);
    }
  });

  it('uses the specific import-code copy for forbidden', () => {
    expect(beltRejectMessage('forbidden')).toBe('That import code wasn’t accepted.');
  });
});

// ─── detectBeltSourceKind — advisory chip ────────────────────────────────────
describe('detectBeltSourceKind (advisory)', () => {
  it('classifies each of the three sources by header line', () => {
    expect(detectBeltSourceKind(RET_HEADER)).toBe('retention');
    expect(detectBeltSourceKind(CUR_HEADER)).toBe('current68');
    expect(detectBeltSourceKind(PREV_HEADER)).toBe('previous69');
  });

  it('returns "unknown" for an unrecognized header', () => {
    expect(detectBeltSourceKind('Foo,Bar,Baz')).toBe('unknown');
  });
});

// ─── isBeltImportConfigured ──────────────────────────────────────────────────
describe('isBeltImportConfigured', () => {
  it('is true only when both VITE_SUPABASE_URL and ANON_KEY are present', () => {
    stubUnconfiguredEnv();
    expect(isBeltImportConfigured()).toBe(false);
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    expect(isBeltImportConfigured()).toBe(false);
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-test-key');
    expect(isBeltImportConfigured()).toBe(true);
  });
});

// ─── corsHeadersFor — narrow allowlist ───────────────────────────────────────
describe('corsHeadersFor', () => {
  it('echoes ACAO for an allowed origin, with methods + headers', () => {
    for (const origin of CORS_ALLOWED_ORIGINS) {
      const h = corsHeadersFor(origin);
      expect(h['Access-Control-Allow-Origin']).toBe(origin);
      expect(h['Access-Control-Allow-Methods']).toBe('POST, OPTIONS');
      expect(h['Access-Control-Allow-Headers']).toContain('x-belt-import-trigger-secret');
      expect(h['Access-Control-Allow-Headers']).toContain('authorization');
      expect(h['Access-Control-Allow-Headers']).toContain('apikey');
      expect(h.Vary).toBe('Origin');
    }
  });

  it('sends NO Access-Control-Allow-Origin for a disallowed origin', () => {
    const h = corsHeadersFor('https://evil.example.com');
    expect(h['Access-Control-Allow-Origin']).toBeUndefined();
    // Methods/headers are still present — but without ACAO the browser blocks it.
    expect(h['Access-Control-Allow-Methods']).toBe('POST, OPTIONS');
  });

  it('sends NO Access-Control-Allow-Origin for an absent origin', () => {
    expect(corsHeadersFor(null)['Access-Control-Allow-Origin']).toBeUndefined();
    expect(corsHeadersFor(undefined)['Access-Control-Allow-Origin']).toBeUndefined();
  });
});
