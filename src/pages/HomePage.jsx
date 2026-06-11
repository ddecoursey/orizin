import { useEffect, useState } from "react";
import { LazyMotion, domAnimation, m, useReducedMotion } from "../lib/motion.js";
import OrizinLogo from "../components/OrizinLogo.jsx";
import AuthModal from "../components/AuthModal.jsx";
import { PRO_PRICE_LABEL, PRO_FEATURES, FREE_FEATURES } from "../lib/billing.js";

// ── Orizin landing page ─────────────────────────────────────────────────────
// Shown to signed-out visitors. Hero → stats → features → how it works →
// pricing → closing CTA, with sign-in / create-account / subscribe entry
// points throughout. Motion is subtle (≤300ms, eased, staggered reveals) and
// fully disabled for prefers-reduced-motion users.

const BRAND_FONT = { fontFamily: '"Space Grotesk", system-ui, sans-serif' };

// ── Inline SVG icons (Lucide-style strokes — no emoji per design system) ───
const icon = "w-5 h-5";
const I = {
  filter: (
    <svg viewBox="0 0 24 24" className={icon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M7 12h10M10 18h4" />
    </svg>
  ),
  spark: (
    <svg viewBox="0 0 24 24" className={icon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1M7.7 16.3l-2.1 2.1" />
      <circle cx="12" cy="12" r="3.5" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" className={icon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3M8 11h6M11 8v6" />
    </svg>
  ),
  pie: (
    <svg viewBox="0 0 24 24" className={icon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.2 15.9A10 10 0 1 1 8 2.8" />
      <path d="M22 12A10 10 0 0 0 12 2v10z" />
    </svg>
  ),
  zap: (
    <svg viewBox="0 0 24 24" className={icon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2 3 14h7l-1 8 11-13h-7l1-7z" />
    </svg>
  ),
  layers: (
    <svg viewBox="0 0 24 24" className={icon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 2 9 5-9 5-9-5 9-5z" />
      <path d="m3 12 9 5 9-5M3 17l9 5 9-5" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  ),
  arrow: (
    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14m-6-6 6 6-6 6" />
    </svg>
  ),
};

const FEATURES = [
  {
    icon: I.filter,
    title: "Quant screener with the Orizin Score",
    body: "Rank 8,000+ stocks on a 16-metric scorecard across Quality, Value and Growth — with your own weights, junk-data guards, and 30+ fundamental filters.",
  },
  {
    icon: I.spark,
    title: "Ori — your AI analyst",
    body: "A portfolio-aware analyst that knows your holdings, goals and theses. Ask anything, get cited numbers, apply its filter suggestions with one click.",
    pro: true,
  },
  {
    icon: I.search,
    title: "Deep Research pages",
    body: "Financial statements, SEC filings, DCF valuation, analyst targets, insider trades, executive comp, peers and multi-year growth — one page per stock.",
  },
  {
    icon: I.pie,
    title: "Portfolios, goals & theses",
    body: "Track allocations across accounts, write down your goals and convictions, and have every recommendation framed by what you actually own.",
  },
  {
    icon: I.zap,
    title: "Live data, all session long",
    body: "A market-hours-aware engine keeps the most important quotes fresh every ~30 minutes while the market trades — and stays quiet when it doesn't.",
  },
  {
    icon: I.layers,
    title: "Watchlists, compare & news",
    body: "Pin favorites per screen, compare two stocks head-to-head, scan a live market-news ticker, and copy your shortlist anywhere.",
  },
];

const STEPS = [
  { n: "01", title: "Screen", body: "Filter the universe and rank it with your Q/V/G weights." },
  { n: "02", title: "Research", body: "Open Deep Research and pressure-test the story behind the score." },
  { n: "03", title: "Decide", body: "Ask Ori how it fits your portfolio, goals and theses — then act." },
];

// Static, decorative screener preview for the hero (aria-hidden).
const MOCK_ROWS = [
  { sym: "NBIX", score: 74, up: true, path: "M0 18 L8 15 L16 16 L24 12 L32 13 L40 9 L48 10 L56 6 L64 4" },
  { sym: "PTC", score: 73, up: true, path: "M0 16 L8 17 L16 13 L24 14 L32 10 L40 11 L48 8 L56 9 L64 5" },
  { sym: "DECK", score: 72, up: false, path: "M0 8 L8 6 L16 10 L24 9 L32 13 L40 11 L48 15 L56 13 L64 16" },
  { sym: "NVDA", score: 70, up: true, path: "M0 19 L8 16 L16 17 L24 11 L32 12 L40 7 L48 9 L56 5 L64 3" },
];

function ScoreBar({ value }) {
  const color = value >= 70 ? "#10b981" : value >= 45 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-bold tabular-nums" style={{ color }}>{value}</span>
      <div className="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${value}%`, background: color }} />
      </div>
    </div>
  );
}

export default function HomePage({ onAuthed }) {
  const reduce = useReducedMotion();
  const [auth, setAuth] = useState({ open: false, mode: "login" });

  useEffect(() => {
    document.title = "Orizin — AI-powered stock screener & research";
  }, []);

  const openLogin = () => setAuth({ open: true, mode: "login" });
  const openSignup = () => setAuth({ open: true, mode: "signup" });

  // Shared motion presets (≤0.5s, eased; identity transforms when reduced).
  const fadeUp = {
    hidden: reduce ? { opacity: 0 } : { opacity: 0, y: 24 },
    show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
  };
  const stagger = {
    hidden: {},
    show: { transition: { staggerChildren: 0.08 } },
  };
  const inView = { once: true, margin: "-80px" };

  const primaryBtn =
    "inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white cursor-pointer " +
    "bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-500 hover:brightness-110 hover:shadow-blue-500/30 " +
    "shadow-lg shadow-blue-500/20 transition-all duration-200 " +
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400";
  const ghostBtn =
    "inline-flex items-center justify-center px-4 py-2 rounded-lg text-sm font-medium text-gray-300 cursor-pointer " +
    "border border-gray-700 hover:border-gray-500 hover:text-white hover:bg-gray-800/50 transition-all duration-200 " +
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400";

  return (
    <LazyMotion features={domAnimation} strict>
    <div className="min-h-screen bg-gray-950 text-gray-100 overflow-x-hidden">
      {/* ── Nav ───────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 border-b border-gray-800/60 bg-gray-950/80 backdrop-blur-xl">
        <nav className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-6">
          <a href="#top" className="flex items-center gap-2.5 shrink-0">
            <OrizinLogo className="w-6 h-6" />
            <span className="text-white text-lg tracking-tight" style={{ ...BRAND_FONT, fontWeight: 600 }}>
              Orizin
            </span>
          </a>
          <div className="hidden md:flex items-center gap-1 text-sm">
            {[["#features", "Features"], ["#how", "How it works"], ["#pricing", "Pricing"]].map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="px-3 py-1.5 rounded-md text-gray-400 hover:text-gray-100 hover:bg-gray-800/60 transition-colors duration-200"
              >
                {label}
              </a>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={openLogin} className={ghostBtn}>Sign in</button>
            <button onClick={openSignup} className={primaryBtn + " hidden sm:inline-flex"}>
              Get started free
            </button>
          </div>
        </nav>
      </header>

      <main id="top">
        {/* ── Hero ────────────────────────────────────────────────────────── */}
        <section className="relative">
          {/* Ambient gradient field — slow, subtle, GPU-cheap */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
            <m.div
              className="absolute -top-48 left-1/2 -translate-x-1/2 w-[52rem] h-[52rem] rounded-full
                bg-gradient-to-br from-blue-600/20 via-indigo-600/10 to-violet-600/15 blur-3xl"
              animate={reduce ? undefined : { scale: [1, 1.06, 1], opacity: [0.8, 1, 0.8] }}
              transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
            />
            <m.div
              className="absolute top-1/3 -right-40 w-[30rem] h-[30rem] rounded-full bg-violet-600/10 blur-3xl"
              animate={reduce ? undefined : { y: [0, -24, 0] }}
              transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
            />
            {/* Faint grid for structure */}
            <div
              className="absolute inset-0 opacity-[0.04]"
              style={{
                backgroundImage:
                  "linear-gradient(to right, #94a3b8 1px, transparent 1px), linear-gradient(to bottom, #94a3b8 1px, transparent 1px)",
                backgroundSize: "56px 56px",
                maskImage: "radial-gradient(ellipse 80% 60% at 50% 20%, black, transparent)",
              }}
            />
          </div>

          <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-16 pb-20 lg:pt-24 lg:pb-28 grid lg:grid-cols-[1.05fr_0.95fr] gap-12 lg:gap-10 items-center">
            <m.div variants={stagger} initial="hidden" animate="show">
              <m.div variants={fadeUp} className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-gray-700/80 bg-gray-900/60 text-[11px] text-gray-400 mb-6">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Live market data through every trading session
              </m.div>

              <m.h1
                variants={fadeUp}
                className="text-4xl sm:text-5xl lg:text-[3.4rem] leading-[1.08] tracking-tight text-white mb-5"
                style={{ ...BRAND_FONT, fontWeight: 700 }}
              >
                Find stocks worth owning,{" "}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-indigo-400 to-violet-400">
                  not just stocks that screen well.
                </span>
              </m.h1>

              <m.p variants={fadeUp} className="text-base sm:text-lg text-gray-400 leading-relaxed max-w-xl mb-8">
                Orizin ranks the market on a 16-metric Quality · Value · Growth scorecard,
                guards against junk data, and pairs it with Ori — an AI analyst that knows
                your portfolio, your goals, and your theses.
              </m.p>

              <m.div variants={fadeUp} className="flex flex-wrap items-center gap-3">
                <button onClick={openSignup} className={primaryBtn + " px-6 py-3"}>
                  Get started free {I.arrow}
                </button>
                <a href="#pricing" className={ghostBtn + " px-5 py-3"}>
                  See pricing
                </a>
              </m.div>

              <m.p variants={fadeUp} className="text-[11px] text-gray-600 mt-4">
                Free forever for screening &amp; research · No card required
              </m.p>
            </m.div>

            {/* Product preview — stylized screener card + Ori insight */}
            <m.div
              className="relative"
              aria-hidden="true"
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 32 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="rounded-2xl border border-gray-700/70 bg-gray-900/70 backdrop-blur-xl shadow-2xl shadow-black/50 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-gray-700" />
                    <span className="w-2.5 h-2.5 rounded-full bg-gray-700" />
                    <span className="text-xs text-gray-500 ml-2">Orizin Screener</span>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">
                    Q 35 · V 35 · G 30
                  </span>
                </div>
                <div className="px-4 py-2">
                  <div className="grid grid-cols-[64px_1fr_88px_96px] items-center gap-3 py-1.5 text-[10px] uppercase tracking-wider text-gray-600">
                    <span>Symbol</span><span>Trend</span><span className="text-right">Coverage</span><span className="text-right">Score</span>
                  </div>
                  {MOCK_ROWS.map((r, i) => (
                    <m.div
                      key={r.sym}
                      className="grid grid-cols-[64px_1fr_88px_96px] items-center gap-3 py-2.5 border-t border-gray-800/60"
                      initial={reduce ? { opacity: 0 } : { opacity: 0, x: 16 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.4, delay: 0.35 + i * 0.1, ease: "easeOut" }}
                    >
                      <span className="text-sm font-bold text-gray-100">{r.sym}</span>
                      <svg viewBox="0 0 64 22" className="w-full max-w-[120px] h-[22px]">
                        <path d={r.path} fill="none" stroke={r.up ? "#22c55e" : "#ef4444"} strokeWidth="1.6" strokeLinecap="round" />
                      </svg>
                      <span className="text-right text-[11px] text-gray-500 tabular-nums">100%</span>
                      <div className="flex justify-end"><ScoreBar value={r.score} /></div>
                    </m.div>
                  ))}
                </div>
              </div>

              {/* Ori insight card overlapping the screener */}
              <m.div
                className="absolute -bottom-8 -left-3 sm:-left-8 max-w-[280px] rounded-xl border border-violet-800/50
                  bg-gray-900/90 backdrop-blur-xl p-3.5 shadow-xl shadow-violet-950/40"
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.8, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center text-[9px] font-bold text-white" style={BRAND_FONT}>
                    Ori
                  </span>
                  <span className="text-[10px] text-gray-500">AI analyst · Pro</span>
                </div>
                <p className="text-[11px] text-gray-300 leading-snug">
                  NBIX scores 74 with full data coverage — strong ROIC and clean balance
                  sheet, but you're already 18% biotech. Want lower-overlap ideas?
                </p>
              </m.div>
            </m.div>
          </div>
        </section>

        {/* ── Stats strip ─────────────────────────────────────────────────── */}
        <section className="border-y border-gray-800/60 bg-gray-900/30">
          <m.div
            className="max-w-6xl mx-auto px-4 sm:px-6 py-8 grid grid-cols-2 md:grid-cols-4 gap-6"
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={inView}
          >
            {[
              ["8,000+", "stocks & ETFs ranked"],
              ["16", "metrics per scorecard"],
              ["~30 min", "quote freshness, market hours"],
              ["1", "AI analyst on your side"],
            ].map(([big, small]) => (
              <m.div key={small} variants={fadeUp} className="text-center">
                <div className="text-2xl sm:text-3xl text-white tabular-nums" style={{ ...BRAND_FONT, fontWeight: 700 }}>{big}</div>
                <div className="text-xs text-gray-500 mt-1">{small}</div>
              </m.div>
            ))}
          </m.div>
        </section>

        {/* ── Features ────────────────────────────────────────────────────── */}
        <section id="features" className="max-w-6xl mx-auto px-4 sm:px-6 py-20 lg:py-24 scroll-mt-14">
          <m.div variants={stagger} initial="hidden" whileInView="show" viewport={inView} className="text-center mb-12">
            <m.h2 variants={fadeUp} className="text-3xl sm:text-4xl text-white tracking-tight mb-3" style={{ ...BRAND_FONT, fontWeight: 700 }}>
              Everything between idea and conviction
            </m.h2>
            <m.p variants={fadeUp} className="text-gray-400 max-w-2xl mx-auto">
              One workspace for screening, research, and portfolio thinking — built so the
              numbers you act on are fresh, complete, and honest.
            </m.p>
          </m.div>

          <m.div
            className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4"
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={inView}
          >
            {FEATURES.map((f) => (
              <m.div
                key={f.title}
                variants={fadeUp}
                whileHover={reduce ? undefined : { y: -4 }}
                transition={{ duration: 0.2 }}
                className="group rounded-2xl border border-gray-800 bg-gray-900/50 p-5 hover:border-gray-600 hover:bg-gray-900/80 transition-colors duration-200"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500/15 to-violet-500/15 border border-blue-800/40 flex items-center justify-center text-blue-300">
                    {f.icon}
                  </div>
                  {f.pro && (
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-violet-900/60 text-violet-300 border border-violet-800/50">
                      PRO
                    </span>
                  )}
                </div>
                <h3 className="text-sm font-semibold text-gray-100 mb-1.5">{f.title}</h3>
                <p className="text-[13px] text-gray-400 leading-relaxed">{f.body}</p>
              </m.div>
            ))}
          </m.div>
        </section>

        {/* ── How it works ────────────────────────────────────────────────── */}
        <section id="how" className="border-y border-gray-800/60 bg-gray-900/30 scroll-mt-14">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20">
            <m.div variants={stagger} initial="hidden" whileInView="show" viewport={inView} className="grid md:grid-cols-3 gap-8">
              {STEPS.map((s) => (
                <m.div key={s.n} variants={fadeUp} className="relative">
                  <div className="text-5xl font-black text-gray-800/80 mb-2 select-none" style={BRAND_FONT}>{s.n}</div>
                  <h3 className="text-base font-semibold text-gray-100 mb-1.5">{s.title}</h3>
                  <p className="text-sm text-gray-400 leading-relaxed">{s.body}</p>
                </m.div>
              ))}
            </m.div>
          </div>
        </section>

        {/* ── Pricing ─────────────────────────────────────────────────────── */}
        <section id="pricing" className="max-w-5xl mx-auto px-4 sm:px-6 py-20 lg:py-24 scroll-mt-14">
          <m.div variants={stagger} initial="hidden" whileInView="show" viewport={inView} className="text-center mb-12">
            <m.h2 variants={fadeUp} className="text-3xl sm:text-4xl text-white tracking-tight mb-3" style={{ ...BRAND_FONT, fontWeight: 700 }}>
              Simple pricing
            </m.h2>
            <m.p variants={fadeUp} className="text-gray-400">
              Screen and research free, forever. Add Ori when you want an analyst in the room.
            </m.p>
          </m.div>

          <m.div
            className="grid md:grid-cols-2 gap-5 max-w-3xl mx-auto items-stretch"
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={inView}
          >
            {/* Free */}
            <m.div variants={fadeUp} className="rounded-2xl border border-gray-800 bg-gray-900/50 p-6 flex flex-col">
              <h3 className="text-sm font-semibold text-gray-300 mb-1">Free</h3>
              <div className="flex items-baseline gap-1 mb-4">
                <span className="text-4xl text-white" style={{ ...BRAND_FONT, fontWeight: 700 }}>$0</span>
                <span className="text-sm text-gray-500">/ forever</span>
              </div>
              <ul className="space-y-2.5 mb-6">
                {FREE_FEATURES.map((feat) => (
                  <li key={feat} className="flex items-start gap-2 text-[13px] text-gray-300">
                    <span className="text-emerald-400 mt-0.5 shrink-0">{I.check}</span>
                    {feat}
                  </li>
                ))}
              </ul>
              <button onClick={openSignup} className={ghostBtn + " w-full mt-auto py-2.5"}>
                Create free account
              </button>
            </m.div>

            {/* Pro */}
            <m.div
              variants={fadeUp}
              className="relative rounded-2xl border border-violet-700/60 bg-gradient-to-b from-violet-950/40 to-gray-900/60 p-6 flex flex-col shadow-xl shadow-violet-950/30"
            >
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] font-bold px-3 py-1 rounded-full bg-gradient-to-r from-blue-500 to-violet-500 text-white shadow-lg shadow-violet-500/30">
                UNLOCKS ORI
              </span>
              <h3 className="text-sm font-semibold text-violet-300 mb-1">Pro</h3>
              <div className="flex items-baseline gap-1 mb-4">
                <span className="text-4xl text-white" style={{ ...BRAND_FONT, fontWeight: 700 }}>$10</span>
                <span className="text-sm text-gray-500">/ month</span>
              </div>
              <ul className="space-y-2.5 mb-2">
                {PRO_FEATURES.map((feat) => (
                  <li key={feat} className="flex items-start gap-2 text-[13px] text-gray-200">
                    <span className="text-violet-400 mt-0.5 shrink-0">{I.check}</span>
                    {feat}
                  </li>
                ))}
                <li className="flex items-start gap-2 text-[13px] text-gray-400">
                  <span className="text-violet-400/60 mt-0.5 shrink-0">{I.check}</span>
                  Everything in Free
                </li>
              </ul>
              <p className="text-[11px] text-gray-500 leading-snug mb-5">
                Subscribe in two steps: create your account, then upgrade from Account
                Settings ({PRO_PRICE_LABEL}, PayPal). Activated personally — usually within a day.
              </p>
              <button onClick={openSignup} className={primaryBtn + " w-full mt-auto py-2.5"}>
                Start with Pro {I.arrow}
              </button>
            </m.div>
          </m.div>
        </section>

        {/* ── Closing CTA ─────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden border-t border-gray-800/60">
          <div className="pointer-events-none absolute inset-0" aria-hidden="true">
            <div className="absolute -bottom-32 left-1/2 -translate-x-1/2 w-[40rem] h-[24rem] rounded-full bg-gradient-to-t from-blue-600/15 to-violet-600/10 blur-3xl" />
          </div>
          <m.div
            className="relative max-w-3xl mx-auto px-4 sm:px-6 py-20 text-center"
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={inView}
          >
            <m.h2 variants={fadeUp} className="text-3xl sm:text-4xl text-white tracking-tight mb-4" style={{ ...BRAND_FONT, fontWeight: 700 }}>
              The market is open. Are your numbers fresh?
            </m.h2>
            <m.p variants={fadeUp} className="text-gray-400 mb-8">
              Join Orizin free and see today's highest-conviction scorecards in minutes.
            </m.p>
            <m.div variants={fadeUp} className="flex flex-wrap justify-center gap-3">
              <button onClick={openSignup} className={primaryBtn + " px-7 py-3"}>
                Get started free {I.arrow}
              </button>
              <button onClick={openLogin} className={ghostBtn + " px-6 py-3"}>
                Sign in
              </button>
            </m.div>
          </m.div>
        </section>
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="border-t border-gray-800/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row items-center gap-3 text-[11px] text-gray-600">
          <div className="flex items-center gap-2">
            <OrizinLogo className="w-4 h-4" />
            <span>© {new Date().getFullYear()} Orizin™ · All rights reserved</span>
          </div>
          <span className="sm:ml-auto text-center">
            For informational purposes only — not financial advice.
          </span>
        </div>
      </footer>

      <AuthModal
        open={auth.open}
        initialMode={auth.mode}
        onClose={() => setAuth((a) => ({ ...a, open: false }))}
        onSuccess={onAuthed}
      />
    </div>
    </LazyMotion>
  );
}
