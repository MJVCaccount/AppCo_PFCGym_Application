import { inflateSync } from "node:zlib";

/**
 * Content checks on an uploaded file, after its real type is known from its
 * first bytes (see sniffType in uploads.ts). Pure functions on bytes; nothing
 * is decoded for display and nothing is executed.
 *
 *  - A PDF is refused when it holds an action that can run code or start a
 *    program when it is opened: /JavaScript, /JS, /Launch, /OpenAction.
 *  - An image is refused when its header is malformed or claims dimensions
 *    that would take a huge amount of memory to decode (a decompression bomb:
 *    a few kilobytes of PNG that expand to gigabytes of pixels).
 */

// ---------------------------------------------------------------- images

/** Largest width or height, in pixels. */
export const MAX_IMAGE_SIDE = 12_000;
/** Largest picture, in pixels: 50 MP for a document photo, 25 MP for a site image. */
export const MAX_DOCUMENT_PIXELS = 50_000_000;
export const MAX_SITE_IMAGE_PIXELS = 25_000_000;

export interface Dimensions {
  width: number;
  height: number;
}

const u16be = (b: Uint8Array, o: number) => ((b[o] ?? 0) << 8) | (b[o + 1] ?? 0);
const u32be = (b: Uint8Array, o: number) =>
  ((b[o] ?? 0) * 0x1000000) + (((b[o + 1] ?? 0) << 16) | ((b[o + 2] ?? 0) << 8) | (b[o + 3] ?? 0));
const u16le = (b: Uint8Array, o: number) => (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8);
const u24le = (b: Uint8Array, o: number) =>
  (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) | ((b[o + 2] ?? 0) << 16);

function ascii(b: Uint8Array, o: number, length: number): string {
  return String.fromCharCode(...b.subarray(o, o + length));
}

function pngSize(b: Uint8Array): Dimensions | null {
  // 8-byte signature, then the IHDR chunk: length(4) "IHDR"(4) width(4) height(4).
  if (b.length < 24 || ascii(b, 12, 4) !== "IHDR") return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

function jpegSize(b: Uint8Array): Dimensions | null {
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    while (b[i] === 0xff) i++; // fill bytes
    const marker = b[i] ?? 0;
    i++;

    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || marker === 0xda) return null; // end, or pixel data with no frame header

    const length = u16be(b, i);
    if (length < 2) return null;

    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) {
      if (i + 7 > b.length) return null;
      return { height: u16be(b, i + 3), width: u16be(b, i + 5) };
    }
    i += length;
  }
  return null;
}

function webpSize(b: Uint8Array): Dimensions | null {
  if (b.length < 30 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return null;

  const chunk = ascii(b, 12, 4);
  if (chunk === "VP8 ") {
    // Frame header after the 3-byte frame tag: start code 9d 01 2a, then 14-bit sizes.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return null;
    const bits = (b[21] ?? 0) | ((b[22] ?? 0) << 8) | ((b[23] ?? 0) << 16) | ((b[24] ?? 0) * 0x1000000);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") {
    return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
  }
  return null;
}

/** Pixel size read from the file header only, or null if the header is not valid. */
export function imageDimensions(bytes: Uint8Array, mediaType: string): Dimensions | null {
  if (mediaType === "image/png") return pngSize(bytes);
  if (mediaType === "image/jpeg") return jpegSize(bytes);
  if (mediaType === "image/webp") return webpSize(bytes);
  return null;
}

/** A sentence for the user when the image should be refused, else null. */
export function inspectImage(
  bytes: Uint8Array,
  mediaType: string,
  maxPixels: number,
): string | null {
  const size = imageDimensions(bytes, mediaType);
  if (!size || size.width < 1 || size.height < 1) {
    return "That image could not be read. Save it again and retry.";
  }
  if (size.width > MAX_IMAGE_SIDE || size.height > MAX_IMAGE_SIDE || size.width * size.height > maxPixels) {
    return "That image is too large in pixels. Use a smaller picture.";
  }
  return null;
}

// ---------------------------------------------------------------- PDF

const ACTIVE = /\/(JavaScript|JS|Launch|OpenAction)(?![A-Za-z0-9_.+-])/;

/** Inflated size limits, so scanning a PDF cannot itself be a bomb. */
const MAX_STREAM_OUTPUT = 8 * 1024 * 1024;
const MAX_TOTAL_OUTPUT = 32 * 1024 * 1024;
const MAX_STREAMS = 2_000;

/** `/J#61vaScript` is the same name as `/JavaScript`: undo PDF's #xx escapes before looking. */
function unescapeNames(text: string): string {
  return text.replace(/#([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function hasActiveContent(text: string): boolean {
  return ACTIVE.test(unescapeNames(text));
}

/**
 * True when the PDF holds /JavaScript, /JS, /Launch or /OpenAction, also when
 * hidden in a compressed stream (object streams pack many objects into one
 * Flate stream). Streams with another filter are not opened; that is a known
 * limit, written down in docs/task3/security-controls.md.
 */
export function pdfHasActiveContent(bytes: Uint8Array): boolean {
  const raw = Buffer.from(bytes).toString("latin1");
  if (hasActiveContent(raw)) return true;

  let total = 0;
  let count = 0;
  const pattern = /stream\r?\n/g;
  for (let match = pattern.exec(raw); match; match = pattern.exec(raw)) {
    if (++count > MAX_STREAMS) return true; // an absurd number of streams is not a medical certificate
    const start = match.index + match[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;

    try {
      const inflated = inflateSync(bytes.subarray(start, end), { maxOutputLength: MAX_STREAM_OUTPUT });
      total += inflated.length;
      if (total > MAX_TOTAL_OUTPUT) return true;
      if (hasActiveContent(inflated.toString("latin1"))) return true;
    } catch (e) {
      // A stream that expands past the limit is a bomb and is refused. Any
      // other failure means it is not Flate data (an image, say): not inspectable.
      if ((e as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") return true;
    }
    pattern.lastIndex = end;
  }
  return false;
}

// ---------------------------------------------------------------- entry

/** Returns the sentence to refuse the upload with, or null when it is acceptable. */
export function inspectUpload(
  bytes: Uint8Array,
  mediaType: string,
  kind: "document" | "image",
): string | null {
  if (mediaType === "application/pdf") {
    return pdfHasActiveContent(bytes)
      ? "That PDF contains scripts or actions that run when it is opened, so it cannot be accepted. Save a plain copy and upload that."
      : null;
  }

  return inspectImage(
    bytes,
    mediaType,
    kind === "document" ? MAX_DOCUMENT_PIXELS : MAX_SITE_IMAGE_PIXELS,
  );
}
