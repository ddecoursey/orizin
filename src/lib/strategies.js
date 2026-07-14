const SECTOR_ETFS = ["XLK", "XLF", "XLE", "XLV", "XLI", "XLY", "XLP", "XLC", "XLRE", "XLB", "XLU"];

export const STRATEGY_SYMBOL_CONTEXT = {
  XLK: { sector: "Technology" },
  XLF: { sector: "Financial Services" },
  XLE: { sector: "Energy" },
  XLV: { sector: "Healthcare" },
  XLI: { sector: "Industrials" },
  XLY: { sector: "Consumer Cyclical" },
  XLP: { sector: "Consumer Defensive" },
  XLC: { sector: "Communication Services" },
  XLRE: { sector: "Real Estate" },
  XLB: { sector: "Basic Materials" },
  XLU: { sector: "Utilities" },
};

export const STRATEGY_METRICS = {
  conviction: { label: "Conviction", unit: "score", group: "Orizin", read: (stock) => stock.conviction },
  current_price: { label: "Current price", unit: "currency", group: "Price and trend", read: (stock, indicators) => indicators?.price ?? stock.price },
  moving_average_price: { label: "Moving average price", unit: "currency", group: "Price and trend", supportsLookback: true, defaultLookback: 50, read: (_stock, indicators, rule) => readWindow(indicators, rule, "sma", 50) },
  exponential_moving_average: { label: "Exponential moving average", unit: "currency", group: "Price and trend", supportsLookback: true, defaultLookback: 20, read: (_stock, indicators, rule) => readWindow(indicators, rule, "ema", 20) },
  price_vs_moving_average: { label: "Price vs moving average", unit: "percent", group: "Price and trend", supportsLookback: true, defaultLookback: 50, read: (_stock, indicators, rule) => readWindow(indicators, rule, "priceVsSma", 50) },
  price_vs_ema: { label: "Price vs exponential average", unit: "percent", group: "Price and trend", supportsLookback: true, defaultLookback: 20, read: (_stock, indicators, rule) => readWindow(indicators, rule, "priceVsEma", 20) },
  price_std_dev: { label: "Price standard deviation", unit: "percent", group: "Risk and return", supportsLookback: true, defaultLookback: 20, read: (_stock, indicators, rule) => readWindow(indicators, rule, "priceStdDev", 20) },
  cumulative_return: { label: "Cumulative return", unit: "percent", group: "Risk and return", supportsLookback: true, defaultLookback: 63, read: (_stock, indicators, rule) => readWindow(indicators, rule, "cumulativeReturn", 63) },
  average_return: { label: "Average daily return", unit: "percent", group: "Risk and return", supportsLookback: true, defaultLookback: 20, read: (_stock, indicators, rule) => readWindow(indicators, rule, "averageReturn", 20) },
  return_std_dev: { label: "Return standard deviation", unit: "percent", group: "Risk and return", supportsLookback: true, defaultLookback: 20, read: (_stock, indicators, rule) => readWindow(indicators, rule, "returnStdDev", 20) },
  annualized_volatility: { label: "Annualized volatility", unit: "percent", group: "Risk and return", supportsLookback: true, defaultLookback: 63, read: (_stock, indicators, rule) => readWindow(indicators, rule, "annualizedVolatility", 63) },
  max_drawdown: { label: "Maximum drawdown", unit: "percent", group: "Risk and return", supportsLookback: true, defaultLookback: 252, read: (_stock, indicators, rule) => readWindow(indicators, rule, "maxDrawdown", 252) },
  rsi: { label: "Relative Strength Index", unit: "number", group: "Risk and return", supportsLookback: true, defaultLookback: 14, minLookback: 2, maxLookback: 60, read: (_stock, indicators, rule) => readWindow(indicators, rule, "rsi", 14) },
  rsi14: { label: "RSI (14)", unit: "number", group: "Legacy", legacy: true, read: (_stock, indicators) => indicators?.rsi14 },
  momentum90: { label: "90-day momentum", unit: "percent", group: "Legacy", legacy: true, read: (stock, indicators) => indicators?.momentum90 ?? stock.mom },
  roic: { label: "ROIC", unit: "percent", group: "Fundamentals", read: (stock) => stock.roic },
  revenue_growth: { label: "Revenue growth", unit: "percent", group: "Fundamentals", read: (stock) => stock.revenue_growth },
  fcf_yield: { label: "FCF yield", unit: "percent", group: "Fundamentals", read: (stock) => stock.fcf_yield },
  net_debt_ebitda: { label: "Net debt / EBITDA", unit: "number", group: "Fundamentals", read: (stock) => stock.net_debt_ebitda },
  beta: { label: "Beta", unit: "number", group: "Fundamentals", read: (stock) => stock.beta },
  price_above_sma200: {
    label: "Price above 200-day average",
    unit: "boolean",
    group: "Legacy",
    legacy: true,
    read: (stock, indicators) => {
      const price = indicators?.price ?? stock.price;
      const sma200 = indicators?.sma200 ?? stock.sma200;
      return Number.isFinite(price) && Number.isFinite(sma200) ? price > sma200 : null;
    },
  },
  sector_latest_return: { label: "Sector latest return", unit: "percent", group: "Sector context", signalFamily: "sectorPerformance", read: (stock, _indicators, _rule, context) => usableContext(context?.sectorPerformance?.[stock.sector], "latestReturn") },
  sector_cumulative_return: { label: "Sector cumulative return", unit: "percent", group: "Sector context", signalFamily: "sectorPerformance", read: (stock, _indicators, _rule, context) => usableContext(context?.sectorPerformance?.[stock.sector], "cumulativeReturn") },
  sector_return_std_dev: { label: "Sector return standard deviation", unit: "percent", group: "Sector context", signalFamily: "sectorPerformance", read: (stock, _indicators, _rule, context) => usableContext(context?.sectorPerformance?.[stock.sector], "returnStdDev") },
  sector_max_drawdown: { label: "Sector maximum drawdown", unit: "percent", group: "Sector context", signalFamily: "sectorPerformance", read: (stock, _indicators, _rule, context) => usableContext(context?.sectorPerformance?.[stock.sector], "maxDrawdown") },
  sector_pe: { label: "Sector P/E", unit: "number", group: "Sector context", signalFamily: "sectorPe", read: (stock, _indicators, _rule, context) => usableContext(context?.sectorPe?.[stock.sector], "pe") },
  sector_pe_vs_average: { label: "Sector P/E vs average", unit: "percent", group: "Sector context", signalFamily: "sectorPe", read: (stock, _indicators, _rule, context) => usableContext(context?.sectorPe?.[stock.sector], "peVsAverage") },
  industry_latest_return: { label: "Industry latest return", unit: "percent", group: "Industry context", signalFamily: "industryPerformance", read: (stock, _indicators, _rule, context) => usableContext(context?.industryPerformance?.[stock.industry], "latestReturn") },
  industry_cumulative_return: { label: "Industry cumulative return", unit: "percent", group: "Industry context", signalFamily: "industryPerformance", read: (stock, _indicators, _rule, context) => usableContext(context?.industryPerformance?.[stock.industry], "cumulativeReturn") },
  industry_return_std_dev: { label: "Industry return standard deviation", unit: "percent", group: "Industry context", signalFamily: "industryPerformance", read: (stock, _indicators, _rule, context) => usableContext(context?.industryPerformance?.[stock.industry], "returnStdDev") },
  industry_max_drawdown: { label: "Industry maximum drawdown", unit: "percent", group: "Industry context", signalFamily: "industryPerformance", read: (stock, _indicators, _rule, context) => usableContext(context?.industryPerformance?.[stock.industry], "maxDrawdown") },
  industry_pe: { label: "Industry P/E", unit: "number", group: "Industry context", signalFamily: "industryPe", read: (stock, _indicators, _rule, context) => usableContext(context?.industryPe?.[stock.industry], "pe") },
  industry_pe_vs_average: { label: "Industry P/E vs average", unit: "percent", group: "Industry context", signalFamily: "industryPe", read: (stock, _indicators, _rule, context) => usableContext(context?.industryPe?.[stock.industry], "peVsAverage") },
  is_biggest_gainer: { label: "In biggest gainers", unit: "boolean", group: "Market movers", signalFamily: "movers", read: (stock, _indicators, _rule, context) => context?.movers?.usable ? context.movers.bySymbol?.[stock.symbol]?.side === "gainer" : null },
  is_biggest_loser: { label: "In biggest losers", unit: "boolean", group: "Market movers", signalFamily: "movers", read: (stock, _indicators, _rule, context) => context?.movers?.usable ? context.movers.bySymbol?.[stock.symbol]?.side === "loser" : null },
  sector_extreme_mover_balance: { label: "Sector extreme-mover balance", unit: "percent", group: "Market movers", signalFamily: "movers", read: (stock, _indicators, _rule, context) => context?.movers?.usable ? context.movers.sectors?.[stock.sector]?.extremeMoverBalance ?? null : null },
  industry_extreme_mover_balance: { label: "Industry extreme-mover balance", unit: "percent", group: "Market movers", signalFamily: "movers", read: (stock, _indicators, _rule, context) => context?.movers?.usable ? context.movers.industries?.[stock.industry]?.extremeMoverBalance ?? null : null },
};

