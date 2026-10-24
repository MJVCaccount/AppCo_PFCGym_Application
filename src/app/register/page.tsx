import type { Metadata } from "next";
import Logo from "@/components/Logo";
import Link from "next/link";
import { redirect } from "next/navigation";

import RegisterForm from "@/components/RegisterForm";
import { getPlans } from "@/lib/repositories/plansRepository";
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

  const plans = await getPlans();

  return (
    <section className="auth">
      <div className="auth__card">
        {/* Decorative: the h1 below names the page and the header already
            carries the brand, so the mark takes an empty alt. */}
        <div className="auth__logo">
          <Logo variant="full" width={88} alt="" />
        </div>
        <h1>Join PFC</h1>

        <RegisterForm plans={plans} selectedPlanId={planId} />

        <p className="auth__alt">
          Already a member? <Link href="/login">Log in</Link>
        </p>
      </div>
    </section>
  );
}
