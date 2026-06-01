// Side-panel drawer opened from Today → Owner Distributions "Compare year"
// dropdown. Renders ProjectionTableV2 in comparison mode for a single past
// year, with a segmented year toggle in the header.
//
// Shell chrome (backdrop, Escape, dialog ARIA) comes from <DrawerShell>; this
// file keeps the `pcd-drawer-*` CSS prefix and owns the header + body content.
import ProjectionTableV2 from './ProjectionTableV2';
import type { ScenarioPoint } from '../lib/data/contract';
import type { PriorYearActualsResult } from '../lib/kpis/priorYearActuals';
import { DrawerShell } from './DrawerShell';

interface Props {
  compareYear: number;
  availableYears: number[];
  onCompareYearChange: (year: number) => void;
  onClose: () => void;
  visibleScenarioProjection: ScenarioPoint[];
  priorYearActuals: PriorYearActualsResult;
  currentForecastYear: number;
  hasCurrentCashBalance: boolean;
  formatCurrency: (value: number) => string;
  toMonthLabel: (month: string) => string;
}

export function ProjectionCompareDrawer({
  compareYear,
  availableYears,
  onCompareYearChange,
  onClose,
  visibleScenarioProjection,
  priorYearActuals,
  currentForecastYear,
  hasCurrentCashBalance,
  formatCurrency,
  toMonthLabel,
}: Props) {
  return (
    <DrawerShell
      classPrefix="pcd-drawer"
      ariaLabel={`Compare ${currentForecastYear} to ${compareYear}`}
      onClose={onClose}
    >
        <div className="pcd-drawer-header">
          <button className="pcd-drawer-close" onClick={onClose} aria-label="Close">×</button>
          <h2 className="pcd-drawer-title">Compare {currentForecastYear} to {compareYear}</h2>
          <div className="segmented-toggle pcd-drawer-toggle" role="group" aria-label="Compare year">
            {availableYears.map((year) => {
              const isActive = year === compareYear;
              return (
                <button
                  key={year}
                  type="button"
                  aria-pressed={isActive}
                  className={`segmented-toggle-btn${isActive ? ' is-active' : ''}`}
                  onClick={() => onCompareYearChange(year)}
                >
                  {year}
                </button>
              );
            })}
          </div>
        </div>

        <div className="pcd-drawer-body">
          <ProjectionTableV2
            visibleScenarioProjection={visibleScenarioProjection}
            priorYearActuals={priorYearActuals}
            projectionActiveYears={[compareYear]}
            currentForecastYear={currentForecastYear}
            hasCurrentCashBalance={hasCurrentCashBalance}
            formatCurrency={formatCurrency}
            toMonthLabel={toMonthLabel}
          />
        </div>
    </DrawerShell>
  );
}
