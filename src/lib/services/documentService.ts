import "server-only";

import { logger } from "@/lib/logger";
import {
  countForFighter,
  createDocument,
  deleteOwnDocument,
  fighterIdsWithApprovedMedical,
  getForAccess,
  listForFighter,
  listForReview,
  reviewDocument as reviewRow,
} from "@/lib/repositories/documentsRepository";
import { notifyDocumentReviewed } from "@/lib/services/notificationService";
import {
  ADMIN_ONLY,
  fail,
  failure,
  isAdmin,
  isOptionalString,
  isValidId,
  succeed,
} from "@/lib/services/serviceResult";
import { optionalText } from "@/lib/text";
import {
  DOCUMENT_TYPES,
  type DocumentType,
  type FighterDocument,
  ROLES,
  type ReviewDocument,
  type ServiceResult,
  type SessionUser,
} from "@/lib/types";
import {
  contentTypeForPathname,
  generatePathname,
  isStoreNotConfigured,
  privateBlobs,
  readUpload,
  sanitizeFileName,
} from "@/lib/uploads";

/**
 * Fighters' medical and licence documents.
 *
 * Special personal information under POPIA, so: stored in the private Blob
 * store, never reachable by a URL, and read back only through openDocument,
 * which answers 404 to everyone except the owner and an administrator.
 */

export const MAX_DOCUMENTS_PER_FIGHTER = 10;
const MAX_NOTE = 500;

const FIGHTERS_ONLY = "Only fighters can upload documents.";
const NOT_FOUND_DOCUMENT = "That document could not be found.";
const STORAGE_DOWN = "File storage is not available right now. Please try again later.";

/** A storage failure: the missing-configuration case is a 503, anything else a 502. */
function storageFailure<T>(e: unknown): ServiceResult<T> {
  logger.error("Document storage failed", { error: e });
  return fail(isStoreNotConfigured(e) ? 503 : 502, STORAGE_DOWN);
}

// ---------------------------------------------------------------- fighter

/**
 * Stores an uploaded document. `request` is a multipart POST with a `type`
 * (Medical, Licence or Other) and a `file`. The role is checked before the
 * body is read.
 */
export async function uploadFighterDocument(
  session: SessionUser,
  request: Request,
): Promise<ServiceResult<FighterDocument>> {
  if (session.role !== ROLES.Fighter) return fail(403, FIGHTERS_ONLY);

  const read = await readUpload(request, "document");
  if (!read.ok) return fail(read.status, read.error);
  const { bytes, mediaType, fileName, fields } = read.upload;

  const type = fields.get("type");
  if (typeof type !== "string" || !DOCUMENT_TYPES.includes(type as DocumentType)) {
    return fail(400, "Choose Medical, Licence or Other.", "type");
  }

  try {
    // Refuse before uploading anything when the limit is already reached.
    if ((await countForFighter(session.id)) >= MAX_DOCUMENTS_PER_FIGHTER) {
      return fail(409, `You can keep at most ${MAX_DOCUMENTS_PER_FIGHTER} documents. Delete one first.`);
    }

    const pathname = generatePathname("document", mediaType, session.id);
    try {
      await privateBlobs.put(pathname, bytes, mediaType);
    } catch (e) {
      return storageFailure(e);
    }

    let result: Awaited<ReturnType<typeof createDocument>>;
    try {
      result = await createDocument(
        { fighterId: session.id, type: type as DocumentType, fileName, pathname },
        MAX_DOCUMENTS_PER_FIGHTER,
      );
    } catch (e) {
      await removeBlob(pathname); // the row was not saved, so nothing points at it
      return failure(e);
    }

    if (!result.ok) {
      await removeBlob(pathname); // nothing points at it
      return result.reason === "limit"
        ? fail(409, `You can keep at most ${MAX_DOCUMENTS_PER_FIGHTER} documents. Delete one first.`)
        : fail(404, NOT_FOUND_DOCUMENT);
    }

    return succeed(result.document, 201);
  } catch (e) {
    return failure(e);
  }
}

/** The signed-in fighter's own documents, newest first. */
export async function listMyDocuments(
  session: SessionUser,
): Promise<ServiceResult<FighterDocument[]>> {
  if (session.role !== ROLES.Fighter) return fail(403, FIGHTERS_ONLY);

  try {
    return succeed(await listForFighter(session.id));
  } catch (e) {
    return failure(e);
  }
}

