import { useId } from "react";

// Ori Emblem — the AI analyst's mark: a ringed planet with a small moon,
// matching the floating Ori button (same indigo sphere gradient and ring tilt).
// Distinct from the Orizin product logo.
//
// Drawn to read at the sizes it is actually used (14–36px) on dark panels,
// light surfaces and violet chips:
//   • the ring is split — its far half passes BEHIND the planet and its near
//     half crosses IN FRONT — so it reads as a planet, not a flat disc;
//   • the ring and moon outline use indigo-400, which holds contrast on both
//     themes (the old near-white ring disappeared on light backgrounds);
//   • gradient ids come from useId, so any number of emblems can share a page.
export default function OriEmblem({ className = "", title }) {
  const uid = useId().replace(/:/g, "");
  const sphere = `ori-sphere-${uid}`;
  const shade = `ori-shade-${uid}`;
  const clip = `ori-clip-${uid}`;
  const labelled = !!title;

  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      role={labelled ? "img" : undefined}
      aria-label={labelled ? title : undefined}
      aria-hidden={labelled ? undefined : "true"}
    >
      <defs>
        {/* Lit from the upper-left, like the Ori button. */}
        <radialGradient id={sphere} cx="0.36" cy="0.3" r="0.78">
          <stop offset="0" stopColor="#eef2ff" />
          <stop offset="0.32" stopColor="#a5b4fc" />
          <stop offset="0.68" stopColor="#6366f1" />
          <stop offset="1" stopColor="#3730a3" />
        </radialGradient>
        {/* Soft limb darkening so the sphere keeps its edge on light surfaces. */}
        <radialGradient id={shade} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0.72" stopColor="#312e81" stopOpacity="0" />
          <stop offset="1" stopColor="#312e81" stopOpacity="0.45" />
        </radialGradient>
        {/* The ring's separator shadow only belongs where it crosses the planet. */}
        <clipPath id={clip}>
          <circle cx="12" cy="12" r="6.3" />
        </clipPath>
      </defs>

      <g transform="rotate(-22 12 12)">
        {/* Far half of the ring — behind the planet. */}
        <path d="M1.2 12 A10.8 3.7 0 0 1 22.8 12" stroke="#818cf8" strokeWidth="1.3" strokeLinecap="round" />
      </g>

      {/* Planet */}
      <circle cx="12" cy="12" r="6.3" fill={`url(#${sphere})`} />
      <circle cx="12" cy="12" r="6.3" fill={`url(#${shade})`} />
      {/* Specular highlight */}
      <ellipse cx="9.7" cy="9.4" rx="1.9" ry="1.3" transform="rotate(-35 9.7 9.4)" fill="#ffffff" opacity="0.6" />

      {/* Thin dark underlay separating the near ring from the sphere. */}
      <g clipPath={`url(#${clip})`}>
        <path d="M1.2 12 A10.8 3.7 0 0 0 22.8 12" transform="rotate(-22 12 12)" stroke="#1e1b4b" strokeOpacity="0.4" strokeWidth="2.6" />
      </g>
      <g transform="rotate(-22 12 12)">
        {/* Near half of the ring — crosses in front of the planet. */}
        <path d="M1.2 12 A10.8 3.7 0 0 0 22.8 12" stroke="#a5b4fc" strokeWidth="1.3" strokeLinecap="round" />
        {/* Moon riding the near side of the ring */}
        <circle cx="20.95" cy="14.05" r="1.45" fill="#ffffff" stroke="#6366f1" strokeWidth="0.7" />
      </g>
    </svg>
  );
}
