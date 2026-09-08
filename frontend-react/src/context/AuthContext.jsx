import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { apiFetch, getToken, setToken, clearToken } from '../api.js';

const AuthContext = createContext(null);

// status: 'loading' (checking a saved token) | 'guest' (show login/signup)
// | 'authed' (user is confirmed, safe to render the game)
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      const token = getToken();
      if (!token) {
        if (!cancelled) setStatus('guest');
        return;
      }
      try {
        const data = await apiFetch('/auth/me', { method: 'GET' });
        if (!cancelled) {
          setUser(data.user);
          setStatus('authed');
        }
      } catch (e) {
        // token invalid/expired — clear it and let the player log in again
        clearToken();
        if (!cancelled) setStatus('guest');
      }
    }
    boot();
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (username, password) => {
    const data = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    setToken(data.token);
    setUser(data.user);
    setStatus('authed');
    return data.user;
  }, []);

  const signup = useCallback(async (username, password) => {
    const data = await apiFetch('/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    setToken(data.token);
    setUser(data.user);
    setStatus('authed');
    return data.user;
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
    setStatus('guest');
  }, []);

  // Final report of a completed run (increments gamesPlayed/totalBounces server-side).
  const submitScore = useCallback((height, bounces) => {
    return apiFetch('/scores', {
      method: 'POST',
      body: JSON.stringify({ height, bounces, final: true }),
    });
  }, []);

  // Lightweight ping sent whenever a new personal-best altitude is passed
  // mid-run — only raises highScore, doesn't touch gamesPlayed/totalBounces.
  const reportProgress = useCallback((height) => {
    return apiFetch('/scores', {
      method: 'POST',
      body: JSON.stringify({ height, final: false }),
    });
  }, []);

  const getLeaderboard = useCallback((limit) => {
    return apiFetch('/scores/leaderboard' + (limit ? ('?limit=' + limit) : ''), { method: 'GET' });
  }, []);

  const value = { user, status, login, signup, logout, submitScore, reportProgress, getLeaderboard };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
