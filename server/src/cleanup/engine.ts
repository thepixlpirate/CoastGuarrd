import { getDb } from '../db/index.js';
import { getSetting } from '../lib/settings.js';
import { getState, setState } from '../lib/state.js';
import { jellyfinReady } from '../jellyfin/client.js';
import { familyEmails, familyLink, notify, sendEmail } from '../notify/index.js';
import { syncLibrary } from './library.js';
import { buildFacts, listRules, loadItems, matchRule, protectedReason, type MatchDetail, type MediaRow } from './rules.js';
import { applyBanner, restorePoster } from './posters.js';
import { syncCollection } from './collection.js';
import { logCleanup, moveToBin } from './recycle.js';

/**
 * Decides what is flagged, keeps posters and the collection in step, and
 * moves titles to the recycle bin when their countdown ends (never while
 * preview mode is on).
 */

type Log = { info: (m: string) => void; warn: (m: string) => void; error: (m: unknown) => void };
const DAY = 86_400_000;

export interface FlagRow {
  id: number;
  item_key: string;
  rule_id: number | null;
  rule_name: string | null;
  reason: string | null;
  detail: string | null;
  flagged_at: number;
  delete_at: number;
  preview: number;
  poster_days: number | null;
  in_collection: number;
  notified: number;
  last_error: string | null;
}

export function daysLeft(deleteAt: number, now = Date.now()) {
  return Math.max(0, Math.ceil((deleteAt - now) / DAY));
}

let evaluating: Promise<EvalResult> | null = null;
let lastResult: EvalResult | null = null;

export interface EvalResult {
  at: number;
  items: number;
  flagged: number;
  newlyFlagged: number;
  cleared: number;
  errors: string[];
}

export function lastEvaluation() {
  return lastResult ?? getState<EvalResult | null>('cleanup:lastEval', null);
}

export function evaluateNow(log: Log, opts: { sync?: boolean } = {}): Promise<EvalResult> {
  if (evaluating) return evaluating;
  evaluating = evaluate(log, opts).finally(() => {
    evaluating = null;
  });
  return evaluating;
}

async function evaluate(log: Log, opts: { sync?: boolean }): Promise<EvalResult> {
  const errors: string[] = [];
  if (opts.sync !== false) {
    try {
      await syncLibrary();
    } catch (err) {
      errors.push(`Library sync: ${(err as Error).message}`);
    }
  }
  const db = getDb();
  const now = Date.now();
  const preview = getSetting('general').previewMode;
  const items = loadItems();
  const facts = buildFacts(items);
  const rules = listRules().filter((r) => r.enabled);

  // What should be flagged right now (first matching rule wins).
  const want = new Map<string, { rule: (typeof rules)[number]; details: MatchDetail[] }>();
  for (const m of items) {
    const f = facts.get(m.key)!;
    if (protectedReason(m, f, now)) continue;
    for (const r of rules) {
      const d = matchRule(r, m, f, now);
      if (d) {
        want.set(m.key, { rule: r, details: d });
        break;
      }
    }
  }

  const existing = new Map((db.prepare('SELECT * FROM flags').all() as FlagRow[]).map((f) => [f.item_key, f]));
  const byKey = new Map(items.map((i) => [i.key, i]));
  let cleared = 0;
  let newly = 0;

  // Unflag what no longer matches (someone watched it, it got protected, the rule changed…).
  for (const [key, f] of existing) {
    if (want.has(key)) continue;
    // Titles you flagged by hand stay flagged unless they become protected or disappear.
    if (f.rule_id == null && byKey.has(key) && !protectedReason(byKey.get(key)!, facts.get(key)!, now)) continue;
    const item = byKey.get(key);
    if (item?.jf_id && f.poster_days != null) await restorePoster(item.jf_id).catch((e) => errors.push(`${item.title}: ${(e as Error).message}`));
    db.prepare('DELETE FROM flags WHERE id = ?').run(f.id);
    const why = item ? (protectedReason(item, facts.get(key)!, now) ?? 'No longer matches the rule (it may have been watched)') : 'No longer in the library';
    logCleanup(key, item?.title ?? null, 'unflagged', why);
    cleared++;
  }

  // Flag new matches.
  const insert = db.prepare(
    `INSERT INTO flags (item_key, rule_id, rule_name, reason, detail, flagged_at, delete_at, preview) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(item_key) DO UPDATE SET rule_id = excluded.rule_id, rule_name = excluded.rule_name, reason = excluded.reason, detail = excluded.detail`,
  );
  for (const [key, w] of want) {
    const ex = existing.get(key);
    if (!ex) newly++;
    insert.run(key, w.rule.id, w.rule.name, w.rule.config.reason, JSON.stringify(w.details), ex?.flagged_at ?? now, ex?.delete_at ?? now + w.rule.config.graceDays * DAY, preview ? 1 : 0);
    if (!ex) logCleanup(key, byKey.get(key)!.title, preview ? 'flagged (preview)' : 'flagged', { rule: w.rule.name, details: w.details });
  }

  // Preview mode switched off: preview flags become real and their countdown starts now.
  if (!preview) {
    const prev = db.prepare('SELECT f.*, r.config FROM flags f LEFT JOIN cleanup_rules r ON r.id = f.rule_id WHERE f.preview = 1').all() as (FlagRow & { config: string | null })[];
    for (const f of prev) {
      const grace = f.config ? ((JSON.parse(f.config) as { graceDays?: number }).graceDays ?? 14) : 14;
      db.prepare('UPDATE flags SET preview = 0, flagged_at = ?, delete_at = ?, notified = 0 WHERE id = ?').run(now, now + grace * DAY, f.id);
    }
  }

  await applyVisuals(preview, errors);
  if (!preview) await announceNewFlags();

  const result: EvalResult = {
    at: now,
    items: items.length,
    flagged: (db.prepare('SELECT COUNT(*) AS n FROM flags').get() as { n: number }).n,
    newlyFlagged: newly,
    cleared,
    errors,
  };
  lastResult = result;
  setState('cleanup:lastEval', result);
  if (errors.length) log.warn(`Cleanup: ${errors.slice(0, 5).join(' | ')}`);
  return result;
}

