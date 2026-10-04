# ERD notes: what is new against the original design

Diagram: [erd.mmd](erd.mmd). Source of truth: `prisma/schema.prisma` and `prisma/migrations/`.

"Original design" here means the Task 1 ERD. That document is not in the repository, so the list of additions is taken from [../TASK3_REPORT_NOTES.md](../TASK3_REPORT_NOTES.md) section 2 and each row below was checked against the schema. Whether every row is absent from the Task 1 figure: **not verified** (Task 1 is not in the repo).

## Additions

| Addition | Where (file:line) | Why (from the code) |
| --- | --- | --- |
| `ClassProgramme` | `prisma/schema.prisma:146` | The public class catalogue (`/classes`) is separate from timetable slots. `GymClass.programmeId` is optional (`SetNull`), so a slot can exist without a programme. Admin CRUD in `src/lib/services/classAdminService.ts`. |
| `Booking.sessionDate` (`@db.Date`) | `prisma/schema.prisma:184` | A class repeats weekly, so a booking must name the date of the session. `nextOccurrence()` in `src/lib/dates.ts` computes it; the unique key `(memberId, gymClassId, sessionDate)` (`:192`) allows one row per member, class and date. |
| `BookingStatus.NoShow` | `prisma/schema.prisma:41` | A coach marks a past session `Completed` or `NoShow` (`src/lib/services/coachService.ts` `markAttendance`). |
| `BookingStatus.Failed` and `Booking.failureReason` | `prisma/schema.prisma:38` and `:186` | A full class writes a `Failed` row with reason "Class full" (`CLASS_FULL_REASON`, `src/lib/repositories/bookingsRepository.ts:19`). Whether `Failed` was in the original design: **not verified**. |
| `FighterDocument` | `prisma/schema.prisma:230` | Medical and licence documents, reviewed by an admin (`DocumentStatus`). **`fileUrl` holds the private Blob pathname** (`fighter-docs/<fighterId>/<uuid>.<ext>`, built by `generatePathname` in `src/lib/uploads.ts`), not a URL. The column name is historical. The file is read only through `GET /api/documents/:id`. |
| `ContactEnquiry` | `prisma/schema.prisma:245` | The contact form saves the message first (`submitEnquiry`, `src/lib/services/contactService.ts`); `emailSentAt` records whether the gym copy went out, `handledAt` is set by an admin. |
| `PasswordResetToken` | `prisma/schema.prisma:256` | Reset and coach-invite links. Only the sha256 of the token is stored (`tokenHash`, unique). `src/lib/repositories/passwordResetRepository.ts`. |
| `AuditLog` | `prisma/schema.prisma:268` | Who did what to which row. `actorId` is `SetNull` so history survives account deletion. Written by `record()` in `src/lib/repositories/auditRepository.ts`, inside the same transaction as the change. |
| `Review` | `prisma/schema.prisma:281` | Public testimonials (`getReviews`, `src/lib/repositories/reviewsRepository.ts`). No relation to `User`. |
| `OpeningHours` | `prisma/schema.prisma:289` | Per-day opening hours; `Day` is the primary key (`src/lib/repositories/hoursRepository.ts`). |
| `RateLimitBucket` | `prisma/schema.prisma:297`, migration `20261004140000_rate_limit` | Fixed-window counters in Postgres (`src/lib/rateLimit.ts`). `key` is `policy:sha256(identifier)`. |
| `User.sessionVersion` | `prisma/schema.prisma:86`, migration `20261004115908_session_version` | Bumped by a password reset (`consumeToken`); the cookie carries the value it was issued under and `getSession()` rejects a mismatch (`src/lib/session.ts`). |
| `EventParticipation @@index([eventId])` | `prisma/schema.prisma:227`, migration `20261004160000_participation_event_index` | Offers are listed by event; the other index `(fighterId, eventId)` leads with `fighterId` (`docs/AUDIT.md` section 5). |
| `Booking @@index([gymClassId, sessionDate, status])` and `@@index([memberId, sessionDate])` | `prisma/schema.prisma:193-194` | Capacity counts per session and a member's booking list. |
| `GymClass @@unique([coachId, day, startsAt])`, `@@index([day, startsAt])` | `prisma/schema.prisma:174-175` | A coach cannot teach two classes in one slot (the 409 "clash"); the timetable reads by day and time. |
| `EventParticipation @@unique([fighterId, eventId])` | `prisma/schema.prisma:226` | One offer per fighter per event (409 on a second). |
| CHECK constraints | `prisma/migrations/20261004015208_integrity_checks/migration.sql` | See below. Prisma's schema language cannot express them. |

## CHECK constraints (all five from one migration)

| Constraint | Rule |
| --- | --- |
| `gymclass_capacity_positive` | `capacity > 0 AND "durationMinutes" > 0` |
| `gymclass_time_format` | `"startsAt"` matches `^([01][0-9]|2[0-3]):[0-5][0-9]$` |
| `plan_price_nonnegative` | `"pricePerMonth" >= 0` |
| `review_rating_range` | `rating BETWEEN 1 AND 5` |
| `hours_range` | `opens BETWEEN 0 AND 23 AND closes BETWEEN 1 AND 24 AND closes > opens` |

Tests that exercise them: `tests/logic.test.ts` ("a class with capacity 0 is rejected", "a class starting at \"25:99\" is rejected", "a review rating of 6 is rejected", "a negative plan price is rejected"). No test for `hours_range`: **not verified** by a test.

There is no CHECK on `Fighter.wins/losses/draws` or on `Booking`/`EventParticipation` state (`docs/AUDIT.md` section 5, a recorded P2).

## Delete behaviour worth stating

| Relation | `onDelete` |
| --- | --- |
| `Member`, `Coach`, `Admin` → `User` | Cascade |
| `Fighter` → `Member`, `EventParticipation` → `Fighter`/`CompetitionEvent`, `FighterDocument` → `Fighter`, `PasswordResetToken` → `User` | Cascade |
| `Booking` → `Member`, `Booking` → `GymClass`, `GymClass` → `Coach` | Restrict |
| `Member` → `MembershipPlan`, `GymClass` → `ClassProgramme`, `AuditLog` → `User` | SetNull |

Source: `prisma/schema.prisma` relation lines.
