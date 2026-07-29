# Railway QA deployment and user-journey testing

Orizin has three complementary automated gates:

1. `.github/workflows/ci.yml` runs hermetic lint, API regressions, a build, and
   Playwright against a temporary SQLite database on every push and pull request.
2. `.github/workflows/railway-qa-journeys.yml` starts after Railway reports a
   successful QA deployment. It verifies the exact deployed commit, then walks
   anonymous, free, Voyager, admin, and mobile browser journeys.
3. `.github/workflows/deployed-smoke.yml` checks the live deployment every six
   hours without credentials or data changes.

## Domain contract

- Production web origin: `https://www.orizin.io` (Wix-managed domain).
- Persistent QA web origin: `https://orizin.app` (Cloudflare-managed domain).
- QA automation origin: `https://orizen-qa.up.railway.app` (Railway-managed
  domain). GitHub-hosted journeys use this direct origin to avoid Cloudflare
  bot/WAF rules; the legacy spelling in Railway's generated hostname is
  intentional.
- Resend sender domain: `orizin.app` in both QA and production. Production
  email must continue using an address such as `noreply@orizin.app`; the sender
  domain does not follow the production web origin.
- `APP_URL` is environment-specific because it controls links: use
  `https://www.orizin.io` in production and `https://orizin.app` in QA.

The persistent-QA workflow never resets the QA database. It creates accounts
under the reserved `qa-e2e-…@example.invalid` namespace, tests them, and removes
them in an `always()` cleanup step. A later run also garbage-collects reserved
accounts left behind if a prior runner was force-cancelled.

## 1. Configure Railway QA

Create a persistent Railway environment named `qa` (or set the GitHub variable
described below to its actual name) and give it:

- Its own volume mounted at `/data`; never share the production SQLite volume.
- A Railway-provided domain, even if QA also has a custom domain. Railway uses
  that domain when it creates PR environments.
- `APP_ENV=qa`.
- `SCREENER_INTANGIBLES_ENABLED=false` so QA never runs autonomous Gemini Lite scoring.
- `APP_URL` set to the QA origin.
- A QA-only `AUTH_SECRET` and `FIRST_ADMIN_SETUP_TOKEN`, both different from
  production.
- PayPal sandbox credentials only.
- `EMAIL_DISABLED=true` so test signups never consume email quota.
- `ENABLE_BACKGROUND_ENRICH=false` and a conservative `FMP_MAX_RPM` because QA
  and production can otherwise consume the Starter-plan allowance at once.
- Keep `GEMINI_CONTEXT_CACHE_NONPROD_ENABLED=false` so deployments and restarts
  do not create paid explicit-cache storage in the low-volume QA environment.
- Public signup enabled (omit `SIGNUPS_ENABLED`, or set it to `true`) so the free
  account journey represents the real product.

Create one dedicated QA automation administrator through the app. Do not reuse a
production account or production password. The workflow uses that account only
to create and remove disposable users; its credentials are injected only into
the provisioning and cleanup steps, not Playwright or uploaded artifacts.

In the Railway service's GitHub deploy settings, enable **Wait for CI**. Railway
will then wait for `.github/workflows/ci.yml` before starting a deployment. The
browser workflow is deliberately post-deploy: it needs the public QA URL to walk
the real service.

Railway setup references:

