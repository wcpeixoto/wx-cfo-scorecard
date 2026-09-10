// Fixed-vocabulary metadata only; never retain body text, headers or exceptions.
export type ParseStage = 'clients_fetch' | 'clients_body_read' | 'detail_body_read' | 'clients_json_decode' | 'clients_envelope' | 'clients_pagination'
  | 'clients_row' | 'clients_identifier' | 'clients_duplicate' | 'detail_json_decode'
  | 'page_build_draft' | 'page_persist_draft' | 'page_success_response';
export type ParseMetadata = {
  outer_json_valid: boolean | null;
  response_content_type: 'application/json' | 'text/html' | 'text/plain' | 'other' | 'missing' | null;
  response_body_bytes: number | null;
  response_body_bytes_overflow: boolean;
};
export const MAX_DIAGNOSTIC_BODY_BYTES = 64 * 1024 * 1024;
type JsonFieldType = 'missing' | 'null' | 'boolean' | 'number' | 'string' | 'array' | 'object';
export type PaginationDiagnostic = {
  page_present: boolean; page_type: JsonFieldType; page_integer: number | null; page_digit_string: string | null;
  page_size_present: boolean; page_size_type: JsonFieldType; page_size_integer: number | null; page_size_digit_string: string | null;
  has_more_present: boolean; has_more_type: JsonFieldType; has_more_boolean: boolean | null; has_more_string_boolean: 'true' | 'false' | null;
  client_row_count: number;
  pagination_failures: ('page_mismatch' | 'page_size_row_count_mismatch' | 'page_size_exceeds_requested' | 'has_more_type' | 'row_count_exceeds_requested' | 'short_nonterminal' | 'max_page_nonterminal')[];
};

/** Observe only after the original predicate failed; this never decides acceptance. */
export function observePagination(pagination: Record<string, unknown>, rows: number, requested: number, size: number, max: number): PaginationDiagnostic {
  const present = (key: string) => Object.prototype.hasOwnProperty.call(pagination, key);
  const kind = (key: string): JsonFieldType => !present(key) ? 'missing'
    : pagination[key] === null ? 'null' : Array.isArray(pagination[key]) ? 'array' : typeof pagination[key] as JsonFieldType;
  const integer = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
  const digits = (value: unknown) => typeof value === 'string' && value.length >= 1 && value.length <= 6 && !/[^0-9]/.test(value) ? value : null;
  const page = pagination.page, pageSize = pagination.page_size, hasMore = pagination.has_more;
  const failures: PaginationDiagnostic['pagination_failures'] = [];
  if (page !== requested) failures.push('page_mismatch');
  if (pageSize !== rows) failures.push('page_size_row_count_mismatch');
  // The fetch check reaches this comparison only after strict equality to an
  // array length has established a number. Never coerce malformed objects here.
  if (typeof pageSize === 'number' && pageSize > size) failures.push('page_size_exceeds_requested');
  if (typeof hasMore !== 'boolean') failures.push('has_more_type');
  if (rows > size) failures.push('row_count_exceeds_requested');
  // Deliberately mirror the original truthiness, including wrong-type values.
  if (hasMore && pageSize !== size) failures.push('short_nonterminal');
  if (hasMore && requested === max) failures.push('max_page_nonterminal');
  return {
    page_present: present('page'), page_type: kind('page'), page_integer: integer(page), page_digit_string: digits(page),
    page_size_present: present('page_size'), page_size_type: kind('page_size'), page_size_integer: integer(pageSize), page_size_digit_string: digits(pageSize),
    has_more_present: present('has_more'), has_more_type: kind('has_more'), has_more_boolean: typeof hasMore === 'boolean' ? hasMore : null,
    has_more_string_boolean: hasMore === 'true' || hasMore === 'false' ? hasMore : null,
    client_row_count: rows, pagination_failures: failures,
  };
}
export const NO_RESPONSE_METADATA: ParseMetadata = {
  outer_json_valid: null, response_content_type: null,
  response_body_bytes: null, response_body_bytes_overflow: false,
};
export function bodyByteMetadata(length: number): Pick<ParseMetadata, 'response_body_bytes' | 'response_body_bytes_overflow'> {
  const overflow = !Number.isSafeInteger(length) || length < 0 || length > MAX_DIAGNOSTIC_BODY_BYTES;
  return { response_body_bytes: overflow ? null : length, response_body_bytes_overflow: overflow };
}
export class WodifyParseError extends SyntaxError {
  constructor(readonly stage: ParseStage, readonly metadata: ParseMetadata = NO_RESPONSE_METADATA, readonly pagination?: PaginationDiagnostic) {
    super('wodify parse diagnostic');
  }
  diagnostic() { return { parse_stage: this.stage, ...this.metadata,
    ...(this.stage === 'clients_pagination' && this.pagination ? { pagination: this.pagination } : {}) }; }
}

export function safeContentType(raw: string | null): ParseMetadata['response_content_type'] {
  if (raw === null) return 'missing';
  const media = raw.split(';', 1)[0].trim().toLowerCase();
  return media === 'application/json' || media === 'text/html' || media === 'text/plain' ? media : 'other';
}

/** Same UTF-8 JSON semantics as Response.json; measure decoded HTTP body bytes. */
export async function parseUpstreamJson(
  response: Response, stage: 'clients_json_decode' | 'detail_json_decode',
  run: <T>(operation: Promise<T>) => Promise<T>,
): Promise<{ body: unknown; metadata: ParseMetadata }> {
  let bytes: ArrayBuffer;
  try { bytes = await run(response.arrayBuffer()); }
  catch (error) {
    if (error instanceof SyntaxError) throw new WodifyParseError(
      stage === 'clients_json_decode' ? 'clients_body_read' : 'detail_body_read',
      { ...NO_RESPONSE_METADATA, response_content_type: safeContentType(response.headers.get('content-type')) },
    );
    throw error;
  }
  const metadata: ParseMetadata = {
    outer_json_valid: false, response_content_type: safeContentType(response.headers.get('content-type')),
    ...bodyByteMetadata(bytes.byteLength),
  };
  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); }
  catch (error) {
    if (error instanceof SyntaxError) throw new WodifyParseError(stage, metadata);
    throw error;
  }
  return run(Promise.resolve({ body, metadata: { ...metadata, outer_json_valid: true } }));
}
