import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  saveChatSession,
  getChatSession,
  listChatSessions,
  deleteChatSession,
  getUserSettings,
  patchUserSettings,
  getUserByUsername,
} from "../db.js";
import { displayNameFor } from "../userProfile.js";
import { hasOriAccess } from "../access.js";
import { geminiKeys, valueModel, liteModel, modelTier } from "../geminiJson.js";
import { buildChatGeminiBody } from "../geminiContextCache.js";
import { checkOriQuota, recordOriUsage, getOriUsageSummary } from "../oriUsage.js";
import {
  truncateChatHistory,
  toGeminiContents,
  historyContextNote,
  chatFetchTimeoutMs,
  chatStreamTimeoutMs,
} from "../chatHistory.js";
import { fmt } from "./prompt-helpers.js";
import { marketStatusLine } from "../marketHours.js";

const router = Router();

// Per-user limiter on the (paid, Gemini-backed) chat endpoint to cap cost/abuse.
// Keyed by the authenticated user, not IP, so users behind one NAT don't share a
// bucket. Generous for real use (a burst of follow-ups is fine).
const chatLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  // /chat is always authenticated (the /api gate sets req.userId), so key by
  // user. Avoids the IP path entirely (no IPv6 keying caveat).
  keyGenerator: (req) => req.userId || "anon",
});

// Ori access gating (Pro tier) lives in ../access.js and is shared with the
// game-plan route so the two can't drift apart.

// ── Ori's persistent per-user memory ───────────────────────────────────────
// Durable facts Ori has learned about the user (risk tolerance, horizon,
// sectors they avoid, tax situation, etc.), stored in the user_settings blob
// and injected into every system prompt. Ori adds to it by emitting
// [[remember: fact]] tokens, which we parse out of each reply server-side.
const MAX_MEMORY_FACTS = 40;

function getOriMemory(userId) {
  try {
    const settings = getUserSettings(userId);
    return Array.isArray(settings.oriMemory) ? settings.oriMemory : [];
  } catch {
    return [];
  }
}

function saveOriMemoryFacts(userId, newFacts) {
  if (!newFacts.length) return [];
  const existing = getOriMemory(userId);
  const seen = new Set(existing.map((f) => String(f.text || f).trim().toLowerCase()));
  const added = [];
  for (const fact of newFacts) {
    const text = String(fact).trim().slice(0, 280);
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    added.push({ text, at: Date.now() });
  }
  if (!added.length) return [];
  const merged = [...existing, ...added].slice(-MAX_MEMORY_FACTS);
  patchUserSettings(userId, { oriMemory: merged });
  return added;
}

// Extract [[remember: ...]] tokens; returns { facts, cleaned }.
const REMEMBER_RE = /\[\[\s*remember\s*:\s*([^\]]+?)\s*\]\]/gi;
function extractRememberTokens(text) {
  const facts = [];
  const cleaned = String(text || "").replace(REMEMBER_RE, (_, fact) => {
    facts.push(fact);
    return "";
  });
  return { facts, cleaned: cleaned.replace(/[ \t]+\n/g, "\n").trimEnd() };
}

// Tool definition: Allow Ori to control the screener filters
// Note: We are using JSON output in the response text instead of native tool calling
// for better reliability with Gemini.

