# Final audit (Prompt 7, part 1)

Read-only audit of the repository at commit `c9224cd` (branch `feature/prisma-schema`, working tree clean). Method: grep for every rule in the standing instructions, then read the code behind each hit. Ratings: **P0** breaks data, security or deploy; **P1** wrong behaviour a user will hit; **P2** polish.

Nothing was changed while auditing except this file. Part 2 of the prompt fixes the P0 and P1 items and the trivial P2 ones; the results are listed in the report that closes Part 2.

## Summary

| Rating | Count |
| --- | --- |
| P0 | 0 |
| P1 | 8 |
| P2 | 16 |

No P0 was found: no console output, no `@/lib/prisma` import outside the repositories, no Decimal, no mutation without a server-side role check, no raw error or stack trace reaching a client, no secret with a production fallback, `npm audit --omit=dev` reports 0 vulnerabilities, and no "Trainer" wording.

## 1. console.\* and prisma imports

* `console.*` in `src/`: **none** (grep over `src`). The only hits are in `prisma/seed.ts:318,498,508` and `prisma/counts.ts:32,38`, which are command-line scripts outside `src/` (they print the host, a count, and an error *message*; never a password). Compliant.
* `@/lib/prisma` imports outside `src/lib/repositories`: **none** in `src/`. `tests/security.test.ts:22` imports it (tests are allowed); `tests/helpers/db.ts` builds its own client. Compliant.
* **P2** Layering: `src/actions/auth.ts:16-19` imports `createMember`, `findByEmail`, `validateCredentials` straight from `usersRepository` and `getPlan` from `plansRepository` (lines 11, 66, 110), so register and login have no service layer. Rule 3 says business rules live in services. Behaviour is correct (P2002 is mapped, rate limits applied); it is a convention gap.

## 2. force-dynamic

Every `route.ts` (19 of 19) and every page and layout except three exports `dynamic = "force-dynamic"`. The three that do not:

* **P2** `src/app/contact/page.tsx`, `src/app/denied/page.tsx`, `src/app/promo/page.tsx`. They are static, read no session and no database, and sit under the root layout (`src/app/layout.tsx:32`), which is force-dynamic anyway. No user data can be cached. Add the export for uniformity.

## 3. Route handlers and server actions

"Role check" is where the decision is made. Every row below makes it **in the service**, not only in the page. "Origin" is `assertSameOrigin` (JSON routes) or Next's own Origin-vs-Host check (server actions). "Limit" is `checkLimit`.

### Route handlers

| Method and path | Who may call | Role check in | Origin | Limit |
| --- | --- | --- | --- | --- |
| GET `/api/health` | anyone | none needed | n/a | no |
| GET `/api/health/ready` | anyone | none needed | n/a | no |
| GET `/api/classes` | anyone | none needed | n/a | no |
| GET `/api/timetable` | anyone | none needed | n/a | no |
| GET `/api/events` | anyone | none needed | n/a | no |
| POST `/api/bookings` | Member, Fighter | `bookingService.createBooking` (403 for staff) | yes | `booking` 30/10 min/user |
| POST `/api/bookings/:id/cancel` | owner member | `bookingService.cancelBooking` (404 for others and staff) | yes | **no** |
| GET `/api/fighter/offers` | Fighter | `fighterService.listMyOffers` | n/a | no |
| POST `/api/fighter/offers/:id/respond` | Fighter, own offer | `eventService.respondToOffer` (404 for others) | yes | **no** |
| POST `/api/fighter/documents` | Fighter | `documentService.uploadFighterDocument` | yes | `upload` 20/h/user |
| DELETE `/api/fighter/documents/:id` | Fighter, own document | `documentService.deleteMyDocument` (404 for others) | yes | **no** |
| GET `/api/documents/:id` | owner Fighter or Admin | `documentService.openDocument` (404 for everyone else) | n/a (GET) | no |
| POST `/api/admin/events` | Admin | `eventService.createEvent` | yes | **no** |
| PATCH `/api/admin/events/:id` | Admin | `eventService.updateEvent` / `cancelEvent` / `completeEvent` | yes | **no** |
| POST `/api/admin/events/:id/offers` | Admin | `eventService.offerBout` | yes | **no** |
| PATCH `/api/admin/participations/:id/result` | Admin | `eventService.recordResult` | yes | **no** |
| POST `/api/admin/fighters` | Admin | `fighterService.promoteToFighter` | yes | **no** |
| DELETE `/api/admin/fighters/:id` | Admin | `fighterService.demoteFighter` | yes | **no** |
| POST `/api/admin/uploads/image` | Admin | `imageService.uploadPublicImage` | yes | `upload` 20/h/user |

