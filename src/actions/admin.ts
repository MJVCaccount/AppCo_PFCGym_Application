"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireRole } from "@/actions/auth";
import { gymLocalToIso } from "@/lib/dates";
import {
  createProgramme,
  createSession,
  deactivateProgramme,
  deactivateSession,
  deleteSession,
  reactivateSession,
  updateProgramme,
  updateSession,
} from "@/lib/services/classAdminService";
import {
  archiveCoach,
  createCoach,
  resendInvite,
  restoreCoach,
  updateCoach,
} from "@/lib/services/coachAdminService";
import { setEnquiryHandled } from "@/lib/services/contactService";
import { reviewDocument } from "@/lib/services/documentService";
import {
  cancelEvent,
  completeEvent,
  createEvent,
  offerBout,
  recordResult,
  updateEvent,
} from "@/lib/services/eventService";
import { demoteFighter, promoteToFighter } from "@/lib/services/fighterService";
import {
  deactivateUser,
  reactivateUser,
  setMemberPlan,
} from "@/lib/services/memberAdminService";
import {
  createPlan,
  deactivatePlan,
  updatePlan,
} from "@/lib/services/planAdminService";
import type { ServiceResult } from "@/lib/types";
import { type FormState, valuesFrom } from "@/lib/validation";

/**
 * Server actions for the admin screens.
 *
 * Each one calls requireRole first, because an action can be posted without
 * its page, and then hands the fields to a service. No rule lives here: the
 * services validate, authorise and answer with a message that is safe to show.
 *
 * Forms return a FormState so the fields keep what was typed. Buttons that
 * act on a row redirect back with ?notice= or ?error=, which the page shows.
 */

// ---------------------------------------------------------------- helpers

