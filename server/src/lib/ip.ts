import net from 'node:net';
import type { FastifyRequest } from 'fastify';
import { getSetting } from './settings.js';

/** Strips the IPv6 wrapper Node puts around IPv4 addresses (::ffff:1.2.3.4). */
export function normalizeIp(ip: string | undefined | null): string {
  if (!ip) return '';
  const trimmed = ip.trim();
  return trimmed.startsWith('::ffff:') ? trimmed.slice(7) : trimmed;
}

/** True for loopback, private LAN, link-local, CGNAT and Docker-style addresses. */
export function isPrivateIp(ip: string): boolean {
  const addr = normalizeIp(ip);
  if (net.isIPv4(addr)) {
    const [a, b] = addr.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (net.isIPv6(addr)) {
    const lower = addr.toLowerCase();
    return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
  }
  return false;
}

/**
 * The visitor's real address. When CoastGuarrd sits behind a tunnel or
 * reverse proxy on the local network, the proxy's headers are used; headers
 * sent from anywhere else are ignored so they can't be faked.
 */
export function clientIp(req: FastifyRequest): string {
  const peer = normalizeIp(req.socket.remoteAddress);
  if (!getSetting('security').trustProxyHeaders || !isPrivateIp(peer)) return peer;

  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && net.isIP(cf.trim())) return normalizeIp(cf);

  const xff = req.headers['x-forwarded-for'];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
  if (first && net.isIP(first)) return normalizeIp(first);

  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && net.isIP(real.trim())) return normalizeIp(real);

  return peer;
}

/** Whether the visitor reached us over HTTPS (directly or via a trusted proxy). */
export function isHttps(req: FastifyRequest): boolean {
  if (req.protocol === 'https') return true;
  const peer = normalizeIp(req.socket.remoteAddress);
  if (!isPrivateIp(peer)) return false;
  const proto = req.headers['x-forwarded-proto'];
  return (Array.isArray(proto) ? proto[0] : proto)?.split(',')[0]?.trim() === 'https';
}
