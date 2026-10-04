import Link from "next/link";

import { logout } from "@/actions/auth";
import Alert from "@/components/Alert";
import { coachStats, getMyClasses } from "@/lib/services/coachService";
import { DAY_NAMES, initials, isFull } from "@/lib/types";
import type { SessionUser } from "@/lib/types";

export default async function CoachDashboard({
  session,
}: {
  session: SessionUser;
}) {
  const now = new Date();
  const [classes, stats] = await Promise.all([
    getMyClasses(session, now),
    coachStats(session, now),
  ]);

  const week = classes.data ?? [];
  const totalBooked = week.reduce((sum, slot) => sum + slot.booked, 0);
  const rate = stats.data?.rate ?? null;

  return (
    <div className="dash">
      <aside className="dash__side">
        <Link
          className="btn btn--red btn--sm"
          href="/dashboard"
          aria-current="page"
        >
          Dashboard
        </Link>
        <div className="dash__user">
          <span className="dash__avatar" aria-hidden="true">
            {initials(session.fullName)}
          </span>
          <span>
            <b>{session.fullName}</b>
            <span>Coach</span>
          </span>
        </div>
      </aside>

      <div className="dash__main">
        <div className="wrap">
          <div className="section-head section-head--row">
            <div>
              <p className="eyebrow">Coach</p>
              <h2>Your classes</h2>
            </div>
            <form action={logout}>
              <button className="pill-link" type="submit">
                Sign out
              </button>
            </form>
          </div>

          {!classes.ok && (
            <Alert kind="err">{classes.error ?? "Your classes could not be loaded."}</Alert>
          )}

          <div className="stats" style={{ margin: "0 0 40px" }}>
            <div>
              <b>{week.length}</b>
              <span>Classes scheduled</span>
            </div>
            <div>
              <b>{totalBooked}</b>
              <span>Booked, next sessions</span>
            </div>
            <div>
              <b>{rate === null ? "—" : `${Math.round(rate * 100)}%`}</b>
              <span>
                {rate === null
                  ? "No attendance recorded yet"
                  : `Attendance, last 30 days (${stats.data?.attended} attended, ${stats.data?.noShow} no-show)`}
              </span>
            </div>
          </div>

          <div className="section-head">
            <h2>Your week</h2>
            <p className="lead">Open a class to see who is booked and record attendance.</p>
          </div>

          {week.length === 0 && (
            <p className="lead">You have no classes scheduled yet. An administrator adds them.</p>
          )}

          {week.map((slot) => (
            <div
              className={`slot${isFull(slot) ? " slot__full" : ""}`}
              key={slot.id}
            >
              <p className="slot__time">
                <b>{slot.startsAt}</b>
                <span>{DAY_NAMES[slot.day].slice(0, 3)}</span>
              </p>
              <p className="slot__info">
                <b>{slot.className}</b>
                <span>
                  {slot.booked} of {slot.capacity} booked · {slot.durationMinutes} min
                </span>
              </p>
              <Link
                className="btn btn--grey btn--sm"
                href={`/coach/classes/${slot.id}?date=${slot.rosterDate}`}
                aria-label={`Roster for ${slot.className} on ${DAY_NAMES[slot.day]} at ${slot.startsAt}`}
              >
                Roster
              </Link>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
