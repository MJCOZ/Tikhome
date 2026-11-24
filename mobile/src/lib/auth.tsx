import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api, loadToken, setToken, Plan, User } from './api';

type Ctx = {
  user: User | null; plan: Plan | null; unread: number; ready: boolean;
  refresh: () => Promise<void>;
  login: (phone: string, password: string) => Promise<void>;
  register: (name: string, phone: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};
const AuthContext = createContext<Ctx>(null as unknown as Ctx);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [unread, setUnread] = useState(0);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const d = await api<{ user: User | null; plan: Plan | null; unread: number }>('/api/me');
      setUser(d.user); setPlan(d.plan); setUnread(d.unread || 0);
      if (!d.user) await setToken(null);
    } catch { /* نبقي الحالة كما هي عند انقطاع الشبكة */ }
  }, []);

  useEffect(() => { (async () => { if (await loadToken()) await refresh(); setReady(true); })(); }, [refresh]);

  const login = async (phone: string, password: string) => {
    const d = await api<{ user: User; token: string }>('/api/auth/login', { method: 'POST', body: { phone, password } });
    await setToken(d.token); setUser(d.user); await refresh();
  };
  const register = async (name: string, phone: string, password: string) => {
    const d = await api<{ user: User; token: string }>('/api/auth/register', { method: 'POST', body: { name, phone, password } });
    await setToken(d.token); setUser(d.user); await refresh();
  };
  const logout = async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* */ }
    await setToken(null); setUser(null); setPlan(null); setUnread(0);
  };
  return <AuthContext.Provider value={{ user, plan, unread, ready, refresh, login, register, logout }}>{children}</AuthContext.Provider>;
}
