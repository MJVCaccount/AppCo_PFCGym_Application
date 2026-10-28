/**
 * Stands in for the "resend" package in tests (see register.cjs). Nothing here
 * touches the network: a "sent" message is pushed onto a list the tests read
 * from globalThis, so they see it whichever copy of this module loaded.
 */
export interface SentMessage {
  from: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
}

type Store = {
  outbox: SentMessage[];
  /** Fail the next send (once) with `failStatus`. */
  failNext: boolean;
  /** HTTP status of the failure; null reproduces a provider error with no status. Default 500. */
  failStatus: number | null;
  /** Throw instead of returning an error on the next send, like a network failure. */
  throwNext: boolean;
  /** How many times the provider was actually called. */
  calls: number;
  constructedWith: string[];
};

const store: Store = ((globalThis as unknown as { __resend?: Store }).__resend ??= {
  outbox: [],
  failNext: false,
  failStatus: 500,
  throwNext: false,
  calls: 0,
  constructedWith: [],
});

export class Resend {
  constructor(key: string) {
    store.constructedWith.push(key);
  }

  emails = {
    send: async (message: SentMessage) => {
      store.calls++;
      if (store.throwNext) {
        store.throwNext = false;
        throw new Error("stub network failure");
      }
      if (store.failNext) {
        store.failNext = false;
        const statusCode = store.failStatus;
        store.failStatus = 500;
        return {
          data: null,
          error: { name: statusCode === 429 ? "rate_limit_exceeded" : "stub_error", message: "stub failure", statusCode },
        };
      }
      store.outbox.push(message);
      return { data: { id: "stub-id" }, error: null };
    },
  };
}
