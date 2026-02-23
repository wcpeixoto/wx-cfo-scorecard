import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { computeLinearTrendLine, computeProgressiveMovingAverage } from '../lib/charts/movingAverage';
import { toMonthLabel } from '../lib/kpis/compute';
import type { CashFlowMode, TrendPoint } from '../lib/data/contract';

type TrendMetric = 'income' | 'expense' | 'net';

type TrendLineChartProps = {
  data: TrendPoint[];
  metric: TrendMetric;
  title: string;
  enableTimeframeControl?: boolean;
  showCashFlowToggle?: boolean;
  cashFlowMode?: CashFlowMode;
  onCashFlowModeChange?: (nextMode: CashFlowMode) => void;
  onMonthPointClick?: (month: string) => void;
};

type PlotPoint = {
  x: number;
  y: number;
  value: number;
  label: string;
  axisLabel: string;
  month: string;
};

type AxisConfig = {
  min: number;
  max: number;
  ticks: number[];
};

type TimeframeOption = 6 | 12 | 24 | 36 | 'all';

type TimeframeItem = {
  value: TimeframeOption;
  label: string;
};

const WIDTH = 760;
const HEIGHT = 280;
const PADDING_X = 74;
const PADDING_TOP = 26;
const PADDING_BOTTOM = 36;
const EPSILON = 0.00001;

const TIMEFRAME_OPTIONS: TimeframeItem[] = [
  { value: 6, label: 'Last 6 months' },
  { value: 12, label: 'Last 12 months' },
  { value: 24, label: 'Last 24 months' },
  { value: 36, label: 'Last 36 months' },
  { value: 'all', label: 'All time' },
];

