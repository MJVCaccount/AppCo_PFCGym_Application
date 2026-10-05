/**
 * Email and contact-form tests, run against the seeded test database (see
 * tests/helpers/db.ts). The "resend" package is replaced by an in-memory stub
 * (tests/support/register.cjs), so no test can send a real email.
 */
import assert from "node:assert/strict";

import { resetDatabase, testDb } from "./helpers/db";

import { sendEnquiry } from "../src/actions/gym";
import { register } from "../src/actions/auth";
import { appUrl, appUrlProblem } from "../src/lib/env";
import { flushEmails } from "../src/lib/email/queue";
import { sendEmail } from "../src/lib/email/send";
import * as templates from "../src/lib/email/templates";
import { getTimetable } from "../src/lib/repositories/timetableRepository";
import { findByEmail, toSessionUser } from "../src/lib/repositories/usersRepository";
import { createBooking } from "../src/lib/services/bookingService";
import { deactivateSession } from "../src/lib/services/classAdminService";
import { listInbox, setEnquiryHandled } from "../src/lib/services/contactService";
import { cancelEvent, createEvent, offerBout } from "../src/lib/services/eventService";
import type { SessionUser } from "../src/lib/types";
import { EMPTY_FORM_STATE } from "../src/lib/validation";

interface Sent {
  from: string;
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
}
interface Stub {
  outbox: Sent[];
  failNext: boolean;
}
const stub = (globalThis as unknown as { __resend: Stub }).__resend;

let passed = 0;
async function check(label: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log("  ok  " + label);
}

async function sessionFor(email: string): Promise<SessionUser> {
  const user = await findByEmail(email);
  assert.ok(user, `${email} is seeded`);
  return toSessionUser(user);
}

