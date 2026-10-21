import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { LogOut, Menu } from 'lucide-react';
import { useAuth } from '../auth';
import { get } from '../api';
import { navItems, type NavItem } from '../nav';

/** Number of open alerts, refreshed every 30 seconds and whenever alerts change. */
function useOpenAlerts() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const load = () => get<{ counts: { open: number } }>('/api/alerts?status=open&pageSize=10').then((r) => setN(r.counts.open)).catch(() => undefined);
    void load();
    const t = setInterval(load, 30_000);
    window.addEventListener('cg:alerts-changed', load);
    return () => {
      clearInterval(t);
      window.removeEventListener('cg:alerts-changed', load);
    };
  }, []);
  return n;
}

function NavList({ onPick, alertCount = 0 }: { onPick?: () => void; alertCount?: number }) {
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
                {n.alerts && alertCount > 0 && <span className="count">{alertCount > 99 ? '99+' : alertCount}</span>}
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
      <img src="/logo.png" alt="" />
      <span className="grad-text">CoastGuarrd</span>
    </Link>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const { status, logout } = useAuth();
  const [sheet, setSheet] = useState(false);
  const location = useLocation();
  const username = status?.user?.username ?? '';
  const alertCount = useOpenAlerts();

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
        <NavList alertCount={alertCount} />
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
            {n.short ?? n.label}
          </NavLink>
        ))}
        <button className={moreActive ? 'active' : ''} onClick={() => setSheet(true)}>
          <Menu />
          More
          {alertCount > 0 && <span className="count-dot" aria-label={`${alertCount} open alerts`} />}
        </button>
      </nav>

      {sheet && (
        <>
          <div className="sheet-back" onClick={() => setSheet(false)} />
          <div className="sheet" role="dialog" aria-label="All pages">
            <div className="grabber" />
            <NavList onPick={() => setSheet(false)} alertCount={alertCount} />
          </div>
        </>
      )}
    </div>
  );
}
