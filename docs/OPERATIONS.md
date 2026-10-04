# Operations

How the PFC app is deployed and run. Everything here comes from the repository
(`.github/workflows/`, `.env.example`, `vercel.json`, `README.md`, `prisma/`,
`scripts/`). Where a value is not in the repository (the production URL, the
Neon host names), this document says so instead of guessing.

## Environments

| Environment | Branch | Deployed by | Database | App address |
| --- | --- | --- | --- | --- |
| Local | any | `npm run dev` | Your `.env`: the Neon dev branch, or a local Postgres | `http://localhost:3000` |
| Preview | `develop` | `deploy.yml`, job `preview` | Neon **dev** branch (`PREVIEW_DIRECT_URL` for migrations) | The repository variable `PREVIEW_ALIAS` (a `*.vercel.app` name) when set; otherwise each deployment's own URL |
| Production | `main` | `deploy.yml`, job `production`, after a reviewer approves | Neon **main** branch (`PROD_DIRECT_URL` for migrations) | Your production domain: set it as `APP_URL` in Vercel's Production environment (not stored in the repository) |
| Test (CI) | pull requests, pushes | `ci.yml`, job `test` | A throwaway `postgres:16` container | none |
| Test (local) | n/a | `npm test` | `TEST_DATABASE_URL` in `.env`: a Neon `test` branch or local Postgres. The tests empty every table | none |

Vercel's own Git integration is off (`vercel.json`: `git.deploymentEnabled`
is `false`). Functions run in `lhr1` (London), next to the Neon project. GitHub
Actions is the only thing that ships code, and only after `ci.yml` has passed
for the push.

## Secrets, variables and environment variables, by scope

### GitHub, Settings, Secrets and variables, Actions: secrets

| Name | Used by | Value |
| --- | --- | --- |
| `VERCEL_TOKEN` | `deploy.yml` (every Vercel CLI step) | A Vercel access token |
| `VERCEL_ORG_ID` | `deploy.yml` (job-wide env) | `orgId` in `.vercel/project.json` after `vercel link` |
| `VERCEL_PROJECT_ID` | `deploy.yml` (job-wide env) | `projectId` in the same file |
| `PROD_DIRECT_URL` | `deploy.yml`, production migration step | Neon `main` **direct** (non-pooled) connection string |
| `PREVIEW_DIRECT_URL` | `deploy.yml`, preview migration step | Neon `dev` **direct** connection string |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | `deploy.yml`, smoke steps (optional) | Vercel's "Protection Bypass for Automation" secret; only needed if Deployment Protection is on |

`ci.yml` uses no secrets: its values are placeholders written in the file.

### GitHub: variables

| Name | Used by | Value |
| --- | --- | --- |
| `PREVIEW_ALIAS` | `deploy.yml`, preview job (optional) | A `*.vercel.app` name, e.g. `pfc-gym-preview.vercel.app`. **Must equal `APP_URL` in Vercel's Preview environment.** When unset, no alias is made and the smoke test uses the deployment's own URL |

### GitHub: Environments

- `production`: add yourself or Brandon as a required reviewer, so a
  production deploy waits for an approval click.

### Vercel, Project, Settings, Environment Variables

Set each for **Production** and **Preview** separately (they point at
different databases). The list is `.env.example`:

