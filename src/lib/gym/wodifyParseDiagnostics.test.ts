import { describe, expect, it } from 'vitest';
import { bodyByteMetadata, MAX_DIAGNOSTIC_BODY_BYTES, observePagination, parseUpstreamJson, safeContentType, WodifyParseError } from './wodifyParseDiagnostics';
const run = <T>(operation: Promise<T>) => operation;

describe('pagination observations never coerce the contract', () => {
  it.each([
    [{}, ['page_mismatch', 'page_size_mismatch', 'has_more_type']],
    [{ page: 2, page_size: 25, has_more: false }, ['page_mismatch']],
    [{ page: 1, page_size: 24, has_more: false }, ['page_size_mismatch']],
    [{ page: 1, page_size: 25, has_more: null }, ['has_more_type']],
  ])('lists all failed predicates in fixed order (%#)', (fields, expected) => {
    expect(observePagination(fields, 1, 1, 25, 200).pagination_failures).toEqual(expected);
  });
  it('distinguishes numeric values, digit strings, missing fields, and fixed boolean strings', () => {
    expect(observePagination({ page: '041', page_size: 25, has_more: 'false' }, 0, 41, 25, 200)).toEqual({
      page_present: true, page_type: 'string', page_integer: null, page_digit_string: '041',
      page_size_present: true, page_size_type: 'number', page_size_integer: 25, page_size_digit_string: null,
      has_more_present: true, has_more_type: 'string', has_more_boolean: null, has_more_string_boolean: 'false',
      client_row_count: 0, pagination_failures: ['page_mismatch', 'has_more_type', 'empty_nonterminal'],
    });
    expect(observePagination({}, 0, 1, 25, 200)).toMatchObject({ page_present: false, page_type: 'missing',
      page_size_present: false, page_size_type: 'missing', has_more_present: false, has_more_type: 'missing' });
  });
  it.each([null, true, 1.5, Number.MAX_SAFE_INTEGER + 1, '1234567', '12\n', '-1', 'private-secret', ['private-secret'], { private: 'secret' }])(
    'does not reflect unsafe scalar values or nested content (%#)', (value) => {
      const out = observePagination({ page: value, page_size: value, has_more: value, private: 'secret' }, 0, 200, 25, 200);
      expect(out.page_integer).toBeNull();
      expect(out.page_digit_string).toBeNull();
      expect(JSON.stringify(out)).not.toMatch(/private|secret/);
      expect(new WodifyParseError('clients_row', undefined, out).diagnostic()).not.toHaveProperty('pagination');
    });
  it('mirrors each row/cap predicate and preserves valid empty and short terminal observations', () => {
    expect(observePagination({ page: 200, page_size: 25, has_more: true }, 0, 200, 25, 200).pagination_failures)
      .toEqual(['empty_nonterminal', 'max_page_nonterminal']);
    expect(observePagination({ page: 200, page_size: 25, has_more: true }, 26, 200, 25, 200).pagination_failures)
      .toEqual(['row_count_exceeds_requested', 'max_page_nonterminal']);
    for (const rows of [0, 1, 25]) expect(observePagination({ page: 41, page_size: 25, has_more: false }, rows, 41, 25, 200).pagination_failures).toEqual([]);
  });
});

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
