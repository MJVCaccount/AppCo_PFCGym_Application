import type { Metadata } from "next";
import Link from "next/link";

import { book } from "@/actions/gym";
import Alert from "@/components/Alert";
import StickyCta from "@/components/StickyCta";
import { getSlotsFor } from "@/lib/gym-data";
import { getSession } from "@/lib/session";
import {
  DAY_NAMES,
  DAY_ORDER,
  type DayKey,
  firstParam,
  isFull,
  type SearchParams,
  spacesLeft,
  todayKey,
} from "@/lib/types";

export const metadata: Metadata = {
  title: "Timetable",
  description:
    "Weekly class timetable for PFC Cape Town. Book a spot up to seven days ahead.",
};

export const dynamic = "force-dynamic";

function isDayKey(value: string | undefined): value is DayKey {
  return value !== undefined && DAY_ORDER.includes(value as DayKey);
}

export default async function TimetablePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const requestedDay = firstParam(params.day);
  const booked = firstParam(params.booked);
  const error = firstParam(params.error);

  // The day comes from the URL, so a tab is a real link: shareable, works with
  // the back button, and works with JavaScript off. Next routes it client-side,
  // so switching still feels instant.
  const selected: DayKey = isDayKey(requestedDay) ? requestedDay : todayKey();

  const slots = getSlotsFor(selected);
  const session = await getSession();

  return (
    <>
      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <p className="eyebrow">Weekly schedule</p>
            <h2>Timetable</h2>
            <p className="lead">
              Book a spot up to seven days ahead. Places are limited and fill
              quickly in the evenings.
            </p>
          </div>

          {booked && <Alert kind="ok">{booked}</Alert>}
          {error && <Alert kind="err">{error}</Alert>}

          <div className="days" role="tablist" aria-label="Day of the week">
            {DAY_ORDER.map((day) => (
              <Link
                key={day}
                className="day"
                href={`/timetable?day=${day}`}
                role="tab"
                aria-selected={day === selected}
                scroll={false}
              >
                {DAY_NAMES[day].slice(0, 3)}
              </Link>
            ))}
          </div>

          <div role="tabpanel" aria-label={DAY_NAMES[selected]}>
            {slots.length === 0 && (
              <p className="lead">
                No classes scheduled on {DAY_NAMES[selected]}.
              </p>
            )}

            {slots.map((slot) => {
              const full = isFull(slot);

              return (
                <div
                  className={`slot${full ? " slot__full" : ""}`}
                  key={slot.id}
                >
                  <p className="slot__time">
                    <b>{slot.startsAt}</b>
                    <span>{slot.durationMinutes} min</span>
                  </p>
                  <p className="slot__info">
                    <b>{slot.className}</b>
                    <span>{slot.coachName}</span>
                  </p>

                  {full ? (
                    <span className="tag">Full</span>
                  ) : (
                    <form action={book}>
                      <input type="hidden" name="slotId" value={slot.id} />
                      <input type="hidden" name="day" value={selected} />
                      <button
                        className="btn btn--red btn--sm"
                        type="submit"
                        aria-label={`Book ${slot.className} at ${slot.startsAt}`}
                      >
                        {session ? "Book" : "Sign in to book"}
                      </button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>

          <p
            className="form-note"
            style={{ textAlign: "left", marginTop: 16 }}
          >
            {DAY_NAMES[selected]} · {slots.length}{" "}
            {slots.length === 1 ? "class" : "classes"}
            {slots.length > 0 && (
              <>
                {" · "}
                {slots.reduce((total, s) => total + spacesLeft(s), 0)} places
                left
              </>
            )}
          </p>
        </div>
      </section>

      <StickyCta />
    </>
  );
}
