// Constrained-generator: the AI tone layer for the committed day_one summary.
// Code owns what is true (the exact weekly target, the action, the check-back
// deadline); the AI only re-tones the confirmation sentence. Every AI rendering
// is grounded (validateGrounding) against the code target AND deadline before it
// reaches the owner — any contradiction, malformed response, or proxy failure
// falls back verbatim to the deterministic dayOneSummary. Fail closed: the owner
// never sees an AI-invented number or date, and never sees an error.
//
// The prompt asks for relative timing ("this week") and forbids invented dates;
// the deadline fact passed to validateGrounding ENFORCES that — a model that
// disobeys with a wrong date is rejected (Slice 1b), not merely discouraged.
//
// Stable-per-commitment: a validated AI summary is cached (read-first, then
// write-through ONLY on a grounding pass) so the day_one confirmation reads like
// a receipt — generated once, served verbatim on every reload, no re-roll. The
// never-cache-fallback invariant is structural: the cache write lives on the sole
// success path, so no fallback / proxy error / malformed / grounding rejection
// can ever be persisted.
//
// Why a commitment-specific prompt rather than the hero card's: the hero prompt
// rounds amounts to $NK, which for a precise commitment target would itself be a
// contradiction ($1,200 -> "$1K"). This prompt pins the exact figure.
import type { PriorityHistoryRow } from '../priorities/types';
import { callAIProvider } from '../priorities/ai';
import { dayOneSummary, formatDeadline } from './templater';
import { validateGrounding } from './copyGrounding';
import { readCachedCommitmentSummary, writeCachedCommitmentSummary } from './summaryCache';

const SYSTEM_PROMPT = `You are a calm, steady CFO advisor. The owner has just committed to move an exact amount of money into their operating reserve this week. Reflect their decision back in one short sentence and let them know you'll check in this week.

Voice:
- Calm and matter-of-fact, not enthusiastic. No exclamations, and no "Perfect", "Great", "Awesome", "Got it", or "Sounds good" openers.
- The owner is the one taking action — make them the subject ("You're moving $X…"), not the assistant ("I've got you down…").
- Plain English, no jargon. No guilt, no pressure, no praise for its own sake.

Hard rules — non-negotiable:
- Use the EXACT dollar amount you are given, written with a $ (e.g. $100, $1,200). Never round it, never abbreviate it (no "$1K"), never change it.
- Mention NO other dollar amount, number, or percentage of any kind.
- Refer to timing only as "this week" or "in about a week" — never invent a specific date.
- One sentence, under 140 characters.

Return a single JSON object: {"summary": "<your sentence>"}. Output only the raw JSON — no markdown fences, no preamble or postamble.`;

// Exact dollars: whole amounts as "$1,200", fractional as "$100.50". Deliberately
// NOT maximumFractionDigits:0 — rounding here would feed the AI a figure the
// grounding validator then rejects.
function exactUsd(amount: number): string {
  return Number.isInteger(amount)
    ? `$${amount.toLocaleString('en-US')}`
    : `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function buildUserMessage(row: PriorityHistoryRow, target: number): string {
  return [
    `The owner just committed to this action: ${row.committed_action ?? ''}`,
    `Exact weekly amount — use this figure verbatim, do not round or change it: ${exactUsd(target)}`,
    'You will check back with them in about one week.',
    '',
    'Write the confirmation. Respond with JSON only.',
  ].join('\n');
}

function warnGroundingFallback(reason: string): void {
  if (import.meta.env.DEV) {
    console.warn('[commitments/grounding] day_one summary fell back:', reason);
  }
}

export async function generateGroundedDayOneSummary(row: PriorityHistoryRow): Promise<string> {
  const fallback = dayOneSummary(row);
  const target = row.target_value;
  // No target to ground against — the deterministic line stands.
  if (target == null || !Number.isFinite(target)) return fallback;

  // Cache read first: a previously-validated summary for this exact commitment
  // (id + facts) is served verbatim — no proxy call, no re-roll. A hit needs no
  // re-validation: the grounded facts (target, deadline) are part of the cache
  // key, so the cached sentence was validated against these exact values.
  const cached = await readCachedCommitmentSummary(row);
  if (cached !== null) return cached;

  try {
    const raw = await callAIProvider(SYSTEM_PROMPT, buildUserMessage(row, target));
    const parsed: unknown = JSON.parse(raw);
    const candidate =
      parsed !== null &&
      typeof parsed === 'object' &&
      typeof (parsed as { summary?: unknown }).summary === 'string'
        ? (parsed as { summary: string }).summary.trim()
        : '';
    if (candidate.length === 0) {
      warnGroundingFallback('malformed_response');
      return fallback;
    }
    const verdict = validateGrounding(candidate, {
      target,
      deadline: formatDeadline(row.deadline_date),
    });
    if (!verdict.ok) {
      warnGroundingFallback(verdict.reason);
      return fallback;
    }
    // Sole success path → the only place a summary is cached (never-cache-fallback
    // P0). Fire-and-forget: the write swallows its own errors and the owner is
    // already getting this validated line, so a failed write only costs a future
    // regeneration. Mirrors the hero cache write in priorities/ai.ts.
    void writeCachedCommitmentSummary(row, candidate);
    return candidate;
  } catch {
    // callAIProvider already DEV-warns the transport failure category
    // (timeout / status_5xx / parse_error / …); fail closed to deterministic.
    return fallback;
  }
}
