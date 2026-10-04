"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { respondToOffer } from "@/lib/services/eventService";
import { getSession } from "@/lib/session";

/**
 * Accept or decline one of the signed-in fighter's bout offers.
 *
 * The service decides whether the caller may answer this offer; a refusal
 * comes back to the dashboard as an inline error rather than a thrown one.
 */
export async function respondToOfferAction(data: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login?returnUrl=%2Fdashboard");

  const result = await respondToOffer(
    session,
    Number(data.get("offerId")),
    data.get("response"),
  );

  revalidatePath("/dashboard");

  if (!result.ok || !result.data) {
    const message = result.error ?? "Your answer could not be saved.";
    redirect(`/dashboard?error=${encodeURIComponent(message)}`);
  }

  const verb = result.data.availability === "Accepted" ? "accepted" : "declined";

  redirect(
    `/dashboard?notice=${encodeURIComponent(
      `You ${verb} the bout at ${result.data.eventName}.`,
    )}`,
  );
}
