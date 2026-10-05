-- Integrity rules Prisma's schema language cannot express.
ALTER TABLE "GymClass" ADD CONSTRAINT gymclass_capacity_positive CHECK (capacity > 0 AND "durationMinutes" > 0);
ALTER TABLE "GymClass" ADD CONSTRAINT gymclass_time_format CHECK ("startsAt" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
ALTER TABLE "MembershipPlan" ADD CONSTRAINT plan_price_nonnegative CHECK ("pricePerMonth" >= 0);
ALTER TABLE "Review" ADD CONSTRAINT review_rating_range CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE "OpeningHours" ADD CONSTRAINT hours_range CHECK (opens BETWEEN 0 AND 23 AND closes BETWEEN 1 AND 24 AND closes > opens);
