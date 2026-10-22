export interface Play {
  id: number;
  userId: string;
  userName: string;
  itemId: string;
  itemType: string;
  title: string;
  subtitle: string;
  seriesId: string | null;
  posterId: string;
  startedAt: number;
  stoppedAt: number | null;
  lastSeenAt: number;
  watchedMs: number;
  pausedMs: number;
  pauseCount: number;
  runtimeMs: number | null;
  positionMs: number;
  percent: number | null;
  completed: boolean;
  playMethod: string | null;
  transcodeVideo: boolean;
  transcodeAudio: boolean;
  transcodeReasons: string[];
  resolution: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
  bitrate: number | null;
  container: string | null;
  client: string | null;
  clientVersion: string | null;
  device: string | null;
  ip: string | null;
  isLocal: boolean;
  place: string | null;
  countryCode: string | null;
  lat: number | null;
  lon: number | null;
  source: string;
}

export interface LiveStream extends Play {
  sessionId: string;
  paused: boolean;
  canControl: boolean;
  transcodeProgress: number | null;
  hwAccel: string | null;
}

export interface LiveResponse {
  streams: LiveStream[];
  summary: { total: number; transcoding: number; directPlay: number; bandwidth: number };
  poller: { running: boolean; lastOkAt: number | null; lastError: string | null; active: number; pollSeconds: number };
}

export interface AlertItem {
  id: number;
  at: number;
  userId: string | null;
  userName: string | null;
  rule: string;
  ruleLabel: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: Record<string, unknown>;
  playId: number | null;
  acknowledgedAt: number | null;
  dismissed: boolean;
}

export interface TitleStat {
  id: string;
  title: string;
  type: string;
  plays: number;
  hours: number;
  users: number;
  posterId: string;
}

export interface Overview {
  live: { total: number; transcoding: number };
  today: { plays: number; hours: number };
  week: { plays: number; hours: number; viewers: number };
  daily: { day: string; plays: number; hours: number }[];
  topUsers: { id: string; name: string; plays: number; hours: number }[];
  topTitles: TitleStat[];
  platforms: { name: string; plays: number; hours: number }[];
  hourOfDay: number[];
  openAlerts: number;
  recentAlerts: AlertItem[];
  recent: Play[];
  hasData: boolean;
}

export interface UserSummary {
  id: string;
  name: string;
  isAdmin: boolean;
  isDisabled: boolean;
  removed: boolean;
  hasImage: boolean;
  lastLoginAt: number | null;
  lastActivityAt: number | null;
  seerrName: string | null;
  plays: number;
  hours: number;
  plays30: number;
  devices: number;
  ips: number;
  openAlerts: number;
  requests: number;
  trust: number;
  streamingNow: number;
  lastPlace: string | null;
}

export interface RequestItem {
  id: number;
  type: 'movie' | 'tv';
  status: string;
  mediaStatus: string;
  available: boolean;
  title: string;
  year: number | null;
  poster: string | null;
  tmdbId: number | null;
  jellyfinId: string | null;
  requestedBy: { id: string | null; name: string };
  is4k: boolean;
  seasons: number[];
  createdAt: number;
  requester: { plays: number; lastAt: number | null; completed: boolean };
  otherViewers: number;
  totalPlays: number;
}

export interface UserDetail {
  user: {
    id: string;
    name: string;
    isAdmin: boolean;
    isDisabled: boolean;
    removed: boolean;
    hasImage: boolean;
    lastLoginAt: number | null;
    lastActivityAt: number | null;
    seerrName: string | null;
    email: string | null;
    streamLimit: number | null;
    notes: string;
    firstSeenAt: number;
    trust: number;
    streamingNow: number;
  };
  totals: { plays: number; hours: number; titles: number };
  hourOfDay: number[];
  week: number[][];
  platforms: { name: string; plays: number; hours: number }[];
  topTitles: TitleStat[];
  devices: { id: string; name: string | null; client: string | null; version: string | null; firstSeenAt: number; lastSeenAt: number; lastIp: string | null }[];
  locations: { ip: string; firstSeenAt: number; lastSeenAt: number; times: number; isLocal: boolean; place: string; countryCode: string | null; lat: number | null; lon: number | null }[];
  signIns: { id: number; at: number; kind: string; ip: string | null; device: string | null; place: string | null }[];
  recent: Play[];
  requests: RequestItem[];
  alerts: AlertItem[];
  defaultStreamLimit: number;
}