function buildSystemPrompt(context, personalization = {}) {
  const {
    filters, weights, stocks, focusSymbols, availableSectors, availableIndustries,
    activeStock, focusStocks, today, totalFiltered, activeScreener, pinnedStocks, news,
    view,
  } = context || {};
  const { username, memory } = personalization;

  const shown = stocks?.length || 0;
  const total = totalFiltered ?? shown;
  const viewLine =
    shown === 0
      ? `${total}`
      : total > shown
        ? `${total} (showing the top ${shown} by Conviction below)`
        : `${shown}`;

  // Timeless persona, score methodology, and view-mode rules live in ORI_SYSTEM_STATIC
  // (server-wide Gemini cachedContents). This function returns ONLY per-request context.
  const currentView = view || "screener";
  let prompt = `Today's date: ${today || "unknown"}.
Market status: ${marketStatusLine()}. Factor this in when discussing prices ("as of Friday's close", "the market is open right now, intraday moves may continue", etc.).
CURRENT_VIEW: ${currentView}
${currentView === "deep-research" && activeStock?.symbol ? `ACTIVE_SYMBOL: ${activeStock.symbol}${activeStock.name ? ` (${activeStock.name})` : ""}` : ""}
${username && username !== "default" ? `You are talking to **${username}**. Address them naturally by name occasionally (don't overdo it) and treat the portfolios, goals, theses and remembered facts below as theirs.` : ""}
${memory?.length ? `
=== WHAT YOU REMEMBER ABOUT THIS USER (from past conversations) ===
${memory.map((f, i) => `${i + 1}. ${f.text || f}`).join("\n")}
Apply these consistently (risk tolerance, horizon, preferences, constraints). If the user contradicts one, follow the user and update your memory.
` : ""}
${view === 'deep-research'
  ? `DEEP RESEARCH CONTEXT:
- The user is viewing ONE stock's full research page (its data is below). They are NOT looking at the screener list right now — do not reference a count of stocks "in view".`
  : `SCREENER CONTEXT:
- Stocks in view: ${viewLine}
- Active screener: ${activeScreener || "All Stocks"}
- Current filters: ${summarizeFilters(filters)}`}
- Current scorecard weights: Q=${weights?.q ?? 35} (Quality), V=${weights?.v ?? 35} (Value), G=${weights?.g ?? 30} (Growth). These determine how the final Orizin Score is calculated — read them through the USER PREFERENCE LENS above and adapt your tone/emphasis accordingly.

Available Sectors: ${JSON.stringify(availableSectors || [])}
Available Industries: ${JSON.stringify(availableIndustries || [])}
`;

  if (stocks?.length) {
    prompt += "\nSTOCK DATA:\n";
    prompt +=
      "| Sym | Sector | MCap | Price | PE | PB | EV/EB | EV/S | FCF_Y | Gross_M | Op_M | ROIC | ROE | ND/EB | D/E | Div_Y | Q | V | G | Score | Conv | Cov |\n";
    prompt +=
      "|-----|--------|------|-------|----|----|-------|------|-------|---------|------|------|-----|-------|-----|-------|-------|-------|-------|-------|------|-----|\n";
    const top = stocks.slice(0, 30);
    for (const s of top) {
      prompt += `| ${s.symbol} | ${(s.sector || "").slice(0, 8)} | ${fmt(s.mcap, "money")} | ${fmt(s.price, "price")} | ${fmt(s.pe, "x")} | ${fmt(s.pb, "x")} | ${fmt(s.ev_ebitda, "x")} | ${fmt(s.ev_sales, "x")} | ${fmt(s.fcf_yield, "pct")} | ${fmt(s.gross_margin, "pct")} | ${fmt(s.op_margin, "pct")} | ${fmt(s.roic, "pct")} | ${fmt(s.roe, "pct")} | ${fmt(s.net_debt_ebitda, "r")} | ${fmt(s.debt_equity, "r")} | ${fmt(s.div_yield, "pct")} | ${s.qScore != null ? Math.round(s.qScore * 100) : "—"} | ${s.vScore != null ? Math.round(s.vScore * 100) : "—"} | ${s.gScore != null ? Math.round(s.gScore * 100) : "—"} | ${s.score != null ? Math.round(s.score * 100) : "—"} | ${s.conviction != null ? s.conviction : "—"} | ${s.dataCoverage != null ? Math.round(s.dataCoverage * 100) + "%" : "—"} |\n`;
    }
    if (stocks.length > 30)
      prompt += `\n(Showing top 30 of ${stocks.length} by Conviction. Score = Orizin fundamentals engine; Conv = the unified headline Conviction users see.)\n`;
  }

  if (pinnedStocks?.length) {
    prompt += `\n📌 PINNED (the user's watchlist in this screener — they've flagged these as ones they care about):\n`;
    for (const s of pinnedStocks.slice(0, 30)) {
      prompt += `- ${s.symbol} (${s.name || ""}) — ${(s.sector || "").slice(0, 16)} · ${fmt(s.mcap, "money")} · P/E ${fmt(s.pe, "x")} · EV/EBITDA ${fmt(s.ev_ebitda, "x")} · ROIC ${fmt(s.roic, "pct")} · Score ${s.score != null ? Math.round(s.score * 100) : "—"}\n`;
    }
    if (pinnedStocks.length > 30) prompt += `(…and ${pinnedStocks.length - 30} more pinned)\n`;
  }

  if (news?.length) {
    prompt += `\nLATEST MARKET NEWS (most recent headlines — use for macro/sentiment context; cite the source if you reference one):\n`;
    for (const a of news.slice(0, 10)) {
      prompt += `- ${a.symbol ? `[${a.symbol}] ` : ""}${a.title}${a.source ? ` (${a.source})` : ""}\n`;
    }
  }

  if (activeStock) {
    prompt += "\n" + buildActiveStockSection(activeStock) + "\n";
  }

  if (focusSymbols?.length) {
    const syms = focusSymbols.join(", ");
    if (activeStock && focusSymbols.includes(activeStock.symbol)) {
      prompt += `FOCUS: The user explicitly asked about ${activeStock.symbol} (the currently open stock above).\n`;
    } else {
      prompt += `FOCUS SYMBOLS: The user clicked "Ask Ori" or is asking specifically about: ${syms}. Their basic screener data is in the STOCK DATA table. For richer context (profile, DCF, targets, insider, news, etc.) the user should open them in the overview pane.\n`;
    }
  }

  // === USER PORTFOLIOS & GOALS (critical framing context) ===
  if (context?.portfolioGoals) {
    const pg = context.portfolioGoals;
    if ((pg.portfolios?.length || pg.goals?.length || pg.theses?.length)) {
      prompt += `\n=== USER'S ACTUAL PORTFOLIOS & GOALS ===\n`;
      prompt += `Grand total invested across all portfolios: $${(pg.grandTotal || 0).toLocaleString()}\n\n`;

      if (pg.portfolios?.length) {
        prompt += `PORTFOLIOS:\n`;
        pg.portfolios.forEach((p, i) => {
          const t = (p.totalInvested || 0).toLocaleString();
          prompt += `${i + 1}. ${p.name || 'Untitled'} — Total: $${t}\n`;
          const holdings = (p.holdings || []).map(h => {
            const pct = h.percent != null ? h.percent.toFixed(1) + '%' : '';
            const dol = h.dollars != null ? '$' + Math.round(h.dollars).toLocaleString() : '';
            return `${h.ticker} ${pct}${dol ? ' (' + dol + ')' : ''}`;
          }).join(', ');
          if (holdings) prompt += `   Holdings: ${holdings}\n`;
        });
      }

      if (pg.overallAllocations?.length) {
        prompt += `\nOVERALL WEIGHTS (across all portfolios):\n`;
        pg.overallAllocations.slice(0, 15).forEach(a => {
          prompt += `• ${a.ticker}: ${a.overallPercent.toFixed(1)}% ($${Math.round(a.dollars).toLocaleString()})\n`;
        });
        if (pg.overallAllocations.length > 15) prompt += `• +${pg.overallAllocations.length - 15} smaller positions\n`;
      }

      if (pg.goals?.length) {
        prompt += `\nUSER GOALS:\n`;
        pg.goals.forEach((g, i) => {
          if (g && g.trim()) prompt += `${i + 1}. ${g.trim()}\n`;
        });
      }

      if (pg.theses?.length) {
        const cleanTheses = pg.theses.filter((t) => t && t.trim());
        if (cleanTheses.length) {
          prompt += `\nUSER INVESTMENT THESES (the user's own convictions about specific companies or trends — treat these as their directional views and weigh them when reasoning. You may respectfully pressure-test or add nuance, but do not dismiss them):\n`;
          cleanTheses.forEach((t, i) => {
            prompt += `${i + 1}. ${t.trim()}\n`;
          });
        }
      }

      prompt += `\nIMPORTANT: Always frame recommendations in the context of the user's existing holdings, concentration risk, tax location (if inferable), stated goals, AND their investment theses above. Suggest specific buys/sells that consider overlap with current positions. Do not recommend things that would dramatically increase risk relative to their goals.\n`;
    }
  }

  // Rich context for any additionally focused/asked-about stocks (from natural language
  // questions, follow-ups on suggestions, etc.). These get the same full treatment.
  if (focusStocks?.length) {
    for (const fs of focusStocks) {
      if (activeStock && fs.symbol === activeStock.symbol) continue; // already covered above
      prompt += `\n=== USER ALSO FOCUSING ON / ASKED ABOUT: ${fs.symbol} (${fs.name || ""}) ===\n`;
      prompt += buildActiveStockSection(fs) + "\n";
    }
  }

  return prompt;
}

