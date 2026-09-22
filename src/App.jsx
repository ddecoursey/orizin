import { useState, useEffect, useLayoutEffect, useRef, useMemo, lazy, Suspense, useCallback } from "react";
import { useInactivityLogout } from "./hooks/useInactivityLogout.js";
import { useWatchlists } from "./hooks/useWatchlists.js";
import { useWatchlistAlerts } from "./hooks/useWatchlistAlerts.js";
import WatchlistPanel from "./components/WatchlistPanel.jsx";

import { LazyMotion, domAnimation, m, AnimatePresence, useReducedMotion } from "./lib/motion.js";
import { useScreener } from "./hooks/useScreener.js";
import { useChat } from "./hooks/useChat.js";
import { useStockDetail } from "./hooks/useStockDetail.js";
import { useNews } from "./hooks/useNews.js";
import { usePortfolioGoals } from "./hooks/usePortfolioGoals.js";
import { useStrategies } from "./hooks/useStrategies.js";
import Header from "./components/Header.jsx";
import Sidebar from "./components/Sidebar.jsx";
import TabsBar from "./components/TabsBar.jsx";
import ScreenerLens from "./components/ScreenerLens.jsx";
import StockTable from "./components/StockTable.jsx";
import ScorecardGrid from "./components/ScorecardGrid.jsx";
import ProgressBar from "./components/ProgressBar.jsx";
import ChatPanel from "./components/ChatPanel.jsx";
import OriEmblem from "./components/OriEmblem.jsx";

// Lazy: the landing page (and framer-motion with it) is only downloaded by
// signed-out visitors — signed-in users go straight to the app bundle.
const HomePage = lazy(() => import("./pages/HomePage.jsx"));
// Every page and modal that isn't on screen at first paint is its own chunk, so
// the screener renders from a smaller main bundle. They're prefetched once the
// app is idle (see prefetchAppChunks) so opening one is still instant.
const loadStrategies = () => import("./pages/StrategiesPage.jsx");
const loadDeepResearch = () => import("./components/DeepResearchPage.jsx");
const loadPortfolio = () => import("./pages/PortfolioGoalsPage.jsx");
const loadStockDetail = () => import("./components/StockDetailModal.jsx");
const loadCompare = () => import("./components/CompareModal.jsx");
const loadUsers = () => import("./components/UsersModal.jsx");
const loadUpgrade = () => import("./components/UpgradeModal.jsx");
const loadAddTicker = () => import("./components/AddTickerModal.jsx");
const StrategiesPage = lazy(loadStrategies);
const DeepResearchPage = lazy(loadDeepResearch);
const PortfolioGoalsPage = lazy(loadPortfolio);
const StockDetailModal = lazy(loadStockDetail);
const CompareModal = lazy(loadCompare);
const UsersModal = lazy(loadUsers);
const UpgradeModal = lazy(loadUpgrade);
const AddTickerModal = lazy(loadAddTicker);
let chunksPrefetched = false;
function prefetchAppChunks() {
  if (chunksPrefetched) return;
  chunksPrefetched = true;
  for (const load of [loadDeepResearch, loadStockDetail, loadPortfolio, loadStrategies, loadCompare, loadUsers, loadUpgrade, loadAddTicker]) {
    load().catch(() => { chunksPrefetched = false; });
  }
}
import Footer from "./components/Footer.jsx";

// Quiet placeholder while a page chunk loads (usually already prefetched).
function PageFallback({ label = "Loading…" }) {
  return <div className="flex h-full flex-1 items-center justify-center bg-gray-950 text-xs text-gray-500">{label}</div>;
}
import TourOverlay, { TourWelcome } from "./components/TourOverlay.jsx";
import { useTour } from "./hooks/useTour.js";
import { PAGE_TOURS } from "./lib/tours.jsx";
import { discardPendingUserSettings, fetchUserSettings, flushUserSettings, patchUserSettings } from "./lib/userStore.js";
import { buildOriStockContext } from "./lib/oriContext.js";
import { parseSessionPlan, hasOriAccess } from "./lib/ranks.js";


export default function App() {
  // "checking" → calling /api/auth/me to see if we have a session
  // "login"    → show the LoginPage
  // "authed"   → render the screener
  const [authState, setAuthState] = useState("checking");
  const [currentUser, setCurrentUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [plan, setPlan] = useState("free");
  // Deployment environment ('production' | 'qa' | 'development') from the server,
  // so QA (sandbox) and prod (live) are visibly distinct when both are running.
  const [appEnv, setAppEnv] = useState("production");

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
        setPlan(parseSessionPlan(data.plan));
        setAppEnv(data.env || "production");
        setAuthState("authed");
      })
      .catch(() => setAuthState("login"));
  }, []);

  async function handleLoginSuccess() {
    // Refresh user info from the server after login so the username
    // matches what the session cookie was issued for.
    try {
      const r = await fetch("/api/auth/me");
      if (!r.ok) throw new Error("session not established");
      const data = await r.json();
      setCurrentUser(data.user || "default");
      setIsAdmin(!!data.isAdmin);
      setPlan(parseSessionPlan(data.plan));
      setAppEnv(data.env || "production");
      setAuthState("authed");
    } catch {
      setAuthState("login");
    }
  }

  // Re-read the session after a plan change (subscribe / cancel) so Pro unlocks
  // or locks immediately, without a full page reload.
  async function refreshAuth() {
    try {
      const r = await fetch("/api/auth/me");
      if (!r.ok) return;
      const data = await r.json();
      setCurrentUser(data.user || "default");
      setIsAdmin(!!data.isAdmin);
      setPlan(parseSessionPlan(data.plan));
      setAppEnv(data.env || "production");
    } catch {
      /* ignore — keep current state */
    }
  }

  // PayPal redirect fallback: if the popup was blocked, PayPal returns the buyer
  // with a subscription id. Verify and activate it directly; webhook recovery is
  // the fallback, so poll briefly afterward before cleaning up.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const subscribed = params.get("subscribed") === "1";
    const cancelled = params.get("subscribe") === "cancelled";
    if (!subscribed && !cancelled) return;

    const subscriptionId =
      params.get("subscription_id") ||
      params.get("subscriptionID") ||
      params.get("subscriptionId");
    const cleanUrl = new URL(window.location.href);
    for (const key of ["subscribed", "subscribe", "subscription_id", "subscriptionID", "subscriptionId", "ba_token"]) {
      cleanUrl.searchParams.delete(key);
    }
    window.history.replaceState(
      {},
      "",
      `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`,
    );
    if (!subscribed) return;

    let stopped = false;
    let timeoutId;
    const wait = (ms) => new Promise((resolve) => { timeoutId = setTimeout(resolve, ms); });
    (async () => {
      if (subscriptionId) {
        try {
          const res = await fetch("/api/billing/activate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subscriptionID: subscriptionId }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            console.error("PayPal redirect activation failed:", body.error || res.status);
          }
        } catch (error) {
          console.error("PayPal redirect activation failed:", error);
        }
      }

      for (let attempt = 0; attempt < 4 && !stopped; attempt += 1) {
        if (attempt > 0) await wait(2500);
        if (!stopped) await refreshAuth();
      }
    })();
    return () => {
      stopped = true;
      clearTimeout(timeoutId);
    };
  }, []);

  const handleLogout = useCallback(async () => {
    await flushUserSettings();
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Even if the request fails, surface the login page so the user
      // can re-authenticate manually.
    }
    discardPendingUserSettings();
    setCurrentUser(null);
    setAuthState("login");
  }, []);

  useInactivityLogout({
    enabled: authState === "authed",
    onLogout: handleLogout,
  });

  // The marketing/landing page is designed for dark mode only. Strip the global
  // .light class while signed out so a prior in-app light theme doesn't invert
  // its gray scale and accents. MainApp re-applies the user's theme on login.
  useLayoutEffect(() => {
    if (authState !== "login" && authState !== "checking") return;
    document.documentElement.classList.remove("light");
  }, [authState]);

  if (authState === "checking") {
    return <div className="h-screen bg-gray-950" />;
  }
  if (authState === "login") {
    // Signed-out visitors land on the marketing page (hero, features,
    // pricing) with sign-in / create-account / subscribe entry points.
    return (
      <Suspense fallback={<div className="h-screen bg-gray-950" />}>
        <HomePage onAuthed={handleLoginSuccess} />
      </Suspense>
    );
  }
  // key forces MainApp to remount when the user changes, so all the
  // localStorage-backed state (pins, tabs, theme) re-reads under the new key.
  return <MainApp key={currentUser} currentUser={currentUser} isAdmin={isAdmin} plan={plan} appEnv={appEnv} onLogout={handleLogout} onAuthRefresh={refreshAuth} />;
}

