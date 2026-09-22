import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { TOURS, TOUR_VERSION, tourById, visibleSteps } from "../lib/tours.jsx";

// ─────────────────────────────────────────────────────────────────────────────
// Guided-tour state machine.
//
// Owns WHICH tour is running and WHERE we are in it; <TourOverlay> owns the
// drawing. Steps are declarative (see src/lib/tours.js) — a step may ask the
// tour to switch pages, open a panel, or supply a demo symbol before it paints,
// which is why navigation is injected here rather than imported: App owns
// `navigateTo` / `openDeepResearch` and the modal setters.
//
// Progress persists in the per-user settings blob under the `tour` key
// ({ version, completed: { [tourId]: true }, seenWelcome }) so a returning user
// is not re-prompted, and so "Restart tour" works from any device.
// ─────────────────────────────────────────────────────────────────────────────

export const emptyTourState = { version: TOUR_VERSION, completed: {}, seenWelcome: false };

// A stored blob from an older build (or a hand-edited one) is coerced into
// shape rather than trusted — a malformed value must never break the app shell.
export function normalizeTourState(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...emptyTourState };
  const completed = {};
  if (raw.completed && typeof raw.completed === "object" && !Array.isArray(raw.completed)) {
    for (const [k, v] of Object.entries(raw.completed)) {
      if (v) completed[String(k).slice(0, 40)] = true;
    }
  }
  return {
    version: Number.isFinite(raw.version) ? raw.version : 0,
    completed,
    seenWelcome: !!raw.seenWelcome,
  };
}

export function useTour({
  // Everything the tour needs to drive the app between steps.
  actions = {},
  // Gating context — steps that don't apply to this account are dropped, so a
  // free user is never spotlighted onto a control they cannot see.
  ctx = {},
  // Persisted `tour` blob from user settings (null until settings hydrate).
  persisted = null,
  onPersist,
} = {}) {
  const [tourId, setTourId] = useState(null);
  const [index, setIndex] = useState(0);
  // Bumped whenever a step's setup has run, so the overlay only measures after
  // the app has actually navigated/opened what the step points at.
  const [stepReady, setStepReady] = useState(false);

  const state = useMemo(() => normalizeTourState(persisted), [persisted]);
  const hydrated = persisted !== null;

  // Latest actions/ctx for step setup. Synced in a layout effect (not during
  // render) — it runs before the setup effect below, so setup never sees a
  // stale navigate function.
  const actionsRef = useRef(actions);
  const ctxRef = useRef(ctx);
  useLayoutEffect(() => {
    actionsRef.current = actions;
    ctxRef.current = ctx;
  });

  const tour = tourById(tourId);
  // Recomputed from ctx so a plan change mid-tour (e.g. the user upgrades from
  // the tour's own upgrade step) immediately reveals the Pro-only steps.
  const steps = useMemo(
    () => (tour ? visibleSteps(tour, ctx) : []),
    // ctx is rebuilt each render by the caller; depend on the gating fields only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tour, ctx.canUseOri, ctx.isAdmin, ctx.plan, ctx.isMobile, ctx.hasStocks, ctx.strategyCount],
  );
  const total = steps.length;
  const clampedIndex = total ? Math.min(index, total - 1) : 0;
  const step = total ? steps[clampedIndex] : null;

  const persist = useCallback(
    (patch) => {
      if (!onPersist) return;
      onPersist({ ...state, version: TOUR_VERSION, ...patch });
    },
    [onPersist, state],
  );

  const stop = useCallback(
    ({ completed = false } = {}) => {
      const finishedId = tourId;
      setTourId(null);
      setIndex(0);
      setStepReady(false);
      actionsRef.current.onExit?.();
      if (completed && finishedId) {
        persist({ completed: { ...state.completed, [finishedId]: true }, seenWelcome: true });
      } else {
        persist({ seenWelcome: true });
      }
    },
    [tourId, persist, state.completed],
  );

  const start = useCallback((id, { at = 0 } = {}) => {
    if (!tourById(id)) return;
    setTourId(id);
    setIndex(Math.max(0, at));
    setStepReady(false);
  }, []);

  const goto = useCallback(
    (i) => {
      if (!total) return;
      setIndex(Math.max(0, Math.min(total - 1, i)));
      setStepReady(false);
    },
    [total],
  );

  const next = useCallback(() => {
    if (clampedIndex >= total - 1) {
      stop({ completed: true });
      return;
    }
    setIndex(clampedIndex + 1);
    setStepReady(false);
  }, [clampedIndex, total, stop]);

  const prev = useCallback(() => {
    if (clampedIndex <= 0) return;
    setIndex(clampedIndex - 1);
    setStepReady(false);
  }, [clampedIndex]);

  // Run the step's setup (navigate, open a panel, seed a demo symbol) BEFORE the
  // overlay measures its target. `setup` may return a promise; the overlay stays
  // in its "preparing" state until it settles, so the spotlight never lands on a
  // page that is still unmounting.
  useEffect(() => {
    if (!step) return;
    let cancelled = false;
    setStepReady(false);
    const run = async () => {
      try {
        await step.setup?.(actionsRef.current, ctxRef.current);
      } catch {
        /* a setup that fails still shows the copy — never trap the user */
      }
      if (!cancelled) setStepReady(true);
    };
    run();
    return () => {
      cancelled = true;
    };
    // `step` is a stable object from the module-level tour definition.
  }, [step]);

  // Esc exits, arrows move. Registered only while a tour is running.
  useEffect(() => {
    if (!tourId) return;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        stop({ completed: false });
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tourId, stop, next, prev]);

  // The tours this account can actually take, with their completion state.
  const catalog = useMemo(
    () =>
      TOURS.filter((t) => !t.when || t.when(ctx)).map((t) => ({
        id: t.id,
        name: t.name,
        blurb: t.blurb,
        minutes: t.minutes,
        done: !!state.completed[t.id],
        steps: visibleSteps(t, ctx).length,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.completed, ctx.canUseOri, ctx.isAdmin, ctx.plan, ctx.isMobile, ctx.hasStocks, ctx.strategyCount],
  );

  // First-run prompt: only once settings have hydrated (so we never flash the
  // welcome at a returning user while their blob is still in flight), and only
  // for an account that has never seen it.
  const shouldOfferWelcome = hydrated && !state.seenWelcome && !tourId;

  const dismissWelcome = useCallback(() => persist({ seenWelcome: true }), [persist]);

  const resetProgress = useCallback(() => {
    if (!onPersist) return;
    onPersist({ version: TOUR_VERSION, completed: {}, seenWelcome: false });
  }, [onPersist]);

  return {
    active: !!tourId && total > 0,
    tour,
    step,
    stepReady,
    index: clampedIndex,
    total,
    catalog,
    completed: state.completed,
    shouldOfferWelcome,
    dismissWelcome,
    resetProgress,
    start,
    stop,
    next,
    prev,
    goto,
  };
}
