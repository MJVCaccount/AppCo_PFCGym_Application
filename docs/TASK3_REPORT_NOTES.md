# Task 3 report: what must change, with the facts from the repository

The Task 3 report has to match the finished system. Several things differ from
Task 1. Each item below gives the facts to write down and where they live in
the code. Nothing here is a figure from a vendor: item 6 needs the live pricing
pages on the day the report is written.

## 1. Authentication is custom cookie sessions, not Auth.js

HMAC-SHA256 signed cookie (`src/lib/sessionToken.ts`), `httpOnly`,
`sameSite=lax`, `secure` in production, 8 hours. Passwords are hashed with
scrypt and a per-account salt (`src/lib/password.ts`). Revocation is
server-side: the cookie carries `sv`, the account's `User.sessionVersion`; a
password reset bumps it, and `getSession()` reads the account's current role
and `isActive` from the database on every request, so a demotion or a
deactivation applies on the next request. State the reason in the report in
the team's own words (for example: the app needs only one credential type, the
session must be revocable per account, and the whole flow stays in the
repository where it can be tested).

## 2. ERD additions

`ClassProgramme`, `Booking.sessionDate`, `BookingStatus.NoShow`,
`FighterDocument`, `ContactEnquiry`, `PasswordResetToken`, `AuditLog`,
`Review`, `OpeningHours`, `RateLimitBucket`, `User.sessionVersion`. Source of
truth: `prisma/schema.prisma`. Redraw Figure 20 and the design class diagram
from it. The schema also has two indexes added after the first draft
(`Booking(gymClassId, sessionDate, status)`, `EventParticipation(eventId)`) and
CHECK constraints in `prisma/migrations/*_integrity_checks`.

**`FighterDocument.fileUrl` holds the private Blob pathname** (for example
`fighter-docs/<fighterId>/<uuid>.pdf`), **not a URL.** The file is only ever
read back through `GET /api/documents/:id`, which checks the caller is the
owner or an admin and streams it with the store's credentials. The column name
is historical; do not describe it as a link in the report.

## 3. Booking sequence and state diagrams

Add the row lock: `bookingsRepository.createBooking` locks the `GymClass` row
(`SELECT ... FOR UPDATE`), counts Confirmed bookings for that session date,
then writes Pending and Confirmed in the same transaction. States:
Pending, Confirmed, Failed, Cancelled, Completed, NoShow. A full class writes a
**Failed** row; a later attempt for the same member, class and date **reuses
that row** (and a Cancelled one), because the table allows one row per member,
class and date. Cancelling is allowed until the class starts. A coach can mark
Completed or NoShow once the session date has arrived on Johannesburg's clock.

## 4. Security section

* Authorisation matrix: the route and action tables in `docs/AUDIT.md`
  (section 3), and the role check in each service.
* CSP with a per-request nonce (`src/lib/csp.ts`, `src/middleware.ts`), the
  security headers in `next.config.mjs`.
* Rate limiting in Postgres (`src/lib/rateLimit.ts`), same-origin check on
  every JSON write (`src/lib/origin.ts`), body size and type checks
  (`src/lib/json.ts`).
* Uploads: size, real type from magic bytes, generated pathnames
  (`src/lib/uploads.ts`); a private store for documents and a public one for
  images.
* XSS controls: React escaping, escaped email templates
  (`src/lib/email/templates.ts`), the CSP nonce.

## 5. DevOps section

The real pipeline diagram is in `README.md` (Deployment); `.github/workflows/ci.yml`
and `deploy.yml` are the source. Branch protection rules and the `production`
environment approval are GitHub settings, not repository files: copy them from
Settings, Branches and Settings, Environments when you write the section.

## 6. Running Costs (not filled in here)

Needs figures from each vendor's pricing page **on the day you write it**, with
the page and the date cited: Neon, Vercel, both Vercel Blob stores, Resend.
State the Resend limit of 100 emails a day as an assumption, and give the 100,
1,000 and 10,000 user scenarios. Email volume per user comes from the app:
a welcome email, a booking confirmation per booking, password resets, bout
and document emails, and two emails per contact enquiry.

## 7. Change Management

Unchanged unless the client's feedback changes it.
