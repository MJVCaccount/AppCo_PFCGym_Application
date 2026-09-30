import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import Alert from "@/components/Alert";
import LoginForm from "@/components/LoginForm";
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

  // Already signed in? There is nothing to do here.
  if (await getSession()) redirect("/dashboard");

  // Only ever hand a path back to the form. An absolute URL would let a
  // crafted login link bounce the user to another site after signing in.
  const safeReturn =
    returnUrl?.startsWith("/") && !returnUrl.startsWith("//")
      ? returnUrl
      : undefined;

  return (
    <section className="auth">
      <div className="auth__card">
        <div className="auth__logo" aria-hidden="true">
          PFC
        </div>
        <h1>Welcome back</h1>

        {registered && (
          <Alert kind="ok">Account created. Sign in to continue.</Alert>
        )}

        <LoginForm returnUrl={safeReturn} />

        <p className="auth__alt">
          Not a member? <Link href="/register">Join PFC</Link>
        </p>
      </div>
    </section>
  );
}
