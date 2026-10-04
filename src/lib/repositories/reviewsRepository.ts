import "server-only";

import type { Review as ReviewRow } from "@prisma/client";

import { isoDate } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import type { Review } from "@/lib/types";

/** Data-access layer for published member reviews. */

function toReview(row: ReviewRow): Review {
  return {
    id: row.id,
    memberName: row.memberName,
    body: row.body,
    rating: row.rating,
    postedOn: isoDate(row.postedOn),
  };
}

export async function getReviews(): Promise<Review[]> {
  const rows = await prisma.review.findMany({ orderBy: { id: "asc" } });
  return rows.map(toReview);
}
