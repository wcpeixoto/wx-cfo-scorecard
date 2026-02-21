import type {
  DashboardModel,
  ExpenseSlice,
  KpiCard,
  MonthlyRollup,
  Mover,
  OpportunityItem,
  PayeeTotal,
  ScenarioInput,
  ScenarioPoint,
  TrendDirection,
  TrendPoint,
  Txn,
} from '../data/contract';

const EPSILON = 0.00001;
const EXPENSE_COLORS = ['#76a8ff', '#5e84f1', '#4f6fdd', '#3f58c1', '#2f479f', '#243b82', '#1b2f67'];

function trendFromDelta(delta: number): TrendDirection {
  if (Math.abs(delta) <= EPSILON) return 'flat';
  return delta > 0 ? 'up' : 'down';
}

function pctDelta(current: number, previous: number): number | null {
  if (Math.abs(previous) <= EPSILON) {
    return null;
  }
  return ((current - previous) / Math.abs(previous)) * 100;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function sortMonths(a: string, b: string): number {
  return a.localeCompare(b);
}

function monthLabel(month: string): string {
  const [yearText, monthText] = month.split('-');
  const year = Number.parseInt(yearText, 10);
  const monthIndex = Number.parseInt(monthText, 10) - 1;
  const date = new Date(Date.UTC(year, monthIndex, 1));
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function addMonths(month: string, offset: number): string {
  const [yearText, monthText] = month.split('-');
  const year = Number.parseInt(yearText, 10);
  const monthIndex = Number.parseInt(monthText, 10) - 1;

  const date = new Date(Date.UTC(year, monthIndex + offset, 1));
  const nextYear = date.getUTCFullYear();
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${nextYear}-${nextMonth}`;
}

export function computeMonthlyRollups(txns: Txn[]): MonthlyRollup[] {
  const monthMap = new Map<string, MonthlyRollup>();

  txns.forEach((txn) => {
    if (!monthMap.has(txn.month)) {
      monthMap.set(txn.month, {
        month: txn.month,
        income: 0,
        expense: 0,
        net: 0,
        transactionCount: 0,
      });
    }

    const rollup = monthMap.get(txn.month);
    if (!rollup) return;

    if (txn.type === 'income') {
      rollup.income += txn.amount;
    } else {
      rollup.expense += txn.amount;
    }

    rollup.net = rollup.income - rollup.expense;
    rollup.transactionCount += 1;
  });

  return [...monthMap.values()]
    .sort((a, b) => sortMonths(a.month, b.month))
    .map((rollup) => ({
      ...rollup,
      income: round2(rollup.income),
      expense: round2(rollup.expense),
      net: round2(rollup.net),
    }));
}

function buildKpis(latest: MonthlyRollup, previous: MonthlyRollup | null): KpiCard[] {
  const prevIncome = previous?.income ?? 0;
  const prevExpense = previous?.expense ?? 0;
  const prevNet = previous?.net ?? 0;

  const currentSavingsRate = latest.income > EPSILON ? (latest.net / latest.income) * 100 : 0;
  const prevSavingsRate = previous && previous.income > EPSILON ? (previous.net / previous.income) * 100 : 0;

  const cards: KpiCard[] = [
    {
      id: 'income',
      label: 'Revenue',
      value: round2(latest.income),
      previousValue: round2(prevIncome),
      deltaPercent: pctDelta(latest.income, prevIncome),
      trend: trendFromDelta(latest.income - prevIncome),
      format: 'currency',
    },
    {
      id: 'expense',
      label: 'Expenses',
      value: round2(latest.expense),
      previousValue: round2(prevExpense),
      deltaPercent: pctDelta(latest.expense, prevExpense),
      trend: trendFromDelta(latest.expense - prevExpense),
      format: 'currency',
    },
    {
      id: 'net',
      label: 'Net Cash Flow',
      value: round2(latest.net),
      previousValue: round2(prevNet),
      deltaPercent: pctDelta(latest.net, prevNet),
      trend: trendFromDelta(latest.net - prevNet),
      format: 'currency',
    },
    {
      id: 'savingsRate',
      label: 'Savings Rate',
      value: round2(currentSavingsRate),
      previousValue: round2(prevSavingsRate),
      deltaPercent: pctDelta(currentSavingsRate, prevSavingsRate),
      trend: trendFromDelta(currentSavingsRate - prevSavingsRate),
      format: 'percent',
    },
  ];

  return cards;
}

function categoryTotals(txns: Txn[]): Map<string, number> {
  const totals = new Map<string, number>();
  txns.forEach((txn) => {
    if (txn.type !== 'expense') return;
    const current = totals.get(txn.category) ?? 0;
    totals.set(txn.category, current + txn.amount);
  });
  return totals;
}

function buildExpenseSlices(latestMonthTxns: Txn[]): ExpenseSlice[] {
  const totals = categoryTotals(latestMonthTxns);
  const entries = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, 7);
  const totalExpense = top.reduce((sum, entry) => sum + entry[1], 0);

  return top.map(([name, value], index) => ({
    name,
    value: round2(value),
    share: totalExpense > EPSILON ? value / totalExpense : 0,
    color: EXPENSE_COLORS[index % EXPENSE_COLORS.length],
  }));
}

function buildTopPayees(latestMonthTxns: Txn[]): PayeeTotal[] {
  const map = new Map<string, PayeeTotal>();

  latestMonthTxns.forEach((txn) => {
    if (txn.type !== 'expense') return;
    const payee = txn.payee?.trim() || 'Unknown';

    if (!map.has(payee)) {
      map.set(payee, { payee, amount: 0, transactionCount: 0 });
    }

    const current = map.get(payee);
    if (!current) return;

    current.amount += txn.amount;
    current.transactionCount += 1;
  });

  return [...map.values()]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8)
    .map((item) => ({ ...item, amount: round2(item.amount) }));
}

function buildMovers(currentMonthTxns: Txn[], previousMonthTxns: Txn[]): Mover[] {
  const currentTotals = categoryTotals(currentMonthTxns);
  const previousTotals = categoryTotals(previousMonthTxns);

  const categories = new Set<string>([...currentTotals.keys(), ...previousTotals.keys()]);
  const movers: Mover[] = [];

  categories.forEach((category) => {
    const current = round2(currentTotals.get(category) ?? 0);
    const previous = round2(previousTotals.get(category) ?? 0);
    const delta = round2(current - previous);

    movers.push({
      category,
      current,
      previous,
      delta,
      deltaPercent: pctDelta(current, previous),
    });
  });

  return movers
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 8);
}

function baselineForCategory(monthlyRollups: MonthlyRollup[], txns: Txn[], category: string, excludeMonth: string): number {
  const months = monthlyRollups.map((rollup) => rollup.month).filter((month) => month < excludeMonth);
  const recentMonths = months.slice(-3);
  if (recentMonths.length === 0) return 0;

  const monthSet = new Set(recentMonths);
  let total = 0;

  txns.forEach((txn) => {
    if (txn.type !== 'expense') return;
    if (txn.category !== category) return;
    if (!monthSet.has(txn.month)) return;
    total += txn.amount;
  });

  return total / recentMonths.length;
}

function buildOpportunities(latestMonthTxns: Txn[], monthlyRollups: MonthlyRollup[], allTxns: Txn[]): OpportunityItem[] {
  const latestMonth = latestMonthTxns[0]?.month;
  if (!latestMonth) return [];

  const totals = categoryTotals(latestMonthTxns);
  const candidates: OpportunityItem[] = [];

  totals.forEach((currentTotal, category) => {
    const baseline = baselineForCategory(monthlyRollups, allTxns, category, latestMonth);
    const overrun = currentTotal - baseline;

    if (overrun > 50) {
      candidates.push({
        title: `Control ${category}`,
        savings: round2(overrun),
        hint: `Current month is ${round2(overrun)} above recent baseline.`,
      });
    }
  });

  if (candidates.length === 0) {
    const fallbackSavings = round2((latestMonthTxns
      .filter((txn) => txn.type === 'expense')
      .reduce((sum, txn) => sum + txn.amount, 0) * 0.03) || 0);

    return [
      {
        title: 'Tighten discretionary spend',
        savings: fallbackSavings,
        hint: 'A 3% trim in discretionary categories is a reasonable first target.',
      },
    ];
  }

  return candidates.sort((a, b) => b.savings - a.savings).slice(0, 8);
}

function buildSummary(latest: MonthlyRollup, previous: MonthlyRollup | null, opportunities: OpportunityItem[], txCount: number): string[] {
  const bullets: string[] = [];
  const netDirection = previous ? latest.net - previous.net : latest.net;

  bullets.push(
    `Processed ${txCount.toLocaleString()} transactions through ${monthLabel(latest.month)} with net ${latest.net >= 0 ? 'positive' : 'negative'} cash flow.`
  );

  if (previous) {
    bullets.push(
      `Revenue moved ${latest.income >= previous.income ? 'up' : 'down'} ${Math.abs(round2(latest.income - previous.income)).toLocaleString(undefined, {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      })} versus ${monthLabel(previous.month)}.`
    );
  }

  bullets.push(
    `Net cash trend is ${netDirection >= 0 ? 'improving' : 'softening'} and top action could recover ${opportunities
      .slice(0, 1)
      .reduce((sum, item) => sum + item.savings, 0)
      .toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}.`
  );

  return bullets;
}

export function computeDashboardModel(txns: Txn[]): DashboardModel {
  const monthlyRollups = computeMonthlyRollups(txns);

  if (monthlyRollups.length === 0) {
    return {
      latestMonth: '',
      previousMonth: null,
      monthlyRollups: [],
      kpiCards: [],
      trend: [],
      expenseSlices: [],
      topPayees: [],
      movers: [],
      opportunityTotal: 0,
      opportunities: [],
      summaryBullets: [],
      digHerePreview: [],
    };
  }

  const latest = monthlyRollups[monthlyRollups.length - 1];
  const previous = monthlyRollups.length > 1 ? monthlyRollups[monthlyRollups.length - 2] : null;

  const latestMonthTxns = txns.filter((txn) => txn.month === latest.month);
  const previousMonthTxns = previous ? txns.filter((txn) => txn.month === previous.month) : [];

  const opportunities = buildOpportunities(latestMonthTxns, monthlyRollups, txns);
  const opportunityTotal = round2(opportunities.reduce((sum, item) => sum + item.savings, 0));

  return {
    latestMonth: latest.month,
    previousMonth: previous?.month ?? null,
    monthlyRollups,
    kpiCards: buildKpis(latest, previous),
    trend: monthlyRollups.map<TrendPoint>((rollup) => ({
      month: rollup.month,
      income: rollup.income,
      expense: rollup.expense,
      net: rollup.net,
    })),
    expenseSlices: buildExpenseSlices(latestMonthTxns),
    topPayees: buildTopPayees(latestMonthTxns),
    movers: buildMovers(latestMonthTxns, previousMonthTxns),
    opportunityTotal,
    opportunities,
    summaryBullets: buildSummary(latest, previous, opportunities, txns.length),
    digHerePreview: opportunities.slice(0, 4),
  };
}

export function projectScenario(model: DashboardModel, input: ScenarioInput): ScenarioPoint[] {
  if (!model.latestMonth || model.monthlyRollups.length === 0) {
    return [];
  }

  const baselineMonths = model.monthlyRollups.slice(-3);
  const baselineIncome =
    baselineMonths.reduce((sum, month) => sum + month.income, 0) /
    Math.max(baselineMonths.length, 1);
  const baselineExpense =
    baselineMonths.reduce((sum, month) => sum + month.expense, 0) /
    Math.max(baselineMonths.length, 1);

  const growthFactor = 1 + input.revenueGrowthPct / 100;
  const expenseFactor = 1 - input.expenseReductionPct / 100;

  const projections: ScenarioPoint[] = [];
  let cumulativeNet = 0;

  for (let index = 1; index <= input.months; index += 1) {
    const month = addMonths(model.latestMonth, index);
    const projectedIncome = round2(baselineIncome * growthFactor ** index);
    const projectedExpense = round2(baselineExpense * expenseFactor ** index);
    const projectedNet = round2(projectedIncome - projectedExpense);
    cumulativeNet = round2(cumulativeNet + projectedNet);

    projections.push({
      month,
      projectedIncome,
      projectedExpense,
      projectedNet,
      cumulativeNet,
    });
  }

  return projections;
}

export function toMonthLabel(month: string): string {
  return monthLabel(month);
}
