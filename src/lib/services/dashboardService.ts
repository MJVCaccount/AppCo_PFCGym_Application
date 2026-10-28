import "server-only";

import { countUpcoming } from "@/lib/repositories/eventsRepository";
import { countFighters } from "@/lib/repositories/fightersRepository";
import { countPending } from "@/lib/repositories/participationsRepository";
import { getClasses } from "@/lib/repositories/programmesRepository";
import { getTimetable } from "@/lib/repositories/timetableRepository";
import { countByRole, getAll } from "@/lib/repositories/usersRepository";
import type {
  GymClass,
  TimetableSlot,
  UserAccount,
} from "@/lib/types";

/** The numbers and lists on the administrator's dashboard. */
export interface AdminOverview {
  timetable: TimetableSlot[];
  users: UserAccount[];
  classes: GymClass[];
  memberCount: number;
  coachCount: number;
  fighterCount: number;
  upcomingEventCount: number;
  pendingOfferCount: number;
}

/** `userLimit` caps the account list; the full list is /admin/members. */
export async function getAdminOverview(
  userLimit: number,
): Promise<AdminOverview> {
  const [
    timetable,
    users,
    classes,
    memberCount,
    coachCount,
    fighterCount,
    upcomingEventCount,
    pendingOfferCount,
  ] = await Promise.all([
    getTimetable(),
    getAll(userLimit),
    getClasses(),
    countByRole("Member"),
    countByRole("Coach"),
    countFighters(),
    countUpcoming(),
    countPending(),
  ]);

  return {
    timetable,
    users,
    classes,
    memberCount,
    coachCount,
    fighterCount,
    upcomingEventCount,
    pendingOfferCount,
  };
}