// Renders rich context for a stock the user has open in a detail pane or has
// explicitly asked about / is focusing on (via button, typing in chat, follow-ups
// on suggestions, etc.). Includes profile, ratings, grades, RSI, performance,
// DCF, analyst targets, insider trades, and recent company news.
function buildActiveStockSection(s) {
  const rsiNote =
    s.latestRsi == null
      ? "n/a"
      : `${s.latestRsi.toFixed(1)} (${s.latestRsi >= 70 ? "overbought" : s.latestRsi <= 30 ? "oversold" : "neutral"})`;

  let out = `=== ⭐ CURRENTLY OPEN STOCK — ${s.symbol} (${s.name || ""}) ===
The user has this stock open in the company-overview panel right now. Unless they clearly ask about something else, assume questions are about ${s.symbol} and prioritize it. You have richer data on it than the rest of the table:

- Sector / Industry: ${s.sector || "—"} / ${s.industry || "—"}
- Price: ${fmt(s.price, "price")} · Market cap: ${fmt(s.mcap, "money")} · Beta: ${s.beta != null ? s.beta.toFixed(2) : "—"}
- Valuation: P/E ${fmt(s.pe, "x")}, P/B ${fmt(s.pb, "x")}, P/S ${fmt(s.ps, "x")}, EV/EBITDA ${fmt(s.ev_ebitda, "x")}, EV/GP ${fmt(s.ev_gp, "x")}, FCF yield ${fmt(s.fcf_yield, "pct")}
- Quality: ROIC ${fmt(s.roic, "pct")}, ROE ${fmt(s.roe, "pct")}, ROA ${fmt(s.roa, "pct")}, Gross ${fmt(s.gross_margin, "pct")}, Op ${fmt(s.op_margin, "pct")}, Net ${fmt(s.net_margin, "pct")}, ND/EBITDA ${fmt(s.net_debt_ebitda, "r")}, D/E ${fmt(s.debt_equity, "r")}, Current ratio ${fmt(s.current_ratio, "r")}
- Growth (TTM): Revenue ${fmt(s.revenue_growth, "pct")}, EPS ${fmt(s.eps_growth, "pct")}, FCF ${fmt(s.fcf_growth, "pct")}
- Dividend yield: ${fmt(s.div_yield, "pct")}
- Conviction (headline): ${s.verdict?.conviction ?? s.conviction ?? "—"}/100 · Fundamentals engine "Orizin Score": ${s.score != null ? Math.round(s.score * 100) : "—"} (Q ${s.qScore != null ? Math.round(s.qScore * 100) : "—"}, V ${s.vScore != null ? Math.round(s.vScore * 100) : "—"}, G ${s.gScore != null ? Math.round(s.gScore * 100) : "—"})${s.dataCoverage != null ? ` · data coverage ${Math.round(s.dataCoverage * 100)}%${s.dataCoverage < 0.6 ? " (LOW — leans on imputation, be skeptical)" : ""}` : ""}
- RSI(10): ${rsiNote}${s.rsiTrend ? ` — ${s.rsiTrend.direction} (${s.rsiTrend.change5d >= 0 ? "+" : ""}${s.rsiTrend.change5d.toFixed(1)} over ~5 sessions)` : ""}`;

  if (s.verdict) {
    const v = s.verdict;
    out += `\n- 🧭 GAME PLAN (the unified verdict shown on this stock's page): CONVICTION ${v.conviction ?? "—"}/100 · HOLD HORIZON ${v.horizon}${v.horizonSub ? ` (${v.horizonSub})` : ""} · RIGHT NOW → ${v.action}${v.actionLine ? ` (${v.actionLine})` : ""}. ${v.headline}`;
    if (v.reasons && v.reasons.length) out += `\n  Horizon drivers: ${v.reasons.join("; ")}`;
    if (Array.isArray(v.pillars) && v.pillars.length)
      out += `\n  Pillars (0-100): ${v.pillars.map((p) => `${p.id} ${p.score ?? "—"}`).join(" · ")}`;
    out += `\n  (confidence: ${v.confidence}). This ONE conviction unifies the Orizin Score (→ fundamentals pillar), personal Fit (→ fit pillar), valuation, technicals, insiders & analysts. Stay consistent with it, or state plainly why you'd differ. You ARE Ori — own the intangibles / future-potential judgment (the Tesla/SpaceX "numbers say no, story says yes" factor) and always give a bull case, a bear case, and what would change your mind.`;
  }

  if (s.performance) {
    const p = s.performance;
    out += `\n- Price performance: 1mo ${fmt(p.m1, "pct")}, 3mo ${fmt(p.m3, "pct")}, 6mo ${fmt(p.m6, "pct")}, 1yr ${fmt(p.y1, "pct")}`;
  }

  if (s.dcf != null || s.targetConsensus != null || s.ownerEarnings != null) {
    const mos = s.dcf != null && s.price ? ((s.dcf - s.price) / s.dcf) * 100 : null;
    const upside = s.targetConsensus != null && s.price ? ((s.targetConsensus - s.price) / s.price) * 100 : null;
    const parts = [];
    if (s.dcf != null)
      parts.push(`DCF fair value ${fmt(s.dcf, "price")}${mos != null ? ` (${mos >= 0 ? "+" : ""}${mos.toFixed(0)}% margin of safety vs price)` : ""}`);
    if (s.targetConsensus != null)
      parts.push(`analyst consensus target ${fmt(s.targetConsensus, "price")}${upside != null ? ` (${upside >= 0 ? "+" : ""}${upside.toFixed(0)}% implied upside)` : ""}${s.targetLow != null || s.targetHigh != null ? `, range ${fmt(s.targetLow, "price")}–${fmt(s.targetHigh, "price")}` : ""}`);
    if (s.ownerEarnings != null) parts.push(`owner earnings/share ${fmt(s.ownerEps, "price")}`);
    out += `\n- Intrinsic value & analyst targets: ${parts.join("; ")}`;
  }

  if (s.profile) {
    const p = s.profile;
    out += `\n- Company: ${p.ceo ? `CEO ${p.ceo}; ` : ""}${p.fullTimeEmployees ? `${p.fullTimeEmployees} employees; ` : ""}${p.country ? `${p.country}; ` : ""}${p.exchange ? `${p.exchange}; ` : ""}${p.ipoDate ? `IPO ${p.ipoDate}; ` : ""}${p.range ? `52W range ${p.range}` : ""}`;
    if (p.website) out += `\n- Website: ${p.website}`;
    if (p.description) out += `\n- Business: ${String(p.description).slice(0, 700)}`;
  }

  if (s.ratings && s.ratings.rating) {
    const r = s.ratings;
    out += `\n- FMP Ratings (1-5 sub-scores): grade ${r.rating}, overall ${r.overall_score ?? "—"}/5 — DCF ${r.dcf_score ?? "—"}, ROE ${r.roe_score ?? "—"}, ROA ${r.roa_score ?? "—"}, D/E ${r.de_score ?? "—"}, P/E ${r.pe_score ?? "—"}, P/B ${r.pb_score ?? "—"}`;
  }

  if (s.grades && s.grades.length) {
    const g = s.grades
      .map((x) => `${x.date || ""} ${x.company || ""} ${x.action || ""}${x.new_grade ? ` → ${x.new_grade}` : ""}`.trim())
      .join("; ");
    out += `\n- Recent analyst grades: ${g}`;
  }

  if (s.insider && s.insider.length) {
    const buys = s.insider.filter((t) => t.type === "A").length;
    const sells = s.insider.filter((t) => t.type === "D").length;
    const recent = s.insider
      .slice(0, 6)
      .map((t) => `${t.date || ""} ${t.name || ""} ${t.type === "A" ? "BUY" : t.type === "D" ? "SELL" : ""} ${t.shares != null ? Math.abs(t.shares).toLocaleString() : ""}sh`.trim())
      .join("; ");
    out += `\n- Insider activity (recent Form 4s): ${buys} buys / ${sells} sells — ${recent}`;
  }

  if (s.news && s.news.length) {
    const headlines = s.news
      .slice(0, 5)
      .map((n) => `${n.date || ""} ${n.title || ""}${n.source ? ` (${n.source})` : ""}`.trim())
      .join(" | ");
    out += `\n- Recent news: ${headlines}`;
  }

  if (s.technicals) {
    const t = s.technicals;
    const maVs = (ma) => (ma != null && s.price ? `${fmt(ma, "price")} (${s.price >= ma ? "above" : "below"})` : ma != null ? fmt(ma, "price") : "—");
    out += `\n- Technicals: SMA50 ${maVs(t.sma50)}, SMA200 ${maVs(t.sma200)}, EMA20 ${maVs(t.ema20)}; RSI(14) ${t.rsi14 != null ? t.rsi14.toFixed(0) : "—"}, ADX ${t.adx != null ? t.adx.toFixed(0) + (t.adx >= 25 ? " (strong trend)" : t.adx < 20 ? " (ranging)" : "") : "—"}, Williams%R ${t.williams != null ? t.williams.toFixed(0) : "—"}`;
    if (t.sma50 != null && t.sma200 != null) out += `; ${t.sma50 >= t.sma200 ? "golden-cross regime (SMA50>SMA200, bullish trend)" : "death-cross regime (SMA50<SMA200, bearish trend)"}`;
  }

  if (s.earnings) {
    const e = s.earnings;
    if (e.next) out += `\n- Next earnings: ${e.next.date}${e.next.epsEstimated != null ? ` (est. EPS ${e.next.epsEstimated})` : ""}`;
    if (e.recent && e.recent.length) {
      const hist = e.recent
        .map((q) => {
          const beat = q.epsActual != null && q.epsEstimated != null ? (q.epsActual >= q.epsEstimated ? "beat" : "miss") : "";
          return `${q.date} EPS ${q.epsActual ?? "—"} vs ${q.epsEstimated ?? "—"}${beat ? ` (${beat})` : ""}`;
        })
        .join("; ");
      out += `\n- Recent earnings: ${hist}`;
    }
  }

  if (s.smartMoney && (s.smartMoney.congress || s.smartMoney.insider)) {
    const c = s.smartMoney.congress;
    const i = s.smartMoney.insider;
    const parts = [];
    if (c && c.total) {
      const names = (c.recent || [])
        .slice(0, 5)
        .map((t) => `${t.name} ${t.type === "buy" ? "BUY" : t.type === "sell" ? "SELL" : ""}${t.amount ? ` ${t.amount}` : ""}`.trim())
        .join("; ");
      parts.push(`Congress (180d): ${c.buyers} bought / ${c.sellers} sold${names ? ` — ${names}` : ""}`);
    }
    if (i && (i.buyers || i.sellers)) {
      parts.push(`Insiders open-market (120d): ${i.buyers} bought / ${i.sellers} sold${i.buyValue ? ` ($${i.buyValue.toLocaleString()} bought)` : ""}`);
    }
    if (parts.length) out += `\n- Insiders (signal: ${s.smartMoney.signal}): ${parts.join(" | ")}`;
  }

  if (s.fit) {
    out += `\n- Fit to THIS user (portfolio/goals/theses): ${s.fit.score}/100 — ${(s.fit.reasons || []).slice(0, 3).join("; ")}`;
  }

  return out;
}

