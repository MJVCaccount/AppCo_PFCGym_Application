-- Offers are listed by event (admin event page, cancellation emails); the only
-- other index on the table leads with fighterId. Additive and backward
-- compatible with the previous release.
CREATE INDEX "EventParticipation_eventId_idx" ON "EventParticipation"("eventId");
