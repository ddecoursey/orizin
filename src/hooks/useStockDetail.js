import { useState, useEffect, useRef } from "react";

// Fetches the per-symbol detail data (profile, price history, RSI, ratings,
// grades, DCF, targets, insider, news) used by the overview panes *and* to give
// Ori full context for any stock the user asks about (buttons, natural language,
// suggestions follow-ups, etc.).
//
// State is tagged with the symbol it belongs to, so a new symbol immediately
// reports `loading` and never shows the previous symbol's data — without any
// synchronous setState in the effect body.
// `reloadToken` bumps after a per-symbol re-gather so panes re-read the server's
// warm caches (enrich already refreshed them — no ?force=1 duplicate FMP wave).
export function useStockDetail(symbol, reloadToken = 0) {
  const [profile, setProfile] = useState({ sym: null, value: null });
  const [points, setPoints] = useState({ sym: null, value: null });
  const [rsi, setRsi] = useState({ sym: null, value: [] });
  const [ratings, setRatings] = useState({ sym: null, value: null });
  const [grades, setGrades] = useState({ sym: null, value: [] });
  const [ai, setAi] = useState({ sym: null, value: null });
  const [insider, setInsider] = useState({ sym: null, value: [] });
  const [news, setNews] = useState({ sym: null, value: [] });
  const [technicals, setTechnicals] = useState({ sym: null, value: null });
  const [earnings, setEarnings] = useState({ sym: null, value: null });
  const [smart, setSmart] = useState({ sym: null, value: null });
  const prevRef = useRef({ symbol: null, token: reloadToken });

  useEffect(() => {
    prevRef.current = { symbol, token: reloadToken };

    if (!symbol) return;
    let cancelled = false;
    const getJson = (url) =>
      fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);

    getJson(`/api/stocks/profile/${symbol}`).then((d) => {
      if (!cancelled) setProfile({ sym: symbol, value: d?.profile || null });
    });
    getJson(`/api/stocks/ai/${symbol}`).then((d) => {
      if (!cancelled) setAi({ sym: symbol, value: d?.data || null });
    });
    getJson(`/api/stocks/insider/${symbol}`).then((d) => {
      if (!cancelled) setInsider({ sym: symbol, value: d?.trades || [] });
    });
    getJson(`/api/stocks/news/${symbol}`).then((d) => {
      if (!cancelled) setNews({ sym: symbol, value: d?.news || [] });
    });
    // 5Y chart — served from DB after enrich; no force=1 re-download.
    getJson(`/api/stocks/sparkline/${symbol}?days=1825`).then((d) => {
      if (!cancelled) setPoints({ sym: symbol, value: d?.prices || [] });
    });
    getJson(`/api/stocks/rsi/${symbol}?periodLength=10`).then((d) => {
      if (!cancelled) setRsi({ sym: symbol, value: d?.rsi || [] });
    });
    getJson(`/api/stocks/ratings/${symbol}`).then((d) => {
      if (!cancelled) setRatings({ sym: symbol, value: d?.ratings || null });
    });
    getJson(`/api/stocks/grades/${symbol}`).then((d) => {
      if (!cancelled) setGrades({ sym: symbol, value: d?.grades || [] });
    });
    // Technicals, earnings, and smart-money power both the Deep Research panels
    // AND Ori's context (so recommendations use them) — fetched here once.
    getJson(`/api/stocks/technicals/${symbol}`).then((d) => {
      if (!cancelled) setTechnicals({ sym: symbol, value: d || null });
    });
    getJson(`/api/stocks/earnings/${symbol}`).then((d) => {
      if (!cancelled) setEarnings({ sym: symbol, value: d?.earnings ?? null });
    });
    getJson(`/api/stocks/smart-money/${symbol}`).then((d) => {
      if (!cancelled) setSmart({ sym: symbol, value: d || null });
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
    technicals: forSym(technicals, null),
    earnings: forSym(earnings, null),
    smartMoney: forSym(smart, null),
    loadingTechnicals: !!symbol && technicals.sym !== symbol,
    loadingProfile: !!symbol && profile.sym !== symbol,
    loadingChart: !!symbol && points.sym !== symbol,
    loadingRatings: !!symbol && ratings.sym !== symbol,
    loadingGrades: !!symbol && grades.sym !== symbol,
    loadingAi: !!symbol && ai.sym !== symbol,
    loadingInsider: !!symbol && insider.sym !== symbol,
    loadingNews: !!symbol && news.sym !== symbol,
  };
}
