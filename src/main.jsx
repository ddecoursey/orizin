import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import DebugErrorLog from './pages/DebugErrorLog.jsx'

// Capture uncaught errors and promise rejections and send to debug endpoint
function reportError(message, error) {
  const payload = {
    message: String(message),
    stack: error?.stack || error?.message,
    url: window.location.href,
  };

  fetch('/api/debug/errors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {}); // don't crash on logging failure
}

window.addEventListener('error', (event) => {
  reportError(event.message || 'Uncaught error', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  reportError('Unhandled promise rejection', event.reason);
});

// Mirror every console.log/info/warn/error to the /debug page.
// Originals are preserved so DevTools still works as expected.
const _origConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
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
    const message = `[${level}] ${args.map(_formatArg).join(' ')}`;
    fetch('/api/debug/errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, level, url: window.location.href }),
    }).catch(() => {});
  } catch {}
}
console.log   = (...a) => { _origConsole.log(...a);   _postConsole('log', a); };
console.info  = (...a) => { _origConsole.info(...a);  _postConsole('info', a); };
console.warn  = (...a) => { _origConsole.warn(...a);  _postConsole('warn', a); };
console.error = (...a) => { _origConsole.error(...a); _postConsole('error', a); };

const root = createRoot(document.getElementById('root'));

if (window.location.pathname === '/debug') {
  root.render(
    <StrictMode>
      <DebugErrorLog />
    </StrictMode>
  );
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}
