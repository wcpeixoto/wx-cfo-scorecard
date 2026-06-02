import { FiList, FiRefreshCw } from 'react-icons/fi';
import { useSidebar } from '../context/SidebarContext';

type AppHeaderProps = {
  onOpenTransactions: () => void;
  updatedLabel?: string | null;
  onUpdatedClick?: () => void;
};

export function AppHeader({ onOpenTransactions, updatedLabel, onUpdatedClick }: AppHeaderProps) {
  const { toggleMobile, isMobileOpen, toggleCollapsed, isCollapsed } = useSidebar();

  return (
    <header className="app-header">
      {/* Mobile row — hamburger / brand / see-transactions */}
      <div className="app-header-mobile-row">
        <button
          type="button"
          className="app-header-menu"
          aria-label={isMobileOpen ? 'Close navigation' : 'Open navigation'}
          onClick={toggleMobile}
        >
          {isMobileOpen ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path fillRule="evenodd" clipRule="evenodd" d="M6.21967 7.28131C5.92678 6.98841 5.92678 6.51354 6.21967 6.22065C6.51256 5.92775 6.98744 5.92775 7.28033 6.22065L11.999 10.9393L16.7176 6.22078C17.0105 5.92789 17.4854 5.92788 17.7782 6.22078C18.0711 6.51367 18.0711 6.98855 17.7782 7.28144L13.0597 12L17.7782 16.7186C18.0711 17.0115 18.0711 17.4863 17.7782 17.7792C17.4854 18.0721 17.0105 18.0721 16.7176 17.7792L11.999 13.0607L7.28033 17.7794C6.98744 18.0722 6.51256 18.0722 6.21967 17.7794C5.92678 17.4865 5.92678 17.0116 6.21967 16.7187L10.9384 12L6.21967 7.28131Z" fill="currentColor" />
            </svg>
          ) : (
            <svg width="16" height="12" viewBox="0 0 16 12" fill="none" aria-hidden="true">
              <path fillRule="evenodd" clipRule="evenodd" d="M0.583252 1C0.583252 0.585788 0.919038 0.25 1.33325 0.25H14.6666C15.0808 0.25 15.4166 0.585786 15.4166 1C15.4166 1.41421 15.0808 1.75 14.6666 1.75L1.33325 1.75C0.919038 1.75 0.583252 1.41422 0.583252 1ZM0.583252 11C0.583252 10.5858 0.919038 10.25 1.33325 10.25L14.6666 10.25C15.0808 10.25 15.4166 10.5858 15.4166 11C15.4166 11.4142 15.0808 11.75 14.6666 11.75L1.33325 11.75C0.919038 11.75 0.583252 11.4142 0.583252 11ZM1.33325 5.25C0.919038 5.25 0.583252 5.58579 0.583252 6C0.583252 6.41421 0.919038 6.75 1.33325 6.75L7.99992 6.75C8.41413 6.75 8.74992 6.41421 8.74992 6C8.74992 5.58579 8.41413 5.25 7.99992 5.25L1.33325 5.25Z" fill="currentColor" />
            </svg>
          )}
        </button>
        {updatedLabel ? (
          <button
            type="button"
            className="app-header-compact-updated"
            onClick={onUpdatedClick}
            aria-label={`${updatedLabel}. Open Settings.`}
          >
            <FiRefreshCw className="app-header-updated-icon" aria-hidden="true" />
            <span>{updatedLabel}</span>
          </button>
        ) : (
          <span className="app-header-mobile-brand" aria-hidden="true" />
        )}
        <button
          type="button"
          className="app-header-see-txns-icon"
          aria-label="See transactions"
          onClick={onOpenTransactions}
        >
          <FiList size={20} aria-hidden="true" />
        </button>
      </div>

      {/* Desktop row — collapse toggle / See Transactions / updated */}
      <div className="app-header-desktop-search">
        <button
          type="button"
          className="app-header-menu"
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!isCollapsed}
          onClick={toggleCollapsed}
        >
          <svg width="16" height="12" viewBox="0 0 16 12" fill="none" aria-hidden="true">
            <path fillRule="evenodd" clipRule="evenodd" d="M0.583252 1C0.583252 0.585788 0.919038 0.25 1.33325 0.25H14.6666C15.0808 0.25 15.4166 0.585786 15.4166 1C15.4166 1.41421 15.0808 1.75 14.6666 1.75L1.33325 1.75C0.919038 1.75 0.583252 1.41422 0.583252 1ZM0.583252 11C0.583252 10.5858 0.919038 10.25 1.33325 10.25L14.6666 10.25C15.0808 10.25 15.4166 10.5858 15.4166 11C15.4166 11.4142 15.0808 11.75 14.6666 11.75L1.33325 11.75C0.919038 11.75 0.583252 11.4142 0.583252 11ZM1.33325 5.25C0.919038 5.25 0.583252 5.58579 0.583252 6C0.583252 6.41421 0.919038 6.75 1.33325 6.75L7.99992 6.75C8.41413 6.75 8.74992 6.41421 8.74992 6C8.74992 5.58579 8.41413 5.25 7.99992 5.25L1.33325 5.25Z" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          className="app-header-see-txns"
          onClick={onOpenTransactions}
        >
          <FiList className="app-header-see-txns-icon-svg" aria-hidden="true" />
          See Transactions
        </button>
        {updatedLabel ? (
          <button
            type="button"
            className="app-header-updated"
            onClick={onUpdatedClick}
            aria-label={`${updatedLabel}. Open Settings.`}
          >
            <FiRefreshCw className="app-header-updated-icon" aria-hidden="true" />
            <span>{updatedLabel}</span>
          </button>
        ) : null}
      </div>
    </header>
  );
}