function lookbackFor(rule, fallback) {
  return Math.max(2, Math.min(252, Number(rule?.lookbackDays) || fallback));
}

function readWindow(indicators, rule, key, fallback) {
  return indicators?.windows?.[lookbackFor(rule, fallback)]?.[key] ?? null;
}

function usableContext(summary, key) {
  return summary?.usable ? summary[key] ?? null : null;
}

export const RULE_OPERATORS = [
  { value: ">", label: "is greater than" },
  { value: ">=", label: "is at least" },
  { value: "<", label: "is less than" },
  { value: "<=", label: "is at most" },
  { value: "between", label: "is between" },
  { value: "=", label: "is" },
  { value: "!=", label: "is not" },
];

const now = () => new Date().toISOString();
const id = (prefix = "strat") => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

const PRESET_DEFINITIONS = [
  {
    presetId: "sector-rotator",
    name: "Hedged Sector Rotator",
    eyebrow: "Momentum with a safety valve",
    description: "Rotates into the strongest US sectors while keeping a cash hedge when momentum or RSI is stretched.",
    accent: "cyan",
    universe: { type: "symbols", symbols: [...SECTOR_ETFS], sectors: [], includeEtfs: true },
    rules: [
      { id: "rule_mom", metric: "cumulative_return", lookbackDays: 63, operator: ">=", value: 0, label: "Only positive 63-day cumulative return" },
      { id: "rule_rsi", metric: "rsi", lookbackDays: 14, operator: "between", value: 42, value2: 68, label: "14-day RSI must be healthy, not overheated" },
      { id: "rule_trend", metric: "price_vs_moving_average", lookbackDays: 200, operator: ">=", value: 0, label: "Price must be above its 200-day moving average" },
    ],
    branches: [
      {
        id: "branch_leadership",
        name: "Overweight confirmed leadership",
        match: "all",
        conditions: [
          { id: "branch_sector", metric: "sector_cumulative_return", operator: ">=", value: 0, label: "Sector return is positive" },
          { id: "branch_drawdown", metric: "max_drawdown", lookbackDays: 63, operator: ">=", value: -0.08, label: "Recent drawdown is no worse than 8%" },
        ],
        action: "overweight",
        multiplier: 1.3,
      },
      {
        id: "branch_volatility",
        name: "Cut weight when volatility spikes",
        match: "any",
        conditions: [
          { id: "branch_vol", metric: "annualized_volatility", lookbackDays: 63, operator: ">=", value: 0.35, label: "Annualized volatility is at least 35%" },
          { id: "branch_movers", metric: "sector_extreme_mover_balance", operator: "<=", value: -0.4, label: "Sector has substantially more extreme losers than gainers" },
        ],
        action: "underweight",
        multiplier: 0.6,
      },
    ],
    ranking: { primary: "cumulative_return", lookbackDays: 63, secondary: "conviction", direction: "desc" },
    limits: {
      maxPositions: 3,
      maxPositionPct: 28,
      cashReservePct: 16,
      rebalance: "Weekly",
      allowOri: true,
      oriRole: "Rank eligible sectors and break close calls",
      minOriConfidence: 62,
    },
    benchmark: "SPY",
    oriBrief: "Prefer broad, persistent leadership. Avoid chasing a sector when its move depends on one unusually volatile week.",
  },
  {
    presetId: "quality-compounder",
    name: "Quality Compounder",
    eyebrow: "Fundamentals first",
    description: "Builds a concentrated paper portfolio of profitable growers with strong capital efficiency and manageable debt.",
    accent: "emerald",
    universe: { type: "stocks", symbols: [], sectors: [], includeEtfs: false },
    rules: [
      { id: "rule_conv", metric: "conviction", operator: ">=", value: 68, label: "Conviction must be 68 or higher" },
      { id: "rule_roic", metric: "roic", operator: ">=", value: 0.15, label: "ROIC must be at least 15%" },
      { id: "rule_growth", metric: "revenue_growth", operator: ">=", value: 0.05, label: "Revenue must be growing at least 5%" },
      { id: "rule_debt", metric: "net_debt_ebitda", operator: "<=", value: 2, label: "Net debt / EBITDA cannot exceed 2x" },
    ],
    branches: [
      {
        id: "branch_quality_risk",
        name: "Trim crowded or disorderly names",
        match: "any",
        conditions: [
          { id: "branch_rsi", metric: "rsi", lookbackDays: 14, operator: ">=", value: 72, label: "14-day RSI is 72 or higher" },
          { id: "branch_vol", metric: "annualized_volatility", lookbackDays: 63, operator: ">=", value: 0.45, label: "Annualized volatility is at least 45%" },
        ],
        action: "underweight",
        multiplier: 0.65,
      },
    ],
    ranking: { primary: "conviction", secondary: "roic", direction: "desc" },
    limits: {
      maxPositions: 8,
      maxPositionPct: 12,
      cashReservePct: 8,
      rebalance: "Monthly",
      allowOri: true,
      oriRole: "Rank eligible companies for business durability",
      minOriConfidence: 65,
    },
    benchmark: "SPY",
    oriBrief: "Within the rule-approved list, favor durable demand, defensible economics, and fewer thesis-breaking risks.",
  },
  {
    presetId: "drawdown-defender",
    name: "Drawdown Defender",
    eyebrow: "Trend-aware allocation",
    description: "Uses a small ETF universe and moves unqualified allocations to cash when long-term trends weaken.",
    accent: "amber",
    universe: { type: "symbols", symbols: ["SPY", "QQQ", "IWM", "GLD", "TLT"], sectors: [], includeEtfs: true },
    rules: [
      { id: "rule_trend", metric: "price_vs_moving_average", lookbackDays: 200, operator: ">=", value: 0, label: "Only hold assets above their 200-day average" },
      { id: "rule_mom", metric: "cumulative_return", lookbackDays: 63, operator: ">=", value: -0.02, label: "63-day cumulative return cannot be below -2%" },
    ],
    branches: [
      {
        id: "branch_drawdown",
        name: "Exit deep drawdowns",
        match: "any",
        conditions: [
          { id: "branch_dd", metric: "max_drawdown", lookbackDays: 126, operator: "<=", value: -0.12, label: "126-day maximum drawdown reached -12%" },
          { id: "branch_loser", metric: "is_biggest_loser", operator: "=", value: true, label: "Asset appears in today's biggest losers" },
        ],
        action: "exclude",
        multiplier: 0,
      },
      {
        id: "branch_stable",
        name: "Overweight stable trends",
        match: "all",
        conditions: [
          { id: "branch_vol", metric: "annualized_volatility", lookbackDays: 63, operator: "<=", value: 0.2, label: "Annualized volatility is at most 20%" },
          { id: "branch_ret", metric: "average_return", lookbackDays: 20, operator: ">=", value: 0, label: "Average 20-day return is non-negative" },
        ],
        action: "overweight",
        multiplier: 1.25,
      },
    ],
    ranking: { primary: "cumulative_return", lookbackDays: 63, secondary: "conviction", direction: "desc" },
    limits: {
      maxPositions: 4,
      maxPositionPct: 24,
      cashReservePct: 20,
      rebalance: "Every 2 weeks",
      allowOri: false,
      oriRole: "Off. Fixed rules decide every allocation",
      minOriConfidence: 100,
    },
    benchmark: "SPY",
    oriBrief: "",
  },
];

