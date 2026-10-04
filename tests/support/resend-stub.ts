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

type Store = { outbox: SentMessage[]; failNext: boolean; constructedWith: string[] };

const store: Store = ((globalThis as unknown as { __resend?: Store }).__resend ??= {
  outbox: [],
  failNext: false,
  constructedWith: [],
});

export class Resend {
  constructor(key: string) {
    store.constructedWith.push(key);
  }

  emails = {
    send: async (message: SentMessage) => {
      if (store.failNext) {
        store.failNext = false;
        return { data: null, error: { name: "stub_error", message: "stub failure" } };
      }
      store.outbox.push(message);
      return { data: { id: "stub-id" }, error: null };
    },
  };
}
