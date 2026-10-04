import "server-only";

import {
  createEnquiry,
  listEnquiries,
  markEmailSent,
  setHandled,
} from "@/lib/repositories/contactRepository";
import { notifyEnquiry } from "@/lib/services/notificationService";
import {
  ADMIN_ONLY,
  fail,
  failure,
  INVALID_INPUT,
  isAdmin,
  isOptionalString,
  isRecord,
  isValidId,
  succeed,
} from "@/lib/services/serviceResult";
import { optionalText } from "@/lib/text";
import type { EnquiryPage, ServiceResult, SessionUser } from "@/lib/types";
import { RULES } from "@/lib/validation";

/**
 * The contact form and the admin inbox behind it.
 *
 * submitEnquiry is public: anyone may write to the gym. It saves the message
 * first and only then queues the emails, so the visitor's message is never
 * lost to a mail outage.
 */

const ENQUIRIES_PAGE_SIZE = 25;
const MAX_PAGE = 10_000;
const NOT_FOUND_ENQUIRY = "That enquiry could not be found.";

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function submitEnquiry(
  input: unknown,
): Promise<ServiceResult<{ id: number }>> {
  if (!isRecord(input)) return fail(400, INVALID_INPUT);
  if (!isOptionalString(input.phone)) {
    return fail(400, "Enter a valid phone number, or leave it blank.", "phone");
  }

  const fullName = asText(input.fullName);
  const email = asText(input.email);
  const phone = optionalText(input.phone);
  const message = asText(input.message);

  const checks: [string, string | null][] = [
    ["fullName", RULES.name(fullName)],
    ["email", RULES.email(email)],
    ["phone", RULES.phone(phone ?? "")],
    ["message", RULES.message(message)],
  ];
  for (const [field, error] of checks) {
    if (error) return fail(400, error, field);
  }

  let id: number;
  try {
    id = await createEnquiry({ fullName, email, phone, message });
  } catch (e) {
    return failure(e);
  }

  const saved = {
    fullName: fullName.trim(),
    email: email.trim(),
    phone,
    message: message.trim(),
  };
  notifyEnquiry(saved, async (sent) => {
    if (sent) await markEmailSent(id, new Date());
  });

  return succeed({ id }, 201);
}

/** One page of the inbox, unhandled first and then newest first. Admin only. */
export async function listInbox(
  session: SessionUser,
  query: unknown = {},
): Promise<ServiceResult<EnquiryPage>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);
  if (!isRecord(query)) return fail(400, INVALID_INPUT);

  const page = query.page ?? 1;
  if (
    typeof page !== "number" ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > MAX_PAGE
  ) {
    return fail(400, "Page must be a positive whole number.", "page");
  }

  try {
    const { items, total } = await listEnquiries({
      page,
      pageSize: ENQUIRIES_PAGE_SIZE,
    });

    return succeed({
      items,
      total,
      page,
      pageSize: ENQUIRIES_PAGE_SIZE,
      pageCount: Math.max(1, Math.ceil(total / ENQUIRIES_PAGE_SIZE)),
    });
  } catch (e) {
    return failure(e);
  }
}

/** Marks an enquiry handled, or reopens it. Admin only; the change is audited. */
export async function setEnquiryHandled(
  session: SessionUser,
  id: unknown,
  handled: unknown,
  now: Date = new Date(),
): Promise<ServiceResult<{ id: number; handled: boolean }>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);
  if (!isValidId(id)) return fail(400, "id must be a positive integer.");
  if (typeof handled !== "boolean") {
    return fail(400, "handled must be true or false.");
  }

  try {
    const result = await setHandled(id, handled, session.id, now);

    return result.ok
      ? succeed({ id, handled })
      : fail(404, NOT_FOUND_ENQUIRY);
  } catch (e) {
    return failure(e);
  }
}
