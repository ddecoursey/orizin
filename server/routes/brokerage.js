import { Router } from "express";
import crypto from "crypto";
import db, { getStock } from "../db.js";

// ── Brokerage scaffolding ───────────────────────────────────────────────────
// Provider-shaped layer for linking external accounts (Plaid-style) and
// routing orders (Alpaca-style). Today only the SIMULATED provider exists:
// linking creates a sandbox account with play-money cash + holdings, market
// orders fill instantly at the screener's last price, and limit orders queue
// as pending. Nothing here touches real money.
//
// Drop-in points for real integrations later:
//   BROKERAGE_PROVIDER=plaid  → implement link() with Plaid Link token exchange
//   BROKERAGE_PROVIDER=alpaca → implement placeOrder() against Alpaca's API
// The route layer and data model (linked_accounts / brokerage_orders) stay
// the same; only the provider object changes.

const PROVIDER = process.env.BROKERAGE_PROVIDER || "simulated";

const INSTITUTIONS = [
  { id: "robinhood", name: "Robinhood" },
  { id: "fidelity", name: "Fidelity" },
  { id: "schwab", name: "Charles Schwab" },
  { id: "vanguard", name: "Vanguard" },
  { id: "etrade", name: "E*TRADE" },
  { id: "alpaca", name: "Alpaca (paper)" },
];

// ── Prepared statements ─────────────────────────────────────────────────────

const insertAccount = db.prepare(`
  INSERT INTO linked_accounts (id, user_id, provider, institution_id, institution,
    account_name, account_mask, status, cash, holdings, created_at)
  VALUES (@id, @user_id, @provider, @institution_id, @institution,
    @account_name, @account_mask, 'linked', @cash, @holdings, @created_at)
`);
const accountsForUser = db.prepare(
  `SELECT * FROM linked_accounts WHERE user_id = ? ORDER BY created_at`,
);
const accountById = db.prepare(
  `SELECT * FROM linked_accounts WHERE id = ? AND user_id = ?`,
);
const updateAccountFunds = db.prepare(
  `UPDATE linked_accounts SET cash = ?, holdings = ? WHERE id = ?`,
);
const deleteAccount = db.prepare(
  `DELETE FROM linked_accounts WHERE id = ? AND user_id = ?`,
);

