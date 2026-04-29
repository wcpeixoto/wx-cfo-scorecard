import { NavLink } from 'react-router';
import { FiGrid, FiTarget, FiTrendingUp, FiSliders, FiSettings, FiLayout, FiChevronLeft, FiX, FiClock } from 'react-icons/fi';
import gracieSportsLogo from '../assets/gracie-sports-logo.svg';
import { useSidebar } from '../context/SidebarContext';

type SidebarItem = {
  to: string;
  label: string;
  icon: typeof FiGrid;
  end?: boolean;
};

const PRIMARY_ITEMS: SidebarItem[] = [
  { to: '/today', label: 'Today', icon: FiClock },
  { to: '/big-picture', label: 'Big Picture', icon: FiGrid },
  { to: '/focus', label: 'Where to Focus', icon: FiTarget },
  { to: '/trends', label: 'Trends', icon: FiTrendingUp },
  { to: '/forecast', label: 'Forecast', icon: FiSliders },
  { to: '/settings', label: 'Settings', icon: FiSettings },
];

export function AppSidebar() {
  const { isCollapsed, isMobileOpen, toggleCollapsed, setMobileOpen } = useSidebar();

  const classes = ['app-sidebar'];
  if (isCollapsed) classes.push('is-collapsed');
  if (isMobileOpen) classes.push('is-mobile-open');

  const handleNavClick = () => setMobileOpen(false);

  return (
    <>
      {isMobileOpen && (
        <div className="app-sidebar-scrim" onClick={() => setMobileOpen(false)} aria-hidden="true" />
      )}
      <aside className={classes.join(' ')} aria-label="Primary navigation">
        <div className="app-sidebar-brand">
          <img className="app-sidebar-logo" src={gracieSportsLogo} alt="Gracie Sports logo" />
          {!isCollapsed && <span className="app-sidebar-brand-title">Financial Dashboard</span>}
          <button
            type="button"
            className="app-sidebar-mobile-close"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          >
            <FiX aria-hidden="true" />
          </button>
        </div>

        <nav className="app-sidebar-nav" aria-label="Main navigation">
          <ul>
            {PRIMARY_ITEMS.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  onClick={handleNavClick}
                  className={({ isActive }) =>
                    isActive ? 'app-sidebar-link is-active' : 'app-sidebar-link'
                  }
                >
                  <item.icon className="app-sidebar-icon" aria-hidden="true" />
                  <span className="app-sidebar-label">{item.label}</span>
                </NavLink>
              </li>
            ))}
            {import.meta.env.DEV && (
              <li>
                <NavLink
                  to="/ui-lab"
                  onClick={handleNavClick}
                  className={({ isActive }) =>
                    isActive ? 'app-sidebar-link app-sidebar-link--dev is-active' : 'app-sidebar-link app-sidebar-link--dev'
                  }
                >
                  <FiLayout className="app-sidebar-icon" aria-hidden="true" />
                  <span className="app-sidebar-label">UI Lab</span>
                </NavLink>
              </li>
            )}
          </ul>
        </nav>

        <button
          type="button"
          className="app-sidebar-collapse"
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={toggleCollapsed}
        >
          <FiChevronLeft className="app-sidebar-icon" aria-hidden="true" />
          {!isCollapsed && <span className="app-sidebar-label">Collapse</span>}
        </button>
      </aside>
    </>
  );
}
