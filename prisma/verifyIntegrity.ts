/**
 * Read-only integrity check. Looks for rows that should not exist: broken
 * subtype links, bookings over capacity, and every rule the CHECK constraints
 * in the integrity migration enforce (so a database that predates them can be
 * audited before they are applied).
 *
 * Run with: npm run db:verify   (exits 1 when anything is found)
 *
 * It only SELECTs. Nothing is written, so it is safe on any database the
 * connection string points at.
 */
import { PrismaClient } from "@prisma/client";

export interface Violation {
  rule: string;
  count: number;
  /** Up to ten ids of offending rows, to find them by hand. */
  sampleIds: number[];
}

interface Rule {
  name: string;
  /** Returns one `id` column for each offending row. */
  sql: string;
}

const RULES: Rule[] = [
  // ---- subtype rows
  {
    name: "a User with role Member or Fighter has no Member row",
    sql: `SELECT u."id" FROM "User" u LEFT JOIN "Member" m ON m."membershipId" = u."id"
          WHERE u."role" IN ('Member','Fighter') AND m."membershipId" IS NULL`,
  },
  {
    name: "a User with role Fighter has no Fighter row",
    sql: `SELECT u."id" FROM "User" u LEFT JOIN "Fighter" f ON f."fighterId" = u."id"
          WHERE u."role" = 'Fighter' AND f."fighterId" IS NULL`,
  },
  {
    name: "a User with role Coach has no Coach row",
    sql: `SELECT u."id" FROM "User" u LEFT JOIN "Coach" c ON c."coachId" = u."id"
          WHERE u."role" = 'Coach' AND c."coachId" IS NULL`,
  },
  {
    name: "a User with role Admin has no Admin row",
    sql: `SELECT u."id" FROM "User" u LEFT JOIN "Admin" a ON a."adminId" = u."id"
          WHERE u."role" = 'Admin' AND a."adminId" IS NULL`,
  },
  {
    name: "a Member row belongs to a User whose role is not Member or Fighter",
    sql: `SELECT m."membershipId" AS "id" FROM "Member" m JOIN "User" u ON u."id" = m."membershipId"
          WHERE u."role" NOT IN ('Member','Fighter')`,
  },
  {
    name: "a Fighter row belongs to a User whose role is not Fighter",
    sql: `SELECT f."fighterId" AS "id" FROM "Fighter" f JOIN "User" u ON u."id" = f."fighterId"
          WHERE u."role" <> 'Fighter'`,
  },
  {
    name: "a Coach row belongs to a User whose role is not Coach",
    sql: `SELECT c."coachId" AS "id" FROM "Coach" c JOIN "User" u ON u."id" = c."coachId"
          WHERE u."role" <> 'Coach'`,
  },
  {
    name: "an Admin row belongs to a User whose role is not Admin",
    sql: `SELECT a."adminId" AS "id" FROM "Admin" a JOIN "User" u ON u."id" = a."adminId"
          WHERE u."role" <> 'Admin'`,
  },
  {
    name: "a User has more than one subtype row",
    sql: `SELECT u."id" FROM "User" u
          LEFT JOIN "Member" m ON m."membershipId" = u."id"
          LEFT JOIN "Coach" c ON c."coachId" = u."id"
          LEFT JOIN "Admin" a ON a."adminId" = u."id"
          WHERE (m."membershipId" IS NOT NULL)::int + (c."coachId" IS NOT NULL)::int
              + (a."adminId" IS NOT NULL)::int > 1`,
  },

  // ---- bookings
  {
    name: "a class session holds more Confirmed bookings than its capacity",
    sql: `SELECT g."id" FROM "GymClass" g
          JOIN "Booking" b ON b."gymClassId" = g."id" AND b."status" = 'Confirmed'
          GROUP BY g."id", g."capacity", b."sessionDate" HAVING COUNT(*) > g."capacity"`,
  },
  {
    name: "a Booking has a failureReason without being Failed, or is Failed without one",
    sql: `SELECT "id" FROM "Booking"
          WHERE ("status" = 'Failed') <> ("failureReason" IS NOT NULL)`,
  },
  {
    name: "a Booking has cancelledAt without being Cancelled, or is Cancelled without it",
    sql: `SELECT "id" FROM "Booking"
          WHERE ("status" = 'Cancelled') <> ("cancelledAt" IS NOT NULL)`,
  },
  {
    name: "a Booking has completedAt without being Completed, or is Completed without it",
    sql: `SELECT "id" FROM "Booking"
          WHERE ("status" = 'Completed') <> ("completedAt" IS NOT NULL)`,
  },

  // ---- fighters
  {
    name: "a Fighter has a negative record or a blank weight class",
    sql: `SELECT "fighterId" AS "id" FROM "Fighter"
          WHERE "wins" < 0 OR "losses" < 0 OR "draws" < 0 OR btrim("weightClass") = ''`,
  },
  {
    name: "a bout has a result but the fighter did not accept it",
    sql: `SELECT "id" FROM "EventParticipation"
          WHERE "result" IS NOT NULL AND "availability" <> 'Accepted'`,
  },
  {
    name: "a bout offer has an answer without respondedAt, or respondedAt without an answer",
    sql: `SELECT "id" FROM "EventParticipation"
          WHERE ("availability" <> 'Pending') <> ("respondedAt" IS NOT NULL)`,
  },
  {
    name: "a Fighter's record differs from the results recorded for them",
    sql: `SELECT f."fighterId" AS "id" FROM "Fighter" f
          LEFT JOIN (
            SELECT "fighterId",
                   COUNT(*) FILTER (WHERE "result" = 'Win')  AS w,
                   COUNT(*) FILTER (WHERE "result" = 'Loss') AS l,
                   COUNT(*) FILTER (WHERE "result" = 'Draw') AS d
            FROM "EventParticipation" GROUP BY "fighterId"
          ) r ON r."fighterId" = f."fighterId"
          WHERE f."wins" < COALESCE(r.w, 0) OR f."losses" < COALESCE(r.l, 0)
             OR f."draws" < COALESCE(r.d, 0)`,
  },

  // ---- documents, tokens, users
  {
    name: "a FighterDocument has reviewedAt that does not match its status",
    sql: `SELECT "id" FROM "FighterDocument"
          WHERE ("status" <> 'Pending') <> ("reviewedAt" IS NOT NULL)`,
  },
  {
    name: "a PasswordResetToken expires before it was created",
    sql: `SELECT "id" FROM "PasswordResetToken" WHERE "expiresAt" <= "createdAt"`,
  },
  {
    name: "a User email is not stored in lowercase",
    sql: `SELECT "id" FROM "User" WHERE "email" <> lower("email")`,
  },
];

export async function verifyIntegrity(db: PrismaClient): Promise<Violation[]> {
  const found: Violation[] = [];

  for (const rule of RULES) {
    const rows = await db.$queryRawUnsafe<{ id: number }[]>(rule.sql);
    if (rows.length > 0) {
      found.push({
        rule: rule.name,
        count: rows.length,
        sampleIds: rows.slice(0, 10).map((r) => Number(r.id)),
      });
    }
  }

  return found;
}

export const RULE_COUNT = RULES.length;

async function main() {
  const db = new PrismaClient();

  try {
    const violations = await verifyIntegrity(db);

    if (violations.length === 0) {
      console.log(`Integrity: all ${RULE_COUNT} checks passed.`);
      return;
    }

    for (const v of violations) {
      console.log(`FAIL  ${v.rule}: ${v.count} row(s), ids ${v.sampleIds.join(", ")}`);
    }
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