function sanitizeTicker(sym) {
  if (!sym || typeof sym !== "string") return null;
  const s = sym.trim().toUpperCase();
  return /^[A-Z0-9.-]{1,12}$/.test(s) ? s : null;
}

function MainApp({ currentUser, isAdmin, plan = "free", appEnv = "production", onLogout, onAuthRefresh }) {
  // Ori access: Pro plan or admin. The server enforces this on /api/chat too —
  // this flag just drives the paywall UI.
  const canUseOri = hasOriAccess({ plan, isAdmin });
  // Gate framer transitions for users who prefer reduced motion (the CSS
  // micro-animations are gated in index.css via the same media query).
  const reduceMotion = useReducedMotion();
  const user = currentUser || "default";
  const themeKey = `theme:${user}`;
  const sidebarKey = `sidebarCollapsed:${user}`;
  // Default to the vertical card view on narrow screens (phones / iPad portrait)
  // so users aren't forced to drag the wide table sideways. Still toggleable.
  const [view, setView] = useState(
    () => (typeof window !== "undefined" && window.innerWidth < 1024 ? "cards" : "table"),
  );
  const [showUsersModal, setShowUsersModal] = useState(false);
  // 'account' (personal settings) | 'users' (admin user management)
  const [usersModalMode, setUsersModalMode] = useState('account');
  const [showCompare, setShowCompare] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const openUpgradeModal = () => setShowUpgradeModal(true);
  const [showAddTicker, setShowAddTicker] = useState(false);
  const [showWatchlist, setShowWatchlist] = useState(false);
  const [detailStock, setDetailStock] = useState(null);
  const [detailStock2, setDetailStock2] = useState(null);
  const [pickingSecond, setPickingSecond] = useState(false);
  // When two overviews are open we keep them on the same tab and scroll in sync.
  const [compareTab, setCompareTab] = useState("overview");
  // Shared chart timeframe so the two compare panes move together.
  const [compareTimeframe, setCompareTimeframe] = useState("1Y");
  const aScrollRef = useRef(null);
  const bScrollRef = useRef(null);
  const scrollSyncingRef = useRef(false);
  const news = useNews();

  // Track small screens so compare switches from side-by-side panes (desktop)
  // to a single full-screen comparison modal (mobile/tablet).
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Portfolio & Goals (always loaded so it can be sent to Ori chat context)
  const portfolioGoals = usePortfolioGoals();

  // Main view: 'screener' | 'portfolio-goals' | 'deep-research' | 'strategies'. Initialized from
  // the URL (?v=…&sym=…) so a refresh restores the page you were on instead of
  // snapping back to the screener. Kept in sync below.
  const [currentView, setCurrentView] = useState(() => {
    if (typeof window === "undefined") return "screener";
    const v = new URLSearchParams(window.location.search).get("v");
    return v === "deep-research" || v === "portfolio-goals" || v === "strategies" ? v : "screener";
  });
  // Symbol currently open in the Deep Research page (single-stock focus).
  const [researchSymbol, setResearchSymbol] = useState(() => {
    if (typeof window === "undefined") return null;
    const p = new URLSearchParams(window.location.search);
    if (p.get("v") !== "deep-research") return null;
    return sanitizeTicker(p.get("sym") || "");
  });

  // Reflect the current view + symbol into the URL (replaceState — no history
  // spam) so a hard refresh lands back here. Screener is the default → clean URL.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    if (currentView === "screener") {
      p.delete("v");
      p.delete("sym");
    } else {
      p.set("v", currentView);
      if (currentView === "deep-research" && researchSymbol) p.set("sym", researchSymbol);
      else p.delete("sym");
    }
    const qs = p.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
  }, [currentView, researchSymbol]);

  // Open the comprehensive Deep Research page for a single symbol. Used by the
  // overview sidebar button, global search, and Ori's "enter deep research" flow.
  const openDeepResearch = (symbol) => {
    const s = sanitizeTicker(typeof symbol === "string" ? symbol : symbol?.symbol);
    if (!s) return;
    setResearchSymbol(s);
    setPickingSecond(false);
    // Close the quick-overview panes so Deep Research owns the full width.
    setDetailStock(null);
    setDetailStock2(null);
    setCurrentView("deep-research");
  };

  // Top-nav navigation. The quick-overview company panes are a screener feature,
  // so leaving for Deep Research closes them (they shouldn't carry over, and
  // Deep Research owns the full width).
  const navigateTo = (view) => {
    if (view === "deep-research") {
      setDetailStock(null);
      setDetailStock2(null);
      setPickingSecond(false);
    }
    if (view === "strategies") {
      setDetailStock(null);
      setDetailStock2(null);
      setPickingSecond(false);
    }
    setCurrentView(view);
  };

  // Track whether enough time has passed to show the full error UI.
  // This prevents a scary "Failed to load" flash on hard refresh while the
  // hook's delay + auto-retry logic has time to work.
  const [showFullErrorUI, setShowFullErrorUI] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowFullErrorUI(true), 1550);
    return () => clearTimeout(timer);
  }, []);
  const [theme, setTheme] = useState(
    () => localStorage.getItem(themeKey) || localStorage.getItem("theme") || "dark",
  );

  // Global search → open the chosen stock directly in the Deep Research page
  // (the dedicated single-stock research surface).
  const handleSearchSelect = (stock) => {
    if (!stock) return;
    openDeepResearch(stock.symbol);
  };

  // Clicking a row opens the primary overview (clicking the same one closes it).
  // While "picking second", the next click opens the comparison pane instead.
  const handleSelectStock = (stock) => {
    if (pickingSecond && detailStock && stock.symbol !== detailStock.symbol) {
      setDetailStock2(stock);
      setPickingSecond(false);
      return;
    }
    setDetailStock((current) =>
      current && current.symbol === stock.symbol ? null : stock
    );
  };
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    // Mobile/tablet (< lg): the filter panel is a full-screen overlay, so start it
    // HIDDEN — the stock list should be the first thing users see; they open
    // filters on demand via the toolbar button. The saved preference governs only
    // the desktop column.
    if (typeof window !== "undefined" && window.innerWidth < 1024) return true;
    const explicit = localStorage.getItem(sidebarKey);
    if (explicit != null) return explicit === "1";
    const legacy = localStorage.getItem("sidebarCollapsed");
    if (legacy != null) return legacy === "1";
    return false;
  });

  // True once theme/sidebar have been reconciled with the server, so the
  // initial local values can't clobber server-side prefs before hydration.
  const settingsHydrated = useRef(false);
  const prevThemeRef = useRef(null);

  // Hydrate theme + sidebar from the server (follows the account across
  // devices). If absent server-side, migrate the current local values up once.
  // Guided-tour progress from the settings blob: null until loaded (and left
  // null if the read fails, so the first-run prompt never misfires).
  const [tourPersisted, setTourPersisted] = useState(null);
  const [tourReturningUser, setTourReturningUser] = useState(false);
  // Only write tour progress back once the stored copy has actually loaded —
  // otherwise a failed read followed by finishing a tour would overwrite the
  // account's saved progress with an empty record.
  const tourLoadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const loaded = await fetchUserSettings({ nullOnError: true });
      if (cancelled) return;
      const server = loaded || {};
      if (loaded) {
        tourLoadedRef.current = true;
        setTourPersisted(loaded.tour && typeof loaded.tour === "object" ? loaded.tour : {});
        // Anything besides tour progress saved → an account from before tours.
        setTourReturningUser(Object.keys(loaded).some((k) => k !== "tour"));
      }
      const patch = {};
      if (typeof server.theme === "string") setTheme(server.theme);
      else patch.theme = theme;
      if (typeof server.sidebarCollapsed === "boolean") {
        // The saved preference governs the DESKTOP column only — on mobile/tablet
        // the filter panel is a full-screen overlay that always starts hidden,
        // so never let a server pref auto-open it on a small screen.
        if (typeof window !== "undefined" && window.innerWidth >= 1024) {
          setSidebarCollapsed(server.sidebarCollapsed);
        }
      } else if (typeof window === "undefined" || window.innerWidth >= 1024) {
        // Only migrate the collapse pref up from a desktop session — never seed
        // the account with the mobile overlay's always-hidden state.
        patch.sidebarCollapsed = sidebarCollapsed;
      }
      if (Object.keys(patch).length) patchUserSettings(patch);
      settingsHydrated.current = true;
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // The collapse state is a saved preference for the DESKTOP column only. On
    // mobile/tablet it's an ephemeral full-screen overlay (always starts hidden),
    // so don't persist it — otherwise opening/closing filters on a phone would
    // overwrite the desktop column's saved preference.
    if (typeof window !== "undefined" && window.innerWidth < 1024) return;
    localStorage.setItem(sidebarKey, sidebarCollapsed ? "1" : "0");
    if (settingsHydrated.current) patchUserSettings({ sidebarCollapsed });
  }, [sidebarCollapsed, sidebarKey]);

  // Expose for easy debugging in console (as requested)
  useEffect(() => {
    window.__DEBUG_IS_ADMIN = isAdmin;
  }, [isAdmin]);

  useEffect(() => {
    document.title = 'Orizin';
  }, []);

  // Warm the lazy page/modal chunks once the first screen has painted.
  useEffect(() => {
    const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 1200));
    const cancel = window.cancelIdleCallback || clearTimeout;
    const id = idle(() => prefetchAppChunks());
    return () => cancel(id);
  }, []);

  // Use layout effect so the .light class is applied synchronously before the browser paints.
  // Only add the .theme-no-transition suppressor when we are *actually switching*
  // themes (compare to prev). This prevents it from running on initial mount or
  // unrelated re-renders, so normal hovers (header buttons, table rows, modals,
  // etc.) are never suppressed. The suppressor only lives ~2 frames (double rAF)
  // during a real flip, making theme switch instant with no jank. Scoped in CSS
  // to only color props so other animations (e.g. button scales, modal fades)
  // are unaffected.
  useLayoutEffect(() => {
    const html = document.documentElement;
    const prev = prevThemeRef.current;
    const isActualSwitch = prev !== null && prev !== theme;

    if (isActualSwitch) {
      html.classList.add('theme-no-transition');
    }

    html.classList.toggle("light", theme === "light");
    localStorage.setItem(themeKey, theme);
    if (settingsHydrated.current) patchUserSettings({ theme });

    prevThemeRef.current = theme;

    if (isActualSwitch) {
      let raf2;
      const raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => {
          html.classList.remove('theme-no-transition');
        });
      });

      return () => {
        cancelAnimationFrame(raf1);
        if (raf2) cancelAnimationFrame(raf2);
        html.classList.remove('theme-no-transition');
      };
    }
  }, [theme, themeKey]);
  const {
    stocks,
    filtered,
    filteredRows,
    status,
    lastFetch,
    filters,
    setFilters,
    applyFiltersFromAI,
    risk,
    setRisk,
    persona,
    setPersona,
    horizon,
    setHorizon,
    goal,
    setGoal,
    pillarWeights,
    tableSortKey,
    tableSortDir,
    setTableSort,
    setConvictionOverride,
    fitCtx,
    pins,
    togglePin,
    tabs,
    activeTab,
    activateTab,
    createTab,
    deleteTab,
    loadStocks,
    refreshWatchlistQuotes,
    syncSymbol,
    enrichAll,
    regatherSymbol,
    enrichLoading,
    enrichNotice,
    clearEnrichNotice,
    loadProgress,
    addTicker,
    cancelOperation,
  } = useScreener(currentUser, portfolioGoals, canUseOri, currentView);

  // Strategy monitoring stays mounted across every main view so due paper checks
  // continue while the user researches elsewhere in the app.
  const strategies = useStrategies(currentUser, stocks, canUseOri);

  const watchlists = useWatchlists(currentUser);
  const wlAlerts = useWatchlistAlerts({ enabled: currentUser && currentUser !== "default" });
  const [wlTestBusy, setWlTestBusy] = useState(false);
  const [wlTestMsg, setWlTestMsg] = useState("");
  const [wlTestOk, setWlTestOk] = useState(null);
  const handleWlTestAlert = async () => {
    setWlTestBusy(true);
    setWlTestMsg("");
    setWlTestOk(null);
    const result = await wlAlerts.triggerTestAlert({
      symbol: watchlists.watchlist?.symbols?.[0],
      type: "price",
    });
    setWlTestBusy(false);
    if (result?.ok) {
      setWlTestOk(true);
      const n = result.alerts?.length ?? 1;
      setWlTestMsg(`${n} alert${n === 1 ? "" : "s"} queued — check the red badge on Watchlist in the header. Email is not sent by this button.`);
    } else {
      setWlTestOk(false);
      setWlTestMsg(result?.error || "Test notification failed");
    }
  };
  const watchlistSymbols = watchlists.watchlist?.symbols || [];
  const watchlistSymbolsKey = watchlistSymbols.join(",");
  const [watchlistNow, setWatchlistNow] = useState(0);
  useEffect(() => {
    const update = () => setWatchlistNow(Date.now());
    update();
    const id = setInterval(update, 60 * 1000);
    return () => clearInterval(id);
  }, []);
  const stockBySymbol = useMemo(
    () => new Map(stocks.map((s) => [s.symbol, s])),
    [stocks],
  );
  const pendingWlSymbols = useMemo(() => {
    const wl = watchlists.watchlist;
    if (!watchlistNow) return new Set();
    if (!wl?.symbols?.length) return new Set();
    const listRecent = wl.updatedAt && watchlistNow - wl.updatedAt < 10 * 60 * 1000;
    if (!listRecent) return new Set();
    const stale = new Set();
    for (const sym of wl.symbols) {
      const snap = wlAlerts.snapshots[sym];
      const row = stockBySymbol.get(sym);
      const pu = snap?.priceUpdatedAt ?? row?.price_updated_at;
      if (!pu || watchlistNow - pu > 5 * 60 * 1000) stale.add(sym);
    }
    return stale;
  }, [watchlists.watchlist, wlAlerts.snapshots, stockBySymbol, watchlistNow]);

  // refreshWatchlistQuotes is a fresh function every render; depending on it
  // directly re-ran this effect (and re-POSTed the quotes) on EVERY App render.
  // Read it through a ref so only a watchlist change restarts the poll.
  const refreshWatchlistQuotesRef = useRef(refreshWatchlistQuotes);
  useEffect(() => {
    refreshWatchlistQuotesRef.current = refreshWatchlistQuotes;
  }, [refreshWatchlistQuotes]);
  useEffect(() => {
    if (!watchlistSymbolsKey) return;
    const symbols = watchlistSymbolsKey.split(",").filter(Boolean);
    if (!symbols.length) return;
    refreshWatchlistQuotesRef.current?.(symbols);
    const id = setInterval(() => refreshWatchlistQuotesRef.current?.(symbols), 3 * 60 * 1000);
    return () => clearInterval(id);
  }, [watchlistSymbolsKey]);
  // fitCtx (portfolio sectors, held symbols, goal/thesis keywords) is built inside
  // useScreener so the screener Conviction can fold in personal Fit; we reuse the
  // SAME context here for Deep Research + Ori chat so all three stay consistent.
  // Bumped only after an explicit (admin) Re-gather so the Deep Research detail
  // panes re-read the freshly gathered caches. Opening a symbol does NOT bump
  // it — the old open flow bumped it straight away, so every panel fetched
  // twice and the ~34 requests tripped the per-minute limiter, which is what
  // made Ori's Game Plan / "Refresh Ori" fail on the first try.
  const [detailReloadToken, setDetailReloadToken] = useState(0);
  useEffect(() => {
    setDetailReloadToken(0);
  }, [researchSymbol]);

  // Opening a stock in Deep Research syncs it with FMP for EVERY account: a
  // live quote plus key metrics / ratios when they are stale (the server
  // decides what is due and coalesces concurrent opens). The heavy full
  // re-gather stays an explicit admin action on the toolbar.
  // Symbols outside the shared universe come back as a read-only row, kept
  // here so the Game Plan can still be computed for them.
  const [researchExtraRow, setResearchExtraRow] = useState(null);
  const [researchSyncing, setResearchSyncing] = useState(false);
  const syncSymbolRef = useRef(syncSymbol);
  const researchSymbolRef = useRef(researchSymbol);
  useEffect(() => {
    syncSymbolRef.current = syncSymbol;
  }, [syncSymbol]);
  useEffect(() => {
    researchSymbolRef.current = researchSymbol;
  }, [researchSymbol]);
  const lastDrOpen = useRef(null);
  useEffect(() => {
    if (currentView !== "deep-research") {
      lastDrOpen.current = null;
      return;
    }
    if (!researchSymbol || lastDrOpen.current === researchSymbol) return;
    lastDrOpen.current = researchSymbol;
    const requested = researchSymbol;
    setResearchSyncing(true);
    syncSymbolRef.current(requested).then((result) => {
      if (researchSymbolRef.current !== requested) return;
      setResearchSyncing(false);
      setResearchExtraRow(result && !result.inUniverse && result.row ? result.row : null);
    });
  }, [currentView, researchSymbol]);

  // Debounce stock search input for much better perf with large universes (tens of thousands of symbols).
  // Input feels instant; expensive re-filtering (applyFilters + memos + virtual list) only on pause.
  const [searchInput, setSearchInput] = useState(filters.search || "");
  const searchDebounceRef = useRef(null);
  useEffect(() => {
    setSearchInput(filters.search || "");
  }, [filters.search]);
  const handleSearchChange = (val) => {
    setSearchInput(val);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setFilters({ ...filters, search: val });
    }, 200);
  };
  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, []);

  const applyRecommendation = (rec) => {
    // Ori no longer recommends weight changes — Conviction's pillar weights come from the user's persona.
    const filtersToApply = rec.filters || rec.recommendFilters || rec.applyFilters;

    if (filtersToApply) {
      // Ori emits flat keys (roicMin: 15, mcapMin: 2); translate them into the
      // shape the current screener + Sidebar use so the filter both narrows the
      // results and shows up in the filter inputs.
      applyFiltersFromAI({ ...filters, ...normalizeRecToFilters(filtersToApply) });
    }
    // weights from recommendations are ignored by design
  };

  // Resolve the open detail stock against the live `filtered` set so its
  // Conviction re-computes as the persona lens changes. Falls back to the
  // clicked snapshot if filters now exclude it.
  const detailRow = detailStock
    ? filtered.find((r) => r.symbol === detailStock.symbol) || detailStock
    : null;

  // Fetch the open stock's rich detail (profile, chart, RSI, ratings, grades)
  // once, here, so both the overview pane AND Ori's chat context share it.
  const detail = useStockDetail(detailStock?.symbol || null);

  // Optional second overview, opened side-by-side for a head-to-head compare.
  const detailRow2 = detailStock2
    ? filtered.find((r) => r.symbol === detailStock2.symbol) || detailStock2
    : null;
  const detail2 = useStockDetail(detailStock2?.symbol || null);

  // Additional rich detail loads specifically for Ori chat context.
  // These ensure that *any* way the user asks about stocks (button, typing a symbol,
  // following up on suggestions, etc.) Ori receives the full available context
  // (profile, DCF, targets, insider, grades, news, RSI series, performance, etc.).
  const [chatFocusSym1, setChatFocusSym1] = useState(null);
  const [chatFocusSym2, setChatFocusSym2] = useState(null);
  const chatFocusDetail1 = useStockDetail(chatFocusSym1);
  const chatFocusDetail2 = useStockDetail(chatFocusSym2);

  // On the Deep Research page, fetch the on-screen stock's full detail so Ori
  // can dig into everything the user is looking at (profile, DCF, targets,
  // insider, news, RSI, grades, performance) without an extra click.
  const researchRow =
    currentView === "deep-research" && researchSymbol
      ? filtered.find((r) => r.symbol === researchSymbol) ||
        stocks.find((r) => r.symbol === researchSymbol) ||
        (researchExtraRow?.symbol === researchSymbol ? researchExtraRow : null) ||
        { symbol: researchSymbol }
      : null;
  const researchDetail = useStockDetail(
    currentView === "deep-research" ? researchSymbol : null,
    detailReloadToken,
  );

  function closeDetailA() {
    setPickingSecond(false);
    if (detailStock2) {
      setDetailStock(detailStock2);
      setDetailStock2(null);
    } else {
      setDetailStock(null);
    }
  }
  function closeDetailB() {
    setPickingSecond(false);
    setDetailStock2(null);
  }
  function pickSecondBySymbol(sym) {
    const s = (sym || "").trim().toUpperCase();
    if (!s) return;
    const row = filtered.find((r) => r.symbol === s) || stocks.find((r) => r.symbol === s);
    if (row) {
      setDetailStock2(row);
      setPickingSecond(false);
    }
  }
  // Mirror one compare pane's scroll position onto the other (no feedback loop).
  function syncScroll(fromRef, toRef) {
    if (!detailStock2 || scrollSyncingRef.current) return;
    const from = fromRef.current;
    const to = toRef.current;
    if (!from || !to) return;
    scrollSyncingRef.current = true;
    to.scrollTop = from.scrollTop;
    requestAnimationFrame(() => {
      scrollSyncingRef.current = false;
    });
  }

  // Every stock handed to Ori is built by the same helper (lib/oriContext.js):
  // row + fetched detail + momentum + personal Fit + the Game Plan verdict.
  const oriLens = { risk, weights: pillarWeights };
  const activeStock = buildOriStockContext(detailRow, detail, fitCtx, oriLens);

  // The on-screen Deep Research stock, framed exactly like activeStock so Ori
  // treats it as the thing the user is currently studying.
  const researchStock = buildOriStockContext(researchRow, researchDetail, fitCtx, oriLens);

  // Pinned screener rows (per-tab) — separate from watchlists used for monitoring.
  const activeScreenerName = tabs.find((t) => t.id === activeTab)?.name || null;
  const pinnedStocks = [...pins]
    .map((sym) => filtered.find((r) => r.symbol === sym) || stocks.find((r) => r.symbol === sym))
    .filter(Boolean);

  // Build rich context objects for up to two additional stocks the user is
  // focusing on / has asked about (via button, typing symbols, or follow-ups).
  // These get the exact same full treatment as the main activeStock.
  const focusRow1 = chatFocusSym1
    ? filtered.find((r) => r.symbol === chatFocusSym1) || stocks.find((r) => r.symbol === chatFocusSym1)
    : null;
  const focusStock1 = buildOriStockContext(focusRow1, chatFocusDetail1, fitCtx, oriLens);

  const focusRow2 = chatFocusSym2
    ? filtered.find((r) => r.symbol === chatFocusSym2) || stocks.find((r) => r.symbol === chatFocusSym2)
    : null;
  const focusStock2 = buildOriStockContext(focusRow2, chatFocusDetail2, fitCtx, oriLens);

  const chat = useChat(filtered, filters, applyRecommendation, currentView === "deep-research" ? (researchStock || activeStock) : activeStock, {
    // Which main view the user is on ('screener' | 'portfolio-goals') so Ori can
    // shift its focus: portfolio analysis vs. screener recommendations.
    view: currentView,
    activeScreener: activeScreenerName,
    pinnedStocks,
    news,
    // Rich data for any stocks the user has explicitly asked about or mentioned
    // (via "Ask Ori", typing symbols in chat, follow-ups, etc.). This ensures
    // Ori always gets the full available context no matter the entry point.
    focusStocks: [focusStock1, focusStock2].filter(Boolean),
    // User's manually entered portfolios + goals — sent to Ori on every message
    // so recommendations are framed by their actual holdings and objectives.
    portfolioGoals: {
      portfolios: portfolioGoals.portfolios,
      goals: portfolioGoals.goals,
      theses: portfolioGoals.theses,
      grandTotal: portfolioGoals.grandTotal,
      overallAllocations: portfolioGoals.overallAllocations,
    },
    onFocusStock: (symbol) => {
      const row = filtered.find((r) => r.symbol === symbol) || stocks.find((r) => r.symbol === symbol);
      if (row) handleSelectStock(row);
    },
    // Ori can transition the user into the Deep Research page (with confirmation).
    onEnterDeepResearch: (symbol) => openDeepResearch(symbol),
  });

  // Known-symbol set for ticker extraction — built once per universe load
  // instead of on every chat message (it's ~10k entries).
  const knownSymbols = useMemo(
    () => new Set(stocks.map((s) => s.symbol)),
    [stocks],
  );

  // Keep additional chat-focused symbols enriched with full detail data so that
  // *any* way the user asks Ori about stocks (explicit button, typing names in chat,
  // following up on Ori's suggestions, etc.) causes the rich context to be sent.
  const detailSym = detailStock?.symbol || null;
  useEffect(() => {
    const fromFocus = chat.focusSymbols || [];
    // Also pull tickers mentioned in the most recent user message(s)
    const recentUserMsgs = chat.messages
      .filter((m) => m.role === "user")
      .slice(-2)
      .map((m) => m.content || "")
      .join(" ");
    const extracted = extractSymbols(recentUserMsgs, knownSymbols);
    const desired = [...new Set([...fromFocus, ...extracted])].slice(0, 3);

    // Don't duplicate the main open detail stock (it already gets full treatment as activeStock)
    const extras = desired.filter((s) => s !== detailSym).slice(0, 2);
    setChatFocusSym1(extras[0] || null);
    setChatFocusSym2(extras[1] || null);
  }, [chat.focusSymbols, chat.messages, detailSym, knownSymbols]);

  // Bump this when the user does a Force Re-gather so the table can also
  // force-refresh its sparklines from the server (which will hit FMP).
  const [sparklineForceVersion, setSparklineForceVersion] = useState(0);

  // Copy the on-screen tickers (top 100 by score) for pasting into another LLM.
  const [copiedTickers, setCopiedTickers] = useState(false);
  const copyTickers = async () => {
    const syms = [...filtered]
      .sort((a, b) => (b.conviction || 0) - (a.conviction || 0))
      .slice(0, 100)
      .map((r) => r.symbol);
    if (!syms.length) return;
    try {
      await navigator.clipboard.writeText(syms.join(", "));
      setCopiedTickers(true);
      setTimeout(() => setCopiedTickers(false), 1600);
    } catch {
      /* clipboard blocked (e.g. insecure context) — ignore */
    }
  };

  // ── Guided tours ─────────────────────────────────────────────────────────
  // Steps drive the app through these actions (navigate, open a panel, pick a
  // demo symbol). Anything a tour opens on the user's behalf is closed again
  // when the tour ends, so it never leaves their saved layout changed.
  const tourOpenedRef = useRef({ sidebar: false, chat: false });
  const tourDemoSymbol = useMemo(
    () => (stocks.find((r) => !r.is_etf && r.has_km) || stocks[0])?.symbol || null,
    [stocks],
  );
  const tour = useTour({
    persisted: tourPersisted,
    onPersist: (blob) => {
      setTourPersisted(blob);
      if (tourLoadedRef.current) patchUserSettings({ tour: blob });
    },
    ctx: {
      canUseOri,
      isAdmin,
      plan,
      isMobile,
      hasStocks: stocks.length > 0,
      researchSymbol,
      demoSymbol: tourDemoSymbol,
      strategyCount: strategies.strategies?.length || 0,
    },
    actions: {
      goto: navigateTo,
      openResearch: openDeepResearch,
      resetSurface: () => {
        chat.setIsOpen(false);
        setShowWatchlist(false);
        setShowCompare(false);
        setDetailStock(null);
        setDetailStock2(null);
        setPickingSecond(false);
        if (isMobile) setSidebarCollapsed(true);
      },
      setChatOpen: (open) => {
        if (open && !chat.isOpen) tourOpenedRef.current.chat = true;
        chat.setIsOpen(open);
      },
      setWatchlistOpen: setShowWatchlist,
      setSidebarCollapsed: (collapsed) => {
        if (!collapsed && sidebarCollapsed) tourOpenedRef.current.sidebar = true;
        setSidebarCollapsed(collapsed);
      },
      onExit: () => {
        setShowWatchlist(false);
        if (tourOpenedRef.current.chat) chat.setIsOpen(false);
        if (tourOpenedRef.current.sidebar || isMobile) setSidebarCollapsed(true);
        tourOpenedRef.current = { sidebar: false, chat: false };
      },
    },
  });

  // Ori launch: just open the chat (the launcher fades out via AnimatePresence).
  const launchOri = () => {
    if (chat.isOpen) return;
    chat.setIsOpen(true);
  };

  return (
    <LazyMotion features={domAnimation} strict>
    <div className="h-[100dvh] flex flex-col bg-gray-950 text-gray-100 overflow-hidden">
      <Header
        status={status}
        filtered={filtered}
        onOpenWatchlist={() => setShowWatchlist(true)}
        watchlistUnread={wlAlerts.alerts.length}
        refreshNotice={enrichNotice}
        onClearRefreshNotice={clearEnrichNotice}

        lastFetch={lastFetch}
        onRefresh={() => loadStocks(true)}
        onGatherData={(scope) => {
          // Only the full "Force re-gather all" force-refreshes the table's
          // sparklines (cheap — the table re-fetches just the rendered rows).
          if (scope === "all") {
            setSparklineForceVersion(v => v + 1);
          }
          enrichAll(scope);
        }}
        enrichLoading={enrichLoading}
        theme={theme}
        onToggleTheme={() => setTheme(theme === "dark" ? "light" : "dark")}
        currentUser={currentUser}
        isAdmin={isAdmin}
        plan={plan}
        env={appEnv}
        onLogout={onLogout}
        onAccountSettings={() => { setUsersModalMode('account'); setShowUsersModal(true); }}
        onOriUsage={() => { setUsersModalMode('usage'); setShowUsersModal(true); }}
        onManageUsers={() => { setUsersModalMode('users'); setShowUsersModal(true); }}
        onUpgradeToPro={openUpgradeModal}
        onAddTicker={() => setShowAddTicker(true)}
        currentView={currentView}
        onNavigate={navigateTo}
        stocks={stocks}
        onSearchSelect={handleSearchSelect}
        portfolioSummary={{
          grandTotal: portfolioGoals.grandTotal,
          portfolioCount: portfolioGoals.portfolios?.length || 0,
          goalCount: portfolioGoals.goals?.length || 0,
        }}
        tours={tour.catalog}
        pageTourId={PAGE_TOURS[currentView] || null}
        onStartTour={(id) => tour.start(id)}
        onResetTours={tour.resetProgress}
      />

      <ProgressBar progress={loadProgress} label={enrichLoading ? "Enriching…" : "Refreshing universe…"} onCancel={cancelOperation} />

      <div className="flex flex-1 overflow-hidden min-h-0">
        {currentView === 'screener' && (
          <Sidebar
            filters={filters}
            setFilters={setFilters}
            stocks={stocks}
            collapsed={sidebarCollapsed}
            onToggleCollapsed={() => setSidebarCollapsed(c => !c)}
          />
        )}

        {/* Plain container for the main view. Removed the framer-motion m.div + AnimatePresence
            wrapper (which was promoting the entire subtree — including the virtualized table — to a
            single GPU compositing layer). This was causing:
            - Laggy/stuttery hover on table rows (every mouse move repainted the whole layer)
            - Laggy theme switches (toggling .light forced a massive synchronous repaint of the giant layer)
            - Cursor / UI freezes during the repaint
            The cross-fade between views is sacrificed for snappy interactions and correct theming.
            (The ori button, chat panel, and landing page still use motion where appropriate.) */}
        <div className="flex flex-col flex-1 overflow-hidden min-h-0">
          <Suspense fallback={<PageFallback />}>
          {currentView === 'deep-research' ? (
            <DeepResearchPage
              fitCtx={fitCtx}
              risk={risk} setRisk={setRisk}
              persona={persona} setPersona={setPersona}
              horizon={horizon} setHorizon={setHorizon}
              goal={goal} setGoal={setGoal}
              pillarWeights={pillarWeights}
              isAdmin={isAdmin}
              canUseOri={canUseOri}
              onToggleWatchlist={watchlists.toggleSymbol}
              isInWatchlist={researchSymbol ? watchlists.isInActive(researchSymbol) : false}
              onConvictionChange={setConvictionOverride}
              symbol={researchSymbol}
              stocks={stocks}
              onSelectSymbol={(sym) => openDeepResearch(sym)}
              row={researchRow}
              syncing={researchSyncing}
              onRegather={
                isAdmin
                  ? (sym) => regatherSymbol(sym, () => setDetailReloadToken((t) => t + 1))
                  : undefined
              }
              regathering={isAdmin && enrichLoading}
              detailReloadToken={detailReloadToken}
              detail={researchDetail}
              onBack={() => setCurrentView('screener')}
              onUpgradeToPro={openUpgradeModal}
              onAskOri={(sym) => {
                if (!canUseOri) {
                  openUpgradeModal();
                  return;
                }
                chat.setIsOpen(true);
                chat.askAboutStock(sym);
              }}
            />
          ) : currentView === 'portfolio-goals' ? (
            <PortfolioGoalsPage
              portfolioGoals={portfolioGoals}
              stocks={stocks}
              theme={theme}
              onSelectStock={handleSelectStock}
              detailStock={detailStock}
              persona={persona}
              setPersona={setPersona}
              horizon={horizon}
              setHorizon={setHorizon}
              goal={goal}
              setGoal={setGoal}
              pillarWeights={pillarWeights}
              risk={risk}
              setRisk={setRisk}
            />
          ) : currentView === 'strategies' ? (
            <StrategiesPage
              strategiesStore={strategies}
              stocks={stocks}
              canUseOri={canUseOri}
              onUpgradeToPro={openUpgradeModal}
            />
          ) : (
            <>
              <TabsBar
                tabs={tabs}
                activeTab={activeTab}
                onActivate={activateTab}
                onCreate={createTab}
                onDelete={deleteTab}
              />

              {/* Controls bar — desktop / iPad landscape (≥ lg) */}
              <div className="hidden lg:flex flex-wrap items-center gap-3 gap-y-2 px-3 py-2 border-b border-gray-800 bg-gray-950 shrink-0">
                <div
                  data-tour="screener-search"
                  className="flex items-center gap-2 flex-1 min-w-[140px] max-w-xs bg-gray-900 border border-gray-800
                  rounded-lg px-3 py-1.5"
                >
                  <span className="text-gray-600 text-sm">⌕</span>
                  <input
                    type="text"
                    value={searchInput}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    placeholder="Search symbol or name…"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    className="flex-1 bg-transparent text-xs text-gray-200 outline-none placeholder-gray-600"
                  />
                </div>

                <span data-tour="screener-count" className="text-xs text-gray-600 whitespace-nowrap">
                  {filtered.length} / {stocks.length}
                </span>

                <button
                  onClick={copyTickers}
                  className="shrink-0 p-1.5 rounded-md bg-gray-900 border border-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
                  title="Copy visible tickers"
                >
                  {copiedTickers ? <CheckIcon className="w-4 h-4 text-emerald-400" /> : <ClipboardIcon className="w-4 h-4" />}
                </button>

                <ScreenerLens
                  persona={persona} setPersona={setPersona}
                  risk={risk} setRisk={setRisk}
                  horizon={horizon} setHorizon={setHorizon}
                  goal={goal} setGoal={setGoal}
                />

                <div data-tour="view-toggle" className="flex shrink-0 border border-gray-700 rounded-md overflow-hidden ml-auto">
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
              </div>

              {/* Controls bar — compact (< lg) */}
              <div className="flex lg:hidden flex-col gap-2 px-3 py-2 border-b border-gray-800 bg-gray-950 shrink-0">
                <div data-tour="screener-search" className="flex items-center gap-2 bg-gray-900 border border-gray-800 rounded-lg px-3 py-2">
                  <span className="text-gray-600 text-sm">⌕</span>
                  <input
                    type="text"
                    value={searchInput}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    placeholder="Search symbol or name…"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    className="flex-1 bg-transparent text-sm text-gray-200 outline-none placeholder-gray-600"
                  />
                </div>

                {/* One row for every control (the Lens used to sit alone on its
                    own row, pushing the first result ~50px further down). */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSidebarCollapsed(false)}
                    className="px-3 py-1.5 rounded-md text-xs font-semibold bg-gray-900 border border-gray-700
                      text-gray-300 hover:bg-gray-800 transition-colors flex items-center gap-1.5"
                  >
                    ⚙ Filters
                  </button>
                  <button
                    onClick={copyTickers}
                    title="Copy on-screen tickers"
                    className="p-2 rounded-md bg-gray-900 border border-gray-700 text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
                  >
                    {copiedTickers ? <CheckIcon className="w-4 h-4 text-emerald-400" /> : <ClipboardIcon className="w-4 h-4" />}
                  </button>
                  <span data-tour="screener-count" className="text-xs text-gray-600 whitespace-nowrap">
                    {filtered.length} / {stocks.length}
                  </span>

                  <div className="ml-auto flex items-center gap-2">
                    <ScreenerLens
                      persona={persona} setPersona={setPersona}
                      risk={risk} setRisk={setRisk}
                      horizon={horizon} setHorizon={setHorizon}
                      goal={goal} setGoal={setGoal}
                    />
                    <div data-tour="view-toggle" className="flex border border-gray-700 rounded-md overflow-hidden">
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
                !showFullErrorUI ? (
                  <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-gray-500">
                    <span className="text-2xl">📡</span>
                    <p className="text-xs">Connecting to data source…</p>
                  </div>
                ) : (
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
                )
              ) : view === "table" ? (
                <div data-tour="results" className="flex-1 min-h-0 overflow-hidden overscroll-contain" style={{ height: '100%' }}>
                  <StockTable
                    rows={filtered}
                    heatRows={filteredRows}
                    pins={pins}
                    canUseOri={canUseOri}
                    onUpgradeToPro={openUpgradeModal}
                    onTogglePin={togglePin}
                    onAskAI={canUseOri ? chat.askAboutStock : undefined}
                    onSelectStock={handleSelectStock}
                    enrichLoading={enrichLoading}
                    sparklineForceVersion={sparklineForceVersion}
                    sortKey={tableSortKey}
                    sortDir={tableSortDir}
                    onSortChange={setTableSort}
                  />
                </div>
              ) : (
                <div data-tour="results" className="flex-1 min-h-0 overflow-auto overscroll-contain pb-24 lg:pb-0" style={{ height: '100%' }}>
                  <ScorecardGrid rows={filtered} canUseOri={canUseOri} onSelectStock={handleSelectStock} pins={pins} onTogglePin={togglePin} />
                </div>
              )}
            </>
          )}
          </Suspense>
        </div>

        <Suspense fallback={null}>
        {currentView !== 'deep-research' && detailRow && (
          <StockDetailModal
            row={detailRow}
            symbol={detailStock?.symbol}
            onClose={closeDetailA}
            onDeepResearch={() => openDeepResearch(detailStock?.symbol)}
            profile={detail.profile}
            points={detail.points}
            rsi={detail.rsi}
            ratings={detail.ratings}
            grades={detail.grades}
            aiData={detail.aiData}
            insider={detail.insider}
            loadingProfile={detail.loadingProfile}
            loadingChart={detail.loadingChart}
            loadingRatings={detail.loadingRatings}
            loadingGrades={detail.loadingGrades}
            loadingAi={detail.loadingAi}
            loadingInsider={detail.loadingInsider}
            comparePicking={pickingSecond}
            onStartCompare={!detailStock2 ? (isMobile ? () => setShowCompare(true) : () => setPickingSecond(true)) : null}
            onCancelCompare={() => setPickingSecond(false)}
            onPickSecond={pickSecondBySymbol}
            onCompare={detailStock2 ? () => setShowCompare(true) : null}
            tab={detailStock2 ? compareTab : null}
            onTabChange={detailStock2 ? setCompareTab : null}
            timeframe={detailStock2 ? compareTimeframe : null}
            onTimeframeChange={detailStock2 ? setCompareTimeframe : null}
            scrollRef={aScrollRef}
            onScrollSync={() => syncScroll(aScrollRef, bScrollRef)}
          />
        )}

        {!isMobile && currentView !== 'deep-research' && detailRow2 && (
          <StockDetailModal
            row={detailRow2}
            symbol={detailStock2?.symbol}
            onClose={closeDetailB}
            profile={detail2.profile}
            points={detail2.points}
            rsi={detail2.rsi}
            ratings={detail2.ratings}
            grades={detail2.grades}
            aiData={detail2.aiData}
            insider={detail2.insider}
            loadingProfile={detail2.loadingProfile}
            loadingChart={detail2.loadingChart}
            loadingRatings={detail2.loadingRatings}
            loadingGrades={detail2.loadingGrades}
            loadingAi={detail2.loadingAi}
            loadingInsider={detail2.loadingInsider}
            onCompare={() => setShowCompare(true)}
            tab={compareTab}
            onTabChange={setCompareTab}
            timeframe={compareTimeframe}
            onTimeframeChange={setCompareTimeframe}
            scrollRef={bScrollRef}
            onScrollSync={() => syncScroll(bScrollRef, aScrollRef)}
          />
        )}
        </Suspense>

        {chat.isOpen && currentView !== 'strategies' && (
          <ChatPanel
            chat={chat}
            canUseOri={canUseOri}
            floating={!!(detailStock && detailStock2)}
            elevated={showWatchlist}
            onUpgradeToPro={openUpgradeModal}
          />
        )}
      </div>

      <Footer news={news} />

      {/* Floating "Ask Ori" launcher. Deliberately quiet: a dark pill with the
          Ori mark and a label on desktop, a compact circle on phones. No idle
          animation — only a short fade/rise on show and a slight lift on hover.
          Slides left to clear the company detail pane(s) when they're open. */}
      <AnimatePresence>
        {!chat.isOpen && currentView !== 'strategies' && (
          <m.div
            key="ori-fab"
            className={`fixed bottom-12 lg:bottom-14 z-50 transition-[right] duration-300 ease-out
              ${detailStock2 ? 'right-3 lg:right-[49.5rem]' : detailStock ? 'right-3 lg:right-[25.5rem]' : 'right-3 lg:right-6'}`}
            initial={reduceMotion ? false : { opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: 10, scale: 0.96 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            <button
              type="button"
              onClick={launchOri}
              data-tour="ori-launch"
              title="Ask Ori — your AI research analyst"
              aria-label="Ask Ori — open the AI chat"
              className="ori-launcher group relative isolate block rounded-full p-px cursor-pointer
                transition-transform duration-200 ease-out hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]
                focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-400"
            >
              {/* Soft indigo halo that slowly breathes (static with reduced motion). */}
              <span aria-hidden="true" className="ori-launcher-halo absolute -inset-2 -z-10 rounded-full bg-indigo-500/30 blur-xl" />
              {/* 1px gradient border. */}
              <span aria-hidden="true" className="ori-launcher-border absolute inset-0 rounded-full opacity-75 transition-opacity duration-200 group-hover:opacity-100" />
              <span
                className="relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-gray-950
                  lg:h-12 lg:w-auto lg:justify-start lg:gap-2.5 lg:pl-1.5 lg:pr-4
                  shadow-[0_10px_30px_-10px_rgba(99,102,241,0.65)]"
              >
                {/* One light sweep when it appears, again on hover. */}
                <span aria-hidden="true" className="ori-launcher-sheen pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/15 to-transparent" />
                {/* Emblem orb with an "available" dot. */}
                <span className="ori-launcher-orb relative grid h-9 w-9 shrink-0 place-items-center rounded-full ring-1 ring-inset ring-indigo-300/30">
                  <OriEmblem className="h-7 w-7 transition-transform duration-300 ease-out group-hover:rotate-[-12deg] group-hover:scale-110" />
                  <span aria-hidden="true" className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-gray-950 bg-emerald-400" />
                </span>
                <span className="hidden lg:flex flex-col items-start leading-none">
                  <span className="flex items-center gap-1.5 text-[13px] font-semibold tracking-tight text-gray-50">
                    Ask Ori
                    {!canUseOri && (
                      <span className="rounded-full border border-violet-500/50 bg-violet-500/15 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-violet-200">
                        Pro
                      </span>
                    )}
                  </span>
                  <span className="mt-1 text-[10px] font-medium text-gray-400">AI research analyst</span>
                </span>
              </span>
            </button>
          </m.div>
        )}
      </AnimatePresence>

      <Suspense fallback={null}>
      {showUsersModal && (
        <UsersModal
          onClose={() => setShowUsersModal(false)}
          currentUser={currentUser}
          isAdmin={isAdmin}
          plan={plan}
          mode={usersModalMode}
          onAuthRefresh={onAuthRefresh}
          onUpgradeToPro={() => { setShowUsersModal(false); openUpgradeModal(); }}
          appEnv={appEnv}
          onTestWatchlistAlert={handleWlTestAlert}
          testWatchlistAlertBusy={wlTestBusy}
          testWatchlistAlertMsg={wlTestMsg}
          testWatchlistAlertOk={wlTestOk}
        />
      )}
      </Suspense>

      <Suspense fallback={null}>
      {showCompare && (
        <CompareModal
          rows={filtered}
          universe={stocks}
          pins={[...pins]}
          initialA={detailStock?.symbol}
          initialB={detailStock2?.symbol}
          onClose={() => setShowCompare(false)}
          onAskOri={(a, b) => {
            setShowCompare(false);
            chat.setIsOpen(true);
            chat.sendMessage(
              `Compare ${a} and ${b} head-to-head on Conviction — valuation, quality, growth, balance sheet, and which is the better buy right now and why.`,
            );
          }}
        />
      )}
      </Suspense>

      <WatchlistPanel
        open={showWatchlist}
        onClose={() => setShowWatchlist(false)}
        watchlist={watchlists.watchlist}
        addSymbol={watchlists.addSymbol}
        removeSymbol={watchlists.removeSymbol}
        stocks={stocks}
        snapshots={wlAlerts.snapshots}
        pendingSymbols={pendingWlSymbols}
        canUseOri={canUseOri}
        alerts={wlAlerts.alerts}
        onDismissAlert={wlAlerts.dismiss}
        onClearAlerts={wlAlerts.markRead}
        onOpenAlertSymbol={(sym) => {
          setShowWatchlist(false);
          openDeepResearch(sym);
        }}
        onSelectSymbol={(sym) => {
          setShowWatchlist(false);
          openDeepResearch(sym);
        }}
        showDevTest={appEnv === "development"}
        onTestAlert={handleWlTestAlert}
        testAlertBusy={wlTestBusy}
        testAlertMsg={wlTestMsg}
        testAlertOk={wlTestOk}
      />

      <Suspense fallback={null}>
      {showUpgradeModal && (
        <UpgradeModal
          onClose={() => setShowUpgradeModal(false)}
          onSuccess={() => {
            // Server already granted Pro (verified the subscription). Re-read the
            // session so the UI unlocks Ori immediately, and return to the home
            // (screener) view so closing the success screen lands there rather
            // than wherever the upgrade was triggered (e.g. a Deep Research page).
            onAuthRefresh?.();
            setCurrentView('screener');
            setDetailStock(null);
            setDetailStock2(null);
          }}
        />
      )}
      </Suspense>

      {tour.active && (
        <TourOverlay
          tour={tour.tour}
          step={tour.step}
          stepReady={tour.stepReady}
          index={tour.index}
          total={tour.total}
          onNext={tour.next}
          onPrev={tour.prev}
          onGoto={tour.goto}
          onSkip={() => tour.stop()}
        />
      )}
      {!tour.active && tour.shouldOfferWelcome && !showUpgradeModal && !showUsersModal && (
        <TourWelcome
          returning={tourReturningUser}
          onStart={() => tour.start("welcome")}
          onDismiss={tour.dismissWelcome}
        />
      )}

      <Suspense fallback={null}>
      {showAddTicker && (
        <AddTickerModal
          onClose={() => setShowAddTicker(false)}
          onAdd={addTicker}
          onView={(stock) => { setShowAddTicker(false); handleSelectStock(stock); }}
        />
      )}
      </Suspense>
    </div>
    </LazyMotion>
  );
}

