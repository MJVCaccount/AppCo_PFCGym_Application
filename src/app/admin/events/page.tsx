import type { Metadata } from "next";
import Link from "next/link";

import {
  cancelEventAction,
  completeEventAction,
  createEventAction,
  updateEventAction,
} from "@/actions/admin";
import { requireRole } from "@/actions/auth";
import ConfirmBar from "@/components/admin/ConfirmBar";
import EventForm from "@/components/admin/EventForm";
import Notices from "@/components/admin/Notices";
import Alert from "@/components/Alert";
import { formatEventDate, isoToGymLocal } from "@/lib/dates";
import { listAllEvents } from "@/lib/services/eventService";
import { firstParam, type SearchParams } from "@/lib/types";

export const metadata: Metadata = { title: "Admin · Events" };
export const dynamic = "force-dynamic";

const STATUS_TAG = {
  Scheduled: "tag--ok",
  Completed: "",
  Cancelled: "tag--off",
} as const;

export default async function AdminEventsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const session = await requireRole("/admin/events", "Admin");

  const editId = Number(firstParam(params.edit));
  const cancelId = Number(firstParam(params.cancel));

  const result = await listAllEvents(session);
  const events = result.data ?? [];
  const now = new Date();
  const editing = events.find((e) => e.id === editId && e.status === "Scheduled");
  const cancelling = events.find((e) => e.id === cancelId && e.status === "Scheduled");

  return (
    <>
      <div className="section-head">
        <p className="eyebrow">Admin</p>
        <h2>Events</h2>
        <p className="lead">Competitions, the bouts offered at them, and the results.</p>
      </div>

      <Notices notice={firstParam(params.notice)} error={firstParam(params.error)} />
      {!result.ok && <Alert kind="err">{result.error ?? "Events could not be loaded."}</Alert>}

      {cancelling && (
        <ConfirmBar
          message={`Cancel ${cancelling.name}? It disappears from the public Events page. Its offers and results are kept.`}
          action={cancelEventAction}
          fields={{ id: cancelling.id }}
          confirmLabel="Cancel event"
          cancelHref="/admin/events"
        />
      )}

      <section className="admin-section" aria-labelledby="events-heading">
        <h3 id="events-heading">All events</h3>
        <div className="table-wrap">
          <table className="admin-table">
            <caption className="sr-only">Events</caption>
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">When (Johannesburg)</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No events yet.
                  </td>
                </tr>
              )}
              {events.map((e) => {
                const past = new Date(e.eventDate) < now;

                return (
                  <tr key={e.id}>
                    <td>
                      {e.name}
                      <div className="muted">{e.venue}</div>
                    </td>
                    <td>{formatEventDate(e.eventDate)}</td>
                    <td>
                      <span className={`tag ${STATUS_TAG[e.status]}`}>{e.status}</span>
                    </td>
                    <td>
                      <div className="admin-actions">
                        <Link
                          className="btn btn--grey btn--sm"
                          href={`/admin/events/${e.id}`}
                          aria-label={`Offers and results for ${e.name}`}
                        >
                          Offers
                        </Link>
                        {e.status === "Scheduled" && (
                          <Link
                            className="btn btn--grey btn--sm"
                            href={`/admin/events?edit=${e.id}`}
                            scroll={false}
                            aria-label={`Edit ${e.name}`}
                          >
                            Edit
                          </Link>
                        )}
                        {e.status === "Scheduled" && past && (
                          <form action={completeEventAction}>
                            <input type="hidden" name="id" value={e.id} />
                            <button
                              className="btn btn--line btn--sm"
                              type="submit"
                              aria-label={`Mark ${e.name} completed`}
                            >
                              Mark completed
                            </button>
                          </form>
                        )}
                        {e.status === "Scheduled" && (
                          <Link
                            className="btn btn--line btn--sm"
                            href={`/admin/events?cancel=${e.id}`}
                            scroll={false}
                            aria-label={`Cancel ${e.name}`}
                          >
                            Cancel
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {editing ? (
        <div className="admin-card">
          <h3>Edit {editing.name}</h3>
          <EventForm
            key={editing.id}
            action={updateEventAction}
            submitLabel="Save changes"
            initial={{
              id: String(editing.id),
              name: editing.name,
              venue: editing.venue,
              description: editing.description,
              eventDate: isoToGymLocal(editing.eventDate),
              imageUrl: editing.imageUrl ?? "",
            }}
          />
          <p style={{ marginTop: 12 }}>
            <Link className="pill-link" href="/admin/events" scroll={false}>
              Cancel editing
            </Link>
          </p>
        </div>
      ) : (
        <div className="admin-card">
          <h3>Create an event</h3>
          <EventForm action={createEventAction} submitLabel="Create event" />
        </div>
      )}
    </>
  );
}
