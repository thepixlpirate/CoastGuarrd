import { Activity, Clock, Flag, Inbox, LayoutDashboard, ListChecks, Map, Settings, ShieldAlert, Trash2, Users, type LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  /** Shorter label for the phone's bottom bar. */
  short?: string;
  icon: LucideIcon;
  section: 'Watch' | 'Cleanup' | 'System';
  /** Shown in the phone's bottom bar. */
  mobile?: boolean;
  /** Build phase that delivers this page (undefined = available now). */
  phase?: number;
  blurb?: string;
  coming?: string[];
  /** Shows the open-alert count. */
  alerts?: boolean;
}

export const navItems: NavItem[] = [
  { to: '/', label: 'Dashboard', short: 'Home', icon: LayoutDashboard, section: 'Watch', mobile: true },
  { to: '/activity', label: 'Live Activity', short: 'Live', icon: Activity, section: 'Watch', mobile: true },
  { to: '/history', label: 'History', icon: Clock, section: 'Watch', mobile: true },
  { to: '/users', label: 'Users', icon: Users, section: 'Watch', mobile: true },
  { to: '/map', label: 'Map', icon: Map, section: 'Watch' },
  { to: '/requests', label: 'Requests', icon: Inbox, section: 'Watch' },
  { to: '/alerts', label: 'Alerts', icon: ShieldAlert, section: 'Watch', alerts: true },
  {
    to: '/rules',
    label: 'Rules',
    icon: ListChecks,
    section: 'Cleanup',
    phase: 3,
    blurb: 'Decide what counts as unwatched.',
    coming: ['Rule builder (never watched, not opened in X days, etc.)', 'Protection rules: keep tags, favourites, kids’ content', 'Preview what each rule would flag'],
  },
  {
    to: '/leaving',
    label: 'Leaving Soon',
    icon: Flag,
    section: 'Cleanup',
    phase: 3,
    blurb: 'Flagged titles and their countdowns.',
    coming: ['Countdown poster banners', '"Leaving Soon" collection in Jellyfin', 'Keep requests from family'],
  },
  {
    to: '/recycle',
    label: 'Recycle Bin',
    icon: Trash2,
    section: 'Cleanup',
    phase: 4,
    blurb: 'Nothing is ever deleted until you empty it here.',
    coming: ['One-click restore', 'Space you can free', 'Empty by hand only — never automatic'],
  },
  { to: '/settings', label: 'Settings', icon: Settings, section: 'System' },
];
