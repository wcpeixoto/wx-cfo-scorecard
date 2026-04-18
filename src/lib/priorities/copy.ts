import type { Signal, PriorityHistoryRow } from './types';

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
): {
  headline: string;
  why: string;
  currentState: string;
  action: string;
  alternative: string;
  followupNote: string;
} {
  const worsened = metricWorsened(signal, priorHistory);

  switch (signal.type) {

    case 'reserve_critical': {
      const fundedPct = pct(signal.metricValue);
      const gap = fmt(signal.gapAmount);
      return {
        headline: 'Your cash reserve is critically low',
        why: worsened
          ? `Your reserve has dropped further — now at ${fundedPct} of where it needs to be. Right now there\'s not much between you and a real squeeze if something unexpected hits.`
          : `Your reserve is at ${fundedPct} — below the level that keeps you safe when something unexpected hits. Right now, there\'s not much buffer between you and a real squeeze.`,
        currentState: `You need ${gap} more to get above the halfway mark. Every dollar you add here buys real breathing room.`,
        action: 'Push for revenue this week — early renewals, a short promotion, or outstanding payments can move this fast.',
        alternative: 'If revenue can\'t move quickly, identify one expense you can delay by 30 days.',
        followupNote: 'Getting above 50% funded is the first milestone — let\'s close that gap.',
      };
    }

    case 'reserve_warning': {
      const fundedPct = pct(signal.metricValue);
      const gap = fmt(signal.gapAmount);
      return {
        headline: 'Reserve is funded but below your target',
        why: worsened
          ? `Your reserve slipped to ${fundedPct} — the direction reversed since last time. Small surprises are manageable, but bigger ones would squeeze you.`
          : `You\'re at ${fundedPct} of your operating target. You have a cushion, but not the full buffer you\'d want if something unexpected hit.`,
        currentState: `You need ${gap} more to be fully funded. You\'re in the right zone — just not all the way there yet.`,
        action: 'Keep building gradually — directing even a portion of this month\'s surplus toward the reserve makes a difference.',
        alternative: 'Make sure no new discretionary spending cuts into what you\'ve already built.',
        followupNote: 'You\'re heading in the right direction — keep the momentum.',
      };
    }

    case 'cash_flow_negative': {
      const lowest = fmt(signal.metricValue);
      const gap = fmt(signal.gapAmount);
      return {
        headline: 'Cash is projected to go negative',
        why: worsened
          ? `The forward outlook has gotten worse since last time — your projected low point is now ${lowest}. This needs attention before it becomes a real constraint.`
          : `Based on your current pace, your balance is projected to go negative. That\'s not just a warning — it means bills don\'t get paid on time.`,
        currentState: `Your lowest projected balance is ${lowest}. You need ${gap} more to stay above zero through the forecast window.`,
        action: 'Look at the next 60 days — are there invoices you can send early, or payments you can push out without penalty?',
        alternative: 'Pulling forward any annual renewals or a short promotion could bridge the gap.',
        followupNote: 'This is the most time-sensitive signal on the dashboard right now.',
      };
    }

    case 'cash_flow_tight': {
      const lowest = fmt(signal.metricValue);
      const gap = fmt(signal.gapAmount);
      return {
        headline: 'Cash may dip below your safety target',
        why: worsened
          ? `The forward picture has tightened since last check — your lowest projected balance is ${lowest}. You won\'t run dry, but the cushion is thinner.`
          : `Your projected cash stays positive, but could fall ${gap} below your reserve target. You\'re not in danger, but you\'d be cutting it close.`,
        currentState: `The lowest your balance gets in the forecast is ${lowest} — just below the safety line you\'ve set.`,
        action: 'Look for ways to bring in a little more or push out a non-urgent expense over the next two months.',
        alternative: 'Even smoothing out when bills are paid can help — timing matters as much as amount.',
        followupNote: 'You\'re in control here — a small adjustment now keeps you comfortable.',
      };
    }

    case 'expense_surge': {
      const category = cat(signal.categoryFlagged);
      const surgeTotal = fmt(signal.metricValue);
      const baseline = fmt(signal.targetValue);
      const delta = fmt(signal.gapAmount);
      if (signal.severity === 'critical') {
        return {
          headline: `${category} spending spiked last month`,
          why: worsened
            ? `${category} spending hit ${surgeTotal} last month — and it\'s gone up again since the last time we flagged it. This is becoming a pattern worth addressing.`
            : `Last month\'s ${category} spending was ${surgeTotal} — more than double your normal level of ${baseline}. A jump this size usually has a specific driver.`,
          currentState: `That\'s ${delta} above your average. This is the largest spending increase across all categories right now.`,
          action: `Pull the ${category} transactions from last month and find the main driver.`,
          alternative: 'If the increase was intentional — a one-time purchase or seasonal event — note it and move on.',
          followupNote: 'If this continues at the same level next month, it becomes a structural expense increase.',
        };
      }
      return {
        headline: `${category} spending is higher than usual`,
        why: worsened
          ? `${category} spending came in at ${surgeTotal} again — up from last time. Two months in a row breaks the pattern.`
          : `Last month\'s ${category} spending was ${surgeTotal}, about ${pct(signal.gapAmount && signal.targetValue ? signal.gapAmount / signal.targetValue : undefined)} above your normal average of ${baseline}.`,
        currentState: `The increase is ${delta} above your baseline. It\'s not alarming on its own, but it broke the pattern.`,
        action: `Take a quick look at what drove the ${category} increase — one transaction or a new recurring charge?`,
        alternative: 'If it\'s a recurring change, update your expense expectations for coming months.',
        followupNote: 'One more month at this level and it starts to look structural.',
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
          headline: 'Revenue has dropped significantly',
          why: worsened
            ? `Revenue has slipped further — your trailing average is now ${trailing}, down from ${prior} the prior period. This trend needs a direct response.`
            : `Your average monthly revenue over the last 3 months is ${trailing}, compared to ${prior} the 3 months before — a decline of more than 15%.`,
          currentState: `That\'s a real shift in your revenue base. Something in your income mix has changed.`,
          action: 'Identify which income streams declined most — memberships, classes, or event revenue — and focus there first.',
          alternative: 'If this is seasonal, compare to the same period last year before making changes.',
          followupNote: 'Revenue trends of this size usually have a clear root cause — finding it is the first step.',
        };
      }
      return {
        headline: 'Revenue is softening — watch the trend',
        why: worsened
          ? `Revenue softened further since last check — average is now ${trailing}, down ${declineRate} from ${prior}. Worth watching closely.`
          : `Average monthly revenue is down about ${declineRate} compared to the prior three months, from ${prior} to ${trailing}.`,
        currentState: `It\'s not a crisis, but the direction matters. Two more months of this and it becomes structural.`,
        action: 'Check your membership count and renewal rate — those are usually the first signals.',
        alternative: 'A quick look at any pricing or promotional changes in the past 60 days might explain it.',
        followupNote: 'If this continues for another month or two, it\'ll need a more direct response.',
      };
    }

    case 'owner_distributions_high': {
      const annualized = fmt(signal.metricValue);
      const baseline = fmt(signal.targetValue);
      return {
        headline: 'Your owner draws are running ahead of last year',
        why: worsened
          ? `Your draw pace has increased since last check — you\'re now on track for ${annualized} annualized, compared to ${baseline} last year.`
          : `At your current pace, you\'re on track to take out ${annualized} this year — compared to ${baseline} last year. That\'s above the 120% benchmark.`,
        currentState: 'The business can sustain this if cash flow is strong, but it tightens the cushion for surprises.',
        action: 'If your reserve is already lean, consider leveling your draw rate until the reserve builds back up.',
        alternative: 'If the increase is planned — personal investment or a one-time need — just make sure it\'s reflected in your forward cash view.',
        followupNote: 'This isn\'t a red flag on its own — it\'s a calibration check to keep the business healthy as you grow.',
      };
    }

    case 'steady_state':
    default: {
      return {
        headline: 'You\'re in a good spot right now',
        why: 'No urgent signals are firing across your reserve, cash flow, or expenses. The business looks stable.',
        currentState: 'Reserve is healthy, the forward cash picture looks solid, and nothing unusual has surfaced.',
        action: 'Keep doing what\'s working — consistency compounds.',
        alternative: 'Use this window to review your next quarter\'s plan or push for a strategic revenue goal.',
        followupNote: 'We\'ll keep watching and surface anything that needs attention.',
      };
    }
  }
}
