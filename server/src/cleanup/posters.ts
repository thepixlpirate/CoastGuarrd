import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { config } from '../config.js';
import { jf, jfRaw } from '../jellyfin/client.js';

/**
 * Draws the angled "MARKED FOR REMOVAL IN X DAYS" banner on posters.
 * The original poster is saved to /config/posters first and put back when
 * the title is kept, watched, unflagged, or before its files are moved.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
// Works from src/ (dev) and dist/ (built).
const FONT_DIR = [path.resolve(here, '../../assets/fonts'), path.resolve(process.cwd(), 'assets/fonts')].find((p) => fs.existsSync(p)) ?? '';
const FONT_BOLD = path.join(FONT_DIR, 'Inter-ExtraBold.otf');
const FONT_SEMI = path.join(FONT_DIR, 'Inter-SemiBold.otf');

const COLORS: Record<string, [string, string]> = {
  red: ['#e11d48', '#9f1239'],
  purple: ['#8b5cf6', '#5b21b6'],
  teal: ['#0d9488', '#115e59'],
  black: ['#27272a', '#09090b'],
};

const backupDir = () => path.join(config.dataDir, 'posters');
export const backupPath = (jfId: string) => path.join(backupDir(), `${jfId.replace(/[^a-zA-Z0-9-]/g, '')}.img`);

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

async function textImage(markup: string, font: string, fontfile: string, size: number, maxWidth: number) {
  const img = sharp({ text: { text: `<span foreground="white">${markup}</span>`, font: `${font} ${Math.round(size)}`, fontfile, rgba: true, dpi: 72 } });
  const buf = await img.png().toBuffer({ resolveWithObject: true });
  if (buf.info.width <= maxWidth) return buf;
  const scaled = await sharp(buf.data).resize({ width: Math.floor(maxWidth) }).png().toBuffer({ resolveWithObject: true });
  return scaled;
}

export function daysLabel(days: number) {
  return days <= 0 ? 'TODAY' : days === 1 ? 'IN 1 DAY' : `IN ${days} DAYS`;
}

/** Returns a JPEG of the poster with the banner drawn on it. */
export async function renderBanner(poster: Buffer, days: number, reason: string, color: string): Promise<Buffer> {
  const base = sharp(poster).rotate();
  const meta = await base.metadata();
  let W = meta.width ?? 600;
  let H = meta.height ?? 900;
  // Work at a sensible size so text is crisp but files stay small.
  const target = Math.min(1000, Math.max(600, W));
  const scale = target / W;
  W = Math.round(W * scale);
  H = Math.round(H * scale);
  const resized = await base.resize(W, H).toBuffer();

  const [c1, c2] = COLORS[color] ?? COLORS.red;
  const bandW = Math.round(W * 1.7);
  const bandH = Math.round(Math.max(W * 0.2, H * 0.13));
  const pad = Math.round(bandH * 0.08);
  const usable = W * 0.86;

  const line1 = await textImage(`MARKED FOR REMOVAL ${esc(daysLabel(days))}`, 'Inter ExtraBold', FONT_BOLD, bandH * 0.3, usable);
  const line2 = reason.trim() ? await textImage(esc(reason.trim()), 'Inter SemiBold', FONT_SEMI, bandH * 0.2, usable) : null;

  const bandSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${bandW}" height="${bandH + pad * 4}">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
        <filter id="s" x="-5%" y="-30%" width="110%" height="160%"><feDropShadow dx="0" dy="${pad * 0.6}" stdDeviation="${pad * 0.9}" flood-color="#000" flood-opacity="0.55"/></filter>
      </defs>
      <g filter="url(#s)">
        <rect x="0" y="${pad * 2}" width="${bandW}" height="${bandH}" fill="url(#g)"/>
        <rect x="0" y="${pad * 2 + pad * 0.6}" width="${bandW}" height="${Math.max(2, pad * 0.25)}" fill="#fff" opacity="0.55"/>
        <rect x="0" y="${pad * 2 + bandH - pad * 0.85}" width="${bandW}" height="${Math.max(2, pad * 0.25)}" fill="#fff" opacity="0.55"/>
      </g>
    </svg>`,
  );

  const gap = Math.round(bandH * 0.07);
  const textH = line1.info.height + (line2 ? gap + line2.info.height : 0);
  const top = pad * 2 + Math.round((bandH - textH) / 2);
  const band = await sharp(bandSvg)
    .composite([
      { input: line1.data, left: Math.round((bandW - line1.info.width) / 2), top },
      ...(line2 ? [{ input: line2.data, left: Math.round((bandW - line2.info.width) / 2), top: top + line1.info.height + gap }] : []),
    ])
    .png()
    .toBuffer();

  const rotated = await sharp(band).rotate(-12, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer({ resolveWithObject: true });
  // Centre the band about two-thirds of the way down, then crop to the poster.
  const cx = W / 2;
  const cy = H * 0.68;
  const left = Math.round(cx - rotated.info.width / 2);
  const topPos = Math.round(cy - rotated.info.height / 2);
  const cropLeft = Math.max(0, -left);
  const cropTop = Math.max(0, -topPos);
  const visW = Math.min(rotated.info.width - cropLeft, W - Math.max(0, left));
  const visH = Math.min(rotated.info.height - cropTop, H - Math.max(0, topPos));
  const piece = await sharp(rotated.data).extract({ left: cropLeft, top: cropTop, width: visW, height: visH }).png().toBuffer();

  return sharp(resized)
    .composite([{ input: piece, left: Math.max(0, left), top: Math.max(0, topPos) }])
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}

async function downloadPoster(jfId: string): Promise<Buffer | null> {
  const res = await jfRaw(`/Items/${jfId}/Images/Primary`);
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

async function uploadPoster(jfId: string, img: Buffer, contentType = 'image/jpeg') {
  // Jellyfin expects the image as base64 text in the request body.
  await jf(`/Items/${jfId}/Images/Primary`, { method: 'POST', body: img.toString('base64'), headers: { 'Content-Type': contentType } });
}

function sniffType(buf: Buffer) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf.slice(0, 4).toString() === 'RIFF') return 'image/webp';
  return 'image/jpeg';
}

/** Saves the original poster (once) and uploads a bannered copy. */
export async function applyBanner(jfId: string, days: number, reason: string, color: string) {
  fs.mkdirSync(backupDir(), { recursive: true });
  const bp = backupPath(jfId);
  let original: Buffer | null = fs.existsSync(bp) ? fs.readFileSync(bp) : null;
  if (!original) {
    original = await downloadPoster(jfId);
    if (!original) throw new Error('This title has no poster in Jellyfin.');
    fs.writeFileSync(bp, original);
  }
  await uploadPoster(jfId, await renderBanner(original, days, reason, color));
}

/** Puts the original poster back and forgets the backup. */
export async function restorePoster(jfId: string, keepBackup = false) {
  const bp = backupPath(jfId);
  if (!fs.existsSync(bp)) return;
  const original = fs.readFileSync(bp);
  await uploadPoster(jfId, original, sniffType(original));
  if (!keepBackup) fs.rmSync(bp, { force: true });
}

/** Banner preview for the web page (doesn't change anything in Jellyfin). */
export async function previewBanner(jfId: string, days: number, reason: string, color: string): Promise<Buffer | null> {
  const bp = backupPath(jfId);
  const original = fs.existsSync(bp) ? fs.readFileSync(bp) : await downloadPoster(jfId);
  if (!original) return null;
  return renderBanner(original, days, reason, color);
}
