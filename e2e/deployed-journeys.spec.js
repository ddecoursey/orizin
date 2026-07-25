import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";

const manifestPath = path.resolve(process.env.QA_E2E_MANIFEST || ".qa-e2e-users.json");
if (!fs.existsSync(manifestPath)) {
  throw new Error(`Disposable QA users were not provisioned; missing ${manifestPath}`);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const { free, pro, admin } = manifest.users || {};
const liveAi = process.env.QA_E2E_LIVE_AI === "true";

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function signIn(page, account) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await page.getByLabel("Username or email", { exact: true }).fill(account.username);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await expect(page.getByRole("button", { name: "Strategies", exact: true })).toBeVisible();
  await expect(page.getByText(/^qa$/i).first()).toBeVisible();
}

async function openAccountMenu(page, account) {
  // This menu is intentionally hover-first. A synthetic mouse click enters the
  // trigger (opening it) and then toggles it closed, so hover matches desktop use.
  await page.getByTitle(new RegExp(`^Signed in as ${escapeRegex(account.username)}`)).hover();
}

async function launchOri(page) {
  const launcher = page.getByRole("button", { name: "Ask Ori — open the AI chat" });
  await expect(launcher).toBeAttached();
  // The launcher enters from orbit and then floats forever. Dispatching the
  // same click event a browser emits avoids treating that movement as a failure.
  await launcher.dispatchEvent("click");
}

