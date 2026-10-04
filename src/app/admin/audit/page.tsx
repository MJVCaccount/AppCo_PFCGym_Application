import type { Metadata } from "next";

import { requireRole } from "@/actions/auth";
import Alert from "@/components/Alert";
import { formatEventDate } from "@/lib/dates";
import { listAuditLog } from "@/lib/services/auditService";

export const metadata: Metadata = { title: "Admin · Audit log" };
export const dynamic = "force-dynamic";

export default async function AdminAuditPage() {
  const session = await requireRole("/admin/audit", "Admin");
  const result = await listAuditLog(session);
  const rows = result.data ?? [];

  return (
    <>
      <div className="section-head">
        <p className="eyebrow">Admin</p>
        <h2>Audit log</h2>
        <p className="lead">The latest 100 changes, newest first. Times are Johannesburg time.</p>
      </div>

      {!result.ok && <Alert kind="err">{result.error ?? "The audit log could not be loaded."}</Alert>}

      <div className="table-wrap">
        <table className="admin-table">
          <caption className="sr-only">Audit log</caption>
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Who</th>
              <th scope="col">Action</th>
              <th scope="col">Entity</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  Nothing recorded yet.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{formatEventDate(row.createdAt)}</td>
                <td>{row.actorName ?? "System"}</td>
                <td>{row.action}</td>
                <td>
                  {row.entity}
                  {row.entityId !== null ? ` #${row.entityId}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
