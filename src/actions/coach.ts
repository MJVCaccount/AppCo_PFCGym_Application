"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireRole } from "@/actions/auth";
import { markAttendance } from "@/lib/services/coachService";

/**
 * Record whether a member attended or no-showed. The role is checked here as
 * well as in the service: a coach or an admin, and the service narrows a coach
 * to their own classes (anything else is a 404).
 */
export async function markAttendanceAction(data: FormData): Promise<void> {
  const classId = String(data.get("classId") ?? "");
  const date = String(data.get("date") ?? "");
  const path = `/coach/classes/${encodeURIComponent(classId)}?date=${encodeURIComponent(date)}`;

  const session = await requireRole(path, "Coach", "Admin");

  const bookingId = Number(data.get("bookingId"));
  const status = data.get("status");
  const result = await markAttendance(session, bookingId, status);

  if (!result.ok) {
    redirect(`${path}&error=${encodeURIComponent(result.error ?? "That could not be saved.")}`);
  }

  revalidatePath("/dashboard");
  const label = status === "Completed" ? "attended" : "a no-show";
  redirect(
    `${path}&notice=${encodeURIComponent(`Marked ${result.data?.memberName} as ${label}.`)}`,
  );
}
