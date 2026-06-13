import { useEffect, useRef, useState } from "react";

// Fetches Ori's intelligence layer for the Game Plan — DEFERRED, so the
// deterministic Game Plan paints instantly and Ori's take fades in after.
// Result is cached 24h server-side (Pro-gated). State is tagged with its symbol
// so switching stocks never shows a stale take; `reloadToken` busts the cache
// after a Re-gather. The caller keeps `payloadRef.current = { stats, verdict }`
// updated; we read it at fire time so changing object identity doesn't refire.
export function useGamePlanOri(symbol, { enabled = true, payloadRef, reloadToken = 0 } = {}) {
  const [state, setState] = useState({ sym: null, ori: null, error: null, locked: false, done: false });
  const prev = useRef({ symbol: null, token: reloadToken, enabled: false });

  useEffect(() => {
    if (!symbol || !enabled) return;

    const symbolChanged = prev.current.symbol !== symbol;
    const tokenChanged = prev.current.token !== reloadToken;
    const justEnabled = !prev.current.enabled;
    prev.current = { symbol, token: reloadToken, enabled };
    if (!symbolChanged && !tokenChanged && !justEnabled) return;

    let cancelled = false;
    setState({ sym: symbol, ori: null, error: null, locked: false, done: false });
    const force = tokenChanged && !symbolChanged;

    // Small defer so the deterministic Game Plan renders first.
    const timer = setTimeout(() => {
      fetch(`/api/stocks/game-plan/${symbol}${force ? "?refresh=1" : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadRef?.current || {}),
      })
        .then(async (r) => {
          if (cancelled) return;
          if (r.status === 402) {
            setState({ sym: symbol, ori: null, error: null, locked: true, done: true });
            return;
          }
          if (!r.ok) {
            const j = await r.json().catch(() => null);
            setState({ sym: symbol, ori: null, error: j?.error || "Ori couldn't weigh in right now.", locked: false, done: true });
            return;
          }
          const j = await r.json();
          setState({ sym: symbol, ori: j?.ori || null, error: j?.ori ? null : "Ori couldn't weigh in right now.", locked: false, done: true });
        })
        .catch(() => {
          if (!cancelled) setState({ sym: symbol, ori: null, error: "Ori couldn't weigh in right now.", locked: false, done: true });
        });
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [symbol, enabled, reloadToken, payloadRef]);

  const forSym = state.sym === symbol;
  return {
    ori: forSym ? state.ori : null,
    error: forSym ? state.error : null,
    locked: forSym ? state.locked : false,
    // "loading" until this symbol's request settles (and only while enabled).
    loading: !!symbol && enabled && !(forSym && state.done),
  };
}
