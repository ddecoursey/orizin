import { computeFit } from "./fitScore.js";
import { computeVerdict } from "./verdict.js";

// Price % change over ~N trading days back from the latest close.
// points: [{ date, price }] oldest→newest. The detail chart loads ~5 years of
// dailies, so "1y" must be ~252 trading days back — using the full window here
// previously reported the 5-year change as "1yr" to Ori and the UI.
export function pricePerformance(points) {
  if (!points || points.length < 2) return null;
  const last = points[points.length - 1].price;
  const at = (n) => {
    const base = points[Math.max(0, points.length - 1 - n)].price;
    return base ? (last - base) / base : null;
  };
  return {
    m1: at(21),
    m3: at(63),
    m6: at(126),
    y1: at(Math.min(252, points.length - 1)),
  };
}

// Latest RSI plus its direction over the last ~5 sessions. rsi: [{ date, rsi }].
export function rsiTrend(rsi) {
  if (!rsi || rsi.length < 2) return null;
  const latest = rsi[rsi.length - 1].rsi;
  const prev = rsi[Math.max(0, rsi.length - 6)].rsi;
  const change5d = latest - prev;
  return {
    latest,
    change5d,
    direction: change5d > 1 ? "rising" : change5d < -1 ? "falling" : "flat",
  };
}

/**
 * One stock as Ori sees it: the screener row plus everything useStockDetail
 * fetched (profile, ratings, grades, DCF/targets, insider, news, technicals,
 * earnings, smart money), derived momentum, personal Fit and the Game Plan
 * verdict under the user's lens. Every place that hands a stock to Ori (the
 * open overview, Deep Research, and up to two chat-focus symbols) builds it
 * here, so the four contexts can never drift apart.
 *
 * @param {object|null} row     screener row (null → null)
 * @param {object} detail       useStockDetail() result for the same symbol
 * @param {object} fitCtx       personal fit context from useScreener
 * @param {{risk?: string, weights?: object}} lens
 */
export function buildOriStockContext(row, detail = {}, fitCtx = null, lens = {}) {
  if (!row) return null;
  const fit = computeFit(row, fitCtx);
  const rsi = detail.rsi;
  return {
    ...row,
    profile: detail.profile,
    ratings: detail.ratings,
    grades: detail.grades,
    aiData: detail.aiData,
    insider: detail.insider,
    news: detail.news || [],
    latestRsi: rsi?.length ? rsi[rsi.length - 1].rsi : null,
    performance: pricePerformance(detail.points),
    rsiTrend: rsiTrend(rsi),
    technicals: detail.technicals,
    earnings: detail.earnings,
    smartMoney: detail.smartMoney,
    fit,
    verdict: computeVerdict(row, detail, fit, { risk: lens.risk, weights: lens.weights }),
  };
}
