import assert from "node:assert/strict";

const configuredUrl = process.argv[2] || process.env.SMOKE_BASE_URL;
if (!configuredUrl) {
  throw new Error("Set SMOKE_BASE_URL or pass the deployment URL as the first argument");
}

const base = new URL(configuredUrl);
const isLocal = base.hostname === "localhost" || base.hostname === "127.0.0.1" || base.hostname === "::1";
if (base.protocol !== "https:" && !(isLocal && base.protocol === "http:")) {
  throw new Error("The smoke target must use HTTPS unless it is localhost");
}
base.pathname = base.pathname.replace(/\/$/, "");
base.search = "";
base.hash = "";

const timeoutMs = Math.max(1_000, Math.min(30_000, Number(process.env.SMOKE_TIMEOUT_MS) || 10_000));

async function request(pathname, options = {}) {
  return fetch(new URL(pathname, `${base.href}/`), {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function readJson(response, label) {
  const body = await response.json().catch(() => null);
  assert.ok(body && typeof body === "object", `${label} did not return JSON`);
  return body;
}

const health = await request("/api/health");
assert.equal(health.status, 200, `health check returned ${health.status}`);
const healthBody = await readJson(health, "health check");
assert.equal(healthBody.ok, true, "health check did not report ok=true");
if (process.env.E2E_EXPECTED_ENV) {
  assert.equal(
    healthBody.env,
    process.env.E2E_EXPECTED_ENV,
    `health check reached ${healthBody.env || "an unlabeled environment"} instead of ${process.env.E2E_EXPECTED_ENV}`,
  );
}
if (process.env.E2E_EXPECTED_SHA) {
  assert.equal(
    healthBody.deploymentSha,
    process.env.E2E_EXPECTED_SHA,
    "health check reached a different Railway commit than the deployment under test",
  );
}

const home = await request("/");
assert.equal(home.status, 200, `app shell returned ${home.status}`);
assert.match(home.headers.get("content-type") || "", /text\/html/i, "app shell is not HTML");
assert.match(home.headers.get("content-security-policy") || "", /default-src 'self'/i, "CSP header is missing");
assert.equal(home.headers.get("x-content-type-options"), "nosniff", "nosniff header is missing");
assert.match(home.headers.get("cache-control") || "", /no-cache/i, "index.html must revalidate after deploys");
const html = await home.text();
assert.match(html, /<div id="root"><\/div>/, "React root is missing from the app shell");

const assetPath = html.match(/<script[^>]+src="(\/assets\/[^"]+\.js)"/)?.[1];
assert.ok(assetPath, "built JavaScript asset was not referenced by index.html");
const asset = await request(assetPath);
assert.equal(asset.status, 200, `built JavaScript asset returned ${asset.status}`);
assert.match(asset.headers.get("content-type") || "", /javascript/i, "built asset has the wrong content type");
assert.match(asset.headers.get("cache-control") || "", /immutable/i, "hashed assets are not cached immutably");
await asset.body?.cancel();

const authStatus = await request("/api/auth/status");
assert.equal(authStatus.status, 200, `auth status returned ${authStatus.status}`);
const authStatusBody = await readJson(authStatus, "auth status");
assert.equal(authStatusBody.authEnabled, true, "deployment authentication is not fail-closed");
assert.equal(typeof authStatusBody.hasUsers, "boolean", "auth status omitted hasUsers");

const anonymousSession = await request("/api/auth/me");
assert.equal(anonymousSession.status, 401, `anonymous session check returned ${anonymousSession.status}`);

// Safe negative mutation: an empty login cannot modify state, and a deployed
// server must reject its hostile browser origin before auth processing.
const hostileMutation = await request("/api/auth/login", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: "https://smoke-attacker.invalid",
    "Sec-Fetch-Site": "cross-site",
  },
  body: JSON.stringify({}),
});
assert.equal(hostileMutation.status, 403, `cross-origin mutation returned ${hostileMutation.status}`);
const hostileBody = await readJson(hostileMutation, "cross-origin rejection");
assert.equal(hostileBody.code, "origin_rejected", "cross-origin mutation was not rejected by the origin guard");

console.log(`Smoke checks passed for ${base.origin}`);
console.log(`Environment: ${healthBody.env || "unknown"}; users present: ${authStatusBody.hasUsers}`);
