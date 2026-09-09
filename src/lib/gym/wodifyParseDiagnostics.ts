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
export const NO_RESPONSE_METADATA: ParseMetadata = {
  outer_json_valid: null, response_content_type: null,
  response_body_bytes: null, response_body_bytes_overflow: false,
};
export function bodyByteMetadata(length: number): Pick<ParseMetadata, 'response_body_bytes' | 'response_body_bytes_overflow'> {
  const overflow = !Number.isSafeInteger(length) || length < 0 || length > MAX_DIAGNOSTIC_BODY_BYTES;
  return { response_body_bytes: overflow ? null : length, response_body_bytes_overflow: overflow };
}
export class WodifyParseError extends SyntaxError {
  constructor(readonly stage: ParseStage, readonly metadata: ParseMetadata = NO_RESPONSE_METADATA) {
    super('wodify parse diagnostic');
  }
  diagnostic() { return { parse_stage: this.stage, ...this.metadata }; }
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
