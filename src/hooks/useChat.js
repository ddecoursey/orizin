import { useState } from 'react';

export function useChat(filteredStocks, filters, weights, onApplyUpdates, activeStock = null, session = {}) {
  const [isOpen, setIsOpen]         = useState(false);
  const [messages, setMessages]     = useState([]);
  const [sessionId, setSessionId]   = useState(null);
  const [isStreaming, setIsStreaming]= useState(false);
  const [error, setError]           = useState(null);
  const [focusSymbols, setFocusSymbols] = useState([]);

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
      payout: s.payout, beta: s.beta, score: s.score,
      qScore: s.qScore, vScore: s.vScore, gScore: s.gScore,
      dataCoverage: s.dataCoverage,
      effectiveWeights: s.effectiveWeights,
    };
  }

  function buildContext() {
    const sorted = [...(filteredStocks || [])].sort((a, b) => (b.score || 0) - (a.score || 0));
    const top = sorted.slice(0, 50);

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
        score: s.score, qScore: s.qScore, vScore: s.vScore, gScore: s.gScore,
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
      };
    }

    const activeStockContext = toContextStock(activeStock);
    const focusStocksContext = (session.focusStocks || []).map(toContextStock).filter(Boolean);

    return {
      filters,
      weights,
      view: session.view || 'screener',
      today: new Date().toISOString().slice(0, 10),
      totalFiltered: (filteredStocks || []).length,
      activeScreener: session.activeScreener || null,
      pinnedStocks: (session.pinnedStocks || []).map(compact),
      news: (session.news || []).slice(0, 10).map((a) => ({
        title: a.title,
        source: a.site || a.publisher,
        symbol: a.symbol,
        date: a.publishedDate,
      })),
      activeStock: activeStockContext,
      focusStocks: focusStocksContext,
      // User's portfolios + goals (framing context for all Ori advice)
      portfolioGoals: session.portfolioGoals || null,
      stocks: top.map(compact),
      availableSectors: allSectors,
      availableIndustries: allIndustries,
      focusSymbols,
      scorecardDefinition: {
        description: "The Orizin Score is a weighted average of three pillars. All inputs are tie-aware 0-1 percentile ranks within the current filtered set.",
        Q: "Quality — average rank of: ROIC, ROE, Gross margin, Op margin, FCF margin, Current ratio (higher better, capped at 3x), Net Debt/EBITDA & Debt/Equity (lower better)",
        V: "Value — average rank of: EV/GP, EV/EBITDA, P/E (lower better), FCF Yield (higher better), DCF Margin of Safety (higher better)",
        G: "Growth — average rank of: Revenue growth (TTM), EPS growth (TTM), FCF growth (TTM)",
        note: "Junk guards: negative P/E and negative D/E rank WORST (not best); ROE on negative equity is voided. Missing inputs are imputed at rank 0.45 instead of ignored, and stocks with <3 of 16 real inputs are unscored — so sparse data can't inflate a score. dataCoverage = fraction of the 16 inputs with real data; treat low-coverage scores skeptically."
      }
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

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          message: text,
          context: buildContext(),
        }),
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
              } else if (evt.type === 'done') {
                setSessionId(evt.sessionId);
                setIsStreaming(false);

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
                  // Weights are intentionally ignored — the user controls the Q/V/G sliders directly.
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
        });
      }
      pump();
    } catch (e) {
      setError(e.message);
      setIsStreaming(false);
    }
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
    sendMessage, askAboutStock, clearChat,
    applyRecommendation, dismissRecommendation,
    enterDeepResearch: (sym) => session.onEnterDeepResearch?.(sym),
    listSessions, loadSession, deleteSession,
    listMemory, deleteMemory, clearMemory,
    stockCount: filteredStocks?.length || 0,
    // Surfaced so the chat UI can tailor itself to the current page.
    view: session.view || 'screener',
    activeSymbol: activeStock?.symbol || null,
  };
}

const VALID_FILTER_KEYS = [
  'sectors', 'industries', 'mcapMin', 'mcapMax', 'volMin',
  'grossMin', 'opMin', 'netMin', 'ebitdaMin', 'fcfMargMin',
  'roicMin', 'roeMin', 'roaMin', 'peMax', 'pbMax', 'psMax',
  'evEbMax', 'evSMax', 'evGpMax', 'fcfMin', 'ndMax', 'crMin',
  'deMax', 'divMin', 'payMax', 'betaMin', 'betaMax', 'pinnedOnly',
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
