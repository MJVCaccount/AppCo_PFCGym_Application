/**
 * Minimal upload fixtures with headers real enough for the content checks in
 * src/lib/uploadInspection.ts: the type signature plus the size fields. The
 * rest of a file is padding, which is all the checks read.
 */

function u32be(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}

/** PNG signature and an IHDR chunk claiming width x height. */
export function pngHead(width = 100, height = 100): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    u32be(13),
    Buffer.from("IHDR"),
    u32be(width),
    u32be(height),
    Buffer.from([8, 2, 0, 0, 0]),
  ]);
}

/** JPEG: SOI, a JFIF segment, then a baseline frame header (SOF0) claiming width x height. */
export function jpegHead(width = 100, height = 100): Buffer {
  const jfif = Buffer.from([0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof = Buffer.from([0xff, 0xc0, 0, 17, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), jfif, sof]);
}

/** WebP in the extended (VP8X) form, claiming width x height. */
export function webpHead(width = 100, height = 100): Buffer {
  const le24 = (n: number) => Buffer.from([n & 255, (n >> 8) & 255, (n >> 16) & 255]);
  const body = Buffer.concat([Buffer.from("WEBP"), Buffer.from("VP8X"), Buffer.from([10, 0, 0, 0]), Buffer.from([0, 0, 0, 0]), le24(width - 1), le24(height - 1)]);
  return Buffer.concat([Buffer.from("RIFF"), Buffer.from([body.length & 255, (body.length >> 8) & 255, 0, 0]), body]);
}

/** Pads a header with filler bytes up to `totalBytes`. */
export function padded(head: Buffer, totalBytes: number): Buffer {
  return Buffer.concat([head, Buffer.alloc(Math.max(0, totalBytes - head.length), 1)]);
}

/** A small PDF with the given body text after the header. */
export function pdfWith(body = ""): Buffer {
  return Buffer.from(`%PDF-1.7\n${body}\n%%EOF\n`);
}
