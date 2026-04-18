import Chart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import type { Txn } from '../lib/data/contract';
import { classifyTxn } from '../lib/cashFlow';

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

type Props = {
  transactions: Txn[];
  today?: Date;
};

export default function OwnerDistributionsChart({ transactions, today = new Date() }: Props) {
  const { years, actual, annualized, annualizedFullYear } = buildOwnerDistSeries(
    transactions,
    today
  );

  const currentYear = today.getFullYear();
  const pill = computeSignalPill(years, actual, annualizedFullYear, currentYear);

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
      show: true,
      position: 'top',
      horizontalAlign: 'left',
      fontFamily: 'Outfit, sans-serif',
    },
    tooltip: {
      y: {
        formatter: (val: number) =>
          '$' + val.toLocaleString('en-US', { maximumFractionDigits: 0 }),
      },
    },
  };

  const series = [
    { name: 'Actual', data: actual },
    { name: 'Annualized', data: annualized },
  ];

  return (
    <article className="owner-dist-card">
      <div className="owner-dist-header">
        <div className="owner-dist-header-left">
          <h3 className="owner-dist-title">Owner Distributions</h3>
          <p className="owner-dist-subtitle">
            What you've taken out of the business each year
          </p>
        </div>
        <span className={`owner-dist-pill is-${pill.variant}`}>{pill.label}</span>
      </div>
      <div className="owner-dist-chart">
        <Chart options={options} series={series} type="bar" height={260} />
      </div>
    </article>
  );
}
