import "server-only";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { record as audit } from "@/lib/repositories/auditRepository";
import type {
  DocumentStatus,
  DocumentType,
  FighterDocument,
  ReviewDocument,
} from "@/lib/types";

/**
 * Data-access layer for fighters' documents (FighterDocument rows).
 *
 * IMPORTANT: the `fileUrl` column holds the blob PATHNAME in the private
 * store (fighter-docs/<fighterId>/<uuid>.<ext>), not a URL. The file is only
 * ever read back with get(pathname, { access: 'private' }) through the
 * authenticated download route, so no URL that works on its own exists. The
 * column name is kept so the schema did not have to change.
 */

const TRANSACTION_OPTIONS = { timeout: 10_000, maxWait: 10_000 };
const MAX_LISTED = 200;

const documentSelect = {
  id: true,
  type: true,
  fileName: true,
  status: true,
  reviewNote: true,
  reviewedAt: true,
  uploadedAt: true,
  fighterId: true,
} satisfies Prisma.FighterDocumentSelect;

type DocumentRow = Prisma.FighterDocumentGetPayload<{
  select: typeof documentSelect;
}>;

function toDocument(row: DocumentRow): FighterDocument {
  return {
    id: row.id,
    type: row.type,
    fileName: row.fileName,
    status: row.status,
    reviewNote: row.reviewNote,
    uploadedAt: row.uploadedAt.toISOString(),
  };
}

function hasCode(e: unknown, code: string): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === code;
}

// ---------------------------------------------------------------- reads

export async function countForFighter(fighterId: number): Promise<number> {
  return prisma.fighterDocument.count({ where: { fighterId } });
}

/** A fighter's own documents, newest first. */
export async function listForFighter(
  fighterId: number,
): Promise<FighterDocument[]> {
  const rows = await prisma.fighterDocument.findMany({
    where: { fighterId },
    orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
    take: MAX_LISTED,
    select: documentSelect,
  });

  return rows.map(toDocument);
}

/** The review queue: Pending first, then the rest, newest first. */
export async function listForReview(): Promise<ReviewDocument[]> {
  const rows = await prisma.fighterDocument.findMany({
    // Newest first; the Pending ones are lifted to the front below.
    orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
    take: MAX_LISTED,
    select: {
      ...documentSelect,
      fighter: {
        select: { member: { select: { user: { select: { fullName: true } } } } },
      },
    },
  });

  const items = rows.map((row) => ({
    ...toDocument(row),
    fighterId: row.fighterId,
    fighterName: row.fighter.member.user.fullName,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
  }));

  return [
    ...items.filter((item) => item.status === "Pending"),
    ...items.filter((item) => item.status !== "Pending"),
  ];
}

export interface DocumentAccess {
  id: number;
  fighterId: number;
  fileName: string;
  /** The blob pathname (see the note at the top of this file). */
  pathname: string;
}

/** What the download route needs to decide access and fetch the file. */
export async function getForAccess(
  id: number,
): Promise<DocumentAccess | undefined> {
  const row = await prisma.fighterDocument.findUnique({
    where: { id },
    select: { id: true, fighterId: true, fileName: true, fileUrl: true },
  });

  return row
    ? {
        id: row.id,
        fighterId: row.fighterId,
        fileName: row.fileName,
        pathname: row.fileUrl,
      }
    : undefined;
}

/** Ids of fighters who have an Approved Medical document. */
export async function fighterIdsWithApprovedMedical(): Promise<number[]> {
  const rows = await prisma.fighterDocument.findMany({
    where: { type: "Medical", status: "Approved" },
    distinct: ["fighterId"],
    select: { fighterId: true },
  });

  return rows.map((row) => row.fighterId);
}

// ---------------------------------------------------------------- writes

export type CreateDocumentResult =
  | { ok: true; document: FighterDocument }
  | { ok: false; reason: "limit" | "fighter-not-found" };

/**
 * Records an uploaded document, unless the fighter already has `maxDocuments`.
 * The fighter row is locked first, so two uploads at once cannot both slip
 * under the limit.
 */