function buildMonotoneCurvePath(points: Array<{ x: number; y: number }>): string {
  const count = points.length;
  if (count === 0) return '';
  if (count === 1) return `M ${points[0].x} ${points[0].y}`;

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const slopes: number[] = [];

  for (let index = 0; index < count - 1; index += 1) {
    const dx = xs[index + 1] - xs[index];
    if (Math.abs(dx) <= EPSILON) {
      slopes.push(0);
    } else {
      slopes.push((ys[index + 1] - ys[index]) / dx);
    }
  }

  const tangents: number[] = new Array(count);
  tangents[0] = slopes[0];
  tangents[count - 1] = slopes[count - 2];

  for (let index = 1; index < count - 1; index += 1) {
    tangents[index] = (slopes[index - 1] + slopes[index]) / 2;
  }

  for (let index = 0; index < slopes.length; index += 1) {
    const slope = slopes[index];
    if (Math.abs(slope) <= EPSILON) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
      continue;
    }

    const a = tangents[index] / slope;
    const b = tangents[index + 1] / slope;
    const magnitude = Math.hypot(a, b);
    if (magnitude > 3) {
      const factor = 3 / magnitude;
      tangents[index] = factor * a * slope;
      tangents[index + 1] = factor * b * slope;
    }
  }

  let path = `M ${xs[0]} ${ys[0]}`;
  for (let index = 0; index < count - 1; index += 1) {
    const x0 = xs[index];
    const x1 = xs[index + 1];
    const y0 = ys[index];
    const y1 = ys[index + 1];
    const dx = x1 - x0;

    const c1x = x0 + dx / 3;
    const c1y = y0 + (tangents[index] * dx) / 3;
    const c2x = x1 - dx / 3;
    const c2y = y1 - (tangents[index + 1] * dx) / 3;

    path += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x1} ${y1}`;
  }

  return path;
}

function buildPath(points: PlotPoint[]): string {
  return buildMonotoneCurvePath(points.map((point) => ({ x: point.x, y: point.y })));
}

function buildTrendPath(points: PlotPoint[], values: number[], axisMax: number, range: number, innerHeight: number): string {
  if (points.length === 0 || values.length !== points.length) return '';
  const mapped = points.map((point, index) => ({
    x: point.x,
    y: PADDING_TOP + ((axisMax - values[index]) / range) * innerHeight,
  }));
  return buildMonotoneCurvePath(mapped);
}

function buildLinearTrendPath(points: PlotPoint[], values: number[], axisMax: number, range: number, innerHeight: number): string {
  if (points.length === 0 || values.length !== points.length) return '';
  const first = points[0];
  const last = points[points.length - 1];
  const firstY = PADDING_TOP + ((axisMax - values[0]) / range) * innerHeight;
  const lastY = PADDING_TOP + ((axisMax - values[values.length - 1]) / range) * innerHeight;
  return `M ${first.x} ${firstY} L ${last.x} ${lastY}`;
}

function timeframeLabel(value: TimeframeOption): string {
  return TIMEFRAME_OPTIONS.find((option) => option.value === value)?.label ?? 'Last 24 months';
}

function getAdaptiveAverageWindow(timeframe: TimeframeOption | number): number {
  if (timeframe === 'all') return 12;
  if (timeframe <= 6) return 3;
  if (timeframe <= 24) return 6;
  return 12;
}

function chooseRoundingBase(maxAbs: number): number {
  if (maxAbs >= 50000) return 5000;
  return 1000;
}

function buildSymmetricNetAxis(maxAbsRaw: number): AxisConfig {
  const base = chooseRoundingBase(maxAbsRaw);
  const roundedMaxAbs = Math.max(base * 2, Math.ceil(maxAbsRaw / (base * 2)) * (base * 2));
  const half = roundedMaxAbs / 2;

  return {
    min: -roundedMaxAbs,
    max: roundedMaxAbs,
    ticks: [-roundedMaxAbs, -half, 0, half, roundedMaxAbs],
  };
}

function buildPositiveAxis(maxRaw: number): AxisConfig {
  const base = maxRaw >= 50000 ? 5000 : 1000;
  const roundedMax = Math.max(base * 4, Math.ceil(maxRaw / (base * 4)) * (base * 4));
  const quarter = roundedMax / 4;

  return {
    min: 0,
    max: roundedMax,
    ticks: [0, quarter, quarter * 2, quarter * 3, roundedMax],
  };
}

function formatCurrencyTick(value: number): string {
  if (Math.abs(value) < 0.5) return '$0';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1000) {
    return `${sign}$${Math.round(abs / 1000)}k`;
  }
  return `${sign}$${Math.round(abs).toLocaleString()}`;
}

function formatCurrencyValue(value: number): string {
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

type XAxisCadence = 'monthly' | 'quarterly' | 'semiannual' | 'yearly';

const X_AXIS_CADENCE_ORDER: XAxisCadence[] = ['monthly', 'quarterly', 'semiannual', 'yearly'];

function parseYearMonth(month: string): { year: number; month: number } | null {
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number.parseInt(match[1], 10);
  const monthNumber = Number.parseInt(match[2], 10);
  if (!Number.isFinite(year) || !Number.isFinite(monthNumber) || monthNumber < 1 || monthNumber > 12) return null;
  return { year, month: monthNumber };
}

function formatShortMonthLabel(month: string): string {
  const parsed = parseYearMonth(month);
  if (!parsed) return month;
  const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const yy = String(parsed.year).slice(-2);
  return `${shortMonths[parsed.month - 1]} ’${yy}`;
}

function buildYearlyJanuaryIndices(points: PlotPoint[]): number[] {
  const indices = new Set<number>();
  if (points.length === 0) return [];
  indices.add(0);
  points.forEach((point, index) => {
    const parsed = parseYearMonth(point.month);
    if (parsed?.month === 1) {
      indices.add(index);
    }
  });
  indices.add(points.length - 1);
  return [...indices].sort((a, b) => a - b);
}

function stepForCadence(cadence: Exclude<XAxisCadence, 'yearly'>): number {
  if (cadence === 'monthly') return 1;
  if (cadence === 'quarterly') return 3;
  return 6;
}

function preferredCadenceByMonthCount(monthCount: number): XAxisCadence {
  if (monthCount <= 6) return 'monthly';
  if (monthCount <= 18) return 'quarterly';
  if (monthCount <= 36) return 'semiannual';
  return 'yearly';
}

function fallbackCadences(preferred: XAxisCadence): XAxisCadence[] {
  const startIndex = X_AXIS_CADENCE_ORDER.indexOf(preferred);
  return X_AXIS_CADENCE_ORDER.slice(startIndex >= 0 ? startIndex : 0);
}

function buildTickIndicesForCadence(points: PlotPoint[], cadence: XAxisCadence): number[] {
  if (points.length === 0) return [];
  if (points.length === 1) return [0];

  if (cadence === 'yearly') {
    return buildYearlyJanuaryIndices(points);
  }

  const indices = new Set<number>();
  indices.add(0);
  const step = stepForCadence(cadence);
  for (let index = 0; index < points.length; index += step) {
    indices.add(index);
  }
  indices.add(points.length - 1);
  return [...indices].sort((a, b) => a - b);
}

function hasOverlaps(indices: number[], points: PlotPoint[], minGap: number): boolean {
  for (let index = 1; index < indices.length; index += 1) {
    const left = points[indices[index - 1]];
    const right = points[indices[index]];
    if (!left || !right) continue;
    if (right.x - left.x < minGap) return true;
  }
  return false;
}

function reduceOverlaps(indices: number[], points: PlotPoint[], minGap: number): number[] {
  if (indices.length <= 2) return indices;
  const reduced = [...indices];

  let changed = true;
  while (changed) {
    changed = false;
    for (let idx = 1; idx < reduced.length; idx += 1) {
      const leftIndex = reduced[idx - 1];
      const rightIndex = reduced[idx];
      const leftPoint = points[leftIndex];
      const rightPoint = points[rightIndex];
      if (!leftPoint || !rightPoint) continue;

      if (rightPoint.x - leftPoint.x >= minGap) continue;

      const leftProtected = leftIndex === 0;
      const rightProtected = rightIndex === points.length - 1;

      if (!rightProtected) {
        reduced.splice(idx, 1);
        changed = true;
        break;
      }

      if (!leftProtected) {
        reduced.splice(idx - 1, 1);
        changed = true;
        break;
      }
    }
  }

  return reduced;
}

function buildAdaptiveXAxisTickIndices(points: PlotPoint[], width: number): number[] {
  if (points.length === 0) return [];
  if (points.length === 1) return [0];

  const preferredCadence = preferredCadenceByMonthCount(points.length);
  const minGap = width < 560 ? 86 : width < 660 ? 78 : 70;

  for (const cadence of fallbackCadences(preferredCadence)) {
    const candidate = buildTickIndicesForCadence(points, cadence);
    if (!hasOverlaps(candidate, points, minGap)) {
      return candidate;
    }
  }

  const yearly = buildTickIndicesForCadence(points, 'yearly');
  const reduced = reduceOverlaps(yearly, points, minGap);
  return reduced.length > 0 ? reduced : [0, points.length - 1];
}

function tooltipBoxX(anchorX: number): number {
  const width = 196;
  const preferred = anchorX + 12;
  return Math.max(PADDING_X + 6, Math.min(preferred, WIDTH - width - 8));
}

function tooltipBoxY(anchorY: number, lineCount: number): number {
  const height = 16 + lineCount * 14;
  const preferred = anchorY - height - 10;
  return Math.max(PADDING_TOP + 6, Math.min(preferred, HEIGHT - PADDING_BOTTOM - height - 4));
}

function gradientIdFor(title: string, metric: TrendMetric): string {
  return `trend-fill-${metric}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

