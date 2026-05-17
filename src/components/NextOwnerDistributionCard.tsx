import ReactApexChart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';
import { chartTokens } from '../lib/ui/chartTokens';

// Visual mock only — a replica of the UI Lab "Total Balance" card
// (TailAdmin /finance). Hardcoded; no forecast/Settings wiring yet.
// Sparkline fixtures local to this mock — not lifted to a shared lib.
const SPARKLINE_SERIES = [42, 48, 44, 52, 50, 58, 55, 62, 60, 68, 65, 74];

const SPARKLINE_OPTIONS: ApexOptions = {
  chart: {
    type: 'area',
    height: 70,
    fontFamily: 'Outfit, sans-serif',
    sparkline: { enabled: true },
    toolbar: { show: false },
    animations: { enabled: false },
  },
  stroke: { curve: 'smooth', width: 1.5, colors: [chartTokens.brand] },
  fill: {
    type: 'gradient',
    gradient: { shadeIntensity: 1, opacityFrom: 0.45, opacityTo: 0, stops: [0, 100] },
  },
  colors: [chartTokens.brand],
  dataLabels: { enabled: false },
  markers: { size: 0 },
  grid: { show: false },
  xaxis: { labels: { show: false }, axisBorder: { show: false }, axisTicks: { show: false } },
  yaxis: { labels: { show: false } },
  tooltip: { enabled: false },
  legend: { show: false },
};

export default function NextOwnerDistributionCard() {
  return (
    <article className="nod-balance-card">
      <div className="nod-balance-card__header">
        <div className="nod-balance-card__title-block">
          <h3 className="nod-balance-card__title">Total Balance</h3>
          <p className="nod-balance-card__subtitle">Your cash and balance for last 30 days</p>
        </div>
        <div className="nod-balance-card__header-actions">
          <button type="button" className="nod-balance-card__dropdown">
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <circle cx="9" cy="9" r="9" fill="#3C3B6E" />
              <path d="M9 0a9 9 0 0 1 0 18V0Z" fill="#B22234" />
              <path d="M0 9h18" stroke="#FFFFFF" strokeWidth="0.6" />
            </svg>
            USD
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button type="button" className="nod-balance-card__dropdown">
            June 2025
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      <div className="nod-balance-card__amount-row">
        <div className="nod-balance-card__amount-block">
          <h2 className="nod-balance-card__amount">19,857.00</h2>
          <div className="nod-balance-card__trend">
            <span className="nod-balance-card__trend-delta nod-balance-card__trend-delta--up">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M8 13.333V2.667M4 6.663l4-3.996 4 3.996" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              3.2%
            </span>
            <span className="nod-balance-card__trend-text">than last month</span>
          </div>
        </div>
        <div className="nod-balance-card__sparkline-slot" aria-hidden="true">
          <ReactApexChart
            options={SPARKLINE_OPTIONS}
            series={[{ name: 'value', data: SPARKLINE_SERIES }]}
            type="area"
            height={70}
            width="100%"
          />
        </div>
      </div>

      <div className="nod-balance-card__account-row">
        <span className="nod-balance-card__account-label">Primary Account:</span>
        <span className="nod-balance-card__account-number">•••• •••• •••• 5332</span>
        <div className="nod-balance-card__account-actions">
          <button type="button" className="nod-balance-card__icon-btn" aria-label="Copy account number">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.6" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button type="button" className="nod-balance-card__detail-btn">See Details</button>
        </div>
      </div>
    </article>
  );
}
