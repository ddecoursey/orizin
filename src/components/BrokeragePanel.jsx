import { useState, useEffect, useCallback } from "react";
import { IconBank } from "./icons.jsx";

// ── Brokerage panel (SIMULATION) ────────────────────────────────────────────
// The account-linking + trading surface for the Portfolio page. Everything is
// wired to /api/brokerage/*, which currently runs the simulated provider:
// linking creates a sandbox account, market orders fill at the screener's
// last price, limit orders queue. When real Plaid (linking) and Alpaca
// (execution) integrations land server-side, this UI keeps working as-is.

const fmtMoney = (n) =>
  n == null
    ? "—"
    : n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const STATUS_STYLE = {
  filled: "bg-emerald-900/40 text-emerald-300",
  pending: "bg-amber-900/40 text-amber-300",
  cancelled: "bg-gray-800 text-gray-500",
  rejected: "bg-red-900/40 text-red-300",
};

function SimBadge() {
  return (
    <span
      className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-amber-900/50 text-amber-300 border border-amber-800/50"
      title="Sandbox: play money only. Real account linking (Plaid) and order routing (Alpaca) plug in here later."
    >
      SIMULATION
    </span>
  );
}

function LinkModal({ institutions, onLink, onClose, linking }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-sm p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-gray-100">Link an account</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>
        <p className="text-[11px] text-gray-500 mb-4">
          This is a sandbox — selecting an institution instantly creates a simulated
          account with play money. The real flow (Plaid Link OAuth) drops in here.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {institutions.map((inst) => (
            <button
              key={inst.id}
              onClick={() => onLink(inst.id)}
              disabled={linking}
              className="px-3 py-3 rounded-lg bg-gray-950 border border-gray-800 hover:border-blue-600 hover:bg-gray-800 text-sm text-gray-200 font-medium transition-colors disabled:opacity-50"
            >
              {inst.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function TradeModal({ account, onClose, onPlaced }) {
  const [symbol, setSymbol] = useState("");
  const [side, setSide] = useState("buy");
  const [qty, setQty] = useState("");
  const [type, setType] = useState("market");
  const [limitPrice, setLimitPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/brokerage/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: account.id,
          symbol: symbol.trim().toUpperCase(),
          side,
          qty: Number(qty),
          type,
          limitPrice: type === "limit" ? Number(limitPrice) : undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setResult(data.order);
      onPlaced?.();
    } catch (e) {
      setError(e.message);
      onPlaced?.(); // rejected orders still show up in history
    }
    setSubmitting(false);
  }

  const valid =
    /^[A-Za-z0-9.-]{1,10}$/.test(symbol.trim()) &&
    Number(qty) > 0 &&
    (type === "market" || Number(limitPrice) > 0);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-sm p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold text-gray-100">
            Trade · {account.institution} ••••{account.mask}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>
        <p className="text-[11px] text-gray-500 mb-4">
          Simulated execution: market orders fill at the latest screener price,
          limit orders stay pending. Cash available: <span className="text-gray-300 font-mono">{fmtMoney(account.cash)}</span>
        </p>

        <div className="flex gap-2 mb-3">
          {["buy", "sell"].map((s) => (
            <button
              key={s}
              onClick={() => setSide(s)}
              className={`flex-1 py-1.5 rounded-md text-xs font-bold uppercase tracking-wide transition-colors ${
                side === s
                  ? s === "buy"
                    ? "bg-emerald-600 text-white"
                    : "bg-red-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Symbol</div>
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="AAPL"
              className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm font-mono uppercase text-gray-100 focus:border-blue-500 outline-none"
            />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Quantity</div>
            <input
              type="number"
              min="0"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder="10"
              className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm font-mono text-gray-100 focus:border-blue-500 outline-none"
            />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Order type</div>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-100 focus:border-blue-500 outline-none"
            >
              <option value="market">Market</option>
              <option value="limit">Limit</option>
            </select>
          </div>
          {type === "limit" && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Limit price</div>
              <input
                type="number"
                min="0"
                step="0.01"
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
                placeholder="100.00"
                className="w-full bg-gray-950 border border-gray-700 rounded px-2 py-1.5 text-sm font-mono text-gray-100 focus:border-blue-500 outline-none"
              />
            </div>
          )}
        </div>

        {error && (
          <div className="mb-3 text-xs text-red-300 bg-red-950/40 border border-red-900/60 rounded px-3 py-2">{error}</div>
        )}
        {result && (
          <div className="mb-3 text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-900/60 rounded px-3 py-2">
            Order {result.status}
            {result.fill_price != null ? ` at ${fmtMoney(result.fill_price)}` : ""} — {result.side} {result.qty} {result.symbol}
          </div>
        )}

        <button
          onClick={submit}
          disabled={!valid || submitting}
          className={`w-full py-2 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-40 ${
            side === "buy" ? "bg-emerald-600 hover:bg-emerald-500" : "bg-red-600 hover:bg-red-500"
          }`}
        >
          {submitting ? "Placing…" : `${side === "buy" ? "Buy" : "Sell"} ${symbol || "—"} (simulated)`}
        </button>
      </div>
    </div>
  );
}

export default function BrokeragePanel() {
  const [accounts, setAccounts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [institutions, setInstitutions] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [linking, setLinking] = useState(false);
  const [tradeAccount, setTradeAccount] = useState(null);
  const [expanded, setExpanded] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [a, o] = await Promise.all([
        fetch("/api/brokerage/accounts").then((r) => (r.ok ? r.json() : null)),
        fetch("/api/brokerage/orders").then((r) => (r.ok ? r.json() : null)),
      ]);
      if (a) setAccounts(a.accounts || []);
      if (o) setOrders(o.orders || []);
    } catch {
      // transient — leave current state
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
    fetch("/api/brokerage/institutions")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setInstitutions(d.institutions || []))
      .catch(() => {});
  }, [refresh]);

  async function handleLink(institutionId) {
    setLinking(true);
    try {
      const res = await fetch("/api/brokerage/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ institutionId }),
      });
      if (res.ok) {
        setShowLink(false);
        await refresh();
      }
    } catch {
      // leave the modal open so the user can retry
    }
    setLinking(false);
  }

  async function handleUnlink(id) {
    if (!confirm("Unlink this simulated account? Its positions disappear; order history is kept.")) return;
    await fetch(`/api/brokerage/accounts/${id}`, { method: "DELETE" }).catch(() => {});
    refresh();
  }

  async function handleCancel(orderId) {
    await fetch(`/api/brokerage/orders/${orderId}`, { method: "DELETE" }).catch(() => {});
    refresh();
  }

  const totalLinked = accounts.reduce((s, a) => s + (a.totalValue || 0), 0);

  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/50 p-5">
      <div className="flex items-center justify-between gap-3 mb-1">
        <button onClick={() => setExpanded((e) => !e)} className="flex items-center gap-2 text-left group">
          <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            <IconBank className="w-4 h-4 text-blue-400" /> Linked Accounts
          </h3>
          <SimBadge />
          <span className={`text-gray-500 text-xs transition-transform ${expanded ? "rotate-180" : ""}`}>▾</span>
        </button>
        <div className="flex items-center gap-3">
          {accounts.length > 0 && (
            <span className="text-xs text-gray-500 tabular-nums">
              {fmtMoney(totalLinked)} across {accounts.length} account{accounts.length === 1 ? "" : "s"}
            </span>
          )}
          <button
            onClick={() => setShowLink(true)}
            className="text-xs px-3 py-1.5 lg:py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-white font-medium cursor-pointer active:scale-95 transition-transform"
          >
            + Link Account
          </button>
        </div>
      </div>
      <p className="text-[10px] text-gray-500 mb-3">
        Sandbox for the upcoming Plaid (account linking) and Alpaca (trade execution)
        integrations — same flows, play money. No real brokerage is ever touched.
      </p>

      {expanded && (
        <>
          {!loaded ? (
            <div className="text-sm text-gray-500 py-4">Loading accounts…</div>
          ) : accounts.length === 0 ? (
            <div className="text-center py-6 text-gray-500 text-sm border border-dashed border-gray-800 rounded-xl">
              No linked accounts yet. Link a simulated brokerage to try the flow.
            </div>
          ) : (
            <div className="space-y-3">
              {accounts.map((a) => (
                <div key={a.id} className="bg-gray-950 border border-gray-800 rounded-xl p-4">
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <div>
                      <span className="text-sm font-semibold text-gray-100">{a.institution}</span>
                      <span className="text-xs text-gray-500 ml-2">{a.name} ••••{a.mask}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="text-sm font-bold text-gray-100 tabular-nums">{fmtMoney(a.totalValue)}</div>
                        <div className="text-[10px] text-gray-500 tabular-nums">{fmtMoney(a.cash)} cash</div>
                      </div>
                      <button
                        onClick={() => setTradeAccount(a)}
                        className="text-xs px-3 py-1.5 rounded-md bg-emerald-700/80 hover:bg-emerald-600 text-white font-semibold"
                      >
                        Trade
                      </button>
                      <button
                        onClick={() => handleUnlink(a.id)}
                        className="text-xs text-gray-500 hover:text-red-400"
                        title="Unlink account"
                      >
                        Unlink
                      </button>
                    </div>
                  </div>
                  {a.positions.length > 0 ? (
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="text-gray-600">
                          <th className="text-left font-medium py-1">Symbol</th>
                          <th className="text-right font-medium py-1">Qty</th>
                          <th className="text-right font-medium py-1">Avg Cost</th>
                          <th className="text-right font-medium py-1">Price</th>
                          <th className="text-right font-medium py-1">Value</th>
                          <th className="text-right font-medium py-1">P/L</th>
                        </tr>
                      </thead>
                      <tbody>
                        {a.positions.map((p) => (
                          <tr key={p.symbol} className="border-t border-gray-800/60">
                            <td className="py-1.5 font-mono font-bold text-gray-200">{p.symbol}</td>
                            <td className="py-1.5 text-right font-mono text-gray-300">{p.qty}</td>
                            <td className="py-1.5 text-right font-mono text-gray-400">{fmtMoney(p.avg_cost)}</td>
                            <td className="py-1.5 text-right font-mono text-gray-300">{fmtMoney(p.price)}</td>
                            <td className="py-1.5 text-right font-mono text-gray-200">{fmtMoney(p.value)}</td>
                            <td className={`py-1.5 text-right font-mono ${p.pl == null ? "text-gray-600" : p.pl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                              {p.pl == null ? "—" : `${p.pl >= 0 ? "+" : ""}${fmtMoney(p.pl)}`}
                              {p.pl_pct != null ? ` (${(p.pl_pct * 100).toFixed(1)}%)` : ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="text-[11px] text-gray-600">No positions — place a simulated trade to start.</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Order history */}
          {orders.length > 0 && (
            <div className="mt-4">
              <div className="text-xs font-semibold text-gray-400 mb-2">Recent Orders</div>
              <div className="border border-gray-800 rounded-xl overflow-hidden bg-gray-950 max-h-52 overflow-y-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-gray-600 bg-gray-950 sticky top-0">
                    <tr>
                      <th className="text-left font-medium px-3 py-1.5">Time</th>
                      <th className="text-left font-medium px-3 py-1.5">Order</th>
                      <th className="text-right font-medium px-3 py-1.5">Fill</th>
                      <th className="text-right font-medium px-3 py-1.5">Status</th>
                      <th className="w-14"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/60">
                    {orders.map((o) => (
                      <tr key={o.id}>
                        <td className="px-3 py-1.5 text-gray-500 font-mono whitespace-nowrap">
                          {new Date(o.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        </td>
                        <td className="px-3 py-1.5">
                          <span className={o.side === "buy" ? "text-emerald-400" : "text-red-400"}>
                            {o.side.toUpperCase()}
                          </span>{" "}
                          <span className="font-mono text-gray-200">{o.qty} {o.symbol}</span>
                          <span className="text-gray-600"> · {o.type}{o.type === "limit" && o.limit_price ? ` @ ${fmtMoney(o.limit_price)}` : ""}</span>
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-gray-300">
                          {o.fill_price != null ? fmtMoney(o.fill_price) : "—"}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${STATUS_STYLE[o.status] || "bg-gray-800 text-gray-400"}`}>
                            {o.status}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          {o.status === "pending" && (
                            <button onClick={() => handleCancel(o.id)} className="text-[10px] text-gray-500 hover:text-red-400">
                              Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {showLink && (
        <LinkModal
          institutions={institutions}
          onLink={handleLink}
          onClose={() => setShowLink(false)}
          linking={linking}
        />
      )}
      {tradeAccount && (
        <TradeModal
          account={accounts.find((a) => a.id === tradeAccount.id) || tradeAccount}
          onClose={() => setTradeAccount(null)}
          onPlaced={refresh}
        />
      )}
    </div>
  );
}
