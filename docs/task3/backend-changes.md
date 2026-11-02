# Back-end changes

A summary of the back-end work on routes, services, repositories, the database, security and the release pipeline. No page layout, CSS or copy changed. Three UI files were touched for a lint or type reason only, with no change in behaviour or appearance: `SiteNav.tsx` (`first?.focus()`, `last?.focus()`), `DocumentUploadForm.tsx` (`onSubmit={(event) => void submit(event)}`), and a few page and component imports that now point at services instead of repositories.

Detail lives in the documents linked from each section: [api-reference.md](api-reference.md), [authorisation-matrix.md](authorisation-matrix.md), [security-controls.md](security-controls.md), [pentest-report.md](pentest-report.md), [deploy-window-proof.md](deploy-window-proof.md), [load-test.md](load-test.md), [test-summary.md](test-summary.md), [erd-notes.md](erd-notes.md), [branch-protection.md](branch-protection.md) and [../OPERATIONS.md](../OPERATIONS.md).

## Numbers

| | Before | After |
| --- | ---: | ---: |
| `npm test` checks | 493 (471 in the earlier test summary, which left out the two accessibility files) | **656**, in 29 files |
| Coverage of `src/lib` (`npm run coverage`, c8) | not measured | **96.38%** statements, **88.54%** branches, 93.88% functions |
| `npm audit` | 5 high | 0 |
| OpenAPI 3.1 operations described | 0 | 27 (every route file, checked both ways) |
| Penetration test | none | OWASP ZAP 2.17.0 with 0 failures, 95 scripted attack checks (see [pentest-report.md](pentest-report.md)) |
| Load test, 50 virtual users for 2 minutes (local) | none | p95 163.5 ms, 0.00% failed requests (see [load-test.md](load-test.md)) |

Lint, typecheck and build are clean. `npm run lint` now covers `src`, `tests`, `prisma` and `scripts`.

## Changes by area

### Layering and code quality

* Actions, pages, components and routes reach data through services. New services: `authService`, `catalogueService`, `timetableService`, `dashboardService`, `healthService`. `bookingService` and `membershipService` return the shared `ServiceResult`.
* `tests/architecture.test.ts` fails if anything outside `src/lib/services`, `session.ts`, `rateLimit.ts` or `src/lib/repositories` imports a repository, or anything outside the repositories imports Prisma. `session.ts` and `rateLimit.ts` keep one narrow repository each, stated in a comment. Diagram: [layers.svg](layers.svg).
* Stricter checks: `noUncheckedIndexedAccess`, `noFallthroughCasesInSwitch`, `noImplicitOverride`; type-aware ESLint rules (`no-floating-promises`, `no-misused-promises`, `consistent-type-imports`, `eqeqeq`). Every finding was fixed (11 in source, 122 in tests).
* `npm run coverage` (c8) and a coverage report kept by CI.

### Concurrency and data integrity

* `tests/booking-concurrency.test.ts`: 30 members for 3 places over five rounds, double submits, and cancel and rebook racing a full class. The invariant (never more Confirmed bookings than capacity) holds.
* An audit that drives real flows (`tests/integrity.test.ts`) found two defects, both fixed with a failing test first: a booking that went Cancelled to Failed on a full class kept its `cancelledAt`, and a fighter could decline an offer after a result was recorded.
* `npm run db:verify` (`prisma/verifyIntegrity.ts`): 20 read-only checks (subtype rows, bookings over capacity, state consistency, record versus results); exits 1 on any finding; runs in CI.
* Trigram indexes on `User.fullName` and `User.email` (migration `member_search_trigram`): the admin member search on 10,000 users drops from about 12 ms to under 1 ms. The index review is in the next section.
* Row-state CHECK constraints are written and tested but **not in `prisma/migrations`**. They are in `docs/task3/pending-migrations/` because the live release writes the two stale values above and would return a 500 on those two flows once the constraints exist ([deploy-window-proof.md](deploy-window-proof.md)). The file is added as its own migration after the current release has deployed and been stable.

### Index review

Measured with `EXPLAIN (ANALYZE)` on a throwaway database holding 10,033 users, 200,198 bookings, 20,000 audit rows and 5,000 enquiries. One run each on local Docker, so the times are relative. An index was added only where the plan showed a gain.

| Query | Before (ms) | After (ms) | Decision |
| --- | ---: | ---: | --- |
| Timetable booked counts | 19.9 | 12.4 | **No index (tried and rejected).** The synthetic data holds about 1,500 Confirmed rows per class and date, where real classes hold at most 24, and the existing (class, date, status) index is exact at real counts. A partial index also cannot be declared in the Prisma schema, so it would show as drift. |
| My bookings | 0.18 | 0.20 | none needed |
| Roster | 2.69 | 2.42 | none needed |
| Admin member search | 11.6 | 0.68 | trigram GIN on `fullName` and `email` |
| Admin member search, count | 11.4 | 0.40 | same indexes |
| Admin member list, no search | 2.70 | 2.41 | none needed |
| Latest 100 audit rows | 0.12 | 0.17 | none needed |
| Enquiries, page 1 | 0.97 | 0.70 | none needed |
| Cancel a member's future bookings | 0.22 | 0.17 | none needed |