/** Posters and the Leaving Soon collection. In preview mode both are cleared. */
export async function applyVisuals(preview: boolean, errors: string[] = []) {
  if (!jellyfinReady()) return;
  const db = getDb();
  const s = getSetting('cleanup');
  const now = Date.now();
  const flags = db.prepare('SELECT f.*, m.jf_id, m.title FROM flags f JOIN media_items m ON m.key = f.item_key').all() as (FlagRow & { jf_id: string | null; title: string })[];

  for (const f of flags) {
    if (!f.jf_id) continue;
    const showBanner = !preview && !f.preview && s.posters.enabled;
    const d = daysLeft(f.delete_at, now);
    try {
      if (showBanner && f.poster_days !== d) {
        await applyBanner(f.jf_id, d, f.reason ?? '', s.posters.color);
        db.prepare('UPDATE flags SET poster_days = ?, last_error = NULL WHERE id = ?').run(d, f.id);
      } else if (!showBanner && f.poster_days != null) {
        await restorePoster(f.jf_id);
        db.prepare('UPDATE flags SET poster_days = NULL WHERE id = ?').run(f.id);
      }
    } catch (err) {
      const msg = `Poster: ${(err as Error).message}`;
      db.prepare('UPDATE flags SET last_error = ? WHERE id = ?').run(msg, f.id);
      errors.push(`${f.title}: ${msg}`);
    }
  }

  try {
    const ids = !preview && s.collection.enabled ? flags.filter((f) => !f.preview && f.jf_id).map((f) => f.jf_id!) : [];
    await syncCollection(s.collection.name || 'Leaving Soon', ids);
    db.prepare('UPDATE flags SET in_collection = CASE WHEN preview = 0 AND ? = 1 THEN 1 ELSE 0 END').run(ids.length ? 1 : 0);
  } catch (err) {
    errors.push(`Collection: ${(err as Error).message}`);
  }
}

async function announceNewFlags() {
  const db = getDb();
  const fresh = db
    .prepare('SELECT f.*, m.title, m.year FROM flags f JOIN media_items m ON m.key = f.item_key WHERE f.preview = 0 AND f.notified = 0 ORDER BY f.delete_at')
    .all() as (FlagRow & { title: string; year: number | null })[];
  if (!fresh.length) return;
  db.prepare('UPDATE flags SET notified = 1 WHERE preview = 0 AND notified = 0').run();
  if (!getSetting('notify').events.flagged) return;
  const lines = fresh.slice(0, 25).map((f) => `• ${f.title}${f.year ? ` (${f.year})` : ''} — in ${daysLeft(f.delete_at)} days`);
  const fam = familyLink();
  await notify({
    title: `${fresh.length} title${fresh.length === 1 ? '' : 's'} marked for removal`,
    text: `${lines.join('\n')}${fresh.length > 25 ? `\n…and ${fresh.length - 25} more` : ''}`,
    link: '/leaving',
    fields: fam ? [{ name: 'Family page', value: 'Family can ask to keep titles from the Leaving Soon page.' }] : undefined,
    severity: 'warning',
    event: 'cleanup.flagged',
  });
}

