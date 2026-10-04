/**
 * Session tests, run against the seeded test database (see
 * tests/helpers/db.ts). getSession() checks the account's current role and
 * isActive flag in the database on every call, so these tests seed first and
 * use real account ids rather than made-up ones.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { cookies } from "next/headers";

import { resetDatabase, testDb } from "./helpers/db";

import {
  createSession,
  destroySession,
  getSession,
  hasRole,
  isSignedIn,
} from "../src/lib/session";
import type { SessionUser } from "../src/lib/types";

let passed = 0;
async function check(label: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log("  ok  " + label);
}

async function sessionFor(email: string): Promise<SessionUser> {
  const row = await testDb.user.findUniqueOrThrow({ where: { email } });
  return { id: row.id, email: row.email, fullName: row.fullName, role: row.role };
}

async function main() {
  await resetDatabase();

  const admin = await sessionFor("admin@pfc.co.za");
  const fighter = await sessionFor("fighter@pfc.co.za");

  console.log("\nSESSION");

  await check("no session before signing in", async () =>
    assert.equal(await getSession(), null),
  );

  await check("round-trips the user, reading the live role from the database", async () => {
    await createSession(admin);
    assert.deepEqual(await getSession(), admin);
    assert.equal(await isSignedIn(), true);
  });

  await check("role checks read the session", async () => {
    assert.equal(await hasRole("Admin"), true);
    assert.equal(await hasRole("Member", "Coach"), false);
  });

  await check("cookie is httpOnly, lax and path-scoped", async () => {
    const store = await cookies();
    // the stub records the raw value only, so assert on the real module's opts
    const raw = store.get("pfc_session")!.value;
    assert.ok(raw.includes("."), "payload.signature shape");
  });

  await check("tampering with the payload invalidates the session", async () => {
    const store = await cookies();
    const [, signature] = store.get("pfc_session")!.value.split(".");

    // Promote ourselves to Admin... on a Member payload, keeping the old signature
    const forged = Buffer.from(
      JSON.stringify({ ...admin, role: "Admin", id: fighter.id }),
    ).toString("base64url");

    store.set("pfc_session", `${forged}.${signature}`);
    assert.equal(await getSession(), null, "forged payload rejected");
  });

  await check("a garbage cookie is rejected, not thrown on", async () => {
    const store = await cookies();
    for (const junk of ["", "no-dot", "a.b", "....", "%%%.%%%"]) {
      store.set("pfc_session", junk);
      assert.equal(await getSession(), null, `rejected: ${junk}`);
    }
  });

  await check("a validly signed but malformed payload is rejected", async () => {
    // Sign a payload that is real JSON but not a SessionUser.
    await createSession(admin);
    const store = await cookies();
    const good = store.get("pfc_session")!.value;
    const [, sig] = good.split(".");
    const wrongShape = Buffer.from(JSON.stringify({ hello: "world" })).toString(
      "base64url",
    );
    store.set("pfc_session", `${wrongShape}.${sig}`);
    assert.equal(await getSession(), null);
  });

  await check("an unknown role is rejected", async () => {
    await createSession({ ...admin, role: "Superuser" as never });
    assert.equal(await getSession(), null);
  });

  await check("a Fighter session round-trips", async () => {
    await createSession(fighter);
    assert.deepEqual(await getSession(), fighter);
    assert.equal(await hasRole("Member", "Fighter"), true);
  });

  await check("destroySession clears it", async () => {
    await createSession(admin);
    assert.ok(await getSession());
    await destroySession();
    assert.equal(await getSession(), null);
    assert.equal(await isSignedIn(), false);
  });

  console.log("\nSESSION VERSION");

  /** A correctly signed cookie with exactly this payload. */
  function signedCookie(payload: Record<string, unknown>): string {
    const secret = process.env.SESSION_SECRET;
    assert.ok(secret && secret.length >= 32, "tests run with a real SESSION_SECRET");
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
  }

  await check("a validly signed cookie with no sv is rejected", async () => {
    const store = await cookies();
    store.set("pfc_session", signedCookie({ ...admin }));
    assert.equal(await getSession(), null);

    store.set("pfc_session", signedCookie({ ...admin, sv: "0" }));
    assert.equal(await getSession(), null, "sv must be a number");

    store.set("pfc_session", signedCookie({ ...admin, sv: 0 }));
    assert.deepEqual(await getSession(), admin, "the same cookie with a numeric sv works");
  });

  await check("a cookie issued under an older sessionVersion is rejected", async () => {
    await createSession(fighter);
    assert.deepEqual(await getSession(), fighter);

    const store = await cookies();
    const old = store.get("pfc_session")!.value;

    await testDb.user.update({
      where: { id: fighter.id },
      data: { sessionVersion: { increment: 1 } },
    });
    assert.equal(await getSession(), null, "stale sv rejected");

    // A session issued afterwards carries the new version.
    await createSession(fighter);
    assert.deepEqual(await getSession(), fighter);

    // And the old cookie stays dead.
    store.set("pfc_session", old);
    assert.equal(await getSession(), null);
  });

  console.log("\nLIVE ROLE AND ACTIVE STATE");

  await check(
    "a cookie's stale role is ignored: the database's current role wins",
    async () => {
      // The cookie claims Member; the account is really a Fighter.
      await createSession({ ...fighter, role: "Member" });
      const session = await getSession();
      assert.equal(session?.role, "Fighter");
    },
  );

  await check("a deactivated account's session stops working", async () => {
    await createSession(fighter);
    assert.ok(await getSession());

    await testDb.user.update({
      where: { id: fighter.id },
      data: { isActive: false },
    });
    assert.equal(await getSession(), null);

    await testDb.user.update({
      where: { id: fighter.id },
      data: { isActive: true },
    });
    assert.deepEqual(await getSession(), fighter);
  });

  await check("a deleted account's cookie is rejected, not thrown on", async () => {
    const ghost = await testDb.user.create({
      data: {
        email: "ghost@example.co.za",
        fullName: "Ghost Account",
        role: "Member",
        passwordHash: "x",
        passwordSalt: "y",
      },
    });
    await createSession({
      id: ghost.id,
      email: ghost.email,
      fullName: ghost.fullName,
      role: ghost.role,
    });
    await testDb.user.delete({ where: { id: ghost.id } });
    assert.equal(await getSession(), null);
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
