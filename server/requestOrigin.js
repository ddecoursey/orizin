const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function normalizedOrigin(value) {
  try {
    return new URL(String(value || "")).origin;
  } catch {
    return null;
  }
}

/**
 * Protect cookie-authenticated mutations without blocking non-browser clients.
 * SameSite cookies remain a second layer; this rejects hostile browser origins.
 */
export function isTrustedMutationRequest(req, appUrl = process.env.APP_URL) {
  if (SAFE_METHODS.has(String(req.method || "GET").toUpperCase())) return true;

  const origin = req.get?.("origin") || req.headers?.origin;
  if (!origin) {
    return String(req.get?.("sec-fetch-site") || req.headers?.["sec-fetch-site"] || "").toLowerCase() !== "cross-site";
  }

  const suppliedOrigin = normalizedOrigin(origin);
  if (!suppliedOrigin) return false;

  const allowed = new Set();
  const configuredOrigin = normalizedOrigin(appUrl);
  if (configuredOrigin) allowed.add(configuredOrigin);

  const host = req.get?.("host") || req.headers?.host;
  if (host) {
    const requestOrigin = normalizedOrigin(`${req.protocol || "http"}://${host}`);
    if (requestOrigin) allowed.add(requestOrigin);
  }

  return allowed.has(suppliedOrigin);
}