const insertOrder = db.prepare(`
  INSERT INTO brokerage_orders (user_id, account_id, symbol, side, qty, type,
    limit_price, status, fill_price, simulated, created_at, updated_at)
  VALUES (@user_id, @account_id, @symbol, @side, @qty, @type,
    @limit_price, @status, @fill_price, 1, @now, @now)
`);
const ordersForUser = db.prepare(
  `SELECT * FROM brokerage_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
);
const orderById = db.prepare(
  `SELECT * FROM brokerage_orders WHERE id = ? AND user_id = ?`,
);
const setOrderStatus = db.prepare(
  `UPDATE brokerage_orders SET status = ?, updated_at = ? WHERE id = ?`,
);

// ── Simulated provider ──────────────────────────────────────────────────────

function parseHoldings(json) {
  try {
    const h = JSON.parse(json || "[]");
    return Array.isArray(h) ? h : [];
  } catch {
    return [];
  }
}

// Seed a freshly "linked" sandbox account with a few large-cap holdings from
// the local universe (if it's populated) plus starting cash.
function seedHoldings() {
  const STARTING_CASH = 10000;
  try {
    const candidates = db
      .prepare(
        `SELECT symbol, price FROM stocks
           WHERE is_etf = 0 AND price IS NOT NULL AND price > 5 AND mcap IS NOT NULL
           ORDER BY mcap DESC LIMIT 50`,
      )
      .all();
    if (!candidates.length) return { cash: STARTING_CASH, holdings: [] };
    const picks = [...candidates].sort(() => Math.random() - 0.5).slice(0, 3);
    const holdings = picks.map((s) => {
      const budget = 1500 + Math.random() * 2000;
      const qty = Math.max(1, Math.floor(budget / s.price));
      // Simulate having bought at a slightly different price than today.
      const drift = 0.9 + Math.random() * 0.2;
      return { symbol: s.symbol, qty, avg_cost: Number((s.price * drift).toFixed(2)) };
    });
    return { cash: STARTING_CASH, holdings };
  } catch {
    return { cash: STARTING_CASH, holdings: [] };
  }
}

// Value an account's positions at current screener prices.
function viewAccount(row) {
  const holdings = parseHoldings(row.holdings);
  const positions = holdings.map((h) => {
    const stock = getStock(h.symbol);
    const price = stock?.price ?? null;
    const value = price != null ? price * h.qty : null;
    const cost = h.avg_cost != null ? h.avg_cost * h.qty : null;
    return {
      symbol: h.symbol,
      qty: h.qty,
      avg_cost: h.avg_cost ?? null,
      price,
      value,
      pl: value != null && cost != null ? value - cost : null,
      pl_pct: value != null && cost ? (value - cost) / cost : null,
    };
  });
  const positionsValue = positions.reduce((s, p) => s + (p.value || 0), 0);
  return {
    id: row.id,
    provider: row.provider,
    institutionId: row.institution_id,
    institution: row.institution,
    name: row.account_name,
    mask: row.account_mask,
    status: row.status,
    cash: row.cash,
    positions,
    totalValue: row.cash + positionsValue,
    simulated: row.provider === "simulated",
    createdAt: row.created_at,
  };
}

const simulatedProvider = {
  name: "simulated",

  link(userId, institutionId) {
    const inst = INSTITUTIONS.find((i) => i.id === institutionId);
    if (!inst) return { error: "Unknown institution" };
    const { cash, holdings } = seedHoldings();
    const id = "acct_" + crypto.randomBytes(6).toString("hex");
    insertAccount.run({
      id,
      user_id: userId,
      provider: "simulated",
      institution_id: inst.id,
      institution: inst.name,
      account_name: `${inst.name} Individual`,
      account_mask: String(1000 + Math.floor(Math.random() * 9000)),
      cash,
      holdings: JSON.stringify(holdings),
      created_at: Date.now(),
    });
    return { account: viewAccount(accountById.get(id, userId)) };
  },

  placeOrder(userId, account, { symbol, side, qty, type, limitPrice }) {
    const now = Date.now();
    const base = {
      user_id: userId,
      account_id: account.id,
      symbol,
      side,
      qty,
      type,
      limit_price: type === "limit" ? limitPrice : null,
      now,
    };

    if (type === "limit") {
      // Scaffolding: limit orders queue as pending. A real provider (or a
      // future fill engine watching quote refreshes) would manage their
      // lifecycle from here.
      const info = insertOrder.run({ ...base, status: "pending", fill_price: null });
      return { order: orderById.get(info.lastInsertRowid, userId) };
    }

    // Market order: fill instantly at the screener's last price.
    const stock = getStock(symbol);
    const price = stock?.price ?? null;
    if (price == null) {
      const info = insertOrder.run({ ...base, status: "rejected", fill_price: null });
      return {
        error: `No live price for ${symbol} — market order rejected (try a limit order)`,
        order: orderById.get(info.lastInsertRowid, userId),
      };
    }

    const holdings = parseHoldings(account.holdings);
    const held = holdings.find((h) => h.symbol === symbol);

    if (side === "buy") {
      const cost = price * qty;
      if (cost > account.cash) {
        const info = insertOrder.run({ ...base, status: "rejected", fill_price: null });
        return {
          error: `Insufficient simulated cash ($${account.cash.toFixed(2)} available, $${cost.toFixed(2)} needed)`,
          order: orderById.get(info.lastInsertRowid, userId),
        };
      }
      if (held) {
        const totalCost = held.avg_cost * held.qty + cost;
        held.qty += qty;
        held.avg_cost = Number((totalCost / held.qty).toFixed(4));
      } else {
        holdings.push({ symbol, qty, avg_cost: price });
      }
      updateAccountFunds.run(account.cash - cost, JSON.stringify(holdings), account.id);
    } else {
      if (!held || held.qty < qty) {
        const info = insertOrder.run({ ...base, status: "rejected", fill_price: null });
        return {
          error: `Not enough shares to sell (${held?.qty ?? 0} held)`,
          order: orderById.get(info.lastInsertRowid, userId),
        };
      }
      held.qty -= qty;
      const remaining = holdings.filter((h) => h.qty > 0);
      updateAccountFunds.run(account.cash + price * qty, JSON.stringify(remaining), account.id);
    }

    const info = insertOrder.run({ ...base, status: "filled", fill_price: price });
    return { order: orderById.get(info.lastInsertRowid, userId) };
  },
};

function getProvider() {
  if (PROVIDER === "simulated") return simulatedProvider;
  // Future: return plaidProvider / alpacaProvider here once credentials and
  // SDKs are wired up. Failing loudly beats silently simulating.
  throw new Error(`Brokerage provider "${PROVIDER}" is not implemented yet`);
}

// ── Routes (all behind the /api auth gate) ─────────────────────────────────

const router = Router();

router.get("/brokerage/institutions", (req, res) => {
  res.json({
    provider: PROVIDER,
    simulated: PROVIDER === "simulated",
    institutions: INSTITUTIONS,
  });
});

router.get("/brokerage/accounts", (req, res) => {
  try {
    const accounts = accountsForUser.all(req.userId).map(viewAccount);
    res.json({ accounts, simulated: PROVIDER === "simulated" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/brokerage/link", (req, res) => {
  try {
    const institutionId = String(req.body?.institutionId || "");
    const result = getProvider().link(req.userId, institutionId);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ok: true, ...result, simulated: PROVIDER === "simulated" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/brokerage/accounts/:id", (req, res) => {
  try {
    const info = deleteAccount.run(req.params.id, req.userId);
    if (!info.changes) return res.status(404).json({ error: "Account not found" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/brokerage/orders", (req, res) => {
  try {
    res.json({ orders: ordersForUser.all(req.userId) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/brokerage/orders", (req, res) => {
  try {
    const body = req.body || {};
    const accountId = String(body.accountId || "");
    const symbol = String(body.symbol || "").trim().toUpperCase();
    const side = body.side === "sell" ? "sell" : body.side === "buy" ? "buy" : null;
    const qty = Number(body.qty);
    const type = body.type === "limit" ? "limit" : body.type === "market" ? "market" : null;
    const limitPrice = Number(body.limitPrice);

    if (!side || !type) return res.status(400).json({ error: "side must be buy/sell and type market/limit" });
    if (!/^[A-Z0-9.-]{1,10}$/.test(symbol)) return res.status(400).json({ error: "Invalid symbol" });
    if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: "qty must be a positive number" });
    if (type === "limit" && (!Number.isFinite(limitPrice) || limitPrice <= 0)) {
      return res.status(400).json({ error: "limitPrice required for limit orders" });
    }

    const account = accountById.get(accountId, req.userId);
    if (!account) return res.status(404).json({ error: "Account not found" });

    const result = getProvider().placeOrder(req.userId, account, {
      symbol, side, qty, type, limitPrice,
    });
    if (result.error) {
      return res.status(400).json({ error: result.error, order: result.order || null });
    }
    res.json({ ok: true, order: result.order, simulated: PROVIDER === "simulated" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/brokerage/orders/:id", (req, res) => {
  try {
    const order = orderById.get(req.params.id, req.userId);
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.status !== "pending") {
      return res.status(400).json({ error: `Only pending orders can be cancelled (this one is ${order.status})` });
    }
    setOrderStatus.run("cancelled", Date.now(), order.id);
    res.json({ ok: true, order: orderById.get(order.id, req.userId) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
