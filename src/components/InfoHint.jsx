import Tooltip from "./Tooltip.jsx";

// Small "i" info icon that reveals an explanation on hover/focus (focus also
// covers tap on mobile). Now backed by the shared portal <Tooltip> — instant and
// never clipped by an overflow container — so it matches every tooltip
// project-wide. Used to explain Orizin's custom computed scores (Orizin Score,
// Fit, Smart Money, intangibles, …).
export default function InfoHint({ text, className = "", side = "top" }) {
  return (
    <Tooltip content={text} side={side} maxWidth={200} className={`align-middle ${className}`}>
      <button
        type="button"
        aria-label="What is this?"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
        className="inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full border border-gray-600 text-[9px] font-bold leading-none text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-300"
      >
        i
      </button>
    </Tooltip>
  );
}
