import { useEffect, useRef, useState } from 'react';
import { FiMenu, FiSearch } from 'react-icons/fi';
import { useSidebar } from '../context/SidebarContext';

type AppHeaderProps = {
  query: string;
  onQueryChange: (value: string) => void;
};

export function AppHeader({ query, onQueryChange }: AppHeaderProps) {
  const { toggleMobile } = useSidebar();
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isMobileSearchOpen) {
      searchInputRef.current?.focus();
    }
  }, [isMobileSearchOpen]);

  const handleSearchIconClick = () => {
    setIsMobileSearchOpen((prev) => !prev);
  };

  const handleSearchBlur = () => {
    if (!query) {
      setIsMobileSearchOpen(false);
    }
  };

  return (
    <header className="app-header">
      {/* Mobile row — hamburger / brand / search icon */}
      <div className="app-header-mobile-row">
        <button
          type="button"
          className="app-header-menu"
          aria-label="Open navigation"
          onClick={toggleMobile}
        >
          <FiMenu aria-hidden="true" />
        </button>
        <span className="app-header-mobile-brand">Wx CFO</span>
        <button
          type="button"
          className="app-header-search-icon-btn"
          aria-label={isMobileSearchOpen ? 'Close search' : 'Open search'}
          aria-expanded={isMobileSearchOpen}
          onClick={handleSearchIconClick}
        >
          <FiSearch size={20} aria-hidden="true" />
        </button>
      </div>

      {/* Mobile search expand row */}
      {isMobileSearchOpen && (
        <div className="app-header-search-row">
          <input
            ref={searchInputRef}
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onBlur={handleSearchBlur}
            placeholder="Search payee, category, memo..."
            aria-label="Search transactions"
          />
        </div>
      )}

      {/* Desktop search — always rendered, hidden below 1024px via CSS */}
      <div className="app-header-desktop-search">
        <button
          type="button"
          className="app-header-menu"
          aria-label="Open navigation"
          onClick={toggleMobile}
        >
          <FiMenu aria-hidden="true" />
        </button>
        <div className="app-header-search">
          <FiSearch className="app-header-search-icon" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search payee, category, memo..."
            aria-label="Search transactions"
          />
        </div>
      </div>
    </header>
  );
}
