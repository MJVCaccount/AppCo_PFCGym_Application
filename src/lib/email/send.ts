import "server-only";

import { Resend } from "resend";

import { logger } from "@/lib/logger";

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

export async function sendEmail(email: OutgoingEmail): Promise<boolean> {
  const summary = { toDomain: domainOf(email.to), subject: email.subject };

  try {
    const key = process.env.RESEND_API_KEY?.trim();
    const from = process.env.EMAIL_FROM?.trim();

    if (!key || !from) {
      if (process.env.NODE_ENV === "production") {
        logger.error("Email not sent: RESEND_API_KEY or EMAIL_FROM is missing", summary);
      } else {
        logger.info("Email skipped: RESEND_API_KEY or EMAIL_FROM is not set", summary);
      }
      return false;
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
      logger.error("Email provider refused the message", {
        ...summary,
        errorName: error.name,
      });
      return false;
    }

    return true;
  } catch (e) {
    logger.error("Email send failed", { ...summary, error: e });
    return false;
  }
}