export const STRATEGY_PRESETS = PRESET_DEFINITIONS.map((preset) => ({ ...preset }));

function basePaperAccount(amount = 100000) {
  const startingCash = clamp(amount, 1000, 100000000);
  return {
    startingCash,
    cash: startingCash,
    holdings: [],
    equityHistory: [{ at: now(), value: startingCash }],
  };
}

export function strategyFromPreset(presetId, amount = 100000) {
  const preset = PRESET_DEFINITIONS.find((item) => item.presetId === presetId) || PRESET_DEFINITIONS[0];
  const createdAt = now();
  return {
    ...structuredClone(preset),
    id: id(),
    origin: "preset",
    status: "paused",
    createdAt,
    updatedAt: createdAt,
    lastRunAt: null,
    nextRunAt: null,
    paper: basePaperAccount(amount),
    activity: [
      {
        id: id("event"),
        at: createdAt,
        source: "system",
        action: "Strategy created",
        explanation: `Started from the ${preset.name} preset with simulated money only. No brokerage is connected.`,
      },
    ],
    backtest: null,
  };
}

export function createBlankStrategy(amount = 100000) {
  const createdAt = now();
  return {
    id: id(),
    presetId: null,
    name: "Untitled strategy",
    eyebrow: "Custom rules",
    description: "A paper strategy built from understandable rules.",
    accent: "blue",
    origin: "manual",
    status: "paused",
    createdAt,
    updatedAt: createdAt,
    lastRunAt: null,
    nextRunAt: null,
    universe: { type: "stocks", symbols: [], sectors: [], includeEtfs: false },
    rules: [
      { id: id("rule"), metric: "conviction", operator: ">=", value: 65, label: "Conviction must be 65 or higher" },
    ],
    branches: [],
    ranking: { primary: "conviction", lookbackDays: 63, secondary: "roic", direction: "desc" },
    limits: {
      maxPositions: 6,
      maxPositionPct: 15,
      cashReservePct: 10,
      rebalance: "Monthly",
      allowOri: false,
      oriRole: "Off. Fixed rules decide every allocation",
      minOriConfidence: 65,
    },
    benchmark: "SPY",
    oriBrief: "",
    paper: basePaperAccount(amount),
    activity: [
      {
        id: id("event"),
        at: createdAt,
        source: "system",
        action: "Draft created",
        explanation: "This strategy starts paused and uses simulated money only.",
      },
    ],
    backtest: null,
  };
}

export function strategyFromOriDraft(draft, prompt, amount = 100000) {
  const strategy = createBlankStrategy(amount);
  const allowedMetrics = new Set(Object.keys(STRATEGY_METRICS));
  const allowedOperators = new Set(RULE_OPERATORS.map((item) => item.value));
  const rules = Array.isArray(draft?.rules)
    ? draft.rules.slice(0, 8).map((rule) => {
        if (!allowedMetrics.has(rule?.metric)) return null;
        const operator = allowedOperators.has(rule?.operator) ? rule.operator : ">=";
        const isBoolean = STRATEGY_METRICS[rule.metric].unit === "boolean";
        return {
          id: id("rule"),
          metric: rule.metric,
          operator,
          value: isBoolean ? safeBoolean(rule.value) : Number(rule.value),
          ...(operator === "between" ? { value2: Number(rule.value2) } : {}),
          ...(STRATEGY_METRICS[rule.metric].supportsLookback ? { lookbackDays: lookbackFor(rule, STRATEGY_METRICS[rule.metric].defaultLookback) } : {}),
          label: String(rule.label || explainRule(rule)).slice(0, 140),
        };
      }).filter(Boolean)
    : [];
  const symbols = Array.isArray(draft?.symbols)
    ? [...new Set(draft.symbols.map((symbol) => String(symbol).trim().toUpperCase()).filter((symbol) => /^[A-Z0-9.-]{1,12}$/.test(symbol)))].slice(0, 40)
    : [];

  return normalizeStrategy({
    ...strategy,
    name: String(draft?.name || "Ori-built strategy").slice(0, 60),
    eyebrow: "Built with Ori",
    description: String(draft?.description || prompt || strategy.description).slice(0, 280),
    origin: "ori",
    universe: {
      type: symbols.length ? "symbols" : "stocks",
      symbols,
      sectors: Array.isArray(draft?.sectors) ? draft.sectors.map(String).slice(0, 12) : [],
      includeEtfs: safeBoolean(draft?.includeEtfs) || Boolean(symbols.length),
    },
    rules: rules.length ? rules : strategy.rules,
    branches: Array.isArray(draft?.branches) ? draft.branches.slice(0, 4).map((branch, branchIndex) => normalizeBranch({
      ...branch,
      id: id("branch"),
      conditions: Array.isArray(branch?.conditions) ? branch.conditions.map((condition, conditionIndex) => ({ ...condition, id: `branch_rule_${branchIndex}_${conditionIndex}` })) : [],
    }, branchIndex)) : [],
    ranking: {
      primary: allowedMetrics.has(draft?.rankingMetric) ? draft.rankingMetric : "conviction",
      secondary: "conviction",
      direction: "desc",
    },
    limits: {
      ...strategy.limits,
      maxPositions: clamp(draft?.maxPositions ?? 6, 1, 20),
      maxPositionPct: clamp(draft?.maxPositionPct ?? 15, 3, 50),
      cashReservePct: clamp(draft?.cashReservePct ?? 10, 0, 80),
      rebalance: ["Daily", "Weekly", "Every 2 weeks", "Monthly", "Quarterly"].includes(draft?.rebalance) ? draft.rebalance : "Monthly",
      allowOri: safeBoolean(draft?.allowOri),
      oriRole: draft?.allowOri ? "Rank rule-approved finalists only" : "Off. Fixed rules decide every allocation",
      minOriConfidence: clamp(draft?.minOriConfidence ?? 65, 50, 95),
    },
    benchmark: /^[A-Z0-9.-]{1,12}$/.test(String(draft?.benchmark || "")) ? String(draft.benchmark).toUpperCase() : "SPY",
    oriBrief: String(draft?.oriBrief || "Use judgment only to rank eligible finalists. Never override a fixed rule or limit.").slice(0, 500),
    activity: [
      {
        id: id("event"),
        at: now(),
        source: "ori",
        action: "Ori translated your idea",
        explanation: `Ori turned "${String(prompt || "your request").slice(0, 140)}" into ${rules.length || 1} reviewable fixed rule${rules.length === 1 ? "" : "s"}${draft?.branches?.length ? ` and ${draft.branches.length} ordered allocation branch${draft.branches.length === 1 ? "" : "es"}` : ""}. You remain in control.`,
      },
    ],
  });
}

