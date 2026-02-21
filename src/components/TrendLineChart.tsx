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

const WIDTH = 760;
const HEIGHT = 280;
const PADDING_X = 42;
const PADDING_TOP = 26;
const PADDING_BOTTOM = 36;

function buildPath(points: PlotPoint[]): string {
  if (points.length === 0) return '';
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

export default function TrendLineChart({ data, metric, title }: TrendLineChartProps) {
  const innerWidth = WIDTH - PADDING_X * 2;
  const innerHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM;

  const { points, linePath, areaPath, minValue, maxValue } = useMemo(() => {
    if (data.length === 0) {
      return { points: [], linePath: '', areaPath: '', minValue: 0, maxValue: 0 };
    }

    const values = data.map((item) => item[metric]);
    const minRaw = Math.min(...values, metric === 'net' ? 0 : values[0]);
    const maxRaw = Math.max(...values, metric === 'net' ? 0 : values[0]);
    const range = Math.max(maxRaw - minRaw, 1);

    const computedPoints = data.map((item, index) => {
      const step = data.length > 1 ? innerWidth / (data.length - 1) : 0;
      const x = PADDING_X + index * step;
      const y = PADDING_TOP + ((maxRaw - item[metric]) / range) * innerHeight;

      return {
        x,
        y,
        value: item[metric],
        label: toMonthLabel(item.month),
      };
    });

    const line = buildPath(computedPoints);
    const baselineY = PADDING_TOP + ((maxRaw - Math.max(minRaw, 0)) / range) * innerHeight;
    const area =
      computedPoints.length > 0
        ? `${line} L ${computedPoints[computedPoints.length - 1].x} ${baselineY} L ${computedPoints[0].x} ${baselineY} Z`
        : '';

    return {
      points: computedPoints,
      linePath: line,
      areaPath: area,
      minValue: minRaw,
      maxValue: maxRaw,
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

        <text x={PADDING_X - 10} y={PADDING_TOP + 12} textAnchor="end" className="axis-label">
          {maxValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </text>
        <text x={PADDING_X - 10} y={PADDING_TOP + innerHeight} textAnchor="end" className="axis-label">
          {minValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </text>
      </svg>
    </article>
  );
}