// Render one filter value for the prompt. Filters can be legacy flat numbers
// ("15"), operator objects ({ op: "<=", value: 25 }), or ranges ({ op:
// "between", min, max }) — and a cleared input leaves { op, value: "" }
// behind, which must read as "off", not "[object Object]".
function condText(v, defaultOp) {
  if (v == null || v === "") return null;
  const num = (x) => {
    if (x == null || x === "") return null;
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  };
  if (typeof v === "object") {
    const op = v.op || defaultOp;
    if (op === "between" || op === "range") {
      const lo = num(v.min);
      const hi = num(v.max);
      if (lo == null && hi == null) return null;
      if (lo != null && hi != null) return `${lo}–${hi}`;
      return lo != null ? `>= ${lo}` : `<= ${hi}`;
    }
    const val = num(v.value);
    return val == null ? null : `${op} ${val}`;
  }
  const n = num(v);
  return n == null ? null : `${defaultOp} ${n}`;
}

function summarizeFilters(f) {
  if (!f) return "none";
  const parts = [];
  if (f.sectors?.length) parts.push(`sectors: ${f.sectors.join(", ")}`);
  if (f.industries?.length) parts.push(`industries: ${f.industries.join(", ")}`);
  if (f.pinnedOnly) parts.push("pinned only");
  if (f.rule40Only) parts.push("Rule-of-40 only");
  if (f.includeEtfs === false) parts.push("ETFs excluded");

  const numeric = [
    ["mcap", "mcap ($B)", ">="], ["mcapMin", "mcap ($B)", ">="], ["mcapMax", "mcap ($B)", "<="],
    ["price", "price ($)", ">="], ["priceMin", "price ($)", ">="], ["priceMax", "price ($)", "<="],
    ["beta", "beta", ">="], ["betaMin", "beta", ">="], ["betaMax", "beta", "<="],
    ["volMin", "volume (M)", ">="],
    ["grossMin", "gross margin %", ">="], ["opMin", "op margin %", ">="],
    ["netMin", "net margin %", ">="], ["ebitdaMin", "EBITDA margin %", ">="],
    ["fcfMargMin", "FCF margin %", ">="],
    ["roicMin", "ROIC %", ">="], ["roeMin", "ROE %", ">="], ["roaMin", "ROA %", ">="],
    ["revGrowthMin", "rev growth %", ">="], ["epsGrowthMin", "EPS growth %", ">="],
    ["fcfGrowthMin", "FCF growth %", ">="], ["opIncGrowthMin", "op income growth %", ">="],
    ["r40Min", "Rule of 40", ">="],
    ["peMax", "P/E", "<="], ["pbMax", "P/B", "<="], ["psMax", "P/S", "<="],
    ["evEbMax", "EV/EBITDA", "<="], ["evSMax", "EV/Sales", "<="], ["evGpMax", "EV/GP", "<="],
    ["fcfMin", "FCF yield %", ">="], ["earningsYieldMin", "earnings yield %", ">="],
    ["ndMax", "ND/EBITDA", "<="], ["crMin", "current ratio", ">="], ["deMax", "D/E", "<="],
    ["divMin", "div yield %", ">="], ["payMax", "payout %", "<="],
  ];
  for (const [key, label, defaultOp] of numeric) {
    const t = condText(f[key], defaultOp);
    if (t) parts.push(`${label} ${t}`);
  }
  return parts.length ? parts.join(", ") : "none (full universe)";
}

