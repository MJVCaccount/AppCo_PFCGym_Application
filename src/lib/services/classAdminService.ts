import "server-only";

import {
  type ClassFields,
  createClass,
  createProgramme as insertProgramme,
  deactivateClass,
  deactivateProgramme as retireProgramme,
  deleteClass,
  listClasses,
  listProgrammes as listProgrammeRows,
  type ProgrammeFields,
  reactivateClass,
  updateClass,
  updateProgramme as updateProgrammeRow,
} from "@/lib/repositories/classAdminRepository";
import {
  ADMIN_ONLY,
  fail,
  failure,
  invalid,
  INVALID_INPUT,
  isAdmin,
  isRecord,
  isValidId,
  type Parsed,
  succeed,
} from "@/lib/services/serviceResult";
import {
  type AdminClass,
  type AdminProgramme,
  CLASS_KINDS,
  type ClassKind,
  DAY_ORDER,
  type DayKey,
  type ServiceResult,
  type SessionUser,
} from "@/lib/types";
import { RULES } from "@/lib/validation";

/**
 * Business rules for the timetable and the class catalogue. Admin only.
 *
 * Every function takes the session first and checks the role itself. Input
 * arrives as `unknown`, straight from a form or a JSON body, and is validated
 * here so pages and actions hold no rules of their own.
 */

const NOT_FOUND_CLASS = "That class could not be found.";
const NOT_FOUND_COACH = "That coach could not be found, or is archived.";
const NOT_FOUND_PROGRAMME = "That programme could not be found.";
const COACH_CLASH = "That coach already teaches a class at that time.";

const RULE = {
  className: RULES.text(2, 80, "Class name"),
  duration: RULES.integerRange(15, 240, "Duration"),
  capacity: RULES.integerRange(1, 200, "Capacity"),
  programmeName: RULES.text(2, 80, "Programme name"),
  description: RULES.text(10, 500, "Description"),
  level: RULES.text(2, 40, "Level"),
};

export interface SessionInput {
  name?: unknown;
  kind?: unknown;
  coachId?: unknown;
  day?: unknown;
  startsAt?: unknown;
  durationMinutes?: unknown;
  capacity?: unknown;
  programmeId?: unknown;
}

export interface ProgrammeInput {
  name?: unknown;
  description?: unknown;
  level?: unknown;
  durationMinutes?: unknown;
}

/**
 * Validates the class fields that are present. With `partial` false every
 * field except programmeId is required; with it true only what was sent is
 * checked and returned, which is what an update needs.
 */
function parseClassFields(
  input: SessionInput,
  partial: boolean,
): Parsed<Partial<ClassFields>> {
  const fields: Partial<ClassFields> = {};
  const sent = (value: unknown) => !partial || value !== undefined;

  if (sent(input.name)) {
    const error = RULE.className(input.name);
    if (error) return { error, field: "name" };
    fields.name = (input.name as string).trim();
  }

  if (sent(input.kind)) {
    if (!CLASS_KINDS.includes(input.kind as ClassKind)) {
      return {
        error: `Kind must be one of ${CLASS_KINDS.join(", ")}.`,
        field: "kind",
      };
    }
    fields.kind = input.kind as ClassKind;
  }

  if (sent(input.coachId)) {
    if (!isValidId(input.coachId)) {
      return { error: "Choose a coach.", field: "coachId" };
    }
    fields.coachId = input.coachId;
  }

  if (sent(input.day)) {
    if (!DAY_ORDER.includes(input.day as DayKey)) {
      return { error: "Choose a day of the week.", field: "day" };
    }
    fields.day = input.day as DayKey;
  }

  if (sent(input.startsAt)) {
    const error = RULES.timeOfDay(
      typeof input.startsAt === "string" ? input.startsAt : "",
    );
    if (error) return { error, field: "startsAt" };
    fields.startsAt = input.startsAt as string;
  }

  if (sent(input.durationMinutes)) {
    const error = RULE.duration(input.durationMinutes);
    if (error) return { error, field: "durationMinutes" };
    fields.durationMinutes = input.durationMinutes as number;
  }

  if (sent(input.capacity)) {
    const error = RULE.capacity(input.capacity);
    if (error) return { error, field: "capacity" };
    fields.capacity = input.capacity as number;
  }

  // Optional: left out, null and "" all mean "no programme".
  if (input.programmeId !== undefined) {
    if (input.programmeId === null || input.programmeId === "") {
      fields.programmeId = null;
    } else if (isValidId(input.programmeId)) {
      fields.programmeId = input.programmeId;
    } else {
      return { error: "Choose a listed programme.", field: "programmeId" };
    }
  } else if (!partial) {
    fields.programmeId = null;
  }

  return { value: fields };
}

