import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

export const RECYCLE_DIR_NAME = '.coastguarrd-recycle';

export function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function statSafe(p: string): fs.Stats | null {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

/** Closest folder at or above `p` that actually exists. */
export function nearestExisting(p: string): string | null {
  let cur = path.resolve(p);
  for (;;) {
    if (statSafe(cur)?.isDirectory()) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

/** Lists sub-folders, skipping hidden ones. */
export function listDirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => (d.isDirectory() || d.isSymbolicLink()) && !d.name.startsWith('.'))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  } catch {
    return [];
  }
}

/** Finds `segments` under `base`, ignoring upper/lower case differences. */
function resolveCaseInsensitive(base: string, segments: string[]): string | null {
  let cur = base;
  for (const seg of segments) {
    const match = listDirs(cur).find((d) => d.toLowerCase() === seg.toLowerCase());
    if (!match) return null;
    cur = path.join(cur, match);
  }
  return cur;
}

/** Breadth-first search for folders named `name` a few levels under the media mount. */
function findByName(name: string, maxDepth = 3): string[] {
  const hits: string[] = [];
  let level = [config.mediaRoot];
  for (let depth = 0; depth < maxDepth && level.length; depth++) {
    const next: string[] = [];
    for (const dir of level) {
      for (const child of listDirs(dir)) {
        const full = path.join(dir, child);
        if (child.toLowerCase() === name.toLowerCase()) hits.push(full);
        next.push(full);
      }
    }
    level = next.slice(0, 500);
  }
  return hits;
}

/**
 * Guesses where a folder reported by another app (for example "/movies" in
 * Radarr) lives inside CoastGuarrd's own media mount.
 */
export function suggestLocalPath(remotePath: string): string {
  if (!fs.existsSync(config.mediaRoot)) return '';
  const segs = remotePath.split(/[\\/]+/).filter(Boolean);
  // Try the longest matching tail first: /mnt/disks/DRIVE/Movies → DRIVE/Movies → Movies.
  for (let k = segs.length; k >= 1; k--) {
    const hit = resolveCaseInsensitive(config.mediaRoot, segs.slice(-k));
    if (hit) return hit;
  }
  const last = segs[segs.length - 1];
  if (last) {
    const hits = findByName(last);
    if (hits.length === 1) return hits[0];
  }
  return '';
}

/**
 * The top of the drive a folder lives on (the highest parent that is still
 * on the same disk). Moves inside one drive are instant; moves between drives
 * mean copying the whole file.
 */
export function driveRoot(localPath: string): string | null {
  const start = nearestExisting(localPath);
  if (!start) return null;
  const dev = statSafe(start)!.dev;
  let cur = start;
  for (;;) {
    if (cur === config.mediaRoot) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return cur;
    if (!isInside(parent, config.mediaRoot) && isInside(cur, config.mediaRoot)) return cur;
    const st = statSafe(parent);
    if (!st || st.dev !== dev) return cur;
    cur = parent;
  }
}

export function suggestRecyclePath(localPath: string): string {
  const root = driveRoot(localPath);
  return root ? path.join(root, RECYCLE_DIR_NAME) : '';
}

export interface PathCheck {
  localExists: boolean;
  recycleExists: boolean;
  recycleWritable: boolean;
  sameDrive: boolean | null;
  recycleInsideLibrary: boolean;
  message: string;
}

export function checkPaths(localPath: string, recyclePath: string): PathCheck {
  const local = localPath ? statSafe(localPath) : null;
  const localExists = !!local?.isDirectory();
  const recycleExists = !!(recyclePath && statSafe(recyclePath)?.isDirectory());
  const recycleBase = recyclePath ? nearestExisting(recyclePath) : null;
  let recycleWritable = false;
  if (recycleBase) {
    try {
      fs.accessSync(recycleBase, fs.constants.W_OK);
      recycleWritable = true;
    } catch {
      recycleWritable = false;
    }
  }
  const sameDrive = local && recycleBase ? statSafe(recycleBase)!.dev === local.dev : null;
  const recycleInsideLibrary = !!(localPath && recyclePath && isInside(path.resolve(recyclePath), path.resolve(localPath)));

  let message = 'Looks good — moves to the recycle bin will be instant.';
  if (!localExists) message = 'CoastGuarrd cannot see this media folder. Check the folder path and the container’s media mapping.';
  else if (!recyclePath) message = 'Choose a recycle bin folder.';
  else if (recycleInsideLibrary) message = 'The recycle bin must not be inside the media folder, or Jellyfin will keep showing removed items.';
  else if (!recycleWritable) message = 'CoastGuarrd cannot write to the recycle bin folder. Check the container’s permissions.';
  else if (sameDrive === false) message = 'The recycle bin is on a different drive, so every move will copy the whole file. Pick a folder on the same drive.';

  return { localExists, recycleExists, recycleWritable, sameDrive, recycleInsideLibrary, message };
}
