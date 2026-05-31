import { useState, useEffect } from "react";

// Latest general market news for the footer ticker and Ori's context.
// Cached server-side (10m), refreshed here periodically.
export function useNews(refreshMs = 10 * 60 * 1000) {
  const [news, setNews] = useState([]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/news?limit=30")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!cancelled && Array.isArray(d?.news)) setNews(d.news);
        })
        .catch(() => {});
    load();
    const id = setInterval(load, refreshMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [refreshMs]);

  return news;
}
