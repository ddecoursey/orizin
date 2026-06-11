// ORIGINAL OrizinLogo - backed up before visual improvements (2026)
// Clean modern Orizin space logo (constellation-inspired, Orion belt)
// This is the exact version before the "easier to see + horizon" tweak.

export default function OrizinLogo({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {/* Subtle nebula glow */}
      <circle cx="12" cy="12" r="9.5" className="text-blue-500/10" fill="currentColor" stroke="none" />
      {/* Orion belt stars + lines */}
      <circle cx="8" cy="9" r="1.1" fill="currentColor" stroke="none" className="text-white" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" className="text-white" />
      <circle cx="16" cy="15" r="1.1" fill="currentColor" stroke="none" className="text-white" />
      <line x1="8.7" y1="9.7" x2="11.3" y2="11.4" stroke="rgba(255,255,255,0.7)" />
      <line x1="12.7" y1="12.6" x2="15.3" y2="14.4" stroke="rgba(255,255,255,0.7)" />
      {/* Subtle cross stars (Orion) */}
      <circle cx="6.5" cy="6" r="0.7" fill="currentColor" className="text-white/70" stroke="none" />
      <circle cx="17.5" cy="18" r="0.7" fill="currentColor" className="text-white/70" stroke="none" />
      <line x1="6.5" y1="6" x2="7.8" y2="8.2" stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
      <line x1="17.5" y1="18" x2="16.2" y2="15.8" stroke="rgba(255,255,255,0.35)" strokeWidth="1" />
    </svg>
  );
}
