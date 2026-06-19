import { useEffect, useRef, useState } from "react";

// Fetches Ori's intelligence layer for the Game Plan — DEFERRED, so the
// deterministic Game Plan paints instantly and Ori's take fades in after.
// Result is cached 24h server-side (Pro-gated). State is tagged with its symbol
// so switching stocks never shows a stale take; `reloadToken` busts the cache
// after a Re-gather. The caller keeps `payloadRef.current = { stats, verdict }`
// updated; we read it at fire time so changing object identity doesn't refire.
export function useGamePlanOri(symbol, { enabled = true, payloadRef, reloadToken = 0 } = {}) {
  const [state, setState] = useState({ sym: null, ori: null, error: null, locked: false, done: false });
  // Bumped by retry() to re-fire the request after a transient failure (e.g.
  // "Ori is busy" / 503 overloaded), without changing symbol or reloadToken.
  const [retryNonce, setRetryNonce] = useState(0);
  // Bumped by refresh() for an admin-only frontier-led cache bust (no re-gather).
  const [refreshNonce, setRefreshNonce] = useState(0);
  const prev = useRef({ symbol: null, token: reloadToken, enabled: false, nonce: 0, refreshNonce: 0 });

  useEffect(() => {
    if (!symbol || !enabled) return;

    const symbolChanged = prev.current.symbol !== symbol;
    const tokenChanged = prev.current.token !== reloadToken;
    const nonceChanged = prev.current.nonce !== retryNonce;
    const refreshChanged = prev.current.refreshNonce !== refreshNonce;
    const justEnabled = !prev.current.enabled;
    prev.current = { symbol, token: reloadToken, enabled, nonce: retryNonce, refreshNonce };
    if (!symbolChanged && !tokenChanged && !justEnabled && !nonceChanged && !refreshChanged) return;

    let cancelled = false;
    setState({ sym: symbol, ori: null, error: null, locked: false, done: false });
    // Same-symbol re-gather bumps the token; opening DR after a re-gather enables
    // Ori with reloadToken > 0 even when the symbol also changed while disabled.
    const force =
      (tokenChanged && !symbolChanged) ||
      (justEnabled && reloadToken > 0) ||
      (refreshChanged && !symbolChanged);
    // A manual retry (after a failed first load) leads with the least-busy tier
    // and skips the scarce frontier model — see the game-plan route. Re-gather
    // (force) and admin refresh still do a full frontier-led refresh.
    const isRetry =
      nonceChanged && !symbolChanged && !tokenChanged && !justEnabled && !refreshChanged;
    const qs = force ? "?refresh=1" : isRetry ? "?retry=1" : "";

    // Small defer so the deterministic Game Plan renders first.
    const timer = setTimeout(() => {
      fetch(`/api/stocks/game-plan/${symbol}${qs}`, {
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
  }, [symbol, enabled, reloadToken, payloadRef, retryNonce, refreshNonce]);

  const forSym = state.sym === symbol;
  return {
    ori: forSym ? state.ori : null,
    error: forSym ? state.error : null,
    locked: forSym ? state.locked : false,
    // "loading" until this symbol's request settles (and only while enabled).
    loading: !!symbol && enabled && !(forSym && state.done),
    // Re-attempt after a transient failure; no-op while a request is in flight.
    retry: () => setRetryNonce((n) => n + 1),
    // Admin-only: frontier-led cache bust without re-gathering FMP data.
    refresh: () => setRefreshNonce((n) => n + 1),
  };
}
