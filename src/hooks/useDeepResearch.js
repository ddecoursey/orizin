import { useState, useEffect } from "react";

// Fetches the Deep-Research-only data sets (financial statements, SEC filings,
// executive compensation, peers, multi-year growth) for the open symbol.
// Server-side these are cached in memory + SQLite, so revisiting a stock is
// free. State is tagged with its symbol so switching stocks never shows the
// previous company's numbers.
export function useDeepResearch(symbol, reloadToken = 0) {
  const [statements, setStatements] = useState({ sym: null, value: null });
  const [filings, setFilings] = useState({ sym: null, value: [] });
  const [execComp, setExecComp] = useState({ sym: null, value: [], planLimited: false });
  const [peers, setPeers] = useState({ sym: null, value: [] });
  const [growth, setGrowth] = useState({ sym: null, value: [] });

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    const getJson = (url) =>
      fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);

    getJson(`/api/stocks/statements/${symbol}?period=annual`).then((d) => {
      if (!cancelled) {
        setStatements({
          sym: symbol,
          value: d ? { income: d.income || [], balance: d.balance || [], cashflow: d.cashflow || [] } : null,
        });
      }
    });
    getJson(`/api/stocks/filings/${symbol}`).then((d) => {
      if (!cancelled) setFilings({ sym: symbol, value: d?.filings || [] });
    });
    getJson(`/api/stocks/exec-comp/${symbol}`).then((d) => {
      if (!cancelled) {
        setExecComp({
          sym: symbol,
          value: d?.compensation || [],
          planLimited: !!d?.planLimited,
        });
      }
    });
    getJson(`/api/stocks/peers/${symbol}`).then((d) => {
      if (!cancelled) setPeers({ sym: symbol, value: d?.peers || [] });
    });
    getJson(`/api/stocks/growth-history/${symbol}`).then((d) => {
      if (!cancelled) setGrowth({ sym: symbol, value: d?.growth || [] });
    });

    return () => {
      cancelled = true;
    };
  }, [symbol, reloadToken]);

  const forSym = (state, fallback) => (state.sym === symbol ? state.value : fallback);

  return {
    statements: forSym(statements, null), // { income, balance, cashflow } | null
    filings: forSym(filings, []),
    execComp: forSym(execComp, []),
    execCompPlanLimited: execComp.sym === symbol && execComp.planLimited,
    peers: forSym(peers, []),
    growthHistory: forSym(growth, []),
    loadingStatements: !!symbol && statements.sym !== symbol,
    loadingFilings: !!symbol && filings.sym !== symbol,
    loadingExecComp: !!symbol && execComp.sym !== symbol,
    loadingPeers: !!symbol && peers.sym !== symbol,
    loadingGrowth: !!symbol && growth.sym !== symbol,
  };
}