Findings:

* **P2** Five authenticated state-changing routes have origin checks but no rate limit (`/api/bookings/:id/cancel`, `/api/fighter/offers/:id/respond`, `DELETE /api/fighter/documents/:id`, and the admin routes). All need a valid session and a role, and every write is idempotent or guarded by a status check, so abuse is bounded; but the prompt's rule is "origin and rate limit", and the README's limits list does not mention that they are exempt.
* **P2** `POST /api/admin/uploads/image` answers `{ "url": ... }` (`src/app/api/admin/uploads/image/route.ts:34`) while every other success is `{ "data": ... }`. The shared error shape is respected; the success shape is not. Left as is because `ImageUploadField` depends on it.
* No 403 is returned where a 404 is required. Ownership probes (booking, offer, document, class roster, member stats) all answer 404; 403 is used only for "wrong role", which reveals nothing about an id.
* No mutation lacks a role check. Reads that expose other users' data (`openDocument`, `getRoster`, `memberStats`) check ownership or role in the service.

### Server actions (`src/actions`)

| Action | Who | Guard in action | Role check in service |
| --- | --- | --- | --- |
| `login`, `register`, `requestPasswordReset`, `submitPasswordReset`, `sendEnquiry` | public | rate limits (`loginIpEmail`, `loginIp`, `register`, `forgotIp`, `forgotEmail`, `resetIp`, `contact`) | n/a |
| `logout` | signed in | none | n/a |
| `book`, `cancelBookingAction` | Member, Fighter | `getSession` (+ `booking` limit on `book`) | `bookingService` |
| `changePlan`, `cancelMembership` | Member, Fighter | `getSession` | `membershipService` (403 for staff) |
| `respondToOfferAction` | Fighter | `getSession` | `eventService.respondToOffer` |
| `markAttendanceAction` | Coach, Admin | `requireRole` | `coachService.markAttendance` (coach scoped to own classes, 404 otherwise) |
| 29 admin actions in `admin.ts` (classes, programmes, coaches, members, fighters, events, offers, results, documents, enquiries, plans) | Admin | `requireRole(..., "Admin")` first line of each | every service starts with `isAdmin` |

No action lacks a role check. **P2**: admin and coach actions have no rate limit (same reasoning as above).

## 4. Dates and time zones

`src/lib/dates.ts` reads the clock through `Intl.DateTimeFormat` with `Africa/Johannesburg` and every booking, roster, attendance and "has it started" rule goes through it. `new Date()` hits in repositories and services are only the default of an injectable `now` parameter. `toLocaleDateString` appears once (`src/app/bookings/page.tsx:27`) with `timeZone: "UTC"` on a date-only value, which is correct.

* **P1** `getRoster` (`src/lib/services/coachService.ts:105`) accepts any real calendar date. A coach can open `/coach/classes/5?date=2026-10-07` for a Monday class and see an empty roster that looks valid (and `canMark` is true for any past date). The session date must fall on the class's weekday; otherwise 400.
* **P2** `src/components/Footer.tsx:90` uses `new Date().getFullYear()`: the server's zone decides the year for up to two hours around New Year's Eve in Johannesburg. Harmless; use `gymDateAndTime(now).date.getUTCFullYear()`.
* **P2** Seed (`prisma/seed.ts:478,485`) sets the two demo events to *now + 30 days* and *now + 75 days*, so their times are whatever clock time the seed ran at (the EXPO would show, say, "Sat 3 Oct 2026, 03:42"). They should be 19:00 Johannesburg.
* `src/app/admin/events/page.tsx:41,88` and `[id]/page.tsx:48` compare instants (`eventDate < now`), which is zone-independent. Fine.

## 5. Prisma

