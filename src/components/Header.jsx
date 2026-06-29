import { useState, useRef, useEffect } from "react";
import OrizinLogo from "./OrizinLogo.jsx";
import RankBadge from "./RankBadge.jsx";
import RankEmblem from "./RankEmblem.jsx";
import { resolveRank, upgradeCta, hasOriAccess } from "../lib/ranks.js";
import {
  IconSun,
  IconMoon,
  IconGear,
  IconUsersGroup,
  IconTerminal,
  IconLogout,
  IconRefresh,
  IconChevronDown,
  IconChart,
  IconSignal,
} from "./icons.jsx";
import DataSyncChip from "./DataSyncChip.jsx";

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
          <div className="rounded-lg bg-gray-900 border border-gray-700 shadow-xl shadow-black/50 py-1 oz-pop">
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
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (onClick) onClick(e);
      }}
      disabled={disabled}
      className={`w-full text-left px-3 py-2.5 lg:py-2 text-xs text-gray-300 hover:bg-gray-800 cursor-pointer
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
      className={`flex-1 lg:flex-none text-center px-2 sm:px-3 py-1.5 lg:px-2.5 lg:py-1 text-xs rounded-md transition-colors duration-150 whitespace-nowrap cursor-pointer active:scale-95
        focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500
        ${active
          ? "text-gray-100 bg-gray-800 font-semibold"
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
  theme,
  onToggleTheme,
  currentUser,
  isAdmin,
  plan = "free",
  onLogout,
  onManageUsers,
  onAccountSettings,
  onOriUsage,
  onUpgradeToPro,
  onAddTicker,
  env = 'production',
  currentView = 'screener',
  onNavigate,
  stocks = [],
  onOpenWatchlist,
  watchlistUnread = 0,
  refreshNotice = null,
  onClearRefreshNotice,
}) {
  // ETFs are never enriched, so they don't count toward "missing" data.
  const missing = filtered.filter((r) => !r.is_etf && (!r.has_km || !r.has_rat)).length;
  const isFullyEnriched = missing === 0;

  // Two distinct operations:
  //   scope='visible' → only the on-screen (filtered) rows. Gathers the ones still
  //     missing data, or force-refreshes them all if everything visible is loaded.
  //   scope='all' → the ENTIRE loaded universe, ignoring filters / what's on screen.
  // Some symbols (ETFs, indexes, funds) never return key-metrics/ratios from FMP,
  // so the visible `missing` count may never reach 0 — that's expected.
  function runGather(scope) {
    if (enrichLoading) return;

    const all = scope === "all";
    const count = all ? stocks.length : missing > 0 ? missing : filtered.length;
    if (count === 0) return;

    const confirmText = all
      ? `Force re-gather ALL data for the entire universe (${count} securities) from FMP?\n\n` +
        `This refreshes the table + EVERYTHING in the company overview panels for ALL loaded securities (stocks + ETFs),\n` +
        `regardless of current filters or what's on screen:\n` +
        `metrics, DCF, analyst targets, profiles, insider trades, news, RSI, ratings, grades, and full price history.\n` +
        `Heavy operation — can take a long time on large universes.`
      : missing > 0
        ? `Gather financial data for the ${count} on-screen stock${count === 1 ? "" : "s"} still missing it, from FMP?\n\n` +
          `This is a heavy API call — depending on the count it can take several minutes.`
        : `Re-gather data for all ${count} stock${count === 1 ? "" : "s"} currently on screen from FMP?\n\n` +
          `Everything visible is already loaded — this force-refreshes their metrics, ratios, DCF & price history.`;

    const ok = window.confirm(confirmText);
    if (ok) onGatherData?.(scope);
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

  const rank = resolveRank({ plan, isAdmin });
  const refreshSymbols = Array.isArray(refreshNotice?.symbols) ? refreshNotice.symbols.filter(Boolean) : [];
  const refreshText = refreshSymbols.length === 1
    ? refreshSymbols[0] + " was refreshed for all users"
    : refreshSymbols.length > 1
      ? String(refreshSymbols.length) + " stocks were refreshed for all users"
      : "";

  return (
    <header className="relative z-30 bg-gray-950 border-b border-gray-800 px-2 sm:px-4 py-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 lg:flex-nowrap lg:gap-3 shrink-0 text-sm">
      {currentUser && currentUser !== "default" && (
        <>
          <div
            className={`pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-gradient-to-r opacity-[0.82] ${rank.headerAccent}`}
            aria-hidden="true"
            title={`${rank.name} (${rank.label})`}
          />
          <div
            className={`pointer-events-none absolute inset-x-6 bottom-0 h-px bg-gradient-to-r blur-[2px] opacity-35 ${rank.headerAccent}`}
            aria-hidden="true"
          />
        </>
      )}
      {/* Orizin logo + wordmark + tagline */}
      <div className="flex items-center gap-2.5 shrink-0">
        <OrizinLogo className="w-5 h-5" />
        <div className="flex items-baseline gap-2">
          <span
            className="hidden sm:inline text-gray-100 text-[18px] leading-none tracking-tight"
            style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif', fontWeight: 600 }}
          >
            Orizin
          </span>
          <span className="text-[10.5px] text-gray-500 hidden lg:inline tracking-wide">
            stock recommendation engine
          </span>
        </div>
      </div>

      {/* Non-production environment badge (QA/sandbox/dev) — so this is never
          mistaken for production when both run at once. */}
      {env !== 'production' && (
        <span
          className="shrink-0 rounded-md bg-amber-500/20 border border-amber-500/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300"
          title={`${env} — test data, not production`}
        >
          {env === 'development' ? 'DEV' : env}
        </span>
      )}

      {/* Compact status — just the dot once loaded (message on hover) */}
      <div
        className="flex items-center gap-2 text-xs text-gray-400 border-l border-gray-800 pl-2 sm:pl-3 shrink-0 min-w-0"
        title={status.msg}
      >
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
        {status.type !== "ready" && <span className="hidden lg:inline truncate max-w-[220px]">{status.msg}</span>}
        <DataSyncChip isAdmin={isAdmin} />
      </div>

      {refreshText && (
        <button
          type="button"
          onClick={onClearRefreshNotice}
          className="flex items-center gap-1.5 max-w-[280px] sm:max-w-[300px] rounded-md border border-emerald-700/60 bg-emerald-950/50 px-2 py-1 text-[11px] font-medium text-emerald-200 shadow-sm shadow-emerald-950/20 shrink-0"
          title={refreshSymbols.join(", ") + " refreshed for all users. Dismiss"}
        >
          <IconRefresh className="w-3 h-3 text-emerald-300 shrink-0" />
          <span className="truncate">{refreshText}</span>
        </button>
      )}

      {/* Top-level page navigation. On mobile it drops to its own full-width row
          (order-last + w-full) so the top row never scrunches; desktop keeps
          it inline (lg:* resets). */}
      <nav className="order-last w-full justify-center flex items-center gap-1 pt-1.5 border-t border-gray-800/60
        lg:order-none lg:w-auto lg:justify-start lg:gap-1 lg:pt-0 lg:border-t-0 lg:border-l lg:border-gray-800 lg:pl-3 shrink-0">
        <NavButton active={currentView === 'screener'} onClick={() => onNavigate?.('screener')}>
          Screener
        </NavButton>
        <NavButton active={currentView === 'deep-research'} onClick={() => onNavigate?.('deep-research')}>
          <span className="hidden lg:inline">Deep Research</span>
          <span className="lg:hidden">Research</span>
        </NavButton>
        <NavButton active={currentView === 'portfolio-goals'} onClick={() => onNavigate?.('portfolio-goals')}>
          Portfolio
        </NavButton>
      </nav>

      {/* Right: watchlist panel + data menu + profile */}
      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        {onOpenWatchlist && (
          <button
            type="button"
            onClick={onOpenWatchlist}
            className="relative px-2.5 py-1.5 lg:px-2 lg:py-1 text-xs font-medium text-gray-400 hover:text-gray-200 border border-gray-700/80 hover:border-gray-600 rounded-md transition-colors cursor-pointer whitespace-nowrap"
            title={watchlistUnread > 0 ? `${watchlistUnread} watchlist alert${watchlistUnread === 1 ? "" : "s"}` : "Open watchlist"}
          >
            Watchlist
            {watchlistUnread > 0 && (
              <span
                className="absolute -top-1.5 -right-1.5 min-w-[17px] h-[17px] px-1 rounded-full bg-red-500 text-[10px] font-bold text-white leading-none flex items-center justify-center shadow-sm ring-2 ring-gray-950"
                aria-hidden="true"
              >
                {watchlistUnread > 99 ? "99+" : watchlistUnread > 9 ? "9+" : watchlistUnread}
              </span>
            )}
          </button>
        )}
        {/* Data menu (Refresh / Gather) — admin only: normal users cannot trigger universe or data refreshes from FMP */}
        {isAdmin && (
          <HeaderMenu
            width="w-64"
            button={(open, toggle) => (
            <button
              onClick={toggle}
              className={`px-2 py-1.5 lg:px-1.5 lg:py-1 text-xs transition-colors flex items-center gap-1 bg-transparent cursor-pointer
                ${open ? "text-gray-200" : "text-gray-400 hover:text-gray-200"}`}
              title="Data actions"
            >
              <span className="hidden sm:inline">Data</span>
              {!isFullyEnriched && filtered.length > 0 && (
                <span className="text-[10px] text-amber-400">({missing})</span>
              )}
              <IconChevronDown className={`w-3 h-3 text-gray-500 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
            </button>
          )}
        >
          {(close) => (
            <>
              {onAddTicker && (
                <MenuItem
                  onClick={() => { close(); onAddTicker(); }}
                  title="Add a single ticker (e.g. a new IPO) not yet in the universe and gather its details from FMP."
                >
                  <span className="flex items-center gap-2">
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-gray-500 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                    Add ticker
                  </span>
                  <span className="block text-[10px] text-gray-500 mt-0.5 pl-[22px]">
                    Pull a new symbol (IPO, missing stock) into the screener.
                  </span>
                </MenuItem>
              )}
              <MenuItem
                onClick={() => { close(); onRefresh?.(); }}
                title="Universe Refresh: pulls full list from FMP stable stock-list + etf-list (no mcap floor), then enriches profiles. Includes all global stocks and ETFs."
              >
                <span className="flex items-center gap-2">
                  <IconRefresh className="w-3.5 h-3.5 text-gray-500 shrink-0" /> Universe Refresh
                </span>
                <span className="block text-[10px] text-gray-500 mt-0.5 pl-[22px]">
                  Full universe from FMP stable lists (stocks + ETFs, no floor).
                </span>
              </MenuItem>
              <MenuItem
                onClick={() => { close(); runGather("visible"); }}
                disabled={enrichLoading || filtered.length === 0}
              >
                <span className="flex items-center gap-2">
                  <IconRefresh className={`w-3.5 h-3.5 text-gray-500 shrink-0 ${enrichLoading ? "animate-spin" : ""}`} />
                  {enrichLoading
                    ? "Gathering…"
                    : missing > 0
                      ? `Gather Data (${missing})`
                      : `Re-gather visible (${filtered.length})`}
                </span>
                <span className="block text-[10px] text-gray-500 mt-0.5 pl-[22px]">
                  {missing > 0
                    ? `Metrics, ratios, growth & DCF for the ${missing} on-screen stock${missing === 1 ? "" : "s"} missing data.`
                    : `Force-refresh the ${filtered.length} stock${filtered.length === 1 ? "" : "s"} currently on screen.`}
                </span>
              </MenuItem>
              <MenuItem
                onClick={() => { close(); runGather("all"); }}
                disabled={enrichLoading || stocks.length === 0}
              >
                <span className="flex items-center gap-2">
                  <IconRefresh className="w-3.5 h-3.5 text-gray-500 shrink-0" /> Force re-gather all ({stocks.length})
                </span>
                <span className="block text-[10px] text-gray-500 mt-0.5 pl-[22px]">
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
              className={`relative w-9 h-9 lg:w-8 lg:h-8 rounded-full p-[2px] bg-gradient-to-br transition duration-150 cursor-pointer hover:brightness-110 active:scale-95
                ${rank.ringGradient}
                ${open ? "ring-2 ring-blue-400/40 ring-offset-2 ring-offset-gray-950" : ""}
                focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400`}
              title={currentUser && currentUser !== "default" ? `Signed in as ${currentUser} — ${rank.name} (${rank.label})` : "Account"}
            >
              <span className="w-full h-full rounded-full bg-gray-900 flex items-center justify-center text-[11px] font-bold text-gray-100">
                {initial}
              </span>
              <span
                className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-gray-950 bg-gray-900 flex items-center justify-center`}
                aria-hidden="true"
              >
                <RankEmblem rankId={rank.id} className="w-2 h-2" />
              </span>
            </button>
          )}
        >
          {(close) => (
            <>
              <div className="px-3 py-2 border-b border-gray-800 space-y-2">
                <div className="text-[10px] uppercase tracking-wider text-gray-500">Signed in as</div>
                <div className="text-sm text-gray-200 font-medium truncate">
                  {currentUser && currentUser !== "default" ? currentUser : "Guest"}
                </div>
                <RankBadge plan={plan} isAdmin={isAdmin} layout="stacked" size="sm" showTagline />
              </div>

              <MenuItem onClick={onToggleTheme}>
                <span className="flex items-center gap-2">
                  {theme === "dark"
                    ? <IconSun className="w-3.5 h-3.5 text-gray-500" />
                    : <IconMoon className="w-3.5 h-3.5 text-gray-500" />}
                  {theme === "dark" ? "Light mode" : "Dark mode"}
                </span>
              </MenuItem>

              {/* Upgrade to Pro - only for free users */}
              {!isAdmin && !hasOriAccess({ plan, isAdmin }) && onUpgradeToPro && (
                <MenuItem 
                  onClick={() => { close(); onUpgradeToPro(); }}
                  className="text-violet-300 hover:bg-violet-950/40"
                >
                  <span className="flex items-center gap-2">
                    {upgradeCta()}
                  </span>
                </MenuItem>
              )}

              {onAccountSettings && (
                <MenuItem onClick={() => { close(); onAccountSettings(); }}>
                  <span className="flex items-center gap-2">
                    <IconGear className="w-3.5 h-3.5 text-gray-500" /> Account settings
                  </span>
                </MenuItem>
              )}

              {/* Ori usage — only meaningful for accounts that can use Ori. */}
              {hasOriAccess({ plan, isAdmin }) && onOriUsage && (
                <MenuItem onClick={() => { close(); onOriUsage(); }}>
                  <span className="flex items-center gap-2">
                    <IconChart className="w-3.5 h-3.5 text-gray-500" /> Ori usage
                  </span>
                </MenuItem>
              )}

              {isAdmin && onManageUsers && (
                <MenuItem onClick={() => { close(); onManageUsers(); }}>
                  <span className="flex items-center gap-2">
                    <IconUsersGroup className="w-3.5 h-3.5 text-gray-500" /> User management
                  </span>
                </MenuItem>
              )}

              {isAdmin && (
                <a
                  href="/admin/observability"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={close}
                  className="block w-full text-left px-3 py-2.5 lg:py-2 text-xs text-gray-300 hover:bg-gray-800 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <IconSignal className="w-3.5 h-3.5 text-gray-500" /> User observability
                  </span>
                </a>
              )}

              {isAdmin && (
                <a
                  href="/debug"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={close}
                  className="block w-full text-left px-3 py-2.5 lg:py-2 text-xs text-gray-300 hover:bg-gray-800 transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <IconTerminal className="w-3.5 h-3.5 text-gray-500" /> Debug log
                  </span>
                </a>
              )}

              {onLogout && (
                <MenuItem
                  onClick={() => { close(); onLogout(); }}
                  className="text-red-300 hover:bg-red-950/40 border-t border-gray-800"
                >
                  <span className="flex items-center gap-2">
                    <IconLogout className="w-3.5 h-3.5" /> Logout
                  </span>
                </MenuItem>
              )}
            </>
          )}
        </HeaderMenu>
      </div>
    </header>
  );
}
