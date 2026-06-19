import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { fetchUserSettings, patchUserSettings } from "../lib/userStore.js";
import {
  defaultWatchlists,
  normalizeWatchlists,
  MAX_WATCHLISTS as MAX_LISTS,
} from "../lib/watchlistNormalize.js";

const WL_KEY = (user) => `watchlists_v1:${user || "default"}`;
const WL_ACTIVE_KEY = (user) => `watchlists_active_v1:${user || "default"}`;

function loadLocal(user) {
  if (typeof window === "undefined") return { lists: defaultWatchlists(), activeId: "default" };
  try {
    const lists = JSON.parse(localStorage.getItem(WL_KEY(user)) || "null");
    const activeId = localStorage.getItem(WL_ACTIVE_KEY(user)) || "default";
    if (Array.isArray(lists) && lists.length) return { lists, activeId };
  } catch { /* ignore */ }
  return { lists: normalizeWatchlists([]), activeId: "default" };
}

function saveLocal(user, lists, activeId) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(WL_KEY(user), JSON.stringify(lists));
    localStorage.setItem(WL_ACTIVE_KEY(user), activeId);
  } catch { /* ignore */ }
}

export function useWatchlists(currentUser, { hydrated = true } = {}) {
  const user = currentUser || "default";
  const initial = loadLocal(user);
  const [lists, setLists] = useState(() => normalizeWatchlists(initial.lists));
  const [activeId, setActiveId] = useState(initial.activeId);
  const hydratedRef = useRef(false);

  const persist = useCallback((nextLists, nextActive) => {
    const norm = normalizeWatchlists(nextLists);
    const aid = norm.some((w) => w.id === nextActive) ? nextActive : "default";
    setLists(norm);
    setActiveId(aid);
    saveLocal(user, norm, aid);
    if (hydratedRef.current) {
      patchUserSettings({ watchlists: norm, activeWatchlistId: aid });
    }
    return { lists: norm, activeId: aid };
  }, [user]);

  // Hydrate from server (watchlists are independent of screener pins).
  useEffect(() => {
    if (!hydrated || hydratedRef.current) return;
    let cancelled = false;
    fetchUserSettings().then((server) => {
      if (cancelled) return;
      hydratedRef.current = true;
      const nextLists = normalizeWatchlists(server?.watchlists);
      let nextActive = server?.activeWatchlistId || activeId;

      if (!nextLists.some((w) => w.id === nextActive)) nextActive = "default";
      setLists(nextLists);
      setActiveId(nextActive);
      saveLocal(user, nextLists, nextActive);
    }).catch(() => {
      hydratedRef.current = true;
    });
    return () => { cancelled = true; };
  }, [hydrated, user, activeId]);

  const activeList = useMemo(
    () => lists.find((w) => w.id === activeId) || lists[0] || normalizeWatchlists([])[0],
    [lists, activeId],
  );

  const activeSymbols = useMemo(() => new Set(activeList?.symbols || []), [activeList]);

  const allSymbols = useMemo(() => {
    const s = new Set();
    for (const w of lists) for (const sym of w.symbols || []) s.add(sym);
    return s;
  }, [lists]);

  const setActiveWatchlist = useCallback((id) => {
    if (!lists.some((w) => w.id === id)) return;
    setActiveId(id);
    saveLocal(user, lists, id);
    if (hydratedRef.current) patchUserSettings({ activeWatchlistId: id });
  }, [lists, user]);

  const createWatchlist = useCallback((name) => {
    const n = String(name || "").trim().slice(0, 28);
    if (!n || lists.length >= MAX_LISTS) return null;
    const id = `wl_${Date.now().toString(36)}`;
    const next = [...lists, { id, name: n, symbols: [], updatedAt: Date.now() }];
    persist(next, id);
    return id;
  }, [lists, persist]);

  const renameWatchlist = useCallback((id, name) => {
    const n = String(name || "").trim().slice(0, 28);
    if (!n) return;
    persist(lists.map((w) => (w.id === id ? { ...w, name: n, updatedAt: Date.now() } : w)), activeId);
  }, [lists, activeId, persist]);

  const deleteWatchlist = useCallback((id) => {
    if (id === "default" || lists.length <= 1) return;
    const next = lists.filter((w) => w.id !== id);
    const nextActive = activeId === id ? "default" : activeId;
    persist(next, nextActive);
  }, [lists, activeId, persist]);

  const addSymbol = useCallback((symbol, listId = activeId) => {
    const sym = String(symbol || "").trim().toUpperCase();
    if (!sym) return;
    const next = lists.map((w) => {
      if (w.id !== listId) return w;
      if (w.symbols.includes(sym)) return w;
      return { ...w, symbols: [...w.symbols, sym], updatedAt: Date.now() };
    });
    persist(next, activeId);
  }, [lists, activeId, persist]);

  const removeSymbol = useCallback((symbol, listId = activeId) => {
    const sym = String(symbol || "").trim().toUpperCase();
    const next = lists.map((w) =>
      w.id === listId ? { ...w, symbols: w.symbols.filter((s) => s !== sym), updatedAt: Date.now() } : w,
    );
    persist(next, activeId);
  }, [lists, activeId, persist]);

  const toggleSymbol = useCallback((symbol, listId = activeId) => {
    const sym = String(symbol || "").trim().toUpperCase();
    if (!sym) return;
    const list = lists.find((w) => w.id === listId);
    if (!list) return;
    if (list.symbols.includes(sym)) removeSymbol(sym, listId);
    else addSymbol(sym, listId);
  }, [lists, addSymbol, removeSymbol]);

  const isInActive = useCallback((symbol) => activeSymbols.has(String(symbol || "").trim().toUpperCase()), [activeSymbols]);

  return {
    lists,
    activeList,
    activeId,
    activeSymbols,
    allSymbols,
    setActiveWatchlist,
    createWatchlist,
    renameWatchlist,
    deleteWatchlist,
    addSymbol,
    removeSymbol,
    toggleSymbol,
    isInActive,
  };
}