* No `Decimal` anywhere in the schema or code; money is `Int` rands (`MembershipPlan.pricePerMonth`).
* User-facing lists are bounded (`take`/`MAX_LISTED`, or `skip`/`take` pages of 25) except these admin or public catalogue reads, all small by nature:
  * **P2** `classAdminRepository.listClasses` (`:140`) and its second query (`:147`) read *every* future confirmed booking and loop over them in memory per class. Not an N+1 in queries, but unbounded and O(classes x bookings). Replace with one `groupBy` like `timetableRepository` already does.
  * **P2** `listProgrammes` (`:170`), `listAllCoaches` (`coachesRepository.ts:100`), `getCoaches` (`:79`), `listAdminFighters` / `listFighters` (`fightersRepository.ts:55,65`), `getAll` (`usersRepository.ts:97`, used for dashboard counts on `AdminDashboard.tsx:29`), `listAllPlans`, `getTimetable*` (`timetableRepository.ts:91,104,132`). Each is bounded by the size of the gym's staff, plans or timetable, not by user input. `getAll()` loads every account to count them; a count query would do.
* **P1** (added in part 2) `AdminDashboard.tsx:29,119` calls `getAll()` and renders a row for every account. With 10,000 users that is a 10,000-row page on every admin visit. `/admin/members` already pages at 25.
* No query inside a loop. `notify*` loops queue emails, not queries.
* Writes that depend on a read are inside `$transaction` with row locks (`FOR UPDATE`/`FOR SHARE`): booking capacity, class edits, coach archive, document limit and review, fighter demote, result recording, last-admin guard, plan retire. P2002/P2025/P2003/P2000/22021 are mapped explicitly in `src/lib/errors.ts`.
  * **P2** `usersRepository.cancelMembership` (`:430`) and `createMember` (`:246`) write outside a transaction, but neither depends on a prior read (a single update; a single nested create).
  * **P2** `uploadFighterDocument` puts the blob first and the row second; if the row insert throws something other than a limit, the blob is orphaned (`documentService.ts:99-117`). It is logged, not cleaned up.
* Indexes, against the `where` and `orderBy` of list pages:
  * **P2** `EventParticipation` is read by `eventId` alone (`participationsRepository.ts:94,108`) but the only index is the unique `(fighterId, eventId)`, which leads with `fighterId`. Add `@@index([eventId])`.
  * **P2** `listClasses` filters `Booking` by `status` and `sessionDate` without `gymClassId`; the index `(gymClassId, sessionDate, status)` does not serve it. Fixed by the groupBy rewrite above plus the existing index.
  * Others (`User.role`, `Booking(memberId, sessionDate)`, `CompetitionEvent.eventDate`, `RateLimitBucket.resetAt`, `PasswordResetToken.userId`) are present. The contact inbox sort has no index; at this size a sequential scan is fine.
* **P2** The schema has CHECK constraints for class, plan, review and hours, but not for `Fighter.wins/losses/draws >= 0` or `Booking`/`EventParticipation` states. The services never produce negatives (counters are recomputed in the transaction).

## 6. Validation

* Optional text accepts null, undefined and "" everywhere it is used: one shared `optionalText()` (`src/lib/text.ts`) plus `isOptionalString`. Verified for event image, coach image, bout notes/opponent/weight class, result notes, review note, phone, search, enquiry phone.
* Numeric inputs go through `isValidId` or `RULES.integerRange`, which reject NaN, fractions, negatives, strings and values over the Postgres INTEGER ceiling. Server actions turn blanks into NaN on purpose (`admin.ts` `toInt`).
* Every string has a maximum: name 100, email 254, phone 30, message 2000, password 128, event and class fields 40 to 2000, search 100, upload names 100, JSON bodies 100,000 bytes, files 2/4 MB.
* NUL characters and lone surrogates: `RULES.text` rejects them; the older `RULES.name/email/message/venue/eventName/eventDescription/weightClass` do not, but the database refusal is mapped to a 400 (`errors.ts`), so a hostile value is a clean 400, not a 500. **P2**: reject them earlier for a better field error.
* **P1** Open redirect: `src/actions/auth.ts:94` and `src/app/login/page.tsx:35` accept a `returnUrl` that starts with `/` but not `//`. `/\evil.example` passes; browsers read `\` as `/`, so the post-login redirect becomes `//evil.example`. Both places need one shared check that also rejects backslashes and control characters.
* **P1** Coach image links (`src/lib/services/coachAdminService.ts:90`) accept any `https://` URL (`RULES.url`), while event images require the public Blob host (`eventService.ts:65,119`). `next/image` and the CSP `img-src` refuse any other host, so an admin can save a coach link that then silently shows the monogram. Use one shared check for both.
* **P2** The Blob host check is a suffix match (`.public.blob.vercel-storage.com`), so any Vercel customer's public store passes, not just ours. Tighten to `PUBLIC_BLOB_STORE_ID` when it is set.

