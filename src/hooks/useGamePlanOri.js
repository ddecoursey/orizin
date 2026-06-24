import { useCallback, useEffect, useRef, useState } from "react";
import { ORI_FRONTIER_TTL_MS, isFreshOriCache } from "../lib/oriCacheTtl.js";

const DEFER_MS = 350;
// Must exceed the server's structured-retry budget (GEMINI_JSON_BUDGET_MS ≈ 45s):
// the game-plan route now rides out a Gemini overload with up to ~6 backed-off
// attempts inside a single request, so the client waits for that to settle (or
// return a friendly 503) rather than aborting mid-retry.
const ORI_TIMEOUT_MS = 70_000;

// Transient failures worth auto-retrying: 429 (rate limiter — Deep Research fires
// several aiDetailLimiter endpoints at once, so a burst can momentarily trip it)
// and 503 (Gemini overloaded). Anything else surfaces immediately.
const TRANSIENT_STATUS = new Set([429, 503]);
const MAX_AUTO_RETRIES = 3;
const BASE_BACKOFF_MS = 700;
const MAX_BACKOFF_MS = 8000;

// Promise that resolves after `ms`, or rejects (AbortError) if the signal fires —
// so a user cancel / timeout interrupts the wait immediately.
function abortableSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => { clearTimeout(t); reject(new DOMException("Aborted", "AbortError")); },
      { once: true },
    );
  });
}

// fetch() that auto-retries transient 429/503 with exponential backoff + jitter,
// honoring the server's Retry-After header when present (capped). Re-fetches fresh
// each attempt; throws AbortError if the signal fires mid-wait.
async function fetchWithBackoff(url, opts, signal) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, opts);
    if (!TRANSIENT_STATUS.has(res.status) || attempt >= MAX_AUTO_RETRIES) return res;
    const retryAfter = Number(res.headers.get("retry-after"));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(MAX_BACKOFF_MS, retryAfter * 1000)
      : Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt) + Math.floor(Math.random() * 400);
    await abortableSleep(wait, signal);
  }
}

// Fetches Ori's intelligence layer for the Game Plan — DEFERRED, so the
// deterministic Game Plan paints instantly and Ori's take fades in after.
// Frontier (Pro) is cached ~1 week server-side per symbol (memory + SQLite) and is
// always served when present. FMP re-gather does not bust it. Explicit "Refresh
// Ori" re-runs flash/lite only. `initialOri` can paint a cached take instantly
// from the screener row. Only a fresh frontier seed skips HTTP — lite still
// revalidates so an expired lite placeholder can upgrade to a frontier miss.
function cachedFrontierSeed(ori, cachedAt) {
  if (ori?.modelTier !== "frontier") return null;
  // A review lifted back to the screener row during THIS session (after a Deep
  // Research visit) carries no cachedAt — it's fresh by construction, so seed it
  // so Ori's Take reappears INSTANTLY when you navigate back to the page instead
  // of vanishing while a fresh HTTP round-trip (which can rate-limit) re-runs.
  if (cachedAt == null) return ori;
  if (!isFreshOriCache(cachedAt, ORI_FRONTIER_TTL_MS)) return null;
  return ori;
}

function cachedLiteSeed(ori) {
  return ori?.modelTier === "lite" ? ori : null;
}

export function useGamePlanOri(symbol, {
  enabled = true,
  payloadRef,
  initialOri = null,
  initialOriCachedAt = null,
} = {}) {
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
    const liteRefresh = refreshChanged && !symbolChanged;
    const skipFetch = !liteRefresh && !nonceChanged;
    const frontierSeed = skipFetch ? cachedFrontierSeed(initialOri, initialOriCachedAt) : null;
    const liteSeed = skipFetch ? cachedLiteSeed(initialOri) : null;
    setState({
      sym: requestSym,
      ori: frontierSeed || liteSeed,
      error: null,
      locked: false,
      done: !!frontierSeed,
      cancelled: false,
    });
    // Weekly frontier cache is authoritative — skip the revalidation round-trip.
    if (frontierSeed) return;

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
      fetchWithBackoff(`/api/stocks/game-plan/${requestSym}${qs}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payloadRef?.current || {}),
        signal: controller.signal,
      }, controller.signal)
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
            // Still transient after the auto-retries — tell the user it's busy and
            // a manual "try again" in a moment will likely work.
            const transient = TRANSIENT_STATUS.has(r.status);
            settle({
              ori: null,
              error: transient
                ? "Ori is busy right now — give it a moment and try again."
                : (j?.error || "Ori couldn't weigh in right now."),
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
                error: "Ori's take timed out — Gemini may be overloaded. Try again in a moment.",
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
    // initialOri is read when symbol/retry/refresh changes — not a dep, so a
    // late row.ori update can't abort an in-flight frontier generation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // Admin-only: flash/lite re-run without busting the weekly frontier cache.
    refresh: () => {
      if (inFlight) return;
      setRefreshNonce((n) => n + 1);
    },
    cancel,
  };
}