function parseProgrammeFields(
  input: ProgrammeInput,
  partial: boolean,
): Parsed<Partial<ProgrammeFields>> {
  const fields: Partial<ProgrammeFields> = {};
  const sent = (value: unknown) => !partial || value !== undefined;

  if (sent(input.name)) {
    const error = RULE.programmeName(input.name);
    if (error) return { error, field: "name" };
    fields.name = (input.name as string).trim();
  }

  if (sent(input.description)) {
    const error = RULE.description(input.description);
    if (error) return { error, field: "description" };
    fields.description = (input.description as string).trim();
  }

  if (sent(input.level)) {
    const error = RULE.level(input.level);
    if (error) return { error, field: "level" };
    fields.level = (input.level as string).trim();
  }

  if (sent(input.durationMinutes)) {
    const error = RULE.duration(input.durationMinutes);
    if (error) return { error, field: "durationMinutes" };
    fields.durationMinutes = input.durationMinutes as number;
  }

  return { value: fields };
}

/**
 * "Muay Thai (Kids)" -> "muay-thai-kids": lowercase a-z, 0-9 and hyphens only.
 * A name with none of those (all emoji, say) falls back to "programme".
 */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug === "" ? "programme" : slug;
}

// ---------------------------------------------------------------- classes

export async function listSessions(
  session: SessionUser,
  now: Date = new Date(),
): Promise<ServiceResult<AdminClass[]>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);

  try {
    return succeed(await listClasses(now));
  } catch (e) {
    return failure(e);
  }
}

export async function createSession(
  session: SessionUser,
  input: unknown,
): Promise<ServiceResult<AdminClass>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);
  if (!isRecord(input)) return fail(400, INVALID_INPUT);

  const parsed = parseClassFields(input, false);
  if ("error" in parsed) return invalid(parsed);

  try {
    const result = await createClass(parsed.value as ClassFields, session.id);

    if (!result.ok) {
      switch (result.reason) {
        case "coach-not-found":
          return fail(404, NOT_FOUND_COACH, "coachId");
        case "programme-not-found":
          return fail(404, NOT_FOUND_PROGRAMME, "programmeId");
        case "clash":
          return fail(409, COACH_CLASH, "startsAt");
      }
    }

    return succeed(result.gymClass, 201);
  } catch (e) {
    return failure(e);
  }
}

export async function updateSession(
  session: SessionUser,
  id: unknown,
  patch: unknown,
  now: Date = new Date(),
): Promise<ServiceResult<AdminClass>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);
  if (!isValidId(id)) return fail(400, "id must be a positive integer.");
  if (!isRecord(patch)) return fail(400, INVALID_INPUT);

  const parsed = parseClassFields(patch, true);
  if ("error" in parsed) return invalid(parsed);
  if (Object.keys(parsed.value).length === 0) {
    return fail(400, "Send at least one field to change.");
  }

  try {
    const result = await updateClass(id, parsed.value, session.id, now);

    if (!result.ok) {
      switch (result.reason) {
        case "not-found":
          return fail(404, NOT_FOUND_CLASS);
        case "coach-not-found":
          return fail(404, NOT_FOUND_COACH, "coachId");
        case "programme-not-found":
          return fail(404, NOT_FOUND_PROGRAMME, "programmeId");
        case "clash":
          return fail(409, COACH_CLASH, "startsAt");
        case "capacity":
          return fail(
            409,
            `Capacity cannot be lower than the ${result.booked} already booked for the next session.`,
            "capacity",
          );
        case "has-bookings":
          return fail(
            409,
            `This class has ${result.count} future ${plural(result.count, "booking")}, so its day and time cannot change. Deactivate it and create a new class instead.`,
            "day",
          );
      }
    }

    return succeed(result.gymClass);
  } catch (e) {
    return failure(e);
  }
}