## 7. Errors

No raw error, SQL or stack reaches a client. Route handlers go through `withSession` or their own try/catch with a fixed message; services map every thrown value with `mapPrismaError`, which logs the original and returns a sentence; `error.tsx` and `global-error.tsx` show a fixed message; `/api/health/ready` answers `{ status: "unavailable" }`. `logger.ts` redacts `password|hash|salt|token|secret|authorization|cookie|body` keys.

* **P2** `logger.ts:27` writes `error.stack` and `error.message` of Prisma errors to the server log; a Prisma message can echo a column value (an email, for example). Server-side only; note it for the privacy section.

## 8. Secrets and environment

`process.env` reads in `src/` and scripts, against `.env.example` and the README:

| Variable | `.env.example` | README table |
| --- | --- | --- |
| `SESSION_SECRET`, `DATABASE_URL`, `DIRECT_URL`, `APP_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, `CONTACT_INBOX`, `PUBLIC_BLOB_STORE_ID`, `PRIVATE_BLOB_STORE_ID`, `PUBLIC_BLOB_READ_WRITE_TOKEN`, `PRIVATE_BLOB_READ_WRITE_TOKEN`, `CSP_REPORT_ONLY`, `SEED_ALLOWED_HOSTS`, `SEED_CONFIRM_HOST`, `TEST_DATABASE_URL` | yes | named in one sentence (Deployment section), **no table** |
| `SMOKE_BYPASS_SECRET` (`scripts/smoke.mjs:23`) | **missing** | named in prose only |
| `NODE_ENV`, `NEXT_RUNTIME`, `NEXT_PHASE`, `VERCEL_OIDC_TOKEN` | platform-set | n/a (OIDC token is mentioned in `.env.example`) |

* **P1** The README has no environment-variable table. The prompt (and the Task 3 hand-in) expects one; the variables are scattered over prose and `docs/OPERATIONS.md`.
* **P2** `SMOKE_BYPASS_SECRET` is missing from `.env.example`.
* **P1** `validateEnv()` (`src/lib/env.ts:62`) checks only `APP_URL`. The README says the app "refuses to start" without `SESSION_SECRET`, but the check lives in `sessionToken.ts:24-34` and fires on first use: a production server with no secret starts, serves public pages, and returns 500 on every sign-in. Check it at start-up.
* The development-only session fallback (`sessionToken.ts:36`) is reachable only when `NODE_ENV !== "production"` and `SESSION_SECRET` is shorter than 32 characters. Vercel sets `NODE_ENV=production` for preview and production builds, so it is unreachable there. `NODE_ENV=test` or an unset `NODE_ENV` on a self-hosted box would use it; acceptable, but a reviewer may prefer it to throw unless `NODE_ENV === "development" | "test"`. **P2**.
* No other secret has a fallback. `appUrl()` falls back to localhost only outside production.

## 9. Email

* Every template escapes interpolated values: `escapeHtml` on headings (`wrap`), paragraphs, fact rows, button label and href; subjects go through `oneLine` (no CR/LF). Links are built from `APP_URL` only. Plain-text parts carry raw text, which is correct for text/plain. Tests in `tests/email.test.ts` cover hostile names.
* No email is sent inside a database transaction. Repositories never call `notify*`; services call it after the commit, and `queueEmail` defers with `after()`.
* **P2** The enquiry and booking confirmation emails are best-effort; a failed send is logged and the enquiry's `emailSentAt` stays null. That is by design and visible to the admin.

## 10. Accessibility (pages added since Prompt 1)

Good: every `TextField` / `SelectField` has a `<label htmlFor>`; every error slot is `role="alert"` and fields set `aria-invalid` and `aria-describedby`; every admin table has an `sr-only` caption and `<th>` headers; row buttons carry `aria-label`s that name the row; the rejection note and member plan select have (visually hidden) labels; the members search is a `role="search"` form.

* **P1** Contrast. `--mut-2` `#6E6E6E` (`src/app/globals.css:20`) is used for table headers, offer fact labels and the "off" tag at 9 to 12 px. Measured: 4.12:1 on black, 3.52:1 on `--surface`, 3.01:1 on `--surface-3`. All fail WCAG AA (4.5:1). The README's contrast table does not list this pair. Placeholder `#6A6A6A` on the input background is 3.05:1 (placeholders are exempt from AA text rules but are hard to read). Error red `#FF6B6B` is 6.46:1 on surface, tags 9 to 12:1, `--mut` on `--surface-3` 5.58:1: all pass.
* **P2** `.btn--sm` is `min-height: 40px` (`globals.css:104`) and `.admin-actions select` is 40 px; every admin table button is below the 44 px target.
* **P2** `DocumentUploadForm` and `ImageUploadField` show their error in a `role="alert"` span but do not link it to the input with `aria-describedby`.
* Focus order was not exercised in a browser in this audit (see "Not verified").

