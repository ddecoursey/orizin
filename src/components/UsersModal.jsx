import { useState, useEffect } from "react";
import { PRO_PRICE_LABEL } from "../lib/billing.js";
import { DEFAULT_WATCHLIST_ALERTS } from "../lib/watchlistAlertsConfig.js";
import { fetchUserSettings, patchUserSettings } from "../lib/userStore.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function userListLabel(u) {
  const email = u.email || (EMAIL_RE.test(u.username) ? u.username : u.username);
  if (u.nickname) return { primary: u.nickname, secondary: email };
  return { primary: email, secondary: null };
}

function usagePct(used, limit) {
  if (!limit || limit <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((used / limit) * 100)));
}
// Calm under ~70%, amber as it fills, red near the cap.
function usageBarColor(p) {
  if (p >= 90) return "bg-red-500";
  if (p >= 70) return "bg-amber-500";
  return "bg-violet-500";
}

// Compact token count: 940, 12.4k, 3.1M.
function fmtTokens(n) {
  const v = Number(n) || 0;
  if (v < 1000) return String(v);
  if (v < 1_000_000) return `${(v / 1000).toFixed(v < 10_000 ? 1 : 0)}k`;
  return `${(v / 1_000_000).toFixed(1)}M`;
}

// A small labelled stat tile for the usage breakdown grid.
function StatTile({ label, value }) {
  return (
    <div className="bg-gray-950 border border-gray-800 rounded-lg px-3 py-2.5 min-w-0">
      <div className="text-sm font-semibold text-gray-100 tabular-nums">{value}</div>
      <div className="text-[10px] text-gray-500 mt-1 leading-snug break-words">{label}</div>
    </div>
  );
}

function HelperText({ children, className = "" }) {
  return (
    <p className={`text-[11px] text-gray-500 leading-relaxed break-words ${className}`}>
      {children}
    </p>
  );
}

function Section({ title, titleClass = "text-gray-500", children, className = "" }) {
  return (
    <section className={className}>
      <div className={`text-xs uppercase tracking-wider ${titleClass} mb-2`}>{title}</div>
      {children}
    </section>
  );
}

