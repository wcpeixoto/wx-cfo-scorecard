import { describe, it, expect } from 'vitest';
import type { DashboardModel, Txn } from '../data/contract';
import { computeCore } from './efficiencyOpportunities';

// ── Test scaffold ────────────────────────────────────────────────────────────
// computeCore takes a referenceDate so the 24-month lookback is deterministic.
// referenceDate = 2026-02-15 → lastCompleteMonth = 2026-01; with
// latestMonth = 2025-12, windowAnchor = 2025-12. Lookback = Jan 2024 … Dec 2025
// (index 0 … 23). The current ("today") window is the last 3 months: Oct–Dec 2025.
const REF_DATE = new Date('2026-02-15T00:00:00Z');
const MODEL = { latestMonth: '2025-12' } as unknown as DashboardModel;

// Lookback months, index 0 (Jan 2024) … 23 (Dec 2025).
const MONTHS: string[] = Array.from({ length: 24 }, (_, i) => {
  const year = 2024 + Math.floor(i / 12);
  const m = (i % 12) + 1;
  return `${year}-${String(m).padStart(2, '0')}`;
});

let idSeq = 0;
function mk(month: string, type: 'income' | 'expense', category: string, amount: number): Txn {
  idSeq += 1;
  return {
    id: `t${idSeq}`,
    date: `${month}-15`,
    month,
    type,
    amount,
    rawAmount: type === 'income' ? amount : -amount,
    category,
  };
}

// A month contributes a "Business Income" income txn when revenue > 0, and a
// "Marketing" expense txn when spend > 0. (Marketing is the only expense
// category in these fixtures, so the result has at most one row.)
function buildTxns(revenue: number[], marketing: number[]): Txn[] {
  const txns: Txn[] = [];
  MONTHS.forEach((month, i) => {
    if (revenue[i] > 0) txns.push(mk(month, 'income', 'Business Income', revenue[i]));
    if (marketing[i] > 0) txns.push(mk(month, 'expense', 'Marketing', marketing[i]));
  });
  return txns;
}

function arr(value: number): number[] {
  return new Array(24).fill(value);
}
function set(base: number[], indices: number[], value: number): number[] {
  const a = base.slice();
  for (const i of indices) a[i] = value;
  return a;
}

function marketingRow(revenue: number[], marketing: number[]) {
  const res = computeCore(MODEL, buildTxns(revenue, marketing), REF_DATE);
  return { res, row: res.rows.find((r) => r.category === 'Marketing') };
}

// Payroll variant — Business Income + a Payroll expense per month. Drives the
// payroll-specific hero fields consumed by PayrollEfficiencyCard.
function buildPayrollTxns(revenue: number[], payroll: number[]): Txn[] {
  const txns: Txn[] = [];
  MONTHS.forEach((month, i) => {
    if (revenue[i] > 0) txns.push(mk(month, 'income', 'Business Income', revenue[i]));
    if (payroll[i] > 0) txns.push(mk(month, 'expense', 'Payroll', payroll[i]));
  });
  return txns;
}

