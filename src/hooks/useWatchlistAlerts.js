import { useCallback, useEffect, useRef, useState } from "react";

const SEEN_IDS_CAP = 200;

function rememberAlertId(seen, id) {
  seen.add(id);
  if (seen.size > SEEN_IDS_CAP) {
    const keep = [...seen].slice(-Math.floor(SEEN_IDS_CAP / 2));
    seen.clear();
    keep.forEach((x) => seen.add(x));
  }
}

export function useWatchlistAlerts({ enabled = true, pollMs = 60_000 } = {}) {
  const [alerts, setAlerts] = useState([]);
  const [snapshots, setSnapshots] = useState({});
  const [unread, setUnread] = useState(0);
  const sinceRef = useRef(0);
  const seenIds = useRef(new Set());
  const snapshotsJson = useRef("");

  const poll = useCallback(async () => {
    if (!enabled) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    try {
      const res = await fetch(`/api/watchlist/alerts?since=${sinceRef.current}`);
      if (!res.ok) return;
      const data = await res.json();
      const nextUnread = data.unread ?? 0;
      setUnread((u) => (u === nextUnread ? u : nextUnread));
      if (data.snapshots) {
        const nextJson = JSON.stringify(data.snapshots);
        if (nextJson !== snapshotsJson.current) {
          snapshotsJson.current = nextJson;
          setSnapshots(data.snapshots);
        }
      }
      const incoming = Array.isArray(data.alerts) ? data.alerts : [];
      const fresh = incoming.filter((a) => a?.id && !seenIds.current.has(a.id));
      if (fresh.length) {
        fresh.forEach((a) => rememberAlertId(seenIds.current, a.id));
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

  const triggerTestAlert = useCallback(async (opts = {}) => {
    try {
      const res = await fetch("/api/watchlist/alerts/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 404) {
          const msg = body?.error === "Not found"
            ? "Dev only"
            : "Alert API not found — restart the dev server";
          return { error: msg };
        }
        return { error: body?.error || "Failed" };
      }
      const data = await res.json();
      const incoming = Array.isArray(data.alerts)
        ? data.alerts
        : data.alert?.id
          ? [data.alert]
          : [];
      if (incoming.length) {
        incoming.forEach((a) => rememberAlertId(seenIds.current, a.id));
        setAlerts((prev) => [...incoming, ...prev].slice(0, 30));
        setUnread((n) => n + incoming.length);
        const maxTs = Math.max(...incoming.map((a) => a.ts || 0), sinceRef.current);
        sinceRef.current = maxTs;
      }
      return { ok: true, alert: incoming[0], alerts: incoming };
    } catch {
      return { error: "Network error" };
    }
  }, [poll]);

  return { alerts, snapshots, unread, dismiss, markRead, refresh: poll, triggerTestAlert };
}