/**
 * Deletes the signed-in fighter's own document, but only while it is Pending
 * or Rejected. Someone else's document is "not found", never "forbidden".
 */
export async function deleteMyDocument(
  session: SessionUser,
  id: unknown,
): Promise<ServiceResult<{ id: number }>> {
  if (session.role !== ROLES.Fighter) return fail(403, FIGHTERS_ONLY);
  if (!isValidId(id)) return fail(404, NOT_FOUND_DOCUMENT);

  try {
    const result = await deleteOwnDocument(id, session.id);

    if (!result.ok) {
      return result.reason === "not-found"
        ? fail(404, NOT_FOUND_DOCUMENT)
        : fail(409, "An approved document cannot be deleted.");
    }

    await removeBlob(result.pathname);
    return succeed({ id });
  } catch (e) {
    return failure(e);
  }
}

/** Best effort: the row is already gone, so a failure is logged and not raised. */
async function removeBlob(pathname: string): Promise<void> {
  try {
    await privateBlobs.del(pathname);
  } catch (e) {
    logger.error("Could not delete a stored document", { pathname, error: e });
  }
}

// ---------------------------------------------------------------- download

export interface OpenedDocument {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  fileName: string;
}

/**
 * The file behind a document, for its owner or an administrator. Everyone
 * else, and every id that does not exist, gets the same 404, so ids cannot be
 * used to find out which documents exist.
 */
export async function openDocument(
  session: SessionUser,
  id: unknown,
): Promise<ServiceResult<OpenedDocument>> {
  if (!isValidId(id)) return fail(404, NOT_FOUND_DOCUMENT);

  try {
    const document = await getForAccess(id);
    const allowed =
      document !== undefined &&
      (isAdmin(session) ||
        (session.role === ROLES.Fighter && document.fighterId === session.id));
    if (!document || !allowed) return fail(404, NOT_FOUND_DOCUMENT);

    let stream: ReadableStream<Uint8Array> | null;
    try {
      stream = await privateBlobs.get(document.pathname);
    } catch (e) {
      return storageFailure(e);
    }
    if (!stream) return fail(404, NOT_FOUND_DOCUMENT);

    return succeed({
      stream,
      contentType: contentTypeForPathname(document.pathname),
      fileName: sanitizeFileName(document.fileName, "document"),
    });
  } catch (e) {
    return failure(e);
  }
}

// ---------------------------------------------------------------- admin

/** Every document, Pending first. Admin only. */
export async function listDocumentsForReview(
  session: SessionUser,
): Promise<ServiceResult<ReviewDocument[]>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);

  try {
    return succeed(await listForReview());
  } catch (e) {
    return failure(e);
  }
}

/** Ids of fighters with an Approved Medical document, for the offer form. Admin only. */
export async function listFightersWithApprovedMedical(
  session: SessionUser,
): Promise<ServiceResult<number[]>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);

  try {
    return succeed(await fighterIdsWithApprovedMedical());
  } catch (e) {
    return failure(e);
  }
}

/**
 * Approves or rejects a document, audits it and emails the fighter. A note is
 * required to reject, so the fighter knows what to fix. Admin only.
 */
export async function reviewDocument(
  session: SessionUser,
  id: unknown,
  decision: unknown,
  note: unknown,
  now: Date = new Date(),
): Promise<ServiceResult<FighterDocument>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);
  if (!isValidId(id)) return fail(400, "id must be a positive integer.");
  if (decision !== "Approved" && decision !== "Rejected") {
    return fail(400, 'decision must be "Approved" or "Rejected".');
  }
  if (!isOptionalString(note)) return fail(400, "The note must be text.", "note");

  const text = optionalText(note);
  if (decision === "Rejected" && text === null) {
    return fail(400, "Say why the document is rejected.", "note");
  }
  if (text !== null && text.length > MAX_NOTE) {
    return fail(400, `The note must be at most ${MAX_NOTE} characters.`, "note");
  }

  try {
    const result = await reviewRow(id, decision, text, session.id, now);

    if (!result.ok) {
      return result.reason === "not-found"
        ? fail(404, NOT_FOUND_DOCUMENT)
        : fail(409, `That document is already ${decision.toLowerCase()}.`);
    }

    notifyDocumentReviewed(result.fighter, {
      documentType: result.document.type,
      status: decision,
      note: text,
    });

    return succeed(result.document);
  } catch (e) {
    return failure(e);
  }
}