test.describe("Railway QA deployed user journeys", () => {
  test("anonymous visitor reaches the landing and authentication surfaces", async ({ page, request }) => {
    const health = await request.get("/api/health");
    expect(health.ok()).toBeTruthy();
    const healthBody = await health.json();
    expect(healthBody).toMatchObject({ ok: true, env: "qa" });

    const anonymous = await request.get("/api/auth/me");
    expect(anonymous.status()).toBe(401);

    await page.goto("/");
    await expect(page).toHaveTitle(/Orizin/);
    await expect(page.getByRole("heading", { name: /Find stocks worth owning/ })).toBeVisible();
    await page.getByRole("button", { name: "Sign in", exact: true }).first().click();
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in", exact: true }).last()).toBeDisabled();
  });

  test("free traveler signs up, explores every core surface, sees the Ori gate, and deletes the account", async ({ page }) => {
    let signedUp = false;
    try {
      await page.goto("/");
      await page.getByRole("button", { name: /Get started free/ }).first().click();
      await expect(page.getByRole("heading", { name: "Create your free account" })).toBeVisible();
      await page.getByLabel("Email", { exact: true }).fill(free.username);
      await page.getByLabel("Password", { exact: true }).fill(free.password);
      await page.getByLabel("Confirm password", { exact: true }).fill(free.password);
      await page.getByRole("button", { name: "Create free account" }).click();
      signedUp = true;

      await expect(page.getByRole("button", { name: "Strategies", exact: true })).toBeVisible();
      const me = await page.request.get("/api/auth/me");
      expect(me.ok()).toBeTruthy();
      expect(await me.json()).toMatchObject({ user: free.username, plan: "free", isAdmin: false });

      await page.getByRole("button", { name: "Deep Research", exact: true }).click();
      await expect(page).toHaveURL(/\?v=deep-research$/);
      await expect(page.locator("p").filter({ hasText: /^Deep Research$/ })).toBeVisible();

      await page.getByRole("button", { name: "Portfolio", exact: true }).click();
      await expect(page).toHaveURL(/\?v=portfolio-goals$/);
      await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Strategies", exact: true }).click();
      await expect(page).toHaveURL(/\?v=strategies$/);
      await expect(page.getByRole("heading", { name: "Describe the behavior. Ori builds the machinery." })).toBeVisible();

      await page.getByRole("button", { name: "Screener", exact: true }).click();
      await launchOri(page);
      await expect(page.getByText("Unlock Ori as a Voyager", { exact: true })).toBeVisible();

      await openAccountMenu(page, free);
      await page.getByRole("button", { name: "Account settings", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Account Settings" })).toBeVisible();
      page.once("dialog", (dialog) => dialog.accept());
      await page.getByRole("button", { name: "Delete my account" }).click();
      await expect(page.getByRole("button", { name: "Sign in", exact: true }).first()).toBeVisible();
      expect((await page.request.get("/api/auth/me")).status()).toBe(401);
      signedUp = false;
    } finally {
      // Workflow cleanup is the final backstop. This immediate cleanup keeps a
      // failed free-user assertion from affecting a retry or a manual rerun.
      if (signedUp) {
        const me = await page.request.get("/api/auth/me").catch(() => null);
        if (me?.ok()) await page.request.delete("/api/users/me").catch(() => {});
      }
    }
  });

  test("Voyager persists a strategy, opens Ori, and traverses the mobile layout", async ({ page }) => {
    if (liveAi) test.setTimeout(240_000);
    await signIn(page, pro);

    const me = await page.request.get("/api/auth/me");
    expect(me.ok()).toBeTruthy();
    expect(await me.json()).toMatchObject({ user: pro.username, plan: "pro", isAdmin: false });

    await page.getByRole("button", { name: "Strategies", exact: true }).click();
    const preset = page.getByRole("button").filter({
      has: page.getByRole("heading", { name: "Hedged Sector Rotator", exact: true }),
    });
    await preset.click();
    await page.getByTitle("Edit strategy").click();
    const strategyName = `Railway QA ${manifest.runLabel}`.slice(0, 60);
    await page.getByLabel("Strategy name", { exact: true }).fill(strategyName);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("heading", { name: strategyName, exact: true })).toBeVisible();
    await expect.poll(async () => {
      const response = await page.request.get("/api/settings");
      const body = await response.json();
      return body.data?.strategies?.some((strategy) => strategy.name === strategyName);
    }).toBe(true);

    await page.getByRole("button", { name: "Screener", exact: true }).click();
    await launchOri(page);
    await expect(page.getByText("Ori — Stock Analyst", { exact: true })).toBeVisible();
    const input = page.getByPlaceholder("Ask about your stocks…");
    await expect(input).toBeEnabled();

    // Live Gemini calls are opt-in so ordinary QA deploys remain deterministic
    // and do not consume paid quota. A manual workflow run can enable the canary.
    if (liveAi) {
      // Ask for live data so this exercises the Gemini function-tool request
      // shape and FMP MCP loop, not only an ordinary cached chat response.
      const prompt = `Railway QA canary ${manifest.runLabel}: what is AAPL's current stock price? Reply briefly.`;
      await input.fill(prompt);
      await input.press("Enter");
      const userMessage = page.getByText(prompt, { exact: true });
      await expect(userMessage).toBeVisible();
      const userRow = userMessage.locator("xpath=ancestor::div[contains(@class,'justify-end')][1]");
      const assistantRow = userRow.locator("xpath=following-sibling::div[contains(@class,'justify-start')][1]");
      await expect(assistantRow.locator("p").first()).toHaveText(/\S+/, { timeout: 180_000 });
      await expect(assistantRow).not.toContainText(
        /Gemini API error|CachedContent can not be used|INVALID_ARGUMENT/i,
      );
    }

    await page.getByTitle("Close", { exact: true }).click();
    await expect(input).toBeHidden();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(page.getByRole("button", { name: "Strategies", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Portfolio", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Strategies", exact: true }).click();
    await expect(page).toHaveURL(/\?v=strategies$/);
    await expect(page.getByRole("button", { name: "New strategy" })).toBeVisible();
    const dimensions = await page.evaluate(() => ({
      viewport: window.innerWidth,
      page: document.documentElement.scrollWidth,
    }));
    expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport + 1);
  });

  test("admin signs in and reaches user management and observability APIs", async ({ page }) => {
    await signIn(page, admin);

    const me = await page.request.get("/api/auth/me");
    expect(me.ok()).toBeTruthy();
    expect(await me.json()).toMatchObject({ user: admin.username, isAdmin: true });

    await openAccountMenu(page, admin);
    await page.getByRole("button", { name: "User management", exact: true }).click();
    await expect(page.getByRole("heading", { name: "User Management" })).toBeVisible();
    await expect(page.getByText(pro.username, { exact: true }).first()).toBeVisible();
    await expect(page.getByText(admin.username, { exact: true }).first()).toBeVisible();

    const usersResponse = await page.request.get("/api/users");
    expect(usersResponse.ok()).toBeTruthy();
    const users = (await usersResponse.json()).users;
    expect(users.some((user) => user.username === pro.username && user.plan === "pro")).toBeTruthy();
    expect(users.some((user) => user.username === admin.username && user.is_admin)).toBeTruthy();
    expect((await page.request.get("/api/debug/fmp-stats")).ok()).toBeTruthy();
  });

});
