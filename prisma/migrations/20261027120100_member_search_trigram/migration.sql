-- Fail fast instead of queueing behind another transaction and blocking every
-- request behind this one (Squawk: require-lock-timeout, require-statement-timeout).
SET lock_timeout = '5s';
SET statement_timeout = '60s';

-- Substring search on the admin members page (ILIKE '%text%' on name or email).
-- Without these the search reads every User row; with them it reads the index.
-- Measured on 10,000 users: 11.6 ms -> 0.7 ms (see docs/task3/backend-changes.md).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "User_fullName_trgm_idx" ON "User" USING GIN ("fullName" gin_trgm_ops);
CREATE INDEX "User_email_trgm_idx" ON "User" USING GIN ("email" gin_trgm_ops);

RESET lock_timeout;
RESET statement_timeout;
