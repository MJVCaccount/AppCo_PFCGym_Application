# API reference

Source: the 19 `route.ts` files under `src/app/api/` (run `find src/app/api -name route.ts` to list them), the services they call, and `src/lib/api.ts`. The who-may-call table with ownership rules is in [authorisation-matrix.md](authorisation-matrix.md); the older route table is in [../AUDIT.md](../AUDIT.md) section 3.

## Conventions (all routes)

* Success: `{ "data": ... }` with the status shown. One exception: `POST /api/admin/uploads/image` answers `{ "url": ... }` (`src/app/api/admin/uploads/image/route.ts`).
* Error: `{ "error": { "message": "..." } }` (`jsonError`, `src/lib/api.ts`). Nothing thrown reaches the client; a failure is a fixed sentence with status 500.
* **State-changing requests (POST, PATCH, DELETE)** must carry an `Origin` (or `Referer`) whose host equals the host of `APP_URL`, otherwise **403** `Cross-origin requests are not allowed.` (`src/lib/origin.ts`). This check runs before the session check.
* **JSON bodies** (`readJson`, `src/lib/json.ts`): `Content-Type: application/json` else **415**; more than 100,000 bytes (declared or counted) else **413**; unreadable or invalid JSON else **400**; for routes that need an object (`readJsonObject`), an array, string or number is **400** `Request body must be a JSON object.`
* **Auth** is the signed `pfc_session` cookie, checked against the database on each request (`getSession`). No valid session is **401** `Sign in to continue.` (`withSession`) or a route-specific sentence for the two booking routes. A signed-in caller with the wrong role gets **403** from the service, except where an id belongs to someone else, which is **404**.
* **Path ids** accept plain digits only (`pathId`); anything else becomes NaN and the service answers 400 (or 404 where noted).
* **429** `Too many requests. Try again later.` with a `Retry-After` header (seconds) when a rate limit is hit; limits are in `POLICIES`, `src/lib/rateLimit.ts`, and scale with `RATE_LIMIT_MULTIPLIER`.
* **Every route can also return 500** with its fixed failure sentence if something unexpected is thrown. The sentence is listed per route.
* Dates are ISO strings; `sessionDate` is `YYYY-MM-DD` on the Johannesburg calendar (`src/lib/dates.ts`).
* Every route exports `dynamic = "force-dynamic"`.

Shapes named below (`TimetableSlot`, `Booking`, `BoutOffer`, `CompetitionEvent`, `FighterOffers`, `FighterDocument`, ...) are TypeScript interfaces in `src/lib/types.ts`.

## Public (no session)

| Method and path | Request | Success | Error statuses |
| --- | --- | --- | --- |
| `GET /api/health` | none | 200 `{ "status": "ok" }` (not wrapped in `data`; no database call) | none |
| `GET /api/health/ready` | none | 200 `{ "status": "ok" }` | 503 `{ "status": "unavailable" }` (database unreachable; no detail) |
| `GET /api/classes` | none | 200 `{ data: ClassProgramme[] }` | 500 `Could not load classes.` |
| `GET /api/timetable` | query `day` optional: `mon`..`sun` | 200 `{ data: TimetableSlot[] }` (the week, or one day) | 400 `day must be one of: ...`; 500 `Could not load the timetable.` |
| `GET /api/events` | none | 200 `{ data: CompetitionEvent[] }` Scheduled, future, soonest first | 500 `Could not load events.` |

## Bookings (Member or Fighter)

| Method and path | Request | Success | Error statuses |
| --- | --- | --- | --- |
| `POST /api/bookings` | JSON `{ "slotId": number }` | **201** `{ data: TimetableSlot }` (refreshed `booked` count) | 401 `Sign in to book a class.`; 403 foreign origin, or coach/admin (`Only members can book classes.`), or no plan (`An active membership plan is required to book a class.`); 429 (30 per 10 min per user); 415; 413; 400 invalid JSON, or `slotId` missing or not a positive integer (`slotId must be a positive integer.`); 404 class missing or inactive; 409 already booked, or class full (a `Failed` row is written); 500 `Could not complete the booking.` |
| `POST /api/bookings/:id/cancel` | no body | 200 `{ data: Booking }` (status `Cancelled`) | 401 `Sign in to cancel a booking.`; 403 foreign origin; 400 id not a positive integer; 404 not your booking, missing, or caller is staff; 409 not Confirmed, or class already started; 500 `Could not cancel the booking.` |

## Fighter

