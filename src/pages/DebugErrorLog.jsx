import { useState, useEffect } from 'react';

// Small stat tile used across the dashboard panels.
function Tile({ label, value, sub, accent }) {
  return (
    <div className="bg-gray-950 border border-gray-800 rounded p-3">
      <div className="text-gray-400 text-xs">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums mt-1 ${accent || ''}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

const SESSION_BADGE = {
  open: { label: 'MARKET OPEN', cls: 'bg-emerald-900 text-emerald-300' },
  pre: { label: 'PRE-MARKET', cls: 'bg-amber-900 text-amber-300' },
  after: { label: 'AFTER-HOURS', cls: 'bg-amber-900 text-amber-300' },
  closed: { label: 'MARKET CLOSED', cls: 'bg-gray-700 text-gray-400' },
};

export default function DebugErrorLog() {
  const [errors, setErrors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  // 'checking' → calling /api/auth/me, 'allowed' → admin, 'denied' → not admin
  const [access, setAccess] = useState('checking');

  // Enrichment background job monitor
  const [enrichStatus, setEnrichStatus] = useState(null);
  const [enrichLoading, setEnrichLoading] = useState(false);
  const [rpmInput, setRpmInput] = useState('150');

  // FMP usage / cache / freshness dashboard
  const [stats, setStats] = useState(null);

  useEffect(() => {
    document.title = 'Debug • Orizen';
  }, []);

  // Gate the page on admin access — non-admins (and signed-out users) get nothing.
  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setAccess(data?.isAdmin ? 'allowed' : 'denied'))
      .catch(() => setAccess('denied'));
  }, []);

  const fetchErrors = async () => {
    try {
      setFetchError(null);
      const res = await fetch('/api/debug/errors?limit=200');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setErrors(data.errors || []);
      setLastUpdated(new Date());
    } catch (e) {
      setFetchError(e.message || 'Failed to connect to backend');
      console.error('Failed to fetch error logs', e);
    } finally {
      setLoading(false);
    }
  };

  const fetchEnrichment = async () => {
    try {
      const res = await fetch('/api/debug/enrichment');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('text/html')) {
        throw new Error('received HTML (dev proxy or stale server issue?)');
      }
      const data = await res.json();
      setEnrichStatus(data);
      if (data && typeof data.targetRpm === 'number') {
        setRpmInput(String(data.targetRpm));
      }
    } catch (e) {
      console.error('Failed to fetch enrichment status', e);
    }
  };

  const controlEnrichment = async (action, rpm = null) => {
    setEnrichLoading(true);
    try {
      const body = { action };
      if (rpm != null) body.rpm = rpm;
      const res = await fetch('/api/debug/enrichment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('text/html') || ct.includes('text/plain')) {
          throw new Error(`HTTP ${res.status} (got HTML; in dev: restart "npm run dev-server" + ensure vite proxies /api to :3001)`);
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setEnrichStatus(data.status || data);
    } catch (e) {
      console.error('Enrichment control failed', e);
      alert('Control failed: ' + (e.message || e));
    } finally {
      setEnrichLoading(false);
      // refresh immediately
      fetchEnrichment();
    }
  };

  const applyRpm = () => {
    const rpm = parseInt(rpmInput, 10);
    if (isNaN(rpm) || rpm < 20 || rpm > 250) {
      alert('RPM must be between 20 and 250');
      return;
    }
    controlEnrichment(null, rpm);
  };

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/debug/fmp-stats');
      if (!res.ok) return;
      const data = await res.json();
      setStats(data);
    } catch {
      // transient — next poll retries
    }
  };

  const clearErrors = async () => {
    try {
      await fetch('/api/debug/errors/clear', { method: 'POST' });
    } catch {
      // even if the server call fails, clear the view
    }
    setErrors([]);
  };

  useEffect(() => {
    if (access !== 'allowed') return;
    fetchErrors();
    fetchEnrichment();
    fetchStats();
    const interval = setInterval(() => {
      fetchErrors();
      fetchEnrichment();
      fetchStats();
    }, 4000); // poll all three
    return () => clearInterval(interval);
  }, [access]);

  if (access === 'checking') {
    return <div className="min-h-screen bg-gray-950" />;
  }

  if (access === 'denied') {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col items-center justify-center gap-3 p-6">
        <span className="text-3xl">🔒</span>
        <h1 className="text-xl font-semibold">Access denied</h1>
        <p className="text-sm text-gray-400">
          This page is restricted to administrators.
        </p>
        <a
          href="/"
          className="mt-2 px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 transition-colors"
        >
          Back to Orizen
        </a>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold">Error Log</h1>
            <p className="text-gray-400 text-sm mt-1">
              Real-time errors from the application (auto-refreshes every 3s)
            </p>
          </div>
          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="text-xs text-gray-500">
                Last updated: {lastUpdated.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={clearErrors}
              className="px-4 py-2 text-sm rounded bg-gray-800 hover:bg-gray-700 border border-gray-700"
            >
              Clear Log
            </button>
            <button
              onClick={fetchErrors}
              className="px-4 py-2 text-sm rounded bg-blue-600 hover:bg-blue-500"
            >
              Refresh Now
            </button>
          </div>
        </div>

        {/* Enrichment Background Job Dashboard */}
        <div className="mb-8 bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold flex items-center gap-2">
                🔄 Background Enrichment
                <span className={`text-xs px-2 py-0.5 rounded ${enrichStatus?.running ? 'bg-emerald-900 text-emerald-300' : 'bg-gray-700 text-gray-400'}`}>
                  {enrichStatus?.running ? 'RUNNING' : 'STOPPED'}
                </span>
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Continuous low-rate updater for the ~38k universe. Keeps metrics fresh without long user-triggered jobs.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => controlEnrichment(enrichStatus?.running ? 'stop' : 'start')}
                disabled={enrichLoading}
                className={`px-3 py-1.5 text-sm rounded border ${enrichStatus?.running ? 'border-red-700 hover:bg-red-900/30' : 'border-emerald-700 hover:bg-emerald-900/30'} disabled:opacity-50`}
              >
                {enrichLoading ? '...' : enrichStatus?.running ? 'Stop Job' : 'Start Job'}
              </button>
              <div className="flex items-center gap-1 text-sm">
                <input
                  type="number"
                  value={rpmInput}
                  onChange={(e) => setRpmInput(e.target.value)}
                  className="w-16 bg-gray-950 border border-gray-700 rounded px-2 py-1 text-xs"
                  min={20}
                  max={250}
                />
                <button
                  onClick={applyRpm}
                  disabled={enrichLoading}
                  className="px-2 py-1 text-xs rounded bg-gray-800 hover:bg-gray-700 border border-gray-700"
                >
                  Set RPM
                </button>
              </div>
              <button
                onClick={() => {
                  if (window.confirm('Kill ALL ongoing FMP fetches (universe refresh, gathers, background, AI etc) and stop the background job?')) {
                    controlEnrichment('kill');
                  }
                }}
                disabled={enrichLoading}
                className="px-3 py-1.5 text-sm rounded border border-red-800 hover:bg-red-900/40 text-red-300 disabled:opacity-50"
                title="Emergency stop: aborts in-flight FMP calls + stops background enrichment. Normal users cannot trigger refreshes."
              >
                🛑 Kill All &amp; Stop Fetches
              </button>
            </div>
          </div>

          {enrichStatus ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div className="bg-gray-950 border border-gray-800 rounded p-3">
                <div className="text-gray-400 text-xs">Target / Actual Pace</div>
                <div className="text-2xl font-semibold tabular-nums mt-1">
                  {enrichStatus.targetRpm} rpm
                </div>
                <div className="text-xs text-gray-500 mt-1">~{Math.round(enrichStatus.targetRpm / 2)} symbols/min (km+rat)</div>
              </div>

              <div className="bg-gray-950 border border-gray-800 rounded p-3">
                <div className="text-gray-400 text-xs">Session Stats</div>
                <div className="flex gap-6 mt-1">
                  <div>
                    <span className="text-emerald-400 text-2xl font-semibold tabular-nums">{enrichStatus.processed}</span>
                    <div className="text-xs text-gray-500">enriched</div>
                  </div>
                  <div>
                    <span className="text-sky-400 text-2xl font-semibold tabular-nums">{enrichStatus.quotesRefreshed ?? 0}</span>
                    <div className="text-xs text-gray-500">quotes</div>
                  </div>
                  <div>
                    <span className="text-red-400 text-2xl font-semibold tabular-nums">{enrichStatus.errors}</span>
                    <div className="text-xs text-gray-500">errors</div>
                  </div>
                </div>
                <div className="text-xs mt-2 text-gray-500">
                  Missing in DB: <span className="font-mono text-gray-300">{enrichStatus.missingCount}</span>
                </div>
              </div>

              <div className="bg-gray-950 border border-gray-800 rounded p-3">
                <div className="text-gray-400 text-xs">Last Activity</div>
                <div className="mt-1 font-mono text-sm truncate">
                  {enrichStatus.lastSymbol ? enrichStatus.lastSymbol : '—'}
                </div>
                <div className="text-xs text-gray-500">
                  {enrichStatus.lastUpdate ? new Date(enrichStatus.lastUpdate).toLocaleTimeString() : 'never'}
                </div>
                <div className="mt-2 text-[10px] text-gray-500">
                  Concurrency: {enrichStatus.concurrency} workers
                </div>
              </div>

              {/* Simple activity + error graph */}
              <div className="md:col-span-3 bg-gray-950 border border-gray-800 rounded p-3">
                <div className="text-xs text-gray-400 mb-2">Recent Activity (last {Math.min(15, enrichStatus.recent?.length || 0)})</div>
                {enrichStatus.recent && enrichStatus.recent.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {enrichStatus.recent.slice(0, 15).map((a, i) => (
                      <div
                        key={i}
                        title={`${new Date(a.ts).toLocaleTimeString()} • ${a.symbol} • ${a.status}${a.message ? ': ' + a.message : ''}`}
                        className={`px-2 py-0.5 rounded text-[10px] font-mono border ${a.status === 'ok' ? 'border-emerald-800 bg-emerald-900/20 text-emerald-300' : 'border-red-800 bg-red-900/20 text-red-300'}`}
                      >
                        {a.symbol}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-gray-500">No recent activity yet.</div>
                )}

                {/* Tiny bar "graph" for error rate in recent window */}
                <div className="mt-3">
                  <div className="text-[10px] text-gray-500 mb-1">Error vs OK in recent window</div>
                  <div className="h-2 bg-gray-800 rounded overflow-hidden flex">
                    {(() => {
                      const rec = enrichStatus.recent || [];
                      const errs = rec.filter(r => r.status === 'err').length;
                      const oks = rec.length - errs;
                      const total = Math.max(rec.length, 1);
                      const errPct = Math.round((errs / total) * 100);
                      const okPct = 100 - errPct;
                      return (
                        <>
                          <div className="bg-emerald-600 h-2" style={{ width: `${okPct}%` }} title={`${oks} ok`} />
                          <div className="bg-red-600 h-2" style={{ width: `${errPct}%` }} title={`${errs} errors`} />
                        </>
                      );
                    })()}
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5 flex justify-between">
                    <span>OKs dominate = healthy</span>
                    <span>High red = investigate rate limits / keys</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-gray-500 text-sm">Loading enrichment status...</div>
          )}
        </div>

        {/* FMP API usage + caches + data freshness */}
        {stats && (
          <div className="mb-8 grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* FMP usage */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  📡 FMP API Usage
                  {stats.market && (
                    <span className={`text-xs px-2 py-0.5 rounded ${(SESSION_BADGE[stats.market.session] || SESSION_BADGE.closed).cls}`}>
                      {(SESSION_BADGE[stats.market.session] || SESSION_BADGE.closed).label}
                    </span>
                  )}
                </h2>
                <span className="text-[10px] text-gray-500">{stats.market?.statusLine}</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <Tile
                  label="Pace (now)"
                  value={`${stats.fmp.rpmNow} rpm`}
                  sub="plan limit 300 rpm"
                  accent={stats.fmp.rpmNow > 280 ? 'text-red-400' : stats.fmp.rpmNow > 220 ? 'text-amber-300' : 'text-emerald-400'}
                />
                <Tile
                  label="Last 15 min"
                  value={stats.fmp.last15min.calls}
                  sub={`${stats.fmp.last15min.http429} × 429`}
                  accent={stats.fmp.last15min.http429 > 0 ? 'text-amber-300' : ''}
                />
                <Tile
                  label="Last hour"
                  value={stats.fmp.last60min.calls}
                  sub={`${stats.fmp.last60min.errors} errors`}
                />
                <Tile
                  label="Since boot"
                  value={stats.fmp.total.calls.toLocaleString()}
                  sub={`avg ${stats.fmp.avgMs}ms · ${stats.fmp.total.http429} × 429`}
                />
              </div>
              {stats.fmp.byEndpoint?.length > 0 && (
                <div className="mt-4">
                  <div className="text-xs text-gray-400 mb-1.5">By endpoint (since boot)</div>
                  <div className="max-h-44 overflow-y-auto border border-gray-800 rounded">
                    <table className="w-full text-[11px]">
                      <thead className="bg-gray-950 text-gray-500 sticky top-0">
                        <tr>
                          <th className="text-left px-2 py-1 font-medium">endpoint</th>
                          <th className="text-right px-2 py-1 font-medium">calls</th>
                          <th className="text-right px-2 py-1 font-medium">ok</th>
                          <th className="text-right px-2 py-1 font-medium">429</th>
                          <th className="text-right px-2 py-1 font-medium">err</th>
                          <th className="text-right px-2 py-1 font-medium">avg ms</th>
                        </tr>
                      </thead>
                      <tbody className="font-mono divide-y divide-gray-800/60">
                        {stats.fmp.byEndpoint.map((e) => (
                          <tr key={e.endpoint}>
                            <td className="px-2 py-1 text-gray-300">{e.endpoint}</td>
                            <td className="px-2 py-1 text-right text-gray-300">{e.calls}</td>
                            <td className="px-2 py-1 text-right text-emerald-400/80">{e.ok}</td>
                            <td className={`px-2 py-1 text-right ${e.http429 ? 'text-amber-300' : 'text-gray-600'}`}>{e.http429}</td>
                            <td className={`px-2 py-1 text-right ${e.errors ? 'text-red-400' : 'text-gray-600'}`}>{e.errors}</td>
                            <td className="px-2 py-1 text-right text-gray-400">{e.avgMs}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Caches + freshness */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h2 className="text-xl font-semibold mb-1">🗄 Caches &amp; Data Freshness</h2>
              <p className="text-xs text-gray-500 mb-4">
                Cache hits are FMP calls we didn't make. Detail lookups persist in SQLite, so restarts no longer re-bill the quota.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <Tile
                  label="Detail cache hit rate"
                  value={(() => {
                    const c = stats.detailCache;
                    const total = c.hits + c.dbHits + c.misses;
                    return total ? `${Math.round(((c.hits + c.dbHits) / total) * 100)}%` : '—';
                  })()}
                  sub={`${stats.detailCache.hits} mem · ${stats.detailCache.dbHits} db · ${stats.detailCache.misses} miss`}
                />
                <Tile
                  label="Persisted entries"
                  value={stats.freshness.kvCache.toLocaleString()}
                  sub={`+ ${stats.freshness.sparklines.toLocaleString()} sparklines`}
                />
                <Tile
                  label="Universe"
                  value={stats.freshness.stocks.toLocaleString()}
                  sub={`${stats.freshness.etfs.toLocaleString()} ETFs · ${stats.freshness.enriched.toLocaleString()} enriched`}
                />
                <Tile
                  label="Missing core data"
                  value={stats.freshness.missingEnrich.toLocaleString()}
                  sub="backlog (non-ETF)"
                  accent={stats.freshness.missingEnrich > 0 ? 'text-amber-300' : 'text-emerald-400'}
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 text-sm">
                <div className="bg-gray-950 border border-gray-800 rounded p-3">
                  <div className="text-gray-400 text-xs mb-2">Price freshness (quotes)</div>
                  <div className="space-y-1 text-[11px] font-mono">
                    <div className="flex justify-between"><span className="text-gray-500">≤ 30 min</span><span className="text-emerald-400">{stats.freshness.price.fresh30m.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">≤ 6 h</span><span className="text-emerald-300/80">{stats.freshness.price.fresh6h.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">≤ 24 h</span><span className="text-gray-300">{stats.freshness.price.fresh24h.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">older / never</span><span className="text-amber-300">{stats.freshness.price.older.toLocaleString()}</span></div>
                  </div>
                  <div className="text-[10px] text-gray-600 mt-2">
                    Top names refresh ~30 min while the market is open; the rest rotate through the session. Quote churn pauses overnight &amp; weekends.
                  </div>
                </div>
                <div className="bg-gray-950 border border-gray-800 rounded p-3">
                  <div className="text-gray-400 text-xs mb-2">Fundamentals freshness (km + ratios)</div>
                  <div className="space-y-1 text-[11px] font-mono">
                    <div className="flex justify-between"><span className="text-gray-500">≤ 24 h</span><span className="text-emerald-400">{stats.freshness.fundamentals.fresh24h.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">≤ 7 d</span><span className="text-gray-300">{stats.freshness.fundamentals.fresh7d.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">older</span><span className="text-amber-300">{stats.freshness.fundamentals.stale7d.toLocaleString()}</span></div>
                  </div>
                  <div className="text-[10px] text-gray-600 mt-2">
                    Stalest enriched rows are re-fetched continuously with spare budget (24 h cycle).
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {fetchError ? (
          <div className="bg-red-950 border border-red-800 rounded-lg p-6">
            <p className="text-red-400 font-medium">Could not load error logs</p>
            <p className="text-red-300 mt-1 text-sm">{fetchError}</p>
          </div>
        ) : loading && errors.length === 0 ? (
          <div className="text-gray-400">Loading errors...</div>
        ) : errors.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-8 text-center">
            <p className="text-gray-400">No errors logged yet.</p>
            <p className="text-sm text-gray-500 mt-2">
              Errors from enrichment, FMP calls, and frontend will appear here.
            </p>
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-800 text-gray-400">
                <tr>
                  <th className="text-left px-4 py-3 font-medium w-48">Timestamp</th>
                  <th className="text-left px-4 py-3 font-medium">Error Message</th>
                  <th className="text-left px-4 py-3 font-medium w-64">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800 font-mono text-xs">
                {errors.map((err, index) => (
                  <tr key={index} className="hover:bg-gray-800/50">
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                      {new Date(err.timestamp).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-red-400 break-words">
                      {err.message}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {err.symbol && <div>Symbol: {err.symbol}</div>}
                      {Object.keys(err).length > 2 && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-gray-600 hover:text-gray-400">More details</summary>
                          <pre className="mt-1 text-[10px] bg-gray-950 p-2 rounded overflow-auto max-h-32">
                            {JSON.stringify(err, null, 2)}
                          </pre>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-6 text-xs text-gray-500">
          This page is only for debugging. Errors in memory (last 200). Background enrichment runs continuously at low RPM to keep the large universe fresh.
        </div>
      </div>
    </div>
  );
}
