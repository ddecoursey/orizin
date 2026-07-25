import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDirectory = mkdtempSync(path.join(tmpdir(), "orizin-e2e-"));
const port = String(Number(process.env.E2E_PORT) || 4187);
let stopping = false;

const child = spawn(process.execPath, [path.join(root, "server", "index.js")], {
  cwd: root,
  env: {
    ...process.env,
    PORT: port,
    DB_PATH: path.join(tempDirectory, "screener.db"),
    NODE_ENV: "production",
    APP_ENV: "qa",
    RAILWAY_ENVIRONMENT: "",
    RAILWAY_PROJECT_ID: "",
    RAILWAY_VOLUME_MOUNT_PATH: "",
    AUTH_PASSWORD: "",
    AUTH_USERS_JSON: "",
    AUTH_SECRET: "e2e-only-session-secret-not-used-in-production",
    FIRST_ADMIN_SETUP_TOKEN: "e2e-first-admin-setup-token-123456",
    FMP_API_KEY: "",
    GEMINI_API_KEY: "",
    GEMINI_API_KEY_BACKUP: "",
    PAYPAL_ENV: "sandbox",
    PAYPAL_CLIENT_ID: "",
    PAYPAL_SECRET: "",
    PAYPAL_PLAN_ID: "",
    PAYPAL_WEBHOOK_ID: "",
    RESEND_API_KEY: "",
    SENDGRID_API_KEY: "",
    EMAIL_DISABLED: "true",
    ENABLE_BACKGROUND_ENRICH: "false",
    SCREENER_INTANGIBLES_ENABLED: "false",
    APP_URL: "https://e2e.orizin.invalid",
  },
  stdio: "inherit",
});

function cleanUp() {
  rmSync(tempDirectory, { recursive: true, force: true });
}

function stop() {
  if (stopping) return;
  stopping = true;
  child.kill("SIGTERM");
  setTimeout(() => child.kill("SIGKILL"), 6_000).unref();
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);

child.on("exit", (code, signal) => {
  cleanUp();
  if (!stopping) {
    console.error(`[e2e] server exited unexpectedly (${signal || code})`);
    process.exit(code === 0 ? 1 : (code || 1));
  }
  process.exit(0);
});

child.on("error", (error) => {
  console.error(`[e2e] failed to start server: ${error.message}`);
  cleanUp();
  process.exit(1);
});
