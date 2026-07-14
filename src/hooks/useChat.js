import { useRef, useState } from 'react';

export function useChat(filteredStocks, filters, onApplyUpdates, activeStock = null, session = {}) {
  const [isOpen, setIsOpen]         = useState(false);
  const [messages, setMessages]     = useState([]);
  const [sessionId, setSessionId]   = useState(null);
  const [isStreaming, setIsStreaming]= useState(false);
  const [error, setError]           = useState(null);
  const [focusSymbols, setFocusSymbols] = useState([]);
  // Aborts the in-flight chat request/stream when the user hits Stop.
  const abortRef = useRef(null);

  // Compact a stock row to the fields Ori needs (shared by the top-50 list,
  // the pinned list, and the active stock).
  function compact(s) {
    return {
      symbol: s.symbol, name: s.name, sector: s.sector,
      price: s.price, mcap: s.mcap, pe: s.pe, pb: s.pb, ps: s.ps,
      ev_ebitda: s.ev_ebitda, ev_sales: s.ev_sales, ev_gp: s.ev_gp,
      fcf_yield: s.fcf_yield, gross_margin: s.gross_margin,
      op_margin: s.op_margin, net_margin: s.net_margin,
      fcf_margin: s.fcf_margin, roic: s.roic, roe: s.roe, roa: s.roa,
      revenue_growth: s.revenue_growth, eps_growth: s.eps_growth, fcf_growth: s.fcf_growth,
      op_income_growth: s.op_income_growth,
      earnings_yield: s.earnings_yield,
      net_debt_ebitda: s.net_debt_ebitda, current_ratio: s.current_ratio,
      debt_equity: s.debt_equity, div_yield: s.div_yield,
      payout: s.payout, beta: s.beta, conviction: s.conviction,
      dataCoverage: s.dataCoverage,
    };
  }

  function classifyChatIntent(message, view, symbols, stock) {
    if (view === 'portfolio-goals') return 'portfolio';
    if (view !== 'screener') return 'general';
    const m = (message || '').toLowerCase();
    if (/\b(filter|narrow|refine|show me only|only show|exclude|remove the|tighten|screen for|less than|greater than|under \$|over \$)\b/.test(m)) {
      return 'filter';
    }
    if (symbols?.length || /\b(analyze|compare|vs\.?|versus|deep dive|tell me about|what do you think of|should i buy)\b/.test(m)) {
      return 'analyze';
    }
    if (/\b(portfolio|holdings|trim|sell|overlap|concentrat|rebalance)\b/.test(m)) {
      return 'portfolio';
    }
    if (stock?.symbol && /\b(this stock|this one|it\b)/.test(m)) return 'analyze';
    return 'general';
  }

  function buildContext(message = '') {
    const currentView = session.view || 'screener';
    const isDeepResearch = currentView === 'deep-research';
    const chatIntent = isDeepResearch ? 'general' : classifyChatIntent(message, currentView, focusSymbols, activeStock);
    const sorted = [...(filteredStocks || [])].sort((a, b) => (b.conviction || 0) - (a.conviction || 0));

    let tableSize = 30;
    if (chatIntent === 'filter') tableSize = 20;
    else if (chatIntent === 'analyze') tableSize = 15;
    else if (chatIntent === 'portfolio') tableSize = 15;

    let top = isDeepResearch ? [] : sorted.slice(0, tableSize);

    if (!isDeepResearch && chatIntent === 'analyze') {
      const want = new Set([
        ...(focusSymbols || []).map((s) => String(s).toUpperCase()),
        activeStock?.symbol,
      ].filter(Boolean));
      if (want.size) {
        const picked = sorted.filter((s) => want.has(s.symbol));
        const rest = sorted.filter((s) => !want.has(s.symbol)).slice(0, Math.max(0, tableSize - picked.length));
        top = [...picked, ...rest];
      }
    }

    // Provide Ori with the list of available sectors and industries so it uses correct values
    const allSectors = [...new Set((filteredStocks || []).map(s => s.sector).filter(Boolean))].sort();
    const allIndustries = [...new Set((filteredStocks || []).map(s => s.industry).filter(Boolean))].sort();

    function toContextStock(s) {
      if (!s) return null;
      return {
        symbol: s.symbol,
        name: s.name,
        sector: s.sector,
        industry: s.industry,
        price: s.price,
        mcap: s.mcap,
        pe: s.pe, pb: s.pb, ps: s.ps,
        ev_ebitda: s.ev_ebitda, ev_sales: s.ev_sales, ev_gp: s.ev_gp,
        fcf_yield: s.fcf_yield, gross_margin: s.gross_margin,
        op_margin: s.op_margin, net_margin: s.net_margin,
        fcf_margin: s.fcf_margin, roic: s.roic, roe: s.roe, roa: s.roa,
        revenue_growth: s.revenue_growth, eps_growth: s.eps_growth, fcf_growth: s.fcf_growth,
        net_debt_ebitda: s.net_debt_ebitda, current_ratio: s.current_ratio,
        debt_equity: s.debt_equity, div_yield: s.div_yield, beta: s.beta,
        conviction: s.conviction,
        dataCoverage: s.dataCoverage,
        latestRsi: s.latestRsi,
        profile: s.profile
          ? {
              description: s.profile.description,
              ceo: s.profile.ceo,
              fullTimeEmployees: s.profile.fullTimeEmployees,
              website: s.profile.website,
              country: s.profile.country,
              ipoDate: s.profile.ipoDate,
              range: s.profile.range,
              exchange: s.profile.exchangeFullName || s.profile.exchange,
            }
          : null,
        ratings: s.ratings || null,
        grades: (s.grades || []).slice(0, 8),
        performance: s.performance || null,
        rsiTrend: s.rsiTrend || null,
        // DCF fair value, analyst price targets, and owner earnings.
        dcf: s.aiData?.dcf ?? null,
        targetConsensus: s.aiData?.target_consensus ?? null,
        targetHigh: s.aiData?.target_high ?? null,
        targetLow: s.aiData?.target_low ?? null,
        ownerEarnings: s.aiData?.owner_earnings ?? null,
        ownerEps: s.aiData?.owner_eps ?? null,
        // Recent insider (Form 4) trades.
        insider: (s.insider || []).slice(0, 10).map((t) => ({
          date: t.transactionDate || t.filingDate,
          name: t.reportingName,
          role: t.typeOfOwner,
          type: t.acquisitionOrDisposition,
          shares: t.securitiesTransacted,
          price: t.price,
        })),
        // Recent company-specific news.
        news: (s.news || []).slice(0, 8).map((a) => ({
          title: a.title,
          source: a.site || a.publisher,
          date: a.publishedDate,
        })),
        // Technical indicators (latest values; moving averages, ADX, etc.).
        technicals: s.technicals
          ? {
              sma50: s.technicals.sma50, sma200: s.technicals.sma200, ema20: s.technicals.ema20,
              rsi14: s.technicals.rsi, adx: s.technicals.adx, williams: s.technicals.williams, stdDev: s.technicals.stdDev,
            }
          : null,
        // Earnings: next report + recent EPS actual vs estimate.
        earnings: Array.isArray(s.earnings)
          ? {
              next: s.earnings.find((e) => e.epsActual == null && new Date(e.date) >= new Date(new Date().toDateString())) || null,
              recent: s.earnings.filter((e) => e.epsActual != null).slice(0, 4),
            }
          : null,
        // Insiders: U.S. Congress + corporate-insider conviction signal.
        smartMoney: s.smartMoney
          ? {
              signal: s.smartMoney.signal,
              congress: s.smartMoney.congress
                ? { buyers: s.smartMoney.congress.buyers, sellers: s.smartMoney.congress.sellers, total: s.smartMoney.congress.total, recent: (s.smartMoney.congress.recent || []).slice(0, 6) }
                : null,
              insider: s.smartMoney.insider
                ? { buyers: s.smartMoney.insider.buyers, sellers: s.smartMoney.insider.sellers, buyValue: s.smartMoney.insider.buyValue }
                : null,
            }
          : null,
        // Personalized fit to the user's portfolio / goals / theses.
        fit: s.fit && !s.fit.needsContext ? { score: s.fit.score, reasons: s.fit.reasons } : null,
        // Unified Game Plan verdict: conviction + hold horizon + action + pillars.
        verdict:
          s.verdict && !s.verdict.insufficient
            ? {
                conviction: s.verdict.conviction,
                horizon: s.verdict.horizon?.label,
                horizonSub: s.verdict.horizon?.sub,
                action: s.verdict.action?.label,
                actionLine: s.verdict.action?.line,
                headline: s.verdict.headline,
                reasons: (s.verdict.reasons || []).map((r) => `${r.tone === "good" ? "+" : r.tone === "bad" ? "-" : "~"} ${r.text}`),
                pillars: (s.verdict.pillars || []).map((p) => ({
                  id: p.id,
                  score: p.score != null ? Math.round(p.score * 100) : null,
                  tone: p.tone,
                })),
                confidence: s.verdict.confidence,
              }
            : null,
      };
    }

    function slimPortfolioGoals(pg, symbol) {
      if (!pg) return null;
      const sym = (symbol || '').toUpperCase();
      const alloc = (pg.overallAllocations || []).find((a) => (a.ticker || '').toUpperCase() === sym);
      const goals = (pg.goals || []).filter((g) => g && String(g).trim()).slice(0, 5);
      const theses = (pg.theses || [])
        .filter((t) => t && String(t).trim() && (!sym || String(t).toUpperCase().includes(sym)))
        .slice(0, 4);
      if (!alloc && !goals.length && !theses.length) return null;
      return {
        holdsSymbol: !!alloc,
        position: alloc
          ? { percent: alloc.overallPercent, dollars: alloc.dollars }
          : null,
        goals,
        theses,
      };
    }

    function toDrContextStock(s) {
      const ctx = toContextStock(s);
      if (!ctx) return null;
      if (ctx.profile?.description) {
        ctx.profile = { ...ctx.profile, description: String(ctx.profile.description).slice(0, 400) };
      }
      ctx.grades = (ctx.grades || []).slice(0, 4);
      ctx.insider = (ctx.insider || []).slice(0, 4);
      ctx.news = (ctx.news || []).slice(0, 5);
      return ctx;
    }

    const activeStockContext = isDeepResearch
      ? toDrContextStock(activeStock)
      : (chatIntent === 'analyze' ? toContextStock(activeStock) : (activeStock ? compact(activeStock) : null));
    const focusStocksContext = (isDeepResearch || chatIntent !== 'analyze')
      ? []
      : (session.focusStocks || []).map(toContextStock).filter(Boolean);

    const newsCap = chatIntent === 'filter' ? 0 : chatIntent === 'analyze' ? 4 : 6;

    return {
      filters: isDeepResearch ? {} : filters,
      view: currentView,
      chatIntent,
      today: new Date().toISOString().slice(0, 10),
      totalFiltered: isDeepResearch ? 0 : (filteredStocks || []).length,
      activeScreener: isDeepResearch ? null : (session.activeScreener || null),
      pinnedStocks: (isDeepResearch || chatIntent === 'filter') ? [] : (session.pinnedStocks || []).map(compact),
      news: (isDeepResearch || newsCap === 0)
        ? []
        : (session.news || []).slice(0, newsCap).map((a) => ({
            title: a.title,
            source: a.site || a.publisher,
            symbol: a.symbol,
            date: a.publishedDate,
          })),
      activeStock: activeStockContext,
      focusStocks: focusStocksContext,
      portfolioGoals: isDeepResearch
        ? slimPortfolioGoals(session.portfolioGoals, activeStock?.symbol)
        : (session.portfolioGoals || null),
      stocks: top.map(compact),
      availableSectors: (isDeepResearch || chatIntent === 'filter') ? [] : allSectors,
      availableIndustries: (isDeepResearch || chatIntent === 'filter') ? [] : allIndustries,
      focusSymbols: isDeepResearch ? (activeStock?.symbol ? [activeStock.symbol] : focusSymbols) : focusSymbols,
    };
  }

  async function sendMessage(text) {
    if (!text.trim() || isStreaming) return;
    setError(null);

    const userMsg = { role: 'user', content: text, ts: Date.now() };
    const assistantMsg = { role: 'assistant', content: '', ts: Date.now() };
    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);

    let accumulated = '';

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          message: text,
          context: buildContext(text),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Chat request failed');
        setMessages(prev => prev.slice(0, -1)); // remove empty assistant msg
        setIsStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      function pump() {
        reader.read().then(({ done, value }) => {
          if (done) { setIsStreaming(false); return; }
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop();
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const evt = JSON.parse(line.slice(6));
              if (evt.type === 'text') {
                accumulated += evt.text;
                setMessages(prev => {
                  const next = [...prev];
                  const last = next[next.length - 1];
                  if (last?.role === 'assistant') {
                    next[next.length - 1] = { ...last, content: last.content + evt.text };
                  }
                  return next;
                });
              } else if (evt.type === 'status') {
                // Transient backend status (e.g. "Ori is busy — retrying…").
                // Show it on the in-progress assistant bubble while it has no
                // text yet, so the user knows we're still working.
                setMessages(prev => {
                  const next = [...prev];
                  const last = next[next.length - 1];
                  if (last?.role === 'assistant') {
                    next[next.length - 1] = { ...last, status: evt.message };
                  }
                  return next;
                });
              } else if (evt.type === 'model') {
                // Which Gemini model answered (value/lite, possibly via the
                // backup key) — surfaced as a small label under the reply.
                setMessages(prev => {
                  const next = [...prev];
                  const last = next[next.length - 1];
                  if (last?.role === 'assistant') {
                    next[next.length - 1] = { ...last, model: evt.model, modelTier: evt.tier };
                  }
                  return next;
                });
              } else if (evt.type === 'done') {
                setSessionId(evt.sessionId);
                setIsStreaming(false);
                abortRef.current = null;

                // The server strips [[remember: …]] tokens before persisting;
                // mirror that for the live bubble and surface what was saved.
                const rememberRe = /\[\[\s*remember\s*:\s*[^\]]+?\s*\]\]/gi;
                if (rememberRe.test(accumulated) || (evt.remembered && evt.remembered.length)) {
                  accumulated = accumulated.replace(rememberRe, '').trimEnd();
                  setMessages(prev => {
                    const next = [...prev];
                    const last = next[next.length - 1];
                    if (last?.role === 'assistant') {
                      next[next.length - 1] = {
                        ...last,
                        content: (last.content || '').replace(rememberRe, '').trimEnd(),
                        remembered: evt.remembered && evt.remembered.length ? evt.remembered : undefined,
                      };
                    }
                    return next;
                  });
                }

                // Do NOT auto-apply. We show a confirmation UI instead.
                const extracted = extractUpdatesFromResponse(accumulated);
                if (accumulated && extracted) {
                  let cleaned = accumulated;
                  if (extracted.stripStart != null && extracted.stripEnd != null) {
                    cleaned = (
                      accumulated.slice(0, extracted.stripStart) +
                      accumulated.slice(extracted.stripEnd)
                    ).trimEnd();
                  }

                  // Normalize recommendation for the UI.
                  // Weights are intentionally ignored — Conviction's pillar weights come from the user's persona.
                  const rec = {
                    filters: extracted.filters || extracted.recommendFilters || extracted.applyFilters,
                    // weights from Ori are deliberately discarded
                  };

                  // Only attach if we actually have something useful to apply
                  if (rec.filters || rec.weights) {
                    setMessages(prev => {
                      const next = [...prev];
                      const last = next[next.length - 1];
                      if (last?.role === 'assistant') {
                        next[next.length - 1] = {
                          ...last,
                          content: cleaned,
                          recommendation: rec,
                        };
                      }
                      return next;
                    });
                  }
                }
                // Ori may offer to open the full Deep Research page for a single
                // stock via an inline token, e.g. [[deep-research:AAPL]]. We strip
                // the token from the visible text and attach the symbol so the
                // ChatPanel can render an "Open Deep Research" confirm button.
                const drMatch = accumulated.match(/\[\[deep-research:\s*([A-Za-z0-9.-]+)\s*\]\]/i);
                if (drMatch) {
                  const drSym = drMatch[1].toUpperCase();
                  setMessages(prev => {
                    const next = [...prev];
                    const last = next[next.length - 1];
                    if (last?.role === 'assistant') {
                      next[next.length - 1] = {
                        ...last,
                        content: (last.content || '').replace(drMatch[0], '').trimEnd(),
                        deepResearch: drSym,
                      };
                    }
                    return next;
                  });
                }
              } else if (evt.type === 'error') {
                setError(evt.message);
                setIsStreaming(false);
                // Drop the trailing assistant bubble if it never produced any
                // text (otherwise it stays stuck on "Thinking…").
                setMessages(prev => {
                  const last = prev[prev.length - 1];
                  if (last?.role === 'assistant' && !last.content) {
                    return prev.slice(0, -1);
                  }
                  return prev;
                });
              } else if (evt.type === 'apply_updates' || evt.type === 'apply_filters') {
                // New behavior: store as recommendation instead of auto-applying
                setMessages(prev => {
                  const next = [...prev];
                  const last = next[next.length - 1];
                  if (last?.role === 'assistant') {
                    const rec = {
                      filters: evt.filters || evt.recommendFilters || evt.applyFilters,
                      weights: evt.weights || evt.recommendWeights,
                    };
                    next[next.length - 1] = {
                      ...last,
                      recommendation: rec,
                    };
                  }
                  return next;
                });
              }
            } catch {}
          }
          pump();
        }).catch((err) => {
          // User pressed Stop (or the connection dropped) mid-stream. Keep
          // whatever text already streamed; only surface real errors.
          setIsStreaming(false);
          if (controller.signal.aborted || err?.name === 'AbortError') return;
          setError(err.message);
        });
      }
      pump();
    } catch (e) {
      setIsStreaming(false);
      abortRef.current = null;
      // Abort = user hit Stop before the stream opened; not an error.
      if (controller.signal.aborted || e?.name === 'AbortError') return;
      setError(e.message);
      setMessages(prev => {
        const last = prev[prev.length - 1];
        return last?.role === 'assistant' && !last.content ? prev.slice(0, -1) : prev;
      });
    }
  }

  // User-initiated Stop: abort the in-flight request/stream, keep any partial
  // reply (drop the bubble only if nothing streamed yet), and mark it stopped.
  function stopStreaming() {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsStreaming(false);
    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last?.role !== 'assistant') return prev;
      if (!last.content) return prev.slice(0, -1); // nothing streamed → remove empty bubble
      const next = [...prev];
      next[next.length - 1] = { ...last, stopped: true, status: undefined };
      return next;
    });
  }

  function askAboutStock(symbol) {
    if (session?.onFocusStock) session.onFocusStock(symbol);
    setFocusSymbols([symbol]);
    setIsOpen(true);
    sendMessage(`Analyze ${symbol} — is it a good investment right now? Consider its valuation, quality metrics, and how it compares to peers in the current filtered set.`);
  }

  function clearChat() {
    setMessages([]);
    setSessionId(null);
    setError(null);
  }

  // ── Recall: past conversations (persisted server-side per user) ────────────

  async function listSessions() {
    try {
      const res = await fetch('/api/chat/sessions');
      if (!res.ok) return [];
      const data = await res.json();
      return data.sessions || [];
    } catch {
      return [];
    }
  }

  async function loadSession(id) {
    try {
      const res = await fetch(`/api/chat/sessions/${encodeURIComponent(id)}`);
      if (!res.ok) return;
      const session = await res.json();

      let stored = [];
      try { stored = JSON.parse(session.messages || '[]'); } catch {}

      const ts = session.updated_at || Date.now();
      const mapped = stored.map((m) => ({ role: m.role, content: m.content, ts }));

      // Re-attach a recommendation (+ cleaned content) to the most recent
      // assistant message so a recalled suggestion can still be applied.
      for (let i = mapped.length - 1; i >= 0; i--) {
        if (mapped[i].role !== 'assistant') continue;
        const extracted = extractUpdatesFromResponse(mapped[i].content);
        if (extracted) {
          let cleaned = mapped[i].content;
          if (extracted.stripStart != null && extracted.stripEnd != null) {
            cleaned = (
              mapped[i].content.slice(0, extracted.stripStart) +
              mapped[i].content.slice(extracted.stripEnd)
            ).trimEnd();
          }
          const filters = extracted.filters || extracted.recommendFilters || extracted.applyFilters;
          if (filters) {
            mapped[i] = { ...mapped[i], content: cleaned, recommendation: { filters } };
          }
        }
        break; // only the last assistant message
      }

      setError(null);
      setMessages(mapped);
      setSessionId(id);
      setIsOpen(true);
    } catch {}
  }

  async function deleteSession(id) {
    try {
      await fetch(`/api/chat/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch { /* best-effort */ }
  }

  // ── Ori's persistent memory (durable user facts, stored server-side) ──────

  async function listMemory() {
    try {
      const res = await fetch('/api/chat/memory');
      if (!res.ok) return [];
      const data = await res.json();
      return data.memory || [];
    } catch {
      return [];
    }
  }

  async function deleteMemory(index) {
    try {
      const res = await fetch(`/api/chat/memory/${index}`, { method: 'DELETE' });
      if (!res.ok) return [];
      const data = await res.json();
      return data.memory || [];
    } catch {
      return [];
    }
  }

  async function clearMemory() {
    try {
      await fetch('/api/chat/memory', { method: 'DELETE' });
    } catch { /* best-effort */ }
    return [];
  }

  function dismissRecommendation(messageIndex) {
    setMessages(prev => {
      const next = [...prev];
      if (next[messageIndex]) {
        const { recommendation, ...rest } = next[messageIndex];
        next[messageIndex] = rest;
      }
      return next;
    });
  }

  // Apply a recommendation by delegating to the screener callback the parent
  // passed in. Exposed from the hook so callers don't have to mutate the return
  // value (which React 19 disallows).
  function applyRecommendation(rec) {
    if (onApplyUpdates) onApplyUpdates(rec);
  }

  return {
    isOpen, setIsOpen,
    messages, isStreaming, error,
    sessionId, focusSymbols, setFocusSymbols,
    sendMessage, stopStreaming, askAboutStock, clearChat,
    applyRecommendation, dismissRecommendation,
    enterDeepResearch: (sym) => session.onEnterDeepResearch?.(sym),
    listSessions, loadSession, deleteSession,
    listMemory, deleteMemory, clearMemory,
    stockCount:
      (session.view || 'screener') === 'deep-research'
        ? (activeStock ? 1 : 0)
        : (filteredStocks?.length || 0),
    contextBadge: (() => {
      const view = session.view || 'screener';
      if (view === 'deep-research') {
        return activeStock?.symbol ? `${activeStock.symbol} · Deep Research` : 'Deep Research';
      }
      if (view === 'portfolio-goals') return 'Portfolio';
      const n = filteredStocks?.length || 0;
      return `${n} stock${n === 1 ? '' : 's'} in view`;
    })(),
    view: session.view || 'screener',
    activeSymbol: activeStock?.symbol || null,
  };
}

const VALID_FILTER_KEYS = [
  'sectors', 'industries', 'mcapMin', 'mcapMax', 'volMin',
  'grossMin', 'opMin', 'netMin', 'ebitdaMin', 'fcfMargMin',
  'roicMin', 'roeMin', 'roaMin', 'peMax', 'pbMax', 'psMax',
  'evEbMax', 'evSMax', 'evGpMax', 'fcfMin', 'ndMax', 'crMin',
  'deMax', 'divMin', 'payMax', 'betaMin', 'betaMax', 'pinnedOnly', 'hasOriConviction',
  // Additional keys the screener actually supports (so Ori recommendations aren't silently dropped)
  'universe', 'search', 'rule40Only', 'revGrowthMin', 'epsGrowthMin',
  'fcfGrowthMin', 'r40Min',
];

/**
 * Best-effort tolerant JSON parser for what Ori actually emits.
 * LLMs frequently produce trailing commas, comments, extra text,
 * single quotes, etc. inside ```json blocks.
 */
function tolerantJsonParse(raw) {
  if (!raw || typeof raw !== 'string') return null;

  let s = raw.trim();

  // Fast path
  try {
    return JSON.parse(s);
  } catch {}

  // Try to isolate the outermost { ... } object
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last > first) {
    s = s.slice(first, last + 1);
  }

  // Aggressive but safe cleaning for common LLM mistakes
  s = s
    // remove trailing commas before } or ]
    .replace(/,\s*([}\]])/g, '$1')
    // remove single-line comments
    .replace(/^\s*\/\/.*$/gm, '')
    // remove block comments
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // best-effort single quotes → double quotes (only for keys and simple strings)
    .replace(/'/g, '"')
    .trim();

  try {
    return JSON.parse(s);
  } catch {}

  // One more desperate attempt: take everything between the very first and last brace
  const f = raw.indexOf('{');
  const l = raw.lastIndexOf('}');
  if (f !== -1 && l > f) {
    try {
      return JSON.parse(raw.slice(f, l + 1));
    } catch {}
  }

  return null;
}

/**
 * Normalizes Ori's filter recommendations into the flat shape our screener expects.
 * Ori often outputs nice nested objects like:
 *   { "roic": { "min": 15 }, "debtToEquity": { "max": 0.2 } }
 * We convert those to our flat keys: { "roicMin": 15, "deMax": 0.2 }
 */
function normalizeFilterObject(raw) {
  if (!raw || typeof raw !== 'object') return {};

  const out = {};

  for (const [key, val] of Object.entries(raw)) {
    // Case 1: Already a flat value (our preferred format)
    if (val === null || val === undefined) continue;

    if (typeof val !== 'object' || Array.isArray(val)) {
      // direct value, e.g. "roicMin": 15 or "sectors": ["Tech"]
      if (VALID_FILTER_KEYS.includes(key)) {
        out[key] = val;
      }
      continue;
    }

    // Case 2: Nested object from Ori, e.g. "roic": { "min": 15 }
    if (val && typeof val === 'object') {
      // min / minimum
      if ('min' in val || 'minimum' in val) {
        const v = val.min ?? val.minimum;
        const flatKey = mapNestedToFlat(key, 'min');
        if (flatKey) out[flatKey] = v;
      }
      // max / maximum
      if ('max' in val || 'maximum' in val) {
        const v = val.max ?? val.maximum;
        const flatKey = mapNestedToFlat(key, 'max');
        if (flatKey) out[flatKey] = v;
      }
      // sometimes people use "greaterThan", "lessThan" etc.
      if ('greaterThan' in val || 'gt' in val) {
        const v = val.greaterThan ?? val.gt;
        const flatKey = mapNestedToFlat(key, 'min');
        if (flatKey) out[flatKey] = v;
      }
      if ('lessThan' in val || 'lt' in val) {
        const v = val.lessThan ?? val.lt;
        const flatKey = mapNestedToFlat(key, 'max');
        if (flatKey) out[flatKey] = v;
      }
    }
  }

  return out;
}

function mapNestedToFlat(nestedKey, direction) {
  const k = nestedKey.toLowerCase();

  const map = {
    roic: 'roicMin',
    roe: 'roeMin',
    roa: 'roaMin',
    grossmargin: 'grossMin',
    opmargin: 'opMin',
    netmargin: 'netMin',
    ebitdamargin: 'ebitdaMin',
    fcfmargin: 'fcfMargMin',
    revenuegrowth: 'revGrowthMin',
    epsgrowth: 'epsGrowthMin',
    fcfgrowth: 'fcfGrowthMin',
    debttoequity: 'deMax',
    debtequity: 'deMax',
    netdebttoequity: 'ndMax',
    netdebtebitda: 'ndMax',
    currentratio: 'crMin',
    payout: 'payMax',
    pe: 'peMax',
    pb: 'pbMax',
    ps: 'psMax',
    evebitda: 'evEbMax',
    evsales: 'evSMax',
    evgp: 'evGpMax',
    fcfyield: 'fcfMin',
    divyield: 'divMin',
    earningsyield: 'earningsYieldMin',
    earnings_yield: 'earningsYieldMin',
    opincome: 'opIncGrowthMin',
    opincomegrowth: 'opIncGrowthMin',
    operatingincomegrowth: 'opIncGrowthMin',
    beta: direction === 'min' ? 'betaMin' : 'betaMax',
    mcap: direction === 'min' ? 'mcapMin' : 'mcapMax',
    marketcap: direction === 'min' ? 'mcapMin' : 'mcapMax',
    volume: 'volMin',
    price: direction === 'min' ? 'priceMin' : 'priceMax',
  };

  return map[k] || null;
}

/**
 * Guards against unit mistakes Ori sometimes makes. The screener expects market
 * cap in billions (2 = $2B) and volume in millions, but the model occasionally
 * emits raw dollar/share counts (e.g. mcapMin: 2000000000). Any market-cap or
 * volume value at or above 1e6 is far outside the sane billions/millions range,
 * so we rescale it. Mutates `f` in place.
 */
function sanitizeFilterUnits(f) {
  if (!f || typeof f !== 'object') return f;
  for (const key of ['mcapMin', 'mcapMax']) {
    const n = Number(f[key]);
    if (Number.isFinite(n) && Math.abs(n) >= 1e6) f[key] = n / 1e9; // dollars → billions
  }
  const v = Number(f.volMin);
  if (Number.isFinite(v) && Math.abs(v) >= 1e6) f.volMin = v / 1e6; // shares → millions
  return f;
}

function tryParseUpdates(jsonStr) {
  try {
    const parsed = tolerantJsonParse(jsonStr);

    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const updates = {};

    // Filters
    const rawFilters = parsed.recommendFilters || parsed.applyFilters || parsed.filters;
    if (rawFilters && typeof rawFilters === 'object') {
      // First try the old flat style
      let cleanFilters = {};
      for (const key of VALID_FILTER_KEYS) {
        if (key in rawFilters) cleanFilters[key] = rawFilters[key];
      }

      // Then merge in any nested style Ori actually used
      const normalized = normalizeFilterObject(rawFilters);
      cleanFilters = { ...cleanFilters, ...normalized };

      sanitizeFilterUnits(cleanFilters);

      if (Object.keys(cleanFilters).length > 0) updates.filters = cleanFilters;
    }

    // Weights
    const rawWeights = parsed.recommendWeights || parsed.applyWeights || parsed.weights;
    if (rawWeights && typeof rawWeights === 'object') {
      const cleanWeights = {};
      for (const key of ['q', 'v', 'g']) {
        if (key in rawWeights && typeof rawWeights[key] === 'number') {
          cleanWeights[key] = Math.max(0, Math.min(100, Math.round(rawWeights[key])));
        }
      }
      if (Object.keys(cleanWeights).length > 0) updates.weights = cleanWeights;
    }

    return Object.keys(updates).length > 0 ? updates : null;
  } catch {
    return null;
  }
}

// Returns { filters, stripStart, stripEnd } or null. stripStart/stripEnd
// describe the slice of `text` to remove when rendering the cleaned message.
function extractUpdatesFromResponse(text) {
  if (!text) return null;

  // Attempt 1: Fenced code block (most common and cleanest). Tolerant of ```json, ```, etc.
  const fenced = [...text.matchAll(/```(?:json|json5)?\s*([\s\S]*?)\s*```/g)];
  if (fenced.length) {
    const m = fenced[fenced.length - 1];
    const updates = tryParseUpdates(m[1]);
    if (updates) return { ...updates, stripStart: m.index, stripEnd: m.index + m[0].length };
  }

  // Attempt 2: Find any JSON object containing a recommendation key (very tolerant)
  // This catches raw JSON (no code fence), weird formatting, extra text around the object, etc.
  const recKeyMatch = text.match(/"(recommendFilters|recommendWeights|applyFilters|applyWeights|filters|weights)"\s*:/);
  if (recKeyMatch) {
    // Walk backward from the key to find the opening {
    let braceStart = -1;
    for (let i = recKeyMatch.index; i >= 0; i--) {
      if (text[i] === '{') { braceStart = i; break; }
    }
    if (braceStart !== -1) {
      // Walk forward to the matching }
      let depth = 0;
      let braceEnd = -1;
      for (let i = braceStart; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') {
          depth--;
          if (depth === 0) { braceEnd = i + 1; break; }
        }
      }
      if (braceEnd !== -1) {
        const candidate = text.slice(braceStart, braceEnd);
        const updates = tryParseUpdates(candidate);
        if (updates) {
          return { ...updates, stripStart: braceStart, stripEnd: braceEnd };
        }
      }
    }
  }

  return null;
}