- [Persistent and PR environments](https://docs.railway.com/environments)
- [Preview deployments with PR environments](https://docs.railway.com/guides/preview-deployments-with-pr-environments)
- [Wait for CI on GitHub autodeploys](https://docs.railway.com/deployments/github-autodeploys)
- [Post-deploy GitHub Actions](https://docs.railway.com/guides/github-actions-post-deploy)

## 2. Configure GitHub

Railway creates a GitHub Environment for the QA service (currently `Orizin / qa`).
Restrict it to the protected branch Railway uses for persistent QA, then add
these environment secrets there:

| Secret | Value |
| --- | --- |
| `QA_E2E_ADMIN_EMAIL` | Dedicated QA automation admin login |
| `QA_E2E_ADMIN_PASSWORD` | That QA-only account's password |

The workflow uses `deployment: false` for this GitHub environment, so selecting
it does not create another deployment-status event and recursively trigger the
workflow.

Add these repository variables:

| Variable | Required | Value |
| --- | --- | --- |
| `QA_BASE_URL` | Yes | Stable QA origin and allowlisted destination for the QA automation credentials |
| `RAILWAY_QA_ENVIRONMENT` | Only for a custom name | Railway environment name if it is not `qa` |

Railway publishes a GitHub `deployment_status` event containing the environment,
URL, and commit. The workflow checks `/api/health` until both `APP_ENV=qa` and
`RAILWAY_GIT_COMMIT_SHA` match that event. This prevents an old container at a
stable hostname from receiving a false green result. Persistent role tests always
use `QA_BASE_URL`; a workflow-dispatch input can never redirect the dedicated QA
admin credential to another host.

## 3. Optional disposable PR-environment journey

The local CI suite already validates the blank-database/first-admin journey on
every change. It can also run against Railway's disposable PR environments,
where leaving the test admin and mutated strategy behind is safe because
Railway deletes the environment when the PR closes.

To opt in:

1. Enable PR environments in Railway, based on QA.
2. Confirm each preview receives a fresh isolated volume and inherits
   `APP_ENV=qa` plus the **QA-only** `FIRST_ADMIN_SETUP_TOKEN`.
3. Add environment secret `E2E_FIRST_ADMIN_SETUP_TOKEN` to `Orizin / qa`, with
   the same QA-only token. Never put the production setup token there.
5. Set repository variable `RAILWAY_PR_E2E_ENABLED=true`.
6. If Railway's preview environment names do not start with `pr-`, set
   `RAILWAY_PR_ENV_PREFIX` to their actual prefix.

Keep this opt-in limited to trusted repository contributors. Code running in a
preview can already read the variables inherited by that preview, so production
credentials must never be present there.

## 4. What each QA deployment walks

The persistent QA suite covers:

- Anonymous landing page, sign-in dialog, auth rejection, and environment label.
- Free signup, Deep Research, Portfolio, Strategies, the Ori upgrade gate, and
  self-service account deletion.
- Voyager login, strategy edit/persistence, and Ori access.
- Admin login, User Management, user-role visibility, and admin observability
  endpoints.
- A 390×844 mobile pass through primary navigation with an overflow check.

It intentionally does not:

- Trigger FMP universe refreshes or background enrichment.
- Complete a PayPal purchase.
- Send a Gemini request on every deployment.

Those exclusions keep deployments deterministic and protect paid quotas. API
regressions cover billing/webhook behavior in CI. To send one real Ori canary,
set `QA_BASE_URL`, manually run **Railway QA user journeys**, choose `qa`, and
enable `live_ai`.

## 5. Failure behavior and production promotion

A failed post-deploy journey turns the GitHub check red and retains screenshots,
video, and the HTML report for 14 days. It does not automatically roll Railway
back. To make QA a production gate, protect the production promotion branch and
require the `Railway QA user journeys / persistent-qa` check before merging or
promoting the tested commit.

Manual commands are also available:

```bash
E2E_BASE_URL=https://your-qa-domain \
QA_E2E_ADMIN_EMAIL=qa-automation@example.com \
QA_E2E_ADMIN_PASSWORD='...' \
npm run test:qa:provision

E2E_BASE_URL=https://your-qa-domain npm run test:e2e:deployed

E2E_BASE_URL=https://your-qa-domain \
QA_E2E_ADMIN_EMAIL=qa-automation@example.com \
QA_E2E_ADMIN_PASSWORD='...' \
npm run test:qa:cleanup
```

Run cleanup even if the browser command fails.
