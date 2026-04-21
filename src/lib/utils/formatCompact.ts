// formatCompact — thresholds match spec mock data table output.
// Note: spec text says "10K+ no decimal" but mock data shows one decimal
// for all K values (e.g. $38.2K, $10.7K). Implemented to match the data.
export function formatCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs < 1000) return `${sign}$${Math.round(abs)}`;
  if (abs < 100000) return `${sign}$${(abs / 1000).toFixed(1)}K`;
  return `${sign}$${Math.round(abs / 1000)}K`;
}

// Shared tooltip formatters — use these in all ApexCharts tooltip configs.
// Import from this file; do not reimplement currency formatting inline.

export function formatTooltipY(value: number): string {
  return formatCompact(value);
}

export function formatTooltipX(value: string): string {
  return value;
}
