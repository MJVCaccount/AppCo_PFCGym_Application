import "server-only";

import { bookSlot, getSlot, getSlotsFor, getTimetable } from "@/lib/gym-data";

/**
 * Data-access layer for the timetable (Task 1 §7.1.2).
 *
 * A thin pass-through to the seeded data module today, including the write
 * (`bookSlot`). Phase 2 replaces these bodies with Prisma queries — ideally
 * `bookSlot` becomes a transaction that re-checks capacity on write, closing
 * the race the in-memory version has (see its own comment in gym-data.ts).
 */
export { getTimetable, getSlotsFor, getSlot, bookSlot };
