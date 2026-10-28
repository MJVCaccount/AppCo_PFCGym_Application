import "server-only";

import { randomUUID } from "node:crypto";

import { jsonError, rateLimitedResponse } from "@/lib/api";
import { logger } from "@/lib/logger";
import { assertSameOrigin } from "@/lib/origin";
import { checkLimit, clientIp, type PolicyName } from "@/lib/rateLimit";
import { runWithRequest } from "@/lib/requestContext";
import { getSession } from "@/lib/session";
import type { SessionUser } from "@/lib/types";

/**
 * One wrapper for every JSON route, so each does the same things in the same
 * order and a route file holds only what is particular to it:
 *
 *  1. a request id (X-Request-Id; an incoming one is kept if it is tame),
 *     available to the logger and the error body for the whole request
 *  2. the same-origin check for POST, PATCH, PUT and DELETE
 *  3. the session, when the route needs one (401)
 *  4. an optional rate limit, counted per user or per client address (429)
 *  5. the route's own code; anything it throws is logged in full and answered
 *     with the route's fixed 500 sentence
 *  6. headers (X-Request-Id, Cache-Control) and one access-log line: method,
 *     route, status, milliseconds
 *
 * Success bodies are whatever the route returns; error bodies are the
 * envelope in apiEnvelope.ts. Body reading stays in the route (readJson and
 * readJsonObject enforce the content type, the 100 kB limit and the syntax)
 * because it must come after authentication and the rate limit.
 */

const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/** An incoming request id is kept only if it cannot carry anything but an id. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

export type RouteParams = Record<string, string>;

export interface ApiContext {
  request: Request;
  requestId: string;
  /** Resolves to the dynamic segments of the path, e.g. { id: "12" }. */
  params: () => Promise<RouteParams>;
  /** The signed-in user, or null on a public route. */
  session: SessionUser | null;
}

export interface UserApiContext extends ApiContext {
  session: SessionUser;
}

interface BaseOptions {
  /** "POST /api/bookings": the label in logs and in the access line. */
  name: string;
  /** The fixed sentence for an unexpected failure (500). */
  failure: string;
  /**
   * Cache-Control for the response. Defaults to "no-store". A handler that
   * sets its own Cache-Control keeps it.
   */
  cache?: string;
  /** Skip the same-origin check on a write. Only for routes that never write. */
  skipOriginCheck?: boolean;
}

export interface PublicOptions extends BaseOptions {
  /** Count the client address against this policy before running. */
  limit?: PolicyName;
}

export interface UserOptions extends BaseOptions {
  /** The 401 sentence. */
  unauthenticated?: string;
  /** Count the signed-in user against this policy before running. */
  limit?: PolicyName;
}

/**
 * What Next passes as the second argument: { params: Promise<{ id: string }> }
 * with the segment names of the route. Next's generated type check compares
 * this position against each route's own segments, so it cannot be narrowed
 * to one shape here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NextContext = any;

export type RouteHandler = (
  request: Request,
  context?: NextContext,
) => Promise<Response>;

export function newRequestId(incoming: string | null): string {
  return incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
}

function accessLogEnabled(): boolean {
  return process.env.API_ACCESS_LOG !== "0";
}

async function run(
  options: BaseOptions & { limit?: PolicyName },
  authenticate: false | { message: string },
  handler: (ctx: ApiContext) => Promise<Response>,
  request: Request,
  context?: NextContext,
): Promise<Response> {
  const requestId = newRequestId(request.headers.get("x-request-id"));
  const started = Date.now();
  const method = request.method.toUpperCase();

  return runWithRequest({ requestId }, async () => {
    let response: Response;

    try {
      response = await guarded();
    } catch (e) {
      logger.error(`${options.name} failed`, { error: e });
      response = jsonError(options.failure, 500);
    }

    return finish(response);

    async function guarded(): Promise<Response> {
      if (
        WRITE_METHODS.has(method) &&
        !options.skipOriginCheck
      ) {
        const blocked = assertSameOrigin(request);
        if (blocked) return blocked;
      }

      let session: SessionUser | null = null;
      if (authenticate) {
        session = await getSession();
        if (!session) return jsonError(authenticate.message, 401);
      }

      if (options.limit) {
        const identity = session
          ? String(session.id)
          : clientIp(request.headers);
        const limit = await checkLimit(options.limit, identity);
        if (!limit.allowed) return rateLimitedResponse(limit);
      }

      return handler({
        request,
        requestId,
        session,
        params: async () => (await context?.params) ?? {},
      });
    }

    function finish(result: Response): Response {
      const headers = new Headers(result.headers);
      headers.set("X-Request-Id", requestId);

      if (!headers.has("Cache-Control")) {
        const cacheable = method === "GET" && result.status >= 200 && result.status < 300;
        headers.set("Cache-Control", cacheable ? (options.cache ?? "no-store") : "no-store");
      }

      const ms = Date.now() - started;
      if (accessLogEnabled()) {
        logger.info("api", {
          method,
          route: options.name,
          status: result.status,
          ms,
        });
      }

      return new Response(result.body, {
        status: result.status,
        statusText: result.statusText,
        headers,
      });
    }
  });
}

/** A route anyone may call. */
export function publicRoute(
  options: PublicOptions,
  handler: (ctx: ApiContext) => Promise<Response>,
): RouteHandler {
  return (request, context) => run(options, false, handler, request, context);
}

/** A route that needs a signed-in user; the role is left to the service. */
export function userRoute(
  options: UserOptions,
  handler: (ctx: UserApiContext) => Promise<Response>,
): RouteHandler {
  return (request, context) =>
    run(
      options,
      { message: options.unauthenticated ?? "Sign in to continue." },
      (ctx) => handler(ctx as UserApiContext),
      request,
      context,
    );
}

// ---------------------------------------------------------------- 405

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const ALL_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/** Marks the handlers made by methodNotAllowed, so tests can tell them apart. */
export const NOT_ALLOWED = Symbol.for("pfc.methodNotAllowed");

/**
 * Handlers for every method a route does not implement, so a wrong method
 * answers the JSON 405 envelope with an Allow header instead of Next's empty
 * 405. Spread the ones the file needs:
 *
 *   export const { POST, PUT, PATCH, DELETE } = methodNotAllowed(["GET"]);
 */
export function methodNotAllowed(
  allowed: HttpMethod[],
): Record<HttpMethod, RouteHandler> {
  const make = (): RouteHandler => {
    const handler: RouteHandler = async (request) => {
      const requestId = newRequestId(request.headers.get("x-request-id"));
      return runWithRequest({ requestId }, async () => {
        const response = jsonError("Method not allowed.", 405);
        response.headers.set("X-Request-Id", requestId);
        response.headers.set("Allow", [...allowed, ...(allowed.includes("GET") ? ["HEAD"] : []), "OPTIONS"].join(", "));
        response.headers.set("Cache-Control", "no-store");
        return response;
      });
    };
    (handler as unknown as Record<symbol, boolean>)[NOT_ALLOWED] = true;
    return handler;
  };

  return Object.fromEntries(
    ALL_METHODS.map((method) => [method, make()]),
  ) as Record<HttpMethod, RouteHandler>;
}
