# Authorisation matrix

Read from the code, not from the README. Columns G, M, F, C, A are Guest (no valid session), Member, Fighter, Coach, Admin. **Y** = allowed. A status or word = what that caller gets. "own" = only rows that belong to the caller; anything else is 404. Tests are named by file and check label. The older route and action tables are in [../AUDIT.md](../AUDIT.md) section 3; this file re-derives them from the code and adds the service layer.

## How a caller is identified (applies to every row)

| Layer | What it does | File | Test |
| --- | --- | --- | --- |
| Cookie | `pfc_session`: HMAC-SHA256 signed payload `{id, email, fullName, role, sv}`, httpOnly, sameSite lax, secure in production, 8 h | `src/lib/sessionToken.ts`, `src/lib/session.ts` | `tests/session.test.ts` "tampering with the payload invalidates the session", "a validly signed cookie with no sv is rejected" |
| `getSession()` | Verifies the signature, then loads the account: inactive, deleted or `sessionVersion` mismatch gives no session. **The role used for every decision is the database role, not the cookie's.** | `src/lib/session.ts:72-91` | `tests/session.test.ts` "a cookie issued under an older sessionVersion is rejected", `tests/admin.test.ts` "a deactivated user's cookie stops working at once", "a promoted member sees the fighter dashboard without signing in again", "a demoted fighter is refused fighter-only actions immediately" |
| Middleware gate | For paths `/dashboard`, `/bookings`, `/admin`, `/coach` (and below): no valid signature gives a redirect to `/login?returnUrl=...`; `/admin` for a non-Admin and `/coach` for a non-Coach/non-Admin give a redirect to `/denied`. Signature and cookie role only, no database. Does not run for `/api/*` | `src/middleware.ts:27-52` | `tests/security.test.ts` "no cookie on a gated path redirects to login with the way back", "a signed-in member reaches /dashboard and /bookings, not /admin or /coach", "admin reaches /admin and /coach; coach reaches /coach but not /admin", "a prefix match is not a path match" |
| Page / action guard | `requireSession(path)`: no session redirects to `/login?returnUrl=`. `requireRole(path, ...roles)`: no session redirects to login, wrong role redirects to `/denied` | `src/actions/auth.ts` (end of file) | `tests/flows.test.ts` "a forged cookie is rejected on every protected route and by the page gate" |
| Route handler | `withSession` returns 401 with no session; the role is decided in the service (403) | `src/lib/api.ts` `withSession` | `tests/flows.test.ts` "every protected route answers 401 with no session" |
| Service | Every service function re-checks the role itself (`isAdmin`, `isMemberRole`, `ROLES.Fighter`, `isStaff`) | `src/lib/services/*.ts` | rows below |

"Member" in service checks means `isMemberRole(role)`: Member **and** Fighter (`src/lib/types.ts:19`), because a Fighter is also a Member row.

## 1. Pages

