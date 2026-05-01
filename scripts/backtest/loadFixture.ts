import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Txn } from '../../src/lib/data/contract';
import type { AnchorsFile } from './types';

const FIXTURE_PATH = resolve('backtest-results/fixtures/transactions-snapshot.jsonl');
const ANCHORS_PATH = resolve('backtest-results/fixtures/historical-anchors.json');

export function fixtureExists(): boolean {
  return existsSync(FIXTURE_PATH);
}

export function getFixturePath(): string {
  return FIXTURE_PATH;
}

export function getAnchorsPath(): string {
  return ANCHORS_PATH;
}

export function loadFixture(): Txn[] {
  if (!fixtureExists()) {
    throw new Error(
      [
        `Backtest fixture missing: ${FIXTURE_PATH}`,
        '',
        'The harness requires a frozen transaction snapshot. To create one,',
        'follow the procedure documented in:',
        '  backtest-results/fixtures/README.md',
        '',
        'Until then, the backtest cannot run.',
      ].join('\n')
    );
  }

  const raw = readFileSync(FIXTURE_PATH, 'utf8');
  const lines = raw.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) {
    throw new Error(`Fixture is empty: ${FIXTURE_PATH}`);
  }

  return lines.map((line, i) => {
    try {
      return JSON.parse(line) as Txn;
    } catch (err) {
      throw new Error(`Fixture parse error on line ${i + 1}: ${err}`);
    }
  });
}

export type LoadedAnchors = {
  loaded: boolean;
  path: string;
  anchors: AnchorsFile['anchors'];
};

export function loadAnchors(): LoadedAnchors {
  if (!existsSync(ANCHORS_PATH)) {
    return { loaded: false, path: ANCHORS_PATH, anchors: [] };
  }
  const raw = readFileSync(ANCHORS_PATH, 'utf8');
  const parsed = JSON.parse(raw) as AnchorsFile;
  const anchors = Array.isArray(parsed?.anchors) ? [...parsed.anchors] : [];
  anchors.sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
  return { loaded: true, path: ANCHORS_PATH, anchors };
}
