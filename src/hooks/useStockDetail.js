import { useState, useEffect } from "react";

// Fetches the per-symbol detail data (profile, price history, RSI, ratings,
// grades) used by both the company-overview pane and Ori's chat context.
// Lifting it here (instead of fetching inside the modal) lets Ori see exactly
// what the user is looking at.
//
// State is tagged with the symbol it belongs to, so a new symbol immediately
// reports `loading` and never shows the previous symbol's data — without any
// synchronous setState in the effect body.
export function useStockDetail(symbol) {
  const [profile, setProfile] = useState({ sym: null, value: null });
  const [points, setPoints] = useState({ sym: null, value: null });
  const [rsi, setRsi] = useState({ sym: null, value: [] });
  const [ratings, setRatings] = useState({ sym: null, value: null });
  const [grades, setGrades] = useState({ sym: null, value: [] });

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    const getJson = (url) =>
      fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);

    getJson(`/api/stocks/profile/${symbol}`).then((d) => {
      if (!cancelled) setProfile({ sym: symbol, value: d?.profile || null });
    });
    getJson(`/api/stocks/sparkline/${symbol}?days=365`).then((d) => {
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

    return () => {
      cancelled = true;
    };
  }, [symbol]);

  // Only surface a field's value once it matches the requested symbol;
  // otherwise it's still loading (or belongs to a previous symbol).
  const forSym = (state, fallback) => (state.sym === symbol ? state.value : fallback);

  return {
    profile: forSym(profile, null),
    points: forSym(points, null),
    rsi: forSym(rsi, []),
    ratings: forSym(ratings, null),
    grades: forSym(grades, []),
    loadingProfile: !!symbol && profile.sym !== symbol,
    loadingChart: !!symbol && points.sym !== symbol,
    loadingRatings: !!symbol && ratings.sym !== symbol,
    loadingGrades: !!symbol && grades.sym !== symbol,
  };
}
