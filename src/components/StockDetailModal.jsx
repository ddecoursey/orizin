import { useState, useEffect, useRef } from "react";
import { fmt } from "../lib/format.js";
import { SECTOR_COLORS } from "../lib/scoring.js";

const shortDate = (d) => {
  if (!d) return "";
  const [, m, day] = d.split("-");
  return `${m}/${day}`;
};

// Interactive price chart with an RSI(10) subpanel, grid lines, and a
// shared hover crosshair + tooltip. Rendered in real pixel coords (measured
// from the container) so text stays crisp and hover math is exact.
function PriceChart({ points, rsi }) {
  const wrapRef = useRef(null);
  const [w, setW] = useState(0);
  const [hover, setHover] = useState(null); // hovered point index

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!points || points.length < 2) {
    return (
      <div
        className="flex items-center justify-center bg-gray-900/50 rounded-lg text-xs text-gray-600"
        style={{ height: 294 }}
      >
        No price history available
      </div>
    );
  }

  // Layout (pixel coords)
  const H = 294;
  const PRICE_TOP = 8;
  const PRICE_H = 166;
  const RSI_TOP = 212;
  const RSI_H = 64;
  const n = points.length;

  const prices = points.map((p) => p.price);
  const pMin = Math.min(...prices);
  const pMax = Math.max(...prices);
  const pRange = pMax - pMin || 1;

  // Align RSI to price points by date
  const rsiMap = new Map((rsi || []).map((d) => [d.date, d.rsi]));
  const rsiVals = points.map((p) => (rsiMap.has(p.date) ? rsiMap.get(p.date) : null));
  const hasRsi = rsiVals.some((v) => v != null);

  const xAt = (i) => (n === 1 ? 0 : (i / (n - 1)) * w);
  const yPrice = (v) => PRICE_TOP + PRICE_H - ((v - pMin) / pRange) * PRICE_H;
  const yRsi = (v) => RSI_TOP + RSI_H - (v / 100) * RSI_H;

  const first = prices[0];
  const last = prices[prices.length - 1];
  const up = last >= first;
  const stroke = up ? "#22c55e" : "#ef4444";
  const changePct = first ? ((last - first) / first) * 100 : 0;

  // Build paths (only meaningful once measured)
  const priceLine = points.map((p, i) => `${xAt(i)},${yPrice(p.price)}`).join(" ");
  const priceArea = `0,${PRICE_TOP + PRICE_H} ${priceLine} ${w},${PRICE_TOP + PRICE_H}`;

  // RSI line, broken across null gaps
  const rsiSegs = [];
  let seg = [];
  rsiVals.forEach((v, i) => {
    if (v == null) {
      if (seg.length) rsiSegs.push(seg);
      seg = [];
    } else {
      seg.push(`${xAt(i)},${yRsi(v)}`);
    }
  });
  if (seg.length) rsiSegs.push(seg);

  // Grid line levels
  const priceLevels = [0, 0.25, 0.5, 0.75, 1].map((t) => pMin + t * pRange);
  const rsiLevels = [0, 30, 50, 70, 100];
  const vCount = 6;
  const vIdx = Array.from({ length: vCount }, (_, k) =>
    Math.round((k / (vCount - 1)) * (n - 1)),
  );

  const moveToClientX = (clientX) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setHover(Math.round(ratio * (n - 1)));
  };
  const onMove = (e) => moveToClientX(e.clientX);
  const onTouch = (e) => {
    if (e.touches?.[0]) moveToClientX(e.touches[0].clientX);
  };

  const hp = hover != null ? points[hover] : null;
  const hRsi = hover != null ? rsiVals[hover] : null;
  const hx = hover != null ? xAt(hover) : 0;
  const tipLeft = w ? Math.max(64, Math.min(w - 64, hx)) : 0;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-xs text-gray-500">
          {shortDate(points[0].date)} → {shortDate(points[points.length - 1].date)}
        </span>
        <span
          className={`text-xs font-semibold font-mono ${up ? "text-emerald-400" : "text-red-400"}`}
        >
          {up ? "▲" : "▼"} {Math.abs(changePct).toFixed(1)}% over period
        </span>
      </div>

      <div
        ref={wrapRef}
        className="relative select-none"
        style={{ height: H, touchAction: "pan-y" }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        onTouchStart={onTouch}
        onTouchMove={onTouch}
        onTouchEnd={() => setHover(null)}
      >
        {w > 0 && (
          <svg width={w} height={H} className="block">
            <defs>
              <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
                <stop offset="100%" stopColor={stroke} stopOpacity="0" />
              </linearGradient>
            </defs>

            {/* Horizontal grid — price */}
            {priceLevels.map((v, i) => (
              <line
                key={`pg${i}`}
                x1="0"
                x2={w}
                y1={yPrice(v)}
                y2={yPrice(v)}
                stroke="#94a3b8"
                strokeOpacity="0.18"
                strokeWidth="1"
              />
            ))}

            {/* Vertical grid + date labels (shared x-axis) */}
            {vIdx.map((idx, i) => (
              <g key={`vg${i}`}>
                <line
                  x1={xAt(idx)}
                  x2={xAt(idx)}
                  y1={PRICE_TOP}
                  y2={RSI_TOP + RSI_H}
                  stroke="#94a3b8"
                  strokeOpacity="0.18"
                  strokeWidth="1"
                />
                <text
                  x={xAt(idx)}
                  y={H - 2}
                  fontSize="9"
                  fill="#6b7280"
                  textAnchor={i === 0 ? "start" : i === vCount - 1 ? "end" : "middle"}
                >
                  {shortDate(points[idx]?.date)}
                </text>
              </g>
            ))}

            {/* Price area + line */}
            <polygon points={priceArea} fill="url(#priceFill)" />
            <polyline
              points={priceLine}
              fill="none"
              stroke={stroke}
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* RSI panel */}
            {hasRsi && (
              <>
                {/* overbought / oversold zones */}
                <rect x="0" y={yRsi(100)} width={w} height={yRsi(70) - yRsi(100)} fill="#ef4444" opacity="0.06" />
                <rect x="0" y={yRsi(30)} width={w} height={yRsi(0) - yRsi(30)} fill="#22c55e" opacity="0.06" />
                {rsiLevels.map((lv, i) => (
                  <line
                    key={`rg${i}`}
                    x1="0"
                    x2={w}
                    y1={yRsi(lv)}
                    y2={yRsi(lv)}
                    stroke="#94a3b8"
                    strokeOpacity={lv === 30 || lv === 70 ? 0.35 : 0.18}
                    strokeWidth="1"
                    strokeDasharray={lv === 30 || lv === 70 ? "3 3" : undefined}
                  />
                ))}
                {rsiSegs.map((s, i) => (
                  <polyline
                    key={`rs${i}`}
                    points={s.join(" ")}
                    fill="none"
                    stroke="#a78bfa"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}
                <text x="2" y={RSI_TOP - 4} fontSize="9" fill="#a78bfa" fontWeight="600">
                  RSI (10)
                </text>
              </>
            )}

            {/* Hover crosshair */}
            {hover != null && (
              <>
                <line
                  x1={hx}
                  x2={hx}
                  y1={PRICE_TOP}
                  y2={RSI_TOP + RSI_H}
                  stroke="#9ca3af"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
                {hp && <circle cx={hx} cy={yPrice(hp.price)} r="3" fill={stroke} stroke="#0a0a0a" strokeWidth="1" />}
                {hRsi != null && <circle cx={hx} cy={yRsi(hRsi)} r="3" fill="#a78bfa" stroke="#0a0a0a" strokeWidth="1" />}
              </>
            )}
          </svg>
        )}

        {/* Tooltip */}
        {hover != null && hp && (
          <div
            className="absolute top-1 z-10 -translate-x-1/2 pointer-events-none bg-gray-950/95 border border-gray-700 rounded-lg px-2.5 py-1.5 shadow-xl"
            style={{ left: tipLeft }}
          >
            <div className="text-[10px] text-gray-400 whitespace-nowrap">{hp.date}</div>
            <div className="text-xs font-mono text-gray-100 whitespace-nowrap">
              {fmt(hp.price, "price")}
            </div>
            {hRsi != null && (
              <div
                className={`text-[10px] font-mono whitespace-nowrap ${hRsi >= 70 ? "text-red-400" : hRsi <= 30 ? "text-emerald-400" : "text-violet-300"}`}
              >
                RSI {hRsi.toFixed(1)}
                {hRsi >= 70 ? " · overbought" : hRsi <= 30 ? " · oversold" : ""}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex justify-between text-[10px] text-gray-500 font-mono mt-1">
        <span>Low {fmt(pMin, "price")}</span>
        <span>High {fmt(pMax, "price")}</span>
      </div>
    </div>
  );
}

// Letter grade → color (groups +/- variants by base letter).
function gradeColor(rating) {
  const g = (rating || "").trim().charAt(0).toUpperCase();
  switch (g) {
    case "A": return { bg: "#14532d", fg: "#86efac" };
    case "B": return { bg: "#1e3a2f", fg: "#6ee7b7" };
    case "C": return { bg: "#713f12", fg: "#fde68a" };
    case "D": return { bg: "#7c2d12", fg: "#fed7aa" };
    default:  return { bg: "#7f1d1d", fg: "#fca5a5" }; // F / unknown
  }
}

// 1–5 score → color
const scoreColor5 = (s) =>
  s >= 5 ? "#22c55e" : s >= 4 ? "#4ade80" : s >= 3 ? "#f59e0b" : s >= 2 ? "#fb923c" : "#ef4444";

function ScoreBar5({ score }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="h-1.5 flex-1 rounded-sm"
          style={{ background: score != null && i <= score ? scoreColor5(score) : "rgba(120,120,120,0.25)" }}
        />
      ))}
    </div>
  );
}