const REBALANCE_SCHEDULES = new Set(["Daily", "Weekly", "Every 2 weeks", "Monthly", "Quarterly"]);
const STRATEGY_SOURCES = new Set(["system", "rule", "ori"]);

function safeText(value, max, fallback = "") {
  return typeof value === "string" ? value.slice(0, max) : fallback;
}

function safeNumber(value, fallback = null, min = -Infinity, max = Infinity) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function safeBoolean(value) {
  if (value === false || value === 0 || value === "false") return false;
  return value === true || value === 1 || value === "true";
}

function safeSymbol(value) {
  const symbol = String(value || "").trim().toUpperCase();
  return /^[A-Z0-9.-]{1,12}$/.test(symbol) ? symbol : null;
}

function normalizeHolding(holding) {
  const symbol = safeSymbol(holding?.symbol);
  if (!symbol) return null;
  return {
    symbol,
    shares: safeNumber(holding.shares, 0, 0, 1e12),
    avgPrice: safeNumber(holding.avgPrice, 0, 0, 1e9),
    lastPrice: safeNumber(holding.lastPrice, 0, 0, 1e9),
    targetPct: safeNumber(holding.targetPct, 0, 0, 100),
    source: STRATEGY_SOURCES.has(holding.source) ? holding.source : "rule",
  };
}

function normalizeActivityEvent(event, index) {
  if (!event || typeof event !== "object") return null;
  const symbol = safeSymbol(event.symbol);
  return {
    id: safeText(event.id, 80, `event_${index}`),
    at: safeText(event.at, 40, now()),
    source: STRATEGY_SOURCES.has(event.source) ? event.source : "system",
    action: safeText(event.action, 180, "Strategy event"),
    explanation: safeText(event.explanation, 1200),
    ...(event.confidence != null ? { confidence: safeNumber(event.confidence, 0, 0, 100) } : {}),
    ...(safeText(event.modelTier, 24) ? { modelTier: safeText(event.modelTier, 24) } : {}),
    ...(symbol ? { symbol } : {}),
    ...(event.side === "Buy" || event.side === "Sell" ? { side: event.side } : {}),
    ...(event.shares != null ? { shares: safeNumber(event.shares, 0, 0, 1e12) } : {}),
    ...(event.price != null ? { price: safeNumber(event.price, 0, 0, 1e9) } : {}),
    ...(safeText(event.branch, 120) ? { branch: safeText(event.branch, 120) } : {}),
    ...(safeText(event.branchReason, 600) ? { branchReason: safeText(event.branchReason, 600) } : {}),
  };
}

function normalizeAllocation(allocation) {
  const symbol = safeSymbol(allocation?.symbol);
  if (!symbol) return null;
  return {
    symbol,
    name: safeText(allocation.name, 120, symbol),
    sector: safeText(allocation.sector, 100, "Other"),
    price: safeNumber(allocation.price, 0, 0, 1e9),
    targetPct: safeNumber(allocation.targetPct, 0, 0, 100),
    source: STRATEGY_SOURCES.has(allocation.source) ? allocation.source : "rule",
    weightSource: allocation.weightSource === "ori" ? "ori" : "rule",
    weightMultiplier: safeNumber(allocation.weightMultiplier, 1, 0, 3),
    branch: safeText(allocation.branch, 120) || null,
    branchReason: safeText(allocation.branchReason, 600) || null,
    rationale: safeText(allocation.rationale, 300) || null,
  };
}

function normalizeLastDecision(decision) {
  if (!decision || typeof decision !== "object") return null;
  const compactCandidate = (candidate) => {
    const symbol = safeSymbol(candidate?.symbol);
    if (!symbol) return null;
    return {
      symbol,
      name: safeText(candidate.name, 120, symbol),
      sector: safeText(candidate.sector, 100),
      conviction: safeNumber(candidate.conviction),
      rsi14: safeNumber(candidate.rsi14),
      momentum90: safeNumber(candidate.momentum90),
      averageReturn: safeNumber(candidate.averageReturn),
      annualizedVolatility: safeNumber(candidate.annualizedVolatility),
      maxDrawdown: safeNumber(candidate.maxDrawdown),
      allocationBranch: safeText(candidate.allocationBranch, 120) || null,
      branchReason: safeText(candidate.branchReason, 600) || null,
      weightMultiplier: safeNumber(candidate.weightMultiplier, 1, 0, 3),
    };
  };
  const picks = Array.isArray(decision.oriDecision?.picks)
    ? decision.oriDecision.picks.slice(0, 20).map((pick) => {
        const symbol = safeSymbol(pick?.symbol ?? pick);
        return symbol ? { symbol, reason: safeText(pick?.reason, 300) } : null;
      }).filter(Boolean)
    : [];
  return {
    at: safeText(decision.at, 40),
    reviewedCount: safeNumber(decision.reviewedCount, 0, 0, 10000),
    eligibleCount: safeNumber(decision.eligibleCount, 0, 0, 10000),
    allocations: Array.isArray(decision.allocations) ? decision.allocations.slice(0, 30).map(normalizeAllocation).filter(Boolean) : [],
    oriDecision: decision.oriDecision && typeof decision.oriDecision === "object" ? {
      picks,
      confidence: safeNumber(decision.oriDecision.confidence, 0, 0, 100),
      explanation: safeText(decision.oriDecision.explanation, 500),
      uncertainty: safeText(decision.oriDecision.uncertainty, 500),
      metConfidenceFloor: safeBoolean(decision.oriDecision.metConfidenceFloor),
    } : null,
    candidates: Array.isArray(decision.candidates) ? decision.candidates.slice(0, 15).map(compactCandidate).filter(Boolean) : [],
    branchExclusions: Array.isArray(decision.branchExclusions) ? decision.branchExclusions.slice(0, 20).map(compactCandidate).filter(Boolean) : [],
    signalStatus: Array.isArray(decision.signalStatus) ? decision.signalStatus.slice(0, 30).map((row) => ({
      family: safeText(row?.family, 40),
      name: safeText(row?.name, 100),
      asOf: safeText(row?.asOf, 40) || null,
      usable: safeBoolean(row?.usable),
      ageDays: safeNumber(row?.ageDays),
    })) : [],
  };
}

