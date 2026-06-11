import { Router } from "express";
import {
  saveChatSession,
  getChatSession,
  listChatSessions,
  deleteChatSession,
  getUserSettings,
  patchUserSettings,
  getUserByUsername,
} from "../db.js";
import { fmt } from "./prompt-helpers.js";
import { marketStatusLine } from "../marketHours.js";

const router = Router();

// ── Plan gating ─────────────────────────────────────────────────────────────
// Ori (the chat itself) is the Pro-tier feature: free accounts get the full
// screener/research experience, Pro ($10/month) unlocks Ori. Admins always
// have access, as do the legacy single-user/env-auth modes (no user rows).
function hasOriAccess(userId) {
  if (!userId || userId === "default") return true; // auth disabled (local dev)
  try {
    const user = getUserByUsername(userId);
    if (!user) return true; // legacy AUTH_PASSWORD session — no DB user rows
    return !!user.is_admin || user.plan === "pro";
  } catch {
    return false;
  }
}

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
    total > shown
      ? `${total} (showing the top ${shown} by Orizin Score below)`
      : `${shown}`;

  let prompt = `You are Ori, a senior equity research analyst with deep expertise in fundamental analysis. You have access to the user's Orizin filtered stock universe.

Today's date: ${today || "unknown"}.
Market status: ${marketStatusLine()}. Factor this in when discussing prices ("as of Friday's close", "the market is open right now, intraday moves may continue", etc.).
${username && username !== "default" ? `You are talking to **${username}**. Address them naturally by name occasionally (don't overdo it) and treat the portfolios, goals, theses and remembered facts below as theirs.` : ""}

IMPORTANT: Always provide a disclaimer that this is analysis for informational purposes, not financial advice.
${memory?.length ? `
=== WHAT YOU REMEMBER ABOUT THIS USER (from past conversations) ===
${memory.map((f, i) => `${i + 1}. ${f.text || f}`).join("\n")}
Apply these consistently (risk tolerance, horizon, preferences, constraints). If the user contradicts one, follow the user and update your memory.
` : ""}
=== PERSISTENT MEMORY (how to remember new things) ===
When the user states a durable preference, constraint, or fact about themselves that will matter in FUTURE conversations (e.g. "I'm a long-term investor", "I avoid tobacco stocks", "my horizon is 10+ years", "I have a high risk tolerance", "I already max out my 401k"), append a token on its own line at the very END of your reply: [[remember: <short fact>]]
- Max 2 per reply. Only genuinely durable facts — never transient context ("user asked about NVDA today"), never things already in your memory above, never your own analysis or opinions.
- The token is stripped before display; never mention or explain it.

SCREENER CONTEXT:
- Stocks in view: ${viewLine}
- Active screener: ${activeScreener || "All Stocks"}
- Current filters: ${summarizeFilters(filters)}
- Current scorecard weights: Q=${weights?.q ?? 35} (Quality), V=${weights?.v ?? 35} (Value), G=${weights?.g ?? 30} (Growth). These determine how the final Orizin Score is calculated.

Available Sectors: ${JSON.stringify(availableSectors || [])}
Available Industries: ${JSON.stringify(availableIndustries || [])}

${context && context.scorecardDefinition ? `ORIEN SCORE METHODOLOGY:\n${JSON.stringify(context.scorecardDefinition, null, 2)}\n\nNote: The table above now includes Q / V / G pillar scores (0-100) for each stock, plus the overall Score. These reflect the current weights.` : ''}
`;

  if (stocks?.length) {
    prompt += "\nSTOCK DATA:\n";
    prompt +=
      "| Sym | Sector | MCap | Price | PE | PB | EV/EB | EV/S | FCF_Y | Gross_M | Op_M | ROIC | ROE | ND/EB | D/E | Div_Y | Q | V | G | Score | Cov |\n";
    prompt +=
      "|-----|--------|------|-------|----|----|-------|------|-------|---------|------|------|-----|-------|-----|-------|-------|-------|-------|-------|-----|\n";
    const top = stocks.slice(0, 50);
    for (const s of top) {
      prompt += `| ${s.symbol} | ${(s.sector || "").slice(0, 8)} | ${fmt(s.mcap, "money")} | ${fmt(s.price, "price")} | ${fmt(s.pe, "x")} | ${fmt(s.pb, "x")} | ${fmt(s.ev_ebitda, "x")} | ${fmt(s.ev_sales, "x")} | ${fmt(s.fcf_yield, "pct")} | ${fmt(s.gross_margin, "pct")} | ${fmt(s.op_margin, "pct")} | ${fmt(s.roic, "pct")} | ${fmt(s.roe, "pct")} | ${fmt(s.net_debt_ebitda, "r")} | ${fmt(s.debt_equity, "r")} | ${fmt(s.div_yield, "pct")} | ${s.qScore != null ? Math.round(s.qScore * 100) : "—"} | ${s.vScore != null ? Math.round(s.vScore * 100) : "—"} | ${s.gScore != null ? Math.round(s.gScore * 100) : "—"} | ${s.score != null ? Math.round(s.score * 100) : "—"} | ${s.dataCoverage != null ? Math.round(s.dataCoverage * 100) + "%" : "—"} |\n`;
    }
    if (stocks.length > 50)
      prompt += `\n(Showing top 50 of ${stocks.length} by composite score)\n`;
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

  prompt += `
=== DEEP RESEARCH HANDOFF ===

Orizin has a dedicated **Deep Research** page that shows comprehensive single-stock data (full profile, key metrics, ratios, DCF, financial statements, SEC filings, price targets, insider trading, exec comp, peers, and growth).

When the user asks for a deep/comprehensive dive on ONE specific stock (e.g. "do a deep dive on NVDA", "I want to research AAPL in depth", "tell me everything about MSFT"), do the following:
1. Give a brief, useful answer first.
2. Then ASK if they'd like to open the Deep Research page for that stock, and on its own line at the very end of your message emit the token: \`[[deep-research:SYMBOL]]\` (e.g. \`[[deep-research:NVDA]]\`). The app turns this into an "Open Deep Research" button — do NOT describe the token itself.
Only emit the token when the user clearly wants an in-depth look at a single named stock. Never emit it for general/screener questions or for multiple stocks at once.

RESPONSE GUIDELINES:
- Be specific: name stocks, cite numbers from the data
- Use markdown tables and bold text for key findings
- Keep responses focused and actionable (under 800 words unless deep analysis requested)
- When comparing stocks, show side-by-side metrics

=== ORIZIN SCORE PILLAR DEFINITIONS (READ THIS CAREFULLY) ===

The Orizin Score is built from three pillars whose influence is controlled by the Q/V/G weights.

**Q (Quality) pillar** = average rank of:
- ROIC, ROE
- Gross margin, Operating margin, FCF margin
- Current ratio (higher better, capped at 3× — hoarding liquidity earns no extra credit)
- Net Debt/EBITDA and Debt/Equity (lower better)

**V (Value) pillar** = average rank of:
- EV/Gross Profit, EV/EBITDA, P/E (lower better)
- FCF Yield (higher better)
- DCF Margin of Safety (higher better)

**G (Growth) pillar** = average rank of:
- Revenue growth (TTM)
- EPS growth (TTM)
- FCF growth (TTM)

Critical mechanics Ori must understand:
- All inputs are converted to **tie-aware 0–1 percentile ranks within the currently filtered set** (not absolute numbers).
- **Junk-value guards** (protect against artificially inflated scores): negative P/E ranks WORST (loss-makers are not "cheap"); negative Debt/Equity (negative shareholder equity) ranks WORST and voids ROE; negative EV/EBITDA only counts as cheap when EBITDA is actually positive; ND/EBITDA is ignored when EBITDA is negative.
- **Missing data is imputed, not ignored**: a missing input counts as rank 0.45 (slightly below the median stock). A stock with only a few good metrics can NOT ace a pillar anymore, and a stock with no growth data can NOT outscore an identical one with mediocre growth.
- Stocks with fewer than 3 of the 16 inputs are not scored at all.
- Final score = the user's slider weights applied to the three pillars (no weight redistribution).
- Each stock carries a **Cov (data coverage)** value = fraction of the 16 inputs with real data. Treat low-coverage scores (< ~60%) with explicit skepticism and SAY SO when recommending such stocks — their score leans on neutral imputation, not evidence.

Current slider values are provided in the context as Q / V / G.
`;

const q = weights?.q ?? 35;
const v = weights?.v ?? 35;
const g = weights?.g ?? 30;
prompt += `
=== USER PREFERENCE LENS (ADAPT TO CURRENT Q/V/G WEIGHTS) ===

The user has deliberately set their Orizin Score weights to:
Q = ${q}%, V = ${v}%, G = ${g}%

This is their current explicit preference and "lens" for looking at stocks. You must adapt your tone, what you emphasize, and how critical or enthusiastic you are based on these weights:

- **High G relative to V** (especially G ≥ 55 and V ≤ 25): The user is hunting growth, disruption, and asymmetric upside. They are willing to pay higher multiples for strong revenue/EPS/FCF acceleration, large TAM, platform advantages, or optionality. Be more constructive on high-growth names even if they look expensive on traditional value metrics. Highlight momentum, scalability, and future optionality. Downplay current margins or "cheapness" unless the growth is faltering.

- **High Q** (Q ≥ 50): The user wants durable compounders. Emphasize sustained ROIC, high and stable or expanding margins (especially gross and FCF), pricing power, clean balance sheets, and long reinvestment runway. Be more skeptical of growth stories that come at the expense of capital efficiency or balance sheet risk. Moat durability and quality of earnings matter more than near-term growth rates.

- **High V** (V ≥ 50): The user is value- and margin-of-safety focused. Stress cheapness on EV/EBITDA, EV/GP, P/E, FCF yield, and DCF vs current price. Point out cases where the market is overly pessimistic relative to the fundamentals. Be cautious about "growth at any price" narratives.

- **Relatively balanced** (weights within ~15 points of each other): Provide a balanced, well-rounded view while still noting where the mild tilt points.

When discussing whether something is "attractive", "interesting", or "worth owning", always do so through the user's current weight distribution. If their weights are extreme (e.g. 80 G / 10 V / 10 Q), your analysis should feel like it is coming from a growth investor's perspective.
`;

if (view === 'portfolio-goals') {
  prompt += `
=== CURRENT MODE: PORTFOLIO ===

The user is currently on their **Portfolio** page (not the screener or deep research). This is your top priority here: help them with their goals & theses and improve their portfolio. Shift your focus accordingly:
- Center your analysis on the user's ACTUAL portfolios, holdings, allocations, concentration, diversification, risk, stated GOALS, and INVESTMENT THESES (all provided above under "USER'S ACTUAL PORTFOLIOS & GOALS").
- Prioritize concrete ways to IMPROVE the portfolio, and explain the reasoning every time: e.g. "diversify by adding exposure to X because you're 70% in tech", "trim Y because it's an oversized 25% position and overlaps with Z", "this conflicts with your stated goal of capital preservation", "this supports your thesis that …".
- When they ask "what do you think of my portfolio?", think through it holistically: position sizing, sector/factor concentration, overlap between holdings, correlation/risk, cash drag, and balance vs. their goals, theses, and risk tolerance. Call out what's working and what's a liability, and where they're over- or under-exposed.
- Tie advice back to their goals and theses explicitly. You may respectfully pressure-test a thesis, but treat it as their directional view.
- Critique and reason about existing positions first. Only suggest new names when it serves rebalancing, filling a gap, diversification, or reducing a concentration/risk problem in THEIR portfolio.
- Do NOT push a list of screener picks here unless asked. This is a "review, improve, and reason about what I own and where I'm going" surface, not a discovery surface.
`;
} else if (view === 'deep-research') {
  prompt += `
=== CURRENT MODE: DEEP RESEARCH (SINGLE STOCK) ===

The user is on the **Deep Research** page, studying ONE stock in depth${activeStock ? `: **${activeStock.symbol}** (${activeStock.name || ""})` : ""}. Everything they're looking at for that stock is provided above in its detailed section (profile, key metrics, financial ratios, DCF/valuation, analyst price targets, insider trading, RSI/technical trend, price performance, grades, and recent news). Your job here is to dig into the nitty-gritty of THIS stock:
- Go deep and specific. Pull from EVERY detail available on screen for this stock — valuation (DCF margin of safety, multiples vs. history/peers), quality (ROIC, margins, balance sheet), growth, capital allocation, analyst targets, insider activity, technicals/RSI, and what the recent news implies.
- Synthesize: what's the bull case, the bear case, the key risks, and what would change your mind. Reference the actual numbers shown, not generalities.
- Frame conclusions through the user's Q/V/G lens and, where relevant, their portfolio/goals/theses (e.g. how this fits or conflicts).
- Stay focused on this one stock unless the user explicitly asks to compare or zoom out. Do NOT emit screener filter recommendations here unless they explicitly ask to go filter the universe.
`;
} else {
  prompt += `
=== CURRENT MODE: SCREENER ===

The user is currently on the **Screener** page. This is your strength here: filtering and recommending stocks. Your job is to surface and recommend stocks from the filtered universe that **complement their existing portfolio and goals**:
- Lean into discovery: highlight attractive names in view, explain why they fit the user's Q/V/G lens, and how they'd add to (rather than duplicate) what they already own.
- Always cross-reference the user's ACTUAL portfolios, goals & theses above so recommendations reduce overlap/concentration and move them toward their objectives — never suggest names that simply double down on an already-crowded position or that conflict with their risk goals.
- When they ask to narrow/refine the set, propose concrete filter changes (per the rules below) and ask to apply them.
`;
}

prompt += `
=== SCREENER RECOMMENDATIONS (FILTERS ONLY) ===

You can **only** recommend changes to filters. You must **never** suggest changes to the Q/V/G scorecard weights.

The Q/V/G weights are controlled exclusively by the user via the sliders at the top of the screen. Do not output "recommendWeights", "applyWeights", or any weight suggestions.

When the user explicitly asks to narrow, refine, tighten, or adjust the set of stocks in view (e.g. "narrow this down", "show me only", "filter to", "remove the high debt ones", "more quality names", "growthier companies", "better value stocks"), you may suggest filter changes.

If the user wants more emphasis on Quality, Growth, or Value while narrowing results, translate that preference into **filters**, for example:
- More Quality → higher roicMin, higher grossMin / opMin / fcfMargMin, lower deMax or ndMax, higher crMin, etc.
- More Growth → higher revGrowthMin, epsGrowthMin, fcfGrowthMin, opIncGrowthMin, or r40Min.
- More Value → lower peMax, pbMax, evEbMax, or higher fcfMin / evGpMax / earningsYieldMin, etc.

Use either the classic flat keys **or** the new flexible operator format for numeric filters.

Classic examples: "priceMin": 25, "mcapMax": 50, "betaMin": 0.8

New flexible format (preferred when you want exact control) — IMPORTANT: use the
SAME key names as the classic format (roicMin, peMax, grossMin, …). Do NOT invent
base keys like "roic" or "pe":
- Single condition: \` "peMax": { "op": "<", "value": 25 } \` or \` "roicMin": { "op": ">=", "value": 15 } \`
- Ranges use the base keys mcap / price / beta: \` "mcap": { "op": "between", "min": 5, "max": 30 } \`

Supported operators: ">", ">=", "<", "<=", "=", "between"

You can mix both styles in the same recommendFilters object.

UNITS (critical — get these right):
- \`mcapMin\` / \`mcapMax\` are in **billions of USD**. For a $2 billion floor, output \`"mcapMin": 2\` — NOT \`2000000000\`. For a $50B ceiling, \`"mcapMax": 50\`.
- \`volMin\` is in **millions** of shares (e.g. \`"volMin": 1\` = 1,000,000).
- Percentage filters (roicMin, grossMin, opMin, fcfMin, divMin, earningsYieldMin, growth mins like opIncGrowthMin, etc.) are whole-number percents (e.g. \`"roicMin": 15\` = 15%).
- Ratio/multiple filters (peMax, pbMax, evEbMax, deMax, ndMax, crMin, beta) are plain numbers (e.g. \`"peMax": 20\`).
- \`priceMin\` / \`priceMax\` are in **USD** (e.g. \`"priceMin": 25\` for stocks ≥ $25).

Output recommendations at the very end of your response in this exact shape:

\`\`\`json
{
  "recommendFilters": {
    "roicMin": 15,
    "deMax": 0.3,
    "opMin": 12,
    "sectors": ["Technology", "Healthcare"]
  }
}
\`\`\`

Then explicitly ask the user if they want to apply the filters.

IMPORTANT reliability rules for this block:
- Whenever the user asks to narrow, refine, tighten, filter, or change the set of stocks in view, you **must** end your response with the \`recommendFilters\` JSON block. Don't describe filters only in prose — always emit the block so the Apply / Don't-apply buttons appear.
- Keep the surrounding analysis **concise** when you are recommending filters, so the JSON block is reliably included and never cut off.
- The JSON block must be the **last thing** in your response.
**Never** recommend weight changes. **Never** emit this block unprompted on pure analysis questions.
**Never apply changes yourself.** Always show the recommendation and ask for confirmation.
`;

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
- Orizin Score: ${s.score != null ? Math.round(s.score * 100) : "—"} (Q ${s.qScore != null ? Math.round(s.qScore * 100) : "—"}, V ${s.vScore != null ? Math.round(s.vScore * 100) : "—"}, G ${s.gScore != null ? Math.round(s.gScore * 100) : "—"})${s.dataCoverage != null ? ` · data coverage ${Math.round(s.dataCoverage * 100)}%${s.dataCoverage < 0.6 ? " (LOW — score leans on imputation, be skeptical)" : ""}` : ""}
- RSI(10): ${rsiNote}${s.rsiTrend ? ` — ${s.rsiTrend.direction} (${s.rsiTrend.change5d >= 0 ? "+" : ""}${s.rsiTrend.change5d.toFixed(1)} over ~5 sessions)` : ""}`;

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
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:streamGenerateContent?alt=sse";
const MAX_GEMINI_RETRIES = 3;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function backoffDelay(attempt) {
  // 500ms, 1s, 2s (+ up to 250ms jitter)
  return 500 * 2 ** attempt + Math.random() * 250;
}

function isOverloaded(status, bodyText) {
  if (status === 429 || status === 503) return true;
  if (status >= 500 && /unavailable|overloaded|try again/i.test(bodyText || ""))
    return true;
  return false;
}

// Resolves to { res } on success, or { friendly, status, body } when the call
// ultimately failed (friendly=true means it was an overload we should phrase nicely).
async function fetchGeminiWithRetry({ apiKey, body, send }) {
  let lastStatus = 0;
  let lastBody = "";

  for (let attempt = 0; attempt <= MAX_GEMINI_RETRIES; attempt++) {
    let res;
    try {
      res = await fetch(GEMINI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-goog-api-key": apiKey },
        body: JSON.stringify(body),
      });
    } catch (e) {
      // Network-level failure — treat as retryable.
      lastStatus = 0;
      lastBody = e?.message || String(e);
      if (attempt < MAX_GEMINI_RETRIES) {
        send("status", { message: "Ori is busy — retrying…" });
        await sleep(backoffDelay(attempt));
        continue;
      }
      return { friendly: true, status: 0, body: lastBody };
    }

    if (res.ok) return { res };

    lastBody = await res.text();
    lastStatus = res.status;

    if (isOverloaded(res.status, lastBody) && attempt < MAX_GEMINI_RETRIES) {
      send("status", { message: "Ori is busy — retrying…" });
      await sleep(backoffDelay(attempt));
      continue;
    }

    // Non-retryable error, or out of retries.
    return {
      friendly: isOverloaded(lastStatus, lastBody),
      status: lastStatus,
      body: lastBody,
    };
  }

  return {
    friendly: isOverloaded(lastStatus, lastBody),
    status: lastStatus,
    body: lastBody,
  };
}

// ── POST /api/chat ─────────────────────────────────────────────────────────
router.post("/chat", async (req, res) => {
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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "your_gemini_api_key_here") {
    return res.status(503).json({
      error:
        "GEMINI_API_KEY not configured. Add your Gemini API key to .env to enable AI chat.",
    });
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

    const systemPrompt = buildSystemPrompt(context, {
      username: req.userId,
      memory: getOriMemory(req.userId),
    });

    // Look the session up scoped to this user. If the id doesn't resolve (stale
    // client state, or an id belonging to a different user), mint a fresh id —
    // the upsert would otherwise silently overwrite the other user's session.
    let session = sessionId ? getChatSession(sessionId, req.userId) : null;
    const messages = session ? JSON.parse(session.messages) : [];
    messages.push({ role: "user", content: userMessage });

    // Convert stored messages to Gemini format (role: 'model' instead of 'assistant')
    const geminiContents = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const { res: geminiRes, friendly, status, body: errBody } =
      await fetchGeminiWithRetry({
        apiKey,
        body: {
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: geminiContents,
          generationConfig: { maxOutputTokens: 8192 },
        },
        send,
      });

    if (!geminiRes) {
      send("error", {
        message: friendly
          ? "Ori is experiencing high demand right now. Please try again in a moment."
          : `Gemini API error ${status || ""}: ${errBody || "request failed"}`.trim(),
      });
      res.end();
      return;
    }

    const reader = geminiRes.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let fullResponse = "";

    while (true) {
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
  res.json(session);
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

export default router;
