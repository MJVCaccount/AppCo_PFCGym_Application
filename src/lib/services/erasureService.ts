import "server-only";

import { logger } from "@/lib/logger";
import { eraseUser as eraseRow } from "@/lib/repositories/usersRepository";
import {
  ADMIN_ONLY,
  fail,
  failure,
  isAdmin,
  isValidId,
  succeed,
} from "@/lib/services/serviceResult";
import type { ServiceResult, SessionUser } from "@/lib/types";
import { privateBlobs, publicBlobs } from "@/lib/uploads";

/**
 * Erasure on request (POPIA). An administrator anonymises one member or
 * fighter: see usersRepository.eraseUser for exactly what goes and what stays.
 * The files go after the database commit; a file that cannot be deleted is
 * logged with its path so it can be removed by hand, and does not undo the
 * erasure.
 */

export interface ErasureReport {
  id: number;
  documentsDeleted: number;
  bookingsCancelled: number;
}

export async function eraseAccount(
  session: SessionUser,
  userId: unknown,
  now: Date = new Date(),
): Promise<ServiceResult<ErasureReport>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);
  if (!isValidId(userId)) return fail(400, "userId must be a positive integer.");
  if (userId === session.id) {
    return fail(409, "You cannot erase your own account.");
  }

  try {
    const result = await eraseRow(userId, session.id, now);

    if (!result.ok) {
      switch (result.reason) {
        case "not-found":
          return fail(404, "That account could not be found.");
        case "protected-role":
          return fail(409, "Only member and fighter accounts can be erased. Deactivate or archive staff instead.");
        case "already-erased":
          return fail(409, "That account has already been erased.");
      }
    }

    for (const pathname of result.documentPathnames) {
      try {
        await privateBlobs.del(pathname);
      } catch (e) {
        logger.error("Erasure: could not delete a stored document", { userId, pathname, error: e });
      }
    }
    if (result.imageUrl) {
      try {
        await publicBlobs.del(result.imageUrl);
      } catch (e) {
        logger.error("Erasure: could not delete a profile image", { userId, error: e });
      }
    }

    return succeed({
      id: userId,
      documentsDeleted: result.documentPathnames.length,
      bookingsCancelled: result.bookingsCancelled,
    });
  } catch (e) {
    return failure(e);
  }
}
