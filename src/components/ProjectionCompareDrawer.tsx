// Side-panel drawer opened from Today → Owner Distributions "Compare year"
// dropdown. Renders ProjectionTableV2 in comparison mode for a single past
// year, with a segmented year toggle in the header.
//
// Drawer pattern is COPIED from EfficiencyDrilldownDrawer, not extracted into
// a shared primitive. With only two drawers in the codebase, an abstraction
// would lock in the wrong shared surface. When a third drawer appears, do an
// extraction pass as its own PR. CSS prefix `pcd-*` keeps the two drawers
// independent in the meantime.
import { useEffect } from 'react';
import ProjectionTableV2 from './ProjectionTableV2';
import type { ScenarioPoint } from '../lib/data/contract';
import type { PriorYearActualsResult } from '../lib/kpis/priorYearActuals';

interface Props {
  compareYear: number;
  availableYears: number[];
  onCompareYearChange: (year: number) => void;
  onClose: () => void;
  visibleScenarioProjection: ScenarioPoint[];
  priorYearActuals: PriorYearActualsResult;
  currentForecastYear: number;
  hasForecastCurrentCashBalance: boolean;
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
  hasForecastCurrentCashBalance,
  formatCurrency,
  toMonthLabel,
}: Props) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="pcd-drawer-backdrop" onClick={handleBackdropClick}>
      <div
        className="pcd-drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-label={`Compare ${currentForecastYear} to ${compareYear}`}
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
            hasForecastCurrentCashBalance={hasForecastCurrentCashBalance}
            formatCurrency={formatCurrency}
            toMonthLabel={toMonthLabel}
          />
        </div>
      </div>
    </div>
  );
}