export default function TrendLineChart({
  data,
  metric,
  title,
  enableTimeframeControl = false,
  showCashFlowToggle = false,
  cashFlowMode,
  onCashFlowModeChange,
  onMonthPointClick,
}: TrendLineChartProps) {
  const [timeframe, setTimeframe] = useState<TimeframeOption>(24);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const cashFlowTooltipId = useId();

  const showNetEnhancements = enableTimeframeControl && metric === 'net';
  const showCashFlowControl =
    showCashFlowToggle &&
    metric === 'net' &&
    typeof onCashFlowModeChange === 'function' &&
    (cashFlowMode === 'operating' || cashFlowMode === 'total');

  useEffect(() => {
    if (!menuOpen) return undefined;

    function handleDocumentClick(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', handleDocumentClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleDocumentClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [menuOpen]);

  const scopedData = useMemo(() => {
    if (!enableTimeframeControl) return data;
    if (timeframe === 'all') return data;
    return data.slice(-timeframe);
  }, [data, enableTimeframeControl, timeframe]);

  const innerWidth = WIDTH - PADDING_X * 2;
  const innerHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM;

  const {
    points,
    linePath,
    areaPath,
    trendPath,
    trendValues,
    trendMode,
    trendWindow,
    trendSlopePerMonth,
    axisMin,
    axisMax,
    yTicks,
    xTickIndices,
  } = useMemo(() => {
    if (scopedData.length === 0) {
      return {
        points: [],
        linePath: '',
        areaPath: '',
        trendPath: '',
        trendValues: [] as number[],
        trendMode: 'ma' as const,
        trendWindow: null as number | null,
        trendSlopePerMonth: null as number | null,
        axisMin: 0,
        axisMax: 0,
        yTicks: [0],
        xTickIndices: [] as number[],
      };
    }

    const values = scopedData.map((item) => {
      const numeric = Number(item[metric]);
      return Number.isFinite(numeric) ? numeric : 0;
    });

    const minRaw = Math.min(...values, 0);
    const maxRaw = Math.max(...values, 0);
    const axis = metric === 'net' ? buildSymmetricNetAxis(Math.max(Math.abs(minRaw), Math.abs(maxRaw))) : buildPositiveAxis(maxRaw);
    const range = Math.max(axis.max - axis.min, 1);

    const step = scopedData.length > 1 ? innerWidth / (scopedData.length - 1) : 0;
    const computedPoints = scopedData.map((item, index) => {
      const value = values[index];
      const x = PADDING_X + index * step;
      const y = PADDING_TOP + ((axis.max - value) / range) * innerHeight;
      return {
        x,
        y,
        value,
        label: toMonthLabel(item.month),
        axisLabel: formatShortMonthLabel(item.month),
        month: item.month,
      };
    });

    const line = buildPath(computedPoints);
    const zeroY = PADDING_TOP + ((axis.max - 0) / range) * innerHeight;
    const area =
      computedPoints.length > 0
        ? `${line} L ${computedPoints[computedPoints.length - 1].x} ${zeroY} L ${computedPoints[0].x} ${zeroY} Z`
        : '';

    const averageScope: TimeframeOption | number = enableTimeframeControl ? timeframe : scopedData.length;
    const averageWindow = getAdaptiveAverageWindow(averageScope);
    const isNetMetric = metric === 'net';

    let computedTrendValues: number[] = [];
    let computedTrendMode: 'ma' | 'linear' = 'ma';
    let computedTrendWindow: number | null = null;
    let computedTrendSlope: number | null = null;

    if (isNetMetric) {
      const linear = computeLinearTrendLine(values);
      computedTrendValues = linear.values;
      computedTrendMode = 'linear';
      computedTrendSlope = linear.slopePerMonth;
    } else {
      computedTrendValues = computeProgressiveMovingAverage(values, averageWindow);
      computedTrendMode = 'ma';
      computedTrendWindow = averageWindow;
    }

    const computedTrendPath = isNetMetric
      ? buildLinearTrendPath(computedPoints, computedTrendValues, axis.max, range, innerHeight)
      : buildTrendPath(computedPoints, computedTrendValues, axis.max, range, innerHeight);

    return {
      points: computedPoints,
      linePath: line,
      areaPath: area,
      trendPath: computedTrendPath,
      trendValues: computedTrendValues,
      trendMode: computedTrendMode,
      trendWindow: computedTrendWindow,
      trendSlopePerMonth: computedTrendSlope,
      axisMin: axis.min,
      axisMax: axis.max,
      yTicks: axis.ticks,
      xTickIndices: buildAdaptiveXAxisTickIndices(computedPoints, innerWidth),
    };
  }, [scopedData, metric, innerHeight, innerWidth, enableTimeframeControl, timeframe]);

  useEffect(() => {
    if (points.length === 0) {
      setActiveIndex(null);
      return;
    }

    if (activeIndex !== null && (activeIndex < 0 || activeIndex >= points.length)) {
      setActiveIndex(null);
    }
  }, [activeIndex, points.length]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    console.info('[Trendline Sanity Check]', {
      metric,
      timeframe,
      mode: trendMode,
      trendWindow,
      slopePerMonth: trendSlopePerMonth,
      visibleMonths: points.length,
      trendLength: trendValues.length,
      firstExists: trendValues.length > 0 ? Number.isFinite(trendValues[0]) : false,
      lastExists: trendValues.length > 0 ? Number.isFinite(trendValues[trendValues.length - 1]) : false,
    });
  }, [metric, timeframe, trendMode, trendWindow, trendSlopePerMonth, points.length, trendValues]);

  if (scopedData.length === 0) {
    return (
      <article className="card chart-card">
        <div className="card-head">
          <h3>{title}</h3>
        </div>
        <p className="empty-state">No trend data available yet.</p>
      </article>
    );
  }

  const rangeLabel = `${toMonthLabel(scopedData[0].month)} – ${toMonthLabel(scopedData[scopedData.length - 1].month)}`;
  const activePointIndex =
    activeIndex !== null && activeIndex >= 0 && activeIndex < points.length ? activeIndex : null;
  const activePoint = activePointIndex !== null ? points[activePointIndex] ?? null : null;
  const hasTrend = trendValues.length === points.length && trendValues.length > 0;
  const trendNoteLabel =
    trendMode === 'linear' ? null : `Trend: ${trendWindow ?? getAdaptiveAverageWindow(scopedData.length)}-mo avg`;

  const gradientId = gradientIdFor(title, metric);

  return (
    <article className="card chart-card">
      <div className="card-head chart-head">
        <h3>{title}</h3>
        <div className="chart-head-right">
          {(enableTimeframeControl || showCashFlowControl) && (
            <div className="chart-control-row">
              {showCashFlowControl && (
                <div className="chart-cashflow-toggle-wrap" role="group" aria-label="Cash Flow mode selector">
                  <span className="cashflow-label">Cash Flow:</span>
                  <div className="cashflow-toggle">
                    <button
                      type="button"
                      className={cashFlowMode === 'total' ? 'is-active' : ''}
                      onClick={() => onCashFlowModeChange?.('total')}
                    >
                      Total
                    </button>
                    <button
                      type="button"
                      className={cashFlowMode === 'operating' ? 'is-active' : ''}
                      onClick={() => onCashFlowModeChange?.('operating')}
                    >
                      Operating
                    </button>
                  </div>
                  <div className="cashflow-help">
                    <button
                      type="button"
                      className="cashflow-tooltip"
                      aria-label="Cash flow mode help"
                      aria-describedby={cashFlowTooltipId}
                    >
                      ⓘ
                    </button>
                    <div id={cashFlowTooltipId} role="tooltip" className="cashflow-tooltip-panel">
                      <ul className="cashflow-tooltip-list">
                        <li>
                          <strong>Operating</strong> excludes capital distribution
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}
              <div className="timeframe-menu" ref={menuRef}>
                <button
                  type="button"
                  className="timeframe-trigger"
                  onClick={() => setMenuOpen((current) => !current)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                >
                  {timeframeLabel(timeframe)} ▾
                </button>
                {menuOpen && (
                  <ul className="timeframe-list" role="menu" aria-label="Select timeframe">
                    {TIMEFRAME_OPTIONS.map((option) => (
                      <li key={option.label}>
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={timeframe === option.value}
                          className={timeframe === option.value ? 'is-active' : ''}
                          onClick={() => {
                            setTimeframe(option.value);
                            setMenuOpen(false);
                          }}
                        >
                          {option.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
          <p className="subtle">{rangeLabel}</p>
          {hasTrend && trendNoteLabel && <p className="subtle trend-note">{trendNoteLabel}</p>}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="trend-svg"
        role="img"
        aria-label={title}
        onMouseLeave={() => setActiveIndex(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(93, 132, 247, 0.18)" />
            <stop offset="100%" stopColor="rgba(93, 132, 247, 0.02)" />
          </linearGradient>
        </defs>

        <line x1={PADDING_X} x2={WIDTH - PADDING_X} y1={PADDING_TOP + innerHeight} y2={PADDING_TOP + innerHeight} className="axis-line" />
        <line x1={PADDING_X} x2={PADDING_X} y1={PADDING_TOP} y2={PADDING_TOP + innerHeight} className="axis-line" />

        {yTicks.map((tick) => {
          const y = PADDING_TOP + ((axisMax - tick) / Math.max(axisMax - axisMin, 1)) * innerHeight;
          const lineClass = Math.abs(tick) < 0.5 ? 'axis-zero' : 'axis-grid';
          return <line key={`grid-${tick}`} x1={PADDING_X} x2={WIDTH - PADDING_X} y1={y} y2={y} className={lineClass} />;
        })}

        <path d={areaPath} fill={`url(#${gradientId})`} />

        {hasTrend && <path d={trendPath} className="ma-path" />}
        <path d={linePath} className="trend-path" />

        {points.map((point, index) => {
          const isLatest = index === points.length - 1;
          return (
            <g key={`${point.month}-${index}`}>
              {isLatest && <circle cx={point.x} cy={point.y} r={7.2} className="trend-dot-latest-ring" />}
              <circle
                cx={point.x}
                cy={point.y}
                r={isLatest ? 5.1 : 3.8}
                className={isLatest ? 'trend-dot-latest' : 'trend-dot'}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => onMonthPointClick?.(point.month)}
                style={onMonthPointClick ? { cursor: 'pointer' } : undefined}
              />
            </g>
          );
        })}

        {points.map((point, index) => {
          const leftEdge = index === 0 ? PADDING_X : (points[index - 1].x + point.x) / 2;
          const rightEdge = index === points.length - 1 ? WIDTH - PADDING_X : (point.x + points[index + 1].x) / 2;
          return (
            <rect
              key={`hover-zone-${point.month}-${index}`}
              x={leftEdge}
              y={PADDING_TOP}
              width={Math.max(rightEdge - leftEdge, 1)}
              height={innerHeight}
              fill="transparent"
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => onMonthPointClick?.(point.month)}
              style={onMonthPointClick ? { cursor: 'pointer' } : undefined}
            />
          );
        })}

        {xTickIndices.map((index) => {
          const point = points[index];
          if (!point) return null;
          return (
            <text key={`${point.label}-${index}`} x={point.x} y={HEIGHT - 10} textAnchor="middle" className="axis-label">
              {point.axisLabel}
            </text>
          );
        })}

        {yTicks.map((tick) => {
          const y = PADDING_TOP + ((axisMax - tick) / Math.max(axisMax - axisMin, 1)) * innerHeight;
          return (
            <text key={tick} x={PADDING_X - 12} y={y + 4} textAnchor="end" className="axis-label">
              {formatCurrencyTick(tick)}
            </text>
          );
        })}

        {activePoint && (
          <g className="chart-tooltip" pointerEvents="none">
            <rect
              x={tooltipBoxX(activePoint.x)}
              y={tooltipBoxY(activePoint.y, showNetEnhancements ? 3 : 2)}
              width={192}
              height={showNetEnhancements ? 58 : 44}
              rx={10}
              ry={10}
              className="tooltip-box"
            />
            <text x={tooltipBoxX(activePoint.x) + 10} y={tooltipBoxY(activePoint.y, showNetEnhancements ? 3 : 2) + 14} className="tooltip-title">
              {toMonthLabel(activePoint.month)}
            </text>
            <text x={tooltipBoxX(activePoint.x) + 10} y={tooltipBoxY(activePoint.y, showNetEnhancements ? 3 : 2) + 28} className="tooltip-line">
              {`Net cash flow: ${formatCurrencyValue(activePoint.value)}`}
            </text>
            {showNetEnhancements && (
              <text x={tooltipBoxX(activePoint.x) + 10} y={tooltipBoxY(activePoint.y, 3) + 42} className="tooltip-hint">
                Click the chart to view details
              </text>
            )}
          </g>
        )}
      </svg>
    </article>
  );
}
