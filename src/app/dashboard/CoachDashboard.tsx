import Link from "next/link";

import { logout } from "@/actions/auth";
import { getSlotsForCoach } from "@/lib/gym-data";
import {
  DAY_NAMES,
  initials,
  isFull,
  spacesLeft,
  todayKey,
} from "@/lib/types";
import type { SessionUser } from "@/lib/types";

export default function CoachDashboard({ session }: { session: SessionUser }) {
  const week = getSlotsForCoach(session.fullName);
  const today = week.filter((slot) => slot.day === todayKey());
  const totalBooked = week.reduce((sum, slot) => sum + slot.booked, 0);

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
              <p className="eyebrow">Today</p>
              <h2>Your classes</h2>
            </div>
            <form action={logout}>
              <button className="pill-link" type="submit">
                Sign out
              </button>
            </form>
          </div>

          {today.length === 0 ? (
            <p className="lead">Nothing scheduled today.</p>
          ) : (
            today.map((slot) => (
              <div className="slot" key={slot.id}>
                <p className="slot__time">
                  <b>{slot.startsAt}</b>
                  <span>{slot.durationMinutes} min</span>
                </p>
                <p className="slot__info">
                  <b>{slot.className}</b>
                  <span>
                    {slot.booked} of {slot.capacity} booked
                  </span>
                </p>
                <span className="tag">
                  {isFull(slot) ? "Full" : `${spacesLeft(slot)} left`}
                </span>
              </div>
            ))
          )}

          <div className="stats" style={{ margin: "40px 0" }}>
            <div>
              <b>{week.length}</b>
              <span>Classes this week</span>
            </div>
            <div>
              <b>{totalBooked}</b>
              <span>Athletes booked</span>
            </div>
            <div>
              <b>{week.filter(isFull).length}</b>
              <span>Fully booked</span>
            </div>
          </div>

          <div className="section-head">
            <h2>Your week</h2>
          </div>

          {week.map((slot) => (
            <div
              className={`slot${isFull(slot) ? " slot__full" : ""}`}
              key={`week-${slot.id}`}
            >
              <p className="slot__time">
                <b>{slot.startsAt}</b>
                <span>{DAY_NAMES[slot.day].slice(0, 3)}</span>
              </p>
              <p className="slot__info">
                <b>{slot.className}</b>
                <span>
                  {slot.booked} of {slot.capacity} booked
                </span>
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
