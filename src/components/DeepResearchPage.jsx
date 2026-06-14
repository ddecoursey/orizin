import { useEffect, useMemo, useRef } from "react";
import { fmt } from "../lib/format.js";
import { SECTOR_COLORS } from "../lib/scoring.js";
import { IconResearch, IconRefresh } from "./icons.jsx";
import GlobalSearch from "./GlobalSearch.jsx";
import { PriceChart, StockNewsList } from "./StockDetailModal.jsx";
import { useDeepResearch } from "../hooks/useDeepResearch.js";
import { computeFit } from "../lib/fitScore.js";
import { computeVerdict, mergeOriIntoVerdict, metricTone } from "../lib/verdict.js";
import { useGamePlanOri } from "../hooks/useGamePlanOri.js";
import GamePlan from "./GamePlan.jsx";
import RatingsSnapshot from "./RatingsSnapshot.jsx";
import InfoHint from "./InfoHint.jsx";

// Compact period-columns table for financial statements: one row per line
// item, one column per fiscal year (newest first, up to `maxCols`).
function StatementTable({ periods, lines, maxCols = 4 }) {
  const cols = (periods || []).slice(0, maxCols);
  if (!cols.length) return null;
  const yearOf = (p) => p.fiscalYear || (p.date ? String(p.date).slice(0, 4) : "—");
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-gray-500">
            <th className="text-left font-medium py-1 pr-2"> </th>
            {cols.map((p, i) => (
              <th key={i} className="text-right font-semibold py-1 pl-3 whitespace-nowrap">{yearOf(p)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map(([label, key, type]) => (
            <tr key={key} className="border-t border-gray-800/50">
              <td className="py-1.5 pr-2 text-gray-500 whitespace-nowrap">{label}</td>
              {cols.map((p, i) => {
                const v = p[key];
                const f = fmt(v, type);
                const neg = typeof v === "number" && v < 0;
                return (
                  <td key={i} className={`py-1.5 pl-3 text-right font-mono whitespace-nowrap ${neg ? "text-red-400" : "text-gray-200"}`}>
                    {f ?? <span className="text-gray-600">—</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const FORM_COLORS = {
  "10-K": "bg-violet-900/50 text-violet-300",
  "10-Q": "bg-blue-900/50 text-blue-300",
  "8-K": "bg-amber-900/50 text-amber-300",
  "4": "bg-gray-800 text-gray-400",
};

// ─────────────────────────────────────────────────────────────────────────────
// Deep Research — a comprehensive, single-stock research surface. This is the
// long-term home for far more data per symbol than the quick overview pane.
//
// For now this is primarily a LAYOUT scaffold: the sections are organized by the
// data-priority tiers we're rolling out. Panels that already have data (profile,
// key metrics, ratios, DCF, price targets, insider) render it; the rest show a
// clearly-labeled "coming soon" placeholder so the structure is visible while we
// wire the remaining FMP endpoints over time.
// ─────────────────────────────────────────────────────────────────────────────

function Panel({ title, tier, children, span = 1, soon = false }) {
  return (
    <section
      className={`bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col transition-colors duration-200 hover:border-gray-700/80 ${
        span === 2 ? "md:col-span-2" : ""
      } ${span === 3 ? "md:col-span-2 xl:col-span-3" : ""}`}
    >
      <header className="flex items-center justify-between mb-3 shrink-0">
        <h3 className="text-[11px] uppercase tracking-wider font-bold text-gray-400">{title}</h3>
        <div className="flex items-center gap-1.5">
          {soon && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-800 text-gray-500 border border-gray-700">
              coming soon
            </span>
          )}
          {tier && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-950/50 text-violet-300/80 border border-violet-900/50">
              {tier}
            </span>
          )}
        </div>
      </header>
      <div className="flex-1 min-h-0">{children}</div>
    </section>
  );
}

const TONE_TEXT = { good: "text-emerald-400", ok: "text-amber-400", bad: "text-red-400", neutral: "text-gray-200" };
const TONE_DOT = { good: "bg-emerald-400", ok: "bg-amber-400", bad: "bg-red-400" };

// A labeled metric. Pass `metric` (a rubric key) to color the value Good/OK/Bad
// for beginners; an explicit `accent` always wins (used where a panel sets its
// own emphasis, e.g. DCF margin of safety).
function Stat({ label, value, type, accent, metric }) {
  const f = type ? fmt(value, type) : value;
  const tone = metric && value != null ? metricTone(metric, value) : "neutral";
  const colorCls = accent || (tone !== "neutral" ? TONE_TEXT[tone] : "text-gray-200");
  return (
    <div className="flex justify-between items-baseline py-1.5 border-b border-gray-800/50 gap-3">
      <span className="text-[11px] text-gray-500 shrink-0">{label}</span>
      <span className={`text-xs font-semibold font-mono text-right flex items-center gap-1.5 justify-end ${colorCls}`}>
        {tone !== "neutral" && TONE_DOT[tone] && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TONE_DOT[tone]}`} />}
        {f ?? <span className="text-gray-600">—</span>}
      </span>
    </div>
  );
}

function Placeholder({ note }) {
  return (
    <div className="h-full min-h-[80px] flex items-center justify-center text-center">
      <p className="text-[11px] text-gray-600 max-w-[240px] leading-relaxed">{note}</p>
    </div>
  );
}

function StatGrid({ children }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">{children}</div>;
}

// ── Technical signal helpers (Deep Research "Technical Analysis" panel) ──────
function maSignal(price, ma) {
  if (ma == null) return { value: null };
  const value = `$${ma.toFixed(2)}`;
  if (price == null) return { value };
  const pct = ((price - ma) / ma) * 100;
  return { value, signal: `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`, tone: price >= ma ? "up" : "down" };
}
// Current 50-vs-200 trend regime (the golden/death cross *events* are shown
// interactively on the price chart; this row just states which side we're on now).
function trendRow(sma50, sma200) {
  if (sma50 == null || sma200 == null) return { value: null };
  const bull = sma50 >= sma200;
  return {
    value: bull ? "Bullish" : "Bearish",
    signal: bull ? "50 > 200" : "50 < 200",
    tone: bull ? "up" : "down",
  };
}
function rsiSignal(rsi) {
  if (rsi == null) return { value: null };
  const v = Math.round(rsi);
  if (rsi >= 70) return { value: v, signal: "overbought", tone: "down" };
  if (rsi <= 30) return { value: v, signal: "oversold", tone: "up" };
  return { value: v, signal: "neutral", tone: "gray" };
}
function williamsSignal(w) {
  if (w == null) return { value: null };
  const v = Math.round(w);
  if (w >= -20) return { value: v, signal: "overbought", tone: "down" };
  if (w <= -80) return { value: v, signal: "oversold", tone: "up" };
  return { value: v, signal: "neutral", tone: "gray" };
}
function adxSignal(adx) {
  if (adx == null) return { value: null };
  const v = Math.round(adx);
  if (adx >= 25) return { value: v, signal: "strong trend", tone: "warn" };
  if (adx < 20) return { value: v, signal: "ranging", tone: "gray" };
  return { value: v, signal: "developing", tone: "gray" };
}
function volSignal(stdDev, price) {
  if (stdDev == null) return { value: null };
  if (!price) return { value: stdDev.toFixed(2) };
  const pct = (stdDev / price) * 100;
  return { value: `${pct.toFixed(1)}%`, signal: pct >= 4 ? "high" : pct <= 1.5 ? "low" : "moderate", tone: pct >= 4 ? "warn" : "gray" };
}

function SigRow({ label, value, signal, tone = "gray" }) {
  const toneCls =
    tone === "up" ? "text-emerald-400" : tone === "down" ? "text-red-400" : tone === "warn" ? "text-amber-400" : "text-gray-400";
  return (
    <div className="flex justify-between items-baseline py-1.5 border-b border-gray-800/50 gap-3">
      <span className="text-[11px] text-gray-500 shrink-0">{label}</span>
      <span className="text-right whitespace-nowrap">
        <span className="text-xs font-semibold font-mono text-gray-200">{value ?? <span className="text-gray-600">—</span>}</span>
        {signal && <span className={`ml-1.5 text-[10px] font-semibold ${toneCls}`}>{signal}</span>}
      </span>
    </div>
  );
}

// ── Earnings date helpers ───────────────────────────────────────────────────
function fmtEarnDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function daysUntil(d) {
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  const diff = Math.round((dt - new Date()) / 86400000);
  if (diff === 0) return "today";
  return diff > 0 ? `in ${diff}d` : `${-diff}d ago`;
}

// ── Smart Money signal styling ──────────────────────────────────────────────
function smTone(signal) {
  if (signal === "buying") return "bg-emerald-900/40 text-emerald-300 border border-emerald-800/50";
  if (signal === "selling") return "bg-red-900/40 text-red-300 border border-red-800/50";
  if (signal === "mixed") return "bg-amber-900/40 text-amber-300 border border-amber-800/50";
  return "bg-gray-800 text-gray-400 border border-gray-700";
}
function smLabel(signal) {
  return signal === "buying" ? "Net Buying" : signal === "selling" ? "Net Selling" : signal === "mixed" ? "Mixed" : "Quiet";
}

export default function DeepResearchPage({ symbol, row, onBack, onAskOri, stocks = [], onSelectSymbol, onRegather, regathering = false, detail = {}, fitCtx = null, risk = "balanced", onConvictionChange }) {
  // Personalized fit (portfolio / theses / goals). Cheap — one stock.
  const fit = computeFit(row || { symbol }, fitCtx);

  // ── Unified Game Plan ──────────────────────────────────────────────────────
  // Deterministic core (instant): folds the Orizin Score + Fit + technicals +
  // valuation + smart money + analysts into one conviction / horizon / action.
  const deterministic = useMemo(
    () => computeVerdict(row || { symbol }, detail, fit, { risk }),
    [row, symbol, detail, fit, risk],
  );
  // Compact payload Ori's intelligence layer needs (POSTed to the server).
  const oriPayload = useMemo(() => {
    const r = row || {};
    return {
      stats: {
        price: r.price, mcap: r.mcap, sector: r.sector, beta: r.beta,
        pe: r.pe, ps: r.ps, pb: r.pb, fcf_yield: r.fcf_yield, div_yield: r.div_yield,
        roic: r.roic, roe: r.roe, net_margin: r.net_margin, op_margin: r.op_margin,
        gross_margin: r.gross_margin, fcf_margin: r.fcf_margin,
        revenue_growth: r.revenue_growth, eps_growth: r.eps_growth,
        debt_equity: r.debt_equity, net_debt_ebitda: r.net_debt_ebitda,
        dcf: detail.aiData?.dcf ?? null, target: detail.aiData?.target_consensus ?? null,
        orizinScore: r.score != null ? Math.round(r.score * 100) : null,
      },
      verdict: {
        horizon: deterministic.horizon?.label,
        action: deterministic.action?.label,
        conviction: deterministic.conviction,
        durability: deterministic.durability != null ? Math.round(deterministic.durability * 100) : null,
        valuation: deterministic.valuation != null ? Math.round(deterministic.valuation * 100) : null,
        flags: deterministic.flags,
        reasons: (deterministic.reasons || []).map((x) => x.text),
      },
    };
  }, [row, detail, deterministic]);
  const oriPayloadRef = useRef(oriPayload);
  useEffect(() => {
    oriPayloadRef.current = oriPayload;
  }, [oriPayload]);
  // Deferred Ori layer (Pro, cached 24h) — fades in after the deterministic core.
  const oriState = useGamePlanOri(symbol, {
    enabled: !!symbol && !deterministic.insufficient,
    payloadRef: oriPayloadRef,
  });
  // Fold Ori in "within reason" once it arrives; otherwise show the data verdict.
  const verdict = useMemo(
    () => (oriState.ori ? mergeOriIntoVerdict(deterministic, oriState.ori) : deterministic),
    [deterministic, oriState.ori],
  );
  // Lift the refined conviction back to the screener row for this session, so the
  // sharper number (live technicals/grades/insiders/Ori) shows there too.
  useEffect(() => {
    if (symbol && verdict && !verdict.insufficient && Number.isFinite(verdict.conviction)) {
      onConvictionChange?.(symbol, verdict.conviction);
    }
  }, [symbol, verdict, onConvictionChange]);
  // `detail` is owned by App (one useStockDetail instance shared with Ori's context)
  // so a re-gather reloads it once rather than double-fetching from FMP.
  const {
    profile, aiData, insider, news, loadingProfile, loadingNews, points, rsi, loadingChart,
    technicals, loadingTechnicals, earnings, smartMoney: smart,
    ratings, loadingRatings,
  } = detail;

  // Deep-research-only data (statements, filings, comp, peers, growth) — owned
  // here since nothing outside this page needs it. Server caches make
  // re-opening a symbol free.
  const deep = useDeepResearch(symbol);

  // Technicals, earnings, and smart-money now come from `detail` (useStockDetail)
  // so the same data also reaches Ori's context. Derive the display shapes here.
  const earnNext = earnings?.find?.((e) => e.epsActual == null && new Date(e.date) >= new Date(new Date().toDateString())) || null;
  const earnRecent = (earnings || []).filter((e) => e.epsActual != null).slice(0, 4);

  const congressSignal =
    smart && smart.congress && smart.congress.total > 0
      ? smart.congress.buyers > smart.congress.sellers
        ? "buying"
        : smart.congress.sellers > smart.congress.buyers
          ? "selling"
          : "mixed"
      : "quiet";

  const handleSearch = (stock) => {
    if (stock?.symbol) onSelectSymbol?.(stock.symbol);
  };

  if (!symbol) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-500 px-6">
        <div className="text-center mb-5 oz-fade-rise">
          <IconResearch className="w-10 h-10 mx-auto mb-3 text-violet-400/80" />
          <p className="text-sm font-semibold text-gray-300">Deep Research</p>
          <p className="text-xs mt-1 text-gray-500">Search for any stock or ETF to open its in-depth research page.</p>
        </div>
        <div className="w-full max-w-md">
          <GlobalSearch stocks={stocks} onSelect={handleSearch} />
        </div>
      </div>
    );
  }

  const sec = SECTOR_COLORS[row?.sector] || { bg: "#1e293b", fg: "#94a3b8" };
  // Header shows the unified Conviction (from the Game Plan verdict), falling
  // back to the row's lean conviction / Orizin score for arbitrary symbols.
  const sc = verdict?.conviction ?? row?.conviction ?? (row?.score != null ? Math.round(row.score * 100) : null);
  const scoreColor = sc >= 70 ? "#10b981" : sc >= 45 ? "#f59e0b" : "#ef4444";

  // DCF margin of safety vs current price (when both present).
  const dcf = aiData?.dcf ?? null;
  const dcfPrice = aiData?.stock_price ?? row?.price ?? null;
  const mos = dcf != null && dcfPrice ? (dcf - dcfPrice) / dcfPrice : null;

  return (
    <div className="flex-1 overflow-y-auto overscroll-contain bg-gray-950">
      {/* Sticky page header */}
      <div className="sticky top-0 z-10 bg-gray-950 border-b border-gray-800 px-4 sm:px-6 py-3">
        <div className="flex items-center gap-3 flex-wrap gap-y-2">
          <button
            onClick={onBack}
            className="shrink-0 text-xs text-gray-400 hover:text-gray-100 px-2.5 py-1.5 lg:px-2 lg:py-1 rounded-md hover:bg-gray-800 transition-colors cursor-pointer"
            title="Back to screener"
          >
            ← Back
          </button>

          {profile?.image && (
            <img
              src={profile.image}
              alt=""
              className="w-10 h-10 rounded-lg bg-white/5 object-contain shrink-0"
              onError={(e) => (e.currentTarget.style.display = "none")}
            />
          )}

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xl font-black text-gray-100">{symbol}</span>
              <span
                className="inline-block rounded-full px-2 py-0.5 text-[10px] font-medium shrink-0"
                style={{ background: sec.bg, color: sec.fg }}
              >
                {row?.sector || "—"}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-violet-300/80 font-semibold hidden sm:inline">
                · Deep Research
              </span>
            </div>
            <div className="text-xs text-gray-400 truncate">{row?.name || profile?.companyName || ""}</div>
          </div>

          <div className="ml-auto flex items-center gap-2.5 sm:gap-4 shrink-0">
            {/* Switch to another stock without leaving Deep Research */}
            <div className="hidden md:block w-56">
              <GlobalSearch stocks={stocks} onSelect={handleSearch} />
            </div>
            <div className="text-right">
              <div className="text-lg font-bold font-mono text-gray-100">{fmt(row?.price, "price") ?? "—"}</div>
              {sc != null && (
                <div className="text-xs font-semibold" style={{ color: scoreColor }}>
                  Conviction {sc}
                </div>
              )}
            </div>
            {onRegather && (
              <button
                onClick={() => onRegather(symbol)}
                disabled={regathering}
                className="text-xs font-semibold px-3 py-2 lg:py-1.5 rounded-md bg-gray-800 text-gray-200 border border-gray-700 hover:bg-gray-700 transition-all active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1.5 cursor-pointer"
                title="Re-fetch all data for this stock from FMP"
              >
                <IconRefresh className={`w-3.5 h-3.5 ${regathering ? "animate-spin" : ""}`} />
                {regathering ? "Gathering…" : "Re-gather"}
              </button>
            )}
            {onAskOri && (
              <button
                onClick={() => onAskOri(symbol)}
                className="text-xs font-semibold px-3 py-2 lg:py-1.5 rounded-md bg-gradient-to-br from-blue-600/30 to-violet-600/30 text-violet-200 border border-violet-800/50 hover:brightness-125 transition-all active:scale-95 cursor-pointer"
              >
                Ask Ori
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6 space-y-6">
        {/* Beginner Game Plan — the first thing you see: what to do with this stock */}
        <div className="oz-fade-rise">
          <GamePlan verdict={verdict} oriState={oriState} />
        </div>

        {/* Price + RSI chart alongside the company profile, under the name bar */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 oz-fade-rise" style={{ animationDelay: "40ms" }}>
          <section className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-4">
            <h3 className="text-[11px] uppercase tracking-wider font-bold text-gray-400 mb-2">
              Price &amp; RSI
            </h3>
            {loadingChart ? (
              <div className="h-[300px] bg-gray-900/50 rounded-lg animate-pulse" />
            ) : (
              <PriceChart points={points} rsi={rsi} symbol={symbol} height={300} allowIndicators />
            )}
          </section>

          <Panel title="Company Profile" tier="T1" span={1}>
            {loadingProfile ? (
              <Placeholder note="Loading profile…" />
            ) : profile ? (
              <div className="space-y-3">
                <StatGrid>
                  <Stat label="CEO" value={profile.ceo} />
                  <Stat label="Employees" value={profile.fullTimeEmployees} />
                  <Stat label="Exchange" value={profile.exchangeFullName || profile.exchange} />
                  <Stat label="Country" value={profile.country} />
                  <Stat label="IPO Date" value={profile.ipoDate} />
                  <Stat label="52W Range" value={profile.range} />
                </StatGrid>
                {profile.description && (
                  <p className="text-[11px] text-gray-400 leading-relaxed line-clamp-6">
                    {profile.description}
                  </p>
                )}
                {profile.website && (
                  <a
                    href={profile.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-blue-400 hover:text-blue-300"
                  >
                    {profile.website}
                  </a>
                )}
              </div>
            ) : (
              <Placeholder note="No profile data yet — try Gather Data from the header." />
            )}
          </Panel>
        </div>

        {/* ── TIER 1 ─────────────────────────────────────────────────────── */}
        <div className="oz-fade-rise" style={{ animationDelay: "60ms" }}>
          <h2 className="text-xs uppercase tracking-[0.15em] font-bold text-gray-500 mb-3">
            Tier 1 · Valuation & Quality
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <Panel title="Key Metrics (TTM)" tier="T1" span={1}>
              <StatGrid>
                <Stat label="Market Cap" value={row?.mcap} type="money" />
                <Stat label="Enterprise Val" value={row?.ev} type="money" />
                <Stat label="P/E" value={row?.pe} type="x" metric="pe" />
                <Stat label="P/B" value={row?.pb} type="x" metric="pb" />
                <Stat label="P/S" value={row?.ps} type="x" metric="ps" />
                <Stat label="EV/EBITDA" value={row?.ev_ebitda} type="x" metric="ev_ebitda" />
                <Stat label="EV/GP" value={row?.ev_gp} type="x" metric="ev_gp" />
                <Stat label="FCF Yield" value={row?.fcf_yield} type="pct" metric="fcf_yield" />
                <Stat label="Earnings Yield" value={row?.earnings_yield} type="pct" metric="earnings_yield" />
                <Stat label="Dividend Yield" value={row?.div_yield} type="pct" metric="div_yield" />
              </StatGrid>
            </Panel>

            <Panel title="Financial Ratios (TTM)" tier="T1" span={1}>
              <StatGrid>
                <Stat label="ROIC" value={row?.roic} type="pct" metric="roic" />
                <Stat label="ROE" value={row?.roe} type="pct" metric="roe" />
                <Stat label="ROA" value={row?.roa} type="pct" metric="roa" />
                <Stat label="Gross Margin" value={row?.gross_margin} type="pct" metric="gross_margin" />
                <Stat label="Op Margin" value={row?.op_margin} type="pct" metric="op_margin" />
                <Stat label="Net Margin" value={row?.net_margin} type="pct" metric="net_margin" />
                <Stat label="FCF Margin" value={row?.fcf_margin} type="pct" metric="fcf_margin" />
                <Stat label="Current Ratio" value={row?.current_ratio} type="ratio" metric="current_ratio" />
                <Stat label="Debt/Equity" value={row?.debt_equity} type="ratio" metric="debt_equity" />
                <Stat label="Net Debt/EBITDA" value={row?.net_debt_ebitda} type="ratio" metric="net_debt_ebitda" />
              </StatGrid>
            </Panel>

            <Panel title="DCF Valuation" tier="T1" span={1}>
              {dcf != null ? (
                <StatGrid>
                  <Stat label="DCF Fair Value" value={dcf} type="price" accent="text-violet-300" />
                  <Stat label="Current Price" value={dcfPrice} type="price" />
                  <Stat
                    label="Margin of Safety"
                    value={mos != null ? `${(mos * 100).toFixed(1)}%` : null}
                    accent={mos > 0 ? "text-emerald-400" : "text-red-400"}
                  />
                  <Stat label="As of" value={aiData?.dcf_date} />
                  <Stat label="Owner Earnings" value={aiData?.owner_earnings} type="money" />
                  <Stat label="Owner EPS" value={aiData?.owner_eps} type="price" />
                </StatGrid>
              ) : (
                <Placeholder note="DCF not loaded for this symbol yet." />
              )}
            </Panel>

            <Panel title="Technical Analysis" tier="T1" span={1}>
              {!technicals && loadingTechnicals ? (
                <div className="h-full min-h-[80px] flex items-center justify-center text-[11px] text-gray-600">
                  Loading indicators…
                </div>
              ) : technicals && (technicals.sma50 != null || technicals.ema20 != null || technicals.adx != null) ? (
                <div>
                  <SigRow label="Price vs 50-day SMA" {...maSignal(technicals.price, technicals.sma50)} />
                  <SigRow label="Price vs 200-day SMA" {...maSignal(technicals.price, technicals.sma200)} />
                  <SigRow label="Price vs 20-day EMA" {...maSignal(technicals.price, technicals.ema20)} />
                  <SigRow label="Trend (50 vs 200)" {...trendRow(technicals.sma50, technicals.sma200)} />
                  <SigRow label="RSI (14)" {...rsiSignal(technicals.rsi)} />
                  <SigRow label="Williams %R (14)" {...williamsSignal(technicals.williams)} />
                  <SigRow label="ADX (14)" {...adxSignal(technicals.adx)} />
                  <SigRow label="Volatility (20d σ)" {...volSignal(technicals.stdDev, technicals.price)} />
                  {technicals.asOf && (
                    <div className="mt-2 text-[9px] text-gray-600 text-right">as of {technicals.asOf}</div>
                  )}
                </div>
              ) : (
                <Placeholder note="Technical indicators aren't available for this symbol." />
              )}
            </Panel>

            <Panel title="Ratings Snapshot" tier="T1" span={1}>
              {loadingRatings && !ratings ? (
                <Placeholder note="Loading ratings…" />
              ) : ratings ? (
                <RatingsSnapshot ratings={ratings} />
              ) : (
                <Placeholder note={`No ratings available for ${symbol}.`} />
              )}
            </Panel>

          </div>
        </div>

        {/* ── TIER 2 ─────────────────────────────────────────────────────── */}
        <div className="oz-fade-rise" style={{ animationDelay: "120ms" }}>
          <h2 className="text-xs uppercase tracking-[0.15em] font-bold text-gray-500 mb-3">
            Tier 2 · Financial Statements & Estimates
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <Panel title="Earnings" tier="T2">
              {earnings === null ? (
                <Placeholder note="Loading earnings…" />
              ) : !earnings.length ? (
                <Placeholder note="No earnings data for this symbol." />
              ) : (
                <div>
                  {earnNext && (
                    <div className="mb-3 rounded-lg border border-blue-900/40 bg-blue-950/30 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-wider text-blue-300/80">Next report</div>
                      <div className="text-sm font-semibold text-gray-100">
                        {fmtEarnDate(earnNext.date)}
                        {daysUntil(earnNext.date) && (
                          <span className="ml-1.5 text-[11px] font-normal text-gray-500">{daysUntil(earnNext.date)}</span>
                        )}
                      </div>
                      {earnNext.epsEstimated != null && (
                        <div className="text-[11px] text-gray-500">Est. EPS ${earnNext.epsEstimated.toFixed(2)}</div>
                      )}
                    </div>
                  )}
                  {earnRecent.length > 0 && (
                    <>
                      <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Recent · EPS act / est</div>
                      {earnRecent.map((e) => {
                        const beat = e.epsActual >= e.epsEstimated;
                        const pct = e.epsEstimated ? ((e.epsActual - e.epsEstimated) / Math.abs(e.epsEstimated)) * 100 : null;
                        return (
                          <div key={e.date} className="flex justify-between items-baseline py-1.5 border-b border-gray-800/50 gap-3">
                            <span className="text-[11px] text-gray-500 shrink-0">{fmtEarnDate(e.date)}</span>
                            <span className="text-right whitespace-nowrap text-xs font-mono">
                              <span className="text-gray-200">${e.epsActual.toFixed(2)}</span>
                              <span className="text-gray-600"> / {e.epsEstimated != null ? `$${e.epsEstimated.toFixed(2)}` : "—"}</span>
                              {pct != null && (
                                <span className={`ml-1.5 text-[10px] font-semibold ${beat ? "text-emerald-400" : "text-red-400"}`}>
                                  {beat ? "beat" : "miss"} {pct >= 0 ? "+" : ""}{pct.toFixed(0)}%
                                </span>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              )}
            </Panel>

            <Panel title="Income Statement (annual)" tier="T2">
              {deep.loadingStatements ? (
                <Placeholder note="Loading income statement…" />
              ) : deep.statements?.income?.length ? (
                <StatementTable
                  periods={deep.statements.income}
                  lines={[
                    ["Revenue", "revenue", "money"],
                    ["Gross Profit", "gross_profit", "money"],
                    ["Op Income", "operating_income", "money"],
                    ["EBITDA", "ebitda", "money"],
                    ["Net Income", "net_income", "money"],
                    ["EPS (dil.)", "eps", "ratio"],
                  ]}
                />
              ) : (
                <Placeholder note="No income statement data available for this symbol." />
              )}
            </Panel>

            <Panel title="Balance Sheet (annual)" tier="T2">
              {deep.loadingStatements ? (
                <Placeholder note="Loading balance sheet…" />
              ) : deep.statements?.balance?.length ? (
                <StatementTable
                  periods={deep.statements.balance}
                  lines={[
                    ["Cash & ST Inv", "cash_and_st_investments", "money"],
                    ["Total Assets", "total_assets", "money"],
                    ["Total Debt", "total_debt", "money"],
                    ["Net Debt", "net_debt", "money"],
                    ["Liabilities", "total_liabilities", "money"],
                    ["Equity", "total_equity", "money"],
                  ]}
                />
              ) : (
                <Placeholder note="No balance sheet data available for this symbol." />
              )}
            </Panel>

            <Panel title="Cash Flow (annual)" tier="T2">
              {deep.loadingStatements ? (
                <Placeholder note="Loading cash flow statement…" />
              ) : deep.statements?.cashflow?.length ? (
                <StatementTable
                  periods={deep.statements.cashflow}
                  lines={[
                    ["Operating CF", "operating_cash_flow", "money"],
                    ["CapEx", "capex", "money"],
                    ["Free Cash Flow", "free_cash_flow", "money"],
                    ["Dividends Paid", "dividends_paid", "money"],
                    ["Net Δ Cash", "net_change_in_cash", "money"],
                  ]}
                />
              ) : (
                <Placeholder note="No cash flow data available for this symbol." />
              )}
            </Panel>

            <Panel title="Price Target Consensus" tier="T2" span={1}>
              {aiData?.target_consensus != null || aiData?.target_high != null ? (
                <StatGrid>
                  <Stat label="Consensus" value={aiData?.target_consensus} type="price" accent="text-violet-300" />
                  <Stat label="Median" value={aiData?.target_median} type="price" />
                  <Stat label="High" value={aiData?.target_high} type="price" accent="text-emerald-400" />
                  <Stat label="Low" value={aiData?.target_low} type="price" accent="text-red-400" />
                  <Stat label="Current Price" value={row?.price} type="price" />
                </StatGrid>
              ) : (
                <Placeholder note="Analyst price targets not loaded for this symbol yet." />
              )}
            </Panel>

            <Panel title="Latest SEC Filings" tier="T2" span={2}>
              {deep.loadingFilings ? (
                <Placeholder note="Loading SEC filings…" />
              ) : deep.filings?.length ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 max-h-56 overflow-y-auto">
                  {deep.filings.slice(0, 14).map((f, i) => (
                    <div key={i} className="flex items-center gap-2 py-1.5 border-b border-gray-800/50 text-[11px]">
                      <span className="text-gray-500 font-mono w-[74px] shrink-0">{f.date || "—"}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 ${FORM_COLORS[f.form] || "bg-gray-800 text-gray-400"}`}>
                        {f.form}
                      </span>
                      {f.link ? (
                        <a href={f.link} target="_blank" rel="noopener noreferrer" className="ml-auto text-blue-400 hover:text-blue-300 shrink-0">
                          View →
                        </a>
                      ) : (
                        <span className="ml-auto text-gray-700">—</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <Placeholder note="No recent SEC filings found for this symbol (foreign issuers may file elsewhere)." />
              )}
            </Panel>
          </div>
        </div>

        {/* ── TIER 3 ─────────────────────────────────────────────────────── */}
        <div className="oz-fade-rise" style={{ animationDelay: "180ms" }}>
          <h2 className="text-xs uppercase tracking-[0.15em] font-bold text-gray-500 mb-3">
            Tier 3 · Ownership, Peers & Growth
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <Panel title="Congressional Trading" tier="T3" span={2}>
              {smart === null ? (
                <div className="h-full min-h-[80px] flex items-center justify-center text-[11px] text-gray-600">Loading…</div>
              ) : !smart.congress || smart.congress.total === 0 ? (
                <Placeholder note="No disclosed congressional trades for this symbol in the last 180 days." />
              ) : (
                <div>
                  <div className="flex items-center gap-3 mb-3 flex-wrap">
                    <span className={`text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded ${smTone(congressSignal)}`}>
                      {smLabel(congressSignal)}
                    </span>
                    <span className="text-[11px] text-gray-400">
                      <span className="text-emerald-400 font-semibold">{smart.congress.buyers} bought</span>
                      <span className="text-gray-600"> · </span>
                      <span className="text-red-400 font-semibold">{smart.congress.sellers} sold</span>
                      <span className="text-gray-600"> · {smart.congress.total} disclosures · 180d</span>
                    </span>
                    <InfoHint text="Trades in this stock disclosed by U.S. Senators and Representatives (periodic transaction reports). Disclosures lag the actual trade by up to ~45 days. An alt-data conviction signal standard screeners don't surface." />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5">
                    {smart.congress.recent.map((t, i) => (
                      <div key={i} className="flex items-baseline justify-between gap-2 py-1 border-b border-gray-800/40">
                        <span className="min-w-0 truncate text-[11px] text-gray-300">
                          {t.name}
                          <span className="ml-1 text-[10px] text-gray-600">{t.chamber === "senate" ? "Sen" : "Rep"}{t.district ? ` · ${t.district}` : ""}</span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className={`text-[10.5px] font-semibold ${t.type === "buy" ? "text-emerald-400" : t.type === "sell" ? "text-red-400" : "text-gray-500"}`}>
                            {t.type === "buy" ? "Buy" : t.type === "sell" ? "Sell" : "—"}
                          </span>
                          {t.amount ? <span className="ml-1 text-[9.5px] text-gray-500">{t.amount}</span> : null}
                          <span className="ml-1 text-[9.5px] text-gray-600">{fmtEarnDate(t.date)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Panel>

            <Panel title="Insider Trading" tier="T3" span={1}>
              {insider?.length ? (
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {insider.slice(0, 12).map((t, i) => {
                    const buy = (t.acquisitionOrDisposition || t.type) === "A";
                    return (
                      <div key={i} className="flex items-center justify-between text-[10px] border-b border-gray-800/50 pb-1">
                        <div className="min-w-0">
                          <div className="text-gray-300 truncate">{t.reportingName || "—"}</div>
                          <div className="text-gray-600">{t.typeOfOwner || ""}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className={buy ? "text-emerald-400" : "text-red-400"}>
                            {buy ? "Buy" : "Sell"}
                          </div>
                          <div className="text-gray-500 font-mono">{t.transactionDate || t.filingDate}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <Placeholder note="No recent insider (Form 4) transactions loaded." />
              )}
            </Panel>

            <Panel title="Executive Compensation" tier="T3" span={1}>
              {deep.loadingExecComp ? (
                <Placeholder note="Loading executive compensation…" />
              ) : deep.execComp?.length ? (
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {deep.execComp.slice(0, 8).map((c, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 text-[10px] border-b border-gray-800/50 pb-1">
                      <div className="min-w-0">
                        <div className="text-gray-300 truncate" title={c.name || ""}>{c.name || "—"}</div>
                        <div className="text-gray-600">{c.year || ""}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-gray-200 font-mono">{fmt(c.total, "money") ?? "—"}</div>
                        <div className="text-gray-600 font-mono">
                          {c.salary != null ? `${fmt(c.salary, "money")} salary` : ""}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Placeholder note="No executive compensation data for this symbol." />
              )}
            </Panel>

            <Panel title="Peer Comparison" tier="T3" span={1}>
              {deep.loadingPeers ? (
                <Placeholder note="Loading peers…" />
              ) : deep.peers?.length ? (
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  <div className="flex items-center text-[9px] uppercase tracking-wider text-gray-600 pb-1">
                    <span className="w-16">Sym</span>
                    <span className="flex-1 text-right">MCap</span>
                    <span className="w-14 text-right">P/E</span>
                    <span className="w-14 text-right">ROIC</span>
                  </div>
                  {deep.peers.slice(0, 10).map((p) => (
                    <button
                      key={p.symbol}
                      onClick={() => onSelectSymbol?.(p.symbol)}
                      className="w-full flex items-center text-[11px] py-1.5 lg:py-1 border-b border-gray-800/50 hover:bg-gray-800/40 rounded transition-colors text-left cursor-pointer"
                      title={p.name || p.symbol}
                    >
                      <span className="w-16 font-bold text-gray-200">{p.symbol}</span>
                      <span className="flex-1 text-right font-mono text-gray-400">{fmt(p.mcap, "money") ?? "—"}</span>
                      <span className="w-14 text-right font-mono text-gray-400">{fmt(p.pe, "x") ?? "—"}</span>
                      <span className="w-14 text-right font-mono text-gray-400">{fmt(p.roic, "pct") ?? "—"}</span>
                    </button>
                  ))}
                  <div className="text-[9px] text-gray-600 pt-1">Click a peer to open its Deep Research page.</div>
                </div>
              ) : (
                <Placeholder note="No peer list available for this symbol." />
              )}
            </Panel>

            <Panel title="Financial Statement Growth" tier="T3" span={3}>
              {deep.loadingGrowth ? (
                <Placeholder note="Loading growth history…" />
              ) : deep.growthHistory?.length ? (
                <StatementTable
                  periods={deep.growthHistory}
                  maxCols={6}
                  lines={[
                    ["Revenue Growth", "revenue_growth", "pct"],
                    ["EPS Growth", "eps_growth", "pct"],
                    ["FCF Growth", "fcf_growth", "pct"],
                    ["Op Income Growth", "op_income_growth", "pct"],
                    ["Net Income Growth", "net_income_growth", "pct"],
                  ]}
                />
              ) : (
                <Placeholder note="No multi-year growth data for this symbol." />
              )}
            </Panel>
          </div>
        </div>

        {/* Recent news — full width at the bottom of the page */}
        <section className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <h3 className="text-[11px] uppercase tracking-wider font-bold text-gray-400 mb-3">Recent News</h3>
          {loadingNews ? (
            <Placeholder note="Loading news…" />
          ) : news?.length ? (
            <StockNewsList news={news} />
          ) : (
            <Placeholder note={`No recent news loaded for ${symbol}.`} />
          )}
        </section>

        <div className="text-center text-[10px] text-gray-600 pt-2 pb-6">
          Data from Financial Modeling Prep · statements & filings cached server-side and refreshed daily.
        </div>
      </div>
    </div>
  );
}
