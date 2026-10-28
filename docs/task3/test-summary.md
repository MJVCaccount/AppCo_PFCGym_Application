# Test summary

Run on 2026-10-28 (Cape Town, second round) on Windows 11 with Node 24.19.0 through `npm test` (the script in `package.json`), against a throwaway PostgreSQL 16 container with the databases `pfc_app` and `pfc_test`. `DATABASE_URL`, `DIRECT_URL` and `TEST_DATABASE_URL` were set in the shell only. Nothing was run against Neon.

Result: **exit code 0, 656 checks passed, 0 failed**, in 29 files run one after another in the order below. Each file prints `N checks passed`; the numbers in the table are those lines.

| # | File | Checks | Covers |
| --- | --- | ---: | --- |
| 1 | `tests/contrast.test.ts` | 12 | Colour contrast of the design tokens |
| 2 | `tests/a11y-fields.test.ts` | 10 | Form fields reference their hint and error nodes |
| 3 | `tests/dates.test.ts` | 23 | Next occurrence of a class, the Johannesburg clock, event dates |
| 4 | `tests/session.test.ts` | 15 | Signed cookie, tampering, `sessionVersion`, deactivated accounts, expiry claim |
| 5 | `tests/logic.test.ts` | 69 | Catalogue, timetable counts, users and auth, plans, CHECK constraints, error mapper, logger, validation rules, password rule |
| 6 | `tests/api.test.ts` | 34 | Booking service rules, races, cancel, public GET routes, booking routes |
| 7 | `tests/fighters.test.ts` | 46 | Promote/demote, events, offers, answers, results and counters, fighter and admin routes |
| 8 | `tests/admin.test.ts` | 51 | Admin services (classes, coaches, members, plans), last-admin rule, roster and attendance, audit log |
| 9 | `tests/hostile-input.test.ts` | 16 | Hostile text and numbers on every create/update, concurrent duplicates |
| 10 | `tests/email.test.ts` | 22 | Escaped templates, `sendEmail`, contact enquiry, notifications fired by services |
| 11 | `tests/password.test.ts` | 13 | Reset request and use, single use, race, coach invite |
| 12 | `tests/uploads.test.ts` | 26 | Magic-byte sniffing, size limits, private store, download route, limits, review, image upload |
| 13 | `tests/security.test.ts` | 83 | Rate limiter and its policies, same-origin, JSON reader, middleware gate, CSP, static headers, health routes |
| 14 | `tests/seed-guard.test.ts` | 19 | Seed host and password refusal rules |
| 15 | `tests/config.test.ts` | 12 | `returnUrl`, public image host, `RATE_LIMIT_MULTIPLIER`, production `SESSION_SECRET`, favicon |
| 16 | `tests/seed-passwords.test.ts` | 6 | Seed with and without the password variables |
| 17 | `tests/rate-limit-multiplier.test.ts` | 6 | Multiplier applied to register and sign-in limits |
| 18 | `tests/flows.test.ts` | 35 | End-to-end scenarios per user type |
| 19 | `tests/architecture.test.ts` | 6 | Only services (and two named exceptions) import repositories; only repositories import Prisma |
| 20 | `tests/booking-concurrency.test.ts` | 4 | 30 members for 3 places, double submit, cancel and rebook racing a full class, 5 rounds each |
| 21 | `tests/integrity.test.ts` | 13 | Real flows leave no row in a forbidden state; `db:verify` finds a planted orphan and exits 1 |
| 22 | `tests/api-handler.test.ts` | 15 | Request id, error envelope, access log, rate-limit option, cache headers, catch-all, 405, `GET /api/bookings`, `GET /api/fighter/documents` |
| 23 | `tests/openapi.test.ts` | 13 | Spec and routes agree both ways, served JSON equals the YAML, real responses match their schemas |
| 24 | `tests/hardening.test.ts` | 22 | Password rule, `__Host-` cookie, `security.txt`, rate limits on every route, audit rows, sign-out-everywhere, erasure, PDF and image checks |
| 25 | `tests/pentest-regressions.test.ts` | 8 | One test per penetration-test finding, plus mass assignment |
| 26 | `tests/outbox.test.ts` | 25 | Outbox send; failure classes (permanent 4xx, 408/429/5xx/network, `.invalid`); retry, dead letter, cap, no double send, purge, erasure; health detail with `deadLast24h`; maintenance and outbox-drain jobs; slow-query log |
| 27 | `tests/pipeline.test.ts` | 20 | Rollback script against a fake Vercel API, monitor decisions, shape of every workflow, every action pinned to a commit SHA, gitleaks and Semgrep in CI |
| 28 | `tests/properties.test.ts` | 19 |
| 29 | `tests/email-skip.test.ts` | 13 | `EMAIL_SKIP`: parser (exact, domain, case, spaces, empty entries, suffix and prefix lookalikes, unset), `deliver()` skips without a provider call or a log line, an outbox row ends Skipped, Skipped is neither pending nor dead in the health detail, the monitor ignores it | Property tests (fast-check, no database): password and validation rules, session cookie round trip and forgery, upload inspection, file names, redirect guard, email backoff |
| | **Total** | **656** | |

