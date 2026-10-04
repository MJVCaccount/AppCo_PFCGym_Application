-- CreateEnum
CREATE TYPE "Role" AS ENUM ('Member', 'Fighter', 'Coach', 'Admin');

-- CreateEnum
CREATE TYPE "Day" AS ENUM ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun');

-- CreateEnum
CREATE TYPE "ClassKind" AS ENUM ('Group', 'Private', 'Kids', 'Fighters');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('Pending', 'Confirmed', 'Failed', 'Completed', 'Cancelled', 'NoShow');

-- CreateEnum
CREATE TYPE "Availability" AS ENUM ('Pending', 'Accepted', 'Declined');

-- CreateEnum
CREATE TYPE "BoutResult" AS ENUM ('Win', 'Loss', 'Draw', 'NoContest');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('Scheduled', 'Completed', 'Cancelled');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('Medical', 'Licence', 'Other');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('Pending', 'Approved', 'Rejected');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "role" "Role" NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "passwordSalt" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "membershipId" INTEGER NOT NULL,
    "planId" INTEGER,
    "planChangedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "Member_pkey" PRIMARY KEY ("membershipId")
);

-- CreateTable
CREATE TABLE "Fighter" (
    "fighterId" INTEGER NOT NULL,
    "weightClass" TEXT NOT NULL,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "imageUrl" TEXT,

    CONSTRAINT "Fighter_pkey" PRIMARY KEY ("fighterId")
);

-- CreateTable
CREATE TABLE "Coach" (
    "coachId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "bio" TEXT NOT NULL,
    "imageUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Coach_pkey" PRIMARY KEY ("coachId")
);

-- CreateTable
CREATE TABLE "Admin" (
    "adminId" INTEGER NOT NULL,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("adminId")
);

-- CreateTable
CREATE TABLE "MembershipPlan" (
    "id" SERIAL NOT NULL,
    "pricePerMonth" INTEGER NOT NULL,
    "isMostPopular" BOOLEAN NOT NULL DEFAULT false,
    "features" TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MembershipPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassProgramme" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ClassProgramme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GymClass" (
    "id" SERIAL NOT NULL,
    "programmeId" INTEGER,
    "name" TEXT NOT NULL,
    "kind" "ClassKind" NOT NULL DEFAULT 'Group',
    "coachId" INTEGER NOT NULL,
    "day" "Day" NOT NULL,
    "startsAt" VARCHAR(5) NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GymClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "gymClassId" INTEGER NOT NULL,
    "sessionDate" DATE NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'Pending',
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitionEvent" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "venue" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "imageUrl" TEXT,
    "status" "EventStatus" NOT NULL DEFAULT 'Scheduled',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventParticipation" (
    "id" SERIAL NOT NULL,
    "fighterId" INTEGER NOT NULL,
    "eventId" INTEGER NOT NULL,
    "availability" "Availability" NOT NULL DEFAULT 'Pending',
    "opponentName" TEXT,
    "boutWeightClass" TEXT,
    "boutNotes" TEXT,
    "result" "BoutResult",
    "resultNotes" TEXT,
    "offeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "EventParticipation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FighterDocument" (
    "id" SERIAL NOT NULL,
    "fighterId" INTEGER NOT NULL,
    "type" "DocumentType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'Pending',
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FighterDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactEnquiry" (
    "id" SERIAL NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "message" TEXT NOT NULL,
    "emailSentAt" TIMESTAMP(3),
    "handledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactEnquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "actorId" INTEGER,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" INTEGER,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" SERIAL NOT NULL,
    "memberName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "postedOn" DATE NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpeningHours" (
    "day" "Day" NOT NULL,
    "opens" INTEGER NOT NULL,
    "closes" INTEGER NOT NULL,

    CONSTRAINT "OpeningHours_pkey" PRIMARY KEY ("day")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "ClassProgramme_slug_key" ON "ClassProgramme"("slug");

-- CreateIndex
CREATE INDEX "GymClass_day_startsAt_idx" ON "GymClass"("day", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "GymClass_coachId_day_startsAt_key" ON "GymClass"("coachId", "day", "startsAt");

-- CreateIndex
CREATE INDEX "Booking_gymClassId_sessionDate_status_idx" ON "Booking"("gymClassId", "sessionDate", "status");

-- CreateIndex
CREATE INDEX "Booking_memberId_sessionDate_idx" ON "Booking"("memberId", "sessionDate");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_memberId_gymClassId_sessionDate_key" ON "Booking"("memberId", "gymClassId", "sessionDate");

-- CreateIndex
CREATE INDEX "CompetitionEvent_eventDate_idx" ON "CompetitionEvent"("eventDate");

-- CreateIndex
CREATE UNIQUE INDEX "EventParticipation_fighterId_eventId_key" ON "EventParticipation"("fighterId", "eventId");

-- CreateIndex
CREATE INDEX "FighterDocument_fighterId_idx" ON "FighterDocument"("fighterId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MembershipPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Fighter" ADD CONSTRAINT "Fighter_fighterId_fkey" FOREIGN KEY ("fighterId") REFERENCES "Member"("membershipId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coach" ADD CONSTRAINT "Coach_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Admin" ADD CONSTRAINT "Admin_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GymClass" ADD CONSTRAINT "GymClass_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "ClassProgramme"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GymClass" ADD CONSTRAINT "GymClass_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Coach"("coachId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("membershipId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_gymClassId_fkey" FOREIGN KEY ("gymClassId") REFERENCES "GymClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventParticipation" ADD CONSTRAINT "EventParticipation_fighterId_fkey" FOREIGN KEY ("fighterId") REFERENCES "Fighter"("fighterId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventParticipation" ADD CONSTRAINT "EventParticipation_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CompetitionEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FighterDocument" ADD CONSTRAINT "FighterDocument_fighterId_fkey" FOREIGN KEY ("fighterId") REFERENCES "Fighter"("fighterId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
