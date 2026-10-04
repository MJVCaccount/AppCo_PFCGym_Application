import "server-only";

import {
  createEvent as insertEvent,
  type EventFields,
  listUpcoming,
  setStatus,
  updateEvent as updateRow,
} from "@/lib/repositories/eventsRepository";
import {
  createOffer,
  setAvailability,
  setResult,
} from "@/lib/repositories/participationsRepository";
import {
  ADMIN_ONLY,
  fail,
  failure,
  isAdmin,
  isOptionalString,
  isValidId,
  succeed,
} from "@/lib/services/serviceResult";
import { optionalText } from "@/lib/text";
import {
  BOUT_RESULTS,
  type BoutOffer,
  type BoutResult,
  type CompetitionEvent,
  ROLES,
  type ServiceResult,
  type SessionUser,
} from "@/lib/types";
import { RULES } from "@/lib/validation";

/**
 * Business rules for competition events, bout offers and results.
 *
 * Every function takes the session first and checks the role itself; none of
 * them reads `next/headers`. Input arrives as `unknown` because it comes
 * straight from a JSON body or a form, and is validated here so the routes
 * and actions hold no rules of their own. `now` is a parameter so the tests
 * can stand before or after an event without waiting for it.
 */

const NOT_FOUND_EVENT = "That event could not be found.";
const NOT_FOUND_FIGHTER = "That fighter could not be found.";
const NOT_FOUND_OFFER = "That offer could not be found.";
const EVENT_CLOSED = "That event is no longer open for bout offers.";
const NOT_SCHEDULED = "Only a scheduled event can be changed that way.";
const NOT_HAPPENED = "The event has not happened yet.";

/** Vercel Blob serves public files from <store>.public.blob.vercel-storage.com. */
const BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";

// An explicit offset is required. Without one the same text would mean a
// different instant depending on the time zone of the machine that parsed it.
const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

const MAX_OPPONENT = 120;
const MAX_BOUT_WEIGHT_CLASS = 40;
const MAX_NOTES = 1000;

export interface EventInput {
  name?: unknown;
  venue?: unknown;
  description?: unknown;
  eventDate?: unknown;
  imageUrl?: unknown;
}

export interface OfferInput {
  opponentName?: unknown;
  boutWeightClass?: unknown;
  boutNotes?: unknown;
}

type Parsed<T> = { value: T } | { error: string };

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseEventDate(value: unknown): Parsed<Date> {
  const error = {
    error:
      "Event date must be an ISO date and time with a time zone, e.g. 2026-11-28T19:00:00+02:00.",
  };
  if (typeof value !== "string" || !ISO_INSTANT.test(value.trim())) return error;

  const date = new Date(value.trim());
  return Number.isNaN(date.getTime()) ? error : { value: date };
}

function parseImageUrl(value: unknown): Parsed<string | null> {
  const error = {
    error: "Image URL must be an https link to an uploaded image, or empty.",
  };
  if (!isOptionalString(value)) return error;

  const text = optionalText(value);
  if (text === null) return { value: null };

  try {
    const url = new URL(text);
    const allowed =
      url.protocol === "https:" && url.hostname.endsWith(BLOB_HOST_SUFFIX);
    return allowed ? { value: url.toString() } : error;
  } catch {
    return error;
  }
}

/** An optional text field of at most `max` characters, blank stored as null. */
function parseOptionalText(
  value: unknown,
  label: string,
  max: number,
): Parsed<string | null> {
  if (!isOptionalString(value)) return { error: `${label} must be text.` };

  const text = optionalText(value);
  if (text !== null && text.length > max) {
    return { error: `${label} must be at most ${max} characters.` };
  }
  return { value: text };
}

/**
 * Validates the event fields that are present. With `partial` false every
 * field except imageUrl is required; with it true, only what was sent is
 * checked and returned, which is what an update needs.
 */
