import type { Signal, PriorityHistoryRow } from './types';
import type { AIProse } from './ai';
import type { DashboardModel } from '../data/contract';
import { watchMetricForSignal } from '../commitments';

// ─── Formatting helpers ───────────────────────────────────────────────────────

function fmt(amount: number | undefined): string {
  if (amount === undefined || amount === null || isNaN(amount)) return 'an amount';
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(abs / 1_000)}K`;
  return `$${Math.round(abs)}`;
}

function pct(ratio: number | undefined): string {
  if (ratio === undefined || ratio === null || isNaN(ratio)) return 'some';
  return `${Math.round(Math.abs(ratio) * 100)}%`;
}

function cat(category: string | undefined): string {
  return category ?? 'a category';
}

// "2026-05" → "May 2026". Mirrors the inline pattern used in
// CashFlowForecastModule.tsx:387 — en-US, UTC, short month name.
function formatTroughMonth(month: string | undefined): string {
  if (!month) return 'the forecast window';
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) return 'the forecast window';
  const year = Number.parseInt(match[1], 10);
  const monthIndex = Number.parseInt(match[2], 10) - 1;
  if (!Number.isFinite(year) || monthIndex < 0 || monthIndex > 11) {
    return 'the forecast window';
  }
  return new Date(Date.UTC(year, monthIndex, 1)).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function metricWorsened(signal: Signal, prior: PriorityHistoryRow | undefined): boolean {
  if (!prior || signal.metricValue === undefined || prior.metric_value === undefined) return false;
  switch (signal.type) {
    case 'expense_surge':
    case 'owner_distributions_high':
      return signal.metricValue > prior.metric_value;
    default:
      return signal.metricValue < prior.metric_value;
  }
}

// ─── Fallback copy ────────────────────────────────────────────────────────────

export function getFallbackCopy(
  signal: Signal,
  priorHistory?: PriorityHistoryRow
): AIProse {
  const worsened = metricWorsened(signal, priorHistory);

  switch (signal.type) {

    case 'reserve_critical': {
      // TODO(phase-2.5+): reserve_critical stays awareness-only this slice
      // (Fork E). Make it commitment-ready (one action + a registry watch
      // entry) in a later slice.
      const fundedPct = pct(signal.metricValue);
      const gap = fmt(signal.gapAmount);
      return {
        signalType: signal.type,
        severity: signal.severity,
        headline: `Operating Reserve is ${gap} short of target`,
        why: worsened
          ? `Your reserve has dropped further — now at ${fundedPct} of where it needs to be. Right now there's not much between you and a real squeeze if something unexpected hits.`
          : `Your reserve is at ${fundedPct} — below the level that keeps you safe when something unexpected hits. Right now, there's not much buffer between you and a real squeeze.`,
        currentState: `You're ${gap} short of the halfway mark — that's how far you are from real breathing room.`,
        action: 'Find one expense to cut this month — the fastest controllable move when reserves are critical.',
      };
    }

    case 'reserve_warning': {
      const fundedPct = pct(signal.metricValue);
      const gap = fmt(signal.gapAmount);
      return {
        signalType: signal.type,
        severity: signal.severity,
        headline: `Operating Reserve is at ${fundedPct} — still short of target`,
        why: worsened
          ? `Your reserve slipped to ${fundedPct} — the direction reversed since last time. Small surprises are manageable, but bigger ones would squeeze you.`
          : `You're at ${fundedPct} of your target. You have a cushion, but not the full buffer you'd want if something unexpected hit.`,
        currentState: `You need ${gap} more to be fully funded. You're in the right zone — just not all the way there yet.`,
        action: 'Move money into your operating reserve this week — pick an amount you can hit in seven days.',
      };
    }

    case 'cash_flow_negative': {
      const lowest = fmt(signal.metricValue);
      const gap = fmt(signal.gapAmount);
      const troughMonth = formatTroughMonth(signal.troughMonth);
      return {
        signalType: signal.type,
        severity: signal.severity,
        headline: `Cash is projected to go negative by ${gap}`,
        why: worsened
          ? `The forward outlook has gotten worse since last time — your projected low point is now ${lowest}. This needs attention before it becomes a real constraint.`
          : `Based on your current pace, your balance is projected to go negative. That's not just a warning — it means bills don't get paid on time.`,
        currentState: `Your lowest projected balance is ${lowest} in ${troughMonth}. You need ${gap} more to stay above zero through the forecast window.`,
        action: 'Send any outstanding invoices today — collecting what you\'re already owed is the fastest cash you can pull in.',
      };
    }

    case 'cash_flow_tight': {
      const lowest = fmt(signal.metricValue);
      const gap = fmt(signal.gapAmount);
      const troughMonth = formatTroughMonth(signal.troughMonth);
      return {
        signalType: signal.type,
        severity: signal.severity,
        headline: `Cash floor drops to ${lowest} in ${troughMonth}`,
        why: worsened
          ? `The forward picture has tightened since last check — your lowest projected balance is ${lowest}. You won't run dry, but the cushion is thinner.`
          : `Your projected cash stays positive, but could fall ${gap} below your Operating Reserve. You're not in danger, but you'd be cutting it close.`,
        currentState: `The lowest your balance gets is ${lowest} in ${troughMonth} — just below the Operating Reserve you've set.`,
        action: 'Identify one payment you can shift out by 2–4 weeks — smoothing the timing relieves the squeeze.',
      };
    }

    case 'expense_surge': {
      const category = cat(signal.categoryFlagged);
      const surgeTotal = fmt(signal.metricValue);
      const baseline = fmt(signal.targetValue);
      const delta = fmt(signal.gapAmount);
      if (signal.severity === 'critical') {
        return {
          signalType: signal.type,
          severity: signal.severity,
          headline: `${category} spending is up ${delta} vs normal`,
          why: worsened
            ? `${category} spending hit ${surgeTotal} last month — and it's gone up again since the last time we flagged it. This is becoming a pattern worth addressing.`
            : `Last month's ${category} spending was ${surgeTotal} — more than double your normal level of ${baseline}. A jump this size usually has a specific driver.`,
          currentState: `That's ${delta} above your average. This is the largest spending increase across all categories right now.`,
          action: `Open last month's ${category} transactions and find the single largest item driving the spike.`,
        };
      }
      return {
        signalType: signal.type,
        severity: signal.severity,
        headline: `${category} spending is running above normal`,
        why: worsened
          ? `${category} spending came in at ${surgeTotal} again — up from last time. Two months in a row breaks the pattern.`
          : `Last month's ${category} spending was ${surgeTotal}, about ${pct(signal.gapAmount && signal.targetValue ? signal.gapAmount / signal.targetValue : undefined)} above your normal average of ${baseline}.`,
        currentState: `The increase is ${delta} above your baseline. It's not alarming on its own, but it broke the pattern.`,
        action: `Check last month's ${category} transactions this week — is it a one-time charge or something recurring?`,
      };
    }

    case 'revenue_decline': {
      const trailing = fmt(signal.metricValue);
      const prior = fmt(signal.targetValue);
      const declineRate = (signal.metricValue !== undefined && signal.targetValue !== undefined && signal.targetValue > 0)
        ? pct((signal.targetValue - signal.metricValue) / signal.targetValue)
        : 'some';
      if (signal.severity === 'critical') {
        return {
          signalType: signal.type,
          severity: signal.severity,
          headline: `Revenue is down ${declineRate} vs the prior period`,
          why: worsened
            ? `Revenue has slipped further — your trailing average is now ${trailing}, down from ${prior} the prior period. This trend needs a direct response.`
            : `Your average monthly revenue over the last 3 months is ${trailing}, compared to ${prior} the 3 months before — a decline of more than 15%.`,
          currentState: `That's a real shift in your revenue base. Something in your income mix has changed.`,
          action: 'Find the single largest revenue source that declined — memberships, classes, or event revenue — and dig into why.',
        };
      }
      return {
        signalType: signal.type,
        severity: signal.severity,
        headline: `Revenue is down ${declineRate} — watch the trend`,
        why: worsened
          ? `Revenue softened further since last check — average is now ${trailing}, down ${declineRate} from ${prior}. Worth watching closely.`
          : `Average monthly revenue is down about ${declineRate} compared to the prior three months, from ${prior} to ${trailing}.`,
        currentState: `It's not a crisis, but the direction matters. Two more months of this and it becomes structural.`,
        action: 'Check your membership count and renewal rate this week — those are the first place a softening trend shows up.',
      };
    }

    case 'owner_distributions_high': {
      const annualized = fmt(signal.metricValue);
      const baseline = fmt(signal.targetValue);
      return {
        signalType: signal.type,
        severity: signal.severity,
        headline: `Distributions are running ahead of last year`,
        why: worsened
          ? `Your draw pace has increased since last check — you're now on track for ${annualized} annualized, compared to ${baseline} last year.`
          : `At your current pace, you're on track to take out ${annualized} this year — compared to ${baseline} last year. That's above the 120% benchmark.`,
        currentState: 'The business can sustain this if cash flow is strong, but it tightens the cushion for surprises.',
        action: 'Compare your current cash balance to your Operating Reserve — if it\'s below, level your draw rate until it recovers.',
      };
    }

    case 'steady_state':
    default: {
      return {
        signalType: signal.type,
        severity: signal.severity,
        headline: 'Business is running clean — no urgent signals',
        why: 'No urgent signals are firing across your reserve, cash flow, or expenses. The business looks stable.',
        currentState: 'Reserve is healthy, the forward cash picture looks solid, and nothing unusual has surfaced.',
        action: 'Stay consistent — and consider moving some surplus toward the reserve while conditions are good.',
      };
    }
  }
}