describe('computeEfficiencyOpportunities — revenue-qualified "Your best" benchmark', () => {
  it('qualified happy path: flat revenue, every window qualifies, best is the spend dip', () => {
    // Revenue flat $30k → floor = 0.7 × $30k = $21k; every window (avg $30k)
    // qualifies. Marketing dips to $1.5k in Apr–Jun 2024 (idx 3–5) → a 5% ratio
    // versus the 10% baseline.
    const revenue = arr(30000);
    const marketing = set(arr(3000), [3, 4, 5], 1500);
    const { res, row } = marketingRow(revenue, marketing);

    expect(res.benchmarkRevenueQualified).toBe(true);
    expect(res.windowLabel).toBe('Oct – Dec 2025');
    expect(row).toBeDefined();
    expect(row!.bestPct).toBe(5);
    expect(row!.todayPct).toBe(10);
    expect(row!.bestWindow.label).toBe('Apr – Jun 2024');
    expect(Math.round(row!.extraPerMonth)).toBe(1500);
  });

  it('Floor 1 active: a low-revenue era with a tiny-spend 5% ratio is excluded', () => {
    // Apr–Jun 2024 (idx 3–5) revenue craters to $10k with $500 spend → a tempting
    // 5% ratio; everything else $30k. Floor = 0.7 × $30k = $21k, so the $10k
    // window falls below the floor. Best must come from a revenue-qualified
    // window — never the excluded 5%.
    const revenue = set(arr(30000), [3, 4, 5], 10000);
    const marketing = set(arr(3000), [3, 4, 5], 500);
    const { res, row } = marketingRow(revenue, marketing);

    expect(res.benchmarkRevenueQualified).toBe(true);
    expect(row).toBeDefined();
    expect(row!.bestPct).toBe(9); // > 5 ⟹ the low-revenue 5% window was excluded
    expect(row!.bestWindow.label).toBe('Feb – Apr 2024');
  });

  it('Floor 2 active: cratered current revenue; weak history excluded by the median floor', () => {
    // Current 6 months cratered to $8k (idx 18–23). A low-rev historical window
    // Apr–Jun 2024 (idx 3–5) at $12k with $600 spend looks like 5%. Floor 1 alone
    // (0.7 × $8k = $5.6k) would ADMIT the $12k window; Floor 2 (0.7 × median $30k
    // = $21k) excludes it. Best must come from a $30k-revenue window.
    const revenue = set(set(arr(30000), [3, 4, 5], 12000), [18, 19, 20, 21, 22, 23], 8000);
    const marketing = set(arr(3000), [3, 4, 5], 600);
    const { res, row } = marketingRow(revenue, marketing);

    expect(res.benchmarkRevenueQualified).toBe(true);
    expect(row).toBeDefined();
    expect(row!.bestPct).toBe(9); // > 5 ⟹ the $12k window was excluded by Floor 2
    expect(row!.bestWindow.label).toBe('Feb – Apr 2024');
  });

  it('fallback: <2 windows qualify → unfiltered best, benchmarkRevenueQualified=false', () => {
    // Revenue is $10k everywhere except a single $50k spike in the final month
    // (idx 23). current6mo avg ≈ $16.7k → floor ≈ $11.7k; only the one window
    // touching the spike clears it (1 < 2 required). Every category falls back to
    // the unfiltered best — here the $500/$10k = 5% dip in Apr–Jun 2024 — and the
    // flag is false. (True "zero qualifying" is unreachable: the current window
    // anchors the floor and tends to qualify, so the reachable edge is <2.)
    const revenue = set(arr(10000), [23], 50000);
    const marketing = set(arr(3000), [3, 4, 5], 500);
    const { res, row } = marketingRow(revenue, marketing);

    expect(res.benchmarkRevenueQualified).toBe(false);
    expect(row).toBeDefined();
    expect(row!.bestPct).toBe(5); // unfiltered best returned (the 5% dip)
    expect(row!.bestWindow.label).toBe('Apr – Jun 2024');
  });

  it('current6mo = 0 (all recent revenue zero): floor falls to the median, result is well-defined', () => {
    // Last 6 months have zero revenue → current6moAvgRevenue = 0, so the floor is
    // carried entirely by Floor 2 (0.7 × median) with no NaN/Infinity. With no
    // revenue in the current window there is no valid "today" window, so the
    // function returns a clean empty result rather than throwing.
    const revenue = set(arr(30000), [18, 19, 20, 21, 22, 23], 0);
    const marketing = arr(3000);

    let res!: ReturnType<typeof computeCore>;
    expect(() => {
      res = computeCore(MODEL, buildTxns(revenue, marketing), REF_DATE);
    }).not.toThrow();
    expect(res.rows).toHaveLength(0);
    expect(res.windowLabel).toBe('');
    expect(res.benchmarkRevenueQualified).toBe(false);
  });
});

