/**
 * EMAIL_SKIP: addresses that must never reach the email provider. The parser is
 * pure; the rest goes through the outbox with the Resend stub, which counts the
 * calls it receives.
 */
import assert from "node:assert/strict";

import { resetDatabase, testDb } from "./helpers/db";

import { GET as healthDetailGet } from "../src/app/api/health/detail/route";
import { deliver } from "../src/lib/email/send";
import { isSkipped, parseSkipList } from "../src/lib/email/skipList";
import { drainOutbox } from "../src/lib/services/outboxService";
import * as monitor from "../scripts/ci/monitor.mjs";

interface ResendStub {
  outbox: { to: string | string[] }[];
  calls: number;
}
const resend = (globalThis as unknown as { __resend: ResendStub }).__resend;

const PRODUCTION_VALUE = "member@pfc.co.za,fighter@pfc.co.za,marcus@pfc.co.za,sofia@pfc.co.za,admin@pfc.co.za";
const TOKEN = "skip-health-token-0123456789-abcdefghijklmnopqrstuvwxyz";

let passed = 0;
async function check(label: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log("  ok  " + label);
}

const skipped = (address: string, value: string | undefined) => isSkipped(address, parseSkipList(value));

async function main() {
  console.log("\nEMAIL_SKIP: THE PARSER");

  await check("an unset, empty or blank value skips nothing", () => {
    for (const value of [undefined, null as unknown as undefined, "", "   ", ",", " , ,, "]) {
      assert.equal(skipped("anyone@example.co.za", value), false, JSON.stringify(value));
      assert.deepEqual([...parseSkipList(value).addresses], []);
      assert.deepEqual([...parseSkipList(value).domains], []);
    }
  });

  await check("an exact address matches, and only that address", () => {
    assert.equal(skipped("admin@pfc.co.za", "admin@pfc.co.za"), true);
    assert.equal(skipped("member@pfc.co.za", "admin@pfc.co.za"), false);
    assert.equal(skipped("admin@pfc.co.za.evil.example", "admin@pfc.co.za"), false);
    assert.equal(skipped("xadmin@pfc.co.za", "admin@pfc.co.za"), false);
    assert.equal(skipped("admin@pfc.co.za", "min@pfc.co.za"), false, "a tail of the local part is not a match");
  });

  await check("a domain entry matches every address at exactly that domain", () => {
    assert.equal(skipped("anyone@demo.test", "demo.test"), true);
    assert.equal(skipped("someone.else@demo.test", "demo.test"), true);
    assert.equal(skipped("anyone@demo.test", "@demo.test"), true, "written with a leading @");
    assert.equal(skipped("anyone@other.test", "demo.test"), false);
  });

  await check("the match ignores case and surrounding spaces, in the list and in the address", () => {
    assert.equal(skipped("Admin@PFC.co.ZA", "  ADMIN@pfc.CO.za "), true);
    assert.equal(skipped("  admin@pfc.co.za  ", "admin@pfc.co.za"), true);
    assert.equal(skipped("someone@DEMO.test", " Demo.TEST"), true);
  });

  await check("empty entries and stray commas are ignored without dropping the real ones", () => {
    const list = parseSkipList(" ,a@x.test,, ,demo.test, ,");
    assert.deepEqual([...list.addresses], ["a@x.test"]);
    assert.deepEqual([...list.domains], ["demo.test"]);
    assert.equal(isSkipped("a@x.test", list), true);
    assert.equal(isSkipped("b@demo.test", list), true);
  });

  await check("a domain entry is not a suffix or a prefix match: notpfc.co.za, pfc.co.za.evil.example and sub.pfc.co.za are different", () => {
    for (const address of ["someone@notpfc.co.za", "someone@pfc.co.za.evil.example", "someone@sub.pfc.co.za", "someone@xpfc.co.za", "pfc.co.za@evil.example", "someone@evil.example/pfc.co.za"]) {
      assert.equal(skipped(address, "pfc.co.za"), false, address);
    }
    assert.equal(skipped("someone@pfc.co.za", "pfc.co.za"), true);
  });

  await check("an address with no @ or with several is judged by what follows the last @", () => {
    assert.equal(skipped("pfc.co.za", "pfc.co.za"), false, "no @ means no domain");
    assert.equal(skipped("a@b@pfc.co.za", "pfc.co.za"), true);
    assert.equal(skipped("", "pfc.co.za"), false);
  });

  await check("the production value skips exactly the five demo accounts", () => {
    for (const address of PRODUCTION_VALUE.split(",")) assert.equal(skipped(address, PRODUCTION_VALUE), true, address);
    for (const address of ["real.member@pfc.co.za", "member@pfc.co.za.example", "memberr@pfc.co.za", "someone@gmail.com"]) {
      assert.equal(skipped(address, PRODUCTION_VALUE), false, address);
    }
  });

  console.log("\nEMAIL_SKIP: DELIVERY AND THE OUTBOX");

  await resetDatabase();
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.EMAIL_FROM = "PFC <no-reply@test.pfc.invalid>";
  process.env.API_ACCESS_LOG = "0";
  const email = (to: string) => ({ to, subject: "s", html: "<p>x</p>", text: "x" });

  await check("deliver() returns skipped, with the reason, and never calls the provider or logs the address", async () => {
    process.env.EMAIL_SKIP = PRODUCTION_VALUE;
    const lines: string[] = [];
    const grab = (chunk: string | Uint8Array) => (lines.push(String(chunk)), true);
    const out = process.stdout.write.bind(process.stdout);
    const err = process.stderr.write.bind(process.stderr);
    process.stdout.write = grab as typeof process.stdout.write;
    process.stderr.write = grab as typeof process.stderr.write;

    const before = resend.calls;
    let result;
    try {
      result = await deliver(email("Admin@PFC.co.za"));
    } finally {
      process.stdout.write = out;
      process.stderr.write = err;
    }

    assert.deepEqual(result, { status: "skipped", reason: "Address is on the EMAIL_SKIP list." });
    assert.equal(resend.calls, before, "the provider was not called");
    assert.ok(!lines.join("").toLowerCase().includes("admin@pfc"), "the address was not logged");
    assert.ok(!lines.join("").includes("pfc.co.za"), "not even its domain");
  });

  await check("an address not on the list is sent as before; the .invalid rule still applies", async () => {
    process.env.EMAIL_SKIP = PRODUCTION_VALUE;
    const before = resend.calls;
    assert.equal((await deliver(email("real.person@example.co.za"))).status, "sent");
    assert.equal(resend.calls, before + 1);

    assert.deepEqual(await deliver(email("demo@pfc.invalid")), { status: "skipped", reason: "The address ends in .invalid and can never receive mail." });
    assert.equal(resend.calls, before + 1);

    delete process.env.EMAIL_SKIP;
    assert.equal((await deliver(email("admin@pfc.co.za"))).status, "sent", "unset: nothing is skipped");
  });

  await check("an outbox row addressed to a listed address ends Skipped with the reason, its body dropped, and resend.calls unchanged", async () => {
    await testDb.emailOutbox.deleteMany();
    process.env.EMAIL_SKIP = PRODUCTION_VALUE;
    const due = new Date(Date.now() - 1000);
    const make = (to: string) =>
      testDb.emailOutbox.create({ data: { kind: "booking.confirmed", toAddress: to, subject: "s", html: "<p>private</p>", text: "private", nextAttemptAt: due } });
    const listed = await make("member@pfc.co.za");
    const listedAgain = await make("SOFIA@pfc.co.za");
    const real = await make("real.person@example.co.za");

    const before = resend.calls;
    const report = await drainOutbox();

    assert.equal(report.skipped, 2);
    assert.equal(report.sent, 1);
    assert.equal(resend.calls, before + 1, "only the real address reached the provider");
    assert.equal(resend.outbox.at(-1)!.to, "real.person@example.co.za");

    for (const row of [listed, listedAgain]) {
      const after = await testDb.emailOutbox.findUniqueOrThrow({ where: { id: row.id } });
      assert.equal(after.status, "Skipped");
      assert.equal(after.lastError, "Address is on the EMAIL_SKIP list.");
      assert.equal(after.html, "");
      assert.equal(after.text, "");
      assert.equal(after.attempts, 0, "no attempt was counted");
    }
    assert.equal((await testDb.emailOutbox.findUniqueOrThrow({ where: { id: real.id } })).status, "Sent");

    // and they are not retried later
    assert.equal((await drainOutbox({ now: new Date(Date.now() + 7 * 86_400_000) })).claimed, 0);
  });

  console.log("\nEMAIL_SKIP: SKIPPED IS NOT A FAILURE");

  await check("skipped rows are neither pending nor dead in the health detail, and do not degrade it", async () => {
    await testDb.emailOutbox.deleteMany();
    for (let i = 0; i < 30; i++) {
      await testDb.emailOutbox.create({ data: { kind: "booking.confirmed", toAddress: `demo${i}@pfc.invalid`, subject: "s", status: "Skipped", lastError: "Address is on the EMAIL_SKIP list." } });
    }
    process.env.HEALTH_TOKEN = TOKEN;
    const res = await healthDetailGet(new Request("http://localhost/api/health/detail", { headers: { authorization: `Bearer ${TOKEN}` } }));
    assert.equal(res.status, 200);
    const { data } = await res.json();

    assert.equal(data.outbox.skipped, 30);
    assert.equal(data.outbox.pending, 0, "not pending");
    assert.equal(data.outbox.dead, 0, "not dead");
    assert.equal(data.outbox.deadLast24h, 0);
    assert.equal(data.outbox.oldestPendingAt, null);
    assert.equal(data.status, "ok");
    delete process.env.HEALTH_TOKEN;
  });

  await check("the monitor raises nothing for any number of skipped emails", () => {
    const detail = {
      status: "ok",
      database: { latencyMs: 30, sizeBytes: 50 * 1048576, migrations: { pending: [] as string[], newerThanThisRelease: [] as string[] } },
      outbox: { pending: 0, dead: 0, deadLast24h: 0, skipped: 5000, sentLast24h: 3 },
      configured: { email: true },
      maintenance: { lastRunAt: new Date().toISOString() },
    };
    assert.deepEqual(monitor.evaluate({ ready: { ok: true, ms: 100 }, detail }), []);
  });

  delete process.env.EMAIL_SKIP;
  console.log(`\n${passed} checks passed\n`);
}

main()
  .then(() => testDb.$disconnect())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
