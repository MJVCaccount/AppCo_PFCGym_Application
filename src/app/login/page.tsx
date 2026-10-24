import type { Metadata } from "next";
import Logo from "@/components/Logo";
import Link from "next/link";
import { redirect } from "next/navigation";

import Alert from "@/components/Alert";
import LoginForm from "@/components/LoginForm";
import { safeReturnPath } from "@/lib/returnUrl";
import { getSession } from "@/lib/session";
import { firstParam, type SearchParams } from "@/lib/types";

export const metadata: Metadata = {
  title: "Login",
  description: "Sign in to your PFC member account.",
};

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const returnUrl = firstParam(params.returnUrl);
  const registered = firstParam(params.registered);
  // Only a known message is shown: a link must not be able to put its own
  // words on the sign-in page.
  const updated = firstParam(params.notice) === "Password updated";

  // Already signed in? There is nothing to do here.
  if (await getSession()) redirect("/dashboard");

  // Only ever hand a path back to the form. An absolute URL would let a
  // crafted login link bounce the user to another site after signing in.
  const safeReturn = safeReturnPath(returnUrl) ?? undefined;

  return (
    <section className="auth">
      <div className="auth__card">
        {/* Decorative: the h1 below names the page and the header already
            carries the brand, so the mark takes an empty alt. */}
        <div className="auth__logo">
          <Logo variant="full" width={88} alt="" />
        </div>
        <h1>Welcome back</h1>

        {registered && (
          <Alert kind="ok">Account created. Sign in to continue.</Alert>
        )}

        {updated && (
          <Alert kind="ok">Password updated. Sign in with your new password.</Alert>
        )}

        <LoginForm returnUrl={safeReturn} />

        <p className="auth__alt">
          Not a member? <Link href="/register">Join PFC</Link>
        </p>
      </div>
    </section>
  );
}
