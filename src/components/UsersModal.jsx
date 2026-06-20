import { useState, useEffect } from "react";
import { PRO_PRICE_LABEL } from "../lib/billing.js";
import { DEFAULT_WATCHLIST_ALERTS } from "../lib/watchlistAlertsConfig.js";
import { fetchUserSettings, patchUserSettings } from "../lib/userStore.js";

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
    if (!showAccount) return;
    fetchUserSettings().then((s) => {
      if (s?.watchlistAlerts) setWlAlerts({ ...DEFAULT_WATCHLIST_ALERTS, ...s.watchlistAlerts });
    }).catch(() => {});
  }, [showAccount]);

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
    if (!newUsername || !newPassword) return;
    setAdding(true);
    setError("");
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: newUsername, password: newPassword, isAdmin: newIsAdmin }),
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

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div 
        className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">{showUsers ? "User Management" : "Account Settings"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-100">✕</button>
        </div>

        {error && (
          <div className="mb-3 text-sm text-red-400 bg-red-950/40 p-2 rounded">{error}</div>
        )}

        {/* Admin-only section: Add user + User list */}
        {showUsers && (
          <>
            {/* Add new user */}
            <div className="mb-6">
              <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">Add New User</div>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Username"
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
                  className="shrink-0 px-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded text-sm"
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
            </div>

            {/* User list */}
            <div className="mb-6">
              <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">Users</div>
              {loading ? (
                <div className="text-sm text-gray-400">Loading...</div>
              ) : (
                <div className="space-y-1">
                  {users.map(u => (
                    <div key={u.username} className="flex items-center justify-between gap-2 bg-gray-950 border border-gray-800 rounded px-3 py-1.5 text-sm">
                      <div className="min-w-0">
                        <span className="font-medium truncate">{u.username}</span>
                        {u.is_admin && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 bg-emerald-900 text-emerald-300 rounded">admin</span>}
                        <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded ${u.plan === 'pro' ? 'bg-violet-900 text-violet-300' : 'bg-gray-800 text-gray-500'}`}>
                          {u.plan === 'pro' ? 'PRO' : 'free'}
                        </span>
                        {u.username === currentUser && <span className="text-xs text-blue-400 ml-2">(you)</span>}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <button
                          onClick={() => setPlan(u.username, u.plan === 'pro' ? 'free' : 'pro')}
                          className="text-xs text-gray-400 hover:text-violet-300"
                          title="Toggle the paid plan after the user's payment arrives"
                        >
                          {u.plan === 'pro' ? 'Downgrade' : 'Set Pro'}
                        </button>
                        {u.username !== currentUser && (
                          <button
                            onClick={() => toggleAdmin(u.username, !u.is_admin)}
                            className="text-xs text-gray-400 hover:text-emerald-300"
                          >
                            {u.is_admin ? "Revoke admin" : "Make admin"}
                          </button>
                        )}
                        {users.length > 1 && u.username !== currentUser && (
                          <button
                            onClick={() => deleteUser(u.username)}
                            className="text-red-400 hover:text-red-300 text-xs"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* Account mode: current plan + upgrade path */}
        {showAccount && (
          <div className="mb-6">
            <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">Your Plan</div>
            <div className="bg-gray-950 border border-gray-800 rounded-lg p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
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
                    className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-md text-white bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-500 hover:brightness-110 transition-all"
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
                    className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-md border border-gray-700 text-gray-300 hover:bg-gray-800 disabled:opacity-50 transition-colors"
                  >
                    {canceling ? "Cancelling…" : "Cancel subscription"}
                  </button>
                )}
              </div>
              <p className="text-[11px] text-gray-500 mt-2 leading-snug">
                {isAdmin || plan === 'pro'
                  ? 'You have full access to Ori, the AI analyst.'
                  : `Free includes the full screener, Deep Research, and portfolio tools. Pro (${PRO_PRICE_LABEL}) unlocks Ori — the portfolio-aware AI analyst.`}
              </p>
            </div>
          </div>
        )}

        {showAccount && (
          <div className="mb-6">
            <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">Watchlist alerts</div>
            <div className="bg-gray-950 border border-gray-800 rounded-lg p-3 space-y-2.5">
              <p className="text-[11px] text-gray-500 leading-snug">
                Watched symbols refresh automatically (~hourly). Get in-app toasts, a daily email digest (8am ET), and optional instant email for large price moves.
              </p>
              {[
                ["enabled", "Alerts enabled"],
                ["inApp", "In-app notifications"],
                ["emailDigest", "Daily email digest"],
                ["emailInstant", "Instant email for large moves (≥8%)"],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center justify-between gap-3 text-xs text-gray-300 cursor-pointer">
                  <span>{label}</span>
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
                <div className="mt-2 space-y-1.5">
                  <p className="text-[10px] text-gray-600 leading-snug">
                    Dev only: previews the in-app toast (bottom-right). Does not send email — real emails come from the scanner and daily digest.
                  </p>
                  <button
                    type="button"
                    disabled={testWatchlistAlertBusy}
                    onClick={onTestWatchlistAlert}
                    className="w-full text-[11px] font-semibold px-2 py-1.5 rounded-md border border-amber-800/50 bg-amber-950/30 text-amber-200 hover:bg-amber-900/40 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {testWatchlistAlertBusy ? 'Sending…' : 'Send test in-app notification'}
                  </button>
                  {testWatchlistAlertMsg && (
                    <p className={`text-[10px] leading-snug ${testWatchlistAlertOk === false ? 'text-red-400' : 'text-emerald-400'}`}>
                      {testWatchlistAlertMsg}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Change own password */}
        {showAccount && (
        <div>
          <div className="text-xs uppercase tracking-wider text-gray-500 mb-2">Change Your Password</div>
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
        </div>
        )}

        {/* Danger zone: self-service account deletion */}
        {showAccount && (
        <div className="mt-6 pt-4 border-t border-gray-800">
          <div className="text-xs uppercase tracking-wider text-red-400/80 mb-2">Danger Zone</div>
          <div className="bg-red-950/20 border border-red-900/50 rounded-lg p-3">
            <p className="text-[11px] text-gray-400 mb-2.5 leading-snug">
              Permanently delete your account and all associated data (settings, portfolios, chats).
              Any active subscription is cancelled. This cannot be undone.
            </p>
            <button
              onClick={deleteMyAccount}
              disabled={deleting}
              className="w-full py-1.5 rounded text-sm font-semibold text-red-200 bg-red-900/40 border border-red-800/60 hover:bg-red-900/60 disabled:opacity-50 transition-colors"
            >
              {deleting ? "Deleting…" : "Delete my account"}
            </button>
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
