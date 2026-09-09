import { describe, expect, it } from 'vitest';
import { bodyByteMetadata, MAX_DIAGNOSTIC_BODY_BYTES, parseUpstreamJson, safeContentType, WodifyParseError } from './wodifyParseDiagnostics';
const run = <T>(operation: Promise<T>) => operation;

describe('bounded parse diagnostics', () => {
  it.each([
    [null, 'missing'], ['Application/JSON; charset=utf-8; secret=private', 'application/json'],
    ['text/html; private=secret', 'text/html'], [' text/plain ', 'text/plain'],
    ['application/private+json', 'other'], ['private'.repeat(1000), 'other'], ['', 'other'],
  ])('does not reflect arbitrary media values (%#)', (raw, expected) => {
    expect(safeContentType(raw)).toBe(expected);
  });
  it('records exact ordinary byte lengths and an explicit overflow state', () => {
    for (const length of [0, 7, MAX_DIAGNOSTIC_BODY_BYTES]) {
      expect(bodyByteMetadata(length)).toEqual({ response_body_bytes: length, response_body_bytes_overflow: false });
    }
    for (const length of [MAX_DIAGNOSTIC_BODY_BYTES + 1, -1, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(bodyByteMetadata(length)).toEqual({ response_body_bytes: null, response_body_bytes_overflow: true });
    }
  });
  it('preserves Response.json semantics for valid UTF-8/BOM and measures bytes, not characters', async () => {
    const raw = '\uFEFF{"value":"é秘密"}';
    const bytes = new TextEncoder().encode(raw);
    const parsed = await parseUpstreamJson(new Response(bytes), 'clients_json_decode', run);
    expect(parsed.body).toEqual(await new Response(bytes).json());
    expect(parsed.metadata.response_body_bytes).toBe(bytes.byteLength);
    expect(parsed.metadata.response_body_bytes).toBeGreaterThan(raw.length);
    expect(parsed.metadata.outer_json_valid).toBe(true);
  });
  it('tags malformed detail JSON without retaining the source or exception text', async () => {
    try {
      await parseUpstreamJson(new Response('private-invalid-json'), 'detail_json_decode', run);
      throw new Error('expected parse rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(WodifyParseError);
      expect((error as WodifyParseError).diagnostic()).toEqual({ parse_stage: 'detail_json_decode',
        outer_json_valid: false, response_content_type: 'text/plain', response_body_bytes: 20,
        response_body_bytes_overflow: false });
      expect(JSON.stringify(error)).not.toContain('private');
      expect((error as Error).message).toBe('wodify parse diagnostic');
    }
  });
});
