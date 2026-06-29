import { useState, useEffect } from "react";
import { fmtAge } from "../lib/format.js";

// Shared-data pipeline indicator — everyone reads the same SQLite cache;
// background enrichment keeps it fresh (no per-user FMP refresh).
export default function DataSyncChip({ isAdmin = false }) {
  const [sync, setSync] = useState(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      setNow(Date.now());
      fetch("/api/status")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!cancelled && d?.dataSync) setSync(d.dataSync);
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!sync) return null;

  const lastMs = sync.lastUpdate ? (typeof sync.lastUpdate === "number" ? sync.lastUpdate : Date.parse(sync.lastUpdate)) : null;
  const age = lastMs && Number.isFinite(lastMs) && now ? fmtAge(now - lastMs) : null;
  const session = sync.marketSession || "closed";
  const label = sync.backgroundRunning
    ? age
      ? `Syncing · ${sync.lastSymbol || "…"} · ${age} ago`
      : "Data syncing…"
    : "Sync paused";

  return (
    <span
      className="hidden sm:inline-flex items-center gap-1.5 text-[10px] text-gray-500 tabular-nums"
      title={
        isAdmin
          ? `Background enrich · ${session} · ${sync.missingCount ?? "?"} symbols missing metrics`
          : "Shared market data — refreshed automatically for all users"
      }
    >
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          sync.backgroundRunning ? "bg-emerald-500 animate-pulse" : "bg-gray-600"
        }`}
      />
      {label}
    </span>
  );
}
