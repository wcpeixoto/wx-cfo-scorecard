// Settings → Data: "Export monthly source JSON" — a one-click download of the month's scorecard
// numbers for the Monthly Attack Plan workflow. Financial data comes from the Dashboard `model`
// (passed in); retention data is pulled from the existing pure fetchers (member_retention_rates +
// wodify_retention_aggregate) — neither domain shares a provider, so the export gathers both here.
// All serialization + gating lives in the pure buildMonthlySourceExport; this component only wires
// inputs, shows per-domain live/missing status, and triggers the Blob download.

import { useCallback, useEffect, useState } from 'react';

import { useRetentionSettings } from '../context/RetentionSettingsContext';
import { fetchMemberRetentionRates } from '../lib/gym/fetchMemberRetentionRates';
import { fetchLatestRetentionAggregate } from '../lib/gym/fetchRetentionAggregate';
import { realRetentionMonths, type RetentionMonth } from '../lib/gym/memberRetentionSeries';
import type { RetentionAggregateSnapshot } from '../lib/gym/fetchRetentionAggregate';
import {
  buildMonthlySourceExport,
  type FinancialBasis,
} from '../lib/export/buildMonthlySourceExport';
import type { DashboardModel } from '../lib/data/contract';

type RetentionState = {
  rates: RetentionMonth[] | null;
  snapshot: RetentionAggregateSnapshot | null;
  loaded: boolean;
};

function statusLabel(live: boolean | null): string {
  if (live === null) return 'Checking…';
  return live ? 'Live' : 'Missing';
}

export function ExportSourceJsonCard({
  model,
  financialTxnCount,
  currentCalendarMonth,
  financialBasis,
}: {
  model: DashboardModel;
  financialTxnCount: number;
  currentCalendarMonth: string;
  financialBasis: FinancialBasis;
}) {
  const { silentChurnThresholdDays } = useRetentionSettings();
  const [retention, setRetention] = useState<RetentionState>({
    rates: null,
    snapshot: null,
    loaded: false,
  });
  const [exporting, setExporting] = useState(false);

  // Probe retention live-status once to seed the pre-click status lines. The export itself ALWAYS
  // re-fetches on click (see handleExport) and never reads this probe for the payload — so an
  // in-session import can't leave a stale file. A null result is "not live", never a fabricated value.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchMemberRetentionRates().catch(() => null),
      fetchLatestRetentionAggregate().catch(() => null),
    ]).then(([rates, snapshot]) => {
      if (!cancelled) setRetention({ rates, snapshot, loaded: true });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      // ALWAYS re-fetch on click — the mount probe can go stale after an in-session Member
      // Retention Rates import. The fresh result feeds both the payload and the status lines.
      const [rates, snapshot] = await Promise.all([
        fetchMemberRetentionRates().catch(() => null),
        fetchLatestRetentionAggregate().catch(() => null),
      ]);
      setRetention({ rates, snapshot, loaded: true });
      const payload = buildMonthlySourceExport({
        model,
        financialTxnCount,
        currentCalendarMonth,
        financialBasis,
        retentionRates: rates,
        snapshot,
        thresholdDays: silentChurnThresholdDays,
        generatedAt: new Date().toISOString(),
      });
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `wx-cfo-scorecard-source-${String(payload.scorecard_month)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }, [model, financialTxnCount, currentCalendarMonth, financialBasis, silentChurnThresholdDays]);

  const financialLive = financialTxnCount > 0;
  const forecastAvailable = model.cashFlowForecastSeries.some((p) => p.status === 'projected');
  const retentionLive = retention.loaded
    ? Boolean(retention.rates) && realRetentionMonths(retention.rates ?? []).length > 0
    : null;
  const snapshotLive = retention.loaded ? Boolean(retention.snapshot) : null;
  const requiredMissing = !financialLive || retentionLive === false;

  return (
    <div className="ta-card">
      <div className="ta-card-header">
        <h3 className="ta-card-title">Export monthly source JSON</h3>
      </div>
      <div className="ta-card-body">
        <p className="subtle">
          One JSON file of this month&rsquo;s scorecard numbers for the Monthly Attack Plan.
          Aggregates only — no transactions, payees, or member identities.
        </p>
        <ul className="export-source-status">
          <li>
            Financial: <strong>{statusLabel(financialLive)}</strong>
          </li>
          <li>
            Membership retention: <strong>{statusLabel(retentionLive)}</strong>
          </li>
          <li>
            Attendance snapshot: <strong>{statusLabel(snapshotLive)}</strong>
          </li>
          <li>
            Forecast: <strong>{forecastAvailable ? 'Available' : 'Missing'}</strong>
          </li>
        </ul>
        {requiredMissing && (
          <p className="export-source-warning">
            Not usable for Attack Plan until live financial and membership retention data are
            available.
          </p>
        )}
        <div className="settings-actions">
          <button type="button" className="ghost-btn" onClick={() => void handleExport()} disabled={exporting}>
            {exporting ? 'Exporting…' : 'Export source JSON'}
          </button>
        </div>
      </div>
    </div>
  );
}
