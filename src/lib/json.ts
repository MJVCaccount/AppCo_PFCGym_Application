import "server-only";

import { NextResponse } from "next/server";

/**
 * Reads a JSON request body with the checks a route should always make:
 * the Content-Type must be JSON (415), the body must fit in `maxBytes` (413),
 * and it must parse (400). Failures carry the standard `{ error: { message } }`
 * body, so a route returns `result.response` as it is.
 */

export type JsonRead =
  | { ok: true; data: unknown }
  | { ok: false; response: NextResponse };

export const DEFAULT_JSON_MAX_BYTES = 100_000;

function reject(status: number, message: string): JsonRead {
  return {
    ok: false,
    response: NextResponse.json({ error: { message } }, { status }),
  };
}

export async function readJson(
  request: Request,
  maxBytes: number = DEFAULT_JSON_MAX_BYTES,
): Promise<JsonRead> {
  const contentType = request.headers.get("content-type") ?? "";
  const mediaType = contentType.split(";")[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    return reject(415, "Content-Type must be application/json.");
  }

  const tooLarge = () =>
    reject(413, `Request body must be at most ${maxBytes} bytes.`);

  // The declared size is only a hint, so the body is counted as it is read.
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge();

  const chunks: Uint8Array[] = [];
  let total = 0;

  if (request.body) {
    const reader = request.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          return tooLarge();
        }
        chunks.push(value);
      }
    } catch {
      return reject(400, "Request body could not be read.");
    }
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks),
    );
    return { ok: true, data: JSON.parse(text) };
  } catch {
    return reject(400, "Request body must be valid JSON.");
  }
}
