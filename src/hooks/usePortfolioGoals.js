import { useState, useEffect, useMemo, useCallback } from 'react';
import { fetchUserSettings, patchUserSettings } from '../lib/userStore.js';

function generateId() {
  return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function normalizeHolding(holding, totalInvested) {
  const h = { ...holding };
  const t = Number(totalInvested) || 0;
  if (h.dollars != null && h.percent == null && t > 0) {
    h.percent = (Number(h.dollars) / t) * 100;
  } else if (h.percent != null && h.dollars == null && t > 0) {
    h.dollars = (Number(h.percent) / 100) * t;
  }
  if (h.percent != null) h.percent = Math.max(0, Math.min(100, Number(h.percent)));
  if (h.dollars != null) h.dollars = Math.max(0, Number(h.dollars));
  return h;
}

export function usePortfolioGoals() {
  const [portfolios, setPortfolios] = useState([]);
  const [goals, setGoals] = useState([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let mounted = true;
    fetchUserSettings().then((settings) => {
      if (!mounted) return;
      if (Array.isArray(settings.portfolios)) setPortfolios(settings.portfolios);
      if (Array.isArray(settings.goals)) setGoals(settings.goals);
      setHydrated(true);
    }).catch(() => { setHydrated(true); });
    return () => { mounted = false; };
  }, []);

  const persist = useCallback((nextPortfolios, nextGoals) => {
    const payload = {};
    if (nextPortfolios !== undefined) payload.portfolios = nextPortfolios;
    if (nextGoals !== undefined) payload.goals = nextGoals;
    patchUserSettings(payload);
  }, []);

  const addPortfolio = useCallback((name = 'New Portfolio') => {
    const newPort = { id: generateId(), name: name || 'New Portfolio', totalInvested: 0, holdings: [] };
    const next = [...portfolios, newPort];
    setPortfolios(next); persist(next, undefined);
    return newPort.id;
  }, [portfolios, persist]);

  const updatePortfolio = useCallback((id, updates) => {
    const next = portfolios.map(p => {
      if (p.id !== id) return p;
      const updated = { ...p, ...updates };
      if ('totalInvested' in updates && updated.holdings?.length) {
        const t = Number(updates.totalInvested) || 0;
        updated.holdings = updated.holdings.map(h => normalizeHolding(h, t));
      }
      return updated;
    });
    setPortfolios(next); persist(next, undefined);
  }, [portfolios, persist]);

  const deletePortfolio = useCallback((id) => {
    const next = portfolios.filter(p => p.id !== id);
    setPortfolios(next); persist(next, undefined);
  }, [portfolios, persist]);

  const renamePortfolio = useCallback((id, name) => {
    updatePortfolio(id, { name: name?.trim() || 'Untitled' });
  }, [updatePortfolio]);

  const addHolding = useCallback((portfolioId, ticker = '') => {
    const next = portfolios.map(p => {
      if (p.id !== portfolioId) return p;
      const total = Number(p.totalInvested) || 0;
      const newHolding = normalizeHolding({ ticker: (ticker || '').toUpperCase().trim(), percent: 0, dollars: 0 }, total);
      return { ...p, holdings: [...(p.holdings || []), newHolding] };
    });
    setPortfolios(next); persist(next, undefined);
  }, [portfolios, persist]);

  const updateHolding = useCallback((portfolioId, index, field, value) => {
    const next = portfolios.map(p => {
      if (p.id !== portfolioId) return p;
      const holdings = [...(p.holdings || [])];
      if (!holdings[index]) return p;
      const h = { ...holdings[index] };
      const total = Number(p.totalInvested) || 0;
      if (field === 'ticker') { h.ticker = (value || '').toUpperCase().trim(); }
      else if (field === 'percent') { h.percent = Number(value); h.dollars = total > 0 ? (h.percent / 100) * total : 0; }
      else if (field === 'dollars') { h.dollars = Number(value); h.percent = total > 0 ? (h.dollars / total) * 100 : 0; }
      holdings[index] = normalizeHolding(h, total);
      return { ...p, holdings };
    });
    setPortfolios(next); persist(next, undefined);
  }, [portfolios, persist]);

  const deleteHolding = useCallback((portfolioId, index) => {
    const next = portfolios.map(p => {
      if (p.id !== portfolioId) return p;
      const holdings = (p.holdings || []).filter((_, i) => i !== index);
      return { ...p, holdings };
    });
    setPortfolios(next); persist(next, undefined);
  }, [portfolios, persist]);

  const addGoal = useCallback((text = '') => { const next = [...goals, text || '']; setGoals(next); persist(undefined, next); }, [goals, persist]);
  const updateGoal = useCallback((index, text) => { const next = goals.map((g, i) => (i === index ? text : g)); setGoals(next); persist(undefined, next); }, [goals, persist]);
  const deleteGoal = useCallback((index) => { const next = goals.filter((_, i) => i !== index); setGoals(next); persist(undefined, next); }, [goals, persist]);

  const { grandTotal, overallAllocations } = useMemo(() => {
    const total = portfolios.reduce((sum, p) => sum + (Number(p.totalInvested) || 0), 0);
    const tickerMap = new Map();
    portfolios.forEach(port => {
      const portTotal = Number(port.totalInvested) || 0;
      let usedPercent = 0;
      (port.holdings || []).forEach(h => {
        const tkr = (h.ticker || '').toUpperCase().trim();
        if (!tkr) return;
        let dollars = Number(h.dollars);
        let percent = Number(h.percent);
        if (isNaN(dollars) && portTotal > 0 && !isNaN(percent)) dollars = (percent / 100) * portTotal;
        if (isNaN(dollars) || dollars < 0) return;
        usedPercent += (percent || 0);
        const current = tickerMap.get(tkr) || 0;
        tickerMap.set(tkr, current + dollars);
      });
      const miscPercent = Math.max(0, 100 - usedPercent);
      if (miscPercent > 0 && portTotal > 0) {
        const miscDollars = (miscPercent / 100) * portTotal;
        const currentMisc = tickerMap.get('MISC') || 0;
        tickerMap.set('MISC', currentMisc + miscDollars);
      }
    });
    const allocations = Array.from(tickerMap.entries()).map(([ticker, dollars]) => ({
      ticker,
      dollars: Math.round(dollars * 100) / 100,
      overallPercent: total > 0 ? Math.round((dollars / total) * 10000) / 100 : 0,
    })).sort((a, b) => b.dollars - a.dollars);
    return { grandTotal: Math.round(total * 100) / 100, overallAllocations: allocations };
  }, [portfolios]);

  return { portfolios, goals, hydrated, addPortfolio, updatePortfolio, deletePortfolio, renamePortfolio, addHolding, updateHolding, deleteHolding, addGoal, updateGoal, deleteGoal, grandTotal, overallAllocations };
}
