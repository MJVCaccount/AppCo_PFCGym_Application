/**
 * The seed's password overrides, against the test database: with
 * SEED_ADMIN_PASSWORD and SEED_DEMO_PASSWORD set the new passwords sign in and
 * the published ones do not; seeding again without them restores the published
 * ones. The seed never prints a password.
 */
import assert from "node:assert/strict";

import { resetDatabase, seedTestDatabase, testDb } from "./helpers/db";

import { validateCredentials } from "../src/lib/repositories/usersRepository";

let passed = 0;
async function check(label: string, fn: () => Promise<void> | void) {
  await fn();
  passed++;
  console.log("  ok  " + label);
}

const ADMIN_NEW = "hosted-admin-passphrase-1";
const DEMO_NEW = "hosted-demo-passphrase-2";

const ADMIN = ["admin@pfc.co.za", "Admin123!"] as const;
const DEMO = [
  ["member@pfc.co.za", "Member123!"],
  ["fighter@pfc.co.za", "Fighter123!"],
  ["marcus@pfc.co.za", "Coach123!"],
  ["sofia@pfc.co.za", "Coach123!"],
] as const;

async function signsIn(email: string, password: string): Promise<boolean> {
  return (await validateCredentials(email, password)) !== null;
}

async function main() {
  await resetDatabase();

  await check("with no overrides the published passwords sign in", async () => {
    assert.equal(await signsIn(...ADMIN), true);
    for (const [email, password] of DEMO) assert.equal(await signsIn(email, password), true, email);
  });

  await check("with both variables set, the new passwords sign in and the published ones do not", async () => {
    const output = seedTestDatabase({ SEED_ADMIN_PASSWORD: ADMIN_NEW, SEED_DEMO_PASSWORD: DEMO_NEW });

    assert.equal(await signsIn(ADMIN[0], ADMIN_NEW), true);
    assert.equal(await signsIn(ADMIN[0], ADMIN[1]), false, "the published admin password is dead");
    assert.equal(await signsIn(ADMIN[0], DEMO_NEW), false, "the demo password does not open the admin account");

    for (const [email, published] of DEMO) {
      assert.equal(await signsIn(email, DEMO_NEW), true, email);
      assert.equal(await signsIn(email, published), false, `${email} published password is dead`);
      assert.equal(await signsIn(email, ADMIN_NEW), false, `${email} does not take the admin password`);
    }

    assert.match(output, /Using passwords from the environment/);
    assert.match(output, /Seeding /);
    assert.ok(!output.includes(ADMIN_NEW) && !output.includes(DEMO_NEW), "the seed printed a password");
    for (const published of ["Member123!", "Fighter123!", "Coach123!", "Admin123!"]) {
      assert.ok(!output.includes(published), "the seed printed a published password");
    }
  });

  await check("nothing else changes: other coaches and filler members still have unknown passwords", async () => {
    for (const email of ["jake@pfc.co.za", "priya@pfc.co.za", "leon@pfc.co.za", "maurice@pfc.co.za", "filler01@demo.pfc.invalid"]) {
      for (const guess of [DEMO_NEW, ADMIN_NEW, "Coach123!", "Member123!"]) {
        assert.equal(await signsIn(email, guess), false, email);
      }
    }
    assert.equal(await testDb.user.count(), 33);
  });

  await check("only the admin variable set changes only the admin", async () => {
    seedTestDatabase({ SEED_ADMIN_PASSWORD: ADMIN_NEW });
    assert.equal(await signsIn(ADMIN[0], ADMIN_NEW), true);
    assert.equal(await signsIn("member@pfc.co.za", "Member123!"), true);
    assert.equal(await signsIn("member@pfc.co.za", DEMO_NEW), false);
  });

  await check("a bad override refuses the seed before it writes anything", async () => {
    const bad: Record<string, string>[] = [
      { SEED_ADMIN_PASSWORD: "tooshort1" },
      { SEED_DEMO_PASSWORD: "Coach123!" },
      { SEED_ADMIN_PASSWORD: ADMIN_NEW, SEED_DEMO_PASSWORD: ADMIN_NEW },
    ];
    for (const env of bad) {
      assert.throws(
        () => seedTestDatabase(env),
        (error: Error) => {
          assert.match(error.message, /Refusing to seed/);
          for (const value of Object.values(env)) {
            assert.ok(!error.message.includes(value), "the refusal named a password");
          }
          assert.ok(!error.message.includes(ADMIN_NEW), "the refusal named a password");
          return true;
        },
      );
    }
    assert.equal(await signsIn(ADMIN[0], ADMIN_NEW), true, "the earlier passwords are untouched");
  });

  await check("seeding again without the variables restores the published passwords", async () => {
    const output = seedTestDatabase();
    assert.doesNotMatch(output, /Using passwords from the environment/);
    assert.equal(await signsIn(...ADMIN), true);
    for (const [email, password] of DEMO) assert.equal(await signsIn(email, password), true, email);
    assert.equal(await signsIn(ADMIN[0], ADMIN_NEW), false);
    assert.equal(await signsIn("member@pfc.co.za", DEMO_NEW), false);
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
