import type { Metadata } from "next";

import { reviewDocumentAction } from "@/actions/admin";
import { requireRole } from "@/actions/auth";
import Notices from "@/components/admin/Notices";
import Alert from "@/components/Alert";
import { formatEventDate } from "@/lib/dates";
import { listDocumentsForReview } from "@/lib/services/documentService";
import { firstParam, type SearchParams } from "@/lib/types";

export const metadata: Metadata = { title: "Admin · Documents" };
export const dynamic = "force-dynamic";

const STATUS_TAG = {
  Pending: "",
  Approved: "tag--ok",
  Rejected: "tag--red",
} as const;

export default async function AdminDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const session = await requireRole("/admin/documents", "Admin");

  const result = await listDocumentsForReview(session);
  const documents = result.data ?? [];
  const pending = documents.filter((d) => d.status === "Pending").length;

  return (
    <>
      <div className="section-head">
        <p className="eyebrow">Admin</p>
        <h2>Fighter documents</h2>
        <p className="lead">
          Medical and licence documents. They are private: open one only to
          review it. Pending documents come first.
        </p>
      </div>

      <Notices notice={firstParam(params.notice)} error={firstParam(params.error)} />
      {!result.ok && (
        <Alert kind="err">{result.error ?? "Documents could not be loaded."}</Alert>
      )}

      <section className="admin-section" aria-labelledby="documents-heading">
        <h3 id="documents-heading">
          {pending} pending of {documents.length}
        </h3>

        <div className="table-wrap">
          <table className="admin-table">
            <caption className="sr-only">Fighter documents</caption>
            <thead>
              <tr>
                <th scope="col">Fighter</th>
                <th scope="col">Type</th>
                <th scope="col">Uploaded</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {documents.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No documents have been uploaded.
                  </td>
                </tr>
              )}
              {documents.map((d) => (
                <tr key={d.id}>
                  <td>
                    {d.fighterName}
                    <div className="muted">{d.fileName}</div>
                  </td>
                  <td>{d.type}</td>
                  <td>
                    <time dateTime={d.uploadedAt}>{formatEventDate(d.uploadedAt)}</time>
                  </td>
                  <td>
                    <span className={`tag ${STATUS_TAG[d.status]}`}>{d.status}</span>
                    {d.reviewNote && <div className="muted">{d.reviewNote}</div>}
                  </td>
                  <td>
                    <div className="admin-actions">
                      <a
                        className="btn btn--grey btn--sm"
                        href={`/api/documents/${d.id}`}
                        aria-label={`Open ${d.type} document from ${d.fighterName}`}
                      >
                        Open
                      </a>
                      {d.status !== "Approved" && (
                        <form action={reviewDocumentAction}>
                          <input type="hidden" name="id" value={d.id} />
                          <input type="hidden" name="decision" value="Approved" />
                          <button
                            className="btn btn--red btn--sm"
                            type="submit"
                            aria-label={`Approve ${d.type} document from ${d.fighterName}`}
                          >
                            Approve
                          </button>
                        </form>
                      )}
                      {d.status !== "Rejected" && (
                        <form className="admin-actions" action={reviewDocumentAction}>
                          <input type="hidden" name="id" value={d.id} />
                          <input type="hidden" name="decision" value="Rejected" />
                          <label className="sr-only" htmlFor={`note-${d.id}`}>
                            Reason for rejecting {d.fighterName}&apos;s {d.type} document
                          </label>
                          <input
                            id={`note-${d.id}`}
                            name="note"
                            type="text"
                            placeholder="Reason (required)"
                            maxLength={500}
                            required
                          />
                          <button className="btn btn--line btn--sm" type="submit">
                            Reject
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
    </>
  );
}
