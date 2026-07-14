import { parseDocument, stringify } from "yaml";
import {
  RULE_OPERATORS,
  STRATEGY_METRICS,
  normalizeStrategy,
} from "./strategies.js";

const MAX_YAML_LENGTH = 50000;
const ACTIONS = new Set(["overweight", "normal", "underweight", "exclude"]);
const MATCHES = new Set(["all", "any"]);
const OPERATORS = new Set(RULE_OPERATORS.map((operator) => operator.value));

export class StrategyYamlError extends Error {
  constructor(errors) {
    super(errors[0] || "Invalid strategy YAML.");
    this.name = "StrategyYamlError";
    this.errors = errors;
  }
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function formatNumber(value, digits = 4) {
  return Number(Number(value).toFixed(digits));
}

function formatPercent(value) {
  return `${formatNumber(Number(value) * 100, 3)}%`;
}

function yamlRule(rule) {
  const metric = STRATEGY_METRICS[rule.metric];
  const condition = {
    metric: rule.metric,
    operator: rule.operator,
    value: metric?.unit === "percent" ? formatPercent(rule.value) : rule.value,
  };
  if (rule.operator === "between") {
    condition.upper = metric?.unit === "percent" ? formatPercent(rule.value2) : rule.value2;
  }
  if (metric?.supportsLookback) condition.lookback_days = rule.lookbackDays || metric.defaultLookback;
  condition.explanation = rule.label || metric?.label || rule.metric;
  return condition;
}

export function strategyToYaml(input) {
  const strategy = normalizeStrategy(input);
  const document = {
    version: 1,
    name: strategy.name,
    description: strategy.description,
    universe: {
      type: strategy.universe.type,
      symbols: strategy.universe.symbols || [],
      sectors: strategy.universe.sectors || [],
      include_etfs: Boolean(strategy.universe.includeEtfs),
    },
    eligibility: {
      if: {
        match: "all",
        conditions: strategy.rules.map(yamlRule),
      },
      then: "continue",
      else: "reject",
    },
    decision_tree: [
      ...(strategy.branches || []).map((branch) => ({
        when: {
          name: branch.name,
          match: branch.match,
          conditions: branch.conditions.map(yamlRule),
        },
        then: {
          allocation: branch.action,
          weight_multiplier: branch.multiplier,
        },
      })),
      {
        else: {
          allocation: "normal",
          weight_multiplier: 1,
        },
      },
    ],
    ranking: {
      metric: strategy.ranking.primary,
      ...(STRATEGY_METRICS[strategy.ranking.primary]?.supportsLookback ? { lookback_days: strategy.ranking.lookbackDays } : {}),
      direction: strategy.ranking.direction,
      tiebreaker: strategy.ranking.secondary,
    },
    portfolio: {
      max_positions: strategy.limits.maxPositions,
      max_position: formatPercent(strategy.limits.maxPositionPct / 100),
      minimum_cash: formatPercent(strategy.limits.cashReservePct / 100),
      review: strategy.limits.rebalance,
    },
    ori: {
      enabled: Boolean(strategy.limits.allowOri),
      role: strategy.limits.oriRole,
      minimum_confidence: strategy.limits.minOriConfidence,
      brief: strategy.oriBrief || "",
    },
    benchmark: strategy.benchmark,
    paper: {
      starting_cash: strategy.paper.startingCash,
    },
  };
  return `# Orizin Strategy YAML v1\n# Conditions run top to bottom. Fixed eligibility and limits cannot be overridden by Ori.\n${stringify(document, { indent: 2, lineWidth: 0 })}`;
}

function parsePercent(value, path, errors) {
  if (typeof value === "string" && value.trim().endsWith("%")) {
    const number = Number(value.trim().slice(0, -1));
    if (Number.isFinite(number)) return number / 100;
  }
  if (Number.isFinite(Number(value))) {
    const number = Number(value);
    return Math.abs(number) > 1 ? number / 100 : number;
  }
  errors.push(`${path} must be a percentage such as 15%.`);
  return 0;
}

function parseBoolean(value, path, errors) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "true") return true;
  if (value === 0 || value === "false") return false;
  errors.push(`${path} must be true or false.`);
  return false;
}

