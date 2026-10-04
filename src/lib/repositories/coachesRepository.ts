import "server-only";

import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type { Coach } from "@/lib/types";

/** Data-access layer for the coaching team. */

const coachSelect = {
  coachId: true,
  title: true,
  bio: true,
  user: { select: { fullName: true } },
} satisfies Prisma.CoachSelect;

type CoachRow = Prisma.CoachGetPayload<{ select: typeof coachSelect }>;

function toCoach(row: CoachRow): Coach {
  return {
    id: row.coachId,
    name: row.user.fullName,
    role: row.title,
    bio: row.bio,
  };
}

export async function getCoaches(): Promise<Coach[]> {
  const rows = await prisma.coach.findMany({
    where: { isActive: true },
    orderBy: { coachId: "asc" },
    select: coachSelect,
  });

  return rows.map(toCoach);
}

export async function getCoachByName(name: string): Promise<Coach | undefined> {
  const row = await prisma.coach.findFirst({
    where: { isActive: true, user: { fullName: name.trim() } },
    orderBy: { coachId: "asc" },
    select: coachSelect,
  });

  return row ? toCoach(row) : undefined;
}
