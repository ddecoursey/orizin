import { useCallback, useEffect, useRef, useState } from "react";

const DEFER_MS = 350;
const ORI_TIMEOUT_MS = 30_000;

// Fetches Ori's intelligence layer for the Game Plan — DEFERRED, so the
// deterministic Game Plan paints instantly and Ori's take fades in after.
// Frontier (Pro) is cached 24h server-side per symbol; FMP re-gather does NOT
// bust that cache. Admin "Refresh Ori" re-runs on flash/lite only. The caller
// keeps `payloadRef.current = { stats, verdict }` updated; we read it at fire
// time so changing object identity doesn't refire.
export function useGamePlanOri(symbol, { enabled = true, payloadRef } = {}) {
  const [state, setState] = useState({
    sym: null,
    ori: null,
    error: null,
    locked: false,
    done: false,
    cancelled: false,
  });
  // Bumped by retry() to re-fire the request after a transient failure (e.g.
  // "Ori is busy" / 503 overloaded), without changing symbol or reloadToken.
  const [retryNonce, setRetryNonce] = useState(0);
  // Bumped by refresh() for an admin-only flash/lite re-run (no frontier bust).
  const [refreshNonce, setRefreshNonce] = useState(0);
  const prev = useRef({ symbol: null, enabled: false, nonce: 0, refreshNonce: 0 });
  const deferTimerRef = useRef(null);
  const abortRef = useRef(null);
  const abortReasonRef = useRef(null);

  const cancel = useCallback(() => {
    clearTimeout(deferTimerRef.current);
    deferTimerRef.current = null;
    abortReasonRef.current = "user";
    abortRef.current?.abort();
    abortRef.current = null;
    if (symbol) {
      setState({
        sym: symbol,
        ori: null,
        error: null,
        locked: false,
        done: true,
        cancelled: true,
      });
    }
  }, [symbol]);

  useEffect(() => {
    if (!symbol || !enabled) return;

    const symbolChanged = prev.current.symbol !== symbol;
    const nonceChanged = prev.current.nonce !== retryNonce;
    const refreshChanged = prev.current.refreshNonce !== refreshNonce;
    const justEnabled = !prev.current.enabled;
    prev.current = { symbol, enabled, nonce: retryNonce, refreshNonce };
    if (!symbolChanged && !justEnabled && !nonceChanged && !refreshChanged) return;

    clearTimeout(deferTimerRef.current);
    deferTimerRef.current = null;
    abortReasonRef.current = "cleanup";
    abortRef.current?.abort();
    abortRef.current = null;

    let cancelled = false;
    const requestSym = symbol;
    setState({
      sym: requestSym,
      ori: null,
      error: null,
      locked: false,
      done: false,
      cancelled: false,
    });
    const liteRefresh = refreshChanged && !symbolChanged;
    // Manual retry leads with flash/lite — see the game-plan route.
    const isRetry =
      nonceChanged && !symbolChanged && !justEnabled && !refreshChanged;
    const qs = liteRefresh ? "?refresh=lite" : isRetry ? "?retry=1" : "";

    const controller = new AbortController();
    abortRef.current = controller;
    abortReasonRef.current = null;

    const timeoutId = setTimeout(() => {
      abortReasonRef.current = "timeout";
      controller.abort();
    }, ORI_TIMEOUT_MS);

    const settle = (patch) => {
      if (cancelled) return;
      setState({ sym: requestSym, ...patch });
    };

    // Small defer so the deterministic Game Plan renders first.
    deferTimerRef.current = setTimeout(() => {
      deferTimerRef.current = null;
      fetch(`/api/stocks/game-plan/${requestSym}${qs}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadRef?.current || {}),
        signal: controller.signal,
      })
        .then(async (r) => {
          if (cancelled) return;
          clearTimeout(timeoutId);
          if (r.status === 402) {
            settle({ ori: null, error: null, locked: true, done: true, cancelled: false });
            return;
          }
          if (!r.ok) {
            const j = await r.json().catch(() => null);
            if (cancelled) return;
            settle({
              ori: null,
              error: j?.error || "Ori couldn't weigh in right now.",
              locked: false,
              done: true,
              cancelled: false,
            });
            return;
          }
          const j = await r.json();
          if (cancelled) return;
          settle({
            ori: j?.ori || null,
            error: j?.ori ? null : "Ori couldn't weigh in right now.",
            locked: false,
            done: true,
            cancelled: false,
          });
        })
        .catch((err) => {
          clearTimeout(timeoutId);
          if (cancelled) return;
          if (err?.name === "AbortError") {
            if (abortReasonRef.current === "timeout") {
              settle({
                ori: null,
                error: "Ori's take timed out after 30 seconds.",
                locked: false,
                done: true,
                cancelled: false,
              });
            }
            return;
          }
          settle({
            ori: null,
            error: "Ori couldn't weigh in right now.",
            locked: false,
            done: true,
            cancelled: false,
          });
        });
    }, DEFER_MS);

    return () => {
      cancelled = true;
      clearTimeout(deferTimerRef.current);
      deferTimerRef.current = null;
      clearTimeout(timeoutId);
      abortReasonRef.current = "cleanup";
      controller.abort();
      if (abortRef.current === controller) abortRef.current = null;
    };
  }, [symbol, enabled, payloadRef, retryNonce, refreshNonce]);

  const forSym = state.sym === symbol;
  const inFlight = !!symbol && enabled && !(forSym && state.done);
  return {
    ori: forSym ? state.ori : null,
    error: forSym ? state.error : null,
    locked: forSym ? state.locked : false,
    cancelled: forSym ? state.cancelled : false,
    // "loading" until this symbol's request settles (and only while enabled).
    loading: inFlight,
    // Re-attempt after a transient failure; no-op while a request is in flight.
    retry: () => {
      if (inFlight) return;
      setRetryNonce((n) => n + 1);
    },
    // Admin-only: flash/lite re-run without busting the 24h frontier cache.
    refresh: () => {
      if (inFlight) return;
      setRefreshNonce((n) => n + 1);
    },
    cancel,
  };
}