import "server-only";

import { after } from "next/server";

import { logger } from "@/lib/logger";

import { type OutgoingEmail, sendEmail } from "./send";

/**
 * Sends an email after the response has gone out, so the visitor never waits
 * for the mail provider and a failed email never fails or undoes the action
 * that caused it.
 *
 * `build` runs inside the deferred work, so a template error is also kept
 * away from the caller. Returning null means there is nothing to send.
 */
type Build = () => OutgoingEmail | null | Promise<OutgoingEmail | null>;

const inFlight = new Set<Promise<void>>();

/** Called with whether the email went out; a throw in it is logged, never raised. */
type OnResult = (sent: boolean) => void | Promise<void>;

async function run(build: Build, onResult?: OnResult): Promise<void> {
  try {
    const email = await build();
    const sent = email ? await sendEmail(email) : false;
    if (onResult) await onResult(sent);
  } catch (e) {
    logger.error("Queued email failed", { error: e });
  }
}

function start(build: Build, onResult?: OnResult): Promise<void> {
  const work = run(build, onResult);
  inFlight.add(work);
  void work.finally(() => inFlight.delete(work));
  return work;
}

export function queueEmail(build: Build, onResult?: OnResult): void {
  try {
    // Runs once the response has been sent, and keeps the serverless
    // function alive until the email is out.
    after(() => start(build, onResult));
  } catch {
    // Outside a request (a script or a test) there is nothing to defer to, so
    // start now; `flushEmails` can wait for it.
    void start(build, onResult);
  }
}

/** Waits for every queued email to finish. For tests and scripts. */
export async function flushEmails(): Promise<void> {
  while (inFlight.size > 0) await Promise.all([...inFlight]);
}
