import "server-only";

import { findById, setPlan } from "@/lib/users";

/**
 * Data-access layer for member accounts (Task 1 §7.1.2), scoped to what the
 * service layer needs (membership status). Account creation and credential
 * checks stay in `users.ts` / `actions/auth.ts` — out of scope for this
 * contribution, see README.
 */
export { findById, setPlan };