export async function deactivateSession(
  session: SessionUser,
  id: unknown,
  options: unknown = {},
  now: Date = new Date(),
): Promise<ServiceResult<{ id: number; cancelledBookings: number }>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);
  if (!isValidId(id)) return fail(400, "id must be a positive integer.");
  if (!isRecord(options)) return fail(400, INVALID_INPUT);

  const cancelBookings = options.cancelBookings ?? false;
  if (typeof cancelBookings !== "boolean") {
    return fail(400, "cancelBookings must be true or false.");
  }

  try {
    const result = await deactivateClass(id, cancelBookings, session.id, now);

    if (!result.ok) {
      switch (result.reason) {
        case "not-found":
          return fail(404, NOT_FOUND_CLASS);
        case "already-inactive":
          return fail(409, "That class is already deactivated.");
        case "has-bookings":
          return fail(
            409,
            `This class has ${result.count} future ${plural(result.count, "booking")}. Confirm that they should be cancelled.`,
          );
      }
    }

    return succeed({ id, cancelledBookings: result.cancelledBookings });
  } catch (e) {
    return failure(e);
  }
}

export async function reactivateSession(
  session: SessionUser,
  id: unknown,
): Promise<ServiceResult<{ id: number }>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);
  if (!isValidId(id)) return fail(400, "id must be a positive integer.");

  try {
    const result = await reactivateClass(id, session.id);

    if (!result.ok) {
      switch (result.reason) {
        case "not-found":
          return fail(404, NOT_FOUND_CLASS);
        case "already-active":
          return fail(409, "That class is already active.");
        case "coach-archived":
          return fail(409, "Restore the class's coach before reactivating it.");
      }
    }

    return succeed({ id });
  } catch (e) {
    return failure(e);
  }
}

export async function deleteSession(
  session: SessionUser,
  id: unknown,
): Promise<ServiceResult<{ id: number }>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);
  if (!isValidId(id)) return fail(400, "id must be a positive integer.");

  try {
    const result = await deleteClass(id, session.id);

    if (!result.ok) {
      return result.reason === "has-bookings"
        ? fail(409, "This class has bookings. Deactivate it instead.")
        : fail(404, NOT_FOUND_CLASS);
    }

    return succeed({ id });
  } catch (e) {
    return failure(e);
  }
}

// ---------------------------------------------------------------- programmes

export async function listProgrammes(
  session: SessionUser,
): Promise<ServiceResult<AdminProgramme[]>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);

  try {
    return succeed(await listProgrammeRows());
  } catch (e) {
    return failure(e);
  }
}

/** The slug is always generated here from the name; any sent slug is ignored. */
export async function createProgramme(
  session: SessionUser,
  input: unknown,
): Promise<ServiceResult<AdminProgramme>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);
  if (!isRecord(input)) return fail(400, INVALID_INPUT);

  const parsed = parseProgrammeFields(input, false);
  if ("error" in parsed) return invalid(parsed);

  const fields = parsed.value as ProgrammeFields;

  try {
    const result = await insertProgramme(fields, slugify(fields.name), session.id);

    return result.ok
      ? succeed(result.programme, 201)
      : fail(409, "A programme with that name was just added. Try again.", "name");
  } catch (e) {
    return failure(e);
  }
}

export async function updateProgramme(
  session: SessionUser,
  id: unknown,
  patch: unknown,
): Promise<ServiceResult<AdminProgramme>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);
  if (!isValidId(id)) return fail(400, "id must be a positive integer.");
  if (!isRecord(patch)) return fail(400, INVALID_INPUT);

  const parsed = parseProgrammeFields(patch, true);
  if ("error" in parsed) return invalid(parsed);
  if (Object.keys(parsed.value).length === 0) {
    return fail(400, "Send at least one field to change.");
  }

  try {
    const result = await updateProgrammeRow(id, parsed.value, session.id);
    return result.ok
      ? succeed(result.programme)
      : fail(404, NOT_FOUND_PROGRAMME);
  } catch (e) {
    return failure(e);
  }
}

export async function deactivateProgramme(
  session: SessionUser,
  id: unknown,
): Promise<ServiceResult<{ id: number }>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);
  if (!isValidId(id)) return fail(400, "id must be a positive integer.");

  try {
    const result = await retireProgramme(id, session.id);

    if (!result.ok) {
      return result.reason === "already-inactive"
        ? fail(409, "That programme is already deactivated.")
        : fail(404, NOT_FOUND_PROGRAMME);
    }

    return succeed({ id });
  } catch (e) {
    return failure(e);
  }
}

function plural(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`;
}
