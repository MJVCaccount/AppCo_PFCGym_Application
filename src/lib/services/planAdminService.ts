import "server-only";

import {
  createPlan as insertPlan,
  deactivatePlan as retirePlan,
  listAllPlans,
  type PlanFields,
  updatePlan as updateRow,
} from "@/lib/repositories/plansRepository";
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
import type { AdminPlan, ServiceResult, SessionUser } from "@/lib/types";
import { RULES } from "@/lib/validation";

/** Business rules for membership plans. Admin only. Prices are whole rands. */

const NOT_FOUND_PLAN = "That plan could not be found.";
const MIN_FEATURES = 1;
const MAX_FEATURES = 10;

const RULE = {
  price: RULES.integerRange(0, 100_000, "Price"),
  feature: RULES.text(2, 80, "Each feature"),
};

export interface PlanInput {
  pricePerMonth?: unknown;
  features?: unknown;
  isMostPopular?: unknown;
}

/**
 * A list of 1 to 10 features, each trimmed and 2 to 80 characters. A feature
 * repeated in any letter case is kept once, in its first spelling.
 */
function parseFeatures(value: unknown): Parsed<string[]> {
  const field = "features";
  if (!Array.isArray(value)) {
    return { error: "Features must be a list of text items.", field };
  }

  const seen = new Set<string>();
  const features: string[] = [];

  for (const item of value) {
    const error = RULE.feature(item);
    if (error) return { error, field };

    const feature = (item as string).trim();
    const key = feature.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    features.push(feature);
  }

  if (features.length < MIN_FEATURES || features.length > MAX_FEATURES) {
    return {
      error: `List ${MIN_FEATURES} to ${MAX_FEATURES} features.`,
      field,
    };
  }

  return { value: features };
}

function parsePlanFields(
  input: PlanInput,
  partial: boolean,
): Parsed<Partial<PlanFields>> {
  const fields: Partial<PlanFields> = {};

  if (!partial || input.pricePerMonth !== undefined) {
    const error = RULE.price(input.pricePerMonth);
    if (error) return { error, field: "pricePerMonth" };
    fields.pricePerMonth = input.pricePerMonth as number;
  }

  if (!partial || input.features !== undefined) {
    const features = parseFeatures(input.features);
    if ("error" in features) return features;
    fields.features = features.value;
  }

  // Optional on create: a plan is not the most popular unless it says so.
  if (input.isMostPopular !== undefined) {
    if (typeof input.isMostPopular !== "boolean") {
      return { error: "Most popular must be yes or no.", field: "isMostPopular" };
    }
    fields.isMostPopular = input.isMostPopular;
  } else if (!partial) {
    fields.isMostPopular = false;
  }

  return { value: fields };
}

export async function listPlans(
  session: SessionUser,
): Promise<ServiceResult<AdminPlan[]>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);

  try {
    return succeed(await listAllPlans());
  } catch (e) {
    return failure(e);
  }
}

/** Marking a plan most popular unsets it on every other plan. */
export async function createPlan(
  session: SessionUser,
  input: unknown,
): Promise<ServiceResult<AdminPlan>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);
  if (!isRecord(input)) return fail(400, INVALID_INPUT);

  const parsed = parsePlanFields(input, false);
  if ("error" in parsed) return invalid(parsed);

  try {
    return succeed(await insertPlan(parsed.value as PlanFields, session.id), 201);
  } catch (e) {
    return failure(e);
  }
}

export async function updatePlan(
  session: SessionUser,
  id: unknown,
  patch: unknown,
): Promise<ServiceResult<AdminPlan>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);
  if (!isValidId(id)) return fail(400, "id must be a positive integer.");
  if (!isRecord(patch)) return fail(400, INVALID_INPUT);

  const parsed = parsePlanFields(patch, true);
  if ("error" in parsed) return invalid(parsed);
  if (Object.keys(parsed.value).length === 0) {
    return fail(400, "Send at least one field to change.");
  }

  try {
    const result = await updateRow(id, parsed.value, session.id);
    return result.ok ? succeed(result.plan) : fail(404, NOT_FOUND_PLAN);
  } catch (e) {
    return failure(e);
  }
}

/** Retires a plan so nobody new can choose it. Refused while anyone is on it. */
export async function deactivatePlan(
  session: SessionUser,
  id: unknown,
): Promise<ServiceResult<{ id: number }>> {
  if (!isAdmin(session)) return fail(403, ADMIN_ONLY);
  if (!isValidId(id)) return fail(400, "id must be a positive integer.");

  try {
    const result = await retirePlan(id, session.id);

    if (!result.ok) {
      switch (result.reason) {
        case "not-found":
          return fail(404, NOT_FOUND_PLAN);
        case "already-inactive":
          return fail(409, "That plan is already deactivated.");
        case "has-members":
          return fail(
            409,
            `${result.count} active ${result.count === 1 ? "member is" : "members are"} on this plan. Move them to another plan first.`,
          );
      }
    }

    return succeed({ id });
  } catch (e) {
    return failure(e);
  }
}