// Ori may express a filter many ways — flat number (roicMin: 15), operator
// object (peMax: {op:'<', value:25}), or a base metric name (roic, pe). This
// translates any of those into the exact keys + shapes the screener + Sidebar
// read, so a recommendation is never silently dropped. mcap/price/beta live on
// a single base key (range-capable); every other numeric metric lives on its
// Min/Max key as { op, value }.
const REC_PASSTHROUGH = new Set(["sectors", "industries", "universe", "search", "pinnedOnly", "rule40Only", "hasOriConviction"]);
const REC_RANGES = { mcap: ["mcapMin", "mcapMax"], price: ["priceMin", "priceMax"], beta: ["betaMin", "betaMax"] };
const REC_RANGE_FLAT = new Set(["mcapMin", "mcapMax", "priceMin", "priceMax", "betaMin", "betaMax"]);
// Base metric names → canonical Min/Max key the screener reads.
const REC_BASE_TO_KEY = {
  roic: "roicMin", roe: "roeMin", roa: "roaMin",
  gross: "grossMin", grossmargin: "grossMin",
  op: "opMin", opmargin: "opMin", operatingmargin: "opMin",
  net: "netMin", netmargin: "netMin",
  ebitda: "ebitdaMin", ebitdamargin: "ebitdaMin",
  fcfmargin: "fcfMargMin",
  revenuegrowth: "revGrowthMin", revgrowth: "revGrowthMin",
  epsgrowth: "epsGrowthMin", fcfgrowth: "fcfGrowthMin",
  opincomegrowth: "opIncGrowthMin", opincgrowth: "opIncGrowthMin",
  pe: "peMax", pb: "pbMax", ps: "psMax",
  evebitda: "evEbMax", evsales: "evSMax", evgp: "evGpMax",
  fcf: "fcfMin", fcfyield: "fcfMin",
  earningsyield: "earningsYieldMin",
  nd: "ndMax", netdebtebitda: "ndMax",
  cr: "crMin", currentratio: "crMin",
  de: "deMax", debtequity: "deMax", debttoequity: "deMax",
  div: "divMin", divyield: "divMin", dividend: "divMin",
  pay: "payMax", payout: "payMax",
  vol: "volMin", volume: "volMin",
  r40: "r40Min", ruleof40: "r40Min",
};