function normalizeBacktest(backtest) {
  if (!backtest || typeof backtest !== "object") return null;
  const series = Array.isArray(backtest.series) ? backtest.series.slice(-504).map((point, index) => ({
    index: safeNumber(point?.index, index, 0, 100000),
    value: safeNumber(point?.value, 0, 0, 1e15),
    benchmark: point?.benchmark == null ? null : safeNumber(point.benchmark, null, 0, 1e15),
  })) : [];
  if (series.length < 2) return null;
  return {
    at: safeText(backtest.at, 40),
    days: safeNumber(backtest.days, series.length, 0, 10000),
    symbols: Array.isArray(backtest.symbols) ? [...new Set(backtest.symbols.map(safeSymbol).filter(Boolean))].slice(0, 30) : [],
    series,
    metrics: {
      endingValue: safeNumber(backtest.metrics?.endingValue, 0),
      totalReturn: safeNumber(backtest.metrics?.totalReturn, 0),
      annualizedReturn: safeNumber(backtest.metrics?.annualizedReturn, 0),
      maxDrawdown: safeNumber(backtest.metrics?.maxDrawdown, 0),
      volatility: safeNumber(backtest.metrics?.volatility, 0),
      benchmarkReturn: safeNumber(backtest.metrics?.benchmarkReturn),
    },
    methodology: safeText(backtest.methodology, 600),
  };
}

export function normalizeStrategy(input) {
  const fallback = createBlankStrategy(input?.paper?.startingCash || 100000);
  const strategy = input && typeof input === "object" ? input : fallback;
  const limits = strategy.limits || {};
  const paper = strategy.paper || fallback.paper;
  const startingCash = clamp(paper.startingCash ?? fallback.paper.startingCash, 1000, 100000000);
  const symbols = Array.isArray(strategy.universe?.symbols)
    ? [...new Set(strategy.universe.symbols.map(safeSymbol).filter(Boolean))].slice(0, 50)
    : [];
  const rules = Array.isArray(strategy.rules)
    ? strategy.rules.slice(0, 10).map((rule, index) => normalizeRule(rule, index))
    : [];
  const createdAt = safeText(strategy.createdAt, 40, fallback.createdAt);
  return {
    id: typeof strategy.id === "string" ? strategy.id.slice(0, 80) : fallback.id,
    presetId: safeText(strategy.presetId, 80) || null,
    name: String(strategy.name || fallback.name).slice(0, 60),
    description: String(strategy.description || "").slice(0, 500),
    eyebrow: safeText(strategy.eyebrow, 80, fallback.eyebrow),
    accent: safeText(strategy.accent, 24, fallback.accent),
    origin: ["preset", "manual", "ori"].includes(strategy.origin) ? strategy.origin : fallback.origin,
    status: strategy.status === "monitoring" ? "monitoring" : "paused",
    createdAt,
    updatedAt: safeText(strategy.updatedAt, 40, createdAt),
    lastRunAt: safeText(strategy.lastRunAt, 40) || null,
    nextRunAt: safeText(strategy.nextRunAt, 40) || null,
    universe: {
      type: strategy.universe?.type === "symbols" ? "symbols" : "stocks",
      symbols,
      sectors: Array.isArray(strategy.universe?.sectors) ? [...new Set(strategy.universe.sectors.map((value) => safeText(value, 100)).filter(Boolean))].slice(0, 20) : [],
      includeEtfs: safeBoolean(strategy.universe?.includeEtfs),
    },
    rules: rules.length ? rules : fallback.rules,
    branches: Array.isArray(strategy.branches) ? strategy.branches.slice(0, 8).map((branch, index) => normalizeBranch(branch, index)) : [],
    ranking: {
      primary: STRATEGY_METRICS[strategy.ranking?.primary] ? strategy.ranking.primary : fallback.ranking.primary,
      secondary: STRATEGY_METRICS[strategy.ranking?.secondary] ? strategy.ranking.secondary : fallback.ranking.secondary,
      lookbackDays: lookbackFor(strategy.ranking, STRATEGY_METRICS[strategy.ranking?.primary]?.defaultLookback || 63),
      direction: strategy.ranking?.direction === "asc" ? "asc" : "desc",
    },
    limits: {
      maxPositions: clamp(limits.maxPositions ?? fallback.limits.maxPositions, 1, 20),
      maxPositionPct: clamp(limits.maxPositionPct ?? fallback.limits.maxPositionPct, 3, 100),
      cashReservePct: clamp(limits.cashReservePct ?? fallback.limits.cashReservePct, 0, 90),
      minOriConfidence: clamp(limits.minOriConfidence ?? fallback.limits.minOriConfidence, 50, 100),
      allowOri: safeBoolean(limits.allowOri),
      rebalance: REBALANCE_SCHEDULES.has(limits.rebalance) ? limits.rebalance : fallback.limits.rebalance,
      oriRole: safeText(limits.oriRole, 300, fallback.limits.oriRole),
    },
    benchmark: safeSymbol(strategy.benchmark) || fallback.benchmark,
    oriBrief: safeText(strategy.oriBrief, 500),
    paper: {
      startingCash,
      cash: safeNumber(paper.cash, startingCash, 0, 1e15),
      holdings: Array.isArray(paper.holdings) ? paper.holdings.slice(0, 30).map(normalizeHolding).filter(Boolean) : [],
      equityHistory: Array.isArray(paper.equityHistory) ? paper.equityHistory.slice(-100).map((point) => ({ at: safeText(point?.at, 40), value: safeNumber(point?.value, 0, 0, 1e15) })) : fallback.paper.equityHistory,
    },
    activity: Array.isArray(strategy.activity) ? strategy.activity.slice(0, 100).map(normalizeActivityEvent).filter(Boolean) : [],
    lastDecision: normalizeLastDecision(strategy.lastDecision),
    backtest: normalizeBacktest(strategy.backtest),
  };
}

function normalizeRule(rule, index = 0) {
  const metric = STRATEGY_METRICS[rule?.metric] ? rule.metric : "conviction";
  const config = STRATEGY_METRICS[metric];
  const operator = RULE_OPERATORS.some((item) => item.value === rule?.operator) ? rule.operator : ">=";
  const boolean = config.unit === "boolean";
  const normalized = {
    id: typeof rule?.id === "string" ? rule.id.slice(0, 80) : `rule_${index}`,
    metric,
    operator: boolean ? "=" : operator,
    value: boolean ? safeBoolean(rule?.value) : safeNumber(rule?.value, 0, -1e12, 1e12),
    label: String(rule?.label || "").slice(0, 180),
  };
  if (operator === "between") normalized.value2 = safeNumber(rule?.value2, 0, -1e12, 1e12);
  if (config.supportsLookback) normalized.lookbackDays = lookbackFor(rule, config.defaultLookback);
  return normalized;
}

