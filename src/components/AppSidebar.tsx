import { NavLink } from 'react-router';
import { FiGrid, FiSliders, FiSettings, FiLayout, FiX, FiClock, FiUsers } from 'react-icons/fi';
import gracieSportsLogo from '../assets/gracie-sports-logo.svg';
import { useSidebar } from '../context/SidebarContext';

type NavLeaf = {
  kind: 'leaf';
  to: string;
  label: string;
  icon: typeof FiGrid;
  end?: boolean;
};

const NAV_ITEMS: NavLeaf[] = [
  { kind: 'leaf', to: '/today', label: 'Today', icon: FiClock },
  { kind: 'leaf', to: '/big-picture', label: 'Big Picture', icon: FiGrid },
  { kind: 'leaf', to: '/forecast', label: 'Forecast', icon: FiSliders },
  // Retention keeps its /gym/retention path; future Gym subpages can return
  // as a Gym group when Overview / Membership / Classes are real.
  { kind: 'leaf', to: '/gym/retention', label: 'Retention', icon: FiUsers },
  { kind: 'leaf', to: '/settings', label: 'Settings', icon: FiSettings },
];

export function AppSidebar() {
  const { isCollapsed, isMobileOpen, setMobileOpen } = useSidebar();

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
          <span className="app-sidebar-brand-title">Financial Dashboard</span>
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
            {NAV_ITEMS.map((item) => (
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
      </aside>
    </>
  );
}
