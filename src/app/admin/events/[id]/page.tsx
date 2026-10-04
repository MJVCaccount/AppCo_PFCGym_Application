import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireRole } from "@/actions/auth";
import Notices from "@/components/admin/Notices";
import OfferForm from "@/components/admin/OfferForm";
import ResultForm from "@/components/admin/ResultForm";
import { formatEventDate } from "@/lib/dates";
import { getEventDetail } from "@/lib/services/eventService";
import { listFightersForAdmin } from "@/lib/services/fighterService";
import { firstParam, type SearchParams } from "@/lib/types";

export const metadata: Metadata = { title: "Admin · Event" };
export const dynamic = "force-dynamic";

const AVAILABILITY_TAG = {
  Pending: "",
  Accepted: "tag--ok",
  Declined: "tag--off",
} as const;

export default async function AdminEventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id: rawId } = await params;
  const query = await searchParams;
  const session = await requireRole(`/admin/events/${rawId}`, "Admin");

  const eventId = /^\d+$/.test(rawId) ? Number(rawId) : NaN;
  const [detail, fighters] = await Promise.all([
    getEventDetail(session, eventId),
    listFightersForAdmin(session),
  ]);
  if (!detail.ok || !detail.data) {
    if (detail.status === 404 || detail.status === 400) notFound();
    throw new Error("The event could not be loaded.");
  }

  const { event, offers } = detail.data;
  const past = new Date(event.eventDate) < new Date();
  const open = event.status === "Scheduled" && !past;
  const offered = new Set(offers.map((o) => o.fighterId));
  const available = (fighters.data ?? [])
    .filter((f) => !offered.has(f.id))
    .map((f) => ({ id: f.id, name: f.fullName }));
  const resultOffers = past
    ? offers.filter((o) => o.availability === "Accepted")
    : [];

  return (
    <>
      <div className="section-head">
        <p className="eyebrow">Admin · Event</p>
        <h2>{event.name}</h2>
        <p className="lead">
          {formatEventDate(event.eventDate)} · {event.venue} · {event.status}
        </p>
        <p style={{ marginTop: 12 }}>
          <Link className="pill-link" href="/admin/events">
            &larr; All events
          </Link>
        </p>
      </div>

      <Notices notice={firstParam(query.notice)} error={firstParam(query.error)} />

      <section className="admin-section" aria-labelledby="offers-heading">
        <h3 id="offers-heading">Offers</h3>
        <div className="table-wrap">
          <table className="admin-table">
            <caption className="sr-only">Bout offers for {event.name}</caption>
            <thead>
              <tr>
                <th scope="col">Fighter</th>
                <th scope="col">Opponent</th>
                <th scope="col">Weight class</th>
                <th scope="col">Availability</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {offers.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No offers yet.
                  </td>
                </tr>
              )}
              {offers.map((o) => (
                <tr key={o.id}>
                  <td>{o.fighterName}</td>
                  <td>{o.opponentName ?? "To be confirmed"}</td>
                  <td>{o.boutWeightClass ?? "To be confirmed"}</td>
                  <td>
                    <span className={`tag ${AVAILABILITY_TAG[o.availability]}`}>
                      {o.availability}
                    </span>
                  </td>
                  <td>
                    {o.result === "NoContest" ? "No contest" : (o.result ?? "—")}
                    {o.resultNotes && <div className="muted">{o.resultNotes}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {open && (
        <div className="admin-card">
          <h3>Offer a bout</h3>
          {available.length === 0 ? (
            <p className="lead">Every fighter already has an offer for this event.</p>
          ) : (
            <OfferForm eventId={event.id} fighters={available} />
          )}
        </div>
      )}

      {resultOffers.length > 0 && event.status !== "Cancelled" && (
        <section className="admin-section" aria-labelledby="results-heading">
          <h3 id="results-heading">Record results</h3>
          {resultOffers.map((o) => (
            <div className="admin-card" key={o.id}>
              <ResultForm
                eventId={event.id}
                offerId={o.id}
                fighterName={o.fighterName}
                current={{ result: o.result, notes: o.resultNotes }}
              />
            </div>
          ))}
        </section>
      )}
    </>
  );
}
