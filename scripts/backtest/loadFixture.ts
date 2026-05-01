import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Txn } from '../../src/lib/data/contract';
import { classifyType } from '../../src/lib/cashFlow';
import type { AnchorsFile } from './types';

const FIXTURE_PATH = resolve('backtest-results/fixtures/transactions-snapshot.csv');
const ANCHORS_PATH = resolve('backtest-results/fixtures/historical-anchors.json');

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

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

  const raw = readFileSync(FIXTURE_PATH, 'utf8').replace(/\r\n/g, '\n');
  const lines = raw.split('\n').filter((line: string) => line.length > 0);
  if (lines.length === 0) {
    throw new Error(`Fixture is empty: ${FIXTURE_PATH}`);
  }

  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  const idx = (name: string): number => {
    const i = header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
    return i;
  };

  const iId = idx('id');
  const iDate = idx('date');
  const iMonth = idx('month');
  const iAmount = idx('amount');
  const iRawAmount = idx('rawAmount');
  const iCategory = idx('category');
  const iPayee = idx('payee');
  const iMemo = idx('memo');
  const iAccount = idx('account');
  const iTransferAccount = idx('transferAccount');
  const iTags = idx('tags');
  const iBalance = idx('balance');
  const iType = idx('type');

  if (iDate < 0 || iAmount < 0 || iCategory < 0) {
    throw new Error(
      `Fixture missing required columns. Header was: ${header.join(', ')}\n` +
        'Required: date, amount, category (and rawAmount strongly recommended).'
    );
  }

  const txns: Txn[] = [];
  for (let lineNum = 1; lineNum < lines.length; lineNum += 1) {
    const cols = parseCsvLine(lines[lineNum]);
    const date = (cols[iDate] ?? '').trim();
    if (!date) continue;

    const month = iMonth >= 0 && cols[iMonth] ? cols[iMonth].trim() : date.slice(0, 7);
    const amountNum = Number((cols[iAmount] ?? '0').trim());
    const rawAmountNum =
      iRawAmount >= 0 && cols[iRawAmount]?.trim().length
        ? Number(cols[iRawAmount].trim())
        : amountNum;

    const explicitType = iType >= 0 ? cols[iType]?.trim().toLowerCase() : '';
    const type =
      explicitType === 'income' || explicitType === 'expense'
        ? (explicitType as 'income' | 'expense')
        : classifyType(rawAmountNum);

    const tagsRaw = iTags >= 0 ? cols[iTags]?.trim() : '';
    const tags = tagsRaw ? tagsRaw.split('|').map((t) => t.trim()).filter(Boolean) : undefined;

    const balanceRaw = iBalance >= 0 ? cols[iBalance]?.trim() : '';
    const balance = balanceRaw ? Number(balanceRaw) : undefined;

    txns.push({
      id: iId >= 0 && cols[iId] ? cols[iId] : `${date}-${lineNum}`,
      date,
      month,
      type,
      amount: Math.abs(amountNum),
      rawAmount: rawAmountNum,
      category: cols[iCategory] ?? '',
      payee: iPayee >= 0 ? cols[iPayee] || undefined : undefined,
      memo: iMemo >= 0 ? cols[iMemo] || undefined : undefined,
      account: iAccount >= 0 ? cols[iAccount] || undefined : undefined,
      transferAccount: iTransferAccount >= 0 ? cols[iTransferAccount] || undefined : undefined,
      tags,
      balance: Number.isFinite(balance) ? (balance as number) : undefined,
    });
  }

  return txns;
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
