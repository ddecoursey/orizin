import { useEffect, useRef } from "react";

const POLL_MS = 10 * 60 * 1000; // re-validate the session every ~10 min

/**
 * Session watcher. The SERVER is the single source of truth for session validity
 * (a rolling 30-day window, re-issued on activity). This hook no longer force-
 * logs the user out on LOCAL idle — that aggressive 60-minute timer booted active-
 * but-quiet users (and combined with a too-short server window, signed people out
 * constantly). It now only:
 *   • pings /api/auth/me periodically and whenever the tab regains focus — which
 *     rolls the session cookie forward, keeping an open/returning tab signed in; and
 *   • signs out promptly if the server reports the session was ended elsewhere
 *     (sign out all devices / password change / admin revoke).
 * It never signs out on a bare 401/offline blip — only on an explicit revoke code.
 */
export function useInactivityLogout({ enabled, onLogout }) {
  const logoutRef = useRef(onLogout);
  useEffect(() => { logoutRef.current = onLogout; }, [onLogout]);

  useEffect(() => {
    if (!enabled) return undefined;
    let stopped = false;

    const check = async () => {
      try {
        const r = await fetch("/api/auth/me");
        if (r.ok || stopped) return;
        const data = await r.json().catch(() => ({}));
        // Only react to an explicit server-side revoke — never to a transient
        // 401/network hiccup, which would log out a perfectly valid session.
        if (data.code === "session_inactive" || data.code === "session_revoked") {
          logoutRef.current?.();
        }
      } catch { /* offline / transient — ignore, retry next tick */ }
    };

    const onVisible = () => { if (document.visibilityState === "visible") check(); };

    const poll = setInterval(check, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, onLogout]);
}
