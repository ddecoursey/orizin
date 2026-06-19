import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { fetchUserSettings, patchUserSettings } from "../lib/userStore.js";
import { defaultWatchlists, normalizeWatchlists } from "../lib/watchlistNormalize.js";

const WL_KEY = (user) => `watchlists_v1:${user || "default"}`;

function loadLocal(user) {
  if (typeof window === "undefined") return defaultWatchlists();
  try {
    const lists = JSON.parse(localStorage.getItem(WL_KEY(user)) || "null");
    if (Array.isArray(lists) && lists.length) return normalizeWatchlists(lists);
  } catch { /* ignore */ }
  return defaultWatchlists();
}

function saveLocal(user, lists) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(WL_KEY(user), JSON.stringify(lists));
  } catch { /* ignore */ }
}

export function useWatchlists(currentUser, { hydrated = true } = {}) {
  const user = currentUser || "default";
  const [lists, setLists] = useState(() => normalizeWatchlists(loadLocal(user)));
  const hydratedRef = useRef(false);

  const persist = useCallback((nextLists) => {
    const norm = normalizeWatchlists(nextLists);
    setLists(norm);
    saveLocal(user, norm);
    if (hydratedRef.current) {
      patchUserSettings({ watchlists: norm, activeWatchlistId: "default" });
    }
    return norm;
  }, [user]);

  useEffect(() => {
    if (!hydrated || hydratedRef.current) return;
    let cancelled = false;
    fetchUserSettings().then((server) => {
      if (cancelled) return;
      hydratedRef.current = true;
      const nextLists = normalizeWatchlists(server?.watchlists);
      setLists(nextLists);
      saveLocal(user, nextLists);
    }).catch(() => {
      hydratedRef.current = true;
    });
    return () => { cancelled = true; };
  }, [hydrated, user]);

  const watchlist = useMemo(() => lists[0] || defaultWatchlists()[0], [lists]);
  const symbols = useMemo(() => new Set(watchlist?.symbols || []), [watchlist]);

  const addSymbol = useCallback((symbol) => {
    const sym = String(symbol || "").trim().toUpperCase();
    if (!sym) return;
    const wl = watchlist;
    if (wl.symbols.includes(sym)) return;
    persist([{ ...wl, symbols: [...wl.symbols, sym], updatedAt: Date.now() }]);
  }, [watchlist, persist]);

  const removeSymbol = useCallback((symbol) => {
    const sym = String(symbol || "").trim().toUpperCase();
    persist([{
      ...watchlist,
      symbols: watchlist.symbols.filter((s) => s !== sym),
      updatedAt: Date.now(),
    }]);
  }, [watchlist, persist]);

  const toggleSymbol = useCallback((symbol) => {
    const sym = String(symbol || "").trim().toUpperCase();
    if (!sym) return;
    if (symbols.has(sym)) removeSymbol(sym);
    else addSymbol(sym);
  }, [symbols, addSymbol, removeSymbol]);

  const isInActive = useCallback((symbol) => symbols.has(String(symbol || "").trim().toUpperCase()), [symbols]);

  return {
    watchlist,
    symbols,
    symbolCount: watchlist.symbols.length,
    addSymbol,
    removeSymbol,
    toggleSymbol,
    isInActive,
    // Legacy shape for gradual cleanup
    lists,
    activeList: watchlist,
    activeSymbols: symbols,
  };
}