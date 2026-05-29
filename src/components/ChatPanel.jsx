import { useState, useRef, useEffect } from "react";

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
      '<h1 class="text-base font-bold text-white mt-3 mb-1">$1</h1>',
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
    .replace(/^[\-\*] (.+)$/gm, '<li class="ml-4 text-xs">$1</li>')
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

export default function ChatPanel({ chat }) {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.messages]);

  useEffect(() => {
    if (chat.isOpen) inputRef.current?.focus();
  }, [chat.isOpen]);

  function handleSend() {
    if (!input.trim() || chat.isStreaming) return;
    chat.sendMessage(input);
    setInput("");
  }

  return (
    <div className="w-96 shrink-0 bg-gray-900 border-l border-gray-800 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-gray-800 flex items-center gap-2">
        <span className="text-sm font-bold text-gray-100">Ori</span>
        <span className="text-[10px] text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
          {chat.stockCount} stocks in view
        </span>
        <div className="ml-auto flex gap-1">
          <button
            onClick={chat.clearChat}
            className="text-[10px] text-gray-500 hover:text-gray-300 px-1.5 py-0.5 rounded hover:bg-gray-800"
            title="Clear chat"
          >
            Clear
          </button>
          <button
            onClick={() => chat.setIsOpen(false)}
            className="text-gray-500 hover:text-gray-300 px-1 text-sm"
          >
            ×
          </button>
        </div>
      </div>

      {/* Error banner */}
      {chat.error && (
        <div className="px-3 py-2 bg-red-900/30 border-b border-red-800/50 text-xs text-red-300">
          {chat.error}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {chat.messages.length === 0 && (
          <div className="text-center py-12 text-gray-600">
            <div className="text-3xl mb-3">🤖</div>
            <p className="text-xs font-medium text-gray-500 mb-1">
              Ori — Stock Analyst
            </p>
            <p className="text-[10px] text-gray-600 max-w-[240px] mx-auto">
              Ori can suggest filters to narrow your results. It will never suggest
              changes to the Q/V/G weights (those are yours to control with the sliders).
              It will always ask before applying anything.
            </p>
            <div className="mt-4 flex flex-col gap-1.5">
              {[
                "What looks interesting here given my current weights?",
                "Narrow to higher growth companies",
                "Narrow to high-quality compounders with strong balance sheets",
                "Is the stock I have open attractive under my Q/V/G settings?",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => {
                    chat.sendMessage(q);
                  }}
                  className="text-[10px] text-left text-blue-400 hover:text-blue-300 px-2 py-1.5
                    bg-gray-800/50 rounded-lg hover:bg-gray-800 transition-colors"
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
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
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
                            const rec = msg.recommendation;
                            if (rec && chat.applyRecommendation) {
                              chat.applyRecommendation(rec);
                            }
                            if (chat.dismissRecommendation) {
                              const liveIdx = chat.messages.findIndex(m => m === msg);
                              if (liveIdx !== -1) {
                                chat.dismissRecommendation(liveIdx);
                              }
                            }
                          }}
                          className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
                        >
                          Apply filters
                        </button>
                        <button
                          onClick={() => {
                            if (chat.dismissRecommendation) {
                              const liveIdx = chat.messages.findIndex(m => m === msg);
                              if (liveIdx !== -1) {
                                chat.dismissRecommendation(liveIdx);
                              }
                            }
                          }}
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
                  Thinking…
                </span>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-2.5 border-t border-gray-800">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder="Ask about your stocks…"
            disabled={chat.isStreaming}
            className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2
              text-xs text-gray-200 placeholder-gray-600 outline-none focus:border-blue-500
              disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || chat.isStreaming}
            className="px-3 py-2 bg-blue-600 text-white text-xs font-medium rounded-lg
              hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {chat.isStreaming ? "…" : "→"}
          </button>
        </div>
      </div>
    </div>
  );
}
