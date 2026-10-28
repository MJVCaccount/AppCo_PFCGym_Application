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
| `HEALTH_TOKEN` | At least 32 random characters. Lets `GET /api/health/detail` answer (bearer token). The same value goes in the GitHub secret `HEALTH_TOKEN` for the monitor. Unset or shorter, the route answers 404 |
| `CRON_SECRET` | At least 32 random characters. Vercel Cron sends it as a bearer token to `GET /api/cron/maintenance`. Unset or shorter, the route answers 404 and the cron run shows as failed |
| `SECURITY_CONTACT` | Optional. Contact line of `/.well-known/security.txt`; falls back to `CONTACT_INBOX` |
| `EMAIL_SKIP` | Optional. Comma-separated addresses or domains that must never reach the provider. **Set in Production to exactly:** `member@pfc.co.za,fighter@pfc.co.za,marcus@pfc.co.za,sofia@pfc.co.za,admin@pfc.co.za`. See "Demo accounts and EMAIL_SKIP" below |
| `EMAIL_DAILY_CAP` | Optional. 1 to 100, default 90. Daily send limit of the email outbox |
| `SLOW_QUERY_MS` | Optional. Slow-query warning threshold, default 500 |
| `RATE_LIMIT_MULTIPLIER` | Optional. Whole number 1 to 20 (default 1; anything else is ignored). Multiplies every rate limit, for a busy day such as the EXPO when many people share one address. Takes effect on the next request; set it back to 1 afterwards |

Local only, never set in Vercel or GitHub: `TEST_DATABASE_URL`,
`PUBLIC_BLOB_READ_WRITE_TOKEN`, `PRIVATE_BLOB_READ_WRITE_TOKEN`,
`SEED_ALLOWED_HOSTS` (the Neon dev host) and `SEED_CONFIRM_HOST` (set for one
command only), and `SMOKE_BYPASS_SECRET`.

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
   `typecheck`, `build`, `test (20)`, `test (24)`, `audit` and `openapi`; block
   force pushes. The exact command is in
   [task3/branch-protection.md](task3/branch-protection.md).
6. Resend: add the DNS records for the domain in `EMAIL_FROM` and confirm it
   shows as verified.
7. Merge `deploy.yml` to `main` first (GitHub runs `workflow_run` workflows
   from the default branch), then push to `develop`.
8. Confirm the first push to `develop` produces **exactly one** preview
   deployment in Vercel. Two means `vercel.json` is not being read.
9. Approve the first production deployment when the `production` job waits.
10. Seed production once (next section), then run
    `npm run smoke -- https://<production domain> --expect-seed`.

## First run of the operator routes (do these in this order)

`HEALTH_TOKEN` and `CRON_SECRET` switch on three routes (`/api/health/detail`,
`/api/cron/maintenance`, `/api/cron/outbox`) and three workflows. Switched on in
the wrong order, the monitor opens an incident issue for something that is not
broken. Follow this order:

1. **Vercel, Production** (and Preview if they should run there): set `CRON_SECRET`
   and `HEALTH_TOKEN`, each at least 32 random characters, from stdin so the value
   never reaches shell history:
   `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))" | vercel env add CRON_SECRET production --no-sensitive`
2. **Deploy.** Environment variables are read at start-up; the routes answer 404
   until a deployment that has them.
3. **Call the maintenance route once, by hand, with the bearer token** (the value
   from step 1, in a variable, never typed into the command):
   ```bash
   curl -s -H "Authorization: Bearer $CRON_SECRET" https://<production domain>/api/cron/maintenance
   ```
   Expect `{"data":{... "failed":[]}}`. This writes the first `maintenance.run` audit
   row. Without it the monitor says "The maintenance job has never run." because the
   daily Vercel cron has not fired yet.
4. **Only then add `HEALTH_TOKEN` to GitHub** (Settings, Secrets and variables,
   Actions), together with the variable `PRODUCTION_URL` and the secret
   `CRON_SECRET` for the Outbox drain. Until step 4 the monitor checks readiness only.
5. Run the **Monitor** and **Outbox drain** workflows once from the Actions tab
   (Run workflow) and read their summaries. Then leave them to their schedules.
6. Run the **Rollback drill** once (it asks for the production approval).

If a workflow shows "Set the repository variable PRODUCTION_URL" or "Set the repository
secret CRON_SECRET", step 4 is not finished.

## Seeding production once

The seed creates demo accounts, for the module demonstration only. Their
passwords are published in the public README, so a hosted database must get
its own: `SEED_ADMIN_PASSWORD` and `SEED_DEMO_PASSWORD` are both required there
(at least 12 characters each, different from each other and from the published
ones) and the seed refuses without them. It also refuses any host that is not localhost, listed in
`SEED_ALLOWED_HOSTS` or named in `SEED_CONFIRM_HOST` (`prisma/seedGuard.ts`).
It also re-applies the demo passwords on every run, so never seed a database
real members use. To seed production once, after the
first deploy has applied the migrations, run this in PowerShell. It sets the
variables for this command only and removes them afterwards:

```powershell
$env:DATABASE_URL = "<production direct string>"; $env:DIRECT_URL = $env:DATABASE_URL; $env:SEED_CONFIRM_HOST = "<its host, no -pooler>"; $env:SEED_ADMIN_PASSWORD = "<a new admin password, 12+ characters>"; $env:SEED_DEMO_PASSWORD = "<a different password, 12+ characters>"; npx prisma db seed; Remove-Item Env:DATABASE_URL, Env:DIRECT_URL, Env:SEED_CONFIRM_HOST, Env:SEED_ADMIN_PASSWORD, Env:SEED_DEMO_PASSWORD
```