Sum check: 12+10+23+15+69+34+46+51+16+22+13+26+83+19+12+6+6+35+6+4+13+15+13+22+8+25+20+19+13 = 656.

## How the count grew

| Step | Checks | Files |
| --- | ---: | ---: |
| Earlier version of this file (it left out the two accessibility files, `contrast` 12 and `a11y-fields` 10) | 471 | 16 |
| Same suite recounted before the back-end changes | 493 | 18 |
| Layering test (6) and booking concurrency (4) | 503 | 20 |
| Data integrity audit and `db:verify` (13) | 516 | 21 |
| Shared API handler (14) and OpenAPI contract (11) | 541 | 23 |
| Hardening (22) and penetration-test regressions (8), with changed assertions | 576 | 25 |
| Email outbox, health detail, maintenance job, slow-query log (17), one more contract check | 594 | 26 |
| Release pipeline (17) and a test for the services the pages use | 612 | 27 |
| Email failure classes and the drain route (outbox +8), pinned actions, gitleaks and Semgrep checks (pipeline +3), property tests (+19), a guard against stray keys in the spec (+1) | 643 | 28 |
| `EMAIL_SKIP` (+13) | 656 | 29 |

## Coverage

`npm run coverage` (c8 around the whole suite, `src/lib` only, source-mapped), final run: **96.38% statements, 88.54% branches, 93.88% functions, 96.38% lines**. CI uploads the report from the Node 24 job.

## Notes

* A "check" is one `check("label", ...)` call; some are generated in a loop, so a count is not the number of `check(` strings in a file.
* The output also contains JSON log lines (`"level":"warn"`, `"level":"error"`). They come from checks that make a stub fail on purpose.
* The tests use stubs for Resend and Vercel Blob (`tests/support/resend-stub.ts`, `tests/support/vercel-blob-stub.ts`); no email was sent and no Blob store was reached. Behaviour against the real providers is **not verified** here.
* `tests/pipeline.test.ts` checks the workflow files' structure and the scripts they call. It cannot prove that GitHub Actions or Vercel behave as the files expect: the workflows have not run (they take effect when committed). `actionlint` reports no problems with them.
* `tests/outbox.test.ts` and `tests/hardening.test.ts` depend on the clock a little (a 300 ms floor, a minute of backoff arithmetic); they were run several times in a row without a failure.
* `tests/properties.test.ts` draws new random inputs on every run (300 per property; `FC_RUNS` raises it). On a failure it prints the seed and the minimal counterexample; replay with `FC_SEED=<seed>`. It found one real bug (`sanitizeFileName` let a lone surrogate through, which made `contentDisposition` throw), now fixed, and one bug in its own generator.
* The load test (`tools/load/k6.js`, [load-test.md](load-test.md)) and the penetration test (`tools/pentest/attack.ts`, ZAP) are not part of `npm test`: it needs a running production build. Its findings are regression-tested in `tests/pentest-regressions.test.ts`.