function RatingsSnapshot({ ratings }) {
  const gc = gradeColor(ratings.rating);
  const subs = [
    ["DCF", ratings.dcf_score],
    ["ROE", ratings.roe_score],
    ["ROA", ratings.roa_score],
    ["D/E", ratings.de_score],
    ["P/E", ratings.pe_score],
    ["P/B", ratings.pb_score],
  ];
  return (
    <div className="flex gap-4">
      {/* Overall grade */}
      <div
        className="flex flex-col items-center justify-center rounded-xl px-4 py-2 shrink-0"
        style={{ background: gc.bg, color: gc.fg }}
      >
        <span className="text-2xl font-black leading-none">{ratings.rating ?? "—"}</span>
        {ratings.overall_score != null && (
          <span className="text-[9px] font-semibold opacity-80 mt-1">
            {ratings.overall_score}/5 overall
          </span>
        )}
      </div>

      {/* Sub-scores */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 flex-1 self-center">
        {subs.map(([label, s]) => (
          <div key={label} className="flex items-center gap-2">
            <span className="text-[10px] text-gray-500 w-7 shrink-0">{label}</span>
            <ScoreBar5 score={s} />
            <span className="text-[10px] font-mono text-gray-400 w-3 text-right shrink-0">
              {s ?? "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Grading action → label + color
function actionStyle(action) {
  const a = (action || "").toLowerCase();
  if (a.includes("up")) return { label: "▲ Upgrade", cls: "bg-emerald-900/40 text-emerald-300" };
  if (a.includes("down")) return { label: "▼ Downgrade", cls: "bg-red-900/40 text-red-300" };
  if (a.includes("init")) return { label: "✦ Initiate", cls: "bg-blue-900/30 text-blue-300" };
  return { label: "= Maintain", cls: "bg-gray-800 text-gray-400" };
}

function GradesList({ grades }) {
  return (
    <div className="space-y-1.5">
      {grades.map((g, i) => {
        const a = actionStyle(g.action);
        const changed = g.previous_grade && g.new_grade && g.previous_grade !== g.new_grade;
        return (
          <div
            key={i}
            className="flex items-center gap-2 text-[11px] border-b border-gray-800/50 pb-1.5"
          >
            <span className="text-gray-500 font-mono w-[68px] shrink-0">{g.date || "—"}</span>
            <span className="text-gray-300 flex-1 truncate" title={g.company || ""}>
              {g.company || "—"}
            </span>
            <span className="text-gray-400 font-mono whitespace-nowrap">
              {changed ? (
                <>
                  <span className="text-gray-600">{g.previous_grade}</span>
                  <span className="text-gray-600"> → </span>
                  <span className="text-gray-200">{g.new_grade}</span>
                </>
              ) : (
                <span className="text-gray-300">{g.new_grade || g.previous_grade || "—"}</span>
              )}
            </span>
            <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold whitespace-nowrap shrink-0 ${a.cls}`}>
              {a.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Stat({ label, value, type }) {
  const f = fmt(value, type);
  const pos = type === "pct" && value > 0;
  const neg = type === "pct" && value < 0;
  return (
    <div className="flex justify-between py-1 border-b border-gray-800/50 text-[11px]">
      <span className="text-gray-500">{label}</span>
      <span
        className={`font-semibold font-mono ${pos ? "text-emerald-400" : neg ? "text-red-400" : "text-gray-300"}`}
      >
        {f ?? <span className="text-gray-600">—</span>}
      </span>
    </div>
  );
}

// DCF fair value + analyst price targets + owner earnings for the open stock.
// Renders nothing if none of it is available (e.g. the FMP plan doesn't expose
// these endpoints), so it never shows an empty shell.
function Valuation({ aiData, loading, price }) {
  if (loading) {
    return (
      <div>
        <h3 className="text-[11px] uppercase tracking-wider font-bold text-gray-500 mb-2">
          Valuation &amp; Targets
        </h3>
        <div className="h-20 bg-gray-900/50 rounded-lg animate-pulse" />
      </div>
    );
  }
  const a = aiData;
  const hasAny = a && (a.dcf != null || a.target_consensus != null || a.owner_earnings != null);
  if (!hasAny) return null;

  const mos = a.dcf != null && price ? (a.dcf - price) / a.dcf : null; // margin of safety vs DCF
  const upside = a.target_consensus != null && price ? (a.target_consensus - price) / price : null;
  const pctClass = (v) => (v == null ? "text-gray-400" : v >= 0 ? "text-emerald-400" : "text-red-400");
  const pct = (v) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);

  return (
    <div>
      <h3 className="text-[11px] uppercase tracking-wider font-bold text-gray-500 mb-2">
        Valuation &amp; Targets
      </h3>
      <div className="grid grid-cols-2 gap-3">
        {a.dcf != null && (
          <div className="bg-gray-950/60 border border-gray-800 rounded-lg p-2.5">
            <div className="text-[9px] uppercase tracking-wider text-gray-600">DCF fair value</div>
            <div className="text-sm font-bold font-mono text-gray-100">{fmt(a.dcf, "price")}</div>
            <div className={`text-[11px] font-semibold ${pctClass(mos)}`}>{pct(mos)} margin of safety</div>
          </div>
        )}
        {a.target_consensus != null && (
          <div className="bg-gray-950/60 border border-gray-800 rounded-lg p-2.5">
            <div className="text-[9px] uppercase tracking-wider text-gray-600">Analyst target</div>
            <div className="text-sm font-bold font-mono text-gray-100">{fmt(a.target_consensus, "price")}</div>
            <div className={`text-[11px] font-semibold ${pctClass(upside)}`}>{pct(upside)} upside</div>
          </div>
        )}
      </div>
      {(a.target_low != null || a.target_high != null || a.owner_earnings != null) && (
        <div className="mt-2 text-[10px] text-gray-500">
          {(a.target_low != null || a.target_high != null) && (
            <>Analyst range: <span className="font-mono text-gray-400">{fmt(a.target_low, "price")} – {fmt(a.target_high, "price")}</span></>
          )}
          {a.owner_earnings != null && (
            <> · Owner earnings/sh: <span className="font-mono text-gray-400">{fmt(a.owner_eps, "price")}</span></>
          )}
        </div>
      )}
    </div>
  );
}

export default function StockDetailModal({
  row,
  onClose,
  symbol: symbolProp,
  profile = null,
  points = null,
  rsi = [],
  ratings = null,
  grades = [],
  aiData = null,
  loadingProfile = false,
  loadingChart = false,
  loadingRatings = false,
  loadingGrades = false,
  loadingAi = false,
}) {
  const symbol = symbolProp || row?.symbol;

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!row) return null;

  const sec = SECTOR_COLORS[row.sector] || { bg: "#1e293b", fg: "#94a3b8" };
  const sc = row.score != null ? Math.round(row.score * 100) : null;
  const scoreColor = sc >= 70 ? "#10b981" : sc >= 45 ? "#f59e0b" : "#ef4444";

  return (
    <>
      {/* Backdrop on tablet/phone where the pane floats over the table */}
      <div className="fixed inset-0 z-30 bg-black/50 touch-none lg:hidden" onClick={onClose} />
      <aside
        className="fixed inset-y-0 right-0 z-40 w-full max-w-md shadow-2xl
          lg:static lg:z-auto lg:w-96 lg:max-w-none lg:shadow-none
          shrink-0 bg-gray-900 border-l border-gray-800 flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-start justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            {profile?.image && (
              <img
                src={profile.image}
                alt=""
                className="w-10 h-10 rounded-lg bg-white/5 object-contain"
                onError={(e) => (e.currentTarget.style.display = "none")}
              />
            )}
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xl font-black text-gray-100">{row.symbol}</span>
                <span
                  className="inline-block rounded-full px-2 py-0.5 text-[10px] font-medium"
                  style={{ background: sec.bg, color: sec.fg }}
                >
                  {row.sector || "—"}
                </span>
              </div>
              <div className="text-xs text-gray-400">{row.name}</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-lg font-bold font-mono text-gray-100">
                {fmt(row.price, "price") ?? "—"}
              </div>
              {sc != null && (
                <div className="text-xs font-semibold" style={{ color: scoreColor }}>
                  Score {sc}
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-200 text-2xl leading-none px-1"
              title="Close"
            >
              ×
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-5">
          {/* Price chart */}
          <div>
            <h3 className="text-[11px] uppercase tracking-wider font-bold text-gray-500 mb-2">
              Price — last 12 months
            </h3>
            {loadingChart ? (
              <div className="h-[294px] bg-gray-900/50 rounded-lg animate-pulse" />
            ) : (
              <PriceChart points={points} rsi={rsi} />
            )}
          </div>

          {/* Valuation & analyst targets (DCF fair value, consensus, owner earnings) */}
          <Valuation aiData={aiData} loading={loadingAi} price={row.price} />

          {/* Ratings snapshot */}
          <div>
            <h3 className="text-[11px] uppercase tracking-wider font-bold text-gray-500 mb-2">
              Ratings Snapshot
            </h3>
            {loadingRatings ? (
              <div className="h-24 bg-gray-900/50 rounded-lg animate-pulse" />
            ) : ratings ? (
              <RatingsSnapshot ratings={ratings} />
            ) : (
              <p className="text-xs text-gray-600">No ratings available for {symbol}.</p>
            )}
          </div>

          {/* Analyst grades */}
          <div>
            <h3 className="text-[11px] uppercase tracking-wider font-bold text-gray-500 mb-2">
              Analyst Grades
            </h3>
            {loadingGrades ? (
              <div className="h-24 bg-gray-900/50 rounded-lg animate-pulse" />
            ) : grades.length ? (
              <GradesList grades={grades} />
            ) : (
              <p className="text-xs text-gray-600">No recent grades for {symbol}.</p>
            )}
          </div>

          {/* Company overview */}
          <div>
            <h3 className="text-[11px] uppercase tracking-wider font-bold text-gray-500 mb-2">
              Company Overview
            </h3>
            {loadingProfile ? (
              <div className="space-y-2">
                <div className="h-3 bg-gray-900 rounded animate-pulse" />
                <div className="h-3 bg-gray-900 rounded animate-pulse w-5/6" />
                <div className="h-3 bg-gray-900 rounded animate-pulse w-4/6" />
              </div>
            ) : profile ? (
              <>
                {profile.description && (
                  <p className="text-xs text-gray-400 leading-relaxed mb-3">
                    {profile.description}
                  </p>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4">
                  {profile.ceo && <Field label="CEO" value={profile.ceo} />}
                  {profile.industry && <Field label="Industry" value={profile.industry} />}
                  {profile.fullTimeEmployees && (
                    <Field
                      label="Employees"
                      value={Number(profile.fullTimeEmployees).toLocaleString()}
                    />
                  )}
                  {(profile.exchangeFullName || profile.exchange) && (
                    <Field label="Exchange" value={profile.exchangeFullName || profile.exchange} />
                  )}
                  {(profile.city || profile.country) && (
                    <Field
                      label="HQ"
                      value={[profile.city, profile.state, profile.country]
                        .filter(Boolean)
                        .join(", ")}
                    />
                  )}
                  {profile.ipoDate && <Field label="IPO Date" value={profile.ipoDate} />}
                  {profile.range && <Field label="52W Range" value={profile.range} />}
                  {profile.website && (
                    <Field
                      label="Website"
                      value={
                        <a
                          href={profile.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:underline truncate"
                        >
                          {profile.website.replace(/^https?:\/\//, "")}
                        </a>
                      }
                    />
                  )}
                </div>
              </>
            ) : (
              <p className="text-xs text-gray-600">
                No company profile available for {symbol}.
              </p>
            )}
          </div>

          {/* Key metrics */}
          <div>
            <h3 className="text-[11px] uppercase tracking-wider font-bold text-gray-500 mb-2">
              Key Metrics
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-5">
              <Stat label="Mkt Cap" value={row.mcap} type="money" />
              <Stat label="P/E" value={row.pe} type="x" />
              <Stat label="P/B" value={row.pb} type="x" />
              <Stat label="EV/EBITDA" value={row.ev_ebitda} type="x" />
              <Stat label="EV/GP" value={row.ev_gp} type="x" />
              <Stat label="FCF Yld" value={row.fcf_yield} type="pct" />
              <Stat label="ROIC" value={row.roic} type="pct" />
              <Stat label="ROE" value={row.roe} type="pct" />
              <Stat label="Gross M" value={row.gross_margin} type="pct" />
              <Stat label="Op M" value={row.op_margin} type="pct" />
              <Stat label="Net M" value={row.net_margin} type="pct" />
              <Stat label="Rev Gr" value={row.revenue_growth} type="pct" />
              <Stat label="EPS Gr" value={row.eps_growth} type="pct" />
              <Stat label="ND/EBITDA" value={row.net_debt_ebitda} type="ratio" />
              <Stat label="Div Yld" value={row.div_yield} type="pct" />
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

function Field({ label, value }) {
  return (
    <div className="py-1 border-b border-gray-800/50 min-w-0">
      <div className="text-[9px] uppercase tracking-wider text-gray-600">{label}</div>
      <div className="text-xs text-gray-300 truncate">{value}</div>
    </div>
  );
}
