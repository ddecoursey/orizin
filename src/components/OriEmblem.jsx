// Ori Emblem — a small ringed planet/moon (distinct from the Orizin product
// logo). Used for the AI analyst ("Ori"). Self-contained indigo palette so it
// reads on the gradient Ori button, on dark panels, and on light surfaces.
export default function OriEmblem({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      {/* Orbital ring — tilted ellipse behind the planet */}
      <ellipse
        cx="12" cy="12" rx="11" ry="3.9"
        transform="rotate(-24 12 12)"
        stroke="rgba(255,255,255,0.7)" strokeWidth="1.2" fill="none"
      />
      {/* Planet body */}
      <circle cx="12" cy="12" r="6" fill="#c7d2fe" />
      {/* Sphere sheen — light from the upper-left */}
      <circle cx="9.9" cy="9.9" r="3.3" fill="#ffffff" opacity="0.7" />
      {/* Night side / terminator for depth (right half) */}
      <path d="M12 6 A6 6 0 0 1 12 18 Z" fill="#3730a3" opacity="0.5" />
      {/* Craters */}
      <circle cx="13.6" cy="10.9" r="0.85" fill="#6366f1" opacity="0.55" />
      <circle cx="10.6" cy="13.9" r="0.55" fill="#6366f1" opacity="0.5" />
      {/* A small moon riding the ring */}
      <circle cx="21" cy="9.3" r="1.1" fill="#ffffff" stroke="#6366f1" strokeWidth="0.5" />
    </svg>
  );
}
