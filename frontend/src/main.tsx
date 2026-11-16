import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { errorText, request, type ObjectKind, type Session } from './api';
import { Auth } from './auth';
import { Button } from './ui';
import { Workspace, workspaceKinds, type WorkspaceRoute } from './workspace';
import './style.css';
import './futuristic.css';
import './universal-theme.css';
import './workflow-motion.css';
import './configuration.css';
import './node-settings.css';
import './command-center.css';
import './earth-fleet.css';

function workspaceRoute(path: string): WorkspaceRoute | null {
  if (/^\/dashboard\/?$/.test(path.toLowerCase())) return { kind: 'dashboard' };
  if (/^\/devices\/?$/.test(path.toLowerCase())) return { kind: 'devices' };
  const control = /^\/runs\/([\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12})\/chat\/?$/.exec(path.toLowerCase());
  if (control) return { kind: 'repair', id: control[1] };
  const run = /^\/runs(?:\/(new|[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}))?\/?$/.exec(path.toLowerCase());
  if (run) return { kind: 'runs', id: run[1] === 'new' ? undefined : run[1], creating: run[1] === 'new' };
  const match = /^\/(requirements|flows|agents)(?:\/(new|[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}))?\/?$/.exec(path.toLowerCase());
  if (!match || !(match[1] in workspaceKinds)) return null;
  return { kind: match[1] as ObjectKind, id: match[2] === 'new' ? undefined : match[2],
    creating: match[2] === 'new' };
}

function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const activePath = useRef(window.location.pathname);
  const popGuard = useRef<(() => boolean) | null>(null);
  const registerPopGuard = useCallback((guard: (() => boolean) | null) => { popGuard.current = guard; }, []);

  const navigate = useCallback((next: string, replace = false) => {
    if (next === window.location.pathname) return;
    if (replace) window.history.replaceState(null, '', next);
    else window.history.pushState(null, '', next);
    activePath.current = next;
    setPath(next);
  }, []);

  useEffect(() => {
    const onPop = () => {
      const next = window.location.pathname;
      if (next === activePath.current) return;
      if (popGuard.current && !popGuard.current()) {
        // Restore the visible route without unmounting a draft or losing an uncertain launch command.
        window.history.pushState(null, '', activePath.current);
        return;
      }
      activePath.current = next;
      setPath(next);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    const control = new AbortController();
    request<Session>('/me', { signal: control.signal })
      .then(current => { if (!control.signal.aborted) setSession(current); })
      .catch(err => { if (!control.signal.aborted) setError(errorText(err)); });
    return () => control.abort();
  }, [retry]);

  useEffect(() => {
    if (!session) return;
    if (session.user && !workspaceRoute(path)) navigate('/dashboard', true);
    else if (!session.user && path !== '/login' && path !== '/register') {
      navigate('/login', true);
    }
  }, [navigate, path, session]);

  const endSession = useCallback(() => {
    setSession({ user: null, csrfToken: null });
    navigate('/login', true);
  }, [navigate]);

  function login(current: Session) {
    setSession(current);
    if (current.user) {
      navigate('/dashboard', true);
      }
  }

  if (!session) return <main className="boot">
    <h1>AgentShip</h1>
    {error ? <div className="grid"><p role="alert" className="inline-error">{error}</p>
      <div><Button onClick={() => { setError(''); setRetry(n => n + 1); }}>Retry connection</Button></div>
    </div> : <p role="status">Reading session...</p>}
  </main>;

  if (!session.user || !session.csrfToken) {
    return <Auth route={path === '/register' ? 'register' : 'login'} navigate={navigate} onLogin={login} />;
  }

  return <Workspace key={session.user.id} route={workspaceRoute(path) ?? { kind: 'dashboard' }}
    session={{ user: session.user, csrfToken: session.csrfToken }} navigate={navigate} onSessionEnd={endSession} registerPopGuard={registerPopGuard} />;
}

const container = document.getElementById('app');
if (container) createRoot(container).render(<App />);
