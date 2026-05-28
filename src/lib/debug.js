// Send a diagnostic log entry to the backend debug endpoint so it shows up
// on the /debug page. Fire-and-forget; never throws.
export function debugLog(message, details = {}) {
  try {
    fetch('/api/debug/errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: String(message), ...details }),
    }).catch(() => {});
  } catch {}
}
