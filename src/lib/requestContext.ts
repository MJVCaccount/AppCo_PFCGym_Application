import { AsyncLocalStorage } from "node:async_hooks";

/**
 * What is known about the request being served, available to any code it
 * calls without passing it down: the logger adds the id to every line, and the
 * error envelope puts it in the response body.
 */
export interface RequestContext {
  requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequest<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}
