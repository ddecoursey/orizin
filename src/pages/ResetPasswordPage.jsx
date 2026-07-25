import { useState } from "react";

// Landing page for the emailed password-reset link (/reset?token=…&u=…).
// On success the server logs this device in (fresh session), so we send the user
// straight into the app.
export default function ResetPasswordPage() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") || "";
  const u = params.get("u") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (password.length < 8 || password.length > 200) return setError("Password must be 8-200 characters");
    if (password !== confirm) return setError("Passwords don't match");
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ u, token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Reset failed");
      setDone(true);
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  const card = "w-full max-w-sm bg-gray-900 border border-gray-800 rounded-2xl p-6";
  const input =
    "w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 outline-none focus:border-blue-500/60";

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center px-4">
      {!token || !u ? (
        <div className={card}>
          <h1 className="text-lg font-semibold mb-2">Invalid reset link</h1>
          <p className="text-sm text-gray-400">This link is missing information. Request a new password reset from the sign-in screen.</p>
          <a href="/" className="inline-block mt-4 text-sm text-blue-400 hover:text-blue-300">← Back to Orizin</a>
        </div>
      ) : done ? (
        <div className={card}>
          <h1 className="text-lg font-semibold mb-2">Password updated 🎉</h1>
          <p className="text-sm text-gray-400 mb-4">Your password has been changed and you're signed in on this device.</p>
          <a href="/" className="inline-block px-4 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-500 hover:brightness-110">Continue to Orizin</a>
        </div>
      ) : (
        <form onSubmit={submit} className={card}>
          <h1 className="text-lg font-semibold mb-1">Choose a new password</h1>
          <p className="text-xs text-gray-500 mb-5">Resetting the password for <span className="text-gray-300">{u}</span>.</p>
          <div className="space-y-3">
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password (8+ characters)" autoComplete="new-password" className={input} autoFocus />
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm new password" autoComplete="new-password" className={input} />
            {error && <div className="text-xs text-red-400 bg-red-950/40 border border-red-900/60 rounded-lg px-3 py-2">{error}</div>}
            <button type="submit" disabled={submitting || !password || !confirm} className="w-full px-4 py-2.5 rounded-lg text-sm font-semibold text-white bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-500 hover:brightness-110 disabled:opacity-50">
              {submitting ? "Updating…" : "Update password"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
