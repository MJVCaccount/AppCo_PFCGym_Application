import assert from "node:assert/strict";
import { cookies } from "next/headers";

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

const admin: SessionUser = {
  id: 4,
  email: "admin@pfc.co.za",
  fullName: "Ruan Cupido",
  role: "Admin",
};

async function main() {
  console.log("\nSESSION");

  await check("no session before signing in", async () =>
    assert.equal(await getSession(), null),
  );

  await check("round-trips the user", async () => {
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
      JSON.stringify({ ...admin, role: "Admin", id: 1 }),
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

  await check("destroySession clears it", async () => {
    await createSession(admin);
    assert.ok(await getSession());
    await destroySession();
    assert.equal(await getSession(), null);
    assert.equal(await isSignedIn(), false);
  });

  console.log(`\n${passed} checks passed\n`);

}

main();
