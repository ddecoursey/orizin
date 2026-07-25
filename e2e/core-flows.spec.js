import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "e2e-admin@example.invalid";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "e2e-password-123";
const SETUP_TOKEN = process.env.E2E_FIRST_ADMIN_SETUP_TOKEN || "e2e-first-admin-setup-token-123456";

async function openSignIn(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in", exact: true }).first().click();
}

async function signIn(page) {
  await openSignIn(page);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await page.getByLabel("Username or email", { exact: true }).fill(ADMIN_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await expect(page.getByRole("button", { name: "Strategies", exact: true })).toBeVisible();
}

async function openStrategies(page) {
  await page.getByRole("button", { name: "Strategies", exact: true }).click();
  await expect(page).toHaveURL(/\?v=strategies$/);
}

test.describe.serial("production-critical browser flows", () => {
  test("first-run setup creates an authenticated admin session and is safe to rerun", async ({ page }) => {
    const statusResponse = await page.request.get("/api/auth/status");
    expect(statusResponse.ok()).toBeTruthy();
    const authStatus = await statusResponse.json();

    await openSignIn(page);
    if (authStatus.needsSetup) {
      await expect(page.getByRole("heading", { name: "Create the first admin account" })).toBeVisible();
      await page.getByLabel("Email", { exact: true }).fill(ADMIN_EMAIL);
      await page.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD);
      if (authStatus.setupTokenRequired) {
        await page.getByLabel("Deployment setup token", { exact: true }).fill(SETUP_TOKEN);
      }
      await page.getByRole("button", { name: "Create admin account" }).click();
    } else {
      await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
      await page.getByLabel("Username or email", { exact: true }).fill(ADMIN_EMAIL);
      await page.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD);
      await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
    }

    await expect(page.getByRole("button", { name: "Strategies", exact: true })).toBeVisible();
    await expect(page.getByText(/^qa$/i)).toBeVisible();
    await openStrategies(page);
    await expect(page.getByRole("button", { name: "New strategy" })).toBeVisible();
    if (authStatus.needsSetup) {
      await expect(page.getByRole("heading", { name: "Describe the behavior. Ori builds the machinery." })).toBeVisible();
    }

    await page.reload();
    await expect(page).toHaveURL(/\?v=strategies$/);
    await expect(page.getByRole("button", { name: "New strategy" })).toBeVisible();
  });

  test("a preset can be edited, monitored, and restored from server settings", async ({ page }) => {
    await signIn(page);
    await openStrategies(page);
    await page.getByRole("button", { name: "New strategy" }).click();

    const preset = page.getByRole("button").filter({
      has: page.getByRole("heading", { name: "Hedged Sector Rotator", exact: true }),
    });
    await preset.click();
    await expect(page.getByRole("heading", { name: "Hedged Sector Rotator", exact: true })).toBeVisible();
    await expect(page.getByText("Paper account", { exact: true })).toBeVisible();

    await page.getByTitle("Edit strategy").click();
    await page.getByLabel("Strategy name", { exact: true }).fill("Hedged Sector Rotator E2E");
    await page.getByLabel("Most holdings", { exact: true }).fill("7");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("heading", { name: "Hedged Sector Rotator E2E", exact: true })).toBeVisible();

    await expect.poll(async () => {
      const response = await page.request.get("/api/settings");
      const body = await response.json();
      return body.data?.strategies?.[0]?.name;
    }).toBe("Hedged Sector Rotator E2E");

    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("strategies:") || key.startsWith("activeStrategy:")) localStorage.removeItem(key);
      }
    });
    await page.reload();
    const restoredStrategy = page.getByRole("button", { name: /Hedged Sector Rotator E2E/ }).first();
    await expect(restoredStrategy).toBeVisible();
    await restoredStrategy.click();
    await expect(page.getByRole("heading", { name: "Hedged Sector Rotator E2E", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Monitor", exact: true }).click();
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Why log/ }).click();
    await expect(page.getByText("Monitoring started", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(page.getByRole("button", { name: "Monitor", exact: true })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTitle("Edit strategy").click();
    const safetyLimits = page.getByRole("heading", { name: "Safety limits" });
    await safetyLimits.scrollIntoViewIfNeeded();
    await expect(safetyLimits).toBeVisible();
    const box = await safetyLimits.locator("xpath=ancestor::section[1]").boundingBox();
    expect(box).not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(391);
    await expect(page.getByRole("spinbutton", { name: "Max per holding", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
  });

  test("logout revokes only that copied device session", async ({ page, browser, request }) => {
    await signIn(page);
    const otherContext = await browser.newContext();
    const otherPage = await otherContext.newPage();

    try {
      await signIn(otherPage);
      const authCookie = (await page.context().cookies()).find((cookie) => cookie.name === "orizin_auth");
      expect(authCookie).toBeTruthy();

      await page.getByTitle(new RegExp(`Signed in as ${ADMIN_EMAIL}`)).hover();
      await expect(page.getByRole("button", { name: "Logout", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Logout", exact: true }).click();
      await expect(page.getByRole("button", { name: "Sign in", exact: true }).first()).toBeVisible();

      const replay = await request.get("/api/auth/me", {
        headers: { Cookie: `${authCookie.name}=${authCookie.value}` },
      });
      expect(replay.status()).toBe(401);
      expect((await replay.json()).code).toBe("session_revoked");

      await otherPage.reload();
      await expect(otherPage.getByRole("button", { name: "Strategies", exact: true })).toBeVisible();
    } finally {
      await otherContext.close();
    }
  });
});
