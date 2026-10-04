import "server-only";

import { randomUUID } from "node:crypto";

import { del, get, put } from "@vercel/blob";

/**
 * File uploads: what is accepted, how it is checked, where it is stored.
 *
 * Two Blob stores, never mixed up:
 *   - public  (PUBLIC_BLOB_STORE_ID):  coach and event images, public by design;
 *   - private (PRIVATE_BLOB_STORE_ID): fighters' medical and licence documents,
 *     which are special personal information and are only ever read back
 *     through an authenticated route.
 *
 * On Vercel the stores are connected with OIDC, so no read-write token exists
 * and the store id is all the SDK needs. For local work a token may be set
 * (PUBLIC_BLOB_READ_WRITE_TOKEN / PRIVATE_BLOB_READ_WRITE_TOKEN); otherwise
 * the short-lived VERCEL_OIDC_TOKEN from `vercel env pull` is used. Nothing
 * here relies on the SDK's default BLOB_* variable names.
 */

// ---------------------------------------------------------------- limits

export const DOCUMENT_MAX_BYTES = 4 * 1024 * 1024;
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024;

/** A multipart body is a little bigger than the file inside it. */
const MULTIPART_SLACK_BYTES = 64 * 1024;

export type UploadKind = "document" | "image";

export const DOCUMENT_TYPES_ALLOWED = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;
export const IMAGE_TYPES_ALLOWED = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

const LIMITS: Record<
  UploadKind,
  { maxBytes: number; types: readonly string[]; label: string }
> = {
  document: {
    maxBytes: DOCUMENT_MAX_BYTES,
    types: DOCUMENT_TYPES_ALLOWED,
    label: "PDF, JPEG or PNG",
  },
  image: {
    maxBytes: IMAGE_MAX_BYTES,
    types: IMAGE_TYPES_ALLOWED,
    label: "JPEG, PNG or WebP",
  },
};

const EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const TYPE_BY_EXTENSION: Record<string, string> = Object.fromEntries(
  Object.entries(EXTENSIONS).map(([type, extension]) => [extension, type]),
);

// ---------------------------------------------------------------- sniffing

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return (
    bytes.length >= offset + signature.length &&
    signature.every((value, index) => bytes[offset + index] === value)
  );
}

/**
 * The real type of a file, from its first bytes. The browser's Content-Type
 * and the file extension are chosen by the sender and are never consulted.
 * Null means "not one of the four types the app accepts".
 */
export function sniffType(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && // RIFF
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8) // ....WEBP
  ) {
    return "image/webp";
  }
  return null;
}

/** The media type for a stored pathname, from our own generated extension. */
export function contentTypeForPathname(pathname: string): string {
  const extension = pathname.slice(pathname.lastIndexOf(".") + 1).toLowerCase();
  return TYPE_BY_EXTENSION[extension] ?? "application/octet-stream";
}

// ---------------------------------------------------------------- names

/**
 * A file name that is safe to store and to put in a header: no path pieces,
 * control characters or characters with special meaning, at most 100 long.
 * This is only ever a label; it is never part of a storage path.
 */
export function sanitizeFileName(name: unknown, fallback = "upload"): string {
  const base = typeof name === "string" ? name : "";
  const cleaned = base
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|;,%]+/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^[.\s_]+/, "")
    .trim();

  if (cleaned === "") return fallback;
  if (cleaned.length <= 100) return cleaned;

  // Cut the middle, not the end, so the extension survives.
  const dot = cleaned.lastIndexOf(".");
  const extension = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : "";
  return cleaned.slice(0, 100 - extension.length) + extension;
}

/**
 * A Content-Disposition header that forces a download. The plain `filename` is
 * ASCII only (anything else becomes "_"); `filename*` carries the real name.
 */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** The storage pathname for an upload. Generated; the client's name is never used. */
export function generatePathname(
  kind: UploadKind,
  mediaType: string,
  fighterId?: number,
): string {
  const extension = EXTENSIONS[mediaType];
  if (!extension) throw new Error("Unsupported media type for a pathname");

  return kind === "document"
    ? `fighter-docs/${fighterId}/${randomUUID()}.${extension}`
    : `images/${randomUUID()}.${extension}`;
}

