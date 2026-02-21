import { useCallback, useEffect, useMemo, useState } from 'react';
import { APP_TITLE, SHEET_CSV_FALLBACK_URL, SHEET_CSV_URL, STORAGE_KEYS } from '../config';
import ExpenseDonut from '../components/ExpenseDonut';
import KpiCards from '../components/KpiCards';
import MoversList from '../components/MoversList';
import TopPayeesTable from '../components/TopPayeesTable';
import TrendLineChart from '../components/TrendLineChart';
import { buildDataSet, splitActualsAndProjections } from '../lib/data/normalize';
import { fetchSheetCsv } from '../lib/data/fetchCsv';
import { computeDashboardModel, projectScenario, toMonthLabel } from '../lib/kpis/compute';
import type { DataSet, ScenarioInput, TrendPoint } from '../lib/data/contract';

type TabId =
  | 'big-picture'
  | 'money-left'
  | 'dig-here'
  | 'trends'
  | 'what-if'
  | 'settings';

type NavItem = {
  id: TabId;
  label: string;
  shortLabel: string;
};

type DataViewMode = 'actuals' | 'all';

const NAV_ITEMS: NavItem[] = [
  { id: 'big-picture', label: 'Big Picture', shortLabel: 'Big Picture' },
  { id: 'money-left', label: 'Money Left on the Table', shortLabel: 'MLOT' },
  { id: 'dig-here', label: 'Dig Here', shortLabel: 'Dig Here' },
  { id: 'trends', label: 'Trends', shortLabel: 'Trends' },
  { id: 'what-if', label: 'What-If Scenarios', shortLabel: 'What-If' },
  { id: 'settings', label: 'Settings', shortLabel: 'Settings' },
];

const DEFAULT_SCENARIO: ScenarioInput = {
  revenueGrowthPct: 4,
  expenseReductionPct: 3,
  months: 12,
};

function formatCurrency(value: number): string {
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return 'Never';
  const date = new Date(iso);
  return date.toLocaleString();
}