function parseEventFields(
  input: EventInput,
  partial: boolean,
): Parsed<Partial<EventFields>> {
  const fields: Partial<EventFields> = {};

  if (!partial || input.name !== undefined) {
    const error = RULES.eventName(asText(input.name));
    if (error) return { error };
    fields.name = asText(input.name).trim();
  }

  if (!partial || input.venue !== undefined) {
    const error = RULES.venue(asText(input.venue));
    if (error) return { error };
    fields.venue = asText(input.venue).trim();
  }

  if (!partial || input.description !== undefined) {
    const error = RULES.eventDescription(asText(input.description));
    if (error) return { error };
    fields.description = asText(input.description).trim();
  }

  if (!partial || input.eventDate !== undefined) {
    const date = parseEventDate(input.eventDate);
    if ("error" in date) return date;
    fields.eventDate = date.value;
  }

  if (!partial || input.imageUrl !== undefined) {
    const image = parseImageUrl(input.imageUrl);
    if ("error" in image) return image;
    fields.imageUrl = image.value;
  }

  return { value: fields };
}

// ---------------------------------------------------------------- events

/** Scheduled, future events. Public: no session needed. */
export async function listPublicEvents(
  now: Date = new Date(),
): Promise<CompetitionEvent[]> {
  return listUpcoming(now);
}

export async function createEvent(
  session: SessionUser,
  input: EventInput,
  now: Date = new Date(),
): Promise<ServiceResult<CompetitionEvent>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);

  const parsed = parseEventFields(input, false);
  if ("error" in parsed) return fail(400, parsed.error);

  const fields = parsed.value as EventFields;
  if (fields.eventDate <= now) {
    return fail(400, "Event date must be in the future.");
  }

  try {
    return succeed(await insertEvent(fields, session.id), 201);
  } catch (e) {
    return failure(e);
  }
}

export async function updateEvent(
  session: SessionUser,
  eventId: unknown,
  input: EventInput,
): Promise<ServiceResult<CompetitionEvent>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);

  if (!isValidId(eventId)) {
    return fail(400, "eventId must be a positive integer.");
  }

  const parsed = parseEventFields(input, true);
  if ("error" in parsed) return fail(400, parsed.error);
  if (Object.keys(parsed.value).length === 0) {
    return fail(
      400,
      "Send at least one of name, venue, description, eventDate or imageUrl.",
    );
  }

  try {
    const result = await updateRow(eventId, parsed.value, session.id);
    return result.ok ? succeed(result.event) : fail(404, NOT_FOUND_EVENT);
  } catch (e) {
    return failure(e);
  }
}

async function changeStatus(
  session: SessionUser,
  eventId: unknown,
  status: "Cancelled" | "Completed",
  now: Date,
): Promise<ServiceResult<CompetitionEvent>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);

  if (!isValidId(eventId)) {
    return fail(400, "eventId must be a positive integer.");
  }

  try {
    const result = await setStatus(eventId, status, session.id, now);

    if (!result.ok) {
      switch (result.reason) {
        case "not-found":
          return fail(404, NOT_FOUND_EVENT);
        case "not-scheduled":
          return fail(409, NOT_SCHEDULED);
        case "not-happened":
          return fail(409, NOT_HAPPENED);
      }
    }

    return succeed(result.event);
  } catch (e) {
    return failure(e);
  }
}

/** Marks an event Cancelled. The row, its offers and its results are kept. */
export async function cancelEvent(
  session: SessionUser,
  eventId: unknown,
  now: Date = new Date(),
): Promise<ServiceResult<CompetitionEvent>> {
  return changeStatus(session, eventId, "Cancelled", now);
}

/** Marks an event Completed, once its date has passed. */
export async function completeEvent(
  session: SessionUser,
  eventId: unknown,
  now: Date = new Date(),
): Promise<ServiceResult<CompetitionEvent>> {
  return changeStatus(session, eventId, "Completed", now);
}

// ---------------------------------------------------------------- offers

