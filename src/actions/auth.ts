"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { ERROR_CODES, mapPrismaError } from "@/lib/errors";
import { getPlan } from "@/lib/repositories/plansRepository";
import {
  createMember,
  findByEmail,
  toSessionUser,
  validateCredentials,
} from "@/lib/repositories/usersRepository";
import { createSession, destroySession, getSession } from "@/lib/session";
import type { UserAccount } from "@/lib/types";
import {
  type FormState,
  validate,
  valuesFrom,
} from "@/lib/validation";

export async function login(
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const values = valuesFrom(data, ["email"]);
  const errors = validate(data, { email: "email", password: "password" });

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors, values };
  }

  let user: UserAccount | null;
  try {
    user = await validateCredentials(
      String(data.get("email")),
      String(data.get("password")),
    );
  } catch (e) {
    return { ok: false, message: mapPrismaError(e).message, values };
  }

  if (!user) {
    // Deliberately vague. Saying which of the two was wrong tells an attacker
    // which email addresses have accounts.
    return {
      ok: false,
      message: "Email or password is incorrect.",
      values,
    };
  }

  await createSession(toSessionUser(user));
  revalidatePath("/", "layout");

  const requested = String(data.get("returnUrl") ?? "");
  // Only follow a path on this site. An absolute URL here would be an open
  // redirect: an attacker could send a login link that bounces to their page.
  const target =
    requested.startsWith("/") && !requested.startsWith("//")
      ? requested
      : "/dashboard";

  redirect(target);
}

export async function register(
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const values = valuesFrom(data, ["fullName", "email", "phone", "planId"]);
  const errors = validate(data, {
    fullName: "name",
    email: "email",
    phone: "phone",
    password: "password",
  });

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors, values };
  }

  const email = String(data.get("email"));
  const emailTaken: FormState = {
    ok: false,
    errors: { email: "That email is already registered." },
    values,
  };

  let user: UserAccount;
  try {
    if (await findByEmail(email)) return emailTaken;

    const rawPlan = String(data.get("planId") ?? "");
    const planId = rawPlan ? Number(rawPlan) : null;

    if (planId !== null && !(await getPlan(planId))) {
      return {
        ok: false,
        errors: { planId: "Choose one of the listed plans." },
        values,
      };
    }

    user = await createMember({
      email,
      fullName: String(data.get("fullName")),
      phone: String(data.get("phone") ?? ""),
      password: String(data.get("password")),
      planId,
    });
  } catch (e) {
    const error = mapPrismaError(e);

    // Two sign-ups with the same address can both pass the check above. The
    // unique index stops the second one, and it gets the same field error.
    if (error.code === ERROR_CODES.conflict) return emailTaken;

    return { ok: false, message: error.message, values };
  }

  await createSession(toSessionUser(user));
  revalidatePath("/", "layout");
  redirect("/dashboard?welcome=1");
}

export async function logout(): Promise<void> {
  await destroySession();
  revalidatePath("/", "layout");
  redirect("/?signedOut=1");
}

/** Redirects to login when nobody is signed in. Use at the top of a page. */
export async function requireSession(returnUrl: string) {
  const session = await getSession();

  if (!session) {
    redirect(`/login?returnUrl=${encodeURIComponent(returnUrl)}`);
  }

  return session;
}
