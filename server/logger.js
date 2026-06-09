// Simple in-memory error logger for debugging + admin UI.
// Used by both main server and background enrichment.

const errorLog = [];
const MAX_ERRORS = 200;

export function logError(message, details = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    message,
    ...details,
  };
  errorLog.unshift(entry);
  if (errorLog.length > MAX_ERRORS) {
    errorLog.pop();
  }
  console.error(`[DEBUG ERROR] ${message}`, details);
}

export function getErrors(limit = 100) {
  return errorLog.slice(0, limit);
}

export function clearErrors() {
  const count = errorLog.length;
  errorLog.length = 0;
  return count;
}
