import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import OriEmblem from "./OriEmblem.jsx";

// ─────────────────────────────────────────────────────────────────────────────
// The guided-tour surface: a dimming scrim with a cut-out "spotlight" over the
// step's target, plus a card holding the copy and the Back / Next controls.
//
// Rendered through a portal into <body> so it is never clipped by the screener's
// overflow containers, and layered above every modal (those top out at z-[100])
// and above the shared <Tooltip> portal (z 9999) so tour copy is never buried.
//
// A step with no `target`, or one whose target is not in the DOM, degrades to a
// centered card — the explanation still lands even if the control is missing on
// this account, this breakpoint, or this data state.
// ─────────────────────────────────────────────────────────────────────────────

const Z_SCRIM = 10000;
const Z_CARD = 10002;
const CARD_W = 360;
const GAP = 14;          // space between the spotlight and the card
const PAD = 8;           // spotlight padding around the target
const EDGE = 12;         // minimum distance from the viewport edge
// How long to keep looking for a target that has not mounted yet (a page that is
// still rendering or a lazy chunk still loading, a panel mid-transition). ~2s at 60fps, then fall back to a
// centered card rather than hanging on an empty spotlight.
const MAX_LOOKUP_FRAMES = 120;

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function rectOf(el) {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom, right: r.right };
}

// Locates the step's target and keeps its rect in sync while the step is shown.
// Returns `undefined` while still searching and `null` once the search gave up,
// so the caller can distinguish "preparing" from "no target".
function useTargetRect(selector, enabled, stepKey) {
  const [rect, setRect] = useState(undefined);

  useEffect(() => {
    if (!enabled) return;
    if (!selector) {
      setRect(null);
      return;
    }

    let stopped = false;
    let raf = 0;
    let frames = 0;
    let scrolled = false;

    const read = () => {
      if (stopped) return;
      // The app renders several controls twice — once in the desktop bar, once
      // in the compact bar — with only one laid out at the current breakpoint.
      // Take the first match that actually occupies space, so a spotlight never
      // lands on the hidden twin.
      let el = null;
      for (const candidate of document.querySelectorAll(selector)) {
        const r = candidate.getBoundingClientRect();
        if (r.width > 0 || r.height > 0) {
          el = candidate;
          break;
        }
      }
      if (!el) {
        // Not mounted or not laid out yet (a collapsed panel, a page still
        // rendering) — keep looking for a bounded number of frames.
        if (frames++ < MAX_LOOKUP_FRAMES) {
          raf = requestAnimationFrame(read);
        } else {
          setRect(null);
        }
        return;
      }
      const r = rectOf(el);
      if (!scrolled) {
        scrolled = true;
        const offscreen = r.top < 0 || r.bottom > window.innerHeight || r.left < 0 || r.right > window.innerWidth;
        if (offscreen) {
          el.scrollIntoView({
            block: "center",
            inline: "nearest",
            behavior: prefersReducedMotion() ? "auto" : "smooth",
          });
          // Let the scroll settle before the first measurement sticks.
          frames = Math.max(0, MAX_LOOKUP_FRAMES - 30);
          raf = requestAnimationFrame(read);
          return;
        }
      }
      setRect((prev) =>
        prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height
          ? prev
          : r,
      );
      raf = requestAnimationFrame(read);
    };

    setRect(undefined);
    raf = requestAnimationFrame(read);

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
    // stepKey forces a fresh search when the step changes even if the selector
    // string happens to repeat between steps.
  }, [selector, enabled, stepKey]);

  return rect;
}

// Places the card beside the spotlight, flipping and clamping so it always
// stays fully on screen. With no rect it centres.
function placeCard(rect, card, vw, vh, placement) {
  const w = Math.min(CARD_W, vw - EDGE * 2);
  const h = card?.height || 220;

  if (!rect) {
    return { left: Math.round((vw - w) / 2), top: Math.round(Math.max(EDGE, (vh - h) / 2)), width: w, arrow: null };
  }

  const spot = {
    top: rect.top - PAD,
    left: rect.left - PAD,
    bottom: rect.bottom + PAD,
    right: rect.right + PAD,
  };
  const below = vh - spot.bottom - GAP;
  const above = spot.top - GAP;
  const rightRoom = vw - spot.right - GAP;
  const leftRoom = spot.left - GAP;

  let side = placement;
  if (side === "auto" || !side) {
    if (below >= h) side = "bottom";
    else if (above >= h) side = "top";
    else if (rightRoom >= w) side = "right";
    else if (leftRoom >= w) side = "left";
    else side = below >= above ? "bottom" : "top";
  } else {
    // An explicit placement still flips when it genuinely does not fit.
    if (side === "bottom" && below < h && above >= h) side = "top";
    else if (side === "top" && above < h && below >= h) side = "bottom";
    else if (side === "right" && rightRoom < w && leftRoom >= w) side = "left";
    else if (side === "left" && leftRoom < w && rightRoom >= w) side = "right";
  }

  let top;
  let left;
  if (side === "bottom" || side === "top") {
    left = rect.left + rect.width / 2 - w / 2;
    top = side === "bottom" ? spot.bottom + GAP : spot.top - GAP - h;
  } else {
    top = rect.top + rect.height / 2 - h / 2;
    left = side === "right" ? spot.right + GAP : spot.left - GAP - w;
  }

  left = Math.max(EDGE, Math.min(left, vw - w - EDGE));
  top = Math.max(EDGE, Math.min(top, vh - h - EDGE));
  return { left: Math.round(left), top: Math.round(top), width: w, arrow: side };
}

