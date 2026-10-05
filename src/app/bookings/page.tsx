import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { requireSession } from "@/actions/auth";
import { cancelBookingAction } from "@/actions/gym";
import Alert from "@/components/Alert";
import { listMyBookings } from "@/lib/services/bookingService";
import {
  type Booking,
  DAY_NAMES,
  firstParam,
  isMemberRole,
  type SearchParams,
} from "@/lib/types";

export const metadata: Metadata = {
  title: "My bookings",
  description: "Your upcoming and past PFC class bookings.",
};

export const dynamic = "force-dynamic";

/** "Mon 5 Oct" from a booking's day and ISO session date. */
function sessionLabel(booking: Booking): string {
  const date = new Date(`${booking.sessionDate}T00:00:00.000Z`);
  const dayAndMonth = date.toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

  return `${DAY_NAMES[booking.day].slice(0, 3)} ${dayAndMonth}`;
}

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);
  // Cancelling takes two steps without any JavaScript: the first click is a
  // link back to this page naming the booking, and only then is the real
  // submit button rendered.
  const confirming = Number(firstParam(params.confirm));

  const session = await requireSession("/bookings");
  if (!isMemberRole(session.role)) redirect("/denied");

  const { upcoming, past } = await listMyBookings(session);

  return (
    <section className="section">
      <div className="wrap">
        <div className="section-head section-head--row">
          <div>
            <p className="eyebrow">Account</p>
            <h2>My bookings</h2>
          </div>
          <Link className="pill-link" href="/timetable">
            Book a class &rarr;
          </Link>
        </div>

        {notice && <Alert kind="ok">{notice}</Alert>}
        {error && <Alert kind="err">{error}</Alert>}

        {upcoming.length === 0 && (
          <p className="lead">You have no upcoming classes booked.</p>
        )}

        {upcoming.map((booking) => (
          <div className="slot" key={booking.id}>
            <p className="slot__time">
              <b>{booking.startsAt}</b>
              <span>{sessionLabel(booking)}</span>
            </p>
            <p className="slot__info">
              <b>{booking.className}</b>
              <span>{booking.coachName}</span>
            </p>

            {confirming === booking.id ? (
              <div className="slot__actions">
                <form action={cancelBookingAction}>
                  <input type="hidden" name="bookingId" value={booking.id} />
                  <button
                    className="btn btn--red btn--sm"
                    type="submit"
                    aria-label={`Confirm cancelling ${booking.className} at ${booking.startsAt}`}
                  >
                    Confirm cancel
                  </button>
                </form>
                <Link className="btn btn--line btn--sm" href="/bookings">
                  Keep
                </Link>
              </div>
            ) : (
              <Link
                className="btn btn--line btn--sm"
                href={`/bookings?confirm=${booking.id}`}
                scroll={false}
                aria-label={`Cancel ${booking.className} at ${booking.startsAt}`}
              >
                Cancel
              </Link>
            )}
          </div>
        ))}

        {past.length > 0 && (
          <>
            <div className="section-head" style={{ marginTop: 40 }}>
              <h2>Past</h2>
            </div>

            {past.map((booking) => (
              <div className="slot slot__full" key={booking.id}>
                <p className="slot__time">
                  <b>{booking.startsAt}</b>
                  <span>{sessionLabel(booking)}</span>
                </p>
                <p className="slot__info">
                  <b>{booking.className}</b>
                  <span>{booking.coachName}</span>
                </p>
                <span className="tag">{booking.status}</span>
              </div>
            ))}
          </>
        )}
      </div>
    </section>
  );
}
