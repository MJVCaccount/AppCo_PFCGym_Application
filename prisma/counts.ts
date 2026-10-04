/**
 * Prints the row count of every table, to check a seed or a migration.
 *
 * Run with: npm run db:counts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const counts: Record<string, number> = {
    User: await prisma.user.count(),
    Member: await prisma.member.count(),
    Fighter: await prisma.fighter.count(),
    Coach: await prisma.coach.count(),
    Admin: await prisma.admin.count(),
    MembershipPlan: await prisma.membershipPlan.count(),
    ClassProgramme: await prisma.classProgramme.count(),
    GymClass: await prisma.gymClass.count(),
    Booking: await prisma.booking.count(),
    CompetitionEvent: await prisma.competitionEvent.count(),
    EventParticipation: await prisma.eventParticipation.count(),
    FighterDocument: await prisma.fighterDocument.count(),
    ContactEnquiry: await prisma.contactEnquiry.count(),
    PasswordResetToken: await prisma.passwordResetToken.count(),
    AuditLog: await prisma.auditLog.count(),
    Review: await prisma.review.count(),
    OpeningHours: await prisma.openingHours.count(),
  };

  for (const [table, count] of Object.entries(counts)) {
    console.log(`${table.padEnd(20)} ${count}`);
  }
}

main()
  .catch((error) => {
    console.error(
      "Count failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
