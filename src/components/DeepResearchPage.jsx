import { fmt } from "../lib/format.js";
import { SECTOR_COLORS } from "../lib/scoring.js";
import GlobalSearch from "./GlobalSearch.jsx";
import { PriceChart, StockNewsList } from "./StockDetailModal.jsx";
import { useDeepResearch } from "../hooks/useDeepResearch.js";

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
      className={`bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col ${
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

function Stat({ label, value, type, accent }) {
  const f = type ? fmt(value, type) : value;
  return (
    <div className="flex justify-between items-baseline py-1.5 border-b border-gray-800/50 gap-3">
      <span className="text-[11px] text-gray-500 shrink-0">{label}</span>
      <span className={`text-xs font-semibold font-mono text-right ${accent || "text-gray-200"}`}>
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

export default function DeepResearchPage({ symbol, row, onBack, onAskOri, stocks = [], onSelectSymbol, onRegather, regathering = false, detail = {} }) {
  // `detail` is owned by App (one useStockDetail instance shared with Ori's context)
  // so a re-gather reloads it once rather than double-fetching from FMP.
  const { profile, aiData, insider, news, loadingProfile, loadingNews, points, rsi, loadingChart } = detail;

  // Deep-research-only data (statements, filings, comp, peers, growth) — owned
  // here since nothing outside this page needs it. Server caches make
  // re-opening a symbol free.
  const deep = useDeepResearch(symbol);

  const handleSearch = (stock) => {
    if (stock?.symbol) onSelectSymbol?.(stock.symbol);
  };

  if (!symbol) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-gray-500 px-6">
        <div className="text-center mb-5">
          <p className="text-2xl mb-2">🔬</p>
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
  const sc = row?.score != null ? Math.round(row.score * 100) : null;
  const scoreColor = sc >= 70 ? "#10b981" : sc >= 45 ? "#f59e0b" : "#ef4444";

  // DCF margin of safety vs current price (when both present).
  const dcf = aiData?.dcf ?? null;
  const dcfPrice = aiData?.stock_price ?? row?.price ?? null;
  const mos = dcf != null && dcfPrice ? (dcf - dcfPrice) / dcfPrice : null;

  return (
    <div className="flex-1 overflow-y-auto overscroll-contain bg-gray-950">
      {/* Sticky page header */}
      <div className="sticky top-0 z-10 bg-gray-950/95 backdrop-blur border-b border-gray-800 px-4 sm:px-6 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="shrink-0 text-xs text-gray-400 hover:text-gray-100 px-2 py-1 rounded-md hover:bg-gray-800 transition-colors"
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

          <div className="ml-auto flex items-center gap-4 shrink-0">
            {/* Switch to another stock without leaving Deep Research */}
            <div className="hidden md:block w-56">
              <GlobalSearch stocks={stocks} onSelect={handleSearch} />
            </div>
            <div className="text-right">
              <div className="text-lg font-bold font-mono text-gray-100">{fmt(row?.price, "price") ?? "—"}</div>
              {sc != null && (
                <div className="text-xs font-semibold" style={{ color: scoreColor }}>
                  Orizin Score {sc}
                </div>
              )}
            </div>
            {onRegather && (
              <button
                onClick={() => onRegather(symbol)}
                disabled={regathering}
                className="text-xs font-semibold px-3 py-1.5 rounded-md bg-gray-800 text-gray-200 border border-gray-700 hover:bg-gray-700 transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1.5"
                title="Re-fetch all data for this stock from FMP"
              >
                <span className={regathering ? "inline-block animate-spin" : ""}>↻</span>
                {regathering ? "Gathering…" : "Re-gather"}
              </button>
            )}
            {onAskOri && (
              <button
                onClick={() => onAskOri(symbol)}
                className="text-xs font-semibold px-3 py-1.5 rounded-md bg-gradient-to-br from-blue-600/30 to-violet-600/30 text-violet-200 border border-violet-800/50 hover:brightness-125 transition-all"
              >
                Ask Ori
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6 space-y-6">
        {/* Price + RSI chart alongside the company profile, under the name bar */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <section className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-4">
            <h3 className="text-[11px] uppercase tracking-wider font-bold text-gray-400 mb-2">
              Price &amp; RSI
            </h3>
            {loadingChart ? (
              <div className="h-[300px] bg-gray-900/50 rounded-lg animate-pulse" />
            ) : (
              <PriceChart points={points} rsi={rsi} symbol={symbol} height={300} />
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
        <div>
          <h2 className="text-xs uppercase tracking-[0.15em] font-bold text-gray-500 mb-3">
            Tier 1 · Valuation & Quality
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <Panel title="Key Metrics (TTM)" tier="T1" span={1}>
              <StatGrid>
                <Stat label="Market Cap" value={row?.mcap} type="money" />
                <Stat label="Enterprise Val" value={row?.ev} type="money" />
                <Stat label="P/E" value={row?.pe} type="x" />
                <Stat label="P/B" value={row?.pb} type="x" />
                <Stat label="P/S" value={row?.ps} type="x" />
                <Stat label="EV/EBITDA" value={row?.ev_ebitda} type="x" />
                <Stat label="EV/GP" value={row?.ev_gp} type="x" />
                <Stat label="FCF Yield" value={row?.fcf_yield} type="pct" />
                <Stat label="Earnings Yield" value={row?.earnings_yield} type="pct" />
                <Stat label="Dividend Yield" value={row?.div_yield} type="pct" />
              </StatGrid>
            </Panel>

            <Panel title="Financial Ratios (TTM)" tier="T1" span={1}>
              <StatGrid>
                <Stat label="ROIC" value={row?.roic} type="pct" />
                <Stat label="ROE" value={row?.roe} type="pct" />
                <Stat label="ROA" value={row?.roa} type="pct" />
                <Stat label="Gross Margin" value={row?.gross_margin} type="pct" />
                <Stat label="Op Margin" value={row?.op_margin} type="pct" />
                <Stat label="Net Margin" value={row?.net_margin} type="pct" />
                <Stat label="FCF Margin" value={row?.fcf_margin} type="pct" />
                <Stat label="Current Ratio" value={row?.current_ratio} type="ratio" />
                <Stat label="Debt/Equity" value={row?.debt_equity} type="ratio" />
                <Stat label="Net Debt/EBITDA" value={row?.net_debt_ebitda} type="ratio" />
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
          </div>
        </div>

        {/* ── TIER 2 ─────────────────────────────────────────────────────── */}
        <div>
          <h2 className="text-xs uppercase tracking-[0.15em] font-bold text-gray-500 mb-3">
            Tier 2 · Financial Statements & Estimates
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
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
        <div>
          <h2 className="text-xs uppercase tracking-[0.15em] font-bold text-gray-500 mb-3">
            Tier 3 · Ownership, Peers & Growth
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
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
                      className="w-full flex items-center text-[11px] py-1 border-b border-gray-800/50 hover:bg-gray-800/40 rounded transition-colors text-left"
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