| Method and path | Request | Success | Error statuses |
| --- | --- | --- | --- |
| `GET /api/fighter/offers` | none | 200 `{ data: FighterOffers }` (`fighter`, `pending`, `accepted`, `declined`, `past`) | 401; 403 `Only fighters have bout offers.`; 404 no fighter profile; 500 `Could not load your offers.` |
| `POST /api/fighter/offers/:id/respond` | JSON `{ "response": "Accepted" \| "Declined" }` | 200 `{ data: BoutOffer }` | 401; 403 foreign origin, or not a fighter; 415; 413; 400 bad id, or response not Accepted/Declined; 404 offer is not yours or missing; 409 event no longer open (cancelled or date passed); 500 `Could not save your answer.` |
| `POST /api/fighter/documents` | multipart: `type` = `Medical` \| `Licence` \| `Other`, `file` (PDF, JPEG or PNG, at most 4 MB by real size and real type) | **201** `{ data: FighterDocument }` (status `Pending`) | 401; 403 foreign origin, or not a fighter; 429 (20 per hour per user); 413 over 4 MB; 415 not PDF/JPEG/PNG by magic bytes; 400 not multipart, no file, empty file, bad `type`; 409 already 10 documents; 502 storage error; 503 private store not configured (`File storage is not available right now. Please try again later.`); 500 `Could not save your document.` |
| `DELETE /api/fighter/documents/:id` | no body | 200 `{ data: { id } }` | 401; 403 foreign origin, or not a fighter; 404 not yours, missing or bad id; 409 `An approved document cannot be deleted.`; 500 `Could not delete the document.` |
| `GET /api/documents/:id` | none | 200 file stream. Headers: `Content-Type` from the stored extension, `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store` | 401; 404 for every case except owner-Fighter or Admin (missing, someone else's, member, coach, bad id, blob missing); 502 / 503 storage error; 500 `Could not open the document.` |

## Admin (Admin only; any other role is 403)

All admin routes share: 401 no session; 403 foreign origin or not an admin; 415, 413, 400 for a bad body as under Conventions (`DELETE` reads no body).

| Method and path | Request | Success | Further error statuses |
| --- | --- | --- | --- |
| `POST /api/admin/events` | JSON `{ name, venue, description, eventDate, imageUrl? }` | **201** `{ data: CompetitionEvent }` | 400 field error, or `Event date must be in the future.`; 500 `Could not create the event.` |
| `PATCH /api/admin/events/:id` | JSON edit `{ name?, venue?, description?, eventDate?, imageUrl? }` (at least one), or JSON `{ "status": "Cancelled" \| "Completed" }` alone | 200 `{ data: CompetitionEvent }` | 400 bad id, field error, nothing sent, `status` mixed with other fields, or status other than Cancelled/Completed; 404 event missing; 409 not Scheduled (cancel/complete), or `Completed` before the date has passed; 500 `Could not update the event.` |
| `POST /api/admin/events/:id/offers` | JSON `{ fighterId, opponentName?, boutWeightClass?, boutNotes? }` | **201** `{ data: BoutOffer }` (availability `Pending`) | 400 bad ids or text; 404 event or fighter missing; 409 event closed, or the fighter already has an offer; 500 `Could not create the offer.` |
| `PATCH /api/admin/participations/:id/result` | JSON `{ "result": "Win" \| "Loss" \| "Draw" \| "NoContest" \| null, notes? }` (`result` must be present) | 200 `{ data: BoutOffer }` | 400 bad id, result or notes; 404 offer missing; 409 event cancelled, or event date not yet reached; 500 `Could not record the result.` |
| `POST /api/admin/fighters` | JSON `{ memberId, weightClass }` | **201** `{ data: Fighter }` | 400 bad id or weight class; 404 member missing, staff or deactivated; 409 already a fighter; 500 `Could not promote the member.` |
| `DELETE /api/admin/fighters/:id` | no body | 200 `{ data: { id } }` | 400 bad id; 404 not a fighter; 409 `A fighter with bout offers or documents cannot be demoted.`; 500 `Could not demote the fighter.` |
| `POST /api/admin/uploads/image` | multipart: `file` (JPEG, PNG or WebP, at most 2 MB, real type by magic bytes) | **201** `{ "url": "https://....public.blob.vercel-storage.com/images/<uuid>.<ext>" }` | 429 (20 per hour per user); 413; 415; 400 not multipart, no file, empty; 502 / 503 storage error (`Image storage is not available right now. Please try again later.`); 500 `Could not upload the image.` |

## Not routes

Sign-in, registration, password reset, contact, membership changes, class/coach/plan/member administration and attendance are **server actions** (`src/actions/*.ts`), not HTTP routes: they are listed in [authorisation-matrix.md](authorisation-matrix.md). Server actions use Next's own Origin-versus-Host check instead of `assertSameOrigin`.

## Verification

Each row above was read from the route file and the service it calls. Tests that exercise the routes: `tests/api.test.ts` (public, booking routes), `tests/fighters.test.ts` (events, fighter and admin routes, "every admin route is 401 signed out and 403 for other roles"), `tests/uploads.test.ts` (document and image routes), `tests/security.test.ts` (origin and body checks on every state-changing route, 429s, health routes), `tests/flows.test.ts` (end-to-end). Exact response bodies for every error row are not each asserted by a test: **not verified** row by row.
