import { describe, expect, it, vi } from 'vitest';

import {
  collectMonthlySourceExportPayload,
  type MonthlySourceExportSources,
  type RetentionFetchResult,
} from './collectMonthlySourceExport';
import { computeDashboardModel } from '../kpis/compute';
import { computeSourceHash } from '../data/scorecardSnapshot';
import type { DashboardModel, Txn } from '../data/contract';

function txn(id: string, month: string, category: string, rawAmount: number): Txn {
  return {
    id,
    date: `${month}-15`,
    month,
    type: rawAmount > 0 ? 'income' : 'expense',
    amount: Math.abs(rawAmount),
    category,
    rawAmount,
  };
}

function txns(): Txn[] {
  const out: Txn[] = [];
  ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'].forEach((m, i) => {
    out.push(txn(`r-${m}`, m, 'Business Income:Memberships', 10000 + i * 100));
    out.push(txn(`e-${m}`, m, 'Rent', -(3000 + i * 10)));
  });
  return out;
}

function model(): DashboardModel {
  return computeDashboardModel(txns(), {
    cashFlowMode: 'operating',
    anchorMonth: '2026-06',
    thisMonthAnchor: '2026-07',
    currentCashBalance: 50000,
  });
}

const RETENTION: RetentionFetchResult = {
  rates: null,
  snapshot: null,
  belt: null,
  cohortRates: null,
};

function sources(): MonthlySourceExportSources {
  const m = model();
  return {
    model: m,
    scorecardAnchoredModel: m,
    financialTxnCount: txns().length,
    currentCalendarMonth: '2026-07',
    financialBasis: 'operating',
    scenarioProjection: [],
    scenarioRunOutMonth: null,
    efficiencyResult: {
      windowLabel: '',
      rows: [],
      totalExtraPerMonth: 0,
      payrollExtraPerMonth: 0,
      payrollTodayPct: 0,
      payrollBestPct: 0,
      payrollBestWindowLabel: '',
      payrollRollingSeries: [],
      benchmarkRevenueQualified: false,
    } as unknown as MonthlySourceExportSources['efficiencyResult'],
    whatNeedsAttention: {
      currentMonth: '',
      baselineMonths: '',
      noData: true,
      rows: [],
    } as unknown as MonthlySourceExportSources['whatNeedsAttention'],
    ownerDistributionStatus: {
      status: 'on_target',
      targetAmount: 0,
      actualAmount: 0,
      windowStart: null,
      windowEnd: null,
    },
    ownerPayProjection: [],
    ownerPayReserveFloor: 0,
    targetNetMargin: 0,
    thresholdDays: 21,
  };
}

describe('collectMonthlySourceExportPayload', () => {
  it('1. the automatic payload equals the manual payload apart from generated_at', async () => {
    const fetchRetention = vi.fn(async () => RETENTION);
    const shared = sources();

    // The manual export path and the snapshot path call the SAME collector with the SAME sources;
    // only the clock differs.
    const manual = await collectMonthlySourceExportPayload(shared, {
      fetchRetention,
      now: () => new Date('2026-09-08T10:00:00.000Z'),
    });
    const automatic = await collectMonthlySourceExportPayload(shared, {
      fetchRetention,
      now: () => new Date('2026-09-08T23:59:59.000Z'),
    });

    expect(manual.payload.generated_at).not.toBe(automatic.payload.generated_at);
    const { generated_at: _m, ...manualRest } = manual.payload;
    const { generated_at: _a, ...automaticRest } = automatic.payload;
    expect(automaticRest).toEqual(manualRest);
    // ...and the documented hash treats them as the same snapshot.
    expect(await computeSourceHash(automatic.payload)).toBe(await computeSourceHash(manual.payload));
  });

  it('2. re-fetches the live retention sources on every call — never a cached probe', async () => {
    const fetchRetention = vi.fn(async () => RETENTION);
    await collectMonthlySourceExportPayload(sources(), { fetchRetention });
    await collectMonthlySourceExportPayload(sources(), { fetchRetention });
    expect(fetchRetention).toHaveBeenCalledTimes(2);
  });

  it('3. an empty forecast produces forecast:not_available, not a suppressed payload', async () => {
    const { payload } = await collectMonthlySourceExportPayload(
      { ...sources(), scenarioProjection: [] },
      { fetchRetention: async () => RETENTION },
    );
    expect(payload.missing_or_unavailable).toContain('forecast:not_available');
    expect(payload.forecast).toBeUndefined();
    // the rest of the snapshot is still fully populated — this is a completed state, not a failure
    expect(payload.scorecard_month).toBe('2026-06');
    expect(payload.schema_version).toBe('0.1');
    expect(Array.isArray(payload.financial_monthly)).toBe(true);
  });

  it('4. carries the retention results back for the caller status lines', async () => {
    const withRates: RetentionFetchResult = { ...RETENTION, belt: [] };
    const { retention } = await collectMonthlySourceExportPayload(sources(), {
      fetchRetention: async () => withRates,
    });
    expect(retention).toEqual(withRates);
  });
});