| Name | Purpose |
| --- | --- |
| `SESSION_SECRET` | Signs the session cookie; at least 32 characters, different per environment |
| `DATABASE_URL` | Pooled Neon string (host contains `-pooler`), used by the running app |
| `DIRECT_URL` | Direct Neon string, used by `prisma migrate` |
| `APP_URL` | Public base URL, `https://`, no trailing slash. Used for links in emails **and** by the same-origin check on the JSON API |
| `RESEND_API_KEY`, `EMAIL_FROM`, `CONTACT_INBOX` | Email. Without the first two no email is sent and the app keeps working |
| `PUBLIC_BLOB_STORE_ID`, `PRIVATE_BLOB_STORE_ID` | The two Vercel Blob stores (images; fighters' documents) |
| `CSP_REPORT_ONLY` | Optional. `1` sends the Content-Security-Policy as report-only |

Local only, never set in Vercel or GitHub: `TEST_DATABASE_URL`,
`PUBLIC_BLOB_READ_WRITE_TOKEN`, `PRIVATE_BLOB_READ_WRITE_TOKEN`,
`SEED_ALLOWED_HOSTS` (the Neon dev host) and `SEED_CONFIRM_HOST` (set for one
command only).

## First-deploy checklist

1. Vercel: create the project, run `vercel link` locally once, and copy the
   two ids from `.vercel/project.json` into the GitHub secrets
   `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`. Confirm `.vercel` is not committed
   (it is in `.gitignore`).
2. Create `VERCEL_TOKEN`, `PROD_DIRECT_URL` and `PREVIEW_DIRECT_URL` as GitHub
   secrets. Set the GitHub variable `PREVIEW_ALIAS`.
3. Set every Vercel environment variable above for Production and Preview.
   `APP_URL` for Preview equals `PREVIEW_ALIAS` with `https://` in front.
4. Create the `production` GitHub Environment with a required reviewer.
5. Protect `main` and `develop`: require pull requests and the checks `lint`,
   `typecheck`, `build`, `test` and `audit`; block force pushes.
6. Resend: add the DNS records for the domain in `EMAIL_FROM` and confirm it
   shows as verified.
7. Merge `deploy.yml` to `main` first (GitHub runs `workflow_run` workflows
   from the default branch), then push to `develop`.
8. Confirm the first push to `develop` produces **exactly one** preview
   deployment in Vercel. Two means `vercel.json` is not being read.
9. Approve the first production deployment when the `production` job waits.
10. Seed production once (next section), then run
    `npm run smoke -- https://<production domain> --expect-seed`.

## Seeding production once

The seed creates demo accounts with known passwords, so it refuses any host
that is not localhost, listed in `SEED_ALLOWED_HOSTS` or named in
`SEED_CONFIRM_HOST` (`prisma/seedGuard.ts`). To seed production once, after the
first deploy has applied the migrations, run this in PowerShell. It sets the
variables for this command only and removes them afterwards:

```powershell
$env:DATABASE_URL = "<production direct string>"; $env:DIRECT_URL = $env:DATABASE_URL; $env:SEED_CONFIRM_HOST = "<its host, no -pooler>"; npx prisma db seed; Remove-Item Env:DATABASE_URL, Env:DIRECT_URL, Env:SEED_CONFIRM_HOST
```

The seed prints only `Seeding <host>`. Afterwards, change or deactivate any
demo account you do not want on a public site.

## Releasing from develop to main

1. Open a pull request from `develop` to `main`. CI must be green
   (`lint`, `typecheck`, `build`, `test`, `audit`).
2. Merge it. CI runs again on the push to `main`; when it passes, `deploy.yml`
   starts the `production` job.
3. The job waits for the required reviewer on the `production` environment.
   Approve it in the Actions run.
4. The job pulls the production settings, builds, applies migrations with
   `prisma migrate deploy` (**before** the new code is live), deploys, and then
   smoke-tests `/api/health/ready`.
5. Optionally run the fuller check: `npm run smoke -- https://<production domain>`.

Every migration must be backward compatible with the previous release: add a
column (nullable or with a default) in one release and start using it in the
next; stop using a column in one release and drop it in the one after.

## Rollback

Vercel dashboard, Deployments: pick the last good deployment and choose
"Promote to Production" (or `vercel rollback`). That restores the previous
code in seconds. Migrations only move forward and are not undone, which is why
the rule above matters. To undo a schema change, ship a new migration that
reverses it.

## EXPO-day checklist

- **Warm up.** The app runs on serverless functions, so the first request after
  a quiet spell is slower. Load `/`, `/classes`, `/timetable`, a signed-in
  `/dashboard` and `/admin` a few minutes before the doors open.
- **Run the smoke test** against production the evening before and again that
  morning: `npm run smoke -- https://<production domain> --expect-seed`.
- **Email.** Resend's free tier has a daily sending cap (see
  `docs/task3/running-costs.md` for the figure fetched on the day it was
  written, and check Resend's dashboard). A welcome email goes out per
  registration and a confirmation per booking, so a busy demo can reach it;
  emails past the cap fail without breaking the app (the failure is logged).
- **Demo accounts.** The seed creates the accounts in the README's table, plus
  a fighter (`fighter@pfc.co.za`) used by the tests. Sign in as each role the
  day before to confirm they work. Do not hand out an admin password.
- **Rate limits and a shared network.** Everyone at the venue shares one public
  address, and several limits count per address (`src/lib/rateLimit.ts`):
  register 5 per hour, forgot-password 3 per hour, contact form 5 per hour,
  reset-password 10 per hour, sign-in 30 per 15 minutes. A crowd registering
  from the venue Wi-Fi will hit the register limit and see "Too many attempts".
  Sign-in per account is 5 per 15 minutes, and a successful sign-in clears
  that count. To reset all counters in an emergency, run this in the Neon SQL
  editor for the production branch: `DELETE FROM "RateLimitBucket";`
  Demonstrate sign-up from a phone on mobile data instead, or pre-register
  attendees.
- Have the rollback steps above open in a tab.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Smoke test step fails with **401** | Vercel Deployment Protection is blocking the request | Create "Protection Bypass for Automation" in Vercel, store it as the GitHub secret `VERCEL_AUTOMATION_BYPASS_SECRET` (the workflow sends it as `x-vercel-protection-bypass`). For `npm run smoke`, set `SMOKE_BYPASS_SECRET` in your shell |
| **403** `Cross-origin requests are not allowed.` on uploads, bookings or any admin API call | The browser's `Origin` host does not match the host of `APP_URL` | Set `APP_URL` in that Vercel environment to the exact address people use (`https://`, no trailing slash, same host and port). For Preview, set it to the alias and set `PREVIEW_ALIAS` to match. Redeploy |
| "Too many attempts. Try again in N minutes." | A rate limit (see the EXPO section) | Wait for the window, or delete the rows in `RateLimitBucket`. If it appears for everyone at once, the database may be unreachable: sign-in and password forms fail closed, so check `/api/health/ready` and the Neon status |
| Build fails: `SESSION_SECRET must be set ...` or `APP_URL must be set in production` / `must start with https://` | A missing or invalid variable in the Vercel environment being built | Set it for that environment (Production or Preview) and redeploy. See the table above |
| `Apply database migrations` step fails in the deploy job | A migration error, or `PROD_DIRECT_URL` / `PREVIEW_DIRECT_URL` is wrong or points at the pooled host | Read the Prisma error in the log. Use the **direct** string, not the `-pooler` one. Fix forward with a new migration; a migration that partly applied needs `prisma migrate resolve` by hand. Nothing was deployed, so the live site is unchanged |
| A page looks broken and the browser console says a script or style was blocked by Content-Security-Policy | The policy in `src/lib/csp.ts` blocks something a page needs | Set `CSP_REPORT_ONLY=1` for that Vercel environment and redeploy: violations are logged, nothing is blocked. Fix the cause (usually something that needs a nonce), then remove the variable |
| `npm run db:seed` says `Refusing to seed "<host>"` | The host is not localhost, not in `SEED_ALLOWED_HOSTS`, not `SEED_CONFIRM_HOST` | Intended. Add the dev host to `SEED_ALLOWED_HOSTS` in `.env`, or use the one-off production command above |
| `npm run db:reset` stops with "invoked by Claude Code" | Prisma blocks `migrate reset` when an AI agent runs it | Run it yourself in a normal terminal |
