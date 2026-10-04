import type { Metadata } from "next";
import Link from "next/link";

import Alert from "@/components/Alert";
import ResetPasswordForm from "@/components/ResetPasswordForm";
import { checkResetToken, RESET_INVALID } from "@/lib/services/passwordService";

export const metadata: Metadata = {
  title: "Choose a new password",
  // Also sent as a Referrer-Policy header (see next.config.mjs): the token in
  // this page's address must not leak to anything the page links or loads.
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const usable = await checkResetToken(token);

  return (
    <section className="auth">
      <div className="auth__card">
        <div className="auth__logo" aria-hidden="true">
          PFC
        </div>
        <h1>Choose a new password</h1>

        {usable ? (
          <ResetPasswordForm token={token} />
        ) : (
          <>
            <Alert kind="err">{RESET_INVALID}</Alert>
            <p className="auth__alt">
              <Link href="/forgot-password">Send me a new link</Link>
            </p>
          </>
        )}

        <p className="auth__alt">
          <Link href="/login">Back to sign in</Link>
        </p>
      </div>
    </section>
  );
}
