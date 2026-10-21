/** Small fetch wrapper with a timeout and friendly error messages. */
export class ServiceError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

export function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + (path.startsWith('/') ? path : '/' + path);
}

export async function httpJson<T = unknown>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 10_000);
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { Accept: 'application/json', ...(init.headers ?? {}) },
    });
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } };
    if (e.name === 'AbortError') throw new ServiceError('No answer in time. Check the address and port.');
    const code = e.cause?.code;
    if (code === 'ECONNREFUSED') throw new ServiceError('Connection refused. Is the app running on that port?');
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') throw new ServiceError('That address could not be found.');
    if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') throw new ServiceError('That address is not reachable from CoastGuarrd.');
    throw new ServiceError(`Could not connect: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 || res.status === 403) throw new ServiceError('The API key was rejected.', res.status);
  if (res.status === 404) throw new ServiceError('Connected, but this does not look like the right app (404).', 404);
  if (!res.ok) throw new ServiceError(`The app answered with an error (${res.status}).`, res.status);
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ServiceError('Connected, but the answer was not what CoastGuarrd expected. Is this the right app?');
  }
}