### API

* One wrapper (`publicRoute`, `userRoute`) runs every JSON route in the same order: request id, same-origin check on writes, session, rate limit, the route, then headers and one access-log line. Errors are `{ error: { message, code, requestId } }` with 13 stable codes; success bodies are unchanged. Unknown paths and wrong methods answer JSON 404 and 405 (with `Allow`). Public catalogue reads are cacheable for 60 seconds; everything with user data, the timetable and every error is `no-store`.
* `docs/openapi.yaml` (OpenAPI 3.1) describes every route; it is served at `GET /api/openapi.json` and rendered to [../api.html](../api.html). `tests/openapi.test.ts` fails when a route or method is missing from the spec or the spec lists one that does not exist, when the served JSON differs from the YAML, when a schema carries a stray key, and when a real response does not match its schema. The spec is also linted with Redocly in CI.
* New routes: `GET /api/bookings`, `GET /api/fighter/documents`, `POST /api/account/sign-out-everywhere`, `POST /api/admin/users/{id}/erase`, `GET /api/health/detail`, `GET /api/cron/maintenance`, `GET /api/cron/outbox`, `GET /api/openapi.json`.

### Security

* Passwords are 10 to 128 characters with a common-password list when chosen; sign-in enforces only the 128 ceiling, so existing passwords still work. The session cookie is `__Host-pfc_session` in production, with COOP and CORP `same-origin`, and `/.well-known/security.txt`.
* Every route has a rate limit except the two health checks. Audit rows are written for administrators downloading a document, sign-in lockouts and password-reset requests.
* Account erasure (admin only) anonymises a member or fighter, deletes their documents, files, queued mail and contact enquiries, cancels future bookings, and keeps bookings and the audit trail.
* Uploads: PDFs containing `/JavaScript`, `/JS`, `/Launch` or `/OpenAction` are refused (also `#xx`-escaped and inside compressed streams); images with unreadable or oversized dimensions are refused; the document download carries `Content-Security-Policy: sandbox`.
* The penetration test ran against a local production build only. Findings: the session expiry was not enforced on the server (Medium, fixed: `exp` is signed into the cookie and checked on every request); password-reset timing differed by about 14 ms between known and unknown addresses (Low, fixed with a fixed minimum response time); five high advisories in dependencies of the Blob SDK (Low, fixed; `npm audit` reports 0). Two Low risks are accepted and documented. Each fix has a regression test.
* Additional scans (details in [pentest-report.md](pentest-report.md)): Gitleaks over the full history (one reviewed test fixture), Semgrep OSS with four rule packs (all findings fixed or justified, then zero), Squawk on the migrations (no errors; warnings accounted for), actionlint (clean).
* `sanitizeFileName` replaces a lone surrogate, which previously made the download header throw (found by the property tests).

### Email

* Mail without a secret (welcome, bookings, bout offers, event cancellation, document review, enquiries) is stored in `EmailOutbox` and then sent. Password-reset and invite mail are sent directly and never stored.
* Failure classes: an HTTP 4xx other than 408 and 429 is permanent and the mail is parked as a dead letter at once with its reason; 429, 408, 5xx and network errors become due again after 5, 30, 120 and 360 minutes, then park after the fifth failure. Addresses ending `.invalid`, and addresses on the `EMAIL_SKIP` list, are skipped without calling the provider and without logging the address.
* A daily cap (`EMAIL_DAILY_CAP`, default 90) counts outbox and direct sends and holds the rest until the next UTC day. Skipped mail is not a failure: it is neither pending nor dead.
* "Due" means a retry may happen, not that it will at that minute. Retries run at the next email the app sends, hourly while the Outbox drain workflow runs (GitHub may delay a scheduled run and disables schedules after 60 days without repository activity), and at least daily through the Vercel cron.

### Operations routes and logging

* `GET /api/health/detail` (bearer `HEALTH_TOKEN`): database latency and size, applied versus expected migrations, row counts, outbox state including `deadLast24h`, rate-limit buckets, whether email and storage are configured. `GET /api/cron/maintenance` (bearer `CRON_SECRET`): clears expired reset tokens and counters, drains the outbox, purges old rows. `GET /api/cron/outbox` (same secret): drains only. Each answers 404 when its secret is unset or shorter than 32 characters.
* A database query slower than 500 ms logs a `Slow query` warning with the model, operation, time and request id, and no arguments.

### Release pipeline and monitoring

