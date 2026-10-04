"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { logger } from "@/lib/logger";
import { getSession } from "@/lib/session";
import { cancelBooking, createBooking } from "@/lib/services/bookingService";
import {
  cancelMembership as cancelPlan,
  changePlan as switchPlan,
} from "@/lib/services/membershipService";
import {
  type FormState,
  validate,
  valuesFrom,
} from "@/lib/validation";

/** Reserve a place in a class. */
export async function book(data: FormData): Promise<void> {
  const id = Number(data.get("slotId"));
  const day = String(data.get("day") ?? "mon");

  const session = await getSession();
  if (!session) {
    redirect(`/login?returnUrl=${encodeURIComponent(`/timetable?day=${day}`)}`);
  }

  const result = await createBooking(session, id);

  revalidatePath("/timetable");
  revalidatePath("/dashboard");

  if (!result.ok) {
    const message = result.error ?? "That class could not be booked.";
    redirect(`/timetable?day=${day}&error=${encodeURIComponent(message)}`);
  }

  const confirmation = result.slot
    ? `Booked ${result.slot.className} at ${result.slot.startsAt} with ${result.slot.coachName}. A confirmation email is on its way.`
    : "Class booked.";

  redirect(`/timetable?day=${day}&booked=${encodeURIComponent(confirmation)}`);
}

/** Cancel one of the signed-in member's bookings. */
export async function cancelBookingAction(data: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login?returnUrl=%2Fbookings");

  const result = await cancelBooking(session, Number(data.get("bookingId")));

  revalidatePath("/bookings");
  revalidatePath("/timetable");
  revalidatePath("/dashboard");

  if (!result.ok) {
    const message = result.error ?? "That booking could not be cancelled.";
    redirect(`/bookings?error=${encodeURIComponent(message)}`);
  }

  const confirmation = result.booking
    ? `Cancelled ${result.booking.className} at ${result.booking.startsAt}.`
    : "Booking cancelled.";

  redirect(`/bookings?notice=${encodeURIComponent(confirmation)}`);
}

/** Move the signed-in member onto a different plan. */
export async function changePlan(data: FormData): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login?returnUrl=%2Fmemberships");

  const result = await switchPlan(session, Number(data.get("planId")));

  if (!result.ok || !result.plan) {
    const message = result.error ?? "That plan could not be found.";
    redirect(`/memberships?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/", "layout");

  redirect(
    `/dashboard?notice=${encodeURIComponent(
      `You are now on the R${result.plan.pricePerMonth} plan.`,
    )}`,
  );
}

/** Cancel the signed-in member's plan. */
export async function cancelMembership(): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/login?returnUrl=%2Fdashboard");

  const result = await cancelPlan(session);

  if (!result.ok) {
    const message = result.error ?? "Your membership could not be cancelled.";
    redirect(`/memberships?error=${encodeURIComponent(message)}`);
  }

  revalidatePath("/", "layout");

  redirect(
    "/dashboard?notice=" +
      encodeURIComponent(
        "Your membership has been cancelled. Access continues until the end of the paid month.",
      ),
  );
}

/**
 * Contact enquiry.
 *
 * Part 2 replaces the log line with a database write and an email send.
 */
export async function sendEnquiry(
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const values = valuesFrom(data, ["fullName", "email", "phone", "message"]);
  const errors = validate(data, {
    fullName: "name",
    email: "email",
    phone: "phone",
    message: "message",
  });

  if (Object.keys(errors).length > 0) {
    return {
      ok: false,
      message: "Please fix the highlighted fields and try again.",
      errors,
      values,
    };
  }

  logger.info("Contact enquiry received");

  return {
    ok: true,
    message:
      "Thanks — your message is on its way. We usually reply within one working day.",
  };
}
