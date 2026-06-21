import { useState, useEffect, useCallback } from "react";
import { IconSignal, IconUsersGroup } from "../components/icons.jsx";
import RankBadge from "../components/RankBadge.jsx";

function Tile({ label, value, sub, accent = "" }) {
  return (
    <div className="bg-gray-950 border border-gray-800 rounded-lg p-3 min-w-0">
      <div className="text-gray-400 text-xs">{label}</div>
      <div className={`text-2xl font-semibold tabular-nums mt-1 ${accent}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1 leading-relaxed">{sub}</div>}
    </div>
  );
}

function fmtWhen(ms) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtCost(usd) {
  const n = Number(usd);
  if (!Number.isFinite(n) || n <= 0) return "$0.00";
  if (n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}

function fmtTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(v);
}

function StatusDot({ online }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${online ? "bg-emerald-400" : "bg-gray-600"}`}
      title={online ? "Online" : "Offline"}
    />
  );
}

export default function AdminObservability() {
  const [access, setAccess] = useState("checking");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    document.title = "Observability • Orizin";
  }, []);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => setAccess(me?.isAdmin ? "allowed" : "denied"))
      .catch(() => setAccess("denied"));
  }, []);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/admin/observability");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError(e.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (access !== "allowed") return undefined;
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [access, load]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return undefined;
    }
    let cancelled = false;
    setDetailLoading(true);
    fetch(`/api/admin/users/${encodeURIComponent(selected)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch(() => { if (!cancelled) setDetail(null); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selected]);

  if (access === "checking") {
    return <div className="min-h-screen bg-gray-950" />;
  }

  if (access === "denied") {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-300 flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <h1 className="text-xl font-semibold text-white mb-2">Admin access required</h1>
          <p className="text-sm text-gray-500 leading-relaxed">Sign in as an admin to view user observability.</p>
          <a href="/" className="inline-block mt-4 text-sm text-violet-400 hover:text-violet-300">← Back to app</a>
        </div>
      </div>
    );
  }

  const summary = data?.summary;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-200">
      <header className="border-b border-gray-800 bg-gray-900/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-white flex items-center gap-2">
              <IconSignal className="w-5 h-5 text-violet-400 shrink-0" />
              User observability
            </h1>
            <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
              Logins, sessions, Ori usage & Gemini cost · auto-logout after {data?.inactivityMinutes ?? 60}m idle
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={load}
              className="text-xs px-3 py-1.5 rounded-md border border-gray-700 text-gray-300 hover:bg-gray-800"
            >
              Refresh
            </button>
            <a href="/" className="text-xs px-3 py-1.5 rounded-md text-violet-300 hover:bg-gray-800">← App</a>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {error && (
          <div className="text-sm text-red-400 bg-red-950/40 border border-red-900/50 rounded-lg p-3">{error}</div>
        )}

        {loading && !data ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            <Tile label="Total users" value={summary.totalUsers} />
            <Tile label="Online now" value={summary.onlineNow} accent="text-emerald-300" sub={`within ${data.onlineWindowMinutes}m`} />
            <Tile label="Active today" value={summary.activeToday} />
            <Tile label="Logins today" value={summary.loginsToday} />
            <Tile label="Voyagers (Pro)" value={summary.proUsers} accent="text-violet-300" />
            <Tile label="Admins" value={summary.adminUsers} />
            <Tile
              label="Gemini today"
              value={fmtCost(summary.geminiCostTodayUsd)}
              accent="text-amber-300"
              sub="All users · ET day"
            />
            <Tile
              label="Gemini month"
              value={fmtCost(summary.geminiCostMonthUsd)}
              accent="text-amber-300"
              sub="Paid API estimate"
            />
          </div>
        )}

        <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6 items-start">
          <section className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden min-w-0">
            <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
              <IconUsersGroup className="w-4 h-4 text-gray-500" />
              <h2 className="text-sm font-semibold text-gray-200">Users</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="text-left px-3 py-2 font-medium">User</th>
                    <th className="text-left px-3 py-2 font-medium">Status</th>
                    <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">Last login</th>
                    <th className="text-left px-3 py-2 font-medium hidden md:table-cell">Last active</th>
                    <th className="text-right px-3 py-2 font-medium">Ori</th>
                    <th className="text-right px-3 py-2 font-medium hidden lg:table-cell">Gemini</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.users || []).map((u) => (
                    <tr
                      key={u.username}
                      onClick={() => setSelected(u.username)}
                      className={`border-b border-gray-800/80 cursor-pointer hover:bg-gray-800/40 ${selected === u.username ? "bg-violet-950/30" : ""}`}
                    >
                      <td className="px-3 py-2.5 min-w-0">
                        <div className="font-medium text-gray-100 truncate">{u.nickname || u.email || u.username}</div>
                        <div className="text-[10px] text-gray-500 truncate">{u.username}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <StatusDot online={u.online} />
                          <span className={u.online ? "text-emerald-300" : "text-gray-500"}>
                            {u.online ? "Online" : "Away"}
                          </span>
                        </div>
                        <div className="mt-1">
                          <RankBadge plan={u.plan} isAdmin={u.is_admin} size="sm" />
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-gray-400 hidden sm:table-cell whitespace-nowrap">
                        {u.lastLoginAgo || "—"}
                        {u.login_count > 0 && <div className="text-[10px] text-gray-600">{u.login_count} logins</div>}
                      </td>
                      <td className="px-3 py-2.5 text-gray-400 hidden md:table-cell whitespace-nowrap">
                        {u.lastActiveAgo || "—"}
                        {u.sessionMinutes && u.online && (
                          <div className="text-[10px] text-gray-600">~{u.sessionMinutes}m this session</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-gray-300">
                        {u.oriUnlimited ? (
                          <span className="text-emerald-400">∞</span>
                        ) : (
                          <>
                            <div>{u.oriToday?.requests ?? 0} today</div>
                            <div className="text-[10px] text-gray-600">{u.oriMonth?.requests ?? 0} month</div>
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums hidden lg:table-cell">
                        <div className="text-amber-200/90">{fmtCost(u.oriCostMonth?.totalUsd)}</div>
                        <div className="text-[10px] text-gray-600">month</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="bg-gray-900 border border-gray-800 rounded-xl p-4 min-w-0 lg:sticky lg:top-20">
            <h2 className="text-sm font-semibold text-gray-200 mb-3">User detail</h2>
            {!selected ? (
              <p className="text-xs text-gray-500 leading-relaxed">Select a user to see login history, Ori usage, and chat activity.</p>
            ) : detailLoading ? (
              <p className="text-xs text-gray-500">Loading…</p>
            ) : detail ? (
              <div className="space-y-4 text-xs">
                <div>
                  <div className="font-semibold text-gray-100 break-words">{detail.nickname || detail.email || detail.username}</div>
                  <div className="text-gray-500 break-all mt-0.5">{detail.username}</div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <RankBadge plan={detail.plan} isAdmin={detail.is_admin} size="sm" />
                    {detail.is_admin && <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-900 text-emerald-300">admin</span>}
                    {detail.online && <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-950 text-emerald-400">online</span>}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-gray-950 border border-gray-800 rounded-lg p-2">
                    <div className="text-gray-500 text-[10px]">Last login</div>
                    <div className="text-gray-200 mt-0.5">{fmtWhen(detail.last_login_at)}</div>
                    {detail.last_login_ip && <div className="text-[10px] text-gray-600 mt-0.5">{detail.last_login_ip}</div>}
                  </div>
                  <div className="bg-gray-950 border border-gray-800 rounded-lg p-2">
                    <div className="text-gray-500 text-[10px]">Last active</div>
                    <div className="text-gray-200 mt-0.5">{fmtWhen(detail.last_active_at)}</div>
                  </div>
                  <div className="bg-gray-950 border border-gray-800 rounded-lg p-2">
                    <div className="text-gray-500 text-[10px]">Chat sessions</div>
                    <div className="text-gray-200 mt-0.5 tabular-nums">{detail.chatSessions}</div>
                  </div>
                  <div className="bg-gray-950 border border-gray-800 rounded-lg p-2">
                    <div className="text-gray-500 text-[10px]">Ori this month</div>
                    <div className="text-gray-200 mt-0.5 tabular-nums">
                      {detail.oriUnlimited ? "Unlimited" : `${detail.oriMonth?.requests ?? 0} req`}
                    </div>
                  </div>
                </div>

                {!detail.oriUnlimited && detail.oriLimits && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">Ori limits</div>
                    <div className="text-gray-400 leading-relaxed">
                      Session {detail.oriSession?.used ?? 0}/{detail.oriLimits.session} ·
                      Today {detail.oriToday?.requests ?? 0}/{detail.oriLimits.daily} ·
                      Week {detail.oriWeek?.requests ?? 0}/{detail.oriLimits.weekly}
                    </div>
                  </div>
                )}

                {detail.oriCostMonth && (
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">Gemini cost (this month)</div>
                    <div className="bg-gray-950 border border-gray-800 rounded-lg p-3 space-y-2">
                      <div className="flex justify-between gap-2">
                        <span className="text-gray-400">Total API estimate</span>
                        <span className="text-amber-200 font-semibold tabular-nums">{fmtCost(detail.oriCostMonth.totalUsd)}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[10px] text-gray-500">
                        <div>Chat {fmtCost(detail.oriCostMonth.chatUsd)}</div>
                        <div>Game plans {fmtCost(detail.oriCostMonth.planUsd)}</div>
                        <div>Input {fmtCost(detail.oriCostMonth.inputUsd)}</div>
                        <div>Output {fmtCost(detail.oriCostMonth.outputUsd)}</div>
                      </div>
                      <div className="text-[10px] text-gray-600 leading-relaxed pt-1 border-t border-gray-800">
                        {fmtTokens(detail.oriCostMonth.promptTokens)} in ·{" "}
                        {fmtTokens(detail.oriCostMonth.cachedTokens)} cached ·{" "}
                        {fmtTokens(detail.oriCostMonth.outputTokens)} out
                      </div>
                      {detail.estMarginMonthUsd != null && (
                        <div className="flex justify-between gap-2 text-[10px] pt-1 border-t border-gray-800">
                          <span className="text-gray-500">Est. Pro margin (after ~${summary?.proNetRevenueUsd ?? 9.2} net sub)</span>
                          <span className={`font-semibold tabular-nums ${detail.estMarginMonthUsd >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                            {fmtCost(detail.estMarginMonthUsd)}
                          </span>
                        </div>
                      )}
                      <p className="text-[9px] text-gray-600 leading-relaxed">
                        Uses inference usageMetadata when available; otherwise free countTokens (GetTokens — not billed).
                      </p>
                    </div>
                  </div>
                )}

                <div>
                  <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1.5">Recent logins</div>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {(detail.loginHistory || []).length === 0 ? (
                      <p className="text-gray-600">No login events recorded yet.</p>
                    ) : (
                      detail.loginHistory.map((e, i) => (
                        <div key={i} className="bg-gray-950 border border-gray-800 rounded px-2 py-1.5">
                          <div className="flex justify-between gap-2">
                            <span className="text-gray-300">{e.kind}</span>
                            <span className="text-gray-500 shrink-0">{e.ago}</span>
                          </div>
                          {e.ip && <div className="text-[10px] text-gray-600 mt-0.5">{e.ip}</div>}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-500">Could not load user details.</p>
            )}
          </section>
        </div>

        {data?.recentLogins?.length > 0 && (
          <section className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-gray-200 mb-3">Recent sign-ins (all users)</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {data.recentLogins.slice(0, 12).map((e, i) => (
                <div key={i} className="bg-gray-950 border border-gray-800 rounded-lg px-3 py-2 text-xs min-w-0">
                  <div className="flex justify-between gap-2">
                    <span className="text-gray-200 truncate">{e.user_id}</span>
                    <span className="text-gray-500 shrink-0">{e.ago}</span>
                  </div>
                  <div className="text-[10px] text-gray-600 mt-0.5">{e.kind}{e.ip ? ` · ${e.ip}` : ""}</div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}