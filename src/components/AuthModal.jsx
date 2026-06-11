import { useEffect, useState } from "react";
import { m, AnimatePresence, useReducedMotion } from "../lib/motion.js";

// Auth dialog for the landing page: sign in, create account, or (on a fresh
// database) first-admin setup. Same endpoints the old full-page LoginPage
// used — /api/auth/login, /api/auth/signup, /api/auth/setup-first-admin.
//
// Modes: "login" | "signup" | "setup". `initialMode` is a hint from the
// caller (e.g. the "Create account" CTA); a needsSetup status overrides it.
export default function AuthModal({ open, initialMode = "login", onClose, onSuccess }) {
  const reduce = useReducedMotion();
  const [mode, setMode] = useState(initialMode);
  const [signupsEnabled, setSignupsEnabled] = useState(true);
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset to the caller's requested mode each time the dialog opens, then let
  // the server status override it (fresh DB → first-admin setup).
  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setError(null);
    setPassword("");
    setConfirm("");
    fetch("/api/auth/status")
      .then((r) => r.json())
      .then((data) => {
        setSignupsEnabled(!!data.signupsEnabled);
        if (data.needsSetup) setMode("setup");
        else if (initialMode === "signup" && !data.signupsEnabled) setMode("login");
      })
      .catch(() => {});
  }, [open, initialMode]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose?.();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function switchMode(next) {
    setMode(next);
    setError(null);
    setPassword("");
    setConfirm("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (mode === "signup") {
      if (password !== confirm) return setError("Passwords don't match");
      if (password.length < 8) return setError("Password must be at least 8 characters");
    }

    setSubmitting(true);
    const endpoint =
      mode === "setup" ? "/api/auth/setup-first-admin"
      : mode === "signup" ? "/api/auth/signup"
      : "/api/auth/login";
    const body = mode === "signup" ? { email: user, password } : { user, password };

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

  const heading =
    mode === "setup" ? "Create the first admin account"
    : mode === "signup" ? "Create your free account"
    : "Welcome back";

  const submitLabel = submitting
    ? "One moment…"
    : mode === "setup" ? "Create admin account"
    : mode === "signup" ? "Create free account"
    : "Sign in";

  const inputCls =
    "w-full bg-gray-950 border border-gray-800 rounded-lg px-3 py-2.5 text-sm text-gray-100 " +
    "placeholder-gray-600 outline-none focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20 " +
    "transition-colors duration-200";

  return (
    <AnimatePresence>
      {open && (
        <m.div
          className="fixed inset-0 z-[100] flex items-center justify-center px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden="true"
          />

          <m.div
            role="dialog"
            aria-modal="true"
            aria-label={heading}
            className="relative w-full max-w-sm bg-gray-900/90 backdrop-blur-xl border border-gray-700/80 rounded-2xl p-6 shadow-2xl shadow-blue-500/10"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.97 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="flex items-start justify-between mb-1">
              <h2 className="text-lg font-semibold text-gray-100 tracking-tight">{heading}</h2>
              <button
                onClick={onClose}
                aria-label="Close"
                className="text-gray-500 hover:text-gray-200 transition-colors duration-150 -mr-1 -mt-1 p-1 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className="text-xs text-gray-500 mb-5 leading-relaxed">
              {mode === "setup"
                ? "No users exist yet — this account becomes the administrator."
                : mode === "signup"
                ? "Free forever: full screener, Deep Research & portfolio tools. Upgrade anytime to unlock Ori."
                : "Sign in with your username or email."}
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1.5">
                  {mode === "signup" ? "Email" : mode === "setup" ? "Username" : "Username or email"}
                </label>
                <input
                  type={mode === "signup" ? "email" : "text"}
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  autoFocus
                  autoComplete={mode === "signup" ? "email" : "username"}
                  className={inputCls}
                  placeholder={mode === "setup" ? "admin" : "you@example.com"}
                />
              </div>

              <div>
                <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    className={inputCls + " pr-10"}
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors duration-150"
                    tabIndex={-1}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {mode === "signup" && (
                <div>
                  <label className="block text-[11px] uppercase tracking-wider text-gray-500 mb-1.5">
                    Confirm password
                  </label>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    autoComplete="new-password"
                    className={inputCls}
                    placeholder="••••••••"
                  />
                </div>
              )}

              {error && (
                <div className="text-xs text-red-400 bg-red-950/40 border border-red-900/60 rounded-lg px-3 py-2" role="alert">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || !user || !password || (mode === "signup" && !confirm)}
                className="w-full px-4 py-2.5 rounded-lg text-sm font-semibold text-white cursor-pointer
                  bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-500 hover:brightness-110
                  disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200
                  shadow-lg shadow-blue-500/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400"
              >
                {submitLabel}
              </button>
            </form>

            {mode === "login" && signupsEnabled && (
              <p className="text-center text-xs text-gray-500 mt-4">
                New to Orizin?{" "}
                <button onClick={() => switchMode("signup")} className="text-blue-400 hover:text-blue-300 font-medium transition-colors duration-150">
                  Create an account
                </button>
              </p>
            )}
            {mode === "signup" && (
              <p className="text-center text-xs text-gray-500 mt-4">
                Already have an account?{" "}
                <button onClick={() => switchMode("login")} className="text-blue-400 hover:text-blue-300 font-medium transition-colors duration-150">
                  Sign in
                </button>
              </p>
            )}

            <p className="text-center text-[10px] text-gray-600 mt-4">
              For informational purposes only · not financial advice
            </p>
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}
