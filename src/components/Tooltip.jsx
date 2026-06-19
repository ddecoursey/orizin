import { useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";

// Lightweight, instant, portal-rendered tooltip — the project-wide replacement
// for slow, unstyled native `title=` tooltips and the old in-flow popups. It
// renders into <body>, so it is NEVER clipped by an overflow/stacking context
// (the screener table, modals, the chart) and always sits on top (z 9999).
// Appears after a short delay on hover/focus and hides instantly.
//
//   <Tooltip content="…">{trigger}</Tooltip>
//
// `content` may be a string (newlines render as line breaks) or JSX. When empty,
// the children render with no wrapper/listeners.
export default function Tooltip({
  content,
  children,
  side = "top",
  maxWidth = 200,
  delay = 90,
  className = "",
}) {
  const [pos, setPos] = useState(null); // { x, y, above } in viewport px, or null = hidden
  const ref = useRef(null);
  const timer = useRef(null);

  const place = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Prefer the requested side; flip to keep it on-screen.
    const above = side === "bottom" ? false : side === "top" ? true : r.top > 140;
    setPos({ x: r.left + r.width / 2, y: above ? r.top : r.bottom, above });
  }, [side]);

  const show = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(place, delay);
  }, [place, delay]);

  const hide = useCallback(() => {
    clearTimeout(timer.current);
    setPos(null);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  if (content == null || content === "") return children;

  return (
    <>
      <span
        ref={ref}
        className={`inline-flex ${className}`}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </span>
      {pos &&
        createPortal(
          <div
            role="tooltip"
            style={{
              position: "fixed",
              left: pos.x,
              top: pos.y,
              transform: `translate(-50%, ${pos.above ? "calc(-100% - 7px)" : "7px"})`,
              maxWidth,
              zIndex: 9999,
              pointerEvents: "none",
            }}
            className="rounded-md border border-gray-700 bg-gray-950/95 px-2 py-1 text-left text-[10px] font-normal normal-case leading-tight tracking-normal text-gray-200 shadow-lg whitespace-pre-line"
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