function normalizeBranch(branch, index = 0) {
  const action = ["overweight", "normal", "underweight", "exclude"].includes(branch?.action) ? branch.action : "normal";
  const defaultMultiplier = action === "overweight" ? 1.25 : action === "underweight" ? 0.65 : action === "exclude" ? 0 : 1;
  return {
    id: typeof branch?.id === "string" ? branch.id.slice(0, 80) : `branch_${index}`,
    name: String(branch?.name || `Branch ${index + 1}`).slice(0, 100),
    match: branch?.match === "any" ? "any" : "all",
    conditions: Array.isArray(branch?.conditions) ? branch.conditions.slice(0, 6).map((rule, ruleIndex) => normalizeRule(rule, ruleIndex)) : [],
    action,
    multiplier: action === "exclude" ? 0 : clamp(branch?.multiplier ?? defaultMultiplier, 0.1, 3),
  };
}

export function strategyDataRequirements(strategy) {
  const conditions = [
    ...(strategy.rules || []),
    ...(strategy.branches || []).flatMap((branch) => branch.conditions || []),
  ];
  const rankingRule = {
    metric: strategy.ranking?.primary,
    lookbackDays: strategy.ranking?.lookbackDays,
  };
  const all = [...conditions, rankingRule].filter((rule) => STRATEGY_METRICS[rule.metric]);
  const lookbacks = all.flatMap((rule) => {
    const metric = STRATEGY_METRICS[rule.metric];
    return metric.supportsLookback ? [lookbackFor(rule, metric.defaultLookback)] : [];
  });
  const legacyHistory = new Set(["current_price", "rsi14", "momentum90", "price_above_sma200"]);
  const families = [...new Set(all.map((rule) => STRATEGY_METRICS[rule.metric].signalFamily).filter(Boolean))];
  return {
    lookbacks: [...new Set(lookbacks)],
    needsPriceHistory: all.some((rule) => STRATEGY_METRICS[rule.metric].supportsLookback || legacyHistory.has(rule.metric)),
    signalFamilies: families,
  };
}

