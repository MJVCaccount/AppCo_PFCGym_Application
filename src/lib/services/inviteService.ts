import "server-only";

import { findById } from "@/lib/repositories/usersRepository";
import { sendInvite } from "@/lib/services/passwordService";

/**
 * Invitations for accounts an admin creates on someone's behalf.
 *
 * An object rather than bare functions so a caller reaches it as
 * `inviteService.sendCoachInvite(...)` and a test can stand in for it.
 */
export const inviteService = {
  /**
   * Tells a coach how to set their password: a single-use link, valid for 7
   * days, sent by email. Any earlier unused link for the account stops
   * working. `actorId` is the admin, for the audit trail.
   *
   * It throws if the account cannot be found or the token cannot be stored;
   * the coach service catches that, so a failed invite never undoes the coach.
   */
  async sendCoachInvite(userId: number, actorId: number): Promise<void> {
    const user = await findById(userId);
    if (!user || !user.isActive) {
      throw new Error(`No active account ${userId} to invite`);
    }

    await sendInvite(user, actorId);
  },
};
