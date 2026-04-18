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

Return a single JSON object with exactly these six string fields. No markdown, no preamble, no commentary — only the JSON object.`;

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

// ─── Provider call (stub) ─────────────────────────────────────────────────────

async function callAIProvider(
  _systemPrompt: string,
  _userMessage: string
): Promise<string> {
  throw new Error(
    'AI provider not configured — secure server-side proxy is not yet in place. Falling back to deterministic copy.'
  );
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
    const parsed = JSON.parse(raw);
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
