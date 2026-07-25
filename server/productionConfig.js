const MIN_SECRET_BYTES = 32;

function isDeployed(env) {
  return (
    env.NODE_ENV === "production" ||
    !!env.RAILWAY_ENVIRONMENT ||
    String(env.APP_ENV || "").toLowerCase() === "production" ||
    String(env.PAYPAL_ENV || "").toLowerCase() === "live"
  );
}

function validPublicUrl(raw) {
  try {
    const url = new URL(String(raw || ""));
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

/** Return launch-blocking configuration errors without exposing secret values. */
export function productionConfigurationErrors(env = process.env) {
  if (!isDeployed(env)) return [];

  const errors = [];
  if (Buffer.byteLength(String(env.AUTH_SECRET || "")) < MIN_SECRET_BYTES) {
    errors.push(`AUTH_SECRET must contain at least ${MIN_SECRET_BYTES} bytes`);
  }
  if (!validPublicUrl(env.APP_URL)) {
    errors.push("APP_URL must be a public HTTPS origin with no path, query, or credentials");
  }

  if (String(env.PAYPAL_ENV || "").toLowerCase() === "live") {
    for (const name of [
      "PAYPAL_CLIENT_ID",
      "PAYPAL_SECRET",
      "PAYPAL_PLAN_ID",
      "PAYPAL_WEBHOOK_ID",
    ]) {
      if (!String(env[name] || "").trim()) errors.push(`${name} is required when PAYPAL_ENV=live`);
    }
  }

  return errors;
}

export function isDeployedRuntime(env = process.env) {
  return isDeployed(env);
}
