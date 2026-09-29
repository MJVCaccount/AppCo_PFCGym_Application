import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import RegisterForm from "@/components/RegisterForm";
import { getPlans } from "@/lib/gym-data";
import { getSession } from "@/lib/session";
import { firstParam, type SearchParams } from "@/lib/types";

export const metadata: Metadata = {
  title: "Register",
  description: "Create your PFC membership account.",
};

export const dynamic = "force-dynamic";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const planId = firstParam((await searchParams).planId);

  if (await getSession()) redirect("/dashboard");

  return (
    <section className="auth">
      <div className="auth__card">
        <div className="auth__logo" aria-hidden="true">
          PFC
        </div>
        <h1>Join PFC</h1>

        <RegisterForm plans={getPlans()} selectedPlanId={planId} />

        <p className="auth__alt">
          Already a member? <Link href="/login">Log in</Link>
        </p>
      </div>
    </section>
  );
}
