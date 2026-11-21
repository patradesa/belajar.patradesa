import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { MeResponse } from '@patradesa/shared';
import { ApiError, api, setCsrfToken } from './api';

interface SessionState {
  me: MeResponse | null;
  loading: boolean;
  refresh: () => Promise<MeResponse | null>;
  logout: () => Promise<void>;
}

const Ctx = createContext<SessionState>({
  me: null,
  loading: true,
  refresh: async () => null,
  logout: async () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const m = await api<MeResponse>('/me');
      setCsrfToken(m.csrfToken);
      setMe(m);
      return m;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setCsrfToken(null);
        setMe(null);
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } finally {
      setCsrfToken(null);
      setMe(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return <Ctx.Provider value={{ me, loading, refresh, logout }}>{children}</Ctx.Provider>;
}

export function useSession(): SessionState {
  return useContext(Ctx);
}

export function hasRole(me: MeResponse | null, ...roles: string[]): boolean {
  return !!me && (me.roles.includes('super_admin') || roles.some((r) => me.roles.includes(r as never)));
}
