import "server-only";

import { queueEmail } from "@/lib/email/queue";
import { queueOutboxEmail, recordDirectSend } from "@/lib/services/outboxService";
import * as templates from "@/lib/email/templates";
import { DAY_NAMES, type BoutOffer, type DayKey } from "@/lib/types";

/**
 * Every email the app sends, one function each. A caller says what happened;
 * this file decides who is told and with which template. All of them queue
 * the send, so they return at once and can never fail the caller's action.
 */

export interface Recipient {
  fullName: string;
  email: string;
}

export function notifyWelcome(user: Recipient): void {
  queueOutboxEmail("welcome", () => ({
    to: user.email,
    ...templates.welcome({ fullName: user.fullName }),
  }));
}

export function notifyBookingConfirmed(
  user: Recipient,
  booking: {
    className: string;
    coachName: string;
    day: DayKey;
    startsAt: string;
    sessionDate: string;
  },
): void {
  queueOutboxEmail("booking.confirmed", () => ({
    to: user.email,
    ...templates.bookingConfirmed({
      fullName: user.fullName,
      className: booking.className,
      coachName: booking.coachName,
      dayName: DAY_NAMES[booking.day],
      startsAt: booking.startsAt,
      sessionDate: booking.sessionDate,
    }),
  }));
}

export function notifyBookingsCancelledByGym(
  cancelled: (Recipient & {
    className: string;
    day: DayKey;
    startsAt: string;
    sessionDate: string;
  })[],
): void {
  for (const booking of cancelled) {
    queueOutboxEmail("booking.cancelled", () => ({
      to: booking.email,
      ...templates.bookingCancelledByGym({
        fullName: booking.fullName,
        className: booking.className,
        dayName: DAY_NAMES[booking.day],
        startsAt: booking.startsAt,
        sessionDate: booking.sessionDate,
      }),
    }));
  }
}

export function notifyBoutOffered(user: Recipient, offer: BoutOffer): void {
  queueOutboxEmail("bout.offered", () => ({
    to: user.email,
    ...templates.boutOffered({
      fullName: user.fullName,
      eventName: offer.eventName,
      eventDate: offer.eventDate,
      venue: offer.venue,
      opponentName: offer.opponentName,
      boutWeightClass: offer.boutWeightClass,
    }),
  }));
}

export function notifyEventCancelled(
  fighters: Recipient[],
  event: { name: string; eventDate: string },
): void {
  for (const fighter of fighters) {
    queueOutboxEmail("event.cancelled", () => ({
      to: fighter.email,
      ...templates.eventCancelled({
        fullName: fighter.fullName,
        eventName: event.name,
        eventDate: event.eventDate,
      }),
    }));
  }
}

export function notifyDocumentReviewed(
  user: Recipient,
  review: {
    documentType: string;
    status: "Approved" | "Rejected";
    note: string | null;
  },
): void {
  queueOutboxEmail("document.reviewed", () => ({
    to: user.email,
    ...templates.documentReviewed({
      fullName: user.fullName,
      documentType: review.documentType,
      status: review.status,
      note: review.note,
    }),
  }));
}

export function notifyPasswordReset(user: Recipient, token: string, minutesValid: number): void {
  queueEmail(
    () => ({
      to: user.email,
      ...templates.passwordReset({ fullName: user.fullName, token, minutesValid }),
    }),
    countDirect("password.reset"),
  );
}

export function notifyCoachInvite(user: Recipient, token: string, daysValid: number): void {
  queueEmail(
    () => ({
      to: user.email,
      ...templates.coachInvite({ fullName: user.fullName, token, daysValid }),
    }),
    countDirect("coach.invite"),
  );
}

/**
 * Both messages for one saved enquiry: the gym's copy and the visitor's
 * receipt. `onGymCopy` hears whether the gym's copy went out, so the caller
 * can record it.
 */
export function notifyEnquiry(enquiry: {
  id: number;
  fullName: string;
  email: string;
  phone: string | null;
  message: string;
}): void {
  queueOutboxEmail(
    "enquiry.gym",
    () => {
      const inbox = process.env.CONTACT_INBOX?.trim();
      if (!inbox) return null;

      return {
        to: inbox,
        replyTo: enquiry.email,
        ...templates.enquiryToGym(enquiry),
      };
    },
    { enquiryId: enquiry.id },
  );

  queueOutboxEmail("enquiry.receipt", () => ({
    to: enquiry.email,
    ...templates.enquiryReceivedAutoReply({ fullName: enquiry.fullName }),
  }));
}

/**
 * These two carry a link with the raw token, so they are sent directly and a
 * stored copy would be a working password reset. The send is only counted, so
 * the daily cap on the outbox knows about it.
 */
function countDirect(kind: string): (sent: boolean) => Promise<void> {
  return async (sent) => {
    if (sent) await recordDirectSend(kind);
  };
}
