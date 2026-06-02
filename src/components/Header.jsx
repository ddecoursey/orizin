import { useState, useRef, useEffect } from "react";
import OrizenLogo from "./OrizenLogo.jsx";

// Dropdown that opens on hover (fluid) and also on click (so touch works).
// Closing is handled by mouse-leave (with a small delay so crossing the gap to
// the panel doesn't dismiss it) plus an outside-click listener — no full-screen
// backdrop, which previously sat between the trigger and the panel and broke the
// hover-off behavior.
function HeaderMenu({ button, children, width = "w-56", align = "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const closeTimer = useRef(null);
  const cancelClose = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  };
  const scheduleClose = () => { cancelClose(); closeTimer.current = setTimeout(() => setOpen(false), 120); };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div
      ref={ref}
      className="relative flex items-center"
      onMouseEnter={() => { cancelClose(); setOpen(true); }}
      onMouseLeave={scheduleClose}
    >
      {button(open, () => setOpen((o) => !o))}
      {open && (
        <div
          className={`absolute ${align === "right" ? "right-0" : "left-0"} top-full pt-1 z-50 ${width}`}
          onMouseEnter={cancelClose}
        >
          <div className="rounded-lg bg-gray-900 border border-gray-700 shadow-xl shadow-black/50 py-1">
            {children(() => setOpen(false))}
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({ onClick, disabled, children, className = "" }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-gray-800
        disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${className}`}
    >
      {children}
    </button>
  );
}

// Top-level page navigation link. Active page is highlighted.
function NavButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 text-xs rounded-md transition-colors whitespace-nowrap
        ${active
          ? "text-white bg-gray-800 font-semibold"
          : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/60"}`}
    >
      {children}
    </button>
  );
}

export default function Header({
  status,
  filtered,
  onRefresh,
  onGatherData,
  enrichLoading,
  lastFetch,
  theme,
  onToggleTheme,
  currentUser,
  isAdmin,
  onLogout,
  onManageUsers,
  onAccountSettings,
  currentView = 'screener',
  onNavigate,
  stocks = [],
  onSearchSelect,
  portfolioSummary = {},
}) {
  const missing = filtered.filter((r) => !r.has_km || !r.has_rat).length;
  const isFullyEnriched = missing === 0;

  // Some symbols (ETFs, indexes, funds) never return key-metrics/ratios from
  // FMP, so `missing` may never reach 0. `force` now re-gathers for the ENTIRE
  // loaded universe (all securities), not just visible.
  function runGather(force) {
    if (enrichLoading) return;

    const count = force ? stocks.length : missing;
    if (count === 0) return;

    const confirmText = force
      ? `Force re-gather ALL data for the entire universe (${count} securities) from FMP?\n\n` +
        `This refreshes the table + EVERYTHING in the company overview panels for ALL loaded securities (stocks + ETFs),\n` +
        `regardless of current filters or what's on screen:\n` +
        `metrics, DCF, analyst targets, profiles, insider trades, news, RSI, ratings, grades, and full price history.\n` +
        `Heavy operation — can take a long time on large universes.`
      : `Gather full financial data for ${count} stock${count === 1 ? "" : "s"} from FMP?\n\n` +
        `This is a heavy API call — depending on the count it can take several minutes. ` +
        `Are you sure you want to continue?`;

    const ok = window.confirm(confirmText);
    if (ok) onGatherData?.(force);
  }

  const dotColor =
    status.type === "ready"
      ? "bg-emerald-400"
      : status.type === "error"
        ? "bg-red-500"
        : "bg-amber-400 animate-pulse";

  const initial =
    currentUser && currentUser !== "default"
      ? currentUser.charAt(0).toUpperCase()
      : "•";

  return (
    <header className="bg-gray-950 border-b border-gray-800 px-3 sm:px-4 py-2 flex items-center gap-3 shrink-0 text-sm">
      {/* Orizen logo + wordmark + tagline */}
      <div className="flex items-center gap-2.5 shrink-0">
        <OrizenLogo className="w-5 h-5" />
        <div className="flex items-baseline gap-2">
          <span
            className="text-white text-[18px] leading-none tracking-tight"
            style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif', fontWeight: 600 }}
          >
            Orizen
          </span>
          <span className="text-[10.5px] text-gray-500 hidden md:inline tracking-wide">
            stock recommendation engine
          </span>
        </div>
      </div>

      {/* Compact status — just the dot once loaded (message on hover) */}
      <div
        className="flex items-center gap-1.5 text-xs text-gray-400 border-l border-gray-800 pl-3 shrink-0"
        title={status.msg}
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
        {status.type !== "ready" && <span className="hidden sm:inline truncate max-w-[220px]">{status.msg}</span>}
      </div>

      {/* Top-level page navigation */}
      <nav className="flex items-center gap-1 border-l border-gray-800 pl-3 shrink-0">
        <NavButton active={currentView === 'screener'} onClick={() => onNavigate?.('screener')}>
          Screener
        </NavButton>
        <NavButton active={currentView === 'deep-research'} onClick={() => onNavigate?.('deep-research')}>
          <span className="hidden sm:inline">Deep Research</span>
          <span className="sm:hidden">Research</span>
        </NavButton>
        <NavButton active={currentView === 'portfolio-goals'} onClick={() => onNavigate?.('portfolio-goals')}>
          Portfolio
        </NavButton>
      </nav>

      {/* Right: Data menu + Profile menu */}
      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        {/* Data menu (Refresh / Gather) — admin only: normal users cannot trigger universe or data refreshes from FMP */}
        {isAdmin && (
          <HeaderMenu
            width="w-64"
            button={(open, toggle) => (
            <button
              onClick={toggle}
              className={`px-1.5 py-1 text-xs transition-colors flex items-center gap-1.5 bg-transparent
                ${open ? "text-gray-200" : "text-gray-400 hover:text-gray-200"}`}
              title="Data actions"
            >
              <span className="hidden sm:inline">Data</span>
              {!isFullyEnriched && filtered.length > 0 && (
                <span className="text-[10px] text-amber-400">({missing})</span>
              )}
              <span className="text-gray-500 text-[10px] opacity-60">▾</span>
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuItem
                onClick={() => { close(); onRefresh?.(); }}
                title="Universe Refresh: pulls full list from FMP stable stock-list + etf-list (no mcap floor), then enriches profiles. Includes all global stocks and ETFs."
              >
                ↻ Universe Refresh
                <span className="block text-[10px] text-gray-500 mt-0.5">
                  Full universe from FMP stable lists (stocks + ETFs, no floor).
                </span>
              </MenuItem>
              <MenuItem
                onClick={() => { close(); runGather(isFullyEnriched); }}
                disabled={enrichLoading || filtered.length === 0}
              >
                ↻ {enrichLoading
                  ? "Gathering…"
                  : isFullyEnriched
                    ? "Re-gather Data"
                    : `Gather Data (${missing})`}
                <span className="block text-[10px] text-gray-500 mt-0.5">
                  Pull metrics, ratios, growth & DCF for visible stocks.
                </span>
              </MenuItem>
              <MenuItem
                onClick={() => { close(); runGather(true); }}
                disabled={enrichLoading || stocks.length === 0}
              >
                ↻ Force re-gather all ({stocks.length})
                <span className="block text-[10px] text-gray-500 mt-0.5">
                  Re-fetches ALL in universe (regardless of filters or screen), even ETFs.
                </span>
              </MenuItem>
            </>
          )}
        </HeaderMenu>
        )}

        {/* Profile menu (account / theme / logout) */}
        <HeaderMenu
          width="w-56"
          button={(open, toggle) => (
            <button
              onClick={toggle}
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white transition-all
                ${open ? "ring-2 ring-blue-400/50" : ""}
                bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-500 hover:brightness-110`}
              title={currentUser && currentUser !== "default" ? `Signed in as ${currentUser}` : "Account"}
            >
              {initial}
            </button>
          )}
        >
          {(close) => (
            <>
              <div className="px-3 py-2 border-b border-gray-800">
                <div className="text-[10px] uppercase tracking-wider text-gray-500">Signed in as</div>
                <div className="text-sm text-gray-200 font-medium truncate flex items-center gap-1.5">
                  {currentUser && currentUser !== "default" ? currentUser : "Guest"}
                  {isAdmin && (
                    <span className="text-[9px] px-1.5 py-0.5 bg-emerald-900 text-emerald-300 rounded">admin</span>
                  )}
                </div>
              </div>

              <MenuItem onClick={onToggleTheme}>
                {theme === "dark" ? "☀  Light mode" : "☾  Dark mode"}
              </MenuItem>

              {onAccountSettings && (
                <MenuItem onClick={() => { close(); onAccountSettings(); }}>
                  ⚙  Account settings
                </MenuItem>
              )}

              {isAdmin && onManageUsers && (
                <MenuItem onClick={() => { close(); onManageUsers(); }}>
                  👥  User management
                </MenuItem>
              )}

              {isAdmin && (
                <a
                  href="/debug"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={close}
                  className="block w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-gray-800 transition-colors"
                >
                  🐞  Debug log
                </a>
              )}

              {onLogout && (
                <MenuItem
                  onClick={() => { close(); onLogout(); }}
                  className="text-red-300 hover:bg-red-950/40 border-t border-gray-800"
                >
                  ⏻  Logout
                </MenuItem>
              )}
            </>
          )}
        </HeaderMenu>
      </div>
    </header>
  );
}