describe('computeEfficiencyOpportunities — payroll hero basis (Payroll Efficiency card)', () => {
  it('hero/best fields equal the Payroll row and footer when there is positive excess', () => {
    // Revenue flat $30k. Payroll $9k (30%) except a dip to $6k (20%) in Apr–Jun
    // 2024. Today window (Oct–Dec 2025) = 30%; best stretch = 20%.
    const revenue = arr(30000);
    const payroll = set(arr(9000), [3, 4, 5], 6000);
    const res = computeCore(MODEL, buildPayrollTxns(revenue, payroll), REF_DATE);
    const row = res.rows.find((r) => r.category === 'Payroll');

    expect(row).toBeDefined();
    // todayPct drives the hero; bestPct + window drive the "Best stretch" label.
    expect(res.payrollTodayPct).toBe(30);
    expect(res.payrollBestPct).toBe(20);
    expect(res.payrollTodayPct).toBe(row!.todayPct);
    expect(res.payrollBestPct).toBe(row!.bestPct);
    expect(res.payrollBestWindowLabel).toBe('Apr – Jun 2024');
    expect(res.payrollBestWindowLabel).toBe(row!.bestWindow.label);
    // extraPerMonth still drives the footer figure.
    expect(res.payrollExtraPerMonth).toBe(row!.extraPerMonth);
    expect(res.payrollExtraPerMonth).toBeGreaterThan(0);
  });

  it('still exposes today/best % when payroll is AT its best stretch (no row, null excess)', () => {
    // Flat payroll → today ratio == best ratio → extraPerMonth 0 → the Payroll row
    // is skipped and payrollExtraPerMonth is null. The hero must STILL render, so
    // payrollTodayPct / payrollBestPct stay populated (the regression guard).
    const revenue = arr(30000);
    const payroll = arr(9000); // flat 30% everywhere
    const res = computeCore(MODEL, buildPayrollTxns(revenue, payroll), REF_DATE);

    expect(res.rows.find((r) => r.category === 'Payroll')).toBeUndefined();
    expect(res.payrollExtraPerMonth).toBeNull();
    expect(res.payrollTodayPct).toBe(30);
    expect(res.payrollBestPct).toBe(30);
    expect(res.payrollBestWindowLabel).not.toBeNull();
  });

  it('payroll fields are null when there is no Payroll spend', () => {
    // Marketing-only fixture — no Payroll category present.
    const res = computeCore(MODEL, buildTxns(arr(30000), arr(3000)), REF_DATE);
    expect(res.payrollTodayPct).toBeNull();
    expect(res.payrollBestPct).toBeNull();
    expect(res.payrollBestWindowLabel).toBeNull();
  });

  it('hero best-stretch respects the firstActiveMonth gate (stays aligned with the gated Payroll row)', () => {
    // Payroll tracking starts at idx 17 (Jun 2025) with 7 consecutive present
    // months ⇒ sustained-tracking rule (#362) sets firstActive=17. Ungated, the
    // pre-tracking $0 windows would win as a bogus 0% best; with the gate the
    // best is the genuine Jun–Aug 2025 dip, and the hero fields equal the gated
    // Money Left Payroll row.
    const revenue = arr(30000);
    const payroll = set(set(arr(0), [17, 18, 19], 6000), [20, 21, 22, 23], 9000);
    const res = computeCore(MODEL, buildPayrollTxns(revenue, payroll), REF_DATE);
    const row = res.rows.find((r) => r.category === 'Payroll');

    expect(row).toBeDefined();
    // Gate excludes the pre-tracking $0 windows → best is the real dip, not 0%.
    expect(res.payrollBestPct).toBe(20);
    expect(res.payrollBestWindowLabel).toBe('Jun – Aug 2025');
    expect(res.payrollTodayPct).toBe(30);
    // The alignment invariant: hero fields equal the gated Money Left Payroll row.
    expect(res.payrollTodayPct).toBe(row!.todayPct);
    expect(res.payrollBestPct).toBe(row!.bestPct);
    expect(res.payrollBestWindowLabel).toBe(row!.bestWindow.label);
  });
});

