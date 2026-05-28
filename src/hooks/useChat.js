import { useState, useRef } from 'react';

const MODES = [
  { id: 'general',            label: 'General',           icon: '💬', color: 'bg-gray-700' },
  { id: 'compounding_moat',   label: 'Compounding Moat',  icon: '🏰', color: 'bg-emerald-800' },
  { id: 'emerging_disruptor', label: 'Disruptor',         icon: '🚀', color: 'bg-violet-800' },
  { id: 'moonshot',           label: 'Moonshot',          icon: '🌙', color: 'bg-amber-800' },
  { id: 'valuation_check',    label: 'Valuation',         icon: '📊', color: 'bg-blue-800' },
  { id: 'hold_duration',      label: 'Hold Duration',     icon: '⏱️', color: 'bg-rose-800' },
];

export { MODES };

export function useChat(filteredStocks, filters, weights, onApplyUpdates) {
  const [isOpen, setIsOpen]         = useState(false);
  const [mode, setMode]             = useState('general');
  const [messages, setMessages]     = useState([]);
  const [sessionId, setSessionId]   = useState(null);
  const [isStreaming, setIsStreaming]= useState(false);
  const [error, setError]           = useState(null);
  const [focusSymbols, setFocusSymbols] = useState([]);
  const abortRef = useRef(null);

  function buildContext() {
    const sorted = [...(filteredStocks || [])].sort((a, b) => (b.score || 0) - (a.score || 0));
    const top = sorted.slice(0, 50);

    // Provide Ori with the list of available sectors and industries so it uses correct values
    const allSectors = [...new Set((filteredStocks || []).map(s => s.sector).filter(Boolean))].sort();
    const allIndustries = [...new Set((filteredStocks || []).map(s => s.industry).filter(Boolean))].sort();

    return {
      filters,
      weights,
      stocks: top.map(s => ({
        symbol: s.symbol, name: s.name, sector: s.sector,
        price: s.price, mcap: s.mcap, pe: s.pe, pb: s.pb, ps: s.ps,
        ev_ebitda: s.ev_ebitda, ev_sales: s.ev_sales, ev_gp: s.ev_gp,
        fcf_yield: s.fcf_yield, gross_margin: s.gross_margin,
        op_margin: s.op_margin, net_margin: s.net_margin,
        fcf_margin: s.fcf_margin, roic: s.roic, roe: s.roe, roa: s.roa,
        net_debt_ebitda: s.net_debt_ebitda, current_ratio: s.current_ratio,
        debt_equity: s.debt_equity, div_yield: s.div_yield,
        payout: s.payout, beta: s.beta, score: s.score,
        qScore: s.qScore, vScore: s.vScore, gScore: s.gScore,
        effectiveWeights: s.effectiveWeights,
      })),
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
          mode,
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
                  tail: accumulated.slice(-500),
                  extracted: _extractedDiag,
                  hasOnApplyUpdates: !!onApplyUpdates,
                }));
                // New behavior: Do NOT auto-apply. We will show a confirmation UI instead.
                if (accumulated) {
                  const extracted = _extractedDiag;
                  if (extracted) {
                    const cleaned = (
                      accumulated.slice(0, extracted.stripStart) +
                      accumulated.slice(extracted.stripEnd)
                    ).trimEnd();

                    // Normalize recommendation for the UI
                    const rec = {
                      filters: extracted.filters || extracted.recommendFilters || extracted.applyFilters,
                      weights: extracted.weights || extracted.recommendWeights,
                    };

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
    mode, setMode,
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
];

function tryParseUpdates(jsonStr) {
  try {
    const parsed = JSON.parse(jsonStr.trim());

    const updates = {};

    // Filters
    const rawFilters = parsed.applyFilters || parsed.filters;
    if (rawFilters && typeof rawFilters === 'object') {
      const cleanFilters = {};
      for (const key of VALID_FILTER_KEYS) {
        if (key in rawFilters) cleanFilters[key] = rawFilters[key];
      }
      if (Object.keys(cleanFilters).length > 0) updates.filters = cleanFilters;
    }

    // Weights (new)
    const rawWeights = parsed.applyWeights || parsed.weights;
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

  // 1) Prefer fenced ```json ... ``` block (last one wins)
  const fenced = [...text.matchAll(/```json\s*([\s\S]*?)\s*```/g)];
  if (fenced.length) {
    const m = fenced[fenced.length - 1];
    const updates = tryParseUpdates(m[1]);
    if (updates) return { ...updates, stripStart: m.index, stripEnd: m.index + m[0].length };
  }

  // 2) Fallback: locate a raw JSON object containing applyFilters or applyWeights
  const keyIdx = Math.max(
    text.lastIndexOf('"applyFilters"'),
    text.lastIndexOf('"applyWeights"')
  );
  if (keyIdx === -1) return null;

  let start = keyIdx;
  while (start >= 0 && text[start] !== '{') start--;
  if (start < 0) return null;

  let depth = 0;
  let end = -1;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end < 0) return null;

  const updates = tryParseUpdates(text.slice(start, end));
  if (!updates) return null;
  return { ...updates, stripStart: start, stripEnd: end };
}