export async function createDocument(
  input: {
    fighterId: number;
    type: DocumentType;
    fileName: string;
    pathname: string;
  },
  maxDocuments: number,
): Promise<CreateDocumentResult> {
  try {
    return await prisma.$transaction(async (tx): Promise<CreateDocumentResult> => {
      const locked = await tx.$queryRaw<{ fighterId: number }[]>`
        SELECT "fighterId" FROM "Fighter"
        WHERE "fighterId" = ${input.fighterId} FOR UPDATE`;
      if (locked.length === 0) return { ok: false, reason: "fighter-not-found" };

      const count = await tx.fighterDocument.count({
        where: { fighterId: input.fighterId },
      });
      if (count >= maxDocuments) return { ok: false, reason: "limit" };

      const row = await tx.fighterDocument.create({
        data: {
          fighterId: input.fighterId,
          type: input.type,
          fileName: input.fileName,
          fileUrl: input.pathname,
        },
        select: documentSelect,
      });

      return { ok: true, document: toDocument(row) };
    }, TRANSACTION_OPTIONS);
  } catch (e) {
    if (hasCode(e, "P2003")) return { ok: false, reason: "fighter-not-found" };
    throw e;
  }
}

export type DeleteDocumentResult =
  | { ok: true; pathname: string }
  | { ok: false; reason: "not-found" | "not-deletable" };

/**
 * Deletes a fighter's own document while it is Pending or Rejected. The row
 * is locked first so an admin approving it at the same moment is not raced:
 * either the approval lands and this refuses, or this lands and the approval
 * finds nothing. An Approved document is kept.
 */
export async function deleteOwnDocument(
  id: number,
  fighterId: number,
): Promise<DeleteDocumentResult> {
  return prisma.$transaction(async (tx): Promise<DeleteDocumentResult> => {
    const [row] = await tx.$queryRaw<
      { status: DocumentStatus; fileUrl: string }[]
    >`SELECT "status"::text AS "status", "fileUrl" FROM "FighterDocument"
      WHERE "id" = ${id} AND "fighterId" = ${fighterId} FOR UPDATE`;

    if (!row) return { ok: false, reason: "not-found" };
    if (row.status === "Approved") return { ok: false, reason: "not-deletable" };

    await tx.fighterDocument.delete({ where: { id } });
    return { ok: true, pathname: row.fileUrl };
  }, TRANSACTION_OPTIONS);
}

export type ReviewDocumentResult =
  | {
      ok: true;
      document: FighterDocument;
      fighter: { fullName: string; email: string };
    }
  | { ok: false; reason: "not-found" | "unchanged" };

/**
 * Approves or rejects a document and audits it, in one transaction. A second
 * identical decision is refused so the fighter is not emailed twice.
 */
export async function reviewDocument(
  id: number,
  decision: "Approved" | "Rejected",
  note: string | null,
  actorId: number,
  now: Date = new Date(),
): Promise<ReviewDocumentResult> {
  return prisma.$transaction(async (tx): Promise<ReviewDocumentResult> => {
    const locked = await tx.$queryRaw<{ status: DocumentStatus }[]>`
      SELECT "status"::text AS "status" FROM "FighterDocument"
      WHERE "id" = ${id} FOR UPDATE`;
    if (locked.length === 0) return { ok: false, reason: "not-found" };
    if (locked[0].status === decision) return { ok: false, reason: "unchanged" };

    const row = await tx.fighterDocument.update({
      where: { id },
      data: { status: decision, reviewNote: note, reviewedAt: now },
      select: {
        ...documentSelect,
        fighter: {
          select: {
            member: { select: { user: { select: { fullName: true, email: true } } } },
          },
        },
      },
    });
    await audit(
      {
        actorId,
        action: decision === "Approved" ? "document.approve" : "document.reject",
        entity: "FighterDocument",
        entityId: id,
        detail: { type: row.type },
      },
      tx,
    );

    return {
      ok: true,
      document: toDocument(row),
      fighter: row.fighter.member.user,
    };
  }, TRANSACTION_OPTIONS);
}
