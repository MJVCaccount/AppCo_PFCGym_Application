import "server-only";

import type { ClassProgramme } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type { GymClass } from "@/lib/types";

/**
 * Data-access layer for the class catalogue (Task 1 §7.1.2): the programmes
 * the gym offers, as opposed to the dated slots in timetableRepository.
 */

function toClass(row: ClassProgramme): GymClass {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    level: row.level,
    durationMinutes: row.durationMinutes,
  };
}

export async function getClasses(): Promise<GymClass[]> {
  const rows = await prisma.classProgramme.findMany({
    where: { isActive: true },
    orderBy: { id: "asc" },
  });

  return rows.map(toClass);
}

export async function getClass(slug: string): Promise<GymClass | undefined> {
  const row = await prisma.classProgramme.findFirst({
    where: { slug: slug.trim().toLowerCase(), isActive: true },
  });

  return row ? toClass(row) : undefined;
}