function recNum(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function recCanonicalKey(k) {
  if (REC_PASSTHROUGH.has(k) || k === "mcap" || k === "price" || k === "beta") return k;
  if (k.endsWith("Min") || k.endsWith("Max")) return k;
  return REC_BASE_TO_KEY[k.toLowerCase()] || null;
}

function normalizeRecToFilters(flat) {
  if (!flat || typeof flat !== "object") return {};
  const out = {};

  // Fold min/max pairs for the range-capable base keys.
  for (const [base, [minK, maxK]] of Object.entries(REC_RANGES)) {
    const minV = recNum(flat[minK]);
    const maxV = recNum(flat[maxK]);
    if (minV != null && maxV != null) out[base] = { op: "between", min: minV, max: maxV };
    else if (minV != null) out[base] = { op: ">=", value: minV };
    else if (maxV != null) out[base] = { op: "<=", value: maxV };
  }

  for (const [k, v] of Object.entries(flat)) {
    if (v == null || v === "" || REC_RANGE_FLAT.has(k)) continue; // ranges handled above
    const kc = recCanonicalKey(k);
    if (!kc) continue;
    if (REC_PASSTHROUGH.has(kc) || Array.isArray(v)) { out[kc] = v; continue; }
    if (kc === "mcap" || kc === "price" || kc === "beta") {
      out[kc] = typeof v === "object" ? v : { op: ">=", value: recNum(v) };
      continue;
    }
    if (typeof v === "object") { out[kc] = v; continue; } // operator object passthrough
    const n = recNum(v);
    if (n != null) out[kc] = { op: kc.endsWith("Max") ? "<=" : ">=", value: n };
  }
  return out;
}

function ClipboardIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

// Extract likely stock tickers (1-5 uppercase letters) from text, filtered to
// symbols that exist in the current universe. Used to auto-enrich context for
// Ori when the user types natural language questions about specific stocks.
function extractSymbols(text, knownSymbolSet) {
  if (!text || !knownSymbolSet?.size) return [];
  const candidates = String(text).toUpperCase().match(/\b([A-Z]{1,5})\b/g) || [];
  return [...new Set(candidates.filter((c) => knownSymbolSet.has(c)))];
}

