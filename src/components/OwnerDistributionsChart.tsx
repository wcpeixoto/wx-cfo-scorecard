import { useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import type { Txn } from '../lib/data/contract';
import { classifyTxn } from '../lib/cashFlow';

function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${Math.round(value)}`;
}

type OwnerDistSeries = {
  years: number[];
  actual: number[];
  annualized: number[];
  annualizedFullYear: number;
};

function buildOwnerDistSeries(transactions: Txn[], today: Date): OwnerDistSeries {
  const ownerDist = transactions.filter((t) => classifyTxn(t) === 'owner-distribution');

  const currentYear = today.getFullYear();
  const nextYear = currentYear + 1;

  const byYear = new Map<number, number>();
  for (const t of ownerDist) {
    const year = new Date(t.date).getFullYear();
    byYear.set(year, (byYear.get(year) ?? 0) + Math.abs(t.amount));
  }

  const yearSet = new Set<number>([...byYear.keys(), currentYear, nextYear]);
  const years = [...yearSet].sort((a, b) => a - b);

  const elapsedMonths = Math.max(1, today.getMonth() + 1);
  const currentYearActual = byYear.get(currentYear) ?? 0;
  const annualizedFullYear =
    currentYearActual > 0 ? (currentYearActual / elapsedMonths) * 12 : 0;

  const actual: number[] = [];
  const annualized: number[] = [];

  for (const year of years) {
    if (year < currentYear) {
      actual.push(byYear.get(year) ?? 0);
      annualized.push(0);
    } else if (year === currentYear) {
      const annualizedRemainder =
        currentYearActual > 0 ? Math.max(0, annualizedFullYear - currentYearActual) : 0;
      actual.push(currentYearActual);
      annualized.push(annualizedRemainder);
    } else {
      actual.push(0);
      annualized.push(annualizedFullYear);
    }
  }

  return { years, actual, annualized, annualizedFullYear };
}

type PillVariant = 'insufficient' | 'above-avg' | 'below-avg' | 'on-track';
type PillConfig = { label: string; variant: PillVariant };

function computeSignalPill(
  years: number[],
  actual: number[],
  annualizedFullYear: number,
  currentYear: number
): PillConfig {
  const completeIndexes = years.reduce<number[]>((acc, y, i) => {
    if (y < currentYear && actual[i] > 0) acc.push(i);
    return acc;
  }, []);

  if (completeIndexes.length < 2) {
    return { label: 'Insufficient history', variant: 'insufficient' };
  }

  const priorAvg =
    completeIndexes.reduce((sum, i) => sum + actual[i], 0) / completeIndexes.length;

  const ratio = priorAvg > 0 ? annualizedFullYear / priorAvg : 0;

  if (ratio > 1.1) return { label: '↑ Above avg', variant: 'above-avg' };
  if (ratio < 0.9) return { label: '↓ Below avg', variant: 'below-avg' };
  return { label: '~ On track', variant: 'on-track' };
}

function ownerDistBadgeClass(variant: PillVariant): string {
  switch (variant) {
    case 'above-avg': return 'is-critical';
    case 'below-avg': return 'is-warning';   // amber — below avg is a mixed signal, not a positive
    case 'on-track': return 'is-neutral';
    case 'insufficient': return 'is-neutral';
  }
}

type DistributionStatus = 'below_target' | 'on_target' | 'above_target';

type Props = {
  transactions: Txn[];
  today?: Date;
  distributionStatus?: DistributionStatus;
  distributionTargetAmount?: number;
  distributionActualAmount?: number;
  targetNetMargin?: number;
};

const TARGET_BADGE_CONFIG: Record<DistributionStatus, { label: string; className: string }> = {
  below_target: { label: '↓ Below target', className: 'card-status-badge is-warning' },
  on_target:    { label: '✓ On target',    className: 'card-status-badge is-healthy' },
  above_target: { label: '↑ Above target', className: 'card-status-badge is-critical' },
};

function getTargetBadgeLabel(
  status: DistributionStatus,
  actualAmount?: number,
  targetAmount?: number
): string {
  if (actualAmount != null && targetAmount != null && targetAmount > 0) {
    const pct = Math.round((actualAmount / targetAmount) * 100);
    if (isFinite(pct) && !isNaN(pct)) {
      if (status === 'below_target') return `↓ ${pct}% of target`;
      if (status === 'above_target') return `↑ ${pct}% of target`;
    }
  }
  return TARGET_BADGE_CONFIG[status].label;
}

export default function OwnerDistributionsChart({ transactions, today = new Date(), distributionStatus, distributionTargetAmount, distributionActualAmount, targetNetMargin }: Props) {
  const { years, actual, annualized, annualizedFullYear } = buildOwnerDistSeries(
    transactions,
    today
  );

  const currentYear = today.getFullYear();
  const pill = computeSignalPill(years, actual, annualizedFullYear, currentYear);

  const navigate = useNavigate();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Historical years only: year < currentYear with actual data, sorted descending
  const actualYears = years
    .filter((y, i) => y < currentYear && actual[i] > 0)
    .sort((a, b) => b - a);

  // Close dropdown on outside click
  useEffect(() => {
    if (!isDropdownOpen) return;
    function handleOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [isDropdownOpen]);

  function handleYearSelect(year: number) {
    setIsDropdownOpen(false);
    navigate({ pathname: '/forecast', search: `?compareYear=${year}` });
  }

  const options: ApexOptions = {
    chart: {
      type: 'bar',
      stacked: true,
      toolbar: { show: false },
      fontFamily: 'Outfit, sans-serif',
      background: 'transparent',
    },
    colors: ['#465FFF', '#9CB9FF'],
    plotOptions: {
      bar: {
        horizontal: false,
        columnWidth: '39%',
        borderRadius: 5,
        borderRadiusApplication: 'end',
        borderRadiusWhenStacked: 'last',
      },
    },
    dataLabels: { enabled: false },
    stroke: {
      show: true,
      width: 2,
      colors: ['transparent'],
    },
    xaxis: {
      categories: years.map(String),
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: { style: { fontSize: '12px', colors: '#667085' } },
    },
    yaxis: {
      labels: {
        formatter: (val: number) => '$' + (val / 1000).toFixed(0) + 'k',
        style: { fontSize: '12px', colors: '#667085' },
      },
    },
    grid: {
      borderColor: '#EAECF0',
      strokeDashArray: 4,
      yaxis: { lines: { show: true } },
      xaxis: { lines: { show: false } },
    },
    legend: {
      show: false,
    },
    tooltip: {
      theme: 'light',
      y: {
        formatter: (val: number) => formatCompact(val),
      },
    },
  };

  const series = [
    { name: 'Actual', data: actual },
    { name: 'Forecast', data: annualized },
  ];

  return (
    <article className="owner-dist-card">
      <div className="owner-dist-header">
        <div className="owner-dist-header-left">
          <h3 className="owner-dist-title">Owner Distributions</h3>
          {targetNetMargin && targetNetMargin > 0 && distributionTargetAmount && distributionTargetAmount > 0 && (
            <p className="owner-dist-subtitle">
              Target distribution for {today.getFullYear()}: ${Math.round(distributionTargetAmount / 1000)}<span className="forecast-unit">K</span>{' '}({Math.round(targetNetMargin * 100)}% net profit)
            </p>
          )}
        </div>
        {distributionStatus
          ? <span className={TARGET_BADGE_CONFIG[distributionStatus].className}>{getTargetBadgeLabel(distributionStatus, distributionActualAmount, distributionTargetAmount)}</span>
          : <span className={`card-status-badge ${ownerDistBadgeClass(pill.variant)}`}>{pill.label}</span>
        }
      </div>
      <div>
        <div className="owner-dist-legend-row">
          <span className="owner-dist-legend-item">
            <span className="owner-dist-legend-dot actual"></span>
            Actual
          </span>
          <span className="owner-dist-legend-item">
            <span className="owner-dist-legend-dot forecast"></span>
            Forecast
          </span>
        </div>
        <div className="owner-dist-chart">
          <Chart options={options} series={series} type="bar" height={229} />
        </div>
      </div>
      {actualYears.length > 0 && (
        <div className="owner-dist-footer">
          <div className="period-dropdown" ref={dropdownRef}>
            <button
              className="owner-dist-forecast-action"
              onClick={() => setIsDropdownOpen(prev => !prev)}
            >
              Compare {currentYear} to a past year
            </button>
            {isDropdownOpen && (
              <ul className="period-dropdown-menu">
                {actualYears.map(year => (
                  <li key={year}>
                    <button onClick={() => handleYearSelect(year)}>{year}</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
