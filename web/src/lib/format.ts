export function fmtHours(h: number): string {
  if (!h) return '0 h';
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 10) return `${h.toFixed(1)} h`;
  return `${Math.round(h).toLocaleString()} h`;
}

export function fmtDuration(ms: number | null | undefined): string {
  if (!ms || ms < 0) return '0:00';
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

/** "1h 24m" style. */
export function fmtSpan(ms: number | null | undefined): string {
  if (!ms || ms < 60_000) return ms && ms > 0 ? `${Math.round(ms / 1000)}s` : '—';
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function fmtBitrate(bps: number | null | undefined): string {
  if (!bps) return '—';
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(bps >= 10_000_000 ? 0 : 1)} Mbps`;
  return `${Math.round(bps / 1000)} kbps`;
}

export function timeAgo(ts: number | null | undefined): string {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} days ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(ts).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

export function fmtDateTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Two-letter country code → flag emoji. */
export function flag(cc: string | null | undefined): string {
  if (!cc || cc.length !== 2) return '';
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export function plural(n: number, word: string, many = `${word}s`) {
  return `${n.toLocaleString()} ${n === 1 ? word : many}`;
}

export const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`));
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function fmtBytes(b: number | null | undefined): string {
  if (b == null) return '—';
  if (b < 1024 ** 2) return `${Math.round(b / 1024)} KB`;
  if (b < 1024 ** 3) return `${Math.round(b / 1024 ** 2)} MB`;
  if (b < 1024 ** 4) return `${(b / 1024 ** 3).toFixed(b < 10 * 1024 ** 3 ? 1 : 0)} GB`;
  return `${(b / 1024 ** 4).toFixed(2)} TB`;
}

export function daysText(n: number): string {
  return n <= 0 ? 'today' : n === 1 ? '1 day' : `${n} days`;
}
