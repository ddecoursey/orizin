import { useState, useEffect, useRef } from "react";
import Starfield from "./components/Starfield";
import { useScreener } from "./hooks/useScreener.js";
import { useChat } from "./hooks/useChat.js";
import { useStockDetail } from "./hooks/useStockDetail.js";
import Header from "./components/Header.jsx";
import Sidebar from "./components/Sidebar.jsx";
import TabsBar from "./components/TabsBar.jsx";
import StockTable from "./components/StockTable.jsx";
import ScorecardGrid from "./components/ScorecardGrid.jsx";
import ProgressBar from "./components/ProgressBar.jsx";
import ChatPanel from "./components/ChatPanel.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import UsersModal from "./components/UsersModal.jsx";
import StockDetailModal from "./components/StockDetailModal.jsx";
import Footer from "./components/Footer.jsx";
import { fetchUserSettings, patchUserSettings } from "./lib/userStore.js";

export default function App() {
  // "checking" → calling /api/auth/me to see if we have a session
  // "login"    → show the LoginPage
  // "authed"   → render the screener
  const [authState, setAuthState] = useState("checking");
  const [currentUser, setCurrentUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then(async (r) => {
        if (!r.ok) {
          setAuthState("login");
          return;
        }
        const data = await r.json().catch(() => ({}));
        setCurrentUser(data.user || "default");
        setIsAdmin(!!data.isAdmin);
        setAuthState("authed");
      })
      .catch(() => setAuthState("login"));
  }, []);

  async function handleLoginSuccess() {
    // Refresh user info from the server after login so the username
    // matches what the session cookie was issued for.
    try {
      const r = await fetch("/api/auth/me");
      const data = await r.json();
      setCurrentUser(data.user || "default");
      setIsAdmin(!!data.isAdmin);
    } catch {
      setCurrentUser("default");
      setIsAdmin(false);
    }
    setAuthState("authed");
  }

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Even if the request fails, surface the login page so the user
      // can re-authenticate manually.
    }
    setCurrentUser(null);
    setAuthState("login");
  }

  if (authState === "checking") {
    return <div className="h-screen bg-gray-950" />;
  }
  if (authState === "login") {
    return <LoginPage onSuccess={handleLoginSuccess} />;
  }
  // key forces MainApp to remount when the user changes, so all the
  // localStorage-backed state (pins, tabs, theme) re-reads under the new key.
  return <MainApp key={currentUser} currentUser={currentUser} isAdmin={isAdmin} onLogout={handleLogout} />;
}

