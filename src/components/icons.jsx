// Shared inline SVG icon set — replaces the emoji/glyph icons (🔬 🆚 📊 ⚙ ⌕ …)
// with consistent stroke-based marks. All icons inherit `currentColor` and are
// sized via className. The Research and Compare marks are custom (telescope /
// twin-node exchange) to stay on-brand with the Orizin constellation identity
// rather than generic library icons.

function Svg({ className = "", children, strokeWidth = 1.8, ...rest }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

/* Deep Research — a telescope pointed at a star (Orion roots). */
export function IconResearch({ className = "" }) {
  return (
    <Svg className={className} strokeWidth="1.7">
      <line x1="5.2" y1="13.6" x2="15.6" y2="7.6" strokeWidth="3" />
      <line x1="16.4" y1="7.05" x2="19" y2="5.55" strokeWidth="3.9" />
      <path d="M9.3 13.2v3.1" />
      <path d="m9.3 16.3-3.1 4.2" />
      <path d="m9.3 16.3 3.1 4.2" />
      <circle cx="20.8" cy="2.9" r="1" fill="currentColor" stroke="none" />
      <circle cx="17.6" cy="1.9" r="0.5" fill="currentColor" stroke="none" opacity="0.6" />
    </Svg>
  );
}

/* Compare — two nodes exchanging places (head-to-head). */
export function IconCompare({ className = "" }) {
  return (
    <Svg className={className} strokeWidth="1.7">
      <circle cx="6.3" cy="6.3" r="2.7" />
      <circle cx="17.7" cy="17.7" r="2.7" />
      <path d="M10.4 4.4h6.1a3.5 3.5 0 0 1 3.5 3.5v3.3" />
      <path d="m18.2 9.5 1.8 1.8 1.8-1.8" />
      <path d="M13.6 19.6H7.5A3.5 3.5 0 0 1 4 16.1v-3.3" />
      <path d="m5.8 14.5-1.8-1.8-1.8 1.8" />
    </Svg>
  );
}

export function IconSearch({ className = "" }) {
  return (
    <Svg className={className}>
      <circle cx="11" cy="11" r="6.3" />
      <path d="m15.8 15.8 4.4 4.4" />
    </Svg>
  );
}

export function IconTable({ className = "" }) {
  return (
    <Svg className={className} strokeWidth="1.6">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17" />
      <path d="M9.5 9.5v10" />
    </Svg>
  );
}

export function IconCards({ className = "" }) {
  return (
    <Svg className={className} strokeWidth="1.6">
      <rect x="3.5" y="3.5" width="7.4" height="7.4" rx="1.5" />
      <rect x="13.1" y="3.5" width="7.4" height="7.4" rx="1.5" />
      <rect x="3.5" y="13.1" width="7.4" height="7.4" rx="1.5" />
      <rect x="13.1" y="13.1" width="7.4" height="7.4" rx="1.5" />
    </Svg>
  );
}

/* Filters — horizontal sliders. */
export function IconFilters({ className = "" }) {
  return (
    <Svg className={className} strokeWidth="1.7">
      <path d="M4 7h9.5M17.5 7H20" />
      <circle cx="15.5" cy="7" r="2" />
      <path d="M4 17h3.5M11.5 17H20" />
      <circle cx="9.5" cy="17" r="2" />
    </Svg>
  );
}

/* Weights — three-band equalizer (Q/V/G). */
export function IconWeights({ className = "" }) {
  return (
    <Svg className={className} strokeWidth="1.7">
      <path d="M6 4v5.5M6 13.5V20" />
      <circle cx="6" cy="11.5" r="2" />
      <path d="M12 4v2.5M12 10.5V20" />
      <circle cx="12" cy="8.5" r="2" />
      <path d="M18 4v9.5M18 17.5V20" />
      <circle cx="18" cy="15.5" r="2" />
    </Svg>
  );
}

export function IconChart({ className = "" }) {
  return (
    <Svg className={className} strokeWidth="1.7">
      <path d="M3.5 20.5h17" />
      <path d="M7 17v-4.5" />
      <path d="M12 17V7.5" />
      <path d="M17 17v-7" />
    </Svg>
  );
}

export function IconSignal({ className = "" }) {
  return (
    <Svg className={className} strokeWidth="1.7">
      <path d="M5 11.5a7 7 0 0 1 14 0" />
      <path d="M8.2 11.5a3.8 3.8 0 0 1 7.6 0" />
      <circle cx="12" cy="13.2" r="1.1" fill="currentColor" stroke="none" />
      <path d="M12 14.5V20" />
    </Svg>
  );
}

export function IconAlert({ className = "" }) {
  return (
    <Svg className={className} strokeWidth="1.7">
      <path d="M10.3 4.1 2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.1a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.5v4" />
      <circle cx="12" cy="16.6" r="0.9" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconPie({ className = "" }) {
  return (
    <Svg className={className} strokeWidth="1.7">
      <path d="M21.2 15.9A10 10 0 1 1 8 2.8" />
      <path d="M22 12A10 10 0 0 0 12 2v10z" />
    </Svg>
  );
}

export function IconBank({ className = "" }) {
  return (
    <Svg className={className} strokeWidth="1.6">
      <path d="M3.5 21h17" />
      <path d="M5.5 17.5V10M10 17.5V10M14 17.5V10M18.5 17.5V10" />
      <path d="m12 3 8.5 4.5h-17z" />
    </Svg>
  );
}

export function IconSun({ className = "" }) {
  return (
    <Svg className={className} strokeWidth="1.7">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M21.5 12h-2M4.5 12h-2M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4M18.7 18.7l-1.4-1.4M6.7 6.7 5.3 5.3" />
    </Svg>
  );
}

export function IconMoon({ className = "" }) {
  return (
    <Svg className={className} strokeWidth="1.7">
      <path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z" />
    </Svg>
  );
}

export function IconGear({ className = "" }) {
  return (
    <Svg className={className} strokeWidth="1.7">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.92 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.92a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01A1.7 1.7 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.03z" />
    </Svg>
  );
}

export function IconUsersGroup({ className = "" }) {
  return (
    <Svg className={className} strokeWidth="1.7">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <path d="M16 5.4a3.2 3.2 0 0 1 0 5.2" />
      <path d="M17.8 15.3c1.7.7 2.7 2.1 2.7 4.7" />
    </Svg>
  );
}

export function IconTerminal({ className = "" }) {
  return (
    <Svg className={className} strokeWidth="1.7">
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="m7 9.5 3 2.5-3 2.5" />
      <path d="M12.5 14.5H17" />
    </Svg>
  );
}

export function IconLogout({ className = "" }) {
  return (
    <Svg className={className} strokeWidth="1.7">
      <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </Svg>
  );
}

export function IconRefresh({ className = "" }) {
  return (
    <Svg className={className} strokeWidth="1.8">
      <path d="M20 11.5A8 8 0 1 0 18.3 17" />
      <path d="M20 4.5v7h-7" />
    </Svg>
  );
}

export function IconChevronDown({ className = "" }) {
  return (
    <Svg className={className} strokeWidth="2">
      <path d="m6 9.5 6 6 6-6" />
    </Svg>
  );
}

/** Watchlist — eye mark (distinct from screener ★ pins). */
export function IconWatchlist({ className = "", active = false }) {
  return (
    <Svg className={className} strokeWidth="1.7">
      <path d="M2.2 12s3.6-6.8 9.8-6.8 9.8 6.8 9.8 6.8-3.6 6.8-9.8 6.8S2.2 12 2.2 12z" />
      <circle cx="12" cy="12" r="2.4" fill={active ? "currentColor" : "none"} />
    </Svg>
  );
}
