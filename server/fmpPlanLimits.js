// Optional FMP plan gates — env-driven so upgrades are a config change, not a deploy.
// When FMP_EXEC_COMP_SYMBOLS is unset or empty, executive compensation is fetched for
// all symbols. Set a comma-separated allowlist on starter-tier plans that limit the
// governance-executive-compensation endpoint to specific tickers.

let allowSet = null;
let parsed = false;
const deniedExecCompSymbols = new Set();

function execCompAllowSet() {
  if (parsed) return allowSet;
  parsed = true;
  const raw = process.env.FMP_EXEC_COMP_SYMBOLS;
  if (raw == null || String(raw).trim() === "") {
    allowSet = null;
    return null;
  }
  allowSet = new Set(
    String(raw)
      .split(/[,\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
  );
  return allowSet;
}

/** True when this symbol may call FMP executive-compensation. Default: all symbols. */
export function execCompAllowed(symbol) {
  const set = execCompAllowSet();
  const normalized = String(symbol || "").toUpperCase();
  if (deniedExecCompSymbols.has(normalized)) return false;
  if (!set) return true;
  return set.has(normalized);
}

/** True when an allowlist is configured (starter-style plan gate). */
export function execCompRestricted() {
  return execCompAllowSet() != null;
}

/**
 * Remember symbol-level Starter-plan denials for this process. FMP returns 402
 * for executive-compensation on a small, changing subset of tickers; once a
 * symbol is denied, avoid spending another API call on every detail refresh.
 */
export function markExecCompUnavailable(symbol) {
  const normalized = String(symbol || "").toUpperCase();
  if (normalized) deniedExecCompSymbols.add(normalized);
}

/** Test hook */
export function _resetFmpPlanLimitsForTests() {
  allowSet = null;
  parsed = false;
  deniedExecCompSymbols.clear();
}
