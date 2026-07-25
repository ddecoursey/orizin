import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const action = process.argv[2];
const manifestPath = path.resolve(process.env.QA_E2E_MANIFEST || ".qa-e2e-users.json");
const reservedUser = /^qa-e2e-(free|pro|admin)-[a-z0-9-]+@example\.invalid$/;

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function deploymentOrigin() {
  const parsed = new URL(required("E2E_BASE_URL"));
  const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) {
    throw new Error("E2E_BASE_URL must use HTTPS unless it is localhost");
  }
  return parsed.origin;
}

function makePassword() {
  return `Qa!${crypto.randomBytes(18).toString("base64url")}`;
}

function makeManifest(baseUrl) {
  const run = `${process.env.GITHUB_RUN_ID || Date.now()}-${process.env.GITHUB_RUN_ATTEMPT || "1"}`;
  const suffix = crypto.randomBytes(4).toString("hex");
  const label = `${run}-${suffix}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const user = (role) => ({
    username: `qa-e2e-${role}-${label}@example.invalid`,
    password: makePassword(),
  });
  return {
    schemaVersion: 1,
    baseUrl,
    runLabel: label,
    users: {
      free: user("free"),
      pro: user("pro"),
      admin: user("admin"),
    },
  };
}

async function request(baseUrl, pathname, { method = "GET", cookie, body, allowed = [] } = {}) {
  const headers = {
    Accept: "application/json",
    Origin: baseUrl,
  };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(new URL(pathname, `${baseUrl}/`), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok && !allowed.includes(response.status)) {
    const detail = data?.error || `HTTP ${response.status}`;
    throw new Error(`${method} ${pathname} failed: ${detail}`);
  }
  return { response, data };
}

async function login(baseUrl, username, password) {
  const { response } = await request(baseUrl, "/api/auth/login", {
    method: "POST",
    body: { user: username, password },
  });
  const setCookies = response.headers.getSetCookie?.() || [response.headers.get("set-cookie")].filter(Boolean);
  const session = setCookies.find((value) => value.startsWith("orizin_auth="));
  if (!session) throw new Error("QA admin login succeeded without returning a session cookie");
  return session.split(";", 1)[0];
}

async function deleteUser(baseUrl, cookie, username) {
  await request(baseUrl, `/api/users/${encodeURIComponent(username)}`, {
    method: "DELETE",
    cookie,
    allowed: [404],
  });
}

async function garbageCollect(baseUrl, cookie, keep) {
  const { data } = await request(baseUrl, "/api/users", { cookie });
  const stale = (data?.users || [])
    .map((entry) => entry.username)
    .filter((username) => reservedUser.test(username) && !keep.has(username));
  for (const username of stale) await deleteUser(baseUrl, cookie, username);
  if (stale.length) console.log(`Removed ${stale.length} stale reserved QA test account(s)`);
}

function readManifest(baseUrl) {
  if (!fs.existsSync(manifestPath)) return null;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest?.schemaVersion !== 1 || !manifest.users) throw new Error("QA user manifest is invalid");
  if (manifest.baseUrl !== baseUrl) {
    throw new Error(`QA user manifest belongs to ${manifest.baseUrl}, not ${baseUrl}`);
  }
  for (const entry of Object.values(manifest.users)) {
    if (!reservedUser.test(entry?.username || "")) throw new Error("QA user manifest contains an unsafe username");
  }
  return manifest;
}

async function provision() {
  const baseUrl = deploymentOrigin();
  const adminEmail = required("QA_E2E_ADMIN_EMAIL");
  const adminPassword = required("QA_E2E_ADMIN_PASSWORD");
  const manifest = makeManifest(baseUrl);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

  const cookie = await login(baseUrl, adminEmail, adminPassword);
  const keep = new Set(Object.values(manifest.users).map((entry) => entry.username));
  await garbageCollect(baseUrl, cookie, keep);

  try {
    await request(baseUrl, "/api/users", {
      method: "POST",
      cookie,
      body: {
        username: manifest.users.pro.username,
        password: manifest.users.pro.password,
        isAdmin: false,
      },
    });
    await request(baseUrl, `/api/users/${encodeURIComponent(manifest.users.pro.username)}`, {
      method: "PATCH",
      cookie,
      body: { plan: "pro" },
    });
    await request(baseUrl, "/api/users", {
      method: "POST",
      cookie,
      body: {
        username: manifest.users.admin.username,
        password: manifest.users.admin.password,
        isAdmin: true,
      },
    });
  } catch (error) {
    for (const entry of Object.values(manifest.users).reverse()) {
      await deleteUser(baseUrl, cookie, entry.username).catch(() => {});
    }
    throw error;
  }

  console.log(`Provisioned disposable free, Voyager, and admin journeys for ${baseUrl}`);
}

async function cleanup() {
  const baseUrl = deploymentOrigin();
  const manifest = readManifest(baseUrl);
  if (!manifest) {
    console.log("No QA user manifest exists; cleanup has nothing to do");
    return;
  }

  const cookie = await login(
    baseUrl,
    required("QA_E2E_ADMIN_EMAIL"),
    required("QA_E2E_ADMIN_PASSWORD"),
  );
  const order = ["admin", "pro", "free"];
  for (const role of order) await deleteUser(baseUrl, cookie, manifest.users[role].username);
  fs.unlinkSync(manifestPath);
  console.log(`Removed all disposable QA journey accounts from ${baseUrl}`);
}

if (action === "provision") await provision();
else if (action === "cleanup") await cleanup();
else throw new Error("Usage: node scripts/qa-e2e-users.mjs <provision|cleanup>");
