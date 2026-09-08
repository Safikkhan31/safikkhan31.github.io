// ---------------------------------------------------------------------------
// Ascent — API client
// Ported from the vanilla frontend's auth.js apiFetch/token helpers.
// ---------------------------------------------------------------------------

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';

const TOKEN_KEY = 'ascent_token';

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
}
export function setToken(token) {
  try { localStorage.setItem(TOKEN_KEY, token); } catch (e) { /* ignore */ }
}
export function clearToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
}

export async function apiFetch(path, options) {
  const opts = options || {};
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  const token = getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;

  const res = await fetch(API_BASE_URL + path, Object.assign({}, opts, { headers }));
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }

  if (!res.ok) {
    const message = (data && data.message) || ('Request failed (' + res.status + ')');
    throw new Error(message);
  }
  return data;
}
