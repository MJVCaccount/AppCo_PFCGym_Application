import type { Metadata } from "next";
import Image from "next/image";

import { formatEventDate } from "@/lib/dates";
import { listPublicEvents } from "@/lib/services/eventService";

export const metadata: Metadata = {
  title: "Events",
  description:
    "Upcoming PFC fight nights and championships: dates, venues and what to expect.",
};

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const events = await listPublicEvents();

  return (
    <section className="section">
      <div className="wrap">
        <div className="section-head">
          <p className="eyebrow">Fight calendar</p>
          <h2>Upcoming events</h2>
          <p className="lead">
            Fight nights and championships featuring PFC fighters.
          </p>
        </div>

        {events.length === 0 ? (
          <p className="lead">No events scheduled yet.</p>
        ) : (
          <div className="grid grid--3">
            {events.map((event) => (
              <article className="card" key={event.id}>
                {event.imageUrl && (
                  <Image
                    className="card__media"
                    src={event.imageUrl}
                    alt={`${event.name} poster`}
                    width={800}
                    height={600}
                  />
                )}
                <div className="card__body">
                  <h3>{event.name}</h3>
                  <p>{event.description}</p>
                  <div className="card__tags">
                    <span className="tag">
                      <time dateTime={event.eventDate}>
                        {formatEventDate(event.eventDate)}
                      </time>
                    </span>
                    <span className="tag">{event.venue}</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
