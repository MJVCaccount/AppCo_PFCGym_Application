import "server-only";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { record as audit } from "@/lib/repositories/auditRepository";
import { optionalText } from "@/lib/text";
import type { Enquiry } from "@/lib/types";

/** Data-access layer for contact-form enquiries. */

const TRANSACTION_OPTIONS = { timeout: 10_000, maxWait: 10_000 };

const enquirySelect = {
  id: true,
  fullName: true,
  email: true,
  phone: true,
  message: true,
  createdAt: true,
  emailSentAt: true,
  handledAt: true,
} satisfies Prisma.ContactEnquirySelect;

type EnquiryRow = Prisma.ContactEnquiryGetPayload<{
  select: typeof enquirySelect;
}>;

function toEnquiry(row: EnquiryRow): Enquiry {
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    message: row.message,
    createdAt: row.createdAt.toISOString(),
    emailSentAt: row.emailSentAt?.toISOString() ?? null,
    handledAt: row.handledAt?.toISOString() ?? null,
  };
}

export interface EnquiryFields {
  fullName: string;
  email: string;
  phone?: string | null;
  message: string;
}

/** Saves one enquiry and returns its id. */
export async function createEnquiry(fields: EnquiryFields): Promise<number> {
  const row = await prisma.contactEnquiry.create({
    data: {
      fullName: fields.fullName.trim(),
      email: fields.email.trim(),
      phone: optionalText(fields.phone),
      message: fields.message.trim(),
    },
    select: { id: true },
  });

  return row.id;
}

/** Records that the gym's copy of an enquiry was emailed. */
export async function markEmailSent(id: number, at: Date): Promise<void> {
  await prisma.contactEnquiry.updateMany({
    where: { id },
    data: { emailSentAt: at },
  });
}

/** One page of enquiries: unhandled first, then newest first. */
export async function listEnquiries(options: {
  page: number;
  pageSize: number;
}): Promise<{ items: Enquiry[]; total: number }> {
  const [total, rows] = await prisma.$transaction([
    prisma.contactEnquiry.count(),
    prisma.contactEnquiry.findMany({
      // Unhandled rows (handledAt is null) first, whatever their age.
      orderBy: [
        { handledAt: { sort: "asc", nulls: "first" } },
        { createdAt: "desc" },
        { id: "desc" },
      ],
      skip: (options.page - 1) * options.pageSize,
      take: options.pageSize,
      select: enquirySelect,
    }),
  ]);

  return { total, items: rows.map(toEnquiry) };
}

export type SetHandledResult =
  | { ok: true; enquiry: Enquiry }
  | { ok: false; reason: "not-found" };

/** Marks an enquiry handled, or reopens it. The change is audited. */
export async function setHandled(
  id: number,
  handled: boolean,
  actorId: number,
  now: Date = new Date(),
): Promise<SetHandledResult> {
  try {
    return await prisma.$transaction(async (tx): Promise<SetHandledResult> => {
      const row = await tx.contactEnquiry.update({
        where: { id },
        data: { handledAt: handled ? now : null },
        select: enquirySelect,
      });
      await audit(
        {
          actorId,
          action: handled ? "enquiry.handle" : "enquiry.reopen",
          entity: "ContactEnquiry",
          entityId: id,
        },
        tx,
      );

      return { ok: true, enquiry: toEnquiry(row) };
    }, TRANSACTION_OPTIONS);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return { ok: false, reason: "not-found" };
    }
    throw e;
  }
}
