import type { ForecastEvent } from '../data/contract';

type Freq = 'once' | 'monthly' | 'yearly';

function parseGroup(id: string): { freq: Freq; groupId: string } | null {
  const parts = id.split('__');
  if (parts.length !== 3) return null;
  if (parts[0] !== 'once' && parts[0] !== 'monthly' && parts[0] !== 'yearly') return null;
  return { freq: parts[0] as Freq, groupId: parts[1] };
}

function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function dateInMonth(month: string, desiredDay: number): string {
  const [y, m] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const day = Math.min(Math.max(desiredDay, 1), lastDay);
  return `${month}-${String(day).padStart(2, '0')}`;
}

/**
 * Expand monthly/yearly manual recurring events to cover the current
 * forecast horizon. Storage keeps only the occurrences generated when the
 * event was created (at the then-current horizon); after the horizon
 * grows, the stored list under-fills and the overlay/chart see fewer
 * occurrences than the user expects. This view-time expander rebuilds
 * the full series from each group's earliest stored occurrence ("seed")
 * and the current horizon — without mutating storage.
 *
 * Once events and renewal-sourced events pass through unchanged.
 */
export function expandRecurringEvents(
  events: ForecastEvent[],
  forecastRangeMonths: number,
  now: Date = new Date()
): ForecastEvent[] {
  if (events.length === 0) return events;

  const manual: ForecastEvent[] = [];
  const renewals: ForecastEvent[] = [];
  for (const e of events) {
    if (e.source === 'renewal') renewals.push(e);
    else manual.push(e);
  }

  type Bucket = { freq: Freq; groupId: string; events: ForecastEvent[] };
  const buckets = new Map<string, Bucket>();
  const passthrough: ForecastEvent[] = [];
  for (const e of manual) {
    const parsed = parseGroup(e.id);
    if (!parsed) {
      passthrough.push(e);
      continue;
    }
    const key = `${parsed.freq}:${parsed.groupId}`;
    if (!buckets.has(key)) buckets.set(key, { freq: parsed.freq, groupId: parsed.groupId, events: [] });
    buckets.get(key)!.events.push(e);
  }

  const horizonEndDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + forecastRangeMonths, 1));
  const horizonEnd = `${horizonEndDate.getUTCFullYear()}-${String(horizonEndDate.getUTCMonth() + 1).padStart(2, '0')}`;

  const expanded: ForecastEvent[] = [...passthrough, ...renewals];

  for (const bucket of buckets.values()) {
    if (bucket.freq === 'once') {
      expanded.push(...bucket.events);
      continue;
    }
    const sorted = [...bucket.events].sort((a, b) => a.month.localeCompare(b.month));
    const seed = sorted[0];
    const seedDay = seed.date ? Number.parseInt(seed.date.slice(8, 10), 10) || 1 : 1;
    const startMonth = seed.month;

    const months: string[] = [];
    if (bucket.freq === 'monthly') {
      let current = startMonth;
      while (current <= horizonEnd) {
        months.push(current);
        current = addMonths(current, 1);
      }
    } else {
      const [sy, sm] = startMonth.split('-').map(Number);
      const [ey] = horizonEnd.split('-').map(Number);
      for (let y = sy; y <= ey; y++) {
        const cand = `${y}-${String(sm).padStart(2, '0')}`;
        if (cand <= horizonEnd) months.push(cand);
      }
    }
    if (months.length === 0) months.push(startMonth);

    for (let i = 0; i < months.length; i++) {
      const month = months[i];
      expanded.push({
        ...seed,
        id: `${bucket.freq}__${bucket.groupId}__${i}`,
        month,
        date: dateInMonth(month, seedDay),
      });
    }
  }

  return expanded;
}
