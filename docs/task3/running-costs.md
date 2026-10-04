# Running costs

Written 2026-10-04 (system clock). Every vendor figure below was fetched on **2026-10-04** from the URL beside it and paraphrased. Where a figure could not be fetched it says **NOT VERIFIED** and no number is given. All dollar amounts are USD, exclude VAT, and are estimates for the stated assumptions, not quotes. Task context: [../TASK3_REPORT_NOTES.md](../TASK3_REPORT_NOTES.md) item 6.

Caveat on method: the pages were read through a fetch tool that summarises each page. The Vercel and Resend and GitHub figures were cross-read against the page text returned; the Neon figures come from a table the tool produced from `neon.com/pricing` and were not independently re-read. Re-check them by eye before they go in the final report.

## 1. Vendor facts (fetched 2026-10-04)

### Neon (database) — https://neon.com/pricing, fetched 2026-10-04

| Item | Free | Launch (next paid tier) |
| --- | --- | --- |
| Storage | 1 GB per project (20 GB per account) | no cap; $0.35 per GB-month |
| Compute | 100 CU-hours per project per month | $0.106 per CU-hour, pay as you go, no monthly minimum |
| Projects | 100 | 100 |
| Branches per project | 10 | 10 included, $1.50 per extra branch-month |
| Scale to zero | after 5 minutes idle, cannot be turned off | after 5 minutes idle, can be disabled |
| Egress | 5 GB per project | 500 GB per project, then $0.10 per GB |
| Price | $0 | usage-based |

NOT VERIFIED: the smallest and largest compute size (CU) the project autoscales between, the cold-start delay after scale-to-zero, and the region of this project. Compute below assumes 0.25 CU when active (mine).

### Vercel (hosting) — fetched 2026-10-04

Sources: https://vercel.com/docs/plans/hobby, https://vercel.com/docs/limits, https://vercel.com/docs/limits/fair-use-guidelines, https://vercel.com/docs/plans/pro-plan, https://vercel.com/docs/cron-jobs/usage-and-pricing, https://vercel.com/docs/pricing/regional-pricing/lhr1.

| Item | Hobby (free) | Pro |
| --- | --- | --- |
| Function invocations | first 1,000,000 per month | usage-based, $0.60 per 1,000,000 after credit |
| Active CPU | 4 CPU-hours | from $0.128 per hour; London (lhr1) $0.177 per hour |
| Provisioned memory | 360 GB-hours | from $0.0106 per GB-hour; lhr1 $0.0146 |
| Function max duration | 300 s | 300 s default, configurable to 800 s |
| Fast Data Transfer (bandwidth) | first 100 GB | Flat Rate CDN: 1 TB and 1,000,000 CDN requests included |
| CDN requests | first 1,000,000 | included in the Flat Rate tier up to 1,000,000; beyond that NOT VERIFIED (lhr1 on-demand rate is $2.40 per 1,000,000) |
| Builds | build time 45 min per deployment, 100 builds per hour, 100 deployments per day, 1 concurrent build; **no monthly build-minute allowance was found on the pages read** | 6,000 deployments per day, concurrent builds configurable |
| Environment variables | up to 1,000 per environment, 64 KB total per deployment (the page states this once, not per plan) | same |
| Cron jobs | 100 per project, **once per day at most, timing within the hour** | 100 per project, once per minute |
| Runtime logs | 1 hour | 1 day |
| Price | $0 | $20 per month platform fee (includes one deploying seat and $20 monthly usage credit); extra deploying seats $20 each; viewer seats free |

Terms: "Hobby teams are restricted to non-commercial personal use only. All commercial usage of the platform requires either a Pro or Enterprise plan." Commercial use is any deployment used for the financial gain of anyone involved in any part of production (examples: processing payment, advertising a sale, being paid to build or host the site). Donations do not count (fair-use page). Exceeding a Hobby limit pauses the feature for 30 days.

This repository: `vercel.json` has no `crons` entry (checked), pins `"regions": ["lhr1"]`, and turns Vercel's Git deployments off. Whether a Hobby project honours a pinned region: **NOT VERIFIED** (the lhr1 pricing page says that pricing is for Pro users).

### Vercel Blob — https://vercel.com/docs/vercel-blob/usage-and-pricing and the lhr1 page above, fetched 2026-10-04

