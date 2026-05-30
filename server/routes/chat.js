import { Router } from "express";
import {
  saveChatSession,
  getChatSession,
  listChatSessions,
  deleteChatSession,
  getAiEnrichmentBatch,
} from "../db.js";
import { fmt } from "./prompt-helpers.js";

const router = Router();

// Tool definition: Allow Ori to control the screener filters
// Note: We are using JSON output in the response text instead of native tool calling
// for better reliability with Gemini.

function buildSystemPrompt(context) {
  const {
    filters, weights, stocks, focusSymbols, availableSectors, availableIndustries,
    activeStock, today, totalFiltered, activeScreener, pinnedStocks,
  } = context || {};

  const shown = stocks?.length || 0;
  const total = totalFiltered ?? shown;
  const viewLine =
    total > shown
      ? `${total} (showing the top ${shown} by Orizen Score below)`
      : `${shown}`;

  let prompt = `You are Ori, a senior equity research analyst with deep expertise in fundamental analysis. You have access to the user's Orizen filtered stock universe.

Today's date: ${today || "unknown"}.

IMPORTANT: Always provide a disclaimer that this is analysis for informational purposes, not financial advice.

SCREENER CONTEXT:
- Stocks in view: ${viewLine}
- Active screener: ${activeScreener || "All Stocks"}
- Current filters: ${summarizeFilters(filters)}
- Current scorecard weights: Q=${weights?.q ?? 35} (Quality), V=${weights?.v ?? 35} (Value), G=${weights?.g ?? 30} (Growth). These determine how the final Orizen Score is calculated.

Available Sectors: ${JSON.stringify(availableSectors || [])}
Available Industries: ${JSON.stringify(availableIndustries || [])}

${context && context.scorecardDefinition ? `ORIEN SCORE METHODOLOGY:\n${JSON.stringify(context.scorecardDefinition, null, 2)}\n\nNote: The table above now includes Q / V / G pillar scores (0-100) for each stock, plus the overall Score. These reflect the current weights.` : ''}
`;

  if (stocks?.length) {
    prompt += "\nSTOCK DATA:\n";
    prompt +=
      "| Sym | Sector | MCap | Price | PE | PB | EV/EB | EV/S | FCF_Y | Gross_M | Op_M | ROIC | ROE | ND/EB | D/E | Div_Y | Q | V | G | Score |\n";
    prompt +=
      "|-----|--------|------|-------|----|----|-------|------|-------|---------|------|------|-----|-------|-----|-------|-------|-------|-------|-------|\n";
    const top = stocks.slice(0, 50);
    for (const s of top) {
      prompt += `| ${s.symbol} | ${(s.sector || "").slice(0, 8)} | ${fmt(s.mcap, "money")} | ${fmt(s.price, "price")} | ${fmt(s.pe, "x")} | ${fmt(s.pb, "x")} | ${fmt(s.ev_ebitda, "x")} | ${fmt(s.ev_sales, "x")} | ${fmt(s.fcf_yield, "pct")} | ${fmt(s.gross_margin, "pct")} | ${fmt(s.op_margin, "pct")} | ${fmt(s.roic, "pct")} | ${fmt(s.roe, "pct")} | ${fmt(s.net_debt_ebitda, "r")} | ${fmt(s.debt_equity, "r")} | ${fmt(s.div_yield, "pct")} | ${s.qScore != null ? Math.round(s.qScore * 100) : "—"} | ${s.vScore != null ? Math.round(s.vScore * 100) : "—"} | ${s.gScore != null ? Math.round(s.gScore * 100) : "—"} | ${s.score != null ? Math.round(s.score * 100) : "—"} |\n`;
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

  if (activeStock) {
    prompt += "\n" + buildActiveStockSection(activeStock) + "\n";
  }

  prompt += `
RESPONSE GUIDELINES:
- Be specific: name stocks, cite numbers from the data
- Use markdown tables and bold text for key findings
- Keep responses focused and actionable (under 800 words unless deep analysis requested)
- When comparing stocks, show side-by-side metrics

=== ORIEN SCORE PILLAR DEFINITIONS (READ THIS CAREFULLY) ===

The Orizen Score is built from three pillars whose influence is controlled by the Q/V/G weights.

**Q (Quality) pillar** = average rank of:
- ROIC, ROE
- Gross margin, Operating margin, FCF margin
- Current ratio (higher better)
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
- All inputs are converted to **relative 0–1 ranks within the currently filtered set** (not absolute numbers).
- Each pillar is the average of its components.
- Final score = weighted average. If a stock has no data for a pillar, that weight is dropped and redistributed (this is why "Effective Weights" on cards can differ from the sliders).

Current slider values are provided in the context as Q / V / G.
`;

const q = weights?.q ?? 35;
const v = weights?.v ?? 35;
const g = weights?.g ?? 30;
prompt += `
=== USER PREFERENCE LENS (ADAPT TO CURRENT Q/V/G WEIGHTS) ===

The user has deliberately set their Orizen Score weights to:
Q = ${q}%, V = ${v}%, G = ${g}%

This is their current explicit preference and "lens" for looking at stocks. You must adapt your tone, what you emphasize, and how critical or enthusiastic you are based on these weights:

- **High G relative to V** (especially G ≥ 55 and V ≤ 25): The user is hunting growth, disruption, and asymmetric upside. They are willing to pay higher multiples for strong revenue/EPS/FCF acceleration, large TAM, platform advantages, or optionality. Be more constructive on high-growth names even if they look expensive on traditional value metrics. Highlight momentum, scalability, and future optionality. Downplay current margins or "cheapness" unless the growth is faltering.

- **High Q** (Q ≥ 50): The user wants durable compounders. Emphasize sustained ROIC, high and stable or expanding margins (especially gross and FCF), pricing power, clean balance sheets, and long reinvestment runway. Be more skeptical of growth stories that come at the expense of capital efficiency or balance sheet risk. Moat durability and quality of earnings matter more than near-term growth rates.

- **High V** (V ≥ 50): The user is value- and margin-of-safety focused. Stress cheapness on EV/EBITDA, EV/GP, P/E, FCF yield, and DCF vs current price. Point out cases where the market is overly pessimistic relative to the fundamentals. Be cautious about "growth at any price" narratives.

- **Relatively balanced** (weights within ~15 points of each other): Provide a balanced, well-rounded view while still noting where the mild tilt points.

When discussing whether something is "attractive", "interesting", or "worth owning", always do so through the user's current weight distribution. If their weights are extreme (e.g. 80 G / 10 V / 10 Q), your analysis should feel like it is coming from a growth investor's perspective.
`;

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

New flexible format (preferred when you want exact control):
- Single condition: `"price": { "op": ">", "value": 30 }`
- Between: `"mcap": { "op": "between", "min": 5, "max": 30 }`

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

// Renders the stock the user currently has open in the detail pane, with the
// extra data (company profile, FMP ratings, analyst grades, RSI) that isn't in
// the screener table — so Ori can speak directly to what they're looking at.
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
- Orizen Score: ${s.score != null ? Math.round(s.score * 100) : "—"} (Q ${s.qScore != null ? Math.round(s.qScore * 100) : "—"}, V ${s.vScore != null ? Math.round(s.vScore * 100) : "—"}, G ${s.gScore != null ? Math.round(s.gScore * 100) : "—"})
- RSI(10): ${rsiNote}${s.rsiTrend ? ` — ${s.rsiTrend.direction} (${s.rsiTrend.change5d >= 0 ? "+" : ""}${s.rsiTrend.change5d.toFixed(1)} over ~5 sessions)` : ""}`;

  if (s.performance) {
    const p = s.performance;
    out += `\n- Price performance: 1mo ${fmt(p.m1, "pct")}, 3mo ${fmt(p.m3, "pct")}, 6mo ${fmt(p.m6, "pct")}, 1yr ${fmt(p.y1, "pct")}`;
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

  return out;
}

function summarizeFilters(f) {
  if (!f) return "none";
  const parts = [];
  if (f.sectors?.length) parts.push(`sectors: ${f.sectors.join(", ")}`);
  if (f.industries?.length)
    parts.push(`industries: ${f.industries.join(", ")}`);
  if (f.mcapMin) parts.push(`mcap >= $${f.mcapMin}B`);
  if (f.mcapMax) parts.push(`mcap <= $${f.mcapMax}B`);
  if (f.roicMin) parts.push(`ROIC >= ${f.roicMin}%`);
  if (f.peMax) parts.push(`PE <= ${f.peMax}`);
  if (f.evEbMax) parts.push(`EV/EBITDA <= ${f.evEbMax}`);
  if (f.fcfMin) parts.push(`FCF yield >= ${f.fcfMin}%`);
  if (f.grossMin) parts.push(`gross margin >= ${f.grossMin}%`);
  return parts.length ? parts.join(", ") : "default (mcap >= $2B)";
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
    const { sessionId, message, context } = req.body;
    const systemPrompt = buildSystemPrompt(context);

    let session = sessionId ? getChatSession(sessionId, req.userId) : null;
    const messages = session ? JSON.parse(session.messages) : [];
    messages.push({ role: "user", content: message });

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

    messages.push({ role: "assistant", content: fullResponse });
    const sid = sessionId || `${req.userId}_chat_${Date.now()}`;
    saveChatSession({
      id: sid,
      user_id: req.userId,
      title: message.slice(0, 60),
      messages: JSON.stringify(messages),
      created_at: session?.created_at || Date.now(),
      updated_at: Date.now(),
    });
    send("done", { sessionId: sid });
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

export default router;
