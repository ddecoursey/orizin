import { useState, useEffect, useLayoutEffect, useRef, useMemo, lazy, Suspense } from "react";
import { LazyMotion, domAnimation, m, AnimatePresence, useReducedMotion } from "./lib/motion.js";
import { useScreener } from "./hooks/useScreener.js";
import { useChat } from "./hooks/useChat.js";
import { useStockDetail } from "./hooks/useStockDetail.js";
import { useNews } from "./hooks/useNews.js";
import { usePortfolioGoals } from "./hooks/usePortfolioGoals.js";
import Header from "./components/Header.jsx";
import Sidebar from "./components/Sidebar.jsx";
import TabsBar from "./components/TabsBar.jsx";
import StockTable from "./components/StockTable.jsx";
import ScorecardGrid from "./components/ScorecardGrid.jsx";
import ProgressBar from "./components/ProgressBar.jsx";
import ChatPanel from "./components/ChatPanel.jsx";
// Lazy: the landing page (and framer-motion with it) is only downloaded by
// signed-out visitors — signed-in users go straight to the app bundle.
const HomePage = lazy(() => import("./pages/HomePage.jsx"));
import UsersModal from "./components/UsersModal.jsx";
import StockDetailModal from "./components/StockDetailModal.jsx";
import CompareModal from "./components/CompareModal.jsx";
import PortfolioGoalsPage from "./pages/PortfolioGoalsPage.jsx";
import DeepResearchPage from "./components/DeepResearchPage.jsx";
import Footer from "./components/Footer.jsx";
import UpgradeModal from "./components/UpgradeModal.jsx";
import { fetchUserSettings, patchUserSettings } from "./lib/userStore.js";

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
        setPlan(data.plan === "pro" ? "pro" : "free");
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
      const data = await r.json();
      setCurrentUser(data.user || "default");
      setIsAdmin(!!data.isAdmin);
      setPlan(data.plan === "pro" ? "pro" : "free");
      setAppEnv(data.env || "production");
    } catch {
      setCurrentUser("default");
      setIsAdmin(false);
      setPlan("free");
    }
    setAuthState("authed");
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
      setPlan(data.plan === "pro" ? "pro" : "free");
      setAppEnv(data.env || "production");
    } catch {
      /* ignore — keep current state */
    }
  }

  // PayPal redirect fallback: if the checkout popup was blocked, PayPal sends the
  // buyer back to /?subscribed=1 after approval. onApprove never ran (we navigated
  // away), so Pro is granted server-side by the webhook — poll the session a few
  // times so it shows up, then clean the URL. (?subscribe=cancelled just clears.)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const subscribed = params.get("subscribed") === "1";
    const cancelled = params.get("subscribe") === "cancelled";
    if (!subscribed && !cancelled) return;
    window.history.replaceState({}, "", window.location.pathname);
    if (!subscribed) return;
    let n = 0;
    const id = setInterval(() => {
      refreshAuth();
      if (++n >= 4) clearInterval(id);
    }, 2500);
    return () => clearInterval(id);
  }, []);

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

