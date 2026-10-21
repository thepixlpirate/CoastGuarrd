import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { LogOut, Menu } from 'lucide-react';
import { useAuth } from '../auth';
import { navItems, type NavItem } from '../nav';

function NavList({ onPick }: { onPick?: () => void }) {
  const sections: NavItem['section'][] = ['Watch', 'Cleanup', 'System'];
  return (
    <nav className="nav">
      {sections.map((section) => (
        <div key={section}>
          <div className="nav-section">{section}</div>
          {navItems
            .filter((n) => n.section === section)
            .map((n) => (
              <NavLink key={n.to} to={n.to} end={n.to === '/'} onClick={onPick}>
                <n.icon />
                {n.label}
                {n.phase && <span className="badge soon">Soon</span>}
              </NavLink>
            ))}
        </div>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <Link to="/" className="brand">
      <img src="/logo.svg" alt="" />
      <span className="grad-text">CoastGuarrd</span>
    </Link>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const { status, logout } = useAuth();
  const [sheet, setSheet] = useState(false);
  const location = useLocation();
  const username = status?.user?.username ?? '';

  useEffect(() => {
    setSheet(false);
    window.scrollTo(0, 0);
  }, [location.pathname]);

  const mobileItems = navItems.filter((n) => n.mobile);
  const moreActive = !mobileItems.some((n) => (n.to === '/' ? location.pathname === '/' : location.pathname.startsWith(n.to)));

  return (
    <div className="shell backdrop">
      <aside className="sidebar">
        <Brand />
        <NavList />
        <div className="sidebar-foot">
          <div className="avatar">{username.slice(0, 1).toUpperCase()}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis' }}>{username}</div>
            <div className="faint" style={{ fontSize: 12 }}>Administrator</div>
          </div>
          <button className="btn btn-ghost icon-btn" onClick={() => void logout()} title="Sign out" aria-label="Sign out">
            <LogOut />
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <Brand />
          <div className="spacer" />
          <button className="btn btn-ghost icon-btn" onClick={() => void logout()} aria-label="Sign out">
            <LogOut />
          </button>
        </header>
        {children}
      </div>

      <nav className="mobile-nav" aria-label="Main">
        {mobileItems.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'}>
            <n.icon />
            {n.label.replace('Live ', '')}
          </NavLink>
        ))}
        <button className={moreActive ? 'active' : ''} onClick={() => setSheet(true)}>
          <Menu />
          More
        </button>
      </nav>

      {sheet && (
        <>
          <div className="sheet-back" onClick={() => setSheet(false)} />
          <div className="sheet" role="dialog" aria-label="All pages">
            <div className="grabber" />
            <NavList onPick={() => setSheet(false)} />
          </div>
        </>
      )}
    </div>
  );
}
