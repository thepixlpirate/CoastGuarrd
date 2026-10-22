import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../db/index.js';

interface FolderRow {
  service: string;
  remote_path: string;
  local_path: string;
  recycle_path: string;
}

function norm(p: string) {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * Converts a path as Radarr/Sonarr/Jellyfin see it into the path inside
 * CoastGuarrd's container, using the folder matches from setup.
 */
export function toLocal(remote: string, service?: string | null): { local: string; root: FolderRow } | null {
  const rows = getDb().prepare('SELECT * FROM library_folders WHERE local_path != ?').all('') as FolderRow[];
  const r = norm(remote);
  const candidates = rows
    .filter((row) => {
      const base = norm(row.remote_path);
      return r === base || r.startsWith(base + '/');
    })
    .sort((a, b) => (a.service === service ? -1 : 0) - (b.service === service ? -1 : 0) || b.remote_path.length - a.remote_path.length);
  const hit = candidates[0];
  if (!hit) return null;
  const rest = r.slice(norm(hit.remote_path).length).replace(/^\//, '');
  return { local: rest ? path.join(hit.local_path, rest) : hit.local_path, root: hit };
}

/** Total size of a file or folder in bytes (follows nothing, skips unreadable entries). */
export function diskUsage(p: string, budget = { files: 200_000 }): number {
  let total = 0;
  const stack = [p];
  while (stack.length && budget.files > 0) {
    const cur = stack.pop()!;
    let st: fs.Stats;
    try {
      st = fs.lstatSync(cur);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      try {
        for (const e of fs.readdirSync(cur)) stack.push(path.join(cur, e));
      } catch {
        /* unreadable */
      }
    } else if (st.isFile()) {
      total += st.size;
      budget.files--;
    }
  }
  return total;
}

/** How full the drive holding `p` is (0–100), or null if unknown. */
export function diskUsedPercent(p: string): number | null {
  try {
    let cur = p;
    while (!fs.existsSync(cur) && path.dirname(cur) !== cur) cur = path.dirname(cur);
    const s = fs.statfsSync(cur);
    const total = s.blocks * s.bsize;
    if (!total) return null;
    return Math.round(((total - s.bavail * s.bsize) / total) * 1000) / 10;
  } catch {
    return null;
  }
}

export function driveSpace(p: string): { total: number; free: number } | null {
  try {
    let cur = p;
    while (!fs.existsSync(cur) && path.dirname(cur) !== cur) cur = path.dirname(cur);
    const s = fs.statfsSync(cur);
    return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  } catch {
    return null;
  }
}
