"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createSession, destroySession, getSession } from "@/lib/session";
import {
  createUser,
  findByEmail,
  toSessionUser,
  validateCredentials,
} from "@/lib/users";
import { getPlan } from "@/lib/gym-data";
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

  const user = validateCredentials(
    String(data.get("email")),
    String(data.get("password")),
  );

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

  if (findByEmail(email)) {
    return {
      ok: false,
      errors: { email: "That email is already registered." },
      values,
    };
  }

  const rawPlan = String(data.get("planId") ?? "");
  const planId = rawPlan ? Number(rawPlan) : null;

  if (planId !== null && !getPlan(planId)) {
    return {
      ok: false,
      errors: { planId: "Choose one of the listed plans." },
      values,
    };
  }

  const user = createUser({
    email,
    fullName: String(data.get("fullName")),
    password: String(data.get("password")),
    planId,
  });

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
