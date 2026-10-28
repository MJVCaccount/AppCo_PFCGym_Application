import "server-only";

/**
 * What the public pages and the header, footer and sticky bar show: classes,
 * coaches, plans, reviews and opening hours.
 *
 * These are plain reads with no rules of their own yet, so they are passed
 * through from the repositories unchanged (including React's per-request
 * cache). Pages and components import them from here, which keeps the
 * repositories behind the service layer and gives any later rule (hiding
 * an archived coach, say) one place to live.
 */
export { getClasses } from "@/lib/repositories/programmesRepository";
export { getCoaches } from "@/lib/repositories/coachesRepository";
export {
  getCheapestPlanPrice,
  getPlan,
  getPlans,
} from "@/lib/repositories/plansRepository";
export { getReviews } from "@/lib/repositories/reviewsRepository";
export {
  getHoursFor,
  getOpeningHours,
  isOpenAt,
} from "@/lib/repositories/hoursRepository";
