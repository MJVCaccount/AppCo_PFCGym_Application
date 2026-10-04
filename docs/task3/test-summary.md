# Test summary

Run on 2026-10-04 on Windows 11, Node via `npm test` (script in `package.json`), against a throwaway `postgres:16` container with two databases, `pfc_app` and `pfc_test`. `DATABASE_URL`, `DIRECT_URL` (both `pfc_app`) and `TEST_DATABASE_URL` (`pfc_test`) and a 40-character `SESSION_SECRET` were exported in the shell only; no `.env` value was used for the database. The container was removed afterwards.

Result: **exit code 0, 468 checks passed, 0 failed.** `npm test` runs 16 files one after another in the order below, and each prints `N checks passed`; the 468 `ok` lines in the output equal the sum of the 16 counts.

| # | File | Checks | Covers (from the check names) |
| --- | --- | ---: | --- |
| 1 | `tests/dates.test.ts` | 23 | Next occurrence of a class, the Johannesburg clock, event dates, admin and coach dates |
| 2 | `tests/session.test.ts` | 15 | Signed cookie, tampering, `sessionVersion`, deactivated and deleted accounts |
| 3 | `tests/logic.test.ts` | 68 | Catalogue, timetable counts, users and auth, plans, DB CHECK constraints, error mapper, logger, validation rules |
| 4 | `tests/api.test.ts` | 34 | Booking service rules, races, cancel, public GET routes, booking routes |
| 5 | `tests/fighters.test.ts` | 46 | Promote/demote, events, offers, answers, results and counters, fighter and admin routes |
| 6 | `tests/admin.test.ts` | 51 | Admin services (classes, coaches, members, plans), last-admin rule, coach roster and attendance, audit log |
| 7 | `tests/hostile-input.test.ts` | 16 | Hostile text and numbers on every create/update, concurrent duplicates |
| 8 | `tests/email.test.ts` | 22 | Escaped templates, `sendEmail`, contact enquiry, notifications fired by services |
| 9 | `tests/password.test.ts` | 13 | Reset request and use, single use, race, coach invite |
| 10 | `tests/uploads.test.ts` | 26 | Magic-byte sniffing, size limits, private store, download route, limits, review, image upload |
| 11 | `tests/security.test.ts` | 79 | Rate limiter and where it is applied, same-origin, JSON reader, middleware gate, CSP, static headers, `/api/health` |
| 12 | `tests/seed-guard.test.ts` | 19 | Seed host and password refusal rules |
| 13 | `tests/config.test.ts` | 12 | `returnUrl`, public image host, `RATE_LIMIT_MULTIPLIER` parsing, production `SESSION_SECRET`, favicon |
| 14 | `tests/seed-passwords.test.ts` | 6 | Seed with and without the password variables |
| 15 | `tests/rate-limit-multiplier.test.ts` | 6 | Multiplier applied to register and sign-in limits |
| 16 | `tests/flows.test.ts` | 32 | End-to-end scenarios per user type |
| | **Total** | **468** | |

Sum check: 23+15+68+34+46+51+16+22+13+26+79+19+12+6+6+32 = 468.

## Notes

* All 16 files are in `tests/` and are the 16 names in the `test` script; there are 7 other files in `tests/helpers` and `tests/support` (one database helper and six stubs/loaders, not test files).
* A "check" is one `check("label", ...)` call; some are generated in a loop (for example `tests/security.test.ts` creates one check per state-changing route), so a count is not the number of `check(` lines in the source.
* The output also contains JSON log lines (`"level":"warn"` "Coach invite failed", `"level":"error"` "Could not delete a stored document"). They come from checks that deliberately make a stub fail (`tests/admin.test.ts` "a failing invite does not undo the account", `tests/uploads.test.ts` "a failed blob delete is logged but the row is still removed") and do not mean a failure.
* The tests use stubs for Resend and Vercel Blob (`tests/support/resend-stub.ts`, `tests/support/vercel-blob-stub.ts`); no email was sent and no Blob store was reached. Behaviour against the real Resend or Blob services: **not verified** by this run.
* `npm run lint`, `npm run typecheck`, `npm run build` and `npm audit` were not run for this document.
* A first attempt at this run was invalid: an earlier test process was still alive and shared `pfc_test`, which made `tests/logic.test.ts` fail on a stray row. That process was killed and the whole suite rerun from scratch; the numbers above are from the clean rerun.

## Update 2026-10-04 (after the browser-check fixes)

A later full run of `npm test` passed **471 checks in 16 files**: `tests/flows.test.ts` went from 32 to 35 checks (the three new `/admin` redirect checks); every other count above is unchanged.
