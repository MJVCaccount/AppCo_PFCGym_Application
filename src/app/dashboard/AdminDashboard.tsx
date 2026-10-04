import Link from "next/link";

import { logout } from "@/actions/auth";
import { countUpcoming } from "@/lib/repositories/eventsRepository";
import { countFighters } from "@/lib/repositories/fightersRepository";
import { countPending } from "@/lib/repositories/participationsRepository";
import { getClasses } from "@/lib/repositories/programmesRepository";
import { getTimetable } from "@/lib/repositories/timetableRepository";
import { countByRole, getAll } from "@/lib/repositories/usersRepository";
import { initials, isFull } from "@/lib/types";
import type { SessionUser } from "@/lib/types";

export default async function AdminDashboard({
  session,
}: {
  session: SessionUser;
}) {
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
    getAll(),
    getClasses(),
    countByRole("Member"),
    countByRole("Coach"),
    countFighters(),
    countUpcoming(),
    countPending(),
  ]);

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
            <span>Administrator</span>
          </span>
        </div>
      </aside>

      <div className="dash__main">
        <div className="wrap">
          <div className="section-head section-head--row">
            <div>
              <p className="eyebrow">Overview</p>
              <h2>Admin</h2>
            </div>
            <form action={logout}>
              <button className="pill-link" type="submit">
                Sign out
              </button>
            </form>
          </div>

          <div className="stats" style={{ marginBottom: 40 }}>
            <div>
              <b>{memberCount}</b>
              <span>Members</span>
            </div>
            <div>
              <b>{coachCount}</b>
              <span>Coaches</span>
            </div>
            <div>
              <b>{classes.length}</b>
              <span>Classes</span>
            </div>
            <div>
              <b>{timetable.length}</b>
              <span>Weekly slots</span>
            </div>
            <div>
              <b>{timetable.filter(isFull).length}</b>
              <span>Fully booked</span>
            </div>
          </div>

          <div className="stats" style={{ marginBottom: 40 }}>
            <div>
              <b>{fighterCount}</b>
              <span>Fighters</span>
            </div>
            <div>
              <b>{upcomingEventCount}</b>
              <span>Upcoming events</span>
            </div>
            <div>
              <b>{pendingOfferCount}</b>
              <span>Pending offers</span>
            </div>
          </div>

          <div className="section-head">
            <h2>Users</h2>
            <p className="lead">
              Editing accounts arrives with the Part 2 back end.
            </p>
          </div>

          {users.map((user) => (
            <div className="slot" key={user.id}>
              <p className="slot__time" style={{ flex: "0 0 44px" }}>
                <span
                  className="dash__avatar"
                  style={{ width: 36, height: 36, fontSize: 12 }}
                  aria-hidden="true"
                >
                  {initials(user.fullName)}
                </span>
              </p>
              <p className="slot__info">
                <b>{user.fullName}</b>
                <span>{user.email}</span>
              </p>
              <span className="tag">{user.role}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