function formatResetTime(ms) {
  if (!ms) return null;
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

function relTime(ms) {
  if (!ms) return null;
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
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

// One labelled progress bar (e.g. "Today  12 / 25").
function UsageMeter({ label, used, limit, sub }) {
  const p = usagePct(used, limit);
  return (
    <div className="min-w-0">
      <div className="flex items-start justify-between gap-3 text-xs mb-1.5">
        <span className="text-gray-300 shrink-0">{label}</span>
        <span className="text-gray-400 tabular-nums text-right">{used} / {limit}</span>
      </div>
      <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
        <div className={`h-full ${usageBarColor(p)} transition-all duration-300`} style={{ width: `${p}%` }} />
      </div>
      {sub && <div className="text-[10px] text-gray-600 mt-1.5 leading-relaxed break-words">{sub}</div>}
    </div>
  );
}

// `mode` controls which surface this modal shows:
//   'account' → personal Account Settings (plan + change your password)
//   'users'   → admin User Management (add/remove users, grant admin, set plan)
export default function UsersModal({
  onClose,
  currentUser,
  isAdmin = false,
  plan = 'free',
  mode = 'account',
  onAuthRefresh,
  onUpgradeToPro,
  appEnv = 'production',
  onTestWatchlistAlert,
  testWatchlistAlertBusy = false,
  testWatchlistAlertMsg = '',
  testWatchlistAlertOk = null,
}) {
  const showUsers = mode === 'users' && isAdmin;
  const showAccount = mode === 'account';
  const showUsage = mode === 'usage';
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [adding, setAdding] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [subStatus, setSubStatus] = useState(null); // { plan, status, subscriptionId }
  const [canceling, setCanceling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [wlAlerts, setWlAlerts] = useState({ ...DEFAULT_WATCHLIST_ALERTS });
  const [wlAlertsSaving, setWlAlertsSaving] = useState(false);
  const [nickname, setNickname] = useState("");
  const [nicknameSaving, setNicknameSaving] = useState(false);
  const [notificationEmail, setNotificationEmail] = useState("");
  const [notificationEmailSaving, setNotificationEmailSaving] = useState(false);
  const [loginEmail, setLoginEmail] = useState(null);
  const [oriUsage, setOriUsage] = useState(null);
  const [expandedUser, setExpandedUser] = useState(null);
  const [userDetail, setUserDetail] = useState(null);
  const [userDetailLoading, setUserDetailLoading] = useState(false);

  async function loadUsers() {
    setLoading(true);
    try {
      const res = await fetch("/api/users");
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${text.substring(0, 200)}`);
      }
      const data = JSON.parse(text);
      if (data.users) setUsers(data.users);
    } catch (e) {
      console.error("Failed to load users:", e);
      setError("Failed to load users — check backend console");
    }
    setLoading(false);
  }

  useEffect(() => {
    if (showUsers) loadUsers();
    else setLoading(false);
  }, [showUsers]);

  useEffect(() => {
    if (!showUsers || !expandedUser) {
      setUserDetail(null);
      return undefined;
    }
    let cancelled = false;
    setUserDetailLoading(true);
    fetch(`/api/admin/users/${encodeURIComponent(expandedUser)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setUserDetail(d); })
      .catch(() => { if (!cancelled) setUserDetail(null); })
      .finally(() => { if (!cancelled) setUserDetailLoading(false); });
    return () => { cancelled = true; };
  }, [showUsers, expandedUser]);

  useEffect(() => {
    if (!showAccount) return;
    (async () => {
      const [s, me] = await Promise.all([
        fetchUserSettings().catch(() => ({})),
        fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      if (s?.watchlistAlerts) setWlAlerts({ ...DEFAULT_WATCHLIST_ALERTS, ...s.watchlistAlerts });
      if (typeof s?.nickname === "string") setNickname(s.nickname);
      else if (me?.nickname) setNickname(me.nickname);
      if (me) {
        setLoginEmail(me.email || null);
        setNotificationEmail(me.notificationEmail || "");
      }
    })();
  }, [showAccount]);

  // Ori usage has its own dropdown surface now (mode='usage'); fetch it there.
  useEffect(() => {
    if (!showUsage) return;
    let cancelled = false;
    (async () => {
      const usage = await fetch("/api/ori/usage").then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (!cancelled && usage) setOriUsage(usage);
    })();
    return () => { cancelled = true; };
  }, [showUsage]);

  async function saveNickname(value) {
    const next = value.trim().slice(0, 64);
    setNickname(next);
    setNicknameSaving(true);
    try {
      await patchUserSettings({ nickname: next });
    } catch {
      // best-effort
    }
    setNicknameSaving(false);
  }

  async function saveNotificationEmail(value) {
    const next = value.trim();
    setNotificationEmail(next);
    setNotificationEmailSaving(true);
    setError("");
    try {
      const res = await fetch("/api/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationEmail: next }),
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = {}; }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setNotificationEmail(data.notificationEmail || "");
    } catch (e) {
      setError(e.message);
    }
    setNotificationEmailSaving(false);
  }

  async function saveWlAlerts(patch) {
    const next = { ...wlAlerts, ...patch };
    setWlAlerts(next);
    setWlAlertsSaving(true);
    try {
      await patchUserSettings({ watchlistAlerts: next });
    } catch {
      // revert on failure
      setWlAlerts(wlAlerts);
    }
    setWlAlertsSaving(false);
  }

  // Account mode: load the current user's subscription status (for the Cancel UI).
  useEffect(() => {
    if (!showAccount) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/billing/status");
        if (!r.ok) return;
        const d = await r.json();
        if (!cancelled) setSubStatus(d);
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [showAccount]);

  async function cancelSubscription() {
    if (!confirm("Cancel your Pro subscription? It won't renew, and you'll keep Pro until the end of your current billing period.")) return;
    setCanceling(true);
    setError("");
    try {
      const res = await fetch("/api/billing/cancel", { method: "POST" });
      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch { data = {}; }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSubStatus((s) => ({
        ...(s || {}),
        plan: data.plan,
        status: data.status || "CANCELLED",
        proUntil: data.proUntil ?? (s?.proUntil ?? null),
      }));
      onAuthRefresh && onAuthRefresh();
    } catch (e) {
      setError(e.message);
    }
    setCanceling(false);
  }


  async function addUser() {
    const email = newUsername.trim().toLowerCase();
    if (!email || !newPassword) return;
    if (!EMAIL_RE.test(email)) {
      setError("A valid email address is required");
      return;
    }
    setAdding(true);
    setError("");
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: email, password: newPassword, isAdmin: newIsAdmin }),
      });

      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Server returned non-JSON (status ${res.status}). Check backend logs. Response started with: ${text.substring(0, 100)}`);
      }

      if (!res.ok) throw new Error(data.error || "Failed to add user");
      setNewUsername("");
      setNewPassword("");
      setNewIsAdmin(false);
      await loadUsers();
    } catch (e) {
      setError(e.message);
    }
    setAdding(false);
  }

  async function patchUser(username, body) {
    setError("");
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(username)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = {}; }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      await loadUsers();
    } catch (e) {
      setError(e.message);
    }
  }

  const toggleAdmin = (username, makeAdmin) => patchUser(username, { isAdmin: makeAdmin });
  const setPlan = (username, plan) => patchUser(username, { plan });

  async function deleteUser(username) {
    if (!confirm(`Delete user "${username}"?`)) return;
    try {
      const res = await fetch(`/api/users/${username}`, { method: "DELETE" });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = {}; }
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      await loadUsers();
    } catch (e) {
      alert("Failed to delete: " + e.message);
    }
  }

  async function changeMyPassword() {
    if (!currentPw || !newPw) return;
    setChangingPassword(true);
    setError("");
    try {
      const res = await fetch("/api/users/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = {}; }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      alert("Password changed successfully!");
      setCurrentPw("");
      setNewPw("");
    } catch (e) {
      setError(e.message);
    }
    setChangingPassword(false);
  }

  async function deleteMyAccount() {
    if (!confirm(
      "Permanently delete your account?\n\nThis cancels any active subscription and erases all your data (settings, portfolios, chats). This cannot be undone."
    )) return;
    setDeleting(true);
    setError("");
    try {
      const res = await fetch("/api/users/me", { method: "DELETE" });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = {}; }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      // Account + this device's session are gone — hard reload to the (now
      // signed-out) app, which lands on the login / marketing page.
      window.location.href = "/";
    } catch (e) {
      setError(e.message);
      setDeleting(false);
    }
  }

  const modalTitle = showUsers ? "User Management" : showUsage ? "Ori Usage" : "Account Settings";
  const modalWidth = showUsers ? "max-w-2xl" : showUsage ? "max-w-lg" : "max-w-xl";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 sm:p-6" onClick={onClose}>
      <div
        className={`bg-gray-900 border border-gray-700 rounded-xl w-full ${modalWidth} max-h-[min(90dvh,calc(100dvh-2rem))] flex flex-col overflow-hidden shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 justify-between items-start gap-3 px-5 sm:px-6 py-4 border-b border-gray-800">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-100">{modalTitle}</h2>
            {showUsage && (
              <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">Fair-use limits for Ori chat and Game Plans</p>
            )}
            {showAccount && (
              <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">Profile, plan, alerts, and security</p>
            )}
            {showUsers && (
              <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">Add users and manage plans</p>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" className="shrink-0 text-gray-400 hover:text-gray-100 text-xl leading-none px-1">×</button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 sm:px-6 py-4 space-y-6">
        {error && (
          <div className="text-sm text-red-400 bg-red-950/40 p-3 rounded-lg leading-relaxed break-words">{error}</div>
        )}

        {/* Admin-only section: Add user + User list */}
        {showUsers && (
          <>
            <Section title="Add New User">
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="email"
                  placeholder="Email"
                  value={newUsername}
                  onChange={e => setNewUsername(e.target.value)}
                  className="flex-1 min-w-0 bg-gray-950 border border-gray-700 rounded px-3 py-1.5 text-sm"
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="flex-1 min-w-0 bg-gray-950 border border-gray-700 rounded px-3 py-1.5 text-sm"
                />
                <button
                  onClick={addUser}
                  disabled={adding || !newUsername || !newPassword}
                  className="shrink-0 px-4 py-1.5 sm:py-0 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded text-sm"
                >
                  Add
                </button>
              </div>
              <label className="flex items-center gap-2 mt-2 text-xs text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newIsAdmin}
                  onChange={e => setNewIsAdmin(e.target.checked)}
                  className="accent-emerald-500"
                />
                Make this user an admin
              </label>
            </Section>

            <Section title="Users">
              <HelperText className="mb-3">
                Click a user for login history and Ori usage. Open the full observability dashboard from the profile menu.
              </HelperText>
              {loading ? (
                <div className="text-sm text-gray-400">Loading...</div>
              ) : (
                <div className="space-y-2">
                  {users.map((u) => {
                    const label = userListLabel(u);
                    const expanded = expandedUser === u.username;
                    return (
                    <div key={u.username} className={`bg-gray-950 border rounded-lg text-sm ${expanded ? "border-violet-800/60" : "border-gray-800"}`}>
                      <div
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-x-3 gap-y-2 px-3 py-2.5 cursor-pointer hover:bg-gray-900/50"
                        onClick={() => setExpandedUser(expanded ? null : u.username)}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${u.online ? "bg-emerald-400" : "bg-gray-600"}`} />
                            <div className="font-medium text-gray-100 break-words">{label.primary}</div>
                          </div>
                          {label.secondary && (
                            <div className="text-xs text-gray-500 mt-0.5 break-all pl-4">{label.secondary}</div>
                          )}
                          <div className="flex items-center gap-1.5 mt-1 flex-wrap pl-4">
                            {u.is_admin && (
                              <span className="text-[10px] px-1.5 py-0.5 bg-emerald-900 text-emerald-300 rounded">admin</span>
                            )}
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${u.plan === 'pro' ? 'bg-violet-900 text-violet-300' : 'bg-gray-800 text-gray-500'}`}>
                              {u.plan === 'pro' ? 'PRO' : 'free'}
                            </span>
                            {u.username === currentUser && (
                              <span className="text-xs text-blue-400">(you)</span>
                            )}
                            {u.last_active_at && (
                              <span className="text-[10px] text-gray-600">active {relTime(u.last_active_at)}</span>
                            )}
                            {!u.is_admin && (
                              <span className="text-[10px] text-gray-600">Ori {u.ori_today_requests ?? 0}d / {u.ori_month_requests ?? 0}m</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 flex-wrap sm:justify-end" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => setPlan(u.username, u.plan === 'pro' ? 'free' : 'pro')}
                            className="text-xs text-gray-400 hover:text-violet-300 whitespace-nowrap"
                            title="Toggle the paid plan after the user's payment arrives"
                          >
                            {u.plan === 'pro' ? 'Downgrade' : 'Set Pro'}
                          </button>
                          {u.username !== currentUser && (
                            <button
                              onClick={() => toggleAdmin(u.username, !u.is_admin)}
                              className="text-xs text-gray-400 hover:text-emerald-300 whitespace-nowrap"
                            >
                              {u.is_admin ? "Revoke admin" : "Make admin"}
                            </button>
                          )}
                          {users.length > 1 && u.username !== currentUser && (
                            <button
                              onClick={() => deleteUser(u.username)}
                              className="text-red-400 hover:text-red-300 text-xs whitespace-nowrap"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </div>
                      {expanded && (
                        <div className="border-t border-gray-800 px-3 py-3 text-xs space-y-3">
                          {userDetailLoading ? (
                            <p className="text-gray-500">Loading details…</p>
                          ) : userDetail ? (
                            <>
                              <div className="grid grid-cols-2 gap-2">
                                <div className="bg-gray-900 border border-gray-800 rounded-lg p-2">
                                  <div className="text-[10px] text-gray-500">Last login</div>
                                  <div className="text-gray-200 mt-0.5">{fmtWhen(userDetail.last_login_at)}</div>
                                  {userDetail.last_login_ip && <div className="text-[10px] text-gray-600 mt-0.5">{userDetail.last_login_ip}</div>}
                                  <div className="text-[10px] text-gray-600 mt-0.5">{userDetail.login_count ?? 0} total logins</div>
                                </div>
                                <div className="bg-gray-900 border border-gray-800 rounded-lg p-2">
                                  <div className="text-[10px] text-gray-500">Last active</div>
                                  <div className="text-gray-200 mt-0.5">{fmtWhen(userDetail.last_active_at)}</div>
                                  {userDetail.sessionMinutes && userDetail.online && (
                                    <div className="text-[10px] text-gray-600 mt-0.5">~{userDetail.sessionMinutes}m this session</div>
                                  )}
                                </div>
                                <div className="bg-gray-900 border border-gray-800 rounded-lg p-2">
                                  <div className="text-[10px] text-gray-500">Chats</div>
                                  <div className="text-gray-200 mt-0.5 tabular-nums">{userDetail.chatSessions ?? 0} sessions</div>
                                </div>
                                <div className="bg-gray-900 border border-gray-800 rounded-lg p-2">
                                  <div className="text-[10px] text-gray-500">Ori usage</div>
                                  <div className="text-gray-200 mt-0.5">
                                    {userDetail.oriUnlimited ? "Unlimited" : `${userDetail.oriMonth?.requests ?? 0} this month`}
                                  </div>
                                </div>
                              </div>
                              {(userDetail.loginHistory || []).length > 0 && (
                                <div>
                                  <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Recent logins</div>
                                  <div className="space-y-1 max-h-32 overflow-y-auto">
                                    {userDetail.loginHistory.slice(0, 5).map((e, i) => (
                                      <div key={i} className="flex justify-between gap-2 text-[10px] text-gray-500">
                                        <span>{e.kind}{e.ip ? ` · ${e.ip}` : ""}</span>
                                        <span className="shrink-0">{e.ago}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </>
                          ) : (
                            <p className="text-gray-500">Could not load user details.</p>
                          )}
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              )}
            </Section>
          </>
        )}

        {showAccount && (
          <Section title="Profile">
            <div className="bg-gray-950 border border-gray-800 rounded-lg p-3 space-y-3">
              <div>
                <label className="text-[11px] text-gray-500 block mb-1">Nickname</label>
                <input
                  type="text"
                  placeholder="How Ori should address you"
                  value={nickname}
                  maxLength={64}
                  onChange={(e) => setNickname(e.target.value)}
                  onBlur={(e) => saveNickname(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm"
                />
                <HelperText className="mt-1.5">
                  Ori uses this instead of your login or email. Leave blank to use your username.
                  {nicknameSaving && <span className="ml-1 text-gray-500">Saving…</span>}
                </HelperText>
              </div>
              <div>
                <label className="text-[11px] text-gray-500 block mb-1">Notification email</label>
                <input
                  type="email"
                  placeholder={loginEmail || "you@example.com"}
                  value={notificationEmail}
                  onChange={(e) => setNotificationEmail(e.target.value)}
                  onBlur={(e) => saveNotificationEmail(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm"
                />
                <HelperText className="mt-1.5">
                  {loginEmail
                    ? "Watchlist digests and billing emails go here when set; otherwise your login email is used."
                    : isAdmin
                      ? "Legacy admin accounts often have no login email — add one here for watchlist digests and billing notices."
                      : "Add an email here for watchlist digests and billing notices."}
                  {notificationEmailSaving && <span className="ml-1 text-gray-500">Saving…</span>}
                </HelperText>
              </div>
            </div>
          </Section>
        )}

        {showAccount && (
          <Section title="Your Plan">
            <div className="bg-gray-950 border border-gray-800 rounded-lg p-3 sm:p-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="min-w-0">
                  <span className={`text-sm font-bold ${(plan === 'pro' || isAdmin) ? 'text-violet-300' : 'text-gray-200'}`}>
                    {isAdmin ? 'Admin (full access)' : plan === 'pro' ? 'Pro' : 'Free'}
                  </span>
                  {!isAdmin && subStatus?.proUntil && (
                    <div className="text-[11px] text-gray-500 mt-0.5">
                      {['ACTIVE', 'APPROVED'].includes(String(subStatus.status || '').toUpperCase())
                        ? `Renews ${new Date(subStatus.proUntil).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`
                        : `Pro until ${new Date(subStatus.proUntil).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })} · won't renew`}
                    </div>
                  )}
                </div>

                {/* Free → upgrade via the real PayPal checkout modal */}
                {!isAdmin && plan !== 'pro' && (
                  <button
                    onClick={() => onUpgradeToPro && onUpgradeToPro()}
                    className="w-full sm:w-auto shrink-0 text-xs font-semibold px-3 py-2 rounded-md text-white bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-500 hover:brightness-110 transition-all text-center"
                  >
                    Upgrade — {PRO_PRICE_LABEL}
                  </button>
                )}

                {/* Pro with an ACTIVE subscription → cancel (won't renew, keeps grace) */}
                {!isAdmin && plan === 'pro' && subStatus?.subscriptionId &&
                  ['ACTIVE', 'APPROVED'].includes(String(subStatus.status || '').toUpperCase()) && (
                  <button
                    onClick={cancelSubscription}
                    disabled={canceling}
                    className="w-full sm:w-auto shrink-0 text-xs font-semibold px-3 py-2 rounded-md border border-gray-700 text-gray-300 hover:bg-gray-800 disabled:opacity-50 transition-colors text-center"
                  >
                    {canceling ? "Cancelling…" : "Cancel subscription"}
                  </button>
                )}
              </div>
              <HelperText className="mt-3">
                {isAdmin || plan === 'pro'
                  ? 'You have full access to Ori, the AI analyst.'
                  : `Free includes the full screener, Deep Research, and portfolio tools. Pro (${PRO_PRICE_LABEL}) unlocks Ori — the portfolio-aware AI analyst.`}
              </HelperText>
            </div>
          </Section>
        )}

        {showUsage && (
          <div className="space-y-5">
            <HelperText>
              Ori powers chat and the Deep Research Game Plan. Limits work like Claude Pro: a rolling session window plus daily, weekly, and monthly caps.
            </HelperText>
            {!oriUsage ? (
              <p className="text-sm text-gray-500">Loading…</p>
            ) : oriUsage.unlimited ? (
              <>
                <div className="bg-gray-950 border border-gray-800 rounded-lg p-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-base font-semibold text-emerald-300">Unlimited</span>
                    <span className="text-[10px] px-1.5 py-0.5 bg-emerald-900 text-emerald-300 rounded">admin</span>
                  </div>
                  <HelperText className="mt-2">
                    Admin accounts aren't metered — chat and Game Plans are uncapped.
                  </HelperText>
                </div>
                {oriUsage.monthTotals?.requests > 0 && (
                  <Section title="This month">
                    <div className="grid grid-cols-2 gap-2">
                      <StatTile label="Chats" value={oriUsage.monthTotals.chatRequests} />
                      <StatTile label="Game plans" value={oriUsage.monthTotals.planRequests} />
                      <StatTile label="Input tokens" value={fmtTokens(oriUsage.monthTotals.promptTokens)} />
                      <StatTile label="Output tokens" value={fmtTokens(oriUsage.monthTotals.outputTokens)} />
                    </div>
                  </Section>
                )}
              </>
            ) : (
              <>
                <div className="bg-gray-950 border border-gray-800 rounded-lg p-4 space-y-4">
                  <UsageMeter
                    label={`Session (${oriUsage.limits.sessionHours}h)`}
                    used={oriUsage.session?.used ?? 0}
                    limit={oriUsage.limits.session}
                    sub={
                      oriUsage.session?.resetsAt
                        ? `Rolling window · resets around ${formatResetTime(oriUsage.session.resetsAt)} ET`
                        : `Rolling window · oldest request ages out after ${oriUsage.limits.sessionHours} hours`
                    }
                  />
                  <UsageMeter
                    label="Today"
                    used={oriUsage.day.requests}
                    limit={oriUsage.limits.daily}
                    sub={`${oriUsage.day.chatRequests} chats · ${oriUsage.day.planRequests} game plans · resets midnight ET`}
                  />
                  <UsageMeter
                    label="This week"
                    used={oriUsage.weekTotals?.requests ?? 0}
                    limit={oriUsage.limits.weekly}
                    sub={`${oriUsage.weekTotals?.chatRequests ?? 0} chats · ${oriUsage.weekTotals?.planRequests ?? 0} game plans · rolling 7 days`}
                  />
                  <UsageMeter
                    label="This month"
                    used={oriUsage.monthTotals.requests}
                    limit={oriUsage.limits.monthly}
                    sub={`${oriUsage.monthTotals.chatRequests} chats · ${oriUsage.monthTotals.planRequests} game plans · resets on the 1st`}
                  />
                </div>
                <Section title="This month's volume">
                  <div className="grid grid-cols-2 gap-2">
                    <StatTile label="Chats" value={oriUsage.monthTotals.chatRequests} />
                    <StatTile label="Game plans" value={oriUsage.monthTotals.planRequests} />
                    <StatTile label="Input tokens" value={fmtTokens(oriUsage.monthTotals.promptTokens)} />
                    <StatTile label="Output tokens" value={fmtTokens(oriUsage.monthTotals.outputTokens)} />
                  </div>
                </Section>
                {oriUsage.monthTotals.cachedTokens > 0 && (
                  <p className="text-[11px] text-emerald-400/80 leading-relaxed break-words">
                    Context cache served {Math.round(oriUsage.monthTotals.cacheHitRate * 100)}% of Ori's input this month — keeping Ori fast and affordable.
                  </p>
                )}
                <HelperText className="text-gray-600">
                  One request = one Ori chat reply or one Deep Research Game Plan. Browsing the screener doesn't count. Longer chats use more of your allowance, so start fresh threads when you can.
                </HelperText>
              </>
            )}
          </div>
        )}

        {showAccount && (
          <Section title="Watchlist alerts">
            <div className="bg-gray-950 border border-gray-800 rounded-lg p-3 sm:p-4 space-y-3">
              <HelperText>
                Watched symbols refresh automatically (~hourly). Get in-app toasts, a daily email digest (8am ET), and optional instant email for large price moves.
              </HelperText>
              {[
                ["enabled", "Alerts enabled"],
                ["inApp", "In-app notifications"],
                ["emailDigest", "Daily email digest"],
                ["emailInstant", "Instant email for large moves (≥8%)"],
              ].map(([key, label]) => (
                <label key={key} className="flex items-start justify-between gap-3 text-xs text-gray-300 cursor-pointer">
                  <span className="leading-relaxed break-words flex-1 min-w-0">{label}</span>
                  <input
                    type="checkbox"
                    checked={!!wlAlerts[key]}
                    disabled={wlAlertsSaving}
                    onChange={(e) => saveWlAlerts({ [key]: e.target.checked })}
                    className="accent-violet-500"
                  />
                </label>
              ))}
              {appEnv === 'development' && onTestWatchlistAlert && (
                <div className="pt-1 space-y-2">
                  <HelperText className="text-gray-600">
                    Dev only: previews the in-app toast (bottom-right). Does not send email — real emails come from the scanner and daily digest.
                  </HelperText>
                  <button
                    type="button"
                    disabled={testWatchlistAlertBusy}
                    onClick={onTestWatchlistAlert}
                    className="w-full text-[11px] font-semibold px-2 py-1.5 rounded-md border border-amber-800/50 bg-amber-950/30 text-amber-200 hover:bg-amber-900/40 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {testWatchlistAlertBusy ? 'Sending…' : 'Send test in-app notification'}
                  </button>
                  {testWatchlistAlertMsg && (
                    <p className={`text-[10px] leading-relaxed break-words ${testWatchlistAlertOk === false ? 'text-red-400' : 'text-emerald-400'}`}>
                      {testWatchlistAlertMsg}
                    </p>
                  )}
                </div>
              )}
            </div>
          </Section>
        )}

        {showAccount && (
        <Section title="Change Your Password">
          <div className="space-y-2">
            <input
              type="password"
              placeholder="Current password"
              value={currentPw}
              onChange={e => setCurrentPw(e.target.value)}
              className="w-full bg-gray-950 border border-gray-700 rounded px-3 py-1.5 text-sm"
            />
            <input
              type="password"
              placeholder="New password"
              value={newPw}
              onChange={e => setNewPw(e.target.value)}
              className="w-full bg-gray-950 border border-gray-700 rounded px-3 py-1.5 text-sm"
            />
            <button
              onClick={changeMyPassword}
              disabled={changingPassword || !currentPw || !newPw}
              className="w-full py-1.5 bg-gray-800 hover:bg-gray-700 rounded text-sm disabled:opacity-50"
            >
              {changingPassword ? "Changing..." : "Change Password"}
            </button>
          </div>
        </Section>
        )}

        {showAccount && (
        <Section title="Danger Zone" titleClass="text-red-400/80" className="pt-2 border-t border-gray-800">
          <div className="bg-red-950/20 border border-red-900/50 rounded-lg p-3 sm:p-4">
            <HelperText className="text-gray-400 mb-3">
              Permanently delete your account and all associated data (settings, portfolios, chats).
              Any active subscription is cancelled. This cannot be undone.
            </HelperText>
            <button
              onClick={deleteMyAccount}
              disabled={deleting}
              className="w-full py-1.5 rounded text-sm font-semibold text-red-200 bg-red-900/40 border border-red-800/60 hover:bg-red-900/60 disabled:opacity-50 transition-colors"
            >
              {deleting ? "Deleting…" : "Delete my account"}
            </button>
          </div>
        </Section>
        )}
        </div>
      </div>
    </div>
  );
}