## 11. Wording

* "Trainer": **none** in `src`, `README.md`, `docs`, `prisma` or `public`.
* TODO, FIXME, lorem, "to be scheduled", "coming soon": **none**.
* "To be confirmed" appears for an unset opponent or weight class (`FighterDashboard.tsx:63,65`, `admin/events/[id]/page.tsx:104,105`, `email/templates.ts:286,287`). It is real information (the admin has not chosen yet), not a placeholder. Left as is.

## 12. Seed

Verified against `prisma/seedGuard.ts`, `prisma/seed.ts` and `tests/seed-guard.test.ts` (the guard is host-based by design, not `NODE_ENV`-based).

* The seed refuses any database whose host is not localhost, not listed in `SEED_ALLOWED_HOSTS` and not named in `SEED_CONFIRM_HOST`; it refuses when `DIRECT_URL` and `DATABASE_URL` name different hosts and when neither is a valid URL; pooled and direct Neon hosts compare equal. It runs before anything connects (`seed.ts:317`).
* Never prints a password: the seed prints the host and counts only; failures print the error *message* (`seed.ts:318,498,508`). `tests/seed-guard.test.ts` asserts that no refusal message contains the password, a connection string or the user name.
* Compliant. **P2** (record only): the guard does not look at `NODE_ENV`; a production database on an allow-listed or confirmed host is seeded on purpose, which is what `SEED_CONFIRM_HOST` is for. The seed re-applies the published demo passwords on every run, and the README does not say the demo accounts are for the module demonstration only (listed under check 14).

## 13. Dependencies

* `npm audit --omit=dev`: **found 0 vulnerabilities**. CI runs the same at `--audit-level=high`.
* Unused packages: none. `server-only` (49 imports), `resend`, `@vercel/blob`, `@prisma/client` are used; `eslint`, `eslint-config-next`, `tsx`, `typescript`, `prisma` are used by scripts. `package.json` has no test runner dependency by design (tests run on `node` + `tsx`).

## 14. README accuracy

* **P1** The top half of the README still describes Part 1: "Structure" lists `gym-data.ts`, `users.ts` and `actions/gym.ts` as the data seam ("Part 2 swaps those two modules for Prisma"), and says "only five components opt into the client", the Tests section lists two test files and "43 checks" and "9 checks". None of that matches the code (Prisma repositories and services, 12 test files, many client components).
* **P1** The demo accounts table lacks `fighter@pfc.co.za` / `Fighter123!`, which the seed creates, and has no note that they are for the module demonstration only.
* **P2** `npm test` needs `TEST_DATABASE_URL` and a migrated database, which the "Running it" section does not say. The section lists `npm run typecheck` but not `lint`, `test`, `db:*`, `smoke` or `ci`.
* Accurate: the Deployment section (branches, workflows, smoke test, migration rule, rollback), rate-limit numbers (match `POLICIES`), CSP and header descriptions (match `csp.ts` and `next.config.mjs`), the `/api/health/ready` body.
* **P2** `/favicon.ico` returns 404 (there is no `src/app/favicon.ico`, `icon.*` or `public/favicon.ico`); the CSP matcher already excludes it.

