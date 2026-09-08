import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

export default function AuthScreen() {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function switchMode(next) {
    setMode(next);
    setError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(username.trim(), password);
      } else {
        await signup(username.trim(), password);
      }
      // On success, AuthProvider flips status to 'authed' and App swaps
      // this screen out for the game — nothing else to do here.
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="overlay" id="authOverlay">
      <div className="card">
        <h1>{mode === 'login' ? 'Log in' : 'Create an account'}</h1>
        <p>Sign in to save your high score and climb the leaderboard.</p>

        <form className="authForm" onSubmit={handleSubmit}>
          <label htmlFor="authUsername">Username</label>
          <input
            id="authUsername"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
            minLength={3}
            maxLength={20}
            pattern={mode === 'signup' ? '[a-zA-Z0-9_]+' : undefined}
            title={mode === 'signup' ? 'Letters, numbers, and underscores only' : undefined}
          />
          <label htmlFor="authPassword">Password</label>
          <input
            id="authPassword"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={6}
          />
          <p className="authError">{error}</p>
          <button type="submit" className="primary authSubmit" disabled={submitting}>
            {submitting ? 'Please wait…' : (mode === 'login' ? 'Log in' : 'Sign up')}
          </button>
        </form>

        <div className="authSwitch">
          {mode === 'login' ? (
            <span>New here? <a onClick={() => switchMode('signup')}>Create an account</a></span>
          ) : (
            <span>Already have an account? <a onClick={() => switchMode('login')}>Log in</a></span>
          )}
        </div>
      </div>
    </div>
  );
}
