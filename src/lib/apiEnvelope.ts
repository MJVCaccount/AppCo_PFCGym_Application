import "server-only";

import { NextResponse } from "next/server";

import { currentRequestId } from "@/lib/requestContext";

/**
 * The error body every JSON route answers with:
 *
 *   { "error": { "message": "...", "code": "NOT_FOUND", "requestId": "..." } }
 *
 * `message` is written for people and may be reworded; `code` is stable and
 * is what a client should branch on. `requestId` matches the X-Request-Id
 * response header and the server log line, so a report can be traced.
 */

export type ErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "CROSS_ORIGIN"
  | "NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "RATE_LIMITED"
  | "INTERNAL"
  | "STORAGE_ERROR"
  | "UNAVAILABLE";

export const ERROR_CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: "INVALID_REQUEST",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  405: "METHOD_NOT_ALLOWED",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  429: "RATE_LIMITED",
  500: "INTERNAL",
  502: "STORAGE_ERROR",
  503: "UNAVAILABLE",
};

export function errorCodeFor(status: number): ErrorCode {
  return (
    ERROR_CODE_BY_STATUS[status] ??
    (status >= 500 ? "INTERNAL" : "INVALID_REQUEST")
  );
}

export function jsonError(
  message: string,
  status: number,
  code: ErrorCode = errorCodeFor(status),
): NextResponse {
  const requestId = currentRequestId();

  return NextResponse.json(
    { error: { message, code, ...(requestId ? { requestId } : {}) } },
    { status },
  );
}
