"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { ERROR_CODES, mapPrismaError } from "@/lib/errors";
import { getPlan } from "@/lib/repositories/plansRepository";
import { notifyWelcome } from "@/lib/services/notificationService";
import {
  RESET_INVALID,
  RESET_REQUESTED,
  requestReset,
  resetPassword,
} from "@/lib/services/passwordService";
import {
  createMember,
  findByEmail,
  toSessionUser,
  validateCredentials,
} from "@/lib/repositories/usersRepository";
import {
  checkLimit,
  clearLimit,
  currentClientIp,
  firstDenied,
  tooManyAttempts,
} from "@/lib/rateLimit";
import { createSession, destroySession, getSession } from "@/lib/session";
import type { Role, UserAccount } from "@/lib/types";
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

  // Five tries per ip+email and thirty per ip in a fixed 15 minutes. A wrong
  // password and an unknown email count the same, so the limit tells an
  // attacker nothing about which addresses have accounts.
  const ip = await currentClientIp();
  const loginId = `${ip}|${String(data.get("email")).trim().toLowerCase()}`;
  const denied = firstDenied(
    await checkLimit("loginIpEmail", loginId),
    await checkLimit("loginIp", ip),
  );
  if (denied) {
    return {
      ok: false,
      message: tooManyAttempts(denied.retryAfterSeconds),
      values,
    };
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

  // The real owner is back in: forget the failed attempts for this ip+email.
  await clearLimit("loginIpEmail", loginId);

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

  const denied = firstDenied(
    await checkLimit("register", await currentClientIp()),
  );
  if (denied) {
    return {
      ok: false,
      message: tooManyAttempts(denied.retryAfterSeconds),
      values,
    };
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

  notifyWelcome(user);

  await createSession(toSessionUser(user));
  revalidatePath("/", "layout");
  redirect("/dashboard?welcome=1");
}

/**
 * "Forgot password" form. The answer is always the same message, whether or
 * not the email has an account. Both limits are keyed on what the visitor
 * typed, not on whether an account exists, so hitting one reveals nothing.
 */
export async function requestPasswordReset(
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const email = String(data.get("email") ?? "");
  const values = valuesFrom(data, ["email"]);

  const errors = validate(data, { email: "email" });
  if (Object.keys(errors).length > 0) return { ok: false, errors, values };

  const denied = firstDenied(
    await checkLimit("forgotIp", await currentClientIp()),
    await checkLimit("forgotEmail", email.trim().toLowerCase()),
  );
  if (denied) {
    return {
      ok: false,
      message: tooManyAttempts(denied.retryAfterSeconds),
      values,
    };
  }

  const result = await requestReset(email);
  return { ok: true, message: result.data?.message ?? RESET_REQUESTED };
}

/** The "choose a new password" form behind an emailed link. */
export async function submitPasswordReset(
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const denied = firstDenied(
    await checkLimit("resetIp", await currentClientIp()),
  );
  if (denied) {
    return { ok: false, message: tooManyAttempts(denied.retryAfterSeconds) };
  }

  const result = await resetPassword(
    String(data.get("token") ?? ""),
    String(data.get("password") ?? ""),
  );

  if (!result.ok) {
    return result.field === "password"
      ? { ok: false, errors: { password: result.error ?? "" } }
      : { ok: false, message: result.error ?? RESET_INVALID };
  }

  redirect("/login?notice=Password+updated");
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

/**
 * The guard for staff pages and their server actions. Signed-out visitors go
 * to login and come back afterwards; anyone signed in with another role goes
 * to /denied. Call it first, in every page and every action: hiding a button
 * is not security, and an action can be posted without the page.
 */
export async function requireRole(returnUrl: string, ...roles: Role[]) {
  const session = await requireSession(returnUrl);

  if (!roles.includes(session.role)) redirect("/denied");

  return session;
}
