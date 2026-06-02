import { NavLink, useLocation } from 'react-router';
import { useEffect, useState } from 'react';
import { FiGrid, FiSliders, FiSettings, FiLayout, FiX, FiClock, FiUsers, FiChevronDown } from 'react-icons/fi';
import gracieSportsLogo from '../assets/gracie-sports-logo.svg';
import { useSidebar } from '../context/SidebarContext';

type NavLeaf = {
  kind: 'leaf';
  to: string;
  label: string;
  icon: typeof FiGrid;
  end?: boolean;
};

type NavGroup = {
  kind: 'group';
  label: string;
  icon: typeof FiGrid;
  basePath: string;
  children: { to: string; label: string }[];
};

type NavEntry = NavLeaf | NavGroup;

const NAV_ITEMS: NavEntry[] = [
  { kind: 'leaf', to: '/today', label: 'Today', icon: FiClock },
  { kind: 'leaf', to: '/big-picture', label: 'Big Picture', icon: FiGrid },
  { kind: 'leaf', to: '/forecast', label: 'Forecast', icon: FiSliders },
  {
    kind: 'group',
    label: 'Gym',
    icon: FiUsers,
    basePath: '/gym',
    // Overview / Membership / Classes are intentionally hidden for now —
    // they return as sibling children when those pages are real.
    children: [{ to: '/gym/retention', label: 'Retention' }],
  },
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
            {NAV_ITEMS.map((item) =>
              item.kind === 'leaf' ? (
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
              ) : (
                <SidebarGroup key={item.label} group={item} onNavigate={handleNavClick} />
              )
            )}
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

// Expandable nav group (TailAdmin submenu pattern): the parent is a toggle
// button (not a link), children render in an indented submenu. The group
// auto-opens when the active route is inside it, and stays user-toggleable.
function SidebarGroup({ group, onNavigate }: { group: NavGroup; onNavigate: () => void }) {
  const location = useLocation();
  const isOnGroup = location.pathname.startsWith(group.basePath);
  const [open, setOpen] = useState(isOnGroup);

  // Track the active section: open on enter, close on leave (matches the
  // TailAdmin submenu pattern). A manual toggle persists until the next
  // section change, since this only re-runs when isOnGroup flips.
  useEffect(() => {
    setOpen(isOnGroup);
  }, [isOnGroup]);

  const Icon = group.icon;

  return (
    <li className="app-sidebar-group">
      <button
        type="button"
        className={`app-sidebar-link app-sidebar-group-toggle${isOnGroup ? ' is-active' : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon className="app-sidebar-icon" aria-hidden="true" />
        <span className="app-sidebar-label">{group.label}</span>
        <FiChevronDown className={`app-sidebar-chevron${open ? ' is-open' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <ul className="app-sidebar-submenu">
          {group.children.map((child) => (
            <li key={child.to}>
              <NavLink
                to={child.to}
                onClick={onNavigate}
                className={({ isActive }) =>
                  isActive ? 'app-sidebar-sublink is-active' : 'app-sidebar-sublink'
                }
              >
                <span className="app-sidebar-label">{child.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
