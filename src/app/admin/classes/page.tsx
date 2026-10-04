import type { Metadata } from "next";
import Link from "next/link";

import {
  createClassAction,
  createProgrammeAction,
  deactivateClassAction,
  deactivateProgrammeAction,
  deleteClassAction,
  reactivateClassAction,
  updateClassAction,
  updateProgrammeAction,
} from "@/actions/admin";
import { requireRole } from "@/actions/auth";
import ClassForm from "@/components/admin/ClassForm";
import ConfirmBar from "@/components/admin/ConfirmBar";
import Notices from "@/components/admin/Notices";
import ProgrammeForm from "@/components/admin/ProgrammeForm";
import Alert from "@/components/Alert";
import { listSessions, listProgrammes } from "@/lib/services/classAdminService";
import { listCoaches } from "@/lib/services/coachAdminService";
import {
  DAY_NAMES,
  DAY_ORDER,
  type DayKey,
  firstParam,
  type SearchParams,
} from "@/lib/types";

export const metadata: Metadata = { title: "Admin · Classes" };
export const dynamic = "force-dynamic";

export default async function AdminClassesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const session = await requireRole("/admin/classes", "Admin");

  const dayParam = firstParam(params.day);
  const day = DAY_ORDER.includes(dayParam as DayKey) ? (dayParam as DayKey) : null;
  const editId = Number(firstParam(params.edit));
  const programmeEditId = Number(firstParam(params.pedit));
  const confirm = firstParam(params.confirm) ?? "";

  const [classes, programmes, coaches] = await Promise.all([
    listSessions(session),
    listProgrammes(session),
    listCoaches(session),
  ]);

  const loadError = [classes, programmes, coaches].find((r) => !r.ok)?.error;
  const allClasses = classes.data ?? [];
  const shown = day ? allClasses.filter((c) => c.day === day) : allClasses;

  const here = day ? `/admin/classes?day=${day}` : "/admin/classes";
  const link = (extra: string) => `${here}${here.includes("?") ? "&" : "?"}${extra}`;

  const editing = allClasses.find((c) => c.id === editId);
  const editingProgramme = (programmes.data ?? []).find(
    (p) => p.id === programmeEditId,
  );
  const [confirmKind, confirmRaw] = confirm.split(":");
  const confirmId = Number(confirmRaw);
  const confirmClass = allClasses.find((c) => c.id === confirmId);
  const confirmProgramme = (programmes.data ?? []).find((p) => p.id === confirmId);

  const coachOptions = (extra?: number) =>
    (coaches.data ?? [])
      .filter((c) => c.isActive || c.id === extra)
      .map((c) => ({ id: c.id, name: c.name }));
  const programmeOptions = (programmes.data ?? [])
    .filter((p) => p.isActive)
    .map((p) => ({ id: p.id, name: p.name }));

  return (
    <>
      <div className="section-head">
        <p className="eyebrow">Admin</p>
        <h2>Classes</h2>
        <p className="lead">The weekly timetable, and the public classes catalogue.</p>
      </div>

      <Notices notice={firstParam(params.notice)} error={firstParam(params.error)} />
      {loadError && <Alert kind="err">{loadError}</Alert>}

      <section className="admin-section" aria-labelledby="timetable-heading">
        <h3 id="timetable-heading">Scheduled classes</h3>

        <div className="admin-filters" role="group" aria-label="Filter by day">
          <Link
            className={`btn btn--sm ${day ? "btn--grey" : "btn--red"}`}
            href="/admin/classes"
            aria-current={day ? undefined : "true"}
          >
            All
          </Link>
          {DAY_ORDER.map((d) => (
            <Link
              key={d}
              className={`btn btn--sm ${day === d ? "btn--red" : "btn--grey"}`}
              href={`/admin/classes?day=${d}`}
              aria-current={day === d ? "true" : undefined}
            >
              {DAY_NAMES[d].slice(0, 3)}
            </Link>
          ))}
        </div>

        {confirmKind === "deactivate" && confirmClass && (
          <ConfirmBar
            message={`Deactivate ${confirmClass.name} (${DAY_NAMES[confirmClass.day]} ${confirmClass.startsAt})? ${confirmClass.futureBookings} future ${confirmClass.futureBookings === 1 ? "booking" : "bookings"} will be cancelled.`}
            action={deactivateClassAction}
            fields={{ id: confirmClass.id }}
            confirmLabel="Deactivate class"
            cancelHref={here}
          />
        )}
        {confirmKind === "delete" && confirmClass && (
          <ConfirmBar
            message={`Delete ${confirmClass.name} (${DAY_NAMES[confirmClass.day]} ${confirmClass.startsAt}) for good? It has never had a booking.`}
            action={deleteClassAction}
            fields={{ id: confirmClass.id }}
            confirmLabel="Delete class"
            cancelHref={here}
          />
        )}

        <div className="table-wrap">
          <table className="admin-table">
            <caption className="sr-only">Scheduled classes</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col">Time</th>
                <th scope="col">Class</th>
                <th scope="col">Coach</th>
                <th scope="col">Capacity</th>
                <th scope="col">Booked next</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    No classes{day ? ` on ${DAY_NAMES[day]}` : ""}.
                  </td>
                </tr>
              )}
              {shown.map((c) => (
                <tr key={c.id}>
                  <td>{DAY_NAMES[c.day]}</td>
                  <td>{c.startsAt}</td>
                  <td>
                    {c.name}
                    <div className="muted">{c.kind} · {c.durationMinutes} min</div>
                  </td>
                  <td>{c.coachName}</td>
                  <td>{c.capacity}</td>
                  <td>{c.booked}</td>
                  <td>
                    <span className={`tag ${c.isActive ? "tag--ok" : "tag--off"}`}>
                      {c.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td>
                    <div className="admin-actions">
                      <Link
                        className="btn btn--grey btn--sm"
                        href={link(`edit=${c.id}`)}
                        scroll={false}
                        aria-label={`Edit ${c.name} on ${DAY_NAMES[c.day]} at ${c.startsAt}`}
                      >
                        Edit
                      </Link>
                      {c.isActive ? (
                        <Link
                          className="btn btn--line btn--sm"
                          href={link(`confirm=deactivate:${c.id}`)}
                          scroll={false}
                          aria-label={`Deactivate ${c.name} on ${DAY_NAMES[c.day]} at ${c.startsAt}`}
                        >
                          Deactivate
                        </Link>
                      ) : (
                        <form action={reactivateClassAction}>
                          <input type="hidden" name="id" value={c.id} />
                          <button className="btn btn--line btn--sm" type="submit">
                            Reactivate
                          </button>
                        </form>
                      )}
                      {!c.hasBookings && (
                        <Link
                          className="btn btn--line btn--sm"
                          href={link(`confirm=delete:${c.id}`)}
                          scroll={false}
                          aria-label={`Delete ${c.name} on ${DAY_NAMES[c.day]} at ${c.startsAt}`}
                        >
                          Delete
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {editing ? (
          <div className="admin-card" id="edit">
            <h3>Edit {editing.name}</h3>
            <ClassForm
              key={editing.id}
              action={updateClassAction}
              coaches={coachOptions(editing.coachId)}
              programmes={programmeOptions}
              submitLabel="Save changes"
              initial={{
                id: String(editing.id),
                name: editing.name,
                kind: editing.kind,
                coachId: String(editing.coachId),
                day: editing.day,
                startsAt: editing.startsAt,
                durationMinutes: String(editing.durationMinutes),
                capacity: String(editing.capacity),
                programmeId: editing.programmeId ? String(editing.programmeId) : "",
              }}
            />
            <p className="help">
              The day and time cannot change while the class has future bookings:
              deactivate it and add a new class instead.
            </p>
            <p style={{ marginTop: 12 }}>
              <Link className="pill-link" href={here} scroll={false}>
                Cancel editing
              </Link>
            </p>
          </div>
        ) : (
          <div className="admin-card">
            <h3>Add a class</h3>
            <ClassForm
              action={createClassAction}
              coaches={coachOptions()}
              programmes={programmeOptions}
              submitLabel="Add class"
            />
          </div>
        )}
      </section>

      <section className="admin-section" aria-labelledby="programmes-heading">
        <h3 id="programmes-heading">Programmes (public Classes page)</h3>

        {confirmKind === "pdeactivate" && confirmProgramme && (
          <ConfirmBar
            message={`Hide ${confirmProgramme.name} from the public Classes page? Scheduled classes that use it are not changed.`}
            action={deactivateProgrammeAction}
            fields={{ id: confirmProgramme.id }}
            confirmLabel="Hide programme"
            cancelHref={here}
          />
        )}

        <div className="table-wrap">
          <table className="admin-table">
            <caption className="sr-only">Programmes</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Level</th>
                <th scope="col">Duration</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(programmes.data ?? []).map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.name}
                    <div className="muted">/{p.slug}</div>
                  </td>
                  <td>{p.level}</td>
                  <td>{p.durationMinutes} min</td>
                  <td>
                    <span className={`tag ${p.isActive ? "tag--ok" : "tag--off"}`}>
                      {p.isActive ? "Shown" : "Hidden"}
                    </span>
                  </td>
                  <td>
                    <div className="admin-actions">
                      <Link
                        className="btn btn--grey btn--sm"
                        href={link(`pedit=${p.id}`)}
                        scroll={false}
                        aria-label={`Edit the ${p.name} programme`}
                      >
                        Edit
                      </Link>
                      {p.isActive && (
                        <Link
                          className="btn btn--line btn--sm"
                          href={link(`confirm=pdeactivate:${p.id}`)}
                          scroll={false}
                          aria-label={`Hide the ${p.name} programme`}
                        >
                          Hide
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {editingProgramme ? (
          <div className="admin-card">
            <h3>Edit {editingProgramme.name}</h3>
            <ProgrammeForm
              key={editingProgramme.id}
              action={updateProgrammeAction}
              submitLabel="Save changes"
              initial={{
                id: String(editingProgramme.id),
                name: editingProgramme.name,
                level: editingProgramme.level,
                description: editingProgramme.description,
                durationMinutes: String(editingProgramme.durationMinutes),
              }}
            />
            <p style={{ marginTop: 12 }}>
              <Link className="pill-link" href={here} scroll={false}>
                Cancel editing
              </Link>
            </p>
          </div>
        ) : (
          <div className="admin-card">
            <h3>Add a programme</h3>
            <ProgrammeForm action={createProgrammeAction} submitLabel="Add programme" />
          </div>
        )}
      </section>
    </>
  );
}
