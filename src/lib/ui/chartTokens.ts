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
 * are decided commit-by-commit, not pre-added here.
 */
export const chartTokens = {
  // Brand
  brand:           '#465FFF',
  brandSecondary:  '#9CB9FF',
  brand400:        '#637AEA',
  brand700:        '#2A31D8',

  // Semantic
  info:                 '#0BA5EC',
  skyLight:        '#38BDF8',  // TailAdmin Sales "Total Sales" sparkline accent (sky-400)
  success:              '#12B76A',
  successGradientEnd:   '#89DBB5',
  successText:          '#039855',
  error:           '#F04438',
  warning:         '#F79009',
  pressure:        '#DC6803',
  costSpike:       '#FB5454',

  // Neutral — used when a stroke needs to read as "no direction" / "flat"
  // (e.g. Cash Trend straight result line when t6mMargin is near zero).
  neutral:         '#98A2B3',

  // Churn-by-Belt line hues — semantic belt colors so each line/legend reads as
  // its belt. White belt has no drawable color on a white card, so it uses
  // `neutral` as a placeholder (the legend label carries the "White" meaning);
  // Blue reuses `brand`, Yellow+Orange reuses `warning`. These three are the
  // belt-specific additions with no existing token.
  beltPurple:      '#7A5AF8',  // Purple belt (adults)
  beltBrownBlack:  '#1D2939',  // Brown+Black belt (adults) — near-black
  beltGrey:        '#667085',  // Grey-family belt (kids) — darker than the White placeholder

  // Structural
  gridBorder:      '#e0e0e0',
  crosshairStroke: '#b6b6b6',
  axisText:        '#667085',
  axisTextSales:   '#373d3f',

  // Text-on-chart
  chartTextStrong: '#344054',
} as const;

export type ChartToken = keyof typeof chartTokens;
