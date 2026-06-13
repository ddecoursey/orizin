import { useState } from "react";

// Small "i" info icon that reveals a tooltip on hover (desktop) and tap (mobile).
// Used to explain Orizin's custom computed scores (Orizin Score, Fit, Smart Money)
// so users know what they're looking at. `title` is set too as a native fallback
// in case the styled tooltip is clipped by an overflow container.
export default function InfoHint({ text, className = "", side = "bottom" }) {
  const [open, setOpen] = useState(false);
  const pos =
    side === "top"
      ? "bottom-full mb-1"
      : side === "left"
        ? "right-full mr-1 top-1/2 -translate-y-1/2"
        : side === "right"
          ? "left-full ml-1 top-1/2 -translate-y-1/2"
          : "top-full mt-1";
  const xCenter = side === "top" || side === "bottom" ? "left-1/2 -translate-x-1/2" : "";

  return (
    <span className={`relative inline-flex align-middle ${className}`}>
      <button
        type="button"
        title={typeof text === "string" ? text : undefined}
        aria-label="What is this?"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-gray-600 text-[9px] font-bold leading-none text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-300"
      >
        i
      </button>
      {open && (
        <span
          role="tooltip"
          onClick={(e) => e.stopPropagation()}
          className={`absolute z-[90] w-56 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-left text-[11px] font-normal normal-case leading-snug tracking-normal text-gray-300 shadow-xl ${pos} ${xCenter}`}
        >
          {text}
        </span>
      )}
    </span>
  );
}
