import "server-only";

/**
 * Invitations for accounts an admin creates on someone's behalf.
 *
 * An object rather than bare functions so a caller reaches it as
 * `inviteService.sendCoachInvite(...)` and a test can stand in for it.
 */
export const inviteService = {
  /**
   * Tells a newly created coach how to set their password.
   *
   * Nothing is sent yet: the invite email arrives with the email work. The
   * coach service already calls this at the right moment, after the account
   * is committed, so only this body has to change.
   */
  async sendCoachInvite(userId: number): Promise<void> {
    void userId;
  },
};