| Item | Hobby | Pro, London (lhr1) |
| --- | --- | --- |
| Storage | 1 GB per month | $0.024 per GB-month |
| Simple operations (cache-miss reads, `head`) | first 10,000 | $0.42 per 1,000,000 |
| Advanced operations (`put`, `copy`, `list`, store creation; `del` is free) | first 2,000 | $5.30 per 1,000,000 |
| Data transfer | first 10 GB | $0.05 per GB |
| Operation rate limit | 1,200 simple and 900 advanced per minute | 7,200 and 4,500 per minute |

* Private and public stores cost the same for storage, operations and uploads; delivery differs. A private blob served through a function (this app's document route) is billed Blob Data Transfer plus Fast Origin Transfer for the function-to-store fetch, plus Fast Data Transfer for the function-to-browser response. A public image is fetched by the browser directly.
* Hobby: "you will not pay for any additional usage", but Blob **cannot be accessed** after a limit until 30 days pass. For this app that would also block document downloads.
* Included Hobby usage "is shared across all Vercel services in your project".
* Server uploads (this app uploads through its own route) incur Fast Data Transfer charges.

### Resend (email) — https://resend.com/pricing, fetched 2026-10-04

| Plan | Price | Emails | Domains |
| --- | --- | --- | --- |
| Free | $0 | 3,000 per month, **100 per day** | 3 |
| Pro | $20 per month | 50,000 per month | 10 |
| Pro | $35 per month | 100,000 per month | 10 |
| Scale | from $90 per month | 100,000 and up | 1,000 |

Overage "starting at $0.90 per 1,000 emails" on Pro. NOT VERIFIED: whether Pro has a daily cap (the page text read gave a daily limit for Free only).

### GitHub Actions — https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions, fetched 2026-10-04

* Public repository: standard GitHub-hosted runners are free.
* Private repository on GitHub Free: 2,000 minutes per month and 500 MB artifact storage; GitHub Pro: 3,000 minutes and 1 GB. Linux 2-core runner: $0.006 per minute beyond the allowance.
* NOT VERIFIED: whether this repository is public or private, and the real minutes per workflow run (no run history was read). A rough figure (mine): five CI jobs of 2 to 4 minutes plus a deploy of 5 to 6 minutes is about 18 minutes per push to `main`; 40 pushes a month is about 720 minutes, inside the private-repo allowance.

### Exchange rate — https://open.er-api.com/v6/latest/USD, fetched 2026-10-04

1 USD = **16.660331 ZAR**; the page states a last update of Sun, 04 Oct 2026 00:02:32 +0000; the data provider is exchangerate-api.com, whose terms the page tells users to read. Rand figures below use this rate and are rounded. A bank or card rate will differ.

## 2. Where the emails come from

Every send goes through one function per event in `src/lib/services/notificationService.ts`. Callers found with `grep -rn "notify[A-Z]" src`:

| Function (definition) | Called from | Recipient | Emails per event |
| --- | --- | --- | --- |
| `notifyWelcome` (`:18`) | `src/actions/auth.ts:164` (register) | the new member | 1 |
| `notifyBookingConfirmed` (`:25`) | `src/lib/services/bookingService.ts:94` | the member | 1 per successful booking |
| `notifyBookingsCancelledByGym` (`:48`) | `src/lib/services/classAdminService.ts:335` (admin deactivates a class with future bookings) | each booked member | 1 each |
| `notifyBoutOffered` (`:70`) | `src/lib/services/eventService.ts:337` | the fighter | 1 per offer |
| `notifyEventCancelled` (`:84`) | `src/lib/services/eventService.ts:304` | each fighter with an offer | 1 each |
| `notifyDocumentReviewed` (`:100`) | `src/lib/services/documentService.ts:280` | the fighter | 1 per approve or reject |
| `notifyPasswordReset` (`:119`) | `src/lib/services/passwordService.ts:82` | the account (if it exists and is active) | 1 per request |
| `notifyCoachInvite` (`:126`) | `src/lib/services/passwordService.ts:161`, reached from `coachAdminService.ts:134` (create coach) and `:161` (resend) | the coach | 1 |
| `notifyEnquiry` (`:138`) | `src/lib/services/contactService.ts:77` | the gym inbox (only if `CONTACT_INBOX` is set) and the visitor | up to 2 per enquiry |

User deactivation also cancels future bookings (`memberAdminService.deactivateUser`) but no `notify` call was found on that path, so it sends no email: **not verified beyond the grep**.

**What the app does at Resend's 100-a-day cap (or any provider error).** `queueEmail` (`src/lib/email/queue.ts`) runs after the response is sent. `sendEmail` (`src/lib/email/send.ts`) catches a provider error, logs `Email provider refused the message` with the recipient's domain, the subject and the error name (no address, no body), and returns `false`. Nothing retries it. The caller already succeeded: the booking, registration or reset token is saved, so the user sees success and simply never receives the email. For a contact enquiry the row is kept and `emailSentAt` stays empty, which the admin inbox shows. Tests: `tests/email.test.ts` "a provider error gives false, not an exception", "a booking still succeeds when the provider is down", "the visitor still sees success, and the row is kept, when email fails". Consequence: a password-reset email lost to the cap is not retried, and the user would have to ask again.

## 3. Scenarios and assumptions

"Mine" = my estimate, to be replaced by real data. "Vendor" = from section 1. "Code" = derived from this repository.

| # | Assumption | Value | Source |
| --- | --- | --- | --- |
| A1 | Registered users | 100, 1,000, 10,000 | task |
| A2 | New users per month (welcome email) | 5% of the base | mine |
| A3 | Booked classes per user per month | 4 (one booking confirmation each) | mine |
| A4 | Password reset requests per user per month | 0.05 | mine |
| A5 | Fighters as a share of users | 5% | mine |
| A6 | Fighter emails per fighter per month (offers, reviews) | 2 (so 0.10 per user) | mine |
| A7 | Gym-cancelled bookings per user per month | 0.1 | mine |
| A8 | Contact enquiries per user per month | 0.02, 2 emails each (0.04) | mine; 2 from code |
| A9 | **Emails per user per month** | 0.05 + 4 + 0.05 + 0.10 + 0.1 + 0.04 = **about 4.3** | sum of A2 to A8 |
| A10 | Page views per user per month | 30 | mine |
| A11 | Function invocations per page view | 2 (page render plus middleware, which runs on Node: `config.runtime = "nodejs"` in `src/middleware.ts`); every page is `force-dynamic` | mine, from code |
| A12 | CDN requests per page view | 15 (HTML, scripts, CSS, images) | mine |
| A13 | Data transferred per page view | 1.5 MB | mine (`public/` is 1.7 MB in total; `du -sk public`) |
| A14 | Active CPU per invocation | 60 ms | mine |
| A15 | Provisioned memory x duration per invocation | 1 GB for 0.2 s | mine |
| A16 | Database size per user | about 12 KB in the first year (see below) | derived from `prisma/schema.prisma`, mine for the counts |
| A17 | Documents per fighter | 3 typical; 10 at the app limit | 10 from `MAX_DOCUMENTS_PER_FIGHTER` (`documentService.ts`) |
| A18 | Document size | 1.5 MB typical; 4 MB at the cap | 4 MB from `DOCUMENT_MAX_BYTES` (`uploads.ts`); 1.5 MB mine |
| A19 | Images stored (coach photos, event posters, up to 2 MB each) | about 30 images, about 30 MB | mine; 2 MB from `IMAGE_MAX_BYTES` |
| A20 | Rate-limit rows alive at peak | about 3 per user: a login bucket, a booking bucket and a share of address buckets | mine, from `POLICIES` in `rateLimit.ts` |
| A21 | Neon compute when active | 0.25 CU (100 and 1,000 users), 0.5 CU (10,000) | mine, NOT VERIFIED against Neon |
| A22 | Neon hours active per month | 100 users: 4.7 h a day; 1,000: 16.5 h a day (traffic keeps it awake); 10,000: 24 h a day | mine |
| A23 | Rate | 1 USD = 16.660331 ZAR | vendor (section 1) |

### Database size, derived (A16)

Method: row size = tuple header (about 24 bytes) + columns + index entries, from the field types in `prisma/schema.prisma`. These are estimates of a PostgreSQL row, not measured.

* `User` (`:75`): email about 25 B, name about 15 B, phone about 12 B, 128-hex `passwordHash` + 32-hex `passwordSalt` as text (about 163 B), enum, flags, two timestamps; about 270 B, plus the unique email index and the role index about 70 B: **about 340 B**.
* `Member` (`:98`): ids and three nullable fields, about 52 B plus primary key about 16 B: **about 70 B**.
* `Booking` (`:178`): 3 ids and a date, an enum, a nullable reason, four timestamps, about 85 B, plus four indexes (primary key, unique, two composite) about 115 B: **about 200 B each**. At A3 that is 48 bookings a year, **about 9.6 KB per user per year**.
* Fighter extras (`Fighter`, `FighterDocument`, `EventParticipation`) about 300 B per document and 150 B per offer; negligible at A5.
* `PasswordResetToken` about 230 B with indexes, 0.05 a month per user; `AuditLog` rows only for admin actions and password resets; `RateLimitBucket` about 250 B including both indexes (the key is `policy:` + 64 hex characters).

Total: about 340 + 70 + 9,600 + small extras, so **about 12 KB per user in the first year**: 1.2 MB at 100 users, 12 MB at 1,000, 120 MB at 10,000, plus the empty-database baseline (NOT VERIFIED). Rate-limit rows: 300, 3,000 and 30,000 rows, about 0.1, 0.8 and 7.5 MB; expired buckets are deleted in batches of 500 about one call in 100 (`rateLimit.ts`).

### Computed volumes

| | 100 users | 1,000 users | 10,000 users |
| --- | ---: | ---: | ---: |
| Emails per month (A9) | 430 | 4,300 | 43,000 |
| Emails per day, average | 14 | 143 | 1,433 |
| Page views per month | 3,000 | 30,000 | 300,000 |
| Function invocations | 6,000 | 60,000 | 600,000 |
| CDN requests | 45,000 | 450,000 | 4,500,000 |
| Data transfer | 4.4 GB | 44 GB | 440 GB |
| Active CPU | 0.10 h | 1.0 h | 10 h |
| Provisioned memory | 0.3 GB-h | 3.3 GB-h | 33 GB-h |
| Database | 1.2 MB | 12 MB | 120 MB |
| Fighters | 5 | 50 | 500 |
| Document storage, typical (A17, A18) | 23 MB | 225 MB | 2.2 GB |
| Document storage at the cap (10 x 4 MB per fighter) | 200 MB | 2 GB | 20 GB |
| Neon compute (A21, A22) | 35 CU-h | 124 CU-h | 360 CU-h |

## 4. Plan, monthly cost and first limit hit

"Commercial" matters: if the gym is run for profit, Vercel Hobby is not allowed (section 1), so Pro is the real plan. The module demonstration is non-commercial. Both are shown.

### Neon

| Users | Plan | Monthly cost | First limit hit |
| --- | --- | --- | --- |
| 100 | Free | $0 | none (35 of 100 CU-hours; 1.2 MB of 1 GB) |
| 1,000 | Launch | about $13.12 compute (124 CU-h x $0.106) + $0.05 storage = **about $13.2** (R220) | Free compute allowance, 100 CU-hours: 124 estimated, so the free plan is borderline and depends on A22 |
| 10,000 | Launch | about $38.16 (360 CU-h) + $0.05 = **about $38.2** (R637) | Free compute allowance; storage (120 MB) and egress are nowhere near their limits |

### Vercel (hosting) and Blob

| Users | Plan | Monthly cost | First limit hit |
| --- | --- | --- | --- |
| 100 | Hobby if non-commercial, else Pro | $0, or $20 (R333) | none (6,000 of 1,000,000 invocations). Commercial use rule decides the plan |
| 1,000 | Hobby if non-commercial, else Pro | $0, or $20 (R333); usage inside the $20 credit | none of the allowances: 44 GB of 100 GB transfer, 1.0 of 4 CPU-hours, 60,000 invocations. Blob: typical 225 MB of 1 GB is fine; at the 10-document cap, 2 GB passes the 1 GB Blob limit, which would block Blob for 30 days |
| 10,000 | Pro | **$20** (R333); estimated usage inside the credit: CPU 10 h x $0.177 = $1.77, memory 33 GB-h x $0.0146 = $0.49, invocations 0.6 M x $0.60 = $0.36, extra CDN requests 3.5 M x $2.40 per M = $8.40 (on-demand rate used as an upper bound; Flat Rate overage NOT VERIFIED), Blob storage $0.05 to $0.47: about $11 to $12 in total, under the $20 credit | On Hobby, several at once: Fast Data Transfer 100 GB (440 GB), CDN requests 1,000,000 (4.5 M), Active CPU 4 h (10 h), Blob storage 1 GB (2.2 GB typical) |

### Resend

| Users | Plan | Monthly cost | First limit hit |
| --- | --- | --- | --- |
| 100 | Free | $0 | none on average (430 of 3,000 a month, 14 a day). **The 100-a-day cap can still be hit on a busy day** (for example 100 sign-ups or bookings in one day) |
| 1,000 | Pro | $20 (R333) | Free: 4,300 emails exceed 3,000 a month, and the 143-a-day average exceeds 100 a day |
| 10,000 | Pro | $20 (R333); 43,000 of 50,000 | Free: both limits. On Pro, the 50,000 monthly volume is 86% used at A9; the next step is $35 for 100,000 |

### GitHub Actions

| Repository | Cost | Limit |
| --- | --- | --- |
| Public | $0 | none |
| Private | $0 at about 720 minutes a month (mine), allowance 2,000 | the allowance, if CI runs more than about 100 pushes a month |

### Totals (Neon + Vercel + Resend; Blob inside Vercel; Actions $0)

| Users | Non-commercial (Hobby allowed) | Commercial (Vercel Pro) |
| --- | --- | --- |
| 100 | **$0** (R0) | **$20** (R333) |
| 1,000 | **about $33** (R552): Neon $13.2 + Resend $20 | **about $53** (R885) |
| 10,000 | not allowed on Hobby in practice (limits) | **about $78** (R1,303): Vercel $20 + Neon $38.2 + Resend $20 |

## 5. Cheapest upgrade that removes the first limit

| Users | First limit hit | Cheapest fix | Added cost |
| --- | --- | --- | --- |
| 100 | none on average; Resend 100 per day on a spike day | none needed; a spike day is handled by spreading sign-ups or by Resend Pro | $0 (or $20 for Resend Pro) |
| 1,000 | Resend 3,000 per month and 100 per day | Resend Pro | +$20 (R333) |
| 1,000 | Neon free compute (borderline) | Neon Launch (pay as you go) | about +$13 (R220) |
| 1,000 | Vercel Hobby commercial-use rule | Vercel Pro | +$20 (R333) |
| 10,000 | Vercel Hobby transfer, CPU, CDN and Blob limits | Vercel Pro | +$20 (R333) |
| 10,000 | Neon free compute | Neon Launch | about +$38 (R637) |
| 10,000 | Resend free limits | Resend Pro $20 | +$20 (R333) |

## 6. Re-check before the EXPO

1. **Resend's 100-emails-a-day cap on the Free plan.** Registrations and bookings on the day each send one email; 100 sign-ups or 100 bookings in a day silently lose the rest (section 2). Decide: upgrade for the month, or accept it. Also check whether the Resend Pro plan has its own daily cap (NOT VERIFIED).
2. **Verified sending domain and `EMAIL_FROM`.** Whether the Resend domain is verified and which sender address is configured in Vercel: not in the repository (NOT VERIFIED).
3. **Vercel plan versus commercial terms.** Whether showing prices or running the expo stall counts as commercial use is the team's decision; the quoted rule is in section 1. If in doubt, ask Vercel support (the fair-use page says to).
4. **Blob stores.** Confirm `PUBLIC_BLOB_STORE_ID` and `PRIVATE_BLOB_STORE_ID` exist in the production environment; without the private id every document upload is a 503 (`tests/uploads.test.ts` "a missing store id is a clean 503 and stores nothing"). Hobby Blob stops working at 1 GB for 30 days.
5. **Neon cold start.** The free plan scales to zero after 5 minutes idle and cannot be turned off; the first request after idle is slower. Cold-start time is NOT VERIFIED. Launch can disable scale-to-zero.
6. **`RATE_LIMIT_MULTIPLIER`.** A crowd on one venue network shares one address; the sign-in, registration, contact and password limits are per address (`src/lib/rateLimit.ts`). Set it (1 to 20) in Vercel for the day.
7. **Vercel region.** `vercel.json` pins `lhr1`; confirm the project region and the Neon region are close, and that the Hobby plan honours it (NOT VERIFIED).
8. **Prices again on the day.** All figures were fetched 2026-10-04 and vendors change prices; re-fetch each URL in section 1 before the report is handed in, and the exchange rate (the rate used is the 2026-10-04 00:02 UTC update).
9. **Real traffic.** A3, A10 to A15 and A22 are my guesses. Replace them with the Vercel usage dashboard and the Neon console numbers from the weeks before the EXPO.
10. **GitHub repository visibility** and the real Actions minutes (NOT VERIFIED).

## 7. Could not be fetched or verified

* Neon: the autoscaling CU range, cold-start time, project region; the figures were taken through a page summariser and not re-read line by line.
* Vercel: how the Flat Rate CDN is billed beyond 1,000,000 requests; a Hobby monthly build-minute allowance (none found); whether Hobby honours `regions`; the whole of the pricing page `vercel.com/pricing` was not read, only the docs pages listed.
* Resend: any daily limit on Pro or Scale; the exact error name returned when the daily cap is hit (the app logs whatever name arrives).
* GitHub: repository visibility and real run minutes.
* All traffic, email and storage volumes are assumptions (section 3), not measurements.
