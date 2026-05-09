import type { Signal, SignalType, PriorityHistoryRow } from './types';
import { getFallbackCopy } from './copy';
import { savePriorityHistory } from '../data/sharedPersistence';

export interface AIProse {
  headline: string;
  why: string;
  currentState: string;
  action: string;
  alternative: string;
  followupNote: string;
}

type MetricDirection = 'worsened' | 'improved' | 'unchanged' | 'unknown';

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a CFO advisor writing a single daily priority card for a small business owner.

Your tone:
- Plain English, no accounting jargon (avoid "reserve ratio", "liquidity floor", "runway multiple", "EBITDA", "variance")
- Direct and calm — you are not alarming, you are informing
- Respect the owner's time — every sentence earns its place
- Speak to the owner, not about them

Your job is to produce six short fields that explain one operating signal:
- headline: one sentence, under 60 characters, stating the situation
- why: 1–2 sentences explaining what's going on and why it matters
- currentState: 1 sentence with the concrete number and what it means
- action: 1 sentence — the primary thing to do this week
- alternative: 1 sentence — a backup move if the primary action isn't available
- followupNote: 1 sentence — what to watch for or expect next

Return a single JSON object with exactly these six string fields. Output only the raw JSON object — do not wrap it in markdown code fences, do not include a preamble, postamble, or any surrounding text.`;

const AI_PROXY_URL = 'https://gzgxcvjvoivlwaksnmxy.supabase.co/functions/v1/ai-proxy';
const AI_PROXY_TIMEOUT_MS = 5000;

// ─── Metric direction ─────────────────────────────────────────────────────────

const WORSE_WHEN_HIGHER: ReadonlySet<SignalType> = new Set<SignalType>([
  'expense_surge',
  'owner_distributions_high',
]);

const WORSE_WHEN_LOWER: ReadonlySet<SignalType> = new Set<SignalType>([
  'reserve_critical',
  'reserve_warning',
  'cash_flow_negative',
  'cash_flow_tight',
  'revenue_decline',
]);

function computeMetricDirection(
  signal: Signal,
  priorHistory?: PriorityHistoryRow
): MetricDirection {
  if (signal.type === 'steady_state') return 'unchanged';
  if (!priorHistory) return 'unknown';
  if (signal.metricValue === undefined || priorHistory.metric_value === undefined) {
    return 'unknown';
  }

  const now = signal.metricValue;
  const prior = priorHistory.metric_value;

  if (now === prior) return 'unchanged';

  if (WORSE_WHEN_HIGHER.has(signal.type)) {
    return now > prior ? 'worsened' : 'improved';
  }
  if (WORSE_WHEN_LOWER.has(signal.type)) {
    return now < prior ? 'worsened' : 'improved';
  }
  return 'unknown';
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildUserMessage(signal: Signal, priorHistory?: PriorityHistoryRow): string {
  const direction = computeMetricDirection(signal, priorHistory);

  const lines: string[] = [];
  lines.push(`Signal type: ${signal.type}`);
  lines.push(`Severity: ${signal.severity}`);

  if (signal.metricValue !== undefined) {
    lines.push(`Current metric value: ${signal.metricValue}`);
  }
  if (signal.targetValue !== undefined) {
    lines.push(`Target / baseline value: ${signal.targetValue}`);
  }
  if (signal.gapAmount !== undefined) {
    lines.push(`Gap amount: ${signal.gapAmount}`);
  }
  if (signal.categoryFlagged) {
    lines.push(`Category flagged: ${signal.categoryFlagged}`);
  }
  if (signal.recommendedAction) {
    lines.push(`Suggested action hint: ${signal.recommendedAction}`);
  }

  if (priorHistory) {
    lines.push('');
    lines.push(`Prior occurrence fired at: ${priorHistory.fired_at}`);
    if (priorHistory.metric_value !== undefined) {
      lines.push(`Prior metric value: ${priorHistory.metric_value}`);
    }
    lines.push(`Direction since last time: ${direction}`);
  } else {
    lines.push('');
    lines.push('No prior occurrence of this signal on record.');
  }

  lines.push('');
  lines.push('Write the six fields as specified. Respond with JSON only.');

  return lines.join('\n');
}

// ─── Provider call ────────────────────────────────────────────────────────────

type FallbackCategory =
  | `status_${number}`
  | 'timeout'
  | 'parse_error'
  | 'validation_error'
  | 'network_error'
  | 'unknown_error';

function warnFallback(category: FallbackCategory): void {
  if (import.meta.env.DEV) {
    console.warn('[priorities/ai] fallback:', category);
  }
}

const FENCE_RE = /^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/;

function stripJsonFences(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(FENCE_RE);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

async function callAIProvider(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  let categorized = false;
  const warn = (category: FallbackCategory): void => {
    categorized = true;
    warnFallback(category);
  };

  try {
    let res: Response;
    try {
      res = await fetch(AI_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
          temperature: 0,
          max_tokens: 512,
        }),
        signal: AbortSignal.timeout(AI_PROXY_TIMEOUT_MS),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      warn(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network_error');
      throw err;
    }

    if (!res.ok) {
      warn(`status_${res.status}` as FallbackCategory);
      throw new Error(`AI proxy returned status ${res.status}`);
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch (err) {
      warn('parse_error');
      throw err;
    }

    if (data === null || typeof data !== 'object') {
      warn('validation_error');
      throw new Error('AI proxy response is not an object');
    }
    const content = (data as { content?: unknown }).content;
    if (!Array.isArray(content) || content.length === 0) {
      warn('validation_error');
      throw new Error('AI proxy response missing content array');
    }
    const first = content[0] as { type?: unknown; text?: unknown } | null;
    if (
      first === null ||
      typeof first !== 'object' ||
      first.type !== 'text' ||
      typeof first.text !== 'string'
    ) {
      warn('validation_error');
      throw new Error('AI proxy response content[0] is not a text block');
    }

    const text = stripJsonFences(first.text);
    if (text.length === 0) {
      warn('validation_error');
      throw new Error('AI proxy response text is empty after fence strip');
    }
    return text;
  } catch (err) {
    if (!categorized) warnFallback('unknown_error');
    throw err;
  }
}

// ─── Response validation ──────────────────────────────────────────────────────

const REQUIRED_FIELDS: readonly (keyof AIProse)[] = [
  'headline',
  'why',
  'currentState',
  'action',
  'alternative',
  'followupNote',
];

function validateProseResponse(parsed: unknown): AIProse {
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('AI response is not an object');
  }
  const obj = parsed as Record<string, unknown>;
  const out: Partial<AIProse> = {};
  for (const field of REQUIRED_FIELDS) {
    const v = obj[field];
    if (typeof v !== 'string') {
      throw new Error(`AI response field "${field}" is missing or not a string`);
    }
    if (v.trim().length === 0) {
      throw new Error(`AI response field "${field}" is empty`);
    }
    out[field] = v;
  }
  return out as AIProse;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function getAIProse(
  signal: Signal,
  priorHistory?: PriorityHistoryRow
): Promise<AIProse> {
  try {
    const userMessage = buildUserMessage(signal, priorHistory);
    const raw = await callAIProvider(SYSTEM_PROMPT, userMessage);
    const parsed = JSON.parse(stripJsonFences(raw));
    const prose = validateProseResponse(parsed);

    // Write-back stub: only on AI success, never on fallback.
    try {
      await savePriorityHistory({
        signal_type: signal.type,
        severity: signal.severity,
        metric_value: signal.metricValue,
        target_value: signal.targetValue,
        category_flagged: signal.categoryFlagged,
        gap_amount: signal.gapAmount,
        recommended_action: signal.recommendedAction,
        ai_headline: prose.headline,
      });
    } catch (writeErr) {
      console.error('[priorities/ai] write-back failed:', writeErr);
    }

    return prose;
  } catch (err) {
    console.warn('[priorities/ai] falling back to deterministic copy:', err);
    return getFallbackCopy(signal, priorHistory);
  }
}
