import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import DebugErrorLog from './pages/DebugErrorLog.jsx'
import AdminObservability from './pages/AdminObservability.jsx'
import ResetPasswordPage from './pages/ResetPasswordPage.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

// ── Client-side error reporting to the /debug page ─────────────────────────
// Only warnings, errors, uncaught exceptions, and unhandled rejections are
// mirrored (the old version POSTed every console.log — hundreds of HTTP
// requests just from scrolling the table). Entries are queued and flushed in
// small batches so bursts of errors cost one request, not one each.
const _logQueue = [];
let _flushTimer = null;
const FLUSH_MS = 2000;
const MAX_BATCH = 20;
const MAX_QUEUE = 100;

function _flushLogs() {
  _flushTimer = null;
  if (!_logQueue.length) return;
  const entries = _logQueue.splice(0, MAX_BATCH);
  fetch('/api/debug/errors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries }),
    keepalive: true,
  }).catch(() => {});
  if (_logQueue.length && !_flushTimer) {
    _flushTimer = setTimeout(_flushLogs, FLUSH_MS);
  }
}

function _enqueueLog(entry) {
  if (_logQueue.length >= MAX_QUEUE) return; // shed under a runaway error loop
  _logQueue.push(entry);
  if (!_flushTimer) _flushTimer = setTimeout(_flushLogs, FLUSH_MS);
}

function reportError(message, error) {
  _enqueueLog({
    message: String(message).slice(0, 1000),
    stack: (error?.stack || error?.message || '').slice(0, 2000),
    url: window.location.href,
  });
}

window.addEventListener('error', (event) => {
  reportError(event.message || 'Uncaught error', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  // Aborted fetches/streams (navigate away, cancel gather, new DR symbol) are expected.
  if (reason?.name === 'AbortError' || reason?.code === 20) {
    event.preventDefault();
    return;
  }
  reportError('Unhandled promise rejection', reason);
});

// Mirror console.warn/error (NOT log/info) to the /debug page.
// Originals are preserved so DevTools still works as expected.
const _origConsole = {
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};
function _formatArg(a) {
  if (a == null) return String(a);
  if (typeof a === 'string') return a;
  if (a instanceof Error) return a.stack || a.message;
  try { return JSON.stringify(a); } catch { return String(a); }
}
function _postConsole(level, args) {
  try {
    const message = `[${level}] ${args.map(_formatArg).join(' ').slice(0, 1000)}`;
    _enqueueLog({ message, level, url: window.location.href });
  } catch { /* never break the app over logging */ }
}
console.warn  = (...a) => { _origConsole.warn(...a);  _postConsole('warn', a); };
console.error = (...a) => { _origConsole.error(...a); _postConsole('error', a); };

const root = createRoot(document.getElementById('root'));

if (window.location.pathname === '/debug') {
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <DebugErrorLog />
      </ErrorBoundary>
    </StrictMode>
  );
} else if (window.location.pathname === '/admin/observability') {
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <AdminObservability />
      </ErrorBoundary>
    </StrictMode>
  );
} else if (window.location.pathname === '/reset') {
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <ResetPasswordPage />
      </ErrorBoundary>
    </StrictMode>
  );
} else {
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>
  );
}