function parseRule(value, path, errors, id) {
  if (!isObject(value)) {
    errors.push(`${path} must be a condition object.`);
    return null;
  }
  const metricKey = String(value.metric || "");
  const metric = STRATEGY_METRICS[metricKey];
  if (!metric) errors.push(`${path}.metric "${metricKey || "missing"}" is not supported.`);
  const operator = String(value.operator || "");
  if (!OPERATORS.has(operator)) errors.push(`${path}.operator must be one of ${[...OPERATORS].join(", ")}.`);
  if (metric?.unit === "boolean" && operator !== "=") errors.push(`${path}.operator must be = for a boolean metric.`);
  const parseValue = (entry, entryPath) => metric?.unit === "percent"
    ? parsePercent(entry, entryPath, errors)
    : metric?.unit === "boolean"
      ? parseBoolean(entry, entryPath, errors)
      : Number(entry);
  const expected = parseValue(value.value, `${path}.value`);
  if (metric?.unit !== "boolean" && !Number.isFinite(expected)) errors.push(`${path}.value must be a number.`);
  const rule = {
    id,
    metric: metricKey,
    operator,
    value: expected,
    label: String(value.explanation || "").slice(0, 180),
  };
  if (operator === "between") {
    const upper = parseValue(value.upper, `${path}.upper`);
    if (metric?.unit !== "boolean" && !Number.isFinite(upper)) errors.push(`${path}.upper must be a number.`);
    rule.value2 = upper;
  }
  if (metric?.supportsLookback) {
    const lookback = Number(value.lookback_days ?? metric.defaultLookback);
    if (!Number.isInteger(lookback) || lookback < (metric.minLookback || 2) || lookback > (metric.maxLookback || 252)) {
      errors.push(`${path}.lookback_days must be between ${metric.minLookback || 2} and ${metric.maxLookback || 252}.`);
    }
    rule.lookbackDays = lookback;
  }
  return rule;
}

function parseConditions(value, path, errors, idPrefix, limit = 10) {
  if (!Array.isArray(value) || !value.length) {
    errors.push(`${path} must contain at least one condition.`);
    return [];
  }
  if (value.length > limit) errors.push(`${path} cannot contain more than ${limit} conditions.`);
  return value.slice(0, limit).map((condition, index) => parseRule(condition, `${path}[${index}]`, errors, `${idPrefix}_${index}`)).filter(Boolean);
}

function parseDocumentRoot(source) {
  if (typeof source !== "string" || !source.trim()) throw new StrategyYamlError(["Strategy YAML cannot be empty."]);
  if (source.length > MAX_YAML_LENGTH) throw new StrategyYamlError(["Strategy YAML must be smaller than 50 KB."]);
  const document = parseDocument(source, { schema: "core", prettyErrors: true, strict: true, maxAliasCount: 0 });
  if (document.errors.length) throw new StrategyYamlError(document.errors.map((error) => error.message));
  let root;
  try {
    root = document.toJS({ maxAliasCount: 0 });
  } catch (error) {
    throw new StrategyYamlError([error.message]);
  }
  if (!isObject(root)) throw new StrategyYamlError(["The YAML root must be an object."]);
  return root;
}