describe('computeEfficiencyOpportunities — payrollRollingSeries (chart + footer)', () => {
  // The Payroll Efficiency card's chart and footer must read from the same
  // 3-month rolling logic as the hero, so the whole card sits on one basis.

  it('current point pct equals payrollTodayPct and isCurrent=true', () => {
    // Same fixture as the happy-path hero test: payroll 30% today, 20% best.
    const revenue = arr(30000);
    const payroll = set(arr(9000), [3, 4, 5], 6000);
    const res = computeCore(MODEL, buildPayrollTxns(revenue, payroll), REF_DATE);

    const last = res.payrollRollingSeries[res.payrollRollingSeries.length - 1];
    expect(last).toBeDefined();
    expect(last.isCurrent).toBe(true);
    expect(last.payrollPct).toBe(res.payrollTodayPct);

    // Exactly one isCurrent in the series.
    expect(res.payrollRollingSeries.filter((p) => p.isCurrent)).toHaveLength(1);
  });

  it('best point pct/label equal payrollBestPct / payrollBestWindowLabel', () => {
    const revenue = arr(30000);
    const payroll = set(arr(9000), [3, 4, 5], 6000);
    const res = computeCore(MODEL, buildPayrollTxns(revenue, payroll), REF_DATE);

    const best = res.payrollRollingSeries.find((p) => p.isBest);
    expect(best).toBeDefined();
    expect(best!.payrollPct).toBe(res.payrollBestPct);
    expect(best!.label).toBe(res.payrollBestWindowLabel);

    // Exactly one isBest.
    expect(res.payrollRollingSeries.filter((p) => p.isBest)).toHaveLength(1);
  });

  it('series carries footer values that reconcile with the hero (rev/$payroll)', () => {
    // Hero 30% should imply $3.33 revenue per $1 payroll (1/0.30) at the
    // current point. Best 20% → $5.00 at the best point.
    const revenue = arr(30000);
    const payroll = set(arr(9000), [3, 4, 5], 6000);
    const res = computeCore(MODEL, buildPayrollTxns(revenue, payroll), REF_DATE);

    const current = res.payrollRollingSeries.find((p) => p.isCurrent)!;
    const best = res.payrollRollingSeries.find((p) => p.isBest)!;

    // revenuePerPayrollDollar matches the raw ratio of the carried sums.
    expect(current.revenuePerPayrollDollar).toBeCloseTo(current.revenue / current.payroll, 6);
    expect(best.revenuePerPayrollDollar).toBeCloseTo(best.revenue / best.payroll, 6);

    // And reconciles with the hero pct (1 / pct) to two decimals.
    expect(current.revenuePerPayrollDollar).toBeCloseTo(1 / (res.payrollTodayPct! / 100), 2);
    expect(best.revenuePerPayrollDollar).toBeCloseTo(1 / (res.payrollBestPct! / 100), 2);
  });

  it('full-history flat revenue: 22 windows, every point benchmark-eligible', () => {
    // 24-month lookback with revenue > 0 every month ⇒ up to 22 valid
    // 3-month windows. Payroll present every month ⇒ firstActiveMonth = 0,
    // every window passes the revenue-qualification floor (flat revenue),
    // so every point is benchmark-eligible.
    const revenue = arr(30000);
    const payroll = arr(9000);
    const res = computeCore(MODEL, buildPayrollTxns(revenue, payroll), REF_DATE);

    expect(res.payrollRollingSeries).toHaveLength(22);
    expect(res.payrollRollingSeries.every((p) => p.isBenchmarkEligible)).toBe(true);
  });

  it('pre-sustained windows are marked ineligible; best never lands on one', () => {
    // Payroll tracking starts at idx 17 (Jun 2025) with 7 consecutive months
    // ⇒ firstActive = 17. Windows starting before idx 17 must be ineligible;
    // the best marker must land on an eligible window.
    const revenue = arr(30000);
    const payroll = set(set(arr(0), [17, 18, 19], 6000), [20, 21, 22, 23], 9000);
    const res = computeCore(MODEL, buildPayrollTxns(revenue, payroll), REF_DATE);

    // Pre-sustained windows: startIdx < 17. All ineligible.
    const preSustained = res.payrollRollingSeries.filter((p) => !p.isBenchmarkEligible);
    expect(preSustained.length).toBeGreaterThan(0);

    // Best is exactly one point AND it's eligible.
    const best = res.payrollRollingSeries.find((p) => p.isBest);
    expect(best).toBeDefined();
    expect(best!.isBenchmarkEligible).toBe(true);
    expect(best!.label).toBe('Jun – Aug 2025');
  });

  it('no payroll spend: series is empty', () => {
    const res = computeCore(MODEL, buildTxns(arr(30000), arr(3000)), REF_DATE);
    expect(res.payrollRollingSeries).toEqual([]);
  });

  it('no sustained run: current point still present, no isBest point', () => {
    // Payroll appears only as scattered single months — no 3-consecutive-month
    // sustained run ⇒ firstActiveMonth has no Payroll entry ⇒ best fields
    // stay null. The series still includes the current window so the chart
    // can render today; no point carries isBest.
    const revenue = arr(30000);
    const payroll = arr(0);
    payroll[3] = 6000; payroll[10] = 6000; payroll[22] = 6000; // scattered, no K=3 run
    const res = computeCore(MODEL, buildPayrollTxns(revenue, payroll), REF_DATE);

    expect(res.payrollBestPct).toBeNull();
    expect(res.payrollBestWindowLabel).toBeNull();
    expect(res.payrollTodayPct).not.toBeNull();

    const current = res.payrollRollingSeries.find((p) => p.isCurrent);
    expect(current).toBeDefined();
    expect(current!.payrollPct).toBe(res.payrollTodayPct);

    // No best marker exists.
    expect(res.payrollRollingSeries.some((p) => p.isBest)).toBe(false);
    // And every point is ineligible (no firstActive entry for Payroll).
    expect(res.payrollRollingSeries.every((p) => !p.isBenchmarkEligible)).toBe(true);
  });
});

