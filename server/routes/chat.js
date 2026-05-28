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

const MODE_INSTRUCTIONS = {
  compounding_moat: `ANALYSIS MODE: Compounding Moat
Identify durable competitive advantages. Prioritize:
- High ROIC (>15% sustained) indicating capital-efficient compounding
- Stable/growing gross margins (>40%) signaling pricing power
- Strong and growing FCF generation
- Low debt relative to earnings (ND/EBITDA < 2)
Look for businesses with network effects, switching costs, brand power, or scale economies.
Rank the top 3-5 candidates and explain the moat source for each.`,

  emerging_disruptor: `ANALYSIS MODE: Emerging Disruptor
Identify high-growth companies disrupting traditional industries. Prioritize:
- Revenue growth trajectory and acceleration
- Expanding margins (even if currently low)
- Large total addressable market (TAM)
- Technology or platform advantages
Accept higher valuations if the growth trajectory justifies them.
Flag which legacy industries each disruptor threatens.`,

  moonshot: `ANALYSIS MODE: Moonshot / High-Risk High-Reward
Identify asymmetric risk/reward opportunities:
- Undervalued turnaround stories with catalysts
- Early-stage growth with massive TAM but unproven profitability
- Companies with optionality (new products, markets, or pivots)
- Heavily discounted stocks where the market may be wrong
Be explicit about the specific risks and what could go wrong. Estimate rough upside/downside scenarios.`,

  valuation_check: `ANALYSIS MODE: Valuation Analysis
Perform rigorous valuation analysis on the filtered stocks:
- Compare PE, PB, PS, EV/EBITDA, EV/GP, FCF yield against sector medians
- Identify stocks that appear significantly over- or under-valued relative to quality
- Flag valuation anomalies (e.g., high quality + low valuation = potential opportunity)
- Consider whether current multiples are justified by growth or quality differentials
Present a clear table of the most over- and under-valued stocks with reasoning.`,

  hold_duration: `ANALYSIS MODE: Hold Duration Analysis
Analyze stocks through the lens of investment time horizon:
SHORT-TERM (1-6 months): Focus on momentum, upcoming earnings catalysts, technical support levels, and near-term sentiment drivers.
MEDIUM-TERM (1-3 years): Focus on earnings growth trajectory, margin expansion potential, and business cycle positioning.
LONG-TERM (3-5+ years): Focus on competitive moat durability, secular tailwinds, reinvestment runway, and management quality.
Categorize each recommended stock by its optimal holding period and explain why.`,

  general: "",
};

function buildSystemPrompt(mode, context) {
  const { filters, weights, stocks, focusSymbols, availableSectors, availableIndustries } = context || {};

  let prompt = `You are Ori, a senior equity research analyst with deep expertise in fundamental analysis. You have access to the user's Orizen filtered stock universe.

IMPORTANT: Always provide a disclaimer that this is analysis for informational purposes, not financial advice.

SCREENER CONTEXT:
- Stocks in view: ${stocks?.length || 0}
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

  const modeInstr = MODE_INSTRUCTIONS[mode] || MODE_INSTRUCTIONS.general;
  if (modeInstr) prompt += "\n" + modeInstr + "\n";

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

=== SCREENER RECOMMENDATIONS ===
You have two tools: filters and weights. Use both.

When the user expresses a preference (e.g. "DCA friendly", "emerging disruptor", "high quality", "focus on value"), you should usually recommend changes to the weights in addition to filters.

Current weights are shown above. When relevant, output this at the very end of your response:

\`\`\`json
{
  "recommendFilters": {...},
  "recommendWeights": { "q": 30, "v": 45, "g": 25 }
}
\`\`\`

Then ask the user if they want to apply it.

**Strongly prefer recommending weight changes** (via \`recommendWeights\`) when the user's language suggests they want more emphasis on quality, value, or growth — even without them saying the word "weight".
**Never apply changes yourself.** Always show the recommendation and ask for confirmation.
`;

  return prompt;
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
    const { sessionId, message, mode, context } = req.body;
    const systemPrompt = buildSystemPrompt(mode || "general", context);

    let session = sessionId ? getChatSession(sessionId, req.userId) : null;
    const messages = session ? JSON.parse(session.messages) : [];
    messages.push({ role: "user", content: message });

    // Convert stored messages to Gemini format (role: 'model' instead of 'assistant')
    const geminiContents = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: geminiContents,
          generationConfig: { maxOutputTokens: 4096 }
        }),
      },
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      send("error", {
        message: `Gemini API error ${geminiRes.status}: ${errText}`,
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
