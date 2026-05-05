/**
 * UI Lab — Forecast Chart Curve Lab.
 *
 * Side-by-side visual comparison of ApexCharts curve modes against two
 * data shapes:
 *  1. TailAdmin "Active Users" reference data (continuous variance, 180–186)
 *     rendered with curve: 'smooth'.
 *  2–4. Wx-style synthetic data (flat baseline + isolated event spike)
 *       rendered with curve: 'smooth', 'straight', and 'stepline'.
 *
 * Goal: confirm whether the smoothing distortion seen on production
 * Forecast around isolated event spikes is curve-driven or data-shape-driven.
 *
 * Pure visual research. No production chart code is imported or modified.
 * Chart configs here are deliberately simpler than production (no
 * annotations, niceTicks, or event overlay) — calibrated to expose the
 * curve-vs-data-shape question.
 */

import ReactApexChart from 'react-apexcharts';
import type { ApexOptions } from 'apexcharts';

const TAIL_ADMIN_CATEGORIES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const TAIL_ADMIN_SERIES = [180, 181, 182, 184, 183, 182, 181, 182, 183, 185, 186, 183];

// Wx-style: flat ~$20K baseline, single +$10K event spike at month 6, flat continuation.
const WX_CATEGORIES = ['M1','M2','M3','M4','M5','M6','M7','M8','M9','M10','M11','M12'];
const WX_SERIES = [20000, 20100, 20200, 20300, 20400, 30500, 20600, 20700, 20800, 20900, 21000, 21100];

const CHART_HEIGHT = 200;

function baseOptions(
  categories: string[],
  curve: 'smooth' | 'straight' | 'stepline',
): ApexOptions {
  return {
    chart: {
      type: 'area',
      height: CHART_HEIGHT,
      fontFamily: 'Outfit, sans-serif',
      toolbar: { show: false },
    },
    colors: ['#465FFF'],
    stroke: { curve, width: 2 },
    markers: { size: 0 },
    fill: {
      type: 'gradient',
      gradient: { opacityFrom: 0.55, opacityTo: 0 },
    },
    legend: { show: false },
    dataLabels: { enabled: false },
    grid: {
      xaxis: { lines: { show: false } },
      yaxis: { lines: { show: false } },
    },
    xaxis: {
      type: 'category',
      categories,
      axisBorder: { show: false },
      axisTicks: { show: false },
      labels: { show: false },
      tooltip: { enabled: false },
    },
    yaxis: { labels: { show: false } },
    tooltip: { x: { format: 'dd MMM yyyy' } },
  };
}

type CellProps = {
  series: { name: string; data: number[] }[];
  options: ApexOptions;
  caption: string;
};

function CurveLabCell({ series, options, caption }: CellProps) {
  return (
    <div>
      <ReactApexChart options={options} series={series} type="area" height={CHART_HEIGHT} />
      <p className="ui-lab-section-subtitle" style={{ marginTop: 8 }}>{caption}</p>
    </div>
  );
}

export default function CurveLabCharts() {
  const tailAdminOptions = baseOptions(TAIL_ADMIN_CATEGORIES, 'smooth');
  const wxSmoothOptions = baseOptions(WX_CATEGORIES, 'smooth');
  const wxStraightOptions = baseOptions(WX_CATEGORIES, 'straight');
  const wxSteplineOptions = baseOptions(WX_CATEGORIES, 'stepline');

  return (
    <>
      <CurveLabCell
        series={[{ name: 'Active Users', data: TAIL_ADMIN_SERIES }]}
        options={tailAdminOptions}
        caption="TailAdmin reference. Smooth curve on naturally varied data. Range 180–186."
      />
      <CurveLabCell
        series={[{ name: 'Cash Balance', data: WX_SERIES }]}
        options={wxSmoothOptions}
        caption="Wx-style data (flat baseline + event spike). Smooth curve. Note distortion around the spike."
      />
      <CurveLabCell
        series={[{ name: 'Cash Balance', data: WX_SERIES }]}
        options={wxStraightOptions}
        caption="Same data, straight line. Spike is sharp, no smoothing distortion. Trades aesthetic softness for honesty."
      />
      <CurveLabCell
        series={[{ name: 'Cash Balance', data: WX_SERIES }]}
        options={wxSteplineOptions}
        caption="Same data, stepline. Each bucket is flat; transitions are vertical. Reads like a cash ledger."
      />
    </>
  );
}
