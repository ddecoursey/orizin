// ─────────────────────────────────────────────────────────────────────────────
// Guided-tour definitions.
//
// A tour is a list of steps. Each step is declarative:
//
//   id        stable key (used for React keys and progress)
//   title     the heading on the card
//   body      string, or JSX for anything richer than a paragraph
//   tip       optional highlighted aside ("the thing people get wrong")
//   target    CSS selector for the element to spotlight. Always a
//             [data-tour="…"] hook so refactoring class names can't break a
//             tour. Omit for a step that explains a concept rather than a control.
//   placement "auto" (default) | "top" | "bottom" | "left" | "right"
//   setup     (actions, ctx) => void|Promise — runs BEFORE the spotlight is
//             measured: navigate to the page, open the panel, pick a symbol.
//   when      (ctx) => boolean — drop the step for accounts that can't see it
//             (Pro-only panels, admin-only menus, desktop-only controls).
//
// Copy rules: plain language first, the jargon second. Anything numeric is
// stated the way the code actually computes it (see lib/verdict.js,
// lib/scoring.js, lib/personas.js, lib/fitScore.js) — a tour that lies about
// the scores is worse than no tour.
// ─────────────────────────────────────────────────────────────────────────────

export const TOUR_VERSION = 1;

// Which tour explains each main view — drives "Tour this page" in the Guide menu.
export const PAGE_TOURS = {
  screener: "screener",
  "deep-research": "deep-research",
  "portfolio-goals": "portfolio",
  strategies: "strategies",
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Most steps just need "be on this page, with nothing overlapping": close the
// chat, watchlist, quick-overview panes and (on small screens) the filter
// overlay, then navigate. A step that needs one of those open re-opens it in
// `extra`.
function onView(view, extra) {
  return async (a, ctx) => {
    a.resetSurface?.();
    if (view) a.goto?.(view);
    await extra?.(a, ctx);
    // One frame for the view swap, plus a beat for lazy chunks (Strategies and
    // the landing page are code-split) to mount before we measure.
    await wait(view ? 260 : 60);
  };
}

// Deep Research steps need a symbol on the page. With none open yet, the tour
// opens the largest enriched stock in the universe as a demo.
const onResearch = onView("deep-research", async (a, ctx) => {
  if (!ctx.researchSymbol && ctx.demoSymbol) a.openResearch?.(ctx.demoSymbol);
});

const isPro = (ctx) => !!ctx.canUseOri;
const isDesktop = (ctx) => !ctx.isMobile;

// ── The grand tour ───────────────────────────────────────────────────────────
const WELCOME = {
  id: "welcome",
  name: "Start here",
  blurb: "The 2-minute overview: what Orizin does and how the four pages fit together.",
  minutes: 2,
  steps: [
    {
      id: "what-is-it",
      title: "Welcome to Orizin",
      body: (
        <>
          <p>
            Orizin narrows thousands of stocks down to the handful worth your attention, then helps you
            decide what to do with them.
          </p>
          <p>
            Four pages, in the order you&rsquo;ll use them: <strong className="text-gray-100">Screener</strong> to
            find candidates, <strong className="text-gray-100">Deep Research</strong> to judge one,{" "}
            <strong className="text-gray-100">Portfolio</strong> to see how it fits what you already own, and{" "}
            <strong className="text-gray-100">Strategies</strong> to test rule-based ideas as simulated paper
            portfolios.
          </p>
        </>
      ),
      tip: "Nothing here is financial advice. Every score is a starting point for your own homework.",
      setup: onView("screener"),
    },
    {
      id: "nav",
      title: "Your four pages",
      body: "These are the only navigation you need. The tour will move between them for you — you can also jump around yourself at any time and come back.",
      target: '[data-tour="nav"]',
      placement: "bottom",
      setup: onView("screener"),
    },
    {
      id: "table",
      title: "The screener table",
      body: "Every stock that survives your filters, one per row. Click any row to open a quick overview panel; the ★ pin keeps a row at the top while you work.",
      target: '[data-tour="results"]',
      placement: "top",
      setup: onView("screener"),
    },
    {
      id: "conviction",
      title: "Conviction is the headline number",
      body: (
        <>
          <p>
            One 0&ndash;100 score per stock, blending seven pillars: Fundamentals, Valuation, Technicals,
            Insiders, Analyst, Portfolio Fit and Intangibles.
          </p>
          <p>
            It uses <strong className="text-gray-100">absolute thresholds</strong>, not a ranking against
            whatever you happen to have filtered. A 72 means the same thing every time you see it.
          </p>
        </>
      ),
      tip: "Rows with too little data are left blank rather than given a misleading number.",
      target: '[data-tour="results"]',
      placement: "top",
      setup: onView("screener"),
    },
    {
      id: "lens",
      title: "Make the score yours",
      body: "The Lens sets your investor persona, risk tolerance, horizon and goal. That re-weights the seven pillars — a Deep Value lens leans hard on Valuation, a Disruptor lens leans on Intangibles — so Conviction re-scores the whole table for how you actually invest.",
      target: '[data-tour="lens"]',
      placement: "bottom",
      when: isDesktop,
      setup: onView("screener"),
    },
    {
      id: "filters",
      title: "Filters narrow the field",
      body: "Market cap, sector, valuation, profitability, growth, leverage — set any of them and the table narrows instantly. The counter above the table always shows how many stocks survived.",
      target: '[data-tour="filters"]',
      placement: "right",
      setup: onView("screener", async (a) => a.setSidebarCollapsed?.(false)),
    },
    {
      id: "deep-research",
      title: "Deep Research: one stock, everything known",
      body: "When a name looks interesting, open it here. Statements, filings, peers, insider activity, analyst targets and technicals on one page — refreshed from market data the moment you open it. Pro adds a plain-English Game Plan on top.",
      target: '[data-tour="nav-deep-research"]',
      placement: "bottom",
      setup: onView("screener"),
    },
    {
      id: "ori",
      title: "Ori, your research analyst",
      body: "Ori already knows what you've filtered, what you own and what you're looking at — so ask it to reason, not to look things up. \"Which of these has the most durable moat?\" is a good question for Ori.",
      target: '[data-tour="ori-launch"]',
      placement: "left",
      when: isPro,
      setup: onView("screener", async (a) => a.setChatOpen?.(false)),
    },
    {
      id: "ori-locked",
      title: "Ori, your research analyst",
      body: "Ori is an AI analyst that reasons over your filtered results, your portfolio and the stock you're viewing. Ori chat and the Deep Research Game Plan are Pro features — the screener, filters, Conviction scores and Deep Research's data panels all work on a free account.",
      target: '[data-tour="ori-launch"]',
      placement: "left",
      when: (ctx) => !ctx.canUseOri,
      setup: onView("screener", async (a) => a.setChatOpen?.(false)),
    },
    {
      id: "watchlist",
      title: "Watchlist",
      body: "Names you're tracking. Watchlist symbols get priority price refreshes and can fire alerts when something moves — it is not the same as the ★ pins, which only reorder the screener table.",
      target: '[data-tour="watchlist-button"]',
      placement: "bottom",
      setup: onView("screener"),
    },
    {
      id: "help",
      title: "That's the tour",
      body: "Every page has its own deeper tour. Open this menu any time to run one, or to replay this overview.",
      tip: "Keyboard: → and ← move between steps, Esc leaves the tour.",
      target: '[data-tour="help-button"]',
      placement: "bottom",
      setup: onView("screener"),
    },
  ],
};

// ── Screener ─────────────────────────────────────────────────────────────────
const SCREENER = {
  id: "screener",
  name: "The Screener",
  blurb: "Filters, tabs, columns, pins and the scores — how to actually find something.",
  minutes: 4,
  steps: [
    {
      id: "intro",
      title: "Finding candidates",
      body: "The screener starts with the whole loaded universe and removes everything that fails your filters. The goal is to get from thousands of names to a shortlist you can actually read.",
      setup: onView("screener"),
    },
    {
      id: "tabs",
      title: "Tabs are saved screens",
      body: "Each tab keeps its own filters, sort and pins. Use one per idea — \"cheap compounders\", \"AI infrastructure\", \"dividend payers\" — and switch between them without losing your setup. Tabs follow your account, not this browser.",
      target: '[data-tour="tabs"]',
      placement: "bottom",
      setup: onView("screener"),
    },
    {
      id: "filters",
      title: "The filter panel",
      body: "Every row is one criterion. Most take a minimum, a maximum, or a range — pick the operator on the left, type the number on the right. Leaving a row empty means \"don't filter on this\".",
      tip: "Conviction has its own violet filter row — the fastest way to cut to the top of the list.",
      target: '[data-tour="filters"]',
      placement: "right",
      setup: onView("screener", async (a) => a.setSidebarCollapsed?.(false)),
    },
    {
      id: "search",
      title: "Search by symbol or name",
      body: "Type to narrow the table to matching tickers or company names. It filters what's already in the table; the search box at the top of the page jumps straight to a stock's Deep Research page instead.",
      target: '[data-tour="screener-search"]',
      placement: "bottom",
      setup: onView("screener"),
    },
    {
      id: "count",
      title: "How much survived",
      body: "Shown as \"matching / loaded\". If the first number is 0 your filters are too tight; if it's still in the thousands, you haven't really screened yet.",
      target: '[data-tour="screener-count"]',
      placement: "bottom",
      setup: onView("screener"),
    },
    {
      id: "lens",
      title: "The Lens — persona, risk, horizon, goal",
      body: (
        <>
          <p>This is the single biggest lever on your results, and it is personal to you.</p>
          <p>
            <strong className="text-gray-100">Persona</strong> sets the base pillar weights (Value, Deep Value,
            Compounder, GARP, Balanced Growth, Momentum, Disruptor).{" "}
            <strong className="text-gray-100">Risk</strong> then penalises speculative names &mdash; heavily on
            Conservative, barely at all on Aggressive. <strong className="text-gray-100">Horizon</strong> and{" "}
            <strong className="text-gray-100">Goal</strong> nudge the weights further.
          </p>
        </>
      ),
      tip: "Change the Lens and watch Conviction re-order the table. Nothing about the companies changed — only what you asked the score to care about.",
      target: '[data-tour="lens"]',
      placement: "bottom",
      when: isDesktop,
      setup: onView("screener"),
    },
    {
      id: "views",
      title: "Table or scorecards",
      body: "Table is dense and sortable — best for comparing many names on one metric. Scorecards show fewer names with more context each. On a phone the app starts you on scorecards.",
      target: '[data-tour="view-toggle"]',
      placement: "bottom",
      when: isDesktop,
      setup: onView("screener"),
    },
    {
      id: "columns",
      title: "Reading a row",
      body: (
        <>
          <p>Click any column header to sort by it; click again to reverse.</p>
          <p>
            The ★ in the first column <em>pins</em> a row to the top of this tab. That is a
            sorting convenience only &mdash; it does not add the stock to your watchlist and does not
            affect refresh priority.
          </p>
        </>
      ),
      target: '[data-tour="results"]',
      placement: "top",
      setup: onView("screener"),
    },
    {
      id: "conviction",
      title: "Conviction, in detail",
      body: (
        <>
          <p>0&ndash;100, from seven pillars weighted by your Lens:</p>
          <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
            <li><strong className="text-gray-200">Fundamentals</strong> &mdash; profitability, growth, balance-sheet safety</li>
            <li><strong className="text-gray-200">Valuation</strong> &mdash; how cheap it is vs intrinsic value and peers</li>
            <li><strong className="text-gray-200">Technicals</strong> &mdash; trend and momentum</li>
            <li><strong className="text-gray-200">Insiders</strong> &mdash; corporate insider and US Congress buying vs selling</li>
            <li><strong className="text-gray-200">Analyst</strong> &mdash; consensus rating and price-target upside</li>
            <li><strong className="text-gray-200">Portfolio Fit</strong> &mdash; match to your holdings, goals and theses</li>
            <li><strong className="text-gray-200">Intangibles</strong> &mdash; Ori&rsquo;s judgment on moat, relevance and ecosystem</li>
          </ul>
        </>
      ),
      tip: "Until Ori has actually reviewed a name, the Intangibles pillar runs on a cheap proxy at reduced weight — so a reviewed stock's Conviction is the more trustworthy one.",
      target: '[data-tour="results"]',
      placement: "top",
      setup: onView("screener"),
    },
    {
      id: "fit",
      title: "Portfolio Fit is about you, not the company",
      body: "Fundamentals asks \"is this a good business?\". Fit asks \"is this right for me?\" — it looks at what you already hold, how concentrated you'd become in that sector, and whether the company matches the goals and theses you wrote on the Portfolio page.",
      tip: "Fit stays flat until you've entered holdings or goals. Filling in the Portfolio page is what switches it on.",
      target: '[data-tour="nav-portfolio"]',
      placement: "bottom",
      setup: onView("screener"),
    },
    {
      id: "data-menu",
      title: "Data actions",
      body: "Admin only. \"Universe Refresh\" re-pulls the full symbol list from FMP; \"Gather\" fills in or force-refreshes the fundamentals for on-screen stocks; \"Add ticker\" pulls in a symbol that isn't in the universe yet — a recent IPO, say.",
      target: '[data-tour="data-menu"]',
      placement: "bottom",
      when: (ctx) => !!ctx.isAdmin,
      setup: onView("screener"),
    },
    {
      id: "next",
      title: "Then go deep",
      body: "A shortlist is only the start. Click a row for the quick overview, or open Deep Research for the full picture on one name.",
      target: '[data-tour="nav-deep-research"]',
      placement: "bottom",
      setup: onView("screener"),
    },
  ],
};

// ── Deep Research ────────────────────────────────────────────────────────────
const DEEP_RESEARCH = {
  id: "deep-research",
  name: "Deep Research",
  blurb: "One stock, every angle — and the Game Plan that turns it into a decision.",
  minutes: 4,
  steps: [
    {
      id: "intro",
      title: "Everything known about one stock",
      body: "Deep Research is the single-stock surface: financial statements, SEC filings, peers, executive pay, insider and Congress activity, analyst targets, a DCF, technicals and news — plus, on Pro, a Game Plan that says what it all adds up to.",
      tip: "Opening a stock refreshes it automatically: a live quote, and its key metrics and ratios if they're more than a day old. The small spinner beside the price means that refresh is running.",
      setup: onResearch,
    },
    {
      id: "switch",
      title: "Switch symbol without leaving",
      body: "Search any stock or ETF in the universe to swap the whole page over to it — the fastest way to hop between two names you're comparing.",
      target: '[data-tour="dr-search"]',
      placement: "bottom",
      setup: onResearch,
    },
    {
      id: "gameplan",
      title: "The Game Plan",
      body: (
        <>
          <p>The plain-English answer to &ldquo;what do I do with this?&rdquo;, split into two honest halves:</p>
          <p>
            <strong className="text-gray-100">Horizon</strong> &mdash; how long the business is worth owning
            (trade, 1yr, 3yr, 5yr, 10yr+). Driven by durability: profitability, balance-sheet safety, earnings
            consistency, size and growth. A great business earns a long horizon whatever its price today.
          </p>
          <p>
            <strong className="text-gray-100">Action</strong> &mdash; what to do at <em>today&rsquo;s</em> price
            (for example Accumulate, Start a position, Wait for a pullback, Avoid). Driven by valuation and timing.
          </p>
        </>
      ),
      tip: "A 10-year Horizon with a \"Wait for a pullback\" Action is a completely coherent answer: great company, poor entry price.",
      target: '[data-tour="dr-gameplan"]',
      placement: "bottom",
      when: isPro,
      setup: onResearch,
    },
    {
      id: "ori-take",
      title: "Ori's take sits on top",
      body: "The Game Plan is computed from the numbers first, then Ori's review is folded in \"within reason\" — it can shift the call, not overturn the arithmetic. Ori's deep review for a symbol is cached for about a week, so re-opening the page is instant and doesn't count against your usage.",
      tip: "\"Refresh Ori\" asks for a quick second opinion without discarding the weekly review. If a refresh can't get through, the take you were reading stays on screen.",
      target: '[data-tour="dr-gameplan"]',
      placement: "bottom",
      when: isPro,
      setup: onResearch,
    },
    {
      id: "pro-gate",
      title: "The Game Plan is a Pro feature",
      body: "Pro turns everything on this page into one verdict: a hold Horizon, a right-now Action, the Conviction behind them, and Ori's written read on the intangibles. Free accounts keep the chart, financials, every data panel below and the Conviction score in the header.",
      target: '[data-tour="dr-gameplan"]',
      placement: "bottom",
      when: (ctx) => !ctx.canUseOri,
      setup: onResearch,
    },
    {
      id: "toolbar",
      title: "The toolbar",
      body: (
        <>
          <p>
            <strong className="text-gray-100">Watchlist</strong> adds this symbol to your tracked names
            (priority refresh and alerts). <strong className="text-gray-100">Ori</strong> opens the chat already
            focused on it.
          </p>
          <p className="text-[11px] text-gray-400">
            Admins also see <strong className="text-gray-200">Re-gather</strong>, which force-refreshes every
            data set for the stock — everyone else gets the automatic refresh on open.
          </p>
        </>
      ),
      target: '[data-tour="dr-toolbar"]',
      placement: "bottom",
      setup: onResearch,
    },
    {
      id: "panels",
      title: "Scroll for the full file",
      body: "Below the Game Plan: price and RSI chart, company profile, valuation and DCF, analyst targets and grades, technical signals, earnings history and the next date, insider and Congress trades, financial statements by year, SEC filings, peers, executive compensation and news.",
      tip: "A panel marked \"coming soon\" is a placeholder for an endpoint that isn't wired up yet — not missing data for this particular stock.",
      target: '[data-tour="dr-panels"]',
      placement: "top",
      setup: onResearch,
    },
    {
      id: "lens",
      title: "The Lens applies here too",
      body: "Same persona, risk, horizon and goal as the screener — one setting shared everywhere. Change it here and the Conviction in the header (and, on Pro, the Game Plan's weighting) moves with it.",
      target: '[data-tour="lens"]',
      placement: "bottom",
      setup: onResearch,
    },
  ],
};

// ── Ori ──────────────────────────────────────────────────────────────────────
const ORI = {
  id: "ori",
  name: "Working with Ori",
  blurb: "What Ori can see, what to ask it, and how usage works.",
  minutes: 3,
  steps: [
    {
      id: "open",
      title: "Ori is a research analyst, not a search box",
      body: "Ori already has your filtered screener results, your Lens, your portfolio and goals, and the full detail of whatever stock you're looking at. Ask it to reason over that — not to look things up.",
      target: '[data-tour="ori-launch"]',
      placement: "left",
      setup: onView("screener"),
    },
    {
      id: "panel",
      title: "The chat panel",
      body: "Type a question, or tap one of the starter questions. On the screener Ori can suggest filter changes — it always asks before applying them, and it never touches your Lens.",
      target: '[data-tour="chat-panel"]',
      placement: "top",
      when: isPro,
      setup: onView("screener", async (a) => {
        a.setChatOpen?.(true);
        await wait(240);
      }),
    },
    {
      id: "page-aware",
      title: "Ori follows you around",
      body: (
        <>
          <p>The starter questions change with the page you&rsquo;re on:</p>
          <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
            <li><strong className="text-gray-200">Screener</strong> &mdash; narrow the list, find compounders, complement your portfolio</li>
            <li><strong className="text-gray-200">Deep Research</strong> &mdash; bull and bear case, valuation, key risks for the stock on screen</li>
            <li><strong className="text-gray-200">Portfolio</strong> &mdash; concentration, diversification, what to trim or add</li>
          </ul>
          <p>Mention a ticker by name and Ori pulls that stock&rsquo;s full detail into the conversation too.</p>
        </>
      ),
      target: '[data-tour="chat-panel"]',
      placement: "top",
      when: isPro,
      setup: onView("screener", async (a) => {
        a.setChatOpen?.(true);
        await wait(240);
      }),
    },
    {
      id: "live-data",
      title: "Ori can check live data",
      body: "When a question clearly needs current figures — a quote, a filing, an earnings line — Ori can pull it live from market data rather than answer from the cached row. It does this selectively, because those calls share the app's data budget.",
      when: isPro,
      setup: onView("screener"),
    },
    {
      id: "usage",
      title: "Usage and limits",
      body: "Ori runs on metered AI models, so Pro accounts have a usage allowance. \"Ori usage\" in your account menu shows where you stand. If you reach a limit Ori tells you plainly rather than quietly giving worse answers.",
      target: '[data-tour="profile-button"]',
      placement: "bottom",
      when: isPro,
      setup: onView("screener"),
    },
    {
      id: "upgrade",
      title: "Ori needs Pro",
      body: "Ori chat, the Deep Research Game Plan and Ori's Intangibles review are Pro features. The screener, every filter, the Conviction score and all of Deep Research's data panels work on a free account. Upgrade from your account menu.",
      target: '[data-tour="profile-button"]',
      placement: "bottom",
      when: (ctx) => !ctx.canUseOri,
      setup: onView("screener"),
    },
  ],
};

// ── Portfolio & goals ────────────────────────────────────────────────────────
const PORTFOLIO = {
  id: "portfolio",
  name: "Portfolio & Goals",
  blurb: "Tell Orizin what you own and what you're aiming for — it personalises everything.",
  minutes: 2,
  steps: [
    {
      id: "why",
      title: "Why bother filling this in",
      body: "Two things switch on once you do: the Portfolio Fit pillar starts contributing real signal to every Conviction score, and Ori stops giving generic answers because it can see your actual positions and objectives.",
      tip: "Everything on this page saves as you type and follows your account to other devices.",
      setup: onView("portfolio-goals"),
    },
    {
      id: "holdings",
      title: "Portfolios and holdings",
      body: "Create one portfolio per account you hold (a brokerage, a retirement account…). Give each its total invested, then list holdings as a % or a $ amount — whatever isn't allocated shows as MISC. Ballpark figures are fine; they drive sector concentration, not accounting.",
      tip: "This is your own record. Nothing here is connected to a broker or places orders.",
      target: '[data-tour="portfolio-holdings"]',
      placement: "right",
      setup: onView("portfolio-goals"),
    },
    {
      id: "goals",
      title: "Your profile, goals and theses",
      body: "The same persona and risk settings as the Lens live here, plus goals (\"retire in 2040\", \"income by 60\") and theses written in plain English (\"grid infrastructure is underbuilt\"). Orizin pulls keywords from your theses and rewards stocks that match them in the Fit pillar, and Ori reads all of it as standing context.",
      target: '[data-tour="portfolio-goals"]',
      placement: "left",
      setup: onView("portfolio-goals"),
    },
    {
      id: "overlap",
      title: "Concentration warnings",
      body: "When you open a stock that would deepen a sector you're already heavy in, Deep Research says so above the Game Plan. That warning only works once your holdings are entered.",
      setup: onView("portfolio-goals"),
    },
  ],
};

// ── Strategies ───────────────────────────────────────────────────────────────
const hasStrategies = (ctx) => (ctx.strategyCount || 0) > 0;
const STRATEGIES = {
  id: "strategies",
  name: "Strategies",
  blurb: "Turn an investing idea into rules, then watch it run as a simulated paper portfolio.",
  minutes: 3,
  steps: [
    {
      id: "what",
      title: "Strategies are simulated portfolios",
      body: "Describe how you'd like to invest — what to buy, what makes a good opportunity, what should make it cautious — and Orizin turns it into explicit rules that pick and weight a paper portfolio. You can see why every simulated trade happened.",
      tip: "Paper trading only. A strategy can never place a real order.",
      setup: onView("strategies"),
    },
    {
      id: "build",
      title: "Three ways to start",
      body: (
        <>
          <p>
            <strong className="text-gray-100">Describe it</strong> and Ori drafts the rules (Pro).{" "}
            <strong className="text-gray-100">Start with a simple plan</strong> to pick the investments, schedule
            and limits yourself. Or pick a <strong className="text-gray-100">ready-made approach</strong> further
            down the page.
          </p>
          <p>Whichever you choose, you review the plan before it can run.</p>
        </>
      ),
      target: '[data-tour="strategy-builder"]',
      placement: "bottom",
      when: (ctx) => !hasStrategies(ctx),
      setup: onView("strategies"),
    },
    {
      id: "list",
      title: "Your strategies",
      body: "Every strategy you've saved, with a green dot on the ones being monitored. \"New strategy\" takes you back to the builder and the ready-made approaches.",
      target: '[data-tour="strategy-list"]',
      placement: "right",
      when: (ctx) => hasStrategies(ctx) && isDesktop(ctx),
      setup: onView("strategies"),
    },
    {
      id: "actions",
      title: "Check, monitor, edit",
      body: "\"Check now\" runs the rules against today's data and rebalances the paper portfolio. \"Monitor\" repeats that on the strategy's schedule while the app is open. The pencil opens the plan — or its YAML — for editing.",
      target: '[data-tour="strategy-actions"]',
      placement: "bottom",
      when: hasStrategies,
      setup: onView("strategies"),
    },
    {
      id: "tabs",
      title: "Now, Plan, Test history, Why log",
      body: (
        <>
          <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
            <li><strong className="text-gray-200">Now</strong> &mdash; the paper account, current allocation and what changed last</li>
            <li><strong className="text-gray-200">Plan</strong> &mdash; the rules as a plain-English decision tree</li>
            <li><strong className="text-gray-200">Test history</strong> &mdash; how today&rsquo;s basket would have done over past prices</li>
            <li><strong className="text-gray-200">Why log</strong> &mdash; every decision, labelled with whether a rule or Ori made it</li>
          </ul>
        </>
      ),
      tip: "Missing or stale data never passes a rule, and Ori can rank candidates but can't override your eligibility rules or safety limits.",
      target: '[data-tour="strategy-tabs"]',
      placement: "bottom",
      when: hasStrategies,
      setup: onView("strategies"),
    },
  ],
};

// ── Watchlist ────────────────────────────────────────────────────────────────
const WATCHLIST = {
  id: "watchlist",
  name: "Watchlist & alerts",
  blurb: "Tracked names, fresher prices, and what triggers an alert.",
  minutes: 2,
  steps: [
    {
      id: "open",
      title: "The watchlist",
      body: "Your tracked names. While Orizin is open their quotes are refreshed every few minutes — more often than the rest of the universe — and they're the only symbols that raise alerts.",
      target: '[data-tour="watchlist-button"]',
      placement: "bottom",
      setup: onView("screener"),
    },
    {
      id: "panel",
      title: "Inside the panel",
      body: "Current quotes for everything you're tracking, with the alerts each one has raised. Click a name to open it in Deep Research. The badge on the button counts unread alerts.",
      target: '[data-tour="watchlist-panel"]',
      placement: "left",
      setup: onView("screener", async (a) => {
        a.setWatchlistOpen?.(true);
        await wait(280);
      }),
    },
    {
      id: "vs-pins",
      title: "Watchlist vs ★ pins",
      body: "Easy to confuse, completely different: ★ pins only float a row to the top of one screener tab. The watchlist is account-wide, gets priority price refreshes, and is what alerts fire from. Add to it from the eye icon in Deep Research's toolbar.",
      target: '[data-tour="watchlist-button"]',
      placement: "bottom",
      setup: onView("screener"),
    },
  ],
};

export const TOURS = [WELCOME, SCREENER, DEEP_RESEARCH, ORI, PORTFOLIO, STRATEGIES, WATCHLIST];

export function tourById(id) {
  return TOURS.find((t) => t.id === id) || null;
}

// Steps whose `when` excludes this account are dropped entirely, so the numbering
// a user sees ("3/9") always matches the steps they will actually be shown.
export function visibleSteps(tour, ctx = {}) {
  if (!tour) return [];
  return tour.steps.filter((s) => !s.when || s.when(ctx));
}