describe('computeEfficiencyOpportunities — sustained-tracking gate', () => {
  // A category is benchmark-ready only after its first run of
  // SUSTAINED_TRACKING_MIN_MONTHS = 3 consecutive months with at least one
  // recorded transaction. Customer Refunds motivates this: real data has
  // stray 2022–early-2025 txns before sustained mid-2025 tracking, so a
  // first-appearance rule (PR #360) wasn't enough — zero-padded pre-sustained
  // windows still won as 0% bests.
  function buildTxnsWithRefunds(revenue: number[], refunds: number[]): Txn[] {
    const txns: Txn[] = [];
    MONTHS.forEach((month, i) => {
      if (revenue[i] > 0) txns.push(mk(month, 'income', 'Business Income', revenue[i]));
      if (refunds[i] > 0) txns.push(mk(month, 'expense', 'Customer Refunds', refunds[i]));
    });
    return txns;
  }

  function refundsRow(revenue: number[], refunds: number[]) {
    const res = computeCore(MODEL, buildTxnsWithRefunds(revenue, refunds), REF_DATE);
    return { res, row: res.rows.find((r) => r.category === 'Customer Refunds') };
  }

  it('late-arriving category: best is the start of the sustained run, not a pre-tracking zero window', () => {
    // Refunds present idx 17–23 (7 consecutive months ⇒ firstActiveMonth = 17,
    // Jun 2025). Pre-sustained windows are zero-padded and would win as 0%
    // "best" without the gate; the rule blocks them.
    const revenue = arr(30000);
    const refunds = set(
      set(set(arr(0), [17, 18, 19], 200), [20, 21, 22], 500),
      [23], 1000,
    );
    const { row } = refundsRow(revenue, refunds);

    expect(row).toBeDefined();
    expect(row!.bestWindow.label).toBe('Jun – Aug 2025');
    expect(row!.bestPct).toBe(1);  // 0.67% rounded
    expect(row!.todayPct).toBe(2); // 2.22% rounded
  });

  it('ghost-history: stray pre-sustained txns do NOT unlock pre-sustained zero windows', () => {
    // Mimics real Customer Refunds data: stray txns scattered across 2024
    // (idx 2, 6, 9) before sustained tracking begins idx 16 (May 2025). A
    // first-appearance rule (PR #360) would set firstActive = 2 and let
    // zero-padded windows between strays win as 0% bests — exactly the bug
    // observed in production. K=3 sets firstActive = 16 instead, so the best
    // window comes from the genuine sustained period.
    const revenue = arr(30000);
    const refunds = arr(0);
    refunds[2] = 800; refunds[6] = 500; refunds[9] = 600;   // strays
    for (let i = 16; i <= 20; i += 1) refunds[i] = 200;     // sustained low
    for (let i = 21; i <= 23; i += 1) refunds[i] = 1000;    // current
    const { row } = refundsRow(revenue, refunds);

    expect(row).toBeDefined();
    expect(row!.bestWindow.label).toBe('May – Jul 2025'); // NOT a 2024 window
    expect(row!.bestPct).toBe(1);  // 0.67% rounded
    expect(row!.todayPct).toBe(3); // 3.33% rounded
  });

  it('low-spend window inside the sustained period is still eligible (regression guard)', () => {
    // Refunds present idx 11–23 (13 consecutive ⇒ firstActive = 11). The
    // sustained period contains a 3-month dip to trivially-low spend at
    // idx 15–17 (Apr–Jun 2025). The gate must NOT block this — a low-spend
    // window inside an active period is real efficiency signal, not padding.
    const revenue = arr(30000);
    const refunds = set(
      set(arr(0), [11, 12, 13, 14, 18, 19, 20, 21, 22, 23], 500),
      [15, 16, 17], 1,
    );
    const { row } = refundsRow(revenue, refunds);

    expect(row).toBeDefined();
    expect(row!.bestWindow.label).toBe('Apr – Jun 2025');
    expect(row!.bestPct).toBe(0); // ~0.003% rounded
    expect(row!.todayPct).toBe(2); // 1.67% rounded
  });

  it('amount=0 transactions count as presence (sign-flip / same-month-offset safety)', () => {
    // Sign-flipped refund pairs or same-month offsets can leave a category
    // with $0 net spend in a month even though transactions exist. Presence
    // must be by txn existence, not summed-spend nonzero — otherwise the
    // first sustained run could be skipped past a real start of tracking
    // because of an arithmetic quirk. Three consecutive amount=0 txns at
    // idx 11–13 must mark presence and satisfy the K=3 rule.
    const txns: Txn[] = [];
    MONTHS.forEach((month, i) => {
      txns.push(mk(month, 'income', 'Business Income', 30000));
      if (i >= 11 && i <= 13) txns.push(mk(month, 'expense', 'Customer Refunds', 0));
    });
    txns.push(mk(MONTHS[21], 'expense', 'Customer Refunds', 500));
    txns.push(mk(MONTHS[22], 'expense', 'Customer Refunds', 500));
    txns.push(mk(MONTHS[23], 'expense', 'Customer Refunds', 500));
    const res = computeCore(MODEL, txns, REF_DATE);
    const row = res.rows.find((r) => r.category === 'Customer Refunds');

    // K=3 satisfied at idx 11 thanks to the amount=0 txns. The row exists
    // (sustained run found) with bestPct = 0 (the all-$0 windows in the
    // pre-current sustained stretch are legitimately eligible).
    expect(row).toBeDefined();
    expect(row!.bestPct).toBe(0);
  });

  it('category without any 3-consecutive-month run gets no row (no fair benchmark exists)', () => {
    // Sparse presence with no K-consecutive run anywhere in the lookback.
    // Current-window spend passes materiality, but there is no credible
    // benchmark — the row drops. Better than fabricating a 0% best from a
    // zero-padded window.
    const revenue = arr(30000);
    const refunds = arr(0);
    refunds[10] = 500; refunds[11] = 500;                  // 2-consecutive stray
    refunds[14] = 200; refunds[15] = 200;                  // 2-consecutive stray
    refunds[20] = 200; refunds[22] = 200; refunds[23] = 200; // alternating around current
    const { row } = refundsRow(revenue, refunds);

    expect(row).toBeUndefined();
  });

  it('full-history category is unaffected: K=3 satisfied at idx 0 ⇒ all windows eligible', () => {
    // Marketing-style category present every month. firstActive = 0, the gate
    // is a no-op, and the existing best-window selection runs unchanged.
    const revenue = arr(30000);
    const refunds = set(arr(3000), [3, 4, 5], 1500);
    const { row } = refundsRow(revenue, refunds);

    expect(row).toBeDefined();
    expect(row!.bestWindow.label).toBe('Apr – Jun 2024');
    expect(row!.bestPct).toBe(5);
    expect(row!.todayPct).toBe(10);
  });
});
