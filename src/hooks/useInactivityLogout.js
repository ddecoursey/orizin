import { useEffect, useRef } from "react";

const POLL_MS = 5 * 60 * 1000;
const DEFAULT_MINUTES = 60;

/**
 * Signs the user out after idle time with no pointer/keyboard activity.
 * Also polls /api/auth/me so a server-side inactivity revoke is caught.
 */
export function useInactivityLogout({ enabled, onLogout, inactivityMinutes }) {
  const logoutRef = useRef(onLogout);
  logoutRef.current = onLogout;

  useEffect(() => {
    if (!enabled || !onLogout) return undefined;

    const minutes = Number(inactivityMinutes) > 0 ? Number(inactivityMinutes) : DEFAULT_MINUTES;
    const idleMs = minutes * 60 * 1000;
    let timer = null;

    const logout = () => logoutRef.current?.();

    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(logout, idleMs);
    };

    const events = ["mousedown", "keydown", "scroll", "touchstart"];
    for (const ev of events) window.addEventListener(ev, reset, { passive: true });
    reset();

    const poll = setInterval(async () => {
      try {
        const r = await fetch("/api/auth/me");
        if (r.ok) return;
        const data = await r.json().catch(() => ({}));
        if (data.code === "session_inactive" || data.code === "session_revoked") logout();
      } catch { /* ignore */ }
    }, POLL_MS);

    return () => {
      clearTimeout(timer);
      clearInterval(poll);
      for (const ev of events) window.removeEventListener(ev, reset);
    };
  }, [enabled, onLogout, inactivityMinutes]);
}