// ── Gemini call with retry/backoff ─────────────────────────────────────────
// Gemini Flash regularly returns 429 (rate limit) / 503 (overloaded) under
// load. Rather than surfacing the raw API error, retry a few times with
// exponential backoff + jitter and only give up (with a friendly message)
// after several attempts. Retries happen before we stream any text to the
// client, so the user never sees a partial answer get clobbered.
// Model tiers + keys are shared with the structured path (geminiJson) so chat and
// the Game Plan stay in lock-step. Chat walks the value→lite ladder — it never
// touches the scarce frontier model, which is reserved for Deep Research.
const streamUrl = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;

// "Move to the next model/key": rate-limited / overloaded (429/503/5xx) or a
// model id this key can't serve (404) — so an unavailable model falls through.
function shouldFailover(status, bodyText) {
  if (status === 429 || status === 503 || status === 404) return true;
  if (status >= 500 && /unavailable|overloaded|try again/i.test(bodyText || "")) return true;
  return false;
}

// Walk the (key, model) ladder: value→lite on the primary key, then value→lite on
// the backup key, failing over on each "too busy"/unavailable response. One attempt
// per combo (no hammering the same model). Resolves to { res, model } on success,
// or { friendly, status, body, timedOut } when every combo failed.
async function fetchGeminiWithRetry({ keys, buildBody, send }) {
  let lastStatus = 0;
  let lastBody = "";
  let sawTimeout = false;
  const models = [valueModel(), liteModel()];
  const fetchTimeoutMs = chatFetchTimeoutMs();

  for (const apiKey of keys) {
    for (const model of models) {
      let res;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), fetchTimeoutMs);
      try {
        res = await fetch(streamUrl(model), {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-goog-api-key": apiKey },
          body: JSON.stringify(buildBody(model)),
          signal: controller.signal,
        });
      } catch (e) {
        if (e?.name === "AbortError") sawTimeout = true;
        lastStatus = 0;
        lastBody = e?.name === "AbortError" ? "request timed out" : (e?.message || String(e));
        continue;
      } finally {
        clearTimeout(timer);
      }

      if (res.ok) return { res, model };

      lastBody = await res.text();
      lastStatus = res.status;
      if (shouldFailover(res.status, lastBody)) {
        send("status", { message: "Ori is busy — trying another model…" });
        continue;
      }
      return { friendly: false, status: lastStatus, body: lastBody };
    }
  }

  return { friendly: true, timedOut: sawTimeout, status: lastStatus, body: lastBody };
}