The seed prints only `Seeding <host>` and, when the passwords come from the
environment, `Using passwords from the environment`; never a password. Re-running
it re-applies the environment passwords. Afterwards, change or deactivate any
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

**Automatic.** The production deploy records the live deployment id first. If the
smoke test fails, `scripts/ci/vercel-rollback.mjs` promotes that deployment back through the
Vercel REST API, waits until the project reports it live, checks
`/api/health/ready` on the production domain, and the job then fails with a summary (open the
run's *Summary* tab). Check the summary says "rollback: success".

**By hand.** Vercel dashboard, Deployments: pick the last good deployment and choose
"Promote to Production". Or, from any machine with the token in the environment:

```bash
# VERCEL_TOKEN, VERCEL_PROJECT_ID, VERCEL_ORG_ID set for this shell only
node scripts/ci/vercel-rollback.mjs previous                # the id before the live one
node scripts/ci/vercel-rollback.mjs rollback <deployment id>
```

Do not use `vercel rollback` or `vercel promote` from the CLI in CI: the deployment token
has no user record and some CLI commands fail with "User not found".

**Rehearse it.** Actions, *Rollback drill*, Run workflow (the production reviewer approves).
It promotes the previous release, checks readiness, promotes the current release back and
checks again; production serves the older code for under a minute.

**Migrations are forward-only.** A rollback restores the previous code, not the previous
schema. That is safe because every migration must work with the release before it (the
rule above). To undo a schema change, ship a new migration that reverses it.

## Demo accounts and EMAIL_SKIP

The demo accounts use addresses that the sandbox sender cannot deliver to, so mail to them would only be refused by the provider and count against the daily limit. Skipped mail is not a failure: it is marked Skipped in the outbox, is never retried, and is not counted as pending or as a dead letter.

Set it in Vercel, Production (and Preview if it also sends mail), as a non-sensitive variable, then redeploy so it is read:

```bash
printf '%s' 'member@pfc.co.za,fighter@pfc.co.za,marcus@pfc.co.za,sofia@pfc.co.za,admin@pfc.co.za' | vercel env add EMAIL_SKIP production --no-sensitive
```

Entries are full addresses or domains, in any case, with spaces tolerated and empty entries ignored. A domain entry matches that domain exactly: `pfc.co.za` does not match `notpfc.co.za`, `pfc.co.za.evil.example` or `mail.pfc.co.za`. The address is never written to a log. To see what was skipped, read the `EmailOutbox` rows with status `Skipped` (their `lastError` says `Address is on the EMAIL_SKIP list.`); the health detail counts them under `outbox.skipped`, and the monitor ignores them.

## Email retries: when they actually happen

A failed email becomes **due** again after 5, 30, 120 and 360 minutes. Due means *may* be
retried, not *will be*. Retries happen:

1. at the **next email the app sends** (it drains up to two due rows on the way past);
2. **hourly** while the *Outbox drain* workflow runs (`GET /api/cron/outbox`, bearer
   `CRON_SECRET`). GitHub may delay a scheduled run or skip one when it is busy, and it
   **disables scheduled workflows after 60 days without repository activity**: a commit,
   issue or pull request re-enables them, or press *Enable workflow* on the Actions tab;
3. **at least once a day** through the Vercel cron (`GET /api/cron/maintenance`, 03:00 UTC).

A refusal the provider says is permanent (an HTTP 4xx other than 408 and 429) is not retried:
it is parked as a dead letter at once with its reason. An address ending `.invalid` (the demo
accounts use them) is skipped without calling the provider. Sending stops at the daily cap
(`EMAIL_DAILY_CAP`, default 90) and resumes the next UTC day.

## Monitoring and incidents

`.github/workflows/monitor.yml` runs every 15 minutes. It needs the repository variable
`PRODUCTION_URL` (for example `https://pfc-gym.vercel.app`) and, for the deeper checks, the
secret `HEALTH_TOKEN` (and `VERCEL_AUTOMATION_BYPASS_SECRET` if Deployment Protection is on).

It checks readiness (one retry, slower than 3 s counts) and, with the token, `/api/health/detail`:

| Alarm | Threshold |
| --- | --- |
| Migration expected by this release but not applied | any |
| Database size | over 400 MB (Neon free is 0.5 GB) |
| Database latency | over 1500 ms |
| Emails parked as dead in the last 24 hours | more than 3 (one bad address is not an incident) |
| Emails waiting | over 20 |
| Emails sent in 24 h | over 95 (Resend free is 100 a day) |
| Email not configured | yes |
| Maintenance job last ran | more than 36 hours ago |

**The incident issue.** On the first failure it opens one GitHub issue titled "Production
incident: monitor checks failing" with the label `incident`. While the list of problems
changes it edits the issue and adds a comment; an unchanged problem does not add noise.
When everything passes again it comments "Recovered" and closes the issue. GitHub emails
anyone watching the repository about the issue (Settings, Notifications). The run itself
also shows red while production is unhealthy.

**First response.** Open the issue, then the latest *Monitor* run. For a readiness failure
open the Vercel deployment logs (filter by the request id from a failing call) and Neon's
dashboard. For a dead letter read `lastError` in the `EmailOutbox` table (it starts with the provider's HTTP status; a 4xx other than 408 and 429 means the provider refused the message for good, so fix the address, the verified domain or the key, not the retry) (no body is kept
for sent mail, the failed ones keep it) and fix the cause (the verified domain, the API
key); a dead letter is not retried, re-queue by setting its `status` back to `Pending`.
For the maintenance alarm check the cron run in Vercel and that `CRON_SECRET` is set.

**Slow queries.** Search the Vercel logs for `Slow query`: it names the model and the
operation and carries the request id.

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
| `npm run db:reset` stops with a safety message | Prisma refuses `migrate reset` when it is not run interactively | Run it yourself in a normal terminal |
