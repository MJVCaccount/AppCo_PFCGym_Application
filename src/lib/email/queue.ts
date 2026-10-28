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
  deferWork(() => start(build, onResult));
}

/**
 * Runs `work` once the response has been sent, and keeps the serverless
 * function alive until it finishes. Outside a request (a script or a test)
 * there is nothing to defer to, so it starts now; `flushEmails` waits for it.
 */
export function deferWork(work: () => Promise<void>): void {
  const tracked = () => {
    const running = work().catch((e: unknown) => {
      logger.error("Deferred work failed", { error: e });
    });
    inFlight.add(running);
    void running.finally(() => inFlight.delete(running));
    return running;
  };

  try {
    after(tracked);
  } catch {
    void tracked();
  }
}

/** Waits for every queued email to finish. For tests and scripts. */
export async function flushEmails(): Promise<void> {
  while (inFlight.size > 0) await Promise.all([...inFlight]);
}
