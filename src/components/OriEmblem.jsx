// Ori Emblem — distinct from the main Orizen product logo
// Used for the AI analyst ("Ori") in the chat interface.
// Keeps constellation / Orion roots but feels more focused and "guiding".
// Different composition from the full three-star belt + horizon product mark.

export default function OriEmblem({ className = "" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Softer, more focused cosmic glow — slightly more indigo/violet to differentiate from main brand */}
      <circle cx="12" cy="10.5" r="9.2" className="text-indigo-400/20" fill="currentColor" stroke="none" />
      <circle cx="12" cy="10.5" r="6.5" className="text-violet-500/25" fill="currentColor" stroke="none" />

      {/* Central "guiding" star — larger and more prominent (the insight / analysis core) */}
      <circle cx="12" cy="10" r="1.6" fill="currentColor" className="text-white" stroke="none" />

      {/* Two supporting stars — arranged more vertically / thoughtfully (not the classic belt alignment) */}
      <circle cx="8.8" cy="7.2" r="0.95" fill="currentColor" className="text-white/90" stroke="none" />
      <circle cx="15.2" cy="13" r="0.95" fill="currentColor" className="text-white/90" stroke="none" />

      {/* Subtle "insight beam" — vertical line suggesting analysis / guidance reaching downward */}
      <line x1="12" y1="11.8" x2="12" y2="17" stroke="rgba(167,139,250,0.55)" strokeWidth="1.1" />

      {/* Minimal constellation connections — different rhythm from the main logo */}
      <line x1="9.4" y1="7.9" x2="11.3" y2="9.5" stroke="rgba(255,255,255,0.55)" strokeWidth="0.9" />
      <line x1="12.7" y1="10.6" x2="14.6" y2="12.5" stroke="rgba(255,255,255,0.55)" strokeWidth="0.9" />

      {/* Very faint outer "witness" stars */}
      <circle cx="6.5" cy="14.5" r="0.5" fill="currentColor" className="text-white/50" stroke="none" />
      <circle cx="17.8" cy="6.8" r="0.5" fill="currentColor" className="text-white/50" stroke="none" />
    </svg>
  );
}
