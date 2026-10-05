# Deployment action log

Times are Cape Town (UTC+2), 2026-10-05, taken from GitHub and git timestamps (seed time approximate). Entries marked "(earlier)" were written up afterwards from the session and carry no clock time. No values, passwords, tokens or connection strings appear here.

## Before the transparency rules (reconstructed from the session)

### (earlier) Tools and logins
- What: installed GitHub CLI (winget) and downloaded neonctl 8.0.7 (npx). User logged in to gh and neonctl.
- Touches: local only.
### (earlier) GitHub production environment
- What: required reviewer = repo owner, deployment branches = main only, prevent self-review off.
- Command: `gh api -X PUT repos/<repo>/environments/production --input <file>` and `.../deployment-branch-policies`
- Touches: GitHub.
### (earlier) GitHub secrets and variable
- What: set secrets VERCEL_ORG_ID, VERCEL_PROJECT_ID, PROD_DIRECT_URL, PREVIEW_DIRECT_URL (values via stdin); variable PREVIEW_ALIAS.
- Touches: GitHub.
### (earlier) Vercel env vars (first set)
- What: Production and Preview SESSION_SECRET, DATABASE_URL, DIRECT_URL, APP_URL, EMAIL_FROM, CONTACT_INBOX, RATE_LIMIT_MULTIPLIER via `vercel env add NAME <env>` (stdin).
- Result: stored as type Secret, which `vercel pull` cannot return. Replaced later.
- Touches: Vercel.
### (earlier) Protection Bypass for Automation
- What: created through the Vercel API (PATCH protection-bypass), stored as GitHub secret VERCEL_AUTOMATION_BYPASS_SECRET. First attempt (48 chars) rejected, second (32 chars) accepted. Also re-set the four secrets above without trailing newlines.
- Touches: Vercel, GitHub.
### (earlier) RESEND_API_KEY
- What: set for Production and Preview via stdin after a read-only key check (GET /domains returned 401 "restricted to sending", meaning valid).
- Touches: Vercel.
### (earlier) Deploy run 37236614716 re-run (attempt 2), failed
- Result: vercel pull rejected the old VERCEL_TOKEN.
### (earlier) VERCEL_TOKEN replaced, env vars re-added as non-sensitive
- What: new token set as GitHub secret VERCEL_TOKEN (printf, no newline). The 8 Production and 8 Preview variables re-added with `vercel env add NAME <env> --force --no-sensitive`. Verified by `vercel pull` in a temp folder (no placeholders); temp folder deleted.
- Touches: GitHub, Vercel.
### (earlier) Deploy run 37236614716 re-run (attempt 3), approved by the user
- Result: pull, build, `prisma migrate deploy` (production database, 5 migrations) and deploy passed. Smoke failed: /api/health/ready returned 503. Runtime logs: Prisma query engine for rhel-openssl-3.0.x not found.
- Touches: Neon production (migrations), Vercel.

