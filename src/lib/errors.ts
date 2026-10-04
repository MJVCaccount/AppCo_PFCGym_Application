import "server-only";

import { Prisma } from "@prisma/client";

import { logger } from "./logger";

/**
 * An error that is safe to show to a client: `message` is written for the
 * user, `status` is the HTTP status it maps to, and `code` is a stable string
 * callers can branch on.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
  }
}

export const ERROR_CODES = {
  conflict: "CONFLICT",
  notFound: "NOT_FOUND",
  inUse: "IN_USE",
  internal: "INTERNAL",
} as const;

/**
 * Turns anything thrown by a repository into an AppError.
 *
 * Known Prisma codes become a specific status. Everything else is logged in
 * full on the server and replaced with a generic message, so SQL, stack traces
 * and row values never reach a response.
 */
export function mapPrismaError(e: unknown): AppError {
  if (e instanceof AppError) return e;

  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    switch (e.code) {
      case "P2002":
        return new AppError(409, ERROR_CODES.conflict, "That already exists.");
      case "P2025":
        return new AppError(404, ERROR_CODES.notFound, "That could not be found.");
      case "P2003":
        return new AppError(
          409,
          ERROR_CODES.inUse,
          "That is in use and cannot be changed.",
        );
    }
  }

  logger.error("Unhandled data error", { error: e });

  return new AppError(
    500,
    ERROR_CODES.internal,
    "Something went wrong. Please try again.",
  );
}
