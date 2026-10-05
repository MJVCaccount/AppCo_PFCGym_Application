# Deployment record

First production deploy of PFC Gym. Written 5 October 2026, Cape Town time (UTC+2). This file holds names, URLs and results only: no passwords, tokens, keys or connection strings. The step-by-step log is in [deployment-action-log.md](deployment-action-log.md).

## Addresses

| | |
|---|---|
| Production | https://pfc-gym.vercel.app (the Vercel-assigned name, no custom domain; publicly reachable) |
| Preview | No stable alias. Each preview deploy gets its own address behind Vercel login, e.g. https://pfc-ol78xbosh-mjani1419-1958.vercel.app |
| Vercel | project `pfc-gym`, Hobby plan, region `lhr1` (vercel.json), Node 24.x on Vercel (CI uses Node 20; both pass) |
| Database | Neon project `pfc-gym`, AWS eu-west-2 London. Branches: `production` (default), `dev`, `test` |

## Workflow runs

| Run | What | Result |
|---|---|---|
| [Deploy 37236614716](https://github.com/MJVCaccount/AppCo_PFCGym_Application/actions/runs/37236614716), attempt 1 | Merge of PR #2, secrets not set | Failed: empty token |
| same run, attempt 2 | After secrets were set | Failed: invalid token |
| same run, attempt 3 | After the token and variables were fixed; approved | Pull, build, migrate and deploy passed. Smoke failed: `/api/health/ready` returned 503 |
| [PR #10](https://github.com/MJVCaccount/AppCo_PFCGym_Application/pull/10) | `binaryTargets = ["native", "rhel-openssl-3.0.x"]` in prisma/schema.prisma | Merged as cda7f2b after 5 green checks |
| [CI 37245022511](https://github.com/MJVCaccount/AppCo_PFCGym_Application/actions/runs/37245022511) | CI on cda7f2b | Passed |
| [Deploy 37245151414](https://github.com/MJVCaccount/AppCo_PFCGym_Application/actions/runs/37245151414) | Production deploy of cda7f2b, approved | Passed, including smoke |
| [CI 37245771999](https://github.com/MJVCaccount/AppCo_PFCGym_Application/actions/runs/37245771999) | CI on the develop merge 44b7134 | Passed |
| [Deploy 37245921430](https://github.com/MJVCaccount/AppCo_PFCGym_Application/actions/runs/37245921430) | Preview deploy of 44b7134 | Attempt 1 failed at `vercel alias set` ("User not found"); attempt 2 passed after `PREVIEW_ALIAS` was removed |

### What went wrong on the way, and the fixes

1. **Prisma query engine.** The first production deploy built and migrated, but every query failed at runtime (`/` returned 500, `/api/health/ready` 503). Cause: the client was generated for `debian-openssl-3.0.x` on the build machine, while Vercel runs `rhel-openssl-3.0.x`. Fix: PR #10.
2. **Environment variables stored as Secret.** Variables added with the Vercel CLI default to type Secret, which `vercel pull` cannot return (it writes a placeholder). They were re-added as normal encrypted variables and checked with a pull.
3. **Deployment token.** The token in use has no user record, so `vercel whoami`, `vercel project ls` and `vercel alias set` fail with "User not found", while pull, build, deploy and the REST API work. Because of this the preview alias could not be used.

## What was set up (names only)

- **GitHub environment** `production`: one required reviewer, deployments limited to branch `main`, prevent self-review off.
- **GitHub secrets:** `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `PROD_DIRECT_URL`, `PREVIEW_DIRECT_URL`, `VERCEL_AUTOMATION_BYPASS_SECRET`.
- **GitHub variables:** none. `PREVIEW_ALIAS` was created and then removed (see Preview below).
- **Vercel, Production and Preview:** `SESSION_SECRET` (a different one per environment), `DATABASE_URL` (pooled), `DIRECT_URL`, `APP_URL`, `EMAIL_FROM`, `CONTACT_INBOX`, `RATE_LIMIT_MULTIPLIER`, `RESEND_API_KEY`. The Blob variables `PUBLIC_BLOB_STORE_ID`, `PRIVATE_BLOB_STORE_ID` and the two `*_BLOB_WEBHOOK_PUBLIC_KEY` already existed and were not touched.
- **Vercel Protection Bypass for Automation:** created, used by the smoke steps in `deploy.yml`.
- **Email:** Resend, sender `onboarding@resend.dev` (the domain is not verified), so mail is delivered only to the owner's address.
- **Database:** `prisma migrate deploy` applied the 5 migrations to the Neon production branch. Production was seeded once (3 plans, 6 programmes, 6 coaches, 20 classes, 24 filler members, 2 events) with two new private passwords chosen by the owner, different from the ones published in the README.

## Preview

- `PREVIEW_ALIAS` was removed because the deployment token has no user record (`vercel alias set` returns "User not found"). The workflow skips the alias step when the variable is empty and smoke-tests the deployment's own address instead.
- The Preview `APP_URL` still names the old alias (https://pfc-gym-preview-mjani.vercel.app), which does not exist. On a preview, POST routes would therefore fail the same-origin check. Previews are for the smoke test only.
- Previews are behind Vercel login (the per-deployment address answered 302 to Vercel Authentication with no auth header). They use the Neon `dev` branch, which still holds the demo accounts with the passwords published in the README, so previews must stay private.
- The preview was smoke-tested only on its per-deployment address, with the bypass header.
- **The alias was not verified.**

## Smoke test (`npm run smoke`)

| # | Check | Production (`--expect-seed`) | Preview (no `--expect-seed`) |
|---|---|---|---|
| 1a | `/api/health` is 200 | PASS | PASS |
| 1b | `/api/health/ready` is 200 (database reachable) | PASS | PASS |
| 2 | `/` is HTML with security headers and nonce CSP | PASS | PASS |
| 3 | Signed out, `/dashboard` `/bookings` `/admin` redirect to `/login?returnUrl=` | PASS | PASS |
| 4 | POST `/api/bookings` is 403 for a foreign or missing Origin | PASS | PASS |
| 5 | `/api/events` 200; production also has 6 programmes in `/api/classes` | PASS | PASS |
| 6 | `/reset-password/abc` is 200, no-referrer, no-store | PASS | PASS |
| 7 | `/no-such-page` is 404 with no stack trace | PASS | PASS |
| 8 | `http://` redirects to `https://` | PASS | PASS |

## Live check on production (headless Edge)

| Area | Result |
|---|---|
| Public pages `/ /classes /timetable /coaches /events /memberships /promo /contact /login /register /forgot-password` at 1280px and 390px | PASS: status 200, no console errors, no CSP violations, no horizontal scroll, no broken images (lazy images scrolled into view) |
| `/favicon.ico` | PASS (200) |
| Headers on `/` and `/reset-password/x` | PASS: CSP, HSTS, nosniff, frame protection, `no-store`; referrer policy `strict-origin-when-cross-origin` on `/` and `no-referrer` on the reset page |
| `http://` to `https://` | PASS (308) |
| Signed-out `/dashboard /bookings /admin /admin/members /coach/classes/1` | PASS: all go to `/login?returnUrl=` |
| Open-redirect probes `//evil.example`, `https://evil.example`, `/\evil.example` | PASS: all land on `/dashboard` on this site |
| Member | PASS: dashboard loads; booked "Elite Boxing 06:30" and cancelled it again; `/admin` goes to `/denied` |
| Fighter | PASS: dashboard loads; accepted the pending offer, then declined it. **The offer was left Declined.** |
| Coach (marcus@) | PASS: dashboard and roster open; `/admin` goes to `/denied`. Mark buttons are enabled for today's class (the rule is "date is today or earlier"). For a future date (2026-10-12) the page says the class has not happened yet and shows no Mark buttons. See "Not verified". |
| Admin | PASS: all 10 admin pages and the dashboard open, status 200, no console errors; no action buttons pressed |
| Published README demo passwords | PASS: all 5 accounts rejected them (one attempt each) |
| Speed (runs 2 to 4 of 4) | PASS: `/` TTFB 7-13 ms, load 584-710 ms; `/classes` load about 465 ms; `/timetable` about 440-510 ms; member `/dashboard` about 440-520 ms. Nothing over 3 seconds |
| Keyboard focus on `/login` fields | PASS: a visible outline on the email and password fields |
| Mobile menu at 390px | PASS: focus moves into the menu on open; Escape closes it and returns focus to the "Open menu" button |

15 sign-ins were used (limit 20), spaced at least 2 seconds apart. Production data changed by the check: one booking made and cancelled by the demo member, and the demo fighter's offer is now Declined.

## Not verified

- The preview alias (it does not exist).
- Same-origin POST routes on a preview (the Preview `APP_URL` names the missing alias).
- Disabled Mark buttons on a future roster with bookings: the only future roster seen was empty, so only the "not happened yet" notice was seen.
- Email delivery: no email was sent. The Resend key was checked read-only (a send-only key is rejected by the domains list, as expected) and the sender domain is not verified.
- File uploads, registration, forgot-password and the contact form on production (deliberately not exercised: production data).
- Behaviour of the sign-in rate limit under many assessors on one network (`RATE_LIMIT_MULTIPLIER` is 5; not load-tested).
- Whether `vercel whoami`-style commands could work with a different token type (not tried).
