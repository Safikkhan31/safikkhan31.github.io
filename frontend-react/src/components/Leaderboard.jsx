import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

export default function Leaderboard({ onClose }) {
  const { getLeaderboard } = useAuth();
  const [entries, setEntries] = useState(null); // null = loading
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getLeaderboard(10)
      .then((data) => {
        if (cancelled) return;
        setEntries((data && data.leaderboard) || []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message || 'Could not load the leaderboard.');
        setEntries([]);
      });
    return () => { cancelled = true; };
  }, [getLeaderboard]);

  return (
    <div id="leaderboardPage">
      <div id="lbHeader">
        <h1>Leaderboard</h1>
        <button id="lbBackBtn" onClick={onClose}>Back to game</button>
      </div>
      <div id="lbListWrap">
        {entries === null && <p id="lbLoading">Loading…</p>}
        {error && <p className="authError">{error}</p>}
        {entries && entries.length === 0 && !error && (
          <p id="lbEmpty">No scores yet — be the first to climb!</p>
        )}
        {entries && entries.length > 0 && (
          <ul id="lbList">
            {entries.map((entry) => (
              <li key={entry.username} className={entry.rank <= 3 ? 'lb-rank-' + entry.rank : undefined}>
                <span className="lb-rank-num">{entry.rank}</span>
                <span className="lb-name">{entry.username}</span>
                <span className="lb-score">{entry.highScore}m</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