/** Moves titles whose countdown has ended. Never runs in preview mode. */
export async function runMover(log: Log) {
  if (getSetting('general').previewMode) return;
  const db = getDb();
  const due = db
    .prepare('SELECT f.*, m.* FROM flags f JOIN media_items m ON m.key = f.item_key WHERE f.preview = 0 AND f.delete_at <= ? ORDER BY f.delete_at LIMIT 25')
    .all(Date.now()) as (FlagRow & MediaRow)[];
  const moved: string[] = [];
  for (const row of due) {
    try {
      await moveToBin(row, row.rule_name);
      moved.push(row.title);
    } catch (err) {
      const msg = (err as Error).message;
      db.prepare('UPDATE flags SET last_error = ? WHERE item_key = ?').run(msg, row.key);
      log.warn(`Couldn't move ${row.title}: ${msg}`);
    }
  }
  if (moved.length) {
    await applyVisuals(false).catch(() => undefined);
    if (getSetting('notify').events.moved) {
      await notify({
        title: `${moved.length} title${moved.length === 1 ? '' : 's'} moved to the recycle bin`,
        text: `${moved.map((t) => `• ${t}`).join('\n')}\n\nNothing has been deleted — restore or empty the recycle bin whenever you like.`,
        link: '/recycle',
        severity: 'info',
        event: 'cleanup.moved',
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Weekly digest (admin + optionally family)
// ---------------------------------------------------------------------------

async function weeklyDigest() {
  const s = getSetting('notify');
  const db = getDb();
  const flags = db
    .prepare('SELECT f.delete_at, m.title, m.year FROM flags f JOIN media_items m ON m.key = f.item_key WHERE f.preview = 0 ORDER BY f.delete_at')
    .all() as { delete_at: number; title: string; year: number | null }[];
  const bin = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(size_bytes), 0) AS bytes FROM recycle_bin WHERE status = 'in_bin'`).get() as { n: number; bytes: number };
  const alerts = (db.prepare('SELECT COUNT(*) AS n FROM alerts WHERE acknowledged_at IS NULL AND dismissed = 0').get() as { n: number }).n;
  const lines = flags.slice(0, 30).map((f) => `• ${f.title}${f.year ? ` (${f.year})` : ''} — in ${daysLeft(f.delete_at)} days`);
  if (s.events.digest) {
    await notify({
      title: 'Your weekly CoastGuarrd summary',
      text: `${flags.length ? `Leaving soon:\n${lines.join('\n')}` : 'Nothing is marked for removal.'}`,
      fields: [
        { name: 'Recycle bin', value: `${bin.n} titles · ${(bin.bytes / 1024 ** 3).toFixed(1)} GB you can free` },
        { name: 'Open alerts', value: String(alerts) },
      ],
      link: '/leaving',
      severity: 'info',
      event: 'digest.weekly',
    });
  }
  const fam = familyLink();
  if (s.family.emailDigest && s.email.enabled && s.email.host && flags.length) {
    for (const to of familyEmails()) {
      await sendEmail(
        to,
        {
          title: 'Leaving the media server soon',
          text: `These titles haven’t been watched in a while and will be removed soon:\n\n${lines.join('\n')}${fam ? '\n\nWant to keep one? Open the page below and tap “Keep it”.' : '\n\nWant to keep one? Just let the server owner know.'}`,
          link: fam ?? undefined,
          event: 'digest.family',
        },
        s,
      ).catch(() => undefined);
    }
  }
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export function startCleanup(log: Log) {
  // Rules: shortly after start, then every N hours.
  const scheduleEval = () => {
    const hours = Math.max(1, Math.min(48, getSetting('cleanup').evaluateHours));
    const t = setTimeout(async () => {
      await evaluateNow(log).catch((e) => log.error(e));
      scheduleEval();
    }, hours * 3_600_000);
    t.unref();
  };
  setTimeout(() => void evaluateNow(log).catch((e) => log.error(e)), 90_000).unref();
  scheduleEval();

  // Countdown banners change once a day: refresh posters every hour (cheap — only changed days are redrawn).
  setInterval(() => void applyVisuals(getSetting('general').previewMode).catch((e) => log.error(e)), 3_600_000).unref();

  // Moving: check every 30 minutes.
  setInterval(() => void runMover(log).catch((e) => log.error(e)), 30 * 60_000).unref();
  setTimeout(() => void runMover(log).catch((e) => log.error(e)), 5 * 60_000).unref();

  // Weekly digest: Sundays at 10am local time.
  setInterval(() => {
    const d = new Date();
    if (d.getDay() !== 0 || d.getHours() !== 10) return;
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (getState('digest:last', '') === key) return;
    setState('digest:last', key);
    void weeklyDigest().catch((e) => log.error(e));
  }, 10 * 60_000).unref();
}

export { weeklyDigest };
