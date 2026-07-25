# Orizin

**Orizin** is an intelligent stock screening and analysis platform that combines fundamental financial metrics with AI-powered research assistance. Filter, analyze, and research stocks in your universe with **Ori** — an AI research analyst that provides contextual insights based on your filtered data.

## Features

- **Advanced Stock Filtering** - Screen by market cap, sector, valuation metrics, profitability, and more
- **Fundamental Analysis** - View key financial metrics including PE, PB, EV/EBITDA, ROIC, FCF yield, and custom scoring
- **Real-time Data** - Integrated with Financial Modeling Prep (FMP) API for accurate financial data
- **AI-Powered Research** - Chat with Ori to analyze your filtered stocks with specialized analysis modes:
  - Compounding Moat analysis
  - Emerging Disruptor identification
  - Moonshot / High-Risk High-Reward opportunities
  - Valuation analysis
  - Hold duration recommendations
- **Live FMP tools for Ori** - Ori can selectively verify quotes, filings, earnings, analyst data, statements, technicals, news, and other Starter-plan data through FMP's hosted MCP server
- **Multi-Tab Portfolio Organization** - Create and manage multiple stock lists/tabs
- **Favorite Pinning** - Pin your watchlist stocks for quick access
- **Local Database** - SQLite for fast, persistent data storage

## Tech Stack

**Frontend**

- React 19 with Vite for fast development and building
- Tailwind CSS 4 for modern styling
- Real-time component updates with React hooks

**Backend**

- Node.js/Express server
- better-sqlite3 for local database
- Integration with:
  - Financial Modeling Prep (FMP) API for stock fundamentals
  - Google Gemini API for AI analysis

## Getting Started

### Prerequisites

- Node.js 18+
- API keys:
  - **FMP_API_KEY** (required) - Get from [Financial Modeling Prep](https://financialmodelingprep.com)
  - **GEMINI_API_KEY** (optional, for Ori AI chat) - Get from [Google AI Studio](https://aistudio.google.com)

### Installation

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure environment variables**
   Create a `.env` file in the project root:

   ```
   FMP_API_KEY=your_fmp_api_key_here
   GEMINI_API_KEY=your_gemini_api_key_here
   FMP_MCP_ENABLED=true
   PORT=3001
   DB_PATH=./data/screener.db
   ```

3. **Start the development server**

   ```bash
   npm run server &    # Start API server (background)
   npm run dev         # Start React dev server
   ```

   The app will be available at `http://localhost:5173`

### Build for Production

```bash
npm run build
npm run server       # Serves the built app at http://localhost:3001
```

### Automated Verification

```bash
npm test             # API, security, billing, strategy, migration, and cost-control regressions
npm run test:e2e     # Build and run isolated Chromium flows against a temporary SQLite database
npm run test:ci      # The same lint, regression, build, and browser gate used by CI
npm run audit:prod   # Audit runtime dependencies only
```

The E2E harness disables FMP, Gemini, PayPal, background enrichment, and email delivery. It never reads or writes the configured application database.

To verify a deployed Railway service without credentials or data changes:

```bash
SMOKE_BASE_URL=https://orizin.io npm run test:smoke
```

The scheduled workflow checks `https://orizin.io` every six hours; set the GitHub repository variable `SMOKE_BASE_URL` only to override that target. Railway also checks `/api/health` before activating each deployment.

Railway QA can also run hands-off role-based Playwright journeys after every
successful deployment, using disposable accounts that are always removed. See
[Railway QA deployment and user-journey testing](docs/railway-qa-testing.md).

## Project Structure

```
orizin/
├── src/                           # React frontend
│   ├── components/                # UI components (Header, Sidebar, StockTable, etc.)
│   ├── hooks/                     # useScreener, useChat custom hooks
│   ├── lib/                       # Utilities (formatting, scoring, etc.)
│   └── App.jsx                    # Main app component
├── server/                        # Node.js backend
│   ├── routes/                    # API endpoints (stocks, chat)
│   ├── db.js                      # SQLite database layer
│   ├── fmp.js                     # Financial Modeling Prep API client
│   ├── index.js                   # Express server setup
│   └── symbols.js                 # Stock symbol utilities
├── data/                          # Local database storage (gitignored)
├── package.json                   # Dependencies
└── vite.config.js                 # Vite configuration
```

## Key Components

- **Header** - Status indicator, data refresh, and bulk enrichment buttons
- **Sidebar** - Filter panel for screening stocks by various metrics
- **StockTable** - Displays filtered stocks with sortable columns
- **ScorecardGrid** - Visual scorecard view of stock metrics
- **ChatPanel** - Chat interface with Ori for AI-powered analysis
- **TabsBar** - Organize and switch between multiple stock lists

## API Analysis Modes

Chat with Ori using different analysis modes:

- **Compounding Moat** - Find durable competitive advantages
- **Emerging Disruptor** - Identify high-growth disruptors
- **Moonshot** - Find asymmetric risk/reward opportunities
- **Valuation Check** - Rigorous valuation analysis
- **Hold Duration** - Analyze by investment time horizon
- **General** - Open discussion about your stocks

Ori automatically discovers FMP's hosted MCP tools when `FMP_API_KEY` is set.
Only a curated Starter-safe subset is offered to Gemini for each question, and
results are cached, row-limited, and counted against the same `FMP_MAX_RPM`
budget as the app's direct FMP requests. Set `FMP_MCP_ENABLED=false` to disable
live tool use without affecting the rest of FMP-backed stock data.

## License

MIT

## Disclaimer

Orizin is for informational and educational purposes only. It does not provide financial advice. Always conduct your own due diligence and consult with a financial advisor before making investment decisions.