function text(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

/** A whole number from a text field. Blank is NaN, which the services refuse. */
function toInt(value: FormDataEntryValue | null): number {
  const raw = text(value).trim();
  return raw === "" ? NaN : Number(raw);
}

/** An optional id: blank means none. */
function optionalId(value: FormDataEntryValue | null): number | null {
  return text(value).trim() === "" ? null : toInt(value);
}

function formFailure<T>(
  result: ServiceResult<T>,
  values: Record<string, string>,
  fields: string[],
): FormState {
  const error = result.error ?? "That could not be saved.";
  const onField = result.field !== undefined && fields.includes(result.field);

  return {
    ok: false,
    message: onField ? "Please fix the highlighted field and try again." : error,
    errors: onField ? { [result.field as string]: error } : undefined,
    values,
  };
}

/** Back to a list with a message the page shows as a status or an alert. */
function back(path: string, kind: "notice" | "error", message: string): never {
  const separator = path.includes("?") ? "&" : "?";
  redirect(`${path}${separator}${kind}=${encodeURIComponent(message)}`);
}

function succeeded(path: string, notice: string): never {
  revalidatePath("/", "layout");
  back(path, "notice", notice);
}

/** For a row button: show the service's error on the page, or the notice. */
function finish<T>(
  result: ServiceResult<T>,
  path: string,
  notice: string,
): never {
  if (!result.ok) back(path, "error", result.error ?? "That did not work.");
  succeeded(path, notice);
}

// ---------------------------------------------------------------- classes

const CLASS_FIELDS = [
  "name",
  "kind",
  "coachId",
  "day",
  "startsAt",
  "durationMinutes",
  "capacity",
  "programmeId",
];

function classInput(data: FormData) {
  return {
    name: text(data.get("name")),
    kind: text(data.get("kind")),
    coachId: toInt(data.get("coachId")),
    day: text(data.get("day")),
    startsAt: text(data.get("startsAt")),
    durationMinutes: toInt(data.get("durationMinutes")),
    capacity: toInt(data.get("capacity")),
    programmeId: optionalId(data.get("programmeId")),
  };
}

export async function createClassAction(
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const session = await requireRole("/admin/classes", "Admin");
  const values = valuesFrom(data, CLASS_FIELDS);

  const result = await createSession(session, classInput(data));
  if (!result.ok) return formFailure(result, values, CLASS_FIELDS);

  succeeded("/admin/classes", `Added ${result.data?.name}.`);
}

export async function updateClassAction(
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const session = await requireRole("/admin/classes", "Admin");
  const values = valuesFrom(data, CLASS_FIELDS);

  const result = await updateSession(
    session,
    toInt(data.get("id")),
    classInput(data),
  );
  if (!result.ok) return formFailure(result, values, CLASS_FIELDS);

  succeeded("/admin/classes", `Saved ${result.data?.name}.`);
}

export async function deactivateClassAction(data: FormData): Promise<void> {
  const session = await requireRole("/admin/classes", "Admin");

  const result = await deactivateSession(session, toInt(data.get("id")), {
    cancelBookings: true,
  });
  const cancelled = result.data?.cancelledBookings ?? 0;

  finish(
    result,
    "/admin/classes",
    `Class deactivated. ${cancelled} ${cancelled === 1 ? "booking was" : "bookings were"} cancelled.`,
  );
}

export async function reactivateClassAction(data: FormData): Promise<void> {
  const session = await requireRole("/admin/classes", "Admin");

  finish(
    await reactivateSession(session, toInt(data.get("id"))),
    "/admin/classes",
    "Class reactivated.",
  );
}

export async function deleteClassAction(data: FormData): Promise<void> {
  const session = await requireRole("/admin/classes", "Admin");

  finish(
    await deleteSession(session, toInt(data.get("id"))),
    "/admin/classes",
    "Class deleted.",
  );
}

const PROGRAMME_FIELDS = ["name", "description", "level", "durationMinutes"];

function programmeInput(data: FormData) {
  return {
    name: text(data.get("name")),
    description: text(data.get("description")),
    level: text(data.get("level")),
    durationMinutes: toInt(data.get("durationMinutes")),
  };
}

export async function createProgrammeAction(
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const session = await requireRole("/admin/classes", "Admin");
  const values = valuesFrom(data, PROGRAMME_FIELDS);

  const result = await createProgramme(session, programmeInput(data));
  if (!result.ok) return formFailure(result, values, PROGRAMME_FIELDS);

  succeeded("/admin/classes", `Added the ${result.data?.name} programme.`);
}

export async function updateProgrammeAction(
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const session = await requireRole("/admin/classes", "Admin");
  const values = valuesFrom(data, PROGRAMME_FIELDS);

  const result = await updateProgramme(
    session,
    toInt(data.get("id")),
    programmeInput(data),
  );
  if (!result.ok) return formFailure(result, values, PROGRAMME_FIELDS);

  succeeded("/admin/classes", `Saved the ${result.data?.name} programme.`);
}

export async function deactivateProgrammeAction(data: FormData): Promise<void> {
  const session = await requireRole("/admin/classes", "Admin");

  finish(
    await deactivateProgramme(session, toInt(data.get("id"))),
    "/admin/classes",
    "Programme hidden from the public classes page.",
  );
}

// ---------------------------------------------------------------- coaches

const COACH_FIELDS = ["fullName", "email", "title", "bio", "imageUrl"];

function coachInput(data: FormData) {
  return {
    fullName: text(data.get("fullName")),
    email: text(data.get("email")),
    title: text(data.get("title")),
    bio: text(data.get("bio")),
    imageUrl: text(data.get("imageUrl")),
  };
}

export async function createCoachAction(
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const session = await requireRole("/admin/coaches", "Admin");
  const values = valuesFrom(data, COACH_FIELDS);

  const result = await createCoach(session, coachInput(data));
  if (!result.ok) return formFailure(result, values, COACH_FIELDS);

  succeeded("/admin/coaches", `Added ${result.data?.name}.`);
}

export async function updateCoachAction(
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const session = await requireRole("/admin/coaches", "Admin");
  const values = valuesFrom(data, COACH_FIELDS);

  const result = await updateCoach(
    session,
    toInt(data.get("id")),
    coachInput(data),
  );
  if (!result.ok) return formFailure(result, values, COACH_FIELDS);

  succeeded("/admin/coaches", `Saved ${result.data?.name}.`);
}

export async function archiveCoachAction(data: FormData): Promise<void> {
  const session = await requireRole("/admin/coaches", "Admin");

  finish(
    await archiveCoach(session, toInt(data.get("id"))),
    "/admin/coaches",
    "Coach archived. They no longer appear on the public Coaches page.",
  );
}

export async function resendInviteAction(data: FormData): Promise<void> {
  const session = await requireRole("/admin/coaches", "Admin");

  finish(
    await resendInvite(session, toInt(data.get("id"))),
    "/admin/coaches",
    "Invitation sent. Any earlier link no longer works.",
  );
}

export async function restoreCoachAction(data: FormData): Promise<void> {
  const session = await requireRole("/admin/coaches", "Admin");

  finish(
    await restoreCoach(session, toInt(data.get("id"))),
    "/admin/coaches",
    "Coach restored.",
  );
}

// ---------------------------------------------------------------- members

/** Keeps the search and page the admin was on when a row button is pressed. */
function membersPath(data: FormData): string {
  const params = new URLSearchParams();
  const q = text(data.get("q")).trim();
  const page = text(data.get("page")).trim();

  if (q) params.set("q", q);
  if (page && page !== "1") params.set("page", page);

  const query = params.toString();
  return query ? `/admin/members?${query}` : "/admin/members";
}

export async function setMemberPlanAction(data: FormData): Promise<void> {
  const session = await requireRole("/admin/members", "Admin");
  const planId = optionalId(data.get("planId"));

  finish(
    await setMemberPlan(session, toInt(data.get("id")), planId),
    membersPath(data),
    planId === null ? "Plan removed." : "Plan changed.",
  );
}

export async function deactivateUserAction(data: FormData): Promise<void> {
  const session = await requireRole("/admin/members", "Admin");
  const result = await deactivateUser(session, toInt(data.get("id")));
  const cancelled = result.data?.cancelledBookings ?? 0;

  finish(
    result,
    membersPath(data),
    `Account deactivated. ${cancelled} future ${cancelled === 1 ? "booking was" : "bookings were"} cancelled.`,
  );
}

export async function reactivateUserAction(data: FormData): Promise<void> {
  const session = await requireRole("/admin/members", "Admin");

  finish(
    await reactivateUser(session, toInt(data.get("id"))),
    membersPath(data),
    "Account reactivated.",
  );
}

// ---------------------------------------------------------------- fighters

const PROMOTE_FIELDS = ["memberId", "weightClass"];

export async function promoteFighterAction(
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const session = await requireRole("/admin/fighters", "Admin");
  const values = valuesFrom(data, PROMOTE_FIELDS);

  const result = await promoteToFighter(
    session,
    toInt(data.get("memberId")),
    text(data.get("weightClass")),
  );
  if (!result.ok) {
    const failed = formFailure(result, values, PROMOTE_FIELDS);
    // The services name no field here, so the weight class rule is shown on
    // the weight class and the rest as a message.
    return /weight class/i.test(result.error ?? "")
      ? {
          ok: false,
          message: "Please fix the highlighted field and try again.",
          errors: { weightClass: result.error ?? "" },
          values,
        }
      : failed;
  }

  succeeded("/admin/fighters", `${result.data?.fullName} is now a fighter.`);
}

export async function demoteFighterAction(data: FormData): Promise<void> {
  const session = await requireRole("/admin/fighters", "Admin");

  finish(
    await demoteFighter(session, toInt(data.get("id"))),
    "/admin/fighters",
    "Fighter demoted back to member.",
  );
}

// ---------------------------------------------------------------- events

const EVENT_FIELDS = ["name", "venue", "description", "eventDate", "imageUrl"];

/** The datetime-local box means gym time; the service wants an offset. */
function eventInput(data: FormData) {
  return {
    name: text(data.get("name")),
    venue: text(data.get("venue")),
    description: text(data.get("description")),
    eventDate: gymLocalToIso(text(data.get("eventDate"))),
    imageUrl: text(data.get("imageUrl")),
  };
}

/** The service words its date error around "Event date"; field it by name. */
function eventFailure<T>(
  result: ServiceResult<T>,
  values: Record<string, string>,
): FormState {
  const error = result.error ?? "That could not be saved.";
  const field = /^Event name/.test(error)
    ? "name"
    : /^Venue/.test(error)
      ? "venue"
      : /^Description/.test(error)
        ? "description"
        : /^Event date|in the future/.test(error)
          ? "eventDate"
          : /^Image URL/.test(error)
            ? "imageUrl"
            : undefined;

  return field
    ? {
        ok: false,
        message: "Please fix the highlighted field and try again.",
        errors: {
          [field]:
            field === "eventDate" && /^Event date must be an ISO/.test(error)
              ? "Choose a valid date and time."
              : error,
        },
        values,
      }
    : { ok: false, message: error, values };
}

export async function createEventAction(
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const session = await requireRole("/admin/events", "Admin");
  const values = valuesFrom(data, EVENT_FIELDS);

  const result = await createEvent(session, eventInput(data));
  if (!result.ok) return eventFailure(result, values);

  succeeded("/admin/events", `Created ${result.data?.name}.`);
}

export async function updateEventAction(
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const session = await requireRole("/admin/events", "Admin");
  const values = valuesFrom(data, EVENT_FIELDS);

  const result = await updateEvent(
    session,
    toInt(data.get("id")),
    eventInput(data),
  );
  if (!result.ok) return eventFailure(result, values);

  succeeded("/admin/events", `Saved ${result.data?.name}.`);
}

export async function cancelEventAction(data: FormData): Promise<void> {
  const session = await requireRole("/admin/events", "Admin");

  finish(
    await cancelEvent(session, toInt(data.get("id"))),
    "/admin/events",
    "Event cancelled. Its offers and results are kept.",
  );
}

export async function completeEventAction(data: FormData): Promise<void> {
  const session = await requireRole("/admin/events", "Admin");

  finish(
    await completeEvent(session, toInt(data.get("id"))),
    "/admin/events",
    "Event marked completed.",
  );
}

const OFFER_FIELDS = ["fighterId", "opponentName", "boutWeightClass", "boutNotes"];

export async function offerBoutAction(
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const eventId = toInt(data.get("eventId"));
  const path = `/admin/events/${eventId}`;
  const session = await requireRole(path, "Admin");
  const values = valuesFrom(data, OFFER_FIELDS);

  const result = await offerBout(session, eventId, toInt(data.get("fighterId")), {
    opponentName: text(data.get("opponentName")),
    boutWeightClass: text(data.get("boutWeightClass")),
    boutNotes: text(data.get("boutNotes")),
  });
  if (!result.ok) {
    const error = result.error ?? "That offer could not be made.";
    const field = /^Opponent/.test(error)
      ? "opponentName"
      : /^Bout weight/.test(error)
        ? "boutWeightClass"
        : /^Bout notes/.test(error)
          ? "boutNotes"
          : /^fighterId/.test(error)
            ? "fighterId"
            : undefined;

    return field
      ? {
          ok: false,
          message: "Please fix the highlighted field and try again.",
          errors: { [field]: field === "fighterId" ? "Choose a fighter." : error },
          values,
        }
      : { ok: false, message: error, values };
  }

  succeeded(path, `Offered a bout to ${result.data?.fighterName}.`);
}

const RESULT_FIELDS = ["result", "notes"];

export async function recordResultAction(
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const eventId = toInt(data.get("eventId"));
  const path = `/admin/events/${eventId}`;
  const session = await requireRole(path, "Admin");
  const values = valuesFrom(data, RESULT_FIELDS);

  const chosen = text(data.get("result"));
  const result = await recordResult(
    session,
    toInt(data.get("offerId")),
    chosen === "" ? null : chosen,
    text(data.get("notes")),
  );
  if (!result.ok) {
    const error = result.error ?? "That result could not be saved.";
    return /^result must/.test(error)
      ? {
          ok: false,
          message: "Please fix the highlighted field and try again.",
          errors: { result: "Choose a result." },
          values,
        }
      : /^Result notes/.test(error)
        ? {
            ok: false,
            message: "Please fix the highlighted field and try again.",
            errors: { notes: error },
            values,
          }
        : { ok: false, message: error, values };
  }

  succeeded(path, "Result saved.");
}

// ---------------------------------------------------------------- documents

/** Approve or reject a fighter's document. Rejecting needs a note. */
export async function reviewDocumentAction(data: FormData): Promise<void> {
  const session = await requireRole("/admin/documents", "Admin");
  const decision = text(data.get("decision"));

  finish(
    await reviewDocument(
      session,
      toInt(data.get("id")),
      decision,
      text(data.get("note")),
    ),
    "/admin/documents",
    decision === "Approved" ? "Document approved." : "Document rejected.",
  );
}

// ---------------------------------------------------------------- enquiries

/** Mark an enquiry handled, or reopen it, and stay on the same page of the inbox. */
export async function setEnquiryHandledAction(data: FormData): Promise<void> {
  const session = await requireRole("/admin/enquiries", "Admin");

  const page = text(data.get("page")).trim();
  const path =
    page && page !== "1" ? `/admin/enquiries?page=${encodeURIComponent(page)}` : "/admin/enquiries";
  const handled = text(data.get("handled")) === "true";

  finish(
    await setEnquiryHandled(session, toInt(data.get("id")), handled),
    path,
    handled ? "Marked as handled." : "Enquiry reopened.",
  );
}

// ---------------------------------------------------------------- plans

const PLAN_FIELDS = ["pricePerMonth", "features", "isMostPopular"];

function planInput(data: FormData) {
  return {
    pricePerMonth: toInt(data.get("pricePerMonth")),
    // One feature per line; blank lines are not features.
    features: text(data.get("features"))
      .split(/\r?\n/)
      .filter((line) => line.trim() !== ""),
    isMostPopular: data.get("isMostPopular") === "on",
  };
}

export async function createPlanAction(
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const session = await requireRole("/admin/plans", "Admin");
  const values = valuesFrom(data, PLAN_FIELDS);

  const result = await createPlan(session, planInput(data));
  if (!result.ok) return formFailure(result, values, PLAN_FIELDS);

  succeeded("/admin/plans", "Plan added.");
}

export async function updatePlanAction(
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const session = await requireRole("/admin/plans", "Admin");
  const values = valuesFrom(data, PLAN_FIELDS);

  const result = await updatePlan(
    session,
    toInt(data.get("id")),
    planInput(data),
  );
  if (!result.ok) return formFailure(result, values, PLAN_FIELDS);

  succeeded("/admin/plans", "Plan saved.");
}

export async function deactivatePlanAction(data: FormData): Promise<void> {
  const session = await requireRole("/admin/plans", "Admin");

  finish(
    await deactivatePlan(session, toInt(data.get("id"))),
    "/admin/plans",
    "Plan retired. Nobody new can choose it.",
  );
}