export interface RuleToggle {
  enabled: boolean;
  severity: 'info' | 'warning' | 'critical';
}

export interface TrackingSettings {
  pollSeconds: number;
  geoEnabled: boolean;
  geoAutoUpdate: boolean;
  minPlaySeconds: number;
  rules: {
    impossibleTravel: RuleToggle & { kmh: number };
    simultaneousLocations: RuleToggle & { km: number };
    concurrentStreams: RuleToggle & { max: number };
    ipVelocity: RuleToggle & { count: number; hours: number };
    newDevice: RuleToggle;
    newCountry: RuleToggle;
    failedSignIns: RuleToggle & { count: number; minutes: number };
  };
  ruleLabels: Record<string, string>;
}

export interface GeoStatus {
  ready: boolean;
  source: 'maxmind' | 'dbip' | null;
  month: string | null;
  downloadedAt: number | null;
  downloading: boolean;
  error: string | null;
  customPath: string;
}

export interface ImportStatus {
  running: boolean;
  method: 'plugin' | 'played' | null;
  imported: number;
  skipped: number;
  message: string;
  finishedAt: number | null;
}

// ---- Cleanup ---------------------------------------------------------------

export type MediaKind = 'movie' | 'show' | 'music';

export interface Condition {
  field: string;
  op: 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'is' | 'contains' | 'notContains';
  value: number | string | boolean;
}

export interface RuleConfig {
  libraries: string[];
  match: 'all' | 'any';
  conditions: Condition[];
  graceDays: number;
  reason: string;
}

export interface CleanupRule {
  id: number;
  name: string;
  enabled: boolean;
  kind: MediaKind;
  position: number;
  config: RuleConfig;
  flagged: number;
}

export interface FieldDef {
  id: string;
  label: string;
  type: 'number' | 'bool' | 'text';
  unit: string | null;
  help: string;
}

export interface MediaItemView {
  key: string;
  kind: MediaKind;
  jfId: string | null;
  title: string;
  year: number | null;
  library: string | null;
  sizeBytes: number | null;
  addedAt: number | null;
  lastWatchedAt: number | null;
  plays: number;
  viewers: number;
  requestedBy: string | null;
  requestedAt: number | null;
  requesterWatched: boolean | null;
  favoriteOf: string[];
  tags: string[];
  arr: string | null;
  monitored: boolean | null;
  path: string | null;
}

export interface FlagView extends MediaItemView {
  id: number;
  ruleName: string;
  manual: boolean;
  reason: string | null;
  details: { field: string; label: string; actual: string }[];
  flaggedAt: number;
  deleteAt: number;
  daysLeft: number;
  preview: boolean;
  bannerApplied: boolean;
  inCollection: boolean;
  lastError: string | null;
  keepRequests: { n: number; names: string } | null;
}

export interface KeepRequest {
  id: number;
  item_key: string;
  title: string;
  name: string;
  message: string | null;
  at: number;
}

export interface BinRow {
  id: number;
  item_key: string | null;
  jf_id: string | null;
  kind: string;
  title: string;
  year: number | null;
  original_path: string;
  recycle_path: string;
  size_bytes: number | null;
  moved_at: number;
  rule_name: string | null;
  arr_service: string | null;
}

export interface EvalResult {
  at: number;
  items: number;
  flagged: number;
  newlyFlagged: number;
  cleared: number;
  errors: string[];
}

export interface CleanupSettings {
  protectTags: string[];
  protectFavorites: boolean;
  protectRequestedDays: number;
  protectAddedDays: number;
  excludedLibraries: string[];
  evaluateHours: number;
  posters: { enabled: boolean; color: 'red' | 'purple' | 'teal' | 'black' };
  collection: { enabled: boolean; name: string };
  arr: { unmonitor: boolean; removeOnDelete: boolean; importExclusion: boolean };
  seerrReset: boolean;
  allowCrossDrive: boolean;
  downloadsAgeDays: number;
}

export interface NotifySettings {
  discord: { enabled: boolean; webhook: string };
  email: { enabled: boolean; host: string; port: number; secure: boolean; user: string; pass: string; from: string; to: string };
  webhook: { enabled: boolean; url: string };
  events: { alerts: 'off' | 'info' | 'warning' | 'critical'; flagged: boolean; moved: boolean; keepRequests: boolean; digest: boolean };
  family: { pageEnabled: boolean; token: string; emailDigest: boolean };
  publicUrl: string;
  hasPass?: boolean;
}