function configureEmail(on: boolean) {
  process.env.RESEND_API_KEY = on ? "re_test_key" : "";
  process.env.EMAIL_FROM = on ? "PFC <no-reply@test.pfc.invalid>" : "";
  process.env.CONTACT_INBOX = on ? "inbox@test.pfc.invalid" : "";
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const goodEnquiry = {
  fullName: "Thandi Nkosi",
  email: "thandi@example.co.za",
  phone: "",
  message: "I would like to know about the beginner boxing classes.",
};

/** Output written by the logger while `fn` runs. */
async function captureLogs(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  const grab = (chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  };
  process.stdout.write = grab as typeof process.stdout.write;
  process.stderr.write = grab as typeof process.stderr.write;
  try {
    await fn();
  } finally {
    process.stdout.write = out;
    process.stderr.write = err;
  }
  return chunks.join("");
}

const HOSTILE = `<script>alert("x")</script> & 'q' "d" <img src=x onerror=1>`;

async function main() {
  await resetDatabase();
  process.env.APP_URL = "https://pfc.test.invalid";

  const admin = await sessionFor("admin@pfc.co.za");
  const member = await sessionFor("member@pfc.co.za");
  const fighter = await sessionFor("fighter@pfc.co.za");

  console.log("\nESCAPING");

  await check("escapeHtml escapes ampersand, angle brackets and both quotes", () => {
    assert.equal(
      templates.escapeHtml(`<a href="x" onclick='y'>&</a>`),
      "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
    assert.equal(templates.escapeHtml(null), "");
    assert.equal(templates.escapeHtml(undefined), "");
  });

  await check("every template neutralises hostile text in its HTML part", () => {
    const all: templates.EmailContent[] = [
      templates.welcome({ fullName: HOSTILE }),
      templates.bookingConfirmed({
        fullName: HOSTILE,
        className: HOSTILE,
        coachName: HOSTILE,
        dayName: HOSTILE,
        startsAt: HOSTILE,
        sessionDate: "2026-11-02",
      }),
      templates.bookingCancelledByGym({
        fullName: HOSTILE,
        className: HOSTILE,
        dayName: HOSTILE,
        startsAt: HOSTILE,
        sessionDate: "2026-11-02",
      }),
      templates.enquiryReceivedAutoReply({ fullName: HOSTILE }),
      templates.enquiryToGym({
        fullName: HOSTILE,
        email: HOSTILE,
        phone: HOSTILE,
        message: HOSTILE,
      }),
      templates.passwordReset({ fullName: HOSTILE, token: HOSTILE, minutesValid: 60 }),
      templates.coachInvite({ fullName: HOSTILE, token: HOSTILE, daysValid: 7 }),
      templates.boutOffered({
        fullName: HOSTILE,
        eventName: HOSTILE,
        eventDate: "2026-11-28T17:00:00.000Z",
        venue: HOSTILE,
        opponentName: HOSTILE,
        boutWeightClass: HOSTILE,
      }),
      templates.eventCancelled({
        fullName: HOSTILE,
        eventName: HOSTILE,
        eventDate: "2026-11-28T17:00:00.000Z",
      }),
      templates.documentReviewed({
        fullName: HOSTILE,
        documentType: HOSTILE,
        status: "Rejected",
        note: HOSTILE,
      }),
    ];

    for (const email of all) {
      assert.ok(email.text.length > 0, `plain text present: ${email.subject}`);
      assert.ok(email.subject.length > 0);
      assert.doesNotMatch(email.html, /<script/i, email.subject);
      assert.doesNotMatch(email.html, /<img/i, email.subject);
      assert.doesNotMatch(email.html, /onerror=1>/i, email.subject);
      assert.doesNotMatch(email.html, /alert\("x"\)/, email.subject);
      // Only plain layout tags: no <img> (remote images, tracking pixels),
      // <script>, <iframe> or <link>.
      const tags = new Set(
        [...email.html.matchAll(/<\/?([a-z0-9]+)/gi)].map((m) => m[1].toLowerCase()),
      );
      for (const tag of tags) {
        assert.ok(
          ["html", "body", "div", "h1", "p", "a", "b", "br", "table", "tr", "td"].includes(tag),
          `unexpected <${tag}> in ${email.subject}`,
        );
      }
      assert.doesNotMatch(email.subject, /[\r\n]/);
    }
  });

  await check("a newline in a name cannot add a header to the subject", () => {
    const email = templates.enquiryToGym({
      fullName: "Eve\r\nBcc: attacker@example.com",
      email: "e@example.com",
      phone: null,
      message: "hello hello hello",
    });
    assert.doesNotMatch(email.subject, /[\r\n]/);
  });

  await check("links are built from APP_URL, never from a request", () => {
    const email = templates.passwordReset({ fullName: "A B", token: "tok_en-1", minutesValid: 60 });
    assert.match(email.text, /https:\/\/pfc\.test\.invalid\/reset-password\/tok_en-1/);
    assert.match(email.html, /href="https:\/\/pfc\.test\.invalid\/reset-password\/tok_en-1"/);
  });

  await check("APP_URL must be https in production", () => {
    const previous = process.env.NODE_ENV;
    const env = process.env as Record<string, string | undefined>;
    try {
      env.NODE_ENV = "production";
      assert.match(appUrlProblem("http://pfc.example.com") ?? "", /https/);
      assert.match(appUrlProblem("") ?? "", /must be set/);
      assert.match(appUrlProblem("not a url") ?? "", /full URL/);
      assert.equal(appUrlProblem("https://pfc.example.com"), null);
    } finally {
      env.NODE_ENV = previous;
    }
    assert.equal(appUrlProblem("http://localhost:3000"), null);
    assert.equal(appUrl(), "https://pfc.test.invalid");
  });

  console.log("\nSENDING");

  await check("sendEmail returns false and does not throw without a key", async () => {
    configureEmail(false);
    stub.outbox.length = 0;

    let result: boolean | undefined;
    const logs = await captureLogs(async () => {
      result = await sendEmail({
        to: "someone@example.co.za",
        subject: "Subject line",
        html: "<p>SECRET-BODY-HTML</p>",
        text: "SECRET-BODY-TEXT",
      });
    });

    assert.equal(result, false);
    assert.equal(stub.outbox.length, 0);
    assert.match(logs, /example\.co\.za/);
    assert.match(logs, /Subject line/);
    assert.doesNotMatch(logs, /SECRET-BODY/, "the body is never logged");
    assert.doesNotMatch(logs, /someone@/, "only the recipient's domain is logged");
  });

  await check("sendEmail sends through the provider when configured", async () => {
    configureEmail(true);
    stub.outbox.length = 0;

    const ok = await sendEmail({
      to: "a@example.co.za",
      subject: "Hi",
      html: "<p>x</p>",
      text: "x",
      replyTo: "r@example.co.za",
    });
    assert.equal(ok, true);
    assert.equal(stub.outbox.length, 1);
    assert.equal(stub.outbox[0].from, "PFC <no-reply@test.pfc.invalid>");
    assert.equal(stub.outbox[0].replyTo, "r@example.co.za");
  });

  await check("a provider error gives false, not an exception", async () => {
    configureEmail(true);
    stub.failNext = true;
    const ok = await sendEmail({ to: "a@example.co.za", subject: "Hi", html: "x", text: "x" });
    assert.equal(ok, false);
  });

  console.log("\nCONTACT FORM");

  await check("a filled honeypot saves nothing and sends nothing", async () => {
    configureEmail(true);
    stub.outbox.length = 0;
    const before = await testDb.contactEnquiry.count();

    const state = await sendEnquiry(
      EMPTY_FORM_STATE,
      form({ ...goodEnquiry, website: "http://spam.example" }),
    );
    await flushEmails();

    assert.equal(state.ok, true, "a bot is shown the normal success state");
    assert.equal(await testDb.contactEnquiry.count(), before);
    assert.equal(stub.outbox.length, 0);
  });

  await check("a valid enquiry saves one row and emails the gym and the visitor", async () => {
    configureEmail(true);
    stub.outbox.length = 0;

    const state = await sendEnquiry(EMPTY_FORM_STATE, form({ ...goodEnquiry, website: "" }));
    await flushEmails();

    assert.equal(state.ok, true);
    const rows = await testDb.contactEnquiry.findMany();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].phone, null, "an empty phone is stored as null");
    assert.ok(rows[0].emailSentAt, "emailSentAt is set once the gym's copy is out");

    const toGym = stub.outbox.find((m) => m.to === "inbox@test.pfc.invalid");
    const reply = stub.outbox.find((m) => m.to === "thandi@example.co.za");
    assert.ok(toGym && reply);
    assert.equal(toGym.replyTo, "thandi@example.co.za");
  });

  await check("a 2,001-character message is rejected and not saved", async () => {
    const before = await testDb.contactEnquiry.count();
    const state = await sendEnquiry(
      EMPTY_FORM_STATE,
      form({ ...goodEnquiry, message: "x".repeat(2001) }),
    );

    assert.equal(state.ok, false);
    assert.match(state.errors?.message ?? "", /at most 2000/);
    assert.equal(await testDb.contactEnquiry.count(), before);

    const edge = await sendEnquiry(
      EMPTY_FORM_STATE,
      form({ ...goodEnquiry, message: "x".repeat(2000) }),
    );
    assert.equal(edge.ok, true, "2,000 characters is allowed");
  });

  await check("other lengths are capped too", async () => {
    const before = await testDb.contactEnquiry.count();
    for (const override of [
      { fullName: "n".repeat(101) },
      { email: `${"e".repeat(250)}@x.co` },
      { phone: `+27${"1".repeat(30)}` },
    ]) {
      const state = await sendEnquiry(EMPTY_FORM_STATE, form({ ...goodEnquiry, ...override }));
      assert.equal(state.ok, false, JSON.stringify(override).slice(0, 30));
    }
    assert.equal(await testDb.contactEnquiry.count(), before);
  });

  await check("the visitor still sees success, and the row is kept, when email fails", async () => {
    configureEmail(false);
    stub.outbox.length = 0;
    const before = await testDb.contactEnquiry.count();

    const state = await sendEnquiry(EMPTY_FORM_STATE, form(goodEnquiry));
    await flushEmails();

    assert.equal(state.ok, true);
    const rows = await testDb.contactEnquiry.findMany({ orderBy: { id: "desc" }, take: 1 });
    assert.equal(await testDb.contactEnquiry.count(), before + 1);
    assert.equal(rows[0].emailSentAt, null);
    assert.equal(stub.outbox.length, 0);
  });

  console.log("\nADMIN INBOX");

  await check("the inbox is admin only", async () => {
    assert.equal((await listInbox(member)).status, 403);
    assert.equal((await listInbox(fighter)).status, 403);
    assert.equal((await setEnquiryHandled(member, 1, true)).status, 403);
  });

  await check("unhandled first, then newest first; handle and reopen are audited", async () => {
    const first = await testDb.contactEnquiry.findFirstOrThrow({ orderBy: { id: "asc" } });

    const handled = await setEnquiryHandled(admin, first.id, true);
    assert.equal(handled.ok, true);

    const list = await listInbox(admin, { page: 1 });
    assert.equal(list.ok, true);
    const items = list.data!.items;
    assert.equal(list.data!.pageSize, 25);
    assert.equal(items[items.length - 1].id, first.id, "handled rows sink to the end");
    assert.ok(items[items.length - 1].handledAt);
    assert.ok(items.slice(0, -1).every((e) => e.handledAt === null));
    const unhandled = items.slice(0, -1).map((e) => e.createdAt);
    assert.deepEqual([...unhandled].sort().reverse(), unhandled, "newest first");

    assert.equal((await setEnquiryHandled(admin, first.id, false)).ok, true);
    assert.equal((await setEnquiryHandled(admin, 999_999, true)).status, 404);
    assert.equal((await setEnquiryHandled(admin, first.id, "yes")).status, 400);

    const actions = (
      await testDb.auditLog.findMany({ where: { entity: "ContactEnquiry" }, orderBy: { id: "asc" } })
    ).map((a) => a.action);
    assert.deepEqual(actions, ["enquiry.handle", "enquiry.reopen"]);
  });

  await check("a page past the end is empty, a bad page is refused", async () => {
    const past = await listInbox(admin, { page: 50 });
    assert.equal(past.ok, true);
    assert.equal(past.data!.items.length, 0);
    assert.equal((await listInbox(admin, { page: 0 })).status, 400);
  });

  console.log("\nWIRED EMAILS");

  await check("registering sends one welcome email", async () => {
    configureEmail(true);
    stub.outbox.length = 0;

    await assert.rejects(
      register(
        EMPTY_FORM_STATE,
        form({
          fullName: "New Person",
          email: "new.person@example.co.za",
          phone: "",
          password: "Sup3rSecret!",
          planId: "",
        }),
      ),
      (e: unknown) => String((e as { digest?: string }).digest).startsWith("NEXT_REDIRECT"),
    );
    await flushEmails();

    const welcomes = stub.outbox.filter((m) => m.to === "new.person@example.co.za");
    assert.equal(welcomes.length, 1);
    assert.equal(welcomes[0].subject, "Welcome to PFC");
  });

  const week = await getTimetable(new Date());
  const boxing = week.find((s) => s.day === "mon" && s.className === "Elite Boxing")!;

  await check("booking sends one confirmation with the class details", async () => {
    configureEmail(true);
    stub.outbox.length = 0;

    const result = await createBooking(member, boxing.id);
    await flushEmails();

    assert.equal(result.ok, true);
    assert.equal(stub.outbox.length, 1);
    const mail = stub.outbox[0];
    assert.equal(mail.to, member.email);
    assert.match(mail.subject, /Elite Boxing/);
    assert.match(mail.html ?? "", /Marcus Thompson/);
    assert.match(mail.text ?? "", /Monday/);
    assert.match(mail.text ?? "", /Johannesburg/);
  });

  await check("a refused booking sends nothing", async () => {
    stub.outbox.length = 0;
    const again = await createBooking(member, boxing.id); // duplicate
    await flushEmails();
    assert.equal(again.ok, false);
    assert.equal(stub.outbox.length, 0);
  });

  await check("a booking still succeeds when the provider is down", async () => {
    configureEmail(true);
    stub.failNext = true;
    stub.outbox.length = 0;

    const tuesday = week.find((s) => s.day === "tue" && s.className === "Muay Thai")!;
    const result = await createBooking(member, tuesday.id);
    await flushEmails();

    assert.equal(result.ok, true);
    assert.equal(stub.outbox.length, 0);
    assert.equal(
      await testDb.booking.count({ where: { memberId: member.id, gymClassId: tuesday.id, status: "Confirmed" } }),
      1,
    );
  });

  await check("deactivating a class with cancelBookings emails each member once", async () => {
    configureEmail(true);
    stub.outbox.length = 0;

    const booked = await testDb.booking.count({
      where: { gymClassId: boxing.id, status: "Confirmed" },
    });
    assert.ok(booked >= 2, "seed data has several members in this class");

    const result = await deactivateSession(admin, boxing.id, { cancelBookings: true });
    await flushEmails();

    assert.equal(result.ok, true);
    assert.equal(result.data!.cancelledBookings, booked);
    assert.equal(stub.outbox.length, booked);
    assert.ok(stub.outbox.every((m) => /^Cancelled: Elite Boxing/.test(m.subject)));
    assert.ok(
      stub.outbox.some((m) => m.to === member.email),
      "the member we booked is told",
    );
    assert.equal(new Set(stub.outbox.map((m) => String(m.to))).size, booked, "one each");
  });

  await check("offering a bout emails the fighter; cancelling emails every offered fighter", async () => {
    configureEmail(true);
    const event = await createEvent(admin, {
      name: "Email Test Fight Night",
      venue: "PFC Arena",
      description: "A long enough description for the test.",
      eventDate: new Date(Date.now() + 20 * 86_400_000).toISOString(),
      imageUrl: "",
    });
    assert.equal(event.ok, true);

    stub.outbox.length = 0;
    const offer = await offerBout(admin, event.data!.id, fighter.id, {
      opponentName: "Test Opponent",
    });
    await flushEmails();
    assert.equal(offer.ok, true);
    assert.equal(stub.outbox.length, 1);
    assert.equal(stub.outbox[0].to, fighter.email);
    assert.match(stub.outbox[0].subject, /Bout offer: Email Test Fight Night/);

    stub.outbox.length = 0;
    const duplicate = await offerBout(admin, event.data!.id, fighter.id, {});
    await flushEmails();
    assert.equal(duplicate.status, 409);
    assert.equal(stub.outbox.length, 0, "a refused offer sends nothing");

    const cancelled = await cancelEvent(admin, event.data!.id);
    await flushEmails();
    assert.equal(cancelled.ok, true);
    assert.equal(stub.outbox.length, 1);
    assert.equal(stub.outbox[0].to, fighter.email);
    assert.match(stub.outbox[0].subject, /Event cancelled: Email Test Fight Night/);

    stub.outbox.length = 0;
    const again = await cancelEvent(admin, event.data!.id);
    await flushEmails();
    assert.equal(again.status, 409);
    assert.equal(stub.outbox.length, 0, "cancelling twice emails nobody");
  });

  console.log(`\n${passed} checks passed\n`);
}

main()
  .then(() => testDb.$disconnect())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