// ── POST /api/chat ─────────────────────────────────────────────────────────
router.post("/chat", chatLimiter, async (req, res) => {
  // Validate input before opening the SSE stream — bad requests get a plain
  // HTTP error the client can handle uniformly.
  const rawMessage = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!rawMessage) {
    return res.status(400).json({ error: "Message is required" });
  }

  if (!hasOriAccess(req.userId)) {
    return res.status(402).json({
      error: "Ori is a Pro feature. Upgrade for $10/month to chat with Ori.",
      code: "upgrade_required",
    });
  }

  const keys = geminiKeys();
  if (!keys.length) {
    return res.status(503).json({
      error:
        "GEMINI_API_KEY not configured. Add your Gemini API key to .env to enable AI chat.",
    });
  }

  // Fair-use limiter: a chat turn always spends Gemini tokens, so meter it up
  // front. Admins / legacy modes are unlimited (checkOriQuota handles that).
  const quota = checkOriQuota(req.userId);
  if (!quota.ok) {
    return res.status(429).json({ error: quota.message, code: "ori_limit", scope: quota.scope });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  const send = (type, data) =>
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);

  try {
    const { sessionId, context } = req.body || {};
    // Hard cap so a runaway client can't ship a megabyte into the prompt.
    const userMessage = rawMessage.slice(0, 8000);

    const user = getUserByUsername(req.userId);
    let dynamicContext = buildSystemPrompt(context, {
      username: displayNameFor(user) || req.userId,
      memory: getOriMemory(req.userId),
    });

    // Look the session up scoped to this user. If the id doesn't resolve (stale
    // client state, or an id belonging to a different user), mint a fresh id —
    // the upsert would otherwise silently overwrite the other user's session.
    let session = sessionId ? getChatSession(sessionId, req.userId) : null;
    const messages = session ? JSON.parse(session.messages) : [];
    messages.push({ role: "user", content: userMessage });

    // Full history is kept in SQLite; only the recent window is sent to Gemini.
    const { messages: historyForGemini, truncated, dropped } = truncateChatHistory(messages);
    if (truncated) dynamicContext += historyContextNote(dropped);
    const geminiContents = toGeminiContents(historyForGemini);

    const { res: geminiRes, model: usedModel, friendly, timedOut, status, body: errBody } =
      await fetchGeminiWithRetry({
        keys,
        buildBody: (model) => buildChatGeminiBody(model, dynamicContext, geminiContents),
        send,
      });

    if (!geminiRes) {
      send("error", {
        message: timedOut
          ? "Ori took too long to start responding. Try again or start a new chat."
          : friendly
            ? "Ori is experiencing high demand right now. Please try again in a moment."
            : `Gemini API error ${status || ""}: ${errBody || "request failed"}`.trim(),
      });
      res.end();
      return;
    }

    // Tell the client which model answered (for the "generated by" label).
    send("model", { model: usedModel, tier: modelTier(usedModel) });

    const reader = geminiRes.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let fullResponse = "";
    let usageMeta = null; // last usageMetadata seen (cumulative; the final chunk wins)
    let streamTimedOut = false;
    const streamDeadline = Date.now() + chatStreamTimeoutMs();

    while (true) {
      if (Date.now() > streamDeadline) {
        streamTimedOut = true;
        try { await reader.cancel(); } catch { /* ignore */ }
        break;
      }
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === "[DONE]") continue;
        try {
          const evt = JSON.parse(raw);
          if (evt.usageMetadata) usageMeta = evt.usageMetadata;
          const candidate = evt.candidates?.[0];
          const part = candidate?.content?.parts?.[0];

          // Normal text response
          if (part?.text) {
            fullResponse += part.text;
            send("text", { text: part.text });
          }

          // Function call from Ori (this is the key feature)
          if (part?.functionCall?.name === "apply_screener_filters") {
            const args = part.functionCall.args || {};
            // Send action to frontend so it can apply the filters live
            send("apply_filters", { filters: args });

            // Also give the model a chance to comment on what it did
            // (we'll let it continue if there's more text later)
          }
        } catch {}
      }
    }

    if (streamTimedOut) {
      send("error", {
        message: "Ori's reply took too long. Try a shorter question or start a new chat.",
      });
      res.end();
      return;
    }

    // Meter this turn against the user's Ori allotment (and bank the token counts
    // for the usage panel). A turn that produced a real answer always cost tokens;
    // record even if usageMetadata was missing so the request count stays honest.
    if (fullResponse || usageMeta) {
      recordOriUsage(req.userId, { kind: "chat", usage: usageMeta });
    }

    // Persist any [[remember: ...]] facts Ori emitted, and store the cleaned
    // text so recalled sessions don't re-show (or re-save) the tokens.
    const { facts, cleaned } = extractRememberTokens(fullResponse);
    let remembered = [];
    if (facts.length) {
      try {
        remembered = saveOriMemoryFacts(req.userId, facts);
      } catch (e) {
        console.warn("[chat] failed to save Ori memory:", e.message);
      }
    }

    // Only record an assistant turn if the stream actually produced text —
    // saving empty turns corrupts the conversation context for future calls.
    if (cleaned) {
      messages.push({ role: "assistant", content: cleaned });
    }
    // Use the validated session's id (not the raw client value) so one user
    // can never write under another user's session id.
    const sid = session?.id || `${req.userId}_chat_${Date.now()}`;
    saveChatSession({
      id: sid,
      user_id: req.userId,
      // Keep the title from the first message; don't overwrite it on every turn
      // (a long conversation shouldn't get renamed to whatever was typed last).
      title: session?.title || userMessage.slice(0, 60),
      messages: JSON.stringify(messages),
      created_at: session?.created_at || Date.now(),
      updated_at: Date.now(),
    });
    send("done", {
      sessionId: sid,
      remembered: remembered.map((f) => f.text),
      historyTruncated: truncated,
      historyDropped: truncated ? dropped : 0,
    });
  } catch (e) {
    send("error", { message: e.message });
  }
  res.end();
});

