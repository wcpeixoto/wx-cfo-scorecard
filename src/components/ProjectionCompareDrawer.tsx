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
          <h2 className="pcd-drawer-title">Compare {currentForecastYear} to past year</h2>
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
