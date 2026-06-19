// Portfolio gap / overlap helpers for goals page and Deep Research context.

export function computePortfolioOverlap(row, ctx) {
  if (!ctx?.hasContext || !row?.symbol) return null;
  const sym = row.symbol.toUpperCase();
  const held = ctx.heldSymbols?.has(sym);
  let sectorPct = null;
  let sectorHeavy = false;
  if (ctx.hasSectorWeights && row.sector) {
    sectorPct = ctx.sectorWeight.get(row.sector) || 0;
    sectorHeavy = sectorPct >= 0.25;
  }
  return { held, sectorPct, sectorHeavy, sector: row.sector || null };
}

export function computeSectorGaps(ctx, stocks = []) {
  if (!ctx?.hasSectorWeights || !stocks.length) return [];
  const universeSectors = new Map();
  for (const s of stocks) {
    if (!s.sector) continue;
    universeSectors.set(s.sector, (universeSectors.get(s.sector) || 0) + 1);
  }
  const gaps = [];
  for (const [sector, count] of universeSectors) {
    const w = ctx.sectorWeight.get(sector) || 0;
    if (w < 0.05 && count >= 3) {
      gaps.push({ sector, portfolioPct: Math.round(w * 100), universeCount: count });
    }
  }
  return gaps.sort((a, b) => b.universeCount - a.universeCount).slice(0, 6);
}

export function overlapChipText(overlap) {
  if (!overlap) return null;
  if (overlap.held) return "Already in your portfolio";
  if (overlap.sectorHeavy && overlap.sector) {
    return `Heavy ${overlap.sector} exposure (${Math.round((overlap.sectorPct || 0) * 100)}% of portfolio)`;
  }
  return null;
}