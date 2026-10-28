import "server-only";

/**
 * The weekly timetable as the public pages and GET /api/timetable show it.
 * Reads only; booking a place is bookingService.
 */
export {
  getNextAvailableSlot,
  getSlotsFor,
  getTimetable,
} from "@/lib/repositories/timetableRepository";
