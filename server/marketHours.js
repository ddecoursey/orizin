// US equity market session helper (America/New_York, DST-safe).
// Used by the background enrichment scheduler to spend FMP quota where it
// matters (live prices during the trading day) and go quiet overnight and on
// weekends, and by Ori's prompt so it knows whether the market is open.

const ET_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

// Returns { weekday: 'Mon', minutes: minutes-since-midnight-ET }
function nowInET(date = new Date()) {
  const parts = Object.fromEntries(
    ET_FMT.formatToParts(date).map((p) => [p.type, p.value]),
  );
  // 'hour12: false' can yield '24' for midnight in some ICU versions.
  const hour = Number(parts.hour) % 24;
  return {
    weekday: parts.weekday,
    minutes: hour * 60 + Number(parts.minute),
  };
}

const OPEN_MIN = 9 * 60 + 30; // 09:30 ET
const CLOSE_MIN = 16 * 60;    // 16:00 ET
const WEEKDAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);

// 'open' | 'pre' | 'after' | 'closed' (closed = weekend / overnight)
export function marketSession(date = new Date()) {
  const { weekday, minutes } = nowInET(date);
  if (!WEEKDAYS.has(weekday)) return 'closed';
  if (minutes >= OPEN_MIN && minutes < CLOSE_MIN) return 'open';
  if (minutes >= 4 * 60 && minutes < OPEN_MIN) return 'pre';
  if (minutes >= CLOSE_MIN && minutes < 20 * 60) return 'after';
  return 'closed';
}

export function isMarketOpen(date = new Date()) {
  return marketSession(date) === 'open';
}

// Human-readable session descriptor for prompts and the debug page.
export function marketStatusLine(date = new Date()) {
  const session = marketSession(date);
  const et = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
  const label = {
    open: 'US market OPEN (regular session)',
    pre: 'US pre-market',
    after: 'US after-hours',
    closed: 'US market CLOSED',
  }[session];
  return `${label} — ${et} ET`;
}
