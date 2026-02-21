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
const PADDING_X = 74;
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
    const axis =
      metric === 'net'
        ? buildSymmetricNetAxis(Math.max(Math.abs(minRaw), Math.abs(maxRaw)))
        : buildPositiveAxis(maxRaw);
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
        {yTicks.map((tick) => {
          const y = PADDING_TOP + ((axisMax - tick) / Math.max(axisMax - axisMin, 1)) * innerHeight;
          const lineClass = Math.abs(tick) < 0.5 ? 'axis-zero' : 'axis-grid';
          return <line key={`grid-${tick}`} x1={PADDING_X} x2={WIDTH - PADDING_X} y1={y} y2={y} className={lineClass} />;
        })}

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
            <text key={tick} x={PADDING_X - 12} y={y + 4} textAnchor="end" className="axis-label">
              {formatCurrencyTick(tick)}
            </text>
          );
        })}
      </svg>
    </article>
  );
}
