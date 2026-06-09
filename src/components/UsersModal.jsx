import { useState, useEffect } from "react";

// `mode` controls which surface this modal shows:
//   'account' → personal Account Settings (change your password)
//   'users'   → admin User Management (add/remove users, grant admin)
export default function UsersModal({ onClose, currentUser, isAdmin = false, mode = 'account' }) {
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

  async function toggleAdmin(username, makeAdmin) {
    setError("");
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(username)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isAdmin: makeAdmin }),
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

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div 
        className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-6"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">{showUsers ? "User Management" : "Account Settings"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
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
                    <div key={u.username} className="flex items-center justify-between bg-gray-950 border border-gray-800 rounded px-3 py-1.5 text-sm">
                      <div>
                        <span className="font-medium">{u.username}</span>
                        {u.is_admin && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 bg-emerald-900 text-emerald-300 rounded">admin</span>}
                        {u.username === currentUser && <span className="text-xs text-blue-400 ml-2">(you)</span>}
                      </div>
                      <div className="flex items-center gap-3">
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
      </div>
    </div>
  );
}