function getStoredCsvUrl(): string {
  if (typeof window === 'undefined') return SHEET_CSV_URL;
  try {
    return window.localStorage.getItem(STORAGE_KEYS.csvUrl) ?? SHEET_CSV_URL;
  } catch {
    return SHEET_CSV_URL;
  }
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<TabId>('big-picture');
  const [csvUrl, setCsvUrl] = useState(getStoredCsvUrl);
  const [draftCsvUrl, setDraftCsvUrl] = useState(getStoredCsvUrl);
  const [query, setQuery] = useState('');
  const [dataSet, setDataSet] = useState<DataSet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [scenarioInput, setScenarioInput] = useState<ScenarioInput>(DEFAULT_SCENARIO);
  const [dataViewMode, setDataViewMode] = useState<DataViewMode>('actuals');

  const runSync = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { records, sourceUrl } = await fetchSheetCsv(csvUrl, SHEET_CSV_FALLBACK_URL);
      const normalized = buildDataSet(records, sourceUrl);
      setDataSet(normalized);
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : 'Could not sync CSV data.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [csvUrl]);

  useEffect(() => {
    void runSync();
  }, [runSync]);

  const dataSplit = useMemo(
    () => splitActualsAndProjections(dataSet?.txns ?? []),
    [dataSet?.txns]
  );

  const baseTxns = useMemo(
    () => (dataViewMode === 'all' ? [...dataSplit.actuals, ...dataSplit.projections] : dataSplit.actuals),
    [dataSplit.actuals, dataSplit.projections, dataViewMode]
  );

  const filteredTxns = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return baseTxns;

    return baseTxns.filter((txn) => {
      const joined = [txn.payee, txn.category, txn.memo, txn.account]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return joined.includes(needle);
    });
  }, [baseTxns, query]);

  const model = useMemo(() => computeDashboardModel(filteredTxns), [filteredTxns]);

  const scenarioProjection = useMemo(() => projectScenario(model, scenarioInput), [model, scenarioInput]);
  const scenarioTrend = useMemo<TrendPoint[]>(
    () =>
      scenarioProjection.map((point) => ({
        month: point.month,
        income: point.projectedIncome,
        expense: point.projectedExpense,
        net: point.projectedNet,
      })),
    [scenarioProjection]
  );

  const latestRollup = model.monthlyRollups[model.monthlyRollups.length - 1] ?? null;
  const previousRollup = model.monthlyRollups[model.monthlyRollups.length - 2] ?? null;

  const sustainability = useMemo(
    () => [
      {
        label: 'Revenue Momentum',
        value: model.kpiCards.find((card) => card.id === 'income')?.trend === 'up' ? 'Getting Better' : 'Getting Worse',
      },
      {
        label: 'Cost Discipline',
        value: model.kpiCards.find((card) => card.id === 'expense')?.trend === 'down' ? 'Getting Better' : 'Needs Attention',
      },
      {
        label: 'Net Cash Position',
        value: (latestRollup?.net ?? 0) >= 0 ? 'Healthy' : 'Negative',
      },
      {
        label: 'Consistency',
        value: model.monthlyRollups.length >= 6 ? 'Long-term Visible' : 'Need More History',
      },
    ],
    [latestRollup?.net, model.kpiCards, model.monthlyRollups.length]
  );

  const rightPanelActions = model.digHerePreview.slice(0, 4);

  function handleSaveCsvUrl() {
    const nextUrl = draftCsvUrl.trim();
    setCsvUrl(nextUrl);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(STORAGE_KEYS.csvUrl, nextUrl);
      } catch {
        // Ignore storage failures and continue with in-memory URL.
      }
    }
  }

  function handleResetCsvUrl() {
    setDraftCsvUrl(SHEET_CSV_URL);
    setCsvUrl(SHEET_CSV_URL);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(STORAGE_KEYS.csvUrl, SHEET_CSV_URL);
      } catch {
        // Ignore storage failures and continue with in-memory URL.
      }
    }
  }

  return (
    <div className="finance-app">
      <aside className="left-nav glass-panel">
        <div className="brand-wrap">
          <div className="brand-badge" aria-hidden="true">
            GS
          </div>
          <div>
            <h1>{APP_TITLE}</h1>
            <p>Personal CFO Scorecard</p>
          </div>
        </div>

        <nav aria-label="Main navigation">
          <ul>
            {NAV_ITEMS.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={activeTab === item.id ? 'nav-item is-active' : 'nav-item'}
                  onClick={() => setActiveTab(item.id)}
                >
                  <span>{item.shortLabel}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <button type="button" className="sync-btn" onClick={() => void runSync()} disabled={loading}>
          {loading ? 'Syncing...' : 'Sync now'}
        </button>

        <p className="meta-note">Last sync: {formatTimestamp(dataSet?.fetchedAtIso ?? null)}</p>
      </aside>

      <section className="main-zone">
        <header className="top-bar glass-panel">
          <div>
            <h2>
              {model.latestMonth ? toMonthLabel(model.latestMonth) : 'No Data Yet'}
            </h2>
            <p>
              {model.previousMonth ? `Compared with ${toMonthLabel(model.previousMonth)}` : 'Load CSV history to unlock comparisons.'}
            </p>
          </div>

          <div className="top-controls">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search payee, category, memo..."
              aria-label="Search transactions"
            />
            <div className="view-toggle" role="group" aria-label="Data view mode">
              <button
                type="button"
                className={dataViewMode === 'actuals' ? 'is-active' : ''}
                onClick={() => setDataViewMode('actuals')}
              >
                Actuals
              </button>
              <button
                type="button"
                className={dataViewMode === 'all' ? 'is-active' : ''}
                onClick={() => setDataViewMode('all')}
              >
                Actuals + Projections
              </button>
            </div>
            <p className="data-count-note">
              Actuals: {dataSplit.actuals.length.toLocaleString()} rows • Projections:{' '}
              {dataSplit.projections.length.toLocaleString()} rows
            </p>
          </div>
        </header>

        {error && <p className="error-banner">{error}</p>}

        {activeTab === 'big-picture' && (
          <>
            <KpiCards cards={model.kpiCards} />

            <TrendLineChart data={model.trend} metric="net" title="Monthly Net Cash Flow" />

            <div className="two-col-grid">
              <article className="card preview-card">
                <div className="card-head">
                  <h3>Money Left on the Table</h3>
                  <p className="subtle">Recoverable opportunity this month</p>
                </div>
                <p className="hero-number">{formatCurrency(model.opportunityTotal)}</p>
                <ul className="opportunity-list">
                  {model.opportunities.slice(0, 5).map((item) => (
                    <li key={item.title}>
                      <span>{item.title}</span>
                      <strong>{formatCurrency(item.savings)}</strong>
                    </li>
                  ))}
                </ul>
              </article>

              <MoversList movers={model.movers.slice(0, 5)} title="Dig Here (Preview)" />
            </div>

            <div className="two-col-grid">
              <article className="card summary-card">
                <div className="card-head">
                  <h3>Summary of Results</h3>
                  <p className="subtle">Narrative snapshot from this period</p>
                </div>

                <ul className="summary-list">
                  {model.summaryBullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              </article>

              <article className="card summary-card">
                <div className="card-head">
                  <h3>Sustainability</h3>
                  <p className="subtle">Health checks in one glance</p>
                </div>
                <ul className="status-list">
                  {sustainability.map((item) => (
                    <li key={item.label}>
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                    </li>
                  ))}
                </ul>
              </article>
            </div>
          </>
        )}

        {activeTab === 'money-left' && (
          <div className="tab-grid">
            <article className="card">
              <div className="card-head">
                <h3>Money Left on the Table</h3>
                <p className="subtle">Potential savings from category overruns vs baseline</p>
              </div>
              <p className="hero-number">{formatCurrency(model.opportunityTotal)}</p>

              <ul className="opportunity-list">
                {model.opportunities.map((item) => (
                  <li key={item.title}>
                    <div>
                      <strong>{item.title}</strong>
                      <p>{item.hint}</p>
                    </div>
                    <span>{formatCurrency(item.savings)}</span>
                  </li>
                ))}
              </ul>
            </article>

            <ExpenseDonut slices={model.expenseSlices} />
          </div>
        )}

        {activeTab === 'dig-here' && (
          <div className="tab-grid">
            <MoversList movers={model.movers} title="Dig Here Actions" />
            <TopPayeesTable payees={model.topPayees} />
          </div>
        )}

        {activeTab === 'trends' && (
          <div className="stack-grid">
            <TrendLineChart data={model.trend} metric="income" title="Revenue Trend" />
            <TrendLineChart data={model.trend} metric="expense" title="Expense Trend" />

            <article className="card table-card">
              <div className="card-head">
                <h3>Monthly Rollups</h3>
                <p className="subtle">Income, expense, net and transaction count by month</p>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Income</th>
                    <th>Expense</th>
                    <th>Net</th>
                    <th>Txns</th>
                  </tr>
                </thead>
                <tbody>
                  {model.monthlyRollups.map((rollup) => (
                    <tr key={rollup.month}>
                      <td>{toMonthLabel(rollup.month)}</td>
                      <td>{formatCurrency(rollup.income)}</td>
                      <td>{formatCurrency(rollup.expense)}</td>
                      <td>{formatCurrency(rollup.net)}</td>
                      <td>{rollup.transactionCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          </div>
        )}

        {activeTab === 'what-if' && (
          <div className="stack-grid">
            <article className="card scenario-card">
              <div className="card-head">
                <h3>What-If Scenario</h3>
                <p className="subtle">Adjust assumptions and project the next 12 months</p>
              </div>

              <div className="slider-grid">
                <label>
                  Revenue growth ({scenarioInput.revenueGrowthPct.toFixed(1)}%)
                  <input
                    type="range"
                    min={-10}
                    max={20}
                    step={0.5}
                    value={scenarioInput.revenueGrowthPct}
                    onChange={(event) =>
                      setScenarioInput((prev) => ({
                        ...prev,
                        revenueGrowthPct: Number.parseFloat(event.target.value),
                      }))
                    }
                  />
                </label>

                <label>
                  Expense reduction ({scenarioInput.expenseReductionPct.toFixed(1)}%)
                  <input
                    type="range"
                    min={0}
                    max={20}
                    step={0.5}
                    value={scenarioInput.expenseReductionPct}
                    onChange={(event) =>
                      setScenarioInput((prev) => ({
                        ...prev,
                        expenseReductionPct: Number.parseFloat(event.target.value),
                      }))
                    }
                  />
                </label>
              </div>
            </article>

            <TrendLineChart data={scenarioTrend} metric="net" title="Projected Monthly Net (12 Months)" />

            <article className="card table-card">
              <div className="card-head">
                <h3>Projection Table</h3>
                <p className="subtle">Scenario output using trailing 3-month baseline</p>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Projected Income</th>
                    <th>Projected Expense</th>
                    <th>Projected Net</th>
                    <th>Cumulative Net</th>
                  </tr>
                </thead>
                <tbody>
                  {scenarioProjection.map((row) => (
                    <tr key={row.month}>
                      <td>{toMonthLabel(row.month)}</td>
                      <td>{formatCurrency(row.projectedIncome)}</td>
                      <td>{formatCurrency(row.projectedExpense)}</td>
                      <td>{formatCurrency(row.projectedNet)}</td>
                      <td>{formatCurrency(row.cumulativeNet)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>
          </div>
        )}

        {activeTab === 'settings' && (
          <article className="card settings-card">
            <div className="card-head">
              <h3>Data Source Settings</h3>
              <p className="subtle">Google Sheets CSV endpoint used by this dashboard</p>
            </div>

            <label className="settings-field">
              CSV URL
              <input
                type="url"
                value={draftCsvUrl}
                onChange={(event) => setDraftCsvUrl(event.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/.../export?format=csv&gid=0"
              />
            </label>

            <div className="settings-actions">
              <button type="button" onClick={handleSaveCsvUrl}>
                Save source URL
              </button>
              <button type="button" onClick={handleResetCsvUrl} className="ghost-btn">
                Reset to default
              </button>
              <button type="button" onClick={() => void runSync()} className="ghost-btn" disabled={loading}>
                {loading ? 'Syncing...' : 'Sync now'}
              </button>
            </div>

            <div className="settings-meta">
              <p>
                Active source: <code>{dataSet?.sourceUrl ?? csvUrl}</code>
              </p>
              <p>
                Last refresh: <strong>{formatTimestamp(dataSet?.fetchedAtIso ?? null)}</strong>
              </p>
            </div>
          </article>
        )}
      </section>

      <aside className="right-panel">
        <section className="right-hero">
          <p className="eyebrow">Current Net</p>
          <h3>{latestRollup ? formatCurrency(latestRollup.net) : '$0'}</h3>
          <p>
            {latestRollup
              ? `for ${toMonthLabel(latestRollup.month)} (${latestRollup.transactionCount.toLocaleString()} transactions)`
              : 'Waiting for data'}
          </p>

          <div className="delta-chip">
            <span>{(latestRollup?.net ?? 0) >= (previousRollup?.net ?? 0) ? '▲' : '▼'}</span>
            <span>
              vs previous {previousRollup ? formatCurrency(previousRollup.net) : 'n/a'}
            </span>
          </div>
        </section>

        <section className="right-card">
          <h4>Dig Here Priorities</h4>
          <ul>
            {rightPanelActions.map((item) => (
              <li key={item.title}>
                <span>{item.title}</span>
                <strong>{formatCurrency(item.savings)}</strong>
              </li>
            ))}
          </ul>
        </section>

        <section className="right-card">
          <h4>Quick Health</h4>
          <div className="mini-metrics">
            <p>
              Revenue <strong>{formatCurrency(latestRollup?.income ?? 0)}</strong>
            </p>
            <p>
              Expense <strong>{formatCurrency(latestRollup?.expense ?? 0)}</strong>
            </p>
            <p>
              Opportunity <strong>{formatCurrency(model.opportunityTotal)}</strong>
            </p>
          </div>
        </section>
      </aside>
    </div>
  );
}
