import "server-only";

import { bookSlot, getSlot } from "@/lib/repositories/timetableRepository";
import { findById } from "@/lib/repositories/membersRepository";
import type { SessionUser, TimetableSlot } from "@/lib/types";

/**
 * Business rules for reserving a class (Task 1 §7.1.1, "Booking Service").
 *
 * Takes the session as a parameter rather than reading it itself, so this
 * function has no dependency on `next/headers` and can be unit tested
 * directly (see tests/api.test.ts) — only the API route and the server
 * action need a real request to resolve the session.
 */
export interface BookingResult {
  ok: boolean;
  status: number;
  error?: string;
  slot?: TimetableSlot;
}

export function createBooking(
  session: SessionUser,
  slotId: number,
): BookingResult {
  if (!Number.isInteger(slotId) || slotId <= 0) {
    return { ok: false, status: 400, error: "slotId must be a positive integer." };
  }

  const slot = getSlot(slotId);
  if (!slot) {
    return { ok: false, status: 404, error: "That class could not be found." };
  }

  // Membership status check. Coaches and admins are staff, not members (see
  // AppUser.planId in types.ts), so the check only applies to the Member role.
  if (session.role === "Member") {
    const account = findById(session.id);
    if (!account?.planId) {
      return {
        ok: false,
        status: 403,
        error: "An active membership plan is required to book a class.",
      };
    }
  }

  // Capacity check happens inside bookSlot. Confirmed classes it stays an
  // in-memory check-then-increment, not atomic — see that function's comment.
  const failure = bookSlot(slotId);
  if (failure) {
    return { ok: false, status: 409, error: failure };
  }

  return { ok: true, status: 201, slot: getSlot(slotId) };
}