// ─── Watch metric ──────────────────────────────────────────────────────────────

// Same currency format as CashOnHandCard.tsx so the steady_state watch metric
// shows the same number under the same name as the Today Cash on Hand card.
const watchCashFormat = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

// Powers the "What should I watch?" chip on the CFO Assistant card. A structured
// {label, value} per signal type — NOT prose and NOT part of the AIProse contract.
// Kept as a sibling of getFallbackCopy so the AI proxy path (AIProse,
// SYSTEM_PROMPT, validateProseResponse) stays untouched. steady_state carries no
// metricValue, so it falls back to the passed-in current cash balance.
export function getWatchMetric(
  signal: Signal,
  model: DashboardModel,
): { label: string; value: string } {
  // Commitment-ready types route through the watch-metric registry (action-tied,
  // #4): the fresh/awareness watch is the baseline-to-be ("starting at $X").
  // Committed-state progress ("$Y of $X") lives in commitmentTemplate
  // (commitments/templater.ts), the single source of committed-state copy.
  const spec = watchMetricForSignal(signal.type);
  if (spec) {
    const current = spec.computeCurrent(model);
    return { label: spec.label, value: `starting at ${watchCashFormat.format(current)}` };
  }

  // Awareness-only types keep their current (portfolio) watch metric until each
  // becomes commitment-ready — then it gets a registry entry and leaves this
  // switch. Migrate per type, in priority order:
  //   reserve_critical, cash_flow_negative, cash_flow_tight, expense_surge,
  //   revenue_decline, owner_distributions_high.  (steady_state stays Cash on Hand.)
  switch (signal.type) {

    case 'reserve_critical':
      return { label: 'Reserve funded', value: pct(signal.metricValue) };

    case 'cash_flow_negative':
    case 'cash_flow_tight': {
      // Trough month folds into the value so the label stays stable across both
      // cash-flow types; dropped silently when the month is absent.
      const floor = fmt(signal.metricValue);
      return {
        label: 'Cash floor',
        value: signal.troughMonth ? `${floor} in ${formatTroughMonth(signal.troughMonth)}` : floor,
      };
    }

    case 'expense_surge':
      return { label: `${cat(signal.categoryFlagged)} spend`, value: fmt(signal.metricValue) };

    case 'revenue_decline':
      return { label: 'Revenue (3-mo avg)', value: fmt(signal.metricValue) };

    case 'owner_distributions_high':
      return { label: 'Draw pace', value: fmt(signal.metricValue) };

    case 'steady_state':
    default:
      return { label: 'Cash on Hand', value: watchCashFormat.format(model.runway.currentCashBalance) };
  }
}
