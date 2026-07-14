// Thin client for the per-user settings blob persisted server-side
// (GET/PUT /api/settings). Reads hydrate app state so it follows the account
// across devices; writes are debounced + coalesced so rapid changes (slider
// drags, repeated filter edits) collapse into a single request. Server-side the
// PUT is a shallow merge, so independent callers only send the keys they own.

export async function fetchUserSettings() {
  try {
    const res = await fetch("/api/settings");
    if (!res.ok) return {};
    const data = await res.json();
    return data?.data || {};
  } catch {
    return {};
  }
}

let pending = {};
let timer = null;

function flush() {
  timer = null;
  const body = pending;
  pending = {};
  if (!Object.keys(body).length) return Promise.resolve();
  return fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {
    // Best-effort: the localStorage mirror in callers keeps this device working.
  });
}

export function patchUserSettings(partial) {
  if (!partial || typeof partial !== "object") return;
  pending = { ...pending, ...partial };
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, 600);
}

// Force any pending write to go out immediately.
export function flushUserSettings() {
  if (timer) {
    clearTimeout(timer);
    return flush();
  }
  return Promise.resolve();
}

export function discardPendingUserSettings() {
  if (timer) clearTimeout(timer);
  timer = null;
  pending = {};
}
