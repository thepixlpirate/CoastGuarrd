import { useCallback, useEffect, useRef, useState } from 'react';
import { get } from '../api';

/**
 * Loads a URL and keeps it fresh. Pauses while the tab is hidden.
 * `intervalMs` of 0 loads once.
 */
export function usePoll<T>(url: string | null, intervalMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const urlRef = useRef(url);
  urlRef.current = url;

  const load = useCallback(async () => {
    const u = urlRef.current;
    if (!u) return;
    try {
      const d = await get<T>(u);
      if (urlRef.current === u) {
        setData(d);
        setError('');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void load();
    if (!intervalMs) return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, intervalMs);
    const onVis = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [url, intervalMs, load]);

  return { data, error, loading, reload: load, setData };
}
