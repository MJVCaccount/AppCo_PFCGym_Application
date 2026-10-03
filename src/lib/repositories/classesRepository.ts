import "server-only";

import { getClass, getClasses } from "@/lib/gym-data";

/**
 * Data-access layer for classes (Task 1 §7.1.2).
 *
 * A thin pass-through to the seeded data module today. Phase 2 replaces the
 * bodies of these two functions with Prisma queries — the service layer and
 * API routes that call them do not change.
 */
export { getClasses, getClass };
