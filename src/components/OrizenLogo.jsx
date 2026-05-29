// Improved Orizen logo (2026 tweak)
// - More visually prominent / easier to read at small sizes
// - Keeps strong Orion constellation (belt) identity
// - Adds subtle horizon theme (nod to "Orizen" = Orion + horizon)
// - Higher contrast stars + lines while staying elegant and dark-mode friendly

export default function OrizenLogo({ className = "" }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Enhanced nebula / cosmic glow - more visible but still soft */}
      <circle cx="12" cy="11.5" r="10" className="text-blue-400/15" fill="currentColor" stroke="none" />
      <circle cx="12" cy="11.5" r="7.8" className="text-blue-500/25" fill="currentColor" stroke="none" />

      {/* Main Orion Belt - larger, higher contrast stars for better visibility */}
      {/* Left star (Mintaka) */}
      <circle cx="7.8" cy="8.4" r="1.35" fill="currentColor" className="text-white" stroke="none" />
      {/* Center star (Alnilam) - slightly larger as the "heart" */}
      <circle cx="12" cy="11.3" r="1.45" fill="currentColor" className="text-white" stroke="none" />
      {/* Right star (Alnitak) */}
      <circle cx="16.2" cy="14.2" r="1.35" fill="currentColor" className="text-white" stroke="none" />

      {/* Orion Belt connecting lines - stronger, more readable */}
      <line x1="8.7" y1="9.1" x2="11.3" y2="10.9" stroke="rgba(255,255,255,0.85)" strokeWidth="1.1" />
      <line x1="12.7" y1="11.9" x2="15.5" y2="13.8" stroke="rgba(255,255,255,0.85)" strokeWidth="1.1" />

      {/* Subtle "shoulder" stars (Betelgeuse & Bellatrix direction) - more visible now */}
      <circle cx="5.8" cy="5.6" r="0.85" fill="currentColor" className="text-white/75" stroke="none" />
      <circle cx="18.1" cy="17.1" r="0.85" fill="currentColor" className="text-white/75" stroke="none" />

      {/* Faint outer constellation lines */}
      <line x1="6.3" y1="6.1" x2="7.5" y2="7.9" stroke="rgba(255,255,255,0.4)" strokeWidth="0.9" />
      <line x1="17.4" y1="16.6" x2="16.5" y2="14.9" stroke="rgba(255,255,255,0.4)" strokeWidth="0.9" />

      {/* Subtle horizon line - nods to "Orizen" (Orion + Horizon) */}
      {/* Gentle curve suggesting stars rising over a horizon */}
      <path
        d="M4 19.5 Q8 18.8 12 19.2 Q16 18.8 20 19.5"
        stroke="rgba(148,163,184,0.35)"
        strokeWidth="0.9"
        fill="none"
      />
      {/* Tiny "ground" dots / distant stars on horizon */}
      <circle cx="5" cy="19.8" r="0.4" fill="currentColor" className="text-slate-400/40" stroke="none" />
      <circle cx="19.2" cy="19.9" r="0.35" fill="currentColor" className="text-slate-400/40" stroke="none" />
    </svg>
  );
}
