/**
 * Stands in for "next/navigation" in tests. The real module needs React's
 * client build, which the server-condition test runner does not load.
 * redirect() throws the same kind of error Next does, so a test can catch it
 * and read the target.
 */
export class RedirectError extends Error {
  readonly digest: string;
  readonly url: string;

  constructor(url: string) {
    super("NEXT_REDIRECT");
    this.url = url;
    this.digest = `NEXT_REDIRECT;replace;${url};307;`;
  }
}

export function redirect(url: string): never {
  throw new RedirectError(url);
}

export function notFound(): never {
  throw new Error("NEXT_NOT_FOUND");
}
