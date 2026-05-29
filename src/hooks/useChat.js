import { useState, useRef } from 'react';

export function useChat(filteredStocks, filters, weights, onApplyUpdates, activeStock = null, session = {}) {
  const [isOpen, setIsOpen]         = useState(false);
  const [messages, setMessages]     = useState([]);
  const [sessionId, setSessionId]   = useState(null);
  const [isStreaming, setIsStreaming]= useState(false);
  const [error, setError]           = useState(null);
  const [focusSymbols, setFocusSymbols] = useState([]);
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
      net_debt_ebitda: s.net_debt_ebitda, current_ratio: s.current_ratio,
      debt_equity: s.debt_equity, div_yield: s.div_yield,
      payout: s.payout, beta: s.beta, score: s.score,
      qScore: s.qScore, vScore: s.vScore, gScore: s.gScore,
      effectiveWeights: s.effectiveWeights,
    };
  }

  function buildContext() {
    const sorted = [...(filteredStocks || [])].sort((a, b) => (b.score || 0) - (a.score || 0));
    const top = sorted.slice(0, 50);

    // Provide Ori with the list of available sectors and industries so it uses correct values
    const allSectors = [...new Set((filteredStocks || []).map(s => s.sector).filter(Boolean))].sort();
    const allIndustries = [...new Set((filteredStocks || []).map(s => s.industry).filter(Boolean))].sort();

    // The stock the user currently has open in the detail pane (if any), with
    // the richer data Ori can't see from the table alone (profile/ratings/grades/RSI).
    const activeStockContext = activeStock
      ? {
          symbol: activeStock.symbol,
          name: activeStock.name,
          sector: activeStock.sector,
          industry: activeStock.industry,
          price: activeStock.price,
          mcap: activeStock.mcap,
          pe: activeStock.pe, pb: activeStock.pb, ps: activeStock.ps,
          ev_ebitda: activeStock.ev_ebitda, ev_sales: activeStock.ev_sales, ev_gp: activeStock.ev_gp,
          fcf_yield: activeStock.fcf_yield, gross_margin: activeStock.gross_margin,
          op_margin: activeStock.op_margin, net_margin: activeStock.net_margin,
          fcf_margin: activeStock.fcf_margin, roic: activeStock.roic, roe: activeStock.roe, roa: activeStock.roa,
          revenue_growth: activeStock.revenue_growth, eps_growth: activeStock.eps_growth, fcf_growth: activeStock.fcf_growth,
          net_debt_ebitda: activeStock.net_debt_ebitda, current_ratio: activeStock.current_ratio,
          debt_equity: activeStock.debt_equity, div_yield: activeStock.div_yield, beta: activeStock.beta,
          score: activeStock.score, qScore: activeStock.qScore, vScore: activeStock.vScore, gScore: activeStock.gScore,
          latestRsi: activeStock.latestRsi,
          profile: activeStock.profile
            ? {
                description: activeStock.profile.description,
                ceo: activeStock.profile.ceo,
                fullTimeEmployees: activeStock.profile.fullTimeEmployees,
                website: activeStock.profile.website,
                country: activeStock.profile.country,
                ipoDate: activeStock.profile.ipoDate,
                range: activeStock.profile.range,
                exchange: activeStock.profile.exchangeFullName || activeStock.profile.exchange,
              }
            : null,
          ratings: activeStock.ratings || null,
          grades: (activeStock.grades || []).slice(0, 8),
          performance: activeStock.performance || null,
          rsiTrend: activeStock.rsiTrend || null,
        }
      : null;

    return {
      filters,
      weights,
      today: new Date().toISOString().slice(0, 10),
      totalFiltered: (filteredStocks || []).length,
      activeScreener: session.activeScreener || null,
      pinnedStocks: (session.pinnedStocks || []).map(compact),
      activeStock: activeStockContext,
      stocks: top.map(compact),
      availableSectors: allSectors,
      availableIndustries: allIndustries,
      focusSymbols,
      scorecardDefinition: {
        description: "The Orizen Score is a weighted average of three pillars. All inputs are ranked 0-1 relative to the current filtered set.",
        Q: "Quality — average rank of: ROIC, ROE, Gross margin, Op margin, FCF margin, Current ratio (higher better), Net Debt/EBITDA & Debt/Equity (lower better)",
        V: "Value — average rank of: EV/GP, EV/EBITDA, P/E (lower better), FCF Yield (higher better), DCF Margin of Safety (higher better)",
        G: "Growth — average rank of: Revenue growth (TTM), EPS growth (TTM), FCF growth (TTM)",
        note: "If a stock is missing data for a pillar, its weight is redistributed to the remaining pillars (see 'effectiveWeights' on cards)."
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
              } else if (evt.type === 'done') {
                setSessionId(evt.sessionId);
                setIsStreaming(false);

                const _extractedDiag = extractUpdatesFromResponse(accumulated);
                console.log('[Ori] diagnostic ' + JSON.stringify({
                  length: accumulated.length,
                  tail: accumulated.slice(-600),
                  extracted: _extractedDiag,
                  hasRecommendBlock: /recommendFilters|recommendWeights|applyFilters|applyWeights/.test(accumulated),
                }));

                // Extra loud logging when Ori tried to recommend something
                if (/recommendFilters|recommendWeights|applyFilters|applyWeights/.test(accumulated) && !_extractedDiag) {
                  console.warn('[Ori] ⚠️  Detected recommendation JSON in response but extraction returned null. Raw last 1200 chars:');
                  console.warn(accumulated.slice(-1200));
                }

                // New behavior: Do NOT auto-apply. We will show a confirmation UI instead.
                if (accumulated) {
                  const extracted = _extractedDiag;
                  if (extracted) {
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
                    } else {
                      console.warn('[Ori] Extraction produced an object but no usable filters/weights after normalization');
                    }
                  }
                }
              } else if (evt.type === 'error') {
                setError(evt.message);
                setIsStreaming(false);
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
    setFocusSymbols([symbol]);
    setIsOpen(true);
    sendMessage(`Analyze ${symbol} — is it a good investment right now? Consider its valuation, quality metrics, and how it compares to peers in the current filtered set.`);
  }

  function clearChat() {
    setMessages([]);
    setSessionId(null);
    setError(null);
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

  return {
    isOpen, setIsOpen,
    messages, isStreaming, error,
    sessionId, focusSymbols, setFocusSymbols,
    sendMessage, askAboutStock, clearChat,
    dismissRecommendation,
    stockCount: filteredStocks?.length || 0,
  };
}

function summarizeApplied(f) {
  const parts = [];
  if (f.industries?.length) parts.push(`industries=${f.industries.join('/')}`);
  if (f.sectors?.length) parts.push(`sectors=${f.sectors.join('/')}`);
  for (const k of ['mcapMin','mcapMax','roicMin','grossMin','opMin','netMin','peMax','pbMax','psMax','evEbMax','fcfMin','ndMax','crMin','deMax','divMin','betaMin','betaMax']) {
    if (f[k] != null && f[k] !== '') parts.push(`${k}=${f[k]}`);
  }
  return parts.join(', ') || 'updated';
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
    beta: direction === 'min' ? 'betaMin' : 'betaMax',
    mcap: direction === 'min' ? 'mcapMin' : 'mcapMax',
    marketcap: direction === 'min' ? 'mcapMin' : 'mcapMax',
    volume: 'volMin',
  };

  return map[k] || null;
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
