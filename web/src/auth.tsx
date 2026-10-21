import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { get, post, SESSION_EXPIRED, type AuthStatus } from './api';

interface AuthCtx {
  status: AuthStatus | null;
  refresh: () => Promise<AuthStatus>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);

  const refresh = useCallback(async () => {
    const s = await get<AuthStatus>('/api/auth/status');
    setStatus(s);
    return s;
  }, []);

  const logout = useCallback(async () => {
    await post('/api/auth/logout').catch(() => undefined);
    await refresh();
  }, [refresh]);

  useEffect(() => {
    refresh().catch(() => setStatus({ needsAccount: false, setupComplete: false, user: null }));
    const onExpired = () => void refresh();
    window.addEventListener(SESSION_EXPIRED, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED, onExpired);
  }, [refresh]);

  return <Ctx.Provider value={{ status, refresh, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
