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
}) {
  const missing = filtered.filter(
    (r) => !r.has_km || !r.has_rat || !r.has_growth || !r.has_dcf,
  ).length;

  function handleGatherData() {
    if (enrichLoading || missing === 0) return;
    const ok = window.confirm(
      `Gather full financial data for ${missing} stock${missing === 1 ? "" : "s"} from FMP?\n\n` +
        `This is a heavy API call — depending on the count it can take several minutes. ` +
        `Are you sure you want to continue?`,
    );
    if (ok) onGatherData?.();
  }

  const dotColor =
    status.type === "ready"
      ? "bg-emerald-400"
      : status.type === "error"
        ? "bg-red-500"
        : "bg-amber-400 animate-pulse";

  return (
    <header className="bg-gray-950 border-b border-gray-800 px-4 py-2 flex items-center gap-3 shrink-0 text-sm">
      {/* Orizen logo + wordmark + tagline */}
      <div className="flex items-center gap-2.5">
        <OrizenLogo className="w-5 h-5" />
        <div className="flex items-baseline gap-2">
          <span
            className="text-white text-[18px] leading-none tracking-tight"
            style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif', fontWeight: 600 }}
          >
            Orizen
          </span>
          <span className="text-[10.5px] text-gray-500 hidden sm:inline tracking-wide">
            stock recommendation engine
          </span>
        </div>
      </div>

      {/* Compact status */}
      <div className="flex items-center gap-1.5 text-xs text-gray-400 border-l border-gray-800 pl-3">
        <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
        <span>{status.msg}</span>
      </div>

      {/* Actions */}
      <div className="ml-auto flex items-center gap-1.5">
        <a
          href="/debug"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-gray-500 hover:text-gray-300 px-1.5 py-1 font-mono"
          title="Open debug error log"
        >
          debug
        </a>

        <button
          onClick={onToggleTheme}
          className="px-2 py-1 rounded-md text-xs bg-gray-900 hover:bg-gray-800 text-gray-300 border border-gray-800 transition-colors"
          title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>

        <button
          onClick={onRefresh}
          className="px-2.5 py-1 rounded-md text-xs font-medium bg-gray-900 hover:bg-gray-800 text-gray-300 border border-gray-800 transition-colors flex items-center gap-1.5"
          title="Force a fresh pull of the universe from FMP (applies 500M+ mkt cap floor + current scope). Prunes old small-caps from the DB. Keeps existing enriched data for symbols that remain."
        >
          ↻ <span className="hidden sm:inline">Stock Refresh</span>
        </button>

        <button
          onClick={handleGatherData}
          disabled={enrichLoading || missing === 0}
          className="px-2.5 py-1 rounded-md text-xs font-medium bg-gray-900 hover:bg-gray-800 text-gray-300 border border-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
          title="Pull full financial data (key metrics, ratios, DCF, growth) for visible stocks missing data. Heavy API call — can take several minutes."
        >
          ⚡ {enrichLoading
            ? "Gathering…"
            : missing > 0
              ? `Gather Data (${missing})`
              : "Data Gathered"}
        </button>

        {onLogout && (
          <>
            {isAdmin && onManageUsers && (
              <button
                onClick={onManageUsers}
                className="px-2.5 py-1 rounded-md text-xs font-medium bg-gray-900 hover:bg-gray-800 text-gray-300 border border-gray-800 transition-colors flex items-center gap-1.5 ml-1"
                title="Manage users"
              >
                👥 Users
              </button>
            )}

            <button
              onClick={onLogout}
              className="px-2.5 py-1 rounded-md text-xs font-medium bg-gray-900 hover:bg-gray-800 text-gray-300 border border-gray-800 transition-colors flex items-center gap-1.5"
              title={currentUser ? `Signed in as ${currentUser} — click to sign out` : "Sign out"}
            >
              ⏻
              <span className="hidden sm:inline">
                {currentUser && currentUser !== "default"
                  ? `Logout (${currentUser})`
                  : "Logout"}
              </span>
            </button>
          </>
        )}
      </div>
    </header>
  );
}

// Clean modern Orizen space logo (constellation-inspired)
function OrizenLogo({ className = "" }) {
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