export function strategyFromYaml(source, baseInput) {
  const root = parseDocumentRoot(source);
  const base = normalizeStrategy(baseInput);
  const errors = [];
  if (root.version !== 1) errors.push("version must be 1.");
  if (!String(root.name || "").trim()) errors.push("name is required.");
  if (String(root.name || "").length > 60) errors.push("name cannot exceed 60 characters.");
  if (String(root.description || "").length > 500) errors.push("description cannot exceed 500 characters.");

  const universe = isObject(root.universe) ? root.universe : {};
  if (!isObject(root.universe)) errors.push("universe is required.");
  const universeType = universe.type === "symbols" ? "symbols" : universe.type === "stocks" ? "stocks" : null;
  if (!universeType) errors.push("universe.type must be stocks or symbols.");
  const symbols = Array.isArray(universe.symbols) ? universe.symbols.map((symbol) => String(symbol).trim().toUpperCase()).filter(Boolean) : [];
  if (universeType === "symbols" && !symbols.length) errors.push("universe.symbols must contain at least one ticker when type is symbols.");
  if (symbols.some((symbol) => !/^[A-Z0-9.-]{1,12}$/.test(symbol))) errors.push("universe.symbols contains an invalid ticker.");
  if (symbols.length > 50) errors.push("universe.symbols cannot contain more than 50 tickers.");
  const includeEtfs = parseBoolean(universe.include_etfs ?? false, "universe.include_etfs", errors);

  const eligibilityRoot = isObject(root.eligibility) ? root.eligibility : {};
  const eligibility = isObject(eligibilityRoot.if) ? eligibilityRoot.if : eligibilityRoot;
  if (isObject(eligibilityRoot.if) && eligibilityRoot.then !== "continue") errors.push("eligibility.then must be continue.");
  if (isObject(eligibilityRoot.if) && eligibilityRoot.else !== "reject") errors.push("eligibility.else must be reject.");
  if (eligibility.match && eligibility.match !== "all") errors.push("eligibility.match must be all. Use decision_tree for any/else logic.");
  const rules = parseConditions(eligibility.conditions, "eligibility.if.conditions", errors, "yaml_rule");

  const tree = Array.isArray(root.decision_tree) ? root.decision_tree : [];
  if (!Array.isArray(root.decision_tree)) errors.push("decision_tree must be an array ending with else.");
  if (tree.length > 9) errors.push("decision_tree cannot contain more than 8 when branches plus else.");
  const branches = [];
  let elseCount = 0;
  tree.slice(0, 9).forEach((entry, index) => {
    const path = `decision_tree[${index}]`;
    if (!isObject(entry)) {
      errors.push(`${path} must contain when/then or else.`);
      return;
    }
    if (entry.else !== undefined) {
      elseCount++;
      if (index !== tree.length - 1) errors.push(`${path}.else must be the final decision-tree entry.`);
      const fallback = entry.else;
      if (!isObject(fallback) || fallback.allocation !== "normal" || Number(fallback.weight_multiplier) !== 1) {
        errors.push(`${path}.else must use normal allocation with weight_multiplier 1.`);
      }
      return;
    }
    if (!isObject(entry.when) || !isObject(entry.then)) {
      errors.push(`${path} must contain both when and then.`);
      return;
    }
    const match = String(entry.when.match || "all");
    if (!MATCHES.has(match)) errors.push(`${path}.when.match must be all or any.`);
    const action = String(entry.then.allocation || "");
    if (!ACTIONS.has(action)) errors.push(`${path}.then.allocation must be overweight, normal, underweight, or exclude.`);
    const multiplier = action === "exclude" ? 0 : Number(entry.then.weight_multiplier);
    if (action !== "exclude" && (!Number.isFinite(multiplier) || multiplier < 0.1 || multiplier > 3)) {
      errors.push(`${path}.then.weight_multiplier must be between 0.1 and 3.`);
    }
    branches.push({
      id: `yaml_branch_${index}`,
      name: String(entry.when.name || `Branch ${index + 1}`).slice(0, 100),
      match,
      conditions: parseConditions(entry.when.conditions, `${path}.when.conditions`, errors, `yaml_branch_${index}_rule`, 6),
      action,
      multiplier,
    });
  });
  if (elseCount !== 1) errors.push("decision_tree must end with exactly one explicit else entry.");

  const ranking = isObject(root.ranking) ? root.ranking : {};
  if (!STRATEGY_METRICS[ranking.metric]) errors.push(`ranking.metric "${ranking.metric || "missing"}" is not supported.`);
  if (ranking.tiebreaker && !STRATEGY_METRICS[ranking.tiebreaker]) errors.push(`ranking.tiebreaker "${ranking.tiebreaker}" is not supported.`);
  if (ranking.direction && !["asc", "desc"].includes(ranking.direction)) errors.push("ranking.direction must be asc or desc.");
  const rankingMetric = STRATEGY_METRICS[ranking.metric];
  const rankingLookback = Number(ranking.lookback_days ?? rankingMetric?.defaultLookback ?? 63);
  if (rankingMetric?.supportsLookback && (!Number.isInteger(rankingLookback) || rankingLookback < 2 || rankingLookback > 252)) errors.push("ranking.lookback_days must be between 2 and 252.");
  const portfolio = isObject(root.portfolio) ? root.portfolio : {};
  const maxPositions = Number(portfolio.max_positions);
  const maxPosition = parsePercent(portfolio.max_position, "portfolio.max_position", errors) * 100;
  const minimumCash = parsePercent(portfolio.minimum_cash, "portfolio.minimum_cash", errors) * 100;
  if (!Number.isInteger(maxPositions) || maxPositions < 1 || maxPositions > 20) errors.push("portfolio.max_positions must be between 1 and 20.");
  if (maxPosition < 3 || maxPosition > 100) errors.push("portfolio.max_position must be between 3% and 100%.");
  if (minimumCash < 0 || minimumCash > 90) errors.push("portfolio.minimum_cash must be between 0% and 90%.");
  if (!["Daily", "Weekly", "Every 2 weeks", "Monthly", "Quarterly"].includes(portfolio.review)) errors.push("portfolio.review must be Daily, Weekly, Every 2 weeks, Monthly, or Quarterly.");
  const ori = isObject(root.ori) ? root.ori : {};
  const oriEnabled = parseBoolean(ori.enabled ?? false, "ori.enabled", errors);
  const oriConfidence = Number(ori.minimum_confidence);
  if (!Number.isFinite(oriConfidence) || oriConfidence < 50 || oriConfidence > 100) errors.push("ori.minimum_confidence must be between 50 and 100.");
  if (String(ori.brief || "").length > 500) errors.push("ori.brief cannot exceed 500 characters.");
  const startingCash = Number(root.paper?.starting_cash ?? base.paper.startingCash);
  if (!Number.isFinite(startingCash) || startingCash < 1000) errors.push("paper.starting_cash must be at least 1000.");
  if (base.paper.holdings.length && startingCash !== base.paper.startingCash) errors.push("paper.starting_cash cannot change after the strategy has holdings.");
  const benchmark = String(root.benchmark || "SPY").toUpperCase();
  if (!/^[A-Z0-9.-]{1,12}$/.test(benchmark)) errors.push("benchmark must be a valid ticker.");

  if (errors.length) throw new StrategyYamlError(errors);
  const hasHoldings = base.paper.holdings.length > 0;
  return normalizeStrategy({
    ...base,
    name: String(root.name).trim(),
    description: String(root.description || ""),
    universe: {
      type: universeType,
      symbols,
      sectors: Array.isArray(universe.sectors) ? universe.sectors.map(String) : [],
      includeEtfs,
    },
    rules,
    branches,
    ranking: {
      primary: ranking.metric,
      lookbackDays: rankingLookback,
      secondary: ranking.tiebreaker || "conviction",
      direction: ranking.direction === "asc" ? "asc" : "desc",
    },
    limits: {
      ...base.limits,
      maxPositions,
      maxPositionPct: maxPosition,
      cashReservePct: minimumCash,
      rebalance: String(portfolio.review || "Monthly"),
      allowOri: oriEnabled,
      oriRole: String(ori.role || (ori.enabled ? "Rank rule-approved finalists only" : "Off. Fixed rules decide every allocation")),
      minOriConfidence: oriConfidence,
    },
    oriBrief: String(ori.brief || ""),
    benchmark,
    paper: {
      ...base.paper,
      startingCash: hasHoldings ? base.paper.startingCash : startingCash,
      cash: hasHoldings ? base.paper.cash : startingCash,
    },
  });
}

export function validateStrategyYaml(source, baseInput) {
  try {
    return { strategy: strategyFromYaml(source, baseInput), errors: [] };
  } catch (error) {
    return { strategy: null, errors: error instanceof StrategyYamlError ? error.errors : [error.message] };
  }
}
