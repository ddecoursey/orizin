import { useState, useRef, useEffect } from "react";
import { m, useReducedMotion } from "../lib/motion.js";
import OriEmblem from "./OriEmblem.jsx";
import { IconResearch } from "./icons.jsx";
import { PRO_PRICE_LABEL, PRO_FEATURES } from "../lib/billing.js";

function relTime(ts) {
  if (!ts) return "";
  const mins = Math.round((Date.now() - Number(ts)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(Number(ts)).toLocaleDateString();
}

function Markdown({ text }) {
  const html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // code blocks
    .replace(
      /```(\w*)\n([\s\S]*?)```/g,
      '<pre class="bg-gray-950 rounded p-2 my-2 text-xs overflow-x-auto"><code>$2</code></pre>',
    )
    // inline code
    .replace(
      /`([^`]+)`/g,
      '<code class="bg-gray-800 px-1 rounded text-xs">$1</code>',
    )
    // headers
    .replace(
      /^### (.+)$/gm,
      '<h3 class="text-sm font-bold text-gray-200 mt-3 mb-1">$1</h3>',
    )
    .replace(
      /^## (.+)$/gm,
      '<h2 class="text-sm font-bold text-gray-100 mt-3 mb-1">$1</h2>',
    )
    .replace(
      /^# (.+)$/gm,
      '<h1 class="text-base font-bold text-gray-100 mt-3 mb-1">$1</h1>',
    )
    // bold
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-gray-100">$1</strong>')
    // italic
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // table rows
    .replace(/^\|(.+)\|$/gm, (match) => {
      const cells = match.split("|").filter((c) => c.trim());
      if (cells.every((c) => /^[\s\-:]+$/.test(c))) return "";
      const tag = "td";
      const row = cells
        .map(
          (c) =>
            `<${tag} class="px-2 py-1 border-b border-gray-800 text-xs whitespace-nowrap">${c.trim()}</${tag}>`,
        )
        .join("");
      return `<tr>${row}</tr>`;
    })
    // wrap consecutive tr's in table
    .replace(
      /((<tr>.*<\/tr>\n?)+)/g,
      '<div class="overflow-x-auto my-2"><table class="w-full border-collapse border border-gray-800 text-xs">$1</table></div>',
    )
    // bullet lists
    .replace(/^[-*] (.+)$/gm, '<li class="ml-4 text-xs">$1</li>')
    .replace(/((<li[^>]*>.*<\/li>\n?)+)/g, '<ul class="list-disc my-1">$1</ul>')
    // numbered lists
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 text-xs">$1</li>')
    // paragraphs
    .replace(/\n\n/g, '</p><p class="mb-2">')
    .replace(/\n/g, "<br/>");

  return (
    <div
      className="text-xs text-gray-300 leading-relaxed prose-sm"
      dangerouslySetInnerHTML={{ __html: `<p class="mb-2">${html}</p>` }}
    />
  );
}

// Empty-state copy + starter prompts tailored to the page Ori is open on.
function pageHints(view, symbol) {
  if (view === "deep-research") {
    const s = symbol || "this stock";
    return {
      tagline: "Digs into the stock on screen — valuation, quality, risks, news.",
      suggestions: [
        `Walk me through ${s}'s bull and bear case`,
        `What do the numbers say about ${s}'s valuation?`,
        `What are the key risks for ${s} right now?`,
        `Does ${s} fit my goals and theses?`,
      ],
    };
  }
  if (view === "portfolio-goals") {
    return {
      tagline: "Helps with your goals, theses, and improving your portfolio.",
      suggestions: [
        "What do you think of my portfolio?",
        "Where am I over-concentrated, and how do I diversify?",
        "Does my portfolio match my goals and theses?",
        "What should I trim or add, and why?",
      ],
    };
  }
  // screener (default)
  return {
    tagline: "Suggests filters. Never touches your Q/V/G weights. Always asks first.",
    suggestions: [
      "What looks interesting here given my current weights?",
      "Narrow to higher growth companies",
      "Narrow to high-quality compounders",
      "Which of these best complement my portfolio?",
    ],
  };
}

