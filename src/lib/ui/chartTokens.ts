/**
 * Chart Tokens — single source of truth for ApexCharts hex values.
 *
 * Per UI_RULES.md §Chart Token File: no chart component may
 * re-type a hex value inline in its options object. Import
 * from this file instead.
 *
 * Permitted inline exception: #FFFFFF (pure white) may appear
 * inline as stroke separators or marker fills. No other hex
 * literal is allowed in ApexCharts options objects.
 *
 * Orphan hexes encountered during per-chart migration
 * (#FB5454, #b6b6b6, #89DBB5, #9ca3af, etc.) are decided
 * commit-by-commit, not pre-added here.
 */
export const chartTokens = {
  // Brand
  brand:           '#465FFF',
  brandSecondary:  '#9CB9FF',
  brand400:        '#637AEA',

  // Semantic
  success:         '#12B76A',
  successText:     '#039855',
  error:           '#F04438',
  warning:         '#F79009',
  pressure:        '#DC6803',

  // Structural
  gridBorder:      '#e0e0e0',
  axisText:        '#667085',
  axisTextSales:   '#373d3f',

  // Text-on-chart
  chartTextStrong: '#344054',
} as const;

export type ChartToken = keyof typeof chartTokens;
