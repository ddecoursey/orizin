const configuredUrl = process.env.E2E_BASE_URL || process.env.SMOKE_BASE_URL;
if (!configuredUrl) {
  throw new Error("Set E2E_BASE_URL (or SMOKE_BASE_URL) to the Railway deployment origin");
}

const target = new URL(configuredUrl);
const local = ["localhost", "127.0.0.1", "::1"].includes(target.hostname);
if (target.protocol !== "https:" && !(local && target.protocol === "http:")) {
  throw new Error("The deployment target must use HTTPS unless it is localhost");
}
target.pathname = "/";
target.search = "";
target.hash = "";

const expectedSha = String(process.env.E2E_EXPECTED_SHA || "").trim();
const expectedEnv = String(process.env.E2E_EXPECTED_ENV || "").trim();
const timeoutMs = Math.max(10_000, Math.min(15 * 60_000, Number(process.env.DEPLOY_WAIT_TIMEOUT_MS) || 5 * 60_000));
const pollMs = Math.max(1_000, Math.min(15_000, Number(process.env.DEPLOY_WAIT_POLL_MS) || 5_000));
const deadline = Date.now() + timeoutMs;
let lastReason = "deployment has not answered yet";

function shaMatches(actual, expected) {
  if (!expected) return true;
  if (!actual) return false;
  return actual === expected || actual.startsWith(expected) || expected.startsWith(actual);
}

while (Date.now() < deadline) {
  try {
    const response = await fetch(new URL("/api/health", target), {
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: "application/json" },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.ok !== true) {
      lastReason = `health returned HTTP ${response.status}`;
    } else if (expectedEnv && body.env !== expectedEnv) {
      lastReason = `health reported environment ${body.env || "unknown"} instead of ${expectedEnv}`;
    } else if (!shaMatches(body.deploymentSha, expectedSha)) {
      lastReason = `health reported commit ${body.deploymentSha || "unknown"} instead of ${expectedSha}`;
    } else {
      console.log(`Railway deployment is ready at ${target.origin}`);
      console.log(`Environment: ${body.env || "unknown"}; commit: ${body.deploymentSha || "not reported"}`);
      process.exit(0);
    }
  } catch (error) {
    lastReason = error?.name === "TimeoutError" ? "health request timed out" : (error?.message || "health request failed");
  }

  await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, Math.max(0, deadline - Date.now()))));
}

throw new Error(`Railway deployment did not become ready within ${Math.round(timeoutMs / 1000)}s: ${lastReason}`);
