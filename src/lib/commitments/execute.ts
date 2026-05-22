// Execute Stage 1 (Item B) — the reserve_warning "money-finding aid" (#6.1).
//
// Shape C (locked): a guided pick-one-lever surface. It curates the app's own
// pre-computed expense overruns — `model.opportunities`, the categories whose
// latest month ran above their trailing-3-month baseline (compute.ts
// buildOpportunities) — into ONE recommended lever plus up to two alternates,
// framed as a single decision. Deterministic, no AI. Informational only: the
// owner acts outside the app — no writes, no selected-lever state, no persistence.
//
// Deliberately narrow — reserve_warning only. This is a money-finding aid, NOT a
// generic Execute framework; the second commitment type that needs execution help
// is what would force that abstraction.
//
// Availability is reduce-to-content: buildExecuteHelp returns null ONLY when the
// open commitment isn't a reserve_warning. When it is, it always returns help —
// either `levers` (real overruns found) or an honest `none` message (#3: never
// fake a lever). The card derives the affordance's availability from
// `help !== null`. (B-1 shipped this seam as `hasExecuteHelp(): boolean`; B-2
// evolves it into the content seam.)
import type { DashboardModel, OpportunityItem } from '../data/contract';
import type { PriorityHistoryRow } from '../priorities/types';

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

// The exact title compute.ts buildOpportunities emits for its generic fallback
// (compute.ts ~L1751) when NO category overran its baseline. compute.ts is a
// LOCKED file (AGENTS.md), so we detect the fallback by matching this literal
// rather than adding a discriminator field to OpportunityItem. If that wording
// ever changes (which requires unlocking compute.ts), the execute.test.ts pin
// fails loudly — update both together.
export const FALLBACK_OPPORTUNITY_TITLE = 'Tighten discretionary spend';

// compute.ts titles overrun opportunities as `Control <category>`; strip the
// prefix to recover the bare category for owner-voice copy. Degrades to the full
// title if the prefix is ever absent.
const CONTROL_PREFIX = 'Control ';

export interface ExecuteLever {
  /** Bare expense category, e.g. "Marketing". */
  category: string;
  /** Dollars this category ran above its recent baseline (the opportunity savings). */
  overrun: number;
  /** Owner-voice line for this lever. */
  text: string;
}

export type ExecuteHelp =
  | {
      kind: 'levers';
      lead: string;
      recommended: ExecuteLever;
      alternates: ExecuteLever[];
    }
  | { kind: 'none'; text: string };

function categoryOf(item: OpportunityItem): string {
  return item.title.startsWith(CONTROL_PREFIX)
    ? item.title.slice(CONTROL_PREFIX.length)
    : item.title;
}

function toLever(item: OpportunityItem, recommended: boolean): ExecuteLever {
  const category = categoryOf(item);
  const amount = usd.format(item.savings);
  return {
    category,
    overrun: item.savings,
    text: recommended
      ? `${category} ran ${amount} above its recent average — the clearest place to find it.`
      : `${category} — ${amount} above average`,
  };
}

export function buildExecuteHelp(
  model: DashboardModel,
  commitment: PriorityHistoryRow,
): ExecuteHelp | null {
  // Narrow path (lock #1): money-finding help only applies to a reserve_warning.
  if (commitment.signal_type !== 'reserve_warning') return null;

  // compute.ts already sorts by savings desc; apply a deterministic secondary
  // (category asc) so equal-overrun ties render stably.
  const ranked = [...model.opportunities].sort(
    (a, b) => b.savings - a.savings || categoryOf(a).localeCompare(categoryOf(b)),
  );
  const top = ranked[0];

  // #3: when nothing genuinely overran — no opportunities, or only compute's
  // generic fallback — don't dress it up as a found lever. Say so honestly; the
  // commitment still stands.
  if (!top || top.title === FALLBACK_OPPORTUNITY_TITLE) {
    return {
      kind: 'none',
      text: "Nothing ran above its recent norm this month, so there's no obvious line to cut. The reserve gap stands — revisit when spending moves.",
    };
  }

  return {
    kind: 'levers',
    lead: "Here's where spending ran above its recent norm this month — pick one to pull back:",
    recommended: toLever(top, true),
    alternates: ranked.slice(1, 3).map((item) => toLever(item, false)),
  };
}