function toComparable(metric, value) {
  if (value == null) return null;
  if (STRATEGY_METRICS[metric]?.unit === "boolean") return Boolean(value);
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function passes(value, rule) {
  if (value == null) return false;
  const expected = toComparable(rule.metric, rule.value);
  const upper = toComparable(rule.metric, rule.value2);
  if (expected == null) return false;
  if (rule.operator === ">=") return value >= expected;
  if (rule.operator === ">") return value > expected;
  if (rule.operator === "<=") return value <= expected;
  if (rule.operator === "<") return value < expected;
  if (rule.operator === "between") return upper != null && value >= Math.min(expected, upper) && value <= Math.max(expected, upper);
  if (rule.operator === "!=") return value !== expected;
  return value === expected;
}

export function explainRule(rule) {
  const metric = STRATEGY_METRICS[rule.metric] || { label: rule.metric, unit: "number" };
  const format = (value) => {
    if (metric.unit === "percent") return `${(Number(value) * 100).toFixed(Math.abs(Number(value)) < 0.1 ? 1 : 0)}%`;
    if (metric.unit === "currency") return `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    if (metric.unit === "boolean") return value ? "yes" : "no";
    return Number.isFinite(Number(value)) ? Number(value).toString() : String(value ?? "-");
  };
  const lookback = metric.supportsLookback ? ` over ${lookbackFor(rule, metric.defaultLookback)} trading days` : "";
  if (rule.operator === "between") return `${metric.label}${lookback} is between ${format(rule.value)} and ${format(rule.value2)}`;
  const words = rule.operator === ">" ? "is greater than" : rule.operator === ">=" ? "is at least" : rule.operator === "<" ? "is less than" : rule.operator === "<=" ? "is at most" : rule.operator === "!=" ? "is not" : "is";
  return `${metric.label}${lookback} ${words} ${format(rule.value)}`;
}

export function formatStrategyMetricValue(metricKey, value) {
  if (value == null) return "missing";
  const metric = STRATEGY_METRICS[metricKey];
  if (metric?.unit === "percent") return `${(Number(value) * 100).toFixed(2)}%`;
  if (metric?.unit === "currency") return `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (metric?.unit === "boolean") return value ? "yes" : "no";
  return Number.isFinite(Number(value)) ? Number(value).toFixed(2).replace(/\.00$/, "") : String(value);
}

function inUniverse(stock, strategy) {
  if (!stock?.symbol) return false;
  const universe = strategy.universe || {};
  if (universe.type === "symbols") return Boolean(universe.symbols?.includes(stock.symbol));
  if (!universe.includeEtfs && stock.is_etf) return false;
  if (universe.sectors?.length && !universe.sectors.includes(stock.sector)) return false;
  return true;
}

export function evaluateStock(stock, strategy, indicators = {}, marketContext = {}) {
  if (!inUniverse(stock, strategy)) return { eligible: false, checks: [], excludedByUniverse: true };
  const checks = (strategy.rules || []).map((rule) => {
    const metric = STRATEGY_METRICS[rule.metric];
    const value = metric ? toComparable(rule.metric, metric.read(stock, indicators, rule, marketContext)) : null;
    return { rule, value, passed: passes(value, rule), missing: value == null };
  });
  return { eligible: checks.every((check) => check.passed), checks, excludedByUniverse: false };
}

function metricValue(stock, metric, indicators, lookbackDays, marketContext) {
  return STRATEGY_METRICS[metric]?.read(stock, indicators, { metric, lookbackDays }, marketContext) ?? null;
}

export function selectCandidates(stocks, strategy, indicatorMap = {}, marketContext = {}) {
  const evaluated = [];
  for (const stock of stocks || []) {
    const result = evaluateStock(stock, strategy, indicatorMap[stock.symbol] || {}, marketContext);
    if (result.eligible) evaluated.push({ ...stock, strategyChecks: result.checks, strategyIndicators: indicatorMap[stock.symbol] || {} });
  }
  const primary = strategy.ranking?.primary || "conviction";
  const secondary = strategy.ranking?.secondary || "conviction";
  evaluated.sort((a, b) => {
    const av = metricValue(a, primary, a.strategyIndicators, strategy.ranking?.lookbackDays, marketContext);
    const bv = metricValue(b, primary, b.strategyIndicators, strategy.ranking?.lookbackDays, marketContext);
    const primaryA = av != null && Number.isFinite(Number(av)) ? Number(av) : null;
    const primaryB = bv != null && Number.isFinite(Number(bv)) ? Number(bv) : null;
    if (primaryA == null || primaryB == null) {
      if (primaryA != null) return -1;
      if (primaryB != null) return 1;
    } else if (primaryB !== primaryA) {
      return strategy.ranking?.direction === "asc" ? primaryA - primaryB : primaryB - primaryA;
    }
    const secondaryA = metricValue(a, secondary, a.strategyIndicators, strategy.ranking?.lookbackDays, marketContext);
    const secondaryB = metricValue(b, secondary, b.strategyIndicators, strategy.ranking?.lookbackDays, marketContext);
    const tieA = secondaryA != null && Number.isFinite(Number(secondaryA)) ? Number(secondaryA) : null;
    const tieB = secondaryB != null && Number.isFinite(Number(secondaryB)) ? Number(secondaryB) : null;
    if (tieA == null || tieB == null) {
      if (tieA != null) return -1;
      if (tieB != null) return 1;
      return String(a.symbol).localeCompare(String(b.symbol));
    }
    return tieB - tieA || String(a.symbol).localeCompare(String(b.symbol));
  });
  return evaluated;
}

export function evaluateAllocationPolicy(stock, strategy, indicators = {}, marketContext = {}) {
  for (const branch of strategy.branches || []) {
    if (!branch.conditions?.length) continue;
    const checks = branch.conditions.map((rule) => {
      const metric = STRATEGY_METRICS[rule.metric];
      const value = metric ? toComparable(rule.metric, metric.read(stock, indicators, rule, marketContext)) : null;
      return { rule, value, passed: passes(value, rule), missing: value == null };
    });
    const matched = branch.match === "any" ? checks.some((check) => check.passed) : checks.every((check) => check.passed);
    if (matched) return { matched: true, branch, checks, action: branch.action, multiplier: branch.multiplier };
  }
  return { matched: false, branch: null, checks: [], action: "normal", multiplier: 1 };
}

export function applyAllocationBranches(candidates, strategy, marketContext = {}) {
  return evaluateAllocationBranches(candidates, strategy, marketContext).included;
}

export function evaluateAllocationBranches(candidates, strategy, marketContext = {}) {
  const evaluated = (candidates || []).map((candidate) => {
    const policy = evaluateAllocationPolicy(candidate, strategy, candidate.strategyIndicators || {}, marketContext);
    return {
      ...candidate,
      strategyAllocationPolicy: policy,
      strategyWeightMultiplier: policy.multiplier,
    };
  });
  return {
    included: evaluated.filter((candidate) => candidate.strategyAllocationPolicy.action !== "exclude"),
    excluded: evaluated.filter((candidate) => candidate.strategyAllocationPolicy.action === "exclude"),
  };
}

export function buildTargetAllocations(candidates, strategy, oriDecision = null) {
  const bySymbol = new Map((candidates || []).map((candidate) => [candidate.symbol, candidate]));
  const oriSymbols = Array.isArray(oriDecision?.picks)
    ? [...new Set(oriDecision.picks.map((pick) => typeof pick === "string" ? pick : pick?.symbol).filter((symbol) => bySymbol.has(symbol)))]
    : [];
  const ordered = [
    ...oriSymbols.map((symbol) => bySymbol.get(symbol)),
    ...(candidates || []).filter((candidate) => !oriSymbols.includes(candidate.symbol)),
  ];
  const maxPositions = Math.max(1, strategy.limits?.maxPositions || 1);
  const investablePct = Math.max(0, 100 - (strategy.limits?.cashReservePct || 0));
  const maxPct = Math.max(1, strategy.limits?.maxPositionPct || 100);
  const selected = ordered.slice(0, maxPositions);
  if (!selected.length) return [];

  const targets = selected.map((stock) => ({ stock, targetPct: 0, multiplier: clamp(stock.strategyWeightMultiplier ?? 1, 0.1, 3) }));
  let remaining = investablePct;
  let active = [...targets];
  for (let pass = 0; pass < selected.length + 1 && remaining > 0.001 && active.length; pass++) {
    const totalMultiplier = active.reduce((sum, item) => sum + item.multiplier, 0) || active.length;
    const capped = [];
    for (const item of active) {
      const share = remaining * (item.multiplier / totalMultiplier);
      if (item.targetPct + share >= maxPct - 0.001) capped.push(item);
    }
    if (!capped.length) {
      for (const item of active) item.targetPct += remaining * (item.multiplier / totalMultiplier);
      break;
    }
    for (const item of capped) {
      const capacity = Math.max(0, maxPct - item.targetPct);
      item.targetPct += capacity;
      remaining -= capacity;
    }
    active = active.filter((item) => !capped.includes(item));
  }
  return targets.map(({ stock, targetPct, multiplier }) => ({
    symbol: stock.symbol,
    name: stock.name || stock.symbol,
    sector: stock.sector || "Other",
    price: Number(stock.price) || Number(stock.strategyIndicators?.price) || 0,
    targetPct: Math.round(targetPct * 100) / 100,
    source: oriSymbols.includes(stock.symbol) ? "ori" : "rule",
    weightSource: "rule",
    weightMultiplier: multiplier,
    branch: stock.strategyAllocationPolicy?.branch?.name || null,
    branchReason: stock.strategyAllocationPolicy?.matched
      ? stock.strategyAllocationPolicy.checks.filter((check) => check.passed).map((check) => `${check.rule.label || explainRule(check.rule)} (actual ${formatStrategyMetricValue(check.rule.metric, check.value)})`).join("; ")
      : null,
    rationale: oriDecision?.picks?.find?.((pick) => pick?.symbol === stock.symbol)?.reason || null,
  }));
}

export function paperAccountValue(paper, priceMap = {}) {
  return (Number(paper?.cash) || 0) + (paper?.holdings || []).reduce((sum, holding) => {
    const price = Number(priceMap[holding.symbol] ?? holding.lastPrice ?? holding.avgPrice) || 0;
    return sum + (Number(holding.shares) || 0) * price;
  }, 0);
}

export function rebalancePaperAccount(strategy, allocations, priceMap = {}) {
  const at = now();
  const before = strategy.paper || basePaperAccount();
  const totalValue = paperAccountValue(before, priceMap) || before.startingCash;
  const previous = new Map((before.holdings || []).map((holding) => [holding.symbol, holding]));
  const holdings = [];
  const trades = [];
  let invested = 0;

  for (const allocation of allocations || []) {
    const price = Number(priceMap[allocation.symbol] ?? allocation.price) || 0;
    const prior = previous.get(allocation.symbol);
    if (price <= 0) {
      if (prior && Number(prior.shares) > 0) {
        holdings.push(prior);
        invested += Number(prior.shares) * (Number(prior.lastPrice ?? prior.avgPrice) || 0);
        previous.delete(allocation.symbol);
      }
      continue;
    }
    const dollars = totalValue * (allocation.targetPct / 100);
    const shares = Math.floor((dollars / price) * 10000) / 10000;
    const actualDollars = shares * price;
    invested += actualDollars;
    const oldShares = Number(prior?.shares) || 0;
    const delta = shares - oldShares;
    const priorAverage = Number(prior?.avgPrice) || price;
    const averagePrice = delta > 0 && oldShares > 0
      ? ((oldShares * priorAverage) + (delta * price)) / shares
      : priorAverage;
    if (shares > 0) {
      holdings.push({
        symbol: allocation.symbol,
        shares,
        avgPrice: averagePrice,
        lastPrice: price,
        targetPct: allocation.targetPct,
        source: allocation.source,
      });
    }
    if (Math.abs(delta) >= 0.0001) {
      trades.push({ symbol: allocation.symbol, side: delta > 0 ? "Buy" : "Sell", shares: Math.abs(delta), price, source: allocation.source, branch: allocation.branch, branchReason: allocation.branchReason });
    }
    previous.delete(allocation.symbol);
  }
  for (const holding of previous.values()) {
    if (!(Number(holding.shares) > 0)) continue;
    const price = Number(priceMap[holding.symbol]) || 0;
    if (price > 0) {
      trades.push({ symbol: holding.symbol, side: "Sell", shares: holding.shares, price, source: "rule" });
    } else {
      holdings.push(holding);
      invested += Number(holding.shares) * (Number(holding.lastPrice ?? holding.avgPrice) || 0);
    }
  }

  const cash = Math.max(0, totalValue - invested);
  return {
    paper: {
      ...before,
      cash,
      holdings,
      equityHistory: [...(before.equityHistory || []), { at, value: totalValue }].slice(-100),
    },
    trades,
    totalValue,
  };
}

function seriesStdDev(values) {
  if (!values.length) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function rsiForPeriod(values, period) {
  if (values.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let index = values.length - period; index < values.length; index++) {
    const change = values[index] - values[index - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }
  const averageGain = gains / period;
  const averageLoss = losses / period;
  if (averageLoss === 0) return averageGain === 0 ? 50 : 100;
  return 100 - (100 / (1 + averageGain / averageLoss));
}

function emaForPeriod(values, period) {
  if (values.length < period) return null;
  const alpha = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (const value of values.slice(period)) ema = value * alpha + ema * (1 - alpha);
  return ema;
}

function indicatorWindow(values, period) {
  const priceWindow = values.slice(-period);
  const returnPrices = values.slice(-(period + 1));
  const hasPrices = priceWindow.length >= period;
  const hasReturns = returnPrices.length >= period + 1;
  const latest = values.at(-1);
  const sma = hasPrices ? priceWindow.reduce((sum, value) => sum + value, 0) / period : null;
  const ema = emaForPeriod(values, period);
  const returns = hasReturns ? returnPrices.slice(1).map((value, index) => value / returnPrices[index] - 1) : [];
  const returnStdDev = returns.length ? seriesStdDev(returns) : null;
  const priceStd = hasPrices ? seriesStdDev(priceWindow) : null;
  return {
    days: period,
    sma,
    ema,
    priceVsSma: sma > 0 ? latest / sma - 1 : null,
    priceVsEma: ema > 0 ? latest / ema - 1 : null,
    priceStdDev: priceStd != null && sma > 0 ? priceStd / sma : null,
    cumulativeReturn: hasReturns && returnPrices[0] > 0 ? latest / returnPrices[0] - 1 : null,
    averageReturn: returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : null,
    returnStdDev,
    annualizedVolatility: returnStdDev != null ? returnStdDev * Math.sqrt(252) : null,
    maxDrawdown: hasPrices ? maxDrawdown(priceWindow) : null,
    rsi: rsiForPeriod(values, period),
  };
}

export function calculateIndicators(prices, { lookbacks = [] } = {}) {
  const values = (prices || []).map((value) => Number(value?.price ?? value?.close ?? value)).filter((value) => Number.isFinite(value) && value > 0);
  if (values.length < 2) return {};
  const latest = values.at(-1);
  const periods = [...new Set([14, 20, 50, 63, 126, 200, 252, ...lookbacks].map((value) => Math.max(2, Math.min(252, Number(value) || 20))))];
  const windows = Object.fromEntries(periods.map((period) => [period, indicatorWindow(values, period)]));
  return {
    price: latest,
    rsi14: windows[14].rsi,
    momentum90: windows[63].cumulativeReturn,
    sma50: windows[50].sma,
    sma200: windows[200].sma,
    ema20: windows[20].ema,
    windows,
  };
}

function maxDrawdown(series) {
  let peak = series[0] || 1;
  let worst = 0;
  for (const value of series) {
    peak = Math.max(peak, value);
    worst = Math.min(worst, (value - peak) / peak);
  }
  return worst;
}

function annualizedVolatility(series) {
  if (series.length < 3) return 0;
  const returns = series.slice(1).map((value, index) => value / series[index] - 1);
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / Math.max(1, returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

export function buildHistoricalSimulation(historyMap, allocations, benchmarkPrices = [], startingCash = 100000) {
  const pricesOnly = (rows) => (rows || [])
    .map((value) => Number(value?.price ?? value?.close ?? value))
    .filter((value) => Number.isFinite(value) && value > 0);
  const usable = (allocations || []).map((allocation) => ({
    allocation,
    prices: pricesOnly(historyMap[allocation.symbol]),
  })).filter((item) => item.prices.length >= 20);
  if (!usable.length) return null;
  const benchmark = pricesOnly(benchmarkPrices);
  const length = Math.min(504, ...usable.map((item) => item.prices.length), benchmark.length || Infinity);
  if (!Number.isFinite(length) || length < 20) return null;

  const aligned = usable.map((item) => ({ ...item, prices: item.prices.slice(-length) }));
  const investedWeight = Math.min(1, aligned.reduce((sum, item) => sum + item.allocation.targetPct / 100, 0));
  const cashWeight = Math.max(0, 1 - investedWeight);
  const strategySeries = Array.from({ length }, (_, index) => {
    const normalized = aligned.reduce((sum, item) => {
      const weight = item.allocation.targetPct / 100;
      return sum + weight * (item.prices[index] / item.prices[0]);
    }, cashWeight);
    return startingCash * normalized;
  });
  const benchmarkSeries = benchmark.length >= length
    ? benchmark.slice(-length).map((price, index, values) => startingCash * (price / values[0]))
    : [];
  const years = Math.max(length / 252, 1 / 12);
  const endingValue = strategySeries.at(-1);
  const totalReturn = endingValue / startingCash - 1;
  const benchmarkReturn = benchmarkSeries.length ? benchmarkSeries.at(-1) / startingCash - 1 : null;
  return {
    at: now(),
    days: length,
    symbols: aligned.map((item) => item.allocation.symbol),
    series: strategySeries.map((value, index) => ({ index, value: Math.round(value * 100) / 100, benchmark: benchmarkSeries[index] ? Math.round(benchmarkSeries[index] * 100) / 100 : null })),
    metrics: {
      endingValue,
      totalReturn,
      annualizedReturn: (endingValue / startingCash) ** (1 / years) - 1,
      maxDrawdown: maxDrawdown(strategySeries),
      volatility: annualizedVolatility(strategySeries),
      benchmarkReturn,
    },
    methodology: "Buy-and-hold simulation of today's rule-approved basket using available daily closes. It does not reconstruct past rule or Ori decisions.",
  };
}

export function nextRunDate(rebalance, from = new Date()) {
  const next = new Date(from.getTime());
  if (rebalance === "Monthly" || rebalance === "Quarterly") {
    const day = next.getUTCDate();
    const months = rebalance === "Quarterly" ? 3 : 1;
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + months);
    const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
    next.setUTCDate(Math.min(day, lastDay));
  } else {
    const days = rebalance === "Daily" ? 1 : rebalance === "Every 2 weeks" ? 14 : 7;
    next.setUTCDate(next.getUTCDate() + days);
  }
  while (next.getUTCDay() === 0 || next.getUTCDay() === 6) next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString();
}

export function makeActivity(source, action, explanation, meta = {}) {
  return { id: id("event"), at: now(), source, action, explanation, ...meta };
}
