import {
  Activity,
  Clock,
  Flag,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Map,
  Settings,
  Trash2,
  Users,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  section: 'Watch' | 'Cleanup' | 'System';
  /** Shown in the phone's bottom bar. */
  mobile?: boolean;
  /** Build phase that delivers this page (undefined = available now). */
  phase?: number;
  blurb?: string;
  coming?: string[];
}

export const navItems: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, section: 'Watch', mobile: true },
  {
    to: '/activity',
    label: 'Live Activity',
    icon: Activity,
    section: 'Watch',
    mobile: true,
    phase: 2,
    blurb: 'Everything playing right now, as it happens.',
    coming: ['Live streams with progress, quality and transcode details', 'Device, app and network for each stream', 'Stop a stream with a message'],
  },
  {
    to: '/history',
    label: 'History',
    icon: Clock,
    section: 'Watch',
    phase: 2,
    blurb: 'Every play, by every person, searchable.',
    coming: ['Full watch history with filters', 'How long each title was watched', 'Import past history from Jellyfin'],
  },
  {
    to: '/users',
    label: 'Users',
    icon: Users,
    section: 'Watch',
    phase: 2,
    blurb: 'A profile for each family member.',
    coming: ['Sign-in dates and times, devices and apps', 'Watch stats and favourite titles', 'Account sharing and multi-device alerts'],
  },
  {
    to: '/map',
    label: 'Map',
    icon: Map,
    section: 'Watch',
    phase: 2,
    blurb: 'Where streams are coming from.',
    coming: ['Map of stream locations', 'Alerts for far-apart sign-ins ("impossible travel")', 'Offline location lookup — nothing sent to outside services'],
  },
  {
    to: '/requests',
    label: 'Requests',
    icon: Inbox,
    section: 'Watch',
    phase: 2,
    blurb: 'Who asked for what — and whether they watched it.',
    coming: ['Every Seerr request with requester and date', 'Requested-but-never-watched report'],
  },
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
    mobile: true,
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
