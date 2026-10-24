import type { Metadata } from "next";
import Logo from "@/components/Logo";
import Link from "next/link";
import { redirect } from "next/navigation";

import ForgotPasswordForm from "@/components/ForgotPasswordForm";
import { getSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Forgot password",
  description: "Get a link to choose a new PFC password.",
};

export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage() {
  if (await getSession()) redirect("/dashboard");

  return (
    <section className="auth">
      <div className="auth__card">
        {/* Decorative: the h1 below names the page and the header already
            carries the brand, so the mark takes an empty alt. */}
        <div className="auth__logo">
          <Logo variant="full" width={88} alt="" />
        </div>
        <h1>Forgot your password?</h1>
        <p className="form-note">
          Enter your email address and we will send you a link to choose a new
          one.
        </p>

        <ForgotPasswordForm />

        <p className="auth__alt">
          Remembered it? <Link href="/login">Sign in</Link>
        </p>
      </div>
    </section>
  );
}
