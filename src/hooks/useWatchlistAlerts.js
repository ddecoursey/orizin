import { useCallback, useEffect, useRef, useState } from "react";

export function useWatchlistAlerts({ enabled = true, pollMs = 60_000 } = {}) {
  const [alerts, setAlerts] = useState([]);
  const [snapshots, setSnapshots] = useState({});
  const [unread, setUnread] = useState(0);
  const sinceRef = useRef(0);
  const seenIds = useRef(new Set());

  const poll = useCallback(async () => {
    if (!enabled || typeof document !== "undefined" && document.visibilityState === "hidden") return;
    try {
      const res = await fetch(`/api/watchlist/alerts?since=${sinceRef.current}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.snapshots) setSnapshots(data.snapshots);
      setUnread(data.unread ?? 0);
      const incoming = Array.isArray(data.alerts) ? data.alerts : [];
      const fresh = incoming.filter((a) => a?.id && !seenIds.current.has(a.id));
      if (fresh.length) {
        fresh.forEach((a) => seenIds.current.add(a.id));
        setAlerts((prev) => [...fresh, ...prev].slice(0, 30));
        const maxTs = Math.max(...incoming.map((a) => a.ts || 0), sinceRef.current);
        sinceRef.current = maxTs;
      }
    } catch {
      // ignore transient network errors
    }
  }, [enabled]);

  const markRead = useCallback(async () => {
    const through = Date.now();
    try {
      await fetch("/api/watchlist/alerts/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ readThrough: through }),
      });
    } catch { /* ignore */ }
    setAlerts([]);
    setUnread(0);
    sinceRef.current = through;
  }, []);

  const dismiss = useCallback((id) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    setUnread((n) => Math.max(0, n - 1));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    poll();
    const id = setInterval(poll, pollMs);
    const onVis = () => { if (document.visibilityState === "visible") poll(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [enabled, poll, pollMs]);

  return { alerts, snapshots, unread, dismiss, markRead, refresh: poll };
}