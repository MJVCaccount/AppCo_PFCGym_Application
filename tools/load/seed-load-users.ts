/**
 * Creates the members the load test signs in as: load01@load.pfc.test and so
 * on, all with one throwaway password, each on a plan so they may book.
 *
 *   DATABASE_URL=<local database> npx tsx tools/load/seed-load-users.ts [count]
 *
 * Refuses any database that is not on localhost.
 */
import { PrismaClient } from "@prisma/client";

import { hashPassword } from "../../src/lib/password";

export const LOAD_PASSWORD = "Load-Test-Password-1!";

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) throw new Error("Refusing to seed load users anywhere but a local database.");

  const count = Number(process.argv[2] ?? 60);
  const db = new PrismaClient();
  const plan = await db.membershipPlan.findFirstOrThrow({ where: { isActive: true } });
  const { hash, salt } = hashPassword(LOAD_PASSWORD);

  for (let n = 1; n <= count; n++) {
    const email = `load${String(n).padStart(2, "0")}@load.pfc.test`;
    await db.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        fullName: `Load User ${n}`,
        role: "Member",
        passwordHash: hash,
        passwordSalt: salt,
        member: { create: { planId: plan.id, planChangedAt: new Date() } },
      },
    });
  }

  console.log(`${count} load users ready (password is the throwaway constant in this file).`);
  await db.$disconnect();
}

void main();
