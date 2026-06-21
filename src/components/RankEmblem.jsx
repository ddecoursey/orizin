// Tier emblems — Traveler, Voyager, Starfarer (+ Admin). Distinct from OriEmblem.

export default function RankEmblem({ rankId = "traveler", className = "" }) {
  switch (rankId) {
    case "voyager":
      return <VoyagerEmblem className={className} />;
    case "starfarer":
      return <StarfarerEmblem className={className} />;
    case "admin":
      return <HelmsmanEmblem className={className} />;
    case "traveler":
    default:
      return <TravelerEmblem className={className} />;
  }
}

/** Compass rose — steady exploration (Free / Traveler). */
function TravelerEmblem({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="#64748b" strokeWidth="1.2" opacity="0.85" />
      <circle cx="12" cy="12" r="2.2" fill="#94a3b8" />
      <path d="M12 4.5 L13.1 10.9 L12 12 L10.9 10.9 Z" fill="#60a5fa" />
      <path d="M12 19.5 L10.9 13.1 L12 12 L13.1 13.1 Z" fill="#475569" opacity="0.9" />
      <path d="M4.5 12 L10.9 10.9 L12 12 L10.9 13.1 Z" fill="#475569" opacity="0.75" />
      <path d="M19.5 12 L13.1 13.1 L12 12 L13.1 10.9 Z" fill="#475569" opacity="0.75" />
    </svg>
  );
}

/** Ringed world — committed voyage (Pro / Voyager). */
function VoyagerEmblem({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <ellipse
        cx="12" cy="12" rx="10.5" ry="3.6"
        transform="rotate(-18 12 12)"
        stroke="#a78bfa" strokeWidth="1.15" fill="none"
      />
      <circle cx="12" cy="12" r="5.2" fill="#7c3aed" />
      <circle cx="10.2" cy="10.4" r="2" fill="#c4b5fd" opacity="0.75" />
      <path d="M12 6.8 A5.2 5.2 0 0 1 12 17.2 Z" fill="#4c1d95" opacity="0.45" />
      <circle cx="20.2" cy="8.8" r="1" fill="#e9d5ff" stroke="#8b5cf6" strokeWidth="0.45" />
    </svg>
  );
}

/** Radiant star — ultimate tier (future). */
function StarfarerEmblem({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" fill="#fbbf24" />
      <circle cx="12" cy="12" r="5.5" fill="#f59e0b" opacity="0.25" />
      {[0, 45, 90, 135].map((deg) => (
        <line
          key={deg}
          x1="12" y1="12"
          x2={12 + 9 * Math.cos((deg * Math.PI) / 180)}
          y2={12 + 9 * Math.sin((deg * Math.PI) / 180)}
          stroke="#fcd34d" strokeWidth="1.4" strokeLinecap="round"
        />
      ))}
      {[22.5, 67.5, 112.5, 157.5].map((deg) => (
        <line
          key={deg}
          x1="12" y1="12"
          x2={12 + 6 * Math.cos((deg * Math.PI) / 180)}
          y2={12 + 6 * Math.sin((deg * Math.PI) / 180)}
          stroke="#f59e0b" strokeWidth="0.9" strokeLinecap="round" opacity="0.85"
        />
      ))}
      <circle cx="12" cy="12" r="1.3" fill="#fffbeb" />
    </svg>
  );
}

/** Command insignia — admin. */
function HelmsmanEmblem({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <path
        d="M12 3 L20 8 V16 L12 21 L4 16 V8 Z"
        stroke="#34d399" strokeWidth="1.2" fill="#064e3b" opacity="0.35"
      />
      <path d="M12 7 L15.5 12 L12 17 L8.5 12 Z" fill="#10b981" />
      <circle cx="12" cy="12" r="1.5" fill="#ecfdf5" />
    </svg>
  );
}