// ---------------------------------------------------------------- reading

export interface ReadUpload {
  bytes: Buffer;
  mediaType: string;
  /** The sanitised original name, for the database only. */
  fileName: string;
  fields: FormData;
}

export type ReadUploadResult =
  | { ok: true; upload: ReadUpload }
  | { ok: false; status: number; error: string };

function refuse(status: number, error: string): ReadUploadResult {
  return { ok: false, status, error };
}

function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/**
 * Reads a multipart request holding a `file` field and checks it: size (twice,
 * once from the header before reading and once on the real bytes) and real
 * type from magic bytes.
 */
export async function readUpload(
  request: Request,
  kind: UploadKind,
): Promise<ReadUploadResult> {
  const limit = LIMITS[kind];
  const tooBig = `That file is too large. The limit is ${megabytes(limit.maxBytes)}.`;

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit.maxBytes + MULTIPART_SLACK_BYTES) {
    return refuse(413, tooBig);
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return refuse(400, "Send the file as multipart form data.");
  }

  let fields: FormData;
  try {
    fields = await request.formData();
  } catch {
    return refuse(400, "The upload could not be read.");
  }

  const file = fields.get("file");
  if (!(file instanceof File)) return refuse(400, "Choose a file to upload.");
  if (file.size === 0) return refuse(400, "That file is empty.");
  if (file.size > limit.maxBytes) return refuse(413, tooBig);

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length > limit.maxBytes) return refuse(413, tooBig);

  const mediaType = sniffType(bytes);
  if (!mediaType || !limit.types.includes(mediaType)) {
    return refuse(415, `That file type is not allowed. Use a ${limit.label} file.`);
  }

  return {
    ok: true,
    upload: {
      bytes,
      mediaType,
      fileName: sanitizeFileName(file.name),
      fields,
    },
  };
}

// ---------------------------------------------------------------- stores

interface StoreOptions {
  storeId: string;
  token?: string;
}

class StoreNotConfigured extends Error {
  constructor(variable: string) {
    super(`${variable} is not set`);
    this.name = "StoreNotConfigured";
  }
}

export function isStoreNotConfigured(e: unknown): boolean {
  return e instanceof StoreNotConfigured;
}

function storeOptions(idVariable: string, tokenVariable: string): StoreOptions {
  const storeId = process.env[idVariable]?.trim();
  if (!storeId) throw new StoreNotConfigured(idVariable);

  const token = process.env[tokenVariable]?.trim();
  return token ? { storeId, token } : { storeId };
}

const publicOptions = () =>
  storeOptions("PUBLIC_BLOB_STORE_ID", "PUBLIC_BLOB_READ_WRITE_TOKEN");
const privateOptions = () =>
  storeOptions("PRIVATE_BLOB_STORE_ID", "PRIVATE_BLOB_READ_WRITE_TOKEN");

/** Public images: anyone with the URL can read them, by design. */
export const publicBlobs = {
  async put(pathname: string, body: Buffer, contentType: string): Promise<string> {
    const result = await put(pathname, body, {
      access: "public",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: false,
      ...publicOptions(),
    });
    return result.url;
  },

  async del(pathname: string): Promise<void> {
    await del(pathname, publicOptions());
  },
};

/** Fighter documents: readable only through the authenticated download route. */
export const privateBlobs = {
  async put(pathname: string, body: Buffer, contentType: string): Promise<void> {
    await put(pathname, body, {
      access: "private",
      contentType,
      addRandomSuffix: false,
      allowOverwrite: false,
      ...privateOptions(),
    });
  },

  /** The file as a stream, or null when the store has no such pathname. */
  async get(pathname: string): Promise<ReadableStream<Uint8Array> | null> {
    const result = await get(pathname, { access: "private", ...privateOptions() });
    return result && result.statusCode === 200 ? result.stream : null;
  },

  async del(pathname: string): Promise<void> {
    await del(pathname, privateOptions());
  },
};
