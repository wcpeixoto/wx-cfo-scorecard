// Phase 5.1 — Pure renewal event generator.
//
// Given a RenewalContract and a horizon, produce the ForecastEvent rows
// the renewal would generate. Pure function: no I/O, no Date.now(), no
// `new Date()` without an argument, no Math.random(), no mutation.
// Same inputs always produce the same output.
//
// Date semantics — the function operates on UTC calendar dates only.
// `today` is interpreted as the UTC date of the supplied Date object;
// the time component is ignored. Two Date objects representing the same
// UTC instant — regardless of how they were constructed (timezone-
// suffixed ISO string, +offset string, etc.) — produce identical
// output. This is the price of stability: a caller invoking the
// function at 11pm local PST on Jan 15 will see today = Jan 16 UTC.
// The dashboard treats forecast dates as calendar dates, not instants,
// so this is the right tradeoff.
//
// Branch 4 will wire the output of this function into
// saveSharedRenewalEvents (the persistence layer) and ultimately into
// the forecast overlay. This branch ships the generator only.

import type { ForecastEvent, RenewalContract } from '../data/contract';
import { generateRenewalEventId } from './generateRenewalEventId';

const MAX_ITERATIONS = 5000; // defensive cap; realistic horizons are ~36

// True for years divisible by 4 except centuries not divisible by 400.
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

// Returns 28..31 for a 1-indexed month (1 = January).
function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

// Pad to YYYY-MM-DD. Year handled with up-to-4-digit padding so the
// string-comparison ordering used downstream stays correct for years
// 1–9999. Month and day are always 2 digits.
function formatYMD(year: number, month: number, day: number): string {
  const yyyy = String(year).padStart(4, '0');
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Add `n` whole months to a (year, month) pair. month is 1-indexed; the
// returned tuple is also 1-indexed. Works for arbitrary positive n.
function addMonths(year: number, month: number, n: number): [number, number] {
  const totalMonths = year * 12 + (month - 1) + n;
  const newYear = Math.floor(totalMonths / 12);
  const newMonth = (totalMonths % 12) + 1;
  return [newYear, newMonth];
}

// Strict YYYY-MM-DD parser. Rejects malformed strings, out-of-range
// month, and impossible day-for-month (e.g., 2025-02-30, 2026-13-01).
// Returns null when the input cannot be interpreted as a real date.
function parseYMD(s: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

export function generateRenewalEvents(
  contract: RenewalContract,
  horizonMonths: number,
  today: Date,
): ForecastEvent[] {
  // --- Gating ---
  if (contract.enabled === false) return [];
  if (contract.status !== 'active') return [];
  if (horizonMonths < 0) return [];
  if (contract.renewalCadence !== 'monthly' && contract.renewalCadence !== 'annual') {
    return [];
  }

  const start = parseYMD(contract.renewalDate);
  if (!start) return [];

  // --- Reference points (UTC calendar dates) ---
  const todayYear = today.getUTCFullYear();
  const todayMonth = today.getUTCMonth() + 1; // 1-indexed
  const todayDay = today.getUTCDate();
  const todayStr = formatYMD(todayYear, todayMonth, todayDay);

  // horizonEnd is the LAST day of the month that is horizonMonths months
  // after today's month. horizonMonths === 0 → end of today's month.
  const [horizonEndYear, horizonEndMonth] = addMonths(todayYear, todayMonth, horizonMonths);
  const horizonEndDay = daysInMonth(horizonEndYear, horizonEndMonth);
  const horizonEndStr = formatYMD(horizonEndYear, horizonEndMonth, horizonEndDay);

  // --- Iterate occurrences ---
  // YYYY-MM-DD strings are zero-padded so lexicographic comparison
  // matches chronological comparison. We rely on that for the
  // todayStr / horizonEndStr bounds check below.
  const stride = contract.renewalCadence === 'monthly' ? 1 : 12;
  const originalDay = start.day;

  const events: ForecastEvent[] = [];

  let curYear = start.year;
  let curMonth = start.month;
  let iter = 0;

  while (iter++ < MAX_ITERATIONS) {
    // Day-of-month clamping: preserve the contract's original day, but
    // clamp to the last valid day of the current target month.
    // Crucially, we re-derive from the ORIGINAL day every iteration —
    // we do NOT carry the previous (clamped) day forward. So Jan 31
    // monthly produces Jan 31 → Feb 28 → Mar 31, not Mar 28.
    const day = Math.min(originalDay, daysInMonth(curYear, curMonth));
    const dateStr = formatYMD(curYear, curMonth, day);

    if (dateStr > horizonEndStr) break;

    if (dateStr >= todayStr) {
      const monthStr = dateStr.slice(0, 7); // 'YYYY-MM'
      events.push({
        id: generateRenewalEventId(contract.id, dateStr),
        month: monthStr,
        date: dateStr,
        type: 'renewal',
        title: contract.name,
        status: 'planned',
        impactMode: 'fixed_amount',
        cashInImpact: contract.cashInAmount,
        cashOutImpact: contract.cashOutAmount,
        enabled: true,
        source: 'renewal',
        contractId: contract.id,
        generatedDate: dateStr,
        generatedCashIn: contract.cashInAmount,
        generatedCashOut: contract.cashOutAmount,
        isOverride: false,
      });
    }

    [curYear, curMonth] = addMonths(curYear, curMonth, stride);
  }

  // Walking forward by a fixed positive stride and clamping monotonically
  // produces an already-sorted sequence. Sort defensively anyway — cheap,
  // and protects against any future iteration-order regression.
  events.sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : 0));
  return events;
}
