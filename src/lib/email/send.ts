import "server-only";

import { Resend } from "resend";

import { logger } from "@/lib/logger";

import { isSkipped, parseSkipList } from "./skipList";

/**
 * Sends one transactional email through Resend.
 *
 * It never throws and never logs the body: a failure is reported in the log
 * with the recipient's domain and the subject only, and the caller gets false.
 */

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

let client: { key: string; resend: Resend } | null = null;

function resendFor(key: string): Resend {
  if (!client || client.key !== key) client = { key, resend: new Resend(key) };
  return client.resend;
}

/** "someone@example.co.za" -> "example.co.za". The address itself is personal. */
function domainOf(address: string): string {
  const at = address.lastIndexOf("@");
  return at === -1 ? "unknown" : address.slice(at + 1).toLowerCase();
}

/**
 * What happened to one send.
 *
 *  - "skipped": nothing was sent and nothing will be: email is not configured,
 *    the address can never receive mail (a ".invalid" address), or it is on the
 *    operator's EMAIL_SKIP list (the demo accounts, whose addresses the sandbox
 *    sender cannot deliver to). The provider is not called at all. Skipped is not
 *    a failure: it is neither retried nor counted as a dead letter
 *  - "failed" with permanent: the provider refused the message for a reason a
 *    retry cannot change (an HTTP 4xx other than 408 and 429: a bad address, a
 *    domain that is not verified, an invalid key)
 *  - "failed" without permanent: worth trying again (429, 408, 5xx, or no
 *    answer at all)
 */
export type DeliveryResult =
  | { status: "sent" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string; permanent: boolean; statusCode: number | null };

/** True for an HTTP 4xx other than 408 (timeout) and 429 (rate limit): retrying cannot help. */
export function isPermanentStatus(statusCode: number | null | undefined): boolean {
  return (
    typeof statusCode === "number" &&
    statusCode >= 400 &&
    statusCode < 500 &&
    statusCode !== 408 &&
    statusCode !== 429
  );
}

/** ".invalid" is reserved (RFC 6761): it can never receive mail. */
export function isUndeliverableAddress(address: string): boolean {
  return /\.invalid$/i.test(address.trim());
}

/** A short, address-free reason for the outbox to keep. Handles Error objects and the plain objects the provider returns. */
function reasonOf(e: unknown, statusCode: number | null = null): string {
  const record = (typeof e === "object" && e !== null ? e : {}) as { name?: unknown; message?: unknown };
  const name = typeof record.name === "string" ? record.name : e instanceof Error ? e.name : "Error";
  const message = typeof record.message === "string" ? record.message : typeof e === "string" ? e : "no detail";
  const status = statusCode === null ? "" : `${statusCode} `;
  return `${status}${name}: ${message}`.replace(/\S+@\S+/g, "[address]").slice(0, 200);
}

export async function deliver(email: OutgoingEmail): Promise<DeliveryResult> {
  const summary = { toDomain: domainOf(email.to), subject: email.subject };

  try {
    if (isUndeliverableAddress(email.to)) {
      return { status: "skipped", reason: "The address ends in .invalid and can never receive mail." };
    }

    // EMAIL_SKIP: the demo and sandbox addresses an operator has listed. Checked
    // before the provider is called and before anything is logged, so the address
    // goes nowhere.
    if (isSkipped(email.to, parseSkipList(process.env.EMAIL_SKIP))) {
      return { status: "skipped", reason: "Address is on the EMAIL_SKIP list." };
    }

    const key = process.env.RESEND_API_KEY?.trim();
    const from = process.env.EMAIL_FROM?.trim();

    if (!key || !from) {
      if (process.env.NODE_ENV === "production") {
        logger.error("Email not sent: RESEND_API_KEY or EMAIL_FROM is missing", summary);
      } else {
        logger.info("Email skipped: RESEND_API_KEY or EMAIL_FROM is not set", summary);
      }
      return { status: "skipped", reason: "Email is not configured." };
    }

    const { error } = await resendFor(key).emails.send({
      from,
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      ...(email.replyTo ? { replyTo: email.replyTo } : {}),
    });

    if (error) {
      const statusCode = typeof error.statusCode === "number" ? error.statusCode : null;
      logger.error("Email provider refused the message", {
        ...summary,
        errorName: error.name,
        statusCode,
      });
      return {
        status: "failed",
        error: reasonOf(error, statusCode),
        permanent: isPermanentStatus(statusCode),
        statusCode,
      };
    }

    return { status: "sent" };
  } catch (e) {
    // No answer at all (network, DNS, timeout): worth another try.
    logger.error("Email send failed", { ...summary, error: e });
    return { status: "failed", error: reasonOf(e), permanent: false, statusCode: null };
  }
}

export async function sendEmail(email: OutgoingEmail): Promise<boolean> {
  return (await deliver(email)).status === "sent";
}