## 15. Tests

Twelve files in `tests/` (`dates`, `session`, `logic`, `api`, `fighters`, `admin`, `hostile-input`, `email`, `password`, `uploads`, `security`, `seed-guard`). The rubric asks for 15 or more. There are no end-to-end flow scenarios per user type yet (Part 2, section B).

## Prioritised fix list

1. **P1** Open redirect via `/\` in `returnUrl` (auth action and login page): one shared safe-path helper, with tests.
2. **P1** Admin dashboard lists every account with no limit (`src/app/dashboard/AdminDashboard.tsx:119`, via `getAll()` at `:29`): cap it and leave paging to `/admin/members`. (Found while fixing, not in the first read.)
3. **P1** Validate `SESSION_SECRET` at start-up (`validateEnv`), alongside `APP_URL`.
4. **P1** `getRoster`: 400 when the date is not the class's weekday.
5. **P1** Coach image link must be the public Blob host, one shared check with events (update the admin test).
6. **P1** Contrast: raise `--mut-2` to at least 4.5:1 on `--surface-3` (one token, no layout change).
7. **P1** README: rewrite the stale Part 1 sections, add the environment variable table, add the fighter demo account, correct the test and command lists.
8. **P1** (Part 2 request) `RATE_LIMIT_MULTIPLIER` so the EXPO day can relax per-address limits without a deploy.
9. Part 2 requests: seed events at 19:00 Johannesburg; favicon; `FighterDocument.fileUrl` note in the Task 3 list.
10. Trivial P2s to fix with the above: `SMOKE_BYPASS_SECRET` in `.env.example`; `force-dynamic` on the three static pages; footer year; `@@index([eventId])`; groupBy in `listClasses`; `getAll()` count; orphan-blob cleanup on a failed insert.
11. Leave and record: rate limits on authenticated admin routes, `.btn--sm` 44 px (a visual change), repository access from the register/login actions, Blob host tightened to the store id.
12. Add the end-to-end flow tests and enough extra test files to reach 15.

## Not verified in this audit

* Focus order, tap targets and screen-reader announcements were read from the markup and CSS, not exercised in a browser.
* No query plans (`EXPLAIN`) were run; index findings are from reading the `where` and `orderBy` clauses.
* No test or build was run during the audit (read-only). Part 2 runs them.
* Vendor pricing for the Task 3 Running Costs section needs each vendor's live pricing page on the day it is written; it is not in the repository.

## Part 2 outcome

Fixed (each with a test unless noted): open redirect via `/\` in `returnUrl`; `SESSION_SECRET` checked at start-up; `getRoster` weekday check (400); coach image links must be the public Blob host (shared `src/lib/publicImage.ts`, same rule as events); admin dashboard account list capped at 20; contrast of `--mut-2` and the input placeholder; README rewritten (structure, scripts, environment table, demo accounts incl. `fighter@pfc.co.za`, tests); `RATE_LIMIT_MULTIPLIER`; demo events at 19:00 Johannesburg; favicon; `FighterDocument.fileUrl` note (`docs/TASK3_REPORT_NOTES.md`).
Also fixed as trivial P2: `SMOKE_BYPASS_SECRET` in `.env.example`; `force-dynamic` on `contact`, `denied`, `promo`; footer year on the gym's clock; `@@index([eventId])` on `EventParticipation` (migration `20261004160000_participation_event_index`); `listClasses` uses one grouped count; orphaned blob removed when the document row fails to save.
Not changed on purpose: no seed guard added (the host-based guard is the design); workflows and `src/middleware.ts` untouched; rate limits on authenticated admin routes, `.btn--sm` height (40 px), the register and login actions calling repositories, the Blob host being tighter than "any public store", the loose `Number(slotId)` in `POST /api/bookings` (a request to tighten it was declined).
