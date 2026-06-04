import { useState, useEffect, useRef } from "react";

// Fetches the per-symbol detail data (profile, price history, RSI, ratings,
// grades, DCF, targets, insider, news) used by the overview panes *and* to give
// Ori full context for any stock the user asks about (buttons, natural language,
// suggestions follow-ups, etc.).
//
// State is tagged with the symbol it belongs to, so a new symbol immediately
// reports `loading` and never shows the previous symbol's data — without any
// synchronous setState in the effect body.
// `reloadToken` lets a caller force a fresh re-fetch (bypassing the server's detail
// caches) — bumped by the Deep Research "Re-gather" button after the per-symbol
// enrichment finishes, so every pane shows the just-gathered data.
export function useStockDetail(symbol, reloadToken = 0) {
  const [profile, setProfile] = useState({ sym: null, value: null });
  const [points, setPoints] = useState({ sym: null, value: null });
  const [rsi, setRsi] = useState({ sym: null, value: [] });
  const [ratings, setRatings] = useState({ sym: null, value: null });
  const [grades, setGrades] = useState({ sym: null, value: [] });
  const [ai, setAi] = useState({ sym: null, value: null });
  const [insider, setInsider] = useState({ sym: null, value: [] });
  const [news, setNews] = useState({ sym: null, value: [] });
  const prevRef = useRef({ symbol: null, token: reloadToken });

  useEffect(() => {
    const prev = prevRef.current;
    const symbolChanged = prev.symbol !== symbol;
    const tokenChanged = prev.token !== reloadToken;
    prevRef.current = { symbol, token: reloadToken };

    if (!symbol) return;
    let cancelled = false;
    const getJson = (url) =>
      fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    // Force a fresh re-fetch (bypassing the server's detail cache) ONLY when an
    // explicit re-gather bumped the token for the SAME symbol. Navigating to a
    // different symbol must use the cache, or every stock you open after one
    // re-gather would needlessly re-hit FMP.
    const force = tokenChanged && !symbolChanged;
    const u = (url) =>
      force ? url + (url.includes("?") ? "&" : "?") + "force=1" : url;

    getJson(u(`/api/stocks/profile/${symbol}`)).then((d) => {
      if (!cancelled) setProfile({ sym: symbol, value: d?.profile || null });
    });
    getJson(u(`/api/stocks/ai/${symbol}`)).then((d) => {
      if (!cancelled) setAi({ sym: symbol, value: d?.data || null });
    });
    getJson(u(`/api/stocks/insider/${symbol}`)).then((d) => {
      if (!cancelled) setInsider({ sym: symbol, value: d?.trades || [] });
    });
    getJson(u(`/api/stocks/news/${symbol}`)).then((d) => {
      if (!cancelled) setNews({ sym: symbol, value: d?.news || [] });
    });
    getJson(u(`/api/stocks/sparkline/${symbol}?days=1825`)).then((d) => {
      if (!cancelled) setPoints({ sym: symbol, value: d?.prices || [] });
    });
    getJson(u(`/api/stocks/rsi/${symbol}?periodLength=10`)).then((d) => {
      if (!cancelled) setRsi({ sym: symbol, value: d?.rsi || [] });
    });
    getJson(u(`/api/stocks/ratings/${symbol}`)).then((d) => {
      if (!cancelled) setRatings({ sym: symbol, value: d?.ratings || null });
    });
    getJson(u(`/api/stocks/grades/${symbol}`)).then((d) => {
      if (!cancelled) setGrades({ sym: symbol, value: d?.grades || [] });
    });

    return () => {
      cancelled = true;
    };
  }, [symbol, reloadToken]);

  // Only surface a field's value once it matches the requested symbol;
  // otherwise it's still loading (or belongs to a previous symbol).
  const forSym = (state, fallback) => (state.sym === symbol ? state.value : fallback);

  return {
    profile: forSym(profile, null),
    points: forSym(points, null),
    rsi: forSym(rsi, []),
    ratings: forSym(ratings, null),
    grades: forSym(grades, []),
    aiData: forSym(ai, null),
    insider: forSym(insider, []),
    news: forSym(news, []),
    loadingProfile: !!symbol && profile.sym !== symbol,
    loadingChart: !!symbol && points.sym !== symbol,
    loadingRatings: !!symbol && ratings.sym !== symbol,
    loadingGrades: !!symbol && grades.sym !== symbol,
    loadingAi: !!symbol && ai.sym !== symbol,
    loadingInsider: !!symbol && insider.sym !== symbol,
    loadingNews: !!symbol && news.sym !== symbol,
  };
}
