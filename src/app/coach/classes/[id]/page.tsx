import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireRole } from "@/actions/auth";
import { markAttendanceAction } from "@/actions/coach";
import Alert from "@/components/Alert";
import SubmitButton from "@/components/SubmitButton";
import { formatSessionDate, gymDateAndTime, isoDate } from "@/lib/dates";
import { getRoster } from "@/lib/services/coachService";
import { DAY_NAMES, firstParam, type SearchParams } from "@/lib/types";

export const metadata: Metadata = { title: "Class roster" };
export const dynamic = "force-dynamic";

const NOT_YET = "Available once the class has happened.";

export default async function RosterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id: rawId } = await params;
  const query = await searchParams;
  const date = firstParam(query.date) ?? isoDate(gymDateAndTime(new Date()).date);

  const session = await requireRole(
    `/coach/classes/${rawId}?date=${encodeURIComponent(date)}`,
    "Coach",
    "Admin",
  );

  const classId = /^\d+$/.test(rawId) ? Number(rawId) : NaN;
  const result = await getRoster(session, classId, date);
  if (!result.ok || !result.data) {
    // Someone else's class answers 404, the same as one that does not exist.
    if ([400, 404].includes(result.status)) notFound();
    throw new Error("The roster could not be loaded.");
  }

  const roster = result.data;
  const notice = firstParam(query.notice);
  const error = firstParam(query.error);

  return (
    <section className="section">
      <div className="wrap">
        <div className="section-head">
          <p className="eyebrow">Roster</p>
          <h2>{roster.className}</h2>
          <p className="lead">
            {DAY_NAMES[roster.day]} {roster.startsAt} · {formatSessionDate(roster.sessionDate)} · {roster.coachName}
          </p>
          <p style={{ marginTop: 12 }}>
            <Link className="pill-link" href="/dashboard">
              &larr; Your classes
            </Link>
          </p>
        </div>

        {notice && <Alert kind="ok">{notice}</Alert>}
        {error && <Alert kind="err">{error}</Alert>}

        {!roster.canMark && (
          <p className="lead" style={{ marginBottom: 16 }}>
            This class has not happened yet, so attendance cannot be recorded.
          </p>
        )}

        {roster.entries.length === 0 && (
          <p className="lead">Nobody is booked into this session.</p>
        )}

        {roster.entries.map((entry) => {
          const markable = ["Confirmed", "Completed", "NoShow"].includes(entry.status);

          return (
            <div className="slot roster-row" key={entry.bookingId}>
              <p className="slot__info">
                <b>{entry.memberName}</b>
                <span>{entry.status === "NoShow" ? "No-show" : entry.status}</span>
              </p>

              {markable && (
                <div className="slot__actions">
                  {(["Completed", "NoShow"] as const).map((status) => (
                    <form action={markAttendanceAction} key={status}>
                      <input type="hidden" name="bookingId" value={entry.bookingId} />
                      <input type="hidden" name="classId" value={roster.classId} />
                      <input type="hidden" name="date" value={roster.sessionDate} />
                      <input type="hidden" name="status" value={status} />
                      {roster.canMark ? (
                        <SubmitButton
                          className={`btn btn--sm ${status === "Completed" ? "btn--red" : "btn--line"}`}
                          pendingLabel="Saving…"
                        >
                          {status === "Completed" ? "Mark attended" : "No-show"}
                          <span className="sr-only"> for {entry.memberName}</span>
                        </SubmitButton>
                      ) : (
                        <button
                          className={`btn btn--sm ${status === "Completed" ? "btn--red" : "btn--line"}`}
                          type="button"
                          disabled
                          title={NOT_YET}
                          aria-label={`${status === "Completed" ? "Mark attended" : "No-show"} for ${entry.memberName}: ${NOT_YET}`}
                        >
                          {status === "Completed" ? "Mark attended" : "No-show"}
                        </button>
                      )}
                    </form>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