// ── GET /api/chat/sessions ─────────────────────────────────────────────────
router.get("/chat/sessions", (req, res) => {
  res.json({ sessions: listChatSessions(req.userId) });
});

// ── GET /api/chat/sessions/:id ─────────────────────────────────────────────
router.get("/chat/sessions/:id", (req, res) => {
  const session = getChatSession(req.params.id, req.userId);
  if (!session) return res.status(404).json({ error: "Session not found" });
  res.json({
    id: session.id,
    title: session.title,
    messages: session.messages,
    created_at: session.created_at,
    updated_at: session.updated_at,
  });
});

// ── DELETE /api/chat/sessions/:id ──────────────────────────────────────────
router.delete("/chat/sessions/:id", (req, res) => {
  deleteChatSession(req.params.id, req.userId);
  res.json({ ok: true });
});

// ── Ori memory management (view / forget) ─────────────────────────────────
router.get("/chat/memory", (req, res) => {
  res.json({ memory: getOriMemory(req.userId) });
});

// Delete one fact by index, or all facts when no index is given.
router.delete("/chat/memory/:index", (req, res) => {
  const idx = parseInt(req.params.index, 10);
  const memory = getOriMemory(req.userId);
  if (!Number.isInteger(idx) || idx < 0 || idx >= memory.length) {
    return res.status(404).json({ error: "No such memory" });
  }
  const next = memory.filter((_, i) => i !== idx);
  patchUserSettings(req.userId, { oriMemory: next });
  res.json({ ok: true, memory: next });
});

router.delete("/chat/memory", (req, res) => {
  patchUserSettings(req.userId, { oriMemory: [] });
  res.json({ ok: true, memory: [] });
});

// ── GET /api/ori/usage ─────────────────────────────────────────────────────
// This user's Ori usage for the account panel: daily + monthly request counts
// against their limits, plus token volume and the context-cache hit rate.
router.get("/ori/usage", (req, res) => {
  res.json(getOriUsageSummary(req.userId));
});

export default router;