function MainApp({ currentUser, isAdmin, plan = "free", appEnv = "production", onLogout, onAuthRefresh }) {
  // Ori access: Pro plan or admin. The server enforces this on /api/chat too —
  // this flag just drives the paywall UI.
  const canUseOri = isAdmin || plan === "pro";
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

  // Main view: 'screener' | 'portfolio-goals' | 'deep-research'
  const [currentView, setCurrentView] = useState('screener');
  // Symbol currently open in the Deep Research page (single-stock focus).
  const [researchSymbol, setResearchSymbol] = useState(null);

  // Open the comprehensive Deep Research page for a single symbol. Used by the
  // overview sidebar button, global search, and Ori's "enter deep research" flow.
  const openDeepResearch = (symbol) => {
    if (!symbol) return;
    setResearchSymbol(typeof symbol === "string" ? symbol : symbol.symbol);
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
    // Mobile/tablet: the filter panel is an overlay, so start it OPEN — filters
    // dominate the small screen and are the first thing users want. The saved
    // preference governs only the desktop column.
    if (typeof window !== "undefined" && window.innerWidth < 1024) return false;
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
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const server = await fetchUserSettings();
      if (cancelled) return;
      const patch = {};
      if (typeof server.theme === "string") setTheme(server.theme);
      else patch.theme = theme;
      if (typeof server.sidebarCollapsed === "boolean") {
        // Don't let the saved (desktop) preference auto-collapse the mobile
        // overlay — mobile always starts with filters open.
        if (typeof window !== "undefined" && window.innerWidth >= 1024) {
          setSidebarCollapsed(server.sidebarCollapsed);
        }
      } else {
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
    regatherSymbol,
    enrichLoading,
    loadProgress,
    addTicker,
    cancelOperation,
  } = useScreener(currentUser);

  // Bumped after a single-symbol re-gather so the Deep Research detail panes
  // re-fetch the freshly gathered data.
  const [detailReloadToken, setDetailReloadToken] = useState(0);

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
    // Ori no longer recommends weight changes — user controls the Q/V/G sliders directly.
    const filtersToApply = rec.filters || rec.recommendFilters || rec.applyFilters;

    if (filtersToApply) {
      // Ori emits flat keys (roicMin: 15, mcapMin: 2); translate them into the
      // shape the current screener + Sidebar use so the filter both narrows the
      // results and shows up in the filter inputs.
      applyFiltersFromAI({ ...filters, ...normalizeRecToFilters(filtersToApply) });
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

  // Derive price performance and RSI trend for the open stock from the data we
  // already fetched for the chart — gives Ori momentum/timing context for free.
  const activeStock = detailRow
    ? {
        ...detailRow,
        profile: detail.profile,
        ratings: detail.ratings,
        grades: detail.grades,
        aiData: detail.aiData,
        insider: detail.insider,
        news: detail.news || [],
        latestRsi: detail.rsi?.length ? detail.rsi[detail.rsi.length - 1].rsi : null,
        performance: pricePerformance(detail.points),
        rsiTrend: rsiTrend(detail.rsi),
      }
    : null;

  // The on-screen Deep Research stock, with full detail, framed exactly like
  // activeStock so Ori treats it as the thing the user is currently studying.
  const researchStock = researchRow
    ? {
        ...researchRow,
        profile: researchDetail.profile,
        ratings: researchDetail.ratings,
        grades: researchDetail.grades,
        aiData: researchDetail.aiData,
        insider: researchDetail.insider,
        news: researchDetail.news || [],
        latestRsi: researchDetail.rsi?.length ? researchDetail.rsi[researchDetail.rsi.length - 1].rsi : null,
        performance: pricePerformance(researchDetail.points),
        rsiTrend: rsiTrend(researchDetail.rsi),
      }
    : null;

  // What the user is actively working with: their pinned watchlist and the
  // screener (tab) they're in. Pinned rows pull from the filtered set first
  // (so they carry live scores), falling back to the full universe.
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
  const focusStock1 = focusRow1
    ? {
        ...focusRow1,
        profile: chatFocusDetail1.profile,
        ratings: chatFocusDetail1.ratings,
        grades: chatFocusDetail1.grades,
        aiData: chatFocusDetail1.aiData,
        insider: chatFocusDetail1.insider,
        news: chatFocusDetail1.news || [],
        latestRsi: chatFocusDetail1.rsi?.length ? chatFocusDetail1.rsi[chatFocusDetail1.rsi.length - 1].rsi : null,
        performance: pricePerformance(chatFocusDetail1.points),
        rsiTrend: rsiTrend(chatFocusDetail1.rsi),
      }
    : null;

  const focusRow2 = chatFocusSym2
    ? filtered.find((r) => r.symbol === chatFocusSym2) || stocks.find((r) => r.symbol === chatFocusSym2)
    : null;
  const focusStock2 = focusRow2
    ? {
        ...focusRow2,
        profile: chatFocusDetail2.profile,
        ratings: chatFocusDetail2.ratings,
        grades: chatFocusDetail2.grades,
        aiData: chatFocusDetail2.aiData,
        insider: chatFocusDetail2.insider,
        news: chatFocusDetail2.news || [],
        latestRsi: chatFocusDetail2.rsi?.length ? chatFocusDetail2.rsi[chatFocusDetail2.rsi.length - 1].rsi : null,
        performance: pricePerformance(chatFocusDetail2.points),
        rsiTrend: rsiTrend(chatFocusDetail2.rsi),
      }
    : null;

  const chat = useChat(filtered, filters, weights, applyRecommendation, currentView === "deep-research" ? (researchStock || activeStock) : activeStock, {
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
      .sort((a, b) => (b.score || 0) - (a.score || 0))
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

  // Ori launch: just open the chat. The planet's orbit-out is driven by the
  // AnimatePresence exit on the floating button (the mirror image of its
  // orbit-in entry), so opening and closing animate identically in reverse.
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
        onManageUsers={() => { setUsersModalMode('users'); setShowUsersModal(true); }}
        onUpgradeToPro={openUpgradeModal}
        currentView={currentView}
        onNavigate={navigateTo}
        stocks={stocks}
        onSearchSelect={handleSearchSelect}
        portfolioSummary={{
          grandTotal: portfolioGoals.grandTotal,
          portfolioCount: portfolioGoals.portfolios?.length || 0,
          goalCount: portfolioGoals.goals?.length || 0,
        }}
      />

      <ProgressBar progress={loadProgress} label={enrichLoading ? "Enriching…" : "Refreshing universe…"} onCancel={cancelOperation} />

      <div className="flex flex-1 overflow-hidden min-h-0">
        {currentView === 'screener' && (
          <Sidebar
            filters={filters}
            setFilters={setFilters}
            stocks={stocks}
            onAddTicker={addTicker}
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
          {currentView === 'deep-research' ? (
            <DeepResearchPage
              symbol={researchSymbol}
              stocks={stocks}
              onSelectSymbol={(sym) => openDeepResearch(sym)}
              row={
                researchSymbol
                  ? filtered.find((r) => r.symbol === researchSymbol) ||
                    stocks.find((r) => r.symbol === researchSymbol) ||
                    { symbol: researchSymbol }
                  : null
              }
              onRegather={(sym) =>
                regatherSymbol(sym, () => setDetailReloadToken((t) => t + 1))
              }
              regathering={enrichLoading}
              detail={researchDetail}
              onBack={() => setCurrentView('screener')}
              onAskOri={(sym) => {
                chat.setIsOpen(true);
                chat.askAboutStock(sym);
              }}
            />
          ) : currentView === 'portfolio-goals' ? (
            <PortfolioGoalsPage
              stocks={stocks}
              theme={theme}
              onSelectStock={handleSelectStock}
              detailStock={detailStock}
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

                <span className="text-xs text-gray-600 whitespace-nowrap">
                  {filtered.length} / {stocks.length}
                </span>

                <button
                  onClick={copyTickers}
                  className="shrink-0 p-1.5 rounded-md bg-gray-900 border border-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
                  title="Copy the top on-screen tickers to the clipboard (to paste into another LLM)"
                >
                  {copiedTickers ? <CheckIcon className="w-4 h-4 text-emerald-400" /> : <ClipboardIcon className="w-4 h-4" />}
                </button>

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

                <WeightsPopover weights={weights} setWeights={setWeights} />
              </div>

              {/* Controls bar — compact (< lg) */}
              <div className="flex lg:hidden flex-col gap-2 px-3 py-2 border-b border-gray-800 bg-gray-950 shrink-0">
                <div className="flex items-center gap-2 bg-gray-900 border border-gray-800 rounded-lg px-3 py-2">
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
                <div className="flex-1 min-h-0 overflow-hidden overscroll-contain" style={{ height: '100%' }}>
                  <StockTable
                    rows={filtered}
                    heatRows={filteredRows}
                    pins={pins}
                    onTogglePin={togglePin}
                    onAskAI={chat.askAboutStock}
                    onSelectStock={handleSelectStock}
                    enrichLoading={enrichLoading}
                    sparklineForceVersion={sparklineForceVersion}
                  />
                </div>
              ) : (
                <div className="flex-1 min-h-0 overflow-auto overscroll-contain" style={{ height: '100%' }}>
                  <ScorecardGrid rows={filtered} onSelectStock={handleSelectStock} pins={pins} onTogglePin={togglePin} />
                </div>
              )}
            </>
          )}
        </div>

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

        {chat.isOpen && (
          <ChatPanel chat={chat} canUseOri={canUseOri} floating={!!(detailStock && detailStock2)} onUpgradeToPro={openUpgradeModal} />
        )}
      </div>

      <Footer news={news} />

      {/* Floating Ori button — a little planet that orbits up into the chat panel
          on open and settles back down from orbit on close. Slides left to clear
          the company detail pane(s) when open. */}
      <AnimatePresence>
        {!chat.isOpen && (
          <m.div
            key="ori-fab"
            className={`fixed bottom-14 z-50 transition-[right] duration-300 ease-out
              ${detailStock2 ? 'right-6 lg:right-[49.5rem]' : detailStock ? 'right-6 lg:right-[25.5rem]' : 'right-6'}`}
            // Open and close are mirror images: the planet orbits in from the
            // upper-right on mount (close) and orbits back out the same way on
            // unmount (open), using the same spring.
            initial={reduceMotion ? false : { opacity: 0, scale: 0.2, x: 70, y: -210, rotate: 40 }}
            animate={{ opacity: 1, scale: 1, x: 0, y: 0, rotate: 0 }}
            exit={reduceMotion ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, scale: 0.2, x: 70, y: -210, rotate: 40 }}
            transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 170, damping: 18, mass: 0.9 }}
          >
            <m.button
              onClick={launchOri}
              whileHover={reduceMotion ? undefined : { scale: 1.1 }}
              whileTap={reduceMotion ? undefined : { scale: 0.92 }}
              animate={reduceMotion ? { y: 0 } : { y: [0, -6, 0] }}
              transition={reduceMotion ? { duration: 0 } : { y: { duration: 3.6, repeat: Infinity, ease: "easeInOut" } }}
              className="group relative grid place-items-center w-16 h-16 cursor-pointer rounded-full
                focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
              title="Ask Ori — your AI analyst"
              aria-label="Ask Ori — open the AI chat"
            >
              {/* Pulsing aura — draws the eye to the button */}
              {!reduceMotion && (
                <m.span
                  aria-hidden="true"
                  className="absolute -inset-1.5 -z-10 rounded-full"
                  style={{ background: "radial-gradient(circle, rgba(129,140,248,0.6) 0%, rgba(129,140,248,0) 70%)" }}
                  animate={{ scale: [1, 1.3, 1], opacity: [0.4, 0.85, 0.4] }}
                  transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
                />
              )}

              {/* Orbital ring (behind the planet) */}
              <svg
                viewBox="0 0 64 64"
                className="absolute inset-0 h-full w-full overflow-visible pointer-events-none"
                fill="none"
              >
                <ellipse
                  cx="32" cy="32" rx="30" ry="8.5"
                  transform="rotate(-22 32 32)"
                  stroke="rgba(165,180,252,0.75)" strokeWidth="2.5"
                />
              </svg>

              {/* Planet sphere with the Ori wordmark on its face */}
              <span
                className="relative grid h-12 w-12 place-items-center rounded-full shadow-lg shadow-indigo-500/40 ring-1 ring-white/25 transition-shadow duration-300 group-hover:shadow-indigo-400/70"
                style={{ background: "radial-gradient(circle at 34% 28%, #e0e7ff 0%, #a5b4fc 30%, #6366f1 62%, #3730a3 100%)" }}
              >
                {/* sphere sheen — light from the upper-left */}
                <span className="absolute left-[18%] top-[16%] h-3.5 w-3.5 rounded-full bg-white/55 blur-[1px]" />
                {/* Ori wordmark with a soft glow */}
                <span
                  className="relative text-[12.5px] font-bold tracking-[0.5px] text-white"
                  style={{
                    fontFamily: '"Space Grotesk", system-ui, sans-serif',
                    textShadow: "0 0 7px rgba(199,210,254,0.85), 0 1px 2px rgba(49,46,129,0.85)",
                  }}
                >
                  Ori
                </span>
              </span>

              {/* Moon orbiting the planet */}
              <m.span
                aria-hidden="true"
                className="absolute left-1/2 top-1/2 h-2.5 w-2.5 rounded-full bg-white shadow ring-1 ring-indigo-400/70"
                style={{ marginLeft: "-5px", marginTop: "-5px" }}
                animate={
                  reduceMotion
                    ? { x: 17, y: -11 }
                    : {
                        x: [28, 23, 5, -16, -28, -23, -5, 16, 28],
                        y: [-11, 0, 11, 16, 11, 0, -11, -16, -11],
                        scale: [0.8, 0.95, 1.15, 1.2, 1.1, 0.95, 0.8, 0.72, 0.8],
                        opacity: [0.75, 0.9, 1, 1, 1, 0.9, 0.75, 0.7, 0.75],
                      }
                }
                transition={reduceMotion ? { duration: 0 } : { duration: 7, repeat: Infinity, ease: "linear" }}
              />

              {/* AI sparkles — twinkle to signal "AI" */}
              {!reduceMotion &&
                [
                  { cls: "right-0.5 top-0", delay: 0, peak: 1 },
                  { cls: "left-1 bottom-1.5", delay: 1.2, peak: 0.75 },
                ].map((sp, i) => (
                  <m.span
                    key={i}
                    aria-hidden="true"
                    className={`absolute ${sp.cls} text-violet-100`}
                    animate={{ scale: [0, sp.peak, 0], opacity: [0, 1, 0], rotate: [0, 90, 0] }}
                    transition={{ duration: 2.2, repeat: Infinity, delay: sp.delay, ease: "easeInOut" }}
                  >
                    <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="currentColor">
                      <path d="M6 0c.4 2.8 1.2 3.6 4 4-2.8.4-3.6 1.2-4 4-.4-2.8-1.2-3.6-4-4 2.8-.4 3.6-1.2 4-4Z" />
                    </svg>
                  </m.span>
                ))}
            </m.button>
          </m.div>
        )}
      </AnimatePresence>

      {showUsersModal && (
        <UsersModal
          onClose={() => setShowUsersModal(false)}
          currentUser={currentUser}
          isAdmin={isAdmin}
          plan={plan}
          mode={usersModalMode}
          onAuthRefresh={onAuthRefresh}
          onUpgradeToPro={() => { setShowUsersModal(false); openUpgradeModal(); }}
        />
      )}

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
              `Compare ${a} and ${b} head-to-head given my current Q/V/G weights — valuation, quality, growth, balance sheet, and which is the better buy right now and why.`,
            );
          }}
        />
      )}

      {showUpgradeModal && (
        <UpgradeModal
          onClose={() => setShowUpgradeModal(false)}
          onSuccess={() => {
            // Server already granted Pro (verified the subscription). Re-read the
            // session so the UI unlocks Ori immediately.
            onAuthRefresh?.();
          }}
        />
      )}
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
const REC_PASSTHROUGH = new Set(["sectors", "industries", "universe", "search", "pinnedOnly", "rule40Only"]);
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

// Price % change over ~N trading days back from the latest close.
// points: [{ date, price }] oldest→newest. The detail chart loads ~5 years of
// dailies, so "1y" must be ~252 trading days back — using the full window here
// previously reported the 5-year change as "1yr" to Ori and the UI.
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
    y1: at(Math.min(252, points.length - 1)),
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
 * sliders. Used in both desktop and mobile controls bars for a consistent,
 * uncluttered experience.
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
              Orizin Score weights
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
