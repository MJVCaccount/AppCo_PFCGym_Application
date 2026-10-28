-- Fail fast instead of queueing behind another transaction and blocking every
-- request behind this one (Squawk: require-lock-timeout, require-statement-timeout).
SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- Email outbox: additive (a new enum and a new table). The previous release
-- neither reads nor writes it, so it is safe to apply before the new code is live.

CREATE TYPE "EmailStatus" AS ENUM ('Pending', 'Sending', 'Sent', 'Dead', 'Skipped');

CREATE TABLE "EmailOutbox" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "toAddress" TEXT NOT NULL,
    "replyTo" TEXT,
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL DEFAULT '',
    "text" TEXT NOT NULL DEFAULT '',
    "status" "EmailStatus" NOT NULL DEFAULT 'Pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "enquiryId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EmailOutbox_status_nextAttemptAt_idx" ON "EmailOutbox"("status", "nextAttemptAt");
CREATE INDEX "EmailOutbox_sentAt_idx" ON "EmailOutbox"("sentAt");

-- A row is Sent exactly when it has a send time; attempts never go negative.
ALTER TABLE "EmailOutbox" ADD CONSTRAINT email_outbox_sent_at_matches_status
  CHECK (("status" = 'Sent') = ("sentAt" IS NOT NULL));
ALTER TABLE "EmailOutbox" ADD CONSTRAINT email_outbox_attempts_nonnegative
  CHECK ("attempts" >= 0);

RESET lock_timeout;
RESET statement_timeout;