* `deploy.yml` records the live production deployment, promotes it back through the Vercel REST API if the smoke test fails (the CLI cannot be used with the deployment token), checks readiness on the production domain, writes a step summary and fails the job. `rollback-drill.yml` rehearses this by hand behind the production approval. Migrations are forward-only.
* `monitor.yml` checks production every 15 minutes (readiness, response time, and with a token the health-detail thresholds) and keeps one incident issue. `outbox-drain.yml` asks production to retry due emails hourly.
* `ci.yml` runs the tests on Node 20 and 24, checks migration drift, seeds and runs `db:verify`, runs coverage on Node 24, lints the OpenAPI spec, and runs `gitleaks` and `semgrep`. `codeql.yml` and `dependency-review.yml` are separate workflows.
* Every `uses:` in every workflow is pinned to a full commit SHA with the tag in a comment; a test fails on an unpinned action. Dependabot covers npm and GitHub Actions with a 7-day cooldown. The Vercel ids are scoped to the jobs that use them.
* Branch protection is applied on `main` and `develop`; the settings are in [branch-protection.md](branch-protection.md).

### Property tests and load test

* `tests/properties.test.ts`: 19 properties (fast-check, no database) for the password and validation rules, the session cookie, upload inspection, file names, the redirect guard and the email backoff. On a failure the seed and the minimal counterexample are printed; `FC_SEED` replays it and `FC_RUNS` raises the effort.
* `tools/load/k6.js` and `tools/load/seed-load-users.ts` reproduce the load test.

## How it was tested

* `npm test` (656 checks) against a throwaway PostgreSQL 16 in Docker, with Resend and Vercel Blob replaced by in-memory stubs. Per-file counts: [test-summary.md](test-summary.md).
* A production build run locally under OWASP ZAP and the scripted attacks (`npm run pentest`); k6 for load.
* The release currently live was run against a database with every new migration applied ([deploy-window-proof.md](deploy-window-proof.md)).

## Known limits: what is not verified

* **The new GitHub workflows have now run on GitHub.** Monitor, Outbox drain, CodeQL, Semgrep, gitleaks and Dependency review have all run. They also pass `actionlint` and structural tests, and the rollback script was tested against a fake Vercel API. The Gitleaks job sets `safe.directory` through the environment, which was only exercised on a Windows bind mount locally. Dependency review fails because the repository's dependency graph is switched off; it is not a required check.
* **Real email delivery and file uploads are not verified.** Deploys, migrations, health checks and the rollback drill have run against Vercel and Neon on production. All 7 migrations are applied there, including `20261027120100_member_search_trigram`, so Neon allowed `CREATE EXTENSION pg_trgm` and the trigram indexes were created (inferred from the applied migration; the index list itself was not queried). The sender is the Resend sandbox address, which reaches only the owner's address, so delivery to members is unverified. The Blob stores are configured on production but uploads were not exercised there.
* **The constraints migration has never been applied to real data.**
* **Load figures are local and relative:** one desktop for server, database and load generator, no TLS, no Neon, no Vercel cold starts, rate limits relaxed twentyfold. They say nothing about the deployed site's absolute performance.
* **Semgrep's registry packs change over time**, so a clean run can turn red later.
* The penetration test did not cover TLS, the edge network, Deployment Protection or the real email provider.
* Two Low risks are accepted: a copied session cookie works until it expires (at most 8 hours) or the account signs out everywhere, and sign-up reveals that an email is registered.

## Operational setup

Environment variables (see `.env.example` and [../OPERATIONS.md](../OPERATIONS.md)):

| Name | Where | Purpose |
| --- | --- | --- |
| `HEALTH_TOKEN` | Vercel, and the GitHub secret of the same name for the monitor | Bearer token for `/api/health/detail` (at least 32 characters) |
| `CRON_SECRET` | Vercel, and the GitHub secret of the same name for the drain | Bearer secret for the two cron routes (at least 32 characters) |
| `EMAIL_SKIP` | Vercel Production | `member@pfc.co.za,fighter@pfc.co.za,marcus@pfc.co.za,sofia@pfc.co.za,admin@pfc.co.za`: the demo accounts use addresses the sandbox sender cannot deliver to |
| `EMAIL_DAILY_CAP`, `SLOW_QUERY_MS`, `SECURITY_CONTACT`, `API_ACCESS_LOG` | optional | Defaults are 90, 500 ms, the contact inbox, and logging on |
| `PRODUCTION_URL` | GitHub repository variable | Used by the monitor and the Outbox drain |

First-run order for a new environment (full text in OPERATIONS; the current production has been through it): set `CRON_SECRET` and `HEALTH_TOKEN` in Vercel, deploy, call `/api/cron/maintenance` once with the bearer token, then add `HEALTH_TOKEN` and `CRON_SECRET` to GitHub, run the Monitor and Outbox drain workflows once, and run the Rollback drill once.

Release order for the held-back migration: deploy this work, let it run stable, then add `docs/task3/pending-migrations/20261027120000_integrity_constraints.sql` as its own migration with a later timestamp.

The production cookie name changes with this release, so everyone signs in once more. Alerts for failed deploys, cron failures, storage and daily email usage are configured in the Vercel, Neon and Resend dashboards; the monitor sees storage and email only from the application's side.
