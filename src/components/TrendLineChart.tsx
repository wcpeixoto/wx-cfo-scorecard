import { useMemo } from 'react';
import { toMonthLabel } from '../lib/kpis/compute';
import type { TrendPoint } from '../lib/data/contract';

type TrendMetric = 'income' | 'expense' | 'net';

type TrendLineChartProps = {
  data: TrendPoint[];
  metric: TrendMetric;
  title: string;
};

type PlotPoint = {
  x: number;
  y: number;
  value: number;
  label: string;
};

type AxisConfig = {
  min: number;
  max: number;
  ticks: number[];
};

const WIDTH = 760;
const HEIGHT = 280;
const PADDING_X = 42;
const PADDING_TOP = 26;
const PADDING_BOTTOM = 36;

function buildPath(points: PlotPoint[]): string {
  if (points.length === 0) return '';
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

function chooseRoundingBase(maxAbs: number): number {
  if (maxAbs >= 50000) return 5000;
  return 1000;
}

function buildAxis(maxAbsRaw: number): AxisConfig {
  const base = chooseRoundingBase(maxAbsRaw);
  const roundedMaxAbs = Math.max(base, Math.ceil(maxAbsRaw / base) * base);

  const targetTickCounts = [7, 6, 5];
  for (const target of targetTickCounts) {
    const approxStep = (roundedMaxAbs * 2) / Math.max(target - 1, 1);
    const step = Math.max(base, Math.ceil(approxStep / base) * base);
    const tickCount = Math.floor((roundedMaxAbs * 2) / step) + 1;
    if (tickCount >= 5 && tickCount <= 7) {
      const ticks: number[] = [];
      for (let value = -roundedMaxAbs; value <= roundedMaxAbs; value += step) {
        ticks.push(value);
      }
      if (ticks[ticks.length - 1] !== roundedMaxAbs) {
        ticks.push(roundedMaxAbs);
      }
      return { min: -roundedMaxAbs, max: roundedMaxAbs, ticks };
    }
  }

  return {
    min: -roundedMaxAbs,
    max: roundedMaxAbs,
    ticks: [-roundedMaxAbs, -roundedMaxAbs / 2, 0, roundedMaxAbs / 2, roundedMaxAbs],
  };
}

function formatCurrencyTick(value: number): string {
  if (Math.abs(value) < 0.5) return '$0';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1000) {
    const compact = abs / 1000;
    const compactText = Number.isInteger(compact) ? String(compact) : compact.toFixed(1);
    return `${sign}$${compactText}k`;
  }
  return `${sign}$${Math.round(abs).toLocaleString()}`;
}

export default function TrendLineChart({ data, metric, title }: TrendLineChartProps) {
  const innerWidth = WIDTH - PADDING_X * 2;
  const innerHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM;

  const { points, linePath, areaPath, axisMin, axisMax, yTicks, zeroY } = useMemo(() => {
    if (data.length === 0) {
      return { points: [], linePath: '', areaPath: '', axisMin: 0, axisMax: 0, yTicks: [0], zeroY: 0 };
    }

    const values = data.map((item) => item[metric]);
    const minRaw = Math.min(...values, 0);
    const maxRaw = Math.max(...values, 0);
    const axis = buildAxis(Math.max(Math.abs(minRaw), Math.abs(maxRaw)));
    const range = Math.max(axis.max - axis.min, 1);

    const computedPoints = data.map((item, index) => {
      const step = data.length > 1 ? innerWidth / (data.length - 1) : 0;
      const x = PADDING_X + index * step;
      const y = PADDING_TOP + ((axis.max - item[metric]) / range) * innerHeight;

      return {
        x,
        y,
        value: item[metric],
        label: toMonthLabel(item.month),
      };
    });

    const line = buildPath(computedPoints);
    const baselineY = PADDING_TOP + ((axis.max - 0) / range) * innerHeight;
    const area =
      computedPoints.length > 0
        ? `${line} L ${computedPoints[computedPoints.length - 1].x} ${baselineY} L ${computedPoints[0].x} ${baselineY} Z`
        : '';

    return {
      points: computedPoints,
      linePath: line,
      areaPath: area,
      axisMin: axis.min,
      axisMax: axis.max,
      yTicks: axis.ticks,
      zeroY: baselineY,
    };
  }, [data, innerHeight, innerWidth, metric]);

  if (data.length === 0) {
    return (
      <article className="card chart-card">
        <div className="card-head">
          <h3>{title}</h3>
        </div>
        <p className="empty-state">No trend data available yet.</p>
      </article>
    );
  }

  const first = points[0];
  const mid = points[Math.floor(points.length / 2)];
  const last = points[points.length - 1];

  return (
    <article className="card chart-card">
      <div className="card-head">
        <h3>{title}</h3>
        <p className="subtle">{toMonthLabel(data[0].month)} to {toMonthLabel(data[data.length - 1].month)}</p>
      </div>

      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="trend-svg" role="img" aria-label={title}>
        <defs>
          <linearGradient id="trendFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(93, 132, 247, 0.28)" />
            <stop offset="100%" stopColor="rgba(93, 132, 247, 0.04)" />
          </linearGradient>
        </defs>

        <line x1={PADDING_X} x2={WIDTH - PADDING_X} y1={PADDING_TOP + innerHeight} y2={PADDING_TOP + innerHeight} className="axis-line" />
        <line x1={PADDING_X} x2={PADDING_X} y1={PADDING_TOP} y2={PADDING_TOP + innerHeight} className="axis-line" />
        <line x1={PADDING_X} x2={WIDTH - PADDING_X} y1={zeroY} y2={zeroY} className="axis-zero" />

        <path d={areaPath} fill="url(#trendFill)" />
        <path d={linePath} className="trend-path" />

        {points.map((point, index) => (
          <circle key={`${point.label}-${index}`} cx={point.x} cy={point.y} r={3.8} className="trend-dot" />
        ))}

        {[first, mid, last].map((point) => (
          <text key={point.label} x={point.x} y={HEIGHT - 10} textAnchor="middle" className="axis-label">
            {point.label}
          </text>
        ))}

        {yTicks.map((tick) => {
          const y = PADDING_TOP + ((axisMax - tick) / Math.max(axisMax - axisMin, 1)) * innerHeight;
          return (
            <text key={tick} x={PADDING_X - 10} y={y + 4} textAnchor="end" className="axis-label">
              {formatCurrencyTick(tick)}
            </text>
          );
        })}
      </svg>
    </article>
  );
}