// Upgrade card shown to free-tier users in place of the chat.
// Primary flow: Logged-in free users click "Upgrade to Pro" in the profile dropdown
// (opens PayPal hosted checkout in a modal). This is now set up for proper
// checkout (not just donate). After payment, admin can flip the user to "pro"
// in User Management (or add webhook for auto-upgrade later).
// The old donate link is kept as fallback.
function ProPaywall({ onUpgradeToPro }) {
  return (
    <div className="m-3 rounded-xl border border-violet-800/50 bg-gradient-to-b from-violet-950/40 to-gray-900 p-4">
      <div className="flex items-center gap-2 mb-2">
        <OriEmblem className="w-7 h-7 text-violet-400" />
        <div>
          <div className="text-sm font-bold text-gray-100">Unlock Ori with Pro</div>
          <div className="text-[11px] text-violet-300 font-semibold">{PRO_PRICE_LABEL}</div>
        </div>
      </div>
      <ul className="space-y-1 mb-3">
        {PRO_FEATURES.map((feat) => (
          <li key={feat} className="text-[11px] text-gray-300 flex items-start gap-1.5">
            <span className="text-violet-400 shrink-0">✦</span>
            <span>{feat}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onUpgradeToPro && onUpgradeToPro();
        }}
        className="block w-full text-center px-3 py-2 rounded-lg text-xs font-semibold text-white bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-500 hover:brightness-110 transition-all"
      >
        Upgrade — pay {PRO_PRICE_LABEL} via PayPal
      </button>
      <p className="text-[10px] text-gray-500 mt-2 leading-snug">
        Uses PayPal sandbox for testing. After subscribing, you’ll be upgraded to Pro.
      </p>
    </div>
  );
}

// `floating` — render as a fixed overlay on ALL breakpoints instead of taking
// a flex column. Used when both compare panes are open on the screener: three
// static 24rem columns don't fit, the chat got pushed off-screen and its close
// button became unreachable. Floating keeps it on top and dismissable.
export default function ChatPanel({ chat, canUseOri = true, floating = false, elevated = false, onUpgradeToPro }) {
  const overlayMode = floating || elevated;
  const reduce = useReducedMotion();
  const hints = pageHints(chat.view, chat.activeSymbol);
  const [input, setInput] = useState("");
  const [showRecall, setShowRecall] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [showMemory, setShowMemory] = useState(false);
  const [memory, setMemory] = useState([]);
  // Shell-style history: index into prior user messages, null = current draft.
  const [histIdx, setHistIdx] = useState(null);
  const messagesEndRef = useRef(null);
  const lastMsgRef = useRef(null);
  const prevLenRef = useRef(0);
  const inputRef = useRef(null);

  // When a new message is added (the user sends and Ori's reply begins), scroll
  // so the START of the latest message is at the top — the user reads Ori's
  // answer from the beginning instead of being yanked to the bottom each token.
  useEffect(() => {
    if (chat.messages.length > prevLenRef.current) {
      lastMsgRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    prevLenRef.current = chat.messages.length;
  }, [chat.messages.length]);

  useEffect(() => {
    if (chat.isOpen) inputRef.current?.focus();
  }, [chat.isOpen]);

  function handleSend() {
    if (!input.trim() || chat.isStreaming) return;
    chat.sendMessage(input);
    setInput("");
    setHistIdx(null);
  }

  // Up/Down arrows recall previously-sent questions (most recent first).
  function handleInputKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }
    const history = chat.messages.filter((m) => m.role === "user").map((m) => m.content);
    if (!history.length) return;

    if (e.key === "ArrowUp") {
      e.preventDefault();
      const next = histIdx === null ? history.length - 1 : Math.max(0, histIdx - 1);
      setHistIdx(next);
      setInput(history[next]);
    } else if (e.key === "ArrowDown") {
      if (histIdx === null) return;
      e.preventDefault();
      const next = histIdx + 1;
      if (next >= history.length) {
        setHistIdx(null);
        setInput("");
      } else {
        setHistIdx(next);
        setInput(history[next]);
      }
    }
  }

  async function refreshSessions() {
    const list = chat.listSessions ? await chat.listSessions() : [];
    setSessions(list);
  }

  async function toggleRecall() {
    if (showRecall) { setShowRecall(false); return; }
    setShowMemory(false);
    await refreshSessions();
    setShowRecall(true);
  }

  async function toggleMemory() {
    if (showMemory) { setShowMemory(false); return; }
    setShowRecall(false);
    const facts = chat.listMemory ? await chat.listMemory() : [];
    setMemory(facts);
    setShowMemory(true);
  }

  async function handleForgetFact(index) {
    const next = await chat.deleteMemory?.(index);
    setMemory(next || []);
  }

  async function handleForgetAll() {
    await chat.clearMemory?.();
    setMemory([]);
  }

  function handleLoadSession(id) {
    chat.loadSession?.(id);
    setShowRecall(false);
  }

  async function handleDeleteSession(e, id) {
    e.stopPropagation();
    if (chat.deleteSession) await chat.deleteSession(id);
    await refreshSessions();
  }

  return (
    <>
      {/* Backdrop on tablet/phone where the sheet floats over the content
          (and on all sizes when the panel is in floating overlay mode) */}
      <m.div
        className={`fixed inset-0 ${overlayMode ? "z-[60]" : "z-40"} bg-black/50 touch-none ${overlayMode ? "" : "lg:hidden"}`}
        onClick={() => chat.setIsOpen(false)}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
      />
      <m.aside
        initial={reduce ? { opacity: 0 } : { opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className={
          overlayMode
            ? `fixed inset-x-0 bottom-0 z-[70] max-h-[min(52vh,440px)] rounded-t-2xl shadow-2xl border-t border-gray-700
              lg:inset-x-auto lg:inset-y-0 lg:right-0 lg:max-h-none lg:w-96 lg:rounded-none lg:border-t-0
              bg-gray-900 border-l border-gray-700 flex flex-col overflow-hidden`
            : `fixed inset-x-0 bottom-0 z-50 max-h-[min(52vh,440px)] rounded-t-2xl shadow-2xl border-t border-gray-700
              lg:static lg:z-auto lg:w-96 lg:max-w-none lg:shadow-none lg:rounded-none lg:border-t-0 lg:max-h-none lg:h-full
              shrink-0 bg-gray-900 border-l border-gray-800 flex flex-col overflow-hidden`
        }
      >
      {/* Grab handle — bottom-sheet dismiss affordance (mobile only) */}
      <button
        onClick={() => chat.setIsOpen(false)}
        className="lg:hidden mx-auto mt-1.5 mb-0.5 h-1 w-8 rounded-full bg-gray-700 shrink-0"
        aria-label="Close Ori"
      />
      {/* Header */}
      <div className="relative px-3 py-2 lg:py-2.5 border-b border-gray-800 flex items-center gap-2">
        {/* "Landing" pop — Ori arrives in the header right after the launch arc */}
        <m.div
          className="shrink-0"
          initial={reduce ? false : { scale: 0, rotate: -90 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 20, delay: 0.08 }}
        >
          <OriEmblem className="w-5 h-5 text-violet-400" />
        </m.div>
        <span className="text-sm font-bold text-gray-100">Ori</span>
        <span className="text-[10px] text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
          {chat.stockCount} stocks in view
        </span>
        <div className="ml-auto flex gap-1">
          <button
            onClick={toggleMemory}
            className={`text-[10px] px-2 py-1.5 lg:px-1.5 lg:py-1 rounded hover:bg-gray-800 cursor-pointer ${showMemory ? "text-gray-200 bg-gray-800" : "text-gray-500 hover:text-gray-300"}`}
            title="What Ori remembers about you"
          >
            Memory
          </button>
          <button
            onClick={toggleRecall}
            className={`text-[10px] px-2 py-1.5 lg:px-1.5 lg:py-1 rounded hover:bg-gray-800 cursor-pointer ${showRecall ? "text-gray-200 bg-gray-800" : "text-gray-500 hover:text-gray-300"}`}
            title="Recall a past conversation"
          >
            Recall
          </button>
          <button
            onClick={chat.clearChat}
            className="text-[10px] text-gray-500 hover:text-gray-300 px-2 py-1.5 lg:px-1.5 lg:py-1 rounded hover:bg-gray-800 cursor-pointer"
            title="Clear chat"
          >
            Clear
          </button>
          <button
            onClick={() => chat.setIsOpen(false)}
            className="text-gray-500 hover:text-gray-300 px-2.5 py-1 text-base lg:text-sm lg:px-1.5 cursor-pointer"
            title="Close"
          >
            ×
          </button>
        </div>

        {/* Memory dropdown — durable facts Ori has learned about this user */}
        {showMemory && (
          <div className="absolute right-2 top-full mt-1 w-72 max-w-[calc(100%-1rem)] max-h-64 lg:max-h-80 overflow-y-auto bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50 oz-pop">
            <div className="px-3 py-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-800 sticky top-0 bg-gray-900">
              <span>Ori remembers</span>
              {memory.length > 0 && (
                <button
                  onClick={handleForgetAll}
                  className="text-red-400/80 hover:text-red-300 normal-case tracking-normal"
                  title="Forget everything"
                >
                  Forget all
                </button>
              )}
            </div>
            {memory.length === 0 ? (
              <div className="px-3 py-4 text-xs text-gray-600 text-center">
                Nothing yet. Tell Ori about your investing style, horizon, or
                constraints and it will remember for future conversations.
              </div>
            ) : (
              memory.map((f, i) => (
                <div
                  key={i}
                  className="group flex items-start gap-2 px-3 py-2 border-b border-gray-800/50"
                >
                  <span className="text-violet-400/80 text-[10px] mt-0.5 shrink-0">◆</span>
                  <span className="flex-1 text-xs text-gray-300 leading-snug">{f.text || String(f)}</span>
                  <button
                    onClick={() => handleForgetFact(i)}
                    className="text-gray-600 hover:text-red-400 px-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity shrink-0"
                    title="Forget this"
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {/* Recall dropdown — past conversations (server-persisted per user) */}
        {showRecall && (
          <div className="absolute right-2 top-full mt-1 w-72 max-w-[calc(100%-1rem)] max-h-64 lg:max-h-80 overflow-y-auto bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50 oz-pop">
            <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-gray-500 border-b border-gray-800 sticky top-0 bg-gray-900">
              Past conversations
            </div>
            {sessions.length === 0 ? (
              <div className="px-3 py-4 text-xs text-gray-600 text-center">
                No saved conversations yet.
              </div>
            ) : (
              sessions.map((s) => (
                <div
                  key={s.id}
                  onClick={() => handleLoadSession(s.id)}
                  className="group flex items-center gap-2 px-3 py-2 hover:bg-gray-800 cursor-pointer border-b border-gray-800/50"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-gray-200 truncate">{s.title || "Untitled"}</div>
                    <div className="text-[10px] text-gray-600">{relTime(s.updated_at)}</div>
                  </div>
                  <button
                    onClick={(e) => handleDeleteSession(e, s.id)}
                    className="text-gray-600 hover:text-red-400 px-2 py-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity"
                    title="Delete conversation"
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Error banner */}
      {chat.error && (
        <div className="px-3 py-2 bg-red-900/30 border-b border-red-800/50 text-xs text-red-300">
          {chat.error}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-2 lg:py-3 space-y-2 lg:space-y-3">
        {!canUseOri && <ProPaywall onUpgradeToPro={onUpgradeToPro} />}
        {canUseOri && chat.messages.length === 0 && (
          <div className="text-center py-6 lg:py-10 text-gray-600">
            <OriEmblem className="w-10 h-10 mx-auto mb-2 text-violet-400/90" />
            <p className="text-xs font-medium text-gray-500 mb-1">
              Ori — Stock Analyst
            </p>
            <p className="text-[10px] text-gray-600 max-w-[260px] mx-auto leading-snug">
              {hints.tagline}
            </p>
            <div className="mt-3 lg:mt-4 flex flex-col gap-1">
              {hints.suggestions.map((q, qi) => (
                <button
                  key={q}
                  onClick={() => {
                    chat.sendMessage(q);
                  }}
                  className="text-[10px] text-left text-blue-400 hover:text-blue-300 px-2 py-1
                    bg-gray-800/50 rounded-lg hover:bg-gray-800 transition-colors duration-150 cursor-pointer oz-msg-in py-1.5 lg:py-1"
                  style={{ animationDelay: `${qi * 45}ms`, animationFillMode: "both" }}
                >
                  "{q}"
                </button>
              ))}
            </div>
          </div>
        )}

        {chat.messages.map((msg, i) => (
          <div
            key={i}
            ref={i === chat.messages.length - 1 ? lastMsgRef : null}
            className={`flex scroll-mt-2 oz-msg-in ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[90%] rounded-lg px-3 py-2 ${
                msg.role === "user"
                  ? "bg-blue-600/20 border border-blue-800/50 text-gray-200"
                  : "bg-gray-800/50 border border-gray-800"
              }`}
            >
              {msg.role === "user" ? (
                <p className="text-xs">{msg.content}</p>
              ) : msg.content ? (
                <>
                  <Markdown text={msg.content} />

                  {/* Subtle note when Ori saved a durable fact to memory */}
                  {msg.remembered && msg.remembered.length > 0 && (
                    <div className="mt-2 text-[10px] text-violet-300/80 flex items-start gap-1">
                      <span className="shrink-0">◆</span>
                      <span>Remembered: {msg.remembered.join(" · ")}</span>
                    </div>
                  )}

                  {/* Which Gemini model answered (value, or lite via failover) */}
                  {msg.model && (
                    <div className="mt-2 text-[9px] text-gray-600" title={`Generated by ${msg.model}`}>
                      ⚙ {msg.modelTier === "lite" ? "Lite" : msg.modelTier === "frontier" ? "Frontier" : "Value"} · {msg.model}
                    </div>
                  )}

                  {/* Confirmation UI for Ori's offer to open Deep Research */}
                  {msg.deepResearch && (
                    <div className="mt-3 pt-3 border-t border-gray-700 flex items-center gap-2">
                      <button
                        onClick={() => chat.enterDeepResearch?.(msg.deepResearch)}
                        className="px-3 py-1.5 text-xs font-semibold rounded bg-gradient-to-br from-blue-600 to-violet-600 text-white hover:brightness-110 transition-all duration-150 cursor-pointer flex items-center gap-1.5"
                      >
                        <IconResearch className="w-3.5 h-3.5" /> Open Deep Research — {msg.deepResearch}
                      </button>
                    </div>
                  )}

                  {/* Confirmation UI for Ori's screener recommendations */}
                  {msg.recommendation && msg.recommendation.filters && (
                    <div className="mt-3 pt-3 border-t border-gray-700">
                      <div className="text-[10px] text-gray-400 mb-1.5">
                        Ori recommends these filters:
                      </div>
                      <div className="text-[10px] text-gray-300 mb-2">
                        {Object.entries(msg.recommendation.filters)
                          .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : v}`)
                          .join(' · ')}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            if (msg.recommendation && chat.applyRecommendation) {
                              chat.applyRecommendation(msg.recommendation);
                            }
                            chat.dismissRecommendation?.(i);
                          }}
                          className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
                        >
                          Apply filters
                        </button>
                        <button
                          onClick={() => chat.dismissRecommendation?.(i)}
                          className="px-3 py-1.5 text-xs font-medium bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
                        >
                          Don't apply
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <span className="text-xs text-gray-500 animate-pulse">
                  {msg.status || "Thinking…"}
                </span>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-2 lg:py-2.5 border-t border-gray-800">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setHistIdx(null);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder={canUseOri ? "Ask about your stocks…" : "Ori is a Pro feature — upgrade to chat"}
            disabled={chat.isStreaming || !canUseOri}
            className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2
              text-xs text-gray-200 placeholder-gray-600 outline-none focus:border-blue-500
              disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || chat.isStreaming || !canUseOri}
            className="px-4 lg:px-3 py-2 bg-blue-600 text-white text-xs font-medium rounded-lg active:scale-95
              hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {chat.isStreaming ? "…" : "→"}
          </button>
        </div>
      </div>
      </m.aside>
    </>
  );
}