function Dots({ total, index, onPick }) {
  if (total <= 1) return null;
  return (
    <div className="flex items-center gap-1.5" role="tablist" aria-label="Tour progress">
      {Array.from({ length: total }, (_, i) => (
        <button
          key={i}
          type="button"
          role="tab"
          aria-selected={i === index}
          aria-label={`Step ${i + 1} of ${total}`}
          onClick={() => onPick(i)}
          className={`h-1.5 rounded-full transition-all cursor-pointer ${
            i === index ? "w-4 bg-violet-400" : i < index ? "w-1.5 bg-violet-700" : "w-1.5 bg-gray-700 hover:bg-gray-600"
          }`}
        />
      ))}
    </div>
  );
}

export default function TourOverlay({
  tour,
  step,
  stepReady,
  index,
  total,
  onNext,
  onPrev,
  onSkip,
  onGoto,
}) {
  const cardRef = useRef(null);
  const nextRef = useRef(null);
  const [cardSize, setCardSize] = useState(null);
  const [viewport, setViewport] = useState(() => ({
    w: typeof window === "undefined" ? 1024 : window.innerWidth,
    h: typeof window === "undefined" ? 768 : window.innerHeight,
  }));

  const stepKey = `${tour?.id || ""}:${step?.id || index}`;
  const rect = useTargetRect(step?.target || null, !!step && stepReady, stepKey);
  const searching = rect === undefined;

  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Measure the card so placement can flip on its real height, not a guess.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCardSize((prev) =>
      prev && Math.abs(prev.height - r.height) < 1 && Math.abs(prev.width - r.width) < 1
        ? prev
        : { width: r.width, height: r.height },
    );
  }, [stepKey, viewport.w, viewport.h, searching, step?.body, step?.title]);

  // Move focus to the primary action when the step changes so keyboard and
  // screen-reader users land on the tour rather than behind it.
  useEffect(() => {
    if (searching) return;
    const t = setTimeout(() => nextRef.current?.focus({ preventScroll: true }), 30);
    return () => clearTimeout(t);
  }, [stepKey, searching]);

  const handleScrimClick = useCallback(
    (e) => {
      // Clicking the dimmed area steps forward (a familiar coach-mark gesture);
      // clicking the spotlight itself falls through to the real control.
      if (e.target === e.currentTarget) onNext();
    },
    [onNext],
  );

  if (!step) return null;

  const target = rect || null;
  const pos = placeCard(target, cardSize, viewport.w, viewport.h, step.placement);
  const isFirst = index === 0;
  const isLast = index === total - 1;
  const reduce = prefersReducedMotion();

  // The spotlight: a transparent box whose enormous spread-shadow paints the
  // scrim everywhere except over the target. One element, no seams, and the
  // target stays fully interactive.
  const spotlight = target ? (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        top: target.top - PAD,
        left: target.left - PAD,
        width: target.width + PAD * 2,
        height: target.height + PAD * 2,
        borderRadius: 10,
        boxShadow: "0 0 0 9999px rgba(3, 7, 18, 0.72)",
        outline: "2px solid rgba(167, 139, 250, 0.9)",
        outlineOffset: 0,
        zIndex: Z_SCRIM,
        pointerEvents: "none",
        transition: reduce ? "none" : "top .22s ease, left .22s ease, width .22s ease, height .22s ease",
      }}
    />
  ) : null;

  return createPortal(
    <>
      {/* Click-catching scrim. With a spotlight it sits underneath the cut-out
          element above, so the highlighted control itself stays clickable. */}
      <div
        onClick={handleScrimClick}
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: Z_SCRIM - 1,
          background: target ? "transparent" : "rgba(3, 7, 18, 0.72)",
        }}
      />
      {spotlight}

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby="oz-tour-title"
        aria-describedby="oz-tour-body"
        style={{
          position: "fixed",
          top: pos.top,
          left: pos.left,
          width: pos.width,
          zIndex: Z_CARD,
          opacity: searching ? 0 : 1,
          transition: reduce ? "none" : "top .22s ease, left .22s ease, opacity .15s ease",
        }}
        className="rounded-xl border border-violet-800/70 bg-gray-900 shadow-2xl shadow-black/60 overflow-hidden"
      >
        <div className="flex items-center gap-2 border-b border-gray-800 bg-gray-950/60 px-3.5 py-2">
          <OriEmblem className="w-3.5 h-3.5 shrink-0 text-violet-300" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-violet-300/90 truncate">
            {tour?.name || "Tour"}
          </span>
          <span className="ml-auto shrink-0 text-[10px] font-mono text-gray-500">
            {index + 1}/{total}
          </span>
          <button
            type="button"
            onClick={onSkip}
            aria-label="End tour"
            className="shrink-0 -mr-1 rounded p-1 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-300 cursor-pointer"
          >
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-3.5 py-3">
          <h2 id="oz-tour-title" className="text-sm font-bold text-gray-100">
            {step.title}
          </h2>
          <div id="oz-tour-body" className="mt-1.5 space-y-2 text-xs leading-relaxed text-gray-300">
            {typeof step.body === "string" ? <p>{step.body}</p> : step.body}
          </div>
          {step.tip && (
            <p className="mt-2.5 rounded-md border border-violet-900/50 bg-violet-950/25 px-2.5 py-1.5 text-[11px] leading-relaxed text-violet-200">
              {step.tip}
            </p>
          )}
          {!searching && !target && step.target && (
            <p className="mt-2.5 text-[10px] italic leading-relaxed text-gray-500">
              This control isn&rsquo;t on screen right now — it appears once the relevant data or panel is open.
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-gray-800 bg-gray-950/40 px-3.5 py-2.5">
          <Dots total={total} index={index} onPick={onGoto} />
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={onSkip}
              className="rounded-md px-2 py-1.5 text-[11px] font-medium text-gray-500 transition-colors hover:text-gray-300 cursor-pointer"
            >
              Skip
            </button>
            {!isFirst && (
              <button
                type="button"
                onClick={onPrev}
                className="rounded-md border border-gray-700 px-2.5 py-1.5 text-[11px] font-semibold text-gray-300 transition-colors hover:border-gray-600 hover:bg-gray-800 cursor-pointer"
              >
                Back
              </button>
            )}
            <button
              ref={nextRef}
              type="button"
              onClick={onNext}
              className="rounded-md bg-violet-600 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-violet-500 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400"
            >
              {isLast ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

// First-run prompt (and the one-time "tours are new" note for existing
// accounts). Deliberately small and dismissible — it offers the tour, it never
// starts one on its own.
export function TourWelcome({ returning = false, onStart, onDismiss }) {
  return createPortal(
    <div
      role="dialog"
      aria-labelledby="oz-tour-welcome-title"
      className="fixed left-3 right-3 bottom-32 sm:left-4 sm:right-auto sm:bottom-14 sm:w-[340px] z-[90]
        rounded-xl border border-violet-800/70 bg-gray-900 p-4 shadow-2xl shadow-black/60 oz-fade-rise"
    >
      <div className="flex items-start gap-3">
        <OriEmblem className="mt-0.5 w-5 h-5 shrink-0 text-violet-300" />
        <div className="min-w-0">
          <h2 id="oz-tour-welcome-title" className="text-sm font-bold text-gray-100">
            {returning ? "New: guided tours" : "New to Orizin?"}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-gray-300">
            {returning
              ? "Short walkthroughs of the screener, Deep Research, Ori, your portfolio and strategies. Take the overview now, or any page's tour later."
              : "Take the 2-minute tour: how to find candidates, research one properly, and make the scores reflect how you invest."}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={onStart}
              className="rounded-md bg-violet-600 px-3 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-violet-500 cursor-pointer"
            >
              {returning ? "Show me around" : "Start the tour"}
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="rounded-md px-2 py-1.5 text-[11px] font-medium text-gray-400 transition-colors hover:text-gray-200 cursor-pointer"
            >
              Not now
            </button>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-gray-500">
            Every tour lives in the <strong className="text-gray-400">Guide</strong> menu at the top of the page.
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
