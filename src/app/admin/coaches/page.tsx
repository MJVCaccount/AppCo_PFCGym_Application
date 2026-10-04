import type { Metadata } from "next";
import Link from "next/link";

import {
  archiveCoachAction,
  createCoachAction,
  restoreCoachAction,
  updateCoachAction,
} from "@/actions/admin";
import { requireRole } from "@/actions/auth";
import CoachForm from "@/components/admin/CoachForm";
import ConfirmBar from "@/components/admin/ConfirmBar";
import Notices from "@/components/admin/Notices";
import Alert from "@/components/Alert";
import { listCoaches } from "@/lib/services/coachAdminService";
import { firstParam, type SearchParams } from "@/lib/types";

export const metadata: Metadata = { title: "Admin · Coaches" };
export const dynamic = "force-dynamic";

export default async function AdminCoachesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const session = await requireRole("/admin/coaches", "Admin");

  const editId = Number(firstParam(params.edit));
  const archiveId = Number(firstParam(params.archive));

  const result = await listCoaches(session);
  const coaches = result.data ?? [];
  const editing = coaches.find((c) => c.id === editId);
  const archiving = coaches.find((c) => c.id === archiveId);

  return (
    <>
      <div className="section-head">
        <p className="eyebrow">Admin</p>
        <h2>Coaches</h2>
        <p className="lead">
          Archived coaches disappear from the public Coaches page; their history is kept.
        </p>
      </div>

      <Notices notice={firstParam(params.notice)} error={firstParam(params.error)} />
      {!result.ok && <Alert kind="err">{result.error ?? "Coaches could not be loaded."}</Alert>}

      {archiving && (
        <ConfirmBar
          message={
            archiving.activeClasses > 0
              ? `${archiving.name} still teaches ${archiving.activeClasses} active ${archiving.activeClasses === 1 ? "class" : "classes"}, so they cannot be archived yet. You can still press the button to see the reason.`
              : `Archive ${archiving.name}? They will no longer appear on the public Coaches page.`
          }
          action={archiveCoachAction}
          fields={{ id: archiving.id }}
          confirmLabel="Archive coach"
          cancelHref="/admin/coaches"
        />
      )}

      <section className="admin-section" aria-labelledby="coaches-heading">
        <h3 id="coaches-heading">All coaches</h3>
        <div className="table-wrap">
          <table className="admin-table">
            <caption className="sr-only">Coaches</caption>
            <thead>
              <tr>
                <th scope="col">Coach</th>
                <th scope="col">Title</th>
                <th scope="col">Active classes</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {coaches.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.name}
                    <div className="muted">{c.email}</div>
                  </td>
                  <td>{c.title}</td>
                  <td>{c.activeClasses}</td>
                  <td>
                    <span className={`tag ${c.isActive ? "tag--ok" : "tag--off"}`}>
                      {c.isActive ? "Active" : "Archived"}
                    </span>
                  </td>
                  <td>
                    <div className="admin-actions">
                      <Link
                        className="btn btn--grey btn--sm"
                        href={`/admin/coaches?edit=${c.id}`}
                        scroll={false}
                        aria-label={`Edit coach ${c.name}`}
                      >
                        Edit
                      </Link>
                      {c.isActive ? (
                        <Link
                          className="btn btn--line btn--sm"
                          href={`/admin/coaches?archive=${c.id}`}
                          scroll={false}
                          aria-label={`Archive coach ${c.name}`}
                        >
                          Archive
                        </Link>
                      ) : (
                        <form action={restoreCoachAction}>
                          <input type="hidden" name="id" value={c.id} />
                          <button
                            className="btn btn--line btn--sm"
                            type="submit"
                            aria-label={`Restore coach ${c.name}`}
                          >
                            Restore
                          </button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editing ? (
        <div className="admin-card">
          <h3>Edit {editing.name}</h3>
          <CoachForm
            key={editing.id}
            action={updateCoachAction}
            submitLabel="Save changes"
            initial={{
              id: String(editing.id),
              fullName: editing.name,
              email: editing.email,
              title: editing.title,
              bio: editing.bio,
              imageUrl: editing.imageUrl ?? "",
            }}
          />
          <p style={{ marginTop: 12 }}>
            <Link className="pill-link" href="/admin/coaches" scroll={false}>
              Cancel editing
            </Link>
          </p>
        </div>
      ) : (
        <div className="admin-card">
          <h3>Add a coach</h3>
          <CoachForm action={createCoachAction} submitLabel="Add coach" />
          <p className="help">The new coach is sent an invitation to set their password.</p>
        </div>
      )}
    </>
  );
}
