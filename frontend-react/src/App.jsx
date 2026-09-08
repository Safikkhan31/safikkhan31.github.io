import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import AuthScreen from './components/AuthScreen.jsx';
import Game from './components/Game.jsx';
import AdSlot from './components/AdSlot.jsx';

function AppInner() {
  const { user, status, logout, submitScore, reportProgress } = useAuth();

  return (
    <div id="appRoot">
      {status === 'authed' ? (
        <Game user={user} onLogout={logout} onSubmitScore={submitScore} onReportProgress={reportProgress} />
      ) : (
        // While status === 'loading' (checking a saved token) we simply show
        // the auth screen underneath — matches the original, where the auth
        // overlay was already in the DOM and just stayed visible until
        // resolved.
        <AuthScreen />
      )}
      <AdSlot />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}