export async function offerBout(
  session: SessionUser,
  eventId: unknown,
  fighterId: unknown,
  input: OfferInput = {},
  now: Date = new Date(),
): Promise<ServiceResult<BoutOffer>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);

  if (!isValidId(eventId)) {
    return fail(400, "eventId must be a positive integer.");
  }
  if (!isValidId(fighterId)) {
    return fail(400, "fighterId must be a positive integer.");
  }

  const opponentName = parseOptionalText(
    input.opponentName,
    "Opponent name",
    MAX_OPPONENT,
  );
  if ("error" in opponentName) return fail(400, opponentName.error);

  const boutWeightClass = parseOptionalText(
    input.boutWeightClass,
    "Bout weight class",
    MAX_BOUT_WEIGHT_CLASS,
  );
  if ("error" in boutWeightClass) return fail(400, boutWeightClass.error);

  const boutNotes = parseOptionalText(input.boutNotes, "Bout notes", MAX_NOTES);
  if ("error" in boutNotes) return fail(400, boutNotes.error);

  try {
    const result = await createOffer(
      {
        eventId,
        fighterId,
        opponentName: opponentName.value,
        boutWeightClass: boutWeightClass.value,
        boutNotes: boutNotes.value,
      },
      session.id,
      now,
    );

    if (!result.ok) {
      switch (result.reason) {
        case "event-not-found":
          return fail(404, NOT_FOUND_EVENT);
        case "fighter-not-found":
          return fail(404, NOT_FOUND_FIGHTER);
        case "event-closed":
          return fail(409, EVENT_CLOSED);
        case "duplicate":
          return fail(409, "That fighter already has an offer for this event.");
      }
    }

    return succeed(result.offer, 201);
  } catch (e) {
    return failure(e);
  }
}

/**
 * A fighter accepts or declines their own offer.
 *
 * Someone else's offer answers 404, never 403, so a fighter cannot learn
 * which offer ids exist. The answer can be changed until the event starts.
 */
export async function respondToOffer(
  session: SessionUser,
  participationId: unknown,
  response: unknown,
  now: Date = new Date(),
): Promise<ServiceResult<BoutOffer>> {
  if (session.role !== ROLES.Fighter) {
    return fail(403, "Only fighters can answer a bout offer.");
  }

  if (!isValidId(participationId)) {
    return fail(400, "participationId must be a positive integer.");
  }
  if (response !== "Accepted" && response !== "Declined") {
    return fail(400, 'response must be "Accepted" or "Declined".');
  }

  try {
    const result = await setAvailability(
      participationId,
      session.id,
      response,
      now,
    );

    if (!result.ok) {
      return result.reason === "not-found"
        ? fail(404, NOT_FOUND_OFFER)
        : fail(409, "This event is no longer open for answers.");
    }

    return succeed(result.offer);
  } catch (e) {
    return failure(e);
  }
}

/**
 * Records, changes or clears (null) a bout result after the event.
 *
 * The fighter's wins, losses and draws move with it, so recording the same
 * result twice changes nothing and changing a result moves one counter down
 * and another up.
 */
export async function recordResult(
  session: SessionUser,
  participationId: unknown,
  result: unknown,
  notes?: unknown,
  now: Date = new Date(),
): Promise<ServiceResult<BoutOffer>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);

  if (!isValidId(participationId)) {
    return fail(400, "participationId must be a positive integer.");
  }
  if (result !== null && !BOUT_RESULTS.includes(result as BoutResult)) {
    return fail(400, "result must be Win, Loss, Draw, NoContest or null.");
  }

  const resultNotes = parseOptionalText(notes, "Result notes", MAX_NOTES);
  if ("error" in resultNotes) return fail(400, resultNotes.error);

  try {
    const outcome = await setResult(
      participationId,
      result as BoutResult | null,
      resultNotes.value,
      session.id,
      now,
    );

    if (!outcome.ok) {
      switch (outcome.reason) {
        case "not-found":
          return fail(404, NOT_FOUND_OFFER);
        case "event-cancelled":
          return fail(409, "The event was cancelled, so it has no results.");
        case "not-happened":
          return fail(409, NOT_HAPPENED);
        case "not-accepted":
          return fail(
            409,
            "A result can only be recorded for an accepted bout.",
          );
      }
    }

    return succeed(outcome.offer);
  } catch (e) {
    return failure(e);
  }
}
