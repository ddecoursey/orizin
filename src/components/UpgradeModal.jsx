import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PRO_PRICE_LABEL, PRO_FEATURES } from "../lib/billing.js";

// Load the PayPal JS SDK once, with the client id served by the backend
// (/api/billing/config). The same SDK URL is used for sandbox and live — PayPal
// decides the environment from the client id.
let sdkPromise = null;
function loadPayPalSdk(clientId) {
  if (window.paypal) return Promise.resolve(window.paypal);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src =
      `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}` +
      `&vault=true&intent=subscription&components=buttons`;
    s.onload = () => resolve(window.paypal);
    s.onerror = () => {
      sdkPromise = null;
      reject(new Error("Failed to load PayPal SDK"));
    };
    document.head.appendChild(s);
  });
  return sdkPromise;
}

export default function UpgradeModal({ onClose, onSuccess }) {
  // loading → ready → success | error | unconfigured
  const [phase, setPhase] = useState("loading");
  const [error, setError] = useState("");
  const [subId, setSubId] = useState(null);

  const containerRef = useRef(null);
  const buttonsRef = useRef(null);
  const renderedRef = useRef(false);
  // Keep the latest onSuccess without re-running the setup effect.
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => { onSuccessRef.current = onSuccess; }, [onSuccess]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // 1) Ask the server for the public PayPal config (client id + plan id).
      let cfg;
      try {
        const r = await fetch("/api/billing/config");
        cfg = await r.json();
      } catch {
        if (!cancelled) { setError("Could not reach the server. Please try again."); setPhase("error"); }
        return;
      }
      if (cancelled) return;
      if (!cfg?.configured) { setPhase("unconfigured"); return; }

      // 2) Load the SDK with that client id.
      let paypal;
      try {
        paypal = await loadPayPalSdk(cfg.clientId);
      } catch {
        if (!cancelled) {
          setError("Couldn't load PayPal. Check your connection or popup blocker and retry.");
          setPhase("error");
        }
        return;
      }
      if (cancelled || !paypal?.Buttons || renderedRef.current) return;
      renderedRef.current = true;
      setPhase("ready");

      // 3) Render the subscribe button. The container is mounted in every
      //    non-terminal phase, so the ref is already available.
      const container = containerRef.current;
      if (!container) return;
      container.innerHTML = "";

      const buttons = paypal.Buttons({
        style: { shape: "pill", color: "gold", layout: "vertical", label: "subscribe" },
        createSubscription: (data, actions) =>
          actions.subscription.create({ plan_id: cfg.planId }),
        onApprove: async (data) => {
          // Hand the subscription id to our server, which verifies it with
          // PayPal before granting Pro. Never trust the client alone.
          try {
            const res = await fetch("/api/billing/activate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ subscriptionID: data.subscriptionID }),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || "Activation failed");
            setSubId(data.subscriptionID);
            setPhase("success");
            onSuccessRef.current?.(data.subscriptionID);
          } catch (e) {
            setError(
              (e && e.message) ||
                "We couldn't activate your subscription. If you were charged, contact support.",
            );
            setPhase("error");
          }
        },
        onError: (err) => {
          console.error("PayPal error:", err);
          if (!cancelled) {
            setError("Something went wrong with PayPal. Please try again.");
            setPhase("error");
          }
        },
        onCancel: () => { /* user closed the PayPal window — leave the button up */ },
      });
      buttonsRef.current = buttons;
      buttons.render(container).catch((e) => {
        console.error("PayPal render error:", e);
        if (!cancelled) { setError("Failed to render the PayPal button."); setPhase("error"); }
      });
    })();

    return () => {
      cancelled = true;
      renderedRef.current = false;
      try { buttonsRef.current?.close(); } catch { /* ignore */ }
      buttonsRef.current = null;
    };
  }, []);

  const modal = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="upgrade-modal-card w-full max-w-md overflow-hidden rounded-2xl border border-gray-700 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold text-white">Upgrade to Pro</h3>
            <p className="mt-0.5 text-xs text-gray-400">{PRO_PRICE_LABEL} · cancel anytime</p>
          </div>
          <button
            onClick={onClose}
            className="text-2xl leading-none text-gray-400 transition-colors hover:text-white"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          {phase === "success" ? (
            <div className="py-6 text-center">
              <div className="mb-3 text-4xl">🎉</div>
              <h4 className="mb-1 text-xl font-semibold text-emerald-400">You're Pro!</h4>
              <p className="mb-4 text-sm text-gray-300">
                Your subscription is active and Ori is unlocked. You can manage or cancel it anytime
                from Account Settings.
              </p>
              {subId && <p className="mb-5 text-[10px] text-gray-500">Subscription: {subId}</p>}
              <button
                onClick={onClose}
                className="rounded-md bg-emerald-600 px-6 py-2 font-medium text-white transition-colors hover:bg-emerald-500"
              >
                Continue
              </button>
            </div>
          ) : phase === "unconfigured" ? (
            <div className="rounded-lg border border-amber-700 bg-amber-900/30 p-4 text-sm text-amber-200">
              Subscriptions aren't configured on this server yet. An administrator needs to set the
              PayPal environment variables (<code>PAYPAL_CLIENT_ID</code>, <code>PAYPAL_SECRET</code>,
              <code> PAYPAL_PLAN_ID</code>).
            </div>
          ) : (
            <>
              <h4 className="mb-2 text-sm font-semibold text-white">What you get with Pro</h4>
              <ul className="mb-5 space-y-1.5 text-sm text-gray-300">
                {PRO_FEATURES.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <span className="mt-0.5 text-emerald-400">✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              {error && (
                <div className="mb-3 rounded-lg border border-red-700 bg-red-900/30 p-3 text-sm text-red-300">
                  {error}
                </div>
              )}

              {/* PayPal subscribe button renders here. Always mounted (so the ref
                  exists); a spinner sits on top until the SDK is ready. */}
              <div className="relative min-h-[150px] rounded-xl border border-gray-800 bg-gray-950/40 p-3">
                {phase === "loading" && (
                  <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400">
                    Loading secure checkout…
                  </div>
                )}
                <div ref={containerRef} />
              </div>

              <p className="mt-4 text-center text-[10px] text-gray-500">
                Secure checkout by PayPal. You can cancel anytime from your account or PayPal.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