| Page | G | M | F | C | A | Wrong role gets | Guard | Test |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/`, `/classes`, `/coaches`, `/memberships`, `/timetable`, `/events`, `/contact`, `/promo`, `/login`, `/register`, `/forgot-password`, `/reset-password/[token]`, `/denied` | Y | Y | Y | Y | Y | n/a | none (login, register and forgot-password call `getSession()` to adapt the page) | `tests/security.test.ts` "public pages pass through with no redirect" |
| `/dashboard` | redirect to login | Y | Y | Y | Y | n/a (renders the dashboard for the DB role) | middleware + `requireSession` (`src/app/dashboard/page.tsx`) | `tests/security.test.ts` middleware checks |
| `/bookings` | redirect to login | Y | Y | Y (empty lists) | Y (empty lists) | n/a | middleware + `requireSession`; `listMyBookings` returns empty for staff | `tests/api.test.ts` "staff get the same 404 for any booking id" covers cancel, not the page: page itself **not verified** by a test |
| `/coach/classes/[id]` | login | `/denied` | `/denied` | Y own classes (404 for another coach's class) | Y any | `/denied` | middleware, `requireRole(..., "Coach", "Admin")`, then `getRoster` | `tests/admin.test.ts` "a coach asking for someone else's roster gets 404, never 403" |
| `/admin` and `/admin/*` (classes, coaches, members, fighters, events, events/[id], plans, documents, enquiries, audit) | login | `/denied` | `/denied` | `/denied` | Y | `/denied` | middleware, `src/app/admin/layout.tsx` `requireRole`, and `requireRole` again in every `page.tsx` | `tests/security.test.ts` middleware checks; every page's guard **not verified** by a per-page test |

## 2. Route handlers (19)

Status when not allowed: G = 401 (booking routes: 401 with their own sentence), wrong role = 403, ownership = 404, foreign `Origin` = 403 before anything else.

| Route | G | M | F | C | A | Wrong role / not yours gets | Decided in | Test |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `GET /api/health`, `GET /api/health/ready`, `GET /api/classes`, `GET /api/timetable`, `GET /api/events` | Y | Y | Y | Y | Y | n/a | none | `tests/api.test.ts` "GET /api/health reports ok", "GET /api/classes returns the six programmes", "GET /api/timetable returns the week, or one day"; `tests/fighters.test.ts` "GET /api/events returns only Scheduled future events..."; `tests/security.test.ts` "/api/health is shallow and /api/health/ready checks the database" |
| `POST /api/bookings` | 401 | Y | Y | 403 | 403 | 403 `Only members can book classes.` | `bookingService.createBooking` | `tests/api.test.ts` "POST routes answer 401...", "POST /api/bookings refuses a coach with 403", "staff cannot book: coach and admin get 403" |
| `POST /api/bookings/:id/cancel` | 401 | Y own | Y own | 404 | 404 | 404 for someone else's booking and for any staff caller | `bookingService.cancelBooking` | `tests/api.test.ts` "cancelling someone else's booking returns 404, like a missing one", "staff get the same 404 for any booking id", "POST /api/bookings/:id/cancel cancels my booking only" |
| `GET /api/fighter/offers` | 401 | 403 | Y own | 403 | 403 | 403 | `fighterService.listMyOffers` | `tests/fighters.test.ts` "GET /api/fighter/offers is 403 for a member and 200 for a fighter" |
| `POST /api/fighter/offers/:id/respond` | 401 | 403 | Y own offer | 403 | 403 | 403 wrong role, 404 another fighter's offer | `eventService.respondToOffer` | `tests/fighters.test.ts` "another fighter gets 404, the same as a missing offer", "a member, a coach and an admin get 403"; `tests/flows.test.ts` "cannot answer an offer that is not theirs: 404, and nothing changes" |
| `POST /api/fighter/documents` | 401 | 403 | Y | 403 | 403 | 403, checked before the body is read | `documentService.uploadFighterDocument` | `tests/uploads.test.ts` "only a fighter may upload, and the role is checked before the body is read", "the document routes enforce their roles" |
| `DELETE /api/fighter/documents/:id` | 401 | 403 | Y own, Pending or Rejected | 403 | 403 | 403 wrong role; 404 another fighter's; 409 if Approved | `documentService.deleteMyDocument` | `tests/uploads.test.ts` "the document routes enforce their roles", "an approved document cannot be deleted"; `tests/flows.test.ts` "cannot read, download or delete another fighter's document: 404 for all" |
| `GET /api/documents/:id` | 401 | 404 | Y own | 404 | Y any | 404 (never 403) | `documentService.openDocument` | `tests/uploads.test.ts` "a member, another fighter and a coach get 404, not 403", "the owner gets the file; an admin gets it too" |
| `POST /api/admin/events` | 401 | 403 | 403 | 403 | Y | 403 | `eventService.createEvent` | `tests/fighters.test.ts` "every admin route is 401 signed out and 403 for other roles" |
| `PATCH /api/admin/events/:id` | 401 | 403 | 403 | 403 | Y | 403 | `eventService.updateEvent` / `cancelEvent` / `completeEvent` | same test |
| `POST /api/admin/events/:id/offers` | 401 | 403 | 403 | 403 | Y | 403 | `eventService.offerBout` | same test |
| `PATCH /api/admin/participations/:id/result` | 401 | 403 | 403 | 403 | Y | 403 | `eventService.recordResult` | same test; `tests/fighters.test.ts` "a coach cannot record a result" |
| `POST /api/admin/fighters` | 401 | 403 | 403 | 403 | Y | 403 | `fighterService.promoteToFighter` | same test; "a member cannot offer a bout or promote anyone" |
| `DELETE /api/admin/fighters/:id` | 401 | 403 | 403 | 403 | Y | 403 | `fighterService.demoteFighter` | same test |
| `POST /api/admin/uploads/image` | 401 | 403 | 403 | 403 | Y | 403 | `imageService.uploadPublicImage` | `tests/uploads.test.ts` "only an admin may upload an image, and it lands in the public store", "the image route answers { url } to an admin and refuses everyone else" |

Also for all rows above: `tests/flows.test.ts` "a signed-in member is refused (403) on every staff-only route, and sees no one else's document".

## 3. Server actions (`src/actions`)

Server actions cannot return an HTTP status to a browser; a denied call becomes a redirect. "Login" = redirect to `/login?returnUrl=...`; "Denied" = redirect to `/denied`; "msg" = redirect back with an `error=` message that carries the service's 403/404 sentence.

| Action(s) | G | M | F | C | A | Guard in the action | Service check | Test |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `login`, `register`, `requestPasswordReset`, `submitPasswordReset`, `sendEnquiry` (`auth.ts`, `gym.ts`) | Y | Y | Y | Y | Y | rate limits only | none needed | `tests/security.test.ts` rate-limit checks; `tests/password.test.ts` |
| `logout` | Y | Y | Y | Y | Y | none | none | `tests/session.test.ts` "destroySession clears it" |
| `book` | Login | Y | Y | msg (403) | msg (403) | `getSession`, `booking` limit | `bookingService.createBooking` | `tests/api.test.ts` "staff cannot book: coach and admin get 403" |
| `cancelBookingAction` | Login | Y own | Y own | msg (404) | msg (404) | `getSession` | `bookingService.cancelBooking` | `tests/api.test.ts` "staff get the same 404 for any booking id" |
| `changePlan`, `cancelMembership` | Login | Y | Y | msg (403) | msg (403) | `getSession` | `membershipService` | `tests/logic.test.ts` "only members may change a plan through the service" |
| `respondToOfferAction` | Login | msg (403) | Y own | msg (403) | msg (403) | `getSession` | `eventService.respondToOffer` | `tests/fighters.test.ts` "a member, a coach and an admin get 403" |
| `markAttendanceAction` | Login | Denied | Denied | Y own classes (404 otherwise) | Y any | `requireRole("Coach","Admin")` | `coachService.markAttendance` | `tests/admin.test.ts` "a coach cannot mark another coach's booking: 404", "a member gets 403 from coach functions; admin and coach are let in" |
| 30 admin actions in `src/actions/admin.ts` (create/update/deactivate/reactivate/delete class; create/update/deactivate programme; create/update/archive/restore coach and resend invite; set plan, deactivate and reactivate user; promote and demote fighter; create/update/cancel/complete event; offer bout; record result; review document; mark enquiry handled; create/update/deactivate plan) | Login | Denied | Denied | Denied | Y | `requireRole(..., "Admin")` is the first line of each | every service starts with `isAdmin` | `tests/admin.test.ts` "every admin function refuses a member, fighter and coach" |

(AUDIT.md says 29 admin actions; `grep -c "export async function" src/actions/admin.ts` gives 30 and the list above has 30. Reason for the difference: **not verified**.)

## 4. Service functions

| Service (file) | Function | G | M | F | C | A | Wrong role gets | Test |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `bookingService` | `createBooking` | n/a (caller supplies a session) | Y | Y | 403 | 403 | 403 | `tests/api.test.ts` "staff cannot book..." |
| | `cancelBooking` | n/a | Y own | Y own | 404 | 404 | 404 | `tests/api.test.ts` "cancelling someone else's booking returns 404...", "staff get the same 404..." |
| | `listMyBookings` | n/a | Y | Y | empty | empty | empty lists | `tests/api.test.ts` "my bookings lists upcoming sessions..." |
| `membershipService` | `changePlan`, `cancelMembership` | n/a | Y | Y | 403 | 403 | 403 | `tests/logic.test.ts` "only members may change a plan through the service" |
| `coachService` | `getMyClasses`, `coachStats` | n/a | 403 | 403 | Y own | Y all | 403 | `tests/admin.test.ts` "a member gets 403 from coach functions...", "a coach sees only their own classes; an admin sees all" |
| | `getRoster` | n/a | 403 | 403 | Y own class | Y | 403; another coach's class is 404 | `tests/admin.test.ts` "a coach asking for someone else's roster gets 404, never 403", "a roster date that is not the class's weekday is a 400 on the date" |
| | `markAttendance` | n/a | 403 | 403 | Y own | Y | 403; another coach's booking 404 | `tests/admin.test.ts` "a coach cannot mark another coach's booking: 404" |
| | `memberStats` | n/a | own only | own only | own only | any | 404 for someone else's id | `tests/admin.test.ts` "memberStats counts the month's attendance and upcoming bookings" (the 404 branch is **not verified** by a named test) |
| `eventService` | `listPublicEvents` | Y | Y | Y | Y | Y | n/a | `tests/fighters.test.ts` "GET /api/events returns only Scheduled future events..." |
| | `listAllEvents`, `getEventDetail`, `createEvent`, `updateEvent`, `cancelEvent`, `completeEvent`, `offerBout`, `recordResult` | n/a | 403 | 403 | 403 | Y | 403 | `tests/fighters.test.ts` "only an admin can create, edit, cancel, complete or demote", "a member cannot offer a bout or promote anyone", "a coach cannot record a result" |
| | `respondToOffer` | n/a | 403 | Y own | 403 | 403 | 403; another fighter's offer 404 | `tests/fighters.test.ts` "another fighter gets 404, the same as a missing offer" |
| `fighterService` | `listFightersForAdmin`, `promoteToFighter`, `demoteFighter` | n/a | 403 | 403 | 403 | Y | 403 | `tests/fighters.test.ts` "only an admin can create, edit, cancel, complete or demote" |
| | `listMyOffers` | n/a | 403 | Y | 403 | 403 | 403 | `tests/fighters.test.ts` "GET /api/fighter/offers is 403 for a member and 200 for a fighter" |
| `documentService` | `uploadFighterDocument`, `listMyDocuments`, `deleteMyDocument` | n/a | 403 | Y own | 403 | 403 | 403; another's id 404 | `tests/uploads.test.ts` |
| | `openDocument` | n/a | 404 | Y own | 404 | Y | 404 | `tests/uploads.test.ts` "a member, another fighter and a coach get 404, not 403" |
| | `listDocumentsForReview`, `listFightersWithApprovedMedical`, `reviewDocument` | n/a | 403 | 403 | 403 | Y | 403 | `tests/uploads.test.ts` "reviewing is admin only...", "the review queue lists Pending first and is admin only", "the offer form can tell who has an approved medical" |
| `imageService` | `uploadPublicImage` | n/a | 403 | 403 | 403 | Y | 403 | `tests/uploads.test.ts` "only an admin may upload an image..." |
| `contactService` | `submitEnquiry` | Y | Y | Y | Y | Y | n/a (public, rate limited in the action) | `tests/email.test.ts` "a valid enquiry saves one row and emails the gym and the visitor" |
| | `listInbox`, `setEnquiryHandled` | n/a | 403 | 403 | 403 | Y | 403 | `tests/email.test.ts` "the inbox is admin only" |
| `classAdminService` | `listSessions`, `createSession`, `updateSession`, `deactivateSession`, `reactivateSession`, `deleteSession`, `listProgrammes`, `createProgramme`, `updateProgramme`, `deactivateProgramme` | n/a | 403 | 403 | 403 | Y | 403 | `tests/admin.test.ts` "every admin function refuses a member, fighter and coach" |
| `coachAdminService` | `listCoaches`, `createCoach`, `resendInvite`, `updateCoach`, `archiveCoach`, `restoreCoach` | n/a | 403 | 403 | 403 | Y | 403 | same test; `tests/password.test.ts` "Resend invite is admin only..." |
| `memberAdminService` | `listMembers`, `listPromotableMembers`, `setMemberPlan`, `deactivateUser`, `reactivateUser` | n/a | 403 | 403 | 403 | Y | 403 | same test |
| `planAdminService` | `listPlans`, `createPlan`, `updatePlan`, `deactivatePlan` | n/a | 403 | 403 | 403 | Y | 403 | same test |
| `auditService` | `listAuditLog` | n/a | 403 | 403 | 403 | Y | 403 | `tests/admin.test.ts` "the audit log lists the latest rows, newest first, with no credentials" |
| `passwordService` | `requestReset`, `checkResetToken`, `resetPassword` | Y | Y | Y | Y | Y | token-based, not role-based | `tests/password.test.ts` |
| | `sendInvite` (via `inviteService.sendCoachInvite`) | n/a | n/a | n/a | n/a | called only from `coachAdminService`, after its admin check | no role check of its own | `tests/password.test.ts` "creating a coach emails a 7-day set-password link, and that link works" |
| `notificationService` | all `notify*` | n/a | internal | internal | internal | internal | no role check; called by services after a commit | `tests/email.test.ts` |

## 5. Things this matrix found

* `bookingService.createBooking` and `cancelBooking` take the session as a parameter and check roles themselves; they do not read the cookie (`src/lib/services/bookingService.ts` header comment).
* Admin and coach actions have no rate limit (`docs/AUDIT.md` section 3 P2, recorded and left as is). Sign-in, registration, password, contact, booking and upload limits are in [security-controls.md](security-controls.md).
* An admin sees any fighter document through `GET /api/documents/:id` and the admin documents page; the code writes no audit row for a download. Whether a download should be audited is **not verified** as a requirement.
