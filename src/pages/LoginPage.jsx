import { useEffect, useState } from "react";
import OrizenLogo from "../components/OrizenLogo.jsx";

export default function LoginPage({ onSuccess }) {
  const [mode, setMode] = useState("checking"); // "checking" | "login" | "setup"
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = "Sign in · Orizen";
  }, []);

  // Check if we need to run first-time setup
  useEffect(() => {
    fetch("/api/auth/status")
      .then(r => r.json())
      .then(data => {
        if (data.needsSetup) {
          setMode("setup");
        } else {
          setMode("login");
        }
      })
      .catch(() => {
        // If we can't reach the status endpoint, fall back to normal login
        setMode("login");
      });
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const endpoint = mode === "setup" ? "/api/auth/setup-first-admin" : "/api/auth/login";

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      onSuccess?.();
    } catch (err) {
      setError(err.message || "Something went wrong");
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center px-4 relative overflow-hidden">
      {/* Background gradient glow */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[40rem] h-[40rem] rounded-full bg-gradient-to-br from-blue-500/20 via-indigo-500/10 to-violet-500/20 blur-3xl" />
        <div className="absolute bottom-0 left-0 w-[20rem] h-[20rem] rounded-full bg-violet-500/10 blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Brand */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <OrizenLogo className="w-10 h-10" />
          <div className="text-center">
            <h1
              className="text-white text-3xl tracking-tight"
              style={{ fontFamily: '"Space Grotesk", system-ui, sans-serif', fontWeight: 600 }}
            >
              Orizen
            </h1>
            <p className="text-xs text-gray-500 mt-1 tracking-wide">
              stock recommendation engine
            </p>
          </div>
        </div>

        {/* Card */}
        <form
          onSubmit={handleSubmit}
          className="bg-gray-900/60 backdrop-blur-sm border border-gray-800 rounded-xl p-6 shadow-2xl shadow-blue-500/5"
        >
          <h2 className="text-sm font-medium text-gray-300 mb-4">
            {mode === "setup" ? "Create First Admin Account" : "Sign in"}
          </h2>

          {mode === "setup" && (
            <p className="text-xs text-gray-400 mb-4">
              No users exist yet. Create the first admin account below. After this, you can manage all users from inside the app.
            </p>
          )}

          <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1.5">
            Username
          </label>
          <input
            type="text"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            autoFocus
            autoComplete="username"
            className="w-full bg-gray-950 border border-gray-800 rounded-md px-3 py-2 text-sm text-gray-100 placeholder-gray-600 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-colors mb-4"
            placeholder="admin"
          />

          <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1.5">
            Password
          </label>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "setup" ? "new-password" : "current-password"}
              className="w-full bg-gray-950 border border-gray-800 rounded-md px-3 py-2 pr-10 text-sm text-gray-100 placeholder-gray-600 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-colors"
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
              tabIndex={-1}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              )}
            </button>
          </div>

          {error && (
            <div className="mt-4 text-xs text-red-400 bg-red-950/40 border border-red-900/60 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || !user || !password}
            className="mt-5 w-full px-4 py-2.5 rounded-md text-sm font-medium text-white bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-500 hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-500/20"
          >
            {submitting 
              ? (mode === "setup" ? "Creating account…" : "Signing in…") 
              : (mode === "setup" ? "Create Admin Account" : "Sign in")}
          </button>

          {mode === "setup" && (
            <p className="text-center text-[10px] text-gray-500 mt-3">
              This account will be an administrator and can create other users later.
            </p>
          )}
        </form>

        <p className="text-center text-[10.5px] text-gray-600 mt-6 tracking-wide">
          For informational purposes only · not financial advice
        </p>
      </div>
    </div>
  );
}