## After the transparency rules
### 01:44  Schema change and local checks
- What: added `binaryTargets = ["native", "rhel-openssl-3.0.x"]` to the generator client block in prisma/schema.prisma. Ran prisma generate, typecheck, lint, build, and npm test against a throwaway Postgres 16 container.
- Why: production runtime logs showed the Prisma query engine for rhel-openssl-3.0.x missing.
- Command: `npx prisma generate; npm run typecheck; npm run lint; npm run build; docker run ... postgres:16 (port 54329); npx prisma migrate deploy; npm test; docker rm -f <container>`
- Touches: local only.
- Result: engine file libquery_engine-rhel-openssl-3.0.x.so.node present; typecheck, lint, build pass; 471 checks passed across 16 files, 0 failed; container removed.
### 01:45  Branch, commit, push, PR
- What: `git switch main; git pull; git switch -c fix/prisma-binary-targets`; committed prisma/schema.prisma as 79574f6 "Add Prisma Linux binary target for Vercel"; pushed; opened PR #10 into main.
- Why: ship the schema fix through the normal CI path.
- Command: `git commit -m "Add Prisma Linux binary target for Vercel" -m "..."; git push -u origin fix/prisma-binary-targets; gh pr create --base main ...`
- Touches: local repo, GitHub.
- Result: pushed; PR https://github.com/MJVCaccount/AppCo_PFCGym_Application/pull/10. Note: git origin URL still uses the old owner name SethOliver, which GitHub redirects to MJVCaccount (same repo id).
### 01:47  PR #10 merged
- What: all 5 checks (lint, test, typecheck, audit, build) passed, then `gh pr merge 10 --merge --delete-branch`.
- Why: pre-approved merge of the Prisma binary target fix.
- Touches: GitHub (main), remote branch deleted.
- Result: merged as commit cda7f2b.
### 01:50  Approved Deploy run 37245151414
- What: approved the pending production deployment of the Deploy run whose head_sha is cda7f2b (the merge commit of PR #10).
- Why: pre-approved for this one run.
- Command: `gh api -X POST repos/<repo>/actions/runs/37245151414/pending_deployments --input <json: state approved, comment "approved for the Prisma binary target fix">`
- Touches: GitHub Actions, then Vercel production and Neon production (migrate deploy is a no-op).
- Result (01:50 entry): the approval was accepted. The run finished green: pull, build, `prisma migrate deploy` (nothing to apply), deploy and smoke test all passed. Public check with no auth header: / 200, /classes 200, /login 200, /api/health/ready 200 {"status":"ok"}. Deployment Protection unchanged; the production alias is public.
### 01:57  Seeded production once
- What: `prisma migrate status` against the production direct string said "Database schema is up to date!". Then ran the seed once.
- Why: Phase 5, demo accounts for the module demonstration, with two new private passwords (never recorded).
- Command: `DATABASE_URL=[redacted] DIRECT_URL=[redacted] SEED_CONFIRM_HOST=ep-divine-morning-zan7a8gv.c-2.eu-west-2.aws.neon.tech SEED_ADMIN_PASSWORD=[redacted] SEED_DEMO_PASSWORD=[redacted] npx prisma db seed` (SEED_ALLOWED_HOSTS not set; variables unset afterwards)
- Touches: Neon production.
- Result: exit 0. Seeded 3 plans, 6 programmes, 6 coaches, 20 classes, 24 filler members and 2 events.
- Result (01:57 entry): production smoke test with --expect-seed: all 8 checks PASS.
### 02:00  Synced develop with main
- What: origin/develop existed (e68c849, 16 commits behind main, nothing main lacked). `git switch develop; git merge --no-ff origin/main -m "Merge main into develop"; git push origin develop`.
- Why: Phase 6, build the preview from current code.
- Touches: local repo, GitHub (develop branch; triggers CI and the Deploy workflow's preview job).
- Result: merge commit 44b7134 pushed.
### 02:05  Preview deploy failed; removed PREVIEW_ALIAS
- What: Deploy run 37245921430 (preview job for the develop push) built and deployed, then failed at `vercel alias set` with "User not found". The deployment token has no user record. Deleted the repository variable PREVIEW_ALIAS so the alias step is skipped.
- Why: user decision to skip the preview alias.
- Command: `gh variable delete PREVIEW_ALIAS -R <repo>`
- Touches: GitHub.
- Result: variable deleted.
### 02:13  Re-ran Deploy run 37245921430 (preview)
- What: one approved retry after PREVIEW_ALIAS was removed.
- Why: finish the preview deploy for develop commit 44b7134 (confirmed from the run's checkout step).
- Command: `gh run rerun 37245921430 -R <repo>`
- Touches: GitHub Actions, Vercel preview, Neon dev (migrate deploy, nothing to apply).
- Result: green. The alias step was skipped, the in-workflow smoke test passed. New preview URL https://pfc-ol78xbosh-mjani1419-1958.vercel.app returns 302 (Vercel Authentication) with no auth header, so it is not public. Local smoke test with the bypass header (no --expect-seed): all 8 checks PASS. The preview alias was NOT verified.
### 02:15-02:20  Production live check (Phase 7)
- What: headless Edge run against https://pfc-gym.vercel.app: public pages at 1280px and 390px, headers, gated routes, open-redirect probes, member (booked and cancelled one class), fighter (accepted then declined the pending offer, left declined), coach roster, admin pages (opened only), role boundaries, performance, keyboard focus, and one attempt per account with the published README passwords. 15 sign-ins in total (cap 20), at least 2 seconds apart. No registering, forgot-password, contact form, uploads or admin action buttons.
- Why: Phase 7.
- Command: a Node script using playwright-core with Microsoft Edge, in a temp folder outside the repo (deleted afterwards). Seed passwords passed in as environment variables, shown as [redacted].
- Touches: Neon production data (one booking made and cancelled by member@; one fighter offer accepted then declined, left Declined).
- Result: all checks pass; see deployment-record.md. Two scripted checks first reported FAIL because of script mistakes (case-sensitive heading match; today's date used instead of a future date) and were re-checked.
### 02:25  Deployment record branch
- What: `git switch main; git pull; git switch -c fix/deployment-record`; wrote docs/task3/deployment-record.md and copied this log to docs/task3/deployment-action-log.md. Deleted the temp browser-test folder (outside the repo).
- Why: Phase 8.
- Touches: local repo; local temp folder.
- Result: files written, secret scan next, then commit, push and PR (entries for those follow in the PR description, not in this file, because this file is part of the commit).
