# Deploy-window proof

The pipeline applies migrations **before** the new code goes live, so for a short time the previous release serves traffic against the new schema. This is the test of that window, run on 2026-10-27 (Cape Town) on a local Postgres 16 in Docker. Nothing touched Neon, the deployed site or GitHub settings.

## Method

1. `git fetch origin`, then `git archive origin/main` into a temporary directory (read-only: nothing in the repository was changed). `origin/main` was `084b843`, the release that is live now. It has none of this back-end work.
2. `npm ci` and `prisma generate` in that directory, so the old release ran with its own dependencies and its own Prisma client.
3. A fresh database with **every current migration applied**: the five old ones, `member_search_trigram`, `email_outbox`, and the held-back `integrity_constraints` (copied in as `20261029000000_integrity_constraints` for the test).
4. The old release's own `npm test` list was run file by file (not chained, so one failure does not hide the rest) against that database.
5. Two flows the old tests never run were run on the old code, once on the new schema and once on a database with only the old migrations, for contrast.

## Result: the constraints migration stays held back

### The old release's own tests, as shipped: 4 of 18 files fail

All four fail on **test fixtures that write rows the new constraints forbid**, not on application code. In each file the run stops at its first failure.

| File | First failing check (the one before it passed) | Constraint | What the fixture did |
| --- | --- | --- | --- |
| `tests/logic.test.ts` | after "a single slot carries the same count as the week view" (line 248) | `booking_cancelled_at_matches_status` | set a booking to `Confirmed` from `Cancelled` without clearing `cancelledAt` |
| `tests/fighters.test.ts` | after "two admins recording Win at once add one win, not two" (line 613) | `participation_responded_at_matches_answer` | created an offer `Accepted` with no `respondedAt` |
| `tests/admin.test.ts` | after "a demoted fighter is refused fighter-only actions immediately" (line 704) | `booking_cancelled_at_matches_status` | created a `Cancelled` booking with no `cancelledAt` |
| `tests/password.test.ts` | after "an unknown token and a weak password are refused with the right messages" (line 195) | `reset_token_expires_after_creation` | moved `expiresAt` into the past without moving `createdAt` |

The other 14 files pass: contrast, a11y-fields, dates, session, api, hostile-input, email, uploads, security, seed-guard, config, seed-passwords, rate-limit-multiplier and flows (315 checks).

### The old release's tests with those fixtures corrected: all 18 files pass

The same four corrections made in the current repository (`cancelledAt` set or cleared, `respondedAt` set, `createdAt` moved back) were applied to the temporary copy. Then logic (68), fighters (46), admin (51) and password (13) all pass. So **no application code path that the old tests exercise breaks** on the new schema.

### Two flows the old release's tests never run do break

Run on the old code, on the new schema (the integrity audit found both; the current release fixes them):

| Flow | Old schema | New schema with the constraints |
| --- | --- | --- |
| A member cancels, the class fills, and the same member tries to book it again | 409 "fully booked" | **500** "Something went wrong" (`booking_cancelled_at_matches_status`: the Failed row keeps its old `cancelledAt`) |
| A result is recorded, an admin moves the event date, the fighter declines | 200 | **500** (`participation_result_needs_acceptance`) |

Both are rare and both end in a generic error with the data unchanged, but they are real: a member in the first flow would be told to try again and would fail every time until the new code is live.

### The other two migrations are safe in the window

`member_search_trigram` and `email_outbox` were applied in the same database. The old release's suite passes on them (the 14 files above, and the four fixed ones).

## Decision

* The constraints migration **stays in `docs/task3/pending-migrations/`**. Moving it into `prisma/migrations` now would make the next deploy return those two 500s to anyone hitting them during the window, and would fail the old suite.
* **To release it:** deploy the current work first; once it is live, copy the file to `prisma/migrations/<a later timestamp>_integrity_constraints/migration.sql` and commit that alone. The current code fixes both flows (tested in `tests/integrity.test.ts`) and passes the whole suite with the constraints applied (shown in round 1).
* The pending file now adds each constraint `NOT VALID` and then runs `VALIDATE CONSTRAINT`, which takes a lighter lock for the long part, and starts with `lock_timeout` and `statement_timeout`.

## Not covered

* Production data. Step 1 of the migration repairs rows that already break a rule, but whether Neon holds any was not looked at (nothing in this work runs against Neon).
* A rollback after the constraints are in: the previous release would then meet the same two 500s. That is one more reason to commit the constraints migration only after a release has been stable for a while.
