"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import {
  authenticate,
  recordLoginLockout,
  register as registerMember,
} from "@/lib/services/authService";
import {
  RESET_INVALID,
  RESET_REQUESTED,
  requestReset,
  resetPassword,
} from "@/lib/services/passwordService";
import {
  checkLimit,
  clearLimit,
  currentClientIp,
  firstDenied,
  tooManyAttempts,
} from "@/lib/rateLimit";
import { safeReturnPath } from "@/lib/returnUrl";
import { createSession, destroySession, getSession } from "@/lib/session";
import type { Role } from "@/lib/types";
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
  const errors = validate(data, { email: "email", password: "loginPassword" });

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors, values };
  }

  // Five tries per ip+email and thirty per ip in a fixed 15 minutes. A wrong
  // password and an unknown email count the same, so the limit tells an
  // attacker nothing about which addresses have accounts.
  const ip = await currentClientIp();
  const loginId = `${ip}|${String(data.get("email")).trim().toLowerCase()}`;
  const byEmail = await checkLimit("loginIpEmail", loginId);
  const byIp = await checkLimit("loginIp", ip);
  if (byEmail.justExceeded) {
    await recordLoginLockout({ policy: "loginIpEmail", email: String(data.get("email")), ip });
  }
  if (byIp.justExceeded) {
    await recordLoginLockout({ policy: "loginIp", email: "", ip });
  }
  const denied = firstDenied(byEmail, byIp);
  if (denied) {
    return {
      ok: false,
      message: tooManyAttempts(denied.retryAfterSeconds),
      values,
    };
  }

  // The service answers a wrong password and an unknown email identically, so
  // the message tells an attacker nothing about which addresses have accounts.
  const result = await authenticate(
    String(data.get("email")),
    String(data.get("password")),
  );

  if (!result.ok || !result.data) {
    return { ok: false, message: result.error, values };
  }

  // The real owner is back in: forget the failed attempts for this ip+email.
  await clearLimit("loginIpEmail", loginId);

  await createSession(result.data);
  revalidatePath("/", "layout");

  // Only follow a path on this site. An absolute URL here would be an open
  // redirect: an attacker could send a login link that bounces to their page.
  const target = safeReturnPath(data.get("returnUrl")) ?? "/dashboard";

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

  const result = await registerMember({
    fullName: String(data.get("fullName")),
    email: String(data.get("email")),
    phone: String(data.get("phone") ?? ""),
    password: String(data.get("password")),
    planId: String(data.get("planId") ?? ""),
  });

  if (!result.ok || !result.data) {
    return result.field
      ? { ok: false, errors: { [result.field]: result.error ?? "" }, values }
      : { ok: false, message: result.error, values };
  }

  await createSession(result.data);
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
