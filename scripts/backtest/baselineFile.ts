import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { AggregateMetrics, BaselineFile } from './types';

export const BASELINE_PATH = 'backtest-results/baseline.json';

export function readBaseline(path: string = BASELINE_PATH): BaselineFile | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw) as BaselineFile;
}

/** Build a BaselineFile from current run metadata.
 *  Key order is fixed by literal construction so JSON output is stable
 *  across writes. */
export function buildBaselineFile(args: {
  fixturePath: string;
  fixtureRowCount: number;
  anchorsLoaded: number;
  asOfDateCount: number;
  harnessVersion: string;
  aggregate: AggregateMetrics;
}): BaselineFile {
  return {
    writtenAt: new Date().toISOString(),
    fixturePath: args.fixturePath,
    fixtureRowCount: args.fixtureRowCount,
    anchorsLoaded: args.anchorsLoaded,
    asOfDateCount: args.asOfDateCount,
    harnessVersion: args.harnessVersion,
    aggregate: {
      directionalAccuracy: args.aggregate.directionalAccuracy,
      mape30: args.aggregate.mape30,
      mape60: args.aggregate.mape60,
      mape90: args.aggregate.mape90,
      safetyLineHitRate: args.aggregate.safetyLineHitRate,
      worstSingleMonthMiss: args.aggregate.worstSingleMonthMiss,
      engineVsNaiveYoY: {
        wins: args.aggregate.engineVsNaiveYoY.wins,
        losses: args.aggregate.engineVsNaiveYoY.losses,
        tied: args.aggregate.engineVsNaiveYoY.tied,
      },
      engineVsT12M: {
        wins: args.aggregate.engineVsT12M.wins,
        losses: args.aggregate.engineVsT12M.losses,
        tied: args.aggregate.engineVsT12M.tied,
      },
    },
  };
}

export function writeBaseline(path: string, data: BaselineFile): void {
  const json = JSON.stringify(data, null, 2);
  writeFileSync(path, `${json}\n`, 'utf8');
}