function MainApp({ currentUser, isAdmin, onLogout }) {
  const user = currentUser || "default";
  const themeKey = `theme:${user}`;
  const sidebarKey = `sidebarCollapsed:${user}`;
  // Default to the vertical card view on narrow screens (phones / iPad portrait)
  // so users aren't forced to drag the wide table sideways. Still toggleable.
  const [view, setView] = useState(
    () => (typeof window !== "undefined" && window.innerWidth < 1024 ? "cards" : "table"),
  );
  const [showUsersModal, setShowUsersModal] = useState(false);
  const [detailStock, setDetailStock] = useState(null);
  const [theme, setTheme] = useState(
    () => localStorage.getItem(themeKey) || localStorage.getItem("theme") || "dark",
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const explicit = localStorage.getItem(sidebarKey);
    if (explicit != null) return explicit === "1";
    const legacy = localStorage.getItem("sidebarCollapsed");
    if (legacy != null) return legacy === "1";
    // No saved preference yet → collapse by default on tablet/narrow screens
    // so the filter panel doesn't steal width from the table.
    return typeof window !== "undefined" && window.innerWidth < 1024;
  });

  // True once theme/sidebar have been reconciled with the server, so the
  // initial local values can't clobber server-side prefs before hydration.
  const settingsHydrated = useRef(false);

  // Hydrate theme + sidebar from the server (follows the account across
  // devices). If absent server-side, migrate the current local values up once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const server = await fetchUserSettings();
      if (cancelled) return;
      const patch = {};
      if (typeof server.theme === "string") setTheme(server.theme);
      else patch.theme = theme;
      if (typeof server.sidebarCollapsed === "boolean") setSidebarCollapsed(server.sidebarCollapsed);
      else patch.sidebarCollapsed = sidebarCollapsed;
      if (Object.keys(patch).length) patchUserSettings(patch);
      settingsHydrated.current = true;
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    localStorage.setItem(sidebarKey, sidebarCollapsed ? "1" : "0");
    if (settingsHydrated.current) patchUserSettings({ sidebarCollapsed });
  }, [sidebarCollapsed, sidebarKey]);

  // Expose for easy debugging in console (as requested)
  useEffect(() => {
    window.__DEBUG_IS_ADMIN = isAdmin;
  }, [isAdmin]);

  useEffect(() => {
    document.title = 'Orizen';
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    localStorage.setItem(themeKey, theme);
    if (settingsHydrated.current) patchUserSettings({ theme });
  }, [theme]);
  const {
    stocks,
    filtered,
    status,
    lastFetch,
    filters,
    setFilters,
    applyFiltersFromAI,
    weights,
    setWeights,
    pins,
    togglePin,
    tabs,
    activeTab,
    activateTab,
    createTab,
    deleteTab,
    loadStocks,
    enrichAll,
    enrichLoading,
    loadProgress,
    addTicker,
    cancelOperation,
  } = useScreener(currentUser);

  const applyRecommendation = (rec) => {
    // Ori no longer recommends weight changes — user controls the Q/V/G sliders directly.
    const filtersToApply = rec.filters || rec.recommendFilters || rec.applyFilters;

    if (filtersToApply) {
      applyFiltersFromAI({ ...filters, ...filtersToApply });
    }
    // weights from recommendations are ignored by design
  };

  // Resolve the open detail stock against the live `filtered` set so its score
  // (and pillar scores) re-compute as the Q/V/G weights change. Falls back to
  // the clicked snapshot if filters now exclude it.
  const detailRow = detailStock
    ? filtered.find((r) => r.symbol === detailStock.symbol) || detailStock
    : null;

  // Fetch the open stock's rich detail (profile, chart, RSI, ratings, grades)
  // once, here, so both the overview pane AND Ori's chat context share it.
  const detail = useStockDetail(detailStock?.symbol || null);

  // Derive price performance and RSI trend for the open stock from the data we
  // already fetched for the chart — gives Ori momentum/timing context for free.
  const activeStock = detailRow
    ? {
        ...detailRow,
        profile: detail.profile,
        ratings: detail.ratings,
        grades: detail.grades,
        latestRsi: detail.rsi?.length ? detail.rsi[detail.rsi.length - 1].rsi : null,
        performance: pricePerformance(detail.points),
        rsiTrend: rsiTrend(detail.rsi),
      }
    : null;

  // What the user is actively working with: their pinned watchlist and the
  // screener (tab) they're in. Pinned rows pull from the filtered set first
  // (so they carry live scores), falling back to the full universe.
  const activeScreenerName = tabs.find((t) => t.id === activeTab)?.name || null;
  const pinnedStocks = [...pins]
    .map((sym) => filtered.find((r) => r.symbol === sym) || stocks.find((r) => r.symbol === sym))
    .filter(Boolean);

  const chat = useChat(filtered, filters, weights, applyRecommendation, activeStock, {
    activeScreener: activeScreenerName,
    pinnedStocks,
  });

  // Expose functions for the chat panel
  chat.applyRecommendation = applyRecommendation;
  chat.dismissRecommendation = chat.dismissRecommendation; // already returned from hook, re-exposing for clarity

  // Bump this when the user does a Force Re-gather so the table can also
  // force-refresh its sparklines from the server (which will hit FMP).
  const [sparklineForceVersion, setSparklineForceVersion] = useState(0);

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100 overflow-hidden">
      <Header
        status={status}
        filtered={filtered}
        lastFetch={lastFetch}
        onRefresh={() => loadStocks(true)}
        onGatherData={(force) => {
          if (force) {
            setSparklineForceVersion(v => v + 1);
          }
          enrichAll(!!force);
        }}
        enrichLoading={enrichLoading}
        theme={theme}
        onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
        currentUser={currentUser}
        isAdmin={isAdmin}
        onLogout={onLogout}
        onManageUsers={() => setShowUsersModal(true)}
      />

      <ProgressBar progress={loadProgress} label={enrichLoading ? "Enriching…" : "Refreshing…"} onCancel={cancelOperation} />

      {/* Very subtle starfield background (dark mode only) */}
      {theme === "dark" && <Starfield />}

      <div className="flex flex-1 overflow-hidden min-h-0">
        <Sidebar
          filters={filters}
          setFilters={setFilters}
          stocks={stocks}
          onAddTicker={addTicker}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed(c => !c)}
        />

        <div className="flex flex-col flex-1 overflow-hidden min-h-0">
          <TabsBar
            tabs={tabs}
            activeTab={activeTab}
            onActivate={activateTab}
            onCreate={createTab}
            onDelete={deleteTab}
          />

          {/* Controls bar — desktop / iPad landscape (≥ lg): unchanged */}
          <div className="hidden lg:flex flex-wrap items-center gap-3 gap-y-2 px-3 py-2 border-b border-gray-800 bg-gray-950 shrink-0">
            <div
              className="flex items-center gap-2 flex-1 min-w-[140px] max-w-xs bg-gray-900 border border-gray-800
              rounded-lg px-3 py-1.5"
            >
              <span className="text-gray-600 text-sm">⌕</span>
              <input
                type="text"
                value={filters.search}
                onChange={(e) =>
                  setFilters({ ...filters, search: e.target.value })
                }
                placeholder="Search symbol or name…"
                className="flex-1 bg-transparent text-xs text-gray-200 outline-none placeholder-gray-600"
              />
            </div>

            <span className="text-xs text-gray-600 whitespace-nowrap">
              {filtered.length} / {stocks.length}
            </span>

            <div className="flex shrink-0 border border-gray-700 rounded-md overflow-hidden ml-auto">
              {[
                ["table", "▦ Table"],
                ["cards", "▤ Scorecards"],
              ].map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`px-3 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                    view === v
                      ? "bg-gray-100 text-gray-900"
                      : "bg-gray-900 text-gray-500 hover:text-gray-300 hover:bg-gray-800"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Pillar weights — always available. Controls the Orizen Score in both Table and Scorecards. */}
            <div className="flex shrink-0 items-center gap-3 text-xs text-gray-500">
              {[
                ["q", "Q", "Quality — Profitable, capital-efficient businesses with strong balance sheets (ROIC, margins, low debt, liquidity)."],
                ["v", "V", "Value — Cheap on multiples + margin of safety (EV/GP, EV/EBITDA, P/E, FCF yield, DCF)."],
                ["g", "G", "Growth — Revenue, EPS, and FCF growth (TTM). Higher = favor faster-growing companies."],
              ].map(([k, label, tip]) => (
                <WeightSlider
                  key={k}
                  label={label}
                  tip={tip}
                  value={weights[k]}
                  onChange={(newValue) =>
                    setWeights((w) => ({ ...w, [k]: newValue }))
                  }
                />
              ))}
            </div>
          </div>

          {/* Controls bar — compact (< lg) */}
          <div className="flex lg:hidden flex-col gap-2 px-3 py-2 border-b border-gray-800 bg-gray-950 shrink-0">
            <div className="flex items-center gap-2 bg-gray-900 border border-gray-800 rounded-lg px-3 py-2">
              <span className="text-gray-600 text-sm">⌕</span>
              <input
                type="text"
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                placeholder="Search symbol or name…"
                className="flex-1 bg-transparent text-sm text-gray-200 outline-none placeholder-gray-600"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setSidebarCollapsed(false)}
                className="px-3 py-1.5 rounded-md text-xs font-semibold bg-gray-900 border border-gray-700
                  text-gray-300 hover:bg-gray-800 transition-colors flex items-center gap-1.5"
              >
                ⚙ Filters
              </button>
              <span className="text-xs text-gray-600 whitespace-nowrap">
                {filtered.length} / {stocks.length}
              </span>

              <div className="ml-auto flex items-center gap-2">
                <div className="flex border border-gray-700 rounded-md overflow-hidden">
                  {[
                    ["table", "▦"],
                    ["cards", "▤"],
                  ].map(([v, icon]) => (
                    <button
                      key={v}
                      onClick={() => setView(v)}
                      title={v === "table" ? "Table" : "Scorecards"}
                      className={`px-3 py-1.5 text-sm font-semibold transition-colors ${
                        view === v
                          ? "bg-gray-100 text-gray-900"
                          : "bg-gray-900 text-gray-500 hover:text-gray-300 hover:bg-gray-800"
                      }`}
                    >
                      {icon}
                    </button>
                  ))}
                </div>
                <WeightsPopover weights={weights} setWeights={setWeights} />
              </div>
            </div>
          </div>

          {/* Main content */}
          {status.type === "loading" && stocks.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-gray-500">
              <span className="text-4xl">📊</span>
              <p className="text-sm font-medium text-gray-400">
                Loading market data…
              </p>
              <div className="w-56 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-blue-500 to-violet-500 rounded-full animate-pulse w-1/3" />
              </div>
              <p className="text-xs">{status.msg}</p>
            </div>
          ) : status.type === "error" ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8">
              <span className="text-3xl">⚠️</span>
              <h3 className="text-sm font-semibold text-red-400">
                Failed to load data
              </h3>
              <p className="text-xs text-gray-500 text-center max-w-sm">
                {status.msg}
              </p>
              <button
                onClick={() => loadStocks()}
                className="px-4 py-2 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 transition-colors"
              >
                Retry
              </button>
            </div>
          ) : view === "table" ? (
            <div className="flex-1 min-h-0 overflow-hidden" style={{ height: '100%' }}>
              <StockTable
                rows={filtered}
                pins={pins}
                onTogglePin={togglePin}
                onAskAI={chat.askAboutStock}
                onSelectStock={setDetailStock}
                enrichLoading={enrichLoading}
                sparklineForceVersion={sparklineForceVersion}
              />
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-auto" style={{ height: '100%' }}>
              <ScorecardGrid rows={filtered} onSelectStock={setDetailStock} />
            </div>
          )}
        </div>

        {detailRow && (
          <StockDetailModal
            row={detailRow}
            symbol={detailStock?.symbol}
            onClose={() => setDetailStock(null)}
            profile={detail.profile}
            points={detail.points}
            rsi={detail.rsi}
            ratings={detail.ratings}
            grades={detail.grades}
            loadingProfile={detail.loadingProfile}
            loadingChart={detail.loadingChart}
            loadingRatings={detail.loadingRatings}
            loadingGrades={detail.loadingGrades}
          />
        )}

        {chat.isOpen && <ChatPanel chat={chat} />}
      </div>

      <Footer />

      {/* Floating Ori button — slides left to clear the detail pane (w-96)
          when it's open and chat isn't (chat would already sit on top of it). */}
      <div
        className={`fixed bottom-14 z-50 transition-[right] duration-300 ease-out
          ${detailStock && !chat.isOpen ? 'right-6 lg:right-[25.5rem]' : 'right-6'}
          ${chat.isOpen ? 'hidden lg:block' : 'block animate-ori-bounce'}`}
      >
        <button
          onClick={() => chat.setIsOpen(!chat.isOpen)}
          className={`w-12 h-12 rounded-full shadow-lg flex items-center justify-center text-sm font-semibold transition-all
            ${chat.isOpen
              ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
              : "bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-500 text-white hover:brightness-110 hover:scale-105 shadow-blue-500/30"
            }`}
          title="Toggle Ori Chat"
        >
          <span 
            className="text-[13px] font-semibold tracking-[1px]"
            style={{ 
              fontFamily: '"Space Grotesk", system-ui, sans-serif', 
              fontWeight: 600 
            }}
          >
            Ori
          </span>
        </button>
      </div>

      {showUsersModal && (
        <UsersModal
          onClose={() => setShowUsersModal(false)}
          currentUser={currentUser}
          isAdmin={isAdmin}
        />
      )}
    </div>
  );
}

// Price % change over ~N trading days back from the latest close, plus the
// full-window (1y) change. points: [{ date, price }] oldest→newest.
function pricePerformance(points) {
  if (!points || points.length < 2) return null;
  const last = points[points.length - 1].price;
  const at = (n) => {
    const base = points[Math.max(0, points.length - 1 - n)].price;
    return base ? (last - base) / base : null;
  };
  return {
    m1: at(21),
    m3: at(63),
    m6: at(126),
    y1: at(points.length - 1),
  };
}

// Latest RSI plus its direction over the last ~5 sessions. rsi: [{ date, rsi }].
function rsiTrend(rsi) {
  if (!rsi || rsi.length < 2) return null;
  const latest = rsi[rsi.length - 1].rsi;
  const prev = rsi[Math.max(0, rsi.length - 6)].rsi;
  const change5d = latest - prev;
  return {
    latest,
    change5d,
    direction: change5d > 1 ? "rising" : change5d < -1 ? "falling" : "flat",
  };
}

/**
 * WeightsPopover — compact "Weights" button + dropdown holding the three Q/V/G
 * sliders, used on narrow screens to keep them off the main controls bar.
 */
function WeightsPopover({ weights, setWeights }) {
  const [open, setOpen] = useState(false);
  const rows = [
    ["q", "Quality"],
    ["v", "Value"],
    ["g", "Growth"],
  ];
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors flex items-center gap-1.5
          ${open ? "bg-gray-800 border-gray-700 text-gray-100" : "bg-gray-900 border-gray-700 text-gray-300 hover:bg-gray-800"}`}
      >
        ⚖ Weights
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-lg bg-gray-900 border border-gray-700 shadow-xl shadow-black/50 p-3 space-y-3">
            <div className="text-[10px] uppercase tracking-wider text-gray-500">
              Orizen Score weights
            </div>
            {rows.map(([k, label]) => (
              <PopoverWeightRow
                key={k}
                label={label}
                value={weights[k]}
                onChange={(v) => setWeights((w) => ({ ...w, [k]: v }))}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PopoverWeightRow({ label, value, onChange }) {
  const [local, setLocal] = useState(value);
  const timeoutRef = useRef(null);
  useEffect(() => setLocal(value), [value]);
  const handleChange = (e) => {
    const v = Number(e.target.value);
    setLocal(v);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => onChange(v), 120);
  };
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-300 mb-1">
        <span>{label}</span>
        <span className="font-mono text-gray-400">{local}</span>
      </div>
      <input
        type="range"
        min="0"
        max="100"
        value={local}
        onChange={handleChange}
        className="w-full accent-blue-500 h-2"
      />
    </div>
  );
}

/**
 * WeightSlider - Renders the slider with instant visual feedback
 * while debouncing the actual weight update (critical for perf with large datasets).
 */
function WeightSlider({ label, tip, value, onChange }) {
  const [localValue, setLocalValue] = useState(value);
  const timeoutRef = useRef(null);

  // Keep local state in sync if parent changes weights externally
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = (e) => {
    const newVal = Number(e.target.value);
    setLocalValue(newVal); // instant UI feedback

    // Debounce the expensive global update
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      onChange(newVal);
    }, 120); // 120ms debounce feels responsive but cuts down recomputes dramatically
  };

  return (
    <label className="group relative flex items-center gap-1.5 cursor-default">
      <span className="border-b border-dotted border-gray-600">{label}</span>

      {/* Premium tooltip - positioned below to avoid clipping at top of screen */}
      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2.5 hidden group-hover:block z-[90] pointer-events-none">
        <div className="relative flex flex-col items-center transition-all duration-150 ease-out group-hover:opacity-100 group-hover:translate-y-0 opacity-0 -translate-y-1">
          {/* Arrow pointing up */}
          <div className="relative -mb-px h-2.5 w-4 overflow-hidden">
            <div className="absolute left-1/2 bottom-0 -translate-x-1/2 h-3 w-3 rotate-45 bg-zinc-900 border-r border-b border-white/15" />
          </div>
          <div className="bg-zinc-900/95 backdrop-blur-xl border border-white/15 text-gray-200 text-[10.5px] leading-relaxed px-3.5 py-2 rounded-xl shadow-2xl shadow-black/70 max-w-[260px] whitespace-normal text-left">
            {tip}
          </div>
        </div>
      </div>

      <input
        type="range"
        min="0"
        max="100"
        value={localValue}
        onChange={handleChange}
        className="w-14 accent-blue-500"
      />
    </label>
